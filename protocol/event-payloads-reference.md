---
title: "Event Payloads Reference"
description: "Complete payload reference for all Cycles webhook events — currently emitted and planned. Includes JSON examples, field definitions, and trigger conditions."
---

# Event Payloads Reference

This page documents the payload structure for every webhook event Cycles can emit. Each event wraps a standard envelope with an event-specific `data` object.

::: info Currently Emitted Events
The v0.1.25 Admin API `EventType` enum registers **51 event types** total across seven categories (budget: 17, reservation: 6, tenant: 6, api_key: 7, policy: 3, webhook: 7, system: 5). Events marked as **Planned** below have their type registered in the protocol but are not yet emitted by any service.

**Registered enum values currently emitted** (count toward the 51 total):

- **Reservation:** `reservation.denied`, `reservation.expired`, `reservation.commit_overage` (runtime).
- **Budget:** runtime emits `budget.exhausted`, `budget.over_limit_entered`, and `budget.debt_incurred`; admin emits `budget.created`, `budget.updated`, `budget.frozen`, `budget.unfrozen`, `budget.funded`, `budget.debited`, `budget.reset`, `budget.reset_spent`, and `budget.debt_repaid`; tenant close emits `budget.closed_via_tenant_cascade`.
- **Tenant:** `tenant.created`, `tenant.updated` (current admin implementation); `tenant.suspended`, `tenant.reactivated`, `tenant.closed` (admin v0.1.25.38+, single-op + bulk-action paths).
- **API key:** `api_key.created`, `api_key.revoked`, and `api_key.auth_failed` (admin v0.1.25+); `api_key.permissions_changed` (admin v0.1.25.7+).
- **Policy:** `policy.created` and `policy.updated` (admin v0.1.25+).
- **Webhook:** `webhook.created`, `webhook.updated`, `webhook.paused`, `webhook.resumed`, `webhook.deleted` (admin v0.1.25.39+); `webhook.disabled` (events service auto-disable v0.1.25.11+). All six webhook lifecycle types were added in spec v0.1.25.33 — see the [Webhook Lifecycle Events](#webhook-lifecycle-events) section below.
- **System:** `system.webhook_test` is sent directly by the admin webhook-test endpoint; `system.webhook_delivery_failed` is persisted by the events service after retry exhaustion (events v0.1.25.21+).
- **Tenant-close cascade fan-out:** `budget.closed_via_tenant_cascade`, `reservation.released_via_tenant_cascade`, `api_key.revoked_via_tenant_cascade`, `webhook.disabled_via_tenant_cascade` (admin v0.1.25.35+; declared in the governance spec's enum since revision v0.1.25.35) — see [Tenant-Close Cascade Events](#tenant-close-cascade-events-governance-spec-v0-1-25-35) below.

Registered values not named above remain planned unless a later section says otherwise.

**Historical additive runtime payloads** (documented in the v0.1.25.3 release history, but not present in the current runtime `EventType` model or emitted by current controller paths):

- Reservation lifecycle samples: `reservation.reserved`, `reservation.committed`, `reservation.released`, `reservation.extended`.
- Runtime ledger application: `event.applied`.

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
| `correlation_id` | string | When applicable | Server-managed family key. The YAML requires deterministic runtime event clusters, but the current reference runtime leaves this absent on implemented runtime emits. Selected admin operations populate explicit IDs such as `webhook_create:<id>`, bulk-action IDs, and cascade IDs. |
| `request_id` | string | When provided | From `X-Request-Id` header on originating request |
| `trace_id` | string | When provided | W3C Trace Context-compatible correlation identifier (32 lowercase hex characters). Links the event to the originating request, its audit entry, and sibling events within the same logical operation. |
| `metadata` | object | When provided | Operator-defined key-value pairs |

---

## Reservation Events

### `reservation.reserved` — Historical Additive Payload (v0.1.25.3)

**Historical trigger:** A reservation was created successfully.

The current reference runtime does not emit this event. Query reservation state and keep application telemetry for successful reserve operations.

---

### `reservation.committed` — Historical Additive Payload (v0.1.25.3)

**Historical trigger:** A reservation was committed with actual spend recorded.

The current reference runtime does not emit this event. A commit that requests more than the estimate can emit `reservation.commit_overage`, and budget-state changes can emit the implemented budget events.

---

### `reservation.released` — Historical Additive Payload (v0.1.25.3)

**Historical trigger:** A reservation was cancelled.

The current reference runtime does not emit this event. An admin-on-behalf-of release does write its required audit entry; ordinary release state remains queryable through the reservation API.

---

### `reservation.extended` — Historical Additive Payload (v0.1.25.3)

**Historical trigger:** A reservation TTL was extended via heartbeat.

The current reference runtime does not emit this event. Query the reservation for current expiry state and log successful extensions in the application when needed.

---

### `reservation.denied` — Currently Emitted

**Trigger:** `POST /v1/decide` or a reservation request with `dry_run: true` returns `decision: DENY`.

**Emitted from:** `POST /v1/reservations` when the nonpersisting dry-run response is DENY, and `POST /v1/decide` when its response is DENY. A live reservation denial is an HTTP error such as `409 BUDGET_EXCEEDED`; the current controller does not emit `reservation.denied` for that exception path. Monitor `cycles_reservations_reserve_total{decision="DENY"}` or application errors for live denial rate.

```json
{
  "event_type": "reservation.denied",
  "data": {
    "scope": "tenant:acme-corp/workspace:prod/workflow:support",
    "unit": "USD_MICROCENTS",
    "reason_code": "BUDGET_EXCEEDED",
    "requested_amount": 500000,
    "remaining": 100000,
    "action": {
      "kind": "llm.chat",
      "name": "support-reply"
    },
    "subject": {
      "tenant": "acme-corp",
      "workspace": "prod",
      "workflow": "support"
    }
  }
}
```

::: tip Fields populated at emission time
The governance schema defines 9 fields. The current server emitter populates `scope`, `unit`, `reason_code`, `requested_amount`, `action`, and `subject`; a denied reservation dry run also derives `remaining` from returned balances, while `/decide` currently omits `remaining`. `policy_id` and `deny_detail` remain unpopulated.
:::

| Field | Type | Populated | Description |
|---|---|---|---|
| `scope` | string | Yes | Scope path that denied the reservation |
| `reason_code` | string | Yes | Why denied. Known values: `BUDGET_EXCEEDED`, `OVERDRAFT_LIMIT_EXCEEDED`, `DEBT_OUTSTANDING`, `BUDGET_FROZEN`, `BUDGET_CLOSED`, and — from cycles-server 0.1.25.47 (spec v0.1.25.13) — `TENANT_CLOSED` on fresh dry-run/decide DENYs for a closed owning tenant. Open string — extensions (v0.1.26+) may emit additional values such as `ACTION_QUOTA_EXCEEDED`, `ACTION_KIND_DENIED`, `ACTION_KIND_NOT_ALLOWED`. |
| `requested_amount` | number | Yes | Amount the reservation requested |
| `unit` | string | Yes | Budget unit (`USD_MICROCENTS`, `TOKENS`, `CREDITS`, `RISK_POINTS`) |
| `remaining` | number | Dry-run reserve only | Minimum remaining amount derived from returned balances; omitted by the current `/decide` emitter |
| `action` | object | Yes | Action metadata from the evaluation request |
| `subject` | object | Yes | Subject metadata from the evaluation request |
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

### Historical threshold aliases

Earlier v0.1.25.x builds documented additive `budget.approaching_limit`, `budget.at_limit`, and `budget.over_limit` aliases. They are not in the current runtime `EventType` model and the current `EventEmitterService` does not emit them. Use `budget.exhausted` for the implemented zero-remaining transition and calculate earlier utilization alerts from balances or metrics. The registered `budget.threshold_crossed` type remains unimplemented.

---

### `budget.reset_spent` — Currently Emitted (v0.1.25.18)

**Trigger:** An admin operator issues a `RESET_SPENT` funding operation on `POST /v1/admin/budgets/fund`.

**Emitted from:** `cycles-server-admin`. Distinct from `budget.reset` — `RESET` resizes the allocated ceiling and preserves `spent`; `RESET_SPENT` additionally clears (or overrides) `spent` for billing-period rollover.

The payload is an `EventDataBudgetLifecycle` with `spent` and `reserved` fields on `BudgetState`, plus an optional `spent_override_provided` boolean flag on the outer payload (`true` when the operator supplied an explicit `spent` value).

See [Rolling over billing periods with RESET_SPENT](/how-to/rolling-over-billing-periods-with-reset-spent) for operator guidance.

---

### `event.applied` — Historical Additive Payload (v0.1.25.3)

**Historical trigger:** A direct debit via `POST /v1/events` was applied successfully.

The current reference runtime does not emit `event.applied`. It returns the applied direct-debit response and can emit implemented budget-state events when that debit changes a ledger.

---

### `budget.exhausted` — Currently Emitted

**Trigger:** A budget's remaining amount transitions from above zero to zero after a reservation, commit, or direct debit.

**Emitted from:** `EventEmitterService.emitBalanceEvents()` (when pre-operation remaining is above zero and post-operation remaining is zero)

```json
{
  "event_type": "budget.exhausted",
  "data": {
    "scope": "tenant:acme-corp/workspace:prod",
    "unit": "USD_MICROCENTS",
    "threshold": 1.0,
    "utilization": 1.0,
    "allocated": 10000000,
    "remaining": 0,
    "spent": 9000000,
    "reserved": 1000000,
    "direction": "rising"
  }
}
```

| Field | Type | Description |
|---|---|---|
| `scope` | string | Affected scope path |
| `unit` | string | Budget unit |
| `threshold` | number | `1.0` for the implemented exhaustion transition |
| `utilization` | number | `(spent + reserved) / allocated` when allocated is positive |
| `allocated` | number | Current allocated amount |
| `remaining` | number | `0` for this event |
| `spent` | number | Current spent amount |
| `reserved` | number | Current reserved amount |
| `direction` | string | `rising` |

The envelope also identifies the tenant, actor, and request context. Query the balance API before remediation because later operations can change the ledger after the event is emitted.

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

**Trigger:** A reservation commit or direct debit creates new debt via `ALLOW_WITH_OVERDRAFT`.

**Emitted from:** `EventEmitterService.emitBalanceEvents()` (when new debt is created)

```json
{
  "event_type": "budget.debt_incurred",
  "data": {
    "scope": "tenant:acme-corp/workspace:prod",
    "unit": "USD_MICROCENTS",
    "reservation_id": "res_a1b2c3d4",
    "debt_incurred": 250000,
    "total_debt": 750000,
    "overdraft_limit": 1000000,
    "overage_policy": "ALLOW_WITH_OVERDRAFT"
  }
}
```

| Field | Type | Description |
|---|---|---|
| `scope` | string | Affected scope path |
| `unit` | string | Budget unit |
| `reservation_id` | string | Reservation whose commit caused the debt; omitted for a direct debit |
| `debt_incurred` | number | New debt created on this scope by the operation |
| `total_debt` | number | Total accumulated debt on this scope |
| `overdraft_limit` | number | Configured overdraft ceiling |
| `overage_policy` | string | Policy applied (`ALLOW_WITH_OVERDRAFT`) |

---

### Planned Budget Events

The following registered budget events are not emitted by the current reference services:

| Event Type | Trigger |
|---|---|
| `budget.closed` | Budget permanently closed |
| `budget.threshold_crossed` | Utilization crossed configured threshold (e.g., 80%, 95%) |
| `budget.over_limit_exited` | Debt dropped below overdraft limit after repayment |
| `budget.burn_rate_anomaly` | Spend rate exceeds baseline multiplier within window |

---

## Tenant-Close Cascade Events (governance spec v0.1.25.35+)

Four event kinds are emitted by the reference admin server as side effects of a `* → CLOSED` tenant transition (Rule 1 — Close Cascade; see [Tenant-Close Cascade Semantics](/protocol/tenant-close-cascade-semantics) for the full contract). All four share the `_via_tenant_cascade` suffix and carry a server-composed `correlation_id` of the form `tenant_close_cascade:<tenant_id>:<request_id>`, so subscribers can correlate cascade side effects to the operator action that triggered them (audit rows for the same operation join via `request_id`/`trace_id`).

These four event names are **declared in the governance spec's `EventType` enum** since document revision v0.1.25.35 (raising the registered enum to 51 values), so cascade Events validate against `Event.event_type` and can be targeted with `event_type=` filters and webhook `event_types` lists like any other lifecycle event. Note the normative strength: the per-object cascade **audit entries** are a MUST (their `event_kind` values are RESERVED in the spec), while emitting the corresponding Event-stream records is a SHOULD — so non-reference servers may not emit them, and consumers should still ignore unrecognized event types gracefully. Tenant self-service subscriptions filter by category, so a tenant subscribed to `budget` or `reservation` events will receive the corresponding cascade events from the reference server in practice.

Shipped in `cycles-server-admin` v0.1.25.35 (initial Mode B cascade) / v0.1.25.36 (full Rule 2 guard coverage).

All four kinds share one payload shape (`EventDataTenantCascade`, governance spec v0.1.25.35): exactly one of `ledger_id` / `subscription_id` / `key_id` identifies the transitioned object (matching the event's category), alongside `prior_status` / `new_status` and `cascade_reason: "tenant_closed"`. The reservation aggregate is the exception — it identifies the drained budget via `ledger_id` and carries `released_amount` instead of a status transition.

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
    "type": "admin"
  },
  "data": {
    "ledger_id": "led_...",
    "scope": "tenant:acme-corp/workspace:prod",
    "unit": "USD_MICROCENTS",
    "prior_status": "ACTIVE",
    "new_status": "CLOSED",
    "cascade_reason": "tenant_closed"
  },
  "correlation_id": "tenant_close_cascade:acme-corp:req_...",
  "trace_id": "<same as originating>"
}
```

### `reservation.released_via_tenant_cascade`

Emitted as a **ledger-level aggregate** when the tenant closes: one event per closed budget with `reserved > 0`, carrying the aggregate `released_amount` (not one per reservation). Reason `tenant_closed`; no overage debt is recorded; the full reserved amount returns to the (now-closed) budget's balance snapshot.

```json
{
  "event_id": "evt_...",
  "event_type": "reservation.released_via_tenant_cascade",
  "category": "reservation",
  "tenant_id": "acme-corp",
  "data": {
    "ledger_id": "led_...",
    "scope": "tenant:acme-corp/workspace:prod",
    "unit": "USD_MICROCENTS",
    "released_amount": 250000,
    "cascade_reason": "tenant_closed"
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
    "prior_status": "ACTIVE",
    "new_status": "REVOKED",
    "name": "production",
    "cascade_reason": "tenant_closed"
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
    "prior_status": "ACTIVE",
    "new_status": "DISABLED",
    "name": "ops-alerts",
    "cascade_reason": "tenant_closed"
  },
  "correlation_id": "tenant_close_cascade:acme-corp:req_...",
  "trace_id": "<same as originating>"
}
```

### Correlating cascade events

The shared `correlation_id` is the primary join key — querying `GET /v1/admin/events?correlation_id=...` returns every event emitted by the cascade in one call. The dashboard (v0.1.25.43+) renders a "tenant cascade" chip on audit and event-timeline rows with these suffixes. See [Using the Cycles Dashboard](/how-to/using-the-cycles-dashboard#closed-tenant-tombstone-and-cascade-preview).

**No emission-order guarantee.** The spec's ordering language covers the cascade's *mutations* (a SHOULD, and only within Mode A's single transaction — see [Tenant-Close Cascade Semantics](/protocol/tenant-close-cascade-semantics#the-two-rules)); it is silent on cascade *event emission* order. The reference implementation currently emits per budget — `budget.closed_via_tenant_cascade` then, for budgets with `reserved > 0`, the `reservation.released_via_tenant_cascade` aggregate, interleaved budget by budget — followed by webhook and API-key events, but this is implementation detail. Subscribers MUST NOT rely on arrival order (at-least-once webhook delivery can reorder and duplicate regardless — see [delivery mechanics](/protocol/webhook-event-delivery-protocol)); reconstruct the cascade by joining on the shared `correlation_id` instead.

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

Current services emit part of every category below. The tables distinguish direct lifecycle emission, synthetic test delivery, and values that remain registered-but-planned.

### Tenant Events (6 types — 5 currently emitted)

| Event Type | Status | Trigger |
|---|---|---|
| `tenant.created` | **Emitted** (current admin implementation) | New tenant provisioned |
| `tenant.updated` | **Emitted** (current admin implementation) | Tenant configuration changed |
| `tenant.suspended` | **Emitted** (admin v0.1.25.38+) | `PATCH /v1/admin/tenants/{id}` or `bulk-action` sets status to `SUSPENDED` |
| `tenant.reactivated` | **Emitted** (admin v0.1.25.38+) | `PATCH /v1/admin/tenants/{id}` or `bulk-action` restores status to `ACTIVE` |
| `tenant.closed` | **Emitted** (admin v0.1.25.38+) | `PATCH /v1/admin/tenants/{id}` or `bulk-action` sets status to `CLOSED` — also triggers the four `_via_tenant_cascade` events documented above |
| `tenant.settings_changed` | Planned | Tenant default settings modified |

### API Key Events (6 base types, plus the tenant-cascade event)

| Event Type | Status | Trigger |
|---|---|---|
| `api_key.created` | **Emitted** (admin v0.1.25+) | New API key generated |
| `api_key.revoked` | **Emitted** (admin v0.1.25+) | API key permanently revoked |
| `api_key.expired` | Planned | API key reached expiration date |
| `api_key.permissions_changed` | **Emitted** (admin v0.1.25.7+) | API key permissions modified |
| `api_key.auth_failed` | **Emitted** (admin v0.1.25+) | Authentication attempt failed |
| `api_key.auth_failure_rate_spike` | Planned | Auth failure rate exceeded threshold |

`api_key.revoked_via_tenant_cascade` is emitted separately by admin v0.1.25.35+ when tenant close revokes owned keys.

### Policy Events (3 types — 2 currently emitted)

| Event Type | Status | Trigger |
|---|---|---|
| `policy.created` | **Emitted** (admin v0.1.25+) | New policy rule created |
| `policy.updated` | **Emitted** (admin v0.1.25+) | Policy configuration changed |
| `policy.deleted` | Planned | Policy removed |

### System Events (5 types — 2 currently produced)

| Event Type | Status | Trigger |
|---|---|---|
| `system.store_connection_lost` | Planned | Redis connection failed |
| `system.store_connection_restored` | Planned | Redis connection recovered |
| `system.high_latency` | Planned | Server-side p99 latency exceeded threshold |
| `system.webhook_delivery_failed` | **Emitted** (events v0.1.25.21+) | Webhook delivery permanently failed after all retries; persisted as a loop-safe meta-event rather than recursively delivered |
| `system.webhook_test` | **Sent directly** (current admin implementation) | Admin-initiated synthetic connectivity test; not queued as an ordinary stored event |

---

## Event Emission Summary

| Category | Total Defined | Currently Emitted | Notes |
|---|---|---|---|
| Reservation | 6 | `reservation.denied`, `reservation.expired`, and `reservation.commit_overage` emitted by runtime paths; the cascade aggregate (`reservation.released_via_tenant_cascade`, spec-declared since governance v0.1.25.35) emitted by the admin server on tenant close | Spike events still planned |
| Budget | 17 | Runtime exhaustion/over-limit/debt events; admin create/update/freeze/unfreeze/funding events; `budget.closed_via_tenant_cascade` on tenant close | `budget.closed`, `budget.threshold_crossed`, `budget.over_limit_exited`, and `budget.burn_rate_anomaly` are not emitted |
| Tenant | 6 | `tenant.created`, `tenant.updated`, `tenant.suspended`, `tenant.reactivated`, and `tenant.closed` emitted by the current admin service | `tenant.settings_changed` still planned |
| API Key | 7 | `api_key.created`, `.revoked`, `.permissions_changed`, `.auth_failed`, plus `.revoked_via_tenant_cascade` | Expiry and rate-spike events still planned |
| Policy | 3 | `policy.created`, `policy.updated` | `policy.deleted` still planned |
| Webhook | 7 | 6 lifecycle events (`webhook.created` / `.updated` / `.paused` / `.resumed` / `.disabled` / `.deleted`) from admin v0.1.25.39 + events v0.1.25.11, plus `webhook.disabled_via_tenant_cascade` (spec-declared since v0.1.25.35) on tenant close | All registered enum values emitted |
| System | 5 | `system.webhook_delivery_failed` persisted by the events service; `system.webhook_test` delivered directly by the admin test endpoint | Store-connection and high-latency events still planned |
| **Total** | **51** | See category rows above | — |

For webhook delivery mechanics, retry schedule, and signature verification, see the [Webhook Event Delivery Protocol](/protocol/webhook-event-delivery-protocol).

For integration examples (PagerDuty, Slack, ServiceNow), see [Webhook Integrations](/how-to/webhook-integrations).
