---
title: "Tenant-Close Cascade Semantics"
description: "How closing a tenant cascades owned objects to terminal states — the two normative rules, Mode A vs Mode B, and the TENANT_CLOSED (409) mutation guard."
---

# Tenant-Close Cascade Semantics

Closing a tenant is more than a status flip. Every object the tenant owns — budgets, reservations, API keys, webhook subscriptions — has to move to a terminal state too, and every subsequent mutation against those objects has to be rejected cleanly. The `cycles-governance-admin-v0.1.25.yaml` spec's `CASCADE SEMANTICS` section is the normative contract for how this works.

This page is the operator-facing reference. For the admin API surface that honors the contract, see the [Admin API Guide](/admin-api/guide). For the error-code side, see [Error Codes and Error Handling](/protocol/error-codes-and-error-handling-in-cycles#tenant-closed-409).

## Why this exists

Pre-v0.1.25.29, closing a tenant was a pure status flip. Operators would then have to separately:

- drain open reservations (or let TTL expire)
- freeze or close each owned budget
- revoke every API key
- disable every webhook subscription

In practice nobody did all of that. The `/admin/overview` dashboard would accumulate "FROZEN budgets on CLOSED tenants" rows forever — inflating the "needs attention" counter with rows operators had no user-reachable path to resolve.

The cascade contract, added in spec v0.1.25.29 and shipping in `cycles-server-admin` v0.1.25.35+, makes the close operation do the right thing atomically (or eventually-atomically) instead.

## Version gate matrix

| Feature | Minimum component | What works |
|---|---|---|
| Rule 1 cascade (budgets + reservations) | `cycles-server-admin` v0.1.25.35 | Closing a tenant cascades budgets → CLOSED and open reservations → RELEASED |
| Rule 2 guard (budget + reservation mutations) | `cycles-server-admin` v0.1.25.35 | Mutations against closed-tenant budgets and reservations return `409 TENANT_CLOSED` |
| Rule 2 full coverage (policies, api-keys, webhook admin) | `cycles-server-admin` v0.1.25.36 | All remaining mutation endpoints also return `409 TENANT_CLOSED` |
| Dashboard tombstone + cascade preview UI | `cycles-dashboard` v0.1.25.43 | Banner, CLOSE dialog preview, humanized errors, cascade audit/event chip |

**Pre-v0.1.25.35 admin servers do not cascade** — operators must manually freeze budgets, revoke keys, and disable webhooks before or after closing the tenant.

## The two rules

### Rule 1 — Close Cascade (server-issued)

On any `* → CLOSED` tenant transition (via `PATCH /v1/admin/tenants/{id}` or `POST /v1/admin/tenants/bulk-action` with `action=CLOSE`), the server drives each owned object into its nearest terminal state:

| Owned object | Terminal state | Notes |
|---|---|---|
| `BudgetLedger` | `CLOSED` | Stamps `closed_at`; preserves the final balance snapshot for audit. |
| `ApiKey` | `REVOKED` | Stamps `revoked_at`. |
| Open `Reservation` | `RELEASED` (reason `tenant_closed`) | No overage debt recorded. |
| `WebhookSubscription` | `DISABLED` | Re-enable is blocked by Rule 2 below, making `DISABLED` effectively-terminal for closed owners without adding a new enum value. |

**Ordering.** The server MUST perform these in order:

1. Drain open reservations
2. Close budgets
3. Disable webhooks and revoke API keys (any order)
4. Flip `tenant.status` to `CLOSED` last

**Audit emission.** One audit entry per mutated owned object, all sharing the `correlation_id` of the originating `tenant.closed` entry. Reserved `event_kind` values:

- `budget.closed_via_tenant_cascade`
- `webhook.disabled_via_tenant_cascade`
- `api_key.revoked_via_tenant_cascade`
- `reservation.released_via_tenant_cascade`

See [Webhook Event Delivery Protocol](/protocol/webhook-event-delivery-protocol) for how these land on webhook deliveries.

**Idempotency.** Re-issuing close on an already-CLOSED tenant is a no-op (returns the current state, no events re-emitted).

### Mode A vs Mode B

The spec (v0.1.25.31) permits two cascade modes:

- **Mode A — Atomic Cascade (preferred).** All owned-object terminal transitions and the tenant flip commit in a single transaction. Rollback on any failure. Strongest guarantee but requires a transactional store.
- **Mode B — Flip-First with Guarded Cascade (conformant alternative).** Tenant flip to `CLOSED` commits first, making Rule 2 active; server then drives children to terminal states inline or via a reconciler. Valid only when: (a) Rule 2 activates at/before flip durability, (b) cascade is idempotent, (c) eventual convergence is guaranteed within a documented bound, (d) observable reads of non-terminal children of a CLOSED tenant remain consistent with stored status until cascade reaches them.

Both modes deliver the same client-observable contract: once the tenant is `CLOSED`, mutations against its owned objects return `409 TENANT_CLOSED` regardless of whether the per-object state has flipped yet.

**runcycles' reference server uses Mode B** — backed by Redis, not a transactional database. Operators should not rely on atomic visibility of all child transitions; instead rely on Rule 2.

### Rule 2 — Terminal-Owner Mutation Guard

Every mutating admin-plane operation on an owned object whose parent tenant is `CLOSED` MUST reject with:

```http
HTTP 409 Conflict
Content-Type: application/json

{
  "error": "TENANT_CLOSED",
  "message": "Tenant <tenant_id> is closed; <object_type> is read-only.",
  "request_id": "req-...",
  "trace_id": "..."
}
```

GET endpoints remain available — closed-tenant state is still readable post-mortem for audit and compliance.

### Endpoints that guard

Per spec v0.1.25.29–.30, these mutating operations all return `409 TENANT_CLOSED` when the owning tenant is closed:

**Budget plane:**
- `PATCH /v1/admin/budgets?scope=&unit=` (updateBudget)
- `POST /v1/admin/budgets` (createBudget)
- `POST /v1/admin/budgets/fund`
- `POST /v1/admin/budgets/freeze`
- `POST /v1/admin/budgets/unfreeze`
- `POST /v1/admin/budgets/bulk-action` (per-row)

**Reservation plane (runtime + admin):**
- `POST /v1/reservations` (createReservation)
- `POST /v1/reservations/{id}/commit`
- `POST /v1/reservations/{id}/release`
- `POST /v1/reservations/{id}/extend`
- `POST /v1/events` (direct-debit)

**Policy plane:**
- `POST /v1/admin/policies` (createPolicy)
- `PATCH /v1/admin/policies/{policy_id}` (updatePolicy)

**API key plane:**
- `POST /v1/admin/api-keys` (createApiKey)
- `PATCH /v1/admin/api-keys/{key_id}` (updateApiKey)
- `DELETE /v1/admin/api-keys/{key_id}` (revokeApiKey)

**Webhook plane (admin and tenant paths):**
- `POST /v1/admin/webhooks`, `PATCH`, `DELETE`, `POST .../test`
- `POST /v1/webhooks`, `PATCH`, `DELETE`, `POST .../test`
- `POST /v1/admin/webhooks/{id}/replay`
- `POST /v1/admin/webhooks/bulk-action` (per-row)

**Bulk-action per-row semantics.** On bulk-action endpoints, rows targeting a closed tenant go into the `failed[]` bucket with `error_code=TENANT_CLOSED` — they don't abort the rest of the batch.

## Operator recipe — closing a tenant

```bash
# 1. Preview what will cascade — confirms intent before the irreversible close
curl -s http://localhost:7979/v1/admin/tenants/acme-corp \
  -H "X-Admin-API-Key: $ADMIN_KEY" | jq '{
    status,
    budget_count: .budget_count,
    active_reservations: .active_reservations_count
  }'

# 2. Close the tenant — cascade runs automatically
curl -X PATCH http://localhost:7979/v1/admin/tenants/acme-corp \
  -H "X-Admin-API-Key: $ADMIN_KEY" \
  -H "Content-Type: application/json" \
  -d '{"status": "CLOSED"}'

# 3. Verify the cascade audit entries
curl -s "http://localhost:7979/v1/admin/audit/logs?tenant_id=acme-corp&from=$(date -u -Iseconds -d '5 min ago')" \
  -H "X-Admin-API-Key: $ADMIN_KEY" \
  | jq '.logs[] | {operation, event_kind: .metadata.event_kind, resource_id}'
```

If the `/admin/overview` dashboard still shows frozen budgets on the closed tenant after a few seconds, your admin server is on a pre-v0.1.25.35 version — the cascade hasn't shipped and you need to upgrade. See the [Admin API Guide — Tenant close and cascade semantics](/admin-api/guide).

## Dashboard behavior

The [Cycles Admin Dashboard](/quickstart/deploying-the-cycles-dashboard) (v0.1.25.43+) surfaces cascade behavior:

- **Closed-tenant banner.** Amber read-only banner on `TenantDetailView` when `tenant.status === 'CLOSED'`: "Tenant closed — all owned objects are read-only."
- **CLOSE confirm-dialog preview.** The dialog enumerates what will be terminated: owned budgets, webhook subscriptions, API keys, open reservations, with counts from already-loaded state. "This cannot be undone."
- **`TENANT_CLOSED` humanizer.** Any mutation that races the cascade (stale tab, deep-link, in-flight request) surfaces "Tenant is closed — this object is read-only." instead of the raw 409.
- **Cascade event chip.** Events and audit rows with `_via_tenant_cascade` event-kind suffixes render a small amber "tenant cascade" chip, visually distinguishing cascade-triggered state changes from user-driven ones when operators correlate by `correlation_id`.

See [Using the Cycles Dashboard](/how-to/using-the-cycles-dashboard#closed-tenant-tombstone-and-cascade-preview) for the full UI walkthrough.

## Backward compatibility

- Pre-v0.1.25.35 admin servers do NOT cascade. Operators on older versions must continue manually terminating owned objects before or after the tenant close.
- Pre-v0.1.25.35 servers do NOT return `409 TENANT_CLOSED` — they return the previous per-endpoint error (`409 BUDGET_FROZEN`, `403 FORBIDDEN`, etc.) or may accept mutations against orphaned objects.
- Pre-v0.1.25.36 servers have partial Rule 2 coverage — `.35` guarded budget and reservation ops; `.36` completed policies, api-keys, webhook-admin mutations, and per-row bulk-action.
- Pre-v0.1.25.43 dashboards render TENANT_CLOSED as a raw 409 error without the humanizer and without the cascade-preview dialog.

**Re-issuing close on an already-CLOSED tenant** is idempotent across all versions — returns current state, no new audit entries.

## Related

- [Error Codes and Error Handling — TENANT_CLOSED](/protocol/error-codes-and-error-handling-in-cycles#tenant-closed-409)
- [Admin API Guide — Tenant close and cascade semantics](/admin-api/guide)
- [Tenant Creation and Management — CLOSED status](/how-to/tenant-creation-and-management-in-cycles#closed)
- [Using the Cycles Dashboard](/how-to/using-the-cycles-dashboard#closed-tenant-tombstone-and-cascade-preview)
- [Webhook Event Delivery Protocol](/protocol/webhook-event-delivery-protocol) — cascade event kinds
