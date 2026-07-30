---
title: "TypeScript Client Configuration Reference"
description: "Complete reference for all configuration options in the runcycles TypeScript client, including connection, durable settlement recovery, retry, and timeout settings."
---

# TypeScript Client Configuration Reference

This is the complete reference for all configuration options available in the `runcycles` TypeScript client.

## CyclesConfig

All configuration is provided through the `CyclesConfig` constructor.

### Required fields

| Field | Type | Description |
|---|---|---|
| `baseUrl` | `string` | Base URL of the Cycles server (e.g., `http://localhost:7878`) |
| `apiKey` | `string` | API key for authentication |

### Subject defaults

These fields set default values for the Subject used in `withCycles` calls. They apply to all guarded functions unless overridden at the HOF level.

| Field | Type | Default | Description |
|---|---|---|---|
| `tenant` | `string \| undefined` | `undefined` | Default tenant |
| `workspace` | `string \| undefined` | `undefined` | Default workspace |
| `app` | `string \| undefined` | `undefined` | Default application name |
| `workflow` | `string \| undefined` | `undefined` | Default workflow |
| `agent` | `string \| undefined` | `undefined` | Default agent |
| `toolset` | `string \| undefined` | `undefined` | Default toolset |

### HTTP timeouts

| Field | Type | Default | Description |
|---|---|---|---|
| `connectTimeout` | `number` | `2000` | Connection timeout in milliseconds. Summed with `readTimeout` (see note below). |
| `readTimeout` | `number` | `5000` | Read timeout in milliseconds. Summed with `connectTimeout` (see note below). |

::: warning Timeout behavior
Node's built-in `fetch` does not distinguish connection timeout from read timeout. `connectTimeout` and `readTimeout` are **summed into a single `AbortSignal.timeout()`** value (default: 2000 + 5000 = **7000ms total**) that caps the entire request duration. If you need a 5-second maximum, set values like `connectTimeout: 2000, readTimeout: 3000`.
:::

### Retry configuration

Controls the commit retry engine and bounded drain.

| Field | Type | Default | Description |
|---|---|---|---|
| `retryEnabled` | `boolean` | `true` | Enable automatic commit retries |
| `retryMaxAttempts` | `number` | `5` | Maximum number of retry attempts |
| `retryInitialDelay` | `number` | `500` | Delay before the first retry (milliseconds) |
| `retryMultiplier` | `number` | `2.0` | Backoff multiplier between retries |
| `retryMaxDelay` | `number` | `30000` | Maximum delay between retries (milliseconds) |
| `retryFlushTimeout` | `number` | `10000` | Default bound used by `flushPendingCommits()` (milliseconds); `0` disables waiting |

#### How retry works

When settlement fails transiently, the retry engine schedules a same-key retry using exponential backoff:

```
Attempt 1: wait 500ms
Attempt 2: wait 1000ms
Attempt 3: wait 2000ms
Attempt 4: wait 4000ms
Attempt 5: wait 8000ms
```

With the default settings the backoff never reaches the cap; `retryMaxDelay` only kicks in once the exponential delay would exceed 30000ms (for example, with a higher `retryMaxAttempts`).

HTTP 429 honors a valid `Retry-After` floor, capped by the SDK's bounded-delay policy. Authentication failures and unclassifiable 4xx responses stop the current retry run but retain the durable record. A genuine, understood client rejection stops retrying and removes the record.

Retries run in the background, but they are not memory-only: known actual usage is journaled before the first settlement request.

### Durable journal

| Field | Type | Default | Description |
|---|---|---|---|
| `journalEnabled` | `boolean` | `true` | Persist unresolved known-actual settlement across process restarts |
| `journalDir` | `string \| undefined` | `undefined` | Journal base directory; `undefined` uses `~/.runcycles/commit-journal` |

A schema-valid HTTP `200` commit or schema-valid HTTP `201` event proves success. Ambiguous outcomes, retry exhaustion, authentication failures, and unclassifiable 4xx responses remain journaled for replay. An expired commit switches to `POST /v1/events` with the original idempotency key.

The journal is partitioned by server and principal. Configure `tenant` so pending records remain discoverable after API-key rotation. Journal records do not store API keys, but they contain settlement bodies and metadata; protect the directory as sensitive application state.

Call `flushPendingCommits(timeoutMs?)` during graceful shutdown. The timeout is process-wide across registered retry engines; unfinished records stay on disk for the next run.

## Programmatic configuration

```typescript
import { CyclesConfig } from "runcycles";

const config = new CyclesConfig({
  // Required
  baseUrl: "http://localhost:7878",
  apiKey: "cyc_live_...",

  // Subject defaults
  tenant: "acme",
  workspace: "production",
  app: "support-bot",

  // HTTP settings (milliseconds)
  connectTimeout: 2000,
  readTimeout: 5000,

  // Commit retry
  retryEnabled: true,
  retryMaxAttempts: 5,
  retryInitialDelay: 500,
  retryMultiplier: 2.0,
  retryMaxDelay: 30000,
  retryFlushTimeout: 10000,

  // Durable settlement journal
  journalEnabled: true,
  journalDir: undefined, // ~/.runcycles/commit-journal
});
```

## Environment variable configuration

Use `CyclesConfig.fromEnv()` to load configuration from environment variables. The default prefix is `CYCLES_`:

```typescript
const config = CyclesConfig.fromEnv();
```

| Environment variable | Maps to | Required |
|---|---|---|
| `CYCLES_BASE_URL` | `baseUrl` | Yes |
| `CYCLES_API_KEY` | `apiKey` | Yes |
| `CYCLES_TENANT` | `tenant` | No |
| `CYCLES_WORKSPACE` | `workspace` | No |
| `CYCLES_APP` | `app` | No |
| `CYCLES_WORKFLOW` | `workflow` | No |
| `CYCLES_AGENT` | `agent` | No |
| `CYCLES_TOOLSET` | `toolset` | No |
| `CYCLES_CONNECT_TIMEOUT` | `connectTimeout` | No |
| `CYCLES_READ_TIMEOUT` | `readTimeout` | No |
| `CYCLES_RETRY_ENABLED` | `retryEnabled` | No |
| `CYCLES_RETRY_MAX_ATTEMPTS` | `retryMaxAttempts` | No |
| `CYCLES_RETRY_INITIAL_DELAY` | `retryInitialDelay` | No |
| `CYCLES_RETRY_MULTIPLIER` | `retryMultiplier` | No |
| `CYCLES_RETRY_MAX_DELAY` | `retryMaxDelay` | No |
| `CYCLES_RETRY_FLUSH_TIMEOUT` | `retryFlushTimeout` | No |
| `CYCLES_JOURNAL_ENABLED` | `journalEnabled` | No |
| `CYCLES_JOURNAL_DIR` | `journalDir` | No |

A custom prefix can be passed: `CyclesConfig.fromEnv("MY_PREFIX_")` reads `MY_PREFIX_BASE_URL`, `MY_PREFIX_API_KEY`, etc.

## `withCycles` options

The `withCycles` HOF accepts an options object that controls reservation behavior per-call. These are separate from the `CyclesConfig` connection settings above. For full documentation and examples, see [Getting Started with the TypeScript Client — withCycles parameters](/quickstart/getting-started-with-the-typescript-client#withcycles-parameters).

| Parameter | Type | Default | Description |
|---|---|---|---|
| `estimate` | `number \| Function` | (required) | Estimated cost. Number constant or function receiving the wrapped function's arguments. |
| `actual` | `number \| Function \| undefined` | `undefined` | Actual cost. Number constant or function receiving the return value. Defaults to estimate. |
| `actionKind` | `string \| ((...args) => string \| undefined)` | `"unknown"` | Action category (e.g. `"llm.completion"`). |
| `actionName` | `string \| ((...args) => string \| undefined)` | `"unknown"` | Action identifier (e.g. `"gpt-4"`). |
| `actionTags` | `string[] \| undefined` | `undefined` | Tags for filtering and reporting. |
| `unit` | `string` | `"USD_MICROCENTS"` | Budget unit: `"USD_MICROCENTS"`, `"TOKENS"`, `"CREDITS"`, `"RISK_POINTS"`. |
| `ttlMs` | `number` | `60000` | Reservation TTL in milliseconds (range: 1000–86400000). |
| `gracePeriodMs` | `number \| undefined` | `undefined` | Grace period after TTL expiry in milliseconds. When `undefined`, the server applies its default (5000ms). Valid range: 0–60,000. |
| `overagePolicy` | `string` | `"ALLOW_IF_AVAILABLE"` | `"REJECT"`, `"ALLOW_IF_AVAILABLE"`, or `"ALLOW_WITH_OVERDRAFT"`. |
| `dryRun` | `boolean` | `false` | If `true`, evaluate without persisting. Function does not execute. |
| `tenant` | `string \| ((...args) => string \| undefined)` | `undefined` | Subject tenant override (takes precedence over config default). |
| `workspace` | `string \| ((...args) => string \| undefined)` | `undefined` | Subject workspace override. |
| `app` | `string \| ((...args) => string \| undefined)` | `undefined` | Subject app override. |
| `workflow` | `string \| ((...args) => string \| undefined)` | `undefined` | Subject workflow override. |
| `agent` | `string \| ((...args) => string \| undefined)` | `undefined` | Subject agent override. |
| `toolset` | `string \| ((...args) => string \| undefined)` | `undefined` | Subject toolset override. |
| `dimensions` | `Record<string, string> \| undefined` | `undefined` | Custom dimensions for the subject. |
| `client` | `CyclesClient \| undefined` | `undefined` | Explicit client. Falls back to module-level default. |
| `useEstimateIfActualNotProvided` | `boolean` | `true` | If `true` and `actual` is not set, use estimate as actual at commit. |

Since 0.3.0, `actionKind`, `actionName`, and the six subject fields accept a callable that receives the wrapped function's arguments and is resolved per call. If the callable returns `undefined`, the field falls back to the `CyclesConfig` default for subject fields, or to `"unknown"` for `actionKind`/`actionName`.

## Setting a default client

Instead of passing `client` to every `withCycles` call, set a module-level default:

```typescript
import { CyclesClient, CyclesConfig, setDefaultClient, setDefaultConfig } from "runcycles";

// Option 1: Set a config (client created lazily on first invocation)
setDefaultConfig(new CyclesConfig({
  baseUrl: "http://localhost:7878",
  apiKey: "cyc_live_...",
  tenant: "acme",
}));

// Option 2: Set an explicit client
setDefaultClient(new CyclesClient(new CyclesConfig({
  baseUrl: "http://localhost:7878",
  apiKey: "cyc_live_...",
})));
```

Client resolution is deferred to the first invocation and then cached — the wrapper binds permanently to the resolved client after its first call. A later `setDefaultClient()` call will not affect already-invoked wrappers.

## Resolution order

For each Subject field, the HOF resolves the value using this priority:

1. **HOF parameter** — if set in the `withCycles` options, it wins
2. **Config default** — if set on the `CyclesConfig` instance

If neither provides a value, the field is omitted from the request.

## Disabling retry

```typescript
const config = new CyclesConfig({
  baseUrl: "http://localhost:7878",
  apiKey: "cyc_live_...",
  retryEnabled: false,
});
```

This disables active background retries, not durability. Failed known-actual settlement remains journaled for replay on a later run while `journalEnabled` is `true`. Disable both only when the application supplies equivalent durable settlement recovery.

## Aggressive retry for critical commits

```typescript
const config = new CyclesConfig({
  baseUrl: "http://localhost:7878",
  apiKey: "cyc_live_...",
  retryMaxAttempts: 10,
  retryInitialDelay: 200,
  retryMultiplier: 1.5,
  retryMaxDelay: 60000,
});
```

## Next steps

- [Getting Started with the TypeScript Client](/quickstart/getting-started-with-the-typescript-client) — quick start guide
- [Error Handling Patterns](/how-to/error-handling-patterns-in-cycles-client-code) — error handling patterns
- [Using the Client Programmatically](/how-to/using-the-cycles-client-programmatically) — direct client usage
- [SDK Settlement Recovery and Durability](/protocol/sdk-settlement-recovery-and-durability) — journal, replay, expiry fallback, and guarantee boundary
- [Server Configuration Reference](/configuration/server-configuration-reference-for-cycles) — server-side properties
