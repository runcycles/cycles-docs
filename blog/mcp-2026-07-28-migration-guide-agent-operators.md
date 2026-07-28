---
title: "MCP 2026-07-28: What Agent Operators Must Change"
date: 2026-07-28
author: Albert Mavashev
tags: [MCP, engineering, agents, migration, production, protocols, runtime-authority]
description: "The MCP 2026-07-28 release candidate removes sessions and adds routing headers. What operators should prepare before the final specification is published."
blog: true
sidebar: false
featured: false
head:
  - - meta
    - name: keywords
      content: "MCP 2026-07-28, MCP spec migration, MCP stateless, Mcp-Session-Id removed, MCP session removal, Mcp-Method header, MCP Tasks extension, MCP migration guide, MCP breaking changes"
---

# MCP 2026-07-28: What Agent Operators Must Change

MCP's maintainers describe the planned 2026-07-28 specification as the Model Context Protocol's largest revision since launch. The [release candidate shipped May 21](https://blog.modelcontextprotocol.io/posts/2026-07-28-release-candidate/) with a ten-week migration window for SDK maintainers; the final specification is scheduled for July 28. If you operate [MCP servers](/glossary#mcp-server) that agents call in production, some of this is action-required rather than nice-to-know.

This guide sorts the changes by what they demand from an operator — what breaks, what needs a config or code change, what's newly possible — and closes with the part the spec deliberately does not solve. Details below reflect the release candidate; where the final published specification differs, the spec is authoritative.

<!-- more -->

## The one-table version

| Change | SEP | Operator impact |
|---|---|---|
| Protocol sessions removed (`Mcp-Session-Id` gone) | SEP-2567 | **Breaking** if you rely on session state |
| `initialize` / `notifications/initialized` handshake removed; per-request `_meta` + `server/discover` | SEP-2575 | **Breaking** for handshake-dependent logic |
| SSE streams replaced by `InputRequiredResult` + `requestState` for multi-round requests; server-initiated requests scoped to active client requests | SEP-2322, SEP-2260 | **Breaking** for server-initiated interaction flows |
| Every HTTP POST requires `MCP-Protocol-Version`, consistent with `_meta` | SEP-2575 | **Breaking** for clients, servers, and intermediaries that omit or do not validate it |
| HTTP GET and resource subscribe/unsubscribe methods replaced by `subscriptions/listen` | SEP-2567 | **Breaking** for stream and resource-subscription clients |
| `ping`, `logging/setLevel`, and `notifications/roots/list_changed` removed | SEP-2575, SEP-2577 | **Breaking** for clients or servers that call or handle them |
| All result objects require `resultType`; SSE resume and `Last-Event-ID` redelivery removed | SEP-2575 | **Breaking** for result dispatch and resumable-stream logic |
| Missing-resource error code moves `-32002` → `-32602` | SEP-2164 | **Breaking** for error-matching code |
| `Mcp-Method` / `Mcp-Name` routing headers | SEP-2243 | **Breaking** for HTTP clients that omit them; body-processing components must reject mismatches |
| `ttlMs` / `cacheScope` on list and resource read results | SEP-2549 | Action: set honest TTLs; compliant clients may cache |
| W3C Trace Context propagation documented in `_meta` | SEP-414 | Action: propagate `traceparent`; correlation gets standard |
| Authorization hardening (issuer validation per RFC 9207, issuer binding, application type at registration, `.well-known` discovery, among others) | SEP-2468, SEP-2352, SEP-837, SEP-2351 | Action: validate `iss` when present, begin emitting it, and review client registrations |
| Full JSON Schema 2020-12 for tool input and output schemas | SEP-2106 | Action: audit validators, `$ref` handling, schema-depth limits, and object-only output assumptions |
| First-class extensions framework | SEP-2133 | New capability; opt-in negotiation |
| Tasks extension (handles for long-running work) | SEP-2663 | Migrate from the experimental API: remove `tasks/result`, `tasks/list`, and per-request opt-in; add `tasks/update` |
| MCP Apps (server-shipped HTML rendered in sandboxed iframes) | SEP-1865 | New capability |
| URL-mode elicitation completion notification and `elicitationId` removed | SEP-2322 | **Breaking** for URL-mode elicitation flows |
| Roots, sampling, and logging features deprecated (working through at least July 2027) | SEP-2577 | Plan replacements while accounting for the wire methods removed above |

## What actually breaks

**Sessions are gone, and state becomes your problem — explicitly.** SEP-2567 removes the `Mcp-Session-Id` header and protocol-level sessions entirely. Anything that used the session as an implicit thread — conversation continuity, per-session counters, cleanup-on-disconnect — must move to explicit handles passed between tool calls. For session-dependent deployments, this is likely the most invasive change, and it is worth doing properly rather than emulating sessions in a lookaside table keyed by client IP. The protocol is telling you state must be named, passed, and owned.

**Multi-round interactions restructure.** Server-initiated requests now happen only while a client request is being processed (SEP-2260), and multi-round flows return `InputRequiredResult` payloads carrying `requestState` instead of holding an SSE stream open (SEP-2322). If your server asks the client questions mid-operation, that logic changes shape.

**Transport and result contracts change.** HTTP POST clients must send `MCP-Protocol-Version`, and servers must check that it matches the request's `_meta`. Every result now carries `resultType`. HTTP GET is no longer part of Streamable HTTP, `Last-Event-ID` resumption and SSE redelivery are gone, and resource subscription moves to `subscriptions/listen`.

**Several utility and extension methods disappear.** Audit calls and handlers for `ping`, `logging/setLevel`, `notifications/roots/list_changed`, `tasks/result`, `tasks/list`, and URL-mode `notifications/elicitation/complete`. Tasks now use `tasks/update`; the previous per-request task opt-in and URL-mode `elicitationId` are removed.

**Error matching needs a one-line audit.** Missing resources return the JSON-RPC-standard `-32602` instead of `-32002` (SEP-2164). Grep for the old code; retry and fallback logic that matches on it will misclassify failures.

**Deprecations are gentle, but some related wire surfaces are already removed.** Roots, sampling, and protocol logging remain available during the deprecation window, while `notifications/roots/list_changed` and `logging/setLevel` are removed in this revision. New work should target the replacements now.

## What the stateless core makes easier

It is worth pausing on *why* the spec went stateless: per the [2026 roadmap](https://blog.modelcontextprotocol.io/posts/2026-mcp-roadmap/), "stateful sessions fight with load balancers, horizontal scaling requires workarounds…" The fixes have a side effect operators should exploit — the protocol just became much friendlier to per-request policy enforcement:

- **`Mcp-Method` and `Mcp-Name` headers (SEP-2243)** let an edge proxy or gateway classify a request without parsing the body. HTTP clients must emit `Mcp-Method`; they must also emit `Mcp-Name` for `tools/call`, `resources/read`, and `prompts/get`. Every component that processes the body must validate the headers against it and reject a mismatch with `HeaderMismatch` (`-32020`). Intermediaries must also preserve and decode the specified Base64 sentinel form. Only after those checks should routing or policy classification use the headers; client-supplied headers alone are not an authorization signal.
- **Stateless requests** let an external decision point evaluate each request without MCP session affinity while retaining its own cumulative ledger keyed to explicit subjects or handles. The [budget-gating pattern for MCP servers](/blog/how-to-add-budget-limits-to-an-mcp-server) gets structurally simpler under this model: reserve, execute, commit, with the handle pattern carrying any continuity the workload needs.
- **W3C Trace Context in `_meta` (SEP-414)** gives implementations a standard correlation mechanism. If hosts, SDKs, and servers propagate the documented fields, MCP traffic can join the same [trace context](/blog/w3c-trace-context-ai-agent-debugging) as downstream policy and budget decisions.
- **Tasks (SEP-2663)** give long-running work a first-class handle with a stateless lifecycle. For budget systems, a task handle can serve as an application-defined correlation key for [reservations](/glossary#reservation) that outlive one request; MCP does not create or settle those reservations. Transient-failure retry semantics remain unspecified. Retention and expiry are signaled per task with `ttlMs`, which the server may update.

## A migration order that works

1. **Audit for `Mcp-Session-Id`, handshake dependencies, HTTP GET, SSE resume, and resource subscriptions.** These changes size the real transport work.
2. **Update request and result handling.** Emit and validate `MCP-Protocol-Version`, `Mcp-Method`, and conditional `Mcp-Name`; enforce header/body agreement; dispatch on required `resultType`; then fix missing-resource matching (`-32002` → `-32602`).
3. **Audit removed methods and notifications.** Cover `ping`, `logging/setLevel`, `notifications/roots/list_changed`, old Tasks methods and opt-in, and URL-mode elicitation completion.
4. **Audit tool-schema handling** against JSON Schema 2020-12, including composition, references, depth limits, and non-object structured output.
5. **Migrate Tasks integrations** to `tasks/update` and the current `ttlMs` lifecycle.
6. **Update SDKs** once your language's implementation ships the final spec — Tier 1 SDKs were expected to land support within the RC window.
7. **Set `ttlMs` and `cacheScope` honestly** on `tools/list`, `prompts/list`, `resources/list`, `resources/templates/list`, and `resources/read`. Compliant clients may cache what you tell them to; stale tools, prompts, and resources become new failure modes.
8. **Verify authorization details**: validate `iss` when present; have authorization servers begin emitting it because a future version is expected to reject omissions; prefer Client ID Metadata Documents; when retaining legacy Dynamic Client Registration, declare application type; and use the standardized `.well-known` discovery suffix.
9. **Plan the deprecation replacements** for roots, sampling, logging, and legacy Dynamic Client Registration on your own schedule — but do not confuse the deprecation window with the methods removed in this revision.

## What the spec deliberately leaves open

The MCP maintainers are explicit about this, and it is the most operator-relevant paragraph in the [roadmap](https://blog.modelcontextprotocol.io/posts/2026-mcp-roadmap/): enterprise needs like "audit trails, SSO-integrated auth, gateway behavior, and configuration portability" are named as priorities but left undefined — deliberately, with the expectation that "most of the enterprise readiness work" will "land as extensions rather than core spec changes."

Read that as a scoping decision, not a gap in diligence. MCP standardizes how agents and tools *connect*, while MCP authorization, host policy, consent, and application validation remain important access controls. The core protocol does not currently define cumulative application-specific budgets, caller-assigned [exposure](/glossary#exposure) accounting, or retained evidence for those budget decisions. Those controls are a separate layer from connectivity, the same distinction discussed in [MCP Gateways Are Not Runtime Authority](/blog/mcp-gateways-are-not-runtime-authority).

The practical upshot for operators is that the 2026-07-28 changes can make a separate [runtime authority](/glossary#runtime-authority) layer easier to integrate: per-method visibility at the edge, requests without MCP session affinity, standard trace propagation, and task handles that applications can correlate with reservations. If your agents' MCP calls have side effects, combine [pre-execution budget checks](/blog/mcp-tool-budgets-before-execution) with MCP authorization and application-level validation.

Migrate the breaking changes first. Then decide which of the new hooks belong in your routing, observability, authorization, and budget-control designs.

## Sources

1. [MCP blog — the 2026-07-28 release candidate](https://blog.modelcontextprotocol.io/posts/2026-07-28-release-candidate/) — May 21, 2026; all SEP references above
2. [MCP blog — the 2026 roadmap](https://blog.modelcontextprotocol.io/posts/2026-mcp-roadmap/) — enterprise-readiness scoping and open gaps
3. [Model Context Protocol draft specification and changelog](https://modelcontextprotocol.io/specification/draft/changelog) — authoritative release-candidate change list; replace with the versioned final specification after publication

## Further Reading

- [How to Add Budget Limits to an MCP Server](/blog/how-to-add-budget-limits-to-an-mcp-server) — the reserve-commit wrapper pattern
- [Add Hard Budgets to MCP Tools Before They Execute](/blog/mcp-tool-budgets-before-execution) — pre-execution gating for tool calls
- [MCP Gateways Are Not Runtime Authority](/blog/mcp-gateways-are-not-runtime-authority) — connectivity vs. authority
- [W3C Trace Context for AI Agent Debugging](/blog/w3c-trace-context-ai-agent-debugging) — correlating decisions across planes
- [Getting Started with the MCP Server](/quickstart/getting-started-with-the-mcp-server) — [budget authority](/glossary#budget-authority) for MCP hosts
- [MCP Tool Poisoning: 84% Success Rate](/blog/mcp-tool-poisoning-why-agent-frameworks-cant-prevent-it) — why tool trust needs an enforcement layer
