---
title: "Cycles vs LangSmith: Enforcement vs Observability"
description: "LangSmith traces what happened after execution. Cycles decides whether execution should happen at all. See how they complement each other in a production agent stack."
---

# Cycles vs LangSmith: Enforcement vs Observability

LangSmith is one of the most widely adopted observability platforms for LLM applications. If you're building with LangChain or LangGraph, you're probably already using it — or evaluating it.

Cycles and LangSmith operate at different points in the agent lifecycle. Understanding where each fits prevents both gaps and redundancy in your production stack.

> **Run the numbers for your workload:** [Cost Calculator →](/calculators/claude-vs-gpt-cost-standalone) · [Blast Radius Risk Calculator →](/calculators/ai-agent-blast-radius-standalone) — observability records what happened; the calculators show what *will* happen at your token volume and action profile.

## What each does

| | LangSmith | Cycles |
|---|---|---|
| **When it acts** | After execution | Before execution |
| **What it answers** | "What happened?" | "Should this happen?" |
| **Core mechanism** | Tracing, logging, evaluation | Reserve → commit → release |
| **Cost tracking** | Reports actual cost per trace | Enforces cost limits per action |
| **Action control** | None — records all actions | Denies actions that exceed authority |
| **Scope** | Per-run, per-chain traces | Per-tenant, per-agent, per-action |
| **Concurrency** | N/A (read-only) | Atomic reservations (write path) |
| **Multi-tenant** | Tags and metadata | API-key-scoped tenant isolation |

## The fundamental difference

LangSmith tells you that yesterday's agent spent $47 across 312 runs, with an average latency of 2.3 seconds and a 4% error rate. That information is valuable — it drives optimization, debugging, and capacity planning.

LangSmith can alert on cost anomalies — but alerting is reactive. By the time the alert fires, the spend has already happened. Cycles operates on the write path, preventing the spend before it occurs.

Cycles operates on the write path. Before an LLM call executes, the agent must reserve budget. If the budget is exhausted, the call is denied — the model is never invoked, no tokens are consumed, no cost is incurred. This is enforcement, not observation.

## Where LangSmith stops

### No pre-execution gate

LangSmith traces are recorded during and after execution. There is no mechanism to block an LLM call before it happens based on budget state. By the time LangSmith records that an agent exceeded its budget, the money is already spent.

### No tenant-level enforcement

LangSmith supports tags and metadata for filtering traces by customer or environment. But these are labels — they don't enforce boundaries. Customer A's traces can't prevent Customer B's agent from running. There is no per-tenant budget enforcement.

### No concurrency safety

When multiple agent instances run simultaneously, LangSmith records each trace independently. It cannot coordinate across instances to prevent concurrent overspend. Two agents checking the same budget in parallel will both proceed — the classic time-of-check-to-time-of-use (TOCTOU) problem that Cycles solves with atomic reservations.

### No action authority

LangSmith records that an agent called `send_email` 200 times. Cycles prevents the 201st call if the action budget is exhausted. The distinction is between logging a side effect and governing whether the side effect should occur.

## Where Cycles stops

Cycles does not replace LangSmith. It has no:

- **Trace visualization** — no flame graphs, no chain-of-thought replay
- **Evaluation framework** — no LLM-as-judge, no dataset management
- **Prompt management** — no prompt hub, no versioning, no sharing
- **Prompt debugging** — no A/B testing, no dataset-driven evaluation
- **Latency profiling** — no per-step timing breakdown

These are observability concerns. Cycles is not an observability tool.

## How they work together

The strongest production setup uses both:

```
Request → Cycles (should this execute?) → LLM call → LangSmith (what happened?)
              ↓                                              ↓
         DENY → graceful degradation              trace → dashboard
         ALLOW → proceed with budget cap           cost → attribution
         ALLOW_WITH_CAPS → proceed with limits     latency → profiling
```

### Practical example

A customer support agent built with LangChain:

1. **Cycles** checks budget before each LLM call and tool invocation. If the per-tenant budget is low, it returns `ALLOW_WITH_CAPS` with a reduced `max_tokens` limit. If exhausted, it returns `DENY` and the agent degrades gracefully.

2. **LangSmith** traces the full execution — every chain step, tool call, and LLM response. The traces show token counts, latency, and error rates. The team uses this data to optimize prompts, evaluate response quality, and debug failures.

Neither tool can do the other's job. LangSmith cannot block an LLM call. Cycles cannot visualize a chain execution.

### Feeding Cycles data into LangSmith

The `CyclesMetrics` attached to each commit (tokens, latency, model version) are available through the Cycles API. Teams that want unified dashboards can:

- Tag LangSmith traces with the Cycles `reservation_id` for cross-referencing
- Use LangSmith's custom metadata to include Cycles decision outcomes (`ALLOW`, `DENY`, `ALLOW_WITH_CAPS`)
- Build alerting rules in LangSmith that flag traces where Cycles returned `ALLOW_WITH_CAPS` — indicating budget pressure

## Decision guide

**Use LangSmith when you need to:**
- Debug why an agent produced a bad response
- Evaluate response quality across datasets
- Profile latency across chain steps
- Track cost attribution across runs and users

**Use Cycles when you need to:**
- Prevent an agent from exceeding its budget before it acts
- Enforce per-tenant, per-agent, or per-action limits
- Handle concurrent agents safely (atomic reservations)
- Control non-LLM actions (tool calls, API requests, emails)
- Degrade gracefully when budget is low (three-way decisions)

**Use both when you need to:**
- Run agents in production with both visibility and enforcement
- Attribute cost accurately (LangSmith) while enforcing limits (Cycles)
- Debug why an agent was denied (LangSmith trace + Cycles decision)

## Key points

- **Different layers, different timing.** LangSmith observes after execution. Cycles enforces before execution. They don't overlap.
- **Observability doesn't prevent overspend.** Knowing an agent spent $47 doesn't stop the next one from spending $470.
- **Enforcement doesn't provide visibility.** Cycles tracks budget state, not execution traces. You need both for production operations.
- **Concurrency is the hidden gap.** LangSmith has no mechanism for coordinating budget across parallel agent instances. Cycles' atomic reservations solve this.

## Next steps

- [From Observability to Enforcement](/concepts/from-observability-to-enforcement-how-teams-evolve-from-dashboards-to-budget-authority) — the evolution from dashboards to runtime authority
- [Cycles vs LLM Proxies and Observability Tools](/blog/cycles-vs-llm-proxies-and-observability-tools) — how Cycles complements LiteLLM, Portkey, Helicone, and Langfuse
- [Integrating with LangChain](/how-to/integrating-cycles-with-langchain) — add Cycles to your LangChain application
- [Integrating with LangGraph](/how-to/integrating-cycles-with-langgraph) — budget governance for LangGraph workflows
