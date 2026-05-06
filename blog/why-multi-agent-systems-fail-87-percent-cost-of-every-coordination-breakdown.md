---
title: "Multi-Agent Systems Fail Up to 87% of the Time — Here's What Each Failure Actually Costs"
date: 2026-03-29
author: Cycles Team
tags: [multi-agent, failures, cost, coordination, production, MAST, runtime-authority, engineering]
description: "UC Berkeley's MAST taxonomy found 14 failure modes across 1,600+ multi-agent traces with 41–87% failure rates. Nobody modeled what each failure costs. We built the cost model."
blog: true
sidebar: false
---

# Multi-Agent Systems Fail Up to 87% of the Time — Here's What Each Failure Actually Costs

> **Part of: [Multi-Tenant AI Operations Reference](/guides/multi-tenant-operations)** — the full pillar covering scope hierarchy, per-tenant enforcement, multi-agent coordination, tenant lifecycle, and identity.

Consider a four-agent research pipeline: Planner, Researcher, Analyst, Writer. In development, it works 90% of the time and costs $3.50 per run. In production, failure rate climbs to 55%. Each failure triggers retries, context regrowth, and cascading delegation — turning a $3.50 run into a $40+ recovery sequence. The monitoring dashboard shows 200 OK on every API call. The invoice shows $12,000 for a week that should have cost $2,800.

The published MAST and SEMAP literature explains how multi-agent systems fail, but does not model per-failure cost in production.

<!-- more -->

That's the gap between failure *rate* research and failure *cost* research. UC Berkeley's [MAST taxonomy](https://arxiv.org/abs/2503.13657) — the first systematic study of multi-agent LLM failures — analyzed 1,600+ execution traces across seven frameworks (taxonomy developed from an initial 150-trace subset, then expanded to the full MAST-Data corpus in v3 of the paper) and found failure rates ranging from 41% to 86.7%. The taxonomy identifies 14 distinct failure modes in three categories. It tells you *how* multi-agent systems break. It doesn't model what each break costs.

This post fills that gap. The MAST paper explains how multi-agent systems fail; we model what those failures cost in production. We map each MAST failure category to an illustrative cost signature — the mechanism by which a coordination breakdown becomes a line item on your invoice — and show where [runtime authority](/glossary#runtime-authority) prevents the cost from compounding. The dollar figures in this post are scenario models based on published token pricing, not measured production data.

## The Numbers: 14 Failure Modes, Three Categories, 41–87% Failure Rates

The [MAST study](https://sky.cs.berkeley.edu/project/mast/) (Cemri et al., NeurIPS 2025 Spotlight) analyzed traces from MetaGPT, ChatDev, HyperAgent, OpenManus, AppWorld, Magentic-One, and AG2. Across 1,600+ traces, the failures clustered into three categories:

| Category | Share of Failures | Example Modes |
|---|---|---|
| **System design issues** | 44.2% | Role overlap, missing escalation paths, scope ambiguity, tool misassignment |
| **Inter-agent misalignment** | 32.3% | Wrong assumptions propagated, conversation resets, lost handoff context |
| **Task verification failures** | 23.5% | Agent marks task complete when it isn't, skips validation, accepts wrong output |

The failure rates varied by framework — from 41% (best) to 86.7% (worst). Across MAST-Data, failures clustered into all three categories, and framework-level profiles varied by architecture and benchmark. Model choice mattered but didn't eliminate failures: GPT-4o showed substantially fewer specification and misalignment failures than Claude 3.7 Sonnet within MetaGPT, and Qwen2.5-Coder proved substantially more robust than CodeLlama among the open models tested. But even with better-performing model setups, failure rates remained high. The paper's key insight: **better system design improved outcomes more than better models** — up to 15.6% improvement from architectural changes alone.

A [follow-up study (SEMAP)](https://arxiv.org/html/2510.12120) using protocol-driven agent engineering in software-engineering multi-agent settings demonstrated up to 69.6% reduction in failures on function-level development tasks by enforcing structured communication protocols between agents. The problem isn't the models. It's what happens between them.

## Modeling What Each Failure Category Costs

None of the failure taxonomy research measures cost. They measure success/failure as a binary. But in production, failure isn't binary — it's a spectrum from "slightly wrong output" to an unbounded recursive loop. The cost depends on what the system does *after* the failure occurs.

The following cost models are illustrative scenarios based on published per-token pricing (GPT-4o, Claude Sonnet 4). Your numbers will vary by model, context length, and workflow design — but the structural relationships hold: misalignment multiplies cost through the chain, verification failures compound through rework, and design issues generate redundant compute.

### Category 1: Inter-Agent Misalignment (32.3% of failures)

**What happens:** Agent A passes context to Agent B. Agent B misinterprets it, proceeds with wrong assumptions, and produces output that Agent C builds on. The error propagates through the chain. By the time it surfaces — if it surfaces at all — three agents have consumed [tokens](/glossary#tokens) based on a wrong premise.

**Cost signature: Token multiplication through error propagation.**

A single misaligned handoff doesn't just waste one agent's compute — it poisons every downstream agent's work. The MAST taxonomy documents this as "proceeding with wrong assumptions instead of seeking clarification" — one of the most common inter-agent misalignment modes.

The multiplier is non-linear because each downstream agent receives a *longer* context (the original plus the wrong output), making every subsequent call more expensive. And when the final output is wrong, the entire chain retries — doubling the cost again. Here's an illustrative model for a chain using GPT-4o at published pricing:

| Agents in chain | Expected cost (model) | Cost with one misaligned handoff (model) | Multiplier |
|---|---|---|---|
| 2 | $1.20 | $3.60 | 3× |
| 3 | $2.80 | $11.20 | 4× |
| 4 | $4.50 | $31.50 | 7× |
| 5+ | $7.00 | $49.00+ | 7×+ |

**Illustrative scenario:** A coding pipeline where a Planner agent decomposes a task incorrectly. The Coder agent writes code for the wrong decomposition. The Reviewer agent flags failures. The system retries the entire chain. Three full passes before succeeding: 3× the expected cost, with the third pass carrying the accumulated context of the first two.

### Category 2: Task Verification Failures (23.5% of failures)

**What happens:** An agent declares a task complete when it isn't. The system moves forward. Downstream agents build on an incomplete foundation. The error is discovered late — by a human, a test suite, or never. The MAST taxonomy identifies this as a distinct failure category where agents skip validation steps or accept incorrect output as sufficient.

**Cost signature: Wasted work plus late-stage rework.**

Without a mechanism to verify completion externally, two agents can pass each other outputs that both consider "complete" — looping indefinitely while monitoring shows 200 OK on every call. The spend accumulates silently because the system has no mechanism to ask: "Is this work unit actually done?"

The following table models the cost multiplier range for each verification failure subtype:

| Verification failure type | Estimated cost impact (model) | Detection latency |
|---|---|---|
| Premature completion (agent skips steps) | 2–3× (rework) | Hours to days |
| False positive validation (agent says "pass" on wrong output) | 4–8× (cascade + rework) | Days to weeks |
| Recursive non-convergence (agents loop without progress) | 10×+ (unbounded without caps) | Until budget exhausted |

The [LangChain State of AI Agents report](https://www.langchain.com/state-of-agent-engineering) found that quality is the #1 barrier to production for 32% of respondents — and verification failures are a primary mechanism by which quality degrades at scale.

### Category 3: System Design Issues (44.2% of failures)

System design is the largest failure category in the MAST taxonomy — nearly half of all failures originate from how the multi-agent system is *architected*, not from how individual agents *reason*.

**What happens:** Agents have overlapping responsibilities, ambiguous scope boundaries, or missing escalation paths. Two agents attempt the same subtask. An agent makes tool calls it shouldn't. A delegation chain has no depth limit.

**Cost signature: Redundant compute plus concurrency overruns.**

As agent count grows, coordination overhead grows faster than work output. Every agent added to a workflow needs to exchange context with other agents — messages about who does what, status updates, shared state synchronization. These coordination tokens are real spend that doesn't appear on any "useful work" ledger.

The following model illustrates how coordination overhead scales in a flat-topology multi-agent system where each agent exchanges context with every other agent:

| Agents | Work tokens (model) | Coordination tokens (model) | Coordination overhead |
|---|---|---|---|
| 2 | 10,000 | 2,000 | 20% |
| 3 | 15,000 | 6,000 | 40% |
| 5 | 25,000 | 25,000 | 100% |
| 8 | 40,000 | 96,000 | 240% |

The MAST paper's own finding supports this directionally: it observed a saturation effect where adding more agents to a system stopped improving outcomes and began introducing new failure modes. And when two agents collide on the same subtask due to role ambiguity, both consume full resources — doubling the cost of that subtask for zero additional value.

## The Compound Effect: What 50% Failure Rate Actually Costs

When you combine all three failure categories, the cost impact compounds. The following scenario model illustrates a production multi-agent system processing 1,000 runs per day, using GPT-4o pricing and assuming each failed run triggers an average of one full retry plus partial rework:

| Metric | Healthy run (model) | Failed run avg (model) | Daily blend at 50% failure |
|---|---|---|---|
| Token consumption | 45,000 | 180,000 | 112,500 |
| API calls | 12 | 47 | 29.5 |
| Cost per run | $3.50 | $18.40 | $10.95 |
| **Daily cost (1,000 runs)** | **$3,500** | **$18,400** | **$10,950** |

At a 50% failure rate — which is *optimistic* relative to MAST's findings of 41–87% — daily spend in this model is 3.1× higher than expected. Over a month, that's $328,500 instead of $105,000. The $223,500 difference represents the cost of coordination failures that your monitoring never attributes to coordination.

The structural problem is that token prices keep falling — but multi-agent architectures multiply consumption faster than prices drop. Every agent added, every retry triggered, every coordination message exchanged adds tokens that don't appear on a "useful work" ledger.

## Why Observability Doesn't Catch This

Standard monitoring shows:
- **Per-call metrics:** Latency, status code, token count. All green.
- **Aggregate metrics:** Total spend, total calls, average latency. Trending up, but slowly enough to look like growth.
- **Provider dashboards:** Monthly total by model. No breakdown by agent, scope, or failure mode.

What's missing:
- **Per-agent, per-run cost attribution.** Which agent in the chain caused the blowout?
- **Failure-cost correlation.** How much did each failed run cost vs. each successful one?
- **Coordination overhead tracking.** What percentage of tokens went to agent-to-agent communication vs. actual work?
- **Pre-execution cost projection.** Before the run starts, what's the maximum it can cost?

Observability tells you the temperature of the room. It doesn't stop the thermostat from running up the bill. As we covered in [Cycles vs LLM Proxies and Observability Tools](/blog/cycles-vs-llm-proxies-and-observability-tools), observability platforms record what happened — they don't prevent what's about to happen.

## How Runtime Authority Contains the Blast Radius

Runtime authority doesn't fix coordination — it bounds the cost of coordination failures. Every agent call requires a budget [reservation](/glossary#reservation) *before* execution. When the budget is exhausted, the next call is denied. The failure still occurs, but the cost is capped.

Here's how each MAST failure category maps to runtime authority enforcement:

### Inter-agent misalignment → Per-agent budget boundaries

Each agent in the chain gets its own budget scope. When Agent B misinterprets Agent A's context and starts a wasteful chain of calls, it hits its own budget limit — not the system's total budget:

```
Planner  → scope: workflow:research/agent:planner    budget: $2.00
Researcher → scope: workflow:research/agent:researcher  budget: $5.00
Analyst  → scope: workflow:research/agent:analyst    budget: $8.00
Writer   → scope: workflow:research/agent:writer     budget: $3.00
```

If the Researcher misaligns and burns through its $5.00 on a wrong-premise investigation, it gets a `409 BUDGET_EXCEEDED` — not a quiet degradation that poisons the Analyst's work too. The [reserve-commit pattern](/protocol/how-reserve-commit-works-in-cycles) ensures every call is accounted for before execution.

In the model above, the error propagation multiplier drops from 7×+ to 1–2× because the blast radius is contained to the failing agent's scope.

### Task verification failures → Per-run budget caps

Recursive non-convergence — agents looping without progress — is the most expensive failure mode. Without a cap, it runs until someone notices or the provider rate-limits you.

With a per-run budget, the loop is bounded:

```
Run budget: $15.00
Iteration 1-4: $3.50 each → $14.00 committed
Iteration 5: Reserve $3.50 → DENY (budget: $1.00 remaining)
```

The run fails, but at $15 — not at an unbounded amount. The system can [gracefully degrade](/blog/ai-agent-failures-budget-controls-prevent): fall back to a simpler strategy, escalate to a human, or return a partial result with a cost-exceeded flag.

### System design issues → Scope-isolated coordination budgets

When agents have overlapping responsibilities and two attempt the same subtask, both consume budget. With scope isolation, you can enforce that each subtask has a single budget allocation:

```
Subtask "data-extraction" → scope: workflow:research/task:data-extraction
  budget: $4.00 (shared across all agents claiming this task)
```

The first agent to reserve against this scope gets the budget. If a second agent attempts the same subtask, the reservation reflects the remaining budget — preventing redundant work from doubling costs. This is the [multi-tenant isolation pattern](/blog/multi-tenant-ai-cost-control-per-tenant-budgets-quotas-isolation) applied at the task level.

## Scenario Model: Guarded vs. Unguarded at Scale

Returning to the 1,000 runs/day scenario model, here's the illustrative impact of runtime authority:

| Metric | Unguarded (model) | Guarded (model) |
|---|---|---|
| Failed run cost (avg) | $18.40 | $8.20 (capped at 2.3× healthy) |
| Daily cost | $10,950 | $5,850 |
| Monthly cost | $328,500 | $175,500 |
| **Monthly delta** | — | **$153,000** |

The failure rate doesn't change — that requires better system design, structured protocols, and the kind of architectural work the MAST and SEMAP research recommends. What changes is the cost of each failure. Runtime authority turns unbounded failures into bounded ones.

And the per-agent, per-run budget data creates the attribution layer that observability alone can't provide. When you can see that `agent:analyst` is consuming 4× its expected budget on 30% of runs, you know exactly where to invest in better coordination — which is what the MAST research says matters more than model upgrades.

## What To Do Now

If you're building or operating multi-agent systems:

1. **Measure your actual failure rate.** Run the [MAST annotator](https://github.com/multi-agent-systems-failure-taxonomy/MAST) (`pip install agentdash`) against your traces. The number will be higher than you think.

2. **Calculate your failure cost multiplier.** Compare per-run cost for successful vs. failed runs. If the ratio is above 3×, coordination failures are a significant budget line item.

3. **Start with per-agent budget boundaries.** Even before optimizing coordination, [scope each agent's budget independently](/blog/multi-agent-budget-control-crewai-autogen-openai-agents-sdk). This bounds the blast radius of any single coordination failure.

4. **Add per-run caps for recursive workflows.** Any multi-agent workflow with retry logic or iterative refinement needs a hard ceiling. The [reserve-commit pattern](/blog/ai-agent-budget-control-enforce-hard-spend-limits) provides this without code changes to your agent logic.

5. **Use the cost data to prioritize design fixes.** Runtime authority doesn't replace good system design — it gives you the data to invest in the right design improvements. When you see that inter-agent misalignment is driving a disproportionate share of your spend, you know that structured handoff protocols (like SEMAP's approach) are worth building.

The MAST research proves that multi-agent failures are systematic, not random. Runtime authority ensures those systematic failures have a predictable, bounded cost — and generates the per-agent attribution data you need to fix the root causes.

## Sources

Research and data referenced in this post:

- [MAST: Why Do Multi-Agent LLM Systems Fail?](https://arxiv.org/abs/2503.13657) — Cemri et al., UC Berkeley. NeurIPS 2025 Datasets & Benchmarks Track Spotlight. 1,600+ annotated traces (MAST-Data, v3), 14 failure modes, 41–87% failure rates across 7 frameworks. Primary source for failure category percentages (Figure 1: system design 44.2%, inter-agent misalignment 32.3%, task verification 23.5%)
- [MAST Project Page — UC Berkeley Sky Computing Lab](https://sky.cs.berkeley.edu/project/mast/) — Dataset, taxonomy, and annotator tools
- [SEMAP: Protocol-Driven Multi-Agent Engineering](https://arxiv.org/html/2510.12120) — Up to 69.6% failure reduction on function-level development tasks through structured communication protocols in software-engineering multi-agent settings
- [LangChain State of AI Agents](https://www.langchain.com/state-of-agent-engineering) — 57.3% have agents in production, quality is #1 barrier (32%)

All dollar figures in cost tables and scenario models are illustrative. They are not measured production data. Pricing assumptions: GPT-4o at $2.50 input / $10.00 output per 1M tokens ([OpenAI API docs](https://developers.openai.com/api/docs/models/gpt-4o)); Claude Sonnet 4 at $3.00 input / $15.00 output per 1M tokens ([Anthropic API pricing](https://docs.anthropic.com/en/docs/about-claude/models)). Verify current rates before using these models for your own budgeting.

## Further Reading

- [Multi-Agent Budget Control: CrewAI, AutoGen, OpenAI](/blog/multi-agent-budget-control-crewai-autogen-openai-agents-sdk) — Per-agent budget patterns for popular frameworks
- [AI Agent Silent Failures: Why 200 OK Is the Most Dangerous Response](/blog/ai-agent-silent-failures-why-200-ok-is-the-most-dangerous-response) — When failures look like successes
- [AI Agent Budget Control: Enforce Hard Spend Limits](/blog/ai-agent-budget-control-enforce-hard-spend-limits) — The reserve-commit pattern that bounds runaway cost
- [5 AI Agent Failures Budget Controls Would Prevent](/blog/ai-agent-failures-budget-controls-prevent) — Specific failure scenarios with dollar math
- [Cycles vs LLM Proxies and Observability Tools](/blog/cycles-vs-llm-proxies-and-observability-tools) — Why monitoring alone isn't enforcement
- [The True Cost of Uncontrolled AI Agents](/blog/true-cost-of-uncontrolled-agents) — The observability gap and why dashboards fail
