---
title: "Production Operations Guide"
description: "Run Cycles reliably in production: Redis configuration, Cycles Server HA, Events Service deployment, network architecture, capacity planning, and operational runbooks."
---

# Production Operations Guide

This guide covers what you need to run Cycles reliably in production. It assumes you've already deployed the stack per [Deploy the Full Stack](/quickstart/deploying-the-full-cycles-stack) and are preparing for production traffic.

::: info
Cycles stores all state in Redis. Redis availability directly determines Cycles availability. Plan your Redis deployment accordingly.
:::

::: tip Operations UI for incident response
For incident-response workflows — freeze a runaway budget, suspend a tenant, force-release hung reservations, replay missed webhooks, revoke a leaked API key — deploy the [Cycles Admin Dashboard](/quickstart/deploying-the-cycles-dashboard). It's a Vue 3 SPA with one-click actions (capability-gated, with confirm + blast-radius summaries) that's typically faster than crafting curl during a live incident. Pair with the Prometheus alerting in [Monitoring and Alerting](/how-to/monitoring-and-alerting) — alerts page you, dashboard helps you act.
:::

## Redis configuration for production

Cycles stores all state in Redis. Redis availability directly determines Cycles availability.

::: warning Always configure Redis authentication in production
Set `REDIS_PASSWORD` and provide it to all Cycles services. An unauthenticated Redis instance is a critical security vulnerability — anyone with network access can read budget state, modify reservations, and extract API keys. See [Security Hardening — Redis Authentication](/how-to/security-hardening#authentication) for complete setup including TLS and ACLs.
:::

### Persistence

Enable both RDB snapshots and AOF append-only logging:

```conf
# redis.conf
save 900 1        # Snapshot every 15 min if at least 1 key changed
save 300 10       # Snapshot every 5 min if at least 10 keys changed
appendonly yes     # Enable AOF
appendfsync everysec  # Fsync once per second (good balance of safety and performance)
```

In Docker Compose:

```yaml
redis:
  image: redis:7-alpine
  command: redis-server --appendonly yes --save "900 1" --save "300 10"
  volumes:
    - redis-data:/data
```

### Memory management

Set a max memory limit and eviction policy:

```conf
maxmemory 2gb
maxmemory-policy noeviction  # IMPORTANT: never evict budget data
```

**Always use `noeviction`**. Evicting budget keys silently loses budget state. It is better for Redis to reject writes (causing reservation failures that can be retried) than to silently drop data.

### High availability

For production, consider:

- **Redis Sentinel** — automatic failover with a primary + replica setup. Good for most deployments.
- **Redis Cluster** — sharded across multiple nodes. Required for very large deployments.

Cycles uses Lua scripts for atomic operations. All keys for a single reservation operation are in the same Redis keyspace, so single-instance and Sentinel setups work out of the box. For Redis Cluster, ensure the key prefix strategy keeps related keys on the same shard.

### Backup strategy

- **Automated RDB snapshots** stored offsite (S3, GCS, etc.)
- **AOF backups** for point-in-time recovery
- **Test restores regularly** — untested backups are not backups

## Cycles Server configuration

### Running multiple instances

The Cycles Server is stateless. You can run multiple instances behind a load balancer:

```yaml
cycles-server-1:
  image: ghcr.io/runcycles/cycles-server:0.1.25.58
  environment:
    REDIS_HOST: redis-primary
    REDIS_PORT: 6379
    REDIS_PASSWORD: ${REDIS_PASSWORD}

cycles-server-2:
  image: ghcr.io/runcycles/cycles-server:0.1.25.58
  environment:
    REDIS_HOST: redis-primary
    REDIS_PORT: 6379
    REDIS_PASSWORD: ${REDIS_PASSWORD}
```

Any load balancing strategy works (round-robin, least-connections). No sticky sessions required.

### Health checks

All three services (runtime, admin, events) enable Spring's dedicated Kubernetes liveness/readiness probes (`management.endpoint.health.probes.enabled=true`) and serve them at `/actuator/health/liveness` and `/actuator/health/readiness`. The probe endpoints are public (unauthenticated). Since 0.1.25.45, all **other** actuator endpoints — the aggregate `/actuator/health`, `/actuator/info`, and `/actuator/prometheus` — require the admin API key via the `X-Admin-API-Key` header.

```bash
# Cycles Server (Kubernetes probes, public)
curl http://localhost:7878/actuator/health/liveness
curl http://localhost:7878/actuator/health/readiness

# Admin Server (Kubernetes probes, public)
curl http://localhost:7979/actuator/health/liveness
curl http://localhost:7979/actuator/health/readiness

# Events Service (Kubernetes probes, management port)
curl http://localhost:9980/actuator/health/liveness
curl http://localhost:9980/actuator/health/readiness

# Aggregate health requires the admin API key (since 0.1.25.45)
curl -H "X-Admin-API-Key: $ADMIN_KEY" http://localhost:7878/actuator/health
```

Configure your load balancer or orchestrator to check these endpoints. On Kubernetes, wire liveness probes to `/actuator/health/liveness` and readiness probes to `/actuator/health/readiness` on all three services — the runtime service on port 7878, the Admin Server on port 7979, and the Events Service on its management port 9980, not the app port 7980. Readiness includes a Redis `PING` health contributor and turns `DOWN` when Redis is unreachable; liveness stays process-only. There is no custom queue-consumption health check on the Events Service today; for backlog monitoring, watch `LLEN dispatch:pending` (see [Monitoring and Alerting](/how-to/monitoring-and-alerting)).

### JVM tuning

The default JVM settings work for most deployments. For high-throughput environments:

```bash
JAVA_OPTS="-Xms512m -Xmx1g -XX:+UseG1GC"
```

### Reservation expiry

The server runs a background sweep to expire stale reservations:

```yaml
cycles:
  expiry:
    interval-ms: 5000  # Default: sweep every 5 seconds
```

Reduce the interval for tighter TTL enforcement. Increase it to reduce Redis load if TTL precision is not critical.

For listing and recovering stale or orphaned reservations after client crashes, see [Reservation Recovery and Listing](/protocol/reservation-recovery-and-listing-in-cycles).

## Events Service configuration

The **Cycles Events Service** (`cycles-server-events`) delivers webhook notifications asynchronously and signs CyclesEvidence envelopes when evidence is enabled. It is an outbound worker: its app port 7980 and management port 9980 should stay internal, and health/metrics checks should target 9980. It is optional — if not deployed, admin and runtime servers continue operating normally. Webhook events accumulate in Redis with TTL until the service starts; evidence refs may be returned by the runtime before the signed envelope is available.

### Configuration

| Variable | Default | Description |
|---|---|---|
| `WEBHOOK_SECRET_ENCRYPTION_KEY` | required by default | AES-256-GCM key for signing secret encryption. Base64, 32 bytes. Same across all services. Generate: `openssl rand -base64 32`. Missing key fails admin/events startup unless `WEBHOOK_SECRET_ALLOW_PLAINTEXT=true` is explicitly set for local development. |
| `EVENT_TTL_DAYS` | 90 | Redis TTL for event records |
| `DELIVERY_TTL_DAYS` | 14 | Redis TTL for delivery records |
| `MAX_DELIVERY_AGE_MS` | 86400000 | Stale deliveries auto-fail after this age (24h default) |
| `dispatch.retry.poll-interval-ms` | 5000 | How often the retry scheduler scans for ready-to-retry deliveries. |
| `dispatch.retry.batch-size` | 100 | Max deliveries processed per retry-scan tick. |
| `dispatch.http.timeout-seconds` | 30 | HTTP request timeout per delivery attempt. |
| `dispatch.http.connect-timeout-seconds` | 5 | HTTP connect timeout per delivery attempt. |
| `EVIDENCE_SERVER_ID` | (empty) | CyclesEvidence issuer base including `/v1`. Blank disables evidence signing and leaves pending source records untouched. |
| `EVIDENCE_SIGNING_SIGNER_DID` | (empty) | Raw-hex public Ed25519 key. Must match the runtime server when evidence is enabled. |
| `EVIDENCE_SIGNING_PRIVATE_KEY_HEX` | (empty) | Raw-hex private Ed25519 key. Secret; set only on `cycles-server-events`. |

The per-subscription retry policy (exponential backoff) defaults to `max_retries=5`, `initial_delay_ms=1000`, `backoff_multiplier=2.0`, `max_delay_ms=60000`. A delivery older than `MAX_DELIVERY_AGE_MS` is failed immediately without further retries. See the [Events Service section in the Server Configuration Reference](/configuration/server-configuration-reference-for-cycles#events-service-configuration) for the full knob list.

### Running multiple instances

The Events Service is safe to run as multiple instances. `BLMOVE` moves a claimed job from `dispatch:pending` to the recoverable `dispatch:processing` list, and owner-token-checked acknowledgement prevents a stale worker from removing a successor's claim. A fleet-wide ordering lease currently serializes the claim/send critical section, so replicas provide failover rather than linear webhook throughput. Delivery semantics are at least once, not exactly once — webhook receivers should deduplicate on the event ID.

```yaml
cycles-events-1:
  image: ghcr.io/runcycles/cycles-server-events:0.1.25.25
  environment:
    REDIS_HOST: redis-primary
    REDIS_PORT: 6379
    REDIS_PASSWORD: ${REDIS_PASSWORD}
    WEBHOOK_SECRET_ENCRYPTION_KEY: ${WEBHOOK_SECRET_ENCRYPTION_KEY}

cycles-events-2:
  image: ghcr.io/runcycles/cycles-server-events:0.1.25.25
  environment:
    REDIS_HOST: redis-primary
    REDIS_PORT: 6379
    REDIS_PASSWORD: ${REDIS_PASSWORD}
    WEBHOOK_SECRET_ENCRYPTION_KEY: ${WEBHOOK_SECRET_ENCRYPTION_KEY}
```

### Events Service down

If the Events Service is unavailable:

1. Admin and runtime servers are **unaffected** — event dispatch and evidence source writes are fire-and-forget
2. Redis accumulates events with TTL (90-day events, 14-day deliveries)
3. On restart: stale deliveries older than `MAX_DELIVERY_AGE_MS` (default 24h) auto-fail; fresh ones deliver normally
4. If CyclesEvidence is enabled, `GET /v1/evidence/{id}` may return transient `404` until the events service signs and stores the envelope

## Network architecture

### Recommended topology

<NetworkTopology />

### Network isolation

- **Cycles Server** (port 7878): Accessible to your application. Can be on an internal network or behind an API gateway.
- **Admin Server** (port 7979): **Internal access only.** This manages tenants, API keys, and budgets. Never expose to the public internet.
- **Events Service** (app port 7980, management port 9980): **Internal access only.** Consumes from Redis and delivers webhooks outbound. Never needs inbound traffic from applications.
- **Redis** (port 6379): **Internal access only.** Never expose directly.

### TLS termination

Terminate TLS at the load balancer or API gateway. The Cycles Server itself runs plain HTTP. Example with nginx:

```nginx
server {
    listen 443 ssl;
    server_name cycles.internal.example.com;

    ssl_certificate /etc/ssl/certs/cycles.crt;
    ssl_certificate_key /etc/ssl/private/cycles.key;

    location / {
        proxy_pass http://cycles-server:7878;
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    }
}
```

## Capacity planning

### Rules of thumb

- **Redis memory:** ~1 KB per active reservation, ~500 bytes per budget ledger. 1 GB of Redis memory supports roughly 500K concurrent reservations.
- **Server CPU:** Each reservation involves 1 Redis Lua script execution (~1ms). A single server instance can handle thousands of reservations per second.
- **Latency:** Expect <5ms for reservation operations on a well-configured setup (server co-located with Redis).

### Scaling triggers

Add more **Cycles Server** instances when:
- Response latency exceeds 50ms at p99
- CPU utilization exceeds 70%

Add more **Events Service** instances when:
- The `dispatch:pending` queue depth grows consistently (`redis-cli LLEN dispatch:pending`)
- Webhook delivery latency exceeds acceptable thresholds
- Multiple instances are safe — each delivery job is claimed by one instance at a time via `BLMOVE`, with at-least-once delivery semantics

Scale **Redis** when:
- Memory utilization exceeds 80%
- Command latency exceeds 5ms

## Upgrade procedures

### Rolling upgrade

All three services (Cycles Server, Admin Server, Events Service) are stateless — all state lives in Redis. You can do rolling upgrades with zero downtime:

1. Pull the new image: `docker pull ghcr.io/runcycles/cycles-server:NEW_VERSION`
2. Stop one instance at a time
3. Start the new version
4. Verify health check passes (`/actuator/health/readiness` on ports 7878, 7979, and events management port 9980)
5. Repeat for remaining instances

The Events Service can be upgraded independently. While it is down, webhook deliveries queue in Redis and are processed when the new version starts.

### Version compatibility

The Cycles protocol is versioned (`/v1`). Minor version upgrades (e.g., 0.1.23 → 0.1.24) are backward-compatible. Check the [changelog](/changelog) for breaking changes before major upgrades.

### Rollback

If an upgrade causes issues:

1. Stop the new version
2. Start the previous version
3. Redis state is compatible across minor versions

## Logging

### Log levels

Configure via Spring Boot:

```yaml
logging:
  level:
    io.runcycles: INFO      # Application logs
    org.springframework: WARN # Framework logs
```

Set `io.runcycles: DEBUG` for troubleshooting (includes full request/response logging).

### Structured logging

Add JSON logging for log aggregation systems:

```yaml
logging:
  pattern:
    console: '{"timestamp":"%d","level":"%p","logger":"%c","message":"%m"}%n'
```

Or use the Spring Boot JSON logging starter for full structured output.

## Operational runbooks

### Budget exhaustion alert

**Symptom:** Applications report `BUDGET_EXCEEDED` errors.

**Response:**
1. Check which scope is exhausted: `GET /v1/balances?tenant=...`
2. Determine if this is expected (legitimate traffic) or unexpected (runaway agent)
3. If expected: fund the budget via admin API (`POST .../fund` with `CREDIT`)
4. If unexpected: check active reservations for anomalies (`GET /v1/reservations?status=ACTIVE`)

### Reservation leak

**Symptom:** Budget `reserved` amount grows but `spent` stays flat. Reservations are being created but never committed or released.

**Response:**
1. List active reservations: `GET /v1/reservations?status=ACTIVE`
2. Check for reservations past their expected TTL
3. The expiry sweep should eventually clean these up. If it's not running, check the server logs.
4. Investigate the client application — it may be failing to commit or release.

### Commit failure after successful LLM call

**Symptom:** An LLM call (or other side-effecting action) completes successfully, but the subsequent commit to Cycles fails. The work happened and incurred real cost, but the budget ledger does not reflect it.

**Why this happens:**
- Transient network error between client and Cycles Server
- Cycles Server restart or Redis outage at commit time
- Client process crash after the LLM call but before commit

**What the retry engine does:**

All three clients (Python, TypeScript, Spring Boot) include a commit retry engine enabled by default. When a commit fails with a transport error or 5xx response, the engine retries with exponential backoff (default: 5 attempts over ~30 seconds). This handles most transient failures automatically.

**When retry is not enough:**

If all retries are exhausted or the client process crashes entirely, the reservation remains in `ACTIVE` state until it expires (based on TTL + grace period). After expiry, the reserved budget is returned to the pool. The actual cost is unaccounted for — the budget appears more available than it really is.

**Response:**
1. **Check for expired reservations that were never committed:**
   ```bash
   curl -s "http://localhost:7878/v1/reservations?tenant=acme-corp&status=EXPIRED" \
     -H "X-Cycles-API-Key: $API_KEY" | jq '.reservations[] | {reservation_id, scope_path, reserved: .reserved.amount, created_at_ms, expires_at_ms}'
   ```
2. **Reconcile using events:** For each expired reservation that represents real work, record the actual cost as a standalone event:
   ```bash
   curl -s -X POST http://localhost:7878/v1/events \
     -H "Content-Type: application/json" \
     -H "X-Cycles-API-Key: $API_KEY" \
     -d '{
       "idempotency_key": "reconcile-<reservation_id>",
       "subject": { "tenant": "acme-corp" },
       "action": { "kind": "reconciliation", "name": "commit-failure-recovery" },
       "actual": { "unit": "USD_MICROCENTS", "amount": <actual_cost> },
       "overage_policy": "ALLOW_WITH_OVERDRAFT",
       "metadata": { "original_reservation_id": "<reservation_id>" }
     }'
   ```
3. **Monitor commit failure rates.** A sustained increase in commit failures signals infrastructure issues. Track the ratio of committed vs. expired reservations.

**Prevention:**
- Keep retry enabled (default) with aggressive settings for critical workloads
- Use `ALLOW_WITH_OVERDRAFT` overage policy for must-record actions so reconciliation events are always accepted
- Ensure client processes have graceful shutdown hooks that commit or release active reservations
- Set up alerts on the expired reservation count (see [Monitoring and Alerting](/how-to/monitoring-and-alerting))

### Redis connection loss

**Symptom:** All reservation operations fail with 500 errors. Events Service also stops processing deliveries.

**Response:**
1. Check Redis connectivity: `redis-cli ping`
2. Check server logs for connection errors on all three services (ports 7878, 7979, 7980)
3. Restart services if Redis connection pool is exhausted
4. Active reservations with remaining TTL are preserved in Redis and will resume when connectivity returns
5. Queued webhook deliveries resume automatically when the Events Service reconnects

### Webhook delivery failures

**Symptom:** Webhook endpoints are not receiving events. Queue depth grows.

**Response:**
1. Check Events Service health: `GET http://localhost:9980/actuator/health/readiness`
2. Check queue depth: `redis-cli LLEN dispatch:pending`
3. Check if subscription was auto-disabled: `GET /v1/admin/webhooks/{subscription_id}`
4. Re-enable if needed: `PATCH /v1/admin/webhooks/{subscription_id}` with `{"status": "ACTIVE"}`
5. Verify `WEBHOOK_SECRET_ENCRYPTION_KEY` matches across all services

## Next steps

- [Webhook Integrations](/how-to/webhook-integrations) — PagerDuty, Slack, ServiceNow examples
- [Client Performance Tuning](/how-to/client-performance-tuning) — timeout, retry, and connection pool optimization
- [Security Hardening](/how-to/security-hardening) — Redis AUTH, TLS, key rotation, webhook security
- [Monitoring and Alerting](/how-to/monitoring-and-alerting) — metrics and alerting setup
- [Server Configuration Reference](/configuration/server-configuration-reference-for-cycles) — all configuration properties
