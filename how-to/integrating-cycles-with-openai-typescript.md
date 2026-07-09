---
title: "Integrating Cycles with OpenAI (TypeScript)"
description: "Guard OpenAI API calls with Cycles budget reservations in TypeScript, including streaming with reserveForStream and caps-aware completions."
---

# Integrating Cycles with OpenAI (TypeScript)

This guide shows how to guard OpenAI API calls with Cycles budget reservations in TypeScript, including streaming support and caps-aware completions.

For the Python version, see [Integrating with OpenAI (Python)](/how-to/integrating-cycles-with-openai).

## Prerequisites

- A running Cycles stack with a tenant, API key, and budget ([Deploy the Full Stack](/quickstart/deploying-the-full-cycles-stack))
- Node.js 20+

## Installation

```bash
npm install runcycles openai
```

```bash
export CYCLES_BASE_URL="http://localhost:7878"
export CYCLES_API_KEY="cyc_live_..."
export OPENAI_API_KEY="sk-..."
```

::: tip 60-Second Quick Start
```typescript
import OpenAI from "openai";
import { CyclesClient, CyclesConfig, withCycles } from "runcycles";

const cycles = new CyclesClient(CyclesConfig.fromEnv());
const openai = new OpenAI();

const ask = withCycles(
  {
    client: cycles,
    actionKind: "llm.completion",
    actionName: "gpt-4o",
    estimate: () => 1_500_000,
    actual: (r: OpenAI.ChatCompletion) =>
      (r.usage?.prompt_tokens ?? 0) * 250 + (r.usage?.completion_tokens ?? 0) * 1_000,
  },
  async (prompt: string) => {
    return openai.chat.completions.create({
      model: "gpt-4o",
      messages: [{ role: "user", content: prompt }],
    });
  },
);

const response = await ask("What is budget authority?");
console.log(response.choices[0].message.content);
```
Budget is reserved before the call and committed with actual token cost after. If budget is exhausted, `BudgetExceededError` is thrown _before_ the OpenAI call is made.
:::

## Non-streaming calls with withCycles

Use the `withCycles` higher-order function to wrap OpenAI calls with automatic reserve → execute → commit:

```typescript
import OpenAI from "openai";
import {
  CyclesClient, CyclesConfig, withCycles,
  setDefaultClient, getCyclesContext, BudgetExceededError,
} from "runcycles";

const cyclesClient = new CyclesClient(CyclesConfig.fromEnv());
setDefaultClient(cyclesClient);

const openai = new OpenAI();

// GPT-4o pricing (microcents per token)
const INPUT_PRICE = 250;     // $2.50 / 1M tokens
const OUTPUT_PRICE = 1_000;  // $10.00 / 1M tokens
const DEFAULT_MAX_TOKENS = 1024;

const chatCompletion = withCycles(
  {
    client: cyclesClient,
    actionKind: "llm.completion",
    actionName: "gpt-4o",
    estimate: (prompt: string) => {
      const inputTokens = Math.ceil(prompt.length / 4);
      return inputTokens * INPUT_PRICE + DEFAULT_MAX_TOKENS * OUTPUT_PRICE;
    },
    actual: (response: OpenAI.ChatCompletion) => {
      return (response.usage?.prompt_tokens ?? 0) * INPUT_PRICE
        + (response.usage?.completion_tokens ?? 0) * OUTPUT_PRICE;
    },
  },
  async (prompt: string) => {
    const ctx = getCyclesContext();

    // Respect budget caps
    let maxTokens = DEFAULT_MAX_TOKENS;
    if (ctx?.caps?.maxTokens) {
      maxTokens = Math.min(maxTokens, ctx.caps.maxTokens);
    }

    const response = await openai.chat.completions.create({
      model: "gpt-4o",
      max_completion_tokens: maxTokens,
      messages: [{ role: "user", content: prompt }],
    });

    // Report metrics for observability
    if (ctx) {
      ctx.metrics = {
        tokensInput: response.usage?.prompt_tokens,
        tokensOutput: response.usage?.completion_tokens,
        modelVersion: response.model,
      };
    }

    return response;
  },
);

try {
  const response = await chatCompletion("Explain budget governance.");
  console.log(response.choices[0].message.content);
} catch (err) {
  if (err instanceof BudgetExceededError) {
    console.log("Budget exhausted.");
  } else {
    throw err;
  }
}
```

## Streaming with reserveForStream

For streaming responses, use `reserveForStream` to manage the reservation lifecycle:

```typescript
import OpenAI from "openai";
import {
  CyclesClient, CyclesConfig, reserveForStream, BudgetExceededError,
} from "runcycles";

const cyclesClient = new CyclesClient(CyclesConfig.fromEnv());
const openai = new OpenAI();

const INPUT_PRICE = 250;
const OUTPUT_PRICE = 1_000;

async function streamWithBudget(prompt: string) {
  const estimatedInputTokens = Math.ceil(prompt.length / 4);
  const estimate = estimatedInputTokens * INPUT_PRICE + 1024 * OUTPUT_PRICE;

  // 1. Reserve budget
  const handle = await reserveForStream({
    client: cyclesClient,
    estimate,
    unit: "USD_MICROCENTS",
    actionKind: "llm.completion",
    actionName: "gpt-4o",
  });

  try {
    // Respect budget caps
    let maxTokens = 1024;
    if (handle.caps?.maxTokens) {
      maxTokens = Math.min(maxTokens, handle.caps.maxTokens);
    }

    // 2. Stream the response
    const stream = await openai.chat.completions.create({
      model: "gpt-4o",
      max_completion_tokens: maxTokens,
      messages: [{ role: "user", content: prompt }],
      stream: true,
      stream_options: { include_usage: true },
    });

    let promptTokens = 0;
    let completionTokens = 0;

    for await (const chunk of stream) {
      const text = chunk.choices[0]?.delta?.content;
      if (text) process.stdout.write(text);

      if (chunk.usage) {
        promptTokens = chunk.usage.prompt_tokens ?? 0;
        completionTokens = chunk.usage.completion_tokens ?? 0;
      }
    }

    // 3. Commit actual usage
    const actualCost = promptTokens * INPUT_PRICE + completionTokens * OUTPUT_PRICE;
    await handle.commit(actualCost, {
      tokensInput: promptTokens,
      tokensOutput: completionTokens,
      modelVersion: "gpt-4o",
    });
  } catch (err) {
    await handle.release("stream_error");
    throw err;
  }
}
```

::: info max_tokens is deprecated
The snippets use `max_completion_tokens`: OpenAI deprecated `max_tokens` in its favor, and reasoning models (o-series) reject `max_tokens` outright.
:::

## Pricing reference

Adjust these constants for the model you use:

| Model | Input (microcents/token) | Output (microcents/token) |
|-------|--------------------------|---------------------------|
| gpt-4o | 250 | 1,000 |
| gpt-4o-mini | 15 | 60 |
| gpt-4.1 | 200 | 800 |
| gpt-4.1-mini | 40 | 160 |
| gpt-4.1-nano | 10 | 40 |
| o3 | 200 | 800 |
| o4-mini | 110 | 440 |

See [Cost Estimation Cheat Sheet](/how-to/cost-estimation-cheat-sheet) for the full pricing reference.

## Key points

- **`withCycles` for non-streaming.** Wraps a single OpenAI call with automatic reserve → execute → commit.
- **`reserveForStream` for streaming.** Manages the reservation lifecycle with automatic heartbeat during the stream.
- **Use `stream_options: { include_usage: true }`.** Required to get token counts from OpenAI streaming responses.
- **Token fields:** `usage.prompt_tokens` / `usage.completion_tokens` (OpenAI naming).
- **Respect caps.** Check `ctx.caps?.maxTokens` or `handle.caps?.maxTokens` to honor budget authority limits.

## Full example

See [`examples/openai-sdk/`](https://github.com/runcycles/cycles-client-typescript/tree/main/examples/openai-sdk) for a complete, runnable example.

## Next steps

- [Integrating with OpenAI (Python)](/how-to/integrating-cycles-with-openai) — Python version of this guide
- [Handling Streaming Responses](/how-to/handling-streaming-responses-with-cycles) — streaming patterns in detail
- [Cost Estimation Cheat Sheet](/how-to/cost-estimation-cheat-sheet) — pricing reference for estimation
- [Error Handling in TypeScript](/how-to/error-handling-patterns-in-typescript) — handling budget errors
- [Production Operations Guide](/how-to/production-operations-guide) — running Cycles in production
