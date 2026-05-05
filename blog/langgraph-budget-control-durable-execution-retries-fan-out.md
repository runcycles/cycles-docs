---
title: "LangGraph Budget Control for Durable Execution, Retries, and Fan-Out"
date: 2026-03-21
author: Cycles Team
tags: [langgraph, budgets, engineering, durable-execution, best-practices]
description: "LangGraph runs pause, resume, retry, and fan out. Enforce per-run and per-node spend limits before durable execution turns cost spikes into cost cliffs."
blog: true
sidebar: false
---

# LangGraph Budget Control for Durable Execution, Retries, and Fan-Out

A team builds an insurance claim processor in LangGraph. The graph has six nodes — classify, extract, validate, enrich, review, decide — with checkpointing enabled so runs can pause and resume. It works well in development.

In production, a batch of 200 claims kicks off on Tuesday morning. The "enrich" node calls an external API that starts returning rate-limit errors. LangGraph's node-level retry policy retries each failed enrich call three times. Each retry triggers a new LLM call to re-plan the enrichment approach — $0.45 per attempt. Across 200 claims, 600 extra LLM calls add $270 in retry spend on top of the original $180. Total bill: $450 instead of $180.

Then it gets worse. Twelve claims trigger the "review" node to fan out into four parallel sub-graphs — one per policy type. Each sub-graph has its own retry policy. When the sub-graphs encounter the same rate limit, each retries independently — 4 branches × 3 retries × $6.65 per branched retry = $80 per claim. Those 12 claims alone burn through $960 in an hour.

The [provider dashboard shows the spike at 6 PM](/blog/cycles-vs-llm-proxies-and-observability-tools) when someone checks. The team's $500/month spending cap hasn't triggered — it's March 4th, and the monthly total is only at $1,410.

Durable execution makes agents more reliable. It also makes cost failures more expensive — because every retry, resume, and [fan-out](/glossary#fan-out) replays work that already cost money.

<!-- more -->

## Why Durable Execution Changes the Budget Problem

One-shot agents have a simple cost model: one pass through the workflow, one bill. If the run fails, you lose that run's cost. The waste is bounded.

Durable graph agents — whether built on LangGraph, Temporal, or Restate — break this model. Runs checkpoint, pause, resume, retry, and branch. The cost of a single logical run is not "one pass." It is the sum of every attempt, across every checkpoint, across every branch.

Three properties of durable execution change how bounded [exposure](/glossary#exposure) works:

**Checkpoints create replay surfaces.** When a graph resumes from a checkpoint, it can re-execute nodes that already consumed [tokens](/glossary#tokens) and triggered side effects. If the budget system does not know which nodes already ran, it cannot prevent double-charging.

**Retries compound across graph depth.** A retry at the graph level replays multiple nodes. A retry at the node level replays multiple LLM calls within that node. If both layers have retry policies, the total cost is the product, not the sum. A 3× graph retry with 3× node retry produces up to 9× the expected cost for a single pass.

**Fan-out multiplies exposure.** Parallel branches in a graph execute concurrently, each consuming budget independently. Four branches sharing a $40 budget can each see "$40 remaining," each proceed, and spend $160 total — because a simple balance check is not an atomic [reservation](/glossary#reservation).

| Property | One-shot agent | Durable graph agent |
|---|---|---|
| Retry cost | Replays full run | Replays from checkpoint — may re-execute completed nodes |
| Fan-out cost | Sequential, predictable | Parallel, multiplicative |
| Failure blast radius | One run's budget | Accumulated spend across all attempts |
| Budget check timing | Before each LLM call | Before each LLM call + before each node + before each retry |
| Concurrency risk | Low (single thread) | High (parallel branches, shared budget) |

This is not a theoretical concern. It is the default behavior of any graph-based agent framework with persistence and retry logic enabled. The framework does its job — making execution reliable. The missing piece is making execution **bounded**.

## The Four Budget Problems in LangGraph Workflows

Each problem maps to a specific failure mode in graph-based execution.

### 1. Replayed nodes re-spend

A graph resumes from a checkpoint after a transient failure. The upstream nodes — which already ran, consumed tokens, and produced results — execute again. Each replay triggers real LLM calls with real cost. Without idempotent cost tracking, you pay twice for work that already succeeded.

This is invisible in simple testing because you rarely resume from checkpoints during development. It surfaces in production when your persistence layer is doing exactly what it should: recovering gracefully from failures.

### 2. Retry storms at graph depth

LangGraph supports retry policies at multiple levels: individual tool calls, node-level retries, and graph-level restarts. Each layer is reasonable in isolation. Together, they multiply.

A graph with 3 retries per node and 3 retries per graph can produce up to 9 executions of a single node. Add an SDK-level retry on transient HTTP errors (another 3×), and you are looking at 27 executions of a node you expected to run once. At $0.45 per node execution, a $0.45 step becomes a $12.15 step.

These three retry layers operate at different levels of the stack. SDK retries replay a single HTTP call — transparent to the node, cost = one LLM call per attempt. Node retries re-execute the node function, which may contain multiple LLM calls and tool invocations — cost = the full node body per attempt. Graph-level retries resume from a checkpoint and re-enter the node from persisted state, replaying everything above. Each layer compounds the cost of the layers below it.

This is the same geometric multiplication pattern behind the [retry storm failure that cost $1,800 in 12 minutes](/blog/ai-agent-failures-budget-controls-prevent). Durable execution does not prevent [retry storms](/glossary#retry-storm) — it makes them more likely, because the framework is designed to keep trying.

### 3. Fan-out branches racing for shared budget

A LangGraph node fans out into four parallel sub-graphs. Each sub-graph checks the remaining budget before starting. All four see "$40 remaining" because they check concurrently. All four proceed. Total spend: $160.

This is the concurrency problem that breaks every application-level budget checker. A variable in memory, a row in a database, even a Redis counter — none of these provide the atomic reserve-and-deduct semantics needed when multiple branches spend from the same budget simultaneously. The fundamental issue is that [a checker is not an authority](/blog/vibe-coding-budget-wrapper-vs-budget-authority).

### 4. Checkpoint-unaware budget state

If budget tracking lives in application memory — a counter, a running total, a class variable — it is lost when the process restarts. LangGraph checkpoints the graph state. It does not checkpoint your budget counter.

When the graph resumes from a checkpoint, the agent's state is restored. The budget counter resets to zero. The actual spend does not. The agent now believes it has a full budget and proceeds to spend it again.

This failure mode is unique to durable execution. One-shot agents don't survive process restarts, so in-memory budget tracking, while fragile, at least fails safely — the agent dies with the process. Durable agents survive restarts by design. Their budget tracking must survive too.

## The Pattern: Reserve at the Node, Settle at the Edge

The [reserve-commit lifecycle](/blog/ai-agent-budget-control-enforce-hard-spend-limits) already solves the core problem of pre-execution budget enforcement. For durable graph execution, the same pattern applies — but scoped to the graph's structure:

**Run-level budget.** A hard limit for the entire graph execution, including all retries and fan-outs. No combination of retries, replays, or parallel branches can exceed it.

**Node-level reservation.** Before each node executes, reserve the estimated cost from the run budget. The reservation is atomic — if the budget is insufficient, the node does not start. The run receives a clear budget-exhausted signal instead of silently proceeding.

**Idempotent commit.** When a node completes, commit the actual cost with a unique execution identifier (run ID + node ID + attempt number). If the same node replays on retry or resume, the commit operation recognizes the duplicate and does not charge again. The node ran once; it pays once.

**Retry-safe settlement.** On retry, check whether a reservation for this node-execution already exists. If it was committed (node completed successfully), skip the reservation — the cost is already settled. If it was reserved but never committed (the process crashed mid-execution), release the stale reservation and create a fresh one.

**Fan-out budget scoping.** Each parallel branch receives a sub-budget carved atomically from the parent budget. Branch A gets $10, Branch B gets $10, Branch C gets $10, Branch D gets $10. The parent's budget decreases by $40 in a single atomic operation. No branch can overspend because each sub-budget is a hard ceiling, not a shared pool.

| LangGraph event | Budget action | What it prevents |
|---|---|---|
| Graph start | Create run budget | Unbounded total spend |
| Node entry | Reserve from run budget | Node executing without budget |
| LLM call within node | Check reservation covers call | Mid-node overrun |
| Node completion | Commit actual cost (idempotent) | Double-charging on replay |
| Node failure + retry | Release uncommitted reservation, re-reserve | Leaked reservations |
| Fan-out (parallel branches) | Allocate sub-budgets from parent | Concurrent overspend |
| Fan-in (join) | Reconcile sub-budget actuals to parent | Accounting drift |
| Graph completion | Settle run budget, release unused | Over-reservation |

## What This Looks Like in Practice

Cycles — a [runtime authority](/glossary#runtime-authority) for [autonomous agents](/glossary#autonomous-agent) — integrates with LangGraph through a [LangChain callback handler](/how-to/integrating-cycles-with-langchain) on the model. The handler fires on every LLM call inside every node: it creates a reservation on `on_llm_start`, commits actual cost on `on_llm_end`, and releases on `on_llm_error`. The reservation boundary sits at the model call, not at the graph edge — so a node that makes three LLM calls gets three reservations.

```python
from langgraph.graph import StateGraph, START, END
from langgraph.checkpoint.memory import MemorySaver
from langchain_openai import ChatOpenAI
from runcycles import CyclesClient, CyclesConfig, Subject
from budget_handler import CyclesBudgetHandler  # see integration guide

client = CyclesClient(CyclesConfig.from_env())

handler = CyclesBudgetHandler(
    client=client,
    subject=Subject(
        tenant="acme",
        workflow="claims-processing",
        agent="classifier",
    ),
)

# The handler attaches to the model, not the graph.
# Every LLM call inside any node gets a pre-execution budget check.
llm = ChatOpenAI(model="gpt-4o", callbacks=[handler])

def classify(state: dict) -> dict:
    # ← on_llm_start fires here: reservation created
    result = llm.invoke(state["messages"])
    # ← on_llm_end fires here: actual cost committed
    return {"messages": [result]}

graph = StateGraph(dict)
graph.add_node("classify", classify)
graph.add_node("extract", extract)
graph.add_node("enrich", enrich)
graph.add_edge(START, "classify")
graph.add_edge("classify", "extract")
graph.add_edge("extract", "enrich")
graph.add_edge("enrich", END)

app = graph.compile(checkpointer=MemorySaver())
```

When LangGraph resumes from a checkpoint and re-enters a node, the handler treats it like any other LLM call — the reservation fires again. [Idempotency keys](/glossary#idempotency-key) on commits (run ID + node ID + attempt number) prevent double-charging: a retried node creates a new reservation, while a replayed-from-checkpoint node that already committed is recognized as settled.

For fan-out, each parallel review node gets its own model instance with a budget-scoped handler:

```python
# Each review node gets its own budget-scoped handler
for branch in ["liability", "medical", "property", "general"]:
    branch_handler = CyclesBudgetHandler(
        client=client,
        subject=Subject(
            tenant="acme",
            workflow="claims-processing",
            agent=f"review-{branch}",
        ),
    )
    branch_llm = ChatOpenAI(model="gpt-4o", callbacks=[branch_handler])

    def make_review_node(model):
        def review(state: dict) -> dict:
            return {"messages": [model.invoke(state["messages"])]}
        return review

    graph.add_node(f"review_{branch}", make_review_node(branch_llm))
```

Each parallel node's LLM calls are budget-bounded independently. The scoped `Subject` per branch means Cycles tracks spend separately — no shared-pool race condition.

For the full callback handler implementation and runnable examples, see [Integrating Cycles with LangChain](/how-to/integrating-cycles-with-langchain).

## What Happens Without Node-Level Budget Control

The difference is not subtle. It is the difference between a cost surprise and a cost bound.

| Scenario | Without node-level control | With Cycles |
|---|---|---|
| Graph resumes from checkpoint | All nodes re-execute, full cost repeated | Idempotent commit skips already-settled nodes |
| 3-level nested retry | Up to 27× cost multiplier (3×3×3) | Run budget caps total across all retries |
| 4-way fan-out, $40 remaining | All 4 branches proceed, $160 spent | Sub-budgets: 4 × $10, total capped at $40 |
| Process crash mid-node | Reservation leaked, budget permanently reduced | Uncommitted reservation auto-released on retry |
| Overnight batch of 500 graph runs | No per-run limit, total cost unknown until morning | Each run bounded, batch total = sum of run budgets |

The insurance claim processor from the opening scenario would have stopped at $180 — enforcement before the action, not observation after. The retry replays would have been idempotent — committed nodes would not re-charge. The fan-out branches would have received sub-budgets. The run-level hard limit would have prevented any single execution from exceeding its allocation.

## Next steps

- **[Integrating Cycles with LangChain](/how-to/integrating-cycles-with-langchain)** — full callback handler implementation for LangChain and LangGraph
- **[AI Agent Budget Control: Enforce Hard Spend Limits](/blog/ai-agent-budget-control-enforce-hard-spend-limits)** — the reserve-commit pattern in depth
- **[5 AI Agent Failures Budget Controls Would Prevent](/blog/ai-agent-failures-budget-controls-prevent)** — retry storm and infinite loop cost math
- **[Budget Wrapper vs Runtime Authority for AI Agents](/blog/vibe-coding-budget-wrapper-vs-budget-authority)** — why a checker is not enough when agents fan out
- **[Multi-Tenant AI Cost Control](/blog/multi-tenant-ai-cost-control-per-tenant-budgets-quotas-isolation)** — per-[tenant](/glossary#tenant) budgets for teams running LangGraph in multi-tenant platforms
- **[Cycles vs LLM Proxies and Observability Tools](/blog/cycles-vs-llm-proxies-and-observability-tools)** — why dashboards and proxies cannot prevent the overspend

## Related how-to guides

- [Multi-agent shared budgets](/how-to/multi-agent-shared-workspace-budget-patterns)
- [Budget control for LangChain](/how-to/how-to-add-budget-control-to-a-langchain-agent)
- [Integrating with LangGraph](/how-to/integrating-cycles-with-langgraph)
