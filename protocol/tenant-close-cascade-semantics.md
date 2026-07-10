---
title: "Tenant-Close Cascade Semantics"
description: "How closing a tenant cascades owned objects to terminal states — the two normative rules, Mode A vs Mode B, and the TENANT_CLOSED (409) mutation guard."
---

# Tenant-Close Cascade Semantics

Closing a tenant is more than a status flip. Every object the tenant owns — budgets, reservations, API keys, webhook subscriptions — has to move to a terminal state too, and every subsequent mutation against those objects has to be rejected cleanly. The `cycles-governance-admin-v0.1.25.yaml` spec's `CASCADE SEMANTICS` section is the normative contract for how this works.

This page is the operator-facing reference. For the admin API surface that honors the contract, see the [Admin API Guide](/admin-api/guide). For the error-code side, see [Error Codes and Error Handling](/protocol/error-codes-and-error-handling-in-cycles#tenant-closed-409).

## Why this exists

Before the cascade contract was formalized (spec document revision 0.1.25.31), closing a tenant was a pure status flip. Operators would then have to separately:

- drain open reservations (or let TTL expire)
- freeze or close each owned budget
- revoke every API key
- disable every webhook subscription

In practice nobody did all of that. The `/admin/overview` dashboard would accumulate "FROZEN budgets on CLOSED tenants" rows forever — inflating the "needs attention" counter with rows operators had no user-reachable path to resolve.

The cascade contract, formalized at spec document revision 0.1.25.31 and shipping in `cycles-server-admin` v0.1.25.35+, makes the close operation do the right thing atomically (or eventually-atomically) instead.

## Version gate matrix

| Feature | Minimum component | What works |
|---|---|---|
| Rule 1 cascade (budgets + reservations) | `cycles-server-admin` v0.1.25.35 | Closing a tenant cascades budgets → CLOSED and open reservations → RELEASED |
| Rule 2 guard (budget operations, webhook create/update) | `cycles-server-admin` v0.1.25.35 | Admin-plane mutations against closed-tenant budgets, and webhook create/update, return `409 TENANT_CLOSED` |
| Rule 2 full coverage (policies, api-keys, remaining webhook mutations) | `cycles-server-admin` v0.1.25.36 | All remaining admin-plane mutation endpoints also return `409 TENANT_CLOSED` |
| Rule 2 runtime guard (reservation create/commit/release/extend) | `cycles-server` v0.1.25.47 (runtime spec v0.1.25.13) | Persisting reservation mutations on a closed tenant return `409 TENANT_CLOSED`; fresh dry-run/decide evaluations return `200 decision=DENY reason_code=TENANT_CLOSED` |
| Dashboard tombstone + cascade preview UI | `cycles-dashboard` v0.1.25.43 | Banner, CLOSE dialog preview, humanized errors, cascade audit/event chip |

**Pre-v0.1.25.35 admin servers do not cascade** — operators must manually freeze budgets, revoke keys, and disable webhooks before or after closing the tenant.

## The two rules

### Rule 1 — Close Cascade (server-issued)

On any `* → CLOSED` tenant transition (via `PATCH /v1/admin/tenants/{id}` or `POST /v1/admin/tenants/bulk-action` with `action=CLOSE`), the server drives each owned object into its nearest terminal state:

| Owned object | Terminal state | Notes |
|---|---|---|
| `BudgetLedger` | `CLOSED` | Stamps `closed_at`; drains any outstanding `reserved` back to `remaining`; preserves the final balance snapshot for audit. |
| `ApiKey` | `REVOKED` | Stamps `revoked_at`. |
| Open `Reservation` | `RELEASED` (reason `tenant_closed`) | No overage debt recorded. |
| `WebhookSubscription` | `DISABLED` | Re-enable is blocked by Rule 2 below, making `DISABLED` effectively-terminal for closed owners without adding a new enum value. |

**Ordering.** Ordering is a Mode A concern. Within Mode A's single transaction, the spec says the order SHOULD be:

1. Drain open reservations
2. Close budgets
3. Disable webhooks and revoke API keys (any order)
4. Flip `tenant.status` to `CLOSED` last

Mode B (see below) inverts this by design — the tenant flip commits **first**, and children converge afterward under the Rule 2 guard. Since runcycles' reference server implements Mode B, do not rely on this ordering in practice.

**Audit and event emission.** One record per mutated owned object. The emitted **Event rows** share a server-composed `correlation_id` of the form `tenant_close_cascade:<tenant_id>:<request_id>` — query `GET /v1/admin/events?correlation_id=...` to reconstruct the cascade. **Audit rows** carry `request_id`/`trace_id` (the AuditLogEntry schema has no correlation field); join them via the originating request's `request_id`. The dotted `*_via_tenant_cascade` names are emitted as Event `event_type`s (registered enum constants in the reference implementation, absent from the published spec enum); the matching audit rows are written as `operation="tenant_close_cascade"` with `resource_type`/`resource_id` identifying the mutated object. Reserved dotted names:

- `budget.closed_via_tenant_cascade`
- `webhook.disabled_via_tenant_cascade`
- `api_key.revoked_via_tenant_cascade`
- `reservation.released_via_tenant_cascade`

Servers should additionally emit one Event (dispatchable to webhook subscribers) per mutated owned object using the same dotted kind as its `event_type`. `reservation.released_via_tenant_cascade` is a **ledger-level aggregate**: reservation objects live on the runtime plane, so the admin plane emits one event per closed budget whose `reserved > 0` at close time — identified by `ledger_id`, not an individual reservation — carrying the drained amount as `released_amount`.

See [Webhook Event Delivery Protocol](/protocol/webhook-event-delivery-protocol) for how these land on webhook deliveries.

**Idempotency.** Re-issuing close on an already-CLOSED tenant is a no-op *at the tenant level* (returns the current state). Under Mode A no child work remains; under Mode B a re-close completes any outstanding child transitions — without emitting duplicate audit or event rows for already-terminal children. Operator-issued re-close is in fact one of the spec-sanctioned convergence mechanisms for an interrupted Mode B cascade.

### Mode A vs Mode B

The spec (v0.1.25.31) permits two cascade modes:

- **Mode A — Atomic Cascade (preferred).** All owned-object terminal transitions and the tenant flip commit in a single transaction. Rollback on any failure. Strongest guarantee but requires a transactional store.
- **Mode B — Flip-First with Guarded Cascade (conformant alternative).** Tenant flip to `CLOSED` commits first, making Rule 2 active; server then drives children to terminal states inline or via a reconciler. Valid only when: (a) Rule 2 activates at/before flip durability, (b) cascade is idempotent, (c) eventual convergence is guaranteed within a documented bound, (d) observable reads of non-terminal children of a CLOSED tenant remain consistent with stored status until cascade reaches them.

Both modes deliver the same client-observable contract: once the tenant is `CLOSED`, admin-plane mutations against its owned objects return `409 TENANT_CLOSED` regardless of whether the per-object state has flipped yet.

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

### Operations that guard

The spec's Rule 2 scopes the guard to **every mutating admin-plane operation** whose target resource has an owning tenant. Its enumeration (explicitly non-exhaustive) covers:

**Budget plane:**
- `POST /v1/admin/budgets/freeze`
- `POST /v1/admin/budgets/unfreeze`
- `POST /v1/admin/budgets/fund`
- `PATCH /v1/admin/budgets?scope=&unit=` (updateBudget)
- `POST /v1/admin/budgets/bulk-action` (per-row)

**Policy plane (tenant-scoped policies):**
- `POST /v1/admin/policies` (createPolicy)
- `PATCH /v1/admin/policies/{policy_id}` (updatePolicy)

**API key plane:**
- `POST /v1/admin/api-keys` (createApiKey)
- `PATCH /v1/admin/api-keys/{key_id}` (updateApiKey)
- `DELETE /v1/admin/api-keys/{key_id}` (revokeApiKey)

**Webhook plane (admin and tenant self-service paths):**
- `POST /v1/admin/webhooks`, `PATCH`, `DELETE`, `POST .../test`
- `POST /v1/webhooks`, `PATCH`, `DELETE`, `POST .../test`
- `POST /v1/admin/webhooks/{id}/replay`
- `POST /v1/admin/webhooks/bulk-action` (per-row)

**Bulk-action per-row semantics.** On bulk-action endpoints, rows targeting a closed tenant go into the `failed[]` bucket with `error_code=TENANT_CLOSED` — they don't abort the rest of the batch.

### What the runtime plane sees

**Spec (normative):** Rule 2's scope explicitly includes runtime reservation mutations — "any reservation create/commit/release/extend" — so a conformant server MUST reject them with `409 TENANT_CLOSED` once the CLOSED flip is durable. Runtime spec revision v0.1.25.13 binds this directly on the runtime plane: `TENANT_CLOSED` is now part of the runtime `ErrorCode` enum, with a normative closed-tenant binding in the runtime spec's ERROR SEMANTICS. `cycles-server` 0.1.25.47 implements it — the reference-implementation gap this section previously documented is closed. Shipped behavior:

- **Persisting mutations → `409 TENANT_CLOSED`.** Reservation create (`dry_run` absent or `false`), commit, release, and extend against a `CLOSED` owning tenant return `409` with `error=TENANT_CLOSED` once the flip is durable. The check runs inside the same Lua scripts as the budget mutations, so a post-flip request can never partially succeed, and it is not subject to any config-cache TTL.
- **Precedence.** For non-replay mutations, `TENANT_CLOSED` takes precedence over the reservation-state errors (`RESERVATION_FINALIZED`, `RESERVATION_EXPIRED`) — Rule 2 rejects regardless of the child's own current status. Same-key replays of mutations that succeeded before the close are the exception: they retain replay precedence and return the original stored response.
- **Non-persisting evaluations never 409.** A fresh (non-replay) `dry_run=true` create or `POST /v1/decide` on a closed tenant returns `200` with `decision=DENY` and `reason_code=TENANT_CLOSED` — dry-run and decide outcomes are attestations of what live execution would do (and may be captured as signed CyclesEvidence), so they reflect the closed tenant as-if-live instead of erroring. Same-key replays of pre-close evaluations return their original payload.
- **Fail-closed on malformed tenant records.** A tenant record that is present but whose status cannot be determined (undecodable JSON, non-object, missing or non-string `status`, unknown status string) returns `500 INTERNAL_ERROR` before any mutation — on the non-persisting surface too, because the server cannot attest against corrupt governance state. A subject tenant with **no** tenant record at all (runtime-only deployments without a governance plane) is not guarded.
- **Evidence receipts.** A mutation-surface `409 TENANT_CLOSED` on the evidence endpoints — persisting create, commit, release — emits an `error` CyclesEvidence envelope and stamps `cycles_evidence` on the response, like the other live denial codes (extend is not an evidence endpoint).
- **Reads unaffected.** `GET /v1/reservations` and `GET /v1/reservations/{id}` keep working on a closed tenant's reservations for post-close audit, mirroring Rule 2's read-access rule.

**Observability note:** the close cascade revokes the tenant's API keys, and the runtime auth filter rejects CLOSED-tenant keys per request — so tenant-key calls usually still fail with `401 UNAUTHORIZED` before the guard is consulted. In practice `409 TENANT_CLOSED` surfaces in two places: **admin-on-behalf-of release** — of the four guarded mutations, release is the only one the runtime plane exposes to `X-Admin-API-Key` (the admin dual-auth allowlist covers reservation list/get/release only, so create/commit/extend are never admin-key reachable) — and the **post-flip/pre-revocation race window** for tenant-key requests on any of the four.

**Version scope:** `cycles-server` 0.1.25.46 and earlier surface closed tenants on the runtime plane only as `401`s (revoked/rejected keys) or budget-state errors (`BUDGET_CLOSED` on cascaded budgets). Client code on those versions should treat "tenant was closed" as a `401`/`BUDGET_CLOSED` scenario; on 0.1.25.47+ handle `409 TENANT_CLOSED` as well.

## Operator recipe — closing a tenant

```bash
# 1. Preview what will cascade — confirms intent before the irreversible close.
#    The Tenant object itself carries no child counts, so use the list endpoints:
curl -s http://localhost:7979/v1/admin/tenants/acme-corp \
  -H "X-Admin-API-Key: $ADMIN_KEY" | jq '{tenant_id, status}'

# Budgets that will be closed (reserved > 0 will emit released_via_tenant_cascade)
curl -s "http://localhost:7979/v1/admin/budgets?tenant_id=acme-corp" \
  -H "X-Admin-API-Key: $ADMIN_KEY" \
  | jq '.ledgers[] | {scope, unit, status, reserved}'

# Open reservations that will be released (admin key requires the tenant filter)
curl -s "http://localhost:7979/v1/reservations?tenant=acme-corp&status=ACTIVE" \
  -H "X-Admin-API-Key: $ADMIN_KEY" | jq '.reservations[]'

# 2. Close the tenant — cascade runs automatically
curl -X PATCH http://localhost:7979/v1/admin/tenants/acme-corp \
  -H "X-Admin-API-Key: $ADMIN_KEY" \
  -H "Content-Type: application/json" \
  -d '{"status": "CLOSED"}'

# 3. Verify the cascade audit entries
curl -s "http://localhost:7979/v1/admin/audit/logs?tenant_id=acme-corp&operation=tenant_close_cascade" \
  -H "X-Admin-API-Key: $ADMIN_KEY" \
  | jq '.logs[] | {operation, resource_type, resource_id}'
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
- Pre-v0.1.25.36 servers have partial Rule 2 coverage — `.35` guarded budget operations and webhook create/update; `.36` completed policies, api-keys, the remaining webhook mutations, and per-row bulk-action.
- Pre-v0.1.25.43 dashboards render TENANT_CLOSED as a raw 409 error without the humanizer and without the cascade-preview dialog.
- `cycles-server` (runtime) 0.1.25.46 and earlier do NOT return `409 TENANT_CLOSED` on reservation mutations — closed tenants surface there only as `401`s (revoked/rejected keys) or `BUDGET_CLOSED`. The runtime guard ships in 0.1.25.47 (runtime spec v0.1.25.13).

**Re-issuing close on an already-CLOSED tenant** is idempotent at the tenant level across all versions — it returns the current state and emits no duplicate audit entries for already-terminal children. Under Mode B it is not a pure no-op: a re-close completes any outstanding child transitions left by an interrupted cascade.

## Related

- [Error Codes and Error Handling — TENANT_CLOSED](/protocol/error-codes-and-error-handling-in-cycles#tenant-closed-409)
- [Admin API Guide — Tenant close and cascade semantics](/admin-api/guide)
- [Tenant Creation and Management — CLOSED status](/how-to/tenant-creation-and-management-in-cycles#closed)
- [Using the Cycles Dashboard](/how-to/using-the-cycles-dashboard#closed-tenant-tombstone-and-cascade-preview)
- [Webhook Event Delivery Protocol](/protocol/webhook-event-delivery-protocol) — cascade event kinds
