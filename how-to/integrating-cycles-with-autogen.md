---
title: "AutoGen Budget Control: Cost Governance for Microsoft AutoGen"
description: "Budget control for Microsoft AutoGen multi-agent workflows in Python — wrap the model client with Cycles reservations for per-call and per-agent cost enforcement."
---

# AutoGen Budget Control: Cost Governance for Microsoft AutoGen

This guide shows how to add budget governance to [AutoGen](https://microsoft.github.io/autogen/) multi-agent workflows so that every LLM call is cost-controlled, observable, and automatically stopped when budgets run out.

AutoGen (v0.4+) does not have a built-in middleware or callback system for intercepting LLM calls. The recommended pattern is to wrap the model client with a budget-gated wrapper that creates Cycles reservations before each call and commits actual usage after.

## Prerequisites

```bash
pip install runcycles autogen-agentchat "autogen-ext[openai]"
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
import asyncio
from autogen_agentchat.agents import AssistantAgent
from autogen_ext.models.openai import OpenAIChatCompletionClient
from runcycles import AsyncCyclesClient, CyclesConfig, cycles, set_default_client

# `ask` below is async, so the default client must be an AsyncCyclesClient
set_default_client(AsyncCyclesClient(CyclesConfig.from_env()))
model_client = OpenAIChatCompletionClient(model="gpt-4o")

@cycles(estimate=2_000_000, action_kind="llm.completion", action_name="gpt-4o")
async def ask(prompt: str) -> str:
    agent = AssistantAgent("assistant", model_client=model_client)
    result = await agent.run(task=prompt)
    await model_client.close()
    return result.messages[-1].content

print(asyncio.run(ask("What is budget authority?")))
```
Every agent run is now budget-guarded. If the budget is exhausted, `BudgetExceededError` is raised _before_ the agent runs. Read on for per-call budget control with a model client wrapper.
:::

## Budget-gated model client

Wrap `OpenAIChatCompletionClient` to create a Cycles reservation before every LLM call and commit actual token usage after:

```python
import uuid
from autogen_ext.models.openai import OpenAIChatCompletionClient
from autogen_core.models import CreateResult, RequestUsage
from runcycles import (
    AsyncCyclesClient, CyclesConfig, ReservationCreateRequest, CommitRequest,
    ReleaseRequest, Subject, Action, Amount, Unit, CyclesMetrics,
    BudgetExceededError, CyclesProtocolError,
)

PRICE_PER_INPUT_TOKEN = 250      # GPT-4o: $2.50/1M tokens in microcents
PRICE_PER_OUTPUT_TOKEN = 1_000   # GPT-4o: $10/1M tokens in microcents


class CyclesBudgetClient:
    """Wraps an OpenAIChatCompletionClient with Cycles budget governance.

    Delegates all ChatCompletionClient protocol methods to the inner client,
    overriding create() to add reserve → execute → commit lifecycle.
    """

    def __init__(
        self,
        inner: OpenAIChatCompletionClient,
        cycles_client: AsyncCyclesClient,
        tenant: str = "acme",
        workflow: str | None = None,
        agent: str | None = None,
        estimate_amount: int = 2_000_000,
    ):
        self._inner = inner
        self._cycles = cycles_client
        self._subject = Subject(tenant=tenant, workflow=workflow, agent=agent)
        self._estimate_amount = estimate_amount

    async def create(self, messages, **kwargs) -> CreateResult:
        key = str(uuid.uuid4())

        # Reserve budget
        res = await self._cycles.create_reservation(ReservationCreateRequest(
            idempotency_key=key,
            subject=self._subject,
            action=Action(kind="llm.completion", name="gpt-4o"),
            estimate=Amount(unit=Unit.USD_MICROCENTS, amount=self._estimate_amount),
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

        rid = res.get_body_attribute("reservation_id")

        try:
            # Execute LLM call
            result = await self._inner.create(messages, **kwargs)

            # Commit actual cost
            input_tokens = result.usage.prompt_tokens if result.usage else 0
            output_tokens = result.usage.completion_tokens if result.usage else 0
            actual = input_tokens * PRICE_PER_INPUT_TOKEN + output_tokens * PRICE_PER_OUTPUT_TOKEN

            await self._cycles.commit_reservation(rid, CommitRequest(
                idempotency_key=f"commit-{key}",
                actual=Amount(unit=Unit.USD_MICROCENTS, amount=actual),
                metrics=CyclesMetrics(
                    tokens_input=input_tokens,
                    tokens_output=output_tokens,
                ),
            ))

            return result
        except BudgetExceededError:
            raise
        except Exception:
            await self._cycles.release_reservation(
                rid, ReleaseRequest(idempotency_key=f"release-{key}"),
            )
            raise

    def create_stream(self, messages, **kwargs):
        # Streaming calls are delegated without budget governance.
        # For per-stream budget control, use client.stream_reservation(...) —
        # see /how-to/handling-streaming-responses-with-cycles.
        return self._inner.create_stream(messages, **kwargs)

    async def close(self):
        await self._inner.close()

    def actual_usage(self):
        return self._inner.actual_usage()

    def total_usage(self):
        return self._inner.total_usage()

    def count_tokens(self, messages, *, tools=[]):
        return self._inner.count_tokens(messages, tools=tools)

    def remaining_tokens(self, messages, *, tools=[]):
        return self._inner.remaining_tokens(messages, tools=tools)

    @property
    def capabilities(self):
        return self._inner.capabilities

    @property
    def model_info(self):
        return self._inner.model_info
```

Streaming calls (`create_stream`) pass through without governance in this wrapper. For per-stream budget control, use `client.stream_reservation(...)` — see [Handling Streaming Responses](/how-to/handling-streaming-responses-with-cycles).

## Using the budget-gated client

### Single agent

Pass the wrapped client to any `AssistantAgent`:

```python
import asyncio
from autogen_agentchat.agents import AssistantAgent
from autogen_ext.models.openai import OpenAIChatCompletionClient
from runcycles import AsyncCyclesClient, CyclesConfig, BudgetExceededError

cycles_client = AsyncCyclesClient(CyclesConfig.from_env())
inner = OpenAIChatCompletionClient(model="gpt-4o")

model = CyclesBudgetClient(
    inner=inner,
    cycles_client=cycles_client,
    tenant="acme",
    agent="support-bot",
)

agent = AssistantAgent("support-bot", model_client=model)

async def main():
    try:
        result = await agent.run(task="Explain budget governance for AI agents.")
        print(result.messages[-1].content)
    except BudgetExceededError:
        print("Budget exhausted.")
    finally:
        await model.close()

asyncio.run(main())
```

### With tools

Every LLM call the agent makes — including tool-calling turns — gets its own reservation:

```python
from autogen_core.tools import FunctionTool
from autogen_agentchat.agents import AssistantAgent

async def get_weather(location: str) -> str:
    """Get current weather for a location."""
    return f"72°F and sunny in {location}"

weather_tool = FunctionTool(get_weather, description="Get current weather")

agent = AssistantAgent(
    "weather-agent",
    model_client=model,
    tools=[weather_tool],
    system_message="Use the weather tool to answer questions.",
)

result = await agent.run(task="What's the weather in NYC?")
```

Each iteration of the tool-calling loop (LLM call → tool → LLM call) creates its own reservation. The agent stops as soon as budget is denied.

## Per-agent budget scoping in teams

Use separate `CyclesBudgetClient` instances with different `agent` values for each team member:

```python
from autogen_agentchat.teams import RoundRobinGroupChat
from autogen_agentchat.conditions import MaxMessageTermination

inner = OpenAIChatCompletionClient(model="gpt-4o")

researcher_model = CyclesBudgetClient(
    inner=inner,
    cycles_client=cycles_client,
    tenant="acme",
    workflow="research-pipeline",
    agent="researcher",
    estimate_amount=3_000_000,
)

writer_model = CyclesBudgetClient(
    inner=inner,
    cycles_client=cycles_client,
    tenant="acme",
    workflow="research-pipeline",
    agent="writer",
    estimate_amount=2_000_000,
)

researcher = AssistantAgent(
    "researcher",
    model_client=researcher_model,
    system_message="Research topics thoroughly and provide detailed findings.",
)

writer = AssistantAgent(
    "writer",
    model_client=writer_model,
    system_message="Write clear, concise reports from research findings.",
)

team = RoundRobinGroupChat(
    participants=[researcher, writer],
    termination_condition=MaxMessageTermination(max_messages=6),
)

try:
    result = await team.run(task="Analyze AI safety trends for Q4.")
    print(result.messages[-1].content)
except BudgetExceededError:
    print("Team stopped — budget exhausted.")
```

This gives you a budget hierarchy: `tenant (acme)` > `workflow (research-pipeline)` > `agent (researcher / writer)`. Each agent can have its own budget limits set by the budget authority.

## Guarding entire workflows with the decorator

For coarser-grained control — budgeting the entire team run rather than individual LLM calls — use the `@cycles` decorator:

```python
from runcycles import cycles, set_default_client, BudgetExceededError

# The decorated function is async, so it needs an AsyncCyclesClient
set_default_client(AsyncCyclesClient(CyclesConfig.from_env()))

@cycles(estimate=10_000_000, action_kind="llm.completion", action_name="research-pipeline")
async def run_research_pipeline(topic: str) -> str:
    result = await team.run(task=f"Research and write a report on: {topic}")
    return result.messages[-1].content

try:
    report = await run_research_pipeline("quantum computing")
    print(report)
except BudgetExceededError:
    print("Pipeline budget exhausted.")
```

With this approach, the entire team run gets a single reservation. This is simpler but less granular than per-call wrapping.

## Swarm teams with budget governance

For `Swarm` teams where agents hand off to each other, each agent's model client tracks its own budget:

```python
from autogen_agentchat.teams import Swarm
from autogen_agentchat.conditions import MaxMessageTermination

reviewer = AssistantAgent(
    "reviewer",
    model_client=CyclesBudgetClient(
        inner=inner, cycles_client=cycles_client,
        tenant="acme", agent="reviewer",
    ),
    handoffs=["approver"],
    system_message="Review budgets. Hand off to approver when ready.",
)

approver = AssistantAgent(
    "approver",
    model_client=CyclesBudgetClient(
        inner=inner, cycles_client=cycles_client,
        tenant="acme", agent="approver",
    ),
    handoffs=["reviewer"],
    system_message="Approve or reject. Hand back to reviewer if issues found.",
)

team = Swarm(
    participants=[reviewer, approver],
    termination_condition=MaxMessageTermination(max_messages=10),
)

result = await team.run(task="Review this budget proposal: ...")
```

## Choosing an integration approach

| Approach | Granularity | Best for |
|----------|------------|----------|
| `CyclesBudgetClient` wrapper | Per-LLM-call | Fine-grained token tracking per agent |
| `@cycles` decorator on run | Per-workflow | Coarser budget control, simpler setup |
| Per-agent wrappers in teams | Per-LLM-call, per-agent scoped | Independent budgets per team member |

You can combine approaches — for example, use per-agent `CyclesBudgetClient` wrappers for LLM cost tracking and `@cycles` on the team run for total workflow budget.

## Key points

- **Wrap the model client, not the agent.** AutoGen v0.4+ doesn't have callback hooks, so wrap `OpenAIChatCompletionClient` with `CyclesBudgetClient` for per-call budget governance.
- **Per-agent scoping with separate wrappers.** Create wrappers with different `agent` values to track and limit costs per team member independently.
- **Tool-calling turns are automatically covered.** Each LLM call in a tool-use loop gets its own reservation through the model client wrapper.
- **Everything is async.** AutoGen v0.4+ is fully async — use `AsyncCyclesClient`, and `asyncio.run()` or `await` for all agent and team operations. The `@cycles` decorator requires an `AsyncCyclesClient` when the decorated function is async.
- **Errors stop the agent.** `BudgetExceededError` raised in the model client propagates up and stops the agent or team.

## Next steps

- [Error Handling Patterns in Python](/how-to/error-handling-patterns-in-python) — handling budget errors in Python
- [Degradation Paths](/how-to/how-to-think-about-degradation-paths-in-cycles-deny-downgrade-disable-or-defer) — strategies for graceful degradation
- [Testing with Cycles](/how-to/testing-with-cycles) — testing budget-guarded code
- [Production Operations Guide](/how-to/production-operations-guide) — running Cycles in production
- [Integrating with OpenAI](/how-to/integrating-cycles-with-openai) — budget governance for direct OpenAI calls
