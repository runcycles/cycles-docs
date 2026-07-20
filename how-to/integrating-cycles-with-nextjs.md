---
title: "Integrating Cycles with Next.js"
description: "Add budget governance to a Next.js application with per-route budget guards, streaming support, and client-side error handling."
---

# Integrating Cycles with Next.js

This guide shows how to add budget governance to a Next.js application using API routes, server actions, and client-side error handling.

For streaming patterns with the Vercel AI SDK, see [Integrating with Vercel AI SDK](/how-to/integrating-cycles-with-vercel-ai-sdk). This guide covers the broader Next.js integration: route-level guards, server actions, per-tenant isolation, and shared client setup.

## Prerequisites

- A running Cycles stack with a tenant, API key, and budget ([Deploy the Full Stack](/quickstart/deploying-the-full-cycles-stack))
- A Next.js 15+ project (App Router)
- Node.js 20+

## Installation

```bash
npm install runcycles
```

## Environment variables

Add to `.env.local`:

```bash
CYCLES_BASE_URL=http://localhost:7878
CYCLES_API_KEY=cyc_live_...
CYCLES_TENANT=acme
OPENAI_API_KEY=sk-...
```

## Shared Cycles client

Create a singleton client for use across API routes and server actions:

```typescript
// lib/cycles.ts
import { CyclesClient, CyclesConfig } from "runcycles";

export const cyclesClient = new CyclesClient(CyclesConfig.fromEnv());
```

## Route-level budget guard

Wrap the expensive work in `withCycles` so each request gets an automatic reserve → execute → commit lifecycle (for a lighter `client.decide()` preflight check, see the next section):

```typescript
// app/api/chat/route.ts
import { NextResponse } from "next/server";
import { cyclesClient } from "@/lib/cycles";
import {
  withCycles, getCyclesContext, BudgetExceededError,
} from "runcycles";

export const runtime = "nodejs";

const INPUT_PRICE = 250;    // GPT-4o: $2.50/1M tokens
const OUTPUT_PRICE = 1_000; // GPT-4o: $10/1M tokens

export async function POST(req: Request) {
  const { prompt } = await req.json();

  const generate = withCycles(
    {
      client: cyclesClient,
      actionKind: "llm.completion",
      actionName: "gpt-4o",
      estimate: () => {
        const inputTokens = Math.ceil(prompt.length / 4);
        return inputTokens * INPUT_PRICE + 1024 * OUTPUT_PRICE;
      },
      actual: (result: { usage: { prompt_tokens: number; completion_tokens: number } }) =>
        result.usage.prompt_tokens * INPUT_PRICE +
        result.usage.completion_tokens * OUTPUT_PRICE,
    },
    async () => {
      const ctx = getCyclesContext();
      let maxTokens = 1024;
      if (ctx?.caps?.maxTokens) {
        maxTokens = Math.min(maxTokens, ctx.caps.maxTokens);
      }

      // Your LLM call here
      const response = await callLLM(prompt, maxTokens);

      if (ctx) {
        ctx.metrics = {
          tokensInput: response.usage.prompt_tokens,
          tokensOutput: response.usage.completion_tokens,
        };
      }

      return response;
    },
  );

  try {
    const result = await generate();
    return NextResponse.json({ content: result.content });
  } catch (err) {
    if (err instanceof BudgetExceededError) {
      return NextResponse.json(
        { error: "budget_exceeded", message: "Budget exhausted." },
        { status: 402 },
      );
    }
    throw err;
  }
}
```

::: info 402 is an application-level choice
Returning 402 to the browser is this route's UX decision. At the Cycles protocol layer, budget exhaustion surfaces as a `DENY` decision from `decide()` or a `BudgetExceededError` thrown by `withCycles` — translating either signal to an HTTP status is up to your application.
:::

## Budget preflight in API routes

Next.js middleware runs in the Edge Runtime, which does not support Node.js APIs required by the `runcycles` client. Instead, add a preflight budget check at the start of your API route handler:

```typescript
// app/api/chat/route.ts
import { NextResponse } from "next/server";
import { cyclesClient } from "@/lib/cycles";

export async function POST(req: Request) {
  const tenant = req.headers.get("x-tenant-id") ?? "acme";

  // Preflight: check budget before doing expensive work
  const preflight = await cyclesClient.decide({
    idempotency_key: crypto.randomUUID(),
    subject: { tenant, app: "my-nextjs-app" },
    action: { kind: "api.request", name: "/api/chat" },
    estimate: { unit: "USD_MICROCENTS", amount: 1_000_000 },
  });

  if (preflight.isSuccess) {
    const decision = preflight.getBodyAttribute("decision");
    if (decision === "DENY") {
      return NextResponse.json(
        { error: "budget_exceeded", message: "Insufficient budget." },
        { status: 402 },
      );
    }
  }

  // Budget allows — proceed with the LLM call
  const { prompt } = await req.json();
  // ... your withCycles-wrapped LLM call here ...
}
```

## Server Actions with budget governance

Guard Next.js Server Actions with `withCycles`:

```typescript
// app/actions.ts
"use server";

import { cyclesClient } from "@/lib/cycles";
import { withCycles, BudgetExceededError } from "runcycles";

const INPUT_PRICE = 250;
const OUTPUT_PRICE = 1_000;

export async function summarize(text: string) {
  const run = withCycles(
    {
      client: cyclesClient,
      actionKind: "llm.completion",
      actionName: "gpt-4o",
      estimate: () => Math.ceil(text.length / 4) * INPUT_PRICE + 512 * OUTPUT_PRICE,
      actual: (r: { usage: { prompt_tokens: number; completion_tokens: number } }) =>
        r.usage.prompt_tokens * INPUT_PRICE + r.usage.completion_tokens * OUTPUT_PRICE,
    },
    async () => {
      return callLLM(`Summarize: ${text}`, 512);
    },
  );

  try {
    const result = await run();
    return { content: result.content };
  } catch (err) {
    if (err instanceof BudgetExceededError) {
      return { error: "Budget exhausted. Try again later." };
    }
    throw err;
  }
}
```

## Per-tenant isolation

Extract the tenant from request headers or auth context:

```typescript
// lib/tenant.ts
import { headers } from "next/headers";

export async function getTenant(): Promise<string> {
  const headerList = await headers();
  return headerList.get("x-tenant-id") ?? "acme";
}
```

Use it in API routes to scope budget per tenant:

```typescript
// app/api/chat/route.ts
import { getTenant } from "@/lib/tenant";

export async function POST(req: Request) {
  const tenant = await getTenant();

  const generate = withCycles(
    {
      client: cyclesClient,
      actionKind: "llm.completion",
      actionName: "gpt-4o",
      tenant,
      estimate: () => 2_000_000,
      actual: (r: any) => r.usage.prompt_tokens * 250 + r.usage.completion_tokens * 1000,
    },
    async () => { /* LLM call */ },
  );

  // ...
}
```

`tenant` (and the other subject fields: `workspace`, `app`, `workflow`, `agent`, `toolset`) is a top-level `withCycles` option that overrides the client config default. Since 0.3.0 it also accepts a callable — `tenant: (...args) => string` — resolved per call from the wrapped function's arguments.

## Client-side error handling

Handle budget errors in React components:

```typescript
// components/chat.tsx
"use client";

import { useState } from "react";

export function Chat() {
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(prompt: string) {
    const res = await fetch("/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ prompt }),
    });

    if (res.status === 402) {
      setError("Your budget has been exhausted. Please contact support.");
      return;
    }

    const data = await res.json();
    // handle response...
  }

  if (error) return <div className="error">{error}</div>;

  return <form onSubmit={(e) => { /* ... */ }}>{ /* ... */ }</form>;
}
```

## Key points

- **Singleton client in `lib/cycles.ts`.** Share one `CyclesClient` across all routes and server actions.
- **`withCycles` for API routes and server actions.** Wraps LLM calls with automatic reserve → execute → commit.
- **Route-handler preflight.** Do budget checks at the start of API routes or server actions; do not use the Node client from Edge middleware.
- **Per-tenant with headers.** Extract tenant from `x-tenant-id` header for multi-tenant budget isolation.
- **402 is an app-layer choice, not a Cycles convention.** Cycles signals budget exhaustion at the protocol layer (`DENY` / `BudgetExceededError`); returning 402 to the browser is one valid translation.
- **Use `runtime = "nodejs"`.** Required for `AsyncLocalStorage` support used by the Cycles client context.

## Next steps

- [Integrating with Vercel AI SDK](/how-to/integrating-cycles-with-vercel-ai-sdk) — streaming patterns with Vercel AI SDK
- [Handling Streaming Responses](/how-to/handling-streaming-responses-with-cycles) — streaming patterns in detail
- [Error Handling in TypeScript](/how-to/error-handling-patterns-in-typescript) — handling budget errors
- [Cost Estimation Cheat Sheet](/how-to/cost-estimation-cheat-sheet) — pricing reference for estimation
- [Production Operations Guide](/how-to/production-operations-guide) — running Cycles in production
