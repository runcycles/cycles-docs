---
title: "Getting Started with the TypeScript Client"
description: "Add runtime authority to Node.js AI apps with runcycles: withCycles, streaming support, reserve-commit enforcement, caps, and audit records."
---

# Getting Started with the TypeScript Client

[![npm downloads](https://img.shields.io/npm/dt/runcycles?label=npm%20downloads&color=555&style=flat-square)](https://www.npmjs.com/package/runcycles)

The `runcycles` TypeScript package provides a `withCycles` higher-order function, a `reserveForStream` streaming adapter, and a programmatic `CyclesClient` for adding budget enforcement to any Node.js application.

The `withCycles` HOF wraps any async function in a reserve → execute → commit lifecycle:

1. **Before the function runs:** evaluates the estimate, creates a reservation, and checks the decision
2. **While the function runs:** maintains the reservation with automatic heartbeat extensions
3. **After the function returns:** commits actual usage and releases any unused remainder
4. **If the function throws:** releases the reservation to return budget to the pool

::: tip Cycles provides three runtime-authority pillars
- **Spend** — reserve-commit budget enforcement before instrumented LLM calls and tool actions
- **Risky actions** — `ALLOW` / `ALLOW_WITH_CAPS` / `DENY` decisions with `RISK_POINTS` budgets and caps for tool allowlists/denylists, max tokens, max steps, and cooldowns
- **Audit** — reservations, commits, releases, and decisions create structured records for compliance, attribution, and incident review
:::

## Prerequisites

You need a running Cycles stack with a tenant, API key, and budget. If you don't have one yet, follow [Deploy the Full Stack](/quickstart/deploying-the-full-cycles-stack) first.

::: tip Where do I get my API key?
API keys are created through the **Cycles Admin Server** (port 7979) and always start with `cyc_live_`. If your stack is already running with a tenant, create one directly:

```bash
curl -s -X POST http://localhost:7979/v1/admin/api-keys \
  -H "Content-Type: application/json" \
  -H "X-Admin-API-Key: admin-bootstrap-key" \
  -d '{
    "tenant_id": "acme-corp",
    "name": "dev-key",
    "permissions": ["reservations:create","reservations:commit","reservations:release","reservations:extend","reservations:list","balances:read"]
  }' | jq -r '.key_secret'
```

The response returns the full key (e.g. `cyc_live_abc123...`). **Save it — the secret is only shown once.**

Need the full setup? See [Deploy the Full Stack — Create an API key](/quickstart/deploying-the-full-cycles-stack#step-3-create-an-api-key). For rotation and lifecycle details, see [API Key Management](/how-to/api-key-management-in-cycles).
:::

## Verify your server is running

Before writing any code, confirm the Cycles Server is reachable:

```bash
curl -sf http://localhost:7878/actuator/health | jq .
```

You should see `{"status":"UP"}`. If this fails, check that the server is running per [Deploy the Full Stack](/quickstart/deploying-the-full-cycles-stack).

::: info Two API key types
Cycles uses two different authentication headers:

- **`X-Admin-API-Key`** — used with the **Admin Server** (port 7979) to manage tenants, budgets, and API keys. This is the bootstrap secret (e.g. `admin-bootstrap-key`).
- **`X-Cycles-API-Key`** — used with the **Cycles Server** (port 7878) for runtime operations (reservations, commits, balances). This is the tenant-scoped key starting with `cyc_live_...`.

The `runcycles` client uses `X-Cycles-API-Key` automatically. You only need `X-Admin-API-Key` when calling the Admin Server directly (e.g. to create tenants or API keys).
:::

## Installation

```bash
npm install runcycles
```

Requires Node.js 20+. TypeScript 5+ is recommended but optional — the package works with plain JavaScript. Zero runtime dependencies (uses built-in `fetch` and `AsyncLocalStorage`).

## Configuration

```typescript
import { CyclesConfig } from "runcycles";

const config = new CyclesConfig({
  baseUrl: "http://localhost:7878",
  apiKey: "cyc_live_...",  // from Admin Server — see tip above
  tenant: "acme-corp",
});
```

Or from environment variables:

```bash
export CYCLES_BASE_URL=http://localhost:7878
export CYCLES_API_KEY=cyc_live_...   # from Admin Server /v1/admin/api-keys response
export CYCLES_TENANT=acme-corp
```

```typescript
const config = CyclesConfig.fromEnv();
```

## The withCycles higher-order function

The simplest usage — wrap an async function with a fixed estimate:

```typescript :line-numbers
import { CyclesClient, CyclesConfig, withCycles, setDefaultClient } from "runcycles";

const config = new CyclesConfig({
  baseUrl: "http://localhost:7878",
  apiKey: "cyc_live_...",
  tenant: "acme-corp",
});
const client = new CyclesClient(config);
setDefaultClient(client);

const summarize = withCycles( // [!code focus]
  { estimate: 1000 }, // [!code focus]
  async (text: string) => {
    return await callLlm(text);
  },
);

const result = await summarize("Hello world");
```

This reserves 1000 USD_MICROCENTS before `summarize()` runs, then commits the same amount afterward.

### Dynamic estimates

The estimate can be a function that receives the wrapped function's arguments:

```typescript
const generate = withCycles(
  { estimate: (text: string, maxTokens: number) => maxTokens * 10 }, // [!code focus]
  async (text: string, maxTokens: number) => {
    return await callLlm(text, maxTokens);
  },
);
```

### Specifying actual usage

By default, the estimate is used as the actual amount at commit time. To calculate actual usage from the return value:

```typescript
const chat = withCycles(
  {
    estimate: 5000,
    actual: (result: string) => result.length * 5, // [!code focus]
  },
  async (prompt: string) => {
    return await callLlm(prompt);
  },
);
```

### withCycles parameters

| Parameter | Default | Description |
|---|---|---|
| `estimate` | (required) | `number` or function returning `number`. Estimated amount. |
| `actual` | `undefined` | `number` or function receiving the return value. Defaults to estimate. |
| `actionKind` | `"unknown"` | Action category (e.g. `"llm.completion"`). |
| `actionName` | `"unknown"` | Action identifier (e.g. `"gpt-4"`). |
| `actionTags` | `undefined` | Array of tags for filtering/reporting. |
| `unit` | `"USD_MICROCENTS"` | Budget unit: `"USD_MICROCENTS"`, `"TOKENS"`, `"CREDITS"`, `"RISK_POINTS"`. |
| `ttlMs` | `60000` | Reservation TTL in milliseconds (range: 1000–86400000). |
| `gracePeriodMs` | `undefined` | Grace period after TTL expiry (range: 0–60000). |
| `overagePolicy` | `"ALLOW_IF_AVAILABLE"` | `"REJECT"`, `"ALLOW_IF_AVAILABLE"`, or `"ALLOW_WITH_OVERDRAFT"`. |
| `dryRun` | `false` | If `true`, evaluate without persisting. Function does not execute. |
| `tenant` | `undefined` | Subject tenant override. |
| `workspace` | `undefined` | Subject workspace override. |
| `app` | `undefined` | Subject app override. |
| `workflow` | `undefined` | Subject workflow override. |
| `agent` | `undefined` | Subject agent override. |
| `toolset` | `undefined` | Subject toolset override. |
| `dimensions` | `undefined` | Custom dimensions object. |
| `client` | `undefined` | Explicit client. Falls back to module default. |
| `useEstimateIfActualNotProvided` | `true` | If `true` and `actual` is not set, use estimate as actual at commit. |

Since 0.3.0, `actionKind`, `actionName`, and the six subject fields (`tenant`, `workspace`, `app`, `workflow`, `agent`, `toolset`) accept `string | ((...args) => string | undefined)` — a callable is resolved per call from the wrapped function's arguments.

## Accessing reservation context at runtime

Inside a `withCycles`-guarded function, the current reservation context is available via `getCyclesContext()`:

```typescript :line-numbers
import { withCycles, getCyclesContext } from "runcycles";

const process = withCycles(
  { estimate: 1000, client },
  async (text: string) => {
    const ctx = getCyclesContext(); // [!code focus]

    // Check reservation details
    console.log(`Reservation: ${ctx?.reservationId}`);
    console.log(`Decision: ${ctx?.decision}`);

    // Check caps (if ALLOW_WITH_CAPS)
    if (ctx?.caps) {
      const maxTokens = ctx.caps.maxTokens;
      // Adjust behavior based on caps
    }

    // Attach metrics for the commit
    if (ctx) {
      ctx.metrics = {
        tokensInput: 150,
        tokensOutput: 80,
        latencyMs: 320,
        modelVersion: "gpt-4o-mini",
      };

      // Attach metadata for audit
      ctx.commitMetadata = { requestId: "req-abc-123" };
    }

    return await callLlm(text);
  },
);
```

The context uses `AsyncLocalStorage`, so it is available in any nested async call within the guarded function.

## Decision handling

When the reservation decision comes back, the HOF handles each case:

- **ALLOW** — the function runs normally.
- **ALLOW_WITH_CAPS** — the function runs. Caps are available through `getCyclesContext()` for the function to inspect and respect.
- **DENY** — the function does not run. A `BudgetExceededError` (or appropriate subclass) is raised.

```typescript :line-numbers
import { BudgetExceededError, CyclesProtocolError } from "runcycles";

try {
  const result = await summarize("Hello");
} catch (err) {
  if (err instanceof BudgetExceededError) { // [!code focus]
    result = fallbackResponse();
  } else if (err instanceof CyclesProtocolError) {
    if (err.retryAfterMs) {
      // retry after suggested delay
    }
    result = fallbackResponse();
  }
}
```

### Exception hierarchy

| Exception | When |
|-----------|------|
| `CyclesError` | Base for all Cycles errors |
| `CyclesProtocolError` | Server returned a protocol-level error |
| `BudgetExceededError` | Budget insufficient for the reservation |
| `OverdraftLimitExceededError` | Debt exceeds the overdraft limit |
| `DebtOutstandingError` | Outstanding debt blocks new reservations (when no overdraft limit configured) |
| `ReservationExpiredError` | Operating on an expired reservation |
| `ReservationFinalizedError` | Operating on an already-committed/released reservation |
| `CyclesTransportError` | Network-level failure (connection, DNS, timeout). Exported for user code — the SDK itself surfaces transport failures from `withCycles`/`reserveForStream` as `CyclesProtocolError` with `status: -1` |

## Streaming support

For LLM streaming where usage is only known after the stream finishes, use `reserveForStream`:

```typescript :line-numbers
import { CyclesClient, CyclesConfig, reserveForStream } from "runcycles";

const config = new CyclesConfig({
  baseUrl: "http://localhost:7878",
  apiKey: "cyc_live_...",
  tenant: "acme",
});
const client = new CyclesClient(config);

let handle;
try {
  handle = await reserveForStream({ // [!code focus]
    client,
    estimate: 5000,
    actionKind: "llm.completion",
    actionName: "gpt-4o",
  });
} catch (err) {
  // Reservation denied — no cleanup needed
  throw err;
}

try {
  const stream = streamText({
    model: openai("gpt-4o"),
    messages,
    onFinish: async ({ usage }) => {
      const actualCost = (usage.promptTokens + usage.completionTokens) * 3;
      await handle.commit(actualCost, { // [!code focus]
        tokensInput: usage.promptTokens,
        tokensOutput: usage.completionTokens,
      });
    },
  });

  return stream.toDataStreamResponse();
} catch (err) {
  await handle.release("stream_error");
  throw err;
}
```

The handle is once-only and race-safe: `commit()` throws if already finalized (so bugs are never silently hidden), while `release()` is a silent no-op if already finalized (best-effort by design).

### Which pattern to use?

| Pattern | Use when |
|---------|----------|
| `withCycles` | You have an async function that returns a result — the lifecycle is fully automatic |
| `reserveForStream` | You're streaming and usage is known only after the stream finishes |
| `CyclesClient` | You need full control over the reservation lifecycle, or are building custom integrations |

## Programmatic client

For full control, use `CyclesClient` directly. The client operates on wire-format (snake_case) JSON. Use typed mappers for camelCase convenience, or pass raw snake_case objects:

```typescript :line-numbers
import {
  CyclesClient,
  CyclesConfig,
  reservationCreateRequestToWire,
  reservationCreateResponseFromWire,
  commitRequestToWire,
  releaseRequestToWire,
} from "runcycles";

const config = new CyclesConfig({
  baseUrl: "http://localhost:7878",
  apiKey: "cyc_live_...",
});
const client = new CyclesClient(config);

// 1. Reserve
const response = await client.createReservation( // [!code focus]
  reservationCreateRequestToWire({
    idempotencyKey: "req-001",
    subject: { tenant: "acme", agent: "support-bot" },
    action: { kind: "llm.completion", name: "gpt-4" },
    estimate: { unit: "USD_MICROCENTS", amount: 500_000 },
    ttlMs: 30_000,
  }),
);

if (!response.isSuccess) {
  throw new Error(`Reservation failed: ${response.errorMessage}`);
}

const parsed = reservationCreateResponseFromWire(response.body!);

// 2. Execute
try {
  const result = await callLlm("Hello");

  // 3. Commit
  await client.commitReservation( // [!code focus]
    parsed.reservationId!,
    commitRequestToWire({
      idempotencyKey: "commit-001",
      actual: { unit: "USD_MICROCENTS", amount: 420_000 },
      metrics: { tokensInput: 1200, tokensOutput: 800 },
    }),
  );
} catch (err) {
  // 4. Release on failure
  await client.releaseReservation(
    parsed.reservationId!,
    releaseRequestToWire({
      idempotencyKey: "release-001",
      reason: "Processing failed",
    }),
  );
  throw err;
}
```

You can also pass raw snake_case objects directly without mappers:

```typescript
const response = await client.createReservation({
  idempotency_key: "req-001",
  subject: { tenant: "acme", agent: "support-bot" },
  action: { kind: "llm.completion", name: "gpt-4" },
  estimate: { unit: "USD_MICROCENTS", amount: 500_000 },
  ttl_ms: 30_000,
});
```

### Preflight decision check

```typescript :line-numbers
import { decisionRequestToWire, decisionResponseFromWire } from "runcycles";

const response = await client.decide(
  decisionRequestToWire({
    idempotencyKey: "decide-001",
    subject: { tenant: "acme" },
    action: { kind: "llm.completion", name: "gpt-4" },
    estimate: { unit: "USD_MICROCENTS", amount: 500_000 },
  }),
);

if (response.isSuccess) {
  const parsed = decisionResponseFromWire(response.body!);
  console.log(parsed.decision); // "ALLOW", "ALLOW_WITH_CAPS", or "DENY"
}
```

### Querying balances

```typescript
import { balanceResponseFromWire } from "runcycles";

const response = await client.getBalances({ tenant: "acme" });
if (response.isSuccess) {
  const parsed = balanceResponseFromWire(response.body!);
  for (const balance of parsed.balances) {
    console.log(`${balance.scopePath}: remaining=${balance.remaining.amount}`);
  }
}
```

### Recording events (direct debit)

```typescript
import { eventCreateRequestToWire } from "runcycles";

const response = await client.createEvent( // [!code focus]
  eventCreateRequestToWire({
    idempotencyKey: "evt-001",
    subject: { tenant: "acme" },
    action: { kind: "api.call", name: "geocode" },
    actual: { unit: "USD_MICROCENTS", amount: 1_500 },
  }),
);
```

## Suggested walkthrough

Follow this order to build understanding progressively:

**1. Reserve and commit with a fixed estimate**

```typescript :line-numbers
import { CyclesClient, CyclesConfig, withCycles, setDefaultClient } from "runcycles";

const config = new CyclesConfig({
  baseUrl: "http://localhost:7878",
  apiKey: "cyc_live_...",
  tenant: "acme-corp",
});
const client = new CyclesClient(config);
setDefaultClient(client);

const hello = withCycles( // [!code focus]
  { estimate: 1000 }, // [!code focus]
  async (name: string) => `Hello, ${name}!`,
);

const result = await hello("world");
console.log(result);
```

**2. Check your balance**

```typescript
import { balanceResponseFromWire } from "runcycles";

const response = await client.getBalances({ tenant: "acme-corp" });
if (response.isSuccess) {
  console.log(balanceResponseFromWire(response.body!));
}
```

**3. Try a dry run**

```typescript
const dryRunFunc = withCycles(
  { estimate: 500, dryRun: true },
  async () => "This won't consume budget",
);

await dryRunFunc();
// Check balances — they haven't changed
```

**4. Use dynamic estimates with metrics**

```typescript :line-numbers
import { getCyclesContext } from "runcycles";

const generate = withCycles(
  {
    estimate: (prompt: string, maxTokens: number) => maxTokens * 10, // [!code focus]
    actual: (result: string) => result.length * 5, // [!code focus]
    actionKind: "llm.completion",
    actionName: "gpt-4",
  },
  async (prompt: string, maxTokens: number) => {
    const ctx = getCyclesContext();
    if (ctx) {
      ctx.metrics = { tokensInput: prompt.length, tokensOutput: maxTokens };
    }
    return `Generated response for: ${prompt}`;
  },
);

const result = await generate("Explain budgets", 500);
```

**5. Handle denials gracefully**

```typescript :line-numbers
import { BudgetExceededError } from "runcycles";

const expensiveFunc = withCycles(
  { estimate: 999_999_999 },
  async () => "This needs a lot of budget",
);

try {
  await expensiveFunc();
} catch (err) {
  if (err instanceof BudgetExceededError) { // [!code focus]
    console.log("Budget exhausted — using fallback");
  }
}
```

## Nested `withCycles` calls

Calling a `withCycles`-wrapped function from inside another `withCycles`-wrapped function is allowed — it will not throw an error. However, each wrapper creates an **independent reservation** that deducts budget separately:

```typescript
const inner = withCycles({ estimate: 100, actionName: "inner" }, async () => "done");
const outer = withCycles({ estimate: 500, actionName: "outer" }, async () => {
  return await inner(); // creates a SECOND reservation — 600 total deducted, not 500
});
```

This means nested guards **double-count budget**. The outer reservation already covers the full estimated cost of the operation, so an inner reservation deducts additional budget from the same pool.

**Recommended pattern:** Place `withCycles` at the outermost entry point only. Inner functions should be plain async functions without their own guard:

```typescript
const inner = async () => "done"; // no withCycles — called within a guarded operation

const outer = withCycles({ estimate: 500, actionName: "outer" }, async () => {
  return await inner(); // single reservation — 500 total
});
```

## Lifecycle summary

For each `withCycles`-guarded function call:

1. Estimate is evaluated (function or fixed value)
2. Reservation is created on the Cycles server
3. Decision is checked (ALLOW / ALLOW_WITH_CAPS / DENY)
4. If DENY: exception is thrown, function does not run
5. Heartbeat extension is scheduled (background, at half the TTL interval, minimum 1s)
6. Function executes
7. Actual usage is evaluated (function, fixed value, or estimate)
8. Commit is sent with actual amount and optional metrics
9. Heartbeat is stopped
10. If function threw: reservation is released instead of committed

## Next steps

- [TypeScript Client Configuration Reference](/configuration/typescript-client-configuration-reference) — all config options and environment variables
- [Error Handling in TypeScript](/how-to/error-handling-patterns-in-typescript) — exception hierarchy, Express/Next.js patterns
- [Testing with Cycles](/how-to/testing-with-cycles) — unit and integration testing patterns
- [Using the Client Programmatically](/how-to/using-the-cycles-client-programmatically) — programmatic client reference
- [Error Handling Patterns](/how-to/error-handling-patterns-in-cycles-client-code) — general error handling patterns across all languages
- [API Reference](/api/) — interactive endpoint documentation
