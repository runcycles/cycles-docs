---
title: "Error Handling Patterns in TypeScript"
description: "Practical patterns for handling Cycles errors in TypeScript with withCycles, reserveForStream, and the programmatic CyclesClient."
---

# Error Handling Patterns in TypeScript

This guide covers practical patterns for handling Cycles errors in TypeScript applications — with `withCycles`, `reserveForStream`, and the programmatic `CyclesClient`.

::: tip Also available
See [Error Handling in Python](/how-to/error-handling-patterns-in-python) or [Rust](/how-to/error-handling-patterns-in-rust) for equivalent patterns, or the [general Error Handling Patterns](/how-to/error-handling-patterns-in-cycles-client-code) for language-agnostic concepts.
:::

## Exception hierarchy

The `runcycles` package provides a typed exception hierarchy:

```
CyclesError (base)
├── CyclesProtocolError (server returned a protocol-level error)
│   ├── BudgetExceededError
│   ├── OverdraftLimitExceededError
│   ├── DebtOutstandingError
│   ├── ReservationExpiredError
│   └── ReservationFinalizedError
└── CyclesTransportError (exported for user code; not thrown by the SDK)
```

## CyclesProtocolError

When `withCycles` or `reserveForStream` encounters a DENY decision or a protocol error, it throws `CyclesProtocolError` (or a specific subclass):

```typescript
import { CyclesProtocolError } from "runcycles";

// Available properties:
e.status;          // HTTP status code (e.g. 409)
e.errorCode;       // Machine-readable error code (e.g. "BUDGET_EXCEEDED")
e.reasonCode;      // Reason code string
e.retryAfterMs;    // Suggested retry delay in ms (or undefined)
e.requestId;       // Server request ID
e.details;         // Additional error details (Record<string, unknown>)

// Convenience checks:
e.isBudgetExceeded();
e.isOverdraftLimitExceeded();
e.isDebtOutstanding();
e.isReservationExpired();
e.isReservationFinalized();
e.isIdempotencyMismatch();
e.isUnitMismatch();
e.isRetryable();           // true for INTERNAL_ERROR, UNKNOWN, or 5xx status
```

## Transport failures (status -1)

Transport failures (DNS failure, timeout, connection refused) do not surface as a distinct exception class. The SDK never throws `CyclesTransportError` itself — the class is exported for use in your own code. Instead:

- **`withCycles` / `reserveForStream`** throw `CyclesProtocolError` with `status === -1` and `errorCode` `undefined`.
- **Programmatic `CyclesClient` calls** never throw on transport failure — they return a `CyclesResponse` with `isTransportError` set and `status` of `-1`.

Detect transport failures by checking the status:

```typescript
import { CyclesProtocolError } from "runcycles";

try {
  result = await guardedFunc();
} catch (err) {
  if (err instanceof CyclesProtocolError && err.status === -1) {
    // Network-level failure — the server was never reached
    console.error(`Transport error: ${err.message}`);
  }
}
```

For the programmatic client:

```typescript
const response = await client.createReservation(body);
if (response.isTransportError) {
  console.error(`Transport error: ${response.errorMessage}`);
  console.error(`Cause: ${response.transportError}`);
}
```

## Catching errors from withCycles

`withCycles` wraps a function with the full reserve → execute → commit lifecycle. If the reservation is denied, it throws before your function runs:

In `runcycles` 0.4.2+, known actual usage is journaled before the first commit request. Ambiguous settlement, authentication failure, and retry exhaustion retain the same-key record for replay; an expired commit switches to a durable `/v1/events` fallback. These commit-time recovery paths are reported operationally rather than converted into a second execution of the guarded function.

```typescript
import { withCycles, BudgetExceededError, CyclesProtocolError } from "runcycles";

const summarize = withCycles(
  { estimate: 1000, actionKind: "llm.completion", actionName: "gpt-4o", client },
  async (text: string) => callLlm(text),
);

try {
  const result = await summarize(text);
} catch (err) {
  if (err instanceof BudgetExceededError) {
    // Budget exhausted — degrade or queue
    return fallbackSummary(text);
  } else if (err instanceof CyclesProtocolError) {
    // Other protocol error
    if (err.retryAfterMs) {
      scheduleRetry(text, err.retryAfterMs);
      return `Request queued. Retrying in ${err.retryAfterMs}ms.`;
    }
    throw err;
  } else {
    throw err;
  }
}
```

## Catching errors from reserveForStream

`reserveForStream` throws on reservation failure. After a successful reservation, you must handle errors from the stream itself and release the handle:

```typescript
import { reserveForStream, BudgetExceededError } from "runcycles";

let handle;
try {
  handle = await reserveForStream({
    client,
    estimate: estimatedCost,
    actionKind: "llm.completion",
    actionName: "gpt-4o",
  });
} catch (err) {
  if (err instanceof BudgetExceededError) {
    console.error("Budget exhausted:", err.message);
    return;
  }
  throw err;
}

// Stream with cleanup on failure
try {
  const stream = await openai.chat.completions.create({ model: "gpt-4o", messages, stream: true });
  // ... process stream ...
  await handle.commit(actualCost, metrics);
} catch (err) {
  await handle.release("stream_error");
  throw err;
}
```

## Express middleware error handling

Register a global error handler that catches Cycles errors and returns appropriate HTTP responses:

```typescript
import type { Request, Response, NextFunction } from "express";
import { CyclesProtocolError, BudgetExceededError } from "runcycles";

function cyclesErrorHandler(err: Error, req: Request, res: Response, next: NextFunction) {
  if (!(err instanceof CyclesProtocolError)) {
    return next(err);
  }

  if (err.isBudgetExceeded()) {
    const retryAfter = err.retryAfterMs ? Math.ceil(err.retryAfterMs / 1000) : 60;
    return res.status(429)
      .set("Retry-After", String(retryAfter))
      .json({ error: "budget_exceeded", message: "Budget limit reached." });
  }

  if (err.isDebtOutstanding() || err.isOverdraftLimitExceeded()) {
    return res.status(503)
      .json({ error: "service_unavailable", message: "Service paused due to budget constraints." });
  }

  return res.status(500)
    .json({ error: "internal_error", message: "An unexpected error occurred." });
}

// Register after all routes:
app.use(cyclesErrorHandler);
```

For per-route handling with the `cyclesGuard` middleware pattern, see the [Express Middleware example](https://github.com/runcycles/cycles-client-typescript/tree/main/examples/express-middleware).

## Next.js API route error handling

In Next.js App Router routes, catch errors and return appropriate responses:

```typescript
import { BudgetExceededError, CyclesProtocolError } from "runcycles";

export async function POST(req: Request) {
  try {
    const result = await handleChat(req);
    return new Response(JSON.stringify(result), {
      headers: { "Content-Type": "application/json" },
    });
  } catch (err) {
    if (err instanceof BudgetExceededError) {
      return new Response(
        JSON.stringify({ error: "budget_exceeded", message: "Budget limit reached." }),
        { status: 402, headers: { "Content-Type": "application/json" } },
      );
    }
    if (err instanceof CyclesProtocolError && err.isDebtOutstanding()) {
      return new Response(
        JSON.stringify({ error: "service_unavailable", message: "Service paused." }),
        { status: 503, headers: { "Content-Type": "application/json" } },
      );
    }
    throw err;
  }
}
```

## Graceful degradation with caps

When the budget system returns `ALLOW_WITH_CAPS`, the decision includes caps that constrain execution. Use these to fall back to cheaper models or limit output:

```typescript
import { withCycles, getCyclesContext, isToolAllowed } from "runcycles";

const callLlm = withCycles(
  { estimate: (prompt: string) => estimateCost(prompt), client, actionKind: "llm.completion", actionName: "gpt-4o" },
  async (prompt: string) => {
    const ctx = getCyclesContext();

    // Respect max tokens cap
    let maxTokens = 4096;
    if (ctx?.caps?.maxTokens) {
      maxTokens = Math.min(maxTokens, ctx.caps.maxTokens);
    }

    // Check tool allowlist
    const tools = allTools.filter((t) => {
      if (!ctx?.caps) return true;
      return isToolAllowed(ctx.caps, t.name);
    });

    return openai.chat.completions.create({
      model: "gpt-4o",
      max_tokens: maxTokens,
      messages: [{ role: "user", content: prompt }],
      tools,
    });
  },
);
```

## Retry-after with exponential backoff

When a protocol error includes `retryAfterMs`, use it as the minimum delay before retrying:

```typescript
import { CyclesProtocolError } from "runcycles";

async function withRetry<T>(fn: () => Promise<T>, maxAttempts = 3): Promise<T> {
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (err) {
      if (err instanceof CyclesProtocolError && err.isRetryable() && attempt < maxAttempts) {
        const baseDelay = err.retryAfterMs ?? 1000 * Math.pow(2, attempt - 1);
        await new Promise((resolve) => setTimeout(resolve, baseDelay));
        continue;
      }
      throw err;
    }
  }
  throw new Error("Unreachable");
}
```

## Distinguishing retryable vs non-retryable errors

Use `isRetryable()` to check whether an error warrants a retry:

```typescript
import { CyclesProtocolError } from "runcycles";

try {
  result = await guardedFunc();
} catch (err) {
  if (err instanceof CyclesProtocolError) {
    if (err.isRetryable()) {
      // INTERNAL_ERROR, UNKNOWN, or 5xx — safe to retry with backoff
      return retryLater(err.retryAfterMs);
    }
    if (err.isBudgetExceeded()) {
      // Budget may free up — retry with backoff or degrade
      return fallback();
    }
    // RESERVATION_EXPIRED, IDEMPOTENCY_MISMATCH, etc. — do not retry
    throw err;
  }
  throw err;
}
```

## Next steps

- [Error Handling Patterns](/how-to/error-handling-patterns-in-cycles-client-code) — general error handling patterns across all languages
- [Error Codes and Error Handling](/protocol/error-codes-and-error-handling-in-cycles) — protocol error code reference
- [Degradation Paths](/how-to/how-to-think-about-degradation-paths-in-cycles-deny-downgrade-disable-or-defer) — strategies for handling budget constraints
- [Getting Started with the TypeScript Client](/quickstart/getting-started-with-the-typescript-client) — TypeScript client setup
- [Testing with Cycles](/how-to/testing-with-cycles) — testing patterns for Cycles-governed code
- [SDK Settlement Recovery and Durability](/protocol/sdk-settlement-recovery-and-durability) — durable replay, expiry fallback, and guarantee boundary
