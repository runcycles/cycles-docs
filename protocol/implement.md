---
title: "Implement the Cycles Protocol"
description: "Build a conformant Cycles Protocol server: minimum surface, four invariants, error semantics, and conformance criteria for OSS contributors and infra teams."
---

# Implement the Cycles Protocol

The Cycles Protocol is open. The reference server ([`runcycles/cycles-server`](https://github.com/runcycles/cycles-server)) is Apache 2.0 and validated against the spec, but it is not the only conformant implementation possible. Anyone can build a server that speaks the same wire format.

This page is the entry point for that work.

## Who this is for

- **Framework maintainers** — LangGraph, Temporal, agent runtimes, orchestrators that want first-class runtime budget authority without proxying every call to an external service.
- **Infrastructure teams** — operating an internal budget system already (custom rate limiter, cost tracker, action governance) and wanting Cycles-compatible client interop without replacing what works.
- **OSS contributors** — building adapters, alternative servers in other languages, or instrumented variants for specific deployment models (FaaS, edge, embedded).
- **Vendors with overlapping scope** — observability, cost tracking, identity governance vendors who want to add reserve-commit semantics to their existing platform.

If "should this specific next agent action proceed, given everything already consumed?" is a question your platform needs to answer, the protocol is the wire format for that question.

## Why a separate implementation might make sense

The reference Cycles server covers the canonical case: self-hosted, Java/Spring Boot, Redis-backed, multi-tenant. Reasons to implement separately:

- **Bespoke runtime requirements** — your stack already runs on Postgres, FoundationDB, DynamoDB, or an in-process state engine; you want budget authority co-located.
- **Integration with existing budget systems** — you've shipped a quota service for traditional API limits and want to expose it under the Cycles wire format so AI-agent SDKs work transparently.
- **Language / platform constraints** — embedded systems, FaaS edge runtimes, mobile / on-device agents where Java + Redis isn't viable.
- **Principled reasons** — you want a second independent implementation in the wild for protocol robustness (the OpenTelemetry multi-implementation pattern).

Cycles' reference server is fine; *protocol robustness* comes from multiple implementations testing the same wire format against the same conformance target — and, once published, the same conformance test kit.

## The minimum implementation surface

The authoritative statement of what's required lives in [`CONFORMANCE.md`](https://github.com/runcycles/cycles-protocol/blob/main/CONFORMANCE.md) — read that first. The current target requires a small core runtime + a cross-plane set, plus a smaller recommended set that well-rounded servers ship. Below is the surface at time of writing; if `CONFORMANCE.md` and this page disagree, **the spec wins**.

### Core runtime (MUST)

From [`cycles-protocol-v0.yaml`](https://github.com/runcycles/cycles-protocol/blob/main/cycles-protocol-v0.yaml):

| Operation | Endpoint | Purpose |
|---|---|---|
| **createReservation** | `POST /v1/reservations` | Atomically lock budget across all affected scopes before action |
| **commitReservation** | `POST /v1/reservations/{reservation_id}/commit` | Settle the actual cost; release the unused portion |
| **releaseReservation** | `POST /v1/reservations/{reservation_id}/release` | Release the full reservation without spending (cancel) |
| **extendReservation** | `POST /v1/reservations/{reservation_id}/extend` | TTL heartbeat for long-running operations |

### Cross-plane (MUST)

From [`cycles-governance-admin-v0.1.25.yaml`](https://github.com/runcycles/cycles-protocol/blob/main/cycles-governance-admin-v0.1.25.yaml). Much of the admin CRUD surface (tenant / budget / policy / key) is reference-shape rather than current conformance target, but the cross-plane operations below carry explicit `x-conformance: normative` labels and MUST follow the spec contract:

1. `GET /v1/admin/events` — **listEvents**
2. `GET /v1/admin/events/{event_id}` — **getEvent**
3. `POST /v1/admin/webhooks/{subscription_id}/replay` — **replayEvents**
4. `GET /v1/events` — **listTenantEvents** (tenant-scoped)
5. `GET /v1/admin/webhooks/{subscription_id}/deliveries` — **listWebhookDeliveries**
6. `GET /v1/webhooks/{subscription_id}/deliveries` — **listTenantWebhookDeliveries** (tenant-scoped)
7. `GET /v1/balances` — **getBalances** (admin-plane view)
8. `GET /v1/auth/introspect` — **introspectAuth**

### Recommended (SHOULD)

Well-rounded servers also implement these (from `cycles-protocol-v0.yaml`):

- `decide` — preflight budget check without reservation
- `listReservations` / `getReservation` — recovery and inspection
- `createEvent` — direct-debit event submission

You can ship without these and still claim conformance against the current target, but most clients expect them.

## Client recovery conformance

Server conformance is only one half of failure-safe settlement. SDK lifecycle helpers also need a shared contract for what happens when connectivity is lost after an action, the process restarts, a reservation expires before commit, or a heartbeat cannot be extended.

The authoritative [`client-recovery/PROFILE.md`](https://github.com/runcycles/cycles-protocol/blob/main/client-recovery/PROFILE.md) defines that client-side guarantee independently from the wire protocol. A durable-conformant SDK:

- persists known-actual settlement before the first request;
- reuses the same idempotency key after ambiguous outcomes;
- retains unresolved records across retry exhaustion, authentication failure, and restart;
- converts an expired commit into a same-key `POST /v1/events` settlement;
- exposes a bounded flush/drain operation; and
- makes heartbeat failure observable without suppressing final settlement.

The shared [`client-recovery/scenarios.yaml`](https://github.com/runcycles/cycles-protocol/blob/main/client-recovery/scenarios.yaml) catalog is executable. SDKs claiming durable recovery must bind every applicable scenario to native behavior tests and run the profile runner in CI. See [SDK Settlement Recovery and Durability](/protocol/sdk-settlement-recovery-and-durability) for the operational guarantee and configuration of the four official SDKs.

## The four core invariants

Spec compliance isn't just endpoint coverage — it's behavior under the hood. Per `CONFORMANCE.md`:

1. **Atomic reservation across scopes** — when a reservation locks multiple affected scopes, it locks all of them or none. No partial locks.
2. **Concurrency-safe enforcement** — shared budgets MUST NOT be oversubscribed under concurrent reserve calls. The reference server uses Lua-scripted Redis operations; alternative implementations need equivalent atomicity guarantees in their backing store.
3. **Idempotent commit and release** — every commit / release MUST be safe to retry. The same action MUST NOT settle twice. Idempotency keys carry the contract.
4. **Unit consistency** — reservations and commits MUST validate and preserve unit denomination (USD_MICROCENTS, TOKENS, CREDITS, RISK_POINTS). Cross-unit operations MUST return `UNIT_MISMATCH` (400).

These are the contracts client SDKs and downstream systems rely on. An implementation that returns the right HTTP codes but lets concurrent reservations oversubscribe is non-conformant in spirit even if it passes a naive endpoint test.

## Error semantics

Implementations MUST return the exact HTTP status + `error` code pairs from `cycles-protocol-v0.yaml` §ERROR SEMANTICS. The full set:

- `BUDGET_EXCEEDED` — 409
- `OVERDRAFT_LIMIT_EXCEEDED` — 409
- `IDEMPOTENCY_MISMATCH` — 409
- `RESERVATION_FINALIZED` — 409
- `RESERVATION_EXPIRED` — 410
- `UNIT_MISMATCH` — 400
- `NOT_FOUND` — 404
- `DEBT_OUTSTANDING` — 409
- `LIMIT_EXCEEDED` — 429 (server-side throttling / rate limiting, optional in v0 and never used for deterministic budget exhaustion; added to the ErrorCode enum in spec v0.1.25.12, revision 2026-07-04). 429 responses carry the `Retry-After` and `X-RateLimit-Reset` headers.
- `TENANT_CLOSED` — 409 (deployments with a governance plane only; added to the ErrorCode enum in spec v0.1.25.13, revision 2026-07-10, mirroring the governance code of the same name). Persisting reservation create/commit/release/extend MUST reject with it when the owning tenant's status is CLOSED and the flip is durable, taking precedence over `RESERVATION_FINALIZED`/`RESERVATION_EXPIRED` for non-replay attempts. Fresh `dry_run=true` and `/v1/decide` evaluations MUST NOT 409 for this — they return `200 decision=DENY reason_code=TENANT_CLOSED`; a present-but-malformed tenant record MUST fail closed with 500 `INTERNAL_ERROR`. Deployments with no tenant records anywhere are exempt (nothing to enforce).

One `RESERVATION_EXPIRED` subtlety, clarified in the 2026-07-03 spec revision: `GET /v1/reservations/{reservation_id}` MUST return 410 `RESERVATION_EXPIRED` when the reservation exists but its status is EXPIRED — the pre-revision text enumerated only commit/release/extend, leaving the GET case ambiguous. EXPIRED reservations remain discoverable via `listReservations`, which returns them as normal 200 rows with `status=EXPIRED`; the 410 applies only to the single-resource GET.

Clients route on these codes — returning a generic 500 or a custom error string breaks the protocol contract even if the underlying behavior is correct.

Action-governance error codes (`ACTION_QUOTA_EXCEEDED`, `ACTION_KIND_NOT_ALLOWED`, `ACTION_KIND_DENIED`) are documented in upcoming spec extensions; check `CONFORMANCE.md` for whether they're currently MUST or SHOULD against the active target.

## Authentication and tenancy

Authenticate via the `X-Cycles-API-Key` header, per [`cycles-protocol-v0.yaml`](https://github.com/runcycles/cycles-protocol/blob/main/cycles-protocol-v0.yaml) §AUTH & TENANCY. How API keys are provisioned, rotated, or scoped to permission sets is implementation-specific — but tenant isolation MUST be enforced.

Two exceptions are deliberately public (`security: []`): `GET /v1/evidence/{evidence_id}`, where the unguessable sha256 `evidence_id` acts as a capability, and `GET /v1/.well-known/cycles-jwks.json`, which serves the public verification-key set that is itself the trust anchor. Servers SHOULD rate-limit both (they declare 429 responses with `Retry-After` / `X-RateLimit-Reset`).

Three reservation operations additionally accept admin dual auth via `AdminKeyAuth` (`X-Admin-API-Key` header, the same header the governance-admin spec uses): `listReservations` (`GET /v1/reservations`), `getReservation` (`GET /v1/reservations/{reservation_id}`), and `releaseReservation` (`POST /v1/reservations/{reservation_id}/release`) — the operator use case is inspecting and force-releasing reservations across tenants, with the admin-driven release audited as `actor_type=admin_on_behalf_of`.

The reference server uses a permissions model with named scopes (`reservations:create`, `balances:read`, `admin:write`, etc.). Alternative implementations can use any equivalent authorization model as long as tenant isolation holds.

## Reference points

When you're stuck on a spec question, these are the canonical sources:

- **[`CONFORMANCE.md`](https://github.com/runcycles/cycles-protocol/blob/main/CONFORMANCE.md)** — the authoritative MUST / SHOULD / MAY document
- **[`cycles-protocol-v0.yaml`](https://github.com/runcycles/cycles-protocol/blob/main/cycles-protocol-v0.yaml)** — runtime base spec
- **[`cycles-spec-index.yaml`](https://github.com/runcycles/cycles-protocol/blob/main/cycles-spec-index.yaml)** — index of all spec files with conformance metadata
- **[`client-recovery/PROFILE.md`](https://github.com/runcycles/cycles-protocol/blob/main/client-recovery/PROFILE.md)** — client-side durable settlement and heartbeat-failure requirements
- **[`client-recovery/scenarios.yaml`](https://github.com/runcycles/cycles-protocol/blob/main/client-recovery/scenarios.yaml)** — executable recovery behavior catalog
- **[Reference server source](https://github.com/runcycles/cycles-server)** — the Java/Spring Boot reference implementation. Read it for "how does the reference handle X edge case?"
- **[Protocol reference pages](/protocol/api-reference-for-the-cycles-protocol)** — narrative documentation of the same surface, useful for understanding the design intent behind each operation
- **[`.spectral.yaml`](https://github.com/runcycles/cycles-protocol/blob/main/.spectral.yaml)** — OpenAPI linting config for keeping spec changes consistent

## Get help

The protocol is small but has subtle behavioral requirements. If you're implementing and have a spec question, edge case, or suspect a contradiction:

- **Email a maintainer** — [founder@runcycles.io](mailto:founder@runcycles.io) for protocol design / clarification questions
- **Open a spec issue** — [`runcycles/cycles-protocol/issues`](https://github.com/runcycles/cycles-protocol/issues) for ambiguity, contradiction, or proposed clarifications
- **Open a docs issue** — [`runcycles/cycles-docs/issues`](https://github.com/runcycles/cycles-docs/issues) for documentation gaps
- **Reference implementation issues** — [`runcycles/cycles-server/issues`](https://github.com/runcycles/cycles-server/issues) for behavior that disagrees with the spec

A founder reads every email and issue.

## Why this matters

Protocol > tool.

Every framework, vendor, and platform that implements the Cycles Protocol speaks the same wire format. Client SDKs work against any conformant server. Operators can switch implementations without touching application code. The category — runtime budget authority over AI agents — has a single, open, version-stable contract that transcends any individual product.

OpenTelemetry won observability by being the protocol every vendor implemented. The protocol that becomes the shared implementation contract shapes the category — and it only earns that role when multiple implementations validate the same wire format against the same conformance target, with a shared conformance kit to follow.

If you build a Cycles-compatible server, you make the protocol stronger. That's the work.

## Related

- [Cycles Protocol overview](/protocol/) — the hub page
- [API Reference](/protocol/api-reference-for-the-cycles-protocol) — narrative API docs
- [How Reserve / Commit Works](/protocol/how-reserve-commit-works-in-cycles) — the lifecycle everything else builds on
- [Runtime Authority vs Runtime Authorization](/concepts/runtime-authority-vs-runtime-authorization) — how the protocol fits alongside identity-based agent governance
