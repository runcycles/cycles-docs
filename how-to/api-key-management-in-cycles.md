---
title: "API Key Management in Cycles"
description: "Create, manage, and rotate API keys in Cycles with tenant isolation, key lifecycle states, and best practices for production key rotation."
---

# API Key Management in Cycles

Every request to the Cycles server requires an API key. This page explains how API keys work, how to create and manage them, and how they relate to tenant isolation.

## How API keys work

The Cycles server authenticates requests using the `X-Cycles-API-Key` header. Each API key is associated with exactly one tenant.

When a request arrives:

1. The server extracts the `X-Cycles-API-Key` header
2. Validates the key exists and is active
3. Derives the effective tenant from the key
4. Verifies that `subject.tenant` in the request body matches the key's tenant
5. If any check fails, returns `401 UNAUTHORIZED` or `403 FORBIDDEN`

This ensures strict tenant isolation — an API key for tenant A cannot create reservations or query balances for tenant B.

## Key states

An API key can be in one of three states:

| State | Meaning |
|---|---|
| `ACTIVE` | Key is valid and can be used for requests |
| `REVOKED` | Key has been manually disabled |
| `EXPIRED` | Key has passed its expiration date |

Only `ACTIVE` keys are accepted. Requests with `REVOKED` or `EXPIRED` keys receive `401 UNAUTHORIZED`.

## Creating API keys

API keys are managed through the [Cycles Admin](https://github.com/runcycles/cycles-server-admin) interface:

```bash
# Create a new API key for a tenant
curl -X POST http://localhost:7979/v1/admin/api-keys \
  -H "Content-Type: application/json" \
  -H "X-Admin-API-Key: $ADMIN_API_KEY" \
  -d '{
    "tenant_id": "acme",
    "name": "production-chatbot",
    "description": "Production chatbot key",
    "permissions": ["reservations:create", "reservations:commit", "reservations:release", "balances:read"]
  }'
```

<a id="available-permissions"></a>
### Available permissions (27 total)

**Tenant-scoped permissions** (used with `X-Cycles-API-Key` for runtime and tenant operations):

| Permission | Grants | Default |
|---|---|---|
| `reservations:create` | Create new reservations | Yes |
| `reservations:commit` | Commit existing reservations | Yes |
| `reservations:release` | Release existing reservations | Yes |
| `reservations:extend` | Extend reservation TTL | Yes |
| `reservations:list` | List reservations | Yes |
| `balances:read` | Query balance information | Yes |
| `webhooks:write` | Create, update, delete, and test tenant webhooks at `/v1/webhooks` | No |
| `webhooks:read` | List tenant webhooks and delivery history | No |
| `events:read` | Query tenant event stream at `/v1/events` | No |

**Tenant budget/policy permissions** (v0.1.25.6+):

| Permission | Grants | Default? |
|---|---|---|
| `budgets:read` | List and read own tenant budgets | Yes |
| `budgets:write` | Create and fund own tenant budgets | Yes |
| `policies:read` | List and read own tenant policies | Yes |
| `policies:write` | Create and update own tenant policies | Yes |

**Admin wildcard permissions** (used with `X-Cycles-API-Key` for admin operations):

| Permission | Grants |
|---|---|
| `admin:read` | Satisfies **any** `*:read` permission (budgets:read, policies:read, webhooks:read, events:read, etc.) |
| `admin:write` | Satisfies **any** `*:write` permission (budgets:write, policies:write, webhooks:write, etc.). Does NOT grant read access — use both `admin:read` and `admin:write` for full access. |

::: tip Wildcard behavior (v0.1.25.7+)
`admin:write` acts as a server-level wildcard — it satisfies any `*:write` permission requirement. This means pre-v0.1.25.6 keys with `admin:write` continue to work without migration even after granular permissions were introduced. `admin:read` does NOT satisfy `*:write`.
:::

**Admin granular permissions** (v0.1.25+ — finer-grained alternative to admin wildcards):

| Permission | Grants |
|---|---|
| `admin:tenants:read` | Read tenant details |
| `admin:tenants:write` | Create and update tenants |
| `admin:budgets:read` | List and read budgets |
| `admin:budgets:write` | Create, fund, and update budgets |
| `admin:policies:read` | List and read policies |
| `admin:policies:write` | Create and update policies |
| `admin:apikeys:read` | List API keys |
| `admin:apikeys:write` | Create and revoke API keys |
| `admin:webhooks:read` | List admin webhook subscriptions and deliveries |
| `admin:webhooks:write` | Create, update, delete, test, and replay admin webhooks |
| `admin:events:read` | Query admin event stream |
| `admin:audit:read` | Query audit logs |

> **Defaults:** When no permissions are specified at key creation, the key receives 10 default permissions: the 6 runtime permissions (`reservations:create`, `reservations:commit`, `reservations:release`, `reservations:extend`, `reservations:list`, `balances:read`) plus `budgets:read`, `budgets:write`, `policies:read`, `policies:write`. Webhook, event, and admin permissions must be explicitly requested.

A typical runtime key needs only the 6 runtime permissions (`reservations:*` and `balances:read`) — remember that an explicit `permissions` array replaces the 10-value default set, so include `budgets:read`/`budgets:write` if the key also manages budgets. Add `webhooks:write` and `webhooks:read` for [webhook subscriptions](/how-to/managing-webhooks#tenant-self-service). Cross-tenant admin operations require the admin server's `X-Admin-API-Key` — no tenant-key permission (including the legacy `admin:read`/`admin:write` wildcards) grants access to those endpoints.

::: warning Admin permissions on tenant keys (v0.1.25.7)
`admin:read` and `admin:write` are accepted on tenant keys for backward compatibility, but **SHOULD NOT be assigned to new tenant keys**. Use the specific permissions (`budgets:write`, `policies:read`, etc.) instead. The admin key (`X-Admin-API-Key`) is server-configured and is not provisioned through the API key creation endpoint.

No permission on a tenant key — including `admin:read`/`admin:write` and the granular `admin:*` permissions — ever grants access to **AdminKeyAuth-only** endpoints (tenant management, API key management, audit, admin webhooks/events/config/overview). Those endpoints are unreachable with a tenant key; they accept only the server-configured `X-Admin-API-Key` header.
:::

For the full endpoint-to-header-to-permission mapping, see the [Architecture Overview — Authentication](/quickstart/architecture-overview-how-cycles-fits-together#authentication).

Response:

```json
{
  "key_id": "key_abc123...",
  "key_secret": "cyc_live_abc123...",
  "key_prefix": "cyc_live_abc12",
  "tenant_id": "acme",
  "permissions": ["reservations:create", "reservations:commit", "reservations:release", "balances:read"],
  "created_at": "2026-03-01T00:00:00Z",
  "expires_at": "2026-05-30T00:00:00Z"
}
```

Store the API key securely. It is shown only once at creation time.

## Using API keys

### In the Python client

Configure the key via `CyclesConfig`:

```python
import os
from runcycles import CyclesConfig

config = CyclesConfig(
    base_url="http://localhost:7878",
    api_key=os.environ["CYCLES_API_KEY"],
    tenant="acme",
)
```

Or from environment variables:

```bash
export CYCLES_BASE_URL=http://localhost:7878
export CYCLES_API_KEY=cyc_live_abc123...
export CYCLES_TENANT=acme
```

```python
config = CyclesConfig.from_env()
```

### In the Spring Boot Starter

Configure the key in your project's `application.yml`:

```yaml
cycles:
  api-key: ${CYCLES_API_KEY}
  base-url: http://localhost:7878
  tenant: acme
```

Use an environment variable rather than hardcoding the key.

### In direct HTTP calls

Pass the key in the `X-Cycles-API-Key` header:

```bash
curl -X POST http://localhost:7878/v1/reservations \
  -H "Content-Type: application/json" \
  -H "X-Cycles-API-Key: cyc_live_abc123..." \
  -d '{ ... }'
```

## Listing API keys

`GET /v1/admin/api-keys` lists keys. The endpoint is **AdminKeyAuth-only** — it requires the `X-Admin-API-Key` header, and tenant keys (`X-Cycles-API-Key`) cannot call it regardless of the permissions they carry. `tenant_id` is an optional filter: omit it to list keys across all tenants (v0.1.25.22+), or provide it to scope the result to a single tenant. Cross-tenant results are cursor-paginated; the cursor format is an implementation detail — treat it as an opaque string and pass it back unchanged.

```bash
# Cross-tenant — all keys, newest first
curl -G "http://localhost:7979/v1/admin/api-keys" \
  -H "X-Admin-API-Key: $ADMIN_KEY" \
  --data-urlencode "sort_by=created_at" \
  --data-urlencode "sort_dir=desc" \
  --data-urlencode "limit=50" | jq .

# Tenant-scoped
curl -G "http://localhost:7979/v1/admin/api-keys?tenant_id=acme" \
  -H "X-Admin-API-Key: $ADMIN_KEY" | jq .
```

`search` (v0.1.25.25+) does a case-insensitive match over `key_id` and `name`. See [Searching and Sorting Admin List Endpoints](/how-to/searching-and-sorting-admin-list-endpoints) for the full parameter vocabulary.

## Revoking API keys

::: tip Revoke from the dashboard
Key revocation is also a one-click action on the API Keys page in the [Cycles Admin Dashboard](/quickstart/deploying-the-cycles-dashboard) — typically faster than crafting a curl when responding to a leaked-key incident. Revocation is irreversible; the dashboard surfaces a confirmation step.
:::

Revoke a key to immediately block all requests using it:

```bash
curl -X DELETE "http://localhost:7979/v1/admin/api-keys/key_abc123?reason=leaked+in+ci+logs" \
  -H "X-Admin-API-Key: $ADMIN_API_KEY"
```

The optional `reason` query parameter is recorded for the audit trail. Revoking a key that is already revoked returns `409` (`ALREADY_REVOKED`).

Revocation is immediate. Any in-flight requests using the revoked key will fail on their next call to the Cycles server. Active reservations created with the revoked key remain valid until they expire or are committed/released.

::: tip Revocation, not deletion
The `DELETE` endpoint performs a **status transition** (ACTIVE → REVOKED), not a hard delete. The key record is retained so that audit logs referencing the key remain resolvable. This is consistent with the lifecycle model used across Cycles — see the equivalent notes on [tenant closure](/how-to/tenant-creation-and-management-in-cycles#closed) and [budget decommissioning](/how-to/budget-allocation-and-management-in-cycles#resizing-a-budget-reset).
:::

## Updating a key without rotating

`PATCH /v1/admin/api-keys/{key_id}` (AdminKeyAuth-only) performs a partial update — only the fields you send are modified. Mutable fields: `permissions` (replaces the full set), `scope_filter`, and `name`/`description`/`metadata`. `tenant_id`, `key_id`, `key_prefix`, `expires_at`, and `status` are immutable — to change expiry or tenant, revoke and recreate. Patching a revoked or expired key returns `409`.

## Key rotation

To rotate an API key without downtime:

1. Create a new key for the same tenant
2. Update your application configuration to use the new key
3. Deploy the configuration change
4. Verify traffic is flowing with the new key
5. Revoke the old key

Because both keys are valid during the transition, there is no interruption.

## Tenant isolation

API keys are the primary mechanism for tenant isolation in Cycles.

**Enforced behaviors:**

- A key for tenant A can only create reservations where `subject.tenant = "A"` (or where tenant is omitted, in which case the server uses the key's tenant)
- A key for tenant A cannot commit, release, or extend reservations owned by tenant B
- A key for tenant A cannot query balances for tenant B
- A key for tenant A cannot list reservations belonging to tenant B

**If the tenant is omitted from the Subject**, the server automatically sets it to the key's associated tenant. This is the recommended approach — configure the tenant at the key level and let the server enforce it.

## Best practices

### One key per environment

Use separate API keys for production, staging, and development, even within the same tenant. This makes it easy to revoke a single environment's access without affecting others.

### Use environment variables

Never hardcode API keys in source code:

```yaml
# Good
cycles:
  api-key: ${CYCLES_API_KEY}

# Bad
cycles:
  api-key: cyc_live_abc123...
```

### Minimal key scope

If you operate multiple tenants, issue one key per tenant. Do not share keys across tenants.

### Monitor key usage

Track which keys are making requests. If a key is compromised, revoke it immediately and issue a replacement.

## Error responses

| Error | HTTP | When |
|---|---|---|
| `UNAUTHORIZED` | 401 | Missing `X-Cycles-API-Key` header, or key is invalid/revoked/expired |
| `FORBIDDEN` | 403 | Key is valid but `subject.tenant` does not match the key's tenant |
| `INSUFFICIENT_PERMISSIONS` | 403 | Key is valid but lacks the required permission for the endpoint (e.g., calling `POST /v1/admin/budgets/fund` without `budgets:write`) |

## Next steps

- [Tenant Creation and Management](/how-to/tenant-creation-and-management-in-cycles) — create and manage the tenants that API keys belong to
- [Authentication and Tenancy](/protocol/authentication-tenancy-and-api-keys-in-cycles) — deeper dive into the auth model
- [Self-Hosting the Cycles Server](/quickstart/self-hosting-the-cycles-server) — deploy your own instance
- [Architecture Overview](/quickstart/architecture-overview-how-cycles-fits-together) — how authentication fits into the system
