---
title: "Using Bulk Actions for Tenants, Webhooks, and Budgets"
description: "Suspend, reactivate, pause, resume, delete, or fund fleets of tenants, webhooks, and budgets against the Cycles admin API, with idempotency, 500-row safety gates, and per-row outcome buckets."
---

# Using Bulk Actions for Tenants, Webhooks, and Budgets

Bulk actions let a single admin call suspend hundreds of tenants, pause a fleet of noisy webhooks, reactivate a batch after an incident is resolved, or roll every budget to a new billing period. They ship in `cycles-server-admin` v0.1.25.26 (tenants + webhooks) and v0.1.25.29 (budgets), against governance spec v0.1.25.21 and .26 respectively, and surface in the [Cycles Admin Dashboard](/quickstart/deploying-the-cycles-dashboard) as filter-then-bulk lanes on the Tenants, Webhooks, and Budgets pages.

The endpoints:

| Endpoint | Supported actions | Since |
|----------|-------------------|-------|
| `POST /v1/admin/tenants/bulk-action` | `SUSPEND`, `REACTIVATE`, `CLOSE` | v0.1.25.26 |
| `POST /v1/admin/webhooks/bulk-action` | `PAUSE`, `RESUME`, `DELETE` | v0.1.25.26 |
| `POST /v1/admin/budgets/bulk-action` | `CREDIT`, `DEBIT`, `RESET`, `REPAY_DEBT`, `RESET_SPENT` | v0.1.25.29 |

All three accept the same envelope and return the same response shape. Budget bulk-action has two extra requirements covered in the [Budget bulk-action](#budget-bulk-action) section below.

## Request shape

Bulk actions operate on a filter expression, not an explicit ID list. You describe the target population with the same filters the list endpoints accept, then the server matches and applies the action atomically per row.

```bash
curl -X POST http://localhost:7979/v1/admin/tenants/bulk-action \
  -H "X-Admin-API-Key: $ADMIN_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "action": "SUSPEND",
    "idempotency_key": "ops-2026-04-17-freeze-abusers",
    "expected_count": 42,
    "filter": {
      "status": "ACTIVE",
      "search": "trial-"
    }
  }'
```

### Required fields

- **`action`** — one of the action values supported by the endpoint (see table above). Unknown values return `400 INVALID_REQUEST`.
- **`idempotency_key`** — stable, unique string. Replays within 15 minutes return the original response without re-executing. Required on every bulk call — there is no "best-effort" mode.
- **`filter`** — an object with the same filter keys the corresponding list endpoint supports. Tenant filters: `status`, `parent_tenant_id`, `observe_mode`, `search`. Webhook filters: `tenant_id`, `status`, `event_type`, `search`. An empty filter is rejected — the server refuses to act on "every tenant" or "every webhook" without at least one constraint. Unknown filter keys return `400 INVALID_REQUEST` (strict `additionalProperties: false`).

`observe_mode` is a forward-compatible tenant filter for the v0.1.26 action-governance preview. v0.1.25.x reference admin servers accept it in the filter shape but only servers that implement observe mode narrow tenant bulk actions by that value.

### Optional fields

- **`expected_count`** — safety gate. If the server resolves the filter to a different number of rows, the call fails with `409 COUNT_MISMATCH` and **no rows are touched**. Use this to catch drift between when you previewed the list and when you executed the bulk action.

## Response envelope

```json
{
  "action": "SUSPEND",
  "idempotency_key": "ops-2026-04-17-freeze-abusers",
  "total_matched": 42,
  "succeeded": [
    { "id": "tenant-abc" },
    { "id": "tenant-def" }
  ],
  "failed": [
    {
      "id": "tenant-ghi",
      "error_code": "INVALID_TRANSITION",
      "message": "cannot SUSPEND from CLOSED"
    }
  ],
  "skipped": [
    {
      "id": "tenant-jkl",
      "reason": "ALREADY_IN_TARGET_STATE"
    }
  ]
}
```

Every row ends in exactly one of the three buckets:

- **`succeeded`** — the row transitioned to the target state. Rows carry `id` only.
- **`failed`** — the row matched the filter but the action could not apply (typically `INVALID_TRANSITION` — e.g., resuming a `DISABLED` webhook, suspending a `CLOSED` tenant). Rows carry `error_code` and `message`.
- **`skipped`** — the row matched the filter but was already in the target state (e.g., a tenant already suspended when `action=SUSPEND`, a webhook already paused). Rows carry `reason` (`ALREADY_IN_TARGET_STATE` or `ALREADY_DELETED`). Not an error — the bulk action is idempotent per row.

`total_matched` equals `succeeded.length + failed.length + skipped.length`. If you supplied `expected_count`, they are guaranteed equal — otherwise the call returned `409 COUNT_MISMATCH` before any row executed.

## Safety gates

### 500-row ceiling — `LIMIT_EXCEEDED`

Bulk actions cap at **500 matched rows per call**. If your filter resolves to more than 500 rows, the server returns HTTP 400 with `error: LIMIT_EXCEEDED`:

```json
{
  "error": "LIMIT_EXCEEDED",
  "message": "filter matches more than 500 tenants; narrow the filter and retry",
  "request_id": "req_...",
  "details": { "total_matched": 637 }
}
```

`total_matched` is the exact server-counted result size, including when it exceeds the 500-row execution cap. No rows are touched. To proceed, narrow the filter (add `status`, `search`, or a scoping field) and run multiple calls with distinct idempotency keys.

### Count mismatch — `COUNT_MISMATCH`

If `expected_count` is provided and disagrees with the resolved match, the call returns HTTP 409:

```json
{
  "error": "COUNT_MISMATCH",
  "message": "expected_count 42 differs from server-counted matches 40",
  "request_id": "req_...",
  "details": { "total_matched": 40 }
}
```

Again, no rows are touched. Re-preview the list and retry with a corrected `expected_count`, or drop the gate if you accept the drift.

### Replay semantics

Bulk calls are idempotent on `idempotency_key`. A replay within the 15-minute window returns the original response verbatim — the server does not re-evaluate the filter on replay. After the window expires, the same key re-executes from scratch against live data.

## Audit trail

One audit entry is written per bulk invocation (not per row). As of v0.1.25.30 its metadata captures the full per-row outcome plus filter echo and wall-clock duration — enough to triage a failure without re-running the op or capturing the synchronous response:

```json
{
  "operation": "bulkActionTenants",
  "resource_type": "tenant",
  "resource_id": "bulk-action",
  "status": 200,
  "metadata": {
    "action": "SUSPEND",
    "total_matched": 42,
    "succeeded": 40,
    "failed": 1,
    "skipped": 1,
    "succeeded_ids": ["tenant_1", "tenant_2", "..."],
    "failed_rows": [
      {"id": "tenant_7", "error_code": "INVALID_TRANSITION", "message": "Already SUSPENDED"}
    ],
    "skipped_rows": [
      {"id": "tenant_9", "reason": "ALREADY_IN_TARGET_STATE"}
    ],
    "filter": { "status": "ACTIVE", "search": "trial-" },
    "duration_ms": 1245,
    "idempotency_key": "ops-2026-04-17-freeze-abusers"
  }
}
```

Worst-case audit row size is ~40 KB at the 500-row bulk cap. Audit tooling that caps on entry-level JSON size should review.

Query bulk-action entries:

```bash
curl -G "http://localhost:7979/v1/admin/audit/logs" \
  -H "X-Admin-API-Key: $ADMIN_KEY" \
  --data-urlencode "operation=bulkActionTenants,bulkActionWebhooks,bulkActionBudgets" | jq .
```

The `operation` param was promoted to an array in v0.1.25.27 — you can OR across all three bulk operations in one query.
There is no `bulk_idempotency_key` audit query parameter. The bulk request's `idempotency_key` is stored as `metadata.idempotency_key` on the returned audit row, so filter by `operation` plus `tenant_id`, time range, `trace_id`, or `request_id`, then inspect the expanded row or exported JSON.

## Event log emission

Bulk actions also emit first-class Events on every successful row — one Event per mutated object, matching the kinds the single-op paths emit. Shipped in server versions:

| Endpoint | Per-row Event since | Spec |
|---|---|---|
| `POST /v1/admin/tenants/bulk-action` | admin v0.1.25.38 | v0.1.25.32 |
| `POST /v1/admin/budgets/bulk-action` | admin v0.1.25.38 | v0.1.25.32 |
| `POST /v1/admin/webhooks/bulk-action` | admin v0.1.25.39 | v0.1.25.33 |

The event kinds are the same ones the single-op endpoints emit — `tenant.suspended`, `tenant.reactivated`, `tenant.closed` for the tenant path; `budget.funded`, `budget.debited`, `budget.reset`, `budget.reset_spent`, `budget.debt_repaid` for the budget path; `webhook.paused`, `webhook.resumed`, `webhook.deleted` for the webhook path (see [Event Payloads Reference](/protocol/event-payloads-reference#webhook-lifecycle-events)).

### Correlation IDs

Every per-row emit from one bulk invocation shares a single `correlation_id`:

| Endpoint | Correlation ID shape |
|---|---|
| Tenants | `tenant_bulk_action:<action>:<request_id>` |
| Budgets | `budget_bulk_action:<action>:<request_id>` |
| Webhooks | `webhook_bulk_action:<action>:<request_id>` |

`<request_id>` is the `X-Request-Id` header the client supplied, or `req_<uuid>` when the header was absent (admin v0.1.25.40 replaced the earlier `"no-req"` literal so concurrent header-less invocations don't collide on one correlation_id). To pull every Event a single bulk invocation produced, query `GET /v1/admin/events?correlation_id=<value>`.

### CLOSE is the two-axis case

For `action=CLOSE` on tenants, each mutated row yields **two** correlation axes:

- The parent `tenant.closed` Event carries `correlation_id = tenant_bulk_action:close:<request_id>` — one value shared across every closed tenant in the invocation. Query by this ID to reconstruct *the invocation*.
- Each tenant's cascade fan-out (budgets closed, webhooks disabled, API keys revoked, reservations released — see [Tenant-Close Cascade Semantics](/protocol/tenant-close-cascade-semantics)) carries `correlation_id = tenant_close_cascade:<tenant_id>:<request_id>`. Query by this ID to reconstruct *one tenant's close*.

The two axes are independent and both are present in the event log. Use whichever matches the question you're answering.

### What does not emit

- **Skipped rows** (`ALREADY_IN_TARGET_STATE` — the row was already in the target status) emit no Event. Matches single-op behavior: a no-op doesn't write to the Event log.
- **Failed rows** (`INVALID_TRANSITION`, etc.) emit no Event. The bulk-action response's `failed[]` bucket and the aggregate `AuditLogEntry` are the operator-facing signals for failures; duplicating to the Event log would produce false failure alerts on any consumer pattern-matching on event kinds.
- **Event emission failures** are caught and logged at WARN; they never abort the bulk op or revert the row's state transition.

## Budget bulk-action

Budget bulk-action (v0.1.25.29) follows the same envelope as tenants and webhooks with two differences: `filter.tenant_id` is REQUIRED, and most actions require an `amount`.

```bash
# End-of-month period rollover for one tenant
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

# Debt cleanup on over-limit budgets
curl -X POST http://localhost:7979/v1/admin/budgets/bulk-action \
  -H "X-Admin-API-Key: $ADMIN_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "filter": { "tenant_id": "acme-corp", "has_debt": true },
    "action": "REPAY_DEBT",
    "amount": { "amount": 500000, "unit": "USD_MICROCENTS" },
    "expected_count": 3,
    "idempotency_key": "debt-cleanup-2026-04-18-acme"
  }'
```

### Differences vs. tenants / webhooks

- **`filter.tenant_id` is REQUIRED.** Cross-tenant budget bulk is explicitly out of scope — returns 400 if blank. If you're operating across many tenants, iterate over tenants and make one bulk call per tenant.
- **`amount` is required for all 5 actions.** `CREDIT`, `DEBIT`, `RESET`, `RESET_SPENT`, `REPAY_DEBT` all move value; there is no "state transition only" action like `SUSPEND` on tenants.
- **`spent` is honored only on `RESET_SPENT`.** Use it to override the post-reset `spent` value (for prorated signups, migrations, or credit-back). Default is 0.
- **Optional filters:** `scope_prefix`, `unit`, `status`, `over_limit`, `has_debt`, `utilization_min`, `utilization_max`, `search`. Same shape as `listBudgets`.
- **Per-row idempotency.** The server derives `{idempotency_key}:{scope}:{unit}` per row and passes it to the underlying fund path, so retrying the failed subset on a tighter filter cannot double-apply CREDIT / DEBIT / RESET / RESET_SPENT / REPAY_DEBT against rows that already landed.
- **Per-row `error_code`:** `BUDGET_EXCEEDED` (DEBIT would take remaining negative), `INVALID_TRANSITION` (unit mismatch / FROZEN / CLOSED), `NOT_FOUND` (ledger deleted between match and apply), `INTERNAL_ERROR`.
- **Per-row `skipped` reasons.** Today only `REPAY_DEBT` on `debt==0` produces `ALREADY_IN_TARGET_STATE`.

### When RESET_SPENT vs. RESET

`RESET` resizes the `allocated` ceiling and preserves `spent`, `reserved`, and `debt`. Use it for plan changes ("this tenant upgraded from 500k to 1M").

`RESET_SPENT` clears (or overrides) `spent` and preserves `allocated`, `reserved`, and `debt`. Use it for billing-period rollovers where outstanding reservations and debt must survive the boundary. See [Rolling Over Billing Periods with RESET_SPENT](/how-to/rolling-over-billing-periods-with-reset-spent).

## Recommended pattern

1. **Preview.** Call the matching list endpoint (`GET /v1/admin/tenants` or `GET /v1/admin/webhooks`) with the same filter. Note `total_count` if the server returns it, or paginate to count manually.
2. **Propose.** Compose the bulk request body. Set `idempotency_key` to something traceable back to an incident or runbook (`ops-INC-842-suspend-abusers`). Set `expected_count` to the preview count.
3. **Execute.** POST the bulk request. Capture the full response envelope to your runbook record.
4. **Reconcile.** Inspect `failed[]`. Investigate each `error_code` — bulk actions do not "retry until green"; follow-up fixes are manual.
5. **Audit.** Query audit logs by bulk `operation` and relevant top-level filters, then inspect `metadata.idempotency_key`, `succeeded_ids`, `failed_rows`, and `skipped_rows` to confirm every row was logged and to export for compliance review.

::: tip Dashboard equivalent
The Tenants and Webhooks pages in the [dashboard](/quickstart/deploying-the-cycles-dashboard) expose the same flow as a visual lane: filter the list, preview the count, click **Bulk action**, confirm with a blast-radius summary, and see per-row results in a side panel. The dashboard sets `expected_count` automatically from the current filter count.
:::

## Error reference

| HTTP | `error` | Meaning |
|------|---------|---------|
| 400 | `LIMIT_EXCEEDED` | Filter matched more than 500 rows. Narrow the filter. |
| 400 | `INVALID_REQUEST` | Unknown `action`, empty `filter`, unknown filter key (strict `additionalProperties: false`), or missing `idempotency_key`. |
| 401 | `UNAUTHORIZED` | Invalid or missing `X-Admin-API-Key`. |
| 409 | `COUNT_MISMATCH` | `expected_count` disagreed with resolved match count. Re-preview. |
| Per-row (`error_code` in `failed[]`) | `INVALID_TRANSITION`, `NOT_FOUND`, `PERMISSION_DENIED`, `BUDGET_EXCEEDED`, `INTERNAL_ERROR` | Row-level failure — HTTP status is still 200. |
| Per-row (`reason` in `skipped[]`) | `ALREADY_IN_TARGET_STATE`, `ALREADY_DELETED` | Row-level no-op skip — HTTP status is still 200. |

## Next steps

- [Tenant Creation and Management](/how-to/tenant-creation-and-management-in-cycles) — the single-entity endpoints bulk actions are built on
- [Managing Webhooks](/how-to/managing-webhooks) — per-subscription operations
- [Admin API reference](/admin-api/) — full OpenAPI
- [Searching and Sorting Admin List Endpoints](/how-to/searching-and-sorting-admin-list-endpoints) — how to narrow the filter before a bulk call
