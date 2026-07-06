---
title: "MCP 2026-07-28: What Agent Operators Must Change"
date: 2026-07-28
author: Albert Mavashev
tags: [mcp, engineering, agents, migration, production, protocols, runtime-authority]
description: "The MCP 2026-07-28 spec lands July 28: stateless core, session removal, routing headers. What to change, what breaks, and what the spec still leaves open."
blog: true
sidebar: false
featured: false
head:
  - - meta
    - name: keywords
      content: "MCP 2026-07-28, MCP spec migration, MCP stateless, Mcp-Session-Id removed, MCP session removal, Mcp-Method header, MCP Tasks extension, MCP migration guide, MCP breaking changes"
---

# MCP 2026-07-28: What Agent Operators Must Change

The Model Context Protocol's 2026-07-28 specification is its largest revision since launch. The [release candidate shipped May 21](https://blog.modelcontextprotocol.io/posts/2026-07-28-release-candidate/) with a ten-week migration window for SDK maintainers — a window that ends with the final specification's scheduled release today. If you operate [MCP servers](/glossary#mcp-server) that agents call in production, some of this is action-required rather than nice-to-know.

This guide sorts the changes by what they demand from an operator — what breaks, what needs a config or code change, what's newly possible — and closes with the part the spec deliberately does not solve. Details below reflect the release candidate; where the final published specification differs, the spec is authoritative.

<!-- more -->

## The one-table version

| Change | SEP | Operator impact |
|---|---|---|
| Protocol sessions removed (`Mcp-Session-Id` gone) | SEP-2567 | **Breaking** if you rely on session state |
| `initialize`/`initialized` handshake removed; per-request `_meta` + `server/discover` | SEP-2575 | **Breaking** for handshake-dependent logic |
| SSE streams replaced by `InputRequiredResult` + `requestState` for multi-round requests | SEP-2322 | **Breaking** for server-initiated interaction flows |
| Missing-resource error code moves `-32002` → `-32602` | SEP-2164 | **Breaking** for error-matching code |
| `Mcp-Method` / `Mcp-Name` routing headers | SEP-2243 | Action: expose to your load balancer; new routing and policy surface |
| `ttlMs` / `cacheScope` on list and resource read results | SEP-2549 | Action: set honest TTLs; clients will cache |
| W3C Trace Context propagation documented in `_meta` | SEP-414 | Action: propagate `traceparent`; correlation gets standard |
| Authorization hardening (issuer validation per RFC 9207, issuer binding, application type at registration, `.well-known` discovery, among others) | SEP-2468, SEP-2352, SEP-837, SEP-2351 | Action: verify your auth server emits `iss`; review client registrations |
| First-class extensions framework | SEP-2133 | New capability; opt-in negotiation |
| Tasks extension (handles for long-running work) | SEP-2663 | New capability; migration from the 2025-11-25 experimental API |
| MCP Apps (server-shipped HTML rendered in sandboxed iframes) | SEP-1865 | New capability |
| Roots, sampling, and logging primitives deprecated (annotation-only; working through at least July 2027) | SEP-2577 | Plan replacement: tool parameters/config, direct provider APIs, stderr or OpenTelemetry |

## What actually breaks

**Sessions are gone, and state becomes your problem — explicitly.** SEP-2567 removes the `Mcp-Session-Id` header and protocol-level sessions entirely. Anything that used the session as an implicit thread — conversation continuity, per-session counters, cleanup-on-disconnect — must move to explicit handles passed between tool calls. This is the single most invasive change, and it is worth doing properly rather than emulating sessions in a lookaside table keyed by client IP. The protocol is telling you state must be named, passed, and owned.

**Multi-round interactions restructure.** Server-initiated requests now happen only while a client request is being processed (SEP-2260), and multi-round flows return `InputRequiredResult` payloads carrying `requestState` instead of holding an SSE stream open (SEP-2322). If your server asks the client questions mid-operation, that logic changes shape.

**Error matching needs a one-line audit.** Missing resources return the JSON-RPC-standard `-32602` instead of `-32002` (SEP-2164). Grep for the old code; retry and fallback logic that matches on it will misclassify failures.

**Deprecations are gentle but real.** Roots, sampling, and protocol logging continue to work through at least July 2027 under the new 12-month deprecation policy, but new work should target the replacements now.

## What the stateless core makes easier

It is worth pausing on *why* the spec went stateless: per the [2026 roadmap](https://blog.modelcontextprotocol.io/posts/2026-mcp-roadmap/), "stateful sessions fight with load balancers, horizontal scaling requires workarounds…" The fixes have a side effect operators should exploit — the protocol just became much friendlier to per-request policy enforcement:

- **`Mcp-Method` and `Mcp-Name` headers (SEP-2243)** mean an edge proxy or gateway can see *which tool an agent is about to invoke* without parsing the body. Routing was the motivation, but the same property serves pre-execution policy: a gate that treats `tools/call` on `send_email` differently from `resources/read` no longer needs deep packet inspection to do it.
- **Stateless requests** mean an external decision point can evaluate each call on its own merits — no session affinity to preserve, no state to co-locate. The [budget-gating pattern for MCP servers](/blog/how-to-add-budget-limits-to-an-mcp-server) gets structurally simpler under this model: reserve, execute, commit, with the handle pattern carrying any continuity the workload needs.
- **W3C Trace Context in `_meta` (SEP-414)** standardizes what was previously bolted on: one trace ID from the agent through the MCP server to every downstream decision. If you already correlate enforcement decisions with [trace context](/blog/w3c-trace-context-ai-agent-debugging), MCP traffic now joins that graph natively.
- **Tasks (SEP-2663)** give long-running work a first-class handle with a stateless lifecycle — which is also the right attachment point for budget [reservations](/glossary#reservation) that must outlive a single request. Note the roadmap's own caveat: retry semantics and result-retention expiry are still open questions, so don't encode assumptions about either.

## A migration order that works

1. **Audit for `Mcp-Session-Id` and handshake dependencies** — this sizes the real work. Everything else is small by comparison.
2. **Fix error-code matching** (`-32002` → `-32602`). One grep, low risk.
3. **Update SDKs** once your language's implementation ships the final spec — Tier 1 SDKs were expected to land support within the RC window.
4. **Expose the routing headers to your infrastructure** and decide what your edge should do with per-method visibility — at minimum, better routing; at best, per-tool policy.
5. **Set `ttlMs` honestly** on list results. Clients will cache what you tell them to; stale tool lists are a new failure mode.
6. **Verify authorization details**: your auth server sends `iss` (clients must validate it), client registrations declare application type, discovery endpoints use the standardized `.well-known` suffix.
7. **Plan the deprecation replacements** for roots, sampling, and logging on your own schedule — you have until at least mid-2027, but new surfaces shouldn't accrue on deprecated primitives.

## What the spec deliberately leaves open

The MCP maintainers are explicit about this, and it is the most operator-relevant paragraph in the [roadmap](https://blog.modelcontextprotocol.io/posts/2026-mcp-roadmap/): enterprise needs like "audit trails, SSO-integrated auth, gateway behavior, and config portability" are named as priorities but left undefined — deliberately, with the expectation that "most of the enterprise readiness work" will "land as extensions rather than core spec changes."

Read that as a scoping decision, not a gap in diligence. MCP standardizes how agents and tools *connect*. It does not — and by its own roadmap will not soon — standardize whether a given call should be *allowed*: whose budget it draws from, what its blast radius is, what evidence of the decision survives. Connectivity and authority are different layers, the same distinction that applies to [MCP gateways](/blog/mcp-gateways-are-not-runtime-authority): a gateway can secure the pipe, but something still has to decide about the water.

The practical upshot for operators is that the 2026-07-28 spec makes the [runtime authority](/glossary#runtime-authority) layer *easier to attach* — per-method visibility at the edge, stateless per-request decisions, standard trace propagation, task handles for reservations — while making clear it will not provide one. If your agents' MCP calls have side effects, [gating them before execution](/blog/mcp-tool-budgets-before-execution) remains your job, with better protocol hooks than before.

Migrate the breaking changes first. Then use the new hooks for the thing the spec correctly declines to do for you.

## Sources

1. [MCP blog — the 2026-07-28 release candidate](https://blog.modelcontextprotocol.io/posts/2026-07-28-release-candidate/) — May 21, 2026; all SEP references above
2. [MCP blog — the 2026 roadmap](https://blog.modelcontextprotocol.io/posts/2026-mcp-roadmap/) — enterprise-readiness scoping and open gaps
3. [Model Context Protocol specification](https://modelcontextprotocol.io/specification/) — authoritative once the final version is published

## Further Reading

- [How to Add Budget Limits to an MCP Server](/blog/how-to-add-budget-limits-to-an-mcp-server) — the reserve/commit wrapper pattern
- [Add Hard Budgets to MCP Tools Before They Execute](/blog/mcp-tool-budgets-before-execution) — pre-execution gating for tool calls
- [MCP Gateways Are Not Runtime Authority](/blog/mcp-gateways-are-not-runtime-authority) — connectivity vs. authority
- [W3C Trace Context for AI Agent Debugging](/blog/w3c-trace-context-ai-agent-debugging) — correlating decisions across planes
- [Getting Started with the MCP Server](/quickstart/getting-started-with-the-mcp-server) — [budget authority](/glossary#budget-authority) for MCP hosts
- [MCP Tool Poisoning: 84% Success Rate](/blog/mcp-tool-poisoning-why-agent-frameworks-cant-prevent-it) — why tool trust needs an enforcement layer
