---
title: "Integrating Cycles with Groq"
description: "Add budget governance to Groq API calls using the OpenAI SDK with Cycles. Includes Groq-specific pricing, estimation, and a model-downgrade degradation pattern."
---

# Integrating Cycles with Groq

This guide shows how to add budget governance to [Groq](https://groq.com/) API calls. Groq provides an OpenAI-compatible Chat Completions API, so the examples use the OpenAI SDK with a different `base_url`. Confirm Groq support before copying provider-specific OpenAI features beyond that shared surface.

## Prerequisites

```bash
pip install runcycles openai
```

```bash
export CYCLES_BASE_URL="http://localhost:7878"
export CYCLES_API_KEY="your-api-key"   # create via Admin Server — see note below
export CYCLES_TENANT="acme"
export GROQ_API_KEY="gsk_..."
```

> **Need a Cycles API key?** Create one via the Admin Server — see [Deploy the Full Stack](/quickstart/deploying-the-full-cycles-stack#step-3-create-an-api-key) or [API Key Management](/how-to/api-key-management-in-cycles).

::: tip 60-Second Quick Start
```python
from openai import OpenAI
from runcycles import CyclesClient, CyclesConfig, cycles, set_default_client

set_default_client(CyclesClient(CyclesConfig.from_env()))
groq = OpenAI(base_url="https://api.groq.com/openai/v1", api_key="gsk_...")

@cycles(estimate=100_000, action_kind="llm.completion", action_name="openai/gpt-oss-120b")
def ask(prompt: str) -> str:
    return groq.chat.completions.create(
        model="openai/gpt-oss-120b",
        messages=[{"role": "user", "content": prompt}],
    ).choices[0].message.content

print(ask("What is budget authority?"))
```
Same SDK shape, same `@cycles` decorator, different `base_url`. Size the estimate from the selected Groq model's current price and a conservative token ceiling.
:::

## Basic pattern

```python
import os
from openai import OpenAI
from runcycles import (
    CyclesConfig, CyclesClient, CyclesMetrics,
    cycles, get_cycles_context, set_default_client,
)

set_default_client(CyclesClient(CyclesConfig.from_env()))

groq = OpenAI(
    base_url="https://api.groq.com/openai/v1",
    api_key=os.environ["GROQ_API_KEY"],
)

# GPT-OSS 120B on Groq, checked 2026-07-24:
# $0.15 / 1M input tokens and $0.60 / 1M output tokens.
PRICE_PER_INPUT_TOKEN = 15
PRICE_PER_OUTPUT_TOKEN = 60

@cycles(
    estimate=lambda prompt, **kw: len(prompt.split()) * 2 * PRICE_PER_INPUT_TOKEN
        + kw.get("max_tokens", 1024) * PRICE_PER_OUTPUT_TOKEN,
    actual=lambda result: (
        result["usage"]["prompt_tokens"] * PRICE_PER_INPUT_TOKEN
        + result["usage"]["completion_tokens"] * PRICE_PER_OUTPUT_TOKEN
    ),
    action_kind="llm.completion",
    action_name="openai/gpt-oss-120b",
    unit="USD_MICROCENTS",
)
def chat(prompt: str, max_tokens: int = 1024) -> dict:
    ctx = get_cycles_context()
    if ctx and ctx.has_caps() and ctx.caps.max_tokens:
        max_tokens = min(max_tokens, ctx.caps.max_tokens)

    response = groq.chat.completions.create(
        model="openai/gpt-oss-120b",
        messages=[{"role": "user", "content": prompt}],
        max_tokens=max_tokens,
    )

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

## TypeScript

```typescript
import OpenAI from "openai";
import { CyclesClient, CyclesConfig, withCycles, getCyclesContext } from "runcycles";

const cycles = new CyclesClient(CyclesConfig.fromEnv());
const groq = new OpenAI({
  baseURL: "https://api.groq.com/openai/v1",
  apiKey: process.env.GROQ_API_KEY,
});

const INPUT_PRICE = 15;
const OUTPUT_PRICE = 60;

const chat = withCycles(
  {
    client: cycles,
    actionKind: "llm.completion",
    actionName: "openai/gpt-oss-120b",
    estimate: (prompt: string) => {
      const inputTokens = Math.ceil(prompt.length / 4);
      return inputTokens * INPUT_PRICE + 1024 * OUTPUT_PRICE;
    },
    actual: (r: OpenAI.ChatCompletion) =>
      (r.usage?.prompt_tokens ?? 0) * INPUT_PRICE +
      (r.usage?.completion_tokens ?? 0) * OUTPUT_PRICE,
  },
  async (prompt: string) => {
    const ctx = getCyclesContext();
    let maxTokens = 1024;
    if (ctx?.caps?.maxTokens) {
      maxTokens = Math.min(maxTokens, ctx.caps.maxTokens);
    }

    return groq.chat.completions.create({
      model: "openai/gpt-oss-120b",
      max_tokens: maxTokens,
      messages: [{ role: "user", content: prompt }],
    });
  },
);
```

## Groq pricing reference

Groq's on-demand list prices were rechecked on July 24, 2026:

| Model | Input (per 1M tokens) | Output (per 1M tokens) | Input (microcents/1K tokens) | Output (microcents/1K tokens) |
|---|---|---|---|---|
| `openai/gpt-oss-20b` | $0.075 | $0.30 | 7,500 | 30,000 |
| `openai/gpt-oss-120b` | $0.15 | $0.60 | 15,000 | 60,000 |
| `qwen/qwen3.6-27b` | $0.60 | $3.00 | 60,000 | 300,000 |

::: info Note
Groq pricing and model availability change. Check [Groq pricing](https://groq.com/pricing) and [model deprecations](https://console.groq.com/docs/deprecations) before deploying. Llama 4 Scout shut down for free and developer tiers on July 17, 2026; Llama 3.1 8B and Llama 3.3 70B are scheduled to shut down for those tiers on August 16, 2026.
:::

## Model-downgrade degradation pattern

An application can try a lower-estimate Groq route after the primary route's reservation is rejected. Cycles does not choose the fallback or detect a “low budget” threshold automatically; the application owns that policy.

```python
from runcycles import BudgetExceededError

# Primary provider route
primary_client = OpenAI()
PRIMARY_MODEL = os.environ["PRIMARY_MODEL"]

# Lower-estimate Groq route
fallback_client = OpenAI(
    base_url="https://api.groq.com/openai/v1",
    api_key=os.environ["GROQ_API_KEY"],
)

@cycles(
    estimate=1_500_000,
    action_kind="llm.completion",
    action_name="primary-model-route",
)
def primary_chat(prompt: str) -> dict:
    response = primary_client.chat.completions.create(
        model=PRIMARY_MODEL,
        messages=[{"role": "user", "content": prompt}],
    )
    return {"content": response.choices[0].message.content, "model": PRIMARY_MODEL}

@cycles(
    estimate=100_000,
    action_kind="llm.completion",
    action_name="openai/gpt-oss-120b",
)
def fallback_chat(prompt: str) -> dict:
    response = fallback_client.chat.completions.create(
        model="openai/gpt-oss-120b",
        messages=[{"role": "user", "content": prompt}],
    )
    return {"content": response.choices[0].message.content, "model": "openai/gpt-oss-120b"}

def chat_with_downgrade(prompt: str) -> dict:
    """Try the primary route, then a lower-estimate Groq route."""
    try:
        return primary_chat(prompt)
    except BudgetExceededError:
        return fallback_chat(prompt)
```

This pattern gives you:
- **An application-owned fallback** after the primary reservation is rejected
- **A separately estimated Groq route** that may still fit the remaining ledger
- **Per-model attribution** in reservation records through distinct `action_name` values

See [Degradation Paths](/how-to/how-to-think-about-degradation-paths-in-cycles-deny-downgrade-disable-or-defer) for more strategies.

## Key points

- **Same SDK, different `base_url`.** Groq uses the OpenAI-compatible API — no new SDK to learn.
- **Model-specific estimates.** Calculate from current Groq list or contracted rates; do not copy an estimate from a different model.
- **Fallback is application policy.** A rejected primary reservation can trigger a separately budgeted Groq route.
- **Compatibility has limits.** The OpenAI-compatible Chat Completions shape enables shared client code, but verify streaming, tool, and response-field behavior for the selected Groq model.

## Next steps

- [Integrating with OpenAI](/how-to/integrating-cycles-with-openai) — related OpenAI SDK lifecycle patterns
- [Integrating with OpenAI (TypeScript)](/how-to/integrating-cycles-with-openai-typescript) — TypeScript streaming patterns
- [Degradation Paths](/how-to/how-to-think-about-degradation-paths-in-cycles-deny-downgrade-disable-or-defer) — model downgrade and other strategies
- [Cost Estimation Cheat Sheet](/how-to/cost-estimation-cheat-sheet) — pricing reference for all providers
- [Integrating with Ollama](/how-to/integrating-cycles-with-ollama) — self-hosted open-source models
