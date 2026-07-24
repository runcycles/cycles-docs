---
title: "Webhook Event Delivery Protocol"
description: "Complete reference for Cycles webhook delivery: 51 registered event types, HTTP headers, payload format, HMAC-SHA256 signing, retry policy, delivery status lifecycle, and at-least-once guarantees."
---

# Webhook Event Delivery Protocol

Cycles emits events when budget state changes and delivers them to webhook subscriptions via HTTP POST. This page is the authoritative reference for the delivery protocol.

## Delivery headers

Every webhook delivery includes these HTTP headers:

| Header | Value | Description |
|--------|-------|-------------|
| `Content-Type` | `application/json` | Always JSON |
| `X-Cycles-Signature` | `sha256=<hex>` | HMAC-SHA256 of the raw body using the subscription signing secret. Present whenever the subscription has a signing secret (if no secret was provided when the subscription was created, the server-generated secret is used); omitted when the subscription has no signing secret. |
| `X-Cycles-Event-Id` | `evt_abc123...` | Unique event ID. Use for deduplication. |
| `X-Cycles-Event-Type` | `budget.exhausted` | Dot-notation event type for routing. |
| `X-Cycles-Trace-Id` | `0af7651916cd43dd8448eb211c80319c` | 32-hex W3C Trace Context identifier for the logical operation this event belongs to. Always present on deliveries from v0.1.25.7+ events services. |
| `traceparent` | `00-<trace_id>-<16-hex-span>-<flags>` | W3C Trace Context v00. `trace_id` matches `X-Cycles-Trace-Id`. `span-id` is freshly generated per delivery (not reused from the inbound request). `trace-flags` preserves the inbound sampling decision when the originating request had a valid `traceparent`, otherwise defaults to `01` (sampled). Always present on v0.1.25.7+ events services. |
| `X-Request-Id` | `req-abc-123` | Present when the originating event carries `request_id`. Narrows to side effects of one HTTP request (vs. `X-Cycles-Trace-Id` which may span many). v0.1.25.7+ events services. |
| `User-Agent` | `cycles-server-events/0.1.25.x` | Service identifier and version. Exact patch suffix tracks the shipped events-service build. |
| Custom headers | Per subscription | From the subscription's `headers` map. |

See [Correlation and Tracing](/protocol/correlation-and-tracing-in-cycles) for the full contract on `trace_id` precedence and propagation.

## Payload format

The body is a JSON-serialized Event object:

```json
{
  "event_id": "evt_a1b2c3d4e5f6",
  "event_type": "budget.exhausted",
  "category": "budget",
  "timestamp": "2026-04-01T12:00:00Z",
  "tenant_id": "acme-corp",
  "scope": "tenant:acme-corp/workspace:prod",
  "source": "cycles-admin",
  "actor": {
    "type": "api_key",
    "key_id": "key_abc123",
    "source_ip": "10.0.1.50"
  },
  "data": {
    "ledger_id": "led_xyz",
    "scope": "tenant:acme-corp/workspace:prod",
    "unit": "TOKENS",
    "allocated": 10000,
    "remaining": 0,
    "spent": 10000
  },
  "correlation_id": "3f2a9c14e0b7d5a1",
  "request_id": "req_789",
  "trace_id": "0af7651916cd43dd8448eb211c80319c",
  "metadata": {}
}
```

Fields `scope`, `actor`, `data`, `correlation_id`, `request_id`, `trace_id`, and `metadata` are optional (omitted when null).

**Correlation fields.** `request_id` narrows to one HTTP request; `trace_id` (32-hex W3C) joins related requests when the caller propagates the same context. `correlation_id` is server-managed: the runtime YAML requires deterministic event-cluster hashes, but the current reference runtime leaves the field absent on its implemented emits; selected admin operations populate explicit IDs such as `webhook_create:<id>` and `webhook_bulk_action:<action>:<request_id>`. See [Correlation and Tracing](/protocol/correlation-and-tracing-in-cycles).

## Event types (51)

The current v0.1.25 Admin API `EventType` enum registers 51 event types across seven categories: budget (17), reservation (6), tenant (6), api_key (7), policy (3), webhook (7), and system (5). Implementations may add future event types, and consumers should ignore unrecognized values gracefully. The per-category tables below list the 47 non-cascade types; the four `*_via_tenant_cascade` types (one each in the budget, reservation, api_key, and webhook categories, added to the enum in governance revision v0.1.25.35) are covered in [Tenant-close cascade fan-out](#tenant-close-cascade-fan-out).

Registration does not guarantee emission. The trigger tables describe each registered type's contract; consult the [Event Payloads Reference](/protocol/event-payloads-reference) for the current reference-service emission matrix before subscribing.

::: info Count note
The 51-type / 7-category count tracks the admin OpenAPI enum. The runtime spec's webhook-event guidance section in `cycles-protocol-v0.yaml` lists 35 event types across 6 categories — it predates the `webhook` lifecycle category and some later enum additions.
:::

### Budget events (16)

| Event Type | Trigger |
|------------|---------|
| `budget.created` | Budget ledger created |
| `budget.updated` | Budget ledger configuration changed |
| `budget.funded` | CREDIT funding operation |
| `budget.debited` | Budget debited (funds removed) |
| `budget.reset` | Budget resized (`allocated` changed; `spent`/`reserved`/`debt` preserved) |
| `budget.reset_spent` | New billing period started (`allocated` set; `spent` cleared or explicitly set; `reserved`/`debt` preserved) |
| `budget.debt_repaid` | Outstanding debt repaid |
| `budget.frozen` | Budget set to FROZEN status (no new reservations) |
| `budget.unfrozen` | Budget restored to ACTIVE from FROZEN |
| `budget.closed` | Budget permanently closed (operator action) |
| `budget.threshold_crossed` | Utilization crossed a configured threshold (e.g., 80%, 95%) |
| `budget.exhausted` | Remaining budget reached zero |
| `budget.over_limit_entered` | Debt exceeded overdraft limit |
| `budget.over_limit_exited` | Debt dropped below overdraft limit |
| `budget.debt_incurred` | New debt created by an ALLOW_WITH_OVERDRAFT commit or direct debit |
| `budget.burn_rate_anomaly` | Spend rate exceeds baseline multiplier within the configured window |

### Reservation events (5)

| Event Type | Trigger |
|------------|---------|
| `reservation.denied` | A dry-run reservation or `/v1/decide` evaluation returned `DENY`; current live 4xx reservation errors do not emit this event |
| `reservation.denial_rate_spike` | Denial rate exceeded threshold within window |
| `reservation.expired` | Reservation TTL expired without commit or release |
| `reservation.expiry_rate_spike` | Expiry rate exceeded threshold within window |
| `reservation.commit_overage` | Commit actual exceeded reserved estimate |

### Tenant events (6)

| Event Type | Trigger |
|------------|---------|
| `tenant.created` | New tenant provisioned |
| `tenant.updated` | Tenant configuration changed |
| `tenant.suspended` | Tenant set to SUSPENDED (blocks new reservations) |
| `tenant.reactivated` | Tenant restored to ACTIVE from SUSPENDED |
| `tenant.closed` | Tenant permanently closed |
| `tenant.settings_changed` | Tenant settings (TTL, overage policy, etc.) modified |

### API key events (6)

| Event Type | Trigger |
|------------|---------|
| `api_key.created` | New API key generated |
| `api_key.revoked` | API key permanently revoked (operator action) |
| `api_key.expired` | API key reached its expiration date |
| `api_key.permissions_changed` | API key permissions modified |
| `api_key.auth_failed` | Authentication attempt with invalid key |
| `api_key.auth_failure_rate_spike` | Auth failure rate exceeded threshold within window |

### Policy events (3)

| Event Type | Trigger |
|------------|---------|
| `policy.created` | New policy rule created |
| `policy.updated` | Policy configuration changed |
| `policy.deleted` | Policy removed |

### Webhook events (6)

| Event Type | Trigger |
|------------|---------|
| `webhook.created` | Webhook subscription created |
| `webhook.updated` | Webhook subscription configuration changed |
| `webhook.paused` | Webhook subscription paused by an operator |
| `webhook.resumed` | Webhook subscription resumed by an operator |
| `webhook.disabled` | Webhook subscription auto-disabled after delivery failures |
| `webhook.deleted` | Webhook subscription deleted |

### System events (5)

| Event Type | Trigger |
|------------|---------|
| `system.store_connection_lost` | Redis connection failed |
| `system.store_connection_restored` | Redis connection recovered |
| `system.high_latency` | Operation latency exceeded threshold |
| `system.webhook_delivery_failed` | Webhook delivery permanently failed |
| `system.webhook_test` | Test webhook sent via POST /v1/admin/webhooks/{id}/test |

### Tenant-accessible events

A webhook subscription **owned by a concrete tenant** can only carry — and can only receive — **tenant-accessible** event classes: `budget.*`, `reservation.*`, and `tenant.*` (29 of the 51 registered event types, including the `budget.*` and `reservation.*` cascade fan-out events the admin server emits on tenant close — see the next section). The **admin-only** classes — `api_key.*`, `policy.*`, `webhook.*`, and `system.*` — belong on subscriptions owned by the operator (the `__system__` owner), never on a tenant-owned row.

This is **governance WEBHOOK SUBSCRIPTION INVARIANT 2** (normative, cross-plane, spec revisions v0.1.25.38–.41): a subscription whose owning `tenant_id` is present and `!= "__system__"` MUST NOT carry an admin-only event type or category — *by any provisioning mechanism*. The invariant is a property of the **owning tenant**, not of the caller or the endpoint, so it holds under tenant self-service auth, admin-key, and admin-on-behalf-of alike. The rationale is confidentiality: the owning tenant controls that subscription's delivery URL and signing secret, and `event_categories` is additive with `event_types` in delivery matching, so an admin-only selector on a tenant-owned row would leak admin governance/security telemetry (`api_key` / `policy` / `webhook` / `system` events) to a tenant-controlled endpoint.

::: warning Enforced at three layers (issue #209)
The guarantee is defense-in-depth across the two services — verify your fleet is fully upgraded:
- **Write** — both provisioning planes reject an admin-only type or category on a concrete-tenant subscription with `400 INVALID_REQUEST`. The tenant self-service plane (`POST /v1/webhooks`, `PATCH /v1/webhooks/{subscription_id}`) since **cycles-server-admin 0.1.25.50** (governance v0.1.25.38); the admin plane (`POST /v1/admin/webhooks?tenant_id=X`, `PATCH /v1/admin/webhooks/{id}`) since **0.1.25.51** (governance v0.1.25.40) — update validates the *effective resulting* selectors (each array as it stands after the update — the request's value where provided, the stored value where omitted; `PATCH` replaces a supplied array, it does not merge), so a status-only reactivation validates the still-stored selectors and can't re-enable a disabled offender that holds admin-only ones. `__system__`-owned subscriptions are exempt (system-wide monitoring is legitimate).
- **Dispatch** — since **0.1.25.51**, live dispatch and replay skip any admin-only event per-event for a concrete-tenant subscription, fail-closed and independent of stored-selector correctness (a default-on startup reconciler additionally strips legacy admin-only selectors from stored non-`DISABLED` rows — best-effort hygiene, see below).
- **Last-mile delivery** — since **cycles-server-events 0.1.25.23**, the delivery worker re-checks the boundary immediately before every outbound POST (initial, retry, and recovered redeliveries), catching deliveries queued before the upgrade and every retry. **Rolling-deploy caveat:** this is a per-worker guarantee — airtight only once *all* delivery workers are on 0.1.25.23.

**Operators upgrading past 0.1.25.49 (admin) / 0.1.25.22 (events)** should audit existing tenant subscriptions for admin-only selectors. Confidentiality does not depend on the audit — the fail-closed dispatch and last-mile boundaries already withhold the events. As storage hygiene, 0.1.25.51 also runs a **default-on, best-effort startup reconciler** (`webhook.category-boundary.reconcile-on-startup`, default `true`) that strips admin-only selectors from stored non-`DISABLED` concrete-tenant rows and disables empty-both rows; it is not the security mechanism (dispatch already withholds the events, and a `DISABLED` row delivers nothing). The [0.1.25.50 release notes](https://github.com/runcycles/cycles-server-admin/releases/tag/v0.1.25.50) carry a `redis-cli`/`jq` recipe to find offenders manually.
:::

#### Monitoring a specific tenant's admin-only events

Because a tenant-owned subscription can no longer carry admin-only classes, per-tenant admin monitoring (e.g. one tenant's `api_key.*` or `policy.*` events pointed at an operator endpoint) moves to a **`__system__`-owned** subscription — create it via `POST /v1/admin/webhooks` with **no `tenant_id`** parameter. A `__system__`-owned subscription may carry admin-only selectors, so name the admin event types you want in `event_types` (create requires a non-empty `event_types` per INVARIANT 1); to cover whole admin categories, pair a representative admin type with `event_categories` (e.g. `event_types: ["api_key.created"]`, `event_categories: ["api_key", "policy"]`). Because `__system__` is in the dispatch union for every tenant, that subscription receives those admin events for **all** tenants; select the tenant you care about **client-side** on the delivered envelope's `tenant_id`.

`scope_filter` generally can't do the per-tenant narrowing here: `api_key.*`, `webhook.*`, and `system.*` events are **null-scoped**, and a `scope_filter` excludes null-scoped events, so it would deliver none of them. The one exception is `policy.*`, which carries a real tenant-bounded `scope` and so *can* be `scope_filter`ed if you only need policy events. For everything else, client-side `tenant_id` filtering is the general solution. The `__system__` row is operator-owned, so its URL and secret stay operator-controlled.

::: tip `/test` probe exception
The owner-triggered webhook test (`POST /v1/webhooks/{id}/test` and its admin twin) POSTs a single synthetic `system.webhook_test` connectivity event **directly** to the subscription's own endpoint, bypassing the dispatch queue. A tenant-owned subscription MAY receive its own test probe even though `system.webhook_test` is a `system.*` (admin-only) type — the payload is an owner-requested `{subscription_id, test:true}` ping carrying no governance telemetry, and the subscription's stored selectors are unchanged and still must satisfy INVARIANT 2. This exception is limited to the synthetic test event on the `/test` operations; no real `system.*`/`api_key.*`/`policy.*`/`webhook.*` event from the event stream reaches a tenant-owned subscription.
:::

### Tenant-close cascade fan-out

The admin server emits cascade fan-out events with the `_via_tenant_cascade` suffix as side effects of a `* → CLOSED` tenant transition (Rule 1 — Close Cascade). All four names are declared in the governance spec's `EventType` enum since document revision v0.1.25.35, so they count toward the 51 registered types and are filterable like any other lifecycle event. Emission is SHOULD-level in the spec (the matching per-object audit entries are a MUST), so non-reference servers may not emit them — keep ignoring unrecognized event types gracefully:

- `budget.closed_via_tenant_cascade` — one per owned `BudgetLedger`.
- `reservation.released_via_tenant_cascade` — a **ledger-level aggregate**: one per closed budget with `reserved > 0`, carrying `released_amount`. Reason `tenant_closed`; no overage debt.
- `api_key.revoked_via_tenant_cascade` — one per owned API key.
- `webhook.disabled_via_tenant_cascade` — one per owned webhook subscription.

All four carry a server-composed `correlation_id` of the form `tenant_close_cascade:<tenant_id>:<request_id>`, letting subscribers correlate cascade side effects to the operator action that triggered them (audit rows for the operation join via `request_id`/`trace_id`). The dashboard (v0.1.25.43+) renders a "tenant cascade" chip on audit and event-timeline rows with these suffixes.

See [Tenant-Close Cascade Semantics](/protocol/tenant-close-cascade-semantics) for the full Rule 1 / Rule 2 contract and Mode A / Mode B semantics.

## Delivery status lifecycle

<DeliveryStateMachine />

| Status | Meaning |
|--------|---------|
| `PENDING` | Queued for delivery, not yet attempted |
| `SUCCESS` | Delivered and received HTTP 2xx response |
| `RETRYING` | Failed but retries remain, scheduled for retry |
| `FAILED` | All retries exhausted or delivery expired |

## Retry policy

Failed deliveries are retried with exponential backoff:

```
delay = min(initial_delay_ms * backoff_multiplier ^ (attempt - 1), max_delay_ms)
```

| Setting | Default | Description |
|---------|---------|-------------|
| `max_retries` | 5 | Maximum retry attempts (6 total including first attempt) |
| `initial_delay_ms` | 1000 | Delay before first retry |
| `backoff_multiplier` | 2.0 | Multiplier applied per retry |
| `max_delay_ms` | 60000 | Maximum delay cap |

**Default retry schedule:** 1s, 2s, 4s, 8s, 16s (capped at 60s).

**Success criteria:** HTTP response status 200–299.

### Auto-disable

After `disable_after_failures` (default 10) consecutive delivery failures, the subscription status is set to `DISABLED`. The counter resets to 0 on any successful delivery. Disabled subscriptions must be manually re-enabled via `PATCH /v1/admin/webhooks/{id}`.

### Stale delivery handling

Deliveries older than `MAX_DELIVERY_AGE_MS` (default 24 hours) are automatically marked FAILED without attempting HTTP delivery. This prevents delivering stale events after a prolonged events service outage.

## Transport

Outbound webhook deliveries negotiate **HTTP/1.1 only** (no HTTP/2 / h2c). This was pinned in `cycles-server-events` v0.1.25.5 to close a silent body-drop bug against HTTP/2 reverse proxies that upgrade `http://` to h2c (closes `cycles-server-events#16`). Receivers behind HTTP/1.1-only proxies were unaffected; receivers behind HTTP/2-capable proxies gain consistent body delivery.

Response bodies are discarded (`HttpResponse.BodyHandlers.discarding()`) so large responses from misbehaving receivers don't pin memory.

## Signature verification

The `X-Cycles-Signature` header contains `sha256=<hex>` where `<hex>` is the HMAC-SHA256 of the raw JSON request body using the subscription's signing secret as the key.

**Verification steps:**

1. Read the raw request body as bytes (do not parse JSON first)
2. Compute HMAC-SHA256 using your copy of the signing secret
3. Compare `sha256=<computed_hex>` with the `X-Cycles-Signature` header using a constant-time comparison
4. Reject the request if they do not match

See [Webhook Integrations](/how-to/webhook-integrations#signature-verification) for implementation in Python, Node.js, Go, and Java.

## At-least-once delivery

Webhooks are delivered at least once. Duplicates can occur due to:

- Network retries (timeout before response received, but server processed it)
- Events service restart during delivery
- Event replay operations

**Deduplication:** Use the `X-Cycles-Event-Id` header as a deduplication key. Store processed event IDs with a short TTL (24h recommended) and skip events you have already seen.

## Redis keys

The events service uses these Redis data structures (shared with the admin server):

| Key | Type | Written By | Read By | Description |
|-----|------|-----------|---------|-------------|
| `dispatch:pending` | LIST | Admin (LPUSH) | Events (BLMOVE) | Delivery IDs awaiting processing |
| `dispatch:processing` | LIST | Events (BLMOVE) | Events (LREM / recovery) | Claimed delivery IDs retained until acknowledged |
| `dispatch:processing:claimed_at` | ZSET | Events | Events | Claim timestamps used for idle-gated crash recovery |
| `dispatch:processing:claim_owner` | HASH | Events | Events | Per-delivery claim-generation token that prevents a stale worker from acknowledging a successor's claim |
| `dispatch:ordering:lock` | STRING | Events | Events | Renewable owner token for the cross-replica claim/send critical section |
| `dispatch:retry` | ZSET | Events (ZADD) | Events (ZRANGEBYSCORE) | Retry queue (score = timestamp) |
| `dispatch:failed` | LIST | Events (LPUSH/LTRIM) | Operators | Bounded quarantine for corrupt delivery records |
| `delivery:{id}` | STRING | Admin (SET) | Events (GET/SET) | Delivery record JSON (14-day TTL) |
| `event:{id}` | STRING | Admin (SET) | Events (GET) | Event record JSON (90-day TTL) |
| `webhook:{id}` | STRING | Admin (SET) | Events (GET/SET) | Subscription JSON |
| `webhook:secret:{id}` | STRING | Admin (SET, encrypted) | Events (GET, decrypts) | AES-256-GCM encrypted signing secret |

## Next steps

- [Webhook Integrations](/how-to/webhook-integrations) — PagerDuty, Slack, ServiceNow examples with signature verification code
- [Managing Webhooks](/how-to/managing-webhooks) — create, update, test, and replay webhooks
- [Deploying the Events Service](/quickstart/deploying-the-events-service) — setup and configuration
- [Cycles Security](/security#webhook-security) — SSRF protection, encryption, and at-least-once delivery
