---
title: "Integrating Cycles with AnyAgent"
description: "Add budget governance to AnyAgent workflows using a custom callback that wraps every LLM call and tool execution with a Cycles reservation — works across all seven supported frameworks."
---

# Integrating Cycles with AnyAgent

This guide shows how to add budget governance to [AnyAgent](https://mozilla-ai.github.io/any-agent/) workflows so that every LLM call and tool execution is cost-controlled, observable, and automatically stopped when budgets run out.

AnyAgent provides a unified interface for seven agent frameworks (OpenAI Agents, LangChain, LlamaIndex, Google, Agno, smolagents, TinyAgent). Because the Cycles callback hooks into AnyAgent's framework-agnostic callback system, a single integration covers all seven backends with no per-framework code.

## Prerequisites

```bash
pip install runcycles any-agent[all]
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
from any_agent import AnyAgent, AgentConfig
from runcycles import CyclesClient, CyclesConfig

client = CyclesClient(CyclesConfig.from_env())

agent = AnyAgent.create(
    agent_framework="openai",
    agent_config=AgentConfig(
        model_id="openai:gpt-4o",
        instructions="You are a helpful assistant.",
        callbacks=[CyclesBudgetCallback(client=client, tenant="acme", agent="my-agent")],
    ),
)

trace = agent.run("What is budget authority?")
print(trace.final_output)
```
Every LLM call and tool execution is now budget-guarded. If the budget is exhausted, `BudgetExceeded` is raised _before_ the call is made. See the full `CyclesBudgetCallback` implementation below.
:::

## The callback approach

AnyAgent's callback system fires lifecycle hooks on every LLM call and tool execution. A custom `Callback` subclass can hook into `before_llm_call`, `after_llm_call`, `before_tool_execution`, and `after_tool_execution` to create and commit Cycles reservations:

```python
import uuid
from any_agent.callbacks.base import Callback
from any_agent import AgentCancel
from runcycles import (
    CyclesClient, CyclesConfig, ReservationCreateRequest, CommitRequest,
    ReleaseRequest, Subject, Action, Amount, Unit, CyclesMetrics,
    CyclesProtocolError,
)


class BudgetExceeded(AgentCancel):
    """Raised when Cycles denies a reservation due to budget exhaustion."""
    pass


class CyclesBudgetCallback(Callback):
    def __init__(
        self,
        client: CyclesClient | None = None,
        tenant: str = "default",
        workflow: str | None = None,
        agent: str | None = None,
        llm_estimate: int = 2_000_000,
        tool_estimate: int = 100_000,
        action_kind: str = "llm.completion",
        action_name: str = "gpt-4o",
    ):
        self.client = client or CyclesClient(CyclesConfig.from_env())
        self.tenant = tenant
        self.workflow = workflow
        self.agent = agent
        self.llm_estimate = llm_estimate
        self.tool_estimate = tool_estimate
        self.action_kind = action_kind
        self.action_name = action_name

    def _subject(self) -> Subject:
        return Subject(
            tenant=self.tenant,
            workflow=self.workflow,
            agent=self.agent,
        )

    def _reserve(self, context, kind: str, name: str, estimate: int):
        key = str(uuid.uuid4())
        res = self.client.create_reservation(ReservationCreateRequest(
            idempotency_key=key,
            subject=self._subject(),
            action=Action(kind=kind, name=name),
            estimate=Amount(unit=Unit.USD_MICROCENTS, amount=estimate),
            ttl_ms=60_000,
        ))

        if not res.is_success:
            error = res.get_error_response()
            if error and error.error == "BUDGET_EXCEEDED":
                raise BudgetExceeded(
                    error.message,
                )
            msg = error.message if error else (res.error_message or "Reservation failed")
            raise CyclesProtocolError(
                msg, status=res.status,
                error_code=error.error if error else None,
            )

        rid = res.get_body_attribute("reservation_id")
        context.shared.setdefault("_cycles_reservations", {})[rid] = key
        context.shared["_cycles_current_rid"] = rid
        return context

    def _commit(self, context, input_tokens: int = 0, output_tokens: int = 0):
        rid = context.shared.pop("_cycles_current_rid", None)
        reservations = context.shared.get("_cycles_reservations", {})
        key = reservations.pop(rid, None)
        if not rid or not key:
            return context

        self.client.commit_reservation(rid, CommitRequest(
            idempotency_key=f"commit-{key}",
            actual=Amount(unit=Unit.USD_MICROCENTS,
                          amount=input_tokens * 250 + output_tokens * 1_000),
            metrics=CyclesMetrics(
                tokens_input=input_tokens,
                tokens_output=output_tokens,
            ),
        ))
        return context

    def _release_current(self, context):
        rid = context.shared.pop("_cycles_current_rid", None)
        reservations = context.shared.get("_cycles_reservations", {})
        key = reservations.pop(rid, None)
        if rid and key:
            self.client.release_reservation(
                rid, ReleaseRequest(idempotency_key=f"release-{key}"),
            )
        return context

    def before_llm_call(self, context, *args, **kwargs):
        return self._reserve(context, self.action_kind, self.action_name, self.llm_estimate)

    def after_llm_call(self, context, *args, **kwargs):
        attrs = getattr(context.current_span, "attributes", None) or {}
        input_tokens = attrs.get("gen_ai.usage.input_tokens", 0)
        output_tokens = attrs.get("gen_ai.usage.output_tokens", 0)
        return self._commit(context, input_tokens, output_tokens)

    def before_tool_execution(self, context, *args, **kwargs):
        attrs = getattr(context.current_span, "attributes", None) or {}
        tool_name = attrs.get("gen_ai.tool.name", "unknown")
        return self._reserve(context, "tool.execution", tool_name, self.tool_estimate)

    def after_tool_execution(self, context, *args, **kwargs):
        return self._commit(context)
```

## Using the callback

> **Note:** Passing `callbacks=[...]` in `AgentConfig` replaces the default callbacks (including the console trace printer). To keep the default console output alongside budget governance, include `ConsolePrintSpan()`:
>
> ```python
> from any_agent.callbacks import ConsolePrintSpan
> callbacks=[CyclesBudgetCallback(...), ConsolePrintSpan()]
> ```

### Basic agent

```python
from any_agent import AnyAgent, AgentConfig
from runcycles import CyclesClient, CyclesConfig

client = CyclesClient(CyclesConfig.from_env())

callback = CyclesBudgetCallback(
    client=client,
    tenant="acme",
    agent="support-bot",
)

agent = AnyAgent.create(
    agent_framework="openai",
    agent_config=AgentConfig(
        model_id="openai:gpt-4o",
        instructions="You are a helpful assistant.",
        callbacks=[callback],
    ),
)

try:
    trace = agent.run("What's the weather in NYC?")
    print(trace.final_output)
except BudgetExceeded:
    print("Budget exhausted.")
```

### With tools

Every tool execution gets its own reservation:

```python
from any_agent import AnyAgent, AgentConfig
from any_agent.tools import search_web, visit_webpage

callback = CyclesBudgetCallback(
    client=client,
    tenant="acme",
    agent="research-agent",
    tool_estimate=200_000,
)

agent = AnyAgent.create(
    agent_framework="openai",
    agent_config=AgentConfig(
        model_id="openai:gpt-4o",
        instructions="Research topics using web search.",
        tools=[search_web, visit_webpage],
        callbacks=[callback],
    ),
)

try:
    trace = agent.run("Find the latest AI safety research papers")
    print(trace.final_output)
except BudgetExceeded:
    print("Agent stopped — budget exhausted.")
```

## Switching frameworks

The same callback works across all seven backends. Change the framework with a single parameter:

```python
# OpenAI Agents
agent = AnyAgent.create("openai", AgentConfig(
    model_id="openai:gpt-4o",
    callbacks=[callback],
    tools=[search_web],
))

# LangChain
agent = AnyAgent.create("langchain", AgentConfig(
    model_id="openai:gpt-4o",
    callbacks=[callback],
    tools=[search_web],
))

# Google (Gemini)
agent = AnyAgent.create("google", AgentConfig(
    model_id="google:gemini-2.0-flash",
    callbacks=[callback],
    tools=[search_web],
))
```

No changes to the callback — budget governance follows the agent across frameworks.

## Per-agent budget scoping

Use the `agent` parameter to scope budgets per agent role. This lets the budget authority set different limits for each agent:

```python
researcher_callback = CyclesBudgetCallback(
    client=client,
    tenant="acme",
    workflow="content-pipeline",
    agent="researcher",
    llm_estimate=3_000_000,
)

writer_callback = CyclesBudgetCallback(
    client=client,
    tenant="acme",
    workflow="content-pipeline",
    agent="writer",
    llm_estimate=2_000_000,
)

researcher = AnyAgent.create("openai", AgentConfig(
    model_id="openai:gpt-4o",
    instructions="Research topics thoroughly.",
    tools=[search_web],
    callbacks=[researcher_callback],
))

writer = AnyAgent.create("openai", AgentConfig(
    model_id="openai:gpt-4o",
    instructions="Write clear reports from research.",
    callbacks=[writer_callback],
))
```

This gives you a budget hierarchy: `tenant (acme)` > `workflow (content-pipeline)` > `agent (researcher / writer)`. Each agent can have its own budget limits set by the budget authority.

## Preflight budget check

Use `client.decide()` before creating the agent to check budget availability without consuming tokens:

```python
import uuid
from runcycles import DecisionRequest, Subject, Action, Amount, Unit

response = client.decide(DecisionRequest(
    idempotency_key=f"decide-{uuid.uuid4()}",
    subject=Subject(tenant="acme", agent="support-bot"),
    action=Action(kind="llm.completion", name="gpt-4o"),
    estimate=Amount(unit=Unit.USD_MICROCENTS, amount=5_000_000),
))

if response.is_success:
    decision = response.get_body_attribute("decision")
    if decision == "DENY":
        print("Budget insufficient — skipping agent run.")
    else:
        trace = agent.run("Handle this support ticket")
```

## Async usage

AnyAgent supports async throughout. The callback hooks work identically:

```python
agent = await AnyAgent.create_async(
    agent_framework="openai",
    agent_config=AgentConfig(
        model_id="openai:gpt-4o",
        instructions="You are a helpful assistant.",
        callbacks=[CyclesBudgetCallback(tenant="acme", agent="async-agent")],
    ),
)

try:
    trace = await agent.run_async("What is budget authority?")
    print(trace.final_output)
except BudgetExceeded:
    print("Budget exhausted.")
```

## Error handling

When budget is denied, `BudgetExceeded` (a subclass of `AgentCancel`) propagates up from the callback. AnyAgent preserves the partial trace:

```python
from any_agent import AgentRunError

try:
    trace = agent.run("Process this request")
except BudgetExceeded as e:
    print(f"Budget denied: {e}")
    print(f"Partial trace: {e.trace}")  # trace up to cancellation point
except AgentRunError as e:
    print(f"Unexpected error: {e.original_exception}")
    print(f"Trace: {e.trace}")
```

For pipelines where partial completion is acceptable, run agents sequentially and handle errors at each stage:

```python
try:
    research_trace = researcher.run("quantum computing")
    research = research_trace.final_output
except BudgetExceeded:
    research = cached_research.get("quantum computing", "No data available.")

try:
    report_trace = writer.run(f"Write a report based on: {research}")
    report = report_trace.final_output
except BudgetExceeded:
    report = f"Raw research (report generation skipped):\n{research}"
```

See [Degradation Paths](/how-to/how-to-think-about-degradation-paths-in-cycles-deny-downgrade-disable-or-defer) for patterns like queueing, model downgrade, and caching.

## Post-run cost analysis

AnyAgent's `AgentTrace` provides token and cost data after execution. Combine this with Cycles for both enforcement and observability:

```python
trace = agent.run("Summarize this document")

# AnyAgent's built-in cost tracking
print(f"Duration: {trace.duration}")
print(f"Tokens: {trace.tokens}")
print(f"Cost: {trace.cost}")

# Cycles budget tracking
response = client.get_balances(tenant="acme")
if response.is_success:
    for balance in response.body.get("balances", []):
        print(f"Scope: {balance['scope']}, remaining: {balance['remaining']}")
```

## Key points

- **One callback covers all frameworks.** The `CyclesBudgetCallback` works identically across all seven AnyAgent backends — no per-framework code needed.
- **LLM calls and tool executions are both guarded.** `before_llm_call` and `before_tool_execution` each create a reservation; `after_*` hooks commit actual cost.
- **`AgentCancel` stops cleanly.** `BudgetExceeded` extends `AgentCancel`, so AnyAgent preserves the partial trace and stops the agent without wrapping the error.
- **Per-agent scoping with subject hierarchy.** Use `tenant`, `workflow`, and `agent` to mirror your agent topology in Cycles budget paths.
- **Preflight checks with `client.decide()`.** Check budget availability before creating or running the agent to avoid wasting resources.

## Next steps

- [Error Handling Patterns in Python](/how-to/error-handling-patterns-in-python) — handling budget errors in Python
- [Degradation Paths](/how-to/how-to-think-about-degradation-paths-in-cycles-deny-downgrade-disable-or-defer) — strategies for graceful degradation
- [Testing with Cycles](/how-to/testing-with-cycles) — testing budget-guarded code
- [Production Operations Guide](/how-to/production-operations-guide) — running Cycles in production
- [Integrating with OpenAI](/how-to/integrating-cycles-with-openai) — budget governance for direct OpenAI calls
- [Integrating with LangChain](/how-to/integrating-cycles-with-langchain) — budget governance for LangChain apps
