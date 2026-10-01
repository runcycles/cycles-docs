"""Real Cycles reservations, simulated provider failover. No LLM API calls.

Python 3.10+, runcycles==0.5.3. Run only against a disposable test tenant.
Creates three $0.10 workflow ledgers and spends $0.16 per successful invocation.
Low-level, single-process drill: no durable journal, transport retry, or heartbeat.
On an unexpected error, stop and inspect the printed attempt IDs before cleanup.
"""

from dataclasses import dataclass, field
import json
import os
from uuid import uuid4

import httpx
from runcycles import CyclesClient, CyclesConfig


UNIT = "USD_MICROCENTS"
CENT = 1_000_000
ALLOCATION = 10 * CENT
TTL_MS = 60_000


def amount(value):
    return {"unit": UNIT, "amount": value}


def emit(event, **fields):
    print(json.dumps({"event": event, **fields}), flush=True)


class BudgetStop(Exception):
    """Terminal for this chain; never classified as a provider failure."""


class ProviderFailure(Exception):
    """Fixture failure with either known usage or an unknown outcome."""

    def __init__(self, actual):
        super().__init__("simulated provider failure")
        self.actual = actual  # None means unknown, zero means proven unused.


@dataclass
class Provider:
    name: str
    estimate: int
    actual: int
    outcome: str = "success"
    calls: list = field(default_factory=list)

    def call(self, attempt_id):
        self.calls.append(attempt_id)
        emit("provider_called", attempt_id=attempt_id, provider=self.name)
        if self.outcome == "unknown":
            raise ProviderFailure(None)
        if self.outcome == "failed":
            raise ProviderFailure(self.actual)
        return self.actual

    def receipt(self, attempt_id):
        # The test fixture knows this amount. A real application must obtain
        # authoritative usage evidence; it cannot infer it from a timeout.
        if attempt_id not in self.calls:
            raise RuntimeError("No fixture execution for this receipt")
        return self.actual


def release(client, reservation_id, attempt_id):
    response = client.release_reservation(reservation_id, {
        "idempotency_key": attempt_id + "-release",
        "reason": "Confirmed no usage or stopped before dispatch",
    })
    if response.status != 200 or response.body.get("status") != "RELEASED":
        raise RuntimeError(f"Release unresolved for {attempt_id}: HTTP {response.status}")
    emit("released", attempt_id=attempt_id)


def commit(client, reservation_id, attempt_id, actual):
    # Replaying THIS request uses the same key and amount. It does not call
    # the provider again. Low-level clients do not journal this automatically.
    response = client.commit_reservation(reservation_id, {
        "idempotency_key": attempt_id + "-commit",
        "actual": amount(actual),
    })
    if (response.status != 200 or response.body.get("status") != "COMMITTED"
            or response.body.get("charged") != amount(actual)):
        raise RuntimeError(f"Commit unresolved for {attempt_id}: HTTP {response.status}")
    emit("committed", attempt_id=attempt_id, actual=actual)


def dispatch(client, subject, provider, attempt_id):
    """Gate ONE provider attempt, returning its result or unresolved identity."""
    emit("reserve_requested", attempt_id=attempt_id, provider=provider.name,
         estimate=provider.estimate, workflow=subject["workflow"])
    response = client.create_reservation({
        "idempotency_key": attempt_id + "-reserve",
        "subject": subject,
        "action": {"kind": "llm.completion", "name": provider.name},
        "estimate": amount(provider.estimate),
        "ttl_ms": TTL_MS,
        "overage_policy": "REJECT",
    })
    if response.status == 409 and response.body.get("error") == "BUDGET_EXCEEDED":
        emit("blocked", attempt_id=attempt_id, provider=provider.name)
        raise BudgetStop(attempt_id)
    if response.status != 200:
        raise RuntimeError(f"Admission unresolved for {attempt_id}: HTTP {response.status}")
    rid = response.body.get("reservation_id")
    decision = response.body.get("decision")
    if not rid or decision not in ("ALLOW", "ALLOW_WITH_CAPS"):
        raise RuntimeError(f"Invalid admission for {attempt_id}")
    # No cap adapter in this fixture. Never ignore a configured constraint.
    if decision == "ALLOW_WITH_CAPS" or response.body.get("caps"):
        release(client, rid, attempt_id)
        raise RuntimeError("Use a test tenant without caps")
    if response.body.get("remaining_ttl_ms", TTL_MS) <= 0:
        raise RuntimeError(f"No live lease for {attempt_id}")

    try:
        actual = provider.call(attempt_id)
    except ProviderFailure as exc:
        if exc.actual is None:
            emit("usage_unknown", attempt_id=attempt_id, reservation_id=rid)
            return "unknown", (rid, attempt_id, provider)
        if exc.actual == 0:
            release(client, rid, attempt_id)
        else:
            commit(client, rid, attempt_id, exc.actual)
        return "failed", None
    commit(client, rid, attempt_id, actual)
    return "success", None


def run_chain(client, subject, providers):
    pending = []
    for index, provider in enumerate(providers):
        attempt_id = f"{subject['workflow']}-a{index}"
        try:
            outcome, unresolved = dispatch(client, subject, provider, attempt_id)
        except BudgetStop:
            return "blocked", pending
        if unresolved:
            pending.append(unresolved)
        if outcome == "success":
            return "success", pending
    return "exhausted", pending


def verify_balance(client, subject, spent, held):
    response = client.get_balances(**subject)
    if response.status != 200:
        raise RuntimeError(f"Balance read failed: HTTP {response.status}")
    scope = f"tenant:{subject['tenant']}/workflow:{subject['workflow']}"
    balance = next(b for b in response.body["balances"] if b["scope_path"] == scope)
    observed = tuple(balance[k]["amount"] for k in ("spent", "reserved", "remaining"))
    expected = (spent, held, ALLOCATION - spent - held)
    if observed != expected:
        raise RuntimeError(f"Ledger mismatch at {scope}: {observed} != {expected}")
    emit("balance_verified", workflow=subject["workflow"], spent=spent, reserved=held,
         remaining=expected[2])


def provision(tenant, workflow):
    response = httpx.post(
        os.environ["CYCLES_ADMIN_URL"].rstrip("/") + "/v1/admin/budgets",
        headers={"X-Cycles-API-Key": os.environ["CYCLES_BUDGET_API_KEY"]},
        json={"scope": f"tenant:{tenant}/workflow:{workflow}",
              "unit": UNIT, "allocated": amount(ALLOCATION)},
        timeout=15,
    )
    response.raise_for_status()


def scenarios():
    # name, providers, expected result, calls per provider, spent before late receipt, held
    return [
        ("unused", [Provider("primary", 4*CENT, 0, "failed"),
                    Provider("backup", 8*CENT, 6*CENT)], "success", [1, 1], 6*CENT, 0),
        ("blocked", [Provider("primary", 4*CENT, 3*CENT, "failed"),
                     Provider("backup", 8*CENT, 6*CENT),
                     Provider("third", CENT, CENT)], "blocked", [1, 0, 0], 3*CENT, 0),
        ("unknown", [Provider("primary", 4*CENT, 3*CENT, "unknown"),
                     Provider("backup", 5*CENT, 4*CENT)], "success", [1, 1], 4*CENT, 4*CENT),
    ]


def main():
    tenant = os.environ["CYCLES_TENANT"]
    config = CyclesConfig(base_url=os.environ["CYCLES_BASE_URL"],
                          api_key=os.environ["CYCLES_API_KEY"], tenant=tenant)
    batch = uuid4().hex[:12]
    with CyclesClient(config) as client:
        for name, providers, expected, calls, spent, held in scenarios():
            workflow = f"failover-{batch}-{name}"
            provision(tenant, workflow)
            subject = {"tenant": tenant, "workflow": workflow}
            outcome, pending = run_chain(client, subject, providers)
            if outcome != expected or [len(p.calls) for p in providers] != calls:
                raise RuntimeError(f"Unexpected {name} outcome; inspect ancestor budgets")
            verify_balance(client, subject, spent, held)
            for rid, attempt_id, provider in pending:
                actual = provider.receipt(attempt_id)
                emit("late_receipt", attempt_id=attempt_id, actual=actual)
                commit(client, rid, attempt_id, actual)
                spent += actual
                # Replay only settlement; never repeat the provider dispatch.
                commit(client, rid, attempt_id, actual)
            verify_balance(client, subject, spent, 0)
            if [len(p.calls) for p in providers] != calls:
                raise RuntimeError("Settlement replay dispatched a provider")
            emit("PASS", scenario=name, provider_calls=calls, spent=spent)


if __name__ == "__main__":
    main()
