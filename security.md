---
title: "Cycles Security"
description: "Cycles security posture for AI agent budget enforcement: data residency, queryable event audit trail, tenant isolation, least-privilege API keys, and SOC 2 compliance status."
---

# Cycles Security

Cycles is infrastructure that sits in the execution path of autonomous agents. Security is a first-order concern.

## Data residency

All Cycles state lives in Redis. Cycles is currently self-hosted only: Redis runs in your infrastructure, no data leaves your network, and you control the region, the instance type, and the retention policy.

Cycles stores budget state — reservation amounts, balances, event records, and tenant configuration. It does not store LLM prompts, responses, or any content from agent interactions.

A managed cloud offering (RunCycles.io) is planned. It is not yet available.

## Event audit trail

Every budget operation — reservation, commit, release, event — creates a structured record:

| Field | Description |
|---|---|
| `reservation_id` / `event_id` | Unique identifier for the operation |
| `subject` | Full scope hierarchy (tenant, workspace, app, workflow, agent, toolset) |
| `action` | What happened (kind, name, tags) |
| `estimate` | Budget locked before execution (reservations) |
| `actual` | Usage recorded after execution (commits and events) |
| `status` | RESERVED, COMMITTED, RELEASED, EXPIRED, APPLIED |
| `metrics` | Operational metadata (tokens, latency, model version) |
| `metadata` | Arbitrary key-value pairs for audit context |

Every reservation, commit, release, and event is logged with the scope context needed for audit. The trail answers "which agent spent how much, on what, and when" from the budget ledger alone.

### Querying the audit trail

Events and reservations are queryable via the REST API:

```bash
# List reservations for a tenant
curl -s "http://localhost:7878/v1/reservations?tenant=acme-corp&status=COMMITTED" \
  -H "X-Cycles-API-Key: $CYCLES_API_KEY"

# Admin audit logs (administrative operations)
curl -s "http://localhost:7979/v1/admin/audit/logs?tenant_id=acme-corp&limit=50" \
  -H "X-Admin-API-Key: $ADMIN_KEY"
```

### Retention

- **Hot storage (Redis)**: 90 days — queryable via API in real time
- **Cold storage**: Export to S3, GCS, or any object store for long-term retention. Recommended: 1+ year for compliance

## Access control

All Cycles services run on the internal network. Only the load balancer is exposed to application traffic.

| Component | Port | Network | Access |
|---|---|---|---|
| Load Balancer | 443 | DMZ / edge | Application traffic (TLS termination) |
| Cycles Server | 7878 | **Internal only** | Application servers via load balancer — never exposed directly |
| Admin Server | 7979 | **Internal / VPN only** | Operations team and CI/CD pipelines only |
| Events Service (API) | 7980 | **Internal only** | No inbound traffic — outbound webhook delivery only |
| Events Service (management) | 9980 | **Internal only** | Actuator endpoints (`/actuator/health`, `/actuator/prometheus`) as of v0.1.25.9 — Prometheus scrape target |
| Redis | 6379 | **Internal only** | Shared by all Cycles services — never exposed directly |

<NetworkZones />

### API key security

- **Least-privilege**: Each key is scoped to specific permissions (e.g., `reservations:create`, `balances:read`). Application keys never get admin access.
- **Rotation**: Keys can be rotated without downtime — create new key, deploy, revoke old key.
- **Revocation**: Immediate. A revoked key is rejected on the next request.
- **Storage**: Keys should live in a secrets manager (AWS Secrets Manager, HashiCorp Vault), never in source control.

## Deployment model

Cycles ships today as self-hosted open source. Redis, the runtime server, the admin server, and the events service all run inside your infrastructure. Data location, network exposure, Redis operation, admin-server access, and compliance scope are all under your control and inherit your existing audit perimeter.

A managed cloud offering (RunCycles.io) is on the roadmap. When it ships, this page will document its data-residency, access-control, and certification posture.

## Webhook security

Cycles delivers events to external HTTP endpoints via webhooks. Three layers protect this surface:

### HMAC-SHA256 signature verification

Every webhook delivery includes an `X-Cycles-Signature` header containing `sha256=<hex>`, the HMAC-SHA256 of the raw JSON body using the subscription's signing secret as the key. Receivers **must** verify this header before processing the payload. This proves both the sender's identity (shared secret) and the body's integrity (hash match).

Signing secrets are generated at subscription creation and returned exactly once. They should be stored in a secrets manager, not in application code.

See [Webhook Integrations](/how-to/webhook-integrations#signature-verification) for verification code in Python, Node.js, Go, and Java.

### SSRF protection

Webhook URLs are validated on creation and update to prevent Server-Side Request Forgery:

- **HTTPS required** — HTTP URLs are rejected by default (`allow_http: false`)
- **Private IP blocking** — Resolved IPs are checked against private/reserved ranges (loopback, RFC 1918, link-local, IPv6 private). This check is always enforced regardless of configuration.
- **URL pattern allowlisting** — Optional `allowed_url_patterns` restrict accepted URLs to specific domains

Default blocked CIDRs: `10.0.0.0/8`, `172.16.0.0/12`, `192.168.0.0/16`, `127.0.0.0/8`, `169.254.0.0/16`, `::1/128`, `fc00::/7`

Configuration is managed via `GET/PUT /v1/admin/config/webhook-security`. See the [Admin API Guide](/admin-api/guide#pillar-4-events-webhooks-v0-1-25) for examples.

### Signing secret encryption at rest

Webhook signing secrets are encrypted in Redis using AES-256-GCM with a 12-byte random IV per encryption. The encryption key (`WEBHOOK_SECRET_ENCRYPTION_KEY`) must be shared across the admin, runtime, and events services. If not set, secrets are stored in plaintext (backward compatible for development).

### At-least-once delivery

Webhooks are delivered at least once. Network retries, service restarts, or replay operations may cause duplicate deliveries. Receivers should deduplicate using the `X-Cycles-Event-Id` header (unique per event). Store processed event IDs with a short TTL (e.g., 24 hours) to detect replays.

## Certification status

Cycles is currently self-hosted only, so compliance posture inherits whatever your own infrastructure and audit perimeter already provide. This page and the [Security Hardening Guide](/how-to/security-hardening) document exactly what we log, how we store it, and how access is controlled, so your security and compliance teams can evaluate Cycles against your existing controls.

A formal certification program (starting with SOC 2 Type I) will accompany the planned managed cloud offering. It is not yet in progress.

## Dependencies and supply chain

Cycles is built from a small, mainstream runtime stack:

- **Runtime, admin, and events services**: Java (LTS) on Spring Boot; Redis for state
- **Client SDKs**: Python, TypeScript, Java, Rust
- **Operator dashboard**: Vue 3 served via nginx

Dependencies are monitored by GitHub Dependabot across all [runcycles](https://github.com/runcycles) production repositories (server, admin, events, protocol, and the four client SDKs). Security-relevant updates are tracked on the affected repository's Security tab.

CVEs are disclosed as [GitHub Security Advisories](https://github.com/runcycles/.github/security/policy) on the affected repository. An SBOM (CycloneDX) is available on request — open a discussion on the relevant repo or email the address below.

## Reporting a vulnerability

The Runcycles [organization-wide security policy](https://github.com/runcycles/.github/security/policy) is the canonical reference. In short:

- **Do not** open a public GitHub issue for security reports
- Email **security@runcycles.io** with the affected repository, version, reproduction steps, and impact
- Expect acknowledgement within 48 hours, an initial assessment within 5 business days, and a fix timeline within 10 business days
- Coordinated disclosure: we aim to ship fixes within 30 days of a confirmed report, and credit researchers in the published advisory unless they prefer otherwise

The documentation repository itself is out of scope — report documentation issues as normal GitHub issues.

## Next steps

- [Security Hardening Guide](/how-to/security-hardening) — operational security checklist for production deployments
- [Authentication and Tenancy](/protocol/authentication-tenancy-and-api-keys-in-cycles) — how API keys, tenants, and scopes work
- [API Key Management](/how-to/api-key-management-in-cycles) — key lifecycle, rotation, and least-privilege setup
