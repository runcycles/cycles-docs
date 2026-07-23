---
title: "Deploying the Events Service"
description: "How to deploy the Cycles events service (cycles-server-events) for async webhook delivery and CyclesEvidence signing."
---

# Deploying the Events Service

The events service (`cycles-server-events`) has two async jobs: webhook delivery and CyclesEvidence signing. Use webhook delivery to get real-time alerts in Slack, PagerDuty, or your own systems when budgets run out, thresholds are crossed, or reservations are denied. Use CyclesEvidence signing when runtime responses need verifiable audit receipts.

As of v0.1.25.9 the service binds two ports: the application port `7980` and a separate management port `9980` for actuator endpoints (`/actuator/health`, `/actuator/info`, `/actuator/prometheus`). The current reference service is an outbound worker; webhook delivery and evidence signing do not require inbound application traffic. Keep `9980` internal-only for health checks and Prometheus scraping, and do not publish `7980` unless your deployment has an explicit internal control-plane use for that app port.

It is optional — the admin and runtime servers operate normally without it. When deployed, it consumes delivery jobs from Redis and sends HTTP POST requests to webhook endpoints with HMAC-SHA256 signatures. If CyclesEvidence is enabled, it also consumes evidence-source records from Redis, signs envelopes with Ed25519, and stores them by content hash for `GET /v1/evidence/{id}`.

## Quick start with Docker

If you already have the full stack running via [Deploying the Full Cycles Stack](/quickstart/deploying-the-full-cycles-stack), uncomment the `cycles-events` block in your `docker-compose.yml` and restart. Otherwise, use the full-stack compose from the admin repo:

```bash
# From the cycles-server-admin directory
export WEBHOOK_SECRET_ENCRYPTION_KEY=$(openssl rand -base64 32)
docker compose -f docker-compose.full-stack.yml up
```

Services: Redis (6379), Admin (7979), Runtime (7878), Events app port (7980), Events management/actuator (9980).

Note that the admin repo's dev full-stack compose publishes the app port `7980` but not the management port `9980` — the actuator endpoints are only reachable from inside the compose network unless you add a `9980:9980` port mapping.

## Standalone deployment

### From pre-built image

```bash
docker run -d --name cycles-events \
  -e REDIS_HOST=redis.example.com \
  -e REDIS_PORT=6379 \
  -e REDIS_PASSWORD=your-redis-password \
  -e WEBHOOK_SECRET_ENCRYPTION_KEY=your-base64-key \
  ghcr.io/runcycles/cycles-server-events:0.1.25.25
```

The service does not need inbound traffic from applications or webhook targets; it sends webhook HTTP requests outbound. For local inspection, temporarily add `-p 9980:9980` and query the management endpoint from the host. In production, scrape `9980` from Prometheus on an internal network path and leave `7980` unpublished unless you have a specific internal use for the app port.

### From JAR

```bash
REDIS_HOST=redis.example.com \
REDIS_PORT=6379 \
REDIS_PASSWORD=your-redis-password \
WEBHOOK_SECRET_ENCRYPTION_KEY=your-base64-key \
java -jar cycles-server-events-*.jar
```

## Configuration

### Required

| Variable | Description |
|----------|-------------|
| `REDIS_HOST` | Redis hostname (shared with admin and runtime servers) |
| `REDIS_PORT` | Redis port (default: 6379) |
| `REDIS_PASSWORD` | Redis password (empty for no auth) |

### Recommended

| Variable | Default | Description |
|----------|---------|-------------|
| `WEBHOOK_SECRET_ENCRYPTION_KEY` | (required by default) | AES-256-GCM key for signing secret decryption. Base64-encoded 32 bytes. Must match admin and runtime. Generate: `openssl rand -base64 32`. A missing key fails startup unless the local/development-only `WEBHOOK_SECRET_ALLOW_PLAINTEXT=true` escape hatch is set. |

### Optional: CyclesEvidence signing

Configure these only when runtime responses should include verifiable `cycles_evidence` references. The public identity must match the runtime server's `EVIDENCE_SERVER_ID` and `EVIDENCE_SIGNING_SIGNER_DID`; the private key belongs only on `cycles-server-events`.

| Variable | Description |
|----------|-------------|
| `EVIDENCE_SERVER_ID` | Issuer base URL including `/v1`, for example `https://cycles.example.com/v1`. Blank disables evidence signing; pending source records are left untouched, not dead-lettered. |
| `EVIDENCE_SIGNING_SIGNER_DID` | Raw-hex Ed25519 public key. Must match the runtime server's public signer identity. |
| `EVIDENCE_SIGNING_PRIVATE_KEY_HEX` | Raw-hex Ed25519 private key. Keep this secret and deploy it only to `cycles-server-events`. |

The runtime server also publishes public JWKS metadata with `EVIDENCE_SIGNING_KID`, `EVIDENCE_SIGNING_NBF_MS`, and `EVIDENCE_SIGNING_RETIRED_KEYS`. Those variables are not read by the events service.

### Tuning

| Variable | Default | Description |
|----------|---------|-------------|
| `dispatch.pending.timeout-seconds` | 5 | BLMOVE blocking timeout for the delivery queue (seconds; property, not env var) |
| `dispatch.retry.poll-interval-ms` | 5000 | How often to check for ready retries (ms; property, not env var) |
| `dispatch.http.timeout-seconds` | 30 | HTTP request timeout for webhook delivery (property, not env var) |
| `dispatch.http.connect-timeout-seconds` | 5 | HTTP connect timeout (property, not env var) |
| `RETRY_BATCH_SIZE` | 100 | Max due retries claimed per retry poll |
| `DISPATCH_PROCESSING_RECOVERY_IDLE_MS` | 180000 | Idle window before in-flight deliveries on the processing list are recovered back to pending |
| `MANAGEMENT_PORT` | 9980 | Separate management port for the actuator endpoints |
| `MAX_DELIVERY_AGE_MS` | 86400000 | Deliveries older than this auto-fail (24h) |
| `EVENT_TTL_DAYS` | 90 | Redis TTL for event records |
| `DELIVERY_TTL_DAYS` | 14 | Redis TTL for delivery records |
| `RETENTION_CLEANUP_INTERVAL_MS` | 3600000 | ZSET index cleanup interval (1h) |
| `EVIDENCE_POP_TIMEOUT_SECONDS` | 5 | BLMOVE blocking timeout for the evidence queue (seconds) |
| `EVIDENCE_FAILED_MAX_LEN` | 10000 | Max length of the evidence dead-letter queue (newest kept) |

### Full configuration example

Environment variables (Docker `-e` flags or the shell environment):

```bash
REDIS_HOST=redis.example.com
REDIS_PORT=6379
REDIS_PASSWORD=your-redis-password
WEBHOOK_SECRET_ENCRYPTION_KEY=K7x2mP9qR4sT6wB1cD3fG5hJ8kL0nA2=
EVIDENCE_SERVER_ID=https://cycles.example.com/v1
EVIDENCE_SIGNING_SIGNER_DID=b10554...c522
EVIDENCE_SIGNING_PRIVATE_KEY_HEX=4f9c...d20a
MANAGEMENT_PORT=9980
RETRY_BATCH_SIZE=100
DISPATCH_PROCESSING_RECOVERY_IDLE_MS=180000
MAX_DELIVERY_AGE_MS=86400000
EVENT_TTL_DAYS=90
DELIVERY_TTL_DAYS=14
RETENTION_CLEANUP_INTERVAL_MS=3600000
```

Application properties (only overridable via `application.properties` or `-D` system properties — they have no env-var mapping):

```properties
dispatch.pending.timeout-seconds=5
dispatch.retry.poll-interval-ms=5000
dispatch.http.timeout-seconds=30
dispatch.http.connect-timeout-seconds=5
```

## Health check

The events service exposes a Spring Boot Actuator health endpoint on the management port (9980 by default as of v0.1.25.9):

```bash
curl http://localhost:9980/actuator/health
# {"status":"UP"}
```

Pre-v0.1.25.9 deployments exposed `/actuator/health` on the application port 7980. Update kubelet probes and Docker `HEALTHCHECK` commands to hit `:9980` when upgrading. The published Docker image's built-in `HEALTHCHECK` (30s interval, 60s start period, 5 retries) has already been updated.

## What happens when the events service is down

1. **Admin and runtime servers are unaffected** — event emission and evidence source writes are fire-and-forget, never blocking API responses
2. **Events and deliveries accumulate in Redis** — `event:{id}` keys (90-day TTL), `delivery:{id}` keys (14-day TTL), `dispatch:pending` list grows
3. **Redis memory is bounded** — TTLs ensure keys auto-expire even if never consumed
4. **When the events service restarts:**
   - Stale deliveries (older than `MAX_DELIVERY_AGE_MS`, default 24h) are immediately marked FAILED
   - Fresh deliveries are processed normally via the BLMOVE reliable queue — claimed jobs sit on `dispatch:processing` until acknowledged, and orphans idle longer than `DISPATCH_PROCESSING_RECOVERY_IDLE_MS` (default 180000 ms) are recovered back to pending
   - `RetentionCleanupService` trims orphaned ZSET index entries hourly
5. **No data loss for events** — event records persist in Redis for 90 days regardless of delivery status
6. **Evidence may be temporarily unavailable** — responses can still include `cycles_evidence`, but `GET /v1/evidence/{id}` may return transient `404` until the events service signs and stores the envelope

## Auto-disable for persistently failing subscriptions

The events service tracks `consecutive_failures` per subscription. When the counter reaches `disable_after_failures` (default **10**), the subscription transitions to `DISABLED` and no further deliveries are attempted. The counter resets to 0 on any successful delivery. Re-enable a disabled subscription with `PATCH /v1/admin/webhooks/{id}` once the receiver is healthy.

Stale deliveries (older than `MAX_DELIVERY_AGE_MS`, default 24h) are marked `FAILED` without attempting HTTP delivery. This prevents a large backlog from triggering thundering-herd traffic against a receiver after a long events-service outage.

Signing secrets are encrypted at rest with AES-256-GCM using `WEBHOOK_SECRET_ENCRYPTION_KEY` (v0.1.25.2+). The events service decrypts per delivery; plaintext never lives on disk.

## Prometheus metrics

The events service publishes webhook delivery metrics under the `cycles_webhook_*` namespace on `/actuator/prometheus`, served on the management port (9980 by default as of v0.1.25.9; was 7980 on pre-.9 builds). Update Prometheus scrape targets accordingly — the metric names and labels are unchanged.

| Metric | Tags | Description |
|--------|------|-------------|
| `cycles_webhook_delivery_attempts_total` | `tenant`, `event_type` | Every outbound HTTP attempt (including retries) |
| `cycles_webhook_delivery_success_total` | `tenant`, `event_type`, `status_code_family` (`2xx`/`3xx`/`4xx`/`5xx`) | Attempts that received HTTP 2xx |
| `cycles_webhook_delivery_failed_total` | `tenant`, `event_type`, `reason` | Failed attempts, bucketed by failure reason |
| `cycles_webhook_delivery_retried_total` | `tenant`, `event_type` | Retry attempts scheduled on the `dispatch:retry` ZSET |
| `cycles_webhook_delivery_stale_total` | `tenant` | Deliveries auto-failed by the `MAX_DELIVERY_AGE_MS` gate |
| `cycles_webhook_subscription_auto_disabled_total` | `tenant`, `reason` | Subscriptions transitioned to `DISABLED` after `disable_after_failures` |
| `cycles_webhook_delivery_latency_seconds` | `tenant`, `event_type`, `outcome` | Timer — HTTP RTT per delivery attempt |
| `cycles_webhook_events_payload_invalid_total` | `type`, `rule` | Event payload validation discrepancies (no tenant tag — shape issue, not traffic) |

The `tenant` tag on all counters is gated by `cycles.metrics.tenant-tag.enabled` (default `false` to bound Prometheus cardinality) — set `CYCLES_METRICS_TENANT_TAG_ENABLED=true` to break metrics out per tenant in smaller deployments.

Alert on `cycles_webhook_subscription_auto_disabled_total` (any increase is a receiver health issue) and on a sustained rise in `cycles_webhook_delivery_failed_total{reason=!~"client_4xx"}` (non-client-error failures indicate dispatch issues).

## Scaling

Multiple events service instances can safely share the same `dispatch:pending` list. `BLMOVE` atomically moves a claimed delivery to `dispatch:processing`, and owner-token-checked acknowledgement prevents a stale worker from removing a successor's claim. Claims idle past `DISPATCH_PROCESSING_RECOVERY_IDLE_MS` (default `180000` ms) are recovered to pending. A fleet-wide ordering lease serializes the claim/send critical section, so additional replicas provide failover rather than higher initial-delivery throughput. Delivery remains at least once; receivers must deduplicate by event ID.

## Next steps

- [Webhook Event Delivery Protocol](/protocol/webhook-event-delivery-protocol) — full event type catalog and delivery specification
- [CyclesEvidence Envelopes](/protocol/cycles-evidence-envelopes-in-cycles) — evidence signing, JWKS verification, and rotation
- [Managing Webhooks](/how-to/managing-webhooks) — create, test, and monitor webhooks
- [Webhook Integrations](/how-to/webhook-integrations) — PagerDuty, Slack, ServiceNow examples
- [Configuration Reference](/configuration/server-configuration-reference-for-cycles#events-service-configuration) — all events service settings
- [Architecture Overview](/quickstart/architecture-overview-how-cycles-fits-together) — how the events service fits in the system
