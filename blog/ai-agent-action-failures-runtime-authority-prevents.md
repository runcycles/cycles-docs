---
title: "5 Action-Risk Scenarios and Control Patterns"
date: 2026-03-30
author: Cycles Team
tags: [action-control, risk, incidents, best-practices]
description: "Five illustrative low-token, high-impact agent action scenarios, with application authorization and caller-assigned RISK_POINTS patterns to contain each one."
blog: true
sidebar: false
head:
  - - meta
    - name: keywords
      content: AI agent failures, action controls, runtime authority, risk budgets, agent side effects, pre-execution enforcement
---

# 5 Action-Risk Scenarios and Control Patterns

> **Part of: [AI Agent Risk & Blast Radius Reference](/guides/risk-and-blast-radius)** — the full pillar covering action authority, risk scoring, blast-radius containment, and degradation paths.

The companion post — [5 Agent Cost Failures Runtime Budgets Can Bound](/blog/ai-agent-failures-budget-controls-prevent) — covers runaway loops, [retry storms](/glossary#retry-storm), and scope leaks with checked cost models. Agents have a second failure dimension that dollar budgets alone do not measure: **actions with consequences**.

The five cases below are constructed scenarios, not reports of identified incidents. Their token-cost figures are illustrative estimates. They show how an inexpensive model call can trigger an email, deploy, delete, message, or ticket with much larger external consequences.

Containment requires a composed boundary: application [action authority](/concepts/action-authority-controlling-what-agents-do) decides whether a principal may use a tool with particular arguments, while Cycles can meter caller-assigned cumulative exposure through `RISK_POINTS`. Neither layer substitutes for the other.

<!-- more -->

## How Action Authority Works

Applications can use the Cycles reserve-commit lifecycle with **[RISK_POINTS](/glossary#risk-points)** instead of dollars. Teams assign point values to authorized action classes — for example, a read costs 1 point, an email 20, and a deploy 50 — and require a reservation before each protected action. When that budget is exhausted, positive-risk reservations fail. The host still decides which tools are authorized and whether zero-risk actions remain available.

For the full mechanism, see [Action Authority: Controlling What Agents Do](/concepts/action-authority-controlling-what-agents-do). For per-tool point assignment, see [Assigning RISK_POINTS to agent tools](/how-to/assigning-risk-points-to-agent-tools). For the unit system, see [Understanding Units in Cycles](/protocol/understanding-units-in-cycles-usd-microcents-tokens-credits-and-risk-points).

## Failure 1: The Wrong Email Template

**The scenario:**

A customer-onboarding agent is tasked with sending personalized welcome emails to 200 trial accounts. A bug in the template-selection logic causes it to fall back to a collections template — "Your payment is overdue. Immediate action required." The agent sends all 200 emails in under three minutes.

This scenario is [described in detail](/blog/ai-agent-action-control-hard-limits-side-effects) in our action authority deep dive.

**The impact:**

| Metric | Value |
|---|---|
| Model spend | $1.40 |
| Emails sent | 200 |
| Customer/support impact | Unquantified in this constructed scenario |
| Pipeline impact | Unquantified in this constructed scenario |

The modeled spend covers generating 200 short email bodies. The external impact is not derived from token cost. A monetary budget calibrated for normal model usage might accept every call even though the template is wrong.

**How action authority prevents this:**

Assign `send_email` a cost of 20 risk points. Set the workflow's risk-point budget to 100.

| Action | Risk points | Count allowed |
|---|---|---|
| Read CRM record | 1 | ~80 before budget pressure |
| Generate email body | 1 | ~80 |
| Send email | 20 | **5** |

If the host requires a reservation before every send, five email reservations consume 100 points and the sixth fails with `BUDGET_EXCEEDED`. This bounds budgeted sends; it does not validate the template.

Alerting or review can then surface the template bug, but Cycles alone does not guarantee discovery or determine the resulting customer impact.

## Failure 2: The Accidental Deploy

**The scenario:**

A coding agent is debugging a CI build failure. It reads the build logs, identifies a missing environment variable, adds it to the config, and — to verify the fix — triggers the deployment pipeline. The agent uses the production deploy command because the prompt context included a production config file. The deploy succeeds. The untested fix is now live.

**The impact:**

The agent made 4 LLM calls to diagnose the issue and 1 tool call to trigger the deploy. Total model spend: approximately $0.80. The business impact depends on what broke — but the category of harm is **production downtime from an untested change**, one of the most common and most expensive incident types in software operations.

The agent did exactly what its instructions implied: "fix the build and verify." It had no concept of "this is production" versus "this is staging." And no dollar budget would have intervened — $0.80 is well within any reasonable per-run cap.

**How action authority prevents this:**

Assign `trigger_deploy` a cost of 50 risk points. Set the debugging workflow's risk-point budget to 40.

If the host classifies deploy as 50 points and requires a reservation, a 40-point workflow budget rejects that request. Application policy can separately require manual approval and can return: "Fix identified. Deploy requires manual approval."

Alternatively, the host can omit `trigger_deploy` from debugging workflows or enforce a denylist. A Cycles budget may return a configured denylist cap, but the host must apply it.

## Failure 3: The Data Cleanup Gone Wrong

**The scenario:**

A data pipeline agent is tasked with cleaning up stale test records from a database. The agent generates a query to identify records older than 90 days with a `test_` prefix. The query is correct for the test environment. But the agent is connected to the production database — a configuration error that nobody caught because the connection string was set at the environment level, not per-task.

The agent runs the delete query. The `test_` prefix filter works, but the 90-day date range also matches production records that were migrated from a legacy system with the `test_` naming convention. Production customer records are deleted.

**The impact:**

The agent made 3 LLM calls to generate and validate the query, then 1 tool call to execute it. Total model spend: approximately $2.00. The business impact is **production data loss** — requiring recovery from backup, with a window of data inconsistency for any customer who accessed their records between deletion and restore.

A $5 per-run budget would not have helped. The delete query cost pennies to generate and execute.

**How action authority prevents this:**

Application authorization should validate the target environment, database identity, query shape, and approval requirements before any delete. Separately, assigning `execute_delete` 25 risk points per batch against a 100-point budget bounds the caller-assigned cumulative exposure to four successful reservations.

That budget does not detect that the connection points to production or that the query matches the wrong records. Environment-scoped credentials, database permissions, argument validation, and review remain the controls that prevent the first destructive batch.

## Failure 4: The Slack Leak

**The scenario:**

A support agent is debugging a customer issue. It needs to check internal logs and share findings with the support team. The agent posts a diagnostic message — including internal system names, error codes, and a reference to another customer's [tenant](/glossary#tenant) ID — to a Slack channel. The wrong Slack channel. Instead of `#support-internal`, the message goes to `#acme-corp-support`, a shared channel visible to the customer.

**The impact:**

The agent made 2 LLM calls to analyze the issue and 1 tool call to post the message. Total model spend: approximately $0.30. The business impact is a **data [exposure](/glossary#exposure) incident** — internal infrastructure details and another customer's tenant ID are visible to an external party. Depending on the industry and the data involved, this can trigger a security review, a customer notification obligation, or a compliance investigation.

A $2 per-conversation budget would not have prevented this. The agent was well within any cost limit. The problem was not how much it spent but *where it posted*.

**How action authority prevents this:**

Two mechanisms, layered:

1. **Channel allowlist.** The Slack integration enforces an allowlist of internal channels before sending. The `#acme-corp-support` channel is external, so application authorization rejects it.

2. **Risk-point budget.** Assign `send_slack_message` a cost of 20 risk points, with the external-channel variant at 50 points (or denied entirely). The agent can post freely to internal channels but cannot reach customer-facing channels without explicit authorization.

With both layers enforced, the application blocks the external-channel message while Cycles can bound the submitted exposure of allowed messages.

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
| Wrong email template | Illustrative $1.40 | Customer/reputational impact, unquantified | Template validation + 20 risk pts/email, 100 budget | At most 5 budgeted sends; content still needs validation |
| Accidental deploy | ~$0.80 | Operational — production downtime | 50 risk pts/deploy, or denylist | Denied before execution |
| Data deletion | ~$2.00 | Data loss — backup recovery required | 25 risk pts/batch, 100 budget | Stopped after 4 batches |
| Slack leak | ~$0.30 | Security — data exposure | Channel allowlist | Blocked to internal only |
| Ticket storm | ~$3.50 | Operational — notification cascade | 20 risk pts/ticket, 200 budget | 10 tickets instead of hundreds |

The approximate model-spend figures across these constructed scenarios total under $8, but they are not measured incident data. A dollar budget sized for routine model use may accept each case because the consequential action, not token spend, carries the larger risk.

## From cost control to runtime authority

Budget authority and action authority are complementary parts of one architecture. Cycles can use reserve-commit for spend and caller-assigned exposure at protocol subject scopes. Application policy enforces tool and argument permissions and chooses any graceful-degradation behavior.

The difference is the unit of account. Budget authority counts dollars. Action authority counts consequences — measured in risk points, scoped by toolset, enforced by the same infrastructure.

Teams that implement only dollar budgets still need identity, application authorization, argument validation, and outcome logging. Adding an exposure budget can bound repetition, but it does not make an authorized action safe.

## Next steps

- **[5 AI Agent Failures Budget Controls Would Prevent](/blog/ai-agent-failures-budget-controls-prevent)** — the companion post covering the cost dimension
- **[AI Agent Action Control: Hard Limits on Side Effects](/blog/ai-agent-action-control-hard-limits-side-effects)** — deep dive on RISK_POINTS, toolset budgets, and progressive capability narrowing
- **[Action Authority](/concepts/action-authority-controlling-what-agents-do)** — the concept page
- **[Understanding Units in Cycles](/protocol/understanding-units-in-cycles-usd-microcents-tokens-credits-and-risk-points)** — RISK_POINTS, [USD_MICROCENTS](/glossary#usd-microcents), TOKENS, and [CREDITS](/glossary#credits)
- **[Degradation Paths](/how-to/how-to-think-about-degradation-paths-in-cycles-deny-downgrade-disable-or-defer)** — deny, downgrade, disable, or defer when action budgets are exhausted
- **[End-to-End Tutorial](/quickstart/end-to-end-tutorial)** — hands-on walkthrough of the reserve-commit lifecycle
