---
title: "Querying Balances in Cycles: Understanding Budget State"
description: "Query current budget state in Cycles to see allocations, reservations, spend, and remaining balance for any scope. Includes filtering and response format."
---

# Querying Balances in Cycles: Understanding Budget State

Budget enforcement is only useful if the system can also answer: **how much is left?**

That is what the balances endpoint provides.

`GET /v1/balances` returns the current budget state for one or more scopes — how much is allocated, how much is reserved, how much has been spent, and how much remains.

## What a balance represents

A balance is a snapshot of a single scope's budget state in a specific unit.

Each balance includes:

### remaining (SignedAmount)

The budget available for new reservations.

This is the most important field for operational decisions. It tells you how much room is left.

Remaining can be negative when a scope is in overdraft (debt exceeds available budget).

Formula: `remaining = allocated - spent - reserved - debt`

### reserved (Amount)

The amount currently locked by active reservations.

This budget is held but not yet spent. It will either become spent (via commit) or return to remaining (via release or expiration).

### spent (Amount)

The cumulative amount successfully committed through reservations or events.

This is actual, accounted usage.

### allocated (Amount)

The total budget cap for this scope, if a fixed allocation exists.

When present, allocated represents the maximum budget the scope can consume. When absent, the remaining amount is authoritative and cannot be derived from other fields.

### debt (Amount)

Overdraft consumption that occurred when insufficient budget was available.

Debt is created only when the `ALLOW_WITH_OVERDRAFT` overage policy is used and budget is insufficient at commit time.

When debt is present and no overdraft limit is configured, new reservations are blocked until it is repaid. When an overdraft limit is set, debt within the limit does not block new reservations.

### overdraft_limit (Amount)

The maximum debt this scope is allowed to carry.

If absent or zero, no overdraft is permitted.

### is_over_limit (Boolean)

Whether the scope's debt exceeds its overdraft limit.

When true, all new reservations against this scope are blocked.

## The ledger invariant

When allocated, spent, reserved, and debt are all present, the following invariant holds:

```
remaining = allocated - spent - reserved - debt
```

The server guarantees this relationship. Clients can rely on it for consistency checking.

If allocated is absent, remaining is authoritative — the client must not try to derive it.

## Querying balances

### Request

```
GET /v1/balances?tenant=acme&app=support-bot
```

At least one subject filter must be provided:

- `tenant`
- `workspace`
- `app`
- `workflow`
- `agent`
- `toolset`

Additional parameters:

- `include_children` — if true, include child scopes in the response (default: false; may be ignored by v0 implementations)
- `limit` — maximum results per page (1–200, default: 50)
- `cursor` — opaque cursor from a previous response for pagination

Queries are always scoped to the effective tenant. The server rejects requests that attempt to query another tenant's balances with `403 FORBIDDEN`.

### Response

```json
{
  "balances": [
    {
      "scope": "tenant:acme",
      "scope_path": "tenant:acme",
      "remaining": { "unit": "USD_MICROCENTS", "amount": 85000000 },
      "reserved": { "unit": "USD_MICROCENTS", "amount": 5000000 },
      "spent": { "unit": "USD_MICROCENTS", "amount": 10000000 },
      "allocated": { "unit": "USD_MICROCENTS", "amount": 100000000 }
    },
    {
      "scope": "app:support-bot",
      "scope_path": "tenant:acme/app:support-bot",
      "remaining": { "unit": "USD_MICROCENTS", "amount": 22000000 },
      "reserved": { "unit": "USD_MICROCENTS", "amount": 3000000 },
      "spent": { "unit": "USD_MICROCENTS", "amount": 5000000 },
      "allocated": { "unit": "USD_MICROCENTS", "amount": 30000000 }
    }
  ],
  "has_more": false
}
```

### Pagination

Responses are paginated:

- `limit` — maximum results per page (1–200, default 50)
- `cursor` — opaque cursor from a previous response
- `has_more` — whether more results exist
- `next_cursor` — cursor for the next page

## Use cases

### Operator dashboards

Balances provide the data needed for budget dashboards:

- which tenants are near their limits
- which workflows are consuming the most
- where reserved amounts are high (indicating active work)
- which scopes have debt

### Automated degradation

Systems can query balances to make proactive decisions:

- if remaining is below a threshold, switch to a smaller model
- if reserved is a large fraction of remaining, reduce concurrency
- if debt is present, pause new work

### Budget monitoring and alerting

Balances enable alerting rules:

- warn when remaining drops below 20% of allocated
- alert when debt exceeds 80% of overdraft_limit
- alert when is_over_limit becomes true

### Capacity planning

Historical balance queries (collected over time) reveal consumption patterns:

- average daily spend by tenant
- peak reserved amounts by workflow
- debt frequency by scope

## Understanding scope and scope_path

Each balance has two identifiers:

- **scope** — the individual scope identifier (e.g., `tenant:acme`, `app:support-bot`)
- **scope_path** — the full hierarchical path (e.g., `tenant:acme/app:support-bot`)

The scope_path places the balance in the hierarchy. The scope identifies the individual level.

## Unit consistency

All amount fields within a single balance share the same unit.

A scope may have balances in multiple units (e.g., both USD_MICROCENTS and TOKENS), but each balance object has a single unit.

## Balances are eventually consistent

Balance queries reflect the current server state, which includes all committed and reserved amounts.

However, under high concurrency, balances may be slightly behind the most recent operations. They are suitable for dashboards, monitoring, and planning — not for real-time budget decisions.

For real-time budget decisions, use reservations (which are atomic and concurrency-safe).

## Reading a balance — a practical example

Consider this balance:

```json
{
  "scope": "workflow:refund-assistant",
  "scope_path": "tenant:acme/app:support-bot/workflow:refund-assistant",
  "remaining": { "unit": "USD_MICROCENTS", "amount": 12000000 },
  "reserved": { "unit": "USD_MICROCENTS", "amount": 3000000 },
  "spent": { "unit": "USD_MICROCENTS", "amount": 15000000 },
  "allocated": { "unit": "USD_MICROCENTS", "amount": 30000000 }
}
```

This tells us:

- The workflow was allocated $0.30 (`30,000,000 / 10^8`)
- It has spent $0.15 so far
- $0.03 is currently reserved by active work
- $0.12 remains available for new reservations

Verify the invariant: `30,000,000 - 15,000,000 - 3,000,000 - 0 = 12,000,000` — correct.

## Negative remaining

When a scope has debt, remaining can be negative:

```json
{
  "remaining": { "unit": "USD_MICROCENTS", "amount": -2000000 },
  "debt": { "unit": "USD_MICROCENTS", "amount": 5000000 },
  "overdraft_limit": { "unit": "USD_MICROCENTS", "amount": 10000000 },
  "is_over_limit": false
}
```

This scope is in overdraft but not over-limit. It has $0.05 in debt within a $0.10 overdraft limit. Because the overdraft limit is configured, new reservations are still allowed as long as remaining budget covers the estimate.

## Summary

The balances API gives operators and systems visibility into budget state across all scopes:

- **remaining** — how much room is left
- **reserved** — how much is held by active work
- **spent** — how much has been consumed
- **allocated** — the total budget cap
- **debt** and **overdraft_limit** — overdraft state
- **is_over_limit** — whether the scope is blocked

This data powers dashboards, monitoring, alerting, automated degradation, and capacity planning.

For real-time budget enforcement, use reservations. For understanding budget state, use balances.

## Next steps

To explore the Cycles stack:

- Read the [Cycles Protocol](https://github.com/runcycles/cycles-protocol)
- Run the [Cycles Server](https://github.com/runcycles/cycles-server)
- Manage budgets with [Cycles Admin](https://github.com/runcycles/cycles-server-admin)
- Integrate with Python using the [Python Client](/quickstart/getting-started-with-the-python-client)
- Integrate with TypeScript using the [TypeScript Client](/quickstart/getting-started-with-the-typescript-client)
- Integrate with Spring Boot or Spring AI using the [Spring Boot starter](https://github.com/runcycles/cycles-spring-boot-starter) or the [Spring AI starter](https://github.com/runcycles/cycles-spring-ai-starter)
