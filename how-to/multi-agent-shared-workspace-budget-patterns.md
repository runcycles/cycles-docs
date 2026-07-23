---
title: "Multi-Agent Shared Workspace Budget Patterns"
description: "Recommended patterns for multiple agents sharing a workspace budget, including hierarchical scopes, per-agent sub-budgets, and concurrency-safe design."
---

# Multi-Agent Shared Workspace Budget Patterns

When multiple agents operate within the same workspace — a team of planners, executors, and reviewers working on a shared task — they need to share a finite budget without overspending. This guide covers recommended patterns for structuring budgets in multi-agent systems.

::: warning Concurrency is the core challenge
Multiple agents checking and spending against a shared budget creates race conditions. Always use Cycles reservations (not balance reads) for spending decisions. See [Concurrent Agent Overspend](/incidents/concurrent-agent-overspend) for a detailed explanation of the failure mode.
:::

## Pattern 1: Shared workspace budget with no per-agent limits

The simplest pattern. All agents draw from a single workspace-level budget. The server's atomic reservation prevents overspend.

**Scope:** `tenant:acme-corp/workspace:project-alpha`

```bash
# Create a shared $50 budget for the workspace
curl -s -X POST http://localhost:7979/v1/admin/budgets \
  -H "Content-Type: application/json" \
  -H "X-Cycles-API-Key: $CYCLES_API_KEY" \
  -d '{
    "scope": "tenant:acme-corp/workspace:project-alpha",
    "unit": "USD_MICROCENTS",
    "allocated": { "amount": 5000000000, "unit": "USD_MICROCENTS" }
  }'
```

**Client setup (Python):**

```python
@cycles(
    estimate=lambda prompt: len(prompt) * 10,
    tenant="acme-corp",
    workspace="project-alpha",
    agent="planner",  # identifies which agent, but all share workspace budget
)
def planner_call(prompt: str) -> str:
    return call_llm(prompt)
```

**When to use:** Small teams of cooperating agents where individual fairness doesn't matter — you just want a hard cap on total spend.

**Trade-off:** A single expensive agent can exhaust the budget for all others.

## Pattern 2: Per-agent sub-budgets under a shared workspace cap

Give each agent its own budget, with a workspace-level parent that acts as a hard cap. Even if per-agent budgets sum to more than the workspace budget, the workspace scope prevents collective overspend.

**Scope hierarchy:**

```
tenant:acme-corp/workspace:project-alpha          → $50 (hard cap)
  tenant:acme-corp/workspace:project-alpha/agent:planner    → $20
  tenant:acme-corp/workspace:project-alpha/agent:executor   → $30
  tenant:acme-corp/workspace:project-alpha/agent:reviewer   → $10
                                                              ───
                                                    Sum: $60 > $50 (OK)
```

```bash
# Workspace-level cap
curl -s -X POST http://localhost:7979/v1/admin/budgets \
  -H "Content-Type: application/json" \
  -H "X-Cycles-API-Key: $CYCLES_API_KEY" \
  -d '{
    "scope": "tenant:acme-corp/workspace:project-alpha",
    "unit": "USD_MICROCENTS",
    "allocated": { "amount": 5000000000, "unit": "USD_MICROCENTS" }
  }'

# Per-agent budgets
for agent_budget in "planner:2000000000" "executor:3000000000" "reviewer:1000000000"; do
  agent="${agent_budget%%:*}"
  amount="${agent_budget##*:}"
  curl -s -X POST http://localhost:7979/v1/admin/budgets \
    -H "Content-Type: application/json" \
    -H "X-Cycles-API-Key: $CYCLES_API_KEY" \
    -d "{
      \"scope\": \"tenant:acme-corp/workspace:project-alpha/agent:${agent}\",
      \"unit\": \"USD_MICROCENTS\",
      \"allocated\": { \"amount\": ${amount}, \"unit\": \"USD_MICROCENTS\" }
    }"
done
```

**Why per-agent budgets can exceed the workspace budget:** The workspace scope is checked at reservation time alongside the agent scope. If the workspace is exhausted, the reservation is denied — regardless of the agent's remaining budget. Over-allocating at the agent level provides flexibility: if the planner finishes under budget, the executor can use more of the shared pool.

**When to use:** Multi-agent workflows where you want both individual fairness and a collective hard cap.

## Pattern 3: Workflow-scoped budgets for task isolation

When agents run multiple independent workflows (e.g. processing different customer requests), scope budgets per workflow to prevent one task from consuming another's budget.

**Scope hierarchy:**

```
tenant:acme-corp/workspace:prod/workflow:task-123       → $10
  tenant:acme-corp/workspace:prod/workflow:task-123/agent:planner
  tenant:acme-corp/workspace:prod/workflow:task-123/agent:executor
tenant:acme-corp/workspace:prod/workflow:task-456       → $10
  tenant:acme-corp/workspace:prod/workflow:task-456/agent:planner
  tenant:acme-corp/workspace:prod/workflow:task-456/agent:executor
```

**Client setup (TypeScript):**

```typescript
const plannerCall = withCycles(
  {
    estimate: 2_000_000,
    tenant: "acme-corp",
    workspace: "prod",
    workflow: taskId,      // dynamic per-task
    agent: "planner",
  },
  async (prompt: string) => callLlm(prompt),
);
```

**When to use:** Task-parallel systems where each task should have an independent budget ceiling.

## Pattern 4: Tiered agents with differentiated limits

Give expensive agents (e.g. those using GPT-4) smaller budgets than cheap agents (e.g. those using GPT-4o-mini), reflecting their different cost profiles.

```bash
# Expensive planner agent — small budget ($5), large model
curl -s -X POST http://localhost:7979/v1/admin/budgets \
  -H "Content-Type: application/json" \
  -H "X-Cycles-API-Key: $CYCLES_API_KEY" \
  -d '{
    "scope": "tenant:acme-corp/workspace:prod/agent:planner",
    "unit": "USD_MICROCENTS",
    "allocated": { "amount": 500000000, "unit": "USD_MICROCENTS" }
  }'

# Cheap executor agent — larger budget ($20), smaller model
curl -s -X POST http://localhost:7979/v1/admin/budgets \
  -H "Content-Type: application/json" \
  -H "X-Cycles-API-Key: $CYCLES_API_KEY" \
  -d '{
    "scope": "tenant:acme-corp/workspace:prod/agent:executor",
    "unit": "USD_MICROCENTS",
    "allocated": { "amount": 2000000000, "unit": "USD_MICROCENTS" }
  }'
```

## Handling denials gracefully

In any multi-agent system, some agents will be denied budget. Design for this:

```python
from runcycles import cycles, BudgetExceededError

@cycles(estimate=2_000_000, agent="executor")
def executor_call(prompt: str) -> str:
    return call_llm(prompt)

def run_executor(prompt: str) -> str:
    try:
        return executor_call(prompt)
    except BudgetExceededError:
        # Options: use a cheaper model, return cached results,
        # queue for later, or signal the orchestrator to stop
        return use_cheaper_model(prompt)
```

For a full treatment of degradation strategies, see [Degradation Paths](/how-to/how-to-think-about-degradation-paths-in-cycles-deny-downgrade-disable-or-defer).

## Monitoring shared budgets

Track budget consumption across agents to detect imbalances early:

```bash
# Check remaining budget across all agents in a workspace
curl -s "http://localhost:7878/v1/balances?tenant=acme-corp&workspace=project-alpha" \
  -H "X-Cycles-API-Key: $API_KEY" | jq '.balances[] | {scope_path, remaining: .remaining.amount, spent: .spent.amount}'
```

Set up alerts when any scope drops below 10% remaining with active reservations. See [Monitoring and Alerting](/how-to/monitoring-and-alerting) for detailed setup.

## Key principles

1. **Reserve, don't read.** Balance queries are informational. Reservations are authoritative. Never use a balance read to decide whether to proceed.
2. **Use parent scopes as hard caps.** Per-agent budgets provide fairness; workspace/tenant scopes provide safety.
3. **Design for denial.** Any agent can be denied at any time. Graceful degradation is not optional.
4. **Set the `agent` field.** Always identify which agent is spending. This enables per-agent monitoring, debugging, and budget allocation.

## Next steps

- [Common Budget Patterns](/how-to/common-budget-patterns) — per-user, per-workflow, and other scope recipes
- [Concurrent Agent Overspend](/incidents/concurrent-agent-overspend) — the failure mode these patterns prevent
- [Scope Derivation](/protocol/how-scope-derivation-works-in-cycles) — how hierarchical scopes work
- [Degradation Paths](/how-to/how-to-think-about-degradation-paths-in-cycles-deny-downgrade-disable-or-defer) — handling denial gracefully
