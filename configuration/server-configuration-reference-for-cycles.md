---
title: "Server Configuration Reference for Cycles"
description: "Complete reference for all Cycles server and admin server configuration properties, including Redis, expiry, logging, and Spring Boot actuator settings."
---

# Server Configuration Reference for Cycles

This is the complete reference for all configuration properties available in the Cycles server.

The server uses Spring Boot's configuration system. Properties can be set in `application.properties`, `application.yml`, or via environment variables.

## Server properties

| Property | Default | Env Variable | Description |
|---|---|---|---|
| `server.port` | `7878` | `SERVER_PORT` | HTTP port the server listens on |
| `spring.application.name` | `cycles-protocol-service` | — | Application name |

## Redis connection

| Property | Default | Env Variable | Description |
|---|---|---|---|
| `redis.host` | `localhost` | `REDIS_HOST` | Redis server hostname |
| `redis.port` | `6379` | `REDIS_PORT` | Redis server port |
| `redis.password` | (empty) | `REDIS_PASSWORD` | Redis password (optional) |
| `redis.pool.max-total` | `128` | — | JedisPool max active connections |
| `redis.pool.max-idle` | `32` | — | JedisPool max idle connections |
| `redis.pool.min-idle` | `16` | — | JedisPool min idle connections kept warm |
| `redis.pool.max-wait-ms` | `2000` | — | Max ms a caller waits for a pooled connection before `JedisException` |

Redis 7+ is required for Lua script compatibility. Tune `redis.pool.max-total` upward on high-concurrency instances — the reservation Lua script holds a connection for the duration of the atomic script call.

## Reservation expiry

| Property | Default | Env Variable | Description |
|---|---|---|---|
| `cycles.expiry.interval-ms` | `5000` | `CYCLES_EXPIRY_INTERVAL_MS` | How often the background expiry sweep runs (ms) |

The expiry sweep scans for reservations past their TTL and marks them as `EXPIRED`, releasing their reserved budget back to the affected scopes.

### Tuning the sweep interval

- **Lower values** (e.g., 1000ms): expired reservations are cleaned up faster, budget is returned sooner. Increases Redis load slightly.
- **Higher values** (e.g., 30000ms): less Redis overhead, but expired reservations hold budget longer before cleanup.

For most deployments, the default 5000ms is a good balance.

## Runtime audit log retention (v0.1.25.15)

The runtime server writes audit entries for admin-on-behalf-of operations (force-release) to `audit:log:{id}` keys in Redis. v0.1.25.15 adds TTL-based retention so these rows respect the same 400-day authenticated tier as the admin plane.

| Property | Default | Env Variable | Description |
|---|---|---|---|
| `audit.retention.days` | `400` | `AUDIT_RETENTION_DAYS` | TTL in days for runtime-written audit rows. Set to `0` for indefinite retention (legal hold, HIPAA-adjacent deployments, environments that offload to an archive store). |
| `audit.sweep.cron` | `0 0 3 * * *` | `AUDIT_SWEEP_CRON` | Cron for the daily `@Scheduled` sweep that prunes expired `audit:logs:{tenantId}` and `audit:logs:_all` ZSET pointers. Safe to run alongside admin's sweep (idempotent `ZREMRANGEBYSCORE`). |

Runtime audit rows never use the admin-plane `__admin__` / `__unauth__` sentinels — the runtime never fails pre-auth for admin keys, so a single tier is sufficient.

## Metrics

| Property | Default | Env Variable | Description |
|---|---|---|---|
| `cycles.metrics.tenant-tag.enabled` | `true` | `CYCLES_METRICS_TENANT_TAG_ENABLED` | When `true`, Prometheus counters include a `tenant` label. Set to `false` in deployments with many thousands of tenants to bound series cardinality. |

The runtime server publishes seven domain counters under `cycles_*_total` (introduced in v0.1.25.10); the events service publishes `cycles_webhook_*` counters plus a latency timer. The `tenant-tag.enabled` toggle is mirrored on both services so they can be flipped together. For the full metric enumeration, tag definitions, scrape targets, and alert recipes, see [Prometheus Metrics Reference](/how-to/prometheus-metrics-reference).

## JSON serialization

| Property | Default | Description |
|---|---|---|
| `spring.jackson.serialization.write-dates-as-timestamps` | `false` | Dates are ISO-8601 strings, not timestamps |
| `spring.jackson.deserialization.fail-on-unknown-properties` | `true` | Reject requests with unknown fields |
| `spring.jackson.default-property-inclusion` | `non_null` | Omit null fields from responses |

These settings enforce strict request validation and clean responses.

## Logging

| Property | Default | Description |
|---|---|---|
| `logging.level.root` | `INFO` | Root log level |
| `logging.level.io.runcycles.protocol` | `DEBUG` | Cycles-specific log level |
| `logging.pattern.console` | `%d{...} [%thread] %-5level %logger{36} - %msg%n` | Log format |

### Recommended production settings

```properties
logging.level.root=WARN
logging.level.io.runcycles.protocol=INFO
```

### Debugging

For troubleshooting, enable DEBUG on the data layer:

```properties
logging.level.io.runcycles.protocol.data=DEBUG
```

This logs Lua script execution details, scope derivation, and balance calculations.

### Structured (JSON) logging

Cycles does not register a custom JSON log format. Because the services run on Spring Boot 3.4+, you can opt into Spring's built-in structured logging by setting one of the following at deploy time:

| Variable | Value | Description |
|---|---|---|
| `LOGGING_STRUCTURED_FORMAT_CONSOLE` | `ecs` | Emit logs in Elastic Common Schema JSON (Spring Boot built-in). |
| `LOGGING_STRUCTURED_FORMAT_CONSOLE` | `logstash` | Emit logs in Logstash JSON format (Spring Boot built-in). |

When either value is set, Spring Boot overrides `logging.pattern.console` in favor of JSON output. This is stock Spring Boot behavior, not a Cycles-specific feature — the same env var works on the admin and events services.

## OpenAPI / Swagger

| Property | Default | Description |
|---|---|---|
| `springdoc.api-docs.path` | `/api-docs` | Path for the OpenAPI JSON spec |
| `springdoc.swagger-ui.path` | `/swagger-ui.html` | Path for the Swagger UI |
| `springdoc.swagger-ui.enabled` | `true` | Enable Swagger UI |

To disable Swagger UI in production:

```properties
springdoc.swagger-ui.enabled=false
```

The OpenAPI spec at `/api-docs` can remain enabled for tooling.

## Actuator / health checks

| Property | Default | Description |
|---|---|---|
| `management.endpoints.web.exposure.include` | `health,info,prometheus` | Exposed actuator endpoints (runtime server default) |
| `management.endpoint.health.show-details` | `when-authorized` | Show health details |

### Available endpoints (default)

```
GET /actuator/health      — aggregate health check
GET /actuator/info        — application info
GET /actuator/prometheus  — Micrometer metrics in Prometheus exposition format
```

The runtime server also whitelists `/actuator/prometheus` in `SecurityConfig` so it can be scraped without an API key. The admin server requires default Spring Security on its actuator paths.

### Adding more endpoints

To expose additional actuator endpoints (e.g., `metrics`, `loggers`, `env`):

```properties
management.endpoints.web.exposure.include=health,info,prometheus,metrics,loggers
```

## Security configuration

The server's security is configured in `SecurityConfig.java`. The following paths are public (no API key required):

- `/api-docs/**` — OpenAPI spec
- `/swagger-ui/**` — Swagger UI
- `/swagger-ui.html` — Swagger UI entry point
- `/swagger-resources/**` — Swagger resource endpoints
- `/v3/api-docs/**` — OpenAPI v3 spec
- `/webjars/**` — WebJar resources
- `/favicon.ico` — Favicon
- `/.well-known/**` — Well-known endpoints
- `/actuator/health` — Health check (exact path only, not sub-paths)

All other paths require a valid `X-Cycles-API-Key` header.

## Full configuration example

```properties
# Server
server.port=7878

# Redis
redis.host=${REDIS_HOST:localhost}
redis.port=${REDIS_PORT:6379}
redis.password=${REDIS_PASSWORD:}

# Expiry
cycles.expiry.interval-ms=5000

# JSON
spring.jackson.serialization.write-dates-as-timestamps=false
spring.jackson.deserialization.fail-on-unknown-properties=true
spring.jackson.default-property-inclusion=non_null

# Logging
logging.level.root=INFO
logging.level.io.runcycles.protocol=DEBUG

# Swagger
springdoc.api-docs.path=/api-docs
springdoc.swagger-ui.path=/swagger-ui.html
springdoc.swagger-ui.enabled=true

# Actuator
management.endpoints.web.exposure.include=health,info
management.endpoint.health.show-details=when-authorized
```

## Environment variable reference

Quick reference for setting all properties via environment variables:

| Variable | Maps to |
|---|---|
| `REDIS_HOST` | `redis.host` |
| `REDIS_PORT` | `redis.port` |
| `REDIS_PASSWORD` | `redis.password` |
| `SERVER_PORT` | `server.port` |
| `CYCLES_EXPIRY_INTERVAL_MS` | `cycles.expiry.interval-ms` |
| `EVIDENCE_SERVER_ID` | `cycles.evidence.server-id` |
| `EVIDENCE_SIGNING_SIGNER_DID` | `cycles.evidence.signing.signer-did` |
| `EVIDENCE_SIGNING_KID` | `cycles.evidence.signing.kid` |
| `EVIDENCE_SIGNING_NBF_MS` | `cycles.evidence.signing.nbf-ms` |
| `EVIDENCE_SIGNING_RETIRED_KEYS` | `cycles.evidence.signing.retired-keys` |

The `EVIDENCE_SIGNING_*` variables configure CyclesEvidence signer-key publication and rotation (the public identity; the private `EVIDENCE_SIGNING_PRIVATE_KEY_HEX` lives only on `cycles-server-events`). `KID` / `NBF_MS` describe the active key's JWK; `RETIRED_KEYS` is the JSON rotation history. See [Signer-key resolution and rotation](/protocol/cycles-evidence-envelopes-in-cycles#signer-key-resolution-and-rotation) for the JWK shape and the rotation procedure, and the [identity enablement runbook](https://github.com/runcycles/cycles-server-events/blob/main/docs/evidence-identity-enablement.md) for first-time setup.

---

## Admin Server Configuration

The Cycles Admin Server (`cycles-admin-service`) is a separate service that manages tenants, API keys, budgets, and policies. It runs on port 7979 by default and shares the same Redis instance as the Cycles Server.

### Admin server properties

| Property | Default | Env Variable | Description |
|---|---|---|---|
| `server.port` | `7979` | `SERVER_PORT` | HTTP port the admin server listens on |
| `admin.api-key` | (empty) | `ADMIN_API_KEY` | Master admin key for `X-Admin-API-Key` header |
| `redis.host` | (required) | `REDIS_HOST` | Redis server hostname |
| `redis.port` | (required) | `REDIS_PORT` | Redis server port |
| `redis.password` | (required) | `REDIS_PASSWORD` | Redis password (set empty string if none) |
| `dashboard.cors.origin` | `http://localhost:5173` | `DASHBOARD_CORS_ORIGIN` | Allowed CORS origin for the [admin dashboard](/quickstart/deploying-the-cycles-dashboard). Only needed when the browser calls the admin server directly (dev mode); unused in standard production (nginx reverse-proxies same-origin). |
| `springdoc.swagger-ui.enabled` | `false` | `SWAGGER_ENABLED` | Swagger UI is disabled by default on the admin server; set to `true` to enable. |
| `logging.level.io.runcycles.admin` | `INFO` | `LOG_LEVEL` | Admin-specific log level. |

### Audit log retention

Introduced in `cycles-server-admin` v0.1.25.20 for SOC2-compliant defaults. Failed requests (401/403/400/404/409/500) are now recorded alongside successes; retention is tiered so pre-auth failures expire faster than authenticated entries.

| Property | Default | Env Variable | Description |
|---|---|---|---|
| `audit.retention.authenticated.days` | `400` | `AUDIT_RETENTION_AUTHENTICATED_DAYS` | TTL on authenticated audit entries (success + authenticated failures). `400` covers the SOC2 Type II 12-month lookback + 1-month auditor-engagement buffer. Set to `0` for indefinite retention (legal hold, HIPAA-adjacent). |
| `audit.retention.unauthenticated.days` | `30` | `AUDIT_RETENTION_UNAUTHENTICATED_DAYS` | TTL on pre-auth failures (sentinel tenant `<unauthenticated>`). Enough for brute-force / credential-stuffing post-mortem. Aggregate volume stays visible via Prometheus regardless of TTL. Set to `0` for indefinite. |
| `audit.sample.unauthenticated` | `1` | `AUDIT_SAMPLE_UNAUTHENTICATED` | Sampling rate on unauthenticated entries (`1` = every entry, `100` = 1 in 100). Opt-in hardening against failed-auth floods on internet-exposed admin endpoints. Authenticated entries are **never** sampled. |
| `audit.sweep.cron` | `0 0 3 * * *` | — | Cron for the daily audit-index sweep. Purges TTL-expired pointers from the `audit:logs:_all` + per-tenant sorted-set indexes. Skipped entirely when `audit.retention.authenticated.days=0`. |

**Alerting.** The Prometheus counter `cycles_admin_audit_writes_total{path_class, outcome}` tracks audit-write health. Alert on `outcome=error` nonzero — audit writes are non-fatal to the request, but silent coverage loss is the exact failure mode the tiered TTL is designed to prevent:

```
sum(rate(cycles_admin_audit_writes_total{outcome="error"}[5m])) > 0
```

**Semantic change for audit-log consumers.** Dashboards that assumed "audit entry exists ⇒ operation succeeded" must now check the entry's `status` or `error_code` field. Queries filtered by `status=201/200/204` return exactly the same rows as v0.1.25.19. See [Admin API guide](/admin-api/guide) for field semantics.

### Admin server Kubernetes probes

Unlike the runtime and events services, the admin server enables Spring Boot's liveness/readiness probes out of the box (`management.endpoint.health.probes.enabled=true`). In Kubernetes, wire probes to these paths:

```yaml
livenessProbe:
  httpGet:
    path: /actuator/health/liveness
    port: 7979
readinessProbe:
  httpGet:
    path: /actuator/health/readiness
    port: 7979
```

### Admin authentication

The admin server uses two authentication schemes:

| Header | Variable | Purpose |
|---|---|---|
| `X-Admin-API-Key` | `ADMIN_API_KEY` | System-level operations (tenant CRUD, API key management, audit logs) |
| `X-Cycles-API-Key` | — | Tenant-scoped operations (budget ledgers, policies, reservations) |

For the full endpoint-to-header mapping with required permissions, see the [Architecture Overview — Authentication](/quickstart/architecture-overview-how-cycles-fits-together#authentication).

### Admin server full configuration example

```properties
# Server
server.port=7979
spring.application.name=cycles-admin-service

# Redis (same instance as cycles-server)
redis.host=${REDIS_HOST}
redis.port=${REDIS_PORT}
redis.password=${REDIS_PASSWORD}

# Admin key
admin.api-key=${ADMIN_API_KEY:}

# JSON
spring.jackson.serialization.write-dates-as-timestamps=false
spring.jackson.deserialization.fail-on-unknown-properties=false
spring.jackson.default-property-inclusion=non_null

# Logging
logging.level.root=INFO
logging.level.io.runcycles.admin=DEBUG

# Swagger
springdoc.api-docs.path=/api-docs
springdoc.swagger-ui.path=/swagger-ui.html
springdoc.swagger-ui.enabled=true

# Actuator
management.endpoints.web.exposure.include=health,info
management.endpoint.health.show-details=when-authorized
```

### Security note

The admin server exposes powerful management operations. In production:

- Run the admin server on an internal network not accessible to application traffic
- Use a strong, randomly generated `ADMIN_API_KEY`
- Consider disabling Swagger UI (`springdoc.swagger-ui.enabled=false`)

## Events Service Configuration

The events delivery service (`cycles-server-events`) is an optional component for webhook delivery.

### Ports (v0.1.25.9)

As of v0.1.25.9 the events service separates its public API port from its management (actuator) port:

| Port | Default | Env Variable | Purpose |
|---|---|---|---|
| Public API | `7980` | `SERVER_PORT` | Webhook dispatch control surface |
| Management | `9980` | `MANAGEMENT_PORT` | Actuator endpoints (`/actuator/health`, `/actuator/info`, `/actuator/prometheus`) |

**Migration from pre-.9:** Prometheus scrape configs must point to `:9980/actuator/prometheus`. Kubernetes liveness / readiness probes and Docker `HEALTHCHECK` must hit `:9980/actuator/health`. The published Docker image `HEALTHCHECK` has already been updated. No wire-format change for the dispatch surface.

Expose `7980` via public ingress or external ClusterIP; keep `9980` on an internal-only ClusterIP scraped by Prometheus.

### Core config

| Variable | Default | Description |
|---|---|---|
| `REDIS_HOST` | localhost | Redis hostname (shared with admin/runtime) |
| `REDIS_PORT` | 6379 | Redis port |
| `REDIS_PASSWORD` | (empty) | Redis password |
| `WEBHOOK_SECRET_ENCRYPTION_KEY` | (empty) | AES-256-GCM key for signing secret encryption. Base64, 32 bytes. Must match admin and runtime. Generate: `openssl rand -base64 32` |
| `dispatch.pending.timeout-seconds` | 5 | BRPOP blocking timeout |
| `dispatch.retry.poll-interval-ms` | 5000 | Retry queue poll interval (ms) |
| `dispatch.retry.batch-size` / `RETRY_BATCH_SIZE` | 100 | Max ready-for-retry deliveries processed per poll tick |
| `dispatch.http.timeout-seconds` | 30 | HTTP request timeout for webhook delivery |
| `dispatch.http.connect-timeout-seconds` | 5 | HTTP connect timeout |
| `dispatch.max-delivery-age-ms` / `MAX_DELIVERY_AGE_MS` | 86400000 | Deliveries older than this auto-fail without further retries (24h). Also feeds `cycles_webhook_delivery_stale_total`. |
| `events.retention.event-ttl-days` / `EVENT_TTL_DAYS` | 90 | Redis TTL for event records |
| `events.retention.delivery-ttl-days` / `DELIVERY_TTL_DAYS` | 14 | Redis TTL for delivery records |
| `events.retention.cleanup-interval-ms` / `RETENTION_CLEANUP_INTERVAL_MS` | 3600000 | ZSET index cleanup interval (1h) |
| `cycles.metrics.tenant-tag.enabled` | `true` | Same toggle as the runtime. When `false`, `cycles_webhook_*` counters drop the `tenant` label to bound cardinality. |

### Per-subscription retry policy

Each subscription carries a `retry_policy` applied by the dispatcher's exponential-backoff loop in `DeliveryHandler`. Defaults (used when a subscription omits the field):

| Field | Default | Description |
|---|---|---|
| `max_retries` | 5 | Number of retry attempts before the delivery is marked failed. |
| `initial_delay_ms` | 1000 | First retry delay. Doubles with each attempt up to `max_delay_ms`. |
| `backoff_multiplier` | 2.0 | Exponential backoff factor. Delay for attempt *n* = `min(initial_delay_ms × multiplier^(n-1), max_delay_ms)`. |
| `max_delay_ms` | 60000 | Ceiling for the computed backoff delay. |

A delivery that exceeds `dispatch.max-delivery-age-ms` (default 24h) is failed immediately regardless of remaining retries.

### Events service metrics

Introduced in `cycles-server-events` v0.1.25.6. Seven counters plus one latency timer under the `cycles_webhook_*` namespace, with `tenant` and `event_type` labels gated by `cycles.metrics.tenant-tag.enabled`. For the full enumeration — metric names, tags, cardinality guidance, scrape config, and alert recipes — see [Prometheus Metrics Reference](/how-to/prometheus-metrics-reference#events-service-cycles-server-events).

### Encryption key (shared across all services)

`WEBHOOK_SECRET_ENCRYPTION_KEY` must be the same on admin, runtime, and events services. Admin encrypts signing secrets on write; events decrypts on read. If not set, secrets are stored in plaintext (backward compatible for development).

```bash
export WEBHOOK_SECRET_ENCRYPTION_KEY=$(openssl rand -base64 32)
```

### Full events service configuration example

```bash
# Required — must match admin and runtime servers
REDIS_HOST=redis.example.com
REDIS_PORT=6379
REDIS_PASSWORD=your-redis-password
WEBHOOK_SECRET_ENCRYPTION_KEY=$(openssl rand -base64 32)

# Dispatch tuning
dispatch.pending.timeout-seconds=5
dispatch.retry.poll-interval-ms=5000
dispatch.http.timeout-seconds=30
dispatch.http.connect-timeout-seconds=5

# Delivery lifecycle
MAX_DELIVERY_AGE_MS=86400000       # 24h — deliveries older than this auto-fail

# Data retention
EVENT_TTL_DAYS=90                  # Event records in Redis
DELIVERY_TTL_DAYS=14               # Delivery records in Redis
RETENTION_CLEANUP_INTERVAL_MS=3600000  # ZSET index cleanup (1h)
```

See [Deploying the Events Service](/quickstart/deploying-the-events-service) for the full deployment guide.

## Next steps

- [Deploying the Full Cycles Stack](/quickstart/deploying-the-full-cycles-stack) — end-to-end deployment guide
- [Deploying the Events Service](/quickstart/deploying-the-events-service) — webhook delivery service setup
- [Self-Hosting the Cycles Server](/quickstart/self-hosting-the-cycles-server) — deployment guide
- [Architecture Overview](/quickstart/architecture-overview-how-cycles-fits-together) — system design
- [Client Configuration Reference](/configuration/client-configuration-reference-for-cycles-spring-boot-starter) — client-side properties
