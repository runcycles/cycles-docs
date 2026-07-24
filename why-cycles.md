---
title: "Why Cycles"
description: "For teams shipping AI agents to customers or internally — blast-radius containment, audit trails, bounded unit economics, and provable governance."
---

# Why Cycles

**Start with the problem that matters to you:**

- [Stop agents from burning your API budget overnight](/why-cycles/cost-control) — a 240-iteration runaway-loop scenario
- [Block the 201st email before it sends](/why-cycles/action-authority) — when the damage isn't cost, it's consequence
- [One customer's runaway shouldn't affect your other 500](/why-cycles/multi-tenant) — per-tenant isolation for SaaS
- [Prove to an auditor that your agents are under control](/why-cycles/governance) — auditable enforcement for compliance

---

If you're deploying AI agents — to customers or inside the enterprise — Cycles is a [runtime authority](/blog/what-is-runtime-authority-for-ai-agents) layer for hard limits on spend and caller-assigned action exposure. Put a required reserve-commit boundary before each protected LLM call, tool invocation, or side effect, then use standard scopes such as tenant and workflow; a workflow value can be unique per run. Cycles accounts for the amounts and context the host submits; tool authorization and complete action auditing remain application responsibilities.

## What Cycles solves

**Protect margin.** Agent costs follow a heavy-tail distribution — the top 10% of users consume [72% of total spend](/blog/ai-agent-unit-economics-cost-per-conversation-per-user-margin). Without per-user budget caps, a feature priced for 80% gross margin [delivers 23%](/blog/ai-agent-unit-economics-cost-per-conversation-per-user-margin). Cycles bounds the tail so unit economics stay predictable.

**Contain cross-tenant budget impact.** In one [illustrative three-hour loop](/blog/ai-agent-failures-budget-controls-prevent), 240 iterations cost $52.80 under the stated token assumptions. Correctly provisioned tenant and workflow budgets can keep one customer's submitted usage from consuming another customer's allocation.

**Audit budget decisions and settlement.** Reservation state, audit rows, and implemented emitted events create structured records for the budget lifecycle, including caller-supplied scope and metadata where the relevant schema carries them. The event store has configurable retention (90 days by default), and callers can export records to their own long-term storage. Propagated trace IDs can link Cycles requests to application logs for tool arguments, authorization, and outcomes; successful reservation operations do not each emit a runtime Event. [Details →](/security)

**Bound high-consequence actions.** In an [illustrative scenario](/blog/ai-agent-action-control-hard-limits-side-effects), 200 mistaken emails have about $1.40 in modeled token spend but potentially much larger, unquantified business impact. A monetary limit calibrated to tokens may not catch that. A host can authorize actions, classify them in [RISK_POINTS](/concepts/action-authority-controlling-what-agents-do), and submit those amounts to a separate Cycles budget. The host still authorizes tools and arguments; Cycles meters the exposure it submits.

## Where Cycles fits

<StackDiagram />

## Why now

Regulatory and standards programs impose different, scope-dependent obligations; none mandates Cycles or runtime budgets specifically. EU AI Act Article 50 transparency rules and Commission enforcement powers for GPAI are scheduled to apply from August 2, 2026, while the 2026 AI Omnibus moved the Annex III high-risk-system timeline to December 2, 2027 ([what actually happens in August →](/blog/eu-ai-act-what-actually-happens-august-2-2026)). NIST launched its voluntary [AI Agent Standards Initiative](https://www.nist.gov/news-events/news/2026/02/announcing-ai-agent-standards-initiative-interoperable-and-secure) in February 2026. Organizations can already pursue [ISO/IEC 42001 certification](https://www.iso.org/standard/42001). Teams should map the rules that apply to their role and use case, then select technical and organizational controls that produce the required evidence. [Full regulatory mapping →](/blog/ai-agent-governance-framework-nist-eu-ai-act-iso-42001-owasp-runtime-enforcement)

## By role

**For engineering:** A modeled loop reached [$52.80 over 240 iterations](/blog/ai-agent-failures-budget-controls-prevent). Under its flat-average assumptions, a mandatory $15 run budget rejects a protected call around iteration 68.
**For security/compliance:** Budget operations and implemented emitted events create structured records; propagated trace context connects them to application authorization and outcome logs.
**For finance:** Per-user budget caps turned a [23% gross margin into 68%](/blog/ai-agent-unit-economics-cost-per-conversation-per-user-margin) in one analysis, with only 5% of users hitting the limit.
**For the AI agent itself:** Visible constraints give operators evidence they can use when deciding whether to increase budgets or reduce manual gates.

<details>
<summary><strong>Engineering — Contain blast radius, protect margins</strong></summary>

Every action the host instruments passes through a reserve-commit gate. Before an LLM call executes, Cycles atomically checks the submitted budget scope and locks the estimated cost. If the reservation is rejected, the host must skip the call and can degrade gracefully — cheaper model, shorter response, or explicit stop.

Without this gate, a coding agent in the [illustrative source scenario](/blog/ai-agent-failures-budget-controls-prevent) loops 240 times over three hours and spends $52.80 at the stated flat-average token rates. With mandatory coverage and a $15 run budget, a protected call is rejected around iteration 68 under those same assumptions.

Blast radius is bounded at every level: per-run, per-workflow, per-tenant. One bad agent cannot starve the platform. Budgets are hierarchical — tenant, workspace, app, workflow, agent — so you set ceilings at the level that matches your architecture.

The margin impact is direct. In one [unit economics analysis](/blog/ai-agent-unit-economics-cost-per-conversation-per-user-margin), a team pricing an AI feature at $15/user/month saw costs hit $11.50/user — a 23% margin against an 80% target. Per-user caps restore it to 68%.

Cost is the first dimension. [Action authority](/concepts/action-authority-controlling-what-agents-do) is the second — gating what agents do, not just what they spend, via risk-point budgets per toolset.

[Why rate limits are not enough →](/concepts/why-rate-limits-are-not-enough-for-autonomous-systems)

</details>

<details>
<summary><strong>Security / Compliance — Budget operations are auditable</strong></summary>

Cycles stores reservation lifecycle records and exposes emitted runtime events as structured, queryable data. Depending on the record and request, fields can include the submitted scope hierarchy, reserved or committed amounts, timestamps, status, correlation identifiers, and metadata.

This supports questions such as "which submitted scope spent how much, and when." It is not a complete record of what a tool did or why application policy authorized it. Propagate the same trace context across related Cycles requests, retain reservation IDs, and add application correlation keys to your own logs so you can join authorization, tool-call, and outcome evidence.

The event log is queryable via the REST API. Hot retention defaults to 90 days (configurable via `EVENT_TTL_DAYS`); export events via the API to your own cold storage (e.g. S3, GCS) for long-term compliance — there is no built-in exporter. The admin server records audit logs for all administrative operations — API key creation, tenant changes, budget modifications.

Access control separates the runtime plane (port 7878, scoped API keys with least-privilege permissions) from the management plane (port 7979, admin-only, never exposed to the public internet). API keys support rotation, revocation, and per-permission scoping.

Cycles is self-hosted open source today, so all data stays in your infrastructure and inherits your existing compliance posture. A managed cloud offering is planned but not yet available.

[Security overview →](/security) · [Event log API →](/protocol/how-events-work-in-cycles-direct-debit-without-reservation) · [Security hardening →](/how-to/security-hardening)

</details>

<details>
<summary><strong>Finance — From unpredictable spend to bounded unit economics</strong></summary>

An [illustrative workload model](/blog/how-much-do-ai-agents-cost) compares an $800/month prototype estimate with a $4,200/month production-shaped scenario driven by 11 calls per conversation, growing context, and retries. It is a calculator scenario, not a verified customer invoice.

This is the norm. In a [unit economics analysis](/blog/ai-agent-unit-economics-cost-per-conversation-per-user-margin) of an AI copilot feature, the top 10% of users consumed 72% of total spend. One user triggered 340 conversations in a month and cost $310 alone — wiping out the margin from 50+ light users.

Cycles can bound this tail on mandatory paths. In the unit-economics model, a $15/month per-user cap changes modeled gross margin from 23% to 68%, with 5% of modeled users hitting the limit. In the separate loop scenario, a $15 run budget bounds protected spend near $15 when estimates and settlement are accurate.

Budget enforcement is not a cost center. It is the mechanism that makes AI feature unit economics predictable.

</details>

<details>
<summary><strong>AI Agent — You get a budget, not just a limit</strong></summary>

Your SDK tells you what each call cost — after it happened. You could track that locally. But a local counter breaks when 20 of you run concurrently against the same customer budget — you all read "remaining: $500" and all proceed. If you crash, your local state is gone. And you cannot see the tenant ledger, a workflow ledger keyed to the run, or workspace capacity. That context lives outside you. This isn't a gap you close with [more tools](/blog/vibe-coding-budget-wrapper-vs-budget-authority) — it requires a shared authority.

Cycles is that authority. Call `cycles_check_balance` before you plan. Call `cycles_reserve` before each costly step. You get back:

- **ALLOW** — proceed.
- **ALLOW_WITH_CAPS** — proceed with constraints (`max_tokens`, `tool_denylist`, `max_steps_remaining`). The authority tells you *how* to adapt, not just whether to proceed.
- **DENY** — do not execute. Summarize what you completed, tell the user what remains, exit cleanly.

Call `cycles_commit` after execution so unused budget returns to the pool. If you crash, reservations expire and budget recovers automatically.

This is the difference between being killed mid-action and [choosing how to wind down](/how-to/how-to-think-about-degradation-paths-in-cycles-deny-downgrade-disable-or-defer). Drop to a cheaper model, skip optional calls, defer work — and explain the trade-off. Bounds you can see, not limits you discover by crashing into them.

### Why this earns you more autonomy

Without visible self-regulation, teams restrict you. They add human-in-the-loop approval steps, limit your tool access, reduce your context window, cap your iterations at 5. They do this because they have no evidence you'll stop on your own.

Cycles contributes that evidence. Every reservation records that the integration checked the submitted budget before acting. Every commit records reported usage. A clean response to a rejection — winding down and explaining what remains — can help operators evaluate whether a larger budget or fewer manual gates are appropriate. Those changes remain human policy decisions, not an automatic consequence of using Cycles.

### What about latency?

In the published benchmark environment, a full reserve-commit cycle added [~15ms](/blog/cycles-server-performance-benchmarks) end-to-end at p50 (~11ms per lifecycle under 32-thread concurrency). That is small relative to many LLM calls, but network, datastore, and load characteristics vary. Measure the added latency in your deployment.

### What if the budget is set too low?

This mismatch is possible — a budget of $0.50 on a task that needs $5 can reject a later live reservation. Without a mandatory budget boundary, the host may discover the mismatch only after spending much more. With one, it can stop near the configured allocation and tell the user that the task needs a larger budget. Teams can [calibrate budgets with shadow mode](/how-to/shadow-mode-in-cycles-how-to-roll-out-budget-enforcement-without-breaking-production) by collecting and analyzing dry-run responses before turning enforcement on.

### What if your estimates are wrong?

They will be. Estimates don't need to be perfect — they need to be bounded. If you overestimate, the excess is released on `commit`. If you underestimate, the [overage policy](/protocol/commit-overage-policies-in-cycles-reject-allow-if-available-and-allow-with-overdraft) decides what happens — reject, allow if available, or allow with overdraft. The protocol is designed for imperfect information, because that's what agents have.

### When you don't need this

If you're a solo agent — one session, one user, no concurrency, no multi-tenancy — a local counter is probably fine. Cycles solves coordination across agents, tenants, and workflows. If there's nothing to coordinate, the overhead isn't justified. Where Cycles matters is when you're one of many: multiple agents drawing from shared budgets, multiple customers on the same platform, multiple workflows that need isolation from each other.

[MCP server quickstart →](/quickstart/getting-started-with-the-mcp-server) · [Agent decision loop →](/how-to/integrating-cycles-with-mcp)

</details>

<AdoptionLadder />

## Get started

- [What is Cycles?](/quickstart/what-is-cycles) — 5-minute overview
- [End-to-End Tutorial](/quickstart/end-to-end-tutorial) — from zero to working enforcement in 30 minutes
- [5 Failures Budget Controls Would Prevent](/blog/ai-agent-failures-budget-controls-prevent) — cost incidents, with dollar math
- [5 Failures Only Action Controls Would Prevent](/blog/ai-agent-action-failures-runtime-authority-prevents) — action incidents, where the spend was negligible
