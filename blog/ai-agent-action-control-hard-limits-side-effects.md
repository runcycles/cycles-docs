---
title: "Hard Limits on AI Agent Side Effects"
date: 2026-03-19
author: Cycles Team
tags: [action-control, risk, agents, engineering, best-practices]
description: "Use mandatory tool boundaries and caller-assigned risk budgets to limit AI agent side effects, while keeping application authorization separate at runtime."
blog: true
sidebar: false
head:
  - - meta
    - name: keywords
      content: AI agent action control, AI agent side effects, RISK_POINTS, runtime authority, tool call budgets, pre-execution enforcement
---

# Hard Limits on AI Agent Side Effects

> **Part of: [AI Agent Risk & Blast Radius Reference](/guides/risk-and-blast-radius)** — the full pillar covering action authority, risk scoring, blast-radius containment, and degradation paths.

Consider an illustrative customer-onboarding agent tasked with sending welcome emails to 200 trial accounts. A template-selection bug falls back to a collections notice, and the host sends all 200. If the associated model calls cost about $1.40, customer and business harm can still dwarf token spend. The scenario has no sourced ticket, complaint, or pipeline-loss measurements; it demonstrates the mismatch between monetary cost and action exposure.

The problem was not spend. The problem was that the agent _acted_ — and nobody checked what it was about to do.

<!-- more -->

## Budget Control Is Not Action Control

Most teams equate "agent control" with "cost control." They set dollar budgets, track token usage, alert on spend thresholds. That covers one dimension — money — but agents have a second, more dangerous dimension: **side effects**.

Side effects are the actions an agent takes in the world. Sending emails. Creating Jira tickets. Writing files to disk. Deleting database records. Triggering CI/CD pipelines. Kicking off production deploys. Calling external APIs that charge money, move data, or change state in systems your team doesn't own.

The critical property of side effects is **irreversibility**. A sent email cannot be unsent. A triggered deploy is live. A deleted record may not be recoverable. A Slack message to a customer channel cannot be retracted without notice. These are consequences that persist after the agent stops — and no amount of post-hoc cost reconciliation changes what already happened.

This is why a complete **[runtime authority](/glossary#runtime-authority)** design needs both budget authority and application [action authority](/glossary#action-authority). Current Cycles enforces budgets over submitted spend or caller-assigned exposure; it does not infer action risk, inspect tool arguments, or replace the host's permission policy.

| Dimension | What it limits | Example controls | What happens if missing |
|-----------|---------------|------------------|------------------------|
| **Budget authority** | How much the agent spends | Per-run dollar cap, per-[tenant](/glossary#tenant) quota | Runaway cost — [$52.80 loop and $2,300 weekend-batch models](/blog/ai-agent-failures-budget-controls-prevent) |
| **Action authority** | What the agent may do | Application tool/argument policy plus optional risk-point caps and per-action [reservation](/glossary#reservation) | Wrong emails sent, accidental deploys, unauthorized file writes, data deletion |

For a deep dive on the budget authority side specifically, see [AI Agent Budget Control: Enforce Hard Spend Limits](/blog/ai-agent-budget-control-enforce-hard-spend-limits).

## The Taxonomy of Consequential Actions

Not all tool calls carry the same risk. A read-only database query changes nothing. A production deploy changes everything. The right control strategy depends on where each action falls on the risk spectrum.

| Tier | Category | Examples | Reversibility | Blast radius | Recommended control |
|:----:|----------|----------|--------------|--------------|---------------------|
| 1 | **Read** | File reads, DB queries, search, web scrape | No state change | None | Event (post-hoc accounting) |
| 2 | **Write-local** | File writes, draft creation, log entries | Reversible with effort | Contained to local system | Event or reserve-commit depending on volume |
| 3 | **Write-external** | Emails, Slack messages, ticket creation, API calls to third parties | Difficult or impossible to reverse | External parties affected | Reserve-commit (always) |
| 4 | **Mutation** | DB deletes, config changes, permission grants, record updates | Often irreversible | System-wide | Reserve-commit with tight caps |
| 5 | **Execution** | Deploys, CI triggers, payment processing, infrastructure changes | Irreversible in practice | Production users affected | Reserve-commit with strict tool allowlist |

The tiers are a starting point. Every team's risk map is different — a file write in a sandboxed environment is tier 1; a file write to a production config directory is tier 4. The exercise of classifying your agent's tool calls by tier is itself valuable, because it forces the question most teams skip: _which of these actions should the agent be allowed to take without asking permission?_

## Reserve Before Execution vs. Record After the Fact

Cycles provides two mechanisms for tracking agent actions, and choosing the right one is a risk judgment.

**Reserve-commit** is pre-execution budget enforcement. Before the host sends an email, writes a file, or triggers a deploy, it can request a hold from the [Cycles server](/glossary#cycles-server). The server checks the applicable budget in dollars, [tokens](/glossary#tokens), credits, or caller-assigned risk points. A live reservation succeeds with `ALLOW` or configured `ALLOW_WITH_CAPS`, or returns an error when budget is unavailable. The host must separately authorize the action, require both checks before execution, apply returned caps, and commit the best-known actual amount afterward.

**Events** are post-hoc accounting. The agent takes the action first, then records what it did. There is no pre-execution check — the action already happened. Events are useful for low-risk actions where the overhead of a pre-execution round-trip is not justified, or for situations where the action completed outside of Cycles entirely and you need to record it for accounting purposes.

| Pattern | Mechanism | When to use | Trade-off |
|---------|-----------|-------------|-----------|
| **Reserve before execution** | `POST /v1/reservations` → execute → `POST /v1/reservations/{id}/commit` | Consequential actions: emails, deploys, deletes, external API calls | Adds one round-trip of latency, but provides pre-execution veto |
| **Record after execution** | `POST /v1/events` | Low-risk actions: reads, searches, internal logging, known-cost operations | No latency cost, but no pre-execution control |

The key insight is that **the choice between these two accounting patterns depends on risk tolerance**. If an action is reversible and low-impact, a direct-usage event may be sufficient for budget accounting. If it creates persistent consequences, use application authorization and a required reservation before execution.

For the full reserve-commit lifecycle, see [How Reserve-Commit Works in Cycles](/protocol/how-reserve-commit-works-in-cycles). For the event pattern, see [How Events Work in Cycles](/protocol/how-events-work-in-cycles-direct-debit-without-reservation).

## RISK_POINTS — Budgeting What Money Cannot Measure

Dollar budgets are the wrong unit for action authority. In the illustrative opening scenario, 200 mistaken emails can have low token cost and high external impact. A monetary budget calibrated for model spend may not reject any email because the submitted dollar amount remains small.

Cycles supports a **[RISK_POINTS](/glossary#risk-points)** unit specifically for this problem. Instead of denominating budgets in dollars or tokens, teams assign point values to each action class based on blast radius. A workflow gets a fixed risk-point budget, and every consequential action deducts from it.

| Action class | Risk points | Rationale |
|-------------|:----------:|-----------|
| Read-only model call | 1 | No side effects, no state change |
| Internal tool call (search, lookup) | 2 | No external side effects |
| External API read (GET) | 5 | Third-party dependency, potential data [exposure](/glossary#exposure) |
| File write | 10 | Persistent state change, reversible with effort |
| Email or Slack message | 20 | External recipient, irreversible once delivered |
| Ticket creation | 20 | Triggers downstream workflows in external systems |
| Database mutation (update/delete) | 25 | Potentially irreversible data change |
| Deploy or CI trigger | 50 | Production impact, affects end users |
| Payment processing | 50 | Financial commitment, regulatory implications |

A workflow capped at 100 risk points can make dozens of reads and searches (1-2 points each) but only send 5 emails (20 points each) before hitting the limit. Or it can do 2 deploys and nothing else. The cap forces the agent to prioritize — and it forces the team to decide, up front, how much action surface they are willing to expose per run.

The specific point values are subjective and team-defined. The table above is an example schedule — your team's will differ. A team that sends transactional emails as a core workflow might assign 5 points per email instead of 20, because a misrouted transactional email is recoverable. A team with strict compliance requirements might assign 100 points to any external communication, because the blast radius of a wrong message is regulatory, not just reputational. The value is not in the absolute numbers but in the **relative weighting** and the **hard cap**. What matters is that the cap exists and is enforced before execution.

For per-tool point assignment, see [Assigning RISK_POINTS to agent tools](/how-to/assigning-risk-points-to-agent-tools). For the full unit system including [USD_MICROCENTS](/glossary#usd-microcents), TOKENS, [CREDITS](/glossary#credits), and RISK_POINTS, see [Understanding Units in Cycles](/protocol/understanding-units-in-cycles-usd-microcents-tokens-credits-and-risk-points).

## Tool Allowlists and Denylists — Capability Control Under Pressure

Risk points cap caller-assigned cumulative action exposure. But sometimes you need to control _which_ actions are available at all. A Cycles budget can return configured **tool allowlists and denylists** as part of an `ALLOW_WITH_CAPS` decision; the host or integration must enforce those cap fields before invoking a tool.

When an agent requests a reservation and the server determines that the action is allowed but should be constrained, it returns `decision: ALLOW_WITH_CAPS` along with a `caps` object. That object can include:

- **`tool_allowlist`** — only these tools may be used (everything else is implicitly denied)
- **`tool_denylist`** — these specific tools are blocked (everything else is allowed)
- **`max_steps_remaining`** — the agent has this many steps left before it must stop

This enables an application pattern: **progressive capability narrowing**. The application assigns risk points per tool and selects among budgets or policy scopes with different configured caps as the workflow changes. The current server does not compute utilization thresholds or automatically tighten caps as risk points are consumed.

| Tool | Risk points | Tier |
|------|:----------:|------|
| `read_file`, `search` | 1 | Read |
| `create_draft` | 5 | Write-local |
| `send_email` | 20 | Write-external |
| `create_ticket` | 20 | Write-external |
| `deploy` | 50 | Execution |

With a 100-point risk budget per run, an application could select this policy progression:

| Application-selected phase | Decision | Configured caps | Effect |
|---|---|---|---|
| Normal | ALLOW | _(none)_ | Full tool access |
| Restricted | ALLOW_WITH_CAPS | `tool_denylist: ["deploy", "send_email"]` | High-blast-radius actions disabled |
| Read-only | ALLOW_WITH_CAPS | `tool_allowlist: ["read_file", "search"]` | Read-only mode |
| Insufficient budget | Live reservation error | — | No further metered actions |

If the host enforces the returned caps, the agent can degrade instead of hard-stopping. It can still complete useful work — reading files, running searches, generating summaries — while the host removes higher-risk capabilities. This is the "disable" degradation strategy applied to action authority rather than cost control.

For the [three-way decision](/glossary#three-way-decision) model (ALLOW, ALLOW_WITH_CAPS, DENY) and how caps flow through the system, see [Caps and the Three-Way Decision Model](/protocol/caps-and-the-three-way-decision-model-in-cycles). For the full set of degradation strategies, see [Degradation Paths in Cycles](/how-to/how-to-think-about-degradation-paths-in-cycles-deny-downgrade-disable-or-defer).

## Containment Is the Goal, Not Just Billing

Return to the illustrative opening scenario: an onboarding agent sends 200 wrong emails while model spend remains low.

A per-run dollar budget of any reasonable amount would not have helped. The agent was cheap. It was also catastrophic.

A risk-point budget of 100, with 20 caller-assigned points per email, permits five successful reservations. If the host requires a reservation before every send, the sixth fails. That bounds the number of budgeted attempts; application authorization and delivery controls still determine whether any email may be sent.

An application policy could remove `send_email` after anomaly detection or expose only `draft_email` until human approval. A Cycles budget may return a configured tool-list cap, but the host must select and enforce it; the current server does not detect the template anomaly or tighten caps automatically.

Budget control asks: _how much can the agent spend?_ Action control asks: _what can the agent do, and how many times?_ Both questions are necessary. For many teams, the second question is the one that matters more.

The analogy is containment in the security sense. A firewall evaluates network policy; an application authorization layer evaluates tools, arguments, principals, and context. Cycles contributes a separate cumulative budget decision for the amount and scope the host submits.

This is what distinguishes a composed runtime-authority boundary from cost monitoring. Monitoring and alerting remain valuable, but the host can require authorization plus an accepted budget reservation before execution. The guarantee applies only to paths routed through and bound by that boundary.

## Putting It Together — A Dual-Authority Checklist

For every agent workflow your team builds, ask two questions:

1. **What is the dollar budget?** How much can this agent spend on model calls, tool invocations, and API fees?
2. **What are the action policy and exposure budget?** Which tools and arguments are authorized, and how much caller-assigned cumulative exposure may the agent consume?

| Question | Budget authority | Action authority |
|----------|-----------------|-----------------|
| **What unit?** | USD_MICROCENTS or TOKENS | RISK_POINTS |
| **What scope?** | Per-run, per-tenant, per-workflow | Per-run, per-tenant, per-workflow (same scopes) |
| **What enforcement?** | Reserve-commit on protected model calls | Application authorization plus reserve-commit on protected tool calls |
| **What degradation?** | Host downgrades model, reduces tokens, or skips optional steps | Host disables tools, denies high-risk actions, or switches to read-only |
| **What accounting?** | Events for known-cost calls | Events for low-risk reads |
| **What to monitor?** | Rejection rate, spend-by-scope, budget exhaustion | Risk-point consumption, tool-deny frequency, action-by-tier |

Teams that implement both dimensions have runtime authority. Teams that implement only dollar budgets have half of it — and the half they are missing is where agents do the most damage.

## Next steps

- **[AI Agent Budget Control: Enforce Hard Spend Limits](/blog/ai-agent-budget-control-enforce-hard-spend-limits)** — the companion post covering budget authority in depth
- **[5 AI Agent Failures Only Action Controls Would Prevent](/blog/ai-agent-action-failures-runtime-authority-prevents)** — the scenario-driven companion: five action failures with impact analysis
- **[5 AI Agent Failures Budget Controls Would Prevent](/blog/ai-agent-failures-budget-controls-prevent)** — failure scenarios with full cost math
- **[Understanding Units in Cycles](/protocol/understanding-units-in-cycles-usd-microcents-tokens-credits-and-risk-points)** — RISK_POINTS, USD_MICROCENTS, TOKENS, and CREDITS
- **[How Reserve-Commit Works in Cycles](/protocol/how-reserve-commit-works-in-cycles)** — the pre-execution authorization lifecycle
- **[Caps and the Three-Way Decision Model](/protocol/caps-and-the-three-way-decision-model-in-cycles)** — tool allowlists, denylists, and ALLOW_WITH_CAPS
- **[Degradation Paths in Cycles](/how-to/how-to-think-about-degradation-paths-in-cycles-deny-downgrade-disable-or-defer)** — deny, downgrade, disable, or defer
- **[End-to-End Tutorial](/quickstart/end-to-end-tutorial)** — hands-on walkthrough of the reserve-commit lifecycle
