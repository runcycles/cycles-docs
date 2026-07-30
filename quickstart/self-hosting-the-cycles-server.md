---
title: "Self-Hosting the Cycles Server"
description: "Run the Cycles budget enforcement server locally, with Docker, or in production. Covers configuration, Redis setup, scaling, and health checks."
---

# Self-Hosting the Cycles Server

The Cycles server is a Spring Boot application that enforces budget reservations backed by Redis. This guide covers how to run it locally, with Docker, and in production.

::: tip This guide covers the runtime Cycles Server (port 7878) only
The full Cycles stack includes three services: the **Cycles Server** (runtime enforcement, covered here), the **Admin Server** (port 7979, tenant/budget management), and the optional **Events Service** (outbound webhook delivery worker; app port 7980 and management port 9980 stay internal). See [Deploying the Full Cycles Stack](/quickstart/deploying-the-full-cycles-stack) for the end-to-end guide covering all components. For a web UI on top of the stack, see [Deploy the Admin Dashboard](/quickstart/deploying-the-cycles-dashboard).
:::

## Choose your path

- **Just the runtime server** — follow this guide.
- **Full local stack (server + admin + dashboard)** — see [Deploying the Full Cycles Stack](/quickstart/deploying-the-full-cycles-stack). Recommended for evaluation.
- **Evaluate Cycles for a multi-tenant agent SaaS** — start with the [evaluation guide](/how-to/evaluate-cycles-for-agent-saas) before deciding what to deploy.
- **Not sure where Cycles fits?** [Send us your agent/tool-call flow](/contact) and we'll map where `reserve` / `commit` should sit.

## Prerequisites

- **Docker** and **Docker Compose** (for the quick path — no Java needed), or
- **Java 21+** and **Maven 3.9+** (for building from source)
- **Redis 7+** (required for Lua script compatibility)

## Quick start with Docker Compose

### Using pre-built GHCR images (recommended)

The fastest way to get the Cycles server running. No Java or Maven required:

```bash
cd cycles-server
docker compose -f docker-compose.prod.yml up -d
```

This pulls `ghcr.io/runcycles/cycles-server:0.1.25.59` (the version pinned in `docker-compose.prod.yml`) and starts it with Redis. The prod compose file requires `REDIS_PASSWORD` and `ADMIN_API_KEY` to be set and fails fast if either is missing.

::: tip Pinning versions
`docker-compose.prod.yml` pins a specific version tag so deployments are reproducible. To upgrade, update the existing pin to the new tag and re-run `docker compose -f docker-compose.prod.yml up -d`. Check [GitHub releases](https://github.com/runcycles/cycles-server/releases) for the current stable version.
:::

### Building from source with Docker

The repository includes a multi-stage Dockerfile that builds the JAR inside Docker — no local Java or Maven needed:

```bash
cd cycles-server
docker compose up -d
```

This uses `docker-compose.yml` which builds from source via the multi-stage Dockerfile.

### Full stack (with Admin Server)

To run both the Cycles Server and Admin Server together:

```bash
cd cycles-server
docker compose -f docker-compose.full-stack.yml up -d       # build from source
docker compose -f docker-compose.full-stack.prod.yml up -d   # use GHCR images
```

The full-stack compose files expect `cycles-server-admin` and `cycles-server-events` to be cloned alongside as sibling directories.

The server is available at `http://localhost:7878`.

Verify it is running:

```bash
curl http://localhost:7878/actuator/health/readiness
```

Since cycles-server 0.1.25.45 the aggregate `/actuator/health`, `/actuator/prometheus`, and the API docs/Swagger UI require an `X-Admin-API-Key` header — only the liveness/readiness probes stay public.

## Running from source

Clone the repository and build:

```bash
git clone https://github.com/runcycles/cycles-server.git
cd cycles-server/cycles-protocol-service
mvn clean package -DskipTests
```

Start Redis (if not already running):

```bash
redis-server
```

Run the server:

```bash
java -jar cycles-protocol-service-api/target/cycles-protocol-service-api-*.jar
```

The server starts on port 7878 by default.

## Configuration

The server is configured via environment variables or `application.properties`.

### Environment variables

| Variable | Default | Description |
|---|---|---|
| `REDIS_HOST` | `localhost` | Redis server hostname |
| `REDIS_PORT` | `6379` | Redis server port |
| `REDIS_PASSWORD` | (empty) | Redis password (optional) |
| `ADMIN_API_KEY` | (empty) | Admin key for the protected operational endpoints and admin-on-behalf-of dual-auth paths. Required (`:?`) in the prod compose files |
| `DASHBOARD_CORS_ORIGIN` | (empty) | Comma-separated browser origin(s) allowed for the Cycles dashboard. Passed through in the stack compose files; set the same value on the admin server |
| `WEBHOOK_SECRET_ENCRYPTION_KEY` | (empty) | Encryption key for webhook secrets, shared with `cycles-server-admin` and `cycles-server-events` |
| `CYCLES_PUBLIC_RATE_LIMIT_ENABLED` | `true` | Per-IP 429 rate limiting on the public evidence/JWKS endpoints (since 0.1.25.46) |
| `CYCLES_PUBLIC_RATE_LIMIT_REQUESTS_PER_MINUTE` | `300` | Fixed-window per-IP request budget for the public endpoints |
| `server.port` | `7878` | HTTP server port |
| `cycles.expiry.interval-ms` | `5000` | Interval for the background reservation expiry sweep (ms) |

### Application properties (excerpt)

The most commonly tuned properties from `application.properties`. See the [Server Configuration Reference](/configuration/server-configuration-reference-for-cycles) for the full list, including evidence signing, audit retention, and event emitter settings:

```properties
# Server
server.port=7878

# Redis
redis.host=${REDIS_HOST:localhost}
redis.port=${REDIS_PORT:6379}
redis.password=${REDIS_PASSWORD:}

# Admin key for protected operational endpoints + dual-auth paths
admin.api-key=${ADMIN_API_KEY:}

# Webhook secret encryption (shared key with cycles-server-admin)
webhook.secret.encryption-key=${WEBHOOK_SECRET_ENCRYPTION_KEY:}

# Reservation expiry sweep interval
cycles.expiry.interval-ms=5000

# Public evidence/JWKS endpoint rate limit (since 0.1.25.46)
cycles.public-rate-limit.enabled=${CYCLES_PUBLIC_RATE_LIMIT_ENABLED:true}
cycles.public-rate-limit.requests-per-minute=${CYCLES_PUBLIC_RATE_LIMIT_REQUESTS_PER_MINUTE:300}

# Logging
logging.level.root=INFO
logging.level.io.runcycles.protocol=INFO

# OpenAPI / Swagger UI
springdoc.api-docs.path=/api-docs
springdoc.swagger-ui.path=/swagger-ui.html
springdoc.swagger-ui.enabled=true

# Actuator (liveness/readiness probe groups enabled)
management.endpoints.web.exposure.include=health,info,prometheus
management.endpoint.health.show-details=when-authorized
management.endpoint.health.probes.enabled=true
```

## Redis connection

The server uses a JedisPool with a default maximum of 128 connections (32 max idle, 16 min idle, 2000 ms max wait). Redis 7+ is required because the Lua scripts use features not available in earlier versions.

### Redis with authentication

Set the `REDIS_PASSWORD` environment variable:

```bash
REDIS_PASSWORD=your-redis-password java -jar cycles-protocol-service-api-*.jar
```

### Redis connection pool

The default pool configuration (128 max total, 32 max idle, 16 min idle, 2000 ms max wait) is sufficient for most workloads. For high-throughput deployments, tune it with the `redis.pool.max-total`, `redis.pool.max-idle`, `redis.pool.min-idle`, and `redis.pool.max-wait-ms` properties — no code change required.

## Background expiry sweep

The server runs a background task every 5 seconds (configurable via `cycles.expiry.interval-ms`) that:

1. Scans the reservation TTL sorted set for expired entries
2. Marks expired reservations as `EXPIRED`
3. Releases their reserved budget back to the affected scopes

This ensures abandoned reservations (from crashed clients or network failures) do not permanently consume budget.

## Health checks

The server exposes Spring Boot Actuator health endpoints. The Kubernetes-style probes are public; readiness includes the Redis dependency:

```bash
# Liveness (process only)
curl http://localhost:7878/actuator/health/liveness

# Readiness (includes Redis)
curl http://localhost:7878/actuator/health/readiness

# Aggregate health — requires the admin key since 0.1.25.45
curl -H "X-Admin-API-Key: $ADMIN_API_KEY" http://localhost:7878/actuator/health
```

Since 0.1.25.45, the aggregate `/actuator/health`, `/actuator/prometheus`, `/actuator/info`, and the API docs/Swagger UI require the `X-Admin-API-Key` header. Only `/actuator/health/liveness` and `/actuator/health/readiness` remain public for orchestrators.

## Swagger UI

The server includes interactive API documentation via Swagger UI:

```
http://localhost:7878/swagger-ui.html
```

The raw OpenAPI spec is available at:

```
http://localhost:7878/api-docs
```

::: warning Admin key required; disabled in the prod compose
Since 0.1.25.45, Swagger UI and `/api-docs` require the `X-Admin-API-Key` header. The production compose files additionally disable them entirely via `SPRINGDOC_API_DOCS_ENABLED=false` and `SPRINGDOC_SWAGGER_UI_ENABLED=false`.
:::

## Production considerations

### Stateless server

The Cycles server is stateless — all state lives in Redis. You can run multiple server instances behind a load balancer without sticky sessions.

### Redis persistence

Enable Redis persistence (RDB or AOF) to survive Redis restarts without losing budget state. For production:

```
# redis.conf
appendonly yes
appendfsync everysec
```

### Redis memory

Budget data is compact. Each scope stores a few counters. Each active reservation stores its metadata. Typical memory usage is low unless you have millions of concurrent reservations.

### Security

- Always run the server behind HTTPS in production (use a reverse proxy like nginx or a cloud load balancer)
- Use strong, unique API keys per tenant
- Set `REDIS_PASSWORD` and restrict Redis network access
- Consider running Redis in a private subnet not accessible from the internet

### Scaling

For higher throughput:

- Add more Cycles server instances behind a load balancer
- Use Redis Cluster for horizontal scaling of budget state
- Tune the JedisPool connection count based on your concurrency needs

## Verifying your deployment

After starting the server, verify the full lifecycle works. You need an API key and a budget already configured via the [Cycles Admin Server](/quickstart/deploying-the-full-cycles-stack):

```bash
# Create a reservation (requires a valid API key and budget for the tenant scope)
curl -s -X POST http://localhost:7878/v1/reservations \
  -H "Content-Type: application/json" \
  -H "X-Cycles-API-Key: $CYCLES_API_KEY" \
  -d '{
    "idempotency_key": "test-001",
    "subject": { "tenant": "acme-corp" },
    "action": { "kind": "test", "name": "verify" },
    "estimate": { "amount": 100, "unit": "USD_MICROCENTS" }
  }'
```

If the server is configured correctly, you will receive a JSON response with a `reservation_id` and `"decision": "ALLOW"`.

If you get `BUDGET_EXCEEDED`, you need to create a budget via the admin server first. If you get `UNAUTHORIZED`, verify your API key was created correctly. See the [full stack deployment guide](/quickstart/deploying-the-full-cycles-stack) for the complete bootstrap sequence.

## Next steps

- [API Reference](/api/) — interactive endpoint documentation
- [Server Configuration Reference](/configuration/server-configuration-reference-for-cycles) — all configuration properties
- [Architecture Overview](/quickstart/architecture-overview-how-cycles-fits-together) — how the components fit together
