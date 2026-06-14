---
title: "Glossary"
description: "Definitions of key terms and concepts used throughout the Cycles documentation, including budgets, scopes, reservations, and protocol terminology."
---

# Glossary

Definitions of key terms and concepts used throughout the Cycles documentation.

## Core Concepts

### Runtime Authority

The umbrella control layer that governs autonomous agent execution. Runtime authority covers both **budget authority** (how much the agent spends) and **action authority** (what the agent does). It is enforced before work begins, not observed after the fact. See [What Is Runtime Authority for AI Agents?](/blog/what-is-runtime-authority-for-ai-agents) and [Runtime Authority vs Guardrails vs Observability](/blog/runtime-authority-vs-guardrails-vs-observability).

### Budget Authority

The role Cycles plays in an autonomous system: authorizing or denying execution based on whether sufficient budget is available. Unlike billing or observability, budget authority is enforced **before** work begins. See [What Cycles Is Not](/concepts/what-cycles-is-not-billing-rate-limiting-orchestration-and-other-category-confusion) for how this differs from adjacent categories.

### Action Authority

The subset of [runtime authority](#runtime-authority) that governs what actions an agent is permitted to take — independent of cost. While budget authority controls spend, action authority controls side effects: emails sent, deployments triggered, records modified. Cycles enforces action authority through toolset-scoped budgets denominated in [RISK_POINTS](/protocol/understanding-units-in-cycles-usd-microcents-tokens-credits-and-risk-points). See the [Action Authority Demo](/demos/) and [AI Agent Action Control](/blog/ai-agent-action-control-hard-limits-side-effects).

### Exposure

The cumulative cost, risk, or side effects an autonomous system can create before it is stopped. An agent with a $5 budget but no pre-execution enforcement has unbounded exposure — every action executes before any limit is checked. Cycles bounds exposure through the [reserve-commit lifecycle](/protocol/how-reserve-commit-works-in-cycles): budget is reserved before work begins, capping the maximum possible damage. See [Exposure Estimation](/how-to/how-to-estimate-exposure-before-execution-practical-reservation-strategies-for-cycles).

### Reservation

A temporary hold placed on a budget before work begins. Reservations lock an estimated amount so that concurrent operations cannot overspend the same budget. Every reservation must eventually be [committed](#commit) or [released](#release). See [How Reserve-Commit Works](/protocol/how-reserve-commit-works-in-cycles).

### Commit

Finalizing a reservation with the actual cost once work completes successfully. The committed amount replaces the original estimate, and any difference is returned to the available budget. See [How Reserve-Commit Works](/protocol/how-reserve-commit-works-in-cycles).

### Release

Freeing a reservation's held budget when the associated work fails, is cancelled, or is no longer needed. The full reserved amount is returned to the available budget. See [How Reserve-Commit Works](/protocol/how-reserve-commit-works-in-cycles).

### Estimate

The predicted cost used when creating a reservation. Estimates determine how much budget is held and should be calibrated to cover the worst-case execution cost. See [How to Estimate Exposure Before Execution](/how-to/how-to-estimate-exposure-before-execution-practical-reservation-strategies-for-cycles).

### Actual

The real cost committed after execution completes. The actual amount may be less than, equal to, or greater than the original estimate, with the difference handled by the configured [overage policy](#overage-policy).

### Decide

A preflight budget check that evaluates whether a reservation **would** be allowed, without actually creating one. Useful for UI gating, request routing, or early rejection of requests that would exceed budget. See [How Decide Works](/protocol/how-decide-works-in-cycles-preflight-budget-checks-without-reservation).

### CyclesEvidence

A tamper-evident, content-addressed, Ed25519-signed envelope that records a budget decision (`decide` / `reserve` / `commit` / `release` / `error`) so any third party can verify *what Cycles decided* offline, without trusting or reaching the Cycles server. Responses carry an optional `cycles_evidence` reference (`evidence_id` + `cycles_evidence_url`); the signed envelope is fetched at `GET /v1/evidence/{id}`. See [CyclesEvidence: Verifiable Audit](/concepts/cycles-evidence-verifiable-audit-for-agent-decisions) and the [envelope reference](/protocol/cycles-evidence-envelopes-in-cycles).

### evidence_id

The content address of a [CyclesEvidence](#cyclesevidence) envelope — the lowercase SHA-256 (64 hex) of its RFC 8785 (JCS) canonical bytes with `evidence_id` and `signature` emptied. Computed synchronously by Cycles and returned on the response, so the id *is* the integrity check: alter the envelope and the id no longer matches.

## Budget & Scope

### Scope

A hierarchical path that identifies a specific budget boundary. Scopes are built from [subject](#subject) fields and take the form `tenant:acme/workspace:prod/agent:summarizer`. Budgets are enforced at every level of the scope hierarchy. See [Understanding Tenants, Scopes, and Budgets](/how-to/understanding-tenants-scopes-and-budgets-in-cycles) and [How Scope Derivation Works](/protocol/how-scope-derivation-works-in-cycles).

### Subject

The set of entity fields — `tenant`, `workspace`, `app`, `workflow`, `agent`, and `toolset` — that identify **who** is spending. Subjects are sent with every protocol request and used to derive the scope path.

### Scope Derivation

The process by which Cycles builds hierarchical scope paths from the subject fields on a request. Each field maps to a level in the scope tree, enabling budget enforcement at any granularity from tenant-wide down to a single toolset. See [How Scope Derivation Works](/protocol/how-scope-derivation-works-in-cycles).

### Cap / Budget Cap

A constraint applied to execution when budget is running low but not yet exhausted. For example, a cap might reduce `max_tokens` on an LLM call so the request can still proceed at lower cost. Caps are returned as part of an `ALLOW_WITH_CAPS` decision. See [Caps and the Three-Way Decision Model](/protocol/caps-and-the-three-way-decision-model-in-cycles).

### Three-Way Decision

The three possible responses to a reservation or decide request: **ALLOW** (proceed normally), **ALLOW_WITH_CAPS** (proceed with reduced limits), or **DENY** (reject the request). This model enables graceful degradation instead of hard pass/fail. See [Caps and the Three-Way Decision Model](/protocol/caps-and-the-three-way-decision-model-in-cycles).

### Overage Policy

Configures what happens when the actual cost committed exceeds the original estimate. Three policies are available: **REJECT** (deny the commit), **ALLOW_IF_AVAILABLE** (permit if remaining budget covers the difference), and **ALLOW_WITH_OVERDRAFT** (permit even if it creates debt). The default tenant policy is **ALLOW_IF_AVAILABLE** as of v0.1.24 (was REJECT in v0.1.23 and earlier). See [Commit Overage Policies](/protocol/commit-overage-policies-in-cycles-reject-allow-if-available-and-allow-with-overdraft).

## Units

<a id="usd-microcents"></a>
### USD_MICROCENTS

One hundred-millionth of a dollar (10^-8 USD). This is the default monetary unit in Cycles, chosen for integer-precision arithmetic at sub-cent granularity. See [Understanding Units](/protocol/understanding-units-in-cycles-usd-microcents-tokens-credits-and-risk-points).

### TOKENS

A raw token count unit, typically used to track LLM input and output tokens directly rather than converting to monetary cost. See [Understanding Units](/protocol/understanding-units-in-cycles-usd-microcents-tokens-credits-and-risk-points).

### CREDITS

An abstract credit unit that lets teams define their own internal currency. Useful when monetary cost is not the right abstraction for a given budget. See [Understanding Units](/protocol/understanding-units-in-cycles-usd-microcents-tokens-credits-and-risk-points).

<a id="risk-points"></a>
### RISK_POINTS

An abstract risk-scoring unit for budgeting non-monetary concerns such as safety risk, compliance exposure, or action severity. See [Understanding Units](/protocol/understanding-units-in-cycles-usd-microcents-tokens-credits-and-risk-points).

## Lifecycle

### TTL (Time To Live)

The duration an active reservation remains valid before it auto-expires. If a reservation is neither committed nor released within its TTL (plus any [grace period](#grace-period)), the held budget is automatically reclaimed. See [Reservation TTL, Grace Period, and Extend](/protocol/reservation-ttl-grace-period-and-extend-in-cycles).

### Grace Period

An additional window of time after a reservation's TTL expires before the held budget is fully reclaimed. The grace period provides a safety buffer for in-flight operations that slightly exceed their TTL. See [Reservation TTL, Grace Period, and Extend](/protocol/reservation-ttl-grace-period-and-extend-in-cycles).

### Extend

Prolonging an active reservation's TTL before it expires. This is used when work is taking longer than originally anticipated and the reservation should remain active. See [Reservation TTL, Grace Period, and Extend](/protocol/reservation-ttl-grace-period-and-extend-in-cycles).

### Heartbeat

An automatic TTL extension sent periodically by SDK clients to keep a reservation alive during long-running work. Heartbeats remove the need for callers to manually track and extend reservation lifetimes.

## Operations

### Shadow Mode / Dry Run

Evaluating budget policies and computing the decision result **without** persisting the reservation or affecting budget balances. Shadow mode is used during rollout to validate enforcement logic before turning it on in production. See [Dry-Run / Shadow Mode Evaluation](/protocol/dry-run-shadow-mode-evaluation-in-cycles) and [Shadow Mode How-To](/how-to/shadow-mode-in-cycles-how-to-roll-out-budget-enforcement-without-breaking-production).

### Idempotency Key

A unique client-supplied key that ensures a protocol operation is processed exactly once, even if the request is retried due to network failures or timeouts. Each endpoint type has its own idempotency scope. See [Idempotency, Retries, and Concurrency](/concepts/idempotency-retries-and-concurrency-why-cycles-is-built-for-real-failure-modes).

### Debt / Overdraft

A negative budget balance that occurs when the actual cost committed exceeds the available budget. Debt is only permitted when the [overage policy](#overage-policy) is set to `ALLOW_WITH_OVERDRAFT`. See [Debt, Overdraft, and the Over-Limit Model](/protocol/debt-overdraft-and-the-over-limit-model-in-cycles).

### Event / Direct Debit

Recording spend against a budget **without** a prior reservation. Events are used for costs that are known after the fact or that bypass the reserve-commit lifecycle entirely. See [How Events Work](/protocol/how-events-work-in-cycles-direct-debit-without-reservation).

### Balance

The current state of a budget, including fields such as `allocated`, `spent`, `reserved`, `remaining`, and `debt`. Balances are computed across the full scope hierarchy and reflect all committed, reserved, and event-based spend. See [Querying Balances](/protocol/querying-balances-in-cycles-understanding-budget-state).

## Patterns & Architecture

### Budget Envelope

A fixed upper bound on how much an entity (tenant, workflow, run) is allowed to consume. Budget envelopes are enforced hierarchically — a run's envelope cannot exceed its parent workflow's remaining budget, which in turn cannot exceed the tenant's allocation.

### Graceful Degradation

A response strategy where the system reduces quality or capability instead of failing outright when budget is constrained. For example, switching from a large model to a smaller one, reducing `max_tokens`, or disabling optional tool calls. Enabled by the [three-way decision](#three-way-decision) model.

### Fan-Out

A pattern where a single workflow or agent spawns multiple concurrent sub-tasks, each consuming budget independently. Fan-out is a common source of budget overruns because the aggregate cost grows multiplicatively. Cycles handles this through [hierarchical scopes](#scope) and concurrent [reservations](#reservation).

### Tool Loop

A failure mode where an AI agent repeatedly calls the same tool in a loop, often due to ambiguous results or hallucinated tool arguments. Without budget authority, tool loops can run indefinitely and accumulate significant cost. See [Runaway Agents and Tool Loops](/incidents/runaway-agents-tool-loops-and-budget-overruns-the-incidents-cycles-is-designed-to-prevent).

### Retry Storm

A cascade of retries triggered by transient failures, where each retry spawns additional retries across services. Without idempotency and budget controls, retry storms can amplify cost by orders of magnitude. See [Retry Storms](/incidents/retry-storms-and-idempotency-failures).

### Tenant

The top-level organizational isolation boundary in Cycles. Every budget, API key, and reservation is scoped to exactly one tenant. Tenants are created and managed through the [Admin Server](#admin-server) using the Admin API. See [Tenant Creation and Management](/how-to/tenant-creation-and-management-in-cycles).

### Tenant Isolation

A budget pattern where each tenant receives an independent budget allocation that cannot be consumed by other tenants. Tenant isolation prevents the "noisy neighbor" problem where one tenant's runaway agent exhausts shared resources. See [Tenant Creation and Management](/how-to/tenant-creation-and-management-in-cycles).

### Cost Estimation

The process of predicting the cost of an AI operation before execution. Accurate estimates improve reservation precision and reduce budget waste from over-reserving. See [Cost Estimation Cheat Sheet](/how-to/cost-estimation-cheat-sheet).

## Infrastructure

### Cycles Server

The HTTP service that implements the [Cycles Protocol](#cycles-protocol) and processes all budget authority requests — reserve, commit, release, decide, extend, events, and balances. See the [API Reference](/protocol/api-reference-for-the-cycles-protocol).

### Admin Server

The management API used to configure tenants, API keys, budgets, and policies. The Admin Server is separate from the Cycles Server and is not part of the protocol's hot path. See [Tenant Creation and Management](/how-to/tenant-creation-and-management-in-cycles) and [Authentication, Tenancy, and API Keys](/protocol/authentication-tenancy-and-api-keys-in-cycles).

### MCP Server

A [Model Context Protocol](https://modelcontextprotocol.io) server that exposes Cycles budget authority as MCP tools. MCP-compatible AI hosts (Claude Desktop, Claude Code, Cursor, Windsurf) discover and call these tools automatically, giving agents budget awareness without SDK integration in the agent's own code. See [Getting Started with the MCP Server](/quickstart/getting-started-with-the-mcp-server).

### Cycles Protocol

The open specification defining the budget authority API. The protocol covers the complete reservation lifecycle, balance queries, event recording, and decision evaluation. See the [API Reference](/protocol/api-reference-for-the-cycles-protocol).

## AI & Agent Terminology

### Autonomous Agent

A software system that takes actions on behalf of a user with minimal human oversight. Autonomous agents typically make multiple LLM calls, use tools, and can run for extended periods. Without budget authority, agents may consume resources indefinitely.

### Model Context Protocol (MCP)

An open protocol that allows AI hosts (Claude Desktop, Claude Code, Cursor, Windsurf) to discover and call external tools. Cycles provides an [MCP server](/quickstart/getting-started-with-the-mcp-server) that exposes budget authority as MCP tools, giving agents budget awareness without SDK integration.

### Token

The fundamental unit of text processing in large language models. Input and output tokens have different costs. Cycles can track budget in [tokens, dollars, credits, or risk points](/protocol/understanding-units-in-cycles-usd-microcents-tokens-credits-and-risk-points).

### Agentic Loop

The iterative cycle where an AI agent reasons, acts, observes results, and decides on the next action. Each iteration may involve one or more LLM calls and tool invocations, making the total cost of an agentic loop inherently unpredictable without budget controls.

### Guardrail

A constraint placed on an AI system to prevent undesirable outcomes. Budget authority is a financial guardrail — it prevents agents from consuming more resources than allocated, complementing safety and content guardrails.

### Webhook

An HTTP POST callback triggered by a state change event. Cycles delivers webhooks to subscriber-configured URLs with HMAC-SHA256 signatures for payload verification. Delivery is at-least-once with exponential backoff retry. See [Webhooks and Events](/concepts/webhooks-and-events).

### Event (Webhook)

An immutable record of a state change (e.g., `budget.exhausted`, `reservation.denied`). The v0.1.25 Admin API `EventType` enum registers 47 event types across 7 categories (budget: 16, reservation: 5, tenant: 6, api_key: 6, policy: 3, webhook: 6, system: 5). The `webhook` category covers six lifecycle events (`webhook.created` / `.updated` / `.paused` / `.resumed` / `.disabled` / `.deleted`) added in spec v0.1.25.33; the four `_via_tenant_cascade` event names are additive reference-server payloads emitted by the tenant-close cascade and not part of the registered enum. Events are stored in Redis with configurable TTL (default 90 days) and dispatched to matching webhook subscriptions.

### Signing Secret

A shared secret used to compute HMAC-SHA256 signatures for webhook payload verification. Generated at subscription creation, returned once, encrypted at rest using AES-256-GCM.

### HMAC-SHA256

Hash-based Message Authentication Code using SHA-256. Signs webhook payloads so receivers can verify authenticity. Sent in the `X-Cycles-Signature` header as `sha256=<hex>`.

### Webhook Subscription

Configuration defining which events to deliver and where. Includes URL, event type filter, signing secret, retry policy, and auto-disable threshold.

### Webhook Delivery

A single attempt to deliver an event to a webhook endpoint via HTTP POST. Tracked in Redis with status (PENDING, SUCCESS, RETRYING, FAILED), attempt count, response code, and timing. At-least-once — consumers should deduplicate using `event_id`.

### Events Service

The async webhook delivery service (`cycles-server-events`). Consumes from shared Redis queue via BRPOP and delivers via HTTP POST with HMAC signing. Optional — admin and runtime operate without it. As of v0.1.25.9, binds public API port `7980` and management/actuator port `9980` (was consolidated on `7980` pre-.9).

### Dashboard

The Cycles Admin Dashboard (`cycles-dashboard`) — a Vue 3 SPA that provides operator-facing UIs for tenants, budgets, API keys, webhooks, events, audit logs, reservations, and policies. Reads through `cycles-server-admin`'s REST API; performs no business logic of its own. Includes capability gating (UI affordances reflect the calling key's permissions), bulk-action lanes, the cross-surface correlation chip (v0.1.25.39+), and a `Cmd/Ctrl+K` command palette. See [Using the Cycles Dashboard](/how-to/using-the-cycles-dashboard).

### Tenant Self-Service

The set of governance endpoints exposed at `/v1/webhooks` and `/v1/events` (no `/admin` prefix) that tenants can call directly with their own `X-Cycles-API-Key` to manage their webhook subscriptions and query their event stream — without going through a platform operator. Permissions: `webhooks:read`, `webhooks:write`, `events:read` (opt-in; not part of the default tenant key permission set). Six of these endpoints are also dual-auth (admin can call them on a tenant's behalf as of v0.1.25.16). See [Managing Webhooks](/how-to/managing-webhooks#tenant-self-service).

## Correlation and Tracing

_For the full normative contract (W3C Trace Context precedence, outbound propagation, cross-plane queries), see [Correlation and Tracing in Cycles](/protocol/correlation-and-tracing-in-cycles)._

### request_id

A server-generated identifier unique to one HTTP request. Appears in every `ErrorResponse`, audit-log entry, and event that is causally downstream of that request. Used to find the side effects of a single call. See [Correlation and Tracing](/protocol/correlation-and-tracing-in-cycles).

### trace_id

A 32-hex-character W3C Trace Context-compatible identifier for a logical operation that may span many HTTP requests. Derived from inbound `traceparent` (when valid) → `X-Cycles-Trace-Id` (when valid) → server-generated. Echoed on every response as the `X-Cycles-Trace-Id` header and carried on webhook deliveries, events, audit rows, and (as of governance-admin v0.1.25.28) on `WebhookDelivery` schema fields. Introduced across the stack on 2026-04-18 (cycles-server v0.1.25.14, cycles-server-admin v0.1.25.31, cycles-server-events v0.1.25.7). Distinct from the application-level `metadata.trace_id` documented in [Standard Metrics and Metadata](/protocol/standard-metrics-and-metadata-in-cycles) (that one is operator-free-form; this one is server-managed W3C). See [Correlation and Tracing](/protocol/correlation-and-tracing-in-cycles).

### traceparent

The W3C Trace Context HTTP header (`00-<trace_id>-<span_id>-<flags>`). Cycles accepts it as the highest-precedence inbound correlation signal. On outbound webhook deliveries, Cycles emits `traceparent` with a freshly generated span-id per delivery and preserves the inbound `trace-flags` byte when available (otherwise defaults to `01`, sampled). See [Correlation and Tracing](/protocol/correlation-and-tracing-in-cycles).

### correlation_id

An opaque, operator-populated identifier that groups a family of related events (for example, every event from a scheduled batch run). Cycles does not derive or inspect it — it only carries it through on event payloads. Distinct from `trace_id` (which Cycles owns) and `request_id` (which the server generates).

## Admin Plane

### AdminKeyAuth

The authentication scheme keyed on the `X-Admin-API-Key` header. Used for platform-operator and fleet-management operations on the admin plane, and for admin-on-behalf-of operations on three runtime endpoints (listReservations, getReservation, releaseReservation) and six tenant-scoped governance webhook endpoints. See [Force-releasing stuck reservations as an operator](/how-to/force-releasing-stuck-reservations-as-an-operator).

### Admin-on-Behalf-of

An operation where a platform operator uses their admin key to act against tenant-owned resources (e.g., force-release a tenant's stuck reservation during incident response). Audit rows carry `actor_type=admin_on_behalf_of` for clear attribution. Intentionally excluded from admin auth: create/commit/extend reservations, create tenant webhook subscriptions, replay — operations where admin impersonation would distort semantics.

### Bulk Action

A single request that applies an action across many resources selected by a filter. Three bulk endpoints (tenants, webhooks, budgets) share a common envelope (`filter`, `action`, `expected_count`, `idempotency_key`) and safety rules: 500-row cap, count-mismatch preflight, 15-minute idempotency, per-row outcomes (`succeeded` / `failed` / `skipped`), one enriched audit row per invocation. See [Using Bulk Actions](/how-to/using-bulk-actions-for-tenants-and-webhooks).

### Audit Sentinels

Two reserved `tenant_id` values on audit-log entries (v0.1.25.28+): `__admin__` (admin-plane operation, not scoped to a tenant, authenticated-tier retention, never sampled) and `__unauth__` (pre-authentication failure, unauthenticated-tier retention, subject to sampling). URL-safe underscored form — no percent-encoding needed. Both are queryable with exact match. Historical `<unauthenticated>` values written pre-.28 keep their literal and age out under the unauth-tier TTL. See [Audit log failure capture](/admin-api/guide#audit-log-failure-capture-v0-1-25-20).

### TENANT_CLOSED

A `409` error code (v0.1.25.35+) returned by every mutating admin-plane operation on an object whose owning tenant is `CLOSED`. Enforced by the "Rule 2 — Terminal-Owner Mutation Guard" half of the cascade contract; GET endpoints remain available for post-mortem audit reads. See [Tenant-Close Cascade Semantics](/protocol/tenant-close-cascade-semantics) and [Error Codes — TENANT_CLOSED](/protocol/error-codes-and-error-handling-in-cycles#tenant-closed-409).

### Tenant-Close Cascade

The two-rule contract (governance-admin spec v0.1.25.29/.30/.31) that makes `* → CLOSED` tenant transitions atomic (or eventually-atomic) across owned objects. **Rule 1 — Close Cascade**: server drives owned `BudgetLedger` → `CLOSED`, `ApiKey` → `REVOKED`, open `Reservation` → `RELEASED`, `WebhookSubscription` → `DISABLED`, emitting one `*_via_tenant_cascade` event per mutated object under the originating `tenant.closed` audit entry's `correlation_id`. **Rule 2 — Terminal-Owner Mutation Guard**: mutations on a closed tenant's children return `409 TENANT_CLOSED`. Two conformant modes: **Mode A** (atomic single-transaction) or **Mode B** (flip-first with guarded cascade; runcycles uses this). See [Tenant-Close Cascade Semantics](/protocol/tenant-close-cascade-semantics).

### RESET_SPENT

A budget funding operation (v0.1.25.18+) distinct from `RESET`: sets `allocated` and clears or overrides `spent` while preserving `reserved` and `debt`. Used for billing-period rollovers where outstanding reservations and debt must survive the boundary. See [Rolling Over Billing Periods](/how-to/rolling-over-billing-periods-with-reset-spent).
