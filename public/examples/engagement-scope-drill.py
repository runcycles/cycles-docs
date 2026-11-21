"""Real Cycles RISK_POINTS reservations for a test-environment agent harness.

Python 3.10+, runcycles==0.5.3. Run only against a disposable test tenant.
No network traffic to any target: every "request" lands on a local fixture
that counts what it receives. Each invocation creates one engagement (an app
scope) with two target ledgers and nine run ledgers, and commits 120
RISK_POINTS in total. The tenant must have NO RISK_POINTS ledger at the
tenant scope: an ancestor ledger in the same unit would admit targets that
have no ledger of their own.
Low-level, single-process drill: no durable journal, transport retry, or
heartbeat. On an unexpected error, stop and inspect the printed operation IDs.
"""

from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass, field
import json
import os
import threading
from uuid import uuid4

import httpx
from runcycles import CyclesClient, CyclesConfig


RISK = "RISK_POINTS"
REQUEST_POINTS = 20       # Illustrative policy weight per outbound request
RUN_CAP = 30              # One run may make one request, not two
TARGET_CAP = 100          # All runs together may make five requests per target
FLEET_SIZE = 8
TTL_MS = 30_000           # Short lease, per the spec's leasing guidance


def amount(value):
    return {"unit": RISK, "amount": value}


def check(condition, message):
    if not condition:
        raise RuntimeError(message)


def emit(event, **fields):
    print(json.dumps({"event": event, **fields}), flush=True)


class Refused(Exception):
    """A definitive 4xx: no reservation exists and nothing may be dispatched."""

    def __init__(self, error):
        super().__init__(f"Reservation refused: {error}")
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


def subject_for(tenant, engagement, target, run):
    # Engagement -> app, target -> workflow, run -> agent. The target sits
    # above the run so that one target ledger is shared by every run.
    return {"tenant": tenant, "app": engagement, "workflow": target, "agent": run}


def reservation_body(subject, op, target, dry_run=False):
    body = {
        "idempotency_key": f"{op}-reserve",
        "subject": subject,
        "action": {"kind": "net.request", "name": "http.get"},
        "estimate": amount(REQUEST_POINTS),
        "ttl_ms": TTL_MS,
        "overage_policy": "REJECT",
        "metadata": {"operation_id": op, "target": target},
    }
    if dry_run:
        body["dry_run"] = True
    return body


def preflight(client, subject, op, target):
    """Nonpersisting check. Returns the decision and reason without a hold."""
    response = client.create_reservation(reservation_body(subject, op + "-dry", target, dry_run=True))
    body = response.body or {}
    if response.status == 200:
        return body.get("decision"), body.get("reason_code")
    if 400 <= response.status < 500:
        return "REFUSED", body.get("error", f"HTTP {response.status}")
    raise RuntimeError(f"Preflight unresolved for {op}: HTTP {response.status}")


def reserve(client, subject, op, target):
    response = client.create_reservation(reservation_body(subject, op, target))
    body = response.body or {}
    if response.status == 409 and body.get("error") == "BUDGET_EXCEEDED":
        emit("denied", op=op, target=target, error="BUDGET_EXCEEDED")
        raise Denied("BUDGET_EXCEEDED")
    if 400 <= response.status < 500:
        # NOT_FOUND (no ledger at any derived scope), UNIT_MISMATCH (only
        # ledgers in other units), INSUFFICIENT_PERMISSIONS, ...: fail closed.
        error = body.get("error", f"HTTP {response.status}")
        emit("refused", op=op, target=target, error=error)
        raise Refused(error)
    if response.status != 200:
        # Transport error or 5xx: the reservation may exist. A production
        # adapter retries with the same key; this drill stops for inspection.
        raise RuntimeError(f"Admission unresolved for {op}: HTTP {response.status}")
    rid = body.get("reservation_id")
    if not rid or body.get("decision") not in ("ALLOW", "ALLOW_WITH_CAPS"):
        raise RuntimeError(f"Invalid admission for {op}")
    if body.get("decision") == "ALLOW_WITH_CAPS" or body.get("caps"):
        release(client, rid, op, "Caps returned; fixture cannot enforce them")
        raise RuntimeError("Use a test tenant without caps; this fixture cannot enforce them")
    emit("reserved", op=op, target=target, reservation_id=rid)
    return rid


def release(client, rid, op, reason):
    response = client.release_reservation(rid, {"idempotency_key": f"{op}-release", "reason": reason})
    if response.status != 200 or (response.body or {}).get("status") != "RELEASED":
        raise RuntimeError(f"Release unresolved for {op}: HTTP {response.status}")
    emit("released", op=op)


def commit(client, rid, op):
    response = client.commit_reservation(rid, {
        "idempotency_key": f"{op}-commit",
        "actual": amount(REQUEST_POINTS),
    })
    body = response.body or {}
    if (response.status != 200 or body.get("status") != "COMMITTED"
            or body.get("charged") != amount(REQUEST_POINTS)):
        raise RuntimeError(f"Commit unresolved for {op}: HTTP {response.status}")
    emit("committed", op=op)


def send(client, targets, subject, op, barrier=None):
    """The only path to a target: reserve, dispatch, commit. Refusal sends nothing."""
    target = subject["workflow"]
    try:
        rid = reserve(client, subject, op, target)
    except Refused as refused:
        if barrier:
            barrier.wait()
        return "denied" if isinstance(refused, Denied) else f"refused:{refused.error}"
    except Exception:
        if barrier:
            barrier.abort()  # Unblock the other workers instead of hanging
        raise
    try:
        if barrier:
            barrier.wait()  # Hold admitted reservations until every run is decided
    except Exception:
        release(client, rid, op, "Not dispatched: synchronization failure")
        raise
    targets.request(target, op)
    # The request went out, so the charge stands. Never release after dispatch.
    commit(client, rid, op)
    return "sent"


def ledger(client, scope_subject):
    response = client.get_balances(**scope_subject)
    if response.status != 200 or not response.body:
        raise RuntimeError(f"Balance read failed: HTTP {response.status}")
    path = "/".join(f"{k}:{v}" for k, v in scope_subject.items())
    rows = [b for b in response.body["balances"]
            if b["scope_path"] == path and b["remaining"]["unit"] == RISK]
    if not rows:
        return None
    return rows[0]["spent"]["amount"], rows[0]["reserved"]["amount"]


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
            provision(f"{base}/workflow:{target}", TARGET_CAP)
        provision(f"{base}/workflow:{in_scope}/agent:run-solo", RUN_CAP)
        fleet_runs = [f"run-{i}" for i in range(FLEET_SIZE)]
        for run in fleet_runs:
            provision(f"{base}/workflow:{fleet_target}/agent:{run}", RUN_CAP)

        # 1. In-scope target, within the run cap: the request goes out.
        targets = Targets()
        solo = subject_for(tenant, engagement, in_scope, "run-solo")
        check(send(client, targets, solo, f"{batch}-a1") == "sent", "In-scope request was not sent")
        check(targets.count(in_scope) == 1, "Unexpected request count")
        emit("PASS", scenario="in_scope", requests=1, target_spent=REQUEST_POINTS)

        # 2. Same run, same target, second request: the run ledger denies it
        #    while the target ledger still has 80 points.
        check(send(client, targets, solo, f"{batch}-a2") == "denied", "Run cap did not deny")
        check(targets.count(in_scope) == 1, "A denied request reached the target")
        check(ledger(client, {"tenant": tenant, "app": engagement, "workflow": in_scope})
              == (REQUEST_POINTS, 0), "Target ledger mismatch after run-cap denial")
        emit("PASS", scenario="run_cap", requests=1, denied=1, target_spent=REQUEST_POINTS)

        # 3. A target with no ledger: no authority exists to reserve against.
        stray = subject_for(tenant, engagement, out_of_scope, "run-solo")
        decision, reason = preflight(client, stray, f"{batch}-b1", out_of_scope)
        check(decision in ("DENY", "REFUSED"), f"Preflight admitted an unlisted target: {decision}")
        result = send(client, targets, stray, f"{batch}-b1")
        check(result.startswith("refused:"), f"Unlisted target was not refused: {result}")
        check(targets.count(out_of_scope) == 0, "A refused request reached the unlisted target")
        # The agent's own key cannot write the missing ledger into existence.
        minted = admin_post_budget(f"{base}/workflow:{out_of_scope}", TARGET_CAP, runtime_key)
        check(minted.status_code == 403, f"Runtime key could write a ledger: HTTP {minted.status_code}")
        emit("PASS", scenario="out_of_scope", requests=0, preflight=f"{decision}:{reason}",
             live=result, runtime_key_budget_write=minted.status_code)

        # 4. Eight concurrent runs, each within its own cap: the shared target
        #    ledger admits five and denies three.
        barrier = threading.Barrier(FLEET_SIZE, timeout=15)

        def attempt(run):
            with CyclesClient(config) as worker:
                subject = subject_for(tenant, engagement, fleet_target, run)
                return send(worker, targets, subject, f"{batch}-f-{run}", barrier)

        with ThreadPoolExecutor(max_workers=FLEET_SIZE) as pool:
            results = sorted(pool.map(attempt, fleet_runs))
        allowed = TARGET_CAP // REQUEST_POINTS
        check(results == ["denied"] * (FLEET_SIZE - allowed) + ["sent"] * allowed,
              f"Unexpected fleet result: {results}")
        check(targets.count(fleet_target) == allowed, "Unexpected fleet request count")
        check(ledger(client, {"tenant": tenant, "app": engagement, "workflow": fleet_target})
              == (TARGET_CAP, 0), "Fleet target ledger mismatch")
        emit("PASS", scenario="fleet", runs=FLEET_SIZE, requests=allowed,
             denied=FLEET_SIZE - allowed, target_spent=TARGET_CAP)


if __name__ == "__main__":
    main()
