"""Real Cycles RISK_POINTS reservations shaped like insurance policy terms.

Python 3.10+, runcycles==0.5.3. Run only against a disposable test tenant.
Nothing leaves the machine except calls to the Cycles runtime and admin
servers: every "action" lands on a local fixture that records what it ran.
Each invocation creates one policy (an app scope) with an aggregate ledger,
one sublimit ledger, and one zero-allocation ledger, and commits 210
RISK_POINTS in total across two periods.
The tenant must have NO RISK_POINTS ledger at the tenant scope: an ancestor
ledger in the same unit is a further limit this drill does not account for.

What this drill does not implement: any link between points and money, a
durable record of dispatched actions, transport retry, or heartbeats. It
holds both API keys in one process for convenience; a real harness gets only
the runtime key. It finishes all work before it renews the ledgers, so no
commit can land between two resets. On an unexpected error, stop and inspect
the printed operation IDs: a reservation whose response was lost can stay
held until its TTL and grace period pass.
"""

from collections import Counter
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
# Illustrative policy terms. The weights are an operator's choice, not a
# measurement of loss.
WEIGHTS = {"email": 10, "refund": 30, "delete": 40, "export": 80}
PER_ACTION = 40           # Checked in the harness before any reservation
AGGREGATE = 200           # All action classes together, per period
SUBLIMITS = {"refund": 60}
EXCLUDED = ("delete",)    # A ledger with zero allocation
FLEET_SIZE = 20
TTL_MS = 30_000           # Short lease, per the spec's leasing guidance
DISPATCH_MARGIN_S = 5     # Refuse to dispatch on a lease about to lapse


def amount(value):
    return {"unit": RISK, "amount": value}


def check(condition, message):
    if not condition:
        raise RuntimeError(message)


EMIT_LOCK = threading.Lock()


def emit(event, **fields):
    try:
        with EMIT_LOCK:  # One whole JSON line per event, even across workers
            print(json.dumps({"event": event, **fields}), flush=True)
    except Exception:
        pass  # Diagnostics must never interrupt release or commit


class Denied(Exception):
    """409 BUDGET_EXCEEDED: a ledger on the path lacks the points."""


@dataclass
class Journal:
    """Stands in for the outside world and for the harness's own records."""

    reserve_calls: list = field(default_factory=list)  # (op, action_class)
    dispatched: list = field(default_factory=list)   # (op, action_class)
    committed: dict = field(default_factory=dict)    # op -> (action_class, points)
    refusals: list = field(default_factory=list)     # (op, action_class, reason)
    lock: threading.Lock = field(default_factory=threading.Lock)

    def reserving(self, op, action_class):
        with self.lock:
            self.reserve_calls.append((op, action_class))

    def dispatch(self, op, action_class):
        with self.lock:
            self.dispatched.append((op, action_class))
        emit("action_dispatched", op=op, action_class=action_class)

    def settle(self, op, action_class, points):
        with self.lock:
            self.committed[op] = (action_class, points)

    def refuse(self, op, action_class, reason, status=None):
        with self.lock:
            self.refusals.append((op, action_class, reason))
        emit("refused", op=op, action_class=action_class, status=status, reason=reason)

    def count(self, action_class):
        return sum(1 for _, c in self.dispatched if c == action_class)


@dataclass
class Hold:
    """One live reservation plus a conservative local deadline for its lease."""

    rid: str
    deadline: float

    def seconds_left(self):
        return self.deadline - time.monotonic()


def subject_for(tenant, policy, action_class, agent):
    # Policy -> app, action class -> workflow, agent -> agent. The action
    # class sits above the agent so that every agent draws on one sublimit.
    return {"tenant": tenant, "app": policy, "workflow": action_class, "agent": agent}


def reservation_body(subject, op, dry_run=False):
    action_class = subject["workflow"]
    body = {
        "idempotency_key": f"{op}-reserve",
        "subject": subject,
        "action": {"kind": "agent.action", "name": action_class},
        "estimate": amount(WEIGHTS[action_class]),
        "ttl_ms": TTL_MS,
        "overage_policy": "REJECT",
        "metadata": {"operation_id": op, "action_class": action_class},
    }
    if dry_run:
        body["dry_run"] = True
    return body


def preflight(client, subject, op):
    """Nonpersisting check. Returns 'DECISION:reason_code'."""
    response = client.create_reservation(reservation_body(subject, op + "-dry", dry_run=True))
    body = response.body or {}
    if response.status != 200:
        raise RuntimeError(f"Preflight unresolved for {op}: HTTP {response.status} {body.get('error')}")
    emit("preflight", op=op, action_class=subject["workflow"],
         decision=body.get("decision"), reason=body.get("reason_code"))
    return f"{body.get('decision')}:{body.get('reason_code')}"


def reserve(client, subject, op):
    sent_at = time.monotonic()  # Measure from send time: never overstate the lease
    response = client.create_reservation(reservation_body(subject, op))
    body = response.body or {}
    if response.status == 409 and body.get("error") == "BUDGET_EXCEEDED":
        raise Denied()
    if response.status != 200:
        # Any other 4xx means the policy ledgers are not set up as expected.
        # A transport error or 5xx means the reservation may exist. A
        # production adapter retries with the same key; this drill stops.
        raise RuntimeError(f"Admission unresolved for {op}: HTTP {response.status} {body.get('error')}. "
                           f"Reconcile with idempotency key {op}-reserve; a hold may remain "
                           "until its TTL and grace period pass")
    rid = body.get("reservation_id")
    if not rid:
        raise RuntimeError(f"Invalid admission for {op}: no reservation_id")
    if body.get("decision") != "ALLOW" or body.get("caps"):
        # ALLOW_WITH_CAPS or a malformed success: the hold exists, so return it.
        release(client, rid, op, "Not dispatched: fixture cannot enforce this decision")
        raise RuntimeError("Use a test tenant with no caps configured; this fixture cannot enforce them")
    # The server may grant less than the requested TTL; trust its remaining_ttl_ms.
    granted = body.get("remaining_ttl_ms")
    if isinstance(granted, bool) or not isinstance(granted, int) or granted < 0:
        release(client, rid, op, "Not dispatched: no usable lease observation")
        raise RuntimeError(f"Admission for {op} carried no valid remaining_ttl_ms")
    emit("reserved", op=op, action_class=subject["workflow"], reservation_id=rid)
    return Hold(rid, sent_at + min(TTL_MS, granted) / 1000)


def release(client, rid, op, reason):
    response = client.release_reservation(rid, {"idempotency_key": f"{op}-release", "reason": reason})
    if response.status != 200 or (response.body or {}).get("status") != "RELEASED":
        raise RuntimeError(f"Release unresolved for {op} ({rid}): HTTP {response.status}")
    emit("released", op=op)


def commit(client, rid, op, points):
    response = client.commit_reservation(rid, {"idempotency_key": f"{op}-commit", "actual": amount(points)})
    body = response.body or {}
    if (response.status != 200 or body.get("status") != "COMMITTED"
            or body.get("charged") != amount(points)):
        # The action ran, so never release. Reconcile with the same key.
        raise RuntimeError(f"Commit unresolved for {op} ({rid}): HTTP {response.status}")
    emit("committed", op=op, points=points)


def act(client, journal, subject, op, barrier=None):
    """The only path to an action: per-action check, reserve, dispatch, commit."""
    action_class = subject["workflow"]
    points = WEIGHTS[action_class]
    if points > PER_ACTION:
        # Refused in the harness. Cycles never sees this attempt.
        journal.refuse(op, action_class, "PER_ACTION")
        return "refused:local:PER_ACTION"
    journal.reserving(op, action_class)
    try:
        hold = reserve(client, subject, op)
    except Denied:
        journal.refuse(op, action_class, "BUDGET_EXCEEDED", status=409)
        if barrier:
            barrier.wait()
        return "denied"
    except Exception as error:
        # Name the operation before unblocking the other workers: their
        # BrokenBarrierError would otherwise be the only error reported.
        emit("unresolved", op=op, action_class=action_class, error=str(error))
        if barrier:
            barrier.abort()
        raise
    try:
        if barrier:
            barrier.wait()  # Hold admitted reservations until every agent is decided
        if hold.seconds_left() < DISPATCH_MARGIN_S:
            raise RuntimeError(f"Lease too short to dispatch {op}")
    except Exception:
        # Nothing was dispatched: return the hold rather than strand it.
        release(client, hold.rid, op, "Not dispatched: synchronization or lease failure")
        raise
    journal.dispatch(op, action_class)
    # The action ran. Commit the hold to record the charge.
    commit(client, hold.rid, op, points)
    journal.settle(op, action_class, points)
    return "sent"


def scope_rows(client, scope_subject):
    """Every balance row for exactly this scope, keyed by unit, across all pages."""
    path = "/".join(f"{k}:{v}" for k, v in scope_subject.items())
    params = {**scope_subject, "limit": "200"}
    rows = {}
    while True:
        response = client.get_balances(**params)
        if response.status != 200 or not response.body:
            raise RuntimeError(f"Balance read failed: HTTP {response.status}")
        for row in response.body["balances"]:
            if row["scope_path"] == path:
                rows[row["remaining"]["unit"]] = row
        if not response.body.get("has_more"):
            return rows
        params["cursor"] = response.body["next_cursor"]


def ledger(client, scope_subject):
    """(allocated, spent, reserved) for the RISK_POINTS ledger at this scope, or None."""
    row = scope_rows(client, scope_subject).get(RISK)
    if row is None:
        return None
    return row["allocated"]["amount"], row["spent"]["amount"], row["reserved"]["amount"]


def admin_url(path):
    return os.environ["CYCLES_ADMIN_URL"].rstrip("/") + path


def provision(scope, value):
    httpx.post(
        admin_url("/v1/admin/budgets"),
        headers={"X-Cycles-API-Key": os.environ["CYCLES_BUDGET_API_KEY"]},
        json={"scope": scope, "unit": RISK, "allocated": amount(value)},
        timeout=15,
    ).raise_for_status()


def fund(scope, operation, value, api_key, idempotency_key):
    return httpx.post(
        admin_url("/v1/admin/budgets/fund"),
        params={"scope": scope, "unit": RISK},
        headers={"X-Cycles-API-Key": api_key},
        json={"operation": operation, "amount": amount(value),
              "idempotency_key": idempotency_key, "reason": "bounded-exposure-drill"},
        timeout=15,
    )


def main():
    tenant = os.environ["CYCLES_TENANT"]
    runtime_key = os.environ["CYCLES_API_KEY"]
    config = CyclesConfig(base_url=os.environ["CYCLES_BASE_URL"], api_key=runtime_key, tenant=tenant)
    batch = uuid4().hex[:10]
    policy = f"policy-{batch}"
    base = f"tenant:{tenant}/app:{policy}"
    policy_scope = {"tenant": tenant, "app": policy}

    def class_scope(action_class):
        return {**policy_scope, "workflow": action_class}

    # A zero-point reservation passes a zero-allocation ledger, so an
    # exclusion only holds while every weight is positive.
    check(all(points > 0 for points in WEIGHTS.values()), "Every weight must be positive")

    with CyclesClient(config) as client:
        check(RISK not in scope_rows(client, {"tenant": tenant}),
              "Tenant scope has a RISK_POINTS ledger; use a tenant without one")

        # The operator, not the agent, writes the policy terms.
        provision(base, AGGREGATE)
        for action_class, limit in SUBLIMITS.items():
            provision(f"{base}/workflow:{action_class}", limit)
        for action_class in EXCLUDED:
            provision(f"{base}/workflow:{action_class}", 0)

        journal = Journal()

        def attempt(action_class, agent, tag):
            return act(client, journal, subject_for(tenant, policy, action_class, agent), f"{batch}-{tag}")

        # 1. The bound can be read from the ledgers before any action runs,
        #    and the runtime key cannot raise it.
        terms = {
            "aggregate": ledger(client, policy_scope)[0],
            "sublimits": {c: ledger(client, class_scope(c))[0] for c in SUBLIMITS},
            "excluded": [c for c in EXCLUDED if ledger(client, class_scope(c))[0] == 0],
            "per_action": PER_ACTION,
        }
        check(terms == {"aggregate": AGGREGATE, "sublimits": SUBLIMITS,
                        "excluded": list(EXCLUDED), "per_action": PER_ACTION},
              f"Ledgers do not match the policy terms: {terms}")
        raised = fund(base, "CREDIT", AGGREGATE, runtime_key, f"{batch}-raise")
        raised_error = (raised.json() or {}).get("error") if raised.status_code == 403 else None
        check(raised_error == "INSUFFICIENT_PERMISSIONS",
              f"Expected 403 INSUFFICIENT_PERMISSIONS, got HTTP {raised.status_code} {raised_error}")
        check(ledger(client, policy_scope) == (AGGREGATE, 0, 0), "Aggregate ledger changed")
        emit("PASS", scenario="stated_bound", **terms,
             runtime_key_raise_limit="403:INSUFFICIENT_PERMISSIONS")

        # 2. An action heavier than the per-action ceiling is refused in
        #    the harness. No reservation is requested.
        check(attempt("export", "agent-0", "x1") == "refused:local:PER_ACTION",
              "Per-action ceiling did not refuse")
        export_reservations = sum(1 for _, c in journal.reserve_calls if c == "export")
        check(export_reservations == 0, "A locally refused action requested a reservation")
        check(ledger(client, policy_scope) == (AGGREGATE, 0, 0), "A local refusal touched the ledger")
        emit("PASS", scenario="per_action", actions=journal.count("export"),
             reservations=export_reservations)

        # 3. An excluded class has a ledger with nothing in it.
        excluded_subject = subject_for(tenant, policy, "delete", "agent-0")
        dry = preflight(client, excluded_subject, f"{batch}-d1")
        check(dry == "DENY:BUDGET_EXCEEDED", f"Unexpected preflight for excluded class: {dry}")
        check(attempt("delete", "agent-0", "d1") == "denied", "Excluded class was not denied")
        emit("PASS", scenario="exclusion", actions=journal.count("delete"), preflight=dry, live="denied")

        # 4. The sublimit stops the third refund while the aggregate has room.
        results = [attempt("refund", "agent-0", f"r{i}") for i in range(3)]
        check(results == ["sent", "sent", "denied"], f"Unexpected sublimit result: {results}")
        check(ledger(client, class_scope("refund")) == (60, 60, 0), "Sublimit ledger mismatch")
        check(ledger(client, policy_scope) == (AGGREGATE, 60, 0), "Aggregate ledger mismatch")
        emit("PASS", scenario="sublimit", actions=2, denied=1, sublimit_spent=60, aggregate_spent=60)

        # 5. Twenty agents each try one email. Admitted reservations stay
        #    open until all twenty are decided, so the holds overlap. The
        #    class has no ledger of its own, so only the aggregate decides.
        barrier = threading.Barrier(FLEET_SIZE, timeout=15)

        def fleet_attempt(index):
            with CyclesClient(config) as worker:
                subject = subject_for(tenant, policy, "email", f"agent-{index}")
                return act(worker, journal, subject, f"{batch}-e{index}", barrier)

        with ThreadPoolExecutor(max_workers=FLEET_SIZE) as pool:
            futures = [pool.submit(fleet_attempt, index) for index in range(FLEET_SIZE)]
        failures = [f.exception() for f in futures if f.exception() is not None]
        if failures:
            # Report the worker that failed, not one it unblocked.
            causes = [e for e in failures if not isinstance(e, threading.BrokenBarrierError)]
            raise (causes or failures)[0]
        results = sorted(f.result() for f in futures)
        room = (AGGREGATE - 60) // WEIGHTS["email"]
        check(results == ["denied"] * (FLEET_SIZE - room) + ["sent"] * room,
              f"Unexpected fleet result: {results}")
        check(ledger(client, policy_scope) == (AGGREGATE, AGGREGATE, 0), "Aggregate ledger mismatch")
        emit("PASS", scenario="aggregate", agents=FLEET_SIZE, actions=room,
             denied=FLEET_SIZE - room, aggregate_spent=AGGREGATE)

        # 6. The period's record: harness records reconciled with the ledgers.
        by_class = Counter()
        for action_class, points in journal.committed.values():
            by_class[action_class] += points
        allocated, spent, reserved = ledger(client, policy_scope)
        check(sorted(journal.dispatched) == sorted((op, c) for op, (c, _) in journal.committed.items()),
              "Dispatched actions and committed reservations do not match")
        check(sum(by_class.values()) == spent and spent + reserved <= allocated,
              "Harness records disagree with the aggregate ledger")
        check(by_class["refund"] == ledger(client, class_scope("refund"))[1],
              "Harness records disagree with the sublimit ledger")
        refusals = Counter(reason for _, _, reason in journal.refusals)
        # One excluded delete, one refund over the sublimit, and the fleet's denials.
        check(refusals == {"BUDGET_EXCEEDED": 2 + FLEET_SIZE - room, "PER_ACTION": 1},
              f"Unexpected refusal totals: {dict(refusals)}")
        emit("PASS", scenario="period_record", actions=len(journal.dispatched),
             committed_by_class=dict(sorted(by_class.items())), aggregate_spent=spent,
             aggregate_limit=allocated, refusals=dict(sorted(refusals.items())))

        # 7. A new period restates the limits and clears spend. The exclusion
        #    has nothing to restate. All work has finished, so no commit can
        #    land between the two resets. The reset response carries the
        #    closing total; after it, the ledger no longer does.
        budget_key = os.environ["CYCLES_BUDGET_API_KEY"]
        renewed = fund(base, "RESET_SPENT", AGGREGATE, budget_key, f"{batch}-renew")
        renewed.raise_for_status()
        closing_spent = renewed.json()["previous_spent"]["amount"]
        check(closing_spent == AGGREGATE, f"Unexpected closing total: {closing_spent}")
        for action_class, limit in SUBLIMITS.items():
            fund(f"{base}/workflow:{action_class}", "RESET_SPENT", limit, budget_key,
                 f"{batch}-renew-{action_class}").raise_for_status()
        check(ledger(client, policy_scope) == (AGGREGATE, 0, 0), "Aggregate ledger was not renewed")
        for action_class, limit in SUBLIMITS.items():
            check(ledger(client, class_scope(action_class)) == (limit, 0, 0),
                  f"Sublimit ledger for {action_class} was not renewed")
        for action_class in EXCLUDED:
            check(ledger(client, class_scope(action_class)) == (0, 0, 0),
                  f"Exclusion ledger for {action_class} changed")
        check(attempt("email", "agent-0", "n1") == "sent", "Renewed aggregate refused an action")
        check(attempt("delete", "agent-0", "n2") == "denied", "Exclusion did not survive renewal")
        check(ledger(client, policy_scope) == (AGGREGATE, WEIGHTS["email"], 0),
              "Aggregate ledger mismatch after renewal")
        emit("PASS", scenario="renewal", closing_spent=closing_spent, after="sent",
             excluded_after="denied", aggregate_spent=WEIGHTS["email"])


if __name__ == "__main__":
    main()
