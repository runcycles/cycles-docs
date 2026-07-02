---
title: "Searching and Sorting Admin List Endpoints"
description: "Use search, sort_by, and sort_dir on Cycles admin list endpoints — tenants, budgets, API keys, webhooks, events, audit logs, and reservations — with correct cursor handling."
---

# Searching and Sorting Admin List Endpoints

The admin and runtime planes expose the list endpoints below. The admin list endpoints share a consistent query-parameter vocabulary for filtering, searching, sorting, and paginating; `/v1/reservations` uses the same sort/cursor conventions for runtime reservations. This page is the practical reference for using them from curl, scripts, and operator tools.

The endpoints:

| Endpoint | Plane | Added / enhanced |
|----------|-------|------------------|
| `GET /v1/admin/tenants` | Admin | sort v0.1.25.24, search v0.1.25.25 |
| `GET /v1/admin/budgets` | Admin | filters v0.1.25.22, sort v0.1.25.24, search v0.1.25.25 |
| `GET /v1/admin/api-keys` | Admin | cross-tenant v0.1.25.22, sort v0.1.25.24, search v0.1.25.25 |
| `GET /v1/admin/webhooks` | Admin | sort v0.1.25.24, search v0.1.25.25 |
| `GET /v1/admin/events` | Admin | sort v0.1.25.24, search v0.1.25.25 |
| `GET /v1/admin/audit/logs` | Admin | failure capture v0.1.25.20, sort v0.1.25.24, search v0.1.25.25 |
| `GET /v1/reservations` | Runtime | sort v0.1.25.12 |

The parameters were added compatibly: older servers that predate a parameter may ignore it rather than erroring. Current servers still validate the parameters they recognize, so unsupported `sort_by`, invalid `sort_dir`, out-of-range `limit`, and `search` values over 128 characters return `400 INVALID_REQUEST`.

## Parameter vocabulary

### `search` (v0.1.25.25+)

A case-insensitive substring match over the endpoint's searchable identifier fields. Maximum 128 characters. Longer strings return `400 INVALID_REQUEST`.

| Endpoint | Fields matched by `search` |
|----------|---------------------------|
| `/v1/admin/tenants` | `tenant_id`, `name` |
| `/v1/admin/budgets` | `tenant_id`, `scope` |
| `/v1/admin/api-keys` | `key_id`, `name` |
| `/v1/admin/webhooks` | `subscription_id`, `url` |
| `/v1/admin/events` | `correlation_id`, `scope` |
| `/v1/admin/audit/logs` | `resource_id`, `log_id`, `error_code`, `operation` |

`search` is applied after other filters (`status`, `plan`, etc.) and is combined with them using AND semantics.

### `sort_by` and `sort_dir`

`sort_by` names the field to order on. `sort_dir` is `asc` or `desc`; when omitted it defaults to `desc`.

| Endpoint | Supported `sort_by` values |
|----------|---------------------------|
| `/v1/admin/tenants` | `tenant_id`, `name`, `status`, `created_at` |
| `/v1/admin/budgets` | `tenant_id`, `scope`, `unit`, `status`, `commit_overage_policy`, `utilization`, `debt` |
| `/v1/admin/api-keys` | `key_id`, `name`, `tenant_id`, `status`, `created_at`, `expires_at` |
| `/v1/admin/webhooks` | `url`, `tenant_id`, `status`, `consecutive_failures` |
| `/v1/admin/events` | `event_type`, `category`, `scope`, `tenant_id`, `timestamp` |
| `/v1/admin/audit/logs` | `timestamp`, `operation`, `resource_type`, `tenant_id`, `key_id`, `status` |
| `/v1/reservations` | `reservation_id`, `tenant`, `scope_path`, `status`, `reserved`, `created_at_ms`, `expires_at_ms` |

Unknown `sort_by` or `sort_dir` values return `400 INVALID_REQUEST`. The reservation endpoint sorts the integer `amount` within the `reserved` key (well-defined under v0's single-unit-per-reservation invariant); `scope_path` sorts the canonical scope string lexicographically.

::: warning Default order
Current admin-list defaults are endpoint-specific: tenants and API keys use `created_at desc`; budgets use `utilization desc`; webhooks use `consecutive_failures desc`; events and audit logs use `timestamp desc`. If a script relies on row order, pass `sort_by` and `sort_dir` explicitly. `/v1/reservations` retains its legacy default order unless `sort_by` is provided.
:::

### `cursor`, `limit`, `has_more`, `next_cursor`

Pagination is cursor-based:

- `limit` — maximum results per page. Endpoint-specific cap (typically 50 default, 200 max). Values outside the range return `400 INVALID_REQUEST`.
- `cursor` — opaque string from a previous response's `next_cursor`. Do not construct or modify it.
- `has_more` — boolean in the response. `true` means there is at least one more page.
- `next_cursor` — the value to pass as `cursor` on the next call. Absent when `has_more` is `false`.

### Cursor binding

When `sort_by` or filters are provided, the returned cursor is bound to the `(sort_by, sort_dir, filters)` tuple. Reusing a cursor under a different sort key, direction, or filter set returns `400 INVALID_REQUEST` with `error_code = CURSOR_INVALIDATED`.

**Reset the cursor whenever you change the sort key, sort direction, or any filter.** The client's job is to either preserve those parameters across all pages of a traversal or start over from page one.

### Cross-tenant listing (admin only)

Omitting the `tenant_id` query parameter on `/v1/admin/api-keys`, `/v1/admin/webhooks`, `/v1/admin/budgets`, `/v1/admin/events`, and `/v1/admin/audit/logs` returns rows across all tenants. Authentication must be via `X-Admin-API-Key` for cross-tenant access — tenant-scoped `X-Cycles-API-Key` calls are limited to their own tenant.

API-key and budget cross-tenant walks use composite cursors such as `(tenant_id, key_id)` or `(tenant_id, ledger_id)` so traversal remains stable across tenants. Treat every `next_cursor` as opaque regardless of endpoint.

## Forward-compatible preview filters

Two admin list surfaces accept v0.1.26-preview filters even on v0.1.25.x reference admin servers:

| Endpoint | Preview filters | v0.1.25.x behavior |
|---|---|---|
| `GET /v1/admin/tenants` | `observe_mode=DISABLED\|OBSERVE\|ENFORCE` | Accepted for compatibility; not applied until observe mode is implemented |
| `GET /v1/admin/policies` | `has_action_quotas`, `references_action_kind` | Accepted for compatibility; not applied until action-governance policy fields are implemented |

`GET /v1/admin/policies` is cursor-paginated but is not one of the six search/sort endpoints listed above. Its current filters are `tenant_id`, `scope_pattern`, `status`, `cursor`, and `limit`; the preview filters are documented in [Action Governance Preview](/protocol/action-governance-preview-in-cycles).

## Recipes

### Oldest-expiring active reservations

Incident response — find reservations about to expire that are holding budget:

```bash
curl -G "http://localhost:7878/v1/reservations" \
  -H "X-Cycles-API-Key: $TENANT_API_KEY" \
  --data-urlencode "status=ACTIVE" \
  --data-urlencode "sort_by=expires_at_ms" \
  --data-urlencode "sort_dir=asc" \
  --data-urlencode "limit=50" | jq .
```

### Most-utilized budgets

Capacity review — find the budgets closest to exhaustion:

```bash
curl -G "http://localhost:7979/v1/admin/budgets" \
  -H "X-Admin-API-Key: $ADMIN_KEY" \
  --data-urlencode "sort_by=utilization" \
  --data-urlencode "sort_dir=desc" \
  --data-urlencode "limit=25" | jq .
```

### Over-limit budgets with debt

Debt review — find scopes currently in overdraft:

```bash
curl -G "http://localhost:7979/v1/admin/budgets" \
  -H "X-Admin-API-Key: $ADMIN_KEY" \
  --data-urlencode "over_limit=true" \
  --data-urlencode "has_debt=true" \
  --data-urlencode "sort_by=debt" \
  --data-urlencode "sort_dir=desc" | jq .
```

`over_limit`, `has_debt`, and `utilization_min` / `utilization_max` are budget-specific filters added in v0.1.25.22.

### Webhooks about to auto-disable

Health check — find subscriptions approaching the `disable_after_failures` threshold:

```bash
curl -G "http://localhost:7979/v1/admin/webhooks" \
  -H "X-Admin-API-Key: $ADMIN_KEY" \
  --data-urlencode "sort_by=consecutive_failures" \
  --data-urlencode "sort_dir=desc" \
  --data-urlencode "limit=10" | jq .
```

### Search across tenants for a key

Audit — find every API key whose name contains "integration":

```bash
curl -G "http://localhost:7979/v1/admin/api-keys" \
  -H "X-Admin-API-Key: $ADMIN_KEY" \
  --data-urlencode "search=integration" \
  --data-urlencode "sort_by=created_at" \
  --data-urlencode "sort_dir=desc" | jq .
```

## Audit log filter DSL (v0.1.25.27)

`GET /v1/admin/audit/logs` supports a richer filter DSL than the other list endpoints. In addition to `search`, `sort_by`, and `sort_dir`, it accepts:

| Parameter | Type | Purpose |
|---|---|---|
| `error_code` | array (max 25) | Exact-or-IN-list on `error_code`. Comma-separated form (`?error_code=a,b`). NULL (success rows) does not match. |
| `error_code_exclude` | array (max 25) | NOT-IN-list. NULL always passes. Combine with `error_code` via AND. |
| `status_min` | integer 100–599 | Inclusive lower bound. Mutually exclusive with exact `status`. |
| `status_max` | integer 100–599 | Inclusive upper bound. `status_min > status_max` returns 400. |
| `operation` | array (max 25) | Promoted from scalar. `?operation=createBudget,updateBudget`. |
| `resource_type` | array (max 25) | Same shape. |
| `trace_id` | 32-hex | Exact-match JOIN across events and webhook deliveries (v0.1.25.31). See [Correlation and Tracing](/protocol/correlation-and-tracing-in-cycles). |
| `request_id` | string | Exact-match on per-HTTP-request id (v0.1.25.31). |

Also, `search` on `listAuditLogs` was extended to match `error_code` and `operation` in addition to `resource_id` / `log_id` — useful when you remember "`BUDGET_EXCEEDED` was involved" but not the full resource id.

```bash
# 5xx failures on budget endpoints in the last hour, not counting known idempotency noise
curl -G 'http://localhost:7979/v1/admin/audit/logs' \
  -H "X-Admin-API-Key: $ADMIN_KEY" \
  --data-urlencode "status_min=500" \
  --data-urlencode "resource_type=budget" \
  --data-urlencode "error_code_exclude=IDEMPOTENCY_MISMATCH" \
  --data-urlencode "from_ts=2026-04-18T12:00:00Z" | jq .

# Everything admins did cross-tenant today
curl -G 'http://localhost:7979/v1/admin/audit/logs' \
  -H "X-Admin-API-Key: $ADMIN_KEY" \
  --data-urlencode "tenant_id=__admin__" \
  --data-urlencode "from_ts=2026-04-18T00:00:00Z" | jq .
```

### Tenant sentinels (v0.1.25.28)

- `__admin__` — admin-plane operations not scoped to a tenant (governance ops, cross-tenant reads, admin-plane 4xx/5xx). Authenticated-tier retention.
- `__unauth__` — pre-authentication failures. Unauthenticated-tier retention, subject to `audit.sample.unauthenticated`.

v0.1.25.28 renamed the previous single `<unauthenticated>` sentinel. Historical rows keep their `<unauthenticated>` literal and age out under the unauth-tier TTL; migrate queries to `__unauth__` (pre-auth failures only) or `__admin__` (new platform-admin slice).

## Hydration cap on sorted reservation listings

On `/v1/reservations`, the sorted path caps the pre-sort working set at `SORTED_HYDRATE_CAP = 2000` rows per page (v0.1.25.13+). If your filter matches more than 2000 rows, the server logs a WARN and fills the page from the capped slice — the sort is only approximately global.

To see past the cap, narrow the filter: add `status`, `idempotency_key`, or a subject field (`workspace`, `app`, `workflow`, `agent`, `toolset`). The admin list endpoints do not apply an equivalent cap — they sort the full filtered set.

## Error reference

| `error_code` | Meaning |
|--------------|---------|
| `INVALID_REQUEST` | Unknown `sort_by`, unknown `sort_dir`, out-of-range `limit`, or `search` over 128 chars |
| `CURSOR_INVALIDATED` | Cursor reused under different sort key, direction, or filters |
| `FORBIDDEN` | Tenant-scoped key attempted a cross-tenant listing |
| `UNAUTHORIZED` | Invalid API key |

## Next steps

- [Admin API reference](/admin-api/) — full OpenAPI for each endpoint
- [Reservation Recovery and Listing](/protocol/reservation-recovery-and-listing-in-cycles) — reservation-specific sort and recovery patterns
- [Using Bulk Actions](/how-to/using-bulk-actions-for-tenants-and-webhooks) — bulk actions take the same filter shape as the list endpoints
- [API Key Management](/how-to/api-key-management-in-cycles) — cross-tenant key listing in practice
