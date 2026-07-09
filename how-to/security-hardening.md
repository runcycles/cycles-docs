---
title: "Security Hardening"
description: "Security best practices for production Cycles deployments including network isolation, API key rotation, and access control."
---

# Security Hardening

This guide covers security best practices for a production Cycles deployment.

::: warning Critical
The Admin Server (port 7979) should **never** be exposed to the public internet. It has full control over tenants, API keys, and budgets.
:::

## Network isolation

### Separate management and runtime planes

All Cycles services — Server, Admin Server, Events Service — run on the internal network. Only a load balancer should be exposed to application traffic. The Admin Server (port 7979), Events Service app/management ports (7980/9980), Cycles Server (port 7878), and Redis (port 6379) should **never be accessible from the public internet**.

<NetworkZones />

### Firewall rules

| Source | Destination | Port | Allow |
|---|---|---|---|
| Public internet | Load Balancer | 443 (HTTPS) | Yes |
| Load Balancer | Cycles Server | 7878 (internal) | Yes |
| Application servers (internal) | Cycles Server | 7878 | Yes |
| Operations team (VPN) | Admin Server | 7979 | Yes |
| Cycles Server | Redis | 6379 | Yes |
| Admin Server | Redis | 6379 | Yes |
| Events Service | Redis | 6379 | Yes |
| Events Service | External webhook endpoints | 443 (HTTPS) | Yes |
| Public internet | Cycles Server | 7878 | **No** |
| Public internet | Admin Server | 7979 | **No** |
| Public internet | Events Service | 7980/9980 | **No** |
| Public internet | Redis | 6379 | **No** |

## Redis security

### Authentication

Always set a strong Redis password in production:

```yaml
# docker-compose.yml
redis:
  image: redis:7-alpine
  command: redis-server --requirepass ${REDIS_PASSWORD} --appendonly yes

cycles-server:
  environment:
    REDIS_PASSWORD: ${REDIS_PASSWORD}

cycles-admin:
  environment:
    REDIS_PASSWORD: ${REDIS_PASSWORD}

cycles-events:
  environment:
    REDIS_PASSWORD: ${REDIS_PASSWORD}
```

All three services — Server, Admin Server, and Events Service — connect to the same Redis, so all three need `REDIS_PASSWORD` set.

Generate a strong password:

```bash
openssl rand -base64 32
```

### Redis TLS

For environments where Redis traffic crosses network boundaries, enable TLS:

```conf
# redis.conf
tls-port 6380
port 0  # Disable non-TLS port
tls-cert-file /etc/redis/tls/redis.crt
tls-key-file /etc/redis/tls/redis.key
tls-ca-cert-file /etc/redis/tls/ca.crt
```

### Redis ACLs

Restrict the Cycles service account to the key patterns the services actually use. All three services (Server, Admin Server, Events Service) share this account, so the pattern list must cover every prefix — omitting the event/delivery/dispatch/evidence prefixes breaks the Events Service:

```conf
# redis.conf
user cycles on >${REDIS_PASSWORD} ~tenant:* ~budget:* ~budgets:* ~reservation:* ~reserve:* ~idem:* ~idempotency:* ~apikey:* ~apikeys:* ~policy:* ~policies:* ~audit:* ~event:* ~events:* ~delivery:* ~deliveries:* ~dispatch:* ~webhook:* ~webhooks:* ~evidence:* ~config:* ~replay:* +@all
user default off
```

Key prefixes by service:

| Service | Key prefixes |
|---|---|
| Cycles Server | `tenant:`, `budget:`, `reservation:`, `reserve:`, `idem:`, `apikey:`, `audit:`, `event:`, `events:`, `delivery:`, `deliveries:`, `dispatch:`, `webhook:`, `webhooks:`, `evidence:` |
| Admin Server | `tenant:`, `budget:`, `budgets:`, `apikey:`, `apikeys:`, `policy:`, `policies:`, `audit:`, `event:`, `events:`, `delivery:`, `deliveries:`, `dispatch:`, `webhook:`, `webhooks:`, `replay:`, `idem:`, `config:` |
| Events Service | `event:`, `events:`, `delivery:`, `deliveries:`, `dispatch:`, `webhook:`, `evidence:`, `config:` |

### Disable dangerous commands

```conf
rename-command FLUSHDB ""
rename-command FLUSHALL ""
rename-command DEBUG ""
rename-command CONFIG ""
```

## API key management

### Key rotation

API keys should be rotated regularly:

1. Create a new key with the same permissions
2. Update the application configuration to use the new key
3. Verify the application works with the new key
4. Revoke the old key

```bash
# 1. Create new key
NEW_KEY=$(curl -s -X POST http://localhost:7979/v1/admin/api-keys \
  -H "Content-Type: application/json" \
  -H "X-Admin-API-Key: $ADMIN_KEY" \
  -d '{
    "tenant_id": "acme-corp",
    "name": "prod-key-v2",
    "permissions": ["reservations:create","reservations:commit","reservations:release","reservations:extend","balances:read"]
  }' | jq -r '.key_secret')

# 2. Update application config (deploy with new key)
# 3. Verify application health

# 4. Revoke old key
curl -s -X DELETE "http://localhost:7979/v1/admin/api-keys/${OLD_KEY_ID}" \
  -H "X-Admin-API-Key: $ADMIN_KEY"
```

### Least-privilege permissions

Only grant the permissions each component needs:

| Component | Permissions needed |
|---|---|
| Application (runtime) | `reservations:create`, `reservations:commit`, `reservations:release`, `reservations:extend`, `balances:read` |
| Monitoring service | `balances:read`, `reservations:list` |
| Batch processor | `reservations:create`, `reservations:commit` |

Don't give application keys full permissions when they only need a subset.

### Admin key security

The `ADMIN_API_KEY` (used in the `X-Admin-API-Key` header) has full administrative access. Protect it:

- Store in a secrets manager (AWS Secrets Manager, HashiCorp Vault, etc.)
- Never commit to source control
- Rotate on a schedule
- Limit who can access it

### Key storage in applications

```bash
# Good: environment variables from secrets manager
export CYCLES_API_KEY=$(aws secretsmanager get-secret-value --secret-id cycles/api-key --query SecretString --output text)

# Bad: hardcoded in source code
# CYCLES_API_KEY = "cyc_live_abc123..."  # NEVER DO THIS
```

## Audit logging

The Admin Server records audit logs for administrative operations. Use these for:

- **Compliance:** Track who created/modified/revoked API keys
- **Incident response:** Determine when a tenant or budget was changed
- **Access review:** Identify unused or over-privileged keys

Query audit logs:

```bash
curl -s "http://localhost:7979/v1/admin/audit/logs?tenant_id=acme-corp&limit=50" \
  -H "X-Admin-API-Key: $ADMIN_KEY" | jq .
```

### Retention policy

- **Hot storage (Redis):** 400 days for authenticated admin operations, 30 days for unauthenticated (failed-auth) entries — queryable via the API. Configurable via `AUDIT_RETENTION_AUTHENTICATED_DAYS` and `AUDIT_RETENTION_UNAUTHENTICATED_DAYS`.
- **Cold storage:** Export to S3/GCS/etc. for long-term retention (1+ year recommended for compliance)

Don't confuse audit retention with event retention: 90 days is the event TTL (`EVENT_TTL_DAYS`), not the audit log retention.

Set up a periodic export job to archive audit logs before they expire from Redis.

## Actuator authentication

Since Cycles Server `0.1.25.45`, operational endpoints — `/actuator/prometheus`, `/actuator/info`, the aggregate `/actuator/health`, API docs, and Swagger — require the `X-Admin-API-Key` header. Only the orchestrator probes `/actuator/health/liveness` and `/actuator/health/readiness` remain public. The Admin Server enforces the same rule. Prometheus scrapers that read these endpoints must send the header.

The Events Service exposes its actuator on a separate management port (9980), which is unauthenticated by design — the separate port is its isolation mechanism. Never publish port 9980 to the host or expose it beyond the internal network; isolate it at the network layer and scrape Prometheus from inside that boundary.

## TLS for client-to-server communication

Terminate TLS at the load balancer or reverse proxy. See the [Production Operations Guide](/how-to/production-operations-guide) for nginx configuration.

For service-to-service communication within a trusted network (e.g., Kubernetes cluster), plain HTTP to the Cycles Server is acceptable if network policies restrict access.

## Container security

### Run as non-root

The Cycles Server Docker images run as a non-root user by default. Verify (the image's entrypoint launches the Java server, so `whoami` must be passed with `--entrypoint` — appending it as a command argument is ignored):

```bash
docker run --rm --entrypoint whoami ghcr.io/runcycles/cycles-server:0.1.25.46
```

### Pin image versions

Use specific version tags, not `latest`:

```yaml
image: ghcr.io/runcycles/cycles-server:0.1.25.46  # Pinned
# NOT: ghcr.io/runcycles/cycles-server:latest   # Unpinned
```

### Read-only filesystem

Mount the container filesystem as read-only:

```yaml
cycles-server:
  image: ghcr.io/runcycles/cycles-server:0.1.25.46
  read_only: true
  tmpfs:
    - /tmp
```

## Security checklist

- [ ] Admin Server not accessible from public internet
- [ ] Redis not accessible from public internet
- [ ] Redis password set and stored in secrets manager
- [ ] API keys use least-privilege permissions
- [ ] Admin key stored in secrets manager, not in source control
- [ ] TLS termination configured for client-facing traffic
- [ ] Container images pinned to specific versions
- [ ] Audit log retention policy defined
- [ ] Key rotation schedule established
- [ ] Dangerous Redis commands disabled
- [ ] Actuator/management endpoints protected: `X-Admin-API-Key` required, Events Service port 9980 not published
- [ ] `allow_http=false` in webhook security config (all environments)
- [ ] `WEBHOOK_SECRET_ENCRYPTION_KEY` generated and stored in secrets manager
- [ ] Webhook URL security: HTTPS enforced, private CIDR ranges blocked
- [ ] Signing secret rotation procedure documented

## Webhook Security

### Signing secret encryption at rest

Webhook signing secrets are encrypted in Redis using AES-256-GCM. All three services must share the same key via `WEBHOOK_SECRET_ENCRYPTION_KEY`. Generate with `openssl rand -base64 32`. Store in a secrets manager — not in source code.

### SSRF prevention

Webhook URLs resolving to private IPs are blocked by default (`10.0.0.0/8`, `172.16.0.0/12`, `192.168.0.0/16`, loopback, link-local). HTTP is rejected by default — keep `allow_http=false` **always**, in every environment, not just production. Configure via `PUT /v1/admin/config/webhook-security`.

### Signing secret rotation

`PATCH /v1/admin/webhooks/{id}` with a new `signing_secret`. Update the consumer to verify the new secret. In-flight retries will use the old secret until retried with the new one.

### Encryption key rotation

Rotating `WEBHOOK_SECRET_ENCRYPTION_KEY` requires decrypting all secrets with the old key, re-encrypting with the new key, and restarting all services simultaneously.

## Next steps

- [Security Overview](/security) — data residency, audit trail, compliance posture
- [Production Operations Guide](/how-to/production-operations-guide) — deployment and infrastructure
- [Monitoring and Alerting](/how-to/monitoring-and-alerting) — metrics and alerting
- [API Key Management](/how-to/api-key-management-in-cycles) — key lifecycle management
