---
title: Managing Webhooks
description: Create, test, monitor, troubleshoot, and manage webhook subscriptions in Cycles
---

# Managing Webhooks

This guide covers the full webhook lifecycle: creating subscriptions, testing connectivity, monitoring delivery health, handling failures, rotating secrets, and replaying events.

::: tip Webhook operations from the dashboard
Every action in this guide — create, test, replay, pause/enable, reset failures, delete — is also available on the Webhooks page in the [Cycles Admin Dashboard](/quickstart/deploying-the-cycles-dashboard). The dashboard shows subscription health (green/yellow/red), recent delivery history, and supports **bulk pause / enable** with tenant filtering. Use the dashboard for day-two operations and the curl examples below for automation.
:::

## Creating a Webhook Subscription

### Admin subscription

Required fields: `url` and `event_types` (at least one event type on create). Add `?tenant_id=acme-corp` to scope the subscription to a specific tenant; omit for system-wide subscriptions (all tenants). All other fields are optional — the server provides sensible defaults (`signing_secret` is auto-generated if omitted). On update (`PATCH`), `event_types` may be cleared to empty as long as `event_categories` is non-empty (a category-only subscription); the server rejects only the empty-both state.

```bash
# Tenant-scoped subscription (receives events for acme-corp only)
curl -X POST 'http://localhost:7979/v1/admin/webhooks?tenant_id=acme-corp' \
  -H "X-Admin-API-Key: $ADMIN_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "url": "https://your-endpoint.example.com/cycles-webhook",
    "event_types": ["budget.exhausted", "budget.over_limit_entered", "reservation.denied"],
    "retry_policy": {
      "max_retries": 5,
      "initial_delay_ms": 1000,
      "backoff_multiplier": 2.0,
      "max_delay_ms": 60000
    },
    "disable_after_failures": 10
  }'
```

The response includes the `subscription_id` and `signing_secret`. **Store the signing secret securely** — it's returned only once.

```json
{
  "subscription": {
    "subscription_id": "whsub_abc123...",
    "status": "ACTIVE",
    "consecutive_failures": 0,
    ...
  },
  "signing_secret": "your-secret-here"
}
```

### Auto-generated signing secret

If you omit `signing_secret`, the server generates a cryptographically random one:

```bash
curl -X POST http://localhost:7979/v1/admin/webhooks \
  -H "X-Admin-API-Key: $ADMIN_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "url": "https://your-endpoint.example.com/webhook",
    "event_types": ["budget.exhausted"]
  }'
```

The generated secret (e.g., `whsec_dGVzdC1zZWNy...`) is in the response. Copy it immediately.

### Category-based subscriptions

Subscribe to **all events in a category** using `event_categories`. This is additive with `event_types` — if you specify both, you get the union. Note: on **create**, `event_types` must be non-empty, so include a representative type alongside the category wildcard. (A later `PATCH` may clear `event_types` to leave a category-only subscription; the server rejects only the state where both arrays are empty.)

```bash
# All budget events (17 types) + all reservation events (6 types)
curl -X POST http://localhost:7979/v1/admin/webhooks \
  -H "X-Admin-API-Key: $ADMIN_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "url": "https://your-endpoint.example.com/webhook",
    "event_types": ["budget.created"],
    "event_categories": ["budget", "reservation"]
  }'
```

> **Note:** Category subscriptions receive future event types added to that category in new releases, without subscription changes.

### Scope filtering

Narrow events to specific scopes:

```bash
# Only events for the prod workspace
curl -X POST http://localhost:7979/v1/admin/webhooks \
  -H "X-Admin-API-Key: $ADMIN_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "url": "https://your-endpoint.example.com/webhook",
    "event_types": ["budget.exhausted"],
    "scope_filter": "tenant:acme-corp/workspace:prod/*"
  }'
```

### Tenant-scoped subscriptions

Subscribe to events for a specific tenant by passing `tenant_id` as a query parameter:

```bash
curl -X POST "http://localhost:7979/v1/admin/webhooks?tenant_id=acme-corp" \
  -H "X-Admin-API-Key: $ADMIN_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "url": "https://acme-corp.example.com/webhook",
    "event_types": ["budget.exhausted", "reservation.denied"]
  }'
```

Omit `tenant_id` for system-wide subscriptions (receives events from all tenants).

## Testing a Webhook

Before relying on a webhook, verify connectivity:

```bash
curl -X POST http://localhost:7979/v1/admin/webhooks/whsub_abc123/test \
  -H "X-Admin-API-Key: $ADMIN_KEY"
```

Response:

```json
{
  "success": true,
  "response_status": 200,
  "response_time_ms": 42,
  "event_id": "evt_test_abc123"
}
```

The test sends a `system.webhook_test` event to the subscription's URL. It does **not** count toward consecutive failures or affect subscription status.

## Listing Subscriptions

```bash
# All subscriptions
curl http://localhost:7979/v1/admin/webhooks \
  -H "X-Admin-API-Key: $ADMIN_KEY"

# Filter by status
curl "http://localhost:7979/v1/admin/webhooks?status=DISABLED" \
  -H "X-Admin-API-Key: $ADMIN_KEY"

# Filter by tenant
curl "http://localhost:7979/v1/admin/webhooks?tenant_id=acme-corp" \
  -H "X-Admin-API-Key: $ADMIN_KEY"
```

## Monitoring Delivery Health

### Check delivery history

```bash
curl "http://localhost:7979/v1/admin/webhooks/whsub_abc123/deliveries?status=FAILED&limit=10" \
  -H "X-Admin-API-Key: $ADMIN_KEY"
```

Response shows delivery attempts with status, response code, and error details:

```json
{
  "deliveries": [
    {
      "delivery_id": "del_xyz789",
      "event_id": "evt_abc123",
      "event_type": "budget.exhausted",
      "status": "FAILED",
      "attempts": 6,
      "response_status": 503,
      "error_message": "HTTP 503",
      "attempted_at": "2026-04-01T12:00:00Z",
      "completed_at": "2026-04-01T12:05:32Z"
    }
  ],
  "has_more": false
}
```

### Check subscription health

```bash
curl http://localhost:7979/v1/admin/webhooks/whsub_abc123 \
  -H "X-Admin-API-Key: $ADMIN_KEY"
```

Key fields to monitor:
- `consecutive_failures` — number of deliveries that failed in a row (resets to 0 on any success)
- `status` — `ACTIVE`, `PAUSED`, or `DISABLED`
- `last_success_at` — when the last delivery succeeded
- `last_failure_at` — when the last delivery failed

### Redis queue depth

```bash
# Pending deliveries (waiting for events service to process)
redis-cli LLEN dispatch:pending

# Deliveries in retry queue
redis-cli ZCARD dispatch:retry
```

If `dispatch:pending` grows continuously, the events service may be down or overwhelmed.

### Prometheus metrics (v0.1.25.6+)

The events service publishes webhook delivery metrics on `/actuator/prometheus` (management port `9980`, which is unauthenticated in the reference deployment — restrict it at the network layer) under the `cycles_webhook_*` namespace. The operationally most useful alerts:

- **`cycles_webhook_subscription_auto_disabled_total`** — any increase means a receiver has gone from healthy to dead. Page on `rate(cycles_webhook_subscription_auto_disabled_total[5m]) > 0`.
- **`cycles_webhook_delivery_failed_total`** — failed delivery attempts, tagged by `reason`. The reason values are `event_not_found`, `subscription_not_found`, `subscription_inactive`, `http_4xx`, `http_5xx`, `transport_error`, and `ssrf_blocked`. Spikes in `http_5xx` or `transport_error` (connect/read timeouts, DNS failures) signal either a widespread receiver outage or a configuration regression.
- **`cycles_webhook_delivery_stale_total`** — non-zero means the `MAX_DELIVERY_AGE_MS` gate (default 24h) is firing. Usually benign after an events-service outage; persistently firing means dispatch is not catching up.
- **`cycles_webhook_delivery_latency_seconds`** — Timer with `outcome` tag. Percentile histograms are not enabled by default, so no `_bucket` series exist and `histogram_quantile()` won't work out of the box — watch `cycles_webhook_delivery_latency_seconds_max` and the `_sum`/`_count` average instead. A creeping `_max` is often the first signal that a receiver is degrading before it starts outright failing. (To get true percentiles, enable percentile histograms for this timer via Micrometer configuration.)

See [Deploying the Events Service](/quickstart/deploying-the-events-service#prometheus-metrics) for the full metric inventory.

## Handling Failures

### Subscription statuses

| Status | Meaning | Deliveries | How to fix |
|---|---|---|---|
| `ACTIVE` | Normal operation | Delivering | — |
| `PAUSED` | Manually paused | **Not queued** — events emitted during the pause are dropped for this subscription, not held for later | `PATCH` status to `ACTIVE`, then [replay](#replaying-events) the pause window to backfill |
| `DISABLED` | Auto-disabled after consecutive failures | **Not queued** | Fix endpoint, then `PATCH` status to `ACTIVE`; replay to backfill |

### Re-enabling a disabled subscription

When a subscription is auto-disabled (e.g., 10 consecutive failures), fix the underlying issue first, then:

```bash
curl -X PATCH http://localhost:7979/v1/admin/webhooks/whsub_abc123 \
  -H "X-Admin-API-Key: $ADMIN_KEY" \
  -H "Content-Type: application/json" \
  -d '{"status": "ACTIVE"}'
```

This resets `consecutive_failures` to 0 and resumes delivery.

### Pausing and resuming

```bash
# Pause (e.g., during maintenance)
curl -X PATCH http://localhost:7979/v1/admin/webhooks/whsub_abc123 \
  -H "X-Admin-API-Key: $ADMIN_KEY" \
  -H "Content-Type: application/json" \
  -d '{"status": "PAUSED"}'

# Resume
curl -X PATCH http://localhost:7979/v1/admin/webhooks/whsub_abc123 \
  -H "X-Admin-API-Key: $ADMIN_KEY" \
  -H "Content-Type: application/json" \
  -d '{"status": "ACTIVE"}'
```

## Updating a Subscription

Partial update — only provided fields change:

```bash
# Change URL
curl -X PATCH http://localhost:7979/v1/admin/webhooks/whsub_abc123 \
  -H "X-Admin-API-Key: $ADMIN_KEY" \
  -H "Content-Type: application/json" \
  -d '{"url": "https://new-endpoint.example.com/webhook"}'

# Change event types (replaces, does not merge)
curl -X PATCH http://localhost:7979/v1/admin/webhooks/whsub_abc123 \
  -H "X-Admin-API-Key: $ADMIN_KEY" \
  -H "Content-Type: application/json" \
  -d '{"event_types": ["budget.exhausted", "reservation.commit_overage", "reservation.denied"]}'

# Switch to a category-only subscription: clear event_types, keep categories.
# Valid on update (unlike create); the server rejects only the empty-both state.
curl -X PATCH http://localhost:7979/v1/admin/webhooks/whsub_abc123 \
  -H "X-Admin-API-Key: $ADMIN_KEY" \
  -H "Content-Type: application/json" \
  -d '{"event_types": [], "event_categories": ["budget", "reservation"]}'

# Adjust retry policy
curl -X PATCH http://localhost:7979/v1/admin/webhooks/whsub_abc123 \
  -H "X-Admin-API-Key: $ADMIN_KEY" \
  -H "Content-Type: application/json" \
  -d '{"retry_policy": {"max_retries": 10, "max_delay_ms": 120000}}'
```

## Rotating Signing Secrets

To rotate the HMAC signing secret:

```bash
curl -X PATCH http://localhost:7979/v1/admin/webhooks/whsub_abc123 \
  -H "X-Admin-API-Key: $ADMIN_KEY" \
  -H "Content-Type: application/json" \
  -d '{"signing_secret": "new-secret-value"}'
```

**Rotation procedure:**
1. Generate new secret
2. Update the subscription with the new secret
3. Update the receiver to accept both old and new signatures (dual verification)
4. Once all in-flight retries with the old secret complete, remove old secret from receiver

## Replaying Events

Re-deliver historical events to a subscription (e.g., after fixing a broken endpoint):

```bash
curl -X POST http://localhost:7979/v1/admin/webhooks/whsub_abc123/replay \
  -H "X-Admin-API-Key: $ADMIN_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "from": "2026-04-01T00:00:00Z",
    "to": "2026-04-01T23:59:59Z",
    "max_events": 100
  }'
```

Response:

```json
{
  "replay_id": "replay_abc123",
  "events_queued": 47,
  "estimated_completion_seconds": 5
}
```

Filter by event type:

```bash
curl -X POST http://localhost:7979/v1/admin/webhooks/whsub_abc123/replay \
  -H "X-Admin-API-Key: $ADMIN_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "from": "2026-04-01T00:00:00Z",
    "to": "2026-04-01T23:59:59Z",
    "event_types": ["budget.exhausted"],
    "max_events": 1000
  }'
```

## Deleting a Subscription

```bash
curl -X DELETE http://localhost:7979/v1/admin/webhooks/whsub_abc123 \
  -H "X-Admin-API-Key: $ADMIN_KEY"
```

Returns `204 No Content`. Deletion is irreversible, and pending deliveries for the subscription are cancelled.

## Querying Events

Browse the event stream independent of webhooks:

```bash
# All events for a tenant
curl "http://localhost:7979/v1/admin/events?tenant_id=acme-corp&limit=20" \
  -H "X-Admin-API-Key: $ADMIN_KEY"

# Filter by type and time range
curl "http://localhost:7979/v1/admin/events?event_type=budget.exhausted&from=2026-04-01T00:00:00Z&to=2026-04-02T00:00:00Z" \
  -H "X-Admin-API-Key: $ADMIN_KEY"

# Get a single event by ID
curl http://localhost:7979/v1/admin/events/evt_abc123 \
  -H "X-Admin-API-Key: $ADMIN_KEY"
```

## Tenant Self-Service

Tenants manage their own webhooks via `/v1/webhooks` using `X-Cycles-API-Key`. The tenant is derived from the key; do not pass a tenant query parameter with tenant-scoped auth.

A tenant-owned subscription is restricted to **tenant-accessible** event classes — `budget.*`, `reservation.*`, `tenant.*` — for both `event_types` and `event_categories`; admin-only classes (`api_key.*`, `policy.*`, `webhook.*`, `system.*`) are rejected with `400 INVALID_REQUEST` (governance WEBHOOK SUBSCRIPTION INVARIANT 2). The same rule binds a tenant-owned row created via the admin plane (`POST /v1/admin/webhooks?tenant_id=X`) or admin-on-behalf-of — it is a property of the owning tenant, not the caller. To monitor a specific tenant's admin-only events, create a `__system__`-owned subscription (no `tenant_id`) and filter client-side on the envelope `tenant_id` — see [Tenant-accessible events](/protocol/webhook-event-delivery-protocol#tenant-accessible-events).

```bash
# Create (restricted to budget.*, reservation.*, tenant.* events)
curl -X POST http://localhost:7979/v1/webhooks \
  -H "X-Cycles-API-Key: $TENANT_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "url": "https://acme.example.com/budget-alerts",
    "event_types": ["budget.exhausted", "reservation.denied"]
  }'

# List tenant's subscriptions
curl http://localhost:7979/v1/webhooks \
  -H "X-Cycles-API-Key: $TENANT_API_KEY"

# Get one subscription
curl http://localhost:7979/v1/webhooks/whsub_abc123 \
  -H "X-Cycles-API-Key: $TENANT_API_KEY"

# Pause or resume delivery
curl -X PATCH http://localhost:7979/v1/webhooks/whsub_abc123 \
  -H "X-Cycles-API-Key: $TENANT_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"status": "PAUSED"}'

# Send a test delivery to the subscription URL
curl -X POST http://localhost:7979/v1/webhooks/whsub_abc123/test \
  -H "X-Cycles-API-Key: $TENANT_API_KEY"

# Inspect delivery attempts
curl "http://localhost:7979/v1/webhooks/whsub_abc123/deliveries?status=FAILED&limit=10" \
  -H "X-Cycles-API-Key: $TENANT_API_KEY"

# Delete a subscription
curl -X DELETE http://localhost:7979/v1/webhooks/whsub_abc123 \
  -H "X-Cycles-API-Key: $TENANT_API_KEY"

# Query tenant's events
curl "http://localhost:7979/v1/events?event_type=budget.exhausted" \
  -H "X-Cycles-API-Key: $TENANT_API_KEY"
```

**Required permissions:** `webhooks:write` (create/update/delete/test), `webhooks:read` (list/get delivery history), `events:read` (query events). These are not included in default key permissions — they must be explicitly requested at key creation. See [API Key Permissions](/how-to/api-key-management-in-cycles#available-permissions-27-total) for the full list.

## Webhook URL Security

The events service always applies a delivery-time SSRF baseline unless its development-only escape hatch is enabled. It rejects `0.0.0.0/8`, `10.0.0.0/8`, `100.64.0.0/10`, `127.0.0.0/8`, `169.254.0.0/16`, `172.16.0.0/12`, `192.168.0.0/16`, `::1/128`, `fe80::/10`, `fc00::/7`, and any-local or unspecified addresses. Admin-configured CIDR blocks are additive; `allowed_url_patterns` only narrows accepted targets and cannot bypass the baseline.

To view and narrow the admin-side policy:

```bash
# View current security config
curl http://localhost:7979/v1/admin/config/webhook-security \
  -H "X-Admin-API-Key: $ADMIN_KEY"

# Restrict production delivery to an approved public endpoint
curl -X PUT http://localhost:7979/v1/admin/config/webhook-security \
  -H "X-Admin-API-Key: $ADMIN_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "allowed_url_patterns": ["https://hooks.example.com/cycles/*"],
    "blocked_cidr_ranges": ["10.0.0.0/8", "172.16.0.0/12", "192.168.0.0/16"]
  }'

# Enable HTTP at the admin boundary for development/testing
curl -X PUT http://localhost:7979/v1/admin/config/webhook-security \
  -H "X-Admin-API-Key: $ADMIN_KEY" \
  -H "Content-Type: application/json" \
  -d '{"allow_http": true, "blocked_cidr_ranges": []}'
```

Local or private-network delivery also requires
`WEBHOOK_URL_GUARD_ALLOW_PRIVATE_NETWORKS=true` on the events service and an events-service restart. Both that environment variable and `allow_http: true` are required for a private HTTP target. Never enable the private-network escape hatch in production.

## Next Steps

- [Webhook Integrations](/how-to/webhook-integrations) — PagerDuty, Slack, ServiceNow examples with signature verification
- [Webhooks and Events Concepts](/concepts/webhooks-and-events) — architecture, delivery semantics, event types
- [Security Hardening](/how-to/security-hardening) — encryption, SSRF, secret rotation
- [Production Operations](/how-to/production-operations-guide) — events service deployment and failure handling
