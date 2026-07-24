---
title: "Integrating Cycles with Pydantic AI"
description: "Guard Pydantic AI agent runs with Cycles budget reservations for cost-controlled, caps-aware AI workflows with structured outputs."
---

# Integrating Cycles with Pydantic AI

This guide shows how to guard [Pydantic AI](https://pydantic.dev/docs/ai/overview/) agent runs with Cycles budget reservations so that every agent invocation is cost-controlled and observable.

## Prerequisites

```bash
pip install runcycles pydantic-ai
```

Set environment variables:

```bash
export CYCLES_BASE_URL="http://localhost:7878"
export CYCLES_API_KEY="your-api-key"   # create via Admin Server — see note below
export CYCLES_TENANT="acme"
export OPENAI_API_KEY="sk-..."         # or whichever provider your agent uses
```

> **Need an API key?** Create one via the Admin Server — see [Deploy the Full Stack](/quickstart/deploying-the-full-cycles-stack#step-3-create-an-api-key) or [API Key Management](/how-to/api-key-management-in-cycles).

> **Note:** The snippets on this page target pydantic-ai 1.x (`result.output`, `output_type=`, `input_tokens`/`output_tokens`). Pre-1.0 releases used `result.data`, `result_type=`, and `request_tokens`/`response_tokens`.

::: tip 60-Second Quick Start
```python
from pydantic_ai import Agent
from runcycles import CyclesClient, CyclesConfig, cycles, set_default_client

set_default_client(CyclesClient(CyclesConfig.from_env()))

agent = Agent("openai:gpt-4o", system_prompt="You are a helpful assistant.")

@cycles(estimate=1_500_000, action_kind="llm.completion", action_name="gpt-4o")
def ask(prompt: str) -> str:
    result = agent.run_sync(prompt)
    return result.output

print(ask("What is budget authority?"))
```
Every call is now budget-guarded. If the budget is exhausted, `BudgetExceededError` is raised _before_ the agent runs. Read on for production patterns with tool calls and structured output.
:::

## Guarding model calls

Use `@cycles` to wrap an agent run with automatic reserve, execute, and commit:

```python
from pydantic_ai import Agent
from runcycles import (
    CyclesClient, CyclesConfig, CyclesMetrics,
    cycles, get_cycles_context, set_default_client,
)

set_default_client(CyclesClient(CyclesConfig.from_env()))

PRICE_PER_INPUT_TOKEN = 250       # $2.50 / 1M tokens in microcents
PRICE_PER_OUTPUT_TOKEN = 1_000    # $10.00 / 1M tokens in microcents

agent = Agent("openai:gpt-4o", system_prompt="You are a research assistant.")

@cycles(
    estimate=2_000_000,
    actual=lambda result: (
        result["usage"]["input_tokens"] * PRICE_PER_INPUT_TOKEN
        + result["usage"]["output_tokens"] * PRICE_PER_OUTPUT_TOKEN
    ),
    action_kind="llm.completion",
    action_name="gpt-4o",
    unit="USD_MICROCENTS",
    ttl_ms=60_000,
)
def research(question: str) -> dict:
    result = agent.run_sync(question)

    ctx = get_cycles_context()
    if ctx:
        ctx.metrics = CyclesMetrics(
            tokens_input=result.usage().input_tokens,
            tokens_output=result.usage().output_tokens,
        )

    return {
        "answer": result.output,
        "usage": {
            "input_tokens": result.usage().input_tokens,
            "output_tokens": result.usage().output_tokens,
        },
    }
```

## Tool call budget scoping

When your Pydantic AI agent uses tools, you can budget each tool invocation separately by wrapping tool functions with `@cycles`:

```python
from pydantic_ai import Agent, RunContext

agent = Agent("openai:gpt-4o", system_prompt="Use tools to answer questions.")

@agent.tool
@cycles(estimate=50_000, action_kind="tool.search", action_name="web-search")
def search_web(ctx: RunContext[None], query: str) -> str:
    """Search the web for information."""
    # Your search implementation
    return perform_search(query)

@agent.tool
@cycles(estimate=20_000, action_kind="tool.lookup", action_name="db-lookup")
def lookup_database(ctx: RunContext[None], record_id: str) -> str:
    """Look up a record in the database."""
    return db.get(record_id)

@cycles(estimate=2_000_000, action_kind="llm.completion", action_name="gpt-4o")
def ask_with_tools(prompt: str) -> str:
    result = agent.run_sync(prompt)
    return result.output
```

Each tool call gets its own reservation, so you have fine-grained visibility into what the agent spends on LLM calls versus tool invocations.

## Structured output with budget control

Pydantic AI excels at returning structured data. Combine this with Cycles to budget-guard typed responses:

```python
from pydantic import BaseModel
from pydantic_ai import Agent
from runcycles import cycles

class MovieReview(BaseModel):
    title: str
    rating: float
    summary: str

review_agent = Agent(
    "openai:gpt-4o",
    output_type=MovieReview,
    system_prompt="You are a film critic. Return structured reviews.",
)

@cycles(estimate=1_500_000, action_kind="llm.completion", action_name="gpt-4o")
def review_movie(movie_name: str) -> MovieReview:
    result = review_agent.run_sync(f"Review the movie: {movie_name}")
    return result.output
```

The decorator does not interfere with the return type. Your function still returns a `MovieReview` instance; Cycles only manages the budget lifecycle around it.

## Error handling

When the budget is insufficient, `BudgetExceededError` is raised **before** the agent runs:

```python
from runcycles import BudgetExceededError

try:
    answer = ask("Summarize recent ML papers")
except BudgetExceededError:
    answer = "Budget exhausted — please try again later."
```

For agents with tool calls, each tool decorated with `@cycles` can independently raise `BudgetExceededError`. Handle this at the outer call to catch failures at any level:

```python
try:
    result = ask_with_tools("Find the latest sales data and summarize it")
except BudgetExceededError as e:
    print(f"Budget limit hit: {e}")
    result = fallback_response()
```

See [Degradation Paths](/how-to/how-to-think-about-degradation-paths-in-cycles-deny-downgrade-disable-or-defer) for patterns like queueing, model downgrade, and caching.

## Key points

- **Decorator wraps any function.** The `@cycles` decorator works with `agent.run_sync()`, async runs, and tool functions alike.
- **Tool-level budgets.** Decorate individual `@agent.tool` functions for per-tool cost visibility.
- **Structured output is preserved.** Cycles does not alter your function's return type or Pydantic models.
- **The agent never runs on DENY.** If the budget is exhausted, the LLM is never called, saving both cost and latency.

## Next steps

- [Error Handling Patterns in Python](/how-to/error-handling-patterns-in-python) — handling budget errors in Python
- [Handling Streaming Responses](/how-to/handling-streaming-responses-with-cycles) — budget-managed streaming
- [Testing with Cycles](/how-to/testing-with-cycles) — testing budget-guarded code
- [Production Operations Guide](/how-to/production-operations-guide) — running Cycles in production
- [Integrating with OpenAI](/how-to/integrating-cycles-with-openai) — if your Pydantic AI agent uses OpenAI models
- [Integrating with Anthropic](/how-to/integrating-cycles-with-anthropic) — if your Pydantic AI agent uses Anthropic models
