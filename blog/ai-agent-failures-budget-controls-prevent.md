---
title: "5 Agent Cost Failures Runtime Budgets Can Bound"
date: 2026-03-14
author: Cycles Team
tags: [incidents, costs, best-practices]
description: "Review five illustrative AI agent cost scenarios and learn how mandatory pre-execution budget reservations can bound spend before it escapes control early."
blog: true
sidebar: false
head:
  - - meta
    - name: keywords
      content: AI agent failures, budget controls, runaway agent costs, pre-execution budgets, LLM spend limits, runtime authority
---

# 5 Agent Cost Failures Runtime Budgets Can Bound

> **Part of: [AI Agent Risk & Blast Radius Reference](/guides/risk-and-blast-radius)** — the full pillar covering action authority, risk scoring, blast-radius containment, and degradation paths.

Runaway loops, [retry storms](/glossary#retry-storm), unattended batches, stale counters, and poorly scoped limits are recurring agent-cost risks. The five cases below are illustrative scenarios built from those patterns, not reports from identified teams. Their arithmetic uses the stated token volumes and model rates.

<!-- more -->

Here are five failure models, the math behind each one, and the budget mechanism that can bound configured spend when every protected path uses a mandatory reservation boundary.

## Failure 1: The Infinite Tool Loop — $52.80 in 3 Hours

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

This model assumes 12,000 input tokens per call on average. A real loop with growing context should use its measured per-call distribution rather than extrapolating from this flat average.

Cost calculation:
- Input: 960 calls x 12,000 tokens = 11.52M tokens x $2.50/1M = $28.80
- Output: 960 calls x 2,500 tokens = 2.4M tokens x $10.00/1M = $24.00
- Total: **$52.80**, or about **$0.22 per iteration**

**How budget enforcement prevents this:**

A per-run budget of $15 would reject a protected call at roughly iteration 68 under the flat-average assumptions above. The host must require a successful reservation before each LLM call and stop on a live reservation error. Its message could say: "Budget limit reached. Test generation did not converge within the configured allocation. Manual review required."

The configured budget would bound this run near $15 rather than allowing the full $52.80 scenario, subject to the integration's estimates and settlement policy. It would also surface non-convergence earlier.

For the full anatomy of this failure mode, see [Runaway Agents: Tool Loops and Budget Overruns](/incidents/runaway-agents-tool-loops-and-budget-overruns-the-incidents-cycles-is-designed-to-prevent).

## Failure 2: The Retry Storm — $33.86 in 12 Minutes

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
| Model | Claude Sonnet 4.6 |
| Avg input tokens per call | 5,000 |
| Avg output tokens per call | 1,200 |

Cost calculation:
- Input: 1,026 x 5,000 = 5.13M tokens x $3.00/1M = $15.39
- Output: 1,026 x 1,200 = 1.23M tokens x $15.00/1M = $18.47
- Per-conversation cost during storm: **~$0.89**
- Total across the 38 affected conversations: **~$33.86**

**How budget enforcement prevents this:**

A per-CRM-lookup budget of $0.25 would allow roughly seven calls at the stated average cost before the next protected call fails to reserve. The host could then return: "I'm unable to look up your order status right now. Our systems are experiencing issues. Please try again in a few minutes."

Total configured exposure across 38 affected conversations would be about $9.50 instead of $33.86. The exact result depends on estimate accuracy and which calls the integration protects.

For more on this failure pattern, see [Retry Storms and Idempotency Failures](/incidents/retry-storms-and-idempotency-failures).

## Failure 3: The Friday Deploy — $2,300 Over the Weekend

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

Total under the stated flat-average assumptions: **$2,300**. Larger context windows would raise that number, but this scenario does not invent an unmeasured long-tail multiplier.

The dashboard updated hourly. The alert was set for daily spend thresholds. The agent processed items steadily all weekend — never fast enough to trigger rate limits and never failing hard enough to stop.

**How budget enforcement prevents this:**

Two levels of enforcement would have contained this:

1. **Per-task budget of $5.00**: Bounds an individual task that enters an unusually expensive retry or context-growth path.

2. **Batch budget of $500**: Bounds the unattended backlog run. When the next protected call cannot reserve within that allocation, the host pauses processing. Completion percentage depends on task ordering and actual context sizes.

Instead of allowing the full $2,300 illustrative run, the team would return to a batch stopped near its $500 allocation. They could then decide whether to increase the budget, optimize expensive tasks, or switch models.

## Failure 4: The Concurrent Burst — $32.40 Against a $5 Balance

**The scenario:**

A SaaS platform provides AI-powered document analysis to enterprise customers. Each customer's documents are processed by an agent that reads the document, extracts structured data, validates the extraction, and generates a summary. The platform tracks per-customer spend using an application-level counter backed by a database.

At 2:15 PM, a large customer uploads a batch of 200 documents simultaneously through the API. The platform spins up 20 concurrent agent instances to process them in parallel. Each agent checks the customer's remaining budget before starting.

Here's the race condition: all 20 agents read the budget balance at nearly the same time. The balance shows $5 remaining. Each agent estimates its document will cost about $0.17 and sees sufficient budget. All 20 proceed.

Each agent makes multiple LLM calls before reporting spend back to the counter. By the time the first agent finishes and updates the balance, the other 19 have already started. More documents enter subsequent work before delayed counter updates converge.

**The math:**

| Parameter | Value |
|---|---|
| Concurrent agents | 20 |
| Documents processed before detection | 200 |
| LLM calls per document | 4 |
| Total LLM calls | 800 |
| Model | Claude Sonnet 4.6 |
| Avg input tokens per call | 6,000 (document content) |
| Avg output tokens per call | 1,500 |

Cost calculation:
- Input: 800 x 6,000 = 4.8M tokens x $3.00/1M = $14.40
- Output: 800 x 1,500 = 1.2M tokens x $15.00/1M = $18.00
- Per-document cost: **~$0.162**
- 200 documents: **~$32.40**

The customer's remaining budget was $5. The modeled spend was about 6.5 times that balance. The application counter was not necessarily arithmetically wrong; its read-then-update sequence was stale under concurrency.

**How budget enforcement prevents this:**

Cycles uses atomic [reservations](/glossary#reservation). When an agent requests permission to spend, Cycles atomically decrements the balance. There is no window between checking and spending — they're the same operation.

With a $5 remaining budget and $0.17 estimates:
- Reservations for 29 documents can hold $4.93
- The reservation for document 30 is rejected for insufficient remaining budget
- Later requests remain rejected until capacity is released or added

At the stated average actual cost, 29 documents settle near $4.70. The remaining documents are queued until capacity is added or reset. Exact settlement still depends on actual usage and the configured overage policy.

The critical difference is atomicity. Cycles doesn't read-then-write. It performs an atomic compare-and-decrement. No matter how many concurrent agents check simultaneously, the budget can never be overdrawn by more than a single reservation's estimation variance.

For the full technical analysis of this failure pattern, see [Concurrent Agent Overspend](/incidents/concurrent-agent-overspend).

## Failure 5: The Scope Leak — $5,600/Month Above Plan

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

At the month-three run rate, the ML workspace is **$5,600/month above its $3,000 expectation**. If that rate continues for three months, the ML excess is **$16,800**. Total organization spend is $3,500/month above the $10,000 organization threshold, or **$10,500 over three months**.

**The math of scope misconfiguration:**

| Budget scope | What it catches | What it misses |
|---|---|---|
| Per-organization | Nothing under the org cap | Any single team consuming disproportionate share |
| Per-workspace | Workspace-level overspend | Individual runaway runs within a workspace |
| Per-workflow | Workflow-level anomalies | Cross-workflow accumulation |
| Per-run | Individual runaway runs | Gradual accumulation from many normal runs |

The right answer is hierarchical scoping: [tenant](/glossary#tenant) > workspace > app > workflow > agent > toolset. Each configured ledger contributes an atomic admission check for submitted estimates. A unique workflow value can represent one run. Coverage, estimate quality, and settlement policy still determine the economic bound.

**How budget enforcement prevents this:**

Per-workspace budgets in Cycles would have capped the ML team at $3,000/month. When their research agent usage hit that limit, the agents would be denied — not the entire tenant, just the ML workspace. The other four workspaces would continue operating normally.

The ML team would immediately know they've hit their budget. They could request an increase (with justification), optimize their agent's efficiency, or prioritize which experiments run within the cap. The decision is explicit and intentional instead of invisible and accidental.

With hierarchical enforcement:
- Tenant ledger: $10,000/month reservation ceiling
- ML workspace ledger: $3,000/month reservation ceiling
- ML research workflow keyed per run: $50 reservation ceiling
- If any level is exhausted, the specific scope is blocked while everything else continues

For more on this failure pattern, see [Scope Misconfiguration and Budget Leaks](/incidents/scope-misconfiguration-and-budget-leaks).

## The Common Pattern

Five different failures. Five different root causes — [tool loops](/glossary#tool-loop), retry cascades, unsupervised batch processing, concurrency races, scope misconfiguration. But they all share one architectural gap: **no pre-execution budget check**.

In every case, the agent was allowed to spend money without asking permission. The system learned about the spend after the fact — through dashboards, alerts, or invoices. By then, the money was gone.

| Failure | Cost | Prevention mechanism | Cost with enforcement |
|---|---|---|---|
| Infinite Tool Loop | $52.80 | Per-run budget ($15) | Near $15 |
| Retry Storm | $33.86 | Per-lookup budget ($0.25) | Up to $9.50 across 38 lookups |
| Friday Deploy | $2,300 | Per-task + batch budget | Near $500 batch cap |
| Concurrent Burst | $32.40 against $5 remaining | Atomic reservations ($5 remaining) | About $4.70 under stated averages |
| Scope Leak | $5,600/mo above plan | Hierarchical workspace budgets | $3,000/mo ML cap |

These scenarios use different time windows and assumptions, so adding them into one savings figure would be misleading. The useful comparison is the configured bound in each row.

The pattern is simple. A mandatory budget boundary asks before every protected LLM call whether the configured budget can cover the submitted estimate. If a live reservation fails, the host does not execute the call. Coverage, estimation, settlement, and overage policy still determine the real bound. For operational exposure, the host can assign and submit [risk points instead of dollars](/concepts/action-authority-controlling-what-agents-do); application authorization remains separate.

## Budget failures are not the only kind

The five failures above are all denominated in dollars. But agents also fail by *doing the wrong thing*. As an illustrative action-risk scenario, 200 mistaken emails might consume only about $1.40 in model tokens while causing much larger business harm. No monetary spending limit calibrated to token cost would necessarily catch that.

This is why a complete [runtime authority](/blog/what-is-runtime-authority-for-ai-agents) design needs more than spend accounting. Cycles can budget spend and caller-assigned exposure through the reserve-commit protocol. [Application action authority](/concepts/action-authority-controlling-what-agents-do) separately authenticates the principal and authorizes tools and arguments at the mandatory boundary.

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

The cheapest incident is the one that never happens. The next best outcome is a protected path that rejects the next estimate when configured capacity is unavailable.

## Related how-to guides

- [Assigning RISK_POINTS to agent tools](/how-to/assigning-risk-points-to-agent-tools)
- [Degradation paths](/how-to/how-to-think-about-degradation-paths-in-cycles-deny-downgrade-disable-or-defer)
- [Using the Cycles dashboard](/how-to/using-the-cycles-dashboard)
