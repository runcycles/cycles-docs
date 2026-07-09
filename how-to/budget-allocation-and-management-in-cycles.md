---
title: "Budget Allocation and Management in Cycles"
description: "How budget allocation works in Cycles — set up scope-level budgets, fund them, resize ceilings (RESET) and start new billing periods (RESET_SPENT), and manage hierarchical budget structures."
---

# Budget Allocation and Management in Cycles

Before you can enforce budgets with Cycles, budgets need to be allocated to scopes. This page explains how budget allocation works, how to set it up, and how to manage budgets over time.

## What is allocation?

Allocation is the total budget assigned to a scope. It is the ceiling against which reservations and commits are measured.

The formula for remaining budget is:

```
remaining = allocated - spent - reserved - debt
```

A reservation succeeds only if `remaining >= estimate` across all affected scopes.

## How allocation works

Each scope in Cycles has an `allocated` value. When a client creates a reservation, the server checks the allocated budget for every scope in the derived hierarchy.

For example, if a reservation targets:

```json
{
  "tenant": "acme",
  "workspace": "production",
  "app": "chatbot"
}
```

Three scopes are checked:

- `tenant:acme` — must have sufficient remaining budget
- `tenant:acme/workspace:production` — must have sufficient remaining budget
- `tenant:acme/workspace:production/app:chatbot` — must have sufficient remaining budget

All three must pass for the reservation to succeed.

## Setting budgets

Budget allocation is managed through the [Cycles Admin Server](https://github.com/runcycles/cycles-server-admin) API (port 7979 by default). The admin server and the runtime Cycles server share the same Redis instance.

### Authentication

Budget, policy, and balance endpoints on the admin server require a tenant-scoped API key (`X-Cycles-API-Key`) with the appropriate permissions:

- **`budgets:write`** — required for creating budgets, funding, and resetting (or `admin:write` as wildcard)
- **`budgets:read`** — required for listing and querying budgets (or `admin:read` as wildcard)
- **`policies:write`** — required for creating and updating policies (or `admin:write` as wildcard)
- **`policies:read`** — required for listing and querying policies (or `admin:read` as wildcard)

Default API keys (created without explicit permissions) include `budgets:write` and `budgets:read` as of v0.1.25.6 and will work for budget operations. Keys created before v0.1.25.6 with explicitly specified permission sets may need `budgets:write` and/or `budgets:read` added. See [API Key Management](/how-to/api-key-management-in-cycles#available-permissions) for the full permission list.

::: warning X-Admin-API-Key vs X-Cycles-API-Key
The bootstrap admin key (`X-Admin-API-Key`) is used for tenant management, API key management, audit log access, and budget PATCH/freeze/unfreeze (admin-only operations). Budget **create**, **list**, and **fund** are dual-auth — they accept either `X-Cycles-API-Key` (with `budgets:write`/`budgets:read`) or `X-Admin-API-Key`. Under the admin key: create requires `tenant_id` in the request **body** (and it must be omitted under a tenant key — the tenant is implicit); fund requires the `tenant_id` **query parameter**; list treats `tenant_id` as an optional filter (omit it for a cross-tenant listing). Admin-key writes are audit-logged with `actor_type=admin_on_behalf_of` (the lowercase wire value; spec prose sometimes shows the enum constant `ADMIN_ON_BEHALF_OF`).
:::

### Using the Cycles Admin API

Create budget ledgers and fund them via the admin API:

```bash
# Create a tenant budget ledger
curl -X POST http://localhost:7979/v1/admin/budgets \
  -H "Content-Type: application/json" \
  -H "X-Cycles-API-Key: $CYCLES_API_KEY" \
  -d '{
    "scope": "tenant:acme",
    "unit": "USD_MICROCENTS",
    "allocated": { "amount": 1000000, "unit": "USD_MICROCENTS" }
  }'

# Fund the budget
curl -X POST "http://localhost:7979/v1/admin/budgets/fund?scope=tenant:acme&unit=USD_MICROCENTS" \
  -H "Content-Type: application/json" \
  -H "X-Cycles-API-Key: $CYCLES_API_KEY" \
  -d '{
    "operation": "CREDIT",
    "amount": { "amount": 1000000, "unit": "USD_MICROCENTS" },
    "idempotency_key": "fund-acme-001"
  }'

# Create a workspace budget within that tenant
curl -X POST http://localhost:7979/v1/admin/budgets \
  -H "Content-Type: application/json" \
  -H "X-Cycles-API-Key: $CYCLES_API_KEY" \
  -d '{
    "scope": "tenant:acme/workspace:production",
    "unit": "USD_MICROCENTS",
    "allocated": { "amount": 500000, "unit": "USD_MICROCENTS" }
  }'

curl -X POST "http://localhost:7979/v1/admin/budgets/fund?scope=tenant:acme/workspace:production&unit=USD_MICROCENTS" \
  -H "Content-Type: application/json" \
  -H "X-Cycles-API-Key: $CYCLES_API_KEY" \
  -d '{
    "operation": "CREDIT",
    "amount": { "amount": 500000, "unit": "USD_MICROCENTS" },
    "idempotency_key": "fund-acme-prod-001"
  }'
```

::: info Note
Tenants and API keys must be created first using the admin key (`X-Admin-API-Key`). See [Deploying the Full Cycles Stack](/quickstart/deploying-the-full-cycles-stack) for the complete bootstrap sequence.
:::

### Budget hierarchy

Budgets are independent at each scope level. A tenant budget of 1,000,000 does not automatically distribute to child scopes.

You set the allocated amount at each level you want to control:

| Scope | Allocated | Purpose |
|---|---|---|
| `tenant:acme` | 1,000,000 | Global cap for the tenant |
| `tenant:acme/workspace:production` | 500,000 | Cap for the production environment |
| `tenant:acme/workspace:production/app:chatbot` | 100,000 | Cap for the chatbot app |

A reservation for 10,000 against the chatbot scope must pass all three levels.

### Unallocated scopes

If a scope has a budget ledger with zero allocation (`allocated = 0`), any reservation targeting it will be denied with `BUDGET_EXCEEDED` (409). The ledger exists but has no room.

If a scope has no budget ledger at all, it is **skipped** during enforcement — it does not block the reservation. This is different from zero allocation: a missing ledger is ignored, a zero-allocation ledger is enforced.

### How budget lookup works during reservations

When the server processes a reservation, it derives scope paths from the subject (e.g., `tenant:acme`, `tenant:acme/workspace:prod`, `tenant:acme/workspace:prod/app:chatbot`) and checks each for a budget ledger:

1. Scopes **with** a budget ledger are checked for sufficient funds
2. Scopes **without** a budget ledger are skipped — they do not block the reservation
3. If **no** derived scope has a budget ledger, the reservation is rejected with `NOT_FOUND` (404) — the response message is `"Budget not found for provided scope: ..."`. (On `/v1/decide` and dry-run reserve, the same condition surfaces as `200 DENY` with `reason_code=BUDGET_NOT_FOUND`.)
4. If **any** budgeted scope has insufficient funds, the reservation is rejected with `BUDGET_EXCEEDED` (409)

This means you only need budgets at the scope levels where you want enforcement. For example, if you only set a tenant-level budget, workspace and app scopes are skipped — the tenant budget is the only constraint.

| Scenario | Result |
|---|---|
| Budget at tenant only, reservation targets tenant/workspace/app | Reserves against tenant budget; workspace and app skipped |
| Budget at tenant and app, not workspace | Reserves against both; workspace skipped |
| No budget at any scope | `NOT_FOUND` (404) — message: `"Budget not found for provided scope: ..."` |
| Budget exists with zero allocation | `BUDGET_EXCEEDED` (409) |

## Common allocation patterns

### Flat tenant budgets

The simplest approach: allocate a single budget at the tenant level.

```
tenant:acme → allocated: 1,000,000
```

Every reservation by tenant `acme` draws from this single pool. No per-workspace or per-app limits.

### Tenant + workspace budgets

Add workspace-level budgets for environment isolation:

```
tenant:acme                          → allocated: 1,000,000
tenant:acme/workspace:production     → allocated: 500,000
tenant:acme/workspace:staging        → allocated: 200,000
tenant:acme/workspace:development    → allocated: 300,000
```

Production cannot consume more than 500,000, even if the tenant has remaining budget elsewhere.

### Per-workflow run budgets

For short-lived workflows, allocate budgets per run using the workflow field:

```
tenant:acme/workspace:production/workflow:run-12345 → allocated: 50,000
```

This caps a single workflow execution at 50,000 units.

### Per-agent budgets

For multi-agent systems, allocate per agent:

```
tenant:acme/workspace:production/agent:planner   → allocated: 100,000
tenant:acme/workspace:production/agent:executor   → allocated: 200,000
tenant:acme/workspace:production/agent:reviewer   → allocated: 50,000
```

### Custom dimensions are not budget scopes

The Subject's optional `dimensions` map (e.g., `cost_center`, `region`) does **not** participate in scope derivation. Scopes are derived only from the six standard Subject fields, in canonical order: `tenant` → `workspace` → `app` → `workflow` → `agent` → `toolset`. There is no `dimensions:` scope segment, so you cannot allocate a budget to a dimension value. v0 servers may ignore `dimensions` for budgeting decisions entirely (they only have to accept and round-trip it) — use dimensions for reporting and policy taxonomies, and model any dimension you need to *enforce* as one of the six standard fields instead.

## Updating budget configuration

Use `PATCH /v1/admin/budgets?scope={scope}&unit={unit}` to update mutable budget properties without re-creating the ledger:

```bash
curl -s -X PATCH "http://localhost:7979/v1/admin/budgets?scope=tenant:acme&unit=USD_MICROCENTS" \
  -H "Content-Type: application/json" \
  -H "X-Admin-API-Key: $ADMIN_KEY" \
  -d '{
    "overdraft_limit": { "amount": 500000, "unit": "USD_MICROCENTS" },
    "commit_overage_policy": "ALLOW_WITH_OVERDRAFT",
    "metadata": { "cost_center": "engineering" }
  }' | jq .
```

You can update:

- **`overdraft_limit`** — maximum allowed debt. When changed, `is_over_limit` is atomically recalculated.
- **`commit_overage_policy`** — per-ledger overage policy override (`REJECT`, `ALLOW_IF_AVAILABLE`, `ALLOW_WITH_OVERDRAFT`).
- **`metadata`** — key-value pairs for external references (replaces the full metadata object).

Fields not included in the request are left unchanged. Returns `404` if the budget does not exist, `403` for tenant mismatch, and `409` if the budget is `CLOSED`.

## Freezing and unfreezing budgets

*New in v0.1.25.6.*

Use freeze to immediately halt all new reservations against a budget without deleting or modifying it. This is useful during incident investigations, compliance holds, or when a runaway agent is detected.

::: tip Freeze from the dashboard
Freeze and unfreeze are also one-click actions on the Budgets page in the [Cycles Admin Dashboard](/quickstart/deploying-the-cycles-dashboard) — typically faster during an active incident than crafting a curl. The dashboard also exposes an **Emergency Freeze (tenant-wide)** action that sequentially freezes every ACTIVE budget for a tenant with a confirm + blast-radius summary.
:::

### Freeze

```bash
curl -s -X POST "http://localhost:7979/v1/admin/budgets/freeze?scope=tenant:acme&unit=USD_MICROCENTS" \
  -H "Content-Type: application/json" \
  -H "X-Admin-API-Key: $ADMIN_KEY" \
  -d '{"reason": "Investigating runaway agent in support workflow"}' | jq .
```

All new live reservations (and events) against the frozen scope fail with `409` and `error: BUDGET_FROZEN`. Only `/v1/decide` and dry-run reserve surface the condition as a `200` response with `decision: DENY` and `reason_code: BUDGET_FROZEN`. Fund operations also return `409` while frozen. The freeze gate applies to *new* reservations — the spec does not block committing or releasing reservations that were already active when the freeze landed. Emits a `budget.frozen` webhook event.

### Unfreeze

```bash
curl -s -X POST "http://localhost:7979/v1/admin/budgets/unfreeze?scope=tenant:acme&unit=USD_MICROCENTS" \
  -H "Content-Type: application/json" \
  -H "X-Admin-API-Key: $ADMIN_KEY" \
  -d '{"reason": "Investigation complete — root cause was prompt loop, now fixed"}' | jq .
```

Transitions FROZEN → ACTIVE. Reservations resume immediately. Emits a `budget.unfrozen` webhook event. Returns 409 if the budget is already active or closed.

::: tip When to freeze vs. adjust budget
**Freeze** when you need to stop all activity immediately while investigating. The budget allocation and history are preserved. **Adjust the budget** (PATCH or fund) when you want to change how much is available. Freeze is an operational control; budget adjustment is a financial control.
:::

## Adjusting budget allocation

### Increasing a budget

Increase the `allocated` value to give a scope more room. This takes effect immediately — the next reservation check will use the new value.

### Decreasing a budget

Decrease the `allocated` value. If the new value is less than `spent + reserved`, existing reservations are not affected, but new reservations may be denied.

### Resizing a budget (RESET)

To **change the allocated ceiling** while preserving consumption history (`spent`, `reserved`, `debt`), use `RESET`:

```bash
curl -X POST "http://localhost:7979/v1/admin/budgets/fund?scope=tenant:acme&unit=USD_MICROCENTS" \
  -H "Content-Type: application/json" \
  -H "X-Cycles-API-Key: $CYCLES_API_KEY" \
  -d '{
    "operation": "RESET",
    "amount": { "amount": 1500000, "unit": "USD_MICROCENTS" },
    "idempotency_key": "resize-acme-q2",
    "reason": "Plan upgrade — Pro tier"
  }'
```

`RESET` sets `allocated = amount` and recalculates `remaining = amount - reserved - spent - debt`. Spent stays where it was. Use this for **plan changes, policy tightening, ceiling adjustments** — the typical "this customer moved to a bigger plan" or "we're tightening this team's limit" scenarios.

Release active reservations first if you're shrinking the ceiling below `spent + reserved` and want a clean cutover.

::: warning RESET is for resizing, not period boundaries
For a fresh billing period (clearing consumption), use `RESET_SPENT` below. A same-amount `RESET` on an exhausted budget is a no-op — `spent` stays at its old value, so `remaining` stays at 0.
:::

### Starting a new billing period (RESET_SPENT)

To **start a new billing period** — clearing accumulated spend so the scope can transact fresh — use `RESET_SPENT`:

```bash
curl -X POST "http://localhost:7979/v1/admin/budgets/fund?scope=tenant:acme&unit=USD_MICROCENTS" \
  -H "Content-Type: application/json" \
  -H "X-Cycles-API-Key: $CYCLES_API_KEY" \
  -d '{
    "operation": "RESET_SPENT",
    "amount": { "amount": 1000000, "unit": "USD_MICROCENTS" },
    "idempotency_key": "reset-march-2026",
    "reason": "Monthly billing period reset — March 2026"
  }'
```

`RESET_SPENT` sets `allocated = amount`, **clears spent to 0**, and preserves `reserved` (active reservations straddle the period boundary and will land in the new period's spent when they commit) and `debt` (period boundaries don't forgive debt — use `REPAY_DEBT` to clear it explicitly).

#### Optional `spent` override

For migrations, prorated signups, and corrections, supply an explicit `spent`:

```bash
# Migration: import an existing customer with their consumption already reflected
curl -X POST "http://localhost:7979/v1/admin/budgets/fund?scope=tenant:acme&unit=USD_MICROCENTS" \
  -H "Content-Type: application/json" \
  -H "X-Cycles-API-Key: $CYCLES_API_KEY" \
  -d '{
    "operation": "RESET_SPENT",
    "amount": { "amount": 1000000, "unit": "USD_MICROCENTS" },
    "spent":  { "amount": 400000,  "unit": "USD_MICROCENTS" },
    "idempotency_key": "migrate-acme-from-billing-vendor",
    "reason": "Imported from billing vendor — current period 40% consumed"
  }'
```

The `spent` field is honoured **only** for `RESET_SPENT`. Common patterns:

| Scenario | `spent` value | Notes |
|---|---|---|
| Routine billing-period rollover | omit (defaults to 0) | The 90% case. |
| Migration from another billing system | actual current consumption | Customer arrives with history; reflect it. |
| Prorated mid-period signup | `allocated × (days_remaining / period_days)` | New customer joins partway through. |
| Credit-back / compensation | reduced consumption value | Refund a portion after a service incident. |
| State correction | corrected value | Fix a miscounted `spent` from an upstream bug. |

Constraints:
- `spent` must be `>= 0`.
- The unit must match the budget's unit.
- The audit log records whether `spent` was explicitly supplied or defaulted to 0, distinguishing routine rollovers from operator-initiated consumption adjustments for compliance review.

##### What `remaining` looks like after RESET_SPENT

In the common case — no outstanding `debt`, no active `reserved`, `spent` omitted — `RESET_SPENT(amount=X)` produces `allocated = X` and `remaining = X`. A clean fresh period.

`remaining` can start the new period **negative** in two specific situations:

- **Carryover.** Preserved `debt` (and/or active `reserved`) exceed the new `allocated`. Periods don't forgive debt by design — use `REPAY_DEBT` if you want to clear it. Example: old period ended with `debt=1200`; `RESET_SPENT(amount=1000)` yields `remaining = 1000 - 0 - 0 - 1200 = -200`.
- **Explicit override.** You pass `spent` larger than `allocated - reserved - debt`. Example: migrating a customer already partway through a period with `RESET_SPENT(amount=1000, spent=1200)` yields `remaining = -200`.

Both cases are valid ledger states, not errors. The response returns the negative value, and the invariant `remaining = allocated - spent - reserved - debt` holds.

##### Recovery pattern: truly starting fresh when the prior period ended in debt

`RESET_SPENT` preserves `debt` by design — periods don't silently forgive obligations. If you want a customer to start the new period with a clean slate (no carryover debt, full ceiling available), pair `REPAY_DEBT` with `RESET_SPENT`:

```bash
# Prior period ended with: allocated=1000, spent=1000, debt=200, remaining=0

# Step 1: Clear the outstanding debt (e.g., after the customer paid their invoice).
curl -X POST "https://admin.example.com/v1/admin/budgets/fund?tenant_id=acme&scope=tenant:acme&unit=USD_MICROCENTS" \
  -H "Content-Type: application/json" \
  -H "X-Admin-API-Key: $ADMIN_KEY" \
  -d '{
    "operation": "REPAY_DEBT",
    "amount": { "amount": 200, "unit": "USD_MICROCENTS" },
    "idempotency_key": "repay-acme-before-rollover",
    "reason": "invoice paid"
  }'
# State now: allocated=1000, spent=1000, debt=0, remaining=0

# Step 2: Start the new billing period with a fresh ceiling.
curl -X POST "https://admin.example.com/v1/admin/budgets/fund?tenant_id=acme&scope=tenant:acme&unit=USD_MICROCENTS" \
  -H "Content-Type: application/json" \
  -H "X-Admin-API-Key: $ADMIN_KEY" \
  -d '{
    "operation": "RESET_SPENT",
    "amount": { "amount": 1000, "unit": "USD_MICROCENTS" },
    "idempotency_key": "rollover-acme-after-repay",
    "reason": "monthly rollover"
  }'
# State now: allocated=1000, spent=0, debt=0, remaining=1000
```

Order matters: if you skip step 1, the carryover `debt` will make the new period's `remaining` start negative. That's the correct behaviour for "customer still owes from last period", but it's not what you want if the debt has already been settled externally. Run `REPAY_DEBT` first whenever you want the next period to begin at the full ceiling.

#### Event emission

`RESET_SPENT` emits `budget.reset_spent` (distinct from `budget.reset`) so dashboards and webhook handlers can route period boundaries separately from resize events. The payload's `spent_override_provided` boolean flags which mode was used.

::: info Why budgets cannot be deleted
The admin API has no delete endpoint for budgets. A budget ledger is the permanent audit record for all spend within a scope — committed reservations reference it, and historical balances are derived from it. Deleting a ledger would create orphaned transactions and break spend reporting.

To decommission a budget: `RESET` its allocation to zero (or `DEBIT` the remaining balance). No new reservations will be approved against a zero-balance scope. The ledger stays in the system for historical queries but has no operational cost.
:::

### Funding after overdraft

If a scope has accumulated debt through `ALLOW_WITH_OVERDRAFT` commits, repay it:

```bash
curl -X POST "http://localhost:7979/v1/admin/budgets/fund?scope=tenant:acme&unit=USD_MICROCENTS" \
  -H "Content-Type: application/json" \
  -H "X-Cycles-API-Key: $CYCLES_API_KEY" \
  -d '{
    "operation": "REPAY_DEBT",
    "amount": { "amount": 500000, "unit": "USD_MICROCENTS" },
    "idempotency_key": "repay-001"
  }'
```

While `debt > 0` and no `overdraft_limit` is configured, new reservations against that scope are blocked with `DEBT_OUTSTANDING`. When an `overdraft_limit > 0` is set, debt within the limit does not block new reservations.

## Monitoring budgets

Use the `GET /v1/balances` endpoint to check budget state:

```bash
curl -s "http://localhost:7878/v1/balances?tenant=acme" \
  -H "X-Cycles-API-Key: your-api-key"
```

This returns the current state for all scopes matching the filter:

```json
{
  "balances": [
    {
      "scope": "tenant:acme",
      "scope_path": "tenant:acme",
      "remaining": { "amount": 750000, "unit": "USD_MICROCENTS" },
      "allocated": { "amount": 1000000, "unit": "USD_MICROCENTS" },
      "spent": { "amount": 200000, "unit": "USD_MICROCENTS" },
      "reserved": { "amount": 50000, "unit": "USD_MICROCENTS" },
      "debt": { "amount": 0, "unit": "USD_MICROCENTS" },
      "overdraft_limit": { "amount": 0, "unit": "USD_MICROCENTS" },
      "is_over_limit": false
    }
  ]
}
```

Key fields to monitor:

- **remaining** — how much room is left
- **reserved** — how much is currently held by active reservations
- **debt** — any overdraft accumulation
- **is_over_limit** — whether the scope is blocked

## Managing policies

Policies define stored caps, rate limits, and behavioral overrides matched by scope pattern.

::: warning v0 limitation
In v0, the protocol server (port 7878) does not evaluate admin-defined policies when processing reservations, commits, or events. Enforcement is planned for a future version. Today, the only policy-like behavior enforced at runtime is the `overage_policy` resolved from the request or the tenant's `default_commit_overage_policy`; budget ledgers and tenant defaults supply the rest of runtime governance. Use admin policies to model intended governance state and prepare for future enforcement.
:::

Create a policy record for matching scopes:

```bash
curl -s -X POST http://localhost:7979/v1/admin/policies \
  -H "Content-Type: application/json" \
  -H "X-Cycles-API-Key: $CYCLES_API_KEY" \
  -d '{
    "name": "production-limits",
    "scope_pattern": "tenant:acme-corp/workspace:production/*",
    "priority": 10,
    "commit_overage_policy": "REJECT",
    "rate_limits": {
      "max_reservations_per_minute": 100,
      "max_commits_per_minute": 100
    },
    "caps": {
      "max_tokens": 4096
    }
  }' | jq .
```

### Updating a policy

Use `PATCH /v1/admin/policies/{policy_id}` to modify mutable fields without re-creating the policy:

```bash
curl -s -X PATCH "http://localhost:7979/v1/admin/policies/$POLICY_ID" \
  -H "Content-Type: application/json" \
  -H "X-Cycles-API-Key: $CYCLES_API_KEY" \
  -d '{
    "priority": 20,
    "caps": { "max_tokens": 8192 },
    "rate_limits": {
      "max_reservations_per_minute": 200,
      "max_commits_per_minute": 200
    }
  }' | jq .
```

You can update: `name`, `description`, `priority`, `caps`, `commit_overage_policy`, `reservation_ttl_override`, `rate_limits`, `effective_from`, `effective_until`, and `status`. Fields not included in the request are left unchanged. Set `status` to `DISABLED` to deactivate a policy without deleting it.

## Summary

Budget allocation in Cycles:

- Is set per scope independently
- Is enforced atomically across the full scope hierarchy for each reservation
- Can be adjusted at any time with immediate effect
- Requires explicit allocation at every scope level you want to control
- Supports flat, hierarchical, per-run, and per-agent patterns (scopes derive from the six standard Subject fields; `dimensions` is reporting-only)

## Next steps

- [Tenants, Scopes, and Budgets](/how-to/understanding-tenants-scopes-and-budgets-in-cycles) — how tenants, scopes, and budgets work together as a unified model
- [Tenant Creation and Management](/how-to/tenant-creation-and-management-in-cycles) — create and configure tenants before allocating budgets
- [Querying Balances](/protocol/querying-balances-in-cycles-understanding-budget-state) — detailed balance query guide
- [Debt and Overdraft](/protocol/debt-overdraft-and-the-over-limit-model-in-cycles) — how overdraft affects allocation
- [How Scope Derivation Works](/protocol/how-scope-derivation-works-in-cycles) — how scopes are derived from Subjects
