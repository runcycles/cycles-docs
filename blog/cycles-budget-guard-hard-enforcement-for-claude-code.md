---
title: "Cycles Budget Guard: Hard Budget Enforcement for Claude Code"
date: 2026-07-22
author: Albert Mavashev
tags: [announcement, claude-code, plugin, hooks, enforcement, budget, runtime-authority, mcp]
description: "A Claude Code plugin that puts Cycles in the tool-dispatch path: budget reserved before every gated tool call, DENY blocks execution at the harness layer, and every executed action gets settled. The model cannot skip it."
blog: true
sidebar: false
---

# Cycles Budget Guard: Hard Budget Enforcement for Claude Code

A few weeks ago, someone asked us the question every enforcement product should be able to answer:

> *"If a prompt injection or a hallucinated argument made the agent try to reserve an impossibly large budget, what actually enforces that the call is denied before it executes?"*

Our honest answer had two parts. Server-side, Cycles is authoritative: an oversized reserve can't grant authority beyond policy, and nothing spends until commit. But *inside an agent's tool loop*, honoring a DENY was cooperative — the [MCP server](/how-to/integrating-cycles-with-mcp) gives the model budget tools and tells it not to proceed on DENY, and nothing in MCP forces it to listen. We wrote that boundary into our [security model](https://github.com/runcycles/cycles-mcp-server#security-model--enforcement-boundary) instead of papering over it, and said the fix was to put Cycles in the actual dispatch path.

Today that fix ships for Claude Code. **[Cycles Budget Guard](https://github.com/runcycles/cycles-claude-plugin)** is a Claude Code plugin that gates tool execution itself:

```
/plugin marketplace add runcycles/cycles-claude-plugin
/plugin install cycles-budget-guard@runcycles
```

<!-- more -->

## What it does

- **PreToolUse reserves before every gated tool call.** A Cycles DENY — or an exhausted, frozen, or closed budget, a debt block, an auth failure, or *any response the plugin can't interpret* — blocks the call at the harness layer, with a reason the model sees. This isn't a prompt convention; the hook runner enforces it. The model cannot skip it.
- **Caps are enforced, not advisory.** `ALLOW_WITH_CAPS` tool allow/denylists block violating calls at the gate, with allowlist precedence exactly per the protocol spec. Token and cooldown caps are injected into the model's context.
- **Every executed action gets settled.** Success commits the reservation. Failure releases it. A reservation that expired during a long tool run still gets charged through an idempotent usage event — executed work is never silently free, and failed attempts are never silently charged.
- **Agents self-regulate.** When a budget drops under 15%, the plugin injects a warning into the model's context. Models act on in-band text; that's the point.
- **The full Cycles MCP toolset rides along** (pinned version), so the model can check balances and make explicit reserves for costly operations while the hooks enforce the floor. `/cycles-budget-guard:budget` gives a one-command status report.

## Built paranoid, on purpose

This plugin sits in the dispatch path of every tool call, so we held it to a different standard. Before merge, it went through five rounds of adversarial enforcement review, and the review kept winning. A few of the design decisions that came out of that process:

**Integrity failures are not availability failures.** Unreachable server? Fail-open by default (bounded by a 4-second deadline — a black-holed server can never hang your session), or fail-closed if you say so. But a *garbled* response — an unknown decision, a missing reservation id, a `tool_denylist` sent as a string instead of an array — is denied, always. Enforcement is never granted on an answer we couldn't interpret, and a mistyped cap is a malformed cap, not a missing one.

**Executed actions can never be un-charged.** The moment a tool succeeds, that fact is persisted locally as a typed record that can only settle by commit or usage event — never release. Transient failures, expired reservations, even crashes: replayed hooks, session end, and the next session start form a deterministic retry chain until the charge lands.

**Recovery can't cross projects.** All local state is namespaced by a hash of (server, subject, unit). A machine running two projects against different Cycles tenants structurally cannot charge one project's budget for the other's action — the records are invisible across configurations, not merely validated.

**Retries never double-charge.** Idempotency keys derive from Claude Code's per-call `tool_use_id`, so a transport retry replays the same reservation while two genuinely identical calls charge separately. (This is also why the stateless MCP server *doesn't* auto-generate keys — only a layer with stable per-call identity can do it safely. The review that established that is in the [server's audit log](https://github.com/runcycles/cycles-mcp-server/blob/main/AUDIT.md).)

**Privacy by construction.** The hooks transmit subject identifiers, tool *names*, unit and amount, and locally computed digests. Tool arguments, file contents, and prompts never leave the machine. The whole enforcement surface is a few hundred lines of zero-dependency code you can read in one sitting — and 75 tests, including an end-to-end suite that spawns the real hook processes, hold it in place. Full policy: [runcycles.io/privacy](/privacy).

## What we don't claim

The same honesty that produced the security model applies here. Local zero-cost reads (`Read`, `Grep`, `Glob`, …) are skipped by default so your budget signal reflects actions, not file browsing — set `CYCLES_CC_SKIP_TOOLS=^$` to gate literally everything. Platform support is Claude Code only: we haven't verified hook behavior in managed environments like Cowork, so we don't claim it. And flat per-call costing is deliberate for v0.1 — meter LLM token spend at your model gateway with the [other Cycles integrations](/how-to/integrations-overview); use this plugin for action-level authority.

## Get started

Docs: [Enforcing Budgets in Claude Code with Budget Guard](/how-to/enforcing-budgets-in-claude-code-with-budget-guard). Five minutes: install the plugin, set `CYCLES_BASE_URL`, `CYCLES_API_KEY`, and `CYCLES_DEFAULT_TENANT`, and watch a DENY actually stop a tool call.

The question that started all this deserved a better answer than "the model is instructed not to." Now it has one.
