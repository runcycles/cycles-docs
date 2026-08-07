---
title: "Integrating Cycles with LangGraph"
description: "Use LangChain 1.x middleware for agent graphs or the managed Python lifecycle for raw StateGraph nodes."
---

# Integrating Cycles with LangGraph

Choose the integration surface that owns the execution boundary:

| Graph style | Recommended Cycles surface |
|---|---|
| Agent built with `langchain.agents.create_agent` | `CyclesFanOutGate` + `CyclesModelGate` + `CyclesToolGate` |
| Raw `StateGraph` node | Python `@cycles` or `stream_reservation()` around the node's paid work |
| Conditional policy edge | `client.decide()` and accept both `ALLOW` and `ALLOW_WITH_CAPS` |

Do not start new code with the deprecated `langgraph.prebuilt.create_react_agent`.
LangChain's current agent entry point is `langchain.agents.create_agent`.

## Agent graphs

```python
from langchain.agents import create_agent
from langchain_runcycles import CyclesFanOutGate, CyclesModelGate, CyclesToolGate
from runcycles import Action, Amount, CyclesClient, CyclesConfig, Subject, Unit

client = CyclesClient(CyclesConfig.from_env())
subject = Subject(tenant="acme", workflow="research")

agent = create_agent(
    model="claude-sonnet-4-6",
    tools=[search, publish],
    middleware=[
        CyclesFanOutGate(
            max_turns=20,
            client=client,
            subject=subject,
            action=Action(kind="model.turn", name="research"),
        ),
        CyclesModelGate(
            client,
            subject=subject,
            action=Action(kind="llm.completion", name="claude-sonnet-4-6"),
            mode="reserve",
            estimate=Amount(unit=Unit.USD_MICROCENTS, amount=2_500_000),
        ),
        CyclesToolGate(
            client,
            subject=subject,
            action={
                "search": Action(kind="tool.call", name="search"),
                "publish": Action(kind="tool.call", name="publish"),
            },
            mode="decide+reserve",
            idempotency_namespace=lambda request: request.state["run_id"],
        ),
    ],
)
```

Reserve modes heartbeat long agent work and durably settle known spend. Tool
keys are stable when LangChain supplies `tool_call_id`; model/fan-out calls do
not have that upstream stable identity and use a fresh UUID within the optional
namespace.

## Raw StateGraph nodes

Use the SDK lifecycle instead of hand-writing reserve/commit/release inside a
`try` block. The decorator provides heartbeat and durable recovery:

```python
from langgraph.graph import StateGraph
from runcycles import cycles

def actual_cost(result: dict) -> int:
    message = result["messages"][-1]
    usage = message.usage_metadata or {}
    return usage.get("input_tokens", 0) * 250 + usage.get("output_tokens", 0) * 1_000

@cycles(
    client=client,
    tenant="acme",
    workflow="research",
    action_kind="llm.completion",
    action_name="gpt-4o",
    estimate=2_000_000,
    actual=actual_cost,
)
def call_model(state: dict) -> dict:
    message = model.invoke(state["messages"])
    return {"messages": [message]}

graph = StateGraph(dict)
graph.add_node("model", call_model)
```

If you need per-run values, make the decorator's estimate/subject fields
callables or build the managed reservation inside the node. Do not release in a
catch block around commit: once the model ran, that can return budget for spend
that already happened.

## Conditional policy edges

```python
from runcycles import Action, Amount, DecisionRequest, DecisionResponse, Unit

def route(state: dict) -> str:
    response = client.decide(DecisionRequest(
        idempotency_key=f"graph-route-{state['run_id']}-{state['step']}",
        subject=subject,
        action=Action(kind="graph.step", name="continue"),
        estimate=Amount(unit=Unit.RISK_POINTS, amount=1),
    ))
    if not response.is_success or response.body is None:
        return "end"
    decision = DecisionResponse.model_validate(response.body)
    return "continue" if decision.is_allowed() else "end"
```

`DecisionResponse.is_allowed()` treats both `ALLOW` and `ALLOW_WITH_CAPS` as
permitted. Apply any returned cap fields in the node that owns the constrained
operation.

## Durable graph retries versus Cycles idempotency

LangGraph checkpoint replay and Cycles accounting idempotency solve different
problems. A stable Cycles key prevents duplicate accounting; it does not make an
email, payment, or database write consume-once. Store run/step IDs in graph
state, scope tool keys with them, and keep external side effects independently
idempotent.

## Next steps

- [LangChain agent middleware guide](/how-to/integrating-cycles-with-langchain)
- [LangGraph durable execution, retries, and fan-out](/blog/langgraph-budget-control-durable-execution-retries-fan-out)
- [SDK settlement recovery and durability](/protocol/sdk-settlement-recovery-and-durability)
