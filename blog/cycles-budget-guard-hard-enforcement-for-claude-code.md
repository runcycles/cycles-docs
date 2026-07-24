---
title: "Announcing Cycles Budget Guard for Claude Code"
date: 2026-07-22
author: Albert Mavashev
tags: [announcement, claude-code, budgets, budget-enforcement, runtime-authority, MCP, security]
description: "Cycles Budget Guard for Claude Code adds dispatch-path enforcement, blocks denied gated tools before they run, and safely retries recorded-call settlement."
blog: true
sidebar: false
featured: false
head:
  - - meta
    - name: keywords
      content: "Claude Code budget enforcement, Cycles Budget Guard, Claude Code hooks, AI agent budgets, runtime authority, MCP budget tools"
---

# Announcing Cycles Budget Guard for Claude Code

A prompt injection or hallucinated argument turns a routine Claude Code task into a request for an operation its budget should forbid. The control question is concrete: what stops the tool before execution?

On the [Cycles server](/glossary#cycles-server), a [reservation](/glossary#reservation) cannot grant authority beyond policy, and a reservation hold is not spent until commit. Inside an agent's [tool loop](/glossary#tool-loop), however, honoring a `DENY` through the [Cycles MCP Server](/how-to/integrating-cycles-with-mcp) is cooperative: MCP exposes budget tools but does not require the model to call them before another tool. The server's [security model](https://github.com/runcycles/cycles-mcp-server#security-model--enforcement-boundary) documents that boundary and the need for a check in the tool dispatch path.

**[Cycles Budget Guard for Claude Code](https://github.com/runcycles/cycles-claude-plugin)** implements that dispatch-path control:

```
/plugin marketplace add runcycles/cycles-claude-plugin
/plugin install cycles-budget-guard@runcycles
```

<!-- more -->

## Claude Code budget enforcement in the dispatch path

- **`PreToolUse` reserves before every gated tool call.** A Cycles `DENY` — or an exhausted, frozen, or closed budget, a debt block, an auth failure, or any response the plugin cannot interpret — blocks the call at the harness layer, with a reason the model sees. The hook runner, rather than a prompt instruction, enforces that decision.
- **Tool-list caps are enforced at the gate.** `ALLOW_WITH_CAPS` tool allowlists and denylists block violating calls, with [allowlist precedence defined by the protocol](/protocol/caps-and-the-three-way-decision-model-in-cycles). Token, step, and cooldown caps are added to model context as guidance; the hook does not mechanically enforce those three caps.
- **Reserved calls have explicit settlement paths.** A successful call with a durable outcome record enters commit recovery; for a call Claude Code reports through `PostToolUseFailure`, the hook attempts to release its hold and retains failed releases for retry. If the reservation expired, was finalized, or is missing, the hook submits an idempotent usage event. During an outage, the default fail-open mode allows an unmetered call because no reservation exists; set `CYCLES_CC_FAIL_CLOSED=true` to block that path.
- **Low-budget guidance supports adaptation.** When balances returned after a successful commit show less than 15% remaining, the plugin adds a warning to model context. The warning can guide the model toward cheaper work, but the dispatch hook remains the enforcement mechanism.
- **A pinned companion Cycles [MCP Server](/glossary#mcp-server) is configured with the plugin**, so the model can check balances and make explicit reserves for costly operations. It is fetched through `npx` on first use rather than vendored in the plugin. `/cycles-budget-guard:budget` gives a one-command status report.

## Enforcement design and recovery boundaries

The plugin sits in the dispatch path of every gated tool call. Its [current audit log](https://github.com/runcycles/cycles-claude-plugin/blob/main/AUDIT.md) records the enforcement reviews and operational hardening included through v0.2.0. The resulting boundaries are explicit:

**Integrity failures are not availability failures.** An unreachable server is eligible for fail-open by default, bounded by a four-second request deadline, or fail-closed when configured. A fail-open call has no reservation and is therefore unmetered. A malformed reserve response — an unknown decision, a missing reservation id, or a `tool_denylist` sent as a string instead of an array — is denied. The plugin never grants execution from a reserve response it cannot interpret, and a mistyped cap is malformed rather than missing.

**Successful-call recovery starts with a durable outcome record.** Once `PostToolUse` changes a successful call's record from `hold` to `commit`, recovery can settle it only by commit or usage event — never release. Replayed hooks, session end, and the next session start retry that record after transient settlement failures. A crash before that durable transition is not covered by this guarantee.

**Recovery is isolated by routing identity.** Local state is namespaced by a hash of (server, subject, unit), so different routing identities cannot see one another's records. Projects that share the same tuple also share a recovery scope; use distinct subject dimensions such as `app` or `workflow` when project-level separation is required.

**Retries use stable per-call identity when available.** When Claude Code supplies `tool_use_id`, [idempotency keys](/glossary#idempotency-key) derive from it, so a transport retry replays the same reservation while two identical calls charge separately. Older inputs without `tool_use_id` use a content-hash fallback; identical fallback calls can collide and undercount. (This is also why the stateless MCP server *doesn't* auto-generate keys — only a layer with stable per-call identity can do it safely. The review that established that is in the [server's audit log](https://github.com/runcycles/cycles-mcp-server/blob/main/AUDIT.md).)

**Privacy scope is narrow and explicit.** Cycles hook requests include the configured API credential, subject identifiers, tool name, unit and amount, reservation TTL or ID and fixed settlement reasons as needed, plus opaque idempotency digests computed locally. Raw tool arguments, file contents, and prompts are not included in Cycles request bodies; Claude Code's model-provider traffic is separate. The zero-runtime-dependency plugin is backed by 81 tests, including an end-to-end suite that spawns the real hook processes. Full policy: [runcycles.io/privacy](/privacy).

## Limits of Claude Code budget enforcement

Local and helper tools (`Read`, `Grep`, `Glob`, `TodoWrite`, …) are skipped by default so the budget signal focuses on consequential actions; set `CYCLES_CC_SKIP_TOOLS=^$` to gate every non-Cycles tool. Cycles budget tools remain exempt through an exact-namespace recursion guard. Platform support is Claude Code only: hook behavior in managed environments such as Cowork has not been verified. Flat per-call costing is the current design — meter LLM token spend at your model gateway with the [other Cycles integrations](/how-to/integrations-overview), and use this plugin for tool-level [action authority](/glossary#action-authority).

## Cycles Budget Guard resources

Start with [Enforcing Budgets in Claude Code with Budget Guard](/how-to/enforcing-budgets-in-claude-code-with-budget-guard). Install the plugin, configure a Cycles server and subject, then verify that an exhausted test budget blocks a gated tool call.

- [Add Hard Budgets to MCP Tools Before They Execute](/blog/mcp-tool-budgets-before-execution) shows the same dispatch-path pattern around an MCP tool handler.
- [How Reserve-Commit Works in Cycles](/protocol/how-reserve-commit-works-in-cycles) explains the reservation lifecycle used by the plugin.
- [What Is Runtime Authority for AI Agents?](/blog/what-is-runtime-authority-for-ai-agents) places dispatch-path enforcement in the broader control model.
