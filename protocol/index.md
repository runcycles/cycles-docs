---
title: "Cycles Protocol"
description: "Open specification for runtime budget authority over AI agents — reserve-commit semantics, hierarchical scopes, three-way decisions, and conformance criteria."
---

# Cycles Protocol

The Cycles Protocol is an open specification for **runtime budget authority over AI agents**.

> **Authorization grants access; authority meters and bounds the action.**

The protocol defines how budgets are reserved before execution, committed after, and reconciled across hierarchical scopes — atomically, with three-way decisions and observable events. Cycles is the reference implementation; anyone can implement a conformant server.

## At a glance

- **Open specification** — Apache 2.0, multiple OpenAPI YAMLs in [`runcycles/cycles-protocol`](https://github.com/runcycles/cycles-protocol).
- **Explicit conformance criteria** — current MUST / SHOULD / MAY breakdown lives in [`CONFORMANCE.md`](https://github.com/runcycles/cycles-protocol/blob/main/CONFORMANCE.md). Start there for the authoritative surface against the current conformance target.
- **Reserve-commit lifecycle** — atomic budget locking before action, commit on completion, release on cancel, with TTL heartbeat for long-running operations.
- **Hierarchical scopes** — tenant → workspace → workflow → run, evaluated atomically in one operation.
- **Three-way decisions** — `ALLOW` / `ALLOW_WITH_CAPS` / `DENY`. Implementations return constraints (`maxTokens`, `toolDenylist`, `maxStepsRemaining`) that let the agent self-regulate, not just stop.
- **Concurrency-safe enforcement** — shared budgets MUST NOT be oversubscribed under concurrent reserve calls.
- **Idempotent commit and release** — retries are safe; the same action MUST NOT settle twice.
- **Explicit error semantics** — `BUDGET_EXCEEDED` (409), `IDEMPOTENCY_MISMATCH` (409), `RESERVATION_EXPIRED` (410), `UNIT_MISMATCH` (400), and the rest defined in the spec.
- **Multiple language clients** — Python, TypeScript, Rust, Spring Boot, MCP host.

## Specification

The full specification lives in the [`runcycles/cycles-protocol`](https://github.com/runcycles/cycles-protocol) repository. Key files:

| File | Purpose |
|---|---|
| [`cycles-protocol-v0.yaml`](https://github.com/runcycles/cycles-protocol/blob/main/cycles-protocol-v0.yaml) | Runtime base — reserve / commit / release / decide / balances / events |
| [`cycles-governance-admin-v0.1.25.yaml`](https://github.com/runcycles/cycles-protocol/blob/main/cycles-governance-admin-v0.1.25.yaml) | Cross-plane events, webhooks, balances, auth introspection (mixed conformance) |
| [`cycles-action-kinds-v0.1.26.yaml`](https://github.com/runcycles/cycles-protocol/blob/main/cycles-action-kinds-v0.1.26.yaml) | Action-kind registry + quota primitives (upcoming, SHOULD today) |
| [`cycles-protocol-extensions-v0.1.26.yaml`](https://github.com/runcycles/cycles-protocol/blob/main/cycles-protocol-extensions-v0.1.26.yaml) | DenyDetail, ObserveMode, v0.1.26 evaluation order (upcoming) |
| [`cycles-governance-extensions-v0.1.26.yaml`](https://github.com/runcycles/cycles-protocol/blob/main/cycles-governance-extensions-v0.1.26.yaml) | Action-quota / access-control policy fields (upcoming) |
| [`cycles-spec-index.yaml`](https://github.com/runcycles/cycles-protocol/blob/main/cycles-spec-index.yaml) | Index of all spec files with conformance metadata |
| [`CHANGELOG.md`](https://github.com/runcycles/cycles-protocol/blob/main/CHANGELOG.md) | Versioned change history |

## Conformance

The authoritative statement of what an implementation MUST, SHOULD, and MAY do is [`CONFORMANCE.md`](https://github.com/runcycles/cycles-protocol/blob/main/CONFORMANCE.md) in the spec repo. Read it first — the current conformance target, exact required-operation list, and any version-bumped requirements all live there. At a glance, the surface includes:

- **Core runtime operations** — reserve / commit / release / extend (atomic budget locking and lifecycle)
- **Cross-plane operations** — event listing, webhook delivery / replay, balance queries, auth introspection
- **Recommended operations** — `decide`, `listReservations`, `getReservation`, `createEvent`
- **4 core invariants** — atomic reservation across scopes, concurrency-safe enforcement, idempotent commit/release, unit consistency
- **Exact HTTP status + error code pairs** — implementations MUST return the spec's error codes verbatim so clients can route on them
- **`X-Cycles-API-Key` header** for authentication; key provisioning and scoping is implementation-specific

Reading the conformance doc is the prerequisite for any new implementation. RFC 2119 language throughout.

## Reference implementation

[`runcycles/cycles-server`](https://github.com/runcycles/cycles-server) is the reference implementation — Java / Spring Boot, Apache 2.0, validated against the current conformance target. The companion [`runcycles/cycles-server-admin`](https://github.com/runcycles/cycles-server-admin) provides the management plane (tenant / budget / policy / key CRUD).

Client SDKs that speak the protocol:

- **Python** — [`runcycles` PyPI package](/quickstart/getting-started-with-the-python-client)
- **TypeScript** — [`runcycles` npm package](/quickstart/getting-started-with-the-typescript-client)
- **Spring Boot** — [`cycles-spring-boot-starter`](/quickstart/getting-started-with-the-cycles-spring-boot-starter)
- **Rust** — [Rust client](/quickstart/getting-started-with-the-rust-client)
- **MCP host** — [MCP server](/quickstart/getting-started-with-the-mcp-server) for Claude / Cursor / Windsurf

All clients communicate over the same wire protocol. A conformant alternative server can replace the reference implementation transparently.

## Implement the Cycles Protocol

If you're building a framework, an in-house budget system, or an alternative server that should speak the same wire format as Cycles, see **[Implement the Cycles Protocol](/protocol/implement)** for the minimum implementation surface and conformance walkthrough.

## Protocol reference

The reference pages in the sidebar walk through every primitive in the protocol — reserve-commit lifecycle, scope derivation, units, caps and three-way decisions, overage policies, TTL and grace, decide preflight, dry-run / shadow mode, events and direct debit, debt and overdraft, balance queries, reservation recovery, metrics and metadata, error codes, webhook event delivery, event payload schemas, scope filter syntax, correlation and tracing, tenant-close cascade semantics.

Start with [API Reference](/protocol/api-reference-for-the-cycles-protocol) for the operation surface, or [How Reserve / Commit Works](/protocol/how-reserve-commit-works-in-cycles) for the lifecycle that everything else builds on.

## Why a protocol, not just a tool

OpenTelemetry didn't win observability by being a tool — it won by being a protocol that every observability vendor implemented. For runtime budget authority on AI agents, the same dynamic applies: the team that owns the protocol owns the category. Cycles ships the spec, the conformance criteria, and the reference implementation in the open. Anyone can implement; everyone speaks the same wire format.

## Related

- [Runtime Authority vs Runtime Authorization](/concepts/runtime-authority-vs-runtime-authorization) — how the protocol fits alongside identity-based agent governance (AWS Bedrock AgentCore Policy, Akeyless)
- [Comparisons](/concepts/comparisons) — how Cycles differs from LiteLLM, Helicone, LangSmith, rate limiters, provider caps, DIY wrappers
- [What Is Runtime Authority for AI Agents](/blog/what-is-runtime-authority-for-ai-agents) — the canonical definition
- [What is Cycles?](/quickstart/what-is-cycles) — 5-minute overview of the reference implementation
