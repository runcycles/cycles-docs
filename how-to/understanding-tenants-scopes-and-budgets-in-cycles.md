---
title: "Understanding Tenants, Scopes, and Budgets in Cycles"
description: "How tenants, scopes, and budgets work together in Cycles — the unified model for hierarchical budget enforcement across autonomous agents and workflows."
---

# Understanding Tenants, Scopes, and Budgets in Cycles

Cycles enforces budget limits on autonomous execution. To do that, it uses three building blocks that work together:

- **Tenants** — who is spending
- **Scopes** — where enforcement happens in the hierarchy
- **Budgets** — how much is allowed at each scope

Understanding how these three pieces relate is the foundation for designing effective budget governance. This guide explains the model, shows how the pieces connect, and helps you design your own scope structure.

## The three building blocks

<ScopeDiagram />

## Tenants: the isolation boundary

A tenant is the top-level organizational unit in Cycles. It represents an independent entity whose budget is completely isolated from other tenants.

Depending on your platform, a tenant might be:

- a customer in a SaaS product
- an internal department or team
- a partner or reseller
- an environment (production, staging, development)

### How tenant isolation works

Every API key belongs to exactly one tenant. When your application sends a request to the Cycles server, the server derives the **effective tenant** from the API key and enforces that all operations stay within that tenant's boundary:

- Reservations can only be created for the API key's tenant
- Balances can only be queried within the API key's tenant
- Reservations owned by one tenant cannot be accessed by another

This isolation is enforced at the protocol level on every request. A key for tenant A cannot see or modify tenant B's budgets, reservations, or balances — even if someone knows the reservation ID.

For the full tenant lifecycle (creating, listing, updating, suspending, and closing tenants), see [Tenant Creation and Management](/how-to/tenant-creation-and-management-in-cycles).

## Scopes: the budget hierarchy

A scope is a hierarchical path that identifies a specific budget boundary. Scopes are derived from the **Subject** — the set of fields you send with every request that describe who is spending.

### The six standard levels

The Cycles protocol defines a fixed hierarchy of Subject fields:

```
tenant → workspace → app → workflow → agent → toolset
```

When a request includes Subject fields, the server builds scope paths from them in this canonical order. For example, a request with:

```json
{
  "subject": {
    "tenant": "acme-corp",
    "workspace": "prod",
    "app": "chatbot"
  }
}
```

Produces three derived scopes:

1. `tenant:acme-corp`
2. `tenant:acme-corp/workspace:prod`
3. `tenant:acme-corp/workspace:prod/app:chatbot`

Each of these scopes is a separate budget boundary that the server checks.

### Gap-skipping

You do not need to provide all six levels. If you skip a level, the server simply omits it from the scope path.

For example, a request with only `tenant` and `agent`:

```json
{
  "subject": {
    "tenant": "acme-corp",
    "agent": "summarizer-v2"
  }
}
```

Produces two scopes:

1. `tenant:acme-corp`
2. `tenant:acme-corp/agent:summarizer-v2`

The intermediate levels (`workspace`, `app`, `workflow`) are not present and are not checked. This means you only need to create budgets at the levels you actually care about.

### Custom dimensions

For attribution facets that do not fit the standard hierarchy, the Subject supports a `dimensions` field with custom key-value pairs:

```json
{
  "subject": {
    "tenant": "acme-corp",
    "workflow": "support-triage",
    "dimensions": {
      "run": "run-12345",
      "cost_center": "engineering"
    }
  }
}
```

Dimensions are metadata for reporting and policy taxonomies only — they never derive scopes, and servers MAY ignore them for budgeting decisions. To give each execution an enforceable **run budget**, encode the run identifier in a standard Subject field instead (e.g. `workflow: "run-{id}"`, deriving the scope `workflow:run-{id}`) — see [modeling tenant, workflow, and run budgets](/how-to/how-to-model-tenant-workflow-and-run-budgets-in-cycles).

For the full technical specification, see [How Scope Derivation Works](/protocol/how-scope-derivation-works-in-cycles).

## Budgets: the enforcement layer

A budget is an allocation assigned to a specific scope and unit pair. It is the ceiling against which reservations and commits are measured.

### The ledger formula

Each scope tracks a ledger with these fields:

| Field | Meaning |
|---|---|
| `allocated` | Total budget assigned to this scope |
| `spent` | Committed actual usage |
| `reserved` | Currently held by active reservations |
| `remaining` | Available for new reservations |
| `debt` | Negative balance from overdraft commits |

The relationship between these fields:

```
remaining = allocated - spent - reserved - debt
```

A reservation succeeds only if `remaining >= estimate` across all affected scopes.

### Budgets are independent at each scope level

This is a key concept: budgets do **not** automatically propagate between parent and child scopes.

If you set a tenant budget of $100, that does not automatically distribute $100 to child scopes. Each scope where you want enforcement needs its own explicit budget allocation.

For example:

| Scope | Allocated | What it controls |
|---|---|---|
| `tenant:acme-corp` | $100 | Total cap for the tenant |
| `tenant:acme-corp/workspace:prod` | $60 | Cap for production workloads |
| `tenant:acme-corp/workspace:prod/app:chatbot` | $20 | Cap for the chatbot app specifically |

A reservation for the chatbot must pass all three levels — even if the chatbot scope has room, the reservation fails if the tenant or workspace scope is exhausted.

### At least one budget must exist

Scopes without budgets are simply **skipped** during enforcement — a missing budget at one level never causes a denial on its own. You do not need a budget at every possible scope, only at scopes where you want enforcement.

The one requirement: at least one derived scope must have a budget. If **none** of the derived scopes has a budget in the requested unit, the server rejects the request with `404 NOT_FOUND`. That is different from a budget denial — a reservation that exceeds an existing budget is rejected with `409 BUDGET_EXCEEDED`.

For setting up budgets, see [Budget Allocation and Management](/how-to/budget-allocation-and-management-in-cycles).

## How they work together

Here is what happens when a reservation request flows through the system:

```
1. Your app sends a reservation request
   with Subject {tenant: "acme-corp", workspace: "prod", app: "chatbot"}
   and estimate of 500,000 microcents

2. The server derives the API key's tenant → "acme-corp"
   and verifies subject.tenant matches (403 if not)

3. The server derives scopes from the Subject:
   → tenant:acme-corp
   → tenant:acme-corp/workspace:prod
   → tenant:acme-corp/workspace:prod/app:chatbot

4. The server checks budgets at EVERY derived scope that has one,
   atomically (scopes without a budget are skipped):
   ┌─────────────────────────────────────────┬───────────┬────────┐
   │ Scope                                   │ Remaining │ Result │
   ├─────────────────────────────────────────┼───────────┼────────┤
   │ tenant:acme-corp                        │ 5,000,000 │   OK   │
   │ tenant:acme-corp/workspace:prod         │ 3,000,000 │   OK   │
   │ tenant:acme-corp/workspace:prod/app:cb  │   800,000 │   OK   │
   └─────────────────────────────────────────┴───────────┴────────┘

5. ALL scopes pass → reservation is ALLOWED
   Budget is reserved atomically at every scope

6. If ANY scope fails → entire reservation is DENIED
   No partial reservations, no inconsistent state
```

### Allocation flows top-down, pressure flows bottom-up

- **Top-down:** A tenant budget constrains everything beneath it. If the tenant is exhausted, no child scope can reserve budget — even if the child has its own remaining allocation.

- **Bottom-up:** When a child scope runs low, that pressure is visible in balance queries at higher levels. If the chatbot app is consuming most of the workspace budget, you can see that before the workspace itself is exhausted.

## Designing your scope structure

Your scope structure determines where enforcement happens. Start simple and add levels as your needs grow.

### Start with tenant-only

The simplest model: one budget per tenant.

```
tenant:acme-corp → $100
```

Every reservation by this tenant draws from a single pool. This is enough for basic multi-tenant isolation and is the recommended starting point.

### Add workspace for environment separation

Separate production from staging to prevent test runs from consuming production budget:

```
tenant:acme-corp                       → $100  (total cap)
tenant:acme-corp/workspace:prod        → $80   (production cap)
tenant:acme-corp/workspace:staging     → $20   (staging cap)
```

### Add app or workflow for feature-level control

Different features may justify different budgets:

```
tenant:acme-corp                                    → $100
tenant:acme-corp/workspace:prod                     → $80
tenant:acme-corp/workspace:prod/app:chatbot         → $30
tenant:acme-corp/workspace:prod/app:research-agent  → $50
```

### Add per-execution budgets for safety

Use the `workflow` field or custom dimensions to cap individual runs:

```
tenant:acme-corp                           → $100  (tenant cap)
tenant:acme-corp/workflow:run-xyz-789      → $2    (single run cap)
```

This protects against runaway loops — even if the tenant has plenty of budget, one execution cannot consume more than $2.

### Decision framework

When deciding which scopes to use, ask:

| Question | Scope to add |
|---|---|
| "How much can this customer spend total?" | `tenant` |
| "How much can this environment consume?" | `workspace` |
| "How much can this feature/product use?" | `app` |
| "How much can this type of process consume?" | `workflow` |
| "How much can this individual agent use?" | `agent` |
| "How much can this set of tools cost?" | `toolset` |
| "How much can this single execution consume?" | `workflow: "run-{id}"` (a standard field — `dimensions` are not enforceable) |

You do not need all of them. Most teams start with tenant + one or two additional levels.

For more patterns, see [Common Budget Patterns](/how-to/common-budget-patterns) and [Tenant, Workflow, and Run Budgets](/how-to/how-to-model-tenant-workflow-and-run-budgets-in-cycles).

## Managing scopes in practice

### Creating budgets at each scope level

Budgets are created through the Admin API. You need one budget per scope per unit:

```bash
# Tenant-level budget
curl -s -X POST http://localhost:7979/v1/admin/budgets \
  -H "Content-Type: application/json" \
  -H "X-Cycles-API-Key: $CYCLES_API_KEY" \
  -d '{
    "scope": "tenant:acme-corp",
    "unit": "USD_MICROCENTS",
    "allocated": {"amount": 10000000000, "unit": "USD_MICROCENTS"}
  }' | jq .

# Workspace-level budget (within the tenant)
curl -s -X POST http://localhost:7979/v1/admin/budgets \
  -H "Content-Type: application/json" \
  -H "X-Cycles-API-Key: $CYCLES_API_KEY" \
  -d '{
    "scope": "tenant:acme-corp/workspace:prod",
    "unit": "USD_MICROCENTS",
    "allocated": {"amount": 8000000000, "unit": "USD_MICROCENTS"}
  }' | jq .

# App-level budget (within the workspace)
curl -s -X POST http://localhost:7979/v1/admin/budgets \
  -H "Content-Type: application/json" \
  -H "X-Cycles-API-Key: $CYCLES_API_KEY" \
  -d '{
    "scope": "tenant:acme-corp/workspace:prod/app:chatbot",
    "unit": "USD_MICROCENTS",
    "allocated": {"amount": 3000000000, "unit": "USD_MICROCENTS"}
  }' | jq .
```

### Querying balances across the hierarchy

Check budget state at any level:

```bash
# All balances for a tenant
curl -s "http://localhost:7878/v1/balances?tenant=acme-corp" \
  -H "X-Cycles-API-Key: $API_KEY" | jq .
```

This returns balances at every scope under the tenant, showing `allocated`, `spent`, `reserved`, `remaining`, and `debt` at each level.

### Resetting budgets for billing periods

At the start of a new billing period, reset budgets to their allocation:

```bash
# Reset tenant-level budget
curl -s -X POST "http://localhost:7979/v1/admin/budgets/fund?scope=tenant:acme-corp&unit=USD_MICROCENTS" \
  -H "Content-Type: application/json" \
  -H "X-Cycles-API-Key: $CYCLES_API_KEY" \
  -d '{
    "operation": "RESET_SPENT",
    "amount": {"amount": 10000000000, "unit": "USD_MICROCENTS"},
    "idempotency_key": "reset-april-2026",
    "reason": "Monthly budget reset"
  }' | jq .

# Reset workspace-level budget
curl -s -X POST "http://localhost:7979/v1/admin/budgets/fund?scope=tenant:acme-corp/workspace:prod&unit=USD_MICROCENTS" \
  -H "Content-Type: application/json" \
  -H "X-Cycles-API-Key: $CYCLES_API_KEY" \
  -d '{
    "operation": "RESET_SPENT",
    "amount": {"amount": 8000000000, "unit": "USD_MICROCENTS"},
    "idempotency_key": "reset-ws-prod-april-2026",
    "reason": "Monthly workspace budget reset"
  }' | jq .
```

Reset each scope independently — parent resets do not cascade to children.

### Evolving your scope structure

You can add new scope levels at any time by creating new budget ledgers. Existing reservations are not affected.

To stop enforcing at a scope level, simply stop including that field in your Subject. Budget ledgers without incoming reservations remain idle.

### Scope consistency

The most important practice: **always include the same Subject fields for the same type of request.** If some code paths include `workspace` and others do not, budget enforcement becomes inconsistent — some requests check the workspace scope, others bypass it.

For more on this, see [Scope Misconfiguration and Budget Leaks](/incidents/scope-misconfiguration-and-budget-leaks).

## A complete example

A SaaS platform with two customers, each with production and staging environments, and per-app budgets.

### Step 1: Create tenants

```bash
# Customer A
curl -s -X POST http://localhost:7979/v1/admin/tenants \
  -H "Content-Type: application/json" \
  -H "X-Admin-API-Key: $ADMIN_API_KEY" \
  -d '{"tenant_id": "customer-a", "name": "Customer A"}'

# Customer B
curl -s -X POST http://localhost:7979/v1/admin/tenants \
  -H "Content-Type: application/json" \
  -H "X-Admin-API-Key: $ADMIN_API_KEY" \
  -d '{"tenant_id": "customer-b", "name": "Customer B"}'
```

### Step 2: Create API keys

```bash
# API key for Customer A
KEY_A=$(curl -s -X POST http://localhost:7979/v1/admin/api-keys \
  -H "Content-Type: application/json" \
  -H "X-Admin-API-Key: $ADMIN_API_KEY" \
  -d '{
    "tenant_id": "customer-a",
    "name": "prod-key",
    "permissions": ["reservations:create","reservations:commit","reservations:release","balances:read"]
  }' | jq -r '.key_secret')
```

### Step 3: Create budgets at multiple scope levels

```bash
# Customer A: tenant-level cap
curl -s -X POST http://localhost:7979/v1/admin/budgets \
  -H "Content-Type: application/json" \
  -H "X-Cycles-API-Key: $CYCLES_API_KEY" \
  -d '{
    "scope": "tenant:customer-a",
    "unit": "USD_MICROCENTS",
    "allocated": {"amount": 10000000000, "unit": "USD_MICROCENTS"}
  }'

# Customer A: production workspace cap
curl -s -X POST http://localhost:7979/v1/admin/budgets \
  -H "Content-Type: application/json" \
  -H "X-Cycles-API-Key: $CYCLES_API_KEY" \
  -d '{
    "scope": "tenant:customer-a/workspace:prod",
    "unit": "USD_MICROCENTS",
    "allocated": {"amount": 8000000000, "unit": "USD_MICROCENTS"}
  }'

# Customer A: chatbot app cap within production
curl -s -X POST http://localhost:7979/v1/admin/budgets \
  -H "Content-Type: application/json" \
  -H "X-Cycles-API-Key: $CYCLES_API_KEY" \
  -d '{
    "scope": "tenant:customer-a/workspace:prod/app:chatbot",
    "unit": "USD_MICROCENTS",
    "allocated": {"amount": 3000000000, "unit": "USD_MICROCENTS"}
  }'
```

### Step 4: Make a reservation

```bash
curl -s -X POST http://localhost:7878/v1/reservations \
  -H "Content-Type: application/json" \
  -H "X-Cycles-API-Key: $KEY_A" \
  -d '{
    "idempotency_key": "example-001",
    "subject": {
      "tenant": "customer-a",
      "workspace": "prod",
      "app": "chatbot"
    },
    "action": {"kind": "llm.completion", "name": "openai:gpt-4o"},
    "estimate": {"amount": 500000, "unit": "USD_MICROCENTS"},
    "ttl_ms": 30000
  }' | jq .
```

The server checks budgets at all three scopes atomically. If all pass, the reservation is allowed. The response includes `affected_scopes` showing which scopes were charged.

### Step 5: Check balances across the hierarchy

```bash
curl -s "http://localhost:7878/v1/balances?tenant=customer-a" \
  -H "X-Cycles-API-Key: $KEY_A" | jq '.balances[] | {scope: .scope_path, remaining: .remaining.amount, reserved: .reserved.amount}'
```

This shows the remaining and reserved amounts at every scope level — giving you visibility into where budget pressure exists in the hierarchy.

## Best practices

### Tenant best practices

- **One tenant per isolation boundary.** If two groups of users should not share budget, they should be separate tenants. Do not multiplex unrelated customers into a single tenant.
- **Use stable, meaningful tenant IDs.** Tenant IDs appear in scope paths, audit logs, and API key bindings. Use domain-meaningful names like `customer-acme` or `dept-engineering`, not internal database IDs. They cannot be changed after creation.
- **Suspend before you close.** Use `SUSPENDED` for temporary blocks (payment failure, investigation). Only use `CLOSED` when you are permanently decommissioning — it is irreversible.
- **Use metadata for external correlation.** Store billing IDs, plan tiers, and external system references in the `metadata` field. This makes it easy to join tenant data with your billing or CRM system.
- **Set `default_commit_overage_policy` at the tenant level.** This establishes a baseline for all scopes. Override per-budget-ledger or per-reservation when specific scopes need different behavior.

### Scope best practices

- **Start with the fewest scope levels that solve your problem.** Tenant-only is a valid starting point. Add workspace, app, or workflow levels only when you need finer control.
- **Keep Subject fields consistent across all code paths.** If some requests include `workspace` and others do not, enforcement becomes inconsistent — some requests bypass the workspace-level check. See [Scope Misconfiguration and Budget Leaks](/incidents/scope-misconfiguration-and-budget-leaks).
- **Use the canonical hierarchy.** The protocol defines `tenant → workspace → app → workflow → agent → toolset`. Map your concepts to these standard levels rather than fighting the ordering.
- **Prefer standard fields over custom dimensions.** Standard fields have built-in scope derivation support. Use `dimensions` only for concepts that truly do not fit (e.g., per-run IDs, cost centers).
- **Validate scope consistency in tests.** Write tests that verify all code paths for the same operation include the same Subject fields. Inconsistencies cause silent budget bypasses.
- **Only create budgets at scopes you need to enforce.** You do not need a budget at every level — scopes without budgets are skipped during enforcement.

### Budget best practices

- **Always create the tenant-level budget first.** The tenant scope is the foundation. Without it, child scope budgets have no parent boundary.
- **Set child scope budgets smaller than parent scope budgets.** A workspace budget of $80 under a tenant budget of $100 makes sense. A workspace budget of $150 under a tenant budget of $100 wastes allocation — the tenant scope will deny before the workspace budget is exhausted.
- **Use idempotency keys on all funding operations.** This prevents double-funding from retries. Use meaningful keys like `fund-acme-march-2026` rather than random UUIDs.
- **Reset budgets at billing period boundaries.** Use the `RESET_SPENT` operation to clear `spent` at period boundaries rather than accumulating `CREDIT` operations. `RESET_SPENT` emits a `budget.reset_spent` event so dashboards can distinguish period boundaries from ceiling changes. Use `RESET` only for resizing the allocated ceiling (plan changes), not for period boundaries — `RESET` preserves spent.
- **Monitor `is_over_limit` and `debt` proactively.** When `debt > 0` and no `overdraft_limit` is configured, new reservations are blocked with `DEBT_OUTSTANDING`. When `debt > overdraft_limit`, the scope enters over-limit state (`OVERDRAFT_LIMIT_EXCEEDED`). Detect these early.
- **`ALLOW_IF_AVAILABLE` is the default overage policy.** It caps charges to available budget and never creates debt. Switch to `REJECT` for hard stops, or `ALLOW_WITH_OVERDRAFT` when exact accounting with debt is needed. Overdraft creates blocking debt that must be explicitly repaid.

## Common questions

### Do I need a budget at every scope level?

No. You only need budgets at scopes where you want enforcement. If you only care about tenant-level caps, create a single budget at `tenant:acme-corp`. Child scopes without budgets are skipped during enforcement.

### What happens if I skip a level in the hierarchy?

If your Subject includes `tenant` and `app` but not `workspace`, the server derives two scopes: `tenant:acme-corp` and `tenant:acme-corp/app:chatbot`. The workspace level is not checked and does not need a budget.

### Can scopes overlap?

No. Each derived scope is an independent budget boundary. The scope `tenant:acme-corp/workspace:prod` is completely separate from `tenant:acme-corp/workspace:staging`. They do not share budget or aggregate balances.

### Can I change my scope structure later?

Yes. Create new budget ledgers at new scopes at any time. Existing budgets and reservations are unaffected. To stop enforcing at a level, simply stop including that field in your Subject.

### How do scopes relate to API keys?

API keys enforce **tenant isolation** — an API key for tenant A cannot operate on tenant B. Scopes enforce **budget hierarchy within a tenant** — different parts of tenant A's organization can have different budget limits.

### Do parent scope budgets automatically include child scope charges?

No. Parent and child scopes are independent ledgers. A reservation at `tenant:acme-corp/workspace:prod/app:chatbot` charges all three scopes independently. The parent scope does not "roll up" child charges — it is charged directly as part of the atomic reservation.

## Next steps

- [Tenant Creation and Management](/how-to/tenant-creation-and-management-in-cycles) — create and manage tenants via the Admin API
- [Budget Allocation and Management](/how-to/budget-allocation-and-management-in-cycles) — fund and adjust budgets at each scope level
- [How Scope Derivation Works](/protocol/how-scope-derivation-works-in-cycles) — the technical protocol reference for scope mechanics
- [Common Budget Patterns](/how-to/common-budget-patterns) — practical recipes for real-world scope hierarchies
- [Tenant, Workflow, and Run Budgets](/how-to/how-to-model-tenant-workflow-and-run-budgets-in-cycles) — multi-level policy design
- [Scope Misconfiguration and Budget Leaks](/incidents/scope-misconfiguration-and-budget-leaks) — what can go wrong with scope design
- [Multi-Tenant AI Cost Control](/blog/multi-tenant-ai-cost-control-per-tenant-budgets-quotas-isolation) — per-tenant budgets, quotas, and isolation for agent platforms
