"""Real Cycles reservations, synthetic RAG steps. No LLM or search provider calls.

Requires Python 3.10+, runcycles==0.5.3, and a disposable Cycles test tenant.
See /blog/agentic-rag-cost-control for setup and the limits of this drill.
Creates three workflow ledgers per invocation; it does not delete or reset them.
"""

from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass
import os
from threading import Barrier
from uuid import uuid4

import httpx
from runcycles import (
    Action, Amount, CyclesClient, CyclesConfig, CyclesProtocolError, Subject, Unit,
)


CENT = 1_000_000  # One dollar is 100,000,000 USD_MICROCENTS.


@dataclass(frozen=True)
class Step:
    name: str
    estimate: int
    actual: int


# Fixture values, not provider prices or estimates of typical RAG costs.
PLAN = Step("plan", 2 * CENT, CENT)
SEARCH = Step("search", 3 * CENT, 2 * CENT)
RERANK = Step("rerank", 2 * CENT, CENT)
ANSWER = Step("answer", 4 * CENT, 3 * CENT)


def provision(workflow: str, allocation: int, tenant: str) -> None:
    """Setup-only operation; keep the budget writer out of the agent process."""
    response = httpx.post(
        os.environ["CYCLES_ADMIN_URL"].rstrip("/") + "/v1/admin/budgets",
        headers={"X-Cycles-API-Key": os.environ["CYCLES_BUDGET_API_KEY"]},
        json={
            "scope": f"tenant:{tenant}/workflow:{workflow}",
            "unit": "USD_MICROCENTS",
            "allocated": {"unit": "USD_MICROCENTS", "amount": allocation},
        },
        timeout=15,
    )
    response.raise_for_status()


def run_step(client, subject, step, operation_id, barrier=None):
    """Return whether the fixture handler ran and its committed fixture cost."""
    entered = False
    try:
        with client.stream_reservation(
            subject=subject,
            action=Action(kind="tool.call", name=f"rag-drill.{step.name}"),
            estimate=Amount(unit=Unit.USD_MICROCENTS, amount=step.estimate),
            idempotency_key=operation_id,
            overage_policy="REJECT",
            raise_on_commit_failure=True,
        ) as reservation:
            entered = True
            # This drill has no cap adapter. Stop rather than ignore constraints.
            if reservation.caps and reservation.caps.model_dump(exclude_none=True):
                raise RuntimeError("Use a test tenant without caps for this drill")
            if barrier is not None:
                barrier.wait(timeout=30)  # Keep holds live until all attempts finish.
            # The synthetic provider handler begins ONLY after admission.
            print(f"EXECUTED {step.name}")
            reservation.usage.actual_cost = step.actual
        return True, step.actual
    except CyclesProtocolError as exc:
        # A failed settlement must not be mislabeled as a pre-execution denial.
        if entered or not exc.is_budget_exceeded():
            raise
        if barrier is not None:
            barrier.wait(timeout=30)
        print(f"BLOCKED {step.name} before handler")
        return False, 0


def verify_balance(client, subject, allocation, expected_spent):
    response = client.get_balances(tenant=subject.tenant, workflow=subject.workflow)
    if not response.is_success:
        raise RuntimeError(f"Balance read failed: HTTP {response.status}")
    scope = f"tenant:{subject.tenant}/workflow:{subject.workflow}"
    balance = next(b for b in response.body["balances"] if b["scope_path"] == scope)
    observed = tuple(balance[k]["amount"] for k in ("spent", "reserved", "remaining"))
    expected = (expected_spent, 0, allocation - expected_spent)
    if observed != expected:
        raise RuntimeError(f"Ledger mismatch: {observed} != {expected}")


def main():
    tenant = os.environ["CYCLES_TENANT"]
    config = CyclesConfig(
        base_url=os.environ["CYCLES_BASE_URL"],
        api_key=os.environ["CYCLES_API_KEY"],
        tenant=tenant,
    )
    batch = uuid4().hex
    with CyclesClient(config) as client:
        for name, steps, expected in (
            ("normal", [PLAN, SEARCH, RERANK, ANSWER], (4, 0, 7 * CENT)),
            ("loop", [PLAN, SEARCH, RERANK] * 4, (8, 1, 11 * CENT)),
        ):
            workflow = f"rag-{batch}-{name}"
            provision(workflow, 12 * CENT, tenant)
            subject = Subject(tenant=tenant, workflow=workflow)
            executed = blocked = spent = 0
            for index, step in enumerate(steps):
                ran, cost = run_step(client, subject, step, f"{workflow}-{index}")
                if not ran:
                    blocked += 1
                    break  # Never ask the model to keep trying after exhaustion.
                executed += 1
                spent += cost
            if (executed, blocked, spent) != expected:
                raise RuntimeError(f"Unexpected {name} outcome; check ancestor budgets")
            verify_balance(client, subject, 12 * CENT, spent)
            print(f"PASS {name}: executed={executed} blocked={blocked} spent={spent}")

        workflow = f"rag-{batch}-parallel"
        provision(workflow, 10 * CENT, tenant)
        subject = Subject(tenant=tenant, workflow=workflow)
        barrier = Barrier(4)
        step = Step("parallel-search", 4 * CENT, 3 * CENT)
        with ThreadPoolExecutor(max_workers=4) as pool:
            futures = [
                pool.submit(run_step, client, subject, step, f"{workflow}-{i}", barrier)
                for i in range(4)
            ]
            results = [future.result() for future in futures]
        executed = sum(ran for ran, _ in results)
        spent = sum(cost for _, cost in results)
        if (executed, spent) != (2, 6 * CENT):
            raise RuntimeError("Unexpected parallel outcome; check ancestor budgets")
        verify_balance(client, subject, 10 * CENT, spent)
        print(f"PASS parallel: executed={executed} blocked={4-executed} spent={spent}")


if __name__ == "__main__":
    main()
