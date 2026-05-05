---
title: "5 AI Agent Failures Only Action Controls Would Prevent"
date: 2026-03-30
author: Cycles Team
tags: [action-control, risk, incidents, best-practices]
description: "Five AI agent failures where model spend was under $5 but the business impact was severe — and how action authority with risk-point budgets prevents each one."
blog: true
sidebar: false
---

# 5 AI Agent Failures Only Action Controls Would Prevent

> **Part of: [AI Agent Risk & Blast Radius Reference](/guides/risk-and-blast-radius)** — the full pillar covering action authority, risk scoring, blast-radius containment, and degradation paths.

The companion post — [5 AI Agent Failures Budget Controls Would Prevent](/blog/ai-agent-failures-budget-controls-prevent) — covers the cost dimension: runaway loops, [retry storms](/glossary#retry-storm), scope leaks. Every scenario is measured in dollars of model spend. But agents have a second failure dimension that dollar budgets cannot touch: **actions with consequences**.

An agent that sends 200 wrong emails costs $1.40 in [tokens](/glossary#tokens). An agent that triggers a production deploy costs $0.80. An agent that deletes production records costs $2.00. No spending limit — $100, $50, even $5 — would have stopped any of them. The damage is not monetary. It is operational, reputational, and in some cases regulatory.

These five patterns come up across teams deploying agents with tool-calling capabilities. Each one is preventable with [action authority](/concepts/action-authority-controlling-what-agents-do) — the dimension of [runtime authority](/blog/what-is-runtime-authority-for-ai-agents) that controls what agents *do*, not just what they *spend*.

<!-- more -->

## How Action Authority Works

[Action authority](/glossary#action-authority) uses the same reserve-commit lifecycle as [budget authority](/glossary#budget-authority), but with a different unit: **[RISK_POINTS](/glossary#risk-points)** instead of dollars. Teams assign point values to each action class based on blast radius — a read costs 1 point, an email costs 20, a deploy costs 50. A workflow gets a fixed risk-point budget. Every consequential action deducts from it. When the budget is exhausted, the agent can still read and reason, but it cannot act.

For the full mechanism, see [Action Authority: Controlling What Agents Do](/concepts/action-authority-controlling-what-agents-do). For the unit system, see [Understanding Units in Cycles](/protocol/understanding-units-in-cycles-usd-microcents-tokens-credits-and-risk-points).

## Failure 1: The Wrong Email Template — $1.40 in Tokens, $50K+ in Pipeline

**The scenario:**

A customer-onboarding agent is tasked with sending personalized welcome emails to 200 trial accounts. A bug in the template-selection logic causes it to fall back to a collections template — "Your payment is overdue. Immediate action required." The agent sends all 200 emails in under three minutes.

This scenario is [described in detail](/blog/ai-agent-action-control-hard-limits-side-effects) in our action authority deep dive.

**The impact:**

| Metric | Value |
|---|---|
| Model spend | $1.40 |
| Emails sent | 200 |
| Support tickets generated | 34 |
| Social media complaints | 12 |
| Estimated pipeline impact | $50,000+ |

The model spend is the cost of generating 200 email bodies — a few hundred tokens each. The business impact is the result of 200 customers receiving a hostile message from a company they just signed up to evaluate. No dollar budget would have flagged this. The agent was under budget the entire time.

**How action authority prevents this:**

Assign `send_email` a cost of 20 risk points. Set the workflow's risk-point budget to 100.

| Action | Risk points | Count allowed |
|---|---|---|
| Read CRM record | 1 | ~80 before budget pressure |
| Generate email body | 1 | ~80 |
| Send email | 20 | **5** |

The agent sends 5 emails, then the 6th [reservation](/glossary#reservation) is denied with `BUDGET_EXCEEDED`. Five wrong emails is a bad day. Two hundred is a public incident. The difference is containment.

The team discovers the template bug after 5 emails instead of 200. They fix it and re-run. Total damage: 5 confused customers, zero social media complaints, zero pipeline impact.

## Failure 2: The Accidental Deploy

**The scenario:**

A coding agent is debugging a CI build failure. It reads the build logs, identifies a missing environment variable, adds it to the config, and — to verify the fix — triggers the deployment pipeline. The agent uses the production deploy command because the prompt context included a production config file. The deploy succeeds. The untested fix is now live.

**The impact:**

The agent made 4 LLM calls to diagnose the issue and 1 tool call to trigger the deploy. Total model spend: approximately $0.80. The business impact depends on what broke — but the category of harm is **production downtime from an untested change**, one of the most common and most expensive incident types in software operations.

The agent did exactly what its instructions implied: "fix the build and verify." It had no concept of "this is production" versus "this is staging." And no dollar budget would have intervened — $0.80 is well within any reasonable per-run cap.

**How action authority prevents this:**

Assign `trigger_deploy` a cost of 50 risk points. Set the debugging workflow's risk-point budget to 40.

The agent can read logs (1 point), analyze code (1 point), and suggest fixes (1 point) freely. But when it attempts to reserve 50 risk points for the deploy, the reservation is denied — the workflow budget is only 40. The agent returns: "Fix identified. Deploy requires manual approval."

Alternatively, a tool denylist can remove `trigger_deploy` entirely for debugging workflows. The agent never sees the tool as an option.

## Failure 3: The Data Cleanup Gone Wrong

**The scenario:**

A data pipeline agent is tasked with cleaning up stale test records from a database. The agent generates a query to identify records older than 90 days with a `test_` prefix. The query is correct for the test environment. But the agent is connected to the production database — a configuration error that nobody caught because the connection string was set at the environment level, not per-task.

The agent runs the delete query. The `test_` prefix filter works, but the 90-day date range also matches production records that were migrated from a legacy system with the `test_` naming convention. Production customer records are deleted.

**The impact:**

The agent made 3 LLM calls to generate and validate the query, then 1 tool call to execute it. Total model spend: approximately $2.00. The business impact is **production data loss** — requiring recovery from backup, with a window of data inconsistency for any customer who accessed their records between deletion and restore.

A $5 per-run budget would not have helped. The delete query cost pennies to generate and execute.

**How action authority prevents this:**

Assign `execute_delete` a cost of 25 risk points per batch. Set the cleanup workflow's risk-point budget to 100.

The agent can delete up to 4 batches before the budget is exhausted. If the first batch deletes unexpected records (production data instead of test data), the team catches it after a contained deletion — not after the entire dataset is gone.

For an additional layer: a tool denylist can block `execute_delete` for any agent running outside a designated test environment. The configuration error that connected the agent to production would be caught at the action-authority layer, not discovered after the data is gone.

## Failure 4: The Slack Leak

**The scenario:**

A support agent is debugging a customer issue. It needs to check internal logs and share findings with the support team. The agent posts a diagnostic message — including internal system names, error codes, and a reference to another customer's [tenant](/glossary#tenant) ID — to a Slack channel. The wrong Slack channel. Instead of `#support-internal`, the message goes to `#acme-corp-support`, a shared channel visible to the customer.

**The impact:**

The agent made 2 LLM calls to analyze the issue and 1 tool call to post the message. Total model spend: approximately $0.30. The business impact is a **data [exposure](/glossary#exposure) incident** — internal infrastructure details and another customer's tenant ID are visible to an external party. Depending on the industry and the data involved, this can trigger a security review, a customer notification obligation, or a compliance investigation.

A $2 per-conversation budget would not have prevented this. The agent was well within any cost limit. The problem was not how much it spent but *where it posted*.

**How action authority prevents this:**

Two mechanisms, layered:

1. **Channel allowlist.** The agent's Slack integration is configured with an allowlist of internal channels. Messages to channels not on the list are denied before sending. The `#acme-corp-support` channel is external — the reservation is denied.

2. **Risk-point budget.** Assign `send_slack_message` a cost of 20 risk points, with the external-channel variant at 50 points (or denied entirely). The agent can post freely to internal channels but cannot reach customer-facing channels without explicit authorization.

The diagnostic message is blocked. The agent returns: "Cannot post to #acme-corp-support — external channel. Posted to #support-internal instead." The customer never sees the internal details.

## Failure 5: The Ticket Storm

**The scenario:**

A workflow agent processes error reports from a monitoring system. For each distinct error, it creates a Jira ticket with the stack trace, affected service, and suggested severity. A parsing bug causes the agent to split a single multi-line stack trace into individual lines, interpreting each line as a separate error.

A 50-line stack trace becomes 50 tickets. The monitoring system had 10 error reports queued. The agent creates hundreds of tickets in under 8 minutes — all assigned to the same on-call team, all triggering email notifications, all appearing in the team's Jira board.

**The impact:**

The agent made approximately 15 LLM calls (parsing + ticket generation) and hundreds of `create_ticket` tool calls. Total model spend: approximately $3.50. The business impact is **operational disruption** — the on-call team's Jira board is flooded, their inboxes are full of notifications, and downstream automations (Slack alerts, PagerDuty escalations) fire for each ticket. The team spends time triaging and bulk-closing duplicate tickets instead of investigating the actual errors.

A per-run dollar budget would not have caught this. The LLM calls are cheap. The damage is in the *volume of actions*, not the cost of generating them.

**How action authority prevents this:**

Assign `create_ticket` a cost of 20 risk points. Set the error-processing workflow's risk-point budget to 200.

| Budget state | Tickets created | Agent behavior |
|---|---|---|
| 0–200 points consumed | Up to 10 tickets | Normal operation |
| 200 points consumed | 10 tickets | Budget exhausted — further ticket creation denied |
| After denial | 0 | Agent returns: "Created 10 tickets. Stopped — ticket budget exhausted. Remaining errors queued for review." |

The team investigates the parsing bug with 10 tickets instead of hundreds. The actual errors are surfaced. The notification cascade never happens.

## The Common Pattern

Five failures. Five different root causes — template bugs, environment confusion, query scope errors, channel misrouting, parsing defects. But they share one architectural gap: **no pre-execution action check**.

In every case, the agent was allowed to act without asking permission. The system discovered the consequences after the fact — through customer complaints, incident reports, or manual review. By then, the emails were sent, the deploy was live, the records were deleted, the message was visible, and the tickets were created.

| Failure | Model Spend | Impact Category | Prevention | With Action Authority |
|---|---|---|---|---|
| Wrong email template | $1.40 | Reputational — [$50K+ pipeline](/blog/ai-agent-action-control-hard-limits-side-effects) | 20 risk pts/email, 100 budget | 5 emails instead of 200 |
| Accidental deploy | ~$0.80 | Operational — production downtime | 50 risk pts/deploy, or denylist | Denied before execution |
| Data deletion | ~$2.00 | Data loss — backup recovery required | 25 risk pts/batch, 100 budget | Stopped after 4 batches |
| Slack leak | ~$0.30 | Security — data exposure | Channel allowlist | Blocked to internal only |
| Ticket storm | ~$3.50 | Operational — notification cascade | 20 risk pts/ticket, 200 budget | 10 tickets instead of hundreds |

Total model spend across all five scenarios: **under $8.** No dollar budget — $100, $50, $10, even $5 — would have prevented any of them. The common thread is not cost. It is **consequence**.

## From cost control to runtime authority

Budget authority and action authority are two dimensions of the same architecture. Both use the reserve-commit lifecycle. Both enforce limits before execution, not after. Both support hierarchical scoping (tenant, workspace, workflow, run). Both degrade gracefully when budgets are exhausted.

The difference is the unit of account. Budget authority counts dollars. Action authority counts consequences — measured in risk points, scoped by toolset, enforced by the same infrastructure.

Teams that implement only dollar budgets have half of [runtime authority](/blog/what-is-runtime-authority-for-ai-agents). The half they are missing is where agents cause the most damage — not by spending too much, but by doing the wrong thing.

## Next steps

- **[5 AI Agent Failures Budget Controls Would Prevent](/blog/ai-agent-failures-budget-controls-prevent)** — the companion post covering the cost dimension
- **[AI Agent Action Control: Hard Limits on Side Effects](/blog/ai-agent-action-control-hard-limits-side-effects)** — deep dive on RISK_POINTS, toolset budgets, and progressive capability narrowing
- **[Action Authority](/concepts/action-authority-controlling-what-agents-do)** — the concept page
- **[Understanding Units in Cycles](/protocol/understanding-units-in-cycles-usd-microcents-tokens-credits-and-risk-points)** — RISK_POINTS, [USD_MICROCENTS](/glossary#usd-microcents), TOKENS, and [CREDITS](/glossary#credits)
- **[Degradation Paths](/how-to/how-to-think-about-degradation-paths-in-cycles-deny-downgrade-disable-or-defer)** — deny, downgrade, disable, or defer when action budgets are exhausted
- **[End-to-End Tutorial](/quickstart/end-to-end-tutorial)** — hands-on walkthrough of the reserve-commit lifecycle
