---
title: "Integrating Cycles with Express"
description: "Add budget governance to an Express.js application using reusable middleware and inline reserve-commit patterns with the Cycles TypeScript client."
---

# Integrating Cycles with Express

This guide shows how to add budget governance to an Express.js application using reusable middleware.

## Prerequisites

- A running Cycles stack with a tenant, API key, and budget ([Deploy the Full Stack](/quickstart/deploying-the-full-cycles-stack))
- Node.js 20+

## Installation

```bash
npm install runcycles express
```

## Pattern overview

Two patterns work well with Express:

1. **Middleware pattern** — for routes where every request needs budget governance (e.g., chat endpoints). The middleware reserves budget and attaches a handle to `res.locals`.
2. **Inline pattern** — for routes where budget governance is conditional or has custom logic. Use `withCycles` directly in the route handler.

## Middleware pattern

Create a reusable middleware that reserves budget for each request:

```typescript
// middleware/cycles-guard.ts
import type { Request, Response, NextFunction } from "express";
import {
  CyclesClient,
  reserveForStream,
  BudgetExceededError,
} from "runcycles";

interface CyclesGuardOptions {
  client: CyclesClient;
  actionKind: string;
  actionName: string;
  estimateFn: (req: Request) => number;
  unit?: string;
  tenantFn?: (req: Request) => string;
}

export function cyclesGuard(options: CyclesGuardOptions) {
  return async (req: Request, res: Response, next: NextFunction) => {
    const estimate = options.estimateFn(req);

    try {
      const handle = await reserveForStream({
        client: options.client,
        estimate,
        unit: options.unit ?? "USD_MICROCENTS",
        actionKind: options.actionKind,
        actionName: options.actionName,
        ...(options.tenantFn && { tenant: options.tenantFn(req) }),
      });

      // Attach the handle so route handlers can commit/release
      res.locals.cyclesHandle = handle;

      // Release budget if the client disconnects.
      // handle.finalized is true once commit() or release() has run,
      // so no manual bookkeeping flag is needed.
      res.on("close", async () => {
        if (!handle.finalized) {
          await handle.release("client_disconnect");
        }
      });

      next();
    } catch (err) {
      if (err instanceof BudgetExceededError) {
        res.status(402).json({
          error: "budget_exceeded",
          message: "Budget exhausted for this operation.",
        });
        return;
      }
      next(err);
    }
  };
}
```

Use the middleware on a route:

```typescript
// server.ts
import express from "express";
import { CyclesClient, CyclesConfig } from "runcycles";
import { cyclesGuard } from "./middleware/cycles-guard.js";

const app = express();
app.use(express.json());

const cyclesClient = new CyclesClient(CyclesConfig.fromEnv());

// Protect the chat route with budget governance
app.post(
  "/api/chat",
  cyclesGuard({
    client: cyclesClient,
    actionKind: "llm.completion",
    actionName: "gpt-4o",
    estimateFn: (req) => {
      const messages = req.body?.messages ?? [];
      const chars = messages.reduce(
        (sum: number, m: { content?: string }) =>
          sum + (typeof m.content === "string" ? m.content.length : 0),
        0,
      );
      const inputTokens = Math.ceil(chars / 4);
      return Math.ceil(inputTokens * 250 + inputTokens * 2 * 1000);
    },
  }),
  async (req, res) => {
    const handle = res.locals.cyclesHandle;

    try {
      // Your LLM call here
      const response = await callOpenAI(req.body.messages);

      // Commit actual cost
      const actualCost = calculateActualCost(response.usage);
      await handle.commit(actualCost, {
        tokensInput: response.usage.prompt_tokens,
        tokensOutput: response.usage.completion_tokens,
      });

      res.json({ message: response.content });
    } catch (err) {
      await handle.release("handler_error");
      throw err;
    }
  },
);

app.listen(3000);
```

Note: `throw err` inside an async route handler only reaches Express's error handling on Express 5 — on Express 4, call `next(err)` instead.

## Inline pattern with withCycles

For simpler routes, use `withCycles` directly:

```typescript
import {
  withCycles, CyclesClient, CyclesConfig, setDefaultClient, BudgetExceededError,
} from "runcycles";

const cyclesClient = new CyclesClient(CyclesConfig.fromEnv());
setDefaultClient(cyclesClient);

const summarize = withCycles(
  { estimate: 3000000, actionKind: "llm.completion", actionName: "gpt-4o-mini" },
  async (text: string) => {
    return await callOpenAI([{ role: "user", content: `Summarize: ${text}` }]);
  },
);

app.post("/api/summarize", async (req, res) => {
  try {
    const result = await summarize(req.body.text);
    res.json({ summary: result });
  } catch (err) {
    if (err instanceof BudgetExceededError) {
      res.status(402).json({ error: "budget_exceeded" });
      return;
    }
    throw err;
  }
});
```

## Budget observability endpoint

Add an endpoint to check current budget status:

```typescript
app.get("/api/balance", async (_req, res) => {
  const balances = await cyclesClient.getBalances({
    tenant: cyclesClient.config.tenant!,
  });
  res.json(balances.body);
});
```

## Per-tenant middleware

For multi-tenant applications, resolve the tenant from the request:

```typescript
app.post(
  "/api/chat",
  cyclesGuard({
    client: cyclesClient,
    actionKind: "llm.completion",
    actionName: "gpt-4o",
    estimateFn: (req) => Math.ceil(req.body.text.length / 4 * 1250),
    // Tenant resolved per-request from auth middleware
    tenantFn: (req) => req.auth.tenantId,
  }),
  chatHandler,
);
```

## Streaming responses

For SSE or streaming endpoints, use the programmatic `CyclesClient` with `reserveForStream` instead of the middleware pattern. The middleware commits when the response finishes, but streaming requires manual commit after the stream completes. See [Handling Streaming Responses](/how-to/handling-streaming-responses-with-cycles) for the full pattern.

## Next steps

- [Handling Streaming Responses](/how-to/handling-streaming-responses-with-cycles) — budget-managed streaming with `reserveForStream`
- [Choosing the Right Integration Pattern](/how-to/choosing-the-right-integration-pattern) — when to use middleware vs inline
- [Cost Estimation Cheat Sheet](/how-to/cost-estimation-cheat-sheet) — how much to reserve per model
- [Error Handling in TypeScript](/how-to/error-handling-patterns-in-typescript) — handling Cycles errors
- [Express middleware example](https://github.com/runcycles/cycles-client-typescript/tree/main/examples/express-middleware) — runnable Express middleware integration
