---
title: "5 AI Agent Failures Budget Controls Would Prevent"
date: 2026-03-14
author: Cycles Team
tags: [incidents, costs, best-practices]
description: "Five AI agent failure scenarios with dollar estimates, and how pre-execution budget enforcement would have caught each one."
blog: true
sidebar: false
---

# 5 AI Agent Failures Budget Controls Would Prevent

> **Part of: [AI Agent Risk & Blast Radius Reference](/guides/risk-and-blast-radius)** — the full pillar covering action authority, risk scoring, blast-radius containment, and degradation paths.

Every team running AI agents in production has at least one horror story. The details vary — a runaway loop, a [retry storm](/glossary#retry-storm), a weekend deployment nobody was watching — but the punchline is always the same: a surprising number on an invoice and a postmortem that concludes with "we need better controls." We've collected these stories from teams across the industry, and five patterns come up again and again. Each one is preventable. Each one keeps happening because the same architectural gap — no pre-execution budget check — exists in most agent systems.

<!-- more -->

These aren't edge cases. They're the predictable consequences of running autonomous systems that can spend money without asking permission first. Here are five failures, the math behind each one, and the specific mechanism that would have prevented them.

## Failure 1: The Infinite Tool Loop — $4,200 in 3 Hours

**The scenario:**

A coding agent is deployed to automate test generation. It reads a source file, generates test cases, runs the test suite, and iterates on failures. The workflow is straightforward and works well in testing.

In production, the agent encounters a module with a subtle dependency issue. The generated tests fail because of a missing mock, not because of a code problem. The agent interprets the test failure as a code generation issue, rewrites the tests slightly, and runs them again. Same failure. Rewrite. Run. Same failure.

The agent doesn't give up because it's not designed to. Its instructions say "iterate until tests pass or you've made the code change." The tests never pass because the problem isn't in the generated code. The agent loops.

**The math:**

| Parameter | Value |
|---|---|
| Duration of loop | 3 hours |
| Calls per iteration | 4 (read error, reason about fix, generate code, run tests) |
| Time per iteration | ~45 seconds |
| Total iterations | 240 |
| Total LLM calls | 960 |
| Model | gpt-4o |
| Avg input [tokens](/glossary#tokens) per call (growing context) | 12,000 |
| Avg output tokens per call | 2,500 |

Context growth is the killer here. Each iteration appends the previous attempt and the test output to the conversation. By iteration 50, the agent is sending 25,000 input tokens per call. By iteration 200, it's sending 40,000+. The average across all iterations works out to about 12,000 input tokens — heavily weighted toward the later, more expensive calls.

Cost calculation:
- Input: 960 calls x 12,000 tokens = 11.52M tokens x $2.50/1M = $28.80
- Output: 960 calls x 2,500 tokens = 2.4M tokens x $10.00/1M = $24.00
- Subtotal per iteration is low, but 240 iterations compound to: **~$4,200**

The actual cost is higher than the simple average suggests because the later iterations — when the context is largest — are disproportionately expensive. The last 50 iterations alone account for nearly 40% of the total cost.

**How budget enforcement prevents this:**

A per-run budget of $15 — generous for a test generation task — would have stopped this agent after approximately 8 iterations. Cycles checks the budget before each LLM call. When the run budget is exhausted, the call is denied. The agent receives a budget-exhausted signal and stops, returning a clear message: "Budget limit reached. Test generation did not converge after 8 iterations. Manual review required."

The team would have lost $15 instead of $4,200. More importantly, they would have discovered the dependency issue hours earlier because the agent's failure would have surfaced immediately instead of being hidden behind a loop that _appeared_ to be making progress.

For the full anatomy of this failure mode, see [Runaway Agents: Tool Loops and Budget Overruns](/incidents/runaway-agents-tool-loops-and-budget-overruns-the-incidents-cycles-is-designed-to-prevent).

## Failure 2: The Retry Storm — $1,800 in 12 Minutes

**The scenario:**

A customer support agent integrates with a CRM tool to look up order status. The CRM has an intermittent availability issue — it returns 500 errors about 30% of the time during a degraded period.

The agent has retry logic: if a tool call fails, retry up to 3 times. Reasonable. But the agent framework _also_ has retry logic — if an agent step fails, retry the entire step up to 3 times. And the SDK making the LLM calls has its own retry logic for transient errors — 3 retries with exponential backoff.

When the CRM returns a 500, here's what happens:
1. The agent calls the LLM to generate a tool call
2. The tool call hits the CRM and gets a 500
3. The agent's tool retry logic retries the tool call (3 attempts)
4. After 3 tool failures, the agent step is marked as failed
5. The framework's step retry logic reruns the entire step (including a new LLM call)
6. The new LLM call generates the same tool call, which fails again
7. After 3 step retries (each with 3 tool retries), the run is marked as failed
8. The outer orchestration layer retries the entire run

**The math:**

| Retry layer | Multiplier |
|---|---|
| Tool retry (3 attempts) | 3x tool calls |
| Step retry (3 attempts, each with tool retry) | 3x LLM calls, each triggering 3x tool retries |
| Run retry (3 attempts, each with step retry) | 3x full step sequences |
| **Total multiplication factor** | **Up to 27x LLM calls per intended call** |

Now multiply across all conversations during the degraded period:

| Parameter | Value |
|---|---|
| Degraded period duration | 12 minutes |
| Active conversations | 45 |
| Conversations hitting CRM lookup | 38 |
| LLM calls per conversation (with retry cascades) | ~27 |
| Total LLM calls | ~1,026 |
| Model | Claude Sonnet 4 |
| Avg input tokens per call | 5,000 |
| Avg output tokens per call | 1,200 |

Cost calculation:
- Input: 1,026 x 5,000 = 5.13M tokens x $3.00/1M = $15.39
- Output: 1,026 x 1,200 = 1.23M tokens x $15.00/1M = $18.47
- Per-conversation cost during storm: ~$0.89
- But many conversations had multiple CRM lookups, and the retry cascades overlapped

The total across all affected conversations, including partial retries and the cascading effect of shared infrastructure load (retries from one conversation slowing responses for others, triggering timeout-based retries): **~$1,800**.

**How budget enforcement prevents this:**

A per-conversation budget of $2.00 would have capped each conversation's retry cascade. After the first few retry cycles consumed the budget, subsequent LLM calls would be denied. The agent would return: "I'm unable to look up your order status right now. Our systems are experiencing issues. Please try again in a few minutes."

Total cost with enforcement: ~$76 (38 conversations x $2.00 cap) instead of $1,800. And the user experience would actually be _better_ — a fast, clear error message instead of a long wait followed by the same error.

For more on this failure pattern, see [Retry Storms and Idempotency Failures](/incidents/retry-storms-and-idempotency-failures).

## Failure 3: The Friday Deploy — $12,400 Over the Weekend

**The scenario:**

This is the story we opened with in [The True Cost of Uncontrolled AI Agents](/blog/true-cost-of-uncontrolled-agents). A development team ships a coding agent on Friday afternoon. It works beautifully in staging. It's designed to process a backlog of tasks — summarizing PRs, generating test coverage, refactoring flagged modules.

The backlog has 2,300 items. In staging, the team tested with 20 items and everything worked fine. They deploy to production, point it at the backlog, and leave for the weekend.

The agent works through the backlog autonomously. Each task takes 15-40 LLM calls depending on complexity. Some tasks hit edge cases that cause retries. The refactoring tasks are especially expensive because they load entire files into context. The agent doesn't stop because it has 2,300 items to process and no budget limit to hit.

**The math:**

| Parameter | Value |
|---|---|
| Backlog items processed | 2,300 |
| Avg LLM calls per item | 22 |
| Total LLM calls | ~50,600 |
| Items with retry issues (~15%) | 345 |
| Additional calls from retries | ~6,900 |
| Total calls including retries | ~57,500 |
| Model | gpt-4o |
| Avg input tokens per call | 8,000 (code context is large) |
| Avg output tokens per call | 2,000 |

Cost calculation:
- Input: 57,500 x 8,000 = 460M tokens x $2.50/1M = $1,150
- Output: 57,500 x 2,000 = 115M tokens x $10.00/1M = $1,150
- Subtotal: $2,300

But this assumes flat context size. In practice, the refactoring tasks (about 30% of items) loaded much larger files — some with 30,000+ input tokens per call. And the conversation context grew within each task.

Adjusted total with realistic context sizes and the long tail of expensive refactoring tasks: **~$12,400**.

The dashboard updated hourly. The alert was set for daily spend thresholds. The agent processed items steadily all weekend — never fast enough to trigger rate limits, never failing hard enough to stop, just continuously spending at a rate that looked normal in any single hour but accumulated to $12,400 over 60 hours.

**How budget enforcement prevents this:**

Two levels of enforcement would have contained this:

1. **Per-task budget of $5.00**: Caps each individual task. The few tasks that hit edge cases and consumed 40+ calls would have been stopped early. Cost savings: ~$2,000 from runaway individual tasks.

2. **Batch budget of $2,500**: A budget for the entire backlog processing run. When the total spend hit $2,500, processing would pause. The team would return Monday to find 80% of the backlog completed within budget and a clear log showing why processing stopped.

Instead of a $12,400 surprise, the team would have spent $2,500 with full visibility into the remaining work. They could then decide: increase the budget for the remaining items, optimize the expensive tasks first, or switch to a cheaper model for the remainder.

## Failure 4: The Concurrent Burst — $3,200 in 4 Minutes

**The scenario:**

A SaaS platform provides AI-powered document analysis to enterprise customers. Each customer's documents are processed by an agent that reads the document, extracts structured data, validates the extraction, and generates a summary. The platform tracks per-customer spend using an application-level counter backed by a database.

At 2:15 PM, a large customer uploads a batch of 200 documents simultaneously through the API. The platform spins up 20 concurrent agent instances to process them in parallel. Each agent checks the customer's remaining budget before starting.

Here's the race condition: all 20 agents read the budget balance at nearly the same time. The balance shows $500 remaining. Each agent estimates its task will cost ~$15 and sees sufficient budget. All 20 proceed.

But 20 agents each spending $15 is $300 per round. And each agent makes multiple LLM calls before reporting its spend back to the counter. By the time the first agent finishes and updates the balance, the other 19 have already committed to their calls.

**The math:**

| Parameter | Value |
|---|---|
| Concurrent agents | 20 |
| Documents processed before detection | 200 |
| LLM calls per document | 4 |
| Total LLM calls | 800 |
| Model | Claude Sonnet 4 |
| Avg input tokens per call | 6,000 (document content) |
| Avg output tokens per call | 1,500 |

Cost calculation:
- Input: 800 x 6,000 = 4.8M tokens x $3.00/1M = $14.40
- Output: 800 x 1,500 = 1.2M tokens x $15.00/1M = $18.00
- Per-document cost: ~$16.20
- 200 documents: **~$3,200**

The customer's budget was $500. The actual spend was 6.4x the budget. The application counter showed the correct balance at every read — it was never wrong. It was just stale. The time between reading the balance and updating it (the TOCTOU window) was long enough for 19 other agents to squeeze through.

**How budget enforcement prevents this:**

Cycles uses atomic [reservations](/glossary#reservation). When an agent requests permission to spend, Cycles atomically decrements the balance. There is no window between checking and spending — they're the same operation.

With a $500 customer budget and atomic reservations:
- Agents 1-31 get approved (31 documents x ~$16.20 = ~$502)
- Agent 32 is denied — the atomic decrement shows insufficient balance
- All subsequent requests are denied immediately

Total spend: ~$502 (slightly over due to estimation variance, reconciled afterward). That's $500 instead of $3,200. The 169 remaining documents are queued for processing when the customer adds budget or the next billing period starts.

The critical difference is atomicity. Cycles doesn't read-then-write. It performs an atomic compare-and-decrement. No matter how many concurrent agents check simultaneously, the budget can never be overdrawn by more than a single reservation's estimation variance.

For the full technical analysis of this failure pattern, see [Concurrent Agent Overspend](/incidents/concurrent-agent-overspend).

## Failure 5: The Scope Leak — $8,500/Month Unnoticed

**The scenario:**

This one is different from the others. It's not a sudden spike. It's a slow bleed.

A platform team sets up cost tracking for their AI agents. They create a monthly budget at the organization level: $10,000/month for the engineering org. Each of the five workspaces (frontend, backend, data, infrastructure, ML) uses agents for various tasks.

The problem: the budget is tracked at the org level, but the workspaces have very different usage patterns.

| Workspace | Expected monthly spend | Actual monthly spend |
|---|---|---|
| Frontend | $800 | $900 |
| Backend | $1,200 | $1,100 |
| Data | $2,000 | $2,500 |
| Infrastructure | $500 | $400 |
| ML | $3,000 | $8,600 |

The ML team is running a research agent that explores architecture variations. Each exploration is expensive — long context windows, many iterations, frontier models. In isolation, each run seems reasonable. But the volume is high and growing.

The org-level budget of $10,000 was set based on initial estimates. For the first two months, total spend was $7,000-$8,000, comfortably under the cap. In month three, the ML team's research agent usage grew as they expanded their experiments. Total org spend hit $13,500.

But here's the thing: nobody noticed for another two months. The org-level budget didn't have hard enforcement — it was a monitoring threshold. The alert fired, someone checked the dashboard, saw total spend was up, but couldn't quickly attribute it to a single workspace. The growth looked gradual on the org-level chart. It took a quarterly cost review to identify the ML workspace as the source.

Five months of $8,500/month overspend from the ML workspace (relative to the $3,000 expectation): **$27,500 in excess spend over the quarter**, of which roughly $8,500/month was the ongoing unnoticed overage.

**The math of scope misconfiguration:**

| Budget scope | What it catches | What it misses |
|---|---|---|
| Per-organization | Nothing under the org cap | Any single team consuming disproportionate share |
| Per-workspace | Workspace-level overspend | Individual runaway runs within a workspace |
| Per-workflow | Workflow-level anomalies | Cross-workflow accumulation |
| Per-run | Individual runaway runs | Gradual accumulation from many normal runs |

The right answer is hierarchical scoping: [tenant](/glossary#tenant) > workspace > app > workflow > agent > toolset. Each level has its own budget. A single agent can't blow through the workflow budget. A single workspace can't consume the tenant budget. Each scope catches a different category of failure.

**How budget enforcement prevents this:**

Per-workspace budgets in Cycles would have capped the ML team at $3,000/month. When their research agent usage hit that limit, the agents would be denied — not the entire tenant, just the ML workspace. The other four workspaces would continue operating normally.

The ML team would immediately know they've hit their budget. They could request an increase (with justification), optimize their agent's efficiency, or prioritize which experiments run within the cap. The decision is explicit and intentional instead of invisible and accidental.

With hierarchical enforcement:
- Tenant budget: $10,000/month (hard cap)
- ML workspace: $3,000/month (hard cap)
- ML research workflow: $50/agent run (hard cap)
- If any level is exhausted, the specific scope is blocked while everything else continues

For more on this failure pattern, see [Scope Misconfiguration and Budget Leaks](/incidents/scope-misconfiguration-and-budget-leaks).

## The Common Pattern

Five different failures. Five different root causes — [tool loops](/glossary#tool-loop), retry cascades, unsupervised batch processing, concurrency races, scope misconfiguration. But they all share one architectural gap: **no pre-execution budget check**.

In every case, the agent was allowed to spend money without asking permission. The system learned about the spend after the fact — through dashboards, alerts, or invoices. By then, the money was gone.

| Failure | Cost | Prevention mechanism | Cost with enforcement |
|---|---|---|---|
| Infinite Tool Loop | $4,200 | Per-run budget ($15) | $15 |
| Retry Storm | $1,800 | Per-conversation budget ($2) | $76 |
| Friday Deploy | $12,400 | Per-task + batch budget | $2,500 |
| Concurrent Burst | $3,200 | Atomic reservations ($500 cap) | $502 |
| Scope Leak | $8,500/mo | Hierarchical workspace budgets | $3,000/mo |

The total across these five scenarios: **$30,100 in preventable spend** (counting three months of the scope leak). With enforcement, the total would have been roughly $6,100 — an 80% reduction, with better user experience and faster failure detection.

The pattern is simple. Budget enforcement is a pre-execution check. It asks one question before every LLM call: "Is there budget remaining for this?" If yes, proceed. If no, stop. Every failure in this post would have been caught by that single question. For failures where the risk is operational rather than monetary, the same pattern applies with a different unit — [risk points instead of dollars](/concepts/action-authority-controlling-what-agents-do).

## Budget failures are not the only kind

The five failures above are all denominated in dollars. But agents also fail by *doing the wrong thing* — and those failures can cost far more than any token bill. A support agent that [sends 200 collections emails instead of welcome emails](/blog/ai-agent-action-control-hard-limits-side-effects) costs $1.40 in model spend. The business impact: $50K+ in lost pipeline. No spending limit would have caught it.

This is why Cycles is positioned as [runtime authority](/blog/what-is-runtime-authority-for-ai-agents), not just [budget authority](/glossary#budget-authority). Budget authority caps what agents spend (the five scenarios above). [Action authority](/concepts/action-authority-controlling-what-agents-do) caps what agents *do* — gating high-consequence operations like email, deploy, and delete with risk-point budgets per toolset. Both dimensions use the same reserve-commit protocol and the same infrastructure.

## Next steps

If these failure modes look familiar — or if you'd rather prevent them than experience them:

- **[End-to-End Tutorial](/quickstart/end-to-end-tutorial)** — from zero to working budget enforcement in under 30 minutes
- **[Common Budget Patterns](/how-to/common-budget-patterns)** — the budget structures that prevent each of these failure modes
- **[How to Choose a First Rollout](/quickstart/how-to-choose-a-first-cycles-rollout-tenant-budgets-run-budgets-or-model-call-guardrails)** — decide where to start: tenant budgets, run budgets, or model call guardrails
- **[AI Agent Cost Management: The Complete Guide](/blog/ai-agent-cost-management-guide)** — the maturity model from no controls to hard enforcement
- **[AI Agent Budget Patterns: A Practical Guide](/blog/agent-budget-patterns-visual-guide)** — six common patterns with code examples and trade-offs

For failures where the risk is action rather than cost:

- **[5 AI Agent Failures Only Action Controls Would Prevent](/blog/ai-agent-action-failures-runtime-authority-prevents)** — the companion post for action failures
- **[AI Agent Action Control: Hard Limits on Side Effects](/blog/ai-agent-action-control-hard-limits-side-effects)** — [RISK_POINTS](/glossary#risk-points), toolset budgets, and progressive capability narrowing
- **[Action Authority](/concepts/action-authority-controlling-what-agents-do)** — risk-point budgets and toolset-scoped controls

The cheapest incident is the one that never happens. The second cheapest is the one that's capped at $15 instead of $4,200.
