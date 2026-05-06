---
title: "LangChain Budget Control via Callback Handlers (Python)"
description: "Per-call budget control for LangChain agents in Python — install a callback handler that reserves and commits Cycles on every LLM call."
---

# LangChain Budget Control via Callback Handlers (Python)

This guide shows how to add budget management to LangChain applications using a custom callback handler that wraps every LLM call with a Cycles reservation.

## Prerequisites

```bash
pip install runcycles langchain langchain-openai
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
from runcycles import CyclesClient, CyclesConfig, Subject

client = CyclesClient(CyclesConfig.from_env())
handler = CyclesBudgetHandler(client=client, subject=Subject(tenant="acme", agent="my-agent"))

llm = ChatOpenAI(model="gpt-4o", callbacks=[handler])
result = llm.invoke([HumanMessage(content="What is budget authority?")])
print(result.content)
```
Every LLM call — including multi-turn agent loops — is now budget-guarded. See the full `CyclesBudgetHandler` implementation below.
:::

## The callback handler approach

LangChain's callback system fires events on every LLM call. A custom `BaseCallbackHandler` can hook into `on_llm_start` and `on_llm_end` to create and commit Cycles reservations:

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

## Using the handler

### With a chat model

```python
from langchain_openai import ChatOpenAI
from langchain_core.messages import HumanMessage
from runcycles import CyclesClient, CyclesConfig, Subject

client = CyclesClient(CyclesConfig.from_env())
handler = CyclesBudgetHandler(
    client=client,
    subject=Subject(tenant="acme", agent="my-agent"),
)

llm = ChatOpenAI(model="gpt-4o", callbacks=[handler])

try:
    result = llm.invoke([HumanMessage(content="Hello!")])
    print(result.content)
except BudgetExceededError:
    print("Budget exhausted.")
```

### With an agent and tools

Every LLM call the agent makes (including tool-calling turns) gets its own reservation:

```python
from langchain_core.tools import tool

@tool
def get_weather(location: str) -> str:
    """Get weather for a location."""
    return f"72°F in {location}"

handler = CyclesBudgetHandler(
    client=client,
    subject=Subject(tenant="acme", agent="tool-agent", toolset="weather"),
)

llm = ChatOpenAI(model="gpt-4o", callbacks=[handler])
llm_with_tools = llm.bind_tools([get_weather])

try:
    result = llm_with_tools.invoke(
        [HumanMessage(content="What's the weather in NYC?")]
    )
except BudgetExceededError:
    print("Agent stopped — budget exhausted.")
```

## How it works

| Event | Action |
|-------|--------|
| `on_llm_start` | Create a reservation with the estimated cost |
| `on_llm_end` | Commit the actual cost from token usage |
| `on_llm_error` | Release the reservation to free held budget |

The handler tracks active reservations by LangChain's `run_id`, so concurrent calls are handled correctly.

## Customizing the estimate

The `estimate_amount` parameter sets how much budget to reserve per LLM call. Adjust it based on your expected usage:

```python
# Conservative: reserve enough for a long response
handler = CyclesBudgetHandler(client=client, subject=subject, estimate_amount=5_000_000)

# Lightweight: for short completions
handler = CyclesBudgetHandler(client=client, subject=subject, estimate_amount=500_000)
```

## Per-agent budgets

Use Cycles' subject hierarchy to give each agent its own budget scope:

```python
# Planning agent with its own budget
planner_handler = CyclesBudgetHandler(
    client=client,
    subject=Subject(tenant="acme", workflow="support", agent="planner"),
)

# Executor agent with a separate budget
executor_handler = CyclesBudgetHandler(
    client=client,
    subject=Subject(tenant="acme", workflow="support", agent="executor"),
)
```

## Key points

- **One reservation per LLM call.** The callback creates a reservation on every `on_llm_start` and commits on `on_llm_end`.
- **Agents are automatically covered.** Multi-turn agents that call the LLM repeatedly get budget-checked on every turn.
- **Errors release budget.** If the LLM call fails, the reservation is released immediately.
- **Thread-safe.** Reservations are tracked by `run_id`, supporting concurrent LLM calls.
- **Works with any LangChain model.** Attach the handler to `ChatOpenAI`, `ChatAnthropic`, or any other model via `callbacks=[handler]`.

## Full example

See [`examples/langchain_integration.py`](https://github.com/runcycles/cycles-client-python/blob/main/examples/langchain_integration.py) for a complete, runnable script.

## Next steps

- [Budget Control for LangChain Agents](/how-to/how-to-add-budget-control-to-a-langchain-agent) — advanced LangChain budget patterns
- [Error Handling Patterns in Python](/how-to/error-handling-patterns-in-python) — handling budget errors in Python
- [Testing with Cycles](/how-to/testing-with-cycles) — testing budget-guarded code
- [Production Operations Guide](/how-to/production-operations-guide) — running Cycles in production
- [LangChain example (Python)](https://github.com/runcycles/cycles-client-python/tree/main/examples/langchain_integration.py) — runnable LangChain integration
