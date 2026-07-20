---
title: "Integrating Cycles with OpenAI"
description: "Guard OpenAI API calls with Cycles budget reservations for cost-controlled, caps-aware chat completions. Includes Python and TypeScript examples."
---

# Integrating Cycles with OpenAI

This guide shows how to guard OpenAI API calls with Cycles budget reservations so that every chat completion is cost-controlled, caps-aware, and observable.

::: tip Using the OpenAI Agents SDK?
If you're building multi-agent workflows with the [OpenAI Agents SDK](https://github.com/openai/openai-agents-python), see [Integrating Cycles with OpenAI Agents SDK](/how-to/integrating-cycles-with-openai-agents) instead — it covers the entire agent run automatically with no per-function decoration.
:::

## Prerequisites

```bash
pip install runcycles openai
```

Set environment variables:

```bash
export CYCLES_BASE_URL="http://localhost:7878"
export CYCLES_API_KEY="your-api-key"   # create via Admin Server — see note below
export CYCLES_TENANT="acme"
export OPENAI_API_KEY="sk-..."
```

> **Prefer not to use environment variables?** All settings can be loaded programmatically from any secret manager, vault, or encrypted config file:
>
> ```python
> from runcycles import CyclesConfig, CyclesClient, set_default_client
>
> config = CyclesConfig(
>     base_url=load_from_vault("cycles_base_url"),
>     api_key=load_from_vault("cycles_api_key"),
>     tenant=load_from_vault("cycles_tenant"),
> )
> set_default_client(CyclesClient(config))
> ```
>
> See [Python Client Configuration](/configuration/python-client-configuration-reference) for all options.

> **Need an API key?** Create one via the Admin Server — see [Deploy the Full Stack](/quickstart/deploying-the-full-cycles-stack#step-3-create-an-api-key) or [API Key Management](/how-to/api-key-management-in-cycles).

::: tip 60-Second Quick Start
```python
from openai import OpenAI
from runcycles import CyclesClient, CyclesConfig, cycles, set_default_client

set_default_client(CyclesClient(CyclesConfig.from_env()))

@cycles(estimate=1_500_000, action_kind="llm.completion", action_name="gpt-4o")
def ask(prompt: str) -> str:
    return OpenAI().chat.completions.create(
        model="gpt-4o",
        messages=[{"role": "user", "content": prompt}],
    ).choices[0].message.content

print(ask("What is budget authority?"))
```
That's it — every call is now budget-guarded. If the budget is exhausted, `BudgetExceededError` is raised _before_ the OpenAI call is made.

> **Note:** This quick start commits the estimate as actual spend. For accurate cost tracking, add an `actual` callback — see [Basic pattern](#basic-pattern) below.
:::

## Basic pattern

Use the `@cycles` decorator to wrap an OpenAI call with automatic reserve → execute → commit:

```python
from openai import OpenAI
from runcycles import (
    CyclesClient, CyclesConfig, CyclesMetrics,
    cycles, get_cycles_context, set_default_client,
)

# Set up clients
config = CyclesConfig.from_env()
set_default_client(CyclesClient(config))
openai_client = OpenAI()

# Per-token pricing in USD microcents (1 USD = 100_000_000 microcents)
PRICE_PER_INPUT_TOKEN = 250       # $2.50 / 1M tokens
PRICE_PER_OUTPUT_TOKEN = 1_000    # $10.00 / 1M tokens

@cycles(
    estimate=lambda prompt, **kw: len(prompt.split()) * 2 * PRICE_PER_INPUT_TOKEN
        + kw.get("max_tokens", 1024) * PRICE_PER_OUTPUT_TOKEN,
    actual=lambda result: (
        result["usage"]["prompt_tokens"] * PRICE_PER_INPUT_TOKEN
        + result["usage"]["completion_tokens"] * PRICE_PER_OUTPUT_TOKEN
    ),
    action_kind="llm.completion",
    action_name="gpt-4o",
    unit="USD_MICROCENTS",
    ttl_ms=60_000,
)
def chat_completion(prompt: str, max_tokens: int = 1024) -> dict:
    ctx = get_cycles_context()

    # Respect caps from the budget authority
    if ctx and ctx.has_caps() and ctx.caps.max_tokens:
        max_tokens = min(max_tokens, ctx.caps.max_tokens)

    response = openai_client.chat.completions.create(
        model="gpt-4o",
        messages=[{"role": "user", "content": prompt}],
        max_tokens=max_tokens,
    )

    # Report metrics
    if ctx:
        ctx.metrics = CyclesMetrics(
            tokens_input=response.usage.prompt_tokens,
            tokens_output=response.usage.completion_tokens,
            model_version=response.model,
        )

    return {
        "content": response.choices[0].message.content,
        "usage": {
            "prompt_tokens": response.usage.prompt_tokens,
            "completion_tokens": response.usage.completion_tokens,
        },
    }
```

## Cost estimation strategies

The estimate function runs **before** the API call. The more accurate it is, the less budget you hold unnecessarily:

| Strategy | Accuracy | Example |
|----------|----------|---------|
| Constant | Low | `estimate=500_000` |
| Token-proportional | Medium | `estimate=lambda p, **kw: kw.get("max_tokens", 1024) * PRICE_PER_OUTPUT_TOKEN` |
| Input + output | High | Count input tokens (or approximate from word count) plus max output tokens |

For production use, consider using `tiktoken` for accurate input token counts:

```python
import tiktoken

enc = tiktoken.encoding_for_model("gpt-4o")

def estimate_cost(prompt: str, max_tokens: int = 1024) -> int:
    input_tokens = len(enc.encode(prompt))
    return (
        input_tokens * PRICE_PER_INPUT_TOKEN
        + max_tokens * PRICE_PER_OUTPUT_TOKEN
    )
```

## Handling budget exhaustion

When the budget is insufficient, the `@cycles` decorator raises `BudgetExceededError` **without** calling OpenAI:

```python
from runcycles import BudgetExceededError

try:
    result = chat_completion("Summarize this document...")
except BudgetExceededError:
    # Degrade gracefully
    result = {"content": "Service temporarily unavailable.", "usage": {}}
```

See [Degradation Paths](/how-to/how-to-think-about-degradation-paths-in-cycles-deny-downgrade-disable-or-defer) for patterns like queueing, model downgrade, and caching.

## Respecting caps

When the decision is `ALLOW_WITH_CAPS`, the budget authority may limit token usage. Always check and respect caps inside your function:

```python
ctx = get_cycles_context()
if ctx and ctx.has_caps() and ctx.caps.max_tokens:
    max_tokens = min(max_tokens, ctx.caps.max_tokens)
```

This lets the budget authority throttle expensive requests without fully denying them.

## Reporting metrics

Metrics attached to the context are included in the commit and become available for observability:

```python
ctx.metrics = CyclesMetrics(
    tokens_input=response.usage.prompt_tokens,
    tokens_output=response.usage.completion_tokens,
    latency_ms=elapsed_ms,
    model_version=response.model,
)
```

## Key points

- **Estimate before, commit after.** The `estimate` function determines how much budget to reserve; the `actual` function computes the real cost from the response.
- **Caps are advisory.** The budget authority sets them; your code decides how to enforce them.
- **Metrics are optional but valuable.** They flow into Cycles for per-model, per-tenant cost visibility.
- **The function never executes on DENY.** OpenAI is never called if the budget is exhausted, saving both money and latency.

## Full example

See [`examples/openai_integration.py`](https://github.com/runcycles/cycles-client-python/blob/main/examples/openai_integration.py) for a complete, runnable script.

## Next steps

- [Integrating with OpenAI (TypeScript)](/how-to/integrating-cycles-with-openai-typescript) — TypeScript version of this guide
- [Integrating with OpenAI Agents SDK](/how-to/integrating-cycles-with-openai-agents) — budget governance for multi-agent workflows
- [Error Handling Patterns in Python](/how-to/error-handling-patterns-in-python) — handling budget errors in Python
- [Handling Streaming Responses](/how-to/handling-streaming-responses-with-cycles) — budget-managed streaming
- [Testing with Cycles](/how-to/testing-with-cycles) — testing budget-guarded code
- [Production Operations Guide](/how-to/production-operations-guide) — running Cycles in production
- [OpenAI example (TypeScript)](https://github.com/runcycles/cycles-client-typescript/tree/main/examples/openai-sdk) — runnable OpenAI SDK integration
- [OpenAI example (Python)](https://github.com/runcycles/cycles-client-python/blob/main/examples/openai_integration.py) — runnable OpenAI integration
