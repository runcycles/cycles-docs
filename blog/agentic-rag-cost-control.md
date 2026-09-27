---
title: "Agentic RAG Cost Control: Budget Every Answer"
date: 2026-09-27
author: Albert Mavashev
tags: [agents, cost-control, budgets, langchain, tutorial, production]
description: "Control agentic RAG costs across retrieval, reranking, and model calls. Learn to enforce per-answer budgets with Cycles and handle budget exhaustion safely."
blog: true
sidebar: false
featured: false
head:
  - - meta
    - name: keywords
      content: agentic RAG cost control, RAG cost per query, LangGraph RAG budget, retrieval agent spending limits, per-answer budgets, Cycles
---

# Agentic RAG Cost Control: Budget Every Answer

Your knowledge assistant answers most questions after one search. Then a difficult question triggers three query rewrites, parallel searches, reranking, and another retrieval pass. The user still sees one answer. Your infrastructure sees a chain of billable operations.

Where should that chain stop?

Consider a constructed support workflow: a customer asks whether a contract amendment changes their renewal terms. The assistant searches the agreement, retrieves an amendment, finds conflicting dates, and searches again. More retrieval might resolve the conflict. It might also repeat the same work until an iteration limit fires.

Agentic RAG cost control needs a budget for the whole answer, enforced before each protected step. That includes model calls and paid retrieval services. The application also needs a useful response when further work no longer fits.

This post walks through provisioning and sizing an answer budget, then testing it with real [reservations](/glossary#reservation). The goal is to stop further spending while giving the user a useful, evidence-based response.

<!-- more -->

## Where agentic RAG costs accumulate

Retrieval-augmented generation (RAG) gives a model external material to use when answering. In an agentic workflow, the model can choose additional retrieval steps as it reasons through the question.

Agentic retrieval is useful precisely because the next step can depend on what the previous search found. LangGraph's [custom RAG agent tutorial](https://docs.langchain.com/oss/python/langgraph/agentic-rag) demonstrates a graph that grades retrieved documents and can rewrite a question before trying again. That flexibility helps applications handle questions a fixed retrieval pass might not answer.

It also changes the accounting unit. One user question can generate several independently billable operations:

| Stage | Possible cost driver | What to bound before dispatch |
|---|---|---|
| Planning and query rewriting | Model input, output, and reasoning usage | Context size, output ceiling, permitted iterations |
| Retrieval | Query embeddings, paid searches, database work | Query count, source [fan-out](/glossary#fan-out), bounded request size |
| Reranking | Provider-specific document, token, or search units | Candidate count and document size |
| Answer generation | Retrieved context plus generated output | Context and output size |
| Validation or retry | Another model or tool invocation | Whether the additional work fits the answer budget |

Not every retrieval operation has a per-call invoice. A local vector lookup may consume provisioned infrastructure rather than a separately billed API. Choose whether your budget represents marginal provider spend or an internal allocation, and label it consistently.

Keep ingestion separate. Initial parsing, embedding, indexing, and later reindexing belong to an ingestion budget. They should not silently disappear into a query-cost metric, nor should their full cost be charged again on every answer.

Microsoft's [agentic RAG architecture guidance](https://learn.microsoft.com/en-us/azure/architecture/ai-ml/guide/rag/rag-agentic) recommends counting model and search service calls in total request cost. Provider usage units need attention too: [Cohere's pricing documentation](https://docs.cohere.com/docs/how-does-cohere-pricing-work) distinguishes generation, embedding, and reranking billing. A model token counter alone is not a complete RAG cost meter.

## What token limits and retrieval tuning control

Start with efficient retrieval. Cache reusable work, remove duplicate candidates, choose an appropriate model, and avoid another search when the existing evidence is sufficient. Those decisions improve the work being admitted.

Then give each limit a specific job:

| Control | Useful guarantee or constraint | Remaining question |
|---|---|---|
| Per-call output limit | Bounds a model's permitted output under its API contract | How many model calls will the run make? |
| Retrieval `top_k` | Bounds returned candidates at that boundary | What did planning, querying, and reranking consume? |
| Iteration or recursion limit | Bounds steps according to the framework's counting rules | How much does each step cost? |
| Request rate limit | Bounds request frequency | How much cumulative spend is allowed? |
| Shared answer budget | Rejects new reservations that do not fit the configured ledger | Are estimates conservative and all costly paths instrumented? |

These controls compose. A five-step run can cost more than a ten-step run if it uses larger contexts or more expensive services. Conversely, a cheap repetitive loop still needs an iteration limit even if it fits its monetary budget. The distinction between [spend limits and rate limits](/blog/ai-agent-spend-limits-are-not-rate-limits) applies inside retrieval workflows too.

## Give each answer a shared budget

Map one application-assigned run identifier to an enforceable workflow scope. Every protected model, retrieval, and reranking call for that answer submits the same [tenant](/glossary#tenant) and workflow subject.

```text
tenant:acme
  workflow:answer-7f2c
    plan -> search -> rerank -> generate
                 \-> another search, if admitted
```

Provision the workflow ledger explicitly. Adding `run_id` to metadata or custom dimensions does not create a per-run budget. A tenant ledger can impose a broader customer ceiling, but it does not automatically allocate child budgets. The [budget allocation guide](/how-to/budget-allocation-and-management-in-cycles) explains those scope rules.

### Provision before dispatch

The trusted application backend owns provisioning; the agent does not choose its own allowance or hold budget-writing credentials. For each incoming question:

1. Assign a durable answer ID and select its authorized allocation.
2. Create the matching workflow ledger through `POST /v1/admin/budgets`, using a tenant-scoped key with `budgets:write`.
3. Confirm the expected scope, unit, allocation, and active status before dispatching work. After a duplicate response or ambiguous timeout, look up the existing ledger with `budgets:read`; do not blindly fund or reset it.
4. Pass the workflow ID to workers using runtime-only credentials. Reuse that identity when the answer resumes.

If provisioning cannot be confirmed, leave the job pending or return a setup failure. A missing workflow ledger is skipped during budget enforcement: an existing tenant ledger can still admit the call. The application must prevent dispatch without the intended answer budget.

This adds an Admin API dependency before execution. A queue can place provisioning before worker dispatch, but it does not remove the dependency. A component in the existing backend can own this sequence; a separate provisioning service is optional.

### Plan for retained ledgers

In the current v0.1.25 APIs, workflow ledgers have no automatic TTL or per-budget deletion endpoint. Reservation TTL governs the hold lifecycle; it does not delete the ledger. Budget period metadata is not a cleanup mechanism either.

After settlement and any permitted resumes finish, mark the answer complete in the application and reject new dispatch for it. That application state does not revoke an already-issued worker credential. Keep the ledger for accounting, and plan storage and index cardinality before allocating one per question at high volume. This pattern supplies per-answer enforcement, not built-in ephemeral-ledger garbage collection.

### Reserve each protected operation

For each protected operation, the application follows the reserve-commit lifecycle:

1. Calculate a conservative estimate for a bounded request.
2. Reserve against the shared workflow and any other matching ledgers.
3. Execute only after the reservation succeeds and applicable caps are enforced.
4. Commit the usage actually consumed, using the same monetary unit.
5. Request another reservation before starting another billable operation.

With parallel retrieval, each branch needs its own reservation against that same shared budget. Reading the balance once and letting every branch proceed from that snapshot is not sufficient. Live holds must reduce the capacity available to the other branches.

The budget bounds admitted estimates. It does not independently cap a provider's invoice. The latter also depends on bounded provider requests, complete instrumentation, conservative estimation, and correct handling of usage and overages. [Estimate drift](/blog/estimate-drift-silent-killer-of-enforcement) is therefore an enforcement concern, not just an accounting detail.

## Size the budget from RAG cost per query

The drill below uses $0.12 to make admission behavior easy to inspect. Choose a production allowance from your workload instead:

1. Record trusted usage for every model, embedding, search, and reranking call, grouped by answer ID. Include retries and unsuccessful answers.
2. Compare cost distributions for relevant workload classes, such as a simple lookup versus multi-document research. A p95 or p99 cost is a starting candidate, chosen against your acceptable interruption rate and economics.
3. Replay the sequence of conservative estimates, commits, and concurrent holds against candidate budgets. At each admission, the allocation must cover committed spend, existing holds, and the new estimate.
4. Test completion rate, evidence quality, and the exhaustion response before enforcing the selected allowance. Reserve headroom for answer generation if the product requires it.

The normal drill commits $0.07, but needs $0.08 to finish unchanged: $0.04 is already spent when generation requests a $0.04 hold. Setting the budget to final measured cost alone would block that last step.

Use [shadow mode](/how-to/shadow-mode-in-cycles-how-to-roll-out-budget-enforcement-without-breaking-production) to inspect policy decisions alongside application usage telemetry. Dry-run requests create no holds and change no balances, so isolated dry-run responses do not reproduce cumulative or concurrent depletion. Measure actual spend separately and replay those admission conditions explicitly.

### Estimate the model-cost component

For an illustrative answer whose planning, grading, and generation calls total 6,000 input [tokens](/glossary#tokens) and 1,500 output tokens, assumed rates of $2 per million input tokens and $10 per million output tokens give **$0.027 in model cost**. These are adjustable example rates, not a vendor quote. Add query embeddings, paid retrieval, and reranking separately; ingestion remains a separate budget.

Open the [model-cost calculator with this answer preset](/calculators/claude-vs-gpt-cost-standalone#s=eyJ3b3JrbG9hZE5hbWUiOiJSQUcgYW5zd2VyIC0gbW9kZWwgY2FsbHMgb25seSIsIndvcmtsb2FkRGVzY3JpcHRpb24iOiJBZ2dyZWdhdGUgbW9kZWwgdG9rZW5zIHBlciBhbnN3ZXIuIEV4Y2x1ZGVzIHF1ZXJ5IGVtYmVkZGluZ3MsIHNlYXJjaCwgcmVyYW5raW5nIGFuZCBpbmdlc3Rpb24uIFJlcGxhY2UgaWxsdXN0cmF0aXZlIHJhdGVzLiIsImlucHV0VG9rZW5zIjo2MDAwLCJvdXRwdXRUb2tlbnMiOjE1MDAsImNhbGxzUGVyRGF5IjoxMDAwLCJtb2RlbHMiOlt7Im91dHB1dFBlck0iOjEwLCJpbnB1dFBlck0iOjIsIm5hbWUiOiJJbGx1c3RyYXRpdmUgcmF0ZXMgLSByZXBsYWNlIHdpdGggeW91ciBwcm92aWRlciJ9XX0). In this preset, one calculator "call" represents the aggregate model tokens for one answer; the 1,000 calls/day field means 1,000 answers/day. Replace the rates and token totals with your measurements. The calculator does not include retrieval or reranking charges.

## Run a Cycles RAG budget drill

The <a href="/examples/agentic-rag-budget-drill.py" download>downloadable Python drill</a> replaces provider calls with deterministic handlers while exercising a real [Cycles server](/glossary#cycles-server). It checks both the number of handlers admitted and the resulting workflow balances.

::: info What this drill shows
Real admission and accounting with synthetic prices, without paid model credentials. It tests normal execution, a repeated retrieval loop, and concurrent holds. It does not benchmark retrieval quality, provider savings, crash recovery, or [tenant isolation](/glossary#tenant-isolation); those require application tests.
:::

Use a disposable test tenant from the [full-stack quickstart](/quickstart/deploying-the-full-cycles-stack). Its tenant budget should have at least $0.34 of available capacity, with no configured caps or competing traffic. The drill creates three fresh workflow ledgers and leaves them available for inspection; each successful invocation commits $0.24 of synthetic usage to the matching ledgers. Repeated runs consume additional test allocation.

Install Python 3.10+ and the SDK version used by this example:

```bash
python -m pip install "runcycles==0.5.3"

export CYCLES_BASE_URL="http://localhost:7878"
export CYCLES_ADMIN_URL="http://localhost:7979"
export CYCLES_TENANT="acme-corp"
export CYCLES_API_KEY="<test-runtime-key>"
export CYCLES_BUDGET_API_KEY="<test-budget-writer-key>"

python agentic-rag-budget-drill.py
```

The runtime key needs `reservations:create`, `reservations:commit`, `reservations:release`, `reservations:extend`, and `balances:read`. The setup key needs `budgets:write` for the same tenant. Both are tenant-scoped keys, not the bootstrap admin key. The quickstart key combines these permissions and can fill both roles for this disposable drill; production setup should keep budget-writing credentials outside the agent process.

The fixture values are deliberately simple. One dollar is 100,000,000 `USD_MICROCENTS`:

| Synthetic step | Reserve | Commit after the handler |
|---|---:|---:|
| Plan or rewrite | $0.02 | $0.01 |
| Search | $0.03 | $0.02 |
| Rerank | $0.02 | $0.01 |
| Generate answer | $0.04 | $0.03 |

The parallel case uses a larger search fixture: $0.04 reserved and $0.03 committed, so two overlapping holds fit within its $0.10 allocation. Committing less than the estimate releases the unused hold.

The core SDK boundary in the drill is:

```python
with client.stream_reservation(
    subject=subject,  # Same tenant and unique workflow for the entire answer.
    action=Action(kind=step.kind, name=f"rag-drill.{step.name}"),
    estimate=Amount(unit=Unit.USD_MICROCENTS, amount=step.estimate),
    idempotency_key=operation_id,
    overage_policy="REJECT",
    raise_on_commit_failure=True,
) as reservation:
    if reservation.caps and reservation.caps.model_dump(exclude_none=True):
        raise RuntimeError("Use a test tenant without caps for this drill")
    # Synthetic provider handler: reached only after admission.
    print(f"EXECUTED {step.name}")
    reservation.usage.actual_cost = step.actual
```

The SDK's `stream_reservation` context manages both streaming and non-streaming work. Each fixture carries its action kind: `llm.completion` for planning and generation, and `tool.call` for the simulated search and reranking tools. The full script provisions workflow budgets, distinguishes admission denial from settlement failure, and verifies balances. It declines returned caps it cannot apply; a production adapter must enforce applicable caps before dispatch or decline the action.

### Three outcomes to inspect

| Scenario | Workflow allocation | Expected result |
|---|---:|---|
| Normal answer plan | $0.12 | Four handlers execute; $0.07 committed |
| Repeated plan/search/rerank loop | $0.12 | Eight handlers execute; the ninth is blocked; $0.11 committed |
| Four concurrent searches, each reserving $0.04 | $0.10 | Two admitted and two blocked while both holds remain live; $0.06 committed |

The parallel case holds admitted reservations open until all four admission attempts finish. Once the admitted calls commit $0.03 each, $0.04 becomes available again for later work.

The summary lines should be:

```text
PASS normal: executed=4 blocked=0 spent=7000000
PASS loop: executed=8 blocked=1 spent=11000000
PASS parallel: executed=2 blocked=2 spent=6000000
```

These results were reproduced with Python SDK 0.5.3, Cycles Server 0.1.25.59, and [Admin Server](/glossary#admin-server) 0.1.25.55.

In the loop case, $0.01 remains, but the next reranking estimate is $0.02. The handler is blocked even though its fixture actual would have been $0.01. Admission uses the estimate available before execution, not hindsight.

## Connect the budget to LangChain or LangGraph

For an agent built with LangChain's `create_agent`, `langchain-runcycles` provides `CyclesModelGate` and `CyclesToolGate`. Use a reserve mode when the action consumes budget; `"decide"` alone creates no hold. The [LangChain integration guide](/how-to/integrating-cycles-with-langchain) shows the complete middleware setup.

Use the model gate for planning and generation calls that pass through that agent's model middleware. Use the tool gate for the retrieval tool, with a conservative estimate covering its bounded work and a `cost_fn(request, result)` that extracts trusted usage from the tool result. Model cost extractors read normalized usage with caller-supplied rates; tool billing needs an adapter for the provider's response.

Be explicit about ownership. If a retrieval tool runs search and reranking internally, either reserve for that bounded composite operation or gate its subcalls. Do not charge the same provider operation through both paths. Separately invoked graders, query-rewrite models, and arbitrary LangGraph nodes do not acquire coverage merely because another agent has middleware; wrap their execution boundaries too.

### Wrap a LangGraph retrieval node

For a raw LangGraph node, put the reservation around its paid retrieval boundary. This one-node graph returns passages or `budget_exhausted`, then stops. Supply an initialized client, a provisioned workflow ledger, and a `bounded_search(query)` adapter returning `(passages, actual_microcents)`. The adapter must enforce the request bounds behind your estimate and return trusted usage. The snippet was tested with `langgraph==1.2.12` and `runcycles==0.5.3`.

```python
from typing import TypedDict
from langgraph.graph import START, END, StateGraph
from runcycles import Action, Amount, CyclesProtocolError, Subject, Unit

class RagState(TypedDict):
    query: str
    workflow: str
    attempt_id: str
    passages: list[str]
    status: str

def retrieval_graph(client, tenant, bounded_search, estimate_microcents):
    def retrieve(state: RagState):
        entered = False
        try:
            with client.stream_reservation(
                subject=Subject(tenant=tenant, workflow=state["workflow"]),
                action=Action(kind="memory.read", name="contracts.retrieve"),
                estimate=Amount(unit=Unit.USD_MICROCENTS, amount=estimate_microcents),
                idempotency_key=state["attempt_id"],
                overage_policy="REJECT", raise_on_commit_failure=True,
            ) as reservation:
                entered = True
                if reservation.caps and reservation.caps.model_dump(exclude_none=True):
                    raise RuntimeError("This adapter cannot enforce returned caps")
                passages, actual = bounded_search(state["query"])
                reservation.usage.actual_cost = actual
        except CyclesProtocolError as exc:
            if entered or not exc.is_budget_exceeded():
                raise
            return {"status": "budget_exhausted"}
        return {"passages": passages, "status": "retrieved"}

    builder = StateGraph(RagState)
    builder.add_node("retrieve", retrieve)
    builder.add_edge(START, "retrieve")
    builder.add_edge("retrieve", END)
    return builder.compile()
```

Invoke it with an application-assigned workflow and retrieval attempt:

```python
graph = retrieval_graph(client, tenant, bounded_search, estimate_microcents)
result = graph.invoke({
    "query": question, "workflow": workflow_id, "attempt_id": retrieval_attempt_id,
    "passages": [], "status": "pending",
})
```

Persist those identities before dispatch, and check `result["status"]` before scheduling more work. A denied retrieval leaves any existing passages intact. Unsupported caps stop execution before search; settlement failures propagate rather than masquerading as budget denial.

On a new billable attempt, use a new operation identity. A retry of the same Cycles operation should retain its identity and request body. Persist identity across checkpoint replay: re-entering the SDK context can execute its body again. Cycles idempotency does not deduplicate provider dispatch. [Durable Budget Control for LangChain Agents](/blog/durable-budget-control-for-langchain-agents) explains settlement recovery and the separate provider-idempotency boundary.

Keep answer validation after the provider operation has settled. In Python SDK 0.5.3, an exception escaping the `stream_reservation` body attempts to release the reservation, even if you already set `usage.actual_cost`. The LangChain tool gate also attempts to release on a handler exception. A real adapter must handle a billable partial failure through an explicit settlement/reconciliation path rather than letting that exception erase known usage from the ledger.

Do not release already consumed search or model cost because the user received no useful answer. When a timeout or cancelled stream leaves provider usage unknown, retain enough provider identifiers to reconcile it; the budget ledger cannot reconstruct usage that the provider never reported.

## Handle budget exhaustion without inventing an answer

At the raw API boundary, a live reservation request that exceeds available budget returns HTTP 409 `BUDGET_EXCEEDED`. `DENY` is a decision from preflight or dry-run evaluation. Neither means the application should repeatedly try the same unaffordable work.

Choose the user-visible outcome before rollout:

| Evidence available | Application response |
|---|---|
| Enough verified material to answer | Generate only if a separately checked generation reservation fits |
| Some useful passages, unresolved contradiction | Return the existing passages and explain the unresolved question |
| No adequate evidence | Ask for clarification or stop with an explicit limitation |
| More research requires approval | Persist progress and resume only after an authorized budget change |

An explanation can be a deterministic message with existing source links. Asking an LLM to summarize after the budget is exhausted creates another billable step. Plan capacity for that step explicitly, or use a response that requires no new model call.

Return to the contract-amendment question. If the agreement and amendment still show conflicting renewal dates when the next search is denied, return the two retrieved passages with their source links and a fixed message: "These documents show conflicting renewal dates. I could not resolve the conflict within this answer's research budget." Preserve the passages and progress for an authorized resume; do not pick a date just to produce a complete-looking answer.

Keep the retrieval trust boundary intact. Budget exhaustion is not a reason to replace a source-grounded answer with an unsupported guess. It also does not relax document authorization or tenant-data filters.

## Measure cost per useful answer

After the drill, evaluate the real integration on representative questions, including ambiguous and unanswerable ones. Compare bounded and baseline runs using the same workload and record:

- committed provider cost per attempted question, including unsuccessful attempts;
- cost per answer that passes the application's quality criteria;
- retrieval, reranking, and model-call counts;
- completion, partial-answer, and budget-denial rates;
- citation correctness, groundedness, and latency;
- estimate-to-actual differences and unresolved usage.

Report both cost and completion. A system that rejects every question is cheap, but it has not improved unit economics. Likewise, an answer that looks complete but lacks evidence is not a successful fallback.

Start with one expensive retrieval tool and one answer-scoped ledger. Run the drill, replace a fixture handler with your bounded provider call, and demonstrate that a failed reservation prevents dispatch. Then add the remaining model and tool boundaries before claiming a budget for the whole answer.

## Resources

- <a href="/examples/agentic-rag-budget-drill.py" download>Python budget drill</a> — synthetic workload against a real Cycles server.
- [LangGraph RAG tutorial](https://docs.langchain.com/oss/python/langgraph/agentic-rag) — retrieval, document grading, and query rewriting.
- [Cycles Python SDK source](https://github.com/runcycles/cycles-client-python) — managed reservations and settlement behavior.
- [LangChain middleware source](https://github.com/runcycles/langchain-runcycles) — model and tool integration boundaries.
