---
title: "We Put Cycles in Front of Our Own Outreach Agent"
date: 2026-05-09
author: Evan Mavashev
tags:
  - case-study
  - runtime-authority
  - budgets
  - action-control
  - operations
  - agents
description: "A dogfood field report on governing a real autonomous outreach agent with Cycles — Gmail drafts, Slack review, budget caps, and DENY on external send."
blog: true
sidebar: false
featured: false
head:
  - - meta
    - name: keywords
      content: "AI agent governance, autonomous outreach agent, agent budget control, action authority, Gmail agent, Slack review workflow, runtime authority, pre-execution guardrails, BUDGET_EXCEEDED, Cycles dogfood"
---

# We Put Cycles in Front of Our Own Outreach Agent

The outreach workflow looked small on paper.

Find public signals from founders and maintainers building agent products. Decide who is worth contacting. Draft a short email. Put it in Gmail. Mirror it to Slack. Track the person in Attio. Watch for replies. Follow up later.

That is not a complicated product.

It is, however, an agent system with real side effects. It can spend LLM budget. It can write CRM state. It can create external-facing drafts. If the send boundary is wrong, it can contact people without approval.

So we put Cycles in front of it.

<!-- more -->

The result we cared about was not that the agent created six drafts. It was that when the normal external-send path tried to run, [Cycles](/blog/what-is-runtime-authority-for-ai-agents) returned `409 BUDGET_EXCEEDED`, left the draft for review, and blocked the side effect.

This is a dogfood report from a real internal workflow — a companion piece to [how scalerX wired Cycles into a Java agent runtime](/blog/how-scalerx-wired-cycles-into-a-java-agent-runtime), but from inside our own runner. What we wrapped, what Cycles blocked, what the ledger showed, and what still needs work.

## The agent system we governed

The runner now lives on a small Linux VM with systemd, not in a local Codex session.

The production shape is:

1. A daily sourcer finds new public artifacts from high-traction agent projects.
2. A triage phase classifies signals as `skip`, `queue`, or `research_now`.
3. A synthesis phase writes concise first-touch drafts only when there is a concrete public pain point.
4. A reviewer phase rejects drafts that are too long, too salesy, too vague, or likely to trip spam filters.
5. Gmail creates real drafts in Evan's mailbox.
6. A Slack bot posts the draft text into `#all-runcycles` for review.
7. Attio stores the CRM state.
8. Sent-sync detects manually sent emails and starts the sequence.
9. Reply-sync checks Gmail every five minutes and alerts Slack when a prospect replies.
10. A daily audit posts what happened, what failed, and what needs attention.

External email stays draft-only. The system can prepare the message, but Evan still sends from Gmail.

That boundary is intentional. The first version of an outreach agent should not be trusted with automatic external send. It should earn that trust with receipts.

## The authority boundaries

Cycles governs two different things in this workflow.

The first is spend.

LLM-heavy research and synthesis run against a `research-live` toolset. The current live allocation is `$50.0000`, with a separate daily cap of `$11.0000`. (The four-decimal display is the Cycles ledger reporting in `USD_MICROCENTS` — not a typo.) The daily cap is not a provider cap. It is an operator policy for this workflow. The runner checks it before and after phases, and the [budget-check timer posts proactive Slack warnings](/blog/real-time-budget-alerts-for-ai-agents) before the system hits a hard denial.

The second is action authority.

External send is a separate toolset from research. In our runner, the internal toolset is named `send-email` (with `send-email-approved` as the explicit-approval variant), but the governed action is the email-send boundary itself — a real external side effect. In the canonical [Cycles action-kind registry](/protocol/), this maps to `message.email.send`. The default `send-email` path has a `$0.0000` allocation, so the normal answer is DENY unless the explicit approval path is used — the same pattern walked through in [the action authority demo](/blog/action-authority-demo-support-agent-walkthrough), where setting a toolset budget to zero makes the reservation fail at the runtime gate.

That matters because the expensive mistake in outreach is not only cost. It is contacting the wrong person, sending a half-reviewed draft, sending too often, or continuing after someone has replied. Token spend is one exposure. External communication is another. [Cycles lets those exposures be budgeted separately](/blog/ai-agent-action-control-hard-limits-side-effects).

The workflow can be allowed to research while being denied permission to send.

That is the useful split.

## What happened in the first live runs

The first high-traction sourcer run targeted agent products and infrastructure projects with visible adoption: coding agents, browser agents, multi-agent frameworks, agent workflow systems, and runtime surfaces where budget or action authority is an obvious pain. After triage, the queue settled at 123 signals to research now, 35 queued, and 194 skipped.

The first production-style pass created six Gmail drafts and six Slack review posts. It also left two contacts in `needs_email` because the system could not verify a direct email address.

| Output | Count |
|---|---:|
| Gmail drafts created | 6 |
| Slack review posts | 6 |
| contacts needing verified email | 2 |
| follow-ups due at that moment | 0 |

The reviewer rejected 10 drafts that day. That is a good outcome, not a failure.

The reviewer exists because outreach copy is an action surface. A draft can be technically correct and still be too long, too transactional, too salesy, or too close to spam-trigger language. The system rejected drafts over the word limit and drafts that used language the operator explicitly did not want: payment, contract, price, revenue, and other terms that make a helpful technical note feel like a sales pitch.

That is governance too. Not every boundary is a dollar boundary — a similar logic shows up in [policy drift in AI agents](/blog/policy-drift-in-ai-agents), where reviewer rules need their own enforcement story.

## The budget receipts

The useful part of dogfooding Cycles is that the system [leaves receipts](/blog/runtime-authority-byproducts-audit-trail-and-attribution-by-default).

During the refactor and rollout, we saw both happy paths and failure paths on the [reserve → commit lifecycle](/protocol/how-reserve-commit-works-in-cycles):

| Receipt | Status | What it proved |
|---|---|---|
| `f3ce6250...` | RELEASED | A Pydantic exception released the reservation instead of leaking budget. |
| `7967032f...` | COMMITTED at `$0.1905` | A successful synthesis committed actual spend. |
| `send-email` | `409 BUDGET_EXCEEDED` (DENY) | The default external-send route was blocked by the zero-dollar budget. |
| `send-email-approved` | ALLOW + COMMIT | The explicit approval path could pass the action gate. |

The important one is the DENY.

At one point the runner attempted the normal outreach flow, but the action-authority gate returned `409 BUDGET_EXCEEDED` on the default send path. The system still updated Attio and created a Gmail draft, but it did not send externally. The result was logged as `pending_human_approval`.

That is exactly the desired failure mode.

The workflow did useful internal work. The external side effect did not happen.

## The cost picture

After the live `research-live` toolset was created, a manual daily run spent:

| Scope | Spend |
|---|---:|
| `process-high-traction / toolset:research-live` | `$1.3155` |

At that point the ledger reported:

| Metric | Value |
|---|---:|
| total allocated | `$61.6000` |
| total spent | `$10.8157` |
| total remaining | `$50.7843` |
| daily cap | `$11.0000` |
| spent that day after baseline | `$1.3155` |
| daily remaining | `$9.6845` |
| `research-live` remaining | `$48.6845` |

The earlier `research` and `research-rerun` toolsets were nearly exhausted:

| Toolset | Remaining |
|---|---:|
| `research` | `$0.2924` |
| `research-rerun` | `$0.2075` |

Those warnings were real, but they were also historical. The active workflow had moved to `research-live`. We added warning filters so retired toolsets still appear in the balance report but do not keep paging the operator.

That distinction is small and operationally important: the ledger should show everything, while alerts should focus on budgets that can block the next run.

## What broke

Several things broke before the system became boring enough to leave on.

The first was underfunding.

The initial budget setup was 10x smaller than intended because of a microcent conversion mistake. That turned out to be useful for the demo because it forced real denials quickly. It was less useful for a production runner. The fix was to create a new `research-live` toolset with a fresh `$50.0000` allocation and keep the daily cap at `$11.0000`.

The second was admin-plane mutation hardening.

The runtime path did what mattered: reserve, commit, release, and deny worked. Budget create and lookup worked too. But mutation operations against existing budgets in the running 0.1.25.x stack were not boring enough yet. Some `PATCH`, `DELETE`, and `fund` paths returned HTTP 500, while recreating the same scope returned `409 Conflict` (a different 409 from the runtime `409 BUDGET_EXCEEDED` — same code, different layer). The workaround was to provision a new scope instead of mutating the old one.

That is not the operator experience we want. It is now a hardening item.

The third was Slack delivery.

Early Slack review posts failed because the original webhook path was not configured. The production path now uses a real Slack bot named `Cycles Outreach`, with `chat.postMessage`, and systemd `OnFailure=` alerts for crashes before Python can catch them.

The fourth was Gmail OAuth.

The one-time OAuth setup was manual. Once the refresh token was stored on the VM, draft creation and sent/reply scanning worked, but the setup path is still operator-heavy.

None of these were agent reasoning problems. They were integration, credential, and operations problems.

That is the point. Real agent systems fail around the edges: budgets, credentials, queues, retries, notifications, and side effects. Runtime authority has to live where those edges are.

## What runs without a laptop

The VM now owns the loop.

There are five systemd timers:

| Timer | Purpose |
|---|---|
| `cycles-outreach-daily.timer` | Run the daily scrape, triage, draft, sync, and audit loop. |
| `cycles-outreach-mirror.timer` | Mirror unposted Gmail drafts into Slack hourly. |
| `cycles-outreach-sent-sync.timer` | Detect manually sent Gmail drafts hourly. |
| `cycles-outreach-reply-sync.timer` | Detect inbound replies about every five minutes. |
| `cycles-outreach-budget-check.timer` | Post proactive budget warnings hourly. |

Failures post to Slack immediately when possible and fall back to `runner_errors.jsonl` and the systemd journal if Slack itself fails.

The daily audit includes:

| Audit field | Example from run |
|---|---:|
| triage counts | `research_now: 123`, `queue: 35`, `skip: 194` |
| lifecycle counts | `draft_ready: 3`, `needs_email: 2`, `active_sequence: 2` |
| reviewer rejects | `10` |
| Gmail drafts | `6` |
| Slack review posts | `6` |
| replies detected | `0` at the time of audit |
| errors | `0` after alert-test noise was cleared |

The audit is not just a summary. It is the operator contract. If the VM runs while everyone is offline, the audit says what it did.

## Follow-ups are a separate control surface

The lifecycle system tracks outreach as a sequence, not a one-off send.

Current policy:

1. First touch only after a specific public artifact.
2. If there is no reply, schedule follow-up 1 after 3 days.
3. Follow-up 2 comes 5 days later.
4. Follow-up 3 comes 7 days after that.
5. After three unanswered follow-ups, stop the active sequence but keep watch mode on.
6. If the person later posts a new relevant issue, PR, or public artifact, draft a new contextual follow-up.
7. Stop on reply, negative reply, explicit opt-out, bounce, or manual suppression.

Reply detection already runs every five minutes and alerts Slack. Sent detection already moves manually sent drafts into `active_sequence`.

At the time of writing, the dedicated follow-up draft writer is the next piece to finish. The scheduling, watch mode, reply stop, and CRM sync are in place. The remaining work is to generate same-thread Gmail follow-up drafts from due lifecycle rows and fresh watched-contact signals.

That split is worth preserving. A follow-up is not "send another email." It is a new decision with context: did they reply, did they opt out, how many times have we touched them, is this a fresh signal, and is the timing reasonable?

## The runtime authority lesson

Before Cycles, it is tempting to describe this as an outreach automation.

That undersells the control problem.

[Agents are cross-cutting](/blog/agents-are-cross-cutting-your-controls-arent), and this system has at least five distinct decision surfaces — sitting across two authority domains (budget and action) plus an upstream policy filter and a downstream lifecycle gate:

| Decision surface | Where it lives |
|---|---|
| Should we spend LLM budget researching this signal? | Budget authority |
| Should this draft pass voice and spam-risk review? | Policy filter (pre-action) |
| Should Gmail create a draft? | Action authority — tool-allowlist mechanism |
| Should an external email be sent? | Action authority — toolset budget mechanism |
| Should this contact stay in the follow-up sequence? | Lifecycle gate |

Those decisions do not belong in one prompt. They do not belong in one provider dashboard. They do not belong in a local loop counter.

They belong in the runtime path.

Cycles did not make the agent smarter. It made the agent bounded.

The most useful result was not that six drafts were created. The useful result was that the system could show, with numbers, what it did:

- how many signals it found
- how many it rejected
- how many drafts it created
- which phase spent money
- which budget would block the next run
- which action path was denied
- which contacts still need verified email
- whether anyone replied
- whether failures reached Slack

That is the difference between "we have an agent" and "we can operate this agent."

## What comes next

There are four immediate improvements.

First, finish the follow-up draft writer. Due follow-ups should create Gmail drafts in the existing thread and mirror to Slack just like first-touch drafts.

Second, make budget mutation boring. Creating new toolsets is fine as an emergency workaround, but normal operators should be able to fund, patch, freeze, and retire scopes cleanly.

Third, move more of the setup into repeatable scripts. Slack bot installation and Gmail OAuth still require too much handholding.

Fourth, keep measuring cost per accepted draft. The first live high-traction run spent `$1.3155`. That is the numerator. The denominator should be drafts that passed review, emails manually sent, replies received, and eventually design-partner conversations created.

Runtime authority is not only about stopping disasters. It is also about making autonomy measurable enough to increase safely.

The outreach runner is still early. It already proved the important thing: a real autonomous workflow can keep running on a VM, spend under a daily cap, create drafts for human review, block external send by default, alert on failures, and leave receipts for every operator question that matters.

That is the bar we should hold agent systems to before we let them act on our behalf.

## Related reading

- [What Is Cycles?](https://runcycles.io/)
- [Why Cycles](https://runcycles.io/why-cycles)
- [How Reserve → Commit Works in Cycles](/protocol/how-reserve-commit-works-in-cycles)
- [Agents Are Cross-Cutting. Your Controls Aren't.](/blog/agents-are-cross-cutting-your-controls-arent)
- [Action Authority Demo: A Support Agent Walkthrough](/blog/action-authority-demo-support-agent-walkthrough)
- [How scalerX.ai Wired Cycles Into a Java Agent Runtime](/blog/how-scalerx-wired-cycles-into-a-java-agent-runtime)
