---
title: "Rolling Over Billing Periods with RESET_SPENT"
description: "Use the RESET_SPENT funding operation in Cycles to start a new billing period without disturbing reservations or debt — the difference between RESET_SPENT and RESET."
---

# Rolling Over Billing Periods with RESET_SPENT

Budget ledgers in Cycles track five counters: `allocated`, `spent`, `reserved`, `debt`, and `remaining` (`remaining = allocated − spent − reserved − debt`). At the end of a billing period — monthly, weekly, or whatever your plan defines — you typically want to restate the *allocation* and clear the *spend*, while preserving in-flight reservations and any debt that should persist into the next period.

That is exactly what `RESET_SPENT` does. It was added in `cycles-server-admin` v0.1.25.18 as a narrower alternative to the existing `RESET` operation, and is available as a funding operation on `POST /v1/admin/budgets/fund`.

## RESET vs RESET_SPENT

The two operations are easy to confuse. Here is how they differ:

| Operation | Sets `allocated` | Clears `spent` | Preserves `reserved` | Preserves `debt` |
|-----------|------------------|----------------|----------------------|------------------|
| `RESET` | **Yes** — to the `amount` in the request | No — preserved | Yes | Yes |
| `RESET_SPENT` | **Yes** — to the `amount` in the request (**required**) | **Yes** — to zero, or to the optional `spent` value | Yes | Yes |

- **`RESET`** changes the size of the budget. The allocation counter is rewritten to whatever you passed in. `spent` carries over. Use this when a customer upgrades or downgrades mid-period.
- **`RESET_SPENT`** starts a new billing period. `allocated` is set to the (required) `amount` in the request — pass the current allocation if the ceiling is not changing — and the `spent` counter is zeroed out (or set to the optional `spent` value, e.g., for a prorated correction).

The protocol was missing a way to clear `spent` at a period boundary: `RESET` resizes the allocation but preserves spend, and issuing corrective `DEBIT`s was error-prone. `RESET_SPENT` closes that gap with a single operation that sets the new period's allocation and resets the spend.

## Basic monthly rollover

The most common case — a cron job that runs at the start of each billing period and zeroes out spend while restating the allocation. `amount` is required and becomes the new `allocated` — pass the current allocation to keep the ceiling unchanged. When authenticating with the admin key, `tenant_id` is also required:

```bash
curl -X POST "http://localhost:7979/v1/admin/budgets/fund?tenant_id=acme-corp&scope=tenant:acme-corp&unit=USD_MICROCENTS" \
  -H "X-Admin-API-Key: $ADMIN_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "operation": "RESET_SPENT",
    "amount": { "amount": 100000000, "unit": "USD_MICROCENTS" },
    "idempotency_key": "rollover-acme-2026-05",
    "reason": "Monthly rollover for billing period 2026-05"
  }'
```

After this call:

- `allocated` — set to the `amount` in the request (`100000000` here).
- `spent` — zero.
- `reserved` — unchanged. Any reservations that were live at the moment of the call continue to hold their budget, and commit normally.
- `debt` — unchanged.
- `remaining` — recomputed as `allocated - spent - reserved - debt`.

The idempotency key should encode the tenant and the period being started. If the cron retries, the replay returns the original response and the counters do not move twice.

## Prorated corrections

If a customer upgrades mid-period and you need to credit back some of the spend they incurred on the old plan, you can pass an explicit `spent` value instead of clearing to zero:

```bash
curl -X POST "http://localhost:7979/v1/admin/budgets/fund?tenant_id=acme-corp&scope=tenant:acme-corp&unit=USD_MICROCENTS" \
  -H "X-Admin-API-Key: $ADMIN_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "operation": "RESET_SPENT",
    "amount": { "amount": 100000000, "unit": "USD_MICROCENTS" },
    "idempotency_key": "prorate-acme-2026-04-17",
    "spent": { "amount": 3200000, "unit": "USD_MICROCENTS" },
    "reason": "Prorated spend after mid-period plan change"
  }'
```

This sets `spent` to exactly `3200000` microcents rather than zero. Use this pattern for:

- Plan changes where the carry-over spend is recalculated
- Refunds issued as a spend reduction rather than an allocation increase
- Migration from a legacy billing system where opening balances are non-zero

## Why reserved and debt are preserved

This is deliberate and matches how production systems actually roll over:

- **Reserved budget represents in-flight work.** An agent that started a reservation at 23:59:58 is still executing at 00:00:02. Zeroing `reserved` would cause its commit to double-count (the commit would subtract from the fresh period's budget while the reservation's hold was already released). Preserving `reserved` lets the existing reservation commit cleanly.
- **Debt represents money you've already let the tenant spend past the cap.** If the old period ended in overdraft, that debt is a real liability. It should either roll forward (the default) or be repaid explicitly with `REPAY_DEBT`. Silently clearing debt at rollover would erase the accounting.

If you want to explicitly zero out reservations or debt, use the targeted operations (`POST /v1/reservations/{id}/release` or a `REPAY_DEBT` funding call) alongside the `RESET_SPENT` call.

## Events emitted

A successful `RESET_SPENT` emits `budget.reset_spent` (v0.1.25.18+). The payload carries `previous_state` and `new_state` snapshots — including the pre-rollover `spent` — plus a `spent_override_provided` flag that distinguishes routine rollovers (`false`, spent defaulted to 0) from explicit adjustments (`true`, the request supplied a `spent` value). Useful for downstream billing systems that want to archive the period's total on the event stream rather than polling balances.

```json
{
  "event_type": "budget.reset_spent",
  "data": {
    "ledger_id": "led_acme_default",
    "scope": "tenant:acme-corp",
    "unit": "USD_MICROCENTS",
    "operation": "RESET_SPENT",
    "previous_state": {
      "allocated": 100000000,
      "spent": 87340000,
      "reserved": 1200000,
      "debt": 0,
      "remaining": 11460000
    },
    "new_state": {
      "allocated": 100000000,
      "spent": 0,
      "reserved": 1200000,
      "debt": 0,
      "remaining": 98800000
    },
    "spent_override_provided": false,
    "reason": "Monthly rollover for billing period 2026-05"
  }
}
```

See the [Webhook Event Delivery Protocol](/protocol/webhook-event-delivery-protocol) for the full event envelope.

## Scheduling the rollover

Budget ledgers carry declarative period metadata — `rollover_policy` (`NONE`, `CARRY_FORWARD`, `CAP_AT_ALLOCATED`) plus `period_start`/`period_end` — that describes how unused budget should be handled at period boundaries. But the server does not execute those boundaries on a schedule: there is no built-in cron, and `RESET_SPENT` is the explicit operation you call to effect the rollover. You trigger it however fits your operational model:

- **External cron.** A scheduled job that reads a list of active tenants from your own tenancy database and calls `RESET_SPENT` for each on the first of the month.
- **Stripe webhook-driven.** A handler for Stripe's `invoice.finalized` event that rolls over the corresponding tenant as part of invoice reconciliation.
- **Event-driven.** Subscribe to `budget.threshold_crossed` at 100% utilization and roll over automatically if your plan logic calls for it.

In every case, make the idempotency key include the target period, so a retry or duplicate trigger does not double-rollover.

## Rolling over many budgets at once (v0.1.25.29)

When a tenant has many budgets (workspace, app, workflow ladders), rolling each one over with individual `POST /v1/admin/budgets/fund` calls is fine but tedious — and leaves a tiny drift window between calls. Budget bulk-action lets you do the whole tenant atomically in one request.

::: warning `filter.tenant_id` is REQUIRED — one bulk call per tenant
Cross-tenant budget bulk is explicitly out of scope. The server returns `400 INVALID_REQUEST` if `filter.tenant_id` is missing or blank. **If you're rolling over a fleet, loop once per tenant** — do not attempt a single bulk call across multiple tenants. This is enforced to cap blast radius: a bad filter wipes at most one tenant's spend, not your whole fleet.
:::

```bash
curl -X POST http://localhost:7979/v1/admin/budgets/bulk-action \
  -H "X-Admin-API-Key: $ADMIN_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "filter": { "tenant_id": "acme-corp", "unit": "USD_MICROCENTS" },
    "action": "RESET_SPENT",
    "amount": { "amount": 1000000, "unit": "USD_MICROCENTS" },
    "expected_count": 8,
    "idempotency_key": "period-rollover-2026-05-01-acme"
  }'
```

### Fleet-scale rollover pattern

```bash
# Per-tenant loop — substitute your tenant source of truth
for TENANT in $(cat tenants-to-roll.txt); do
  COUNT=$(curl -s "http://localhost:7979/v1/admin/budgets?tenant_id=$TENANT&unit=USD_MICROCENTS" \
    -H "X-Admin-API-Key: $ADMIN_KEY" | jq '.ledgers | length')

  curl -X POST http://localhost:7979/v1/admin/budgets/bulk-action \
    -H "X-Admin-API-Key: $ADMIN_KEY" \
    -H "Content-Type: application/json" \
    -d "{
      \"filter\": { \"tenant_id\": \"$TENANT\", \"unit\": \"USD_MICROCENTS\" },
      \"action\": \"RESET_SPENT\",
      \"amount\": { \"amount\": 1000000, \"unit\": \"USD_MICROCENTS\" },
      \"expected_count\": $COUNT,
      \"idempotency_key\": \"period-rollover-2026-05-01-$TENANT\"
    }"
done
```

The idempotency key **must** encode both the period and the tenant (`period-rollover-{date}-{tenant_id}`). A static key like `period-rollover-acme` replays the first month's response on month two — the bulk-action returns `200 OK` but mutates nothing. Including the date makes the key unique per billing boundary; including the tenant makes it unique per iteration.

### `amount` vs. `spent`

- **`amount`** (REQUIRED) is the new `allocated` ceiling for every matched budget after the reset. One value applies to all rows.
- **`spent`** (optional, `RESET_SPENT`-only) overrides the default-zero `spent` value after the reset. Use it for prorated signups mid-period or migrations that import an existing consumption number.

If each budget needs a different `allocated`, `amount` is too coarse — fall back to per-budget `POST /v1/admin/budgets/fund` calls.

### Prerequisites and per-row outcomes

- **Budgets must be ACTIVE.** `RESET_SPENT` against a `FROZEN` or `CLOSED` budget lands in the `failed[]` bucket with `error_code=INVALID_TRANSITION`. If you intentionally froze some budgets during a dispute, either unfreeze them first or add `status=ACTIVE` to the filter to skip them: `"filter": { "tenant_id": "acme-corp", "unit": "USD_MICROCENTS", "status": "ACTIVE" }`.
- **Other per-row outcomes:** `BUDGET_EXCEEDED` (only matters for DEBIT, not RESET_SPENT), `NOT_FOUND` (ledger deleted mid-operation), `PERMISSION_DENIED`, `INTERNAL_ERROR`.
- The 500-row cap and 15-minute idempotency window apply the same as for tenants/webhooks bulk-action.
- Emits one `budget.reset_spent` event per matched budget.
- Emits one audit row for the whole invocation with per-budget `succeeded_ids` / `failed_rows` — triageable from the audit log alone (v0.1.25.30+).

See [Using bulk actions for tenants, webhooks, and budgets](/how-to/using-bulk-actions-for-tenants-and-webhooks#budget-bulk-action) for the full envelope, safety gates, and per-row error codes.

## Common mistakes

- **Using `RESET` when you meant `RESET_SPENT`.** `RESET` rewrites `allocated` — it does not clear spend. If you call `RESET` with the same `amount` as the previous period, you've changed nothing. Use `RESET_SPENT` to zero out spend.
- **Zeroing out before in-flight reservations commit.** `RESET_SPENT` preserves reservations by design, so this is handled — but if you write custom tooling that manually sets `spent` to zero, remember to leave `reserved` alone.
- **Forgetting to roll over debt deliberately.** If your plan says debt should not carry between periods, issue an explicit `REPAY_DEBT` before the rollover (with the corresponding accounting entry in your billing system). `RESET_SPENT` on its own will leave debt untouched.
- **Not generating a unique idempotency key per period.** Reusing `rollover-acme` month after month means the second month is a replay of the first, returning the first month's response and moving nothing.

## Next steps

- [Budget Allocation and Management](/how-to/budget-allocation-and-management-in-cycles) — the full funding operation catalog
- [Admin API reference](/admin-api/) — OpenAPI definitions for `/v1/admin/budgets/fund`
- [Webhook Event Delivery Protocol](/protocol/webhook-event-delivery-protocol) — `budget.reset_spent` event details
- [Multi-Tenant SaaS with Cycles](/how-to/multi-tenant-saas-with-cycles) — where rollover fits in a SaaS billing cycle
