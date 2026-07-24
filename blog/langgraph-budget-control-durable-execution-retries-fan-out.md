---
title: "LangGraph Budget Control for Durable Runs"
date: 2026-03-21
author: Cycles Team
tags: [langgraph, budgets, engineering, durable-execution, best-practices]
description: "LangGraph runs pause, resume, retry, and fan out. Enforce per-run and per-node spend limits before durable execution turns cost spikes into cost cliffs."
blog: true
sidebar: false
head:
  - - meta
    - name: keywords
      content: LangGraph budget control, durable execution costs, AI agent retries, graph run budgets, node budgets, runtime authority
---

# LangGraph Budget Control for Durable Execution, Retries, and Fan-Out

Consider a constructed insurance-claim processor in LangGraph. The graph has six nodes—classify, extract, validate, enrich, review, decide—with checkpointing enabled so runs can pause and resume.

In production, a batch of 200 claims kicks off on Tuesday morning. The "enrich" node calls an external API that starts returning rate-limit errors. LangGraph's node-level retry policy retries each failed enrich call three times. Each retry triggers a new LLM call to re-plan the enrichment approach — $0.45 per attempt. Across 200 claims, 600 extra LLM calls add $270 in retry spend on top of the original $180. Total bill: $450 instead of $180.

Then it gets worse. Twelve claims trigger the "review" node to fan out into four parallel sub-graphs — one per policy type. Each sub-graph has its own retry policy. When the sub-graphs encounter the same rate limit, each retries independently — 4 branches × 3 retries × $6.65 per branched retry = $80 per claim. Those 12 claims alone burn through $960 in an hour.

In this illustrative scenario, the team discovers the spike later in its [provider dashboard](/blog/cycles-vs-llm-proxies-and-observability-tools). The exact alerting and provider-control behavior depends on its account configuration.

Durable execution makes agents more reliable. It also makes cost failures more expensive — because every retry, resume, and [fan-out](/glossary#fan-out) replays work that already cost money.

<!-- more -->

## Why Durable Execution Changes the Budget Problem

One-shot agents have a simpler cost model: fewer retry, checkpoint, and replay surfaces. Their spend is still unbounded unless an execution limit exists.

Durable graph agents — whether built on LangGraph, Temporal, or Restate — break this model. Runs checkpoint, pause, resume, retry, and branch. The cost of a single logical run is not "one pass." It is the sum of every attempt, across every checkpoint, across every branch.

Three properties of durable execution change how bounded [exposure](/glossary#exposure) works:

**Checkpoints create replay surfaces.** Depending on checkpoint placement and application logic, a resumed graph can re-execute work that already consumed [tokens](/glossary#tokens) or triggered side effects. Budget idempotency prevents duplicate ledger mutation only when the caller reuses the same key and request body; business-side replay safety remains separate.

**Retries compound across graph depth.** A retry at the graph level replays multiple nodes. A retry at the node level replays multiple LLM calls within that node. If both layers have retry policies, the total cost is the product, not the sum. A 3× graph retry with 3× node retry produces up to 9× the expected cost for a single pass.

**Fan-out multiplies exposure.** Parallel branches in a graph execute concurrently, each consuming budget independently. Four branches sharing a $40 budget can each see "$40 remaining," each proceed, and spend $160 total — because a simple balance check is not an atomic [reservation](/glossary#reservation).

| Property | One-shot agent | Durable graph agent |
|---|---|---|
| Retry cost | Replays full run | Replays from checkpoint — may re-execute completed nodes |
| Fan-out cost | Fewer concurrent branches | Sum of parallel branch work |
| Failure blast radius | One run's budget | Accumulated spend across all attempts |
| Budget check timing | Before each LLM call | Before each LLM call + before each node + before each retry |
| Concurrency risk | Low (single thread) | High (parallel branches, shared budget) |

These are design risks to test, not claims about every graph run. Actual replay depends on checkpointing, retry policies, idempotency, and node implementation.

## The Four Budget Problems in LangGraph Workflows

Each problem maps to a specific failure mode in graph-based execution.

### 1. Replayed nodes re-spend

A graph resumes from a checkpoint after a transient failure. The upstream nodes — which already ran, consumed tokens, and produced results — execute again. Each replay triggers real LLM calls with real cost. Without idempotent cost tracking, you pay twice for work that already succeeded.

This is invisible in simple testing because you rarely resume from checkpoints during development. It surfaces in production when your persistence layer is doing exactly what it should: recovering gracefully from failures.

### 2. Retry storms at graph depth

LangGraph supports retry policies at multiple levels: individual tool calls, node-level retries, and graph-level restarts. Each layer is reasonable in isolation. Together, they multiply.

A graph with 3 retries per node and 3 retries per graph can produce up to 9 executions of a single node. Add an SDK-level retry on transient HTTP errors (another 3×), and you are looking at 27 executions of a node you expected to run once. At $0.45 per node execution, a $0.45 step becomes a $12.15 step.

These three retry layers operate at different levels of the stack. SDK retries replay a single HTTP call — transparent to the node, cost = one LLM call per attempt. Node retries re-execute the node function, which may contain multiple LLM calls and tool invocations — cost = the full node body per attempt. Graph-level retries resume from a checkpoint and re-enter the node from persisted state, replaying everything above. Each layer compounds the cost of the layers below it.

This is the same geometric multiplication pattern behind the [illustrative retry-storm model that costs $33.86 under its stated assumptions](/blog/ai-agent-failures-budget-controls-prevent). Durable execution does not prevent [retry storms](/glossary#retry-storm) — it can amplify them when retry layers are not coordinated.

### 3. Fan-out branches racing for shared budget

A LangGraph node fans out into four parallel sub-graphs. Each sub-graph checks the remaining budget before starting. All four see "$40 remaining" because they check concurrently. All four proceed. Total spend: $160.

This breaks a non-atomic read-check-write budget checker. A database transaction or atomic Redis script can implement the required invariant; Cycles packages that reserve-and-settle behavior as a protocol service. The fundamental issue is that [a read-only checker is not an authority](/blog/vibe-coding-budget-wrapper-vs-budget-authority).

### 4. Checkpoint-unaware budget state

If budget tracking lives in application memory — a counter, a running total, a class variable — it is lost when the process restarts. LangGraph checkpoints the graph state. It does not checkpoint your budget counter.

When the graph resumes from a checkpoint, an application-only counter may reset unless it was persisted consistently. Provider spend and external side effects do not reset with it.

Durable execution makes this mismatch easier to trigger because the workflow survives restarts by design. Its budget state and idempotency model must survive too.

## The Pattern: Reserve at the Node, Settle at the Edge

The [reserve-commit lifecycle](/blog/ai-agent-budget-control-enforce-hard-spend-limits) already solves the core problem of pre-execution budget enforcement. For durable graph execution, the same pattern applies — but scoped to the graph's structure:

**Run-level budget.** Map each graph execution to an enforceable scope—commonly a unique workflow subject—and require every protected call to submit it. `subject.dimensions.run_id` is attribution-only and does not create a ledger.

**Node-level reservation.** Before each node executes, reserve the estimated cost from the run budget. The reservation is atomic — if the budget is insufficient, the node does not start. The run receives a clear budget-exhausted signal instead of silently proceeding.

**Idempotent settlement.** Retries of the same Cycles operation must reuse the same idempotency key and request body. A genuinely new node attempt needs a new key because it performs new work. The application or checkpoint state decides whether a replay represents the same operation.

**Retry-safe settlement.** On resume, reconcile any existing reservation before starting more work. If the external call may have completed, do not blindly release the hold; retry the same commit when the actual outcome is known or send the case to operator reconciliation.

**Fan-out budget scoping.** Every branch call can consume a shared workflow ledger atomically. If separate branch ceilings are required, provision explicit branch-mapped agent or workflow ledgers and submit those scopes. Cycles does not carve or transfer branch balances from a parent in one allocation operation.

| LangGraph event | Budget action | What it prevents |
|---|---|---|
| Before graph execution | Provision or select a unique enforceable workflow budget | Unbounded submitted estimate for that workflow |
| Node entry | Reserve from run budget | Node executing without budget |
| LLM call within node | Check reservation covers call | Mid-node overrun |
| Node completion | Commit best-known actual cost; retry the same commit with the same key/body | Duplicate ledger mutation on transport retry |
| Node failure + retry | Reconcile ambiguous reservations; use a new key only for new work | Leaked or incorrectly released reservations |
| Fan-out (parallel branches) | Reserve every branch against the shared workflow and any explicit branch scope | Oversubscription of matching ledgers |
| Fan-in (join) | Confirm branch reservations are settled | Accounting drift |
| Graph completion | Reconcile remaining in-flight reservations | Orphaned holds |

## What This Looks Like in Practice

The documented [LangChain callback handler](/how-to/integrating-cycles-with-langchain) can wrap model calls inside LangGraph nodes: it creates a reservation on `on_llm_start`, commits caller-calculated usage on `on_llm_end`, and releases on `on_llm_error`. The example handler is application code, not a class exported by the Cycles package, and its default UUID keys are not checkpoint-aware.

```python
from langgraph.graph import StateGraph, START, END
from langgraph.checkpoint.memory import MemorySaver
from langchain_openai import ChatOpenAI
from runcycles import CyclesClient, CyclesConfig, Subject
from budget_handler import CyclesBudgetHandler  # local class copied from the integration guide

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

When LangGraph resumes from a checkpoint and re-enters a node, the basic handler treats it like another LLM call and creates another reservation. A production checkpoint-aware wrapper must persist the Cycles operation identity or mark the node execution settled. Merely constructing a key from run, node, and attempt fields does not deduplicate anything unless the same logical operation reuses the same key and body.

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

Each parallel node's LLM calls can share the workflow ledger and, when explicitly provisioned, match a narrower branch agent ledger. The server checks all matching ledgers atomically. A distinct `Subject` alone does not create a budget.

For the full callback handler implementation and runnable examples, see [Integrating Cycles with LangChain](/how-to/integrating-cycles-with-langchain).

## What Happens Without Node-Level Budget Control

The difference is not subtle. It is the difference between a cost surprise and a cost bound.

| Scenario | Without node-level control | With Cycles |
|---|---|---|
| Graph resumes from checkpoint | Application may replay already completed work | Checkpoint-aware caller reuses the same operation identity or skips settled work |
| 3-level nested retry | Up to 27 executions under the stated 3×3×3 policy | Every new attempt consumes the shared workflow budget |
| 4-way fan-out, $40 remaining | Non-atomic checks can each proceed from the same snapshot | Atomic reservations contend against the same $40 ledger |
| Process crash mid-node | External outcome and hold can become ambiguous | Caller retries the same settlement or sends it to reconciliation |
| Overnight batch of 500 graph runs | No application-defined per-run boundary | Unique workflow ledgers bound submitted estimates when every path uses them |

In the constructed claim scenario, a mandatory workflow ledger would reject the first new estimate that no longer fit. The exact provider-bill maximum still depends on conservative estimates, commit-overage policy, complete instrumentation, and checkpoint-aware idempotency.

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
