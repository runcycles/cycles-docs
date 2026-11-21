"""Real Cycles RISK_POINTS reservations for a test-environment agent harness.

Python 3.10+, runcycles==0.5.3. Run only against a disposable test tenant.
No network traffic to any target: every "request" lands on a local fixture
that counts what it receives. The script does call the Cycles runtime and
admin servers. Each invocation creates one engagement (an app scope) with two
target ledgers and nine run ledgers, and commits 120 RISK_POINTS in total.
The tenant must have NO RISK_POINTS ledger at the tenant scope: an ancestor
ledger in the same unit would admit targets that have no ledger of their own.

What this drill does not implement: a host-side target allowlist, a check
that a run ledger exists before a run starts, an engagement time window, or
technique restrictions. It holds both API keys in one process for
convenience; a real harness gets only the runtime key.
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


RISK = "RISK_POINTS"
REQUEST_POINTS = 20       # Illustrative policy weight per outbound request
RUN_ALLOCATION = 30       # One run may make one request to a target, not two
TARGET_ALLOCATION = 100   # All runs together may make five requests per target
FLEET_SIZE = 8
TTL_MS = 30_000           # Short lease, per the spec's leasing guidance
DISPATCH_MARGIN_S = 5     # Refuse to dispatch on a lease about to lapse


def amount(value):
    return {"unit": RISK, "amount": value}


def check(condition, message):
    if not condition:
        raise RuntimeError(message)


def emit(event, **fields):
    try:
        print(json.dumps({"event": event, **fields}), flush=True)
    except Exception:
        pass  # Diagnostics must never interrupt release or commit


class Refused(Exception):
    """A definitive 4xx: this call granted no authority, so nothing is dispatched."""

    def __init__(self, status, error):
        super().__init__(f"Reservation refused: HTTP {status} {error}")
        self.status = status
        self.error = error


class Denied(Refused):
    """409 BUDGET_EXCEEDED: a ledger exists and it said no."""


@dataclass
class Targets:
    """Stands in for the network. Counts every request each target receives."""

    received: dict = field(default_factory=dict)
    lock: threading.Lock = field(default_factory=threading.Lock)

    def request(self, target, op):
        with self.lock:
            self.received.setdefault(target, []).append(op)
        emit("request_sent", target=target, op=op)

    def count(self, target):
        return len(self.received.get(target, []))


@dataclass
class Hold:
    """One live reservation plus a conservative local deadline for its lease."""

    rid: str
    deadline: float

    def seconds_left(self):
        return self.deadline - time.monotonic()


def subject_for(tenant, engagement, target, run):
    # Engagement -> app, target -> workflow, run -> agent. The target sits
    # above the run so that one target ledger is shared by every run. The run
    # ledger is therefore per run-target pair.
    return {"tenant": tenant, "app": engagement, "workflow": target, "agent": run}


def context(subject, op):
    return {"engagement": subject["app"], "target": subject["workflow"],
            "run": subject["agent"], "op": op}


def reservation_body(subject, op, dry_run=False):
    body = {
        "idempotency_key": f"{op}-reserve",
        "subject": subject,
        "action": {"kind": "net.request", "name": "http.get"},
        "estimate": amount(REQUEST_POINTS),
        "ttl_ms": TTL_MS,
        "overage_policy": "REJECT",
        "metadata": {"operation_id": op, "target": subject["workflow"]},
    }
    if dry_run:
        body["dry_run"] = True
    return body


def preflight(client, subject, op):
    """Nonpersisting check. Returns (http_status, decision_or_error, reason_code)."""
    response = client.create_reservation(reservation_body(subject, op + "-dry", dry_run=True))
    body = response.body or {}
    if response.status == 200:
        result = (200, body.get("decision"), body.get("reason_code"))
    elif 400 <= response.status < 500:
        result = (response.status, body.get("error"), None)
    else:
        raise RuntimeError(f"Preflight unresolved for {op}: HTTP {response.status}")
    emit("preflight", **context(subject, op), status=result[0], result=result[1], reason=result[2])
    return result


def reserve(client, subject, op):
    sent_at = time.monotonic()  # Measure from send time: never overstate the lease
    response = client.create_reservation(reservation_body(subject, op))
    body = response.body or {}
    if 400 <= response.status < 500:
        # NOT_FOUND (no ledger at any derived scope), UNIT_MISMATCH (only
        # ledgers in other units), BUDGET_EXCEEDED, ...: fail closed.
        error = body.get("error", "UNKNOWN")
        emit("refused", **context(subject, op), status=response.status, error=error)
        if response.status == 409 and error == "BUDGET_EXCEEDED":
            raise Denied(response.status, error)
        raise Refused(response.status, error)
    if response.status != 200:
        # Transport error or 5xx: the reservation may exist. A production
        # adapter retries with the same key; this drill stops for inspection.
        raise RuntimeError(f"Admission unresolved for {op}: HTTP {response.status}")
    rid = body.get("reservation_id")
    if not rid:
        raise RuntimeError(f"Invalid admission for {op}: no reservation_id")
    if body.get("decision") != "ALLOW" or body.get("caps"):
        # ALLOW_WITH_CAPS or a malformed success: the hold exists, so return it.
        release(client, rid, op, "Not dispatched: fixture cannot enforce this decision")
        raise RuntimeError("Use a test tenant with no caps configured; this fixture cannot enforce them")
    # The server may grant less than the requested TTL; trust its remaining_ttl_ms.
    lease_ms = min(TTL_MS, body.get("remaining_ttl_ms", TTL_MS))
    emit("reserved", **context(subject, op), reservation_id=rid)
    return Hold(rid, sent_at + lease_ms / 1000)


def release(client, rid, op, reason):
    response = client.release_reservation(rid, {"idempotency_key": f"{op}-release", "reason": reason})
    if response.status != 200 or (response.body or {}).get("status") != "RELEASED":
        raise RuntimeError(f"Release unresolved for {op} ({rid}): HTTP {response.status}")
    emit("released", op=op)


def commit(client, rid, op):
    response = client.commit_reservation(rid, {
        "idempotency_key": f"{op}-commit",
        "actual": amount(REQUEST_POINTS),
    })
    body = response.body or {}
    if (response.status != 200 or body.get("status") != "COMMITTED"
            or body.get("charged") != amount(REQUEST_POINTS)):
        # Execution happened, so never release. Reconcile with the same key.
        raise RuntimeError(f"Commit unresolved for {op} ({rid}): HTTP {response.status}")
    emit("committed", op=op)


def send(client, targets, subject, op, barrier=None):
    """The only path to a target: reserve, dispatch, commit. Refusal sends nothing."""
    target = subject["workflow"]
    try:
        hold = reserve(client, subject, op)
    except Refused as refused:
        if barrier:
            barrier.wait()
        if isinstance(refused, Denied):
            return "denied"
        return f"refused:{refused.status}:{refused.error}"
    except Exception:
        if barrier:
            barrier.abort()  # Unblock the other workers instead of hanging
        raise
    try:
        if barrier:
            barrier.wait()  # Hold admitted reservations until every run is decided
        if hold.seconds_left() < DISPATCH_MARGIN_S:
            raise RuntimeError(f"Lease too short to dispatch {op}")
    except Exception:
        # Nothing was dispatched: return the hold rather than strand it.
        release(client, hold.rid, op, "Not dispatched: synchronization or lease failure")
        raise
    targets.request(target, op)
    # The request went out, so the charge stands. Never release after dispatch.
    commit(client, hold.rid, op)
    return "sent"


def ledger(client, scope_subject):
    """Find the RISK_POINTS row for exactly this scope, following pagination."""
    path = "/".join(f"{k}:{v}" for k, v in scope_subject.items())
    params = {**scope_subject, "limit": "200"}
    while True:
        response = client.get_balances(**params)
        if response.status != 200 or not response.body:
            raise RuntimeError(f"Balance read failed: HTTP {response.status}")
        for row in response.body["balances"]:
            if row["scope_path"] == path and row["remaining"]["unit"] == RISK:
                return row["spent"]["amount"], row["reserved"]["amount"]
        if not response.body.get("has_more"):
            return None
        params["cursor"] = response.body["next_cursor"]


def admin_post_budget(scope, value, api_key):
    return httpx.post(
        os.environ["CYCLES_ADMIN_URL"].rstrip("/") + "/v1/admin/budgets",
        headers={"X-Cycles-API-Key": api_key},
        json={"scope": scope, "unit": RISK, "allocated": amount(value)},
        timeout=15,
    )


def provision(scope, value):
    admin_post_budget(scope, value, os.environ["CYCLES_BUDGET_API_KEY"]).raise_for_status()


def main():
    tenant = os.environ["CYCLES_TENANT"]
    runtime_key = os.environ["CYCLES_API_KEY"]
    config = CyclesConfig(base_url=os.environ["CYCLES_BASE_URL"], api_key=runtime_key, tenant=tenant)
    batch = uuid4().hex[:10]
    engagement = f"eval-{batch}"
    in_scope, fleet_target, out_of_scope = "staging-api", "staging-search", "crm-internal"
    base = f"tenant:{tenant}/app:{engagement}"

    with CyclesClient(config) as client:
        # An ancestor RISK_POINTS ledger would admit targets with no ledger.
        check(ledger(client, {"tenant": tenant}) is None,
              "Tenant scope has a RISK_POINTS ledger; use a tenant without one")

        # The operator, not the agent, writes the rules of engagement.
        for target in (in_scope, fleet_target):
            provision(f"{base}/workflow:{target}", TARGET_ALLOCATION)
        provision(f"{base}/workflow:{in_scope}/agent:run-solo", RUN_ALLOCATION)
        fleet_runs = [f"run-{i}" for i in range(FLEET_SIZE)]
        for run in fleet_runs:
            provision(f"{base}/workflow:{fleet_target}/agent:{run}", RUN_ALLOCATION)

        # 1. In-scope target, within the run allocation: the request goes out.
        targets = Targets()
        solo = subject_for(tenant, engagement, in_scope, "run-solo")
        check(send(client, targets, solo, f"{batch}-a1") == "sent", "In-scope request was not sent")
        check(targets.count(in_scope) == 1, "Unexpected request count")
        emit("PASS", scenario="in_scope", requests=1, target_spent=REQUEST_POINTS)

        # 2. Same run, same target, second request: the run ledger denies it
        #    while the target ledger still has 80 points.
        check(send(client, targets, solo, f"{batch}-a2") == "denied", "Run ledger did not deny")
        check(targets.count(in_scope) == 1, "A denied request reached the target")
        check(ledger(client, {"tenant": tenant, "app": engagement, "workflow": in_scope})
              == (REQUEST_POINTS, 0), "Target ledger mismatch after run-ledger denial")
        emit("PASS", scenario="run_cap", requests=1, denied=1, target_spent=REQUEST_POINTS)

        # 3. A target with no ledger: no authority exists to reserve against.
        #    Exactly two outcomes are documented, depending on whether an
        #    ancestor holds a ledger in another unit. Anything else fails.
        stray = subject_for(tenant, engagement, out_of_scope, "run-solo")
        dry = preflight(client, stray, f"{batch}-b1")
        live = send(client, targets, stray, f"{batch}-b1")
        no_ledger = dry == (200, "DENY", "BUDGET_NOT_FOUND") and live == "refused:404:NOT_FOUND"
        other_unit = dry == (400, "UNIT_MISMATCH", None) and live == "refused:400:UNIT_MISMATCH"
        check(no_ledger or other_unit, f"Unexpected result for unlisted target: {dry} / {live}")
        check(targets.count(out_of_scope) == 0, "A refused request reached the unlisted target")
        # The runtime key cannot write the missing ledger into existence.
        minted = admin_post_budget(f"{base}/workflow:{out_of_scope}", TARGET_ALLOCATION, runtime_key)
        minted_error = (minted.json() or {}).get("error") if minted.status_code == 403 else None
        check(minted_error == "INSUFFICIENT_PERMISSIONS",
              f"Expected 403 INSUFFICIENT_PERMISSIONS, got HTTP {minted.status_code} {minted_error}")
        emit("PASS", scenario="out_of_scope", requests=0,
             preflight="DENY:BUDGET_NOT_FOUND" if no_ledger else "400:UNIT_MISMATCH",
             live=live, runtime_key_budget_write="403:INSUFFICIENT_PERMISSIONS")

        # 4. Eight concurrent runs, each within its own allocation: the shared
        #    target ledger admits five and denies three.
        barrier = threading.Barrier(FLEET_SIZE, timeout=15)

        def attempt(run):
            with CyclesClient(config) as worker:
                subject = subject_for(tenant, engagement, fleet_target, run)
                return send(worker, targets, subject, f"{batch}-f-{run}", barrier)

        with ThreadPoolExecutor(max_workers=FLEET_SIZE) as pool:
            results = sorted(pool.map(attempt, fleet_runs))
        allowed = TARGET_ALLOCATION // REQUEST_POINTS
        check(results == ["denied"] * (FLEET_SIZE - allowed) + ["sent"] * allowed,
              f"Unexpected fleet result: {results}")
        check(targets.count(fleet_target) == allowed, "Unexpected fleet request count")
        check(ledger(client, {"tenant": tenant, "app": engagement, "workflow": fleet_target})
              == (TARGET_ALLOCATION, 0), "Fleet target ledger mismatch")
        emit("PASS", scenario="fleet", runs=FLEET_SIZE, requests=allowed,
             denied=FLEET_SIZE - allowed, target_spent=TARGET_ALLOCATION)


if __name__ == "__main__":
    main()
