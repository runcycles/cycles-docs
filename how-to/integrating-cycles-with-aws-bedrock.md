---
title: "Integrating Cycles with AWS Bedrock"
description: "Add budget governance to AWS Bedrock model invocations using the runcycles TypeScript client. Reserve before each call, commit actual token usage after."
---

# Integrating Cycles with AWS Bedrock

This guide shows how to add budget governance to AWS Bedrock model invocations using the `runcycles` TypeScript client and the `@aws-sdk/client-bedrock-runtime`.

## Prerequisites

- A running Cycles stack with a tenant, API key, and budget ([Deploy the Full Stack](/quickstart/deploying-the-full-cycles-stack))
- AWS credentials configured for Bedrock access
- Node.js 20+

## Installation

```bash
npm install runcycles @aws-sdk/client-bedrock-runtime
```

## Non-streaming calls with `withCycles`

For non-streaming `InvokeModel` calls, use the `withCycles` higher-order function. The example intentionally uses Amazon Bedrock's platform-specific Claude Sonnet 4 model ID, which AWS currently classifies as legacy in some regions with an October 14, 2026 end-of-life date. Confirm availability in your region and replace the ID with a supported Bedrock model before deploying.

```typescript
import { InvokeModelCommand, BedrockRuntimeClient } from "@aws-sdk/client-bedrock-runtime";
import { CyclesClient, CyclesConfig, withCycles, setDefaultClient, getCyclesContext } from "runcycles";

const cyclesClient = new CyclesClient(CyclesConfig.fromEnv());
setDefaultClient(cyclesClient);

const bedrock = new BedrockRuntimeClient({ region: "us-east-1" });
const MODEL_ID = "anthropic.claude-sonnet-4-20250514-v1:0";

// Claude on Bedrock pricing (us-east-1):
// Input: $3.00/1M tokens = 300 microcents/token
// Output: $15.00/1M tokens = 1500 microcents/token
function costMicrocents(inputTokens: number, outputTokens: number): number {
  return Math.ceil(inputTokens * 300 + outputTokens * 1500);
}

const DEFAULT_MAX_TOKENS = 1024;

const askClaude = withCycles(
  {
    client: cyclesClient,
    actionKind: "llm.completion",
    actionName: MODEL_ID,
    estimate: (prompt: string) => {
      const inputTokens = Math.ceil(prompt.length / 4);
      return costMicrocents(inputTokens, DEFAULT_MAX_TOKENS);
    },
    actual: (response: { usage: { input_tokens: number; output_tokens: number } }) => {
      return costMicrocents(response.usage.input_tokens, response.usage.output_tokens);
    },
  },
  async (prompt: string) => {
    const ctx = getCyclesContext();

    // Respect budget caps
    let maxTokens = DEFAULT_MAX_TOKENS;
    if (ctx?.caps?.maxTokens) {
      maxTokens = Math.min(maxTokens, ctx.caps.maxTokens);
    }

    const command = new InvokeModelCommand({
      modelId: MODEL_ID,
      contentType: "application/json",
      accept: "application/json",
      body: JSON.stringify({
        anthropic_version: "bedrock-2023-05-31",
        max_tokens: maxTokens,
        messages: [{ role: "user", content: prompt }],
      }),
    });

    const result = await bedrock.send(command);
    const response = JSON.parse(new TextDecoder().decode(result.body));

    // Report metrics for observability
    if (ctx) {
      ctx.metrics = {
        tokensInput: response.usage.input_tokens,
        tokensOutput: response.usage.output_tokens,
        modelVersion: MODEL_ID,
      };
    }

    return response;
  },
);

const response = await askClaude("Explain budget governance for AI agents.");
console.log(response.content[0].text);
```

## Streaming calls with reserveForStream

For streaming responses, use `reserveForStream` to manage the reservation lifecycle manually:

```typescript
import { InvokeModelWithResponseStreamCommand } from "@aws-sdk/client-bedrock-runtime";
import {
  CyclesClient,
  CyclesConfig,
  reserveForStream,
  BudgetExceededError,
} from "runcycles";

const cyclesClient = new CyclesClient(CyclesConfig.fromEnv());
const bedrock = new BedrockRuntimeClient({ region: "us-east-1" });

const MODEL_ID = "anthropic.claude-sonnet-4-20250514-v1:0";
const MAX_TOKENS = 1024;

// Pricing: Claude 3 Sonnet on Bedrock
// Input: $3.00/1M tokens = 300 microcents/token
// Output: $15.00/1M tokens = 1500 microcents/token
function estimateCost(inputTokens: number, maxOutputTokens: number): number {
  return Math.ceil((inputTokens * 300 + maxOutputTokens * 1500) * 1.2);
}

async function streamWithBudget(prompt: string) {
  const estimatedInputTokens = Math.ceil(prompt.length / 4);
  const estimate = estimateCost(estimatedInputTokens, MAX_TOKENS);

  // 1. Reserve budget
  const handle = await reserveForStream({
    client: cyclesClient,
    estimate,
    unit: "USD_MICROCENTS",
    actionKind: "llm.completion",
    actionName: MODEL_ID,
  });

  try {
    // Respect budget caps
    let maxTokens = MAX_TOKENS;
    if (handle.caps?.maxTokens) {
      maxTokens = Math.min(maxTokens, handle.caps.maxTokens);
    }

    // 2. Stream the response
    const command = new InvokeModelWithResponseStreamCommand({
      modelId: MODEL_ID,
      contentType: "application/json",
      accept: "application/json",
      body: JSON.stringify({
        anthropic_version: "bedrock-2023-05-31",
        max_tokens: maxTokens,
        messages: [{ role: "user", content: prompt }],
      }),
    });

    const result = await bedrock.send(command);

    let inputTokens = 0;
    let outputTokens = 0;

    if (result.body) {
      for await (const event of result.body) {
        if (event.chunk?.bytes) {
          const chunk = JSON.parse(new TextDecoder().decode(event.chunk.bytes));

          if (chunk.type === "content_block_delta" && chunk.delta?.text) {
            process.stdout.write(chunk.delta.text);
          }
          if (chunk.type === "message_start" && chunk.message?.usage) {
            inputTokens = chunk.message.usage.input_tokens;
          }
          if (chunk.type === "message_delta" && chunk.usage?.output_tokens) {
            outputTokens = chunk.usage.output_tokens;
          }
        }
      }
    }

    // 3. Commit actual usage
    const actualCost = Math.ceil(inputTokens * 300 + outputTokens * 1500);
    await handle.commit(actualCost, {
      tokensInput: inputTokens,
      tokensOutput: outputTokens,
      modelVersion: MODEL_ID,
    });
  } catch (err) {
    await handle.release("stream_error");
    throw err;
  }
}
```

## Bedrock token usage extraction

Bedrock streams usage metadata in specific event types:

- **`message_start`** — contains `message.usage.input_tokens`
- **`message_delta`** — contains `usage.output_tokens`

Track both to calculate accurate actual cost for the commit.

## Next steps

- [Handling Streaming Responses](/how-to/handling-streaming-responses-with-cycles) — streaming patterns in detail
- [Cost Estimation Cheat Sheet](/how-to/cost-estimation-cheat-sheet) — pricing reference for estimation
- [Error Handling in TypeScript](/how-to/error-handling-patterns-in-typescript) — handling budget errors
- [AWS Bedrock example (TypeScript)](https://github.com/runcycles/cycles-client-typescript/tree/main/examples/aws-bedrock) — runnable AWS Bedrock integration
