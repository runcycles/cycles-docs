---
title: "Authentication, Tenancy, and API Keys in Cycles"
description: "How Cycles authenticates API requests and scopes all budget operations to tenants using API keys. Covers key creation, tenant isolation, and the security model."
---

# Authentication, Tenancy, and API Keys in Cycles

Every protected budget operation is authenticated and tenant-scoped. Liveness/readiness and other explicitly public operational or evidence endpoints are exceptions.

These two properties — authentication and tenancy — are foundational. They determine who is making the request, which budgets are visible, and which reservations can be accessed.

## How authentication works

Cycles authenticates requests using the `X-Cycles-API-Key` header.

Tenant-authenticated runtime requests must include this header. If it is missing or the key is invalid, the server returns `401 UNAUTHORIZED`. Admin and public endpoints follow their own authentication rules.

```
X-Cycles-API-Key: your-api-key
```

There is no session, token exchange, or OAuth flow in the reference API. Protected tenant requests use one API-key header; admin-only routes use `X-Admin-API-Key`.

### Public endpoints (no API key)

The runtime YAML declares two public evidence endpoints with `security: []`:

- `GET /v1/evidence/{evidence_id}` — signed-envelope retrieval. The `evidence_id` is an unguessable content-hash capability, and the envelope is content-addressed and signed, so public read cannot forge or alter it.
- `GET /v1/.well-known/cycles-jwks.json` — the signer's public JWK Set (public keys only, the standard posture for a verification key set), used to verify evidence signatures.

The reference server also leaves `/actuator/health/liveness` and `/actuator/health/readiness` public for probes. Aggregate health, metrics, API documentation, and the remaining operational/API routes require the configured tenant or admin credential.

## The effective tenant

From the API key (or other auth context), the server determines an **effective tenant**.

The effective tenant is the identity that governs all budget operations for that request:

- which budgets can be queried
- which reservations can be created
- which reservations can be committed, released, or extended
- which balances are visible

The effective tenant is not sent by the client. It is derived by the server from the authentication context.

## Tenant validation on every request

Every request that includes a `Subject` must have a `tenant` field that matches the effective tenant.

If the client sends `subject.tenant = "acme"` but the API key maps to tenant `"beta"`, the server returns `403 FORBIDDEN`.

This is a normative rule: the server **must** reject any request where `subject.tenant` does not match the effective tenant.

This prevents one tenant from creating reservations, recording events, or querying budgets against another tenant's scopes.

## Reservation ownership

Every reservation is bound to the effective tenant at creation time.

Any subsequent operation on that reservation — commit, release, extend, or get — must come from the same effective tenant.

If a different tenant attempts to access the reservation, the server returns `403 FORBIDDEN`, even if the reservation ID is known.

This means:

- tenant A cannot commit tenant B's reservation
- tenant A cannot release tenant B's reservation
- tenant A cannot extend tenant B's reservation
- tenant A cannot view tenant B's reservation details

Reservation ownership is enforced at the protocol level, not by convention.

## Balance visibility

Balance queries are tenant-scoped.

The server only returns balances within the effective tenant's scope. If the `tenant` query parameter is provided, it is validation-only — it must match the effective tenant, or the server returns `403 FORBIDDEN`.

If the `tenant` parameter is omitted, the effective tenant is used automatically.

A tenant cannot query another tenant's balances under any circumstances.

## Tenant validation on listing endpoints

The reservation listing endpoint (`GET /v1/reservations`) follows the same tenancy rules:

- results are scoped to the effective tenant
- if the `tenant` query parameter is provided, it must match the effective tenant
- if it does not match, the server returns `403 FORBIDDEN`

This ensures that listing and recovery operations are always tenant-isolated.

## Admin access on behalf of a tenant

Three runtime reservation endpoints also accept the admin key header `X-Admin-API-Key` (the `AdminKeyAuth` scheme — the same header the governance-admin spec uses), so admin operators can authenticate against the runtime plane with one key:

- `GET /v1/reservations` (list) — the admin caller has no effective tenant, so the `tenant` query parameter is **required** and is used as a filter, not validation. Omitting it returns `400 INVALID_REQUEST`.
- `GET /v1/reservations/{reservation_id}` (get) — admin operators can read any reservation regardless of owning tenant; the reservation ID already pins the owner, so no extra parameter is needed.
- `POST /v1/reservations/{reservation_id}/release` — admin operators can release any reservation regardless of owning tenant (the ops use case is force-expiring a hung reservation during incident response). The audit-log entry for an admin-driven release must record `actor_type=admin_on_behalf_of`, so security review can distinguish admin-driven releases from tenant self-service releases.

Create, commit, and extend do not accept the admin key — they remain tenant-key-only operations.

## The decide endpoint and tenancy

The decide endpoint (`POST /v1/decide`) follows the same rule: `subject.tenant` must match the effective tenant.

Even though decide is a read-only preflight check that does not modify budget state, it still enforces tenant isolation.

## How the X-Cycles-Tenant response header works

The server may include an `X-Cycles-Tenant` response header on any response.

This header contains the effective tenant identifier derived from the authentication context.

It is useful for:

- debugging tenant mismatch errors
- confirming which tenant the server resolved from the API key
- logging and correlation in multi-tenant environments

This header is optional in v0 implementations.

## API key permissions (governance layer)

When using the Cycles governance server (admin API), API keys can carry granular permissions that restrict which operations they can perform. The governance spec's `Permission` enum defines 27 values in three groups.

### Tenant permissions (13)

Tenant-scoped keys should carry only these permissions:

| Permission | Operations |
|---|---|
| `reservations:create` | Create reservations |
| `reservations:commit` | Commit reservations |
| `reservations:release` | Release reservations |
| `reservations:extend` | Extend reservations |
| `reservations:list` | List and get reservations |
| `balances:read` | Query balances |
| `budgets:read` | List and read budgets |
| `budgets:write` | Create, update, and fund budgets |
| `policies:read` | List and read policies |
| `policies:write` | Create and update policies |
| `webhooks:read` | Read webhook subscriptions and deliveries (self-service) |
| `webhooks:write` | Create, update, and delete webhook subscriptions (self-service) |
| `events:read` | Read the tenant's event stream |

### Legacy wildcard admin permissions (2)

`admin:read` and `admin:write` are reserved for backward compatibility with legacy keys and SHOULD NOT be assigned to new tenant keys — use the granular tenant permissions above instead. Their wildcard semantics are normative:

- `admin:write` satisfies any `*:write` requirement (`budgets:write`, `policies:write`, `webhooks:write`, etc.)
- `admin:read` satisfies any `*:read` requirement (`budgets:read`, `policies:read`, `events:read`, `balances:read`, etc.)
- `admin:read` does **not** satisfy `*:write`

### Granular admin permissions (12)

Admin-plane operations use granular admin permissions rather than the legacy wildcards: `admin:tenants:read`, `admin:tenants:write`, `admin:budgets:read`, `admin:budgets:write`, `admin:policies:read`, `admin:policies:write`, `admin:apikeys:read`, `admin:apikeys:write`, `admin:webhooks:read`, `admin:webhooks:write`, `admin:events:read`, and `admin:audit:read`.

### Default permission set

When `permissions` is omitted from the API key creation request, the server assigns the default set for tenant keys — 10 permissions: `[reservations:create, reservations:commit, reservations:release, reservations:extend, reservations:list, balances:read, budgets:read, budgets:write, policies:read, policies:write]`.

Only the webhook and event self-service permissions (`webhooks:read`, `webhooks:write`, `events:read`) are excluded from the default set and must be explicitly granted.

If a request requires a permission the API key does not have, the governance server returns `403` with error code `INSUFFICIENT_PERMISSIONS` (defined in the governance spec, not the protocol spec).

### Key prefixes

Tenant keys are issued in the format `cyc_live_{random}` or `cyc_test_{random}`. Only the visible `key_prefix` (e.g., `cyc_live_abc123`) is returned for identification after creation — the full key secret is returned exactly once, at creation time, and is stored server-side only as a hash.

## Scope filter (governance layer)

API keys can optionally be restricted to specific scopes using a **scope filter**.

A scope filter is an array of scope segment patterns:

```json
"scope_filter": ["workspace:eng", "agent:*"]
```

When a scope filter is set on an API key:

- operations are only permitted on scopes containing a matching segment
- `"workspace:eng"` matches scopes like `tenant:acme/workspace:eng/agent:bot1` (exact segment match)
- `"agent:*"` matches any scope containing an agent segment (wildcard match)
- if no filter entry matches the requested scope, the server returns `403 FORBIDDEN`

When scope filter is empty or not set, the key has unrestricted access within its tenant.

## Practical implications

### One API key per tenant (typical)

Most deployments map each API key to exactly one tenant. This makes tenant validation automatic — the client sets `subject.tenant` to match its key, and all operations are scoped correctly.

### Multi-tenant API keys (advanced)

Some deployments may use API keys that can operate on behalf of multiple tenants. In this case, the effective tenant derivation logic is implementation-specific and may involve additional headers or request context.

The protocol does not define how effective tenant is derived — only that it must be derived and enforced consistently.

### Tenant mismatch debugging

When a `403 FORBIDDEN` error occurs, the most common cause is a tenant mismatch:

- the `subject.tenant` in the request does not match the effective tenant from the API key
- a commit or release targets a reservation owned by a different tenant
- a balance query specifies a tenant that does not match the API key

Check the `X-Cycles-Tenant` response header (if present) to see which tenant the server resolved.

## Security properties

The authentication and tenancy model provides several guarantees:

- **Isolation**: tenants cannot see or modify each other's budgets, reservations, or balances
- **Ownership**: reservations are permanently bound to the creating tenant
- **Validation**: every protected tenant operation is checked against the effective tenant before processing
- **Consistency**: the same tenancy rules apply to all endpoints (reserve, commit, release, extend, decide, events, balances, listing)

These properties hold regardless of whether the client is trusted. The server enforces them on protected tenant operations.

## Summary

Tenant-plane authentication uses the `X-Cycles-API-Key` header. Admin-only routes use `X-Admin-API-Key`, and explicitly public routes require neither.

The server derives an effective tenant from the key and enforces tenant isolation across all operations:

- **Subject.tenant** must match the effective tenant on operations that carry a `Subject`; tenant query parameters are validation-only where supported
- **Reservation ownership** is enforced on commit, release, extend, and get
- **Balance visibility** is scoped to the effective tenant
- **403 FORBIDDEN** is returned for any tenant mismatch

This ensures that budget governance is always tenant-isolated, even in shared deployments.

## Next steps

- [Tenant Creation and Management](/how-to/tenant-creation-and-management-in-cycles) — create, configure, and manage tenants via the Admin API
- [API Key Management](/how-to/api-key-management-in-cycles) — create and rotate tenant-scoped API keys
- [Budget Allocation and Management](/how-to/budget-allocation-and-management-in-cycles) — set up budgets at tenant and sub-scopes
- [Scope Derivation](/protocol/how-scope-derivation-works-in-cycles) — how tenant scopes fit into the budget hierarchy
- [Deploy the Full Stack](/quickstart/deploying-the-full-cycles-stack) — set up the Cycles infrastructure from scratch
- Integrate with [Python](/quickstart/getting-started-with-the-python-client), [TypeScript](/quickstart/getting-started-with-the-typescript-client), or [Spring AI](/how-to/integrating-cycles-with-spring-ai)
