---
title: "Multi-Agent Budget Control: CrewAI, AutoGen, OpenAI"
date: 2026-03-21
author: Cycles Team
tags: [multi-agent, crewai, autogen, openai, budgets, engineering, best-practices]
description: "Multi-agent delegation chains create recursive cost exposure. Enforce per-agent budget boundaries in CrewAI, AutoGen, and OpenAI Agents SDK."
blog: true
sidebar: false
---

# Multi-Agent Budget Control: CrewAI, AutoGen, OpenAI

> **Part of: [Multi-Tenant AI Operations Reference](/guides/multi-tenant-operations)** — the full pillar covering scope hierarchy, per-tenant enforcement, multi-agent coordination, tenant lifecycle, and identity.

> **Part of: [LLM Cost Runtime Control Reference](/guides/llm-cost-runtime-control)** — the full pillar covering causes, enforcement patterns, multi-tenant boundaries, and unit economics.

A team builds a research pipeline using CrewAI with three agents: a Planner that breaks topics into sub-questions, a Researcher that investigates each one, and a Writer that synthesizes the results. The Planner delegates 5 sub-questions per topic to the Researcher. For complex sub-questions, the Researcher delegates down to a Deep Analyst agent that makes 15 LLM calls per investigation. In development, one topic costs ~$3.50.

In production, a batch of 40 topics kicks off overnight. The Researcher's delegation is non-deterministic — some topics trigger zero Deep Analyst calls, others trigger four. One topic causes all 5 sub-questions to delegate to the Deep Analyst, each triggering its own [tool loop](/glossary#tool-loop) with retries. That single topic costs $89.

| Layer | Calls (expected) | Calls (worst case) | Cost (expected) | Cost (worst case) |
|---|---|---|---|---|
| Planner | 2 | 2 | $0.30 | $0.30 |
| Researcher (5 sub-questions) | 40-60 | 40-60 | $2.50 | $2.50 |
| Deep Analyst (0-2 delegations) | 0-30 | 75 (5 × 15) | $0.70 | $47.00 |
| Retries (growing context) | ~5 | ~55 | — | $39.00 |
| **Total** | **~50-95** | **~190** | **$3.50** | **$89.00** |

The Deep Analyst's cost is not linear in call count — each retry sends a longer context window, so later calls cost 3-5× more than early ones. That is why 190 calls cost $89, not $7.

The 40-topic batch: $1,740 instead of the projected $140. Most topics cost $15-30 because production topics are more complex than the development test set. The provider dashboard shows the total. It does not show which agent in the delegation chain caused the blowout, or that delegation depth was the problem.

<!-- more -->

## Why Delegation Chains Are Different from Fan-Out

[Fan-out](/blog/langgraph-budget-control-durable-execution-retries-fan-out) creates parallel branches from a single parent — the total cost is the sum of the branches. Delegation chains create serial depth — Agent A calls Agent B calls Agent C. The cost is multiplicative because each delegator's retry and loop behavior wraps around the entire subtree below it.

If the Planner retries a failed topic, it re-executes the Researcher, which re-executes every Deep Analyst delegation. A single retry at the top of the chain replays every agent below it. This is the recursive version of the [retry storm pattern](/blog/ai-agent-failures-budget-controls-prevent) — except the blast radius grows with delegation depth, not retry count.

| Property | [Fan-out](/glossary#fan-out) (parallel) | Delegation chain (serial depth) |
|---|---|---|
| Cost structure | Additive — sum of branches | Multiplicative — product of depths |
| Concurrency risk | Branches race on shared budget | Child inherits parent's remaining budget |
| Retry blast radius | One branch retries independently | Parent retries the entire child subtree |
| Visibility | Branches visible at one graph level | Depth hidden inside opaque agent calls |
| Budget scoping | Sub-budgets per branch | Budget must flow DOWN with diminishing allocation |

## The Delegation Tax: Framework by Framework

None of the major multi-agent frameworks enforce per-agent budgets. Each provides a delegation mechanism with no cost boundary between delegator and delegate.

### CrewAI

Agents in a Crew can delegate tasks to other agents via `allow_delegation=True`. When Agent A delegates to Agent B, the framework creates a new task execution context. There is no budget boundary between them — they share the same API key and the same global execution. The Crew has no concept of "Agent B's budget." A delegated agent can make unlimited LLM calls because nothing in the framework tracks per-agent spend.

### AutoGen

Multi-agent conversations use `GroupChat` or `initiate_chat()` chains. When an AssistantAgent sends work to another agent, the receiving agent runs its own LLM call loop. AutoGen tracks message counts but not token costs. The `max_consecutive_auto_reply` setting limits message rounds, not spend. A single reply that involves 5 tool calls and 5 LLM calls counts as 1 reply toward the limit — the cost inside that reply is invisible to the framework.

### OpenAI Agents SDK

The `handoff()` mechanism passes control from one agent to another. Each agent has its own system prompt and tool definitions. The SDK provides tracing via `RunContext` but no budget enforcement. A handoff chain of 3 agents, each making 10 tool calls, produces 30+ LLM calls with no per-agent ceiling.

| Framework | Delegation mechanism | Built-in cost control | What's missing |
|---|---|---|---|
| CrewAI | `allow_delegation=True` | None | Per-agent spend limit |
| AutoGen | `initiate_chat()`, `GroupChat` | `max_consecutive_auto_reply` (count, not cost) | Token/dollar cap per agent |
| OpenAI Agents SDK | `handoff()` | None (tracing only) | Pre-execution budget check |

The common gap: these frameworks control execution flow. They do not control execution cost. That requires a [runtime authority](/blog/ai-agent-budget-control-enforce-hard-spend-limits) that sits between each agent and the LLM provider, making a deterministic allow/deny decision before every call.

## The Pattern: Hierarchical Budget Allocation for Delegation Chains

The [reserve-commit lifecycle](/blog/ai-agent-budget-control-enforce-hard-spend-limits) already solves single-agent budget enforcement. For multi-agent delegation, the same pattern applies — but budget must flow down the chain with diminishing allocations.

```
Run Budget: $25.00
├── Planner: $2.00 (reserved from run)
├── Researcher (sub-question 1): $4.00 (reserved from run)
│   └── Deep Analyst: $2.00 (reserved from Researcher's allocation)
├── Researcher (sub-question 2): $4.00
│   └── (no delegation — stays within $4.00)
├── Researcher (sub-question 3): $4.00
│   └── Deep Analyst: $2.00
├── Writer: $3.00
└── Unallocated: $4.00 (safety margin)
```

Three design principles make this work:

**Diminishing allocation.** Each delegation level gets a fraction of the parent's budget, not the full remaining balance. The Deep Analyst receives $2.00 carved from the Researcher's $4.00 — not $23.00 from the run's remaining budget. This bounds the blast radius of any single agent regardless of depth.

**Pre-delegation [reservation](/glossary#reservation).** Before Agent A delegates to Agent B, Agent A reserves the sub-budget from its own allocation. If Agent A's remaining budget cannot fund the delegation, the delegation does not happen — the agent receives a clear budget-exhausted signal and can take an alternative path. This is enforcement before the action, not observation after.

**Commit on return.** When the delegated agent completes, actual cost is committed and unused budget is released back to the parent. The Researcher reserved $2.00 for the Deep Analyst, but if the Deep Analyst only spent $1.30, the remaining $0.70 returns to the Researcher's pool. No budget is permanently locked.

## What This Looks Like in Practice

Cycles — a [runtime authority](/glossary#runtime-authority) for [autonomous agents](/glossary#autonomous-agent) — integrates with any multi-agent framework through a budget-scoped handler per agent. Each agent in the delegation chain gets its own `Subject` in the Cycles hierarchy, creating a hard limit that survives across framework boundaries.

For CrewAI, attach a handler to each agent's LLM:

```python
from langchain_openai import ChatOpenAI
from runcycles import CyclesClient, CyclesConfig, Subject
from budget_handler import CyclesBudgetHandler  # see integration guide

client = CyclesClient(CyclesConfig.from_env())

# Each agent gets a budget-scoped handler
def make_agent_llm(agent_name: str) -> ChatOpenAI:
    handler = CyclesBudgetHandler(
        client=client,
        subject=Subject(
            tenant="acme",
            workflow="research-pipeline",
            agent=agent_name,
        ),
    )
    return ChatOpenAI(model="gpt-4o", callbacks=[handler])

planner_llm = make_agent_llm("planner")       # bounded by planner's budget
researcher_llm = make_agent_llm("researcher") # bounded by researcher's budget
analyst_llm = make_agent_llm("deep-analyst")   # bounded by analyst's budget
```

For AutoGen, attach the handler to each agent's underlying model:

```python
from autogen import ConversableAgent

# Each agent gets a budget-scoped LLM
researcher = ConversableAgent(
    name="researcher",
    llm_config={
        "model": "gpt-4o",
        "callbacks": [CyclesBudgetHandler(
            client=client,
            subject=Subject(
                tenant="acme",
                workflow="research-pipeline",
                agent="researcher",
            ),
        )],
    },
)
```

For the OpenAI Agents SDK, intercept each `handoff()` boundary:

```python
from runcycles import CyclesClient, CyclesConfig, Subject

# Before handoff, reserve sub-budget from parent
def budget_handoff(parent_agent: str, child_agent: str, budget_usd: float):
    client.reserve(
        subject=Subject(
            tenant="acme",
            workflow="research-pipeline",
            agent=child_agent,
        ),
        amount=int(budget_usd * 100_000_000),  # USD to microcents
    )
```

The key is that each agent's LLM calls are bounded independently. A [checker variable in application memory is not enough](/blog/vibe-coding-budget-wrapper-vs-budget-authority) — it does not survive process restarts, does not handle concurrent agents, and does not provide atomic reservation semantics. The runtime authority must be external to the framework.

For the full callback handler implementation, see [Integrating Cycles with LangChain](/how-to/integrating-cycles-with-langchain).

## What Happens Without Per-Agent Budgets

The difference between debugging a $1,740 bill and preventing it.

| Scenario | Without per-agent budget | With Cycles |
|---|---|---|
| Deep Analyst enters tool loop | 200+ calls, $89 per topic | Budget exhausted after ~15 calls, graceful denial |
| Planner retries failed delegation | Recreates entire child subtree at full cost | New sub-budget from parent's remaining allocation |
| 40-topic overnight batch | $1,740, discovered Monday morning | Each topic capped at $25, batch max = $1,000 |
| Debugging which agent overspent | Parse API logs, reconstruct delegation chain manually | Per-agent balance queries show where spend accumulated |
| Non-deterministic delegation depth | Cost variance of 25× between topics | Hard limit per agent regardless of delegation path |

The research pipeline from the opening scenario would have stopped at $25 per topic. The Deep Analyst's tool loop would have hit its $2.00 sub-budget after ~15 calls instead of running to 75+. The overnight batch of 40 topics would have cost at most $1,000 — bounded [exposure](/glossary#exposure) instead of an open-ended bill.

## Next steps

- **[LangGraph Budget Control for Durable Execution, Retries, and Fan-Out](/blog/langgraph-budget-control-durable-execution-retries-fan-out)** — budget enforcement for graph-based fan-out (the parallel counterpart to delegation chains)
- **[AI Agent Budget Control: Enforce Hard Spend Limits](/blog/ai-agent-budget-control-enforce-hard-spend-limits)** — the reserve-commit pattern that powers per-agent enforcement
- **[5 AI Agent Failures Budget Controls Would Prevent](/blog/ai-agent-failures-budget-controls-prevent)** — [retry storm](/glossary#retry-storm) and infinite loop cost math
- **[Budget Wrapper vs Runtime Authority for AI Agents](/blog/vibe-coding-budget-wrapper-vs-budget-authority)** — why a per-agent counter is not the same as a runtime authority
- **[How Much Do AI Agents Actually Cost?](/blog/how-much-do-ai-agents-cost)** — raw provider pricing behind the cost math in this post
- **[Multi-Tenant AI Cost Control](/blog/multi-tenant-ai-cost-control-per-tenant-budgets-quotas-isolation)** — per-[tenant](/glossary#tenant) budgets for teams running multi-agent systems in shared platforms

## Related how-to guides

- [Multi-agent shared budgets](/how-to/multi-agent-shared-workspace-budget-patterns)
- [Budget control for LangChain](/how-to/how-to-add-budget-control-to-a-langchain-agent)
- [Integrating with LangGraph](/how-to/integrating-cycles-with-langgraph)
