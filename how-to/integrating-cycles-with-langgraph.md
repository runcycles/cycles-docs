---
title: "LangGraph Budget Control: Per-Node Cost Enforcement"
description: "Budget control for LangGraph stateful agent workflows in Python — per-node and per-graph cost enforcement with callback handlers and the @cycles decorator."
---

# LangGraph Budget Control: Per-Node Cost Enforcement

This guide shows how to add budget management to [LangGraph](https://langchain-ai.github.io/langgraph/) stateful agent workflows so that every LLM call within a graph node is cost-controlled, observable, and automatically stopped when budgets run out.

LangGraph builds on LangChain, so two integration paths apply depending on how your nodes call the model:

| Node style | Cycles tool |
|---|---|
| `langchain.agents.create_agent` (LangChain 1.x agent inside a node) | [`langchain-runcycles`](https://pypi.org/project/langchain-runcycles/) middleware (`CyclesToolGate`, `CyclesFanOutGate`) — see the [agent middleware section of the LangChain guide](/how-to/integrating-cycles-with-langchain#agent-middleware-via-langchain-runcycles) |
| Raw `StateGraph` node calling an LLM directly | The `CyclesBudgetHandler` callback handler from the [LangChain guide](/how-to/integrating-cycles-with-langchain#callback-handler-for-non-agent-runnables) — covered below |

This guide focuses on the callback-handler path because it's the right fit for raw `StateGraph` workflows. For nodes built around `create_agent`, the middleware in `langchain-runcycles` gives you per-tool authorization and fan-out caps that the callback handler can't see.

This guide also covers per-node budget scoping using the `@cycles` decorator for full graph-level cost visibility.

## Prerequisites

```bash
pip install runcycles langchain langchain-openai langgraph
```

```bash
export CYCLES_BASE_URL="http://localhost:7878"
export CYCLES_API_KEY="your-api-key"   # create via Admin Server — see note below
export CYCLES_TENANT="acme"
export OPENAI_API_KEY="sk-..."
```

> **Need an API key?** Create one via the Admin Server — see [Deploy the Full Stack](/quickstart/deploying-the-full-cycles-stack#step-3-create-an-api-key) or [API Key Management](/how-to/api-key-management-in-cycles).

::: tip 60-Second Quick Start
```python
from langchain_openai import ChatOpenAI
from langchain_core.messages import HumanMessage
from langgraph.graph import StateGraph, START, END, MessagesState
from runcycles import CyclesClient, CyclesConfig, Subject

client = CyclesClient(CyclesConfig.from_env())
handler = CyclesBudgetHandler(client=client, subject=Subject(tenant="acme", agent="my-graph"))

llm = ChatOpenAI(model="gpt-4o", callbacks=[handler])

def chatbot(state: MessagesState) -> dict:
    return {"messages": [llm.invoke(state["messages"])]}

graph = StateGraph(MessagesState)
graph.add_node("chatbot", chatbot)
graph.add_edge(START, "chatbot")
graph.add_edge("chatbot", END)
app = graph.compile()

result = app.invoke({"messages": [HumanMessage(content="What is budget authority?")]})
print(result["messages"][-1].content)
```
Every LLM call in every graph node is now budget-guarded. See the full `CyclesBudgetHandler` implementation in the [LangChain integration guide](/how-to/integrating-cycles-with-langchain#the-callback-handler-approach). Read on for multi-node and per-node patterns.
:::

## The callback handler in graph nodes

LangGraph nodes call LangChain models, so the `CyclesBudgetHandler` from the [LangChain integration](/how-to/integrating-cycles-with-langchain) works without modification. Attach it to the model, and every LLM call inside any node that uses that model is budget-guarded:

```python
import uuid
from typing import Any
from langchain_core.callbacks import BaseCallbackHandler
from langchain_core.outputs import LLMResult
from runcycles import (
    CyclesClient, ReservationCreateRequest, CommitRequest,
    ReleaseRequest, Subject, Action, Amount, Unit, CyclesMetrics,
    BudgetExceededError, CyclesProtocolError,
)

class CyclesBudgetHandler(BaseCallbackHandler):
    def __init__(
        self,
        client: CyclesClient,
        subject: Subject,
        estimate_amount: int = 2_000_000,
        action_kind: str = "llm.completion",
        action_name: str = "gpt-4o",
    ):
        super().__init__()
        self.client = client
        self.subject = subject
        self.estimate_amount = estimate_amount
        self.action_kind = action_kind
        self.action_name = action_name
        self._reservations: dict[str, str] = {}
        self._keys: dict[str, str] = {}

    def on_llm_start(self, serialized, prompts, *, run_id, **kwargs):
        key = str(uuid.uuid4())
        self._keys[str(run_id)] = key

        res = self.client.create_reservation(ReservationCreateRequest(
            idempotency_key=key,
            subject=self.subject,
            action=Action(kind=self.action_kind, name=self.action_name),
            estimate=Amount(unit=Unit.USD_MICROCENTS, amount=self.estimate_amount),
            ttl_ms=60_000,
        ))

        if not res.is_success:
            error = res.get_error_response()
            if error and error.error == "BUDGET_EXCEEDED":
                raise BudgetExceededError(
                    error.message, status=res.status,
                    error_code=error.error, request_id=error.request_id,
                )
            msg = error.message if error else (res.error_message or "Reservation failed")
            raise CyclesProtocolError(
                msg, status=res.status,
                error_code=error.error if error else None,
            )

        self._reservations[str(run_id)] = res.get_body_attribute("reservation_id")

    def on_llm_end(self, response: LLMResult, *, run_id, **kwargs):
        rid = self._reservations.pop(str(run_id), None)
        key = self._keys.pop(str(run_id), None)
        if not rid or not key:
            return

        usage = (response.llm_output or {}).get("token_usage", {})
        input_tokens = usage.get("prompt_tokens", 0)
        output_tokens = usage.get("completion_tokens", 0)

        self.client.commit_reservation(rid, CommitRequest(
            idempotency_key=f"commit-{key}",
            actual=Amount(unit=Unit.USD_MICROCENTS,
                          amount=input_tokens * 250 + output_tokens * 1_000),
            metrics=CyclesMetrics(
                tokens_input=input_tokens,
                tokens_output=output_tokens,
            ),
        ))

    def on_llm_error(self, error, *, run_id, **kwargs):
        rid = self._reservations.pop(str(run_id), None)
        key = self._keys.pop(str(run_id), None)
        if rid and key:
            self.client.release_reservation(
                rid, ReleaseRequest(idempotency_key=f"release-{key}"),
            )
```

## Multi-node graph with shared budget

In a multi-node graph, all nodes share a single budget scope through the same handler:

```python
from langchain_openai import ChatOpenAI
from langchain_core.messages import HumanMessage, AIMessage
from langgraph.graph import StateGraph, START, END, MessagesState
from runcycles import CyclesClient, CyclesConfig, Subject, BudgetExceededError

client = CyclesClient(CyclesConfig.from_env())
handler = CyclesBudgetHandler(
    client=client,
    subject=Subject(tenant="acme", workflow="research-pipeline", agent="graph"),
)

llm = ChatOpenAI(model="gpt-4o", callbacks=[handler])

def researcher(state: MessagesState) -> dict:
    prompt = f"Research the following topic: {state['messages'][-1].content}"
    result = llm.invoke([HumanMessage(content=prompt)])
    return {"messages": [result]}

def writer(state: MessagesState) -> dict:
    research = state["messages"][-1].content
    prompt = f"Write a concise report based on this research:\n{research}"
    result = llm.invoke([HumanMessage(content=prompt)])
    return {"messages": [result]}

graph = StateGraph(MessagesState)
graph.add_node("researcher", researcher)
graph.add_node("writer", writer)
graph.add_edge(START, "researcher")
graph.add_edge("researcher", "writer")
graph.add_edge("writer", END)
app = graph.compile()

try:
    result = app.invoke({"messages": [HumanMessage(content="AI safety")]})
    print(result["messages"][-1].content)
except BudgetExceededError:
    print("Budget exhausted during graph execution.")
```

Both nodes draw from the same budget scope. If the researcher node exhausts the budget, the writer node never runs.

## Per-node budget scoping

For independent budget tracking per node, create separate handlers with different `agent` values:

```python
from runcycles import CyclesClient, CyclesConfig, Subject

client = CyclesClient(CyclesConfig.from_env())

researcher_handler = CyclesBudgetHandler(
    client=client,
    subject=Subject(tenant="acme", workflow="pipeline", agent="researcher"),
    estimate_amount=3_000_000,
)

writer_handler = CyclesBudgetHandler(
    client=client,
    subject=Subject(tenant="acme", workflow="pipeline", agent="writer"),
    estimate_amount=2_000_000,
)

researcher_llm = ChatOpenAI(model="gpt-4o", callbacks=[researcher_handler])
writer_llm = ChatOpenAI(model="gpt-4o", callbacks=[writer_handler])

def researcher(state: MessagesState) -> dict:
    result = researcher_llm.invoke(state["messages"])
    return {"messages": [result]}

def writer(state: MessagesState) -> dict:
    result = writer_llm.invoke(state["messages"])
    return {"messages": [result]}
```

This gives you a budget hierarchy: `tenant (acme)` > `workflow (pipeline)` > `agent (researcher / writer)`. Each node can have its own budget limits set by the budget authority.

## Guarding node functions with the decorator

For coarser-grained control — budgeting the entire node invocation rather than individual LLM calls — use the `@cycles` decorator:

```python
from langchain_openai import ChatOpenAI
from langchain_core.messages import HumanMessage
from langgraph.graph import StateGraph, START, END, MessagesState
from runcycles import (
    CyclesClient, CyclesConfig, cycles, set_default_client, BudgetExceededError,
)

config = CyclesConfig.from_env()
set_default_client(CyclesClient(config))

llm = ChatOpenAI(model="gpt-4o")

@cycles(estimate=3_000_000, action_kind="llm.completion", action_name="research-node", agent="researcher")
def researcher(state: MessagesState) -> dict:
    result = llm.invoke([HumanMessage(content=f"Research: {state['messages'][-1].content}")])
    return {"messages": [result]}

@cycles(estimate=2_500_000, action_kind="llm.completion", action_name="writer-node", agent="writer")
def writer(state: MessagesState) -> dict:
    result = llm.invoke([HumanMessage(content=f"Summarize: {state['messages'][-1].content}")])
    return {"messages": [result]}

graph = StateGraph(MessagesState)
graph.add_node("researcher", researcher)
graph.add_node("writer", writer)
graph.add_edge(START, "researcher")
graph.add_edge("researcher", "writer")
graph.add_edge("writer", END)
app = graph.compile()
```

With this approach, each node function gets a single reservation for the entire invocation. This is simpler but less granular than the callback handler approach.

## Conditional edges with budget checks

LangGraph conditional edges can route based on budget availability. Use the Cycles client's preflight `decide` call to check whether budget is available before choosing the next node:

```python
import uuid
from langgraph.graph import StateGraph, START, END, MessagesState
from runcycles import (
    CyclesClient, CyclesConfig, DecisionRequest,
    Subject, Action, Amount, Unit,
)

client = CyclesClient(CyclesConfig.from_env())

def should_continue(state: MessagesState) -> str:
    """Route to 'refine' if budget allows, otherwise go to 'summarize'."""
    response = client.decide(DecisionRequest(
        idempotency_key=f"decide-{uuid.uuid4()}",
        subject=Subject(tenant="acme", workflow="pipeline"),
        action=Action(kind="llm.completion", name="gpt-4o"),
        estimate=Amount(unit=Unit.USD_MICROCENTS, amount=3_000_000),
    ))
    if response.is_success:
        decision = response.get_body_attribute("decision")
        if decision == "ALLOW":
            return "refine"
    return "summarize"

graph = StateGraph(MessagesState)
graph.add_node("researcher", researcher)
graph.add_node("refine", refine)
graph.add_node("summarize", summarize)
graph.add_edge(START, "researcher")
graph.add_conditional_edges("researcher", should_continue, {"refine": "refine", "summarize": "summarize"})
graph.add_edge("refine", "summarize")
graph.add_edge("summarize", END)
app = graph.compile()
```

The `decide` call is a lightweight preflight check — it returns `"ALLOW"` or `"DENY"` without creating a reservation. This lets the graph skip expensive refinement steps when budget is low and fall back to cheaper summarization.

## Tool-calling agent graph

LangGraph's prebuilt `create_react_agent` creates a tool-calling agent loop. The callback handler covers every LLM call in the loop automatically:

```python
from langchain_openai import ChatOpenAI
from langchain_core.tools import tool
from langgraph.prebuilt import create_react_agent
from runcycles import CyclesClient, CyclesConfig, Subject, BudgetExceededError

client = CyclesClient(CyclesConfig.from_env())
handler = CyclesBudgetHandler(
    client=client,
    subject=Subject(tenant="acme", agent="react-agent"),
)

@tool
def get_weather(location: str) -> str:
    """Get current weather for a location."""
    return f"72°F and sunny in {location}"

@tool
def get_population(city: str) -> str:
    """Get population of a city."""
    return f"{city} has approximately 8.3 million people"

llm = ChatOpenAI(model="gpt-4o", callbacks=[handler])
agent = create_react_agent(llm, [get_weather, get_population])

try:
    result = agent.invoke(
        {"messages": [("user", "What's the weather and population of NYC?")]}
    )
    print(result["messages"][-1].content)
except BudgetExceededError:
    print("Agent stopped — budget exhausted.")
```

Each iteration of the ReAct loop (LLM call → tool → LLM call → ...) creates its own reservation. The agent stops as soon as budget is denied.

## Error handling

When budget is exhausted, `BudgetExceededError` propagates up from the graph node:

```python
from runcycles import BudgetExceededError

try:
    result = app.invoke({"messages": [HumanMessage(content="Research AI safety")]})
except BudgetExceededError:
    result = {"messages": [AIMessage(content="Budget limit reached. Try again later.")]}
```

For multi-node graphs where partial completion is acceptable, use the callback handler approach (not the `@cycles` decorator) so you can catch the error inside the node function. With `@cycles`, the error is raised **before** the function body executes, so it cannot be caught inside:

```python
# Callback handler approach — error raised during llm.invoke(), catchable inside the node
def researcher(state: MessagesState) -> dict:
    try:
        result = researcher_llm.invoke(state["messages"])
        return {"messages": [result]}
    except BudgetExceededError:
        return {"messages": [AIMessage(content="Research skipped — budget exhausted.")]}
```

See [Degradation Paths](/how-to/how-to-think-about-degradation-paths-in-cycles-deny-downgrade-disable-or-defer) for patterns like queueing, model downgrade, and caching.

## Choosing an integration approach

| Approach | Granularity | Best for |
|----------|------------|----------|
| Callback handler on model | Per-LLM-call | Fine-grained token tracking across all nodes |
| `@cycles` decorator on node | Per-node-invocation | Coarser budget control, simpler setup |
| Per-node handlers | Per-LLM-call, per-node scoped | Independent budgets per node role |
| Conditional edges | Graph-level routing | Adapting execution path to remaining budget |

You can combine approaches — for example, use per-node callback handlers for LLM cost tracking and conditional edges for budget-aware routing.

## Key points

- **Callback handler works in graph nodes.** The `CyclesBudgetHandler` from the LangChain integration works without modification inside LangGraph nodes.
- **Per-node scoping with separate handlers.** Create handlers with different `agent` values to track and limit costs per graph node independently.
- **Conditional edges enable budget-aware routing.** Use `client.decide()` preflight checks to skip expensive nodes or choose cheaper alternatives.
- **ReAct agents are automatically covered.** Tool-calling loops created with `create_react_agent` get budget-checked on every LLM turn.
- **Errors propagate cleanly.** `BudgetExceededError` raised inside a node stops the graph, or can be caught within the node for graceful degradation.

## Full example

See the complete LangGraph snippets above and the [`CyclesBudgetHandler` LangChain example](https://github.com/runcycles/cycles-client-python/blob/main/examples/langchain_integration.py) for the underlying callback setup.

## Next steps

- [Integrating with LangChain](/how-to/integrating-cycles-with-langchain) — the `CyclesBudgetHandler` used in this guide
- [Budget Control for LangChain Agents](/how-to/how-to-add-budget-control-to-a-langchain-agent) — advanced LangChain budget patterns
- [Error Handling Patterns in Python](/how-to/error-handling-patterns-in-python) — handling budget errors in Python
- [Degradation Paths](/how-to/how-to-think-about-degradation-paths-in-cycles-deny-downgrade-disable-or-defer) — strategies for graceful degradation
- [Testing with Cycles](/how-to/testing-with-cycles) — testing budget-guarded code
- [Production Operations Guide](/how-to/production-operations-guide) — running Cycles in production
