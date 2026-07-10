---
title: "Changelog"
description: "Release history and version notes for the Cycles Protocol, server, admin API, Python client, TypeScript client, and Spring Boot starter."
---

# Changelog

Release history for the Cycles Protocol and reference implementations.

## v0.1.25.x — patch releases (April-July 2026)

Since the initial v0.1.25 Events & Webhooks release, each component has shipped a stream of patch releases. Wire format is stable within `0.1.x`; every change below is **additive** unless explicitly marked breaking.

**Current component versions:**

| Component | Version | Release date |
|---|---|---|
| Protocol spec (runtime) | v0.1.25 (document revision v0.1.25.12) | 2026-05-22 |
| Governance spec (admin) | v0.1.25.34 | 2026-04-20 |
| `cycles-server` (runtime) | v0.1.25.46 | 2026-07-04 |
| `cycles-server-admin` | v0.1.25.48 | 2026-07-04 |
| `cycles-server-events` | v0.1.25.22 | 2026-07-04 |
| `cycles-dashboard` | v0.1.25.67 | 2026-07-04 |

**Client SDKs and plugins.** The language clients and plugin integrations are versioned independently from the protocol / server / dashboard tracks — they track the client API surface rather than the wire spec. Current releases:

| SDK / plugin | Version | Release date | Runtime | Release notes |
|---|---|---|---|---|
| `cycles-client-typescript` | 0.3.3 | 2026-05-22 | Node 20+ (native fetch) | [CHANGELOG](https://github.com/runcycles/cycles-client-typescript/blob/main/CHANGELOG.md) |
| `cycles-client-rust` | 0.2.6 | 2026-05-22 | Rust 1.88+ MSRV | [CHANGELOG](https://github.com/runcycles/cycles-client-rust/blob/main/CHANGELOG.md) |
| `cycles-client-python` | 0.4.3 | 2026-05-22 | Python 3.10+ (httpx, Pydantic v2) | [CHANGELOG](https://github.com/runcycles/cycles-client-python/blob/main/CHANGELOG.md) |
| `cycles-spring-boot-starter` | 0.2.5 | 2026-06-18 | Spring Boot 3.5+, Java 21 | [CHANGELOG](https://github.com/runcycles/cycles-spring-boot-starter/blob/main/CHANGELOG.md) |
| `cycles-mcp-server` | 0.2.4 | 2026-05-03 | Node 20+, MCP protocol | [CHANGELOG](https://github.com/runcycles/cycles-mcp-server/blob/main/CHANGELOG.md) |
| `cycles-openai-agents` | 0.2.1 | 2026-05-07 | OpenAI Agents SDK (Python) | [CHANGELOG](https://github.com/runcycles/cycles-openai-agents/blob/main/CHANGELOG.md) |
| `cycles-openclaw-budget-guard` | 0.8.4 | 2026-05-07 | OpenClaw plugin (Node) | [CHANGELOG](https://github.com/runcycles/cycles-openclaw-budget-guard/blob/main/CHANGELOG.md) |
| `langchain-runcycles` | 0.3.0 | 2026-05-15 | LangChain `create_agent` middleware (Python) — `CyclesModelGate` (with `cost_fn` actual-cost extraction, v0.2.0+) + `CyclesToolGate` (with tool-side `cost_fn`, v0.3.0+) + `CyclesFanOutGate` + streaming-path verified (v0.2.1+); settlement HTTP failures honored per `settlement_error_policy` (v0.2.3+) | [CHANGELOG](https://github.com/runcycles/langchain-runcycles/blob/main/CHANGELOG.md) |
| `cycles-spring-ai-starter` | 0.3.1 | 2026-05-12 | Spring Boot 3.5+, Spring AI 1.0+/1.1+, Java 21 — three extension points added in 0.3.0: **pluggable `SubjectResolver`** for per-call attribution (multi-tenant agents can route the Cycles subject from an authenticated principal, header, or thread-local); **pluggable `PromptTokenEstimator`** with a real BPE impl (`JtokkitPromptTokenEstimator` via `com.knuddels:jtokkit`, opt in with `cycles.spring-ai.token-estimator-encoding=cl100k_base` / `o200k_base`); **`cycles.reservation_id` on chat-client traces** as a high-cardinality `KeyValue` for trace ↔ reservation correlation. End-to-end integration test added. 98.3% instruction / 95.7% branch test coverage at 0.3.0; 0.3.1 is a documentation-only patch (fixed a 10x cost-per-token example) verified at 100% / 100%. No breaking changes vs 0.2.0. Companion to `cycles-spring-boot-starter`. | [CHANGELOG](https://github.com/runcycles/cycles-spring-ai-starter/blob/main/CHANGELOG.md) |

Each client repo's AUDIT.md records the specific protocol revision that release was validated against (currently v0.1.23 or v0.1.24 for most of the 0.2.x line). Because the wire contract is additive-only within `0.1.x`, clients validated against an earlier revision work unchanged against a newer server — pre-v0.1.25 clients tolerate the v0.1.25 event / webhook / audit additions. See each CHANGELOG for the exact revision.

### Protocol spec suite (v0.1.26)

- The cycles-protocol repo added [`CONFORMANCE.md`](https://github.com/runcycles/cycles-protocol/blob/main/CONFORMANCE.md) — a formal MUST / SHOULD / MAY statement of what a conformant Cycles implementation has to do. The active v0.1.25 target requires 12 MUST operations: 4 core runtime reservation operations plus 8 cross-plane event / webhook / balance / auth-introspection operations. Four more runtime operations (`decide`, list/get reservations, direct-debit events) are SHOULD-level and implemented by the reference servers.
- The README repositioned the spec suite around upcoming **v0.1.26** extensions (runtime base still v0.1.25). Action-kinds, action-quotas, observe mode, DenyDetail, and `ACTION_QUOTA_EXCEEDED` / `ACTION_KIND_DENIED` / `ACTION_KIND_NOT_ALLOWED` reason codes are SHOULD-level today and **not yet enforced** in runcycles' reference servers. They become MUST only when `CONFORMANCE.md` promotes v0.1.26 to the active target.
- Spec-only trace_id alignment bumps on extension specs (`cycles-action-kinds`, `cycles-governance-extensions` to v0.1.27) — declare `trace_id` on `ErrorResponse` and `X-Cycles-Trace-Id` on `components.headers` for OpenAPI tooling consistency. Behavioral contract unchanged from what's documented in [Correlation and Tracing](/protocol/correlation-and-tracing-in-cycles).

### Runtime server (`cycles-server`)

- **v0.1.25.46** (2026-07-04) — **Public-endpoint rate limiting.** The unauthenticated `GET /v1/evidence/*` and CyclesEvidence JWKS endpoints are now rate-limited per client IP (default 300 requests/minute, `CYCLES_PUBLIC_RATE_LIMIT_REQUESTS_PER_MINUTE`; kill switch `CYCLES_PUBLIC_RATE_LIMIT_ENABLED`). Over-limit requests receive `429` with `error=LIMIT_EXCEEDED` (new runtime ErrorCode, spec v0.1.25.12).
- **v0.1.25.45** (2026-06-27) — **Operational endpoints require the admin key.** `/actuator/prometheus`, `/actuator/info`, aggregate `/actuator/health`, and the API docs / Swagger endpoints now require `X-Admin-API-Key`; liveness/readiness probes and the protocol-public CyclesEvidence/JWKS endpoints stay unauthenticated. Also bounds the event-emission executor queue and adds correlation headers on auth-filter errors.
- **v0.1.25.44** (2026-06-26) — Deployment hardening: production Compose disables tenant labels on Prometheus metrics and public SpringDoc/Swagger; `exec java` PID-1 entrypoint. No API change.
- **v0.1.25.43** (2026-06-25) — `/actuator/health/readiness` gains a Redis PING contributor; Spring Security explicitly stateless / API-key-only.
- **v0.1.25.42** (2026-06-25) — Release benchmark gating uses a rolling median from history; guarded tenant-auth DEBUG logging. CI/benchmark only.
- **v0.1.25.41** (2026-06-24) — CR/LF log-injection flattening across data-plane logs; per-request controller logs moved INFO → DEBUG.
- **v0.1.25.40** (2026-06-24) — Structured protocol-exception logs (method, path, route, status, error code, `request_id`, `trace_id`, `reservation_id`) and request-context fields on controller logs.
- **v0.1.25.39** (2026-06-24) — Pagination, replay, auth, and production-default hardening. Legacy SCAN pagination for reservations/balances no longer skips rows when a page limit is reached mid-batch; sorted reservations no longer truncate at 2000 hydrated rows. Auth-filter errors now carry `trace_id`, `POST /v1/events` idempotent replay returns the stored original response, invalid tenant default overage policies fail closed, API key validation no longer caches full allow/deny decisions, and production Compose pins `cycles-server` to 0.1.25.39.
- **v0.1.25.38** (2026-06-23) — **Unconfigured CyclesEvidence no longer queues source records.** If `EVIDENCE_SERVER_ID` or `EVIDENCE_SIGNING_SIGNER_DID` is blank, the runtime emitter returns no `cycles_evidence` ref and does not push to `evidence:pending`. Configured deployments still compute `evidence_id` synchronously, queue the source record, and return the evidence ref.
- **v0.1.25.37** (2026-06-22, per release tag — the repo CHANGELOG has a gap for this version) — **Reservation evidence projection.** The runtime persists computed evidence refs on reservation hashes and exposes them through `GET /v1/reservations/{id}` and `include=evidence` on `GET /v1/reservations`, enabling dashboard "View evidence" links after the original response is gone.
- **v0.1.25.17** (2026-04-22) — Pin `commons-lang3` 3.18.0 to close CVE-2025-48924. No wire or behavior change.
- **v0.1.25.16** (2026-04-19) — Bump Spring Boot 3.5.11 → 3.5.13, pin embedded tomcat 10.1.54 (CVE remediation). Pom-version-only bump — no standalone release was cut; its changes ship cumulatively in v0.1.25.17. No wire or behavior change.
- **v0.1.25.15** (2026-04-18) — **Runtime audit-log retention TTL.** New `audit.retention.days` config (default `400`, env `AUDIT_RETENTION_DAYS`) applies a TTL to `audit:log:{id}` keys — previously these persisted indefinitely until Redis eviction, silently escaping the authenticated-tier retention the admin plane applies. New `audit.sweep.cron` (default `0 0 3 * * *`, env `AUDIT_SWEEP_CRON`) prunes stale ZSET pointers. Set to `0` for indefinite retention.
- **v0.1.25.14** (2026-04-18) — **W3C Trace Context correlation.** Every response now carries `X-Cycles-Trace-Id` (32-hex lowercase). Inbound precedence: `traceparent` → `X-Cycles-Trace-Id` → server-generate. New optional `trace_id` field on `ErrorResponse`, `Event`, `WebhookDelivery`, `AuditLogEntry`. `WebhookDelivery` also gains `trace_flags` and `traceparent_inbound_valid`. Malformed inbound correlation headers are tolerated (fall through to next rule) — server never rejects on a bad header. SLF4J MDC carries `traceId` alongside `requestId`. `ReservationExpiryService` mints a fresh trace_id per sweep batch so sibling `reservation.expired` events correlate. See [Correlation and Tracing](/protocol/correlation-and-tracing-in-cycles).
- **v0.1.25.13** (2026-04-16) — `SORTED_HYDRATE_CAP = 2000` guard on `GET /v1/reservations` sorted path. Capped WARN log; cursor page still fills from the capped slice. Narrow filters to see past the cap. Superseded by v0.1.25.39, which keeps the 2,000-row warning threshold but no longer truncates sorted results.
- **v0.1.25.12** (2026-04-16) — `GET /v1/reservations` accepts `sort_by` and `sort_dir` query params. Valid keys: `reservation_id`, `tenant`, `scope_path`, `status`, `reserved`, `created_at_ms`, `expires_at_ms`. Default `desc`. Opaque sorted cursor binds to the `(sort_by, sort_dir, filters)` tuple; reusing under a different tuple returns HTTP 400.
- **v0.1.25.10** (2026-04-14) — Seven domain-level Prometheus counters (`cycles_reservations_reserve_total`, `..._commit_total`, `..._release_total`, `..._extend_total`, `..._expired_total`, `cycles_events_total`, `cycles_overdraft_incurred_total`). New flag `cycles.metrics.tenant-tag.enabled` (default `true`) controls per-tenant cardinality. **Fixed** — `reservation.expired` webhook now actually fires (was no-op since v0.1.25.3 due to wrong Redis key prefix).
- **v0.1.25.8** (2026-04-13) — **Admin-on-behalf-of release.** `POST /v1/reservations/{id}/release` accepts either `X-Cycles-API-Key` (tenant) or `X-Admin-API-Key` (admin). Admin-driven releases write audit entries with `metadata.actor_type=admin_on_behalf_of`. New property `admin.api-key` for admin key configuration.
- **v0.1.25.6** (2026-04-10) — Reserve / commit / decide now distinguish `UNIT_MISMATCH` from `BUDGET_NOT_FOUND` when a scope has a budget under a different unit.
- **v0.1.25.5** (2026-04-08) — Fixed duplicate emission of `budget.approaching_limit`, `budget.at_limit`, `budget.over_limit`, `debt.incurred` on multi-scope operations.
- **v0.1.25.4** (2026-04-07) — Event payloads now include all fields webhook consumers need for correct dedup/ordering (`reservation_id`, `scope`, `unit`, `actor`, timestamps).
- **v0.1.25.3** (2026-04-03) — Runtime event emission wired: `reservation.reserved`, `reservation.committed`, `reservation.released`, `reservation.expired`, `reservation.extended`, `event.applied`, plus budget-state transitions (`budget.approaching_limit`, `budget.at_limit`, `budget.over_limit`).
- **v0.1.25.2** (2026-04-02) — `getBalances` and `listReservations` lowercase the stored scope before segment matching.
- **v0.1.25.1** (2026-04-01) — Initial runtime event emission. `EventEmitterService` with async, non-blocking emission on a dedicated daemon thread pool. TTL retention — `EVENT_TTL_DAYS` (90) / `DELIVERY_TTL_DAYS` (14). Pipelined event save + subscription lookup for near-zero overhead on non-event paths. **Fixed** — `reservation.commit_overage` now emits only when `actual > estimate` (was firing on every commit).

### Admin server (`cycles-server-admin`)

- **v0.1.25.48** (2026-07-04) — Cascade event payloads now map to a typed `EventDataTenantCascade` class (the four `*_via_tenant_cascade` event types). Internal validation/registry only — no wire change.
- **v0.1.25.47** (2026-06-26) — Admin image readiness healthcheck + `exec java $JAVA_OPTS` entrypoint; full-stack compose pins refreshed; README/OPERATIONS deployment doc refresh.
- **v0.1.25.46** (2026-06-26) — Dependency currency: Jedis 7.5.0 → 7.5.2, springdoc-openapi 2.8.16 → 2.8.17. No code change.
- **v0.1.25.45** (2026-06-25) — **Security hardening.** Actuator, OpenAPI docs, and Swagger now require `X-Admin-API-Key`; `WEBHOOK_SECRET_ENCRYPTION_KEY` is required; repeated 401/403 failures are throttled with `429 LIMIT_EXCEEDED`; webhook test delivery re-validates the SSRF policy; hardened Redis compose defaults.
- **v0.1.25.44** (2026-06-24) — CR/LF log-injection flattening across exception/auth/repository logs via a shared `LogSanitizer`.
- **v0.1.25.43** (2026-06-24) — Ops logging context review: structured operational identifiers on governance exception-handler logs.
- **v0.1.25.42** (2026-06-24) — Dependency-only security release. Reintroduces the Tomcat 10.1.55 override for Apache Tomcat CVEs, carries the previously unreleased Spring Boot 3.5.15 and Jedis 7.5.0 dependency bumps, and scopes the Trivy SARIF gate to the intended HIGH/CRITICAL severity threshold while jackson-databind 2.21.5 is not yet published. No code, spec, or wire-format changes.
- **v0.1.25.41** (2026-04-26) — Dependency hygiene aligning the service fleet on the same Spring Boot patch and Redis client major. Spring Boot 3.5.13 → 3.5.14, Jedis 5.2.0 → 6.2.0, and the explicit Tomcat 10.1.54 override was removed because the Spring Boot BOM manages it directly. No code or wire-format changes.
- **v0.1.25.40** (2026-04-23) — Same-release hygiene sweep on the v0.1.25.39 webhook lifecycle emits. Single-op actor now populates `keyId` from `authenticated_key_id`, matching the bulk-path parity already in place. `changed_fields` on `webhook.updated` is now a real diff vs the prior snapshot — identity PATCHes emit empty `changed_fields` and full-identity PATCHes suppress the emit entirely per spec v0.1.25.33 §6281. The `"no-req"` literal correlation-id fallback is replaced with `req_<uuid>` to preserve uniqueness under misconfigured `RequestIdFilter`. No wire or spec surface change.
- **v0.1.25.39** (2026-04-23) — **Webhook lifecycle events (spec v0.1.25.33).** `POST /v1/admin/webhooks`, `PATCH /v1/admin/webhooks/{id}`, `DELETE /v1/admin/webhooks/{id}`, and `POST /v1/admin/webhooks/bulk-action` (PAUSE / RESUME / DELETE) now emit `webhook.created` / `.updated` / `.paused` / `.resumed` / `.deleted` Events with the new `EventDataWebhookLifecycle` payload (`subscription_id`, `tenant_id`, `previous_status`, `new_status`, `changed_fields`, `disable_reason`). Update-endpoint emit type is classified by the status transition: `ACTIVE → PAUSED` yields `webhook.paused`, `PAUSED → ACTIVE` yields `webhook.resumed`, everything else yields `webhook.updated` with the touched properties enumerated in `changed_fields`. Bulk path stamps every per-row emit with `correlation_id = webhook_bulk_action:<action>:<request_id>` (one correlation_id per invocation, shared across rows) — skipped / failed rows never emit. Single-op correlation_ids: `webhook_create:<id>`, `webhook_update:<id>:<request_id>`, `webhook_delete:<id>`. The dispatcher-emitted `webhook.disabled` (auto-disable on failure threshold) is the events-service's responsibility — see `cycles-server-events` v0.1.25.11. Closes the operator-observability blind spot that v0.1.25.38 explicitly deferred. Aligns with spec v0.1.25.33 and v0.1.25.34's `EventCategory.webhook` enum addition. See [Event Payloads Reference](/protocol/event-payloads-reference).
- **v0.1.25.38** (2026-04-22) — **Bulk-action event parity (spec v0.1.25.32).** `POST /v1/admin/budgets/bulk-action` and `POST /v1/admin/tenants/bulk-action` now emit per-row Events matching single-op kinds (`budget.funded` / `.debited` / `.reset` / `.reset_spent` / `.debt_repaid` for budgets; `tenant.suspended` / `.reactivated` / `.closed` for tenants) after each successful mutation. Correlation-id shape: `budget_bulk_action:<action>:<request_id>` and `tenant_bulk_action:<action>:<request_id>` — one correlation_id per invocation, shared across rows. Skipped rows (`ALREADY_IN_TARGET_STATE`) and failed rows emit no Event. For `action=CLOSE` on tenants the existing `tenant_close_cascade:<tenant_id>:<request_id>` correlation axis (spec v0.1.25.29) is unchanged — operators tracing an invocation query by `tenant_bulk_action:close:<req>`, operators tracing one specific tenant's close query by `tenant_close_cascade:<tenant_id>:<req>`. Aggregate `AuditLogEntry` per invocation (spec v0.1.25.26) unchanged. `bulkActionWebhooks` was explicitly deferred in this release — its lifecycle `EventType` values did not yet exist — and is closed in v0.1.25.39. See [Using Bulk Actions](/how-to/using-bulk-actions-for-tenants-and-webhooks).
- **v0.1.25.37** (2026-04-21) — **Rule 1(c) bounded-convergence.** `PATCH /v1/admin/tenants/{id}` with `status=CLOSED` and `POST /v1/admin/tenants/bulk-action` action=CLOSE are idempotent on already-CLOSED tenants: the tenant-level write is a no-op (`ALREADY_IN_TARGET_STATE` for bulk, 200 for single-op) but the cascade is re-run against remaining non-terminal children. Implements the "implementation-defined convergence mechanism" clause of spec v0.1.25.31 §Rule 1(c), letting operators drive straggler children to terminal state by re-issuing CLOSE — no new endpoint, no new ceremony. Dashboard v0.1.25.44's cascade-recovery banner is the UI affordance for this.
- **v0.1.25.36** (2026-04-20) — **Rule 2 terminal-owner mutation guard coverage completed.** Every mutation on an object whose owning tenant is CLOSED now returns `409 TENANT_CLOSED` from every admin-mutating endpoint, per spec v0.1.25.30. New guard callsites: `POST /v1/admin/policies`, `PATCH /v1/admin/policies/{id}`, `POST /v1/admin/api-keys`, `PATCH /v1/admin/api-keys/{id}`, `DELETE /v1/admin/api-keys/{id}`, `POST /v1/admin/webhooks`, `PATCH`, `DELETE`, `POST .../test`, and per-row in `bulkActionWebhooks`. See [Tenant-Close Cascade Semantics](/protocol/tenant-close-cascade-semantics).
- **v0.1.25.35** (2026-04-20) — **Tenant-close cascade + TENANT_CLOSED guard shipped (Mode B).** Closing a tenant (`PATCH /v1/admin/tenants/{id}` or bulk-action) now cascades: `BudgetLedger → CLOSED`, `ApiKey → REVOKED`, open `Reservation → RELEASED` (reason `tenant_closed`), `WebhookSubscription → DISABLED`. One audit entry per mutated object under the same `correlation_id` as the originating `tenant.closed`. New event kinds: `budget.closed_via_tenant_cascade`, `api_key.revoked_via_tenant_cascade`, `reservation.released_via_tenant_cascade`, `webhook.disabled_via_tenant_cascade`. Rule 2 guard — 409 TENANT_CLOSED — active on budget/reservation mutation endpoints (full Rule 2 coverage shipped in v0.1.25.36). Spec v0.1.25.29 / .30 / .31 alignment. runcycles' reference server uses Mode B (flip-first-with-guarded-cascade); Mode A (atomic) is also conformant.
- **v0.1.25.34** (2026-04-20) — Pin `commons-lang3` 3.18.0 to close CVE-2025-48924. No wire or behavior change.
- **v0.1.25.33** (2026-04-20) — Bump Spring Boot 3.5.11 → 3.5.13, pin embedded tomcat 10.1.54 (CVE remediation). No wire or behavior change.
- **v0.1.25.32** (2026-04-18) — **Lenient deserialization on cross-plane read schemas.** `Event` and `WebhookDelivery` now set `@JsonIgnoreProperties(ignoreUnknown = true)` at the class level. Runtime is the authoritative writer of these records; admin only reads them. Previously admin POJOs were strict, so runtime shipping an additive field in a patch would break `listEvents` / `listWebhookDeliveries` until admin lockstep-updated. Now runtime can ship additive fields without forcing an admin release. Internal only — no wire contract change.
- **v0.1.25.31** (2026-04-18) — **W3C Trace Context cross-surface correlation** — server-side implementation of spec v0.1.25.28. New optional `trace_id` (32-hex) on `ErrorResponse`, `AuditLogEntry`, `Event` response bodies. New `X-Cycles-Trace-Id` response header on every response (2xx, 4xx, 5xx). Inbound precedence: `traceparent` → `X-Cycles-Trace-Id` → server-generate. New exact-match query params on `GET /v1/admin/audit/logs` and `GET /v1/admin/events`: `trace_id`, `request_id`. `WebhookDelivery` persists `trace_id` + `trace_flags` + `traceparent_inbound_valid` so the events sidecar can construct outbound `traceparent` preserving inbound sampling. Historical entries without `trace_id` continue to round-trip through strict Jackson. See [Correlation and Tracing](/protocol/correlation-and-tracing-in-cycles).
- **v0.1.25.30** (2026-04-18) — **Bulk-action audit metadata enrichment.** Single `AuditLogEntry` per bulk-action invocation (`bulkActionTenants`, `bulkActionWebhooks`, `bulkActionBudgets`) now carries the full per-row outcome arrays plus filter echo plus wall-clock `duration_ms`. New keys: `succeeded_ids`, `failed_rows`, `skipped_rows`, `filter`. Worst-case audit row size ~40KB at 500-row cap. Fully additive — existing metadata keys unchanged; spec `AuditLogEntry.metadata` is already typed `object` with `additionalProperties: true` so no info.version bump. Triage now works from audit alone without re-running the op.
- **v0.1.25.29** (2026-04-18) — **Budget bulk-action endpoint.** `POST /v1/admin/budgets/bulk-action` — AdminKeyAuth only. Five actions: `CREDIT`, `DEBIT`, `RESET`, `REPAY_DEBT`, `RESET_SPENT`. `filter.tenant_id` REQUIRED (cross-tenant budget bulk out of scope — 400 if blank). `amount` required for all 5 actions; `spent` honored only on `RESET_SPENT`. Filter mirrors `listBudgets` — `scope_prefix`, `unit`, `status`, `over_limit`, `has_debt`, `utilization_min/max`, `search`. Same 500-row cap, `expected_count`, idempotency-key safety gates as tenants/webhooks bulk. Per-row idempotency derived from `{bulkKey}:{scope}:{unit}` so retrying the failed subset cannot double-apply. Aligned with governance-admin spec v0.1.25.26.
- **v0.1.25.28** (2026-04-17) — **Audit `tenant_id` sentinel split.** The previous single `<unauthenticated>` sentinel is replaced by two: `__admin__` (admin-plane operations not scoped to a tenant, authenticated-tier retention, never sampled) and `__unauth__` (pre-auth failures, unauthenticated-tier retention, subject to sampling). URL-safe underscored form — no percent-encoding needed. **Migration:** dashboards and auditor queries using `?tenant_id=<unauthenticated>` keep matching historical rows but stop matching fresh writes; migrate to `__unauth__` or `__admin__`. Historical rows age out on the correct schedule. Aligned with governance-admin spec v0.1.25.25.
- **v0.1.25.27** (2026-04-17) — **Audit log filter DSL upgrade** on `GET /v1/admin/audit/logs`. New params: `error_code` (array, maxItems 25, IN-list, NULL-excluding), `error_code_exclude` (NOT-IN-list, NULL-passing, combinable with `error_code`), `status_min` / `status_max` (integer range, mutex with exact `status`). `operation` and `resource_type` promoted from scalar to array (comma-separated; single scalar still parses). `search` match set extended to include `error_code` + `operation` in addition to `resource_id` / `log_id`. Aligned with governance-admin spec v0.1.25.24.
- **v0.1.25.26** (2026-04-17) — **Bulk-action endpoints.** `POST /v1/admin/tenants/bulk-action` (SUSPEND | REACTIVATE | CLOSE) and `POST /v1/admin/webhooks/bulk-action` (PAUSE | RESUME | DELETE). Filter-only body (no id arrays), 500-row hard cap (`LIMIT_EXCEEDED` on overflow), optional `expected_count` → 409 `COUNT_MISMATCH` if the list changed between preview and submit. Response envelope splits `succeeded[]` / `failed[]` / `skipped[]`. `idempotency_key` required; 15-minute replay window served from the new `IdempotencyStore` primitive.
- **v0.1.25.25** (2026-04-17) — **Free-text `search` query param** on six admin list endpoints (`/v1/admin/tenants`, `.../api-keys`, `.../budgets`, `.../webhooks`, `.../events`, `.../audit/logs`). Case-insensitive substring match, ≤128 characters, AND-combined with every other filter. Pre-.25 servers ignore the unknown param (additive guarantee).
- **v0.1.25.24** (2026-04-16) — `sort_by` + `sort_dir` on the six list endpoints. Per-endpoint whitelists; unknown keys → 400 `INVALID_REQUEST`. **Default ordering changes for `listBudgets` (`utilization DESC`) and `listWebhookSubscriptions` (`consecutive_failures DESC`)** — callers relying on the prior set-iteration order must pass an endpoint-supported `sort_by` and `sort_dir` explicitly. Total-order cursor with primary-key tie-breaker; `SORTED_HYDRATE_CAP = 2000` on time-indexed endpoints.
- **v0.1.25.23** (2026-04-16) — `BudgetLedger.tenant_id` exposed on the wire (`@JsonInclude(NON_NULL)`). Cross-tenant list responses now carry per-row tenant attribution without scope-string parsing.
- **v0.1.25.22** (2026-04-16) — **Cross-tenant list** for `GET /v1/admin/api-keys` and `GET /v1/admin/budgets` under `AdminKeyAuth`. Omit `tenant_id` to walk every tenant; composite cursor `{tenantId}|{keyId}` / `{tenantId}|{ledgerId}`. Four new budget filters: `over_limit`, `has_debt`, `utilization_min`, `utilization_max`. Deleted-cursor-tenant handling skips forward instead of stalling.
- **v0.1.25.20** (2026-04-16) — **Audit log now captures failed requests** (401/403/400/404/409/500) with `error_code`, sanitized `metadata.error_message`, `metadata.method`, `metadata.path`. New sentinel tenant `<unauthenticated>` for pre-auth failures. **Tiered TTL** with SOC2-compliant defaults: `audit.retention.authenticated.days=400`, `audit.retention.unauthenticated.days=30` (both `0` = indefinite). Optional `audit.sample.unauthenticated` for DDoS exposure. Daily index sweep `audit.sweep.cron` (default `0 0 3 * * *`). New counter `cycles_admin_audit_writes_total{path_class, outcome}` — **alert on `outcome=error` nonzero**. **Semantic change**: dashboards that assumed "audit entry exists ⇒ operation succeeded" must now check `status` / `error_code`.
- **v0.1.25.19** (2026-04-16) — `GET /v1/auth/introspect` accepts both `AdminKeyAuth` and `ApiKeyAuth`. Tenant keys return `auth_type=tenant` shape with `tenant_id`, optional `scope_filter`, and a per-capability boolean table. Admin-plane capabilities forced to `false` under tenant auth.
- **v0.1.25.18** (2026-04-15) — **`RESET_SPENT` funding operation** on `POST /v1/admin/budgets/fund`. Clears (or overrides) `spent` for billing-period rollover, distinct from `RESET` which preserves `spent`. Optional `spent >= 0` override for migration / proration / credit-back. New event `budget.reset_spent`. `BudgetFundingResponse` gains nullable `previous_spent` + `new_spent`.
- **v0.1.25.17** (2026-04-14) — Fixed cjson empty-array round-trip bug that dropped records from `GET /v1/admin/api-keys` (and defensively on `Policy.caps.tool_allowlist` / `tool_denylist` / `Tenant.metadata`). `revokeApiKey` on already-revoked key now returns 409 `KEY_REVOKED` (was 200).
- **v0.1.25.16** (2026-04-13) — Dual-auth on six tenant-scoped webhook endpoints (`GET/PATCH/DELETE /v1/webhooks/{id}`, `POST /v1/webhooks/{id}/test`, `GET /v1/webhooks`, `GET /v1/webhooks/{id}/deliveries`). Admin operators can pause / inspect / force-delete tenant webhooks during incident response. `POST /v1/webhooks` (create) remains tenant-only.
- **v0.1.25.15** (2026-04-13) — `ScopeValidator` enforces canonical scope grammar (`tenant:<id>` first; canonical kind order `tenant → workspace → app → workflow → agent → toolset`; wildcards only terminal in policy patterns).
- **v0.1.25.14** (2026-04-13) — Dual-auth on `POST /v1/admin/budgets`, `POST /v1/admin/policies`, `PATCH /v1/admin/policies/{id}`. Admin auth requires `tenant_id` in the body; audit-log records `metadata.actor_type=admin_on_behalf_of`.
- **v0.1.25.13** (2026-04-13) — Fixed CORS `allowedMethods` missing `PUT`, which blocked browser dashboards from calling `PUT /v1/admin/config/webhook-security`.
- **v0.1.25.12** (2026-04-12) — Targeted 404/409 error responses on admin endpoints; documented 400 across every admin operation; spec-compliance hardening pass.
- **v0.1.25.11** (2026-04-12) — Contract testing default ON. `*ControllerTest` validates every 2xx/4xx/5xx JSON body against the pinned spec at build time. Offline builds: `CONTRACT_VALIDATION_ENABLED=false`.
- **v0.1.25.10** (2026-04-12) — Typed `Permission` enum + `Capabilities` class; spec-compliance hardening.

### Events service (`cycles-server-events`)

- **v0.1.25.22** (2026-07-04) — **Delivery-time SSRF guard.** The dispatcher re-validates each subscription URL against the current `config:webhook-security` (scheme / `allow_http`, resolved IP vs `blocked_cidr_ranges`, `allowed_url_patterns`) immediately before every outbound POST. A blocked delivery fails permanently (`ssrf_blocked`, no retry) and does not count against the subscription's failure budget.
- **v0.1.25.21** (2026-07-03) — `system.webhook_delivery_failed` meta-alert emitted on retry exhaustion; the four `*_via_tenant_cascade` event types added to the vocabulary; unknown `category` / `actor.type` values no longer poison deliveries.
- **v0.1.25.20** (2026-06-26) — Webhook processing recovery made multi-replica safe (timestamped claims, idle-based requeue); delivery-state write failures fail closed; `exec java` entrypoint.
- **v0.1.25.19** (2026-06-26) — Jedis 7.5.0 → 7.5.2. No code change.
- **v0.1.25.18** (2026-06-25) — **Reliable claim/ack queue (BRPOP → BLMOVE).** Delivery IDs are now claimed via `BLMOVE dispatch:pending → dispatch:processing` and acked with `LREM`; startup recovery requeues orphaned entries. Closes the crash-loss window of the previous destructive `BRPOP` consumption. Also fail-closed secret decrypt and a Redis PING health indicator.
- **v0.1.25.17** (2026-06-24) — Effective trace-id on transport-failure logs; CR/LF log-injection flattening.
- **v0.1.25.16** (2026-06-24) — Ops logging context review: stable operational identifiers on delivery/retry/dispatch/evidence logs; transport failures log the target host rather than the raw URL.
- **v0.1.25.15** (2026-06-23) — **Unconfigured CyclesEvidence is a supported disabled mode.** A blank `EVIDENCE_SERVER_ID` prevents the evidence signer worker, envelope builder, and local signing key from being created. The worker no longer claims source records or dead-letters them solely because `server_id` is absent. Retention cleanup also skips non-ZSET Redis keys matched by broad `events:*` scans, avoiding `WRONGTYPE` startup noise.
- **v0.1.25.14** (2026-06-15) — **CyclesEvidence signing tier.** The events service consumes `evidence:pending`, builds `cycles-evidence/v0.1` envelopes, cross-checks the producer-stamped `evidence_id`, Ed25519-signs with the private key held only in this service, and stores the envelope content-addressed for the runtime server to serve.
- **v0.1.25.11** (2026-04-23) — **Dispatcher-side webhook lifecycle emit (spec v0.1.25.33).** When `DeliveryHandler.incrementConsecutiveFailures` crosses `disable_after_failures`, the dispatcher now writes a `webhook.disabled` Event directly to the shared Redis store alongside the existing `DISABLED` status flip and `cycles_webhook_subscription_auto_disabled_total` metric. `EventType.WEBHOOK_DISABLED` and `EventCategory.WEBHOOK` enum values added (additive, no wire break). `correlation_id = webhook_auto_disable:<subscription_id>:<delivery_id>`; payload conforms to `EventDataWebhookLifecycle` with `disable_reason="consecutive_failures_exceeded_threshold"`, `actor.type=system`, `source=cycles-events`; `trace_id` copied from the triggering Delivery when present. Emit is best-effort — a Redis write failure logs at WARN but does not revert the status flip. The operator-initiated webhook lifecycle emits (`webhook.created/updated/paused/resumed/deleted`) remain the responsibility of `cycles-server-admin` v0.1.25.39; this patch closes only the auto-disable path the spec names as the dispatcher's exclusive emission point.
- **v0.1.25.10** (2026-04-20) — Bump Spring Boot 3.5.11 → 3.5.13, pin embedded tomcat 10.1.54 (CVE remediation). No wire or behavior change.
- **v0.1.25.9** (2026-04-18) — **Management port split.** `health`, `info`, and `prometheus` actuator endpoints moved from application port `7980` to a dedicated management port (default `9980`, env `MANAGEMENT_PORT`). **Migration:** Prometheus scrape configs must update target port from `:7980` → `:9980`; kubelet probes and Docker `HEALTHCHECK` same. Published Docker image `HEALTHCHECK` already updated. No wire-format change for dispatch. The reference events service is an outbound worker, so do not publish `7980` for webhook delivery; keep `9980` internal-only.
- **v0.1.25.8** (2026-04-18) — **Cross-surface correlation on `WebhookDelivery`.** Three new OPTIONAL fields: `trace_id` (captured at dispatch time from originating event), `trace_flags` (W3C trace-flags byte for outbound `traceparent`), `traceparent_inbound_valid` (whether upstream sent valid W3C traceparent). Aligns with governance-admin spec v0.1.25.28. Dispatcher honors `trace_flags` when `traceparent_inbound_valid=true`, otherwise defaults to `01` (sampled). Proactive `trace_id` stamping on `Delivery` as rolling-upgrade safety net for pre-.31 admin servers.
- **v0.1.25.7** (2026-04-18) — **trace_id and W3C Trace Context headers on every outbound webhook delivery.** New outbound headers: `X-Cycles-Trace-Id` (always present), `traceparent: 00-<trace_id>-<16-hex-span>-<flags>` (fresh span-id per delivery, never reused from inbound), `X-Request-Id` (when event carries `request_id`). New `Event.trace_id` field, optional. Non-fatal `trace_id_shape` validation rule — malformed `trace_id` increments `cycles_webhook_events_payload_invalid_total{rule="trace_id_shape"}` and the dispatcher falls back to minting a fresh id so outbound header stays well-formed. Aligns with governance-admin spec v0.1.25.27.
- **v0.1.25.6** (2026-04-16) — `BUDGET_RESET_SPENT` added to the `EventType` vocabulary. **Eight new Prometheus metrics** under `cycles_webhook_*`: `delivery_attempts_total`, `delivery_success_total`, `delivery_failed_total`, `delivery_retried_total`, `delivery_stale_total`, `subscription_auto_disabled_total`, `events_payload_invalid_total`, plus `cycles_webhook_delivery_latency_seconds` timer. `cycles.metrics.tenant-tag.enabled` flag mirrors the runtime. Non-fatal `EventPayloadValidator` on every ingested event (WARN + counter on violation; never drops).
- **v0.1.25.5** (2026-04-08) — **Force HTTP/1.1 on outbound webhook deliveries.** Fixes silent body-drop against HTTP/2 reverse proxies that upgrade to h2c.
- **v0.1.25.4** (2026-04-07) — `SubscriptionRepository.updateDeliveryState` switched to partial merge (previously overwrote admin-side PATCH writes under contention).
- **v0.1.25.3** (2026-04-03) — `micrometer-registry-prometheus` dependency added (`/actuator/prometheus` was 404 without it). Typed `DeliveryStatus` / `WebhookStatus` enums.
- **v0.1.25.1** (2026-04-01) — Initial release. Redis-driven dispatcher consuming `dispatch:pending` via BRPOP. HMAC-SHA256 signing, exponential-backoff retry, auto-disable after consecutive failures. AES-256-GCM encryption of signing secrets at rest (`WEBHOOK_SECRET_ENCRYPTION_KEY`, 32-byte key). TTL retention (90d events / 14d deliveries). Configurable `dispatch.http.connect-timeout-seconds` + `dispatch.http.timeout-seconds`.

### Dashboard (`cycles-dashboard`)

- **v0.1.25.67** (2026-07-04) — Compose pin: `cycles-server-admin` 0.1.25.47 → 0.1.25.48, completing the fleet alignment started in .66. No dashboard code change.
- **v0.1.25.66** (2026-07-04) — Bundled server stack bumped to `cycles-server` 0.1.25.46 and `cycles-server-events` 0.1.25.22 (compose + README). Operator notes: events .22 re-validates webhook URLs against the webhook-security config at delivery time — dev stacks delivering to `http://` or private-network targets must adjust **Settings → Webhook security** or deliveries permanently fail with `ssrf_blocked`; server .46 adds default-on 429 rate limiting on the public evidence/JWKS endpoints. No dashboard code change.
- **v0.1.25.65** (2026-07-03) — The four `*_via_tenant_cascade` event kinds (spec v0.1.25.35) added to `EVENT_TYPES`, so they appear in the Events type-filter typeahead and can be selected in webhook subscription event-type checkboxes. CI coverage gate raised to the repo's ≥95% line threshold.
- **v0.1.25.64** (2026-06-26) — Bundled fleet bump (`cycles-server` 0.1.25.44, admin 0.1.25.47, events 0.1.25.20); nginx container healthcheck; backend healthchecks moved to `/actuator/health/readiness`; hardened production compose defaults (required Redis password, required webhook-secret encryption, SpringDoc off, tenant metrics off).
- **v0.1.25.63** (2026-06-22) — **Reservation → evidence links.** The reservation detail dialog gains one-click **View reserve / commit / release evidence** links to the Evidence viewer, and the list `include` toggle requests the `evidence` projection. Requires `cycles-server` v0.1.25.37+; older servers omit the field and no links render.
- **v0.1.25.62** (2026-06-22) — **Reservations and Evidence gap closure.** Reservations view gains `committed` / `finalized_at_ms` columns, a read-only detail dialog with reserve-time and commit-time metadata (`include=metadata,committed_metadata`), and advanced filters (created/expires/finalized time ranges, Subject filters). Create/Edit Policy exposes `caps`, `rate_limits`, `reservation_ttl_override`, and the effective window; Create/Edit Webhook exposes `thresholds` and `retry_policy`; API-key edit can adjust `expires_at`; tenant create/edit exposes `max_reservation_extensions` and `reservation_expiry_policy`. New **Evidence** page retrieves `GET /v1/evidence/{id}` and resolves the signer key against the published JWK Set. Runtime-plane compose baseline moved to `cycles-server` 0.1.25.36.
- **v0.1.25.61** (2026-05-31) — **Configurable reverse-proxy upstreams.** The bundled nginx proxy's two upstream targets become environment variables (`ADMIN_UPSTREAM` / `RUNTIME_UPSTREAM`), so the proxy that routes `/v1/reservations*`, `/v1/evidence*`, and `/v1/.well-known/cycles-jwks.json` to the runtime plane can be retargeted at deploy time without an image rebuild. Deployment-only change.
- **v0.1.25.59** (2026-04-23) — **Spec alignment v0.1.25.31 → v0.1.25.34.** Adds the six `webhook.created` / `.updated` / `.paused` / `.resumed` / `.disabled` / `.deleted` values to the Events view type datalist plus `webhook` to the category dropdown, so operators can filter on the new lifecycle events emitted by admin v0.1.25.39 and events v0.1.25.11. Payload renderer stays untyped (`Record<string, unknown>`) — matches the existing pattern for `EventDataTenantLifecycle`. Compose pins bumped to admin v0.1.25.39 + events v0.1.25.11 so new events actually fire end-to-end. **Operator bug folded in:** Overview budget-utilization donut and the at-cap attention card now exclude spec-terminal CLOSED budgets (spec v0.1.25.29) from both the bucketing and the total, so a CLOSED-at-120% budget no longer inflates "Over cap" and CLOSED budgets no longer inflate "Healthy". FROZEN stays included — it's non-terminal.
- **v0.1.25.58** (2026-04-23) — **Mobile-responsive sweep.** Ten fixes across layout shell, tables, menus, dialogs: Escape closes the drawer with focus-return to hamburger, hamburger sized to 44×44 with `aria-expanded` / `aria-controls`, root uses `h-dvh` (mobile Safari URL-bar), `PageHeader` reflows to column on narrow viewports, table minimum widths tightened, `RowActionsMenu` clamps to viewport horizontally, `FormDialog` + `ConfirmAction` footers flex-wrap, `LoginView` and `NotFoundView` fit 320w with `min-h-dvh`. Virtualized-table card-mode on phones and `CommandPalette` soft-keyboard handling deferred to a future release.
- **v0.1.25.57** (2026-04-23) — Correctness + debuggability sweep. Replay body properly typed with pre-flight validation of `max_events`; tenant-list failure surfaces in the top banner instead of inline filter text; `auth.restore()` is single-flight so concurrent cold-load callers coalesce; timeout error messages include method + URL path; JSON-parse failures on error bodies log `console.warn`; `ReservationsView` reads `?tenant_id=` and mirrors the filter to URL; bulk-action durations use `Intl.NumberFormat` for locale-aware formatting.
- **v0.1.25.56** (2026-04-23) — P2 accessibility + form-UX closeout. `TenantsView` create form validates live with `FormDialog.submitDisabled`; `BaseChart` auto-renders an `sr-only` data table from pie-shaped options so screen readers get every donut; `.chip:focus-visible` ring added. `RowActionsMenu` keyboard nav (ArrowUp/Down/Home/End/Escape/Tab) was already correct — added a regression-lock test.
- **v0.1.25.55** (2026-04-23) — L-tier polish + coverage backfill. Nine hardcoded polling-interval literals across views collapsed to shared constants; `.form-label` gains `font-medium`; `RefreshButton` dark hover states wired. Coverage additions on `useChartTheme`, `useListExport` boundaries, and `usePolling` stale-after-unmount.
- **v0.1.25.54** (2026-04-23) — **Full-app UX & safety sweep (P0 / P1).** Catch-all 404 route with `NotFoundView`; detail views distinguish pending fetch vs 404; `useListExport` threads `AbortSignal` through `fetchPage` and drops late pages; named-route discipline across Sidebar / TenantDetail / WebhookDetail / BudgetsView; per-route `document.title` via `meta.title` + `afterEach`; `LoadingSkeleton` on cold load for list views; logout confirmation via `ConfirmAction`; `formatDateTime` / `formatTime` include short timezone marker; `usePolling.lastSuccessAt` + `PageHeader` freshness pill; shared `InlineErrorBanner` with dismiss × replaces nine inline banners; `BudgetsView` `route.query.filter` watcher re-runs `loadList` on change; "all tenants" scope banner on `BudgetsView` non-cross-tenant-filter case.
- **v0.1.25.53** (2026-04-22) — **Counter-strip / donut / drill-down reconciliation.** Five instances of the same class of bug where two surfaces showing the same concept read from different data sources or applied different filters. Fixes: webhooks-active drill-down now pushes `status=` server-side (was client-side filtering one page — 62 vs 12); webhook fleet-health donut slices are status-pure `{active, paused, disabled}` sourced from `overview.webhook_counts` (not failure-biased — fixes 5 vs 6 paused); utilization-donut sampling bump `limit=500 → 2000`; events drill-downs from Overview carry `from`/`to` matching the tile window; Expiring Keys "View all" carries `?expiring_within_7d=1` so the drill-down shows the same set as the card.
- **v0.1.25.52** (2026-04-22) — **Webhook fleet-health donut relocated to Overview.** Moved from `WebhooksView` to the Overview 4-up chart grid (after budget utilization, before events-by-category) so operators get fleet-glance health on the landing page without it pushing the webhooks table below the fold. Same data source (`listWebhooks` already fetched for the failing-webhooks card), same drill-down contract. Overview chart grid widened `lg:grid-cols-3` → `lg:grid-cols-4`.
- **v0.1.25.51** (2026-04-22) — **Webhook visualizations — fleet-health donut + per-subscription stat row.** `WebhookDetailView` gains a four-up stat row between the subscription card and the Delivery History table: last-success chip with PagerDuty-style traffic-light semantics (green <1h, amber 1h–24h, red ≥24h or no success), delivery-outcome donut (click sets the history-table status filter in place), attempts-per-delivery histogram bucketed 0/1/2/3/4/5+, response-time p50/p95/max computed via NIST nearest-rank. Fleet-health donut over `webhooks` (client-side reduce from the 60s poll, no new request) with click-to-drill via `?status=...` or `?failing=1`.
- **v0.1.25.50** (2026-04-22) — **Budget fleet-utilization reframed.** Overview chart now partitions budgets by actual `spent / allocated` across Healthy (`<0.9`), Near cap (`0.9 ≤ util < 1.0`), Over cap (`≥1.0`) and drills to `/budgets?utilization_min=…&utilization_max=…` — replaces the v0.1.25.48 stacked bar that was keyed off `budget_counts.over_limit` / `budget_counts.with_debt` (a financial overdraft signal, not a utilization signal). `BudgetsView` hydrates `filterUtilMin` / `filterUtilMax` from `route.query` on mount so deep-links from the Overview drill-down actually filter. Chart type changed to donut so the three Overview charts share one shape.
- **v0.1.25.49** (2026-04-22) — **Chart drill-down (slice-click → filtered list view) + color-palette fix.** Every slice / segment on the three Overview charts is clickable and navigates to the corresponding filtered list view via `router.push` (budgets `status=` / `filter=over_limit` / `filter=has_debt`, events `category=`). Ten-hue qualitative palette added to `useChartTheme` with a `hashCategory(name) % 10` fallback so previously-collided neutral-grey categories (`tenant`, `api_key`, `audit`) now get distinct hues — `policy` keeps danger-red and `reservation` keeps success-green because operators already associate those semantics.
- **v0.1.25.48** (2026-04-22) — **Overview charts expanded from 1 to 3.** Added budget-utilization stacked bar + events-by-category donut beside the existing budget-status donut, laid out as a 3-up grid beneath the counter strip. Same `/v1/admin/overview` payload — no new fetches. Each chart has its own `v-if` empty-state guard plus a wrapping `hasAnyChart` so the row hides entirely on a fresh environment.
- **v0.1.25.47** (2026-04-22) — **Charting layer trial slice (budget-status donut).** Introduces ECharts + `vue-echarts` as a tree-shaken lazy-loaded chunk (~142 KB gz, `CanvasRenderer` only), new shared `BaseChart.vue` wrapper, new `useChartTheme` composable (reactive palette re-deriving on dark-mode flip), plus one live chart — the budget-status donut on Overview. `OverviewView` initial chunk stays at ~6.4 KB gz via `defineAsyncComponent`.
- **v0.1.25.46** (2026-04-21) — **Hide terminal-state rows by default across every list view.** Tenants, Budgets, Webhooks, API Keys, and TenantDetail sub-lists now hide CLOSED / DISABLED / REVOKED / EXPIRED rows on mount and surface a "Show closed (N)" / "Show disabled (N)" / "Show revoked (N)" toggle mirroring the hidden count. Toggle state mirrors to `?include_terminal=1` on top-level views; auto-engages when an `explicit_status` matching a terminal value is chosen. Matches the GitHub / Linear / Gmail convention — new shared `useTerminalAwareList` composable, single source of truth for what counts as terminal per entity kind.
- **v0.1.25.45** (2026-04-21) — **Closed-tenant children excluded from Overview attention cards + Tenants filter persists across drill-in + clean-close banner flash.** Overview fetches `listTenants({status:'CLOSED'})` alongside the existing attention-card sources and filters Budgets-at-cap / Frozen-budgets / Debt-budgets / Expiring-API-keys / Failing-webhooks to exclude closed-tenant children (transient Mode B convergence window, spec v0.1.25.31). `TenantsView` filter state (parent, status) survives drill-in via a `router.replace({ query })` watcher; back-navigation uses `router.back()` so the detail URL stays clean. `executeTenantAction` now four-way refetches on CLOSE so the cascade-recovery banner doesn't flash on a clean close.
- **v0.1.25.44** (2026-04-20) — **Cascade-recovery banner (consumes spec v0.1.25.31 Rule 1(c)).** `TenantDetailView` renders an amber banner below the CLOSED-tenant tombstone when `cascadeIsIncomplete(children)` — enumerates pending counts per axis (budgets, webhook subscriptions, API keys) and exposes a "Re-run cascade" button that re-PATCHes `{status: CLOSED}`. Idempotent at the tenant level (no-op per Rule 1) but drives remaining non-terminal children to terminal states via the admin v0.1.25.37 bounded-convergence path. Serves historical tenants closed pre-admin-`.35` (cascade never ran) and partial-cascade-failure recovery without requiring operators to curl the admin API by hand.
- **v0.1.25.43** (2026-04-20) — **Closed-tenant tombstone + cascade preview UI.** Consumes admin v0.1.25.36 cascade implementation. New TenantDetailView amber banner when `tenant.status === 'CLOSED'` ("Tenant closed — all owned objects are read-only."). CLOSE confirm-dialog now previews what the cascade will terminate (budgets, webhook subscriptions, API keys, open reservations with counts). `TENANT_CLOSED` 409 humanizer ("Tenant is closed — this object is read-only.") on race conditions. Audit + event-timeline rows render a small amber "tenant cascade" chip when the event kind carries `_via_tenant_cascade`, letting operators distinguish cascade-triggered state changes from user-driven ones when correlating by `correlation_id`. Admin image pin 0.1.25.32 → 0.1.25.36 (cascade requires admin .36). New shared `isTerminalTenant()` predicate in `src/utils/tenantStatus.ts`. Spec pointer v0.1.25.29 → v0.1.25.31.
- **v0.1.25.42** (2026-04-19) — Security: base-image bumps (`nginx:1.27-alpine` → `nginx:1.29-alpine`, `node:20.19` → `20.20`) resolving 57 Alpine-layer CVEs flagged by Trivy.
- **v0.1.25.41** (2026-04-19) — Dependabot-bundled dependency bumps including `vue-router 4.6.4 → 5.0.4` (major, no breaking changes for this app). TypeScript typecheck clean; 742 tests green.
- **v0.1.25.40** (2026-04-19) — **Shared icon library** at `src/components/icons/` — 24 reusable SVG components (CopyJsonIcon, CopyIcon, KebabIcon, etc.). Stroke-width unified to `1.5`; four icons upgraded to Heroicons v2 geometry. Copy JSON moved from dedicated rows/columns to overlay icons and kebab menus — WebhookDetailView delivery column shrinks 88px → 40px; panels lose ~35–50px footer rows.
- **v0.1.25.39** (2026-04-18) — **Cross-surface trace / request correlation chip** on Events, Audit, and WebhookDeliveries rows. Click `trace_id` on Audit → EventsView filtered to the same trace; click `trace_id` on Events → AuditView filtered to originating entry. Requires `cycles-server-admin` v0.1.25.31+. **Webhook delivery history fixes:** interface field mapping (`http_status` → `response_status`, `delivered_at` → `completed_at`), StatusBadge delivery-status colors, Error column on FAILED rows, CSV export enrichment.
- **v0.1.25.38** (2026-04-18) — **Structured bulk-action audit detail** in AuditView expanded row. Renders `succeeded_ids` / `failed_rows` / `skipped_rows` / `filter` echo / `duration_ms` as a first-class layout (not raw JSON). Requires `cycles-server-admin` v0.1.25.30+.
- **v0.1.25.37** (2026-04-18) — **Per-row Copy JSON** affordance across EventsView, AuditView, EventTimeline, WebhookDeliveries. Row-select bulk failures open `BulkActionResultDialog`. EventTimeline `correlation_id` click → EventsView filtered.
- **v0.1.25.36** (2026-04-18) — **BudgetsView row-select + bulk Freeze / Unfreeze.** Row-select checkboxes + floating bulk toolbar mirror the TenantsView pattern.
- **v0.1.25.35** (2026-04-18) — **Budget bulk-action UI.** Filter-apply toolbar on BudgetsView for `CREDIT`, `DEBIT`, `RESET`, `RESET_SPENT`, `REPAY_DEBT`. Requires `cycles-server-admin` v0.1.25.29+.
- **v0.1.25.34** (2026-04-18) — **`BulkActionResultDialog` component** — per-row outcome triage for bulk operations. New `errorCodeMessages.ts` utility — single source of truth for operator-facing error code prose.
- **v0.1.25.33** (2026-04-18) — **AuditView filter DSL completeness** against governance-admin v0.1.25.24: `error_code_exclude`, `operation` IN-list, `resource_type` typeahead datalist, `status_min` / `status_max` range. Deep-link support via query params.
- **v0.1.25.28** (2026-04-17) — Bulk-action UI on TenantsView + WebhooksView (filter-apply path in addition to row-select). Image tag `ghcr.io/runcycles/cycles-dashboard:0.1.25.28`. Spec alignment bumped to v0.1.25.23. CI gate runs 6 new e2e bulk-action probes (empty filter → 400, invalid action → 400, zero-match → 200, idempotency replay, webhook mirror) against the published image on every release.
- **v0.1.25.27** — Free-text `search` wired into six admin list views (Tenants, Budgets, ApiKeys, Audit, Webhooks, Events). Debounced page-1 refetch honors cursor-tuple invalidation. Client-side fallback on pre-.25 servers. **RESET_SPENT funding** operation available from BudgetDetail → Fund (requires admin v0.1.25.18+).
- **v0.1.25.26** — V4 server-side sort across six admin views + `ReservationsView` (runtime plane). TenantsView "+N more" and inline child-links thread `?parent=<src>` so the back arrow returns to the source parent. Scale hardening: row virtualization via `@tanstack/vue-virtual` across seven list views; pagination + N+1 mitigation; cancel-button on long exports; dark-mode and a11y (WCAG AA) passes.
- **v0.1.25.22** — ApiKeysView + BudgetsView consume the cross-tenant `/v1/admin/api-keys` and `/v1/admin/budgets` endpoints. `BudgetLedger.tenant_id` rendered as a first-class column.
- New routes introduced across the window: `/api-keys` (first-class cross-tenant list), `/reservations` (runtime-plane force-release), `/tenants/:id` (detail with parent/children breadcrumb), `/webhooks/:id` (single subscription detail).
- Global command palette: `Cmd/Ctrl+K` or `/` opens a tenant search (3-page prefetch, 60s cache, substring filter, "Load more" for scale).

---

## v0.1.25 — April 2026 (Initial release)

**Pillar 4: Events & Webhooks (Observability Plane)**

New event-driven observability system spanning all three services.

**Protocol spec (non-breaking, guidance only):**
- Added WEBHOOK EVENT GUIDANCE section documenting 41 event types, payload schema, delivery protocol, and X-Cycles-Signature HMAC verification
- No new API endpoints — guidance is informational, not normative

**Admin server (20 new endpoints):**
- 12 admin webhook/event endpoints at `/v1/admin/webhooks` and `/v1/admin/events`
- 8 tenant self-service endpoints at `/v1/webhooks` and `/v1/events` (requires `webhooks:read/write`, `events:read`)
- `GET/PUT /v1/admin/config/webhook-security` — SSRF protection with blocked CIDR ranges
- 41 event types across 6 categories: budget (16), reservation (5), tenant (6), api_key (6), policy (3), system (5)
- Event emission wired into all existing controllers

**Runtime server (event emission):**
- `reservation.denied` on DENY decision (reserve and decide endpoints)
- `reservation.commit_overage` on commit with actual > estimated

**Events delivery service (`cycles-server-events`, internal app port 7980):**
- Async webhook delivery via BLMOVE claim/ack from the shared Redis dispatch queue (BRPOP before v0.1.25.18)
- HMAC-SHA256 payload signing (`X-Cycles-Signature: sha256=<hex>`)
- Exponential backoff retry, auto-disable after consecutive failures
- Stale delivery protection (>24h deliveries auto-fail on pickup)

**Security:**
- AES-256-GCM encryption for signing secrets at rest (`WEBHOOK_SECRET_ENCRYPTION_KEY` env var)
- Webhook URL SSRF protection: private IPs blocked by default, HTTPS required in production

**Data retention:**
- Event keys: 90-day Redis TTL (configurable via `EVENT_TTL_DAYS`)
- Delivery keys: 14-day Redis TTL (configurable via `DELIVERY_TTL_DAYS`)
- ZSET index cleanup: hourly via RetentionCleanupService

**Testing:** 530 tests across 3 services (events: 114, admin: 319, server: 97), all 95%+ coverage. Full-stack E2E test (23 assertions) verified across all services via Docker.

---

## v0.1.24 — March 2026

::: danger Migration required — default overage policy changed
The default `commit_overage_policy` changed from **`REJECT`** to **`ALLOW_IF_AVAILABLE`**. If you relied on `REJECT` as the implicit default, reservations and commits that previously failed will now succeed and may allow overspend. To preserve the previous behavior, explicitly set `overagePolicy = "REJECT"` on your decorators/annotations, or update tenant defaults via `PATCH /v1/admin/tenants/{id}` with `"default_commit_overage_policy": "REJECT"`.
:::

**Protocol (breaking):**
- Default overage policy changed from `REJECT` to `ALLOW_IF_AVAILABLE`
- `ALLOW_IF_AVAILABLE` commits now always succeed: when remaining budget can't cover the full overage delta, the charge is capped to estimate + available remaining and `is_over_limit` is set to block future reservations
- `is_over_limit` extended to also cover capped `ALLOW_IF_AVAILABLE` commits
- `CommitResponse.charged` may now be less than `actual` when overage is capped
- `EventCreateResponse` now includes optional `charged` field (present when `ALLOW_IF_AVAILABLE` caps the charge to remaining budget)
- Three new error codes: `BUDGET_FROZEN` (409), `BUDGET_CLOSED` (409), `MAX_EXTENSIONS_EXCEEDED` (409) — error code count increased from 12 to 15

**Server:**
- Updated commit Lua script with capped-delta logic for `ALLOW_IF_AVAILABLE`
- Updated default fallback in reservation and commit paths from `REJECT` to `ALLOW_IF_AVAILABLE`

**Admin Server:**
- Default tenant `default_commit_overage_policy` changed from `REJECT` to `ALLOW_IF_AVAILABLE`
- New endpoint: `PATCH /v1/admin/budgets?scope=&unit=` — update `overdraft_limit`, `commit_overage_policy`, and `metadata` on existing budgets with atomic `is_over_limit` recalculation
- Budget fund and patch endpoints now use query parameters (`?scope=...&unit=...`) instead of path variables for consistency with the balances API
- New endpoint: `PATCH /v1/admin/policies/{policy_id}` — update all mutable policy fields (name, description, priority, caps, overage policy, TTL override, rate limits, effective dates, status). Note: policy runtime enforcement is deferred to a future version; policies are stored but not yet evaluated by the protocol server
- Tenant update extended with `default_reservation_ttl_ms`, `max_reservation_ttl_ms`, and `max_reservation_extensions` — reservation TTL is now configurable per-tenant
- Budget metadata support on create and update

## v0.1.23 — March 2026

**Protocol:**
- Complete OpenAPI 3.1.0 specification
- 9 protocol endpoints: decide, reserve, list, get, commit, release, extend, balances, events
- 4 unit types: USD_MICROCENTS, TOKENS, CREDITS, RISK_POINTS
- 3 overage policies: REJECT, ALLOW_IF_AVAILABLE, ALLOW_WITH_OVERDRAFT
- Subject hierarchy: tenant, workspace, app, workflow, agent, toolset
- Dry-run mode for shadow evaluation
- Reservation TTL with grace period and extend
- Idempotent operations with per-endpoint scoping
- 12 error codes with structured error responses
- Caps and three-way decision model (ALLOW, ALLOW_WITH_CAPS, DENY)
- Debt and overdraft model

**Server:**
- Spring Boot 3.5 + Java 21 runtime
- Redis 7+ with Lua scripts for atomic operations
- Docker images on GHCR
- Health check endpoint (Spring Boot Actuator)
- Request ID generation and tracking

**Admin Server:**
- Tenant lifecycle management (ACTIVE, SUSPENDED, CLOSED)
- API key management with granular permissions
- Budget ledger CRUD with funding operations (CREDIT, DEBIT, RESET, REPAY_DEBT)
- Policy management with scope patterns
- Audit logging
- Cursor-based pagination

**Client SDKs:**
- Python: `runcycles` — decorator, programmatic, and async APIs
- TypeScript: `runcycles` — withCycles HOF, reserveForStream, programmatic APIs
- Java/Spring: `cycles-client-java-spring` — @Cycles annotation with SpEL expressions

**Integrations:**
- OpenAI, Anthropic, LangChain (Python)
- OpenAI, Anthropic, LangChain.js, Vercel AI SDK, AWS Bedrock, Google Gemini, Express (TypeScript)
- Spring AI (Java)
- OpenClaw agent framework (TypeScript)

---

## Version compatibility

| SDK / Component | Version | Compatible server |
|---|---|---|
| `runcycles` (Python) | 0.4.3 | v0.1.23+, v0.1.24+, v0.1.25+ |
| `runcycles` (TypeScript) | 0.3.3 | v0.1.23+, v0.1.24+, v0.1.25+ |
| `runcycles` (Rust) | 0.2.6 | v0.1.23+, v0.1.24+, v0.1.25+ |
| `cycles-client-java-spring` | 0.2.5 | v0.1.23+, v0.1.24+, v0.1.25+ |
| `@runcycles/mcp-server` | 0.2.4 | v0.1.23+, v0.1.24+, v0.1.25+ |
| `@runcycles/openclaw-budget-guard` | 0.8.4 | v0.1.23+, v0.1.24+, v0.1.25+ |
| Cycles Server (runtime) | v0.1.25.46 | Protocol v0.1.25 plus CyclesEvidence v0.2 signer-authority layer |
| Cycles Admin Server | v0.1.25.48 | Governance spec v0.1.25.34 |
| Cycles Events Service | v0.1.25.22 | Shared Redis dispatch queue plus CyclesEvidence signing queue |
| Cycles Dashboard | v0.1.25.67 | Admin v0.1.25.39+ for current governance views; runtime v0.1.25.37+ for reservation evidence links; events v0.1.25.14+ for signed evidence |

All current SDK versions are backward-compatible with server v0.1.23. New v0.1.24 features (budget patch, policy patch, capped `ALLOW_IF_AVAILABLE` commits) require server v0.1.24+. New v0.1.25 features (event emission, webhook delivery, events service, `policy_id` / `deny_detail` on `reservation.denied`) require server v0.1.25.

### Minimum versions for specific features

| Feature | Minimum component |
|---|---|
| Dashboard Evidence viewer and reservation "View evidence" links | `cycles-dashboard` v0.1.25.63+; `cycles-server` v0.1.25.37+ for `include=evidence`; `cycles-server-events` v0.1.25.14+ to sign envelopes |
| Unconfigured CyclesEvidence disabled mode (no queueing or dead-lettering when identity is blank) | `cycles-server` v0.1.25.38, `cycles-server-events` v0.1.25.15 |
| Tenant-close cascade + `TENANT_CLOSED` (409) error code + 4 `_via_tenant_cascade` event kinds | `cycles-server-admin` v0.1.25.35 (initial Mode B cascade) / v0.1.25.36 (full Rule 2 guard coverage); `cycles-dashboard` v0.1.25.43 (tombstone + cascade preview UI); governance-admin spec v0.1.25.29 / .30 / .31 |
| W3C Trace Context (`trace_id` on responses + audit/events filter) | `cycles-server` v0.1.25.14, `cycles-server-admin` v0.1.25.31, `cycles-server-events` v0.1.25.7, `cycles-dashboard` v0.1.25.39 |
| Runtime audit-log retention TTL (`AUDIT_RETENTION_DAYS`) | `cycles-server` v0.1.25.15 |
| Events service management port split (9980) | `cycles-server-events` v0.1.25.9 |
| Bulk-action audit metadata enrichment (`succeeded_ids`, `failed_rows`, `filter`, `duration_ms`) | `cycles-server-admin` v0.1.25.30 |
| Budget bulk-action endpoint (`POST /v1/admin/budgets/bulk-action`) | `cycles-server-admin` v0.1.25.29, `cycles-dashboard` v0.1.25.35 |
| Audit tenant sentinel split (`__admin__` / `__unauth__`) | `cycles-server-admin` v0.1.25.28 |
| Audit log filter DSL (`error_code_exclude`, `status_min/max`, array `operation`/`resource_type`) | `cycles-server-admin` v0.1.25.27, `cycles-dashboard` v0.1.25.33 |
| Sorted pagination on `GET /v1/reservations` (`sort_by`, `sort_dir`) | `cycles-server` v0.1.25.12 |
| Admin-on-behalf-of release (`X-Admin-API-Key` on `/v1/reservations/{id}/release`) | `cycles-server` v0.1.25.8 |
| Bulk-action endpoints on tenants + webhooks | `cycles-server-admin` v0.1.25.26 |
| Free-text `search` on admin list endpoints | `cycles-server-admin` v0.1.25.25 |
| Server-side sort on admin list endpoints | `cycles-server-admin` v0.1.25.24 |
| Cross-tenant list for API keys + budgets | `cycles-server-admin` v0.1.25.22 |
| Failed-request audit capture + tiered TTL | `cycles-server-admin` v0.1.25.20 |
| `RESET_SPENT` funding operation | `cycles-server-admin` v0.1.25.18 |
| Dual-auth on tenant webhook endpoints | `cycles-server-admin` v0.1.25.16 |
| Webhook delivery via HTTP/1.1 (h2c fix) | `cycles-server-events` v0.1.25.5 |

---

*For detailed API changes, see the [Cycles Protocol specification](https://github.com/runcycles/cycles-protocol).*
