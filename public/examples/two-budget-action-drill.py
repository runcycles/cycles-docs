"""Real Cycles reservations in two units, simulated compute provisioning.

Python 3.10+, runcycles==0.5.3. Run only against a disposable test tenant.
No cloud API calls: launches, billing periods, and teardown are local fixtures.
Each invocation creates four workflows with USD_MICROCENTS and RISK_POINTS
ledgers and commits $1.05 plus 60 RISK_POINTS in total. The tenant needs at
least $1.50 of available USD_MICROCENTS capacity and no caps.
Low-level, single-process drill: no durable journal, transport retry, or
heartbeat. On an unexpected error, stop and inspect the printed operation IDs.
"""

from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass, field
import json
import os
import threading
import time
from uuid import uuid4

import httpx
from runcycles import CyclesClient, CyclesConfig


USD = "USD_MICROCENTS"
RISK = "RISK_POINTS"
CENT = 1_000_000                  # 1 cent in USD_MICROCENTS
LAUNCH_POINTS = 20                # Illustrative policy weight, not a damage estimate
PERIOD_ESTIMATE = 40 * CENT       # Synthetic price ceiling for one billing period
PERIOD_ACTUAL = 35 * CENT         # Synthetic metered usage for one period
TENANT_MINIMUM = 150 * CENT
TTL_MS = 30_000                   # Short lease, per the spec's leasing guidance
DISPATCH_MARGIN_S = 5             # Refuse to dispatch on a lease about to lapse


def amount(unit, value):
    return {"unit": unit, "amount": value}


def check(condition, message):
    if not condition:
        raise RuntimeError(message)


def emit(event, **fields):
    print(json.dumps({"event": event, **fields}), flush=True)


class Refused(Exception):
    """A definitive 4xx: no reservation exists, so any companion hold must go."""

    def __init__(self, unit, error):
        super().__init__(f"{unit} reservation refused: {error}")
        self.unit = unit
        self.error = error


class Denied(Refused):
    """409 BUDGET_EXCEEDED: the budget, not the request, said no."""


@dataclass
class Fleet:
    """Stands in for a cloud API. Counts every call it receives."""

    launches: list = field(default_factory=list)
    teardowns: list = field(default_factory=list)
    lock: threading.Lock = field(default_factory=threading.Lock)

    def launch(self, op):
        with self.lock:
            self.launches.append(op)
        emit("instance_launched", op=op)

    def teardown(self, op):
        with self.lock:
            self.teardowns.append(op)
        emit("instance_terminated", op=op)


@dataclass
class Hold:
    """One live reservation plus a conservative local deadline for its lease."""

    rid: str
    key: str
    unit: str
    capped: bool
    deadline: float

    def seconds_left(self):
        return self.deadline - time.monotonic()


def reserve(client, subject, op, unit, value, key_suffix):
    key = f"{op}-{key_suffix}"
    sent_at = time.monotonic()  # Measure from send time: never overstate the lease
    response = client.create_reservation({
        # One key per unit: idempotency is scoped to the endpoint, so reusing
        # a key with a different unit returns 409 IDEMPOTENCY_MISMATCH.
        "idempotency_key": key + "-reserve",
        "subject": subject,
        "action": {"kind": "infra.provision", "name": "compute.gpu_instance"},
        "estimate": amount(unit, value),
        "ttl_ms": TTL_MS,
        "overage_policy": "REJECT",
        "metadata": {"operation_id": op},  # Links both units in the audit trail
    })
    body = response.body or {}
    if response.status == 409 and body.get("error") == "BUDGET_EXCEEDED":
        emit("denied", op=op, unit=unit)
        raise Denied(unit, "BUDGET_EXCEEDED")
    if 400 <= response.status < 500:
        # UNIT_MISMATCH, IDEMPOTENCY_MISMATCH, DEBT_OUTSTANDING, ...: fail closed.
        raise Refused(unit, body.get("error", f"HTTP {response.status}"))
    if response.status != 200:
        # Transport error or 5xx: the reservation may exist. A production
        # adapter retries with the same key; this drill stops for inspection.
        raise RuntimeError(f"Admission unresolved for {key}: HTTP {response.status}")
    rid = body.get("reservation_id")
    if not rid or body.get("decision") not in ("ALLOW", "ALLOW_WITH_CAPS"):
        raise RuntimeError(f"Invalid admission for {key}")
    capped = body.get("decision") == "ALLOW_WITH_CAPS" or bool(body.get("caps"))
    # The server may grant less than the requested TTL; trust its remaining_ttl_ms.
    lease_ms = min(TTL_MS, body.get("remaining_ttl_ms", TTL_MS))
    emit("reserved", op=op, unit=unit, amount=value, reservation_id=rid)
    return Hold(rid, key, unit, capped, sent_at + lease_ms / 1000)


def release(client, hold, reason):
    response = client.release_reservation(hold.rid, {
        "idempotency_key": hold.key + "-release",
        "reason": reason,
    })
    if response.status != 200 or (response.body or {}).get("status") != "RELEASED":
        raise RuntimeError(f"Release unresolved for {hold.key}: HTTP {response.status}")
    emit("released", key=hold.key)


def release_all(client, holds, reason):
    """Attempt every release, even if one fails, then report what is unresolved."""
    failures = []
    for hold in holds:
        try:
            release(client, hold, reason)
        except Exception as exc:  # Keep going: the other hold is independent
            failures.append(f"{hold.key}: {exc}")
    if failures:
        raise RuntimeError("Unresolved holds: " + "; ".join(failures))


def commit(client, hold, value):
    response = client.commit_reservation(hold.rid, {
        "idempotency_key": hold.key + "-commit",
        "actual": amount(hold.unit, value),
    })
    body = response.body or {}
    if (response.status != 200 or body.get("status") != "COMMITTED"
            or body.get("charged") != amount(hold.unit, value)):
        raise RuntimeError(f"Commit unresolved for {hold.key}: HTTP {response.status}")
    emit("committed", key=hold.key, unit=hold.unit, amount=value)


def admit_launch(client, subject, op):
    """Both reservations must succeed before dispatch. Fixed order: risk, then cost."""
    risk = reserve(client, subject, op, RISK, LAUNCH_POINTS, "risk")
    try:
        usd = reserve(client, subject, op, USD, PERIOD_ESTIMATE, "usd-p1")
    except Refused as refused:
        # Definitive: no cost reservation exists, so return the risk hold now.
        release_all(client, [risk], f"Cost reservation refused: {refused.error}")
        raise
    if risk.capped or usd.capped:
        # This fixture cannot enforce caps, so it declines the action entirely.
        release_all(client, [risk, usd], "Caps returned; executor cannot enforce them")
        raise RuntimeError("Use a test tenant without caps; this fixture cannot enforce them")
    return risk, usd


def launch(client, subject, fleet, op, barrier=None):
    try:
        risk, usd = admit_launch(client, subject, op)
    except Denied as denied:
        if barrier:
            barrier.wait()
        return f"denied:{denied.unit}"
    except Exception:
        if barrier:
            barrier.abort()  # Unblock the other workers instead of hanging
        raise
    try:
        if barrier:
            barrier.wait()  # Hold admitted reservations until every attempt is decided
        if min(risk.seconds_left(), usd.seconds_left()) < DISPATCH_MARGIN_S:
            raise RuntimeError(f"Lease too short to dispatch {op}")
    except Exception:
        # Nothing was dispatched: return both holds rather than strand them.
        release_all(client, [risk, usd], "Not dispatched: synchronization or lease failure")
        raise
    fleet.launch(op)
    failures = []
    # Policy: the risk charge is fixed once the provider accepts the launch.
    # The first period's metered usage settles the first cost reservation.
    for hold, value in ((risk, LAUNCH_POINTS), (usd, PERIOD_ACTUAL)):
        try:
            commit(client, hold, value)
        except Exception as exc:  # Settle each ledger independently
            failures.append(f"{hold.key}: {exc}")
    if failures:
        # Execution happened, so never release. Stop the spend and leave the
        # unsettled holds for reconciliation against what actually ran.
        fleet.teardown(op)
        raise RuntimeError("Settlement unresolved after launch: " + "; ".join(failures))
    return "launched"


def renew(client, subject, fleet, op, period):
    """Continuing spend needs fresh admission. Teardown is never gated on it."""
    try:
        hold = reserve(client, subject, op, USD, PERIOD_ESTIMATE, f"usd-p{period}")
        if hold.capped:
            release_all(client, [hold], "Caps returned; executor cannot enforce them")
            raise RuntimeError("Use a test tenant without caps")
        commit(client, hold, PERIOD_ACTUAL)
    except Denied:
        fleet.teardown(op)
        return "terminated"
    except Exception:
        fleet.teardown(op)  # No confirmed, settled period: stop the spend
        raise
    return "renewed"


def ledger(client, subject, unit):
    response = client.get_balances(**subject)
    if response.status != 200 or not response.body:
        raise RuntimeError(f"Balance read failed: HTTP {response.status}")
    path = "/".join(f"{k}:{v}" for k, v in subject.items())
    row = next(b for b in response.body["balances"]
               if b["scope_path"] == path and b["remaining"]["unit"] == unit)
    return row["spent"]["amount"], row["reserved"]["amount"]


def verify(client, subject, usd_spent, risk_spent):
    observed = {USD: ledger(client, subject, USD), RISK: ledger(client, subject, RISK)}
    expected = {USD: (usd_spent, 0), RISK: (risk_spent, 0)}
    if observed != expected:
        raise RuntimeError(f"Ledger mismatch for {subject['workflow']}: {observed} != {expected}")


def provision(tenant, workflow, usd_allocation, risk_allocation):
    for unit, value in ((USD, usd_allocation), (RISK, risk_allocation)):
        response = httpx.post(
            os.environ["CYCLES_ADMIN_URL"].rstrip("/") + "/v1/admin/budgets",
            headers={"X-Cycles-API-Key": os.environ["CYCLES_BUDGET_API_KEY"]},
            json={"scope": f"tenant:{tenant}/workflow:{workflow}",
                  "unit": unit, "allocated": amount(unit, value)},
            timeout=15,
        )
        response.raise_for_status()


def preflight(client, tenant):
    remaining, params = None, {"tenant": tenant, "limit": "200"}
    while remaining is None:
        response = client.get_balances(**params)
        if response.status != 200 or not response.body:
            raise RuntimeError(f"Balance read failed: HTTP {response.status}")
        for row in response.body["balances"]:
            if row["scope_path"] == f"tenant:{tenant}" and row["remaining"]["unit"] == USD:
                remaining = row["remaining"]["amount"]
        if not response.body.get("has_more"):
            break
        params["cursor"] = response.body["next_cursor"]
    if remaining is None or remaining < TENANT_MINIMUM:
        raise RuntimeError("Tenant needs at least $1.50 of available USD_MICROCENTS capacity")


def main():
    tenant = os.environ["CYCLES_TENANT"]
    config = CyclesConfig(base_url=os.environ["CYCLES_BASE_URL"],
                          api_key=os.environ["CYCLES_API_KEY"], tenant=tenant)
    batch = uuid4().hex[:10]

    def subject_for(name, usd_allocation, risk_allocation):
        workflow = f"two-budget-{batch}-{name}"
        provision(tenant, workflow, usd_allocation, risk_allocation)
        return {"tenant": tenant, "workflow": workflow}

    with CyclesClient(config) as client:
        preflight(client, tenant)

        # 1. Cost fits, risk does not: the cost ledger is never touched.
        fleet, subject = Fleet(), subject_for("risk-denied", 100 * CENT, 10)
        result = launch(client, subject, fleet, f"{batch}-rd")
        check(result == f"denied:{RISK}" and not fleet.launches, f"Unexpected result: {result}")
        verify(client, subject, 0, 0)
        emit("PASS", scenario="risk_denied", launches=0, usd_spent=0, risk_spent=0)

        # 2. Risk fits, cost does not: the risk hold is released, nothing launches.
        fleet, subject = Fleet(), subject_for("cost-denied", 20 * CENT, 50)
        result = launch(client, subject, fleet, f"{batch}-cd")
        check(result == f"denied:{USD}" and not fleet.launches, f"Unexpected result: {result}")
        verify(client, subject, 0, 0)
        emit("PASS", scenario="cost_denied", launches=0, usd_spent=0, risk_spent=0)

        # 3. Three concurrent launches: risk allows three, cost allows two.
        fleet, subject = Fleet(), subject_for("race", 100 * CENT, 60)
        barrier = threading.Barrier(3, timeout=10)
        ops = [f"{batch}-race{i}" for i in range(3)]

        def attempt(op):
            with CyclesClient(config) as worker:
                return launch(worker, subject, fleet, op, barrier)

        with ThreadPoolExecutor(max_workers=3) as pool:
            results = sorted(pool.map(attempt, ops))
        check(results == ["denied:" + USD, "launched", "launched"], f"Unexpected result: {results}")
        check(len(fleet.launches) == 2, f"Unexpected launches: {fleet.launches}")
        verify(client, subject, 2 * PERIOD_ACTUAL, 2 * LAUNCH_POINTS)
        for op in fleet.launches:
            fleet.teardown(op)  # Clean shutdown; no reservation required
        emit("PASS", scenario="race", launches=2, usd_spent=2 * PERIOD_ACTUAL,
             risk_spent=2 * LAUNCH_POINTS)

        # 4. The second billing period does not fit: teardown, not overage.
        fleet, subject = Fleet(), subject_for("renewal", 70 * CENT, 50)
        op = f"{batch}-rn"
        check(launch(client, subject, fleet, op) == "launched", "Unexpected scenario outcome")
        check(renew(client, subject, fleet, op, period=2) == "terminated", "Unexpected scenario outcome")
        check(fleet.launches == [op] and fleet.teardowns == [op], "Unexpected scenario outcome")
        verify(client, subject, PERIOD_ACTUAL, LAUNCH_POINTS)
        emit("PASS", scenario="renewal", launches=1, teardowns=1,
             usd_spent=PERIOD_ACTUAL, risk_spent=LAUNCH_POINTS)


if __name__ == "__main__":
    main()
