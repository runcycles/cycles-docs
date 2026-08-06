---
title: "Integrating Cycles with LangChain.js"
description: "Use withCycles for LangChain.js calls and reserveForStream for streaming or multi-step agents."
---

# Integrating Cycles with LangChain.js

Use the TypeScript SDK's lifecycle helpers instead of a raw LangChain callback:

| Workload | Helper |
|---|---|
| One chain/model invocation with a final result | `withCycles` |
| Streaming response or multi-step agent run | `reserveForStream` |

Both paths reserve before execution. Lifecycle-managed commits use the SDK's
durable journal; `reserveForStream` also heartbeats the lease while the run is
active. Version 0.4.3 also prevents broad error cleanup from releasing known
spend after a terminal commit rejection.

## Install

```bash
npm install runcycles@^0.4.3 @langchain/openai @langchain/core
```

## Guard a chain with `withCycles`

```typescript
import { ChatOpenAI } from "@langchain/openai";
import { ChatPromptTemplate } from "@langchain/core/prompts";
import type { AIMessage } from "@langchain/core/messages";
import { BudgetExceededError, CyclesClient, CyclesConfig, withCycles } from "runcycles";

const client = new CyclesClient(CyclesConfig.fromEnv());
const model = new ChatOpenAI({ model: "gpt-4o" });
const prompt = ChatPromptTemplate.fromMessages([["user", "{question}"]]);
const chain = prompt.pipe(model);

function calculatedCost(message: AIMessage): number {
  const usage = message.usage_metadata;
  if (!usage) throw new Error("LangChain returned no normalized usage_metadata");
  const cached = usage.input_token_details?.cache_read ?? 0;
  const ordinaryInput = Math.max(0, usage.input_tokens - cached);
  return ordinaryInput * 250 + cached * 125 + usage.output_tokens * 1_000;
}

const ask = withCycles(
  {
    client,
    actionKind: "llm.completion",
    actionName: "gpt-4o",
    estimate: 2_000_000,
    actual: calculatedCost,
  },
  async (question: string) => chain.invoke({ question }),
);

try {
  const answer = await ask("What is runtime authority?");
  console.log(answer.content);
} catch (error) {
  if (error instanceof BudgetExceededError) {
    console.error("Denied before the model call");
  } else {
    throw error;
  }
}
```

The rates above are caller-supplied examples, not live pricing. Verify the exact
model and cache rate you deploy.

## Streaming and multi-step agents

```typescript
import { HumanMessage } from "@langchain/core/messages";
import { reserveForStream } from "runcycles";

const streamEstimate = 4_000_000;
const handle = await reserveForStream({
  client,
  estimate: streamEstimate,
  unit: "USD_MICROCENTS",
  actionKind: "agent.run",
  actionName: "support-agent",
});

let dispatchAttempted = false;
try {
  // From this point onward the provider may incur partial usage even if the
  // stream throws before returning a final normalized usage object.
  dispatchAttempted = true;
  const stream = await model.stream([new HumanMessage("Draft a reply.")]);
  let finalUsage;
  for await (const chunk of stream) {
    process.stdout.write(typeof chunk.content === "string" ? chunk.content : "");
    if (chunk.usage_metadata) finalUsage = chunk.usage_metadata;
  }
  if (!finalUsage) throw new Error("No finalized normalized usage_metadata");

  const cached = finalUsage.input_token_details?.cache_read ?? 0;
  const actual = Math.max(0, finalUsage.input_tokens - cached) * 250
    + cached * 125
    + finalUsage.output_tokens * 1_000;
  await handle.commit(actual, {
    tokensInput: finalUsage.input_tokens,
    tokensOutput: finalUsage.output_tokens,
  });
} catch (error) {
  if (!handle.finalized) {
    if (dispatchAttempted) {
      // No final usage may exist for an interrupted stream. Conservatively
      // settle the estimate and mark it rather than returning budget for
      // possible partial provider spend.
      try {
        await handle.commit(streamEstimate, undefined, { actual_source: "estimate" });
      } catch (settlementError) {
        console.error("Cycles settlement failed after stream error", settlementError);
      }
    } else {
      await handle.release("stream_startup_failed");
    }
  }
  throw error;
}
```

For a multi-step agent, accumulate normalized usage across its finalized model
messages, apply `handle.caps` before execution, then commit the aggregate once.
See the runnable
[`examples/langchain-js`](https://github.com/runcycles/cycles-client-typescript/tree/main/examples/langchain-js)
project.

## Denial and failure semantics

- Lifecycle helpers throw `BudgetExceededError` before LangChain runs.
- At the raw reserve endpoint, budget denial is HTTP 409
  `BUDGET_EXCEEDED`—not a 2xx `decision: "DENY"` response.
- A pre-dispatch handler error releases. After provider dispatch, interrupted
  streams conservatively commit the estimate when final usage is unavailable.
- Once actual spend is known, commit recovery is journaled and uses the same
  idempotency key. A recognized terminal commit rejection is surfaced with the
  handle finalized; never release known spend from a broad catch.
- A Cycles key deduplicates accounting only. Keep tool side effects separately
  idempotent.

## Why not the old callback recipe?

A simple `handleLLMStart`/`handleLLMEnd` map does not automatically heartbeat a
long call or durably persist a pending commit before process exit. It can also
read provider-specific `llmOutput.tokenUsage` while claiming provider-neutral
behavior. Use the SDK helpers above unless you implement equivalent lease and
recovery choreography yourself.

## Next steps

- [TypeScript error handling](/how-to/error-handling-patterns-in-typescript)
- [Handling streaming responses](/how-to/handling-streaming-responses-with-cycles)
- [Cost estimation cheat sheet](/how-to/cost-estimation-cheat-sheet)
