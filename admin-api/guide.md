---
title: "Admin API Guide"
description: "How to use the Cycles Admin API for tenant management, API key lifecycle, budget operations, and policy configuration."
---

# Admin API Guide

The Cycles Admin API runs on port **7979** (separate from the runtime API on port 7878) and provides endpoints for managing tenants, API keys, budgets, and policies.

**Authentication:** Budget create uses `X-Cycles-API-Key` with `budgets:write` permission. Budget list and fund accept either `X-Cycles-API-Key` or `X-Admin-API-Key` (admin requires `tenant_id` query param). Budget patch, freeze, and unfreeze use `X-Admin-API-Key`. The `admin:write` and `admin:read` permissions act as wildcards — `admin:write` satisfies any `*:write` requirement. See the [budget allocation guide](/how-to/budget-allocation-and-management-in-cycles) for details.

**Conformance note.** Most of this admin API is **runcycles-reference**: implementers of the Cycles protocol MAY diverge — use GitOps YAML for policies, OAuth/OIDC for auth, direct DB writes for budget allocation, etc.

A small set of operations and schemas inside the governance-admin YAML are labeled `x-conformance: normative` because they expose the protocol's event stream, webhook delivery contract, and cross-plane auth introspection:

- **Operations (8):** events list / get / replay, webhook deliveries (admin + tenant paths), admin balances view, auth introspect.
- **Schemas:** `Event`, `EventType`, `EventData*` variants, `WebhookDelivery`, `WebhookRetryPolicy`, `Permission`.

See [CONFORMANCE.md](https://github.com/runcycles/cycles-protocol/blob/main/CONFORMANCE.md) for the authoritative MUST / SHOULD / MAY statement.

For the full interactive API reference, see the [Admin API Reference](/admin-api/).

## Authentication

The admin API uses two authentication mechanisms:

```bash
# Tenant/key/policy/webhook management + budget PATCH/freeze/unfreeze
-H "X-Admin-API-Key: $ADMIN_KEY"

# Budget create (tenant-scoped)
-H "X-Cycles-API-Key: $CYCLES_API_KEY"  # requires budgets:write or admin:write

# Budget list, fund (dual-auth — either works)
-H "X-Cycles-API-Key: $CYCLES_API_KEY"  # tenant derived from key
-H "X-Admin-API-Key: $ADMIN_KEY"        # requires tenant_id query param
```

The admin key is set via the `ADMIN_API_KEY` environment variable. `admin:write` acts as a wildcard that satisfies any `*:write` permission. `admin:read` satisfies any `*:read` permission. Budget patch, freeze, and unfreeze require the admin bootstrap key. Budget list and fund accept either auth method (v0.1.25.5+) — when using `X-Admin-API-Key`, the `tenant_id` query parameter is required.

## Tenant management

### Create a tenant

```bash
curl -s -X POST http://localhost:7979/v1/admin/tenants \
  -H "Content-Type: application/json" \
  -H "X-Admin-API-Key: admin-bootstrap-key" \
  -d '{
    "tenant_id": "acme-corp",
    "name": "Acme Corporation"
  }' | jq .
```

### Update tenant configuration

Tenant-level defaults control reservation TTL limits and the default overage policy:

```bash
curl -s -X PATCH http://localhost:7979/v1/admin/tenants/acme-corp \
  -H "Content-Type: application/json" \
  -H "X-Admin-API-Key: admin-bootstrap-key" \
  -d '{
    "default_reservation_ttl_ms": 60000,
    "max_reservation_ttl_ms": 300000,
    "max_reservation_extensions": 10,
    "default_commit_overage_policy": "ALLOW_IF_AVAILABLE"
  }' | jq .
```

### Suspend or close a tenant

```bash
curl -s -X PATCH http://localhost:7979/v1/admin/tenants/acme-corp \
  -H "Content-Type: application/json" \
  -H "X-Admin-API-Key: admin-bootstrap-key" \
  -d '{"status": "SUSPENDED"}' | jq .
```

Status values: `ACTIVE`, `SUSPENDED`, `CLOSED`.

### Tenant-close cascade semantics (v0.1.25.35+)

Closing a tenant is not just a status flip. As of `cycles-server-admin` v0.1.25.35, the `* → CLOSED` transition cascades owned objects to terminal states automatically:

| Owned object | Terminal state | Event emitted |
|---|---|---|
| `BudgetLedger` | `CLOSED` | `budget.closed_via_tenant_cascade` |
| `ApiKey` | `REVOKED` | `api_key.revoked_via_tenant_cascade` |
| Open `Reservation` | `RELEASED` (reason `tenant_closed`) | `reservation.released_via_tenant_cascade` |
| `WebhookSubscription` | `DISABLED` | `webhook.disabled_via_tenant_cascade` |

All cascade events share the `correlation_id` of the originating `tenant.closed` audit entry. After the cascade completes, every mutating admin-plane operation on the closed tenant's owned objects returns **`409 TENANT_CLOSED`** (Rule 2 — Terminal-Owner Mutation Guard). GET endpoints remain available for audit reads. runcycles' server uses the Mode B (flip-first-with-guarded-cascade) cascade implementation; both Mode A (atomic) and Mode B are conformant per spec v0.1.25.31.

See [Tenant-Close Cascade Semantics](/protocol/tenant-close-cascade-semantics) for the full Rule 1 / Rule 2 contract, affected endpoints, and operator recipes.

## API key management

### Create a key

```bash
curl -s -X POST http://localhost:7979/v1/admin/api-keys \
  -H "Content-Type: application/json" \
  -H "X-Admin-API-Key: admin-bootstrap-key" \
  -d '{
    "tenant_id": "acme-corp",
    "name": "production-key",
    "permissions": [
      "reservations:create",
      "reservations:commit",
      "reservations:release",
      "reservations:extend",
      "reservations:list",
      "balances:read"
    ]
  }' | jq .
```

The response includes `key_secret` (e.g., `cyc_live_abc123...`). **Save it immediately — the secret is only shown once.**

### List keys for a tenant

```bash
curl -s http://localhost:7979/v1/admin/api-keys?tenant_id=acme-corp \
  -H "X-Admin-API-Key: admin-bootstrap-key" | jq .
```

### Update a key

*New in v0.1.25.7:*

```bash
curl -s -X PATCH http://localhost:7979/v1/admin/api-keys/{key_id} \
  -H "Content-Type: application/json" \
  -H "X-Admin-API-Key: $ADMIN_KEY" \
  -d '{
    "permissions": ["reservations:create", "reservations:commit", "reservations:release", "balances:read", "budgets:write"],
    "name": "support-bot-v2"
  }' | jq .
```

Updates key permissions, scope_filter, name, description, or metadata without rotating the secret. Emits `api_key.permissions_changed` when permissions or scope_filter change. Returns 400 for invalid permission names, 409 for revoked or expired keys.

### Revoke a key

```bash
curl -s -X DELETE http://localhost:7979/v1/admin/api-keys/{key_id} \
  -H "X-Admin-API-Key: admin-bootstrap-key"
```

## Budget management

### Create a budget ledger

```bash
curl -s -X POST http://localhost:7979/v1/admin/budgets \
  -H "Content-Type: application/json" \
  -H "X-Cycles-API-Key: $CYCLES_API_KEY" \
  -d '{
    "scope": "tenant:acme-corp",
    "unit": "USD_MICROCENTS",
    "allocated": { "amount": 100000000, "unit": "USD_MICROCENTS" }
  }' | jq .
```

The tenant is derived from the authenticated API key — no `tenant_id` field in the request body.

### Fund an existing budget (CREDIT)

```bash
curl -s -X POST "http://localhost:7979/v1/admin/budgets/fund?scope=tenant:acme-corp&unit=USD_MICROCENTS" \
  -H "Content-Type: application/json" \
  -H "X-Cycles-API-Key: $CYCLES_API_KEY" \
  -d '{
    "operation": "CREDIT",
    "amount": { "amount": 50000000, "unit": "USD_MICROCENTS" },
    "idempotency_key": "fund-acme-001"
  }' | jq .
```

Operations: `CREDIT` (add funds), `DEBIT` (remove funds), `RESET` (resize `allocated` ceiling, preserving `spent`/`reserved`/`debt`), `RESET_SPENT` (start new billing period — set `allocated`, clear `spent` or set via optional `spent` override, preserve `reserved`/`debt`), `REPAY_DEBT` (reduce outstanding debt).

### Patch budget settings

*New in v0.1.24:*

```bash
curl -s -X PATCH 'http://localhost:7979/v1/admin/budgets?scope=tenant:acme-corp&unit=USD_MICROCENTS' \
  -H "Content-Type: application/json" \
  -H "X-Admin-API-Key: $ADMIN_KEY" \
  -d '{
    "commit_overage_policy": "REJECT",
    "overdraft_limit": { "amount": 10000000, "unit": "USD_MICROCENTS" }
  }' | jq .
```

This atomically recalculates `is_over_limit` based on the new settings.

### Freeze a budget

*New in v0.1.25.6:*

```bash
curl -s -X POST 'http://localhost:7979/v1/admin/budgets/freeze?scope=tenant:acme-corp&unit=USD_MICROCENTS' \
  -H "Content-Type: application/json" \
  -H "X-Admin-API-Key: $ADMIN_KEY" \
  -d '{"reason": "Investigating runaway agent"}' | jq .
```

Transitions budget status from ACTIVE → FROZEN. All new reservations, commits, and fund operations against this budget will be blocked (reservations return `BUDGET_FROZEN`, commits and fund return 409). Existing active reservations can only be released, not committed. Emits a `budget.frozen` event.

### Unfreeze a budget

```bash
curl -s -X POST 'http://localhost:7979/v1/admin/budgets/unfreeze?scope=tenant:acme-corp&unit=USD_MICROCENTS' \
  -H "Content-Type: application/json" \
  -H "X-Admin-API-Key: $ADMIN_KEY" \
  -d '{"reason": "Investigation complete, resuming"}' | jq .
```

Transitions FROZEN → ACTIVE. Reservations resume. Emits a `budget.unfrozen` event. Returns 409 if the budget is already active or has been closed.

### Look up a specific budget

*New in v0.1.25.5:*

```bash
curl -s "http://localhost:7979/v1/admin/budgets/lookup?scope=tenant:acme-corp/workspace:prod&unit=USD_MICROCENTS" \
  -H "X-Cycles-API-Key: $CYCLES_API_KEY" | jq .
```

Returns the single budget ledger for an exact scope + unit pair. Also accepts `X-Admin-API-Key` — no `tenant_id` needed because the budget is uniquely identified by the (scope, unit) pair.

### Dashboard overview

*New in v0.1.25.5:*

```bash
curl -s "http://localhost:7979/v1/admin/overview" \
  -H "X-Admin-API-Key: $ADMIN_KEY" | jq .
```

Returns a server-wide summary: entity counts (tenants, budgets, webhooks), top offenders, and recent event summaries. Designed for admin dashboard UIs — this endpoint is what powers the Overview page in the [Cycles Admin Dashboard](/quickstart/deploying-the-cycles-dashboard).

The overview payload also carries machine-readable aggregates that dashboards should treat as optional by server version:

| Field | Meaning |
|---|---|
| `recent_denials_by_reason` | Recent denial counts keyed by reason code. v0.1.25.x servers populate this for base denial reasons; v0.1.26 action-governance servers also include action reason codes such as `ACTION_QUOTA_EXCEEDED`. |
| `quota_health` | v0.1.26+ action-quota health summary for counters near or at their limit. Null or absent on v0.1.25.x reference admin servers. |
| `access_control_stats` | v0.1.26+ summary of policies using action-kind allow/deny lists and related access-control activity. Null or absent on v0.1.25.x reference admin servers. |
| `tenant_counts.in_observe_mode` | v0.1.26+ count of tenants with `observe_mode != ENFORCE`. Null or absent on v0.1.25.x reference admin servers. |

### API key introspection

*New in v0.1.25.5:*

```bash
curl -s "http://localhost:7979/v1/auth/introspect" \
  -H "X-Admin-API-Key: $ADMIN_KEY" | jq .
```

Returns server-level auth introspection. Useful for debugging auth configuration. Admin-key only.

### API key validation

`POST /v1/auth/validate` is the internal validation surface used by the runtime enforcement layer when it needs to validate a tenant API key through the governance plane. It checks, in order: key existence in the store, key hash match, key status (`ACTIVE`), expiry, tenant status (`ACTIVE`), permissions, and scope filters.

```bash
curl -s -X POST http://localhost:7979/v1/auth/validate \
  -H "Content-Type: application/json" \
  -H "X-Admin-API-Key: $ADMIN_KEY" \
  -d '{"key_secret": "cyc_live_..."}' | jq .
```

Use this for auth debugging and service-to-service validation flows. Do not expose it directly to tenants; tenant-facing applications should authenticate with `X-Cycles-API-Key` on the tenant-scoped endpoint they need.

## Policy management

::: warning v0 limitation
In v0, policies are **stored but not yet enforced at runtime**. The protocol server (port 7878) does not evaluate admin-defined policies when processing reservations, commits, or events. Enforcement is planned for a future version. Today, the only policy-like behavior enforced at runtime is the `overage_policy` resolved from the request or the tenant's `default_commit_overage_policy`.

The v0.1.26 action-governance preview extends policies with action quotas and action-kind allow/deny lists, but that extension is not part of the current v0.1.25 conformance target. See [Action Governance Preview](/protocol/action-governance-preview-in-cycles).
:::

### Create a policy

```bash
curl -s -X POST http://localhost:7979/v1/admin/policies \
  -H "Content-Type: application/json" \
  -H "X-Cycles-API-Key: $CYCLES_API_KEY" \
  -d '{
    "name": "limit-gpt4",
    "scope_pattern": "tenant:acme-corp/agent:*",
    "caps": {"max_tokens": 4096},
    "commit_overage_policy": "REJECT",
    "priority": 100
  }' | jq .
```

### Update a policy

*New in v0.1.24:*

```bash
curl -s -X PATCH http://localhost:7979/v1/admin/policies/{policy_id} \
  -H "Content-Type: application/json" \
  -H "X-Cycles-API-Key: $CYCLES_API_KEY" \
  -d '{
    "caps": {"max_tokens": 8192},
    "status": "ACTIVE"
  }' | jq .
```

### List policies

`GET /v1/admin/policies` supports `tenant_id`, `scope_pattern`, `status`, `cursor`, and `limit`. v0.1.25.x reference admin servers also accept the v0.1.26 compatibility filters `has_action_quotas` and `references_action_kind` without applying them.

Under the v0.1.26 action-governance extension, `has_action_quotas=true` filters to policies with non-empty `action_quotas` or `risk_class_quotas`; `references_action_kind=<kind>` matches policies whose `action_quotas`, `allowed_action_kinds`, or `denied_action_kinds` mention that kind.

## Audit logs

Query the audit trail for compliance and debugging:

```bash
curl -s 'http://localhost:7979/v1/admin/audit/logs?tenant_id=acme-corp&limit=10' \
  -H "X-Admin-API-Key: admin-bootstrap-key" | jq .
```

## Pillar 4: Events & Webhooks (v0.1.25)

The admin server provides 20 webhook/event endpoints for real-time observability:

- **Webhook management**: create, list, get, update, delete, test subscriptions
- **Event query**: list and retrieve events by tenant, type, category, time range
- **Delivery tracking**: list delivery attempts per subscription with status/date filters
- **Event replay**: re-deliver historical events to a subscription
- **Security config**: manage webhook URL SSRF protection (blocked CIDRs, HTTPS enforcement)
- **Tenant self-service**: tenants manage their own webhooks at `/v1/webhooks` for budget, reservation, and tenant events (27 of 47 registered event types, plus the additive `_via_tenant_cascade` fan-out events the reference admin server emits in those categories on tenant close — see [Tenant-Close Cascade Semantics](/protocol/tenant-close-cascade-semantics))

Events are emitted by admin controllers (tenant, budget, api-key, policy operations) and delivered asynchronously by the events service (`cycles-server-events`). See [Webhooks and Events](/concepts/webhooks-and-events) for architecture details.

**Create a webhook subscription** (add `?tenant_id=acme-corp` to scope to a tenant; omit for system-wide):

```bash
curl -X POST 'http://localhost:7979/v1/admin/webhooks?tenant_id=acme-corp' \
  -H "X-Admin-API-Key: $ADMIN_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "url": "https://your-endpoint.example.com/webhook",
    "event_types": ["budget.exhausted", "reservation.denied"]
  }'
```

The response includes `subscription_id` and `signing_secret` (auto-generated, returned only once).

**List webhooks:**

```bash
curl -s 'http://localhost:7979/v1/admin/webhooks?tenant_id=acme-corp' \
  -H "X-Admin-API-Key: $ADMIN_KEY" | jq .
```

**Test a webhook** (sends a `system.webhook_test` event):

```bash
curl -X POST http://localhost:7979/v1/admin/webhooks/whsub_abc123/test \
  -H "X-Admin-API-Key: $ADMIN_KEY"
```

**Query deliveries for a subscription:**

```bash
curl -s 'http://localhost:7979/v1/admin/webhooks/whsub_abc123/deliveries?status=FAILED' \
  -H "X-Admin-API-Key: $ADMIN_KEY" | jq .
```

**Replay events** (re-deliver events from a time range):

```bash
curl -X POST http://localhost:7979/v1/admin/webhooks/whsub_abc123/replay \
  -H "X-Admin-API-Key: $ADMIN_KEY" \
  -H "Content-Type: application/json" \
  -d '{"from": "2026-04-01T00:00:00Z", "to": "2026-04-01T12:00:00Z"}'
```

**Query events:**

```bash
curl -s 'http://localhost:7979/v1/admin/events?tenant_id=acme-corp&event_type=budget.exhausted&limit=10' \
  -H "X-Admin-API-Key: $ADMIN_KEY" | jq .
```

**View webhook security config:**

```bash
curl -s http://localhost:7979/v1/admin/config/webhook-security \
  -H "X-Admin-API-Key: $ADMIN_KEY" | jq .
# Returns: {"blocked_cidr_ranges": [...], "allow_http": false, "allowed_url_patterns": []}
```

**Update webhook security config** (enable HTTP for local dev):

```bash
curl -X PUT http://localhost:7979/v1/admin/config/webhook-security \
  -H "X-Admin-API-Key: $ADMIN_KEY" \
  -H "Content-Type: application/json" \
  -d '{"allow_http": true, "blocked_cidr_ranges": []}'
```

**Tenant self-service** (using `X-Cycles-API-Key` with `webhooks:write` permission):

```bash
curl -X POST http://localhost:7979/v1/webhooks \
  -H "X-Cycles-API-Key: $TENANT_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "url": "https://my-app.example.com/cycles-webhook",
    "event_types": ["budget.exhausted", "budget.threshold_crossed"]
  }'
```

See [Webhook Event Delivery Protocol](/protocol/webhook-event-delivery-protocol) for the full 47-event-type reference and delivery specification. See [Webhook Integrations](/how-to/webhook-integrations) for PagerDuty, Slack, and ServiceNow examples.

## List-endpoint features (v0.1.25.22+)

Six admin list endpoints (`/v1/admin/tenants`, `/v1/admin/api-keys`, `/v1/admin/budgets`, `/v1/admin/webhooks`, `/v1/admin/events`, `/v1/admin/audit/logs`) gained three operator features across the v0.1.25.22 through v0.1.25.25 window. See [Searching and sorting admin list endpoints](/how-to/searching-and-sorting-admin-list-endpoints) for the full cursor-invalidation rules.

**Cross-tenant lists (v0.1.25.22).** `GET /v1/admin/api-keys`, `GET /v1/admin/budgets`, `GET /v1/admin/webhooks`, `GET /v1/admin/events`, and `GET /v1/admin/audit/logs` accept an omitted `tenant_id` under admin auth. API-key and budget cross-tenant walks return composite cursors (`{tenantId}|{keyId}` or `{tenantId}|{ledgerId}`) so pagination remains stable across tenants. Dashboards that previously ran N+1 per-tenant loops should replace them with a single cross-tenant call.

**Budget filters (v0.1.25.22).** `GET /v1/admin/budgets` adds `over_limit` (boolean), `has_debt` (boolean), `utilization_min` (`[0,1]`), and `utilization_max` (`[0,1]`). AND-combined with every other filter; applied before cursor traversal so pagination stays stable. `utilization_min > utilization_max` → 400.

**Server-side sort (v0.1.25.24).** `sort_by` + `sort_dir` on all six endpoints. Per-endpoint whitelists; unknown keys → 400. Current default row order is `utilization desc` for budgets, `consecutive_failures desc` for webhooks, `timestamp desc` for events and audit logs, and `created_at desc` for tenants and API keys. Pass an endpoint-supported `sort_by` and `sort_dir` when row order matters.

**Free-text search (v0.1.25.25).** `search` query param on all six endpoints. Case-insensitive substring match on natural identifier fields, ≤128 characters, AND-combined with other filters.

**Forward-compatible v0.1.26 filters.** `GET /v1/admin/tenants` accepts `observe_mode`, and `GET /v1/admin/policies` accepts `has_action_quotas` and `references_action_kind`. On v0.1.25.x reference admin servers these parameters are accepted for compatibility but do not narrow results. Servers that implement [Action Governance Preview](/protocol/action-governance-preview-in-cycles) must wire them to the preview fields.

## Audit log failure capture (v0.1.25.20)

`GET /v1/admin/audit/logs` now returns entries for **failed** requests (401/403/400/404/409/500) alongside successes. Each failure entry carries `status`, `error_code`, `metadata.error_message` (sanitized, 1024-char capped), `metadata.method`, `metadata.path`, and — on 500 — `metadata.exception_class`.

Four query features landed in rapid succession on top of this foundation — sentinels (how pre-auth and admin-plane rows are tagged), filter DSL (how to slice the failure stream), correlation filters (how to join across planes), and tiered retention (how long each slice lives). They are covered separately below.

### Tenant sentinels (v0.1.25.28)

v0.1.25.28 split the previous single `<unauthenticated>` sentinel into two URL-safe values:

| Sentinel | Meaning | Retention tier |
|---|---|---|
| `__admin__` | Request authenticated via `X-Admin-API-Key`, not scoped to a tenant (governance ops, cross-tenant reads, admin-plane 4xx/5xx) | Authenticated (default 400 days). Never sampled. |
| `__unauth__` | Pre-authentication failure (missing / invalid / revoked key) | Unauthenticated (default 30 days). Subject to `audit.sample.unauthenticated`. |

```bash
# Admin-plane activity (new in v0.1.25.28)
curl -s 'http://localhost:7979/v1/admin/audit/logs?tenant_id=__admin__&limit=50' \
  -H "X-Admin-API-Key: $ADMIN_KEY" | jq .

# Pre-auth failures (was <unauthenticated>)
curl -s 'http://localhost:7979/v1/admin/audit/logs?tenant_id=__unauth__&limit=50' \
  -H "X-Admin-API-Key: $ADMIN_KEY" | jq .
```

**Migration note.** Auditor queries and dashboard filters hard-coded to `?tenant_id=<unauthenticated>` (or its URL-encoded form `%3Cunauthenticated%3E`) stop matching fresh writes the moment a server upgrades to v0.1.25.28. Historical rows written pre-.28 keep their literal `<unauthenticated>` value and age out under the unauth-tier TTL; no rewrite happens. Migrate queries to `__unauth__` (pre-auth failures only) or `__admin__` (new platform-admin slice).

**Tiered TTL defaults** (SOC2 compliant out of the box): authenticated entries retained 400 days, unauthenticated entries 30 days. Set either `audit.retention.authenticated.days` or `audit.retention.unauthenticated.days` to `0` for indefinite retention. See [Server Configuration Reference → Audit log retention](/configuration/server-configuration-reference-for-cycles#audit-log-retention).

**Semantic change for consumers.** Queries without a `status` filter (or with `status=4xx/5xx`) now surface failure entries that didn't exist in v0.1.25.19. Dashboards that assumed "audit entry exists ⇒ operation succeeded" must switch to checking `status` or `error_code`.

### Filter DSL (v0.1.25.27)

Four new query parameters on `GET /v1/admin/audit/logs` and two promoted to arrays:

| Parameter | Type | Purpose |
|---|---|---|
| `error_code` | array (max 25) | Exact-or-IN-list on `AuditLogEntry.error_code`. NULL `error_code` (success rows) MUST NOT match. |
| `error_code_exclude` | array (max 25) | NOT-IN-list. NULL `error_code` MUST always pass — don't hide successes when excluding failure codes. |
| `status_min` | integer 100..599 | Inclusive lower bound. Mutually exclusive with exact `status`. |
| `status_max` | integer 100..599 | Inclusive upper bound. `status_min > status_max` returns 400. |
| `operation` | array (max 25) | Promoted from scalar. Comma-separated form: `?operation=createBudget,updateBudget`. Single scalar still parses correctly. |
| `resource_type` | array (max 25) | Same shape. |

Search was extended to match `error_code` and `operation` in addition to `resource_id` / `log_id` (128-char substring cap unchanged).

```bash
# All 4xx failures for budget operations today
curl -s 'http://localhost:7979/v1/admin/audit/logs?status_min=400&status_max=499&resource_type=budget&from_ts=2026-04-18T00:00:00Z' \
  -H "X-Admin-API-Key: $ADMIN_KEY"

# Narrow to a set, minus a noisy subset
curl -s 'http://localhost:7979/v1/admin/audit/logs?error_code=BUDGET_EXCEEDED,OVERDRAFT_LIMIT_EXCEEDED&error_code_exclude=IDEMPOTENCY_MISMATCH' \
  -H "X-Admin-API-Key: $ADMIN_KEY"
```

### Correlation filters (v0.1.25.31)

Two exact-match filters that JOIN audit entries with events and webhook deliveries:

| Parameter | Purpose |
|---|---|
| `trace_id` | 32-hex W3C Trace Context identifier. Narrows to audit rows for one logical operation. May span multiple HTTP requests. |
| `request_id` | Narrows to audit rows for one specific HTTP request. |

```bash
# Walk one logical operation across planes
TID=0af7651916cd43dd8448eb211c80319c
curl -s "http://localhost:7979/v1/admin/audit/logs?trace_id=$TID" \
  -H "X-Admin-API-Key: $ADMIN_KEY"
curl -s "http://localhost:7979/v1/admin/events?trace_id=$TID" \
  -H "X-Admin-API-Key: $ADMIN_KEY"
```

See [Correlation and Tracing](/protocol/correlation-and-tracing-in-cycles) for the full contract.

## Bulk actions (v0.1.25.26)

Two filter-driven bulk endpoints for operators who need to suspend / reactivate / close many tenants — or pause / resume / delete many webhooks — in a single atomic call.

```bash
curl -X POST http://localhost:7979/v1/admin/tenants/bulk-action \
  -H "X-Admin-API-Key: $ADMIN_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "filter": { "status": "ACTIVE", "search": "preview-" },
    "action": "SUSPEND",
    "expected_count": 12,
    "idempotency_key": "'"$(uuidgen)"'"
  }'
```

**Safety gates:**
- Empty filter → 400 (prevents accidental all-rows action).
- More than 500 matches → 400 `LIMIT_EXCEEDED` with `total_matched` in the body.
- `expected_count` mismatch → 409 `COUNT_MISMATCH` with no writes.
- `idempotency_key` required; 15-minute replay window returns the cached outcome.

**Response envelope** splits results three ways:

```json
{
  "action": "SUSPEND",
  "total_matched": 12,
  "succeeded": ["tenant_1", "tenant_2", "..."],
  "failed": [{"id": "tenant_7", "error_code": "INVALID_TRANSITION", "message": "..."}],
  "skipped": [{"id": "tenant_9", "reason": "ALREADY_IN_TARGET_STATE"}],
  "idempotency_key": "..."
}
```

Supported actions: `SUSPEND | REACTIVATE | CLOSE` on `/v1/admin/tenants/bulk-action`; `PAUSE | RESUME | DELETE` on `/v1/admin/webhooks/bulk-action`; `CREDIT | DEBIT | RESET | REPAY_DEBT | RESET_SPENT` on `/v1/admin/budgets/bulk-action` (v0.1.25.29+).

### Budget bulk-action (v0.1.25.29)

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

- `filter.tenant_id` is REQUIRED (cross-tenant budget bulk is explicitly out of scope — 400 if blank). Optional filters: `scope_prefix`, `unit`, `status`, `over_limit`, `has_debt`, `utilization_min`, `utilization_max`, `search`.
- `amount` is required for all 5 actions. `spent` is honored only on `RESET_SPENT`.
- Per-row idempotency is derived from `{idempotency_key}:{scope}:{unit}`, so retrying the failed subset on a tighter filter cannot double-apply CREDIT / DEBIT / RESET / RESET_SPENT / REPAY_DEBT.
- Per-row `error_code` values: `BUDGET_EXCEEDED`, `INVALID_TRANSITION` (unit mismatch / FROZEN / CLOSED), `NOT_FOUND`, `INTERNAL_ERROR`.
- `skipped` with `reason=ALREADY_IN_TARGET_STATE` is produced today only by `REPAY_DEBT` on `debt==0` rows.

### Audit metadata enrichment (v0.1.25.30)

The single `AuditLogEntry` emitted per bulk invocation (`bulkActionTenants`, `bulkActionWebhooks`, `bulkActionBudgets`) now carries the full per-row outcome arrays, the filter echo, and the wall-clock duration. This lets triage happen from audit alone without re-running the op:

| Key | Type | Purpose |
|---|---|---|
| `succeeded_ids` | `string[]` | Per-row ids that succeeded — paper trail. |
| `failed_rows` | `BulkActionRowOutcome[]` | Full `{id, error_code, message}` per failure. |
| `skipped_rows` | `BulkActionRowOutcome[]` | Full `{id, reason}` per skip — distinguishes `ALREADY_IN_TARGET_STATE` from `ALREADY_DELETED`. |
| `filter` | object | Normalized filter echoed as-is — reconstructs operator intent from audit alone. |
| `duration_ms` | int64 | Handler-entry → audit-emit wall-clock for SLO triage. |

Worst-case audit row size is ~40 KB at the 500-row bulk cap. Audit tooling that caps on entry-level JSON size should review.

See [Using bulk actions for tenants and webhooks](/how-to/using-bulk-actions-for-tenants-and-webhooks) for idempotency patterns, filter construction, and operator workflow.

## Admin-on-behalf-of (v0.1.25.14 / v0.1.25.16)

Several mutating endpoints accept admin auth with an explicit `tenant_id` in the body — useful for onboarding, migration, and incident response:

- `POST /v1/admin/budgets` (budget creation)
- `POST /v1/admin/policies`, `PATCH /v1/admin/policies/{id}` (policy creation + update)
- Six tenant-scoped webhook endpoints: `GET /v1/webhooks`, `GET/PATCH/DELETE /v1/webhooks/{id}`, `POST /v1/webhooks/{id}/test`, `GET /v1/webhooks/{id}/deliveries`

All admin-driven mutations tag the audit entry with `metadata.actor_type=admin_on_behalf_of` so the provenance is queryable. `POST /v1/webhooks` (create) remains tenant-only — admin-creating-on-tenant-behalf would obscure the audit trail.

Incident-response bonus: `POST /v1/reservations/{id}/release` on the runtime server (port 7878) also accepts `X-Admin-API-Key` as of cycles-server v0.1.25.8 — see [Force-releasing stuck reservations as an operator](/how-to/force-releasing-stuck-reservations-as-an-operator).

## Next steps

- [Webhook Integrations](/how-to/webhook-integrations) — PagerDuty, Slack, ServiceNow examples
- [Admin API Reference (Interactive)](/admin-api/) — full OpenAPI explorer
- [Tenant Management](/how-to/tenant-creation-and-management-in-cycles) — tenant lifecycle patterns
- [API Key Management](/how-to/api-key-management-in-cycles) — key rotation and permissions
- [Budget Allocation and Management](/how-to/budget-allocation-and-management-in-cycles) — budget hierarchy patterns
