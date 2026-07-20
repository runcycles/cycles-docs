---
title: "Common Budget Patterns"
description: "Practical recipes for common budget governance scenarios including per-user daily budgets, per-workflow limits, and scope hierarchies."
---

# Common Budget Patterns

Practical recipes for common budget governance scenarios. Each pattern shows the scope hierarchy and budget allocation needed.

::: tip Need cost estimates?
See the [Cost Estimation Cheat Sheet](/how-to/cost-estimation-cheat-sheet) for per-model pricing and how to translate token counts into `USD_MICROCENTS`.
:::

## Per-user daily budgets

Give each user a daily spending limit.

**Scope:** `tenant:acme-corp/workspace:prod/app:chatbot/agent:{user_id}`

```bash
# Create a $5/day budget for user-123
curl -s -X POST http://localhost:7979/v1/admin/budgets \
  -H "Content-Type: application/json" \
  -H "X-Cycles-API-Key: $CYCLES_API_KEY" \
  -d '{
    "scope": "tenant:acme-corp/workspace:prod/app:chatbot/agent:user-123",
    "unit": "USD_MICROCENTS",
    "allocated": { "amount": 500000000, "unit": "USD_MICROCENTS" }
  }' | jq .
```

**Reset daily** with a cron job or scheduled task — use `RESET_SPENT` so
each day's spent clears to 0 (not `RESET`, which preserves spent and
would leave the budget exhausted):

```bash
# Reset each user's daily budget to $5, clearing yesterday's spend
curl -s -X POST ".../fund" \
  -d '{"operation": "RESET_SPENT", "amount": {"amount": 500000000, "unit": "USD_MICROCENTS"}, ...}'
```

**In your app:**

```python
@cycles(
    estimate=2000000,
    action_kind="llm.completion",
    action_name="gpt-4o",
    # Callable: re-evaluated on every call, so each request resolves
    # the current user (a bare `current_user.id` would be captured
    # once at decoration time)
    agent=lambda prompt: current_user.id,
)
def chat(prompt: str) -> str:
    ...
```

## Per-conversation session budgets

Cap spending per conversation to prevent runaway loops.

**Scope:** `tenant:acme-corp/workflow:{conversation_id}`

```bash
# Create a $0.50 budget per conversation
curl -s -X POST http://localhost:7979/v1/admin/budgets \
  -H "Content-Type: application/json" \
  -H "X-Cycles-API-Key: $CYCLES_API_KEY" \
  -d '{
    "scope": "tenant:acme-corp/workflow:conv-abc-123",
    "unit": "USD_MICROCENTS",
    "allocated": { "amount": 50000000, "unit": "USD_MICROCENTS" }
  }' | jq .
```

**In your app:**

```python
@cycles(
    estimate=2000000,
    action_kind="llm.completion",
    action_name="gpt-4o",
    # Callable receives the function's arguments at call time
    workflow=lambda conversation_id, message: conversation_id,
)
def reply(conversation_id: str, message: str) -> str:
    ...
```

When the conversation budget runs out, the next call is denied. The user sees a "budget exhausted" message and can start a new conversation (with its own fresh budget).

## Model-tier budgets

Different budget pools for different model tiers. Prevents expensive model calls from consuming the cheap-model budget.

**Scopes:**

```
tenant:acme-corp/app:chatbot/toolset:tier-premium    → $50/month
tenant:acme-corp/app:chatbot/toolset:tier-standard    → $200/month
tenant:acme-corp/app:chatbot/toolset:tier-economy     → $500/month
```

**In your app:**

```python
MODEL_TIERS = {
    "gpt-4o": "tier-premium",
    "claude-sonnet": "tier-premium",
    "gpt-4o-mini": "tier-standard",
    "claude-haiku": "tier-economy",
}

@cycles(
    estimate=2000000,
    action_kind="llm.completion",
    # Callables: resolved per call from the function's arguments
    action_name=lambda model_name, prompt: model_name,
    toolset=lambda model_name, prompt: MODEL_TIERS[model_name],
)
def call_model(model_name: str, prompt: str) -> str:
    ...
```

## Team-level rollup budgets

Give each team its own budget while also enforcing a company-wide cap.

**Scopes (both need budgets):**

```
tenant:acme-corp                          → $10,000/month (company cap)
tenant:acme-corp/workspace:engineering    → $5,000/month
tenant:acme-corp/workspace:marketing      → $2,000/month
tenant:acme-corp/workspace:support        → $3,000/month
```

A reservation with `tenant=acme-corp, workspace=engineering` checks budget at both levels. If the engineering team has budget but the company is at its cap, the reservation is denied.

## Agent loop with per-run budget

Cap the total cost of a single agent run to prevent runaway loops.

```bash
# Create a $2 budget for this specific run
curl -s -X POST http://localhost:7979/v1/admin/budgets \
  -H "Content-Type: application/json" \
  -H "X-Cycles-API-Key: $CYCLES_API_KEY" \
  -d '{
    "scope": "tenant:acme-corp/workflow:run-xyz-789",
    "unit": "USD_MICROCENTS",
    "allocated": { "amount": 200000000, "unit": "USD_MICROCENTS" }
  }' | jq .
```

**In your app:**

```python
def agent_run(task: str, run_id: str):
    while not done:
        @cycles(
            estimate=2000000,
            action_kind="llm.completion",
            action_name="gpt-4o",
            workflow=run_id,
        )
        def think(prompt: str) -> str:
            return call_llm(prompt)

        try:
            result = think(next_prompt)
            # ... process result, decide next step ...
        except BudgetExceededError:
            return "Agent stopped: budget limit for this run reached."
```

## Gradual degradation pattern

Use multiple budget thresholds to degrade gracefully instead of hard-stopping.

**Budget scopes with different allocations:**

```
tenant:acme-corp/app:chatbot                    → $100 (hard limit)
tenant:acme-corp/app:chatbot/toolset:premium    → $60  (premium model threshold)
tenant:acme-corp/app:chatbot/toolset:tools      → $40  (tool use threshold)
```

**In your app:**

```python
from runcycles import BudgetExceededError, cycles

@cycles(estimate=5000000, action_kind="llm.completion",
        action_name="gpt-4o", toolset="premium")
def premium_response(prompt: str) -> str:
    return call_gpt4o(prompt)

@cycles(estimate=200000, action_kind="llm.completion",
        action_name="gpt-4o-mini")
def economy_response(prompt: str) -> str:
    return call_gpt4o_mini(prompt)

def respond(prompt: str) -> str:
    # Try premium model first
    try:
        return premium_response(prompt)
    except BudgetExceededError:
        pass  # Premium budget exhausted, fall through

    # Fall back to cheap model
    try:
        return economy_response(prompt)
    except BudgetExceededError:
        return "All budgets exhausted. Please try again later."
```

## Multi-tenant SaaS with per-customer budgets

Each customer gets an isolated budget. Use tenant-per-customer or workspace-per-customer depending on your isolation model.

**Option A: Tenant per customer** (strongest isolation — separate API keys)

```
tenant:customer-a → $500/month
tenant:customer-b → $200/month
```

**Option B: Workspace per customer** (shared tenant, simpler management)

```
tenant:my-saas/workspace:customer-a → $500/month
tenant:my-saas/workspace:customer-b → $200/month
```

The app resolves the scope from the authenticated request:

```python
@cycles(
    estimate=2000000,
    action_kind="llm.completion",
    action_name="gpt-4o",
    # Callable: resolves the customer per call
    workspace=lambda request: request.customer_id,
)
def handle_request(request):
    ...
```

## Next steps

- [Tenants, Scopes, and Budgets](/how-to/understanding-tenants-scopes-and-budgets-in-cycles) — how the three building blocks fit together
- [Tenant, Workflow, and Run Budgets](/how-to/how-to-model-tenant-workflow-and-run-budgets-in-cycles) — detailed multi-level budgeting guide
- [Budget Allocation and Management](/how-to/budget-allocation-and-management-in-cycles) — funding operations
- [Scope Derivation](/protocol/how-scope-derivation-works-in-cycles) — how hierarchical scopes work
- [AI Agent Budget Patterns: A Practical Guide](/blog/agent-budget-patterns-visual-guide) — architectural thinking behind each budget pattern
