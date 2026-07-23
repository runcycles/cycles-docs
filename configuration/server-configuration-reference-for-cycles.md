---
title: "Server Configuration Reference for Cycles"
description: "Reference for Cycles runtime, admin, and events service configuration, including Redis, maintenance, security, evidence, and operations."
---

# Server Configuration Reference for Cycles

This reference covers the Cycles-defined properties and deployment-facing Spring settings in the current runtime, admin, and events service implementations. Standard Spring Boot properties that the services do not set explicitly are outside its scope.

The server uses Spring Boot's configuration system. Properties can be set in `application.properties`, `application.yml`, or via environment variables.

## Server properties

| Property | Default | Env Variable | Description |
|---|---|---|---|
| `server.port` | `7878` | `SERVER_PORT` | HTTP port the server listens on |
| `spring.application.name` | `cycles-protocol-service` | — | Application name |
| `spring.task.scheduling.pool.size` | `4` | `CYCLES_SCHEDULER_POOL_SIZE` | Bounded scheduler used by expiry, audit, event, and reservation-index maintenance jobs |
| `server.compression.enabled` | `true` | — | Enable HTTP response compression |
| `server.compression.min-response-size` | `1024` | — | Minimum response size in bytes before compression |
| `server.shutdown` | `graceful` | — | Enable graceful shutdown |
| `spring.lifecycle.timeout-per-shutdown-phase` | `30s` | — | Maximum graceful-shutdown phase duration |

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

## Distributed maintenance and reservation index

Runtime maintenance jobs coordinate across replicas with renewable, owner-safe Redis leases. The optional per-tenant created-at index is dual-written by all writers but remains disabled for reads and repair by default so it can be rolled out safely.

| Property | Default | Env Variable | Description |
|---|---|---|---|
| `cycles.maintenance.lease-ttl-ms` | `30000` | `CYCLES_MAINTENANCE_LEASE_TTL_MS` | Lease TTL for each distributed maintenance job |
| `cycles.maintenance.renew-interval-ms` | `10000` | `CYCLES_MAINTENANCE_RENEW_INTERVAL_MS` | Lease-renewal interval; must remain below the lease TTL |
| `cycles.reservation-index.created-at.enabled` | `false` | `RESERVATION_CREATED_AT_INDEX_ENABLED` | Enable reads and repair for the per-tenant created-at reservation index |
| `cycles.reservation-index.created-at.repair-interval-ms` | `300000` | `RESERVATION_CREATED_AT_INDEX_REPAIR_INTERVAL_MS` | Delay between repair batches |
| `cycles.reservation-index.created-at.initial-delay-ms` | `5000` | `RESERVATION_CREATED_AT_INDEX_INITIAL_DELAY_MS` | Initial delay before repair begins |
| `cycles.reservation-index.created-at.failure-backoff-ms` | `3600000` | `RESERVATION_CREATED_AT_INDEX_FAILURE_BACKOFF_MS` | Backoff after a repair failure |
| `cycles.reservation-index.created-at.sweep-cron` | `0 45 3 * * *` | `RESERVATION_CREATED_AT_INDEX_SWEEP_CRON` | Cron for stale index-pointer cleanup |

## Runtime cross-plane settings

| Property | Default | Env Variable | Description |
|---|---|---|---|
| `admin.api-key` | (empty) | `ADMIN_API_KEY` | Admin key accepted on the allowlisted admin-on-behalf-of and protected operational endpoints |
| `webhook.secret.encryption-key` | (empty) | `WEBHOOK_SECRET_ENCRYPTION_KEY` | Shared base64 AES-256 key. Production Compose requires it; use the same value on admin and events. |
| `events.retention.event-ttl-days` | `90` | `EVENT_TTL_DAYS` | Runtime-emitted event record TTL |
| `events.retention.delivery-ttl-days` | `14` | `DELIVERY_TTL_DAYS` | Delivery record TTL stamped for the shared event plane |
| `events.retention.sweep-cron` | `0 30 3 * * *` | `EVENT_RETENTION_SWEEP_CRON` | Cron for stale event/delivery index cleanup |
| `cycles.evidence.queue.pending-key` | `evidence:pending` | `EVIDENCE_PENDING_KEY` | Source queue consumed by the events-service evidence worker |
| `cycles.evidence.store.key-prefix` | `evidence:envelope:` | `EVIDENCE_STORE_KEY_PREFIX` | Redis key prefix used by public evidence retrieval; must match the events service |

## Public endpoint rate limiting (v0.1.25.46)

The runtime server applies a fixed-window per-client-IP rate limit to the **public (unauthenticated)** endpoints only — `GET /v1/evidence/*` and the CyclesEvidence JWKS — implementing the spec's SHOULD-level 429 throttling (`error=LIMIT_EXCEEDED` with `Retry-After` and `X-RateLimit-Reset`). Authenticated `/v1` endpoints are not covered.

| Property | Default | Env Variable | Description |
|---|---|---|---|
| `cycles.public-rate-limit.enabled` | `true` | `CYCLES_PUBLIC_RATE_LIMIT_ENABLED` | Enable the public-endpoint rate limiter. |
| `cycles.public-rate-limit.requests-per-minute` | `300` | `CYCLES_PUBLIC_RATE_LIMIT_REQUESTS_PER_MINUTE` | Fixed 60s window per client IP, per instance. Keyed on the socket peer address — behind an ingress that terminates connections, prefer rate limiting there and/or raise this limit. |

## Event emission (v0.1.25.45)

The runtime emits webhook/event side effects through a bounded, non-blocking executor so a dispatch Redis outage or slow event persistence cannot grow heap without limit.

| Property | Default | Env Variable | Description |
|---|---|---|---|
| `cycles.events.emit.threads` | `0` | `CYCLES_EVENTS_EMIT_THREADS` | Worker threads for the non-blocking runtime event emitter. |
| `cycles.events.emit.queue-capacity` | `10000` | `CYCLES_EVENTS_EMIT_QUEUE_CAPACITY` | Bounded queue capacity; under sustained event-persistence outage, side effects past this bound are dropped (ledger mutations are unaffected). |

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

The runtime server publishes seven domain counters under `cycles_*_total` (introduced in v0.1.25.10); the events service publishes `cycles_webhook_*` counters plus a latency timer. The `tenant-tag.enabled` toggle is mirrored on both services, but note the defaults differ: `true` on the runtime, `false` on the events service. For the full metric enumeration, tag definitions, scrape targets, and alert recipes, see [Prometheus Metrics Reference](/how-to/prometheus-metrics-reference).

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
| `logging.level.io.runcycles.protocol` | `INFO` | Cycles-specific log level |
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

Since v0.1.25.45 (2026-06-27), the runtime server's `OperationalEndpointAuthFilter` protects the operational endpoints with the configured admin key: `/actuator/prometheus`, `/actuator/info`, and aggregate `/actuator/health` require `X-Admin-API-Key`. Only the liveness/readiness probe paths (`/actuator/health/liveness`, `/actuator/health/readiness`) remain unauthenticated for orchestrators. Prometheus scrapers must send `X-Admin-API-Key` on the scrape request, or have a trusted ingress inject it.

### Adding more endpoints

To expose additional actuator endpoints (e.g., `metrics`, `loggers`, `env`):

```properties
management.endpoints.web.exposure.include=health,info,prometheus,metrics,loggers
```

## Security configuration

The server's security is configured in `SecurityConfig.java` plus, since v0.1.25.45 (2026-06-27), `OperationalEndpointAuthFilter.java`, which moved the operational/docs endpoints behind the admin key.

Truly public paths (no key of any kind required):

- `/actuator/health/liveness`, `/actuator/health/readiness` — Kubernetes-style probes
- `/.well-known/**` — Well-known endpoints, including the CyclesEvidence JWKS
- `/v1/evidence/**` — Public evidence retrieval (rate-limited; see [Public endpoint rate limiting](#public-endpoint-rate-limiting-v0-1-25-46))
- `/favicon.ico` — Favicon

Admin-key-protected paths (require `X-Admin-API-Key`):

- `/actuator/**` — All other actuator endpoints, including `/actuator/prometheus`, `/actuator/info`, and aggregate `/actuator/health`
- `/api-docs/**`, `/v3/api-docs/**` — OpenAPI spec
- `/swagger*` — Swagger UI and resources
- `/webjars/**` — WebJar resources

All other paths require a valid `X-Cycles-API-Key` header.

## Representative runtime configuration

This example shows the common deployment settings. Use the tables above for maintenance, evidence, retention, and rate-limit tuning.

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
logging.level.io.runcycles.protocol=INFO

# Swagger
springdoc.api-docs.path=/api-docs
springdoc.swagger-ui.path=/swagger-ui.html
springdoc.swagger-ui.enabled=true

# Actuator
management.endpoints.web.exposure.include=health,info,prometheus
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
| `CYCLES_SCHEDULER_POOL_SIZE` | `spring.task.scheduling.pool.size` |
| `CYCLES_MAINTENANCE_LEASE_TTL_MS` | `cycles.maintenance.lease-ttl-ms` |
| `CYCLES_MAINTENANCE_RENEW_INTERVAL_MS` | `cycles.maintenance.renew-interval-ms` |
| `RESERVATION_CREATED_AT_INDEX_ENABLED` | `cycles.reservation-index.created-at.enabled` |
| `RESERVATION_CREATED_AT_INDEX_REPAIR_INTERVAL_MS` | `cycles.reservation-index.created-at.repair-interval-ms` |
| `RESERVATION_CREATED_AT_INDEX_INITIAL_DELAY_MS` | `cycles.reservation-index.created-at.initial-delay-ms` |
| `RESERVATION_CREATED_AT_INDEX_FAILURE_BACKOFF_MS` | `cycles.reservation-index.created-at.failure-backoff-ms` |
| `RESERVATION_CREATED_AT_INDEX_SWEEP_CRON` | `cycles.reservation-index.created-at.sweep-cron` |
| `ADMIN_API_KEY` | `admin.api-key` |
| `WEBHOOK_SECRET_ENCRYPTION_KEY` | `webhook.secret.encryption-key` |
| `EVENT_TTL_DAYS` | `events.retention.event-ttl-days` |
| `DELIVERY_TTL_DAYS` | `events.retention.delivery-ttl-days` |
| `EVENT_RETENTION_SWEEP_CRON` | `events.retention.sweep-cron` |
| `CYCLES_PUBLIC_RATE_LIMIT_ENABLED` | `cycles.public-rate-limit.enabled` |
| `CYCLES_PUBLIC_RATE_LIMIT_REQUESTS_PER_MINUTE` | `cycles.public-rate-limit.requests-per-minute` |
| `CYCLES_EVENTS_EMIT_THREADS` | `cycles.events.emit.threads` |
| `CYCLES_EVENTS_EMIT_QUEUE_CAPACITY` | `cycles.events.emit.queue-capacity` |
| `AUDIT_RETENTION_DAYS` | `audit.retention.days` |
| `AUDIT_SWEEP_CRON` | `audit.sweep.cron` |
| `EVIDENCE_PENDING_KEY` | `cycles.evidence.queue.pending-key` |
| `EVIDENCE_STORE_KEY_PREFIX` | `cycles.evidence.store.key-prefix` |
| `EVIDENCE_SERVER_ID` | `cycles.evidence.server-id` |
| `EVIDENCE_SIGNING_SIGNER_DID` | `cycles.evidence.signing.signer-did` |
| `EVIDENCE_SIGNING_KID` | `cycles.evidence.signing.kid` |
| `EVIDENCE_SIGNING_NBF_MS` | `cycles.evidence.signing.nbf-ms` |
| `EVIDENCE_SIGNING_RETIRED_KEYS` | `cycles.evidence.signing.retired-keys` |

These runtime-server variables configure CyclesEvidence signer-key publication and rotation. They are public identity/JWKS settings; the private `EVIDENCE_SIGNING_PRIVATE_KEY_HEX` lives only on `cycles-server-events` and is not read by `cycles-server`. `KID` / `NBF_MS` describe the active key's JWK; `RETIRED_KEYS` is the JSON rotation history. See [Signer-key resolution and rotation](/protocol/cycles-evidence-envelopes-in-cycles#signer-key-resolution-and-rotation) for the JWK shape and the rotation procedure, and the [identity enablement runbook](https://github.com/runcycles/cycles-server-events/blob/main/docs/evidence-identity-enablement.md) for first-time setup.

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
| `springdoc.api-docs.enabled` | `false` | `API_DOCS_ENABLED` | OpenAPI JSON spec endpoint (`/api-docs`) is disabled by default on the admin server; set to `true` to enable. |
| `auth.failure-rate-limit.enabled` | `false` | `AUTH_FAILURE_RATE_LIMIT_ENABLED` | Optional in-process guard for repeated 401/403 failures from the same source. Disabled by default for local/test parity; enable in production. |
| `auth.failure-rate-limit.max-per-minute` | `300` | `AUTH_FAILURE_RATE_LIMIT_MAX_PER_MINUTE` | Max auth failures per source per minute before throttling, when the guard is enabled. |
| `auth.failure-rate-limit.max-tracked-sources` | `10000` | `AUTH_FAILURE_RATE_LIMIT_MAX_TRACKED_SOURCES` | Bound the limiter's in-memory source/path buckets; the oldest live bucket is evicted at the cap. |
| `spring.task.scheduling.pool.size` | `2` | `TASK_SCHEDULER_POOL_SIZE` | Scheduler threads. Values below 2 are raised to the enforced safety floor. |
| `tenant-close.reconciler.enabled` | `true` | `TENANT_CLOSE_RECONCILER_ENABLED` | Retry incomplete Mode-B cascades for tenants already marked `CLOSED`. |
| `tenant-close.reconciler.interval-ms` | `300000` | `TENANT_CLOSE_RECONCILER_INTERVAL_MS` | Delay between reconciliation runs. |
| `tenant-close.reconciler.max-tenants-per-run` | `100` | `TENANT_CLOSE_RECONCILER_MAX_TENANTS_PER_RUN` | Maximum due tenant-close work items processed per run. |
| `webhook.secret.encryption-key` | (empty; startup fails) | `WEBHOOK_SECRET_ENCRYPTION_KEY` | Base64 AES-256 key used to encrypt webhook signing secrets. Must match runtime and events. |
| `webhook.secret.allow-plaintext` | `false` | `WEBHOOK_SECRET_ALLOW_PLAINTEXT` | Explicit local/development compatibility escape hatch. With an empty key, `true` permits plaintext and emits a prominent warning. Never enable in production. |
| `events.retention.event-ttl-days` | `90` | `EVENT_TTL_DAYS` | Shared event record TTL. |
| `events.retention.delivery-ttl-days` | `14` | `DELIVERY_TTL_DAYS` | Shared webhook-delivery record TTL. |
| `logging.level.io.runcycles.admin` | `INFO` | `LOG_LEVEL` | Admin-specific log level. |

### Audit log retention

Introduced in `cycles-server-admin` v0.1.25.20 for SOC2-compliant defaults. Failed requests (401/403/400/404/409/500) are now recorded alongside successes; retention is tiered so pre-auth failures expire faster than authenticated entries.

| Property | Default | Env Variable | Description |
|---|---|---|---|
| `audit.retention.authenticated.days` | `400` | `AUDIT_RETENTION_AUTHENTICATED_DAYS` | TTL on authenticated audit entries (success + authenticated failures). `400` covers the SOC2 Type II 12-month lookback + 1-month auditor-engagement buffer. Set to `0` for indefinite retention (legal hold, HIPAA-adjacent). |
| `audit.retention.unauthenticated.days` | `30` | `AUDIT_RETENTION_UNAUTHENTICATED_DAYS` | TTL on pre-auth failures (sentinel tenant `__unauth__`). Enough for brute-force / credential-stuffing post-mortem. Aggregate volume stays visible via Prometheus regardless of TTL. Set to `0` for indefinite. |
| `audit.sample.unauthenticated` | `1` | `AUDIT_SAMPLE_UNAUTHENTICATED` | Sampling rate on unauthenticated entries (`1` = every entry, `100` = 1 in 100). Opt-in hardening against failed-auth floods on internet-exposed admin endpoints. Authenticated entries are **never** sampled. |
| `audit.sweep.cron` | `0 0 3 * * *` | `AUDIT_SWEEP_CRON` | Cron for the daily audit-index sweep. Purges TTL-expired pointers from the `audit:logs:_all` + per-tenant sorted-set indexes. Skipped entirely when `audit.retention.authenticated.days=0`. |

**Alerting.** The Prometheus counter `cycles_admin_audit_writes_total{path_class, outcome}` tracks audit-write health. Alert on `outcome=error` nonzero — audit writes are non-fatal to the request, but silent coverage loss is the exact failure mode the tiered TTL is designed to prevent:

```
sum(rate(cycles_admin_audit_writes_total{outcome="error"}[5m])) > 0
```

**Semantic change for audit-log consumers.** Dashboards that assumed "audit entry exists ⇒ operation succeeded" must now check the entry's `status` or `error_code` field. Queries filtered by `status=201/200/204` return exactly the same rows as v0.1.25.19. See [Admin API guide](/admin-api/guide) for field semantics.

### Admin server Kubernetes probes

Like the runtime and events services, the admin server enables Spring Boot's liveness/readiness probes out of the box (`management.endpoint.health.probes.enabled=true`). In Kubernetes, wire probes to these paths:

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
| `X-Admin-API-Key` | `ADMIN_API_KEY` | System-level and operator operations: tenant CRUD, API key management, audit logs, admin-only budget state, and runtime reservation admin-on-behalf-of list/detail/release |
| `X-Cycles-API-Key` | — | Tenant-scoped operations: budget ledgers, policies, reservations, balances, events, and tenant self-service webhooks |

For the full endpoint-to-header mapping with required permissions, see the [Architecture Overview — Authentication](/quickstart/architecture-overview-how-cycles-fits-together#authentication).

### Representative admin server configuration

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

# Webhook signing-secret encryption (required by default)
webhook.secret.encryption-key=${WEBHOOK_SECRET_ENCRYPTION_KEY:}
webhook.secret.allow-plaintext=${WEBHOOK_SECRET_ALLOW_PLAINTEXT:false}

# JSON
spring.jackson.serialization.write-dates-as-timestamps=false
spring.jackson.deserialization.fail-on-unknown-properties=false
spring.jackson.default-property-inclusion=non_null

# Logging
logging.level.root=INFO
logging.level.io.runcycles.admin=DEBUG

# Swagger
springdoc.api-docs.path=/api-docs
springdoc.api-docs.enabled=false
springdoc.swagger-ui.path=/swagger-ui.html
springdoc.swagger-ui.enabled=false

# Actuator
management.endpoints.web.exposure.include=health,info
management.endpoint.health.show-details=when-authorized
```

### Security note

The admin server exposes powerful management operations. In production:

- Run the admin server on an internal network not accessible to application traffic
- Use a strong, randomly generated `ADMIN_API_KEY`
- Keep Swagger UI and API docs disabled unless operators explicitly need them (`springdoc.swagger-ui.enabled=false`, `springdoc.api-docs.enabled=false`)

## Events Service Configuration

The events service (`cycles-server-events`) is an optional component for webhook delivery and CyclesEvidence signing.

### Ports (v0.1.25.9)

As of v0.1.25.9 the events service separates its application port from its management (actuator) port:

| Port | Default | Env Variable | Purpose |
|---|---|---|---|
| Application | `7980` | `SERVER_PORT` | Spring application port. The current reference service is an outbound worker and exposes no operator-facing HTTP API here. |
| Management | `9980` | `MANAGEMENT_PORT` | Actuator endpoints (`/actuator/health`, `/actuator/info`, `/actuator/prometheus`) |

**Migration from pre-.9:** Prometheus scrape configs must point to `:9980/actuator/prometheus`. Kubernetes liveness / readiness probes and Docker `HEALTHCHECK` must hit `:9980/actuator/health`. The published Docker image `HEALTHCHECK` has already been updated. No wire-format change for the dispatch surface.

Do not publish either port to the internet. Keep `9980` on an internal-only ClusterIP scraped by Prometheus; leave `7980` unexposed unless your deployment has an explicit internal control-plane use for that app port.

### Core config

| Variable | Default | Description |
|---|---|---|
| `REDIS_HOST` | localhost | Redis hostname (shared with admin/runtime) |
| `REDIS_PORT` | 6379 | Redis port |
| `REDIS_PASSWORD` | (empty) | Redis password |
| `REDIS_USERNAME` | (empty) | Redis ACL username |
| `REDIS_TLS_ENABLED` | `false` | Enable TLS for the Redis connection |
| `REDIS_CONNECT_TIMEOUT_MS` | `2000` | Redis connection timeout |
| `REDIS_SOCKET_TIMEOUT_MS` | `5000` | Redis non-blocking socket timeout |
| `REDIS_BLOCKING_SOCKET_TIMEOUT_MS` | `10000` | Redis timeout used by blocking queue operations |
| `WEBHOOK_SECRET_ENCRYPTION_KEY` | (empty; startup fails) | AES-256-GCM key for signing secret encryption. Base64, 32 bytes. Must match admin and runtime. Generate: `openssl rand -base64 32`. |
| `WEBHOOK_SECRET_ALLOW_PLAINTEXT` | `false` | Explicit local/development compatibility escape hatch. Never enable in production. |
| `EVIDENCE_SERVER_ID` | (empty) | Issuer base URL including `/v1`. Blank disables evidence signing and leaves pending evidence-source records untouched. Must match the runtime server when evidence is enabled. |
| `EVIDENCE_SIGNING_SIGNER_DID` | (empty) | Raw-hex Ed25519 public key. Must match the runtime server's public signer identity when evidence is enabled. |
| `EVIDENCE_SIGNING_PRIVATE_KEY_HEX` | (empty) | Raw-hex Ed25519 private key used to sign evidence envelopes. Secret; deploy only to `cycles-server-events`. |
| `EVIDENCE_ALLOW_EPHEMERAL_SIGNING_KEY` | `false` | Allow the worker to generate an ephemeral signing key when no keypair is configured. Development-only; leave `false` in production. |
| `EVIDENCE_STORE_BACKEND` | `redis` | Select the evidence-store bean. The reference service ships only `redis`; another value requires a custom `EvidenceStore` implementation in the application context. |
| `dispatch.pending.timeout-seconds` | 5 | BLMOVE blocking timeout (reliable-queue pattern) |
| `DISPATCH_LOOP_DELAY_MS` | `25` | Delay before the next dispatch-loop iteration |
| `DISPATCH_ORDERING_LEASE_MS` | `120000` | Global claim/send lease. Must cover queue claim, HTTP delivery, and Redis state-write time. |
| `DISPATCH_ORDERING_CONTENTION_BACKOFF_MS` | `500` | Backoff when another replica owns the ordering lease |
| `DISPATCH_PROCESSING_RECOVERY_IDLE_MS` | `180000` | Minimum idle age before an in-flight delivery is eligible for recovery |
| `DISPATCH_PROCESSING_RECOVERY_INTERVAL_MS` | `30000` | Interval between recovery passes |
| `DISPATCH_FAILED_MAX_LEN` | `10000` | Maximum malformed/untransitionable delivery IDs retained in the quarantine list |
| `DISPATCH_EVENT_OUTBOX_POLL_INTERVAL_MS` | `1000` | Lifecycle-event outbox polling interval |
| `DISPATCH_EVENT_OUTBOX_BATCH_SIZE` | `25` | Maximum outbox rows claimed per poll |
| `DISPATCH_EVENT_OUTBOX_CLAIM_LEASE_MS` | `30000` | Outbox claim lease |
| `DISPATCH_EVENT_OUTBOX_RETRY_DELAY_MS` | `5000` | Retry delay after an outbox publish failure |
| `DISPATCH_EVENT_OUTBOX_MAX_ATTEMPTS` | `100` | Maximum publish attempts before quarantine |
| `DISPATCH_EVENT_OUTBOX_FAILED_MAX_LEN` | `10000` | Maximum quarantined outbox rows retained |
| `dispatch.retry.poll-interval-ms` | 5000 | Retry queue poll interval (ms) |
| `dispatch.retry.batch-size` / `RETRY_BATCH_SIZE` | 100 | Max ready-for-retry deliveries processed per poll tick |
| `dispatch.http.timeout-seconds` | 30 | HTTP request timeout for webhook delivery |
| `dispatch.http.connect-timeout-seconds` | 5 | HTTP connect timeout |
| `WEBHOOK_URL_GUARD_ALLOW_PRIVATE_NETWORKS` | `false` | Development-only opt-out for the delivery-side private-network SSRF baseline; admin-configured blocked CIDRs remain enforced |
| `dispatch.max-delivery-age-ms` / `MAX_DELIVERY_AGE_MS` | 86400000 | Deliveries older than this auto-fail without further retries (24h). Also feeds `cycles_webhook_delivery_stale_total`. |
| `events.retention.event-ttl-days` / `EVENT_TTL_DAYS` | 90 | Redis TTL for event records |
| `events.retention.delivery-ttl-days` / `DELIVERY_TTL_DAYS` | 14 | Redis TTL for delivery records |
| `events.retention.cleanup-interval-ms` / `RETENTION_CLEANUP_INTERVAL_MS` | 3600000 | ZSET index cleanup interval (1h) |
| `RETENTION_LOCK_LEASE_MS` | `300000` | Distributed lease duration for retention cleanup |
| `SCHEDULING_POOL_SIZE` | `5` | Scheduler pool sized for dispatch, evidence, retry, recovery, and cleanup jobs |
| `cycles.metrics.tenant-tag.enabled` | `false` | Same toggle as the runtime, but the events service defaults to `false` (the runtime defaults to `true`). When `false`, `cycles_webhook_*` counters drop the `tenant` label to bound cardinality. |

### Evidence queue and store tuning

| Variable | Default | Description |
|---|---|---|
| `EVIDENCE_PENDING_KEY` | `evidence:pending` | Pending source-record list; must match the runtime server |
| `EVIDENCE_PROCESSING_KEY` | `evidence:processing` | In-flight reliable-queue list |
| `EVIDENCE_POP_TIMEOUT_SECONDS` | `5` | BLMOVE timeout |
| `EVIDENCE_LOOP_DELAY_MS` | `25` | Delay between worker iterations |
| `EVIDENCE_QUEUE_FAILURE_BACKOFF_MS` | `1000` | Backoff for record-level failures |
| `EVIDENCE_INFRASTRUCTURE_BACKOFF_MS` | `30000` | Backoff for signing/store infrastructure failures |
| `EVIDENCE_RECOVERY_IDLE_MS` | `120000` | Minimum idle age before in-flight recovery |
| `EVIDENCE_RECOVERY_INTERVAL_MS` | `30000` | Interval between evidence recovery passes |
| `EVIDENCE_RECOVERY_BATCH_SIZE` | `100` | Maximum in-flight records recovered per pass |
| `EVIDENCE_FAILED_KEY` | `evidence:failed` | Dead-letter list for deterministically malformed source records |
| `EVIDENCE_FAILED_MAX_LEN` | `10000` | Maximum retained dead-letter records |
| `EVIDENCE_STORE_KEY_PREFIX` | `evidence:envelope:` | Content-addressed Redis key prefix; must match the runtime server |
| `EVIDENCE_STORE_TTL_SECONDS` | `0` | Envelope TTL; `0` means no expiry |

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

`WEBHOOK_SECRET_ENCRYPTION_KEY` must be the same on admin, runtime, and events services. Admin encrypts signing secrets on write; events decrypts on read. Current admin and events services fail startup when the key is missing. Local development may opt into plaintext explicitly with `WEBHOOK_SECRET_ALLOW_PLAINTEXT=true`; that escape hatch logs a warning and must never be enabled in production. Existing plaintext values remain readable during migration after a key is configured.

```bash
export WEBHOOK_SECRET_ENCRYPTION_KEY=$(openssl rand -base64 32)
```

### CyclesEvidence signer identity

To enable evidence, configure the same public identity on the runtime and events services:

- `EVIDENCE_SERVER_ID` — issuer URL, including `/v1`.
- `EVIDENCE_SIGNING_SIGNER_DID` — raw-hex public Ed25519 key.

Then configure only the events service with `EVIDENCE_SIGNING_PRIVATE_KEY_HEX`. Configure only the runtime server with `EVIDENCE_SIGNING_KID`, `EVIDENCE_SIGNING_NBF_MS`, and `EVIDENCE_SIGNING_RETIRED_KEYS` so it can publish `GET /v1/.well-known/cycles-jwks.json`.

### Representative events service configuration

```bash
# Required — must match admin and runtime servers
REDIS_HOST=redis.example.com
REDIS_PORT=6379
REDIS_PASSWORD=your-redis-password
WEBHOOK_SECRET_ENCRYPTION_KEY=$(openssl rand -base64 32)

# Optional — CyclesEvidence signer identity
EVIDENCE_SERVER_ID=https://cycles.example.com/v1
EVIDENCE_SIGNING_SIGNER_DID=b10554...c522
EVIDENCE_SIGNING_PRIVATE_KEY_HEX=4f9c...d20a

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
