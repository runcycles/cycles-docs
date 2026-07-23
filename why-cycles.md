---
title: "Why Cycles"
description: "For teams shipping AI agents to customers or internally — blast-radius containment, audit trails, bounded unit economics, and provable governance."
---

# Why Cycles

**Start with the problem that matters to you:**

- [Stop agents from burning your API budget overnight](/why-cycles/cost-control) — the $4,200 overnight incident
- [Block the 201st email before it sends](/why-cycles/action-authority) — when the damage isn't cost, it's consequence
- [One customer's runaway shouldn't affect your other 500](/why-cycles/multi-tenant) — per-tenant isolation for SaaS
- [Prove to an auditor that your agents are under control](/why-cycles/governance) — auditable enforcement for compliance

---

If you're deploying AI agents — to customers or inside the enterprise — Cycles is the [runtime authority](/blog/what-is-runtime-authority-for-ai-agents) layer that enforces hard limits on spend and actions before every LLM call, tool invocation, and side effect. Per-tenant, per-workflow, per-run. So one runaway agent never blows through another's budget, your feature margin stays predictable, and every action is auditable.

## What Cycles solves

**Protect margin.** Agent costs follow a heavy-tail distribution — the top 10% of users consume [72% of total spend](/blog/ai-agent-unit-economics-cost-per-conversation-per-user-margin). Without per-user budget caps, a feature priced for 80% gross margin [delivers 23%](/blog/ai-agent-unit-economics-cost-per-conversation-per-user-margin). Cycles bounds the tail so unit economics stay predictable.

**Contain cross-tenant blast radius.** A single runaway agent can burn [$4,200 in three hours](/blog/ai-agent-failures-budget-controls-prevent). Cycles enforces hierarchical budgets — tenant, workspace, workflow, run — so one customer's bad agent cannot starve the platform or another customer's allocation.

**Audit every action.** Every reservation, commit, and event creates a structured record with full scope context. Queryable via API, 90-day hot retention, exportable to cold storage. No log reconstruction required — the budget ledger is the audit trail. When an auditor asks "which agent did what, when, and who authorized it," the answer is a single API query — not a week of log reconstruction. [Details →](/security)

**Gate high-consequence actions.** A support agent [sent 200 collections emails instead of welcome emails](/blog/ai-agent-action-control-hard-limits-side-effects). Total model spend: $1.40. Business impact: $50K+ in lost pipeline. No spending limit would have caught it. Cycles supports [RISK_POINTS](/concepts/action-authority-controlling-what-agents-do) — budgets denominated in blast radius, not dollars — so agents can read and reason freely while dangerous capabilities (email, deploy, delete) are gated separately.

## Where Cycles fits

<StackDiagram />

## Why now

Regulatory frameworks are converging on a single requirement: if your AI system acts autonomously, you must be able to prove what it did, why it was allowed to do it, and how you would have stopped it. The EU AI Act's Article 50 transparency obligations and GPAI enforcement apply from August 2, 2026; the June 2026 Digital Omnibus moved Annex III high-risk obligations to December 2, 2027 ([what actually happens in August →](/blog/eu-ai-act-what-actually-happens-august-2-2026)). NIST launched its [AI Agent Standards Initiative](https://www.nist.gov/news-events/news/2026/02/announcing-ai-agent-standards-initiative-interoperable-and-secure) in February 2026. Organizations can already pursue [ISO 42001 certification](https://www.iso.org/standard/81230.html). The window between "we should govern our agents" and "we must prove we govern our agents" is closing. [Full regulatory mapping →](/blog/ai-agent-governance-framework-nist-eu-ai-act-iso-42001-owasp-runtime-enforcement)

## By role

**For engineering:** A single runaway agent burned [$4,200 in three hours](/blog/ai-agent-failures-budget-controls-prevent). With a $15 per-run budget in Cycles, the same agent stops after 8 iterations.
**For security/compliance:** Every reservation, commit, and event creates a structured, queryable audit record with full scope context.
**For finance:** Per-user budget caps turned a [23% gross margin into 68%](/blog/ai-agent-unit-economics-cost-per-conversation-per-user-margin) in one analysis, with only 5% of users hitting the limit.
**For the AI agent itself:** Visible constraints earn trust — teams that see agents self-regulate respond by increasing budgets and granting access to higher-risk tools.

<details>
<summary><strong>Engineering — Contain blast radius, protect margins</strong></summary>

Every agent action passes through a reserve-commit gate. Before an LLM call executes, Cycles atomically checks the budget and locks the estimated cost. If the budget is exhausted, the call is denied and the agent degrades gracefully — cheaper model, shorter response, or explicit stop.

Without this gate, a single runaway agent can burn **$4,200 in three hours** — a coding agent hit an ambiguous error, retried with expanding context windows, and [looped 240 times before anyone noticed](/blog/ai-agent-failures-budget-controls-prevent). With a $15 per-run budget in Cycles, the same agent stops after 8 iterations and surfaces the problem immediately.

Blast radius is bounded at every level: per-run, per-workflow, per-tenant. One bad agent cannot starve the platform. Budgets are hierarchical — tenant, workspace, app, workflow, agent — so you set ceilings at the level that matches your architecture.

The margin impact is direct. In one [unit economics analysis](/blog/ai-agent-unit-economics-cost-per-conversation-per-user-margin), a team pricing an AI feature at $15/user/month saw costs hit $11.50/user — a 23% margin against an 80% target. Per-user caps restore it to 68%.

Cost is the first dimension. [Action authority](/concepts/action-authority-controlling-what-agents-do) is the second — gating what agents do, not just what they spend, via risk-point budgets per toolset.

[Why rate limits are not enough →](/concepts/why-rate-limits-are-not-enough-for-autonomous-systems)

</details>

<details>
<summary><strong>Security / Compliance — Every action is auditable</strong></summary>

Every reservation, commit, release, and event in Cycles creates a structured, queryable record. Each record includes: full scope hierarchy (tenant, workspace, app, workflow, agent, toolset), amounts reserved and committed, timestamp, status, and arbitrary metadata.

This means every budget operation — every reservation, commit, release, and event — is logged with the context needed for audit. You can answer "which agent spent how much, on what, and when" from the event log alone, without reconstructing it from scattered application logs.

The event log is queryable via the REST API. Hot retention defaults to 90 days (configurable via `EVENT_TTL_DAYS`); export events via the API to your own cold storage (e.g. S3, GCS) for long-term compliance — there is no built-in exporter. The admin server records audit logs for all administrative operations — API key creation, tenant changes, budget modifications.

Access control separates the runtime plane (port 7878, scoped API keys with least-privilege permissions) from the management plane (port 7979, admin-only, never exposed to the public internet). API keys support rotation, revocation, and per-permission scoping.

Cycles is self-hosted open source today, so all data stays in your infrastructure and inherits your existing compliance posture. A managed cloud offering is planned but not yet available.

[Security overview →](/security) · [Event log API →](/protocol/how-events-work-in-cycles-direct-debit-without-reservation) · [Security hardening →](/how-to/security-hardening)

</details>

<details>
<summary><strong>Finance — From unpredictable spend to bounded unit economics</strong></summary>

In one [real deployment](/blog/how-much-do-ai-agents-cost), a team estimated $800/month for a customer support agent based on prototype traffic. The first production invoice was $4,200. The per-token pricing was exactly right — the call volume was not. Agents averaged 11 LLM calls per conversation instead of the 3 assumed in the estimate. Retries doubled call counts on bad days.

This is the norm. In a [unit economics analysis](/blog/ai-agent-unit-economics-cost-per-conversation-per-user-margin) of an AI copilot feature, the top 10% of users consumed 72% of total spend. One user triggered 340 conversations in a month and cost $310 alone — wiping out the margin from 50+ light users.

Cycles bounds this tail. In the same analysis, a $15/month per-user cap turned a 23% gross margin into 68%, with only 5% of users ever hitting the limit. A $15 per-run cap prevents the [$4,200 tool loop](/blog/ai-agent-failures-budget-controls-prevent) entirely — the agent stops at $15 and surfaces the problem for human review.

Budget enforcement is not a cost center. It is the mechanism that makes AI feature unit economics predictable.

</details>

<details>
<summary><strong>AI Agent — You get a budget, not just a limit</strong></summary>

Your SDK tells you what each call cost — after it happened. You could track that locally. But a local counter breaks when 20 of you run concurrently against the same customer budget — you all read "remaining: $500" and all proceed. If you crash, your local state is gone. And you can't see the tenant's allocation, the workflow's run budget, or the workspace capacity. That context lives outside you. This isn't a gap you close with [more tools](/blog/vibe-coding-budget-wrapper-vs-budget-authority) — it requires a shared authority.

Cycles is that authority. Call `cycles_check_balance` before you plan. Call `cycles_reserve` before each costly step. You get back:

- **ALLOW** — proceed.
- **ALLOW_WITH_CAPS** — proceed with constraints (`max_tokens`, `tool_denylist`, `max_steps_remaining`). The authority tells you *how* to adapt, not just whether to proceed.
- **DENY** — do not execute. Summarize what you completed, tell the user what remains, exit cleanly.

Call `cycles_commit` after execution so unused budget returns to the pool. If you crash, reservations expire and budget recovers automatically.

This is the difference between being killed mid-action and [choosing how to wind down](/how-to/how-to-think-about-degradation-paths-in-cycles-deny-downgrade-disable-or-defer). Drop to a cheaper model, skip optional calls, defer work — and explain the trade-off. Bounds you can see, not limits you discover by crashing into them.

### Why this earns you more autonomy

Without visible self-regulation, teams restrict you. They add human-in-the-loop approval steps, limit your tool access, reduce your context window, cap your iterations at 5. They do this because they have no evidence you'll stop on your own.

Cycles gives them that evidence. Every reservation is a record that you checked before acting. Every commit is proof you reported actual usage. Every DENY you handled gracefully — winding down, explaining what's left — is a signal that you can be trusted with more. Teams that see agents self-regulate within bounds respond by increasing budgets, granting access to higher-risk tools, and removing manual gates. Constraint you can demonstrate is the path to autonomy you earn.

### What about latency?

A full reserve+commit cycle adds [~15ms](/blog/cycles-server-performance-benchmarks) end-to-end (p50; ~11ms per lifecycle under 32-thread concurrency). A typical LLM call takes 500ms–30s. Budget enforcement adds less time than the variance in your provider's response latency. You won't notice it.

### What if the budget is set too low?

This is real — a budget of $0.50 on a task that needs $5 means you get DENY on step 3. But without Cycles, you'd discover the mismatch after spending $5 (or $50, or $4,200). With Cycles, you discover it at $0.50 and can tell the user: "Budget exhausted after 3 steps. This task needs a larger allocation." That's better for both of you. And teams can [calibrate budgets with shadow mode](/how-to/shadow-mode-in-cycles-how-to-roll-out-budget-enforcement-without-breaking-production) — running enforcement in dry-run against real traffic before turning it on.

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
