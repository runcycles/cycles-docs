---
title: "AI Agent Action Control: Hard Limits on Side Effects"
date: 2026-03-19
author: Cycles Team
tags: [action-control, risk, agents, engineering, best-practices]
description: "Why controlling what AI agents DO matters more than controlling what they spend — and how to enforce hard limits on emails, deploys, and file writes."
blog: true
sidebar: false
---

# AI Agent Action Control: Hard Limits on Side Effects

> **Part of: [AI Agent Risk & Blast Radius Reference](/guides/risk-and-blast-radius)** — the full pillar covering action authority, risk scoring, blast-radius containment, and degradation paths.

A customer-onboarding agent is tasked with sending personalized welcome emails to 200 trial accounts. A bug in the template-selection logic causes it to fall back to a collections template — "Your payment is overdue. Immediate action required." The agent sends all 200 emails in under three minutes. Total model spend: $1.40. Total business impact: 34 support tickets, 12 public complaints on social media, and a customer-churn spike that the sales team estimates at over $50,000 in lost pipeline. No spending limit would have caught this. The agent was under budget the entire time.

The problem was not spend. The problem was that the agent _acted_ — and nobody checked what it was about to do.

<!-- more -->

## Budget Control Is Not Action Control

Most teams equate "agent control" with "cost control." They set dollar budgets, track token usage, alert on spend thresholds. That covers one dimension — money — but agents have a second, more dangerous dimension: **side effects**.

Side effects are the actions an agent takes in the world. Sending emails. Creating Jira tickets. Writing files to disk. Deleting database records. Triggering CI/CD pipelines. Kicking off production deploys. Calling external APIs that charge money, move data, or change state in systems your team doesn't own.

The critical property of side effects is **irreversibility**. A sent email cannot be unsent. A triggered deploy is live. A deleted record may not be recoverable. A Slack message to a customer channel cannot be retracted without notice. These are consequences that persist after the agent stops — and no amount of post-hoc cost reconciliation changes what already happened.

This is why [Cycles](/) is positioned as **[runtime authority](/glossary#runtime-authority)**, not just [budget authority](/glossary#budget-authority). Runtime authority is the umbrella: it covers both how much the agent spends (budget authority) and what the agent does ([action authority](/glossary#action-authority)). Both are enforced through a shared protocol, a common lifecycle, and the same infrastructure. Budget authority is the subset most teams implement first. Action authority is the subset where the costliest incidents live.

| Dimension | What it limits | Example controls | What happens if missing |
|-----------|---------------|------------------|------------------------|
| **Budget authority** | How much the agent spends | Per-run dollar cap, per-[tenant](/glossary#tenant) quota | Runaway cost — [$4,200 tool loops, $12,400 weekend batches](/blog/ai-agent-failures-budget-controls-prevent) |
| **Action authority** | What the agent does | Tool allowlist/denylist, risk-point caps, per-action [reservation](/glossary#reservation) | Wrong emails sent, accidental deploys, unauthorized file writes, data deletion |

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

**Reserve-commit** is pre-execution authorization. Before the agent sends the email, writes the file, or triggers the deploy, it calls the [Cycles server](/glossary#cycles-server) to request permission. The server checks the available budget (whether that budget is denominated in dollars, [tokens](/glossary#tokens), or risk points), makes an allow/deny decision, and returns the result. Only if the decision is ALLOW does the agent proceed. After execution, the agent commits the actual cost or risk consumed.

**Events** are post-hoc accounting. The agent takes the action first, then records what it did. There is no pre-execution check — the action already happened. Events are useful for low-risk actions where the overhead of a pre-execution round-trip is not justified, or for situations where the action completed outside of Cycles entirely and you need to record it for accounting purposes.

| Pattern | Mechanism | When to use | Trade-off |
|---------|-----------|-------------|-----------|
| **Reserve before execution** | `POST /v1/reservations` → execute → `POST /v1/reservations/{id}/commit` | Consequential actions: emails, deploys, deletes, external API calls | Adds one round-trip of latency, but provides pre-execution veto |
| **Record after execution** | `POST /v1/events` | Low-risk actions: reads, searches, internal logging, known-cost operations | No latency cost, but no pre-execution control |

The key insight is that **the choice between these two patterns is not about technical capability — it is about risk tolerance**. If the action is reversible and low-impact, record it after the fact. If the action creates consequences that persist beyond the agent's runtime, authorize it before execution.

For the full reserve-commit lifecycle, see [How Reserve-Commit Works in Cycles](/protocol/how-reserve-commit-works-in-cycles). For the event pattern, see [How Events Work in Cycles](/protocol/how-events-work-in-cycles-direct-debit-without-reservation).

## RISK_POINTS — Budgeting What Money Cannot Measure

Dollar budgets are the wrong unit for action authority. The opening scenario makes this clear: 200 emails cost $1.40 in model spend. A per-run budget of $100, $50, even $5 would not have stopped a single email. The risk was not monetary. It was reputational, operational, and ultimately commercial — $50,000 in lost pipeline from a $1.40 agent run.

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

For the full unit system including [USD_MICROCENTS](/glossary#usd-microcents), TOKENS, [CREDITS](/glossary#credits), and RISK_POINTS, see [Understanding Units in Cycles](/protocol/understanding-units-in-cycles-usd-microcents-tokens-credits-and-risk-points).

## Tool Allowlists and Denylists — Capability Control Under Pressure

Risk points cap the _volume_ of consequential actions. But sometimes you need to control _which_ actions are available at all. Cycles provides this through **tool allowlists and denylists**, returned as part of the ALLOW_WITH_CAPS decision.

When an agent requests a reservation and the server determines that the action is allowed but should be constrained, it returns `decision: ALLOW_WITH_CAPS` along with a `caps` object. That object can include:

- **`tool_allowlist`** — only these tools may be used (everything else is implicitly denied)
- **`tool_denylist`** — these specific tools are blocked (everything else is allowed)
- **`max_steps_remaining`** — the agent has this many steps left before it must stop

This enables a pattern teams can implement on their server: **progressive capability narrowing** — a degradation strategy where the server narrows an agent's available tools as risk-point budget runs low. For example, an operator might assign risk points per tool and configure narrowing thresholds:

| Tool | Risk points | Tier |
|------|:----------:|------|
| `read_file`, `search` | 1 | Read |
| `create_draft` | 5 | Write-local |
| `send_email` | 20 | Write-external |
| `create_ticket` | 20 | Write-external |
| `deploy` | 50 | Execution |

With a 100-point risk budget per run, the server applies progressive narrowing:

| Risk budget consumed | Decision | Caps applied | Effect |
|:-------------------:|----------|-------------|--------|
| 0–50% | ALLOW | _(none)_ | Full tool access |
| 50–80% | ALLOW_WITH_CAPS | `tool_denylist: ["deploy", "send_email"]` | High-blast-radius actions disabled |
| 80–100% | ALLOW_WITH_CAPS | `tool_allowlist: ["read_file", "search"]` | Read-only mode |
| 100% | DENY | — | No further actions |

The agent degrades gracefully instead of hard-stopping. It can still complete useful work — reading files, running searches, generating summaries — while the most dangerous capabilities are removed from its reach. This is the "disable" degradation strategy applied to action authority rather than cost control.

For the [three-way decision](/glossary#three-way-decision) model (ALLOW, ALLOW_WITH_CAPS, DENY) and how caps flow through the system, see [Caps and the Three-Way Decision Model](/protocol/caps-and-the-three-way-decision-model-in-cycles). For the full set of degradation strategies, see [Degradation Paths in Cycles](/how-to/how-to-think-about-degradation-paths-in-cycles-deny-downgrade-disable-or-defer).

## Containment Is the Goal, Not Just Billing

Return to the opening scenario. An onboarding agent sends 200 wrong emails. Total model spend: $1.40.

A per-run dollar budget of any reasonable amount would not have helped. The agent was cheap. It was also catastrophic.

A risk-point budget of 100, with 20 points per email, would have stopped the agent after 5 emails. Five wrong emails is a bad day. Two hundred wrong emails is a public incident. The difference is containment.

A tool denylist that removed `send_email` after the first anomalous batch — or an allowlist that restricted the agent to `draft_email` instead of `send_email` until a human approved — would have caught the template bug before a single email reached a customer.

Budget control asks: _how much can the agent spend?_ Action control asks: _what can the agent do, and how many times?_ Both questions are necessary. For many teams, the second question is the one that matters more.

The analogy is containment in the security sense. A firewall does not care how much traffic costs. It cares what the traffic _does_ — which ports it targets, which payloads it carries, which systems it reaches. Runtime authority for agents is the same principle applied to a different domain. The question is not "how much did this cost?" but "should this action be allowed to happen at all?"

This is what distinguishes runtime authority from cost monitoring. Monitoring tells you what happened. Alerting tells you that something happened. Runtime authority decides, before the action executes, whether it _should_ happen. That pre-execution decision point is the difference between a $50,000 incident and a contained anomaly that surfaces in a log.

## Putting It Together — A Dual-Authority Checklist

For every agent workflow your team builds, ask two questions:

1. **What is the dollar budget?** How much can this agent spend on model calls, tool invocations, and API fees?
2. **What is the action budget?** How many consequential actions can this agent take, and which actions should be available at all?

| Question | Budget authority | Action authority |
|----------|-----------------|-----------------|
| **What unit?** | USD_MICROCENTS or TOKENS | RISK_POINTS |
| **What scope?** | Per-run, per-tenant, per-workflow | Per-run, per-tenant, per-workflow (same scopes) |
| **What enforcement?** | Reserve-commit on model calls | Reserve-commit on consequential tool calls |
| **What degradation?** | Downgrade model, reduce tokens, skip optional steps | Disable tools, deny high-risk actions, switch to read-only |
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
