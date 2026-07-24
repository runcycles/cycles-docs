---
title: "Integrating Cycles with the Vercel AI SDK"
description: "Add budget governance to a Next.js app using the Vercel AI SDK with the reserveForStream pattern for streaming LLM responses."
---

# Integrating Cycles with the Vercel AI SDK

This guide shows how to add budget governance to a Next.js application using the [Vercel AI SDK](https://ai-sdk.dev/) and the `runcycles` TypeScript client.

The Vercel AI SDK uses streaming by default, so this guide uses the `reserveForStream` pattern — reserving budget before the stream starts, keeping the reservation alive during streaming, and committing actual usage when the stream finishes.

## Prerequisites

- A running Cycles stack with a tenant, API key, and budget ([Deploy the Full Stack](/quickstart/deploying-the-full-cycles-stack))
- A Next.js project with the Vercel AI SDK installed
- Node.js 20+

## Installation

```bash
npm install runcycles ai@^4 @ai-sdk/openai@^1
```

This guide targets AI SDK v4 (the major pinned by the SDK's [example project](https://github.com/runcycles/cycles-client-typescript/tree/main/examples/vercel-ai-sdk); note the example's route code is currently being aligned to the same v4 surface). AI SDK 5 renames several of these APIs (`usage.inputTokens`/`outputTokens`, `toUIMessageStreamResponse()`, `maxOutputTokens`, `useChat` from `@ai-sdk/react`) — adjust accordingly if you are on v5.

## Environment variables

```bash
CYCLES_BASE_URL=http://localhost:7878
CYCLES_API_KEY=cyc_live_...
CYCLES_TENANT=acme-corp
OPENAI_API_KEY=sk-...
```

::: tip 60-Second Quick Start
```typescript
import { streamText } from "ai";
import { openai } from "@ai-sdk/openai";
import { CyclesClient, CyclesConfig, reserveForStream } from "runcycles";

const cycles = new CyclesClient(CyclesConfig.fromEnv());
const handle = await reserveForStream({
  client: cycles, estimate: 2_000_000, unit: "USD_MICROCENTS",
  actionKind: "llm.completion", actionName: "gpt-4o",
});

const result = streamText({
  model: openai("gpt-4o"),
  prompt: "What is budget authority?",
  onFinish: async ({ usage }) => {
    await handle.commit((usage.promptTokens ?? 0) * 250 + (usage.completionTokens ?? 0) * 1000);
  },
});
```
Budget is reserved before the stream starts and committed when it finishes. Read on for the full Next.js API route pattern with error handling.
:::

## API route with budget governance

Create an API route that reserves budget before streaming and commits actual usage after:

```typescript
// app/api/chat/route.ts
import { streamText, type Message, convertToCoreMessages } from "ai";
import { openai } from "@ai-sdk/openai";
import {
  CyclesClient,
  CyclesConfig,
  reserveForStream,
  BudgetExceededError,
} from "runcycles";

export const runtime = "nodejs"; // Required for AsyncLocalStorage

const cyclesClient = new CyclesClient(CyclesConfig.fromEnv());

export async function POST(req: Request) {
  const { messages }: { messages: Message[] } = await req.json();

  // Estimate cost from message content (1 token ~ 4 chars).
  // GPT-4o: input $2.50/1M tokens (250 microcents/token),
  //         output $10/1M tokens (1000 microcents/token).
  const estimatedInputTokens = messages.reduce(
    (sum, m) => sum + (typeof m.content === "string" ? m.content.length : 0) / 4,
    0,
  );
  const estimatedCost = Math.ceil(
    estimatedInputTokens * 250 + estimatedInputTokens * 2 * 1000,
  );

  // 1. Reserve budget
  let handle;
  try {
    handle = await reserveForStream({
      client: cyclesClient,
      estimate: estimatedCost,
      unit: "USD_MICROCENTS",
      actionKind: "llm.completion",
      actionName: "gpt-4o",
    });
  } catch (err) {
    if (err instanceof BudgetExceededError) {
      return new Response(
        JSON.stringify({
          error: "budget_exceeded",
          message: "Budget exhausted. Contact your administrator.",
        }),
        { status: 402, headers: { "Content-Type": "application/json" } },
      );
    }
    throw err;
  }

  // 2. Stream with budget tracking
  try {
    const result = streamText({
      model: openai("gpt-4o"),
      messages: convertToCoreMessages(messages),
      onFinish: async ({ usage }) => {
        const actualCost = Math.ceil(
          (usage.promptTokens ?? 0) * 250 +
          (usage.completionTokens ?? 0) * 1000,
        );
        await handle.commit(actualCost, {
          tokensInput: usage.promptTokens,
          tokensOutput: usage.completionTokens,
        });
      },
    });

    return result.toDataStreamResponse();
  } catch (err) {
    await handle.release("stream_error");
    throw err;
  }
}
```

## How it works

1. **Before streaming:** `reserveForStream` creates a reservation and starts an automatic heartbeat to keep it alive during the stream.
2. **During streaming:** The Vercel AI SDK streams tokens to the client. The heartbeat extends the reservation TTL automatically.
3. **After streaming:** The `onFinish` callback calculates actual cost from token usage and calls `handle.commit()`. The heartbeat stops automatically.
4. **On error:** The `catch` block calls `handle.release()` to return the reserved budget to the pool.

## Respecting budget caps

When the deepest matching budget has `max_tokens` configured, Cycles can return `ALLOW_WITH_CAPS`. This is not an automatic low-balance transition. Respect the returned value by capping the model's output:

```typescript
let handle = await reserveForStream({ ... });

// Use caps-aware max_tokens
let maxTokens = 4096;
if (handle.caps?.maxTokens) {
  maxTokens = Math.min(maxTokens, handle.caps.maxTokens);
}

const result = streamText({
  model: openai("gpt-4o"),
  maxTokens,
  messages: convertToCoreMessages(messages),
  onFinish: async ({ usage }) => { ... },
});
```

## Client-side error handling

Handle the 402 response in your React component:

```typescript
// components/chat.tsx
import { useChat } from "ai/react";

export function Chat() {
  const { messages, input, handleInputChange, handleSubmit, error } = useChat();

  if (error?.message?.includes("budget_exceeded")) {
    return <div>Your budget has been exhausted. Please contact support.</div>;
  }

  return (
    <form onSubmit={handleSubmit}>
      {messages.map((m) => (
        <div key={m.id}>{m.content}</div>
      ))}
      <input value={input} onChange={handleInputChange} />
    </form>
  );
}
```

## Next steps

- [Integrating with Next.js](/how-to/integrating-cycles-with-nextjs) — middleware, server actions, per-tenant isolation
- [Handling Streaming Responses](/how-to/handling-streaming-responses-with-cycles) — streaming patterns in detail
- [Cost Estimation Cheat Sheet](/how-to/cost-estimation-cheat-sheet) — how much to reserve per model
- [Choosing the Right Integration Pattern](/how-to/choosing-the-right-integration-pattern) — when to use `withCycles` vs `reserveForStream`
- [Vercel AI SDK example](https://github.com/runcycles/cycles-client-typescript/tree/main/examples/vercel-ai-sdk) — runnable Vercel AI SDK integration
