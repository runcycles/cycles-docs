---
title: "Integrating Cycles with Anthropic (TypeScript)"
description: "Guard Anthropic Messages API calls with Cycles budget reservations in TypeScript, including streaming with reserveForStream and per-tool-call tracking."
---

# Integrating Cycles with Anthropic (TypeScript)

This guide shows how to guard Anthropic Messages API calls with Cycles budget reservations in TypeScript, including streaming support and per-tool-call budget tracking for agentic workflows.

For the Python version, see [Integrating with Anthropic (Python)](/how-to/integrating-cycles-with-anthropic).

## Prerequisites

- A running Cycles stack with a tenant, API key, and budget ([Deploy the Full Stack](/quickstart/deploying-the-full-cycles-stack))
- Node.js 20+

## Installation

```bash
npm install runcycles @anthropic-ai/sdk
```

```bash
export CYCLES_BASE_URL="http://localhost:7878"
export CYCLES_API_KEY="cyc_live_..."
export ANTHROPIC_API_KEY="sk-ant-..."
```

::: tip 60-Second Quick Start
```typescript
import Anthropic from "@anthropic-ai/sdk";
import { CyclesClient, CyclesConfig, withCycles } from "runcycles";

const cycles = new CyclesClient(CyclesConfig.fromEnv());
const anthropic = new Anthropic();

const ask = withCycles(
  {
    client: cycles,
    actionKind: "llm.completion",
    actionName: "claude-sonnet-4",
    estimate: () => 2_000_000,
    actual: (r: Anthropic.Message) =>
      r.usage.input_tokens * 300 + r.usage.output_tokens * 1_500,
  },
  async (prompt: string) => {
    return anthropic.messages.create({
      model: "claude-sonnet-4-20250514",
      max_tokens: 1024,
      messages: [{ role: "user", content: prompt }],
    });
  },
);

const response = await ask("What is budget authority?");
console.log(response.content[0].type === "text" ? response.content[0].text : "");
```
Budget is reserved before the call and committed with actual token cost after. If budget is exhausted, `BudgetExceededError` is thrown _before_ the Anthropic call is made.
:::

## Non-streaming calls with withCycles

Use the `withCycles` higher-order function to wrap Anthropic calls with automatic reserve → execute → commit:

```typescript
import Anthropic from "@anthropic-ai/sdk";
import {
  CyclesClient, CyclesConfig, withCycles,
  setDefaultClient, getCyclesContext, BudgetExceededError,
} from "runcycles";

const cyclesClient = new CyclesClient(CyclesConfig.fromEnv());
setDefaultClient(cyclesClient);

const anthropic = new Anthropic();

// Claude Sonnet 4 pricing (microcents per token)
const INPUT_PRICE = 300;     // $3.00 / 1M tokens
const OUTPUT_PRICE = 1_500;  // $15.00 / 1M tokens
const DEFAULT_MAX_TOKENS = 1024;

const sendMessage = withCycles(
  {
    client: cyclesClient,
    actionKind: "llm.completion",
    actionName: "claude-sonnet-4-20250514",
    estimate: (prompt: string) => {
      const inputTokens = Math.ceil(prompt.length / 4);
      return inputTokens * INPUT_PRICE + DEFAULT_MAX_TOKENS * OUTPUT_PRICE;
    },
    actual: (response: Anthropic.Message) => {
      return response.usage.input_tokens * INPUT_PRICE
        + response.usage.output_tokens * OUTPUT_PRICE;
    },
  },
  async (prompt: string) => {
    const ctx = getCyclesContext();

    // Respect budget caps
    let maxTokens = DEFAULT_MAX_TOKENS;
    if (ctx?.caps?.maxTokens) {
      maxTokens = Math.min(maxTokens, ctx.caps.maxTokens);
    }

    const response = await anthropic.messages.create({
      model: "claude-sonnet-4-20250514",
      max_tokens: maxTokens,
      messages: [{ role: "user", content: prompt }],
    });

    // Report metrics for observability
    if (ctx) {
      ctx.metrics = {
        tokensInput: response.usage.input_tokens,
        tokensOutput: response.usage.output_tokens,
        modelVersion: response.model,
      };
    }

    return response;
  },
);

try {
  const response = await sendMessage("Explain budget governance.");
  console.log(response.content[0].type === "text" ? response.content[0].text : "");
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
import Anthropic from "@anthropic-ai/sdk";
import {
  CyclesClient, CyclesConfig, reserveForStream, BudgetExceededError,
} from "runcycles";

const cyclesClient = new CyclesClient(CyclesConfig.fromEnv());
const anthropic = new Anthropic();

const INPUT_PRICE = 300;
const OUTPUT_PRICE = 1_500;

async function streamWithBudget(prompt: string) {
  const estimatedInputTokens = Math.ceil(prompt.length / 4);
  const estimate = estimatedInputTokens * INPUT_PRICE + 1024 * OUTPUT_PRICE;

  // 1. Reserve budget
  const handle = await reserveForStream({
    client: cyclesClient,
    estimate,
    unit: "USD_MICROCENTS",
    actionKind: "llm.completion",
    actionName: "claude-sonnet-4-20250514",
  });

  try {
    // Respect budget caps
    let maxTokens = 1024;
    if (handle.caps?.maxTokens) {
      maxTokens = Math.min(maxTokens, handle.caps.maxTokens);
    }

    // 2. Stream the response
    const stream = anthropic.messages.stream({
      model: "claude-sonnet-4-20250514",
      max_tokens: maxTokens,
      messages: [{ role: "user", content: prompt }],
    });

    for await (const event of stream) {
      if (
        event.type === "content_block_delta" &&
        event.delta.type === "text_delta"
      ) {
        process.stdout.write(event.delta.text);
      }
    }

    // 3. Commit actual usage from the final message
    const finalMessage = await stream.finalMessage();
    const actualCost =
      finalMessage.usage.input_tokens * INPUT_PRICE +
      finalMessage.usage.output_tokens * OUTPUT_PRICE;

    await handle.commit(actualCost, {
      tokensInput: finalMessage.usage.input_tokens,
      tokensOutput: finalMessage.usage.output_tokens,
      modelVersion: finalMessage.model,
    });
  } catch (err) {
    await handle.release("stream_error");
    throw err;
  }
}
```

## Per-tool-call budget tracking

When Claude uses tools, each LLM turn consumes tokens. Use `reserveForStream` to create a reservation per turn:

```typescript
import Anthropic from "@anthropic-ai/sdk";
import {
  CyclesClient, CyclesConfig, reserveForStream, BudgetExceededError,
} from "runcycles";

const cyclesClient = new CyclesClient(CyclesConfig.fromEnv());
const anthropic = new Anthropic();

const INPUT_PRICE = 300;
const OUTPUT_PRICE = 1_500;

async function chatWithTools(prompt: string): Promise<string> {
  const messages: Anthropic.MessageParam[] = [
    { role: "user", content: prompt },
  ];

  for (let turn = 1; turn <= 5; turn++) {
    // Reserve budget for this turn — a denial ends the conversation gracefully
    let handle;
    try {
      handle = await reserveForStream({
        client: cyclesClient,
        estimate: 2_000_000,
        unit: "USD_MICROCENTS",
        actionKind: "llm.completion",
        actionName: "claude-sonnet-4-20250514",
      });
    } catch (err) {
      if (err instanceof BudgetExceededError) {
        return "Budget exhausted mid-conversation.";
      }
      throw err;
    }

    try {
      const response = await anthropic.messages.create({
        model: "claude-sonnet-4-20250514",
        max_tokens: 1024,
        tools: TOOLS,
        messages,
      });

      // Commit actual cost
      const actualCost =
        response.usage.input_tokens * INPUT_PRICE +
        response.usage.output_tokens * OUTPUT_PRICE;

      await handle.commit(actualCost, {
        tokensInput: response.usage.input_tokens,
        tokensOutput: response.usage.output_tokens,
        modelVersion: response.model,
      });

      if (response.stop_reason === "end_turn") {
        const textBlock = response.content.find((b) => b.type === "text");
        return textBlock ? textBlock.text : "";
      }

      // Process tool calls and continue
      if (response.stop_reason === "tool_use") {
        messages.push({ role: "assistant", content: response.content });
        const toolResults: Anthropic.ToolResultBlockParam[] = [];
        for (const block of response.content) {
          if (block.type === "tool_use") {
            const result = await executeTool(block.name, block.input);
            toolResults.push({
              type: "tool_result",
              tool_use_id: block.id,
              content: result,
            });
          }
        }
        messages.push({ role: "user", content: toolResults });
      }
    } catch (err) {
      await handle.release("tool_call_error");
      throw err;
    }
  }

  return "Max turns reached.";
}
```

Each turn gets its own reservation, so the budget authority can deny mid-conversation if the agent is burning through budget too fast.

## Pricing reference

Adjust these constants for the model you use:

| Model | Input (microcents/token) | Output (microcents/token) |
|-------|--------------------------|---------------------------|
| Claude Haiku 3.5 | 80 | 400 |
| Claude Sonnet 4 | 300 | 1,500 |
| Claude Opus 4 | 1,500 | 7,500 |

## Key points

- **`withCycles` for non-streaming.** Wraps a single Anthropic call with automatic reserve → execute → commit.
- **`reserveForStream` for streaming.** Manages the reservation lifecycle with automatic heartbeat during the stream.
- **Token fields differ from OpenAI.** Anthropic uses `usage.input_tokens` / `usage.output_tokens` (not `prompt_tokens` / `completion_tokens`).
- **Per-turn reservations for tool use.** Each LLM turn in a tool-use loop gets its own reservation for fine-grained budget control.
- **Respect caps.** Check `handle.caps?.maxTokens` to honor budget authority limits.

## Full example

See [`examples/anthropic-sdk/`](https://github.com/runcycles/cycles-client-typescript/tree/main/examples/anthropic-sdk) for a complete, runnable example.

## Next steps

- [Integrating with Anthropic (Python)](/how-to/integrating-cycles-with-anthropic) — Python version of this guide
- [Handling Streaming Responses](/how-to/handling-streaming-responses-with-cycles) — streaming patterns in detail
- [Cost Estimation Cheat Sheet](/how-to/cost-estimation-cheat-sheet) — pricing reference for estimation
- [Error Handling in TypeScript](/how-to/error-handling-patterns-in-typescript) — handling budget errors
- [Production Operations Guide](/how-to/production-operations-guide) — running Cycles in production
