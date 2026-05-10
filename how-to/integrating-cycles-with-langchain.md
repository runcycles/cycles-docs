---
title: "LangChain Budget Control: Agent Middleware + Callback Handlers"
description: "Budget control for LangChain in Python — install langchain-runcycles middleware for create_agent workflows, or a callback handler for bare ChatOpenAI / chains / RAG."
---

# LangChain Budget Control: Agent Middleware + Callback Handlers

LangChain offers two integration surfaces for Cycles, depending on how you use LangChain:

| Surface | When to use | Cycles tool |
|---|---|---|
| **Agent middleware** ([`langchain-runcycles`](https://pypi.org/project/langchain-runcycles/)) | LangChain 1.x agents using `langchain.agents.create_agent` | The `langchain-runcycles` package, shipping `CyclesToolGate` + `CyclesFanOutGate` |
| **Callback handler** | Bare `ChatOpenAI` / chains / RAG / non-agent LangChain code | Custom `BaseCallbackHandler` (recipe below; also bundled in [`cycles-client-python`](https://github.com/runcycles/cycles-client-python/blob/main/examples/langchain_integration.py)) |

The **middleware path is dramatically better for `create_agent` users**: tool calls are gated *before* execution (denial returns a `ToolMessage` so the agent recovers gracefully), fan-out is capped at the model-turn level, and idempotency keys are deterministic and optionally namespace-scoped for retry-safe replay across runs. The callback handler is still the right fit for everything else.

> **Need an API key?** Create one via the Admin Server — see [Deploy the Full Stack](/quickstart/deploying-the-full-cycles-stack#step-3-create-an-api-key) or [API Key Management](/how-to/api-key-management-in-cycles).

---

## Agent middleware via langchain-runcycles

The [`langchain-runcycles`](https://pypi.org/project/langchain-runcycles/) package provides two `AgentMiddleware` subclasses that plug into `langchain.agents.create_agent`:

- **`CyclesToolGate`** — intercepts every tool call (`wrap_tool_call`). Authorizes via `client.decide()` and/or reserves budget. Returns a `ToolMessage` on denial so the model can recover gracefully.
- **`CyclesFanOutGate`** — runs before every model turn (`before_model`). Halts the agent (with `jump_to: "end"`) when a turn cap is reached or an external policy says stop.

### Install

```bash
pip install langchain-runcycles
```

```bash
export CYCLES_BASE_URL="http://localhost:7878"
export CYCLES_API_KEY="your-api-key"
```

### Quick start

```python
from langchain.agents import create_agent
from langchain.tools import tool
from langchain_runcycles import CyclesFanOutGate, CyclesToolGate
from runcycles import Action, CyclesClient, CyclesConfig, Subject

@tool
def send_email(to: str, body: str) -> str:
    """Send an email to a recipient."""
    return f"Sent to {to}"

client = CyclesClient(CyclesConfig.from_env())

tool_gate = CyclesToolGate(
    client,
    subject=Subject(tenant="acme", agent="researcher"),
    action={"send_email": Action(kind="tool.call", name="send_email")},
    mode="decide",  # or "reserve" / "decide+reserve"
)

fanout_gate = CyclesFanOutGate(
    max_turns=20,
    client=client,
    subject=Subject(tenant="acme"),
    action=Action(kind="model.turn", name="research"),
)

agent = create_agent(
    model="claude-sonnet-4-6",
    tools=[send_email],
    middleware=[fanout_gate, tool_gate],
)

agent.invoke({"messages": [{"role": "user", "content": "Email alice."}]})
```

If `client.decide()` denies the call, `send_email` is never invoked — the model receives a `ToolMessage` with the denial reason and can choose another path.

### Three modes for `CyclesToolGate`

| Mode | Behavior |
|---|---|
| `"decide"` | Calls `client.decide()`. Denies the tool call on a non-allow decision. No reservation. |
| `"reserve"` | Creates a reservation, runs the tool, commits on success (at the configured `estimate`), releases on exception. |
| `"decide+reserve"` | Authorizes via `decide()` first, then reserves and commits. Most strict. |

### Settlement-failure policy (v0.1.2+)

If `commit_reservation` fails after a successful tool run, the tool's side effect already happened. `settlement_error_policy` on `CyclesToolGate` controls what happens next:

| Policy | Behavior | When to choose |
|---|---|---|
| `"raise"` (default) | Propagate the commit exception. Tool result is lost; caller reconciles. | Strict governance: no tool-level cost goes unaccounted. |
| `"log"` | Log a warning, return the tool result. The reservation expires via TTL. | UX continuity matters more than per-call settlement guarantees. |

Note: `"raise"` surfaces the failure as a tool exception, so a LangChain agent may retry. If the tool's side effect (an email send, a payment, a CRM write) is **not safely idempotent on retry**, choose `"log"` instead.

### Idempotency-key namespacing (v0.1.3+)

Cycles idempotency keys default to `{prefix}-{tool_call_id}` — deterministic per tool call so retries land on the same reservation. If your runtime reuses short tool-call IDs across runs (`tc_1`, `tc_2`, ...), set `idempotency_namespace` on the middleware to scope keys by run / workflow / tenant. Keys then become `{prefix}-{namespace}-{tool_call_id}`:

```python
gate = CyclesToolGate(
    client,
    subject=Subject(tenant="acme"),
    action=Action(kind="tool.call", name="send_email"),
    idempotency_namespace="run_2026_05_10_abc",  # static
)

# Or callable — extract per call from your runtime's run-id source
gate = CyclesToolGate(
    client,
    subject=Subject(tenant="acme"),
    action=Action(kind="tool.call", name="send_email"),
    idempotency_namespace=lambda req: get_current_run_id(),
)
```

### Async support

Use `AsyncCyclesClient` and invoke the agent with `.ainvoke()`. The middleware automatically uses async hooks (`awrap_tool_call`, `abefore_model`):

```python
from runcycles import AsyncCyclesClient

async_client = AsyncCyclesClient(CyclesConfig.from_env())
gate = CyclesToolGate(async_client, subject=..., action=..., mode="decide")

agent = create_agent(model="...", tools=[...], middleware=[gate])
await agent.ainvoke({"messages": [...]})
```

See the [`langchain-runcycles` README](https://github.com/runcycles/langchain-runcycles#readme) for the full configuration surface, including subject extractors, action mappers, denial messages, and per-call namespacing opt-out.

---

## Callback handler for non-agent runnables

For code that doesn't use `create_agent` — bare `ChatOpenAI` invocations, chains, RAG pipelines, anything on the older callback-based LangChain API — use a custom `BaseCallbackHandler` to wrap each LLM call with a Cycles reservation.

### Install

```bash
pip install runcycles langchain langchain-openai
```

```bash
export CYCLES_BASE_URL="http://localhost:7878"
export CYCLES_API_KEY="your-api-key"
export CYCLES_TENANT="acme"
export OPENAI_API_KEY="sk-..."
```

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

### The callback handler approach

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

### Using the handler

#### With a chat model

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

#### With an agent and tools (legacy `bind_tools` flow)

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

> **Using `create_agent`?** The middleware path above (`langchain-runcycles`) gives you per-tool authorization *before* execution, plus fan-out caps. The callback handler only sees LLM calls, not tool calls — for `create_agent` workflows the middleware is the better fit.

### How it works

| Event | Action |
|-------|--------|
| `on_llm_start` | Create a reservation with the estimated cost |
| `on_llm_end` | Commit the actual cost from token usage |
| `on_llm_error` | Release the reservation to free held budget |

The handler tracks active reservations by LangChain's `run_id`, so concurrent calls are handled correctly.

### Customizing the estimate

The `estimate_amount` parameter sets how much budget to reserve per LLM call. Adjust it based on your expected usage:

```python
# Conservative: reserve enough for a long response
handler = CyclesBudgetHandler(client=client, subject=subject, estimate_amount=5_000_000)

# Lightweight: for short completions
handler = CyclesBudgetHandler(client=client, subject=subject, estimate_amount=500_000)
```

### Per-agent budgets

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

### Key points

- **One reservation per LLM call.** The callback creates a reservation on every `on_llm_start` and commits on `on_llm_end`.
- **LLM-level only.** The handler sees LLM events, not tool calls. For tool-call gating use the middleware path above.
- **Errors release budget.** If the LLM call fails, the reservation is released immediately.
- **Thread-safe.** Reservations are tracked by `run_id`, supporting concurrent LLM calls.
- **Works with any LangChain model.** Attach the handler to `ChatOpenAI`, `ChatAnthropic`, or any other model via `callbacks=[handler]`.

### Full example

See [`examples/langchain_integration.py`](https://github.com/runcycles/cycles-client-python/blob/main/examples/langchain_integration.py) for a complete, runnable callback-handler script.

---

## Which path do I use?

```text
Are you using `langchain.agents.create_agent` (LangChain 1.x agents)?
├── YES → langchain-runcycles middleware (top of this page)
│       Tool-call authorization, fan-out caps, async support, retry-safe keys
│
└── NO  → Callback handler (bottom of this page)
         Bare ChatOpenAI, chains, RAG pipelines, multi-tool prompts without create_agent
```

For LangGraph workflows, see [LangGraph budget control](/how-to/integrating-cycles-with-langgraph) — `create_agent`-based LangGraph nodes can use the middleware path; raw `StateGraph` + LLM nodes use the callback handler.

For per-run budget control (a single reservation around the entire agent run, regardless of how many LLM calls), see [Budget Control for LangChain Agents](/how-to/how-to-add-budget-control-to-a-langchain-agent).

## Next steps

- [Budget Control for LangChain Agents](/how-to/how-to-add-budget-control-to-a-langchain-agent) — per-run reservation pattern with `@cycles`
- [LangGraph integration](/how-to/integrating-cycles-with-langgraph) — stateful graph workflows
- [Error Handling Patterns in Python](/how-to/error-handling-patterns-in-python) — handling budget errors
- [Testing with Cycles](/how-to/testing-with-cycles) — testing budget-guarded code
- [Production Operations Guide](/how-to/production-operations-guide) — running Cycles in production
- [`langchain-runcycles` on GitHub](https://github.com/runcycles/langchain-runcycles) — package source, examples, AUDIT
- [LangChain example (Python)](https://github.com/runcycles/cycles-client-python/blob/main/examples/langchain_integration.py) — runnable callback-handler example
