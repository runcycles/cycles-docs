"""Real Cycles reservations, simulated prompt cache. No LLM provider calls.

Requires Python 3.10+, runcycles==0.5.3, and a disposable Cycles test tenant.
See /blog/prompt-caching-ai-agent-budgets for setup and the limits of this drill.
Creates four workflow ledgers per invocation; it does not delete or reset them.
"""

from dataclasses import dataclass, field
import hashlib
import os
from uuid import uuid4

import httpx
from runcycles import (
    Action, Amount, CyclesClient, CyclesConfig, CyclesProtocolError, Subject, Unit,
)


# Fixture rates in USD_MICROCENTS per token ($1 = 100,000,000). They follow the
# shape of a 5-minute cache tier: writes 1.25x input, reads 0.1x input.
# They are not a price quote; replace them with your provider's current rates.
INPUT, CACHE_WRITE, CACHE_READ, OUTPUT = 300, 375, 30, 1_500

PREFIX_TOKENS = 20_000  # System prompt and tool definitions, marked cacheable.
TAIL_TOKENS = 1_000     # New turn content after the cache breakpoint.
MAX_OUTPUT = 500        # Enforced output ceiling; the fixture always uses all of it.
CACHE_TTL_S = 300       # Five-minute entry, refreshed on each read.
ALLOCATION = 30_000_000  # $0.30 per workflow.

WRITE_PRICED = PREFIX_TOKENS * CACHE_WRITE + TAIL_TOKENS * INPUT + MAX_OUTPUT * OUTPUT
UNCACHED = (PREFIX_TOKENS + TAIL_TOKENS) * INPUT + MAX_OUTPUT * OUTPUT
UNCACHED_PLUS_20 = UNCACHED * 12 // 10


@dataclass
class SimulatedCache:
    """Exact-prefix cache with a sliding TTL, like a single cache breakpoint."""
    entries: dict[str, float] = field(default_factory=dict)

    def usage(self, prefix: str, now: float) -> dict[str, int]:
        key = hashlib.sha256(prefix.encode()).hexdigest()
        hit = self.entries.get(key, -1.0) > now
        self.entries[key] = now + CACHE_TTL_S  # Written on a miss, refreshed on a hit.
        return {
            "cache_read": PREFIX_TOKENS if hit else 0,
            "cache_write": 0 if hit else PREFIX_TOKENS,
            "input": TAIL_TOKENS,
            "output": MAX_OUTPUT,
        }


def price(usage: dict[str, int]) -> int:
    return (usage["cache_read"] * CACHE_READ + usage["cache_write"] * CACHE_WRITE
            + usage["input"] * INPUT + usage["output"] * OUTPUT)


def provision(workflow: str, tenant: str) -> None:
    """Setup-only operation; keep the budget writer out of the agent process."""
    response = httpx.post(
        os.environ["CYCLES_ADMIN_URL"].rstrip("/") + "/v1/admin/budgets",
        headers={"X-Cycles-API-Key": os.environ["CYCLES_BUDGET_API_KEY"]},
        json={
            "scope": f"tenant:{tenant}/workflow:{workflow}",
            "unit": "USD_MICROCENTS",
            "allocated": {"unit": "USD_MICROCENTS", "amount": ALLOCATION},
        },
        timeout=15,
    )
    response.raise_for_status()


def run_turn(client, subject, estimate, operation_id, cache, prefix, now):
    """Return 'settled', 'blocked', or 'unsettled', plus the provider-side cost."""
    entered = False
    cost = 0
    usage = None
    try:
        with client.stream_reservation(
            subject=subject,
            action=Action(kind="llm.completion", name="cache-drill.turn"),
            estimate=Amount(unit=Unit.USD_MICROCENTS, amount=estimate),
            idempotency_key=operation_id,
            overage_policy="REJECT",
            raise_on_commit_failure=True,
        ) as reservation:
            entered = True
            # This drill has no cap adapter. Stop rather than ignore constraints.
            if reservation.caps and reservation.caps.model_dump(exclude_none=True):
                raise RuntimeError("Use a test tenant without caps for this drill")
            # The simulated provider call begins ONLY after admission.
            usage = cache.usage(prefix, now)
            cost = price(usage)
            kind = "write" if usage["cache_write"] else "read"
            print(f"EXECUTED {operation_id} cache={kind} cost={cost}")
            reservation.usage.actual_cost = cost
        return "settled", cost, usage
    except CyclesProtocolError as exc:
        if entered and exc.is_budget_exceeded():
            # REJECT refused the commit AFTER the provider call ran.
            print(f"UNSETTLED {operation_id}: actual {cost} exceeded estimate {estimate}")
            return "unsettled", cost, usage
        if entered or not exc.is_budget_exceeded():
            raise
        print(f"BLOCKED {operation_id} before provider call")
        return "blocked", 0, None


def verify_balance(client, subject, spent, reserved):
    response = client.get_balances(tenant=subject.tenant, workflow=subject.workflow)
    if not response.is_success:
        raise RuntimeError(f"Balance read failed: HTTP {response.status}")
    scope = f"tenant:{subject.tenant}/workflow:{subject.workflow}"
    balance = next(b for b in response.body["balances"] if b["scope_path"] == scope)
    observed = tuple(balance[k]["amount"] for k in ("spent", "reserved", "remaining"))
    expected = (spent, reserved, ALLOCATION - spent - reserved)
    if observed != expected:
        raise RuntimeError(f"Ledger mismatch: {observed} != {expected}")


# name, estimate per turn, turn start times (seconds), timestamp in prefix?
SCENARIOS = (
    ("under-reserved", UNCACHED_PLUS_20, [0, 30, 60, 90, 120], False),
    ("stable", WRITE_PRICED, [0, 30, 60, 90, 120], False),
    ("timestamp", WRITE_PRICED, [0, 30, 60, 90, 120], True),
    ("idle-gap", WRITE_PRICED, [0, 30, 450, 480, 510], False),
)

EXPECTED = {  # (settled, blocked, unsettled, ledger spent, provider cost, read share %)
    "under-reserved": (0, 0, 1, 0, 8_550_000, 0),
    "stable": (5, 0, 0, 15_150_000, 15_150_000, 80),
    "timestamp": (3, 1, 0, 25_650_000, 25_650_000, 0),
    "idle-gap": (5, 0, 0, 22_050_000, 22_050_000, 60),
}


def main():
    tenant = os.environ["CYCLES_TENANT"]
    config = CyclesConfig(
        base_url=os.environ["CYCLES_BASE_URL"],
        api_key=os.environ["CYCLES_API_KEY"],
        tenant=tenant,
    )
    batch = uuid4().hex[:12]
    print(f"estimates: uncached+20%={UNCACHED_PLUS_20} write-priced={WRITE_PRICED}")
    with CyclesClient(config) as client:
        for name, estimate, times, timestamped in SCENARIOS:
            workflow = f"cache-{batch}-{name}"
            provision(workflow, tenant)
            subject = Subject(tenant=tenant, workflow=workflow)
            cache = SimulatedCache()
            counts = {"settled": 0, "blocked": 0, "unsettled": 0}
            spent = provider_cost = read_tokens = prefix_tokens = 0
            held = 0
            for turn, now in enumerate(times):
                prefix = "SYSTEM PROMPT AND TOOLS v1"
                if timestamped:
                    prefix = f"Current time: t+{now}s\n" + prefix  # Silent invalidator.
                outcome, cost, usage = run_turn(
                    client, subject, estimate, f"{workflow}-{turn}", cache, prefix, now,
                )
                counts[outcome] += 1
                if outcome == "blocked":
                    break  # Do not keep retrying unaffordable work.
                provider_cost += cost
                read_tokens += usage["cache_read"]
                prefix_tokens += PREFIX_TOKENS
                if outcome == "settled":
                    spent += cost
                else:
                    held = estimate  # REJECT leaves the hold until its TTL expires.
                    break  # The ledger no longer matches the provider; stop.
            read_share = round(100 * read_tokens / prefix_tokens) if prefix_tokens else 0
            observed = (counts["settled"], counts["blocked"], counts["unsettled"],
                        spent, provider_cost, read_share)
            if observed != EXPECTED[name]:
                raise RuntimeError(f"Unexpected {name} outcome {observed}; check ancestor budgets")
            verify_balance(client, subject, spent, held)
            print(f"PASS {name}: settled={counts['settled']} blocked={counts['blocked']} "
                  f"unsettled={counts['unsettled']} ledger_spent={spent} "
                  f"provider_cost={provider_cost} cache_read_share={read_share}%")


if __name__ == "__main__":
    main()
