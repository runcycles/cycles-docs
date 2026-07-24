---
title: "Multi-Agent Budget Control: CrewAI, AutoGen, OpenAI"
date: 2026-03-21
author: Cycles Team
tags: [multi-agent, crewai, autogen, openai, budgets, engineering, best-practices]
description: "Multi-agent delegation creates recursive cost exposure. Learn how to enforce per-agent budget boundaries in CrewAI, AutoGen, and OpenAI Agents SDK runtimes."
blog: true
sidebar: false
head:
  - - meta
    - name: keywords
      content: multi-agent budget control, CrewAI budgets, AutoGen budgets, OpenAI Agents SDK, agent delegation costs, runtime authority
---

# Multi-Agent Budget Control: CrewAI, AutoGen, OpenAI

> **Part of: [Multi-Tenant AI Operations Reference](/guides/multi-tenant-operations)** — the full pillar covering scope hierarchy, per-tenant enforcement, multi-agent coordination, tenant lifecycle, and identity.

> **Part of: [LLM Cost Runtime Control Reference](/guides/llm-cost-runtime-control)** — the full pillar covering causes, enforcement patterns, multi-tenant boundaries, and unit economics.

Consider a constructed research pipeline with three agents: a Planner that breaks topics into sub-questions, a Researcher that investigates each one, and a Writer that synthesizes the results. The Planner delegates five sub-questions per topic to the Researcher. For complex sub-questions, the Researcher delegates to a Deep Analyst that makes 15 LLM calls per investigation. Under the illustrative assumptions below, one development topic costs about $3.50.

In production, a batch of 40 topics kicks off overnight. The Researcher's delegation is non-deterministic — some topics trigger zero Deep Analyst calls, others trigger four. One topic causes all 5 sub-questions to delegate to the Deep Analyst, each triggering its own [tool loop](/glossary#tool-loop) with retries. That single topic costs $89.

| Layer | Calls (expected) | Calls (worst case) | Cost (expected) | Cost (worst case) |
|---|---|---|---|---|
| Planner | 2 | 2 | $0.30 | $0.30 |
| Researcher (5 sub-questions) | 40-60 | 40-60 | $2.50 | $2.50 |
| Deep Analyst (0-2 delegations) | 0-30 | 75 (5 × 15) | $0.70 | $47.00 |
| Retries (growing context) | ~5 | ~55 | — | $39.00 |
| **Total** | **~50-95** | **~190** | **$3.50** | **$89.00** |

The Deep Analyst's cost is not linear in call count — each retry sends a longer context window, so later calls cost 3-5× more than early ones. That is why 190 calls cost $89, not $7.

Under the same constructed model, a 40-topic batch totals $1,740 instead of the projected $140. Provider attribution depends on the keys, projects, and tracing metadata the application supplies; a shared provider identity will not infer this agent hierarchy on its own.

<!-- more -->

## Why Delegation Chains Are Different from Fan-Out

[Fan-out](/blog/langgraph-budget-control-durable-execution-retries-fan-out) creates parallel branches from a single parent. Delegation chains create serial depth—Agent A calls Agent B calls Agent C. Costs are still the sum of executed work, but a retry at a higher level can replay an entire lower subtree, causing the amount of work to grow rapidly with depth.

If the Planner retries a failed topic, it re-executes the Researcher, which re-executes every Deep Analyst delegation. A single retry at the top of the chain replays every agent below it. This is the recursive version of the [retry storm pattern](/blog/ai-agent-failures-budget-controls-prevent) — except the blast radius grows with delegation depth, not retry count.

| Property | [Fan-out](/glossary#fan-out) (parallel) | Delegation chain (serial depth) |
|---|---|---|
| Cost structure | Sum of concurrently executed branches | Sum of nested work, with upper-level retries able to replay subtrees |
| Concurrency risk | Branches may contend for a shared budget | Nested calls may share an ancestor workflow budget when callers submit that scope |
| Retry blast radius | One branch retries independently | Parent retries the entire child subtree |
| Visibility | Branches visible at one graph level | Depth hidden inside opaque agent calls |
| Budget scoping | Explicit branch/workflow scopes where the framework exposes them | Explicit workflow and agent ledgers; no automatic inheritance or transfer |

## The Delegation Tax: Framework by Framework

Multi-agent frameworks expose different usage, termination, guardrail, and hook surfaces. Those controls should be used where they fit, but they do not automatically create Cycles ledgers or a shared cross-provider dollar boundary for each application-defined agent.

### CrewAI

CrewAI supports delegation and exposes usage/operational controls that vary by version and configuration. A Cycles integration still needs to identify each protected model or tool call and submit the intended workflow and agent subjects; the framework does not provision those external budgets automatically.

### AutoGen

AutoGen APIs differ between its stable core/AgentChat packages and the legacy 0.2 `GroupChat`/`ConversableAgent` surface. Conversation termination controls such as legacy `max_consecutive_auto_reply` bound replies rather than an application-defined dollar amount. Use the current runtime's usage and termination features, then add an external budget boundary only where their semantics do not meet the requirement.

### OpenAI Agents SDK

The SDK's `handoff()` mechanism passes control to another agent. Current releases aggregate request and token usage across model calls, tool calls, and handoffs in the run context, and applications can use that usage to implement limits. That is useful, but it is not itself a pre-execution reservation against an external per-agent dollar ledger.

| Framework | Delegation mechanism | Useful native control | What a Cycles integration adds |
|---|---|---|---|
| CrewAI | Crew/agent delegation | Framework usage and execution controls | External scoped budget for instrumented calls |
| AutoGen | Version-specific AgentChat/Core orchestration | Termination and runtime controls | External cumulative budget with caller-supplied scopes |
| OpenAI Agents SDK | `handoff()` / agents as tools | Aggregated request/token usage, hooks, and tool guardrails | Pre-execution reservation when the application requires it |

The integration question is whether the native control is evaluated before the cost-bearing operation, uses the unit and scope your application needs, and remains consistent across every provider path. If not, a [runtime budget boundary](/blog/ai-agent-budget-control-enforce-hard-spend-limits) can fill that specific gap.

## The Pattern: Explicit Shared and Per-Agent Ledgers

The [reserve-commit lifecycle](/blog/ai-agent-budget-control-enforce-hard-spend-limits) can apply to each protected call in a multi-agent run. Cycles does not transfer a parent balance to a child or infer the delegation graph. An operator provisions the intended workflow and agent budgets, and each integration submits the matching `Subject`.

```
Topic workflow budget: $25.00  ← shared ancestor ceiling
├── planner agent budget:       $2.00
├── researcher agent budget:   $12.00
├── deep-analyst agent budget:  $4.00
└── writer agent budget:        $3.00
```

These are overlapping ceilings, not carved-out balances. A Deep Analyst call submitted with both the topic workflow and `deep-analyst` agent scopes consumes the matching workflow and agent ledgers atomically.

Three design principles make this work:

**Explicit child ceilings.** Provision smaller agent ledgers where deeper agents should have less room. An absent ledger is skipped; it is not a zero budget. If a path must be disabled, the host must deny it or the operator must provision an explicit zero allocation at the intended scope.

**Mandatory per-call integration.** Every cost-bearing child call must reserve before execution with the correct workflow and agent subjects. Creating a ledger does not intercept framework traffic on its own.

**Per-call settlement.** A commit settles the caller-reported actual amount and releases any unused part of that call's estimate back to the same matching ledgers. It does not transfer a child allocation back to a parent.

## What This Looks Like in Practice

The integration point depends on the framework version:

| Framework | Candidate boundary | Cycles requirement |
|---|---|---|
| CrewAI | Each agent's configured model client and consequential tool wrapper | Submit a stable workflow ID and the actual agent role on every protected call |
| AutoGen | The current model-client or runtime middleware surface | Do not copy legacy `ConversableAgent` examples into a newer runtime without checking its API |
| OpenAI Agents SDK | Model/tool lifecycle hooks; use the published Cycles integration where it covers the call | Usage is observable in `RunContext`, but a hard external budget still needs a reservation before the protected operation |

The handler must build a `Subject` such as `tenant=acme`, `workflow=topic-123`, and `agent=deep-analyst` for each protected call. The corresponding workflow and agent budgets must already exist. A fictitious generic `CyclesBudgetHandler` is not part of the Cycles clients; use the framework-specific guide or implement the reserve/commit/release calls directly.

See [Integrating Cycles with CrewAI](/how-to/integrating-cycles-with-crewai), [Integrating Cycles with AutoGen](/how-to/integrating-cycles-with-autogen), and [Integrating Cycles with OpenAI Agents](/how-to/integrating-cycles-with-openai-agents). Recheck those guides against the framework version in your lockfile.

## What Explicit Ledgers Change

For the constructed scenario, assume each topic has a unique workflow scope, all protected calls use conservative estimates, and the relevant workflow and agent ledgers are explicitly provisioned:

| Scenario | Without the scoped boundary | With mandatory Cycles reservations |
|---|---|---|
| Deep Analyst enters tool loop | Calls continue until a framework/provider limit or application stop | First call whose estimate no longer fits the agent or workflow ledger is rejected |
| Planner retries failed delegation | A new execution can replay the child subtree | New child calls continue consuming the same explicit workflow and agent ceilings |
| 40-topic overnight batch | Illustrative total reaches $1,740 | Submitted estimates are bounded by $25 per topic when each topic has its own workflow ledger |
| Debugging which agent consumed budget | Shared provider identity requires trace reconstruction | Cycles balance/lifecycle records show submitted and settled amounts by configured subject |
| Non-deterministic delegation depth | Cost varies with executed work | Depth cannot consume beyond the configured estimated headroom without a denied reservation |

This bounds the [exposure](/glossary#exposure) represented by the submitted estimates. It does not prove a $1,000 provider-bill maximum unless estimates conservatively cover actual usage, every path is instrumented, and the selected commit-overage policy is acceptable.

## Framework sources

Framework behavior was rechecked on July 24, 2026. APIs evolve, so use the documentation for the version in your lockfile:

- [OpenAI Agents SDK usage tracking](https://openai.github.io/openai-agents-python/usage/)
- [OpenAI Agents SDK handoffs](https://openai.github.io/openai-agents-python/handoffs/)
- [AutoGen stable documentation](https://microsoft.github.io/autogen/stable/)
- [CrewAI documentation](https://docs.crewai.com/)

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
