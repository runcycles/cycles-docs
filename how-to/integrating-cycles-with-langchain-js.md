---
title: "Integrating Cycles with LangChain.js"
description: "Add budget governance to LangChain.js applications using a custom callback handler that wraps every LLM call with a Cycles reservation."
---

# Integrating Cycles with LangChain.js

This guide shows how to add budget governance to LangChain.js applications using a custom callback handler that wraps every LLM call with a Cycles reservation.

## Prerequisites

```bash
npm install runcycles @langchain/core @langchain/openai
```

```bash
export CYCLES_BASE_URL="http://localhost:7878"
export CYCLES_API_KEY="cyc_live_..."
export CYCLES_TENANT="acme"
export OPENAI_API_KEY="sk-..."
```

## The callback handler approach

LangChain.js fires callback events on every LLM call. A custom `BaseCallbackHandler` can hook into `handleLLMStart` and `handleLLMEnd` to create and commit Cycles reservations:

```typescript
import { BaseCallbackHandler } from "@langchain/core/callbacks/base";
import { Serialized } from "@langchain/core/load/serializable";
import { LLMResult } from "@langchain/core/outputs";
import {
  BudgetExceededError,
  CyclesClient,
} from "runcycles";

interface CyclesBudgetHandlerOptions {
  client: CyclesClient;
  subject: { tenant: string; workflow?: string; agent?: string; toolset?: string };
  estimateAmount?: number;
  actionKind?: string;
  actionName?: string;
}

export class CyclesBudgetHandler extends BaseCallbackHandler {
  name = "CyclesBudgetHandler";

  private client: CyclesClient;
  private subject: CyclesBudgetHandlerOptions["subject"];
  private estimateAmount: number;
  private actionKind: string;
  private actionName: string;
  private reservations = new Map<string, string>();
  private keys = new Map<string, string>();

  constructor(options: CyclesBudgetHandlerOptions) {
    super();
    this.client = options.client;
    this.subject = options.subject;
    this.estimateAmount = options.estimateAmount ?? 2_000_000;
    this.actionKind = options.actionKind ?? "llm.completion";
    this.actionName = options.actionName ?? "gpt-4o";
  }

  async handleLLMStart(
    _serialized: Serialized,
    _prompts: string[],
    runId: string,
  ): Promise<void> {
    const key = crypto.randomUUID();
    this.keys.set(runId, key);

    const res = await this.client.createReservation({
      idempotency_key: key,
      subject: this.subject,
      action: { kind: this.actionKind, name: this.actionName },
      estimate: { unit: "USD_MICROCENTS", amount: this.estimateAmount },
      ttl_ms: 60_000,
    });

    if (!res.isSuccess) {
      throw new Error(res.errorMessage ?? "Reservation failed");
    }

    // A DENY comes back as HTTP 2xx with decision: "DENY" and no
    // reservation_id — isSuccess alone does not enforce the budget.
    if (res.getBodyAttribute("decision") === "DENY") {
      throw new BudgetExceededError("Budget denied for LLM call", {
        status: res.status,
        reasonCode: res.getBodyAttribute("reason_code") as string | undefined,
      });
    }

    this.reservations.set(runId, res.getBodyAttribute("reservation_id") as string);
  }

  async handleLLMEnd(output: LLMResult, runId: string): Promise<void> {
    const rid = this.reservations.get(runId);
    const key = this.keys.get(runId);
    this.reservations.delete(runId);
    this.keys.delete(runId);
    if (!rid || !key) return;

    const usage = output.llmOutput?.tokenUsage ?? {};
    const inputTokens = usage.promptTokens ?? 0;
    const outputTokens = usage.completionTokens ?? 0;

    await this.client.commitReservation(rid, {
      idempotency_key: `commit-${key}`,
      actual: {
        unit: "USD_MICROCENTS",
        amount: inputTokens * 250 + outputTokens * 1_000,
      },
      metrics: {
        tokens_input: inputTokens,
        tokens_output: outputTokens,
      },
    });
  }

  async handleLLMError(error: Error, runId: string): Promise<void> {
    const rid = this.reservations.get(runId);
    const key = this.keys.get(runId);
    this.reservations.delete(runId);
    this.keys.delete(runId);
    if (rid && key) {
      await this.client.releaseReservation(rid, {
        idempotency_key: `release-${key}`,
      });
    }
  }
}
```

Note that the programmatic client returns responses instead of throwing typed errors, so the handler throws `BudgetExceededError` itself when the decision is `DENY` — that is what makes the `catch` blocks below work. Alternatively, wrap the whole chain in `withCycles`, which throws `BudgetExceededError` natively on a denial, as in the SDK's [langchain-js example](https://github.com/runcycles/cycles-client-typescript/blob/main/examples/langchain-js/src/chain.ts).

## Using the handler

### With a chat model

```typescript
import { ChatOpenAI } from "@langchain/openai";
import { HumanMessage } from "@langchain/core/messages";
import { CyclesClient, CyclesConfig, BudgetExceededError } from "runcycles";

const client = new CyclesClient(CyclesConfig.fromEnv());
const handler = new CyclesBudgetHandler({
  client,
  subject: { tenant: "acme", agent: "my-agent" },
});

const llm = new ChatOpenAI({ model: "gpt-4o", callbacks: [handler] });

try {
  const result = await llm.invoke([new HumanMessage("Hello!")]);
  console.log(result.content);
} catch (err) {
  if (err instanceof BudgetExceededError) {
    console.log("Budget exhausted.");
  } else {
    throw err;
  }
}
```

### With an agent and tools

Every LLM call the agent makes (including tool-calling turns) gets its own reservation:

```typescript
import { tool } from "@langchain/core/tools";
import { z } from "zod";

const getWeather = tool(
  async ({ location }: { location: string }) => `72°F in ${location}`,
  {
    name: "get_weather",
    description: "Get weather for a location.",
    schema: z.object({ location: z.string() }),
  },
);

const handler = new CyclesBudgetHandler({
  client,
  subject: { tenant: "acme", agent: "tool-agent", toolset: "weather" },
});

const llm = new ChatOpenAI({ model: "gpt-4o", callbacks: [handler] });
const llmWithTools = llm.bindTools([getWeather]);

try {
  const result = await llmWithTools.invoke([
    new HumanMessage("What's the weather in NYC?"),
  ]);
  console.log(result.content);
} catch (err) {
  if (err instanceof BudgetExceededError) {
    console.log("Agent stopped — budget exhausted.");
  } else {
    throw err;
  }
}
```

## How it works

| Event | Action |
|-------|--------|
| `handleLLMStart` | Create a reservation with the estimated cost |
| `handleLLMEnd` | Commit the actual cost from token usage |
| `handleLLMError` | Release the reservation to free held budget |

The handler tracks active reservations by LangChain's `runId`, so concurrent calls are handled correctly.

## Streaming with LangChain.js

For streaming responses, use `reserveForStream` instead of the callback handler. This keeps the reservation alive with an automatic heartbeat while tokens are being streamed:

```typescript
import { ChatOpenAI } from "@langchain/openai";
import { HumanMessage } from "@langchain/core/messages";
import {
  CyclesClient,
  CyclesConfig,
  reserveForStream,
  BudgetExceededError,
} from "runcycles";

const client = new CyclesClient(CyclesConfig.fromEnv());

const handle = await reserveForStream({
  client,
  estimate: 2_000_000,
  unit: "USD_MICROCENTS",
  actionKind: "llm.completion",
  actionName: "gpt-4o",
});

const llm = new ChatOpenAI({ model: "gpt-4o" });

try {
  const stream = await llm.stream([new HumanMessage("Write a short poem.")]);
  let fullText = "";

  for await (const chunk of stream) {
    const content = typeof chunk.content === "string" ? chunk.content : "";
    process.stdout.write(content);
    fullText += content;
  }

  // Estimate actual cost from output length (1 token ~ 4 chars)
  const estimatedOutputTokens = Math.ceil(fullText.length / 4);
  const actualCost = Math.ceil(500 * 250 + estimatedOutputTokens * 1_000);

  await handle.commit(actualCost, {
    tokensOutput: estimatedOutputTokens,
  });
} catch (err) {
  await handle.release("stream_error");
  throw err;
}
```

## Per-agent budgets

Use Cycles' subject hierarchy to give each agent its own budget scope:

```typescript
// Planning agent with its own budget
const plannerHandler = new CyclesBudgetHandler({
  client,
  subject: { tenant: "acme", workflow: "support", agent: "planner" },
});

// Executor agent with a separate budget
const executorHandler = new CyclesBudgetHandler({
  client,
  subject: { tenant: "acme", workflow: "support", agent: "executor" },
});

const planner = new ChatOpenAI({ model: "gpt-4o", callbacks: [plannerHandler] });
const executor = new ChatOpenAI({ model: "gpt-4o", callbacks: [executorHandler] });
```

Each agent draws from its own budget allocation. If the executor exhausts its budget, the planner can still operate independently.

## Key points

- **One reservation per LLM call.** The callback creates a reservation on every `handleLLMStart` and commits on `handleLLMEnd`.
- **Agents are automatically covered.** Multi-turn agents that call the LLM repeatedly get budget-checked on every turn.
- **Errors release budget.** If the LLM call fails, the reservation is released immediately.
- **Concurrent-safe.** Reservations are tracked by `runId`, supporting concurrent LLM calls.
- **Streaming uses a different pattern.** Use `reserveForStream` with its automatic heartbeat instead of the callback handler.
- **Works with any LangChain.js model.** Attach the handler to `ChatOpenAI`, `ChatAnthropic`, or any other model via `callbacks: [handler]`.

## Next steps

- [Integrating Cycles with LangChain (Python)](/how-to/integrating-cycles-with-langchain) — the Python version of this guide
- [Handling Streaming Responses](/how-to/handling-streaming-responses-with-cycles) — streaming patterns in detail
- [Cost Estimation Cheat Sheet](/how-to/cost-estimation-cheat-sheet) — how much to reserve per model
- [Error Handling Patterns in TypeScript](/how-to/error-handling-patterns-in-typescript) — handling Cycles errors in TypeScript
- [LangChain.js example](https://github.com/runcycles/cycles-client-typescript/tree/main/examples/langchain-js) — runnable LangChain.js integration
