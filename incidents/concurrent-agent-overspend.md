---
title: "Concurrent Agent Overspend"
description: "How concurrent agents sharing a budget can collectively exceed limits due to race conditions, and how Cycles prevents it."
---

# Concurrent Agent Overspend

A failure mode where multiple agents sharing a budget each pass local checks but collectively exceed the limit.

## The incident

A platform runs 5 agents concurrently, all spending against the same team budget of $10. Each agent checks the remaining balance before making a call and sees $8 remaining. All 5 proceed simultaneously, each spending $3. Total spend: $15 — exceeding the $10 budget by 50%.

### The race condition

```
Time 0: Budget = $10.00
Agent A checks balance → $10.00 remaining → proceeds
Agent B checks balance → $10.00 remaining → proceeds
Agent C checks balance → $10.00 remaining → proceeds
Agent D checks balance → $10.00 remaining → proceeds
Agent E checks balance → $10.00 remaining → proceeds

All 5 agents call LLM simultaneously, each spending ~$3.00

Time 1: Budget = $10.00 - $15.00 = -$5.00 (overspent)
```

### Why read-then-act doesn't work

The check-then-spend pattern is a classic [TOCTOU](https://en.wikipedia.org/wiki/Time-of-check_to_time-of-use) race. The balance read is stale by the time the spend occurs. This is true even with database transactions — unless the balance check and the deduction are atomic.

### Without Cycles

Application-level balance checks are not concurrency-safe. Even "careful" implementations using database locks often miss edge cases under high concurrency.

### With Cycles

Cycles reservation is **atomically concurrency-safe**. Each reservation locks the requested amount across all affected scopes in a single Redis Lua script. No partial locks, no race conditions:

```
Time 0: Budget = $10.00
Agent A reserves $3.00 → ALLOW ($7.00 remaining, $3.00 reserved)
Agent B reserves $3.00 → ALLOW ($4.00 remaining, $6.00 reserved)
Agent C reserves $3.00 → ALLOW ($1.00 remaining, $9.00 reserved)
Agent D reserves $3.00 → DENIED — HTTP 409 BUDGET_EXCEEDED (only $1.00 remaining)
Agent E reserves $3.00 → DENIED — HTTP 409 BUDGET_EXCEEDED (only $1.00 remaining)
```

Agents D and E are denied *before any LLM call is made*. The budget is never exceeded. On the wire, a live denial is an HTTP `409` error response with `error: BUDGET_EXCEEDED` — the `DENY` decision value appears only on dry-run and `decide` responses, which return `200` with the decision in the body.

### Python example

```python
import os

from runcycles import (
    BudgetExceededError,
    CyclesClient,
    CyclesConfig,
    cycles,
    set_default_client,
)

set_default_client(CyclesClient(CyclesConfig(
    base_url=os.environ["CYCLES_BASE_URL"],
    api_key=os.environ["CYCLES_API_KEY"],
    tenant="acme-corp",
    workspace="prod",
)))

@cycles(
    estimate=3_000_000,
    action_kind="llm.completion",
    action_name="gpt-4o",
    # Subject callables receive the decorated function's *args/**kwargs
    agent=lambda *args, **kwargs: kwargs.get("agent_id"),
)
def call_llm_safe(prompt: str, agent_id: str) -> str:
    return call_llm(prompt)

def agent_task(agent_id: str, task: str):
    try:
        return call_llm_safe(task, agent_id=agent_id)
    except BudgetExceededError:
        return fallback_response(task)
```

### TypeScript example

```typescript
import {
  BudgetExceededError,
  CyclesClient,
  CyclesConfig,
  setDefaultClient,
  withCycles,
} from "runcycles";

setDefaultClient(new CyclesClient(new CyclesConfig({
  baseUrl: process.env.CYCLES_BASE_URL!,
  apiKey: process.env.CYCLES_API_KEY!,
  tenant: "acme-corp",
  workspace: "prod",
})));

const callLlmSafe = withCycles(
  {
    estimate: 3_000_000,
    actionKind: "llm.completion",
    actionName: "gpt-4o",
    tenant: "acme-corp",
    workspace: "prod",
  },
  async (prompt: string): Promise<string> => {
    return await callLlm(prompt);
  }
);

async function agentTask(agentId: string, task: string): Promise<string> {
  try {
    return await callLlmSafe(task);
  } catch (err) {
    if (err instanceof BudgetExceededError) {
      return fallbackResponse(task);
    }
    throw err;
  }
}

// Run 5 agents concurrently — Cycles guarantees budget safety
const results = await Promise.all(
  agents.map((agent) => agentTask(agent.id, agent.task))
);
```

## Severity and impact

Concurrent overspend is proportional to the number of parallel agents and the cost per operation. The worst case is `N agents * cost per call` overshoot.

**Concrete examples:**

| Agents | Budget | Cost per call | Overspend (no Cycles) | With Cycles |
|--------|--------|---------------|----------------------|-------------|
| 5      | $10    | $3.00         | $5.00 (50%)          | $0.00       |
| 10     | $50    | $8.00         | $30.00 (60%)         | $0.00       |
| 50     | $100   | $5.00         | $150.00 (150%)       | $0.00       |
| 100    | $500   | $10.00        | $500.00 (100%)       | $0.00       |

The overspend percentage increases with concurrency. At 100 agents each spending $10, the theoretical maximum overshoot is $500 — a full doubling of the budget.

**Compounding effect with retries.** If each agent also retries failed calls (see [Retry Storms](/incidents/retry-storms-and-idempotency-failures)), the multiplication compounds. 10 agents with 5 retries each can produce 50 concurrent calls against the same budget.

**Invoice shock.** Unlike a gradual budget drain, concurrent overspend happens in a burst. The budget goes from healthy to overdrawn in seconds, giving operators no time to intervene manually.

## Detection

### Querying for concurrent reservation patterns

Check how many reservations are active simultaneously for the same scope:

```bash
# Count active reservations per scope
curl -s "http://localhost:7878/v1/reservations?tenant=acme-corp&status=ACTIVE" \
  -H "X-Cycles-API-Key: $API_KEY" \
  | jq '.reservations | group_by(.scope_path) | map({scope_path: .[0].scope_path, count: length})'
```

If a single scope has many active reservations simultaneously, you have high concurrency against that budget.

### Spotting TOCTOU patterns in application code

Search your codebase for the check-then-spend anti-pattern:

```python
# ANTI-PATTERN: checking balance then spending is NOT safe
balance = get_balance(scope="tenant:acme-corp")
if balance.remaining > estimated_cost:
    # Another agent can spend between this check and the call
    result = call_llm(prompt)  # UNSAFE
```

The fix is to always use `reserve` instead of `balance` for authorization decisions.

### Checking for budget overruns

Compare spent against allocated to find scopes that exceeded their budget:

```bash
# Find scopes where spent exceeds allocated (overrun already happened)
curl -s "http://localhost:7878/v1/balances?tenant=acme-corp" \
  -H "X-Cycles-API-Key: $API_KEY" \
  | jq '.balances[] | select(.spent.amount > .allocated.amount) | {scope, allocated, spent, overshoot: (.spent.amount - .allocated.amount)}'
```

## Monitoring

### Alerting rules

::: warning Planned metrics — not yet registered
`cycles_scope_spent_total`, `cycles_scope_allocated_total`, `cycles_scope_remaining_total`, and `cycles_active_reservations_count` are on the roadmap but are not emitted by the current server builds (runtime 0.1.25.46 registers request-driven `cycles.*` counters — reservations, events, overdraft — but no balance or active-reservation gauges). Build these alerts from a balance-polling sidecar that pushes `GET /v1/balances` fields as gauges — see [Query balances for monitoring](/how-to/monitoring-and-alerting#query-balances-for-monitoring). Once the sidecar pushes `cycles_budget_spent` / `cycles_budget_allocated` / `cycles_budget_remaining` / `cycles_active_reservations`, the rules below apply as-is against your own gauge names.
:::

```yaml
# Alert when spent exceeds allocated for any scope
# Requires gauges pushed by a balance-polling sidecar (see note above)
- alert: CyclesBudgetOvershoot
  expr: |
    cycles_budget_spent > cycles_budget_allocated
  for: 0m
  labels:
    severity: critical
  annotations:
    summary: "Budget overshoot on {{ $labels.scope }}: spent {{ $value }}"

# Alert on high concurrent reservation count (pre-incident warning)
- alert: CyclesHighConcurrentReservations
  expr: |
    cycles_active_reservations > 20
  for: 1m
  labels:
    severity: warning
  annotations:
    summary: "{{ $value }} concurrent reservations on {{ $labels.scope }}"

# Alert when remaining budget drops below 10% with active reservations
- alert: CyclesBudgetNearExhaustion
  expr: |
    cycles_budget_remaining / cycles_budget_allocated < 0.1
    and cycles_active_reservations > 0
  for: 0m
  labels:
    severity: critical
  annotations:
    summary: "Budget nearly exhausted on {{ $labels.scope }} with active reservations"
```

For detailed monitoring setup, see [Monitoring and Alerting](/how-to/monitoring-and-alerting).

## Testing for concurrency issues

Concurrency bugs are hard to reproduce in unit tests. Use these strategies to verify your budget enforcement holds under concurrent load.

### Load test with parallel reservations

```python
import asyncio
import uuid

from runcycles import (
    Action,
    Amount,
    AsyncCyclesClient,
    CommitRequest,
    CyclesConfig,
    ReservationCreateRequest,
    Subject,
    Unit,
)

async def test_concurrent_budget_safety():
    """Verify that concurrent reservations never exceed the budget."""
    budget_allocated = 10_000_000  # 10M microcents
    cost_per_call = 3_000_000      # 3M microcents each
    num_agents = 5

    config = CyclesConfig(base_url="http://localhost:7878", api_key="test-key")
    async with AsyncCyclesClient(config) as client:

        async def agent_reserve() -> str:
            resp = await client.create_reservation(ReservationCreateRequest(
                idempotency_key=f"test-{uuid.uuid4()}",
                subject=Subject(tenant="test-tenant"),
                action=Action(kind="llm.completion", name="gpt-4o"),
                estimate=Amount(amount=cost_per_call, unit=Unit.USD_MICROCENTS),
            ))
            if resp.status == 409:  # BUDGET_EXCEEDED — denied before any spend
                return "denied"
            reservation_id = resp.body["reservation_id"]
            # Simulate work
            await asyncio.sleep(0.1)
            await client.commit_reservation(reservation_id, CommitRequest(
                idempotency_key=f"commit-{reservation_id}",
                actual=Amount(amount=cost_per_call, unit=Unit.USD_MICROCENTS),
            ))
            return "committed"

        results = await asyncio.gather(
            *[agent_reserve() for _ in range(num_agents)]
        )

    committed = results.count("committed")
    denied = results.count("denied")

    # At most 3 agents can commit (3 * 3M = 9M < 10M budget)
    assert committed <= 3, f"Too many commits: {committed}"
    assert denied >= 2, f"Expected denials, got {denied}"
    total_spent = committed * cost_per_call
    assert total_spent <= budget_allocated, f"Overspent: {total_spent}"
```

### TypeScript concurrency test

```typescript
import { randomUUID } from "node:crypto";
import { CyclesClient, CyclesConfig } from "runcycles";

async function testConcurrentBudgetSafety() {
  const budgetAllocated = 10_000_000;
  const costPerCall = 3_000_000;
  const numAgents = 5;

  const client = new CyclesClient(new CyclesConfig({
    baseUrl: "http://localhost:7878",
    apiKey: "test-key",
  }));

  const agentReserve = async (): Promise<"committed" | "denied"> => {
    // createReservation takes the raw snake_case wire body
    const resp = await client.createReservation({
      idempotency_key: `test-${randomUUID()}`,
      subject: { tenant: "test-tenant" },
      action: { kind: "llm.completion", name: "gpt-4o" },
      estimate: { amount: costPerCall, unit: "USD_MICROCENTS" },
    });
    if (resp.status === 409) return "denied"; // BUDGET_EXCEEDED
    const reservationId = resp.body!.reservation_id as string;
    await new Promise((r) => setTimeout(r, 100));
    await client.commitReservation(reservationId, {
      idempotency_key: `commit-${reservationId}`,
      actual: { amount: costPerCall, unit: "USD_MICROCENTS" },
    });
    return "committed";
  };

  const results = await Promise.all(
    Array.from({ length: numAgents }, () => agentReserve())
  );

  const committed = results.filter((r) => r === "committed").length;
  console.assert(committed <= 3, `Too many commits: ${committed}`);
  const totalSpent = committed * costPerCall;
  console.assert(totalSpent <= budgetAllocated, `Overspent: ${totalSpent}`);
}
```

For more testing patterns, see [Testing with Cycles](/how-to/testing-with-cycles).

## Key points

- **Balance reads are informational, not authoritative.** Querying `/v1/balances` tells you the current state, but it does not reserve anything. Two agents can read the same balance and both decide to spend.
- **Reservations are authoritative.** A successful reservation guarantees the budget is locked for that agent. Other agents see the reduced remaining balance.
- **The `remaining` field accounts for reservations.** It equals `allocated - spent - reserved - debt`. Active reservations reduce `remaining` even before they commit.

## Real-world scenarios

This pattern appears in:

- **Multi-agent workflows** where agents share a team or project budget
- **Webhook-triggered processing** where multiple events arrive simultaneously
- **Batch processing** with parallel workers
- **Auto-scaling** where new instances start making calls before the budget is recalculated

## Prevention

1. **Always reserve before spending.** Never rely on balance reads for authorization. The `reserve` call is the only concurrency-safe way to claim budget. A successful reservation is a guarantee; a balance read is a suggestion.

2. **Use hierarchical scopes.** Even if agents have individual budgets, a shared parent scope acts as a hard cap. If 5 agents each have a $5 budget but the team scope is $10, the team scope prevents collective overspend:

   ```bash
   # Team-level cap
   curl -s -X POST "http://localhost:7979/v1/admin/budgets" \
     -H "Content-Type: application/json" \
     -H "X-Cycles-API-Key: $CYCLES_API_KEY" \
     -d '{"scope": "tenant:acme-corp/workspace:prod", "unit": "USD_MICROCENTS", "allocated": {"amount": 10000000, "unit": "USD_MICROCENTS"}}'

   # Per-agent budgets (sum exceeds team cap — that's fine)
   for agent in agent-a agent-b agent-c agent-d agent-e; do
     curl -s -X POST "http://localhost:7979/v1/admin/budgets" \
       -H "Content-Type: application/json" \
       -H "X-Cycles-API-Key: $CYCLES_API_KEY" \
       -d "{\"scope\": \"tenant:acme-corp/workspace:prod/agent:${agent}\", \"unit\": \"USD_MICROCENTS\", \"allocated\": {\"amount\": 5000000, \"unit\": \"USD_MICROCENTS\"}}"
   done
   ```

3. **Design for denial.** Agents that can't reserve budget should degrade gracefully, not crash. Return cached results, use a cheaper model, or queue the work for later. See [Degradation Paths](/how-to/how-to-think-about-degradation-paths-in-cycles-deny-downgrade-disable-or-defer) for patterns.

4. **Avoid fire-and-forget patterns.** If you spawn agents without awaiting their reservations, you lose the ability to react to denials. Always handle the reservation result before proceeding.

## Next steps

- [Idempotency, Retries and Concurrency](/concepts/idempotency-retries-and-concurrency-why-cycles-is-built-for-real-failure-modes) — how Cycles handles concurrency
- [Scope Derivation](/protocol/how-scope-derivation-works-in-cycles) — hierarchical budget enforcement
- [Degradation Paths](/how-to/how-to-think-about-degradation-paths-in-cycles-deny-downgrade-disable-or-defer) — handling denial gracefully
- [Multi-Tenant AI Cost Control](/blog/multi-tenant-ai-cost-control-per-tenant-budgets-quotas-isolation) — how per-tenant budget isolation prevents concurrent overspend across tenants
