---
title: "Architecture Overview: How Cycles Fits Together"
description: "Learn how Cycles components interact — the protocol, server, admin server, and Spring Boot starter — and how budget enforcement flows through the system."
---

# Architecture Overview: How Cycles Fits Together

Cycles is a runtime authority for autonomous agents. It sits between your application and the actions that cost money or carry risk.

This page describes the components, how they interact, and where each piece runs.

::: tip Prerequisites
This is a reference page. If you haven't set up Cycles yet, start with the [End-to-End Tutorial](/quickstart/end-to-end-tutorial) or [Deploy the Full Stack](/quickstart/deploying-the-full-cycles-stack).
:::

## System overview

<ArchDiagramFull />

Your application talks to the **Cycles Server** (port 7878) at runtime. The **Cycles Admin Server** (port 7979) is the management plane where you create tenants, generate API keys, and configure budget ledgers. The **Cycles Events Service** is an outbound worker that delivers webhook notifications asynchronously and, when CyclesEvidence is enabled, signs evidence envelopes; its app port 7980 and management port 9980 should stay internal. All three services share the same Redis instance.

::: info Independent release cadences
Runtime, admin, events, and dashboard images ship patch releases independently. Latest tagged versions as of 2026-07-10: `cycles-server` 0.1.25.47, `cycles-server-admin` 0.1.25.49, `cycles-server-events` 0.1.25.22, `cycles-dashboard` 0.1.25.67. Older admin servers that predate newer query parameters (e.g., `sort_by`, `search`) ignore them rather than erroring — the APIs follow an additive-parameter guarantee. See the [changelog](/changelog) for the full matrix of minimum versions per feature.
:::

## Components

### Cycles Protocol

The protocol specification defines the API contract. It is a language-agnostic OpenAPI 3.1 spec that any client or server can implement.

The protocol defines:

- Runtime endpoints for decisions, reservations, balances, event ingest, evidence retrieval, and signer JWKS publication
- The Subject hierarchy (tenant, workspace, app, workflow, agent, toolset)
- The reserve → execute → commit lifecycle
- Error codes and their semantics
- Idempotency guarantees
- Scope derivation rules

The spec lives at [cycles-protocol](https://github.com/runcycles/cycles-protocol).

### Cycles Server

The reference server implementation. It is a Spring Boot 3.5 application backed by Redis 7+.

**What it does:**

- Accepts HTTP requests from clients
- Validates API keys and enforces tenant isolation
- Executes atomic budget operations via Redis Lua scripts
- Maintains budget state (allocated, spent, reserved, debt)
- Runs a background expiry sweep to clean up abandoned reservations
- Computes CyclesEvidence content hashes synchronously, returns `cycles_evidence` refs when configured, and serves signed envelopes plus public signer JWKS

**Modules:**

| Module | Purpose |
|---|---|
| `cycles-protocol-service-api` | REST controllers, security filters, exception handling |
| `cycles-protocol-service-data` | Redis repository, Lua scripts, scope derivation, expiry service |
| `cycles-protocol-service-model` | Shared DTOs and enums |

**Why Redis and Lua:**

Budget enforcement under concurrency requires atomicity. A reservation must check and update multiple scope counters in a single operation. Redis Lua scripts execute atomically on the server, ensuring no race conditions between concurrent reservations.

Six Lua scripts handle the core operations:

| Script | Operation |
|---|---|
| `reserve.lua` | Check budgets across all scopes, reserve atomically |
| `commit.lua` | Record actual spend, release remainder, handle overage |
| `release.lua` | Return reserved budget to pool |
| `extend.lua` | Extend reservation TTL |
| `event.lua` | Record direct debit without reservation |
| `expire.lua` | Mark expired reservations and release their budget |

### Cycles Admin Server

The management plane for Cycles. It runs as a separate Spring Boot 3.5 service on port 7979 and shares the same Redis instance as the Cycles Server.

The optional [Cycles Admin Dashboard](/quickstart/deploying-the-cycles-dashboard) (Vue 3 SPA) sits in front of this server and exposes its operations as a web UI — useful for day-two ops without crafting curl commands.

**What it does:**

- Manages tenants (create, list, update, suspend, close)
- Creates and revokes API keys with granular permissions
- Creates budget ledgers and handles funding operations (credit, debit, reset, reset_spent, repay debt)
- Defines policies (caps, rate limits, TTL overrides) matched by scope patterns — **stored for future runtime enforcement; not yet evaluated by the Cycles Server in v0**
- Validates API keys (used by the Cycles Server for authentication)
- Maintains an audit log of all administrative operations

**Modules:**

| Module | Purpose |
|---|---|
| `cycles-admin-service-api` | REST controllers, auth interceptor, Spring Boot app |
| `cycles-admin-service-data` | Redis repositories, key service |
| `cycles-admin-service-model` | Shared domain models and DTOs |

**Authentication:** Cycles uses two auth schemes depending on the endpoint. `X-Admin-API-Key` is the bootstrap/operator key for tenant and key management, audit, admin-only budget operations, and a small runtime admin-on-behalf-of reservation surface. `X-Cycles-API-Key` is tenant-scoped and carries explicit permissions for budgets, policies, reservations, balances, events, and tenant self-service webhooks.

#### `X-Admin-API-Key` — bootstrap / system administration

Set via the `ADMIN_API_KEY` environment variable. Not scoped to any tenant.

| Endpoint | Method | Purpose |
|---|---|---|
| `/v1/admin/tenants/*` | POST, GET, PATCH | Create, list, update, suspend tenants |
| `/v1/admin/api-keys/*` | POST, GET, DELETE | Create, list, revoke API keys |
| `/v1/auth/validate` | POST | Validate an API key |
| `/v1/admin/audit/logs` | GET | Query audit logs |
| `/v1/admin/budgets` | PATCH | Update budget settings (overage policy, overdraft limit) — admin key only |
| `/v1/admin/budgets/freeze`, `/v1/admin/budgets/unfreeze` | POST | Admin-only budget state changes |
| `/v1/reservations`, `/v1/reservations/{id}`, `/v1/reservations/{id}/release` | GET / POST | Runtime admin-on-behalf-of inspection and force release |

#### `X-Cycles-API-Key` — tenant-scoped operations

Requires a key created via the admin API with the appropriate [permissions](/how-to/api-key-management-in-cycles#available-permissions).

| Endpoint | Method | Required Permission |
|---|---|---|
| `/v1/admin/budgets` | POST | `budgets:write` |
| `/v1/admin/budgets` | GET | `budgets:read` |
| `/v1/admin/budgets/fund` | POST | `budgets:write` |
| `/v1/admin/policies` | POST, PATCH | `policies:write` |
| `/v1/admin/policies` | GET | `policies:read` |
| `/v1/balances` | GET | `balances:read` |
| `/v1/reservations` | GET | `reservations:list` |
| `/v1/reservations` | POST | `reservations:create` |
| `/v1/reservations/{id}/commit` | POST | `reservations:commit` |
| `/v1/reservations/{id}/release` | POST | `reservations:release` |
| `/v1/reservations/{id}/extend` | POST | `reservations:extend` |
| `/v1/decide` | POST | *(valid key only)* |
| `/v1/events` | POST | *(valid key only)* |

PATCH `/v1/admin/budgets` (budget settings) is `X-Admin-API-Key`-only — it is not available to tenant keys. The legacy `admin:write` / `admin:read` permissions act as wildcards that satisfy any `*:write` / `*:read` requirement, but new keys should carry the granular permissions (`budgets:write`, `policies:write`, etc.) instead.

Note that the admin server enforces these per-endpoint permissions on the governance plane. The reference runtime server (port 7878) does **not** enforce per-endpoint permissions on the runtime plane — it checks key validity and tenant match only, so the `reservations:*` permission strings on runtime endpoints document the spec's intent rather than reference-server behavior.

::: tip Which header do I use?
If the endpoint manages **identity**, fleet-level audit, admin-only budget state, or operator force-release → `X-Admin-API-Key`.
If the endpoint is a tenant-scoped budget, policy, runtime, balance, or event call → `X-Cycles-API-Key`.
:::

#### Key provisioning

The two headers represent different keys with different lifecycles:

1. **`X-Admin-API-Key`** is a static secret you choose at deploy time. Set it as the `ADMIN_API_KEY` environment variable when starting the admin server. There is no API to create or rotate it — you manage it like any infrastructure secret (secrets manager, env vars, etc.).

2. **`X-Cycles-API-Key`** keys are created dynamically via `POST /v1/admin/api-keys` (authenticated with the admin key). Each key is scoped to one tenant and carries explicit permissions. The key secret (e.g., `cyc_live_abc123...`) is returned once at creation time.

**Bootstrap order:** deploy server with admin key → create tenant → create API key → use API key for budgets and runtime operations. See [Deploying the Full Cycles Stack](/quickstart/deploying-the-full-cycles-stack) for the step-by-step walkthrough.

**Why a separate server:**

Separating the management plane from the runtime enforcement plane lets you:

- Run the admin server in a restricted network (internal only) while the Cycles Server is accessible to applications
- Scale the enforcement server independently from the admin server
- Apply different access controls to management vs runtime operations

See the [Admin API reference](/admin-api/) for the full API, or the [governance spec](https://github.com/runcycles/cycles-protocol/blob/main/cycles-governance-admin-v0.1.25.yaml) for the authoritative OpenAPI definition.

### Cycles Events Service

The async webhook delivery and evidence signing service. It runs as a separate Spring Boot 3.5 service with an internal app port (7980) and management/actuator port (9980), and shares the same Redis instance.

**What it does:**

- Consumes delivery jobs from a Redis queue (`dispatch:pending`) via BLMOVE — a reliable-queue pattern that parks each claimed job on `dispatch:processing` until acknowledged, recovering orphans idle longer than `DISPATCH_PROCESSING_RECOVERY_IDLE_MS` (default 120000 ms)
- Delivers events to webhook endpoints via HTTP POST with HMAC-SHA256 signatures
- Retries failed deliveries with exponential backoff (configurable: default 5 retries, 1s–60s delay)
- Auto-disables subscriptions after consecutive failures (default threshold: 10)
- Expires stale deliveries after configurable max age (default: 24h)
- Cleans up expired ZSET index entries hourly
- Builds and Ed25519-signs CyclesEvidence envelopes when `EVIDENCE_SERVER_ID` and the signing key are configured
- Stores signed evidence envelopes content-addressed for the runtime server to serve at `GET /v1/evidence/{id}`

**Why a separate service:**

| Concern | Admin Server | Events Service |
|---------|-------------|----------------|
| Workload | Synchronous CRUD, operator-facing | Asynchronous delivery and signing, variable latency |
| Scaling | Scale with admin traffic | Scale with webhook volume |
| Failure isolation | Admin stays responsive during delivery backlog | Delivery retries don't block admin API |
| Concurrency | Single instance | Multiple instances safe (the BLMOVE claim is atomic) |

**Optional:** If the events service is not deployed, admin and runtime servers operate normally. Webhook events and deliveries accumulate in Redis (bounded by TTL) and are processed when the events service starts. If CyclesEvidence is configured on the runtime server but the events service is down, responses may carry `cycles_evidence` refs while `GET /v1/evidence/{id}` returns transient `404` until the signer catches up.

See [Deploying the Events Service](/quickstart/deploying-the-events-service) for setup, [Webhook Event Delivery Protocol](/protocol/webhook-event-delivery-protocol) for webhook delivery, and [CyclesEvidence Envelopes](/protocol/cycles-evidence-envelopes-in-cycles) for evidence signing and verification.

### Cycles MCP Server

A [Model Context Protocol](https://modelcontextprotocol.io) server that exposes Cycles runtime authority as MCP tools. MCP-compatible AI hosts (Claude Desktop, Claude Code, Cursor, Windsurf) discover and call these tools automatically.

**What it does:**

- Exposes 9 MCP tools covering the full Cycles protocol (reserve, commit, release, extend, decide, balance, events, reservations)
- Ships 3 built-in prompts for integration code generation, budget debugging, and strategy design
- Provides resources for inspecting balances and reservation state
- Wraps the `runcycles` TypeScript client internally — talks to the Cycles Server via HTTP

**When to use it:**

Use the MCP server when your agent host supports MCP. No SDK integration is needed in the agent's own code — adding the server to the agent's tool configuration is the only setup required. See [Getting Started with the MCP Server](/quickstart/getting-started-with-the-mcp-server).

### Cycles Spring Boot Starter

A client library that integrates Cycles into Spring Boot applications. It provides two usage modes:

1. **Declarative** — The `@Cycles` annotation wraps methods in a reserve → execute → commit lifecycle automatically via Spring AOP
2. **Programmatic** — The `CyclesClient` interface can be injected and used directly for fine-grained control

**Key components:**

| Component | Purpose |
|---|---|
| `@Cycles` annotation | Declarative budget enforcement on methods |
| `CyclesAspect` | AOP interceptor that drives the lifecycle |
| `CyclesLifecycleService` | Orchestrates reserve/execute/commit/release |
| `CyclesClient` / `DefaultCyclesClient` | HTTP client using Spring WebClient |
| `CyclesContextHolder` | ThreadLocal access to reservation state mid-execution |
| `CyclesExpressionEvaluator` | SpEL evaluation for dynamic estimates and actuals |
| `CyclesFieldResolver` | Interface for dynamic Subject field resolution |
| `CommitRetryEngine` | Retry engine for transient commit failures |
| `CyclesProperties` | Spring Boot configuration properties |

## Request flow

Here is what happens when an `@Cycles`-annotated method is called:

### 1. Estimate evaluation

The SpEL expression in the annotation is evaluated against method parameters to produce a numeric estimate.

### 2. Reservation request

The starter sends `POST /v1/reservations` to the Cycles server with the Subject, Action, estimate, TTL, and overage policy.

### 3. Atomic budget check (server side)

The server derives all affected scopes from the Subject, then executes `reserve.lua`. The Lua script:

- Checks each scope has sufficient remaining budget (`allocated - spent - reserved - debt >= estimate`)
- Checks no scope has outstanding debt or is over-limit
- If all checks pass, atomically increments the `reserved` counter on every scope
- Stores the reservation record with its TTL

### 4. Decision returned

The server returns one of three decisions: `ALLOW`, `ALLOW_WITH_CAPS`, or `DENY`.

### 5. Method execution

If allowed, the starter runs the annotated method. During execution:

- A heartbeat thread periodically extends the reservation TTL
- The method can access `CyclesContextHolder` to read caps or set metrics

### 6. Commit

After the method returns, the starter evaluates the `actual` expression and sends `POST /v1/reservations/{id}/commit`. The server executes `commit.lua` to record actual spend and release the unused remainder.

### 7. Error path

If the method throws, the starter sends `POST /v1/reservations/{id}/release` to return all reserved budget to the pool.

## Data model

All budget state lives in Redis. The key concepts:

### Scopes

A scope is a budgeting boundary derived from the Subject hierarchy. A single reservation may affect multiple scopes. For example, a reservation with `tenant=acme, workspace=prod, app=chatbot` affects three scopes:

- `tenant:acme`
- `tenant:acme/workspace:prod`
- `tenant:acme/workspace:prod/app:chatbot`

### Balances

Each scope tracks:

| Field | Meaning |
|---|---|
| `allocated` | Total budget assigned to this scope |
| `spent` | Committed actual usage |
| `reserved` | Currently held by active reservations |
| `remaining` | `allocated - spent - reserved - debt` |
| `debt` | Negative balance from overdraft commits |
| `overdraft_limit` | Maximum allowed debt |
| `is_over_limit` | Whether `debt > overdraft_limit` |

### Reservations

Each reservation is stored with:

- Unique ID
- Subject and action metadata
- Reserved amount and unit
- Status (ACTIVE, COMMITTED, RELEASED, EXPIRED)
- TTL and grace period timestamps
- Idempotency key and payload hash

## Authentication

Budget and reservation requests authenticate via the `X-Cycles-API-Key` header. Each API key is associated with a tenant. The server enforces that `subject.tenant` matches the key's tenant — a key for tenant A cannot create reservations for tenant B.

Public runtime endpoints are intentionally narrow: the `/actuator/health/liveness` and `/actuator/health/readiness` probes, `GET /v1/evidence/{id}` (a content-addressed capability URL), and `GET /v1/.well-known/cycles-jwks.json` (public verification keys only). Since cycles-server 0.1.25.45 the aggregate `/actuator/health`, `/actuator/prometheus`, and the OpenAPI/Swagger docs paths require the `X-Admin-API-Key` header. Evidence retrieval does not expose ledger state; the unguessable `evidence_id` is the lookup capability.

Since 0.1.25.46 the public evidence and JWKS endpoints are rate-limited per client IP — 300 requests/minute by default (on by default; `cycles.public-rate-limit.*` properties). Exceeding the window returns `429` with `error=LIMIT_EXCEEDED` and a `Retry-After` header.

## Deployment topology

A typical deployment:

<DeploymentDiagram />

Multiple Cycles server instances can run behind a load balancer. All state is in Redis, so the server is stateless. The admin server is typically on an internal network, accessible only to operators and CI/CD pipelines. The events service is optional — if deployed, it consumes delivery jobs from Redis, delivers webhooks with HMAC-SHA256 signatures, and signs CyclesEvidence envelopes when the shared evidence identity is configured.

Non-Spring clients (Python, TypeScript/Node.js, Go) can use the protocol directly via HTTP — the client libraries are convenience layers, not a requirement. MCP-compatible agents (Claude Desktop, Claude Code, Cursor, Windsurf) can use the Cycles MCP Server for a zero-code integration path.

## Next steps

- [Tenants, Scopes, and Budgets](/how-to/understanding-tenants-scopes-and-budgets-in-cycles) — how tenants, scopes, and budgets work together as a unified model
- [Deploying the Full Cycles Stack](/quickstart/deploying-the-full-cycles-stack) — zero to working deployment with all components
- [Self-Hosting the Cycles Server](/quickstart/self-hosting-the-cycles-server) — server-specific configuration and deployment
- [API Reference](/api/) — interactive endpoint documentation
- [Getting Started with the MCP Server](/quickstart/getting-started-with-the-mcp-server) — add runtime authority to Claude Desktop, Claude Code, Cursor, or Windsurf
- [Getting Started with the Python Client](/quickstart/getting-started-with-the-python-client) — integrate with your Python app
- [Getting Started with the TypeScript Client](/quickstart/getting-started-with-the-typescript-client) — integrate with your TypeScript/Node.js app
- [Getting Started with the Spring Boot Starter](/quickstart/getting-started-with-the-cycles-spring-boot-starter) — integrate with your Spring app
