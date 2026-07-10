---
title: "Event Payloads Reference"
description: "Complete payload reference for all Cycles webhook events — currently emitted and planned. Includes JSON examples, field definitions, and trigger conditions."
---

# Event Payloads Reference

This page documents the payload structure for every webhook event Cycles can emit. Each event wraps a standard envelope with an event-specific `data` object.

::: info Currently Emitted Events
The v0.1.25 Admin API `EventType` enum registers **47 event types** total across seven categories (budget: 16, reservation: 5, tenant: 6, api_key: 6, policy: 3, webhook: 6, system: 5). Events marked as **Planned** below have their type registered in the protocol but are not yet emitted by any service.

**Registered enum values currently emitted** (count toward the 47 total):

- **Reservation:** `reservation.denied`, `reservation.expired`, `reservation.commit_overage` (runtime).
- **Budget:** `budget.exhausted`, `budget.over_limit_entered`, `budget.debt_incurred`, `budget.reset_spent` (runtime + admin v0.1.25.18+); `budget.funded`, `budget.debited`, `budget.reset`, `budget.debt_repaid` (admin v0.1.25.38+).
- **Tenant:** `tenant.suspended`, `tenant.reactivated`, `tenant.closed` (admin v0.1.25.38+, single-op + bulk-action paths).
- **Webhook:** `webhook.created`, `webhook.updated`, `webhook.paused`, `webhook.resumed`, `webhook.deleted` (admin v0.1.25.39+); `webhook.disabled` (events service auto-disable v0.1.25.11+). All six webhook lifecycle types were added in spec v0.1.25.33 — see the [Webhook Lifecycle Events](#webhook-lifecycle-events) section below.
- **API key, policy, system:** 0 registered enum values currently emitted; all planned.

**Additive reference-server payloads** (observable in the reference implementation but not part of the published admin-openapi enum — consumers must ignore unrecognized event types gracefully):

- Reservation lifecycle samples: `reservation.reserved`, `reservation.committed`, `reservation.released`, `reservation.extended`.
- Runtime ledger application: `event.applied`.
- Tenant-close cascade fan-out: `budget.closed_via_tenant_cascade`, `reservation.released_via_tenant_cascade`, `api_key.revoked_via_tenant_cascade`, `webhook.disabled_via_tenant_cascade` (admin v0.1.25.35+) — see the [Tenant-Close Cascade Semantics](/protocol/tenant-close-cascade-semantics) contract.

See the [Event Emission Summary](#event-emission-summary) at the bottom for the full per-category breakdown.
:::

## Standard Envelope

Every event shares this envelope structure. The `data` field varies by event type.

```json
{
  "event_id": "evt_a1b2c3d4e5f67890",
  "event_type": "budget.exhausted",
  "category": "budget",
  "timestamp": "2026-04-01T14:32:00.123Z",
  "tenant_id": "acme-corp",
  "scope": "tenant:acme-corp/workspace:prod",
  "source": "cycles-server",
  "actor": {
    "type": "api_key",
    "key_id": "key_abc123",
    "source_ip": "10.0.1.50"
  },
  "data": { },
  "correlation_id": "3f2a9c14e0b7d5a1",
  "request_id": "req_789",
  "trace_id": "4bf92f3577b34da6a3ce929d0e0e4736",
  "metadata": {}
}
```

### Envelope fields

| Field | Type | Always present | Description |
|---|---|---|---|
| `event_id` | string | Yes | Unique event identifier (format: `evt_*`). Use for deduplication. |
| `event_type` | string | Yes | Dotted event name (e.g., `budget.exhausted`) |
| `category` | string | Yes | One of: `budget`, `reservation`, `tenant`, `api_key`, `policy`, `webhook`, `system` (the `webhook` value was added in spec v0.1.25.34) |
| `timestamp` | string | Yes | ISO 8601 UTC timestamp |
| `tenant_id` | string | Yes | Tenant ID (system events use `__system__`) |
| `scope` | string | When applicable | Full scope path (e.g., `tenant:acme-corp/workspace:prod`) |
| `source` | string | Yes | Emitting service: `cycles-server` (runtime events), `cycles-admin` (admin-plane events including bulk-action emits and webhook lifecycle events since v0.1.25.38/.39), or `cycles-events` (dispatcher-emitted `webhook.disabled` on auto-disable, v0.1.25.11). |
| `actor` | object | When applicable | Who triggered: `type` (`api_key`, `admin`, `system`, `scheduler`), `key_id`, `source_ip` |
| `data` | object | Varies | Event-specific payload (see below). Some events emit `null`. |
| `correlation_id` | string | When applicable | Server-set family key — deterministic hash for event-stream clusters, explicit operation IDs (`webhook_create:<id>` etc.) for admin operations |
| `request_id` | string | When provided | From `X-Request-Id` header on originating request |
| `trace_id` | string | When provided | W3C Trace Context-compatible correlation identifier (32 lowercase hex characters). Links the event to the originating request, its audit entry, and sibling events within the same logical operation. |
| `metadata` | object | When provided | Operator-defined key-value pairs |

---

## Reservation Events

### `reservation.reserved` — Additive Reference-Server Payload (v0.1.25.3)

**Trigger:** A reservation is created successfully.

**Emitted from:** `POST /v1/reservations` (ALLOW or ALLOW_WITH_CAPS response).

The envelope's `scope`, `tenant_id`, and `actor` fields identify the reservation context. The `data` payload carries the reservation identifier and the amount held.

---

### `reservation.committed` — Additive Reference-Server Payload (v0.1.25.3)

**Trigger:** A reservation is committed with actual spend recorded.

**Emitted from:** `POST /v1/reservations/{id}/commit`.

If `actual > estimated`, a companion `reservation.commit_overage` event is also emitted (see below).

---

### `reservation.released` — Additive Reference-Server Payload (v0.1.25.3)

**Trigger:** A reservation is cancelled.

**Emitted from:** `POST /v1/reservations/{id}/release`. If the release was performed by an admin operator (dual-auth path introduced in v0.1.25.8), the envelope's `actor.type` will be `admin` and the audit log records `metadata.actor_type=admin_on_behalf_of`.

---

### `reservation.extended` — Additive Reference-Server Payload (v0.1.25.3)

**Trigger:** A reservation TTL is extended via heartbeat.

**Emitted from:** `POST /v1/reservations/{id}/extend`.

---

### `reservation.denied` — Currently Emitted

**Trigger:** A reservation or decide request returns DENY.

**Emitted from:** `POST /v1/reservations` (DENY response), `POST /v1/decide` (DENY response)

```json
{
  "event_type": "reservation.denied",
  "data": {
    "scope": "tenant:acme-corp/workspace:prod/workflow:support",
    "reason_code": "BUDGET_EXCEEDED",
    "requested_amount": 500000
  }
}
```

::: tip Fields populated at emission time
The `reservation.denied` event model defines 9 fields, but the current server emission populates `scope`, `reason_code`, and `requested_amount`. The remaining fields (`unit`, `remaining`, `action`, `subject`, `policy_id`, `deny_detail`) are defined in the model and may be populated in future releases.
:::

| Field | Type | Populated | Description |
|---|---|---|---|
| `scope` | string | Yes | Scope path that denied the reservation |
| `reason_code` | string | Yes | Why denied. Known values: `BUDGET_EXCEEDED`, `OVERDRAFT_LIMIT_EXCEEDED`, `DEBT_OUTSTANDING`, `BUDGET_FROZEN`, `BUDGET_CLOSED`. Open string — extensions (v0.1.26+) may emit additional values such as `ACTION_QUOTA_EXCEEDED`, `ACTION_KIND_DENIED`, `ACTION_KIND_NOT_ALLOWED`. |
| `requested_amount` | number | Yes | Amount the reservation requested |
| `unit` | string | Not yet | Budget unit (`USD_MICROCENTS`, `TOKENS`, `CREDITS`, `RISK_POINTS`) |
| `remaining` | number | Not yet | Budget remaining at the scope that denied |
| `action` | object | Not yet | Action metadata from the reservation request |
| `subject` | object | Not yet | Subject metadata from the reservation request |
| `policy_id` | string | Not yet | Policy ID that caused the denial, when applicable (added v0.1.25.8) |
| `deny_detail` | object | Not yet | Operator-grade structured context (added v0.1.25.8). Populated by extensions; may include `quota_violation`, `blocked_by_policy`, `blocked_by_scope`, `suggested_fix`, `budget_remaining`. |

---

### `reservation.commit_overage` — Currently Emitted

**Trigger:** A commit's actual cost exceeds the original reservation estimate.

**Emitted from:** `POST /v1/reservations/{id}/commit` (when `actual > estimated`)

```json
{
  "event_type": "reservation.commit_overage",
  "scope": "tenant:acme/workflow:support",
  "data": {
    "reservation_id": "res_a1b2c3d4",
    "scope": "tenant:acme/workflow:support",
    "unit": "USD_MICROCENTS",
    "estimated_amount": 400000,
    "actual_amount": 480000,
    "overage": 80000,
    "overage_policy": "ALLOW_IF_AVAILABLE",
    "debt_incurred": 0
  }
}
```

::: tip Fields populated at emission time
As of cycles-server v0.1.25.46, the emission populates **all 8** data fields and sets the envelope `scope` to the reservation's scope path — so `commit_overage` participates in scope filtering like any other scoped event. (Earlier releases populated only `reservation_id` and `actual_amount`, with a null envelope scope.)
:::

| Field | Type | Populated | Description |
|---|---|---|---|
| `reservation_id` | string | Yes | The reservation that exceeded its estimate |
| `scope` | string | Yes | Affected scope path (also set on the envelope) |
| `unit` | string | Yes | Budget unit |
| `estimated_amount` | number | Yes | Original reservation estimate |
| `actual_amount` | number | Yes | Actual cost committed |
| `overage` | number | Yes | Amount by which actual exceeded estimate |
| `overage_policy` | string | Yes | Policy applied: `REJECT`, `ALLOW_IF_AVAILABLE`, `ALLOW_WITH_OVERDRAFT` |
| `debt_incurred` | number | Yes | Debt created (0 unless `ALLOW_WITH_OVERDRAFT`) |

---

### `reservation.expired` — Currently Emitted

**Trigger:** A reservation TTL expires without being committed or released.

**Emitted from:** Background expiry sweeper (runs every 5 seconds by default)

```json
{
  "event_type": "reservation.expired",
  "data": {
    "reservation_id": "res_d4e5f678",
    "scope": "tenant:acme-corp/workspace:prod",
    "unit": "USD_MICROCENTS",
    "estimated_amount": 200000,
    "created_at": "2026-04-01T14:30:00.000Z",
    "expired_at": "2026-04-01T14:35:30.000Z",
    "ttl_ms": 300000,
    "extensions_used": 0
  }
}
```

| Field | Type | Description |
|---|---|---|
| `reservation_id` | string | The expired reservation |
| `scope` | string | Affected scope path |
| `unit` | string | Budget unit |
| `estimated_amount` | number | Amount that was held by the reservation |
| `created_at` | string | When the reservation was created (ISO 8601) |
| `expired_at` | string | When the reservation expired (ISO 8601) |
| `ttl_ms` | number | Effective TTL in milliseconds (computed as `expired_at - created_at`; includes extensions) |
| `extensions_used` | number | How many times the reservation was extended before expiry |

---

### `reservation.denial_rate_spike` — Planned

**Trigger:** Denial rate exceeds configured threshold within a rolling window.

::: warning Not Yet Emitted
This event type is defined in the protocol but not yet emitted by the Cycles server. It will be implemented in a future release.
:::

---

### `reservation.expiry_rate_spike` — Planned

**Trigger:** Expiry rate exceeds configured threshold within a rolling window.

::: warning Not Yet Emitted
This event type is defined in the protocol but not yet emitted by the Cycles server. It will be implemented in a future release.
:::

---

## Budget Events

### `budget.approaching_limit` — Additive Reference-Server Payload (v0.1.25.3, dedup fixed v0.1.25.5)

**Trigger:** A scope's utilization crosses the configured "approaching" threshold (default **80%**).

**Emitted from:** `EventEmitterService.emitBalanceEvents()` on reservation / commit / event.

The envelope identifies the scope; the `data` payload reports `utilization`, `remaining`, and the threshold crossed. Subscriptions that want pager-ready escalation should filter on `event_type=budget.approaching_limit OR budget.at_limit OR budget.over_limit`.

---

### `budget.at_limit` — Additive Reference-Server Payload (v0.1.25.3, dedup fixed v0.1.25.5)

**Trigger:** Utilization crosses the "at-limit" threshold (default **95%**).

**Emitted from:** Same emission path as `approaching_limit`. Dedup logic prevents re-emission while the scope remains in the same state band on subsequent mutations.

---

### `budget.over_limit` — Additive Reference-Server Payload (v0.1.25.3, dedup fixed v0.1.25.5)

**Trigger:** Utilization reaches or exceeds **100%**.

**Emitted from:** Same emission path. Distinct from `budget.over_limit_entered`, which fires when debt first exceeds `overdraft_limit` under `ALLOW_WITH_OVERDRAFT`.

---

### `budget.reset_spent` — Currently Emitted (v0.1.25.18)

**Trigger:** An admin operator issues a `RESET_SPENT` funding operation on `POST /v1/admin/budgets/fund`.

**Emitted from:** `cycles-server-admin`. Distinct from `budget.reset` — `RESET` resizes the allocated ceiling and preserves `spent`; `RESET_SPENT` additionally clears (or overrides) `spent` for billing-period rollover.

The payload is an `EventDataBudgetLifecycle` with `spent` and `reserved` fields on `BudgetState`, plus an optional `spent_override_provided` boolean flag on the outer payload (`true` when the operator supplied an explicit `spent` value).

See [Rolling over billing periods with RESET_SPENT](/how-to/rolling-over-billing-periods-with-reset-spent) for operator guidance.

---

### `event.applied` — Additive Reference-Server Payload (v0.1.25.3)

**Trigger:** A direct debit via `POST /v1/events` is applied successfully (no pre-reservation path).

**Emitted from:** Runtime events controller. The envelope's `scope` and `actor` identify the debit; the `data` payload reports the amount charged.

---

### `budget.exhausted` — Currently Emitted

**Trigger:** A budget's remaining amount reaches zero after a reservation or commit.

**Emitted from:** `EventEmitterService.emitBalanceEvents()` (when `remaining.amount == 0`)

```json
{
  "event_type": "budget.exhausted",
  "data": null
}
```

::: tip Envelope contains context
While the `data` field is `null` for this event, the envelope's `scope`, `tenant_id`, and `actor` fields identify which budget exhausted and what triggered it. Query the budget's current state via the admin API for balance details.
:::

---

### `budget.over_limit_entered` — Currently Emitted

**Trigger:** Debt exceeds the configured `overdraft_limit` on a budget with `ALLOW_WITH_OVERDRAFT` policy.

**Emitted from:** `EventEmitterService.emitBalanceEvents()` (when `is_over_limit` transitions to `true`)

```json
{
  "event_type": "budget.over_limit_entered",
  "data": {
    "scope": "tenant:acme-corp/workspace:prod",
    "unit": "USD_MICROCENTS",
    "debt": 1500000,
    "overdraft_limit": 1000000,
    "is_over_limit": true,
    "debt_utilization": 1.5
  }
}
```

| Field | Type | Description |
|---|---|---|
| `scope` | string | Affected scope path |
| `unit` | string | Budget unit |
| `debt` | number | Current debt amount |
| `overdraft_limit` | number | Configured overdraft ceiling |
| `is_over_limit` | boolean | Always `true` for this event |
| `debt_utilization` | number | Ratio: `debt / overdraft_limit` |

---

### `budget.debt_incurred` — Currently Emitted

**Trigger:** A commit creates new debt via `ALLOW_WITH_OVERDRAFT` policy (actual cost exceeds available budget).

**Emitted from:** `EventEmitterService.emitBalanceEvents()` (when new debt is created)

```json
{
  "event_type": "budget.debt_incurred",
  "data": {
    "scope": "tenant:acme-corp/workspace:prod",
    "unit": "USD_MICROCENTS",
    "total_debt": 750000,
    "overdraft_limit": 1000000
  }
}
```

::: tip Fields populated at emission time
The `budget.debt_incurred` event model defines 7 fields, but the current server emission populates `scope`, `unit`, `total_debt`, and `overdraft_limit`. The remaining fields (`reservation_id`, `debt_incurred`, `overage_policy`) are defined in the model and may be populated in future releases.
:::

| Field | Type | Populated | Description |
|---|---|---|---|
| `scope` | string | Yes | Affected scope path |
| `unit` | string | Yes | Budget unit |
| `total_debt` | number | Yes | Total accumulated debt on this scope |
| `overdraft_limit` | number | Yes | Configured overdraft ceiling |
| `reservation_id` | string | Not yet | Reservation whose commit caused the debt |
| `debt_incurred` | number | Not yet | New debt from this commit |
| `overage_policy` | string | Not yet | Policy applied (`ALLOW_WITH_OVERDRAFT`) |

---

### Planned Budget Events

The following budget events are defined in the protocol but not yet emitted. They will be implemented as admin service and budget lifecycle operations gain event hooks.

| Event Type | Trigger |
|---|---|
| `budget.created` | Budget ledger created via admin API |
| `budget.updated` | Budget configuration changed |
| `budget.funded` | CREDIT, DEBIT, RESET, or REPAY_DEBT funding operation |
| `budget.debited` | Funds removed from budget |
| `budget.reset` | Budget reset to new allocated amount |
| `budget.debt_repaid` | Outstanding debt repaid via REPAY_DEBT |
| `budget.frozen` | Budget status set to FROZEN |
| `budget.unfrozen` | Budget restored from FROZEN |
| `budget.closed` | Budget permanently closed |
| `budget.threshold_crossed` | Utilization crossed configured threshold (e.g., 80%, 95%) |
| `budget.over_limit_exited` | Debt dropped below overdraft limit after repayment |
| `budget.burn_rate_anomaly` | Spend rate exceeds baseline multiplier within window |

---

## Tenant-Close Cascade Events — Additive Reference-Server Payloads (v0.1.25.35+)

Four event kinds are emitted by the reference admin server as side effects of a `* → CLOSED` tenant transition (Rule 1 — Close Cascade; see [Tenant-Close Cascade Semantics](/protocol/tenant-close-cascade-semantics) for the full contract). All four share the `_via_tenant_cascade` suffix and carry a server-composed `correlation_id` of the form `tenant_close_cascade:<tenant_id>:<request_id>`, so subscribers can correlate cascade side effects to the operator action that triggered them (audit rows for the same operation join via `request_id`/`trace_id`).

These four event names are **absent from the published admin-openapi `EventType` enum** (they do not count toward the 47 registered types), but they are registered as first-class constants in the reference implementation's `EventType.java`. Consumers must ignore unrecognized event types gracefully and should not assume non-reference servers emit them. Tenant self-service subscriptions filter by category, so a tenant subscribed to `budget` or `reservation` events will receive the corresponding cascade events from the reference server in practice.

Shipped in `cycles-server-admin` v0.1.25.35 (initial Mode B cascade) / v0.1.25.36 (full Rule 2 guard coverage).

### `budget.closed_via_tenant_cascade`

Emitted once per owned `BudgetLedger` when the tenant closes. The per-budget `BudgetLedger.status` flips to `CLOSED` and `closed_at` is stamped; the final balance snapshot is preserved for audit.

```json
{
  "event_id": "evt_...",
  "event_type": "budget.closed_via_tenant_cascade",
  "category": "budget",
  "timestamp": "2026-04-20T12:00:00Z",
  "tenant_id": "acme-corp",
  "scope": "tenant:acme-corp/workspace:prod",
  "source": "cycles-admin",
  "actor": {
    "type": "api_key",
    "key_id": "admin_key_...",
    "source_ip": "..."
  },
  "data": {
    "ledger_id": "led_...",
    "scope": "tenant:acme-corp/workspace:prod",
    "unit": "USD_MICROCENTS",
    "final_allocated": 10000000,
    "final_spent": 8234000,
    "final_reserved": 0,
    "final_debt": 0,
    "closed_at": "2026-04-20T12:00:00Z",
    "cascade_origin": "tenant.closed"
  },
  "correlation_id": "tenant_close_cascade:acme-corp:req_...",
  "trace_id": "<same as originating>"
}
```

### `reservation.released_via_tenant_cascade`

Emitted once per open owned `Reservation` when the tenant closes. Reason `tenant_closed`; no overage debt is recorded; the full reserved amount returns to the (now-closed) budget's balance snapshot.

```json
{
  "event_id": "evt_...",
  "event_type": "reservation.released_via_tenant_cascade",
  "category": "reservation",
  "tenant_id": "acme-corp",
  "data": {
    "reservation_id": "rsv_...",
    "scope": "tenant:acme-corp/...",
    "reserved": { "amount": 1000, "unit": "TOKENS" },
    "release_reason": "tenant_closed",
    "cascade_origin": "tenant.closed"
  },
  "correlation_id": "tenant_close_cascade:acme-corp:req_...",
  "trace_id": "<same as originating>"
}
```

### `api_key.revoked_via_tenant_cascade`

Emitted once per owned `ApiKey` when the tenant closes. The per-key `ApiKey.status` flips to `REVOKED` and `revoked_at` is stamped.

```json
{
  "event_id": "evt_...",
  "event_type": "api_key.revoked_via_tenant_cascade",
  "category": "api_key",
  "tenant_id": "acme-corp",
  "data": {
    "key_id": "key_...",
    "name": "production",
    "revoked_at": "2026-04-20T12:00:00Z",
    "cascade_origin": "tenant.closed"
  },
  "correlation_id": "tenant_close_cascade:acme-corp:req_...",
  "trace_id": "<same as originating>"
}
```

### `webhook.disabled_via_tenant_cascade`

Emitted once per owned `WebhookSubscription` when the tenant closes. Status flips to `DISABLED`; re-enable is blocked by the Rule 2 guard (returns `409 TENANT_CLOSED`), making DISABLED effectively-terminal for closed-owner subscriptions without adding a new enum value.

```json
{
  "event_id": "evt_...",
  "event_type": "webhook.disabled_via_tenant_cascade",
  "category": "webhook",
  "tenant_id": "acme-corp",
  "data": {
    "subscription_id": "whsub_...",
    "url": "https://...",
    "disabled_at": "2026-04-20T12:00:00Z",
    "cascade_origin": "tenant.closed"
  },
  "correlation_id": "tenant_close_cascade:acme-corp:req_...",
  "trace_id": "<same as originating>"
}
```

### Correlating cascade events

The shared `correlation_id` is the primary join key — querying `GET /v1/admin/events?correlation_id=...` returns every event emitted by the cascade in one call. The dashboard (v0.1.25.43+) renders a "tenant cascade" chip on audit and event-timeline rows with these suffixes. See [Using the Cycles Dashboard](/how-to/using-the-cycles-dashboard#closed-tenant-tombstone-and-cascade-preview).

**Ordering guarantee.** The spec mandates emission order: reservations released → budgets closed → webhooks disabled + API keys revoked → `tenant.closed`. Subscribers that depend on ordered observation of these events can rely on this, modulo the usual at-least-once webhook-delivery duplicates and reordering risk.

---

## Webhook Lifecycle Events

**Currently emitted (spec v0.1.25.33).** Admin v0.1.25.39 emits six webhook lifecycle event types on the subscription CRUD + bulk-action paths; events v0.1.25.11 emits `webhook.disabled` on the dispatcher auto-disable path. All six share the `EventDataWebhookLifecycle` payload and the `webhook` category.

### `EventDataWebhookLifecycle` payload

| Field | Type | Always present | Description |
|---|---|---|---|
| `subscription_id` | string | Yes | The affected webhook subscription (`whsub_...`). |
| `tenant_id` | string | Yes | Owning tenant — mirrors the envelope for convenience. |
| `previous_status` | string | When applicable | `ACTIVE` / `PAUSED` / `DISABLED`. Absent on `webhook.created` (no prior state). Present on `webhook.deleted` (the status the subscription held before deletion). |
| `new_status` | string | When applicable | `ACTIVE` / `PAUSED` / `DISABLED`. Post-mutation status. Absent on `webhook.deleted` (subscription no longer exists). |
| `changed_fields` | array&lt;string&gt; | On `webhook.updated` | The subscription fields the PATCH actually modified (diff vs prior snapshot — identity-PATCHes emit an empty array and full-identity PATCHes suppress emit entirely per spec §6281). |
| `disable_reason` | string | On `webhook.disabled` | Why the dispatcher auto-disabled this subscription. Canonical value: `consecutive_failures_exceeded_threshold`. |

### `webhook.created`

**Trigger:** Successful `POST /v1/admin/webhooks`.
**Emitted by:** `cycles-server-admin` v0.1.25.39.
**Correlation-id shape:** `webhook_create:<subscription_id>`.

```json
{
  "event_id": "evt_...",
  "event_type": "webhook.created",
  "category": "webhook",
  "tenant_id": "acme-corp",
  "source": "cycles-admin",
  "data": {
    "subscription_id": "whsub_...",
    "tenant_id": "acme-corp",
    "new_status": "ACTIVE"
  },
  "correlation_id": "webhook_create:whsub_...",
  "trace_id": "<32-hex>"
}
```

### `webhook.updated`

**Trigger:** `PATCH /v1/admin/webhooks/{id}` that is neither a pure `ACTIVE → PAUSED` nor `PAUSED → ACTIVE` flip (those emit `webhook.paused` / `webhook.resumed` instead).
**Emitted by:** `cycles-server-admin` v0.1.25.39.
**Correlation-id shape:** `webhook_update:<subscription_id>:<request_id>`.

`changed_fields` is a true diff against the prior snapshot: re-PATCHing the same values is silently suppressed — no event emitted — so operators don't see lifecycle noise from identity writes.

### `webhook.paused`

**Trigger:** `PATCH /v1/admin/webhooks/{id}` with a status transition `ACTIVE → PAUSED`, or `POST /v1/admin/webhooks/bulk-action` with `action=PAUSE`.
**Emitted by:** `cycles-server-admin` v0.1.25.39.
**Correlation-id shape:** `webhook_update:<id>:<request_id>` (single-op) or `webhook_bulk_action:pause:<request_id>` (bulk).

### `webhook.resumed`

**Trigger:** `PATCH /v1/admin/webhooks/{id}` with a status transition `PAUSED → ACTIVE`, or `POST /v1/admin/webhooks/bulk-action` with `action=RESUME`.
**Emitted by:** `cycles-server-admin` v0.1.25.39.
**Correlation-id shape:** `webhook_update:<id>:<request_id>` (single-op) or `webhook_bulk_action:resume:<request_id>` (bulk).

### `webhook.disabled`

**Trigger:** The dispatcher auto-disables a subscription after consecutive delivery failures cross `disable_after_failures`.
**Emitted by:** `cycles-server-events` v0.1.25.11.
**Correlation-id shape:** `webhook_auto_disable:<subscription_id>:<delivery_id>`.
**Actor:** `{type: system}` with `source = cycles-events`.

This is reserved for dispatcher-driven disables. Operator-initiated disables show up as `webhook.paused` (soft-disable) or `webhook.deleted` (removal). Tenant-close cascades use the separate `webhook.disabled_via_tenant_cascade` event — see [Tenant-Close Cascade Events](#webhook-disabled-via-tenant-cascade) above.

```json
{
  "event_id": "evt_...",
  "event_type": "webhook.disabled",
  "category": "webhook",
  "tenant_id": "acme-corp",
  "source": "cycles-events",
  "actor": { "type": "system" },
  "data": {
    "subscription_id": "whsub_...",
    "tenant_id": "acme-corp",
    "previous_status": "ACTIVE",
    "new_status": "DISABLED",
    "disable_reason": "consecutive_failures_exceeded_threshold"
  },
  "correlation_id": "webhook_auto_disable:whsub_...:dlv_...",
  "trace_id": "<copied from triggering delivery when present>"
}
```

### `webhook.deleted`

**Trigger:** Successful `DELETE /v1/admin/webhooks/{id}`, or `POST /v1/admin/webhooks/bulk-action` with `action=DELETE`.
**Emitted by:** `cycles-server-admin` v0.1.25.39.
**Correlation-id shape:** `webhook_delete:<subscription_id>` (single-op) or `webhook_bulk_action:delete:<request_id>` (bulk).

### Correlating webhook lifecycle events

Bulk-action invocations stamp every per-row emit with a shared `correlation_id` (`webhook_bulk_action:<action>:<request_id>`) — query `GET /v1/admin/events?correlation_id=...` to pull every lifecycle event from one operator action. Skipped or failed rows never emit. See [Using Bulk Actions](/how-to/using-bulk-actions-for-tenants-and-webhooks) for the full bulk-action event contract.

For the managing-webhooks operator flow (subscription creation, signing-secret rotation, delivery health) see [Managing Webhooks](/how-to/managing-webhooks).

---

## Tenant, API Key, Policy, and System Events

The tenant category is partially emitted as of admin v0.1.25.38. Policy, system, and api_key enum values are fully defined in the protocol but are not yet emitted directly by any service; cascade fan-out examples above are additive reference-server payloads. Additional emissions will be implemented as the admin service gains event-emission support.

### Tenant Events (6 types — 3 currently emitted)

| Event Type | Status | Trigger |
|---|---|---|
| `tenant.created` | Planned | New tenant provisioned |
| `tenant.updated` | Planned | Tenant configuration changed |
| `tenant.suspended` | **Emitted** (admin v0.1.25.38+) | `PATCH /v1/admin/tenants/{id}` or `bulk-action` sets status to `SUSPENDED` |
| `tenant.reactivated` | **Emitted** (admin v0.1.25.38+) | `PATCH /v1/admin/tenants/{id}` or `bulk-action` restores status to `ACTIVE` |
| `tenant.closed` | **Emitted** (admin v0.1.25.38+) | `PATCH /v1/admin/tenants/{id}` or `bulk-action` sets status to `CLOSED` — also triggers the four `_via_tenant_cascade` events documented above |
| `tenant.settings_changed` | Planned | Tenant default settings modified |

### API Key Events (6 types — all planned)

| Event Type | Status | Trigger |
|---|---|---|
| `api_key.created` | Planned | New API key generated |
| `api_key.revoked` | Planned | API key permanently revoked |
| `api_key.expired` | Planned | API key reached expiration date |
| `api_key.permissions_changed` | Planned | API key permissions modified |
| `api_key.auth_failed` | Planned | Authentication attempt failed |
| `api_key.auth_failure_rate_spike` | Planned | Auth failure rate exceeded threshold |

### Policy Events (3 types — all planned)

| Event Type | Trigger |
|---|---|
| `policy.created` | New policy rule created |
| `policy.updated` | Policy configuration changed |
| `policy.deleted` | Policy removed |

### System Events (5 types — all planned)

| Event Type | Trigger |
|---|---|
| `system.store_connection_lost` | Redis connection failed |
| `system.store_connection_restored` | Redis connection recovered |
| `system.high_latency` | Server-side p99 latency exceeded threshold |
| `system.webhook_delivery_failed` | Webhook delivery permanently failed after all retries |
| `system.webhook_test` | Admin-initiated test webhook |

---

## Event Emission Summary

| Category | Total Defined | Currently Emitted | Notes |
|---|---|---|---|
| Reservation | 5 | `reservation.denied`, `reservation.expired`, and `reservation.commit_overage` emitted by runtime paths; lifecycle and cascade examples above are additive reference-server payloads | Spike events still planned |
| Budget | 16 | `budget.exhausted`, `over_limit_entered`, `debt_incurred`, `reset_spent`, and admin funding events emitted by current services; legacy threshold aliases and cascade examples above are additive reference-server payloads | Remaining lifecycle/threshold types still planned |
| Tenant | 6 | `tenant.suspended`, `tenant.reactivated`, `tenant.closed` emitted by admin (single-op + bulk-action paths, bulk parity added in v0.1.25.38) | `tenant.created`, `.updated`, `.settings_changed` still planned |
| API Key | 6 | 0 registered enum values emitted directly | Lifecycle events still planned; cascade examples above are additive reference-server payloads |
| Policy | 3 | 0 | All planned |
| Webhook | 6 | 6 lifecycle events (`webhook.created` / `.updated` / `.paused` / `.resumed` / `.disabled` / `.deleted`) from admin v0.1.25.39 + events v0.1.25.11 | All registered enum values emitted |
| System | 5 | 0 | All planned |
| **Total** | **47** | See category rows above | — |

For webhook delivery mechanics, retry schedule, and signature verification, see the [Webhook Event Delivery Protocol](/protocol/webhook-event-delivery-protocol).

For integration examples (PagerDuty, Slack, ServiceNow), see [Webhook Integrations](/how-to/webhook-integrations).
