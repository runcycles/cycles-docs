---
title: "When Budget Runs Out: AI Agent Degradation Patterns"
date: 2026-04-06
author: Albert Mavashev
tags: [engineering, best-practices, agents, production, action-control, costs, risk, budgets]
description: "Your guardrails block an agent action. Now what? Five graceful degradation patterns for handling DENY and ALLOW_WITH_CAPS — from model fallback to inform-and-stop."
blog: true
sidebar: false
featured: false
---

# When Budget Runs Out: AI Agent Degradation Patterns

> **Part of: [AI Agent Risk & Blast Radius Reference](/guides/risk-and-blast-radius)** — the full pillar covering action authority, risk scoring, blast-radius containment, and degradation paths.

Runtime enforcement solves one problem and creates another. Once your guardrails can [block an agent action before execution](/blog/what-is-runtime-authority-for-ai-agents), you need to decide what the agent should do when it gets blocked.

A hard stop — "budget exceeded, goodbye" — is better than a runaway agent. But it's not a good user experience. The agent was in the middle of something. The user was waiting for a result. A bare error message doesn't help either of them.

And budget isn't the only reason an agent gets blocked. [Runtime authority](/blog/what-is-runtime-authority-for-ai-agents) enforces both **cost limits** (you've spent your $10) and **risk limits** (you've used your 3 allowed `send_email()` calls, or your [RISK_POINTS](/blog/ai-agent-risk-assessment-score-classify-enforce-tool-risk) budget is exhausted). The DENY is the same signal. The recovery path is different.

This post covers five patterns for handling enforcement decisions gracefully — whether the trigger is cost, risk, or both, and whether the response is a full **DENY**, a constrained **ALLOW_WITH_CAPS**, or a soft signal that limits are approaching. The goal is the same in every case: **the agent completes as much useful work as possible within the boundaries it's given.**

<!-- more -->

## What Frameworks Do Today

Before covering the patterns, it's worth understanding the current state of the art. Frameworks are getting better at detecting limits and intercepting stops, but graceful degradation is still mostly application logic.

**LangGraph** raises a `GRAPH_RECURSION_LIMIT` error when the agent hits its iteration cap — a hard stop by default. LangChain's newer [middleware surface](https://docs.langchain.com/oss/python/langchain/middleware/built-in) adds prebuilt components for summarization, model fallback, model-call limits, tool-call limits, and human-in-the-loop approval. These are real building blocks, but assembling them into a coherent degradation strategy per agent is still application logic.

**CrewAI** is the closest to graceful degradation built-in. When an agent hits `max_iter` (default 20), it's forced to provide its best answer rather than crash. CrewAI also auto-summarizes context when the token window overflows — genuine capability narrowing at the framework level.

**OpenAI Agents SDK** raises `MaxTurnsExceeded` when the run exceeds the `max_turns` you configure. But it offers an `error_handlers` mechanism where you can return a controlled final output instead of raising the exception — the infrastructure for Pattern 5, if you wire it up yourself.

**Claude Agent SDK** has first-class session budget controls via `max_budget_usd` and returns structured result messages, which makes graceful termination easier to handle than a generic crash. Anthropic's engineering blog also recommends [checkpointing with progress files](https://www.anthropic.com/engineering/effective-harnesses-for-long-running-agents) so agents can resume from where they stopped rather than restart from scratch.

**The common gap:** Frameworks provide pieces — fallback, summarization, iteration or tool-call limits, error handlers — but no unified degradation policy model that ties them together. That's what the five patterns below address.

## The Three Signals Your Agent Receives

Every pattern below depends on the three [enforcement decisions](/blog/ai-agent-runtime-permissions-control-actions-before-execution) an agent can receive:

| Decision | Triggered by | Meaning | Agent should... |
|---|---|---|---|
| **ALLOW** | — | Proceed normally | Execute the planned action |
| **ALLOW_WITH_CAPS** | Cost, risk, or both | Proceed, but with constraints | Adapt — cheaper model (cost), narrower tools (risk), or both |
| **DENY** | Cost, risk, or both | Action not permitted | Stop, degrade, queue, or inform the user |

The binary allow/deny model forces hard stops. The three-way model gives agents room to adapt. Most of the patterns below depend on **ALLOW_WITH_CAPS** — the middle ground where enforcement narrows what the agent can do without killing the session entirely.

---

## Pattern 1: Model Downgrade

**When to use:** Budget is running low but the task can still be completed with a cheaper model.

The simplest degradation path — and the one with the most existing framework support. LangChain's [fallback middleware](https://docs.langchain.com/oss/python/langchain/middleware/built-in) provides built-in model fallback components for this. When the agent receives ALLOW_WITH_CAPS or detects that remaining budget is thin, it switches from a high-capability model to a cheaper one.

**The fallback chain:**

```
GPT-4o → GPT-4o-mini → cached/partial response
Claude Opus → Claude Sonnet → Claude Haiku
```

**How it works in practice:**

1. Agent requests a reservation for the next LLM call
2. Enforcement returns ALLOW_WITH_CAPS with a reduced budget ceiling
3. Agent checks whether the preferred model fits within the cap
4. If not, it walks down the fallback chain until it finds a model that fits
5. If no model fits, it falls through to Pattern 4 or 5

**Trade-offs:**
- Users get a result instead of an error
- Output quality drops — summarization may be less nuanced, code generation less precise
- Requires designing and testing fallback chains per use case
- Some tasks genuinely need a high-capability model and can't degrade meaningfully

**Watch out for the context window trap.** If the agent has accumulated a large context (150K+ tokens of conversation history and retrieved documents), downgrading to a model with a smaller effective context window — or one that handles long context less well — can cause a hard failure or severe quality drop. Model downgrade often requires a truncation or summarization step before the fallback call, not just a model swap.

**When it doesn't work:** Tasks where the cheaper model produces wrong answers rather than less polished ones. A legal document review that needs Opus-level reasoning shouldn't silently fall back to Haiku.

---

## Pattern 2: Capability Narrowing

**When to use:** The agent has multiple tools, and enforcement progressively restricts which ones it can use. **This is the primary pattern for risk-driven enforcement** — it's triggered by RISK_POINTS consumption, not just dollar spend.

This is the [progressive capability narrowing](/blog/ai-agent-action-control-hard-limits-side-effects) pattern. As the agent consumes its [RISK_POINTS budget](/blog/ai-agent-risk-assessment-score-classify-enforce-tool-risk) — where high-blast-radius actions like `send_email` (20 points) or `deploy` (50 points) cost far more than read-only operations — the enforcement layer returns ALLOW_WITH_CAPS with increasingly restrictive `tool_denylist` or `tool_allowlist` constraints.

**Example policy progression:**

| Budget consumed | Decision | Caps | Agent can still... |
|---|---|---|---|
| 0-50% | ALLOW | — | Full tool access |
| 50-80% | ALLOW_WITH_CAPS | `tool_denylist: [send_email, deploy, delete_record]` | Read, search, generate, write drafts |
| 80-100% | ALLOW_WITH_CAPS | `tool_allowlist: [search, read_file, summarize]` | Read-only operations |
| 100% | DENY | — | Must stop or inform user |

**What the agent does at each stage:**
- **Full access:** Normal operation
- **High-risk tools denied:** Agent continues but skips actions that send external messages, mutate data, or trigger deployments. It can still research, draft, and prepare outputs for human review.
- **Read-only mode:** Agent can answer questions, retrieve information, and summarize — but can't take any action with side effects.
- **DENY:** Graceful stop (see Pattern 5).

**Trade-offs:**
- The agent degrades gracefully instead of hard-stopping
- It can still complete useful work — reading files, running searches, generating summaries — while dangerous capabilities are removed
- Requires defining risk tiers for your tools (see [risk assessment guide](/blog/ai-agent-risk-assessment-score-classify-enforce-tool-risk))
- Users may not realize the agent is operating in a constrained mode unless you tell them
- **Critical: the agent must know why a tool was denied.** If the enforcement layer returns a generic "tool execution failed" error, a persistent agent will retry the tool in an expensive loop or hallucinate alternatives. The DENY or ALLOW_WITH_CAPS response should include context the LLM can reason about — e.g., *"send_email capability revoked due to risk limits. Proceed with read-only operations."* — so the agent changes strategy instead of retrying blindly

---

## Pattern 3: Queue and Defer

**When to use:** The action is important but not urgent, and can wait for a new budget window.

Not every DENY needs to be a dead end. Some actions — batch processing, scheduled reports, non-urgent notifications — can be queued for later execution when budget replenishes.

**How it works:**

1. Agent receives DENY for the current action
2. Agent checks whether the action type is deferrable (based on priority or configuration)
3. If deferrable: agent queues the action with metadata (what to do, for whom, estimated cost)
4. Agent confirms to the user: *"I've queued this report for processing. It'll run when the next budget window opens."*
5. A scheduler or background worker picks up the action when budget is available

**Where this fits naturally:**
- Nightly batch summarizations
- Scheduled data exports
- Non-urgent email drafts (queue for human review instead of sending immediately)
- Research tasks that can run during off-peak hours

**Where it doesn't fit:**
- Real-time user interactions where the user is waiting for a response
- Time-sensitive actions (incident response, live customer support)
- Actions with external deadlines

**Trade-offs:**
- Converts a hard failure into a delayed success
- Requires a queueing mechanism and budget-aware scheduler
- **State rehydration is hard.** Deferring a simple task (send this report) is straightforward. Deferring an agent mid-reasoning-chain requires serializing its memory, scratchpad, and graph state, storing it durably, and rehydrating it later. Realistically this requires a durable execution engine (like Temporal or Inngest) or a robust state-store design — making this the heaviest pattern to implement from scratch
- Users need to understand that "deferred" doesn't mean "lost"
- Budget windows must be well-defined and communicated

---

## Pattern 4: Partial Completion with Summary

**When to use:** The agent is mid-task when it hits a budget boundary, and some work is already done.

The worst user experience isn't a DENY at the start — it's a DENY in the middle, with no indication of what was accomplished. This pattern ensures the agent saves its progress and tells the user what it completed and what remains.

**How it works:**

1. Agent is executing a multi-step task (e.g., reviewing 10 files, processing 50 records)
2. Mid-task, a reservation returns DENY or ALLOW_WITH_CAPS with `max_steps_remaining: 1`
3. Agent uses its final allowed step to:
   - Save intermediate results (drafts, partial analyses, processed records)
   - Generate a summary of work completed vs. work remaining
   - Provide a clear handoff: *"I reviewed 6 of 10 files. Here are my findings so far. The remaining 4 files are: ..."*

**Example agent response:**

> *"I've analyzed 6 of the 10 pull requests you asked about. Here's what I found so far:*
> - *PR #142: Approved — minor style changes only*
> - *PR #145: Needs review — changes to auth middleware*
> - *[4 more results]*
>
> *I wasn't able to review PRs #149, #150, #151, and #153 — session budget reached its limit. You can continue in a new session or I can queue the remaining reviews."*

**Trade-offs:**
- Users get partial value instead of nothing
- Clear handoff reduces frustration and enables manual follow-up
- Requires the agent to track its own progress and be able to summarize on demand
- The "summarize what you've done" step itself costs tokens — budget enough for it

Anthropic's engineering team [recommends a similar approach](https://www.anthropic.com/engineering/effective-harnesses-for-long-running-agents) for long-running agents: maintain a progress file that logs completed actions, so new sessions can pick up where the previous one stopped rather than restarting from scratch.

**Design tip:** Reserve a small budget buffer (~5% of total) specifically for the summarization step. If the agent uses 100% of budget on work and has nothing left for the summary, the user gets the worst of both worlds: incomplete work *and* no explanation.

---

## Pattern 5: Inform and Stop

**When to use:** The action cannot be degraded, deferred, or partially completed. The only option is a clean stop.

This is the last resort — but it should still be designed, not accidental. This is error handling for humans, not just for logs. A well-crafted stop message is dramatically better than an unhandled error or a silent timeout.

**What a good stop looks like:**

| Bad | Better |
|---|---|
| `Error: BUDGET_EXCEEDED` | *"I've reached the session budget limit. Here's a summary of what I completed. To continue, you can start a new session."* |
| `500 Internal Server Error` | *"I'm not able to complete this request right now. Your data is saved and nothing was sent externally."* |
| Silent hang | *"This action requires more budget than currently available. I've queued it for your review."* |

**Key elements of a good stop message:**
1. **What happened** — be specific (budget limit, not "something went wrong")
2. **What was saved** — reassure the user that no work was lost
3. **What wasn't done** — so they know what to follow up on
4. **What they can do next** — start a new session, wait for budget refresh, escalate

**Trade-offs:**
- Clean user experience instead of a cryptic error
- Requires designing stop messages per agent type (internal-facing vs. customer-facing)
- Users may not understand why the agent stopped if the message is too vague
- Over-explaining internal mechanics (budgets, RISK_POINTS) confuses end users

**For customer-facing agents**, the message should never expose internal budget mechanics. Instead:

> *"I'm not able to look up your order status right now. Our systems are experiencing temporary limits. Please try again in a few minutes, or I can connect you with a human agent."*

The user doesn't need to know about RISK_POINTS or budget hierarchies. They need to know their request isn't lost and there's a next step.

---

## Choosing the Right Pattern

Not every DENY needs the same response. The right pattern depends on the action, the user, and the context:

| Scenario | Recommended pattern |
|---|---|
| Budget low, task can use cheaper model | **Pattern 1:** Model downgrade |
| Budget low, agent has multiple tools | **Pattern 2:** Capability narrowing |
| Action denied but not time-sensitive | **Pattern 3:** Queue and defer |
| Agent mid-task when budget hits | **Pattern 4:** Partial completion + summary |
| Hard DENY, no degradation possible | **Pattern 5:** Inform and stop |
| Budget low + mid-task + deferrable remainder | **Combine 1 + 4 + 3:** Downgrade model, complete what you can, queue the rest |

In practice, most production agents should implement at least patterns 1, 4, and 5 — they cover the core graceful degradation path. Model downgrade catches the majority of budget constraints. Partial completion handles mid-task boundaries. Inform-and-stop is the fallback for everything else.

Patterns 2 and 3 add sophistication for agents with complex tool access or batch workloads, but they require more infrastructure — [risk-point tiers](/blog/ai-agent-risk-assessment-score-classify-enforce-tool-risk) for capability narrowing, a queue and scheduler for deferral.

---

## Cost-Driven vs. Risk-Driven Degradation

The trigger matters because the recovery options are different:

| | Cost-driven DENY | Risk-driven DENY |
|---|---|---|
| **Why it fired** | Dollar or token budget exhausted | RISK_POINTS budget exhausted or specific tool denied |
| **Can a cheaper model help?** | Yes — Pattern 1 | No — the model isn't the problem, the action is |
| **Can the agent keep working?** | Often yes, at lower quality | Often yes, with fewer tools (Pattern 2) |
| **Can it be deferred?** | Yes — wait for next budget window | Depends — some actions are time-sensitive |
| **Typical recovery path** | Downgrade model → partial completion → stop | Narrow capabilities → read-only mode → stop |

The key insight: **a cost DENY means the agent can't afford to act. A risk DENY means the agent isn't allowed to act.** Agents that handle both need to inspect the DENY reason and choose the right degradation path.

In practice, enforcement decisions often involve both simultaneously — an agent running low on dollar budget *and* approaching its RISK_POINTS ceiling. The patterns compose: downgrade the model (cost) while narrowing tool access (risk), complete what you can (partial completion), and queue the rest (defer).

---

## The Design Principle

All five patterns share one principle: **the agent should never leave the user wondering what happened.**

A DENY without context is an error. A DENY with a summary, a handoff, and a next step is a feature. The difference isn't in the enforcement layer — it's in how the agent is designed to handle the response.

Enforcement tells the agent *no*. Graceful degradation design tells it *what to do instead*. That's the difference between error handling that serves the system and error handling that serves the user.

---

- [What Is Runtime Authority for AI Agents](/blog/what-is-runtime-authority-for-ai-agents)
- [Action Authority: Hard Limits on Agent Side Effects](/blog/ai-agent-action-control-hard-limits-side-effects)
- [Risk Assessment: Score, Classify, and Enforce Tool Risk](/blog/ai-agent-risk-assessment-score-classify-enforce-tool-risk)
- [Budget Patterns Visual Guide](/blog/agent-budget-patterns-visual-guide)
- [AI Agent Failures That Budget Controls Prevent](/blog/ai-agent-failures-budget-controls-prevent)
- [GitHub: runcycles](https://github.com/runcycles)
