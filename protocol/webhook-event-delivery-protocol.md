---
title: "Webhook Event Delivery Protocol"
description: "Complete reference for Cycles webhook delivery: 47 registered event types, HTTP headers, payload format, HMAC-SHA256 signing, retry policy, delivery status lifecycle, and at-least-once guarantees."
---

# Webhook Event Delivery Protocol

Cycles emits events when budget state changes and delivers them to webhook subscriptions via HTTP POST. This page is the authoritative reference for the delivery protocol.

## Delivery headers

Every webhook delivery includes these HTTP headers:

| Header | Value | Description |
|--------|-------|-------------|
| `Content-Type` | `application/json` | Always JSON |
| `X-Cycles-Signature` | `sha256=<hex>` | HMAC-SHA256 of the raw body using the subscription signing secret. If no secret was provided when the subscription was created, the server-generated secret is used. |
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
  "correlation_id": "batch_nightly_2026_04_18",
  "request_id": "req_789",
  "trace_id": "0af7651916cd43dd8448eb211c80319c",
  "metadata": {}
}
```

Fields `scope`, `actor`, `data`, `correlation_id`, `request_id`, `trace_id`, and `metadata` are optional (omitted when null).

**Correlation fields.** `request_id` narrows to one HTTP request; `trace_id` (32-hex W3C) narrows to one logical operation (may span many requests); `correlation_id` is operator-populated and groups a family of related events. See [Correlation and Tracing](/protocol/correlation-and-tracing-in-cycles).

## Event types (47)

The current v0.1.25 Admin API `EventType` enum registers 47 event types across seven categories: budget (16), reservation (5), tenant (6), api_key (6), policy (3), webhook (6), and system (5). Implementations may add future event types, and consumers should ignore unrecognized values gracefully.

### Budget events (16)

| Event Type | Trigger |
|------------|---------|
| `budget.created` | Budget ledger created |
| `budget.updated` | Budget ledger configuration changed |
| `budget.funded` | CREDIT, DEBIT, RESET, REPAY_DEBT, or RESET_SPENT funding operation |
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
| `budget.debt_incurred` | New debt created via ALLOW_WITH_OVERDRAFT commit |
| `budget.burn_rate_anomaly` | Spend rate exceeds baseline multiplier within the configured window |

### Reservation events (5)

| Event Type | Trigger |
|------------|---------|
| `reservation.denied` | Reservation rejected (budget exceeded, frozen, closed, debt outstanding) |
| `reservation.denial_rate_spike` | Denial rate exceeded threshold within window |
| `reservation.expired` | Reservation TTL expired without commit |
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

Tenants creating self-service webhooks via `/v1/webhooks` can subscribe to budget, reservation, and tenant events: 27 of the 47 registered event types. They will also receive the additive `_via_tenant_cascade` fan-out events that the reference admin server emits in those same categories on tenant close — see the next section. API key, policy, webhook lifecycle, and system events are admin-only.

### Tenant-close cascade fan-out

The reference implementation also emits cascade fan-out event names with the `_via_tenant_cascade` suffix as side effects of a `* → CLOSED` tenant transition (Rule 1 — Close Cascade). Treat these as additive implementation events and ignore any unrecognized event type gracefully:

- `budget.closed_via_tenant_cascade` — one per owned `BudgetLedger`.
- `reservation.released_via_tenant_cascade` — one per open owned reservation. Reason `tenant_closed`; no overage debt.
- `api_key.revoked_via_tenant_cascade` — one per owned API key.
- `webhook.disabled_via_tenant_cascade` — one per owned webhook subscription.

All four carry the `correlation_id` of the originating `tenant.closed` audit entry, letting subscribers correlate cascade side effects to the operator action that triggered them. The dashboard (v0.1.25.43+) renders a "tenant cascade" chip on audit and event-timeline rows with these suffixes.

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
| `dispatch:pending` | LIST | Admin (LPUSH) | Events (BRPOP) | Delivery IDs awaiting processing |
| `dispatch:retry` | ZSET | Events (ZADD) | Events (ZRANGEBYSCORE) | Retry queue (score = timestamp) |
| `delivery:{id}` | STRING | Admin (SET) | Events (GET/SET) | Delivery record JSON (14-day TTL) |
| `event:{id}` | STRING | Admin (SET) | Events (GET) | Event record JSON (90-day TTL) |
| `webhook:{id}` | STRING | Admin (SET) | Events (GET/SET) | Subscription JSON |
| `webhook:secret:{id}` | STRING | Admin (SET, encrypted) | Events (GET, decrypts) | AES-256-GCM encrypted signing secret |

## Next steps

- [Webhook Integrations](/how-to/webhook-integrations) — PagerDuty, Slack, ServiceNow examples with signature verification code
- [Managing Webhooks](/how-to/managing-webhooks) — create, update, test, and replay webhooks
- [Deploying the Events Service](/quickstart/deploying-the-events-service) — setup and configuration
- [Cycles Security](/security#webhook-security) — SSRF protection, encryption, and at-least-once delivery
