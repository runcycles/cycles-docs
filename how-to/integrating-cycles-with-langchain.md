---
title: "LangChain Budget Control with Cycles"
description: "Gate LangChain model calls, tool calls, and agent fan-out before execution, with heartbeat-protected reservations and durable settlement."
---

# LangChain Budget Control with Cycles

Use [`langchain-runcycles`](https://pypi.org/project/langchain-runcycles/) for
LangChain 1.x agents built with `langchain.agents.create_agent`. It provides
three `AgentMiddleware` controls:

| Middleware | Boundary |
|---|---|
| `CyclesFanOutGate` | Stops another model turn when a local cap or remote policy says stop |
| `CyclesModelGate` | Authorizes and optionally reserves before each model call |
| `CyclesToolGate` | Authorizes and optionally reserves before each tool side effect |

For bare models, chains, and RAG runnables that do not use `create_agent`, use
the managed callback example in the
[`runcycles` Python SDK](https://github.com/runcycles/cycles-client-python/blob/main/examples/langchain_integration.py).

## Install

```bash
pip install "langchain-runcycles>=0.4.0" langchain-anthropic
```

Version 0.4.0 requires `runcycles >=0.5.3` and uses the SDK's managed
reservation lifecycle. Reserve-mode calls are heartbeated while the handler
runs, and known spend is journaled before the first commit request.

## Compose the three gates

```python
from langchain.agents import create_agent
from langchain.tools import tool
from langchain_runcycles import CyclesFanOutGate, CyclesModelGate, CyclesToolGate
from langchain_runcycles.extractors import anthropic_cost
from runcycles import Action, Amount, CyclesClient, CyclesConfig, Subject, Unit

client = CyclesClient(CyclesConfig.from_env())
subject = Subject(tenant="acme", workflow="support", agent="researcher")

@tool
def send_email(to: str, body: str) -> str:
    """Send an email after all middleware checks pass."""
    return f"Sent to {to}"

agent = create_agent(
    model="claude-sonnet-4-6",
    tools=[send_email],
    middleware=[
        CyclesFanOutGate(
            max_turns=20,
            client=client,
            subject=subject,
            action=Action(kind="model.turn", name="support"),
        ),
        CyclesModelGate(
            client,
            subject=subject,
            action=Action(kind="llm.completion", name="claude-sonnet-4-6"),
            mode="decide+reserve",
            estimate=Amount(unit=Unit.USD_MICROCENTS, amount=2_500_000),
            cost_fn=anthropic_cost(
                input_per_million_usd=3.00,
                output_per_million_usd=15.00,
                cache_read_per_million_usd=0.30,
                cache_creation_5m_per_million_usd=3.75,
                cache_creation_1h_per_million_usd=6.00,
            ),
        ),
        CyclesToolGate(
            client,
            subject=subject,
            action={"send_email": Action(kind="tool.call", name="send_email")},
            mode="decide+reserve",
            idempotency_namespace=lambda request: request.state.get("run_id"),
        ),
    ],
)

agent.invoke({
    "messages": [{"role": "user", "content": "Email the customer."}],
    "run_id": "support-run-123",
})
```

The order is intentional: stop runaway fan-out, authorize model spend, then
authorize tool side effects.

## Choose a gate mode

`CyclesModelGate` and `CyclesToolGate` share three modes:

| Mode | Behavior |
|---|---|
| `"decide"` | Policy/budget preflight only; no hold or settlement |
| `"reserve"` | Reserve before the handler, commit after success, release on handler failure |
| `"decide+reserve"` | Run both checks; strongest separation of policy and accounting |

Both `ALLOW` and `ALLOW_WITH_CAPS` are allowed decisions. A tool denial is
returned as a correlated `ToolMessage`; a model denial becomes a
`ModelResponse` that ends the loop. At the raw protocol level, an exhausted
reservation request is HTTP 409 `BUDGET_EXCEEDED`, not a successful 2xx body.

## Settlement after the action ran

Reserve mode uses the same recovery choreography as the Python SDK:

1. heartbeat the reservation while the model/tool handler runs;
2. persist the exact known-spend commit before sending it;
3. replay transient failures with the same key, including after restart;
4. if the reservation expires, recover through `POST /v1/events`.

`settlement_error_policy` controls what the current LangChain call observes,
not whether recovery exists:

| Policy | Result |
|---|---|
| `"raise"` (default) | Queue recovery, then raise `CyclesProtocolError` |
| `"log"` | Queue recovery, log, and return the handler result |

Use `"log"` for non-idempotent side effects when an automatic agent retry could
repeat an email, payment, or write. Known spend remains recoverable either way.

## Actual-cost extraction

The model extractors read LangChain's provider-neutral
`AIMessage.usage_metadata`. Their rates are caller supplied and are not a live
pricing service:

```python
from langchain_runcycles.extractors import openai_cost

cost_fn = openai_cost(
    prompt_per_million_usd=2.50,
    cached_prompt_per_million_usd=1.25,
    completion_per_million_usd=10.00,
)
```

Cache reads/writes come from normalized `input_token_details`. Verify the exact
model and cache tier on the provider pricing page before deployment. A malformed
usage object, invalid rate, or mismatched unit falls back to the configured
reservation estimate.

Tool providers do not expose one normalized billing shape. Supply
`CyclesToolGate.cost_fn(request, result)` when a tool should commit something
other than its configured estimate.

## Idempotency scope

Tool reservation keys are stable when LangChain provides `tool_call_id`.
Configure `idempotency_namespace` when short call IDs might repeat across runs:

```python
tool_gate = CyclesToolGate(
    client,
    subject=subject,
    action=Action(kind="tool.call", name="send_email"),
    mode="reserve",
    idempotency_namespace=lambda request: request.state["run_id"],
)
```

If a tool ID is missing, the middleware generates a logged random fallback.
Model and fan-out hooks have no equivalent stable upstream call ID and use a
fresh UUID within the optional namespace; do not assume those keys survive a
framework redispatch.

## Async and streaming

Pass `AsyncCyclesClient` and call `.ainvoke()` for async hooks. Completed
`agent.astream(...)` and `agent.astream_events(...)` runs are heartbeated and
settled once from LangChain's final aggregated `usage_metadata`.

If a stream is cancelled before LangChain produces a final response, no
finalized normalized usage exists. The middleware releases the reservation and
re-raises; reconcile any provider charge for the partial stream from provider
billing telemetry.

## Non-agent callbacks

The SDK's
[`CyclesBudgetHandler`](https://github.com/runcycles/cycles-client-python/blob/main/examples/langchain_integration.py)
recipe keeps one managed reservation per LangChain `run_id`, uses a lock for
concurrent callbacks, reads normalized usage (including cache reads), and
settles through the SDK journal. Avoid low-level callback examples that simply
pop an in-memory reservation and ignore the commit response.

## Next steps

- [Add budget control to a LangChain agent](/how-to/how-to-add-budget-control-to-a-langchain-agent)
- [Integrate Cycles with LangGraph](/how-to/integrating-cycles-with-langgraph)
- [`langchain-runcycles` source and audit](https://github.com/runcycles/langchain-runcycles)
- [SDK settlement recovery and durability](/protocol/sdk-settlement-recovery-and-durability)
