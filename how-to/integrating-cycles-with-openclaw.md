---
title: "Integrating Cycles with OpenClaw"
description: "Add budget enforcement to OpenClaw agents using the cycles-openclaw-budget-guard plugin for automatic reserve, commit, and release."
---

# Integrating Cycles with OpenClaw

[![npm](https://img.shields.io/npm/v/@runcycles/openclaw-budget-guard)](https://www.npmjs.com/package/@runcycles/openclaw-budget-guard)
[![npm downloads](https://img.shields.io/npm/dt/@runcycles/openclaw-budget-guard?label=downloads&color=555&style=flat-square)](https://www.npmjs.com/package/@runcycles/openclaw-budget-guard)

This guide shows how to add budget enforcement to OpenClaw agents using the [`cycles-openclaw-budget-guard`](https://github.com/runcycles/cycles-openclaw-budget-guard) plugin. The plugin handles the full reserve → commit → release lifecycle for both model and tool calls automatically, with no custom code required.

## Choose your path

- **Cap OpenClaw agents in JS/TS** — install [`@runcycles/openclaw-budget-guard`](https://www.npmjs.com/package/@runcycles/openclaw-budget-guard) and follow this guide.
- **Use Cycles directly without OpenClaw** — start with the [TypeScript client](/quickstart/getting-started-with-the-typescript-client) for custom agent frameworks.
- **Evaluate Cycles for a multi-tenant agent SaaS** — start with the [evaluation guide](/how-to/evaluate-cycles-for-agent-saas) before reading this implementation page.
- **Not sure where Cycles fits?** [Send us your tool-call flow](/contact) and we'll map where `reserve` / `commit` should sit.

## Why budget enforcement?

AI agents make autonomous decisions — calling models, invoking tools, retrying on failure — with no human in the loop. Without runtime enforcement:

- **Runaway spend** — a single [runaway agent](/incidents/runaway-agents-tool-loops-and-budget-overruns-the-incidents-cycles-is-designed-to-prevent) can consume substantial budget quickly. Provider budgets, credits, and quotas use their own scopes and semantics; request-count limits do not account for variable call cost.
- **Uncontrolled side-effects** — an agent can send hundreds of emails, trigger deployments, or call dangerous APIs with nothing to stop it. Cost limits alone don't help — some actions are consequential regardless of price.
- **Noisy neighbors** — in multi-tenant or multi-user setups, one agent can consume the entire team budget, starving other users.
- **No session-level cost visibility** — when a session ends, you have no idea what it spent, which tools it called most, or whether it was cost-efficient.
- **Abrupt failure** — budget runs out and the agent crashes instead of adapting.

The plugin adds budget checks to model and tool calls that pass through OpenClaw's supported lifecycle hooks. With `modelFallbacks`, low-budget strategies, and `toolCallLimits` configured, it can downgrade matching models, disable expensive tools, add remaining-budget prompt hints, and cap per-tool invocation counts. Standard subject fields in `budgetScope` select enforceable tenant, workspace, app, workflow, agent, or toolset ledgers; `userId` and `sessionId` are attribution dimensions unless you map them to those fields. Session summaries report the plugin's estimated model and tool costs.

Beyond enforcement, the plugin actively protects you:

- **Burn rate anomaly detection** emits `cycles.budget.burn_rate_anomaly` when the current window exceeds the configured comparison threshold; your OTLP backend decides whether to alert or intervene
- **Predictive exhaustion warnings** estimate when budget will run out and emit `cycles.budget.exhaustion_forecast_ms` before it happens, so you can fund the budget or wind down gracefully
- **Automatic retry with backoff** on transient Cycles server errors (429/503/504) prevents spurious denials during load spikes
- **Reservation heartbeat** auto-extends long-running tool reservations so cost tracking doesn't silently break when a tool exceeds the default 60s TTL
- **Budget observability** via the built-in OTLP HTTP adapter (14 metrics when the current features are enabled, configured through `otlpMetricsEndpoint`) and opt-in session logs of the plugin's reserve, commit, deny, block, and release decisions
- **Unconfigured tool detection** reports which tools are using default cost estimates so you can tune `toolBaseCosts` after every session

The result is a mandatory budget boundary for the hook paths the plugin covers, plus configurable degradation and budget telemetry. External model and tool outcomes still belong in application or provider logs.

Install, configure 3 fields, done. No agent code changes required.

::: tip When to use this vs. the Cycles client directly
If you're building a custom agent framework, use the [Cycles TypeScript client](/how-to/using-the-cycles-client-programmatically) directly. If you're running OpenClaw, this plugin gives you the same enforcement with zero custom code — just configure and go.
:::

For background on why rate limits and provider caps aren't enough, see [Exposure: Why Rate Limits Leave Agents Unbounded](/concepts/exposure-why-rate-limits-leave-agents-unbounded) and [Cycles vs. Provider Spending Caps](/concepts/cycles-vs-provider-spending-caps).

## Quick start

Get budget enforcement running in under a minute:

```bash
openclaw plugins install @runcycles/openclaw-budget-guard
openclaw plugins enable openclaw-budget-guard
```

Add minimal configuration to your OpenClaw config file (typically `openclaw.json` or `openclaw.config.json`):

```json
{
  "plugins": {
    "entries": {
      "openclaw-budget-guard": {
        "config": {
          "cyclesBaseUrl": "http://localhost:7878",
          "cyclesApiKey": "cyc_live_...",
          "tenant": "my-org",
          "currency": "USD_MICROCENTS"
        }
      }
    }
  }
}
```

That's it — all model and tool calls are now budget-guarded. Read on for advanced features like model fallbacks, tool access control, and budget-aware prompt hints.

## Prerequisites

- A Cycles API key — create one via the Admin Server. See [Deploy the Full Stack](/quickstart/deploying-the-full-cycles-stack#step-3-create-an-api-key) or [API Key Management](/how-to/api-key-management-in-cycles).

You also need:
- **OpenClaw** >= 0.1.0 with plugin support
- **Node.js** >= 20.0.0

## Install and enable

```bash
# Install the plugin
openclaw plugins install @runcycles/openclaw-budget-guard

# Enable it
openclaw plugins enable openclaw-budget-guard
```

Or install from a local checkout:

```bash
openclaw plugins install -l ./cycles-openclaw-budget-guard
openclaw plugins enable openclaw-budget-guard
```

## Minimal configuration

Add the plugin to your OpenClaw config file (typically `openclaw.config.json`). Three fields are required — everything else has sensible defaults:

```json
{
  "plugins": {
    "entries": {
      "openclaw-budget-guard": {
        "config": {
          "cyclesBaseUrl": "http://localhost:7878",
          "cyclesApiKey": "your-api-key",
          "tenant": "acme"
        }
      }
    }
  }
}
```

> **Important:** Budget exhaustion and reservation failures are enforced fail-closed by default. A failed budget-snapshot fetch is treated as healthy by default, but you can make that path fail closed with `failClosedOnSnapshotError: true`. See [Fail-open vs fail-closed](#fail-open-vs-fail-closed) for details.

## Understanding the cost model

Every model call and tool call reserves a fixed cost from the budget. The default currency is `USD_MICROCENTS` — 1 unit = $0.00000001 (10⁻⁸ dollars).

| Amount | USD |
|--------|-----|
| 100,000 | $0.001 |
| 1,000,000 | $0.01 |
| 10,000,000 | $0.10 |
| 100,000,000 | $1.00 |

**Example.** With a $5 budget (500,000,000 units) and `claude-opus` at 1,500,000/call, you can afford ~333 model calls. The `lowBudgetThreshold` (default 10,000,000 = $0.10) triggers model downgrade when budget is nearly exhausted.

**Setting tool costs.** Start with defaults (100,000/call). After your first session, check `sessionSummary.unconfiguredTools` for the list of tools that need explicit costs. External API tools (web search, code execution) typically cost 500K-1M. Lightweight tools (text formatting, math) cost 10K-50K.

## What the plugin does

The plugin hooks into five OpenClaw lifecycle events to enforce budget boundaries:

| Hook | What happens |
|------|-------------|
| `before_model_resolve` | Fetches balance, reserves budget for the model call, downgrades the model if budget is low, blocks if exhausted (via [model override workaround](#model-blocking-workaround-v0-7-3)). The reservation is held open for later commit (see [Model cost reconciliation](#model-cost-reconciliation-v0-5-0)). |
| `before_prompt_build` | Commits any pending model reservation from the previous turn at the reserved estimate. Injects a budget-awareness hint into the system prompt, including forecast projections and pool balances. |
| `before_tool_call` | Checks tool permissions (allowlist/blocklist), applies degradation strategies, creates a Cycles reservation. Optionally retries on denial. |
| `after_tool_call` | Commits the reservation with the estimated cost from `toolBaseCosts` (or the default). |
| `agent_end` | Releases orphaned reservations, builds a session summary with cost breakdown and forecasts, POSTs it to `analyticsWebhookUrl` if configured. |

Both model and tool calls follow the standard Cycles reserve → commit → release protocol. The plugin manages an in-memory map of active reservations so that every reservation is properly settled or released at `agent_end`.

## Budget levels and model downgrading

The plugin classifies budget into three levels:

| Level | Condition | Behavior |
|-------|-----------|----------|
| **healthy** | `remaining > lowBudgetThreshold` | Pass through — no changes |
| **low** | `exhaustedThreshold < remaining ≤ lowBudgetThreshold` | Apply low-budget strategies (model downgrade, token limits, tool restrictions) |
| **exhausted** | `remaining ≤ exhaustedThreshold` | Block execution (or warn, if `failClosed: false`) |

### Chained model fallbacks

Model fallbacks support both single values and ordered chains. When budget is low, the plugin iterates through candidates and selects the first one whose cost fits within the remaining budget:

```json
{
  "plugins": {
    "entries": {
      "openclaw-budget-guard": {
        "config": {
          "tenant": "acme",
          "modelFallbacks": {
            "anthropic/claude-opus-4-8": ["anthropic/claude-sonnet-4-6", "anthropic/claude-haiku-4-5-20251001"],
            "openai/gpt-4o": "openai/gpt-4o-mini"
          },
          "modelBaseCosts": {
            "anthropic/claude-opus-4-8": 500000,
            "anthropic/claude-sonnet-4-6": 300000,
            "anthropic/claude-haiku-4-5-20251001": 100000,
            "openai/gpt-4o": 1000000,
            "openai/gpt-4o-mini": 100000
          }
        }
      }
    }
  }
}
```

When the budget drops below `lowBudgetThreshold` (default: 10,000,000 units), any model request matching a key in `modelFallbacks` is transparently swapped to the cheapest affordable alternative.

## Tool cost estimation

Configure per-tool cost estimates via `toolBaseCosts`:

```json
{
  "plugins": {
    "entries": {
      "openclaw-budget-guard": {
        "config": {
          "tenant": "acme",
          "toolBaseCosts": {
            "web_search": 500000,
            "code_execution": 1000000,
            "file_read": 50000
          }
        }
      }
    }
  }
}
```

Any tool not listed defaults to 100,000 units.

::: warning Type safety note
Config values in `toolBaseCosts` and `modelBaseCosts` are validated at startup (v0.7.10+). Non-number values are rejected and negative values throw an error. If using OpenClaw's JSON config, ensure all cost values are numbers, not quoted strings.
:::

::: info Tuning tool costs
OpenClaw plugins are configured via JSON, which cannot carry JavaScript functions, so the plugin's `costEstimator` callback is **not available** through OpenClaw config. To refine estimates, iterate on `toolBaseCosts` using session data:

1. Set `enableEventLog: true` in your plugin config.
2. Run a few agent sessions.
3. Inspect the session summary in the logs — it includes per-tool cost breakdowns and an `unconfiguredTools` list of tools falling back to the default estimate.
4. Adjust `toolBaseCosts` values based on observed usage and re-run.

Cycles reservations lock the estimated amount and commits charge the same estimate, so the values only need to be "close enough" — precise per-call cost reconciliation is reserved for consumers who import `cycles-openclaw-budget-guard` as an npm library in custom agent frameworks.
:::

## Tool access control

Control which tools can be called using allowlists and blocklists with glob-style patterns:

```json
{
  "plugins": {
    "entries": {
      "openclaw-budget-guard": {
        "config": {
          "tenant": "acme",
          "toolAllowlist": ["web_search", "code_*"],
          "toolBlocklist": ["dangerous_*"]
        }
      }
    }
  }
}
```

- Blocklist takes precedence over allowlist
- Supports exact names and `*` wildcards anywhere in the pattern (prefix: `code_*`, suffix: `*_tool`, mid: `aws_*_tool`, all: `*`)
- Tools blocked by access lists are rejected before any budget reservation is attempted

## Tool call limits

Cap the number of times a specific tool can be invoked per session. Useful for consequential actions like sending emails or triggering deployments:

```json
{
  "plugins": {
    "entries": {
      "openclaw-budget-guard": {
        "config": {
          "tenant": "acme",
          "toolCallLimits": {
            "send_email": 10,
            "deploy": 3
          }
        }
      }
    }
  }
}
```

Once a tool reaches its limit, further calls are blocked with a descriptive reason. Tools without a limit are unrestricted. Limits reset on each new agent session.

::: tip Combine with cost limits
Tool call limits complement cost-based budgeting. Use `toolBaseCosts` to control spend and `toolCallLimits` to cap side-effects independently — an agent can exhaust its budget before hitting call limits, or vice versa.
:::

## Graceful degradation strategies

When budget is low, the plugin can apply multiple composable strategies beyond model downgrading:

```json
{
  "plugins": {
    "entries": {
      "openclaw-budget-guard": {
        "config": {
          "tenant": "acme",
          "lowBudgetStrategies": ["downgrade_model", "reduce_max_tokens", "disable_expensive_tools"],
          "maxTokensWhenLow": 1024,
          "expensiveToolThreshold": 1000000
        }
      }
    }
  }
}
```

Available strategies:

| Strategy | Effect |
|----------|--------|
| `downgrade_model` | Use cheaper fallback models from `modelFallbacks` (default) |
| `reduce_max_tokens` | Append token limit guidance to prompt hints |
| `disable_expensive_tools` | Block tools exceeding `expensiveToolThreshold` |
| `limit_remaining_calls` | Cap total tool/model calls via `maxRemainingCallsWhenLow` (default: 10) |

Strategies are composable — list multiple values to combine them.

## Prompt budget hints

When `injectPromptBudgetHint` is enabled (the default), the plugin prepends a compact hint to the system prompt so the model itself is aware of budget constraints:

```
Budget: 5000000 USD_MICROCENTS remaining. Budget is low — prefer cheaper models and avoid expensive tools. 50% of budget remaining. Est. ~10 tool calls and ~5 model calls remaining at current rate. Team pool: 50000000 remaining.
```

The hint includes:
- Current remaining balance and percentage
- Budget level warnings
- Forecast projections based on average call costs so far
- Team pool balance (when `parentBudgetId` is configured)
- Token limit guidance (when `reduce_max_tokens` strategy is active)

This helps models self-regulate — choosing cheaper tools, shorter responses, or skipping optional steps when budget is tight.

## Per-user and per-session attribution

Attach user and session identifiers to reservations for attribution and reporting:

```json
{
  "plugins": {
    "entries": {
      "openclaw-budget-guard": {
        "config": {
          "tenant": "acme",
          "userId": "user-123",
          "sessionId": "session-456"
        }
      }
    }
  }
}
```

User and session identifiers can also be set dynamically via `ctx.metadata.userId` and `ctx.metadata.sessionId` at runtime — context values override static config.

These identifiers are threaded into Cycles reservation subjects as `dimensions` for attribution and reporting. Note that dimensions never derive budget scopes — to *enforce* a per-user or per-session budget, the identifier must be mapped to a standard Subject field (e.g. `agent` or `workflow`) with a budget at that scope.

## Reservation settings

Configure reservation behavior per-tool or globally:

```json
{
  "plugins": {
    "entries": {
      "openclaw-budget-guard": {
        "config": {
          "tenant": "acme",
          "reservationTtlMs": 60000,
          "toolReservationTtls": {
            "code_execution": 120000
          },
          "overagePolicy": "ALLOW_IF_AVAILABLE",
          "toolOveragePolicies": {
            "web_search": "ALLOW_IF_AVAILABLE"
          }
        }
      }
    }
  }
}
```

Overage policies control what happens when a reservation exceeds the remaining budget:
- `ALLOW_IF_AVAILABLE` — allow up to the remaining balance (default)
- `REJECT` — deny the reservation
- `ALLOW_WITH_OVERDRAFT` — allow and create a debt

## Retry on denied reservations

Optionally retry tool reservations that are denied, useful when budget is being replenished or released concurrently:

```json
{
  "plugins": {
    "entries": {
      "openclaw-budget-guard": {
        "config": {
          "tenant": "acme",
          "retryOnDeny": true,
          "retryDelayMs": 2000,
          "maxRetries": 1
        }
      }
    }
  }
}
```

::: warning Latency note
Retries block the `before_tool_call` hook synchronously. With the defaults (`retryDelayMs: 2000`, `maxRetries: 1`), a denied tool call pauses for 2 seconds before returning a block result. For interactive agents where responsiveness matters, consider lowering `retryDelayMs` or keeping `retryOnDeny: false` (the default) and handling denials at the application level instead.
:::

## Budget transition alerts

Get notified when the budget level changes (e.g., healthy → low → exhausted):

```json
{
  "plugins": {
    "entries": {
      "openclaw-budget-guard": {
        "config": {
          "tenant": "acme",
          "budgetTransitionWebhookUrl": "https://hooks.example.com/budget-alert"
        }
      }
    }
  }
}
```

The webhook POST body carries `{ previousLevel, currentLevel, remaining, timestamp }`. Receiver services should be idempotent and ack quickly — delivery is fire-and-forget (best-effort, no retries).

::: info Note
Transition detection runs on every budget snapshot refresh (controlled by `snapshotCacheTtlMs`, default 5 seconds). If a budget oscillates rapidly around a threshold between cache refreshes, the same transition (e.g., healthy → low) may fire more than once. Webhook receivers should be idempotent or deduplicate by timestamp if this matters for your use case.
:::

## Session analytics and cost breakdown

The plugin tracks per-tool and per-model cost breakdowns throughout the session. At `agent_end`, it builds a `SessionSummary` containing:

- Tenant, budget, user, and session identifiers
- Final remaining/spent/reserved balances
- Total reservations made
- Per-component cost breakdown (e.g., `tool:web_search`, `model:anthropic/claude-sonnet-4-6`)
- Per-tool invocation counts (e.g., `{ web_search: 15, code_execution: 3 }`)
- Session timing (start/end timestamps)
- Average cost and estimated remaining calls

The summary is attached to `ctx.metadata["openclaw-budget-guard"]` and can also be exported via webhook:

```json
{
  "plugins": {
    "entries": {
      "openclaw-budget-guard": {
        "config": {
          "tenant": "acme",
          "analyticsWebhookUrl": "https://analytics.example.com/sessions"
        }
      }
    }
  }
}
```

The webhook receives the full `SessionSummary` as its POST body, so the receiving service can persist or forward it to any analytics backend.

## End-user budget visibility

Budget status is automatically attached to `ctx.metadata["openclaw-budget-guard-status"]` on every hook invocation, making it available to OpenClaw frontends for UI display:

```json
{
  "level": "low",
  "remaining": 5000000,
  "allocated": 10000000,
  "percentRemaining": 50
}
```

## Multi-currency support

Override the default currency per-tool or per-model:

```json
{
  "plugins": {
    "entries": {
      "openclaw-budget-guard": {
        "config": {
          "tenant": "acme",
          "currency": "USD_MICROCENTS",
          "modelCurrency": "TOKENS",
          "toolCurrencies": {
            "web_search": "CREDITS"
          }
        }
      }
    }
  }
}
```

Each reservation uses the appropriate currency unit. Cost tracking respects the per-component currency.

## Budget pools

Surface hierarchical budget information by setting a parent budget ID:

```json
{
  "plugins": {
    "entries": {
      "openclaw-budget-guard": {
        "config": {
          "tenant": "acme",
          "budgetScope": { "app": "team-alpha-agent" },
          "parentBudgetId": "team-alpha"
        }
      }
    }
  }
}
```

When `parentBudgetId` is set, the matching balance is included in budget snapshots and prompt hints (for example, "Team pool: 50000000 remaining."). This setting is read-only visibility: reservations still target `budgetScope`, and `parentBudgetId` does not add another enforced ledger. To enforce a broader limit as well, create a budget at a broader standard scope that is actually present in the reservation subject.

## Dry-run mode

Test the plugin without a live Cycles server:

```json
{
  "plugins": {
    "entries": {
      "openclaw-budget-guard": {
        "config": {
          "tenant": "acme",
          "cyclesBaseUrl": "http://unused",
          "cyclesApiKey": "unused",
          "dryRun": true,
          "dryRunBudget": 100000000
        }
      }
    }
  }
}
```

In dry-run mode, budget is tracked in-memory using a simulated client. All plugin behavior (classification, reservation, fallbacks, strategies) works identically — only the Cycles server communication is replaced. This is useful for development, testing, and evaluating the plugin before deploying a Cycles server.

## Fail-open vs fail-closed

The plugin distinguishes between two failure modes:

**Budget confirmed exhausted** — controlled by `failClosed` (default: `true`):
- `failClosed: true` → returns OpenClaw's blocking result for tools; for model calls, overrides the model with the plugin's non-existent exhaustion sentinel so the provider rejects before generation
- `failClosed: false` → logs a warning but allows execution to continue

**Budget snapshot unavailable** — controlled by `failClosedOnSnapshotError` (default: `false`):
- `failClosedOnSnapshotError: false` → assumes a healthy snapshot and continues to the reservation step
- `failClosedOnSnapshotError: true` → treats the snapshot as exhausted; `failClosed` then decides whether to block

**Reservation unavailable or denied** — the reservation helper returns a denial after its configured transient retries. `failClosed: true` blocks the call; `failClosed: false` logs the denial and allows execution while tracking the estimate locally.

## Error handling

The package exports two structured error classes for custom integrations:

```typescript
import { BudgetExhaustedError, ToolBudgetDeniedError } from "@runcycles/openclaw-budget-guard";
```

- **`BudgetExhaustedError`** (`code: "BUDGET_EXHAUSTED"`) — includes `remaining`, `tenant`, and `budgetId` properties.
- **`ToolBudgetDeniedError`** (`code: "TOOL_BUDGET_DENIED"`) — includes `toolName`.

The built-in hooks do not currently throw these classes. `before_tool_call` returns `{ block: true, blockReason }` for a fail-closed denial, while `before_model_resolve` returns `modelOverride: "__cycles_budget_exhausted__"` because OpenClaw does not expose a model-call block result.

## Verifying the integration

Set `logLevel: "debug"` to see the plugin's activity:

```json
{
  "plugins": {
    "entries": {
      "openclaw-budget-guard": {
        "config": {
          "tenant": "acme",
          "logLevel": "debug"
        }
      }
    }
  }
}
```

On startup, the plugin logs a config summary so you can verify settings at a glance:

```
  Cycles Budget Guard for OpenClaw v0.8.4
  https://runcycles.io
  tenant: acme
  cyclesBaseUrl: http://localhost:7878
  cyclesApiKey: ****_key
  currency: USD_MICROCENTS
  failClosed: true
  dryRun: false
  logLevel: debug
  lowBudgetThreshold: 10000000
  exhaustedThreshold: 0
```

The plugin also warns about common misconfigurations on startup (e.g., `downgrade_model` strategy with no `modelFallbacks`, or no `toolBaseCosts` configured).

With `logLevel: "debug"`, you'll see per-call activity:

```
[openclaw-budget-guard] before_model_resolve: model=anthropic/claude-sonnet-4-6 level=healthy
[openclaw-budget-guard] before_prompt_build: injecting hint (142 chars)
[openclaw-budget-guard] Tool "web_search" has no entry in toolBaseCosts — using default estimate (100000 USD_MICROCENTS)
[openclaw-budget-guard] before_tool_call: tool=web_search callId=abc123 estimate=100000
[openclaw-budget-guard] after_tool_call: committed 100000 for tool=web_search
[openclaw-budget-guard] Agent session budget summary: remaining=9500000 spent=500000 reservations=1
```

## Full configuration reference

### Core settings

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `enabled` | boolean | `true` | Master switch |
| `cyclesBaseUrl` | string | — | Cycles server URL (required) |
| `cyclesApiKey` | string | — | Cycles API key (required) |
| `tenant` | string | — | Cycles tenant (required) |
| `budgetScope` | object | — | Scope segments for targeting a specific budget (e.g. `{ "workspace": "road", "app": "lane" }`) |
| `budgetId` | string | — | **Deprecated** — use `budgetScope`. Equivalent to `budgetScope: { "app": "<value>" }` |
| `currency` | string | `USD_MICROCENTS` | Default budget unit |
| `failClosed` | boolean | `true` | Block on exhausted snapshots and reservation denials |
| `failClosedOnSnapshotError` | boolean | `false` | Treat a failed or timed-out budget snapshot fetch as exhausted instead of healthy |
| `logLevel` | string | `info` | `debug` / `info` / `warn` / `error` |

### Budget thresholds

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `lowBudgetThreshold` | number | `10000000` | Below this → low budget mode |
| `exhaustedThreshold` | number | `0` | At or below this → exhausted |

### Model configuration

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `modelFallbacks` | object | `{}` | Model → fallback model or chain (string or string[]) |
| `modelBaseCosts` | object | `{}` | Model name → estimated cost per call |
| `defaultModelCost` | number | `500000` | Fallback cost when model not in `modelBaseCosts` |
| `defaultModelName` | string | — | Model name for budget reservations. Required because OpenClaw's `before_model_resolve` event doesn't include the model name. Set to your agent's model (e.g. `"openai/gpt-5-nano"`). |
| `defaultModelActionKind` | string | `llm.completion` | Action kind for model reservations |
| `modelCurrency` | string | — | Override currency for model reservations |

### Tool configuration

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `toolBaseCosts` | object | `{}` | Tool name → estimated cost per call |
| `defaultToolActionKindPrefix` | string | `tool.` | Prefix for tool action kinds |
| `toolAllowlist` | string[] | — | Only these tools are permitted (supports `*` wildcards) |
| `toolBlocklist` | string[] | — | These tools are blocked (supports `*` wildcards) |
| `toolCurrencies` | object | — | Tool name → currency override |
| `toolReservationTtls` | object | — | Tool name → TTL override (ms) |
| `toolOveragePolicies` | object | — | Tool name → overage policy override |
| `toolCallLimits` | object | — | Map: tool name → max invocations per session |

### Prompt hints

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `injectPromptBudgetHint` | boolean | `true` | Inject budget status into the system prompt |
| `maxPromptHintChars` | number | `200` | Max characters for the budget hint |

### Reservation settings

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `reservationTtlMs` | number | `60000` | Default reservation TTL (ms) |
| `overagePolicy` | string | `ALLOW_IF_AVAILABLE` | Default overage policy (`REJECT`, `ALLOW_IF_AVAILABLE`, `ALLOW_WITH_OVERDRAFT`) |
| `snapshotCacheTtlMs` | number | `5000` | Budget snapshot cache TTL (ms) |

### Low-budget strategies

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `lowBudgetStrategies` | string[] | `["downgrade_model"]` | Strategies to apply when budget is low |
| `maxTokensWhenLow` | number | `1024` | Token limit when `reduce_max_tokens` is active |
| `expensiveToolThreshold` | number | — | Cost threshold for `disable_expensive_tools` |
| `maxRemainingCallsWhenLow` | number | `10` | Max calls when `limit_remaining_calls` is active |

### Retry on deny

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `retryOnDeny` | boolean | `false` | Retry tool reservations after denial |
| `retryDelayMs` | number | `2000` | Delay between retries (ms) |
| `maxRetries` | number | `1` | Maximum retry attempts |

### Dry-run mode

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `dryRun` | boolean | `false` | Use in-memory simulated budget |
| `dryRunBudget` | number | `100000000` | Starting budget for dry-run mode |

### Per-user/session attribution

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `userId` | string | — | User ID recorded in `dimensions` for attribution/reporting — not budget-enforcing (overridable via `ctx.metadata.userId`) |
| `sessionId` | string | — | Session ID recorded in `dimensions` for attribution/reporting — not budget-enforcing (overridable via `ctx.metadata.sessionId`) |

### Budget transitions

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `budgetTransitionWebhookUrl` | string | — | Webhook URL for level transitions |

### Session analytics

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `analyticsWebhookUrl` | string | — | Webhook URL for session summary data |

### Budget pools

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `parentBudgetId` | string | — | Parent budget ID for pool balance visibility |

### Advanced / operational settings

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `aggressiveCacheInvalidation` | boolean | `true` | Invalidate budget snapshot cache after every mutation |
| `heartbeatIntervalMs` | number | `30000` | Interval for reservation TTL heartbeat extensions |
| `retryableStatusCodes` | number[] | `[429, 503, 504]` | HTTP status codes eligible for transient retry |
| `transientRetryMaxAttempts` | number | `2` | Max retries on transient server errors |
| `transientRetryBaseDelayMs` | number | `500` | Base delay for transient retries (ms) |
| `burnRateWindowMs` | number | `60000` | Window for burn-rate anomaly detection |
| `burnRateAlertThreshold` | number | `3.0` | Alert when burn rate exceeds this multiple of average |
| `enableEventLog` | boolean | `false` | Log all budget events for debugging |
| `exhaustionWarningThresholdMs` | number | `120000` | Warn when time-to-exhaustion falls below this (ms) |
| `otlpMetricsEndpoint` | string | — | OpenTelemetry OTLP endpoint for budget metrics |
| `otlpMetricsHeaders` | object | — | Custom headers for OTLP exporter |

## Comparison with manual integration

If you're already using the Cycles TypeScript client directly (see [Programmatic Client Usage](/how-to/using-the-cycles-client-programmatically)), the plugin automates the same reserve → commit → release pattern but at the OpenClaw hook level:

| Concern | Manual client | OpenClaw plugin |
|---------|--------------|-----------------|
| Reserve before LLM call | Your code | `before_model_resolve` hook |
| Reserve before tool call | Your code | `before_tool_call` hook |
| Commit after completion | Your code | `after_tool_call` hook |
| Release orphans | Your code | `agent_end` hook |
| Model downgrade on low budget | Your code | Automatic via `modelFallbacks` |
| Prompt budget awareness | Your code | Automatic via `injectPromptBudgetHint` |
| Cost breakdown tracking | Your code | Automatic per-tool/model tracking |
| Session analytics | Your code | Automatic via `analyticsWebhookUrl` |
| Tool access control | Your code | Automatic via `toolAllowlist` / `toolBlocklist` |

The plugin is the recommended approach for OpenClaw users — it requires zero custom code and covers the full lifecycle automatically.

## Config presets

Common starting configurations for typical deployment scenarios.

### Strict enforcement

For production agents handling real spend. Blocks on exhaustion, downgrades models, caps tool calls:

```json
{
  "plugins": {
    "entries": {
      "openclaw-budget-guard": {
        "config": {
          "tenant": "my-org",
          "failClosed": true,
          "lowBudgetStrategies": ["downgrade_model", "disable_expensive_tools", "limit_remaining_calls"],
          "modelFallbacks": {
            "anthropic/claude-opus-4-8": ["anthropic/claude-sonnet-4-6", "anthropic/claude-haiku-4-5-20251001"]
          },
          "modelBaseCosts": {
            "anthropic/claude-opus-4-8": 500000,
            "anthropic/claude-sonnet-4-6": 300000,
            "anthropic/claude-haiku-4-5-20251001": 100000
          },
          "toolBaseCosts": {
            "web_search": 500000,
            "code_execution": 1000000
          },
          "toolCallLimits": {
            "send_email": 10,
            "deploy": 3
          },
          "maxRemainingCallsWhenLow": 5
        }
      }
    }
  }
}
```

### Development / testing

Dry-run mode with generous budget. No Cycles server needed:

```json
{
  "plugins": {
    "entries": {
      "openclaw-budget-guard": {
        "config": {
          "tenant": "dev",
          "cyclesBaseUrl": "http://unused",
          "cyclesApiKey": "unused",
          "dryRun": true,
          "dryRunBudget": 500000000,
          "logLevel": "debug"
        }
      }
    }
  }
}
```

### Cost-conscious

Aggressive cost savings. Low thresholds, model downgrade with token limits, expensive tools disabled early:

```json
{
  "plugins": {
    "entries": {
      "openclaw-budget-guard": {
        "config": {
          "tenant": "my-org",
          "lowBudgetThreshold": 5000000,
          "exhaustedThreshold": 100000,
          "lowBudgetStrategies": ["downgrade_model", "reduce_max_tokens", "disable_expensive_tools"],
          "maxTokensWhenLow": 512,
          "expensiveToolThreshold": 200000,
          "modelFallbacks": {
            "anthropic/claude-opus-4-8": "anthropic/claude-haiku-4-5-20251001",
            "openai/gpt-4o": "openai/gpt-4o-mini"
          }
        }
      }
    }
  }
}
```

## Model cost reconciliation (v0.5.0)

Model costs are estimated at reservation time based on `modelBaseCosts` or `defaultModelCost`. Since OpenClaw doesn't provide token counts after model completion, exact per-call costs aren't available through the JSON-configured OpenClaw path.

v0.5.0 introduces the **reserve-then-commit** pattern for models: the plugin reserves budget in `before_model_resolve` but doesn't commit until the next `before_prompt_build` (or `agent_end` for the last turn). The reservation is committed at the estimated cost.

```json
{
  "config": {
    "modelBaseCosts": {
      "anthropic/claude-sonnet-4-6": 300000,
      "anthropic/claude-opus-4-8": 500000
    }
  }
}
```

Tune the numbers iteratively: enable `enableEventLog: true`, run representative sessions, and adjust `modelBaseCosts` using the per-model cost breakdown in the session summary. Reservations lock the estimate and commits charge the same value, so close-enough estimates are sufficient for enforcement.

::: info Precise per-call reconciliation
Token-accurate reconciliation via a `modelCostEstimator` callback is available only when consuming `cycles-openclaw-budget-guard` as an npm library in a custom agent framework — OpenClaw's JSON plugin config cannot carry JavaScript functions.
:::

## Observability with OTLP metrics (v0.5.0)

The plugin can emit structured metrics to any observability backend (Datadog, Prometheus, Grafana, OpenTelemetry) via the built-in OTLP HTTP adapter.

### Using the built-in OTLP adapter

For zero-config OpenTelemetry integration, set `otlpMetricsEndpoint`:

```json
{
  "config": {
    "otlpMetricsEndpoint": "http://localhost:4318/v1/metrics",
    "otlpMetricsHeaders": {
      "Authorization": "Bearer <token>"
    }
  }
}
```

The plugin auto-creates a lightweight OTLP HTTP adapter that buffers metrics and flushes them periodically. No OpenTelemetry SDK dependency required.

::: info Custom emitter
A programmatic `metricsEmitter` interface (`gauge` / `counter` / `histogram`) is available only when consuming `cycles-openclaw-budget-guard` as an npm library — OpenClaw's JSON plugin config cannot carry JavaScript functions. For OpenClaw deployments, point `otlpMetricsEndpoint` at your collector (most observability backends, including Datadog and Prometheus via a receiver, accept OTLP).
:::

### Emitted metrics

| Metric | Type | Tags | When |
|--------|------|------|------|
| `cycles.budget.remaining` | gauge | tenant, budgetScope keys, currency | Every snapshot fetch |
| `cycles.budget.reserved` | gauge | tenant, budgetScope keys | Every snapshot fetch |
| `cycles.budget.spent` | gauge | tenant, budgetScope keys | Every snapshot fetch |
| `cycles.budget.level` | gauge (0/1/2) | tenant, budgetScope keys, level | Every snapshot fetch |
| `cycles.reservation.created` | counter | tenant, kind, name | On reserve |
| `cycles.reservation.committed` | counter | tenant, kind, name | On commit |
| `cycles.reservation.denied` | counter | tenant, kind, name, reason | On deny |
| `cycles.reservation.cost` | histogram | tenant, kind, name | On commit |
| `cycles.model.downgrade` | counter | tenant, from, to | On model downgrade |
| `cycles.tool.blocked` | counter | tenant, tool, reason | On tool block |
| `cycles.session.duration_ms` | histogram | tenant | On agent_end |
| `cycles.session.total_cost` | histogram | tenant | On agent_end |
| `cycles.budget.burn_rate_anomaly` | counter | tenant, ratio | On burn rate spike (v0.6.0) |
| `cycles.budget.exhaustion_forecast_ms` | gauge | tenant | On exhaustion forecast (v0.6.0) |

## Aggressive cache invalidation (v0.5.0)

By default (`aggressiveCacheInvalidation: true`), the plugin refetches the budget snapshot from the Cycles server after every commit or release. This reduces the "stale window" from the `snapshotCacheTtlMs` (default 5s) to near-zero for single-agent scenarios.

For high-throughput setups where the extra network call is undesirable, disable it:

```json
{
  "config": {
    "aggressiveCacheInvalidation": false,
    "snapshotCacheTtlMs": 2000
  }
}
```

## Resilience: retry and heartbeat (v0.6.0)

### Automatic retry on transient errors

The plugin retries Cycles server requests on transient HTTP errors (429, 503, 504) with exponential backoff:

```json
{
  "config": {
    "retryableStatusCodes": [429, 503, 504],
    "transientRetryMaxAttempts": 2,
    "transientRetryBaseDelayMs": 500
  }
}
```

With default settings, a 429 response triggers up to 2 retries with 500ms and 1000ms delays. The plugin builds one request body and idempotency key for the logical reservation, then reuses both across those transport retries. A successful retry therefore resolves to the same idempotent reservation operation rather than creating a second hold.

### Heartbeat for long-running tools

Tools that run longer than the reservation TTL (default 60s) previously lost cost tracking silently. v0.6.0 auto-extends reservations:

```json
{
  "config": {
    "heartbeatIntervalMs": 30000
  }
}
```

Every 30 seconds, the plugin calls the Cycles `extend` endpoint to keep the reservation alive. The timer is automatically stopped when the tool completes or at `agent_end`. Set to `0` to disable.

## Anomaly detection (v0.6.0)

### Burn rate monitoring

Detect runaway tool loops by monitoring cost-per-window:

```json
{
  "config": {
    "burnRateWindowMs": 60000,
    "burnRateAlertThreshold": 3.0
  }
}
```

If the cost rate in the current window exceeds 3x the previous window, the plugin emits the `cycles.budget.burn_rate_anomaly` counter (tagged with `currentBurnRate`, `averageBurnRate`, `ratio`, `threshold`, and `remaining`). Wire alerts to this metric in your OTLP-connected backend (Datadog, Prometheus, Grafana) to page on runaway loops.

### Predictive exhaustion warning

Get advance notice before budget runs out:

```json
{
  "config": {
    "exhaustionWarningThresholdMs": 120000
  }
}
```

When estimated time-to-exhaustion drops below 120 seconds (based on current burn rate), the plugin emits the `cycles.budget.exhaustion_forecast_ms` gauge. The warning fires once per session. Alert on this gauge in your OTLP-connected backend to trigger a top-up or graceful wind-down.

## Session event log (v0.6.0)

Enable a session log of the plugin's budget decisions:

```json
{
  "config": {
    "enableEventLog": true
  }
}
```

When enabled, `sessionSummary.eventLog` contains every reserve, commit, deny, block, and release event with timestamps, budget levels, and amounts. The log is capped at 10,000 entries. Useful for debugging budget exhaustion and understanding agent behavior.

Example event:
```json
{
  "timestamp": 1711468850000,
  "hook": "before_tool_call",
  "action": "reserve",
  "kind": "tool",
  "name": "web_search",
  "amount": 500000,
  "decision": "ALLOW",
  "budgetLevel": "healthy",
  "remaining": 45000000
}
```

The session summary also includes `unconfiguredTools` — a list of tools that used the default cost estimate (100,000 units) because they had no entry in `toolBaseCosts`. Use this to identify configuration gaps.

## Model blocking workaround (v0.7.3)

OpenClaw's `before_model_resolve` hook does not support `{ block: true }` like `before_tool_call` does ([feature request](https://github.com/openclaw/openclaw/issues/55771)). When budget is exhausted, the plugin cannot directly prevent the model call.

**Workaround:** The plugin returns `{ modelOverride: "__cycles_budget_exhausted__" }`, which causes the LLM provider to reject the request with "Unknown model." The agent receives no response and no budget is spent.

The user sees:
```
Agent failed before reply: Unknown model: openai/__cycles_budget_exhausted__
```

This is intentional. When OpenClaw adds `block` support to `before_model_resolve`, the plugin will switch to a clean blocking mechanism with a proper error message.

**Note:** OpenClaw's `before_model_resolve` event also does not include the model name — it only passes `{ prompt }`. Set `defaultModelName` in your plugin config so the plugin knows which model to track:

```json
{
  "config": {
    "defaultModelName": "openai/gpt-5-nano"
  }
}
```

## What to do when budget is exhausted

1. **Fund the budget** via the Cycles Admin API:
   ```bash
   curl -X POST "http://localhost:7979/v1/admin/budgets/fund?scope=tenant:my-org&unit=USD_MICROCENTS" \
     -H "X-Cycles-API-Key: your-tenant-key" \
     -H "Content-Type: application/json" \
     -d '{"operation": "CREDIT", "amount": {"amount": 50000000, "unit": "USD_MICROCENTS"}, "idempotency_key": "topup-001"}'
   ```
   This adds 50,000,000 units ($0.50) to the budget. Adjust the `scope` to match your `tenant` and `budgetScope`.

2. **Start a new agent session** — the plugin fetches fresh budget state at the start of each session.

For details, see [Budget Allocation and Management](/how-to/budget-allocation-and-management-in-cycles).

## Troubleshooting

**"Skipping registration" warning during install**
- This is normal. OpenClaw loads the plugin during install before your config is written. The plugin detects the missing config, logs a warning, and skips registration. After you add your config and restart the gateway, the plugin will register normally.

**Plugin not loading**
- Verify the plugin is enabled: `openclaw plugins list`
- Check that `openclaw.plugin.json` is included in the installed package

**"cyclesBaseUrl is required" error**
- Set `cyclesBaseUrl` in your plugin config (use `"${CYCLES_BASE_URL}"` for env var interpolation)

**"tenant is required" error**
- Add `"tenant": "your-org"` to the plugin config

**Budget always shows "healthy"**
- Verify `currency`, `tenant`, and `budgetScope` match your Cycles setup
- Set `logLevel: "debug"` to see raw balance responses

**Tools not being blocked**
- Check `toolBaseCosts` includes your tool (default cost is 100,000 units)
- Check `failClosed` is `true` (default)

**"No toolBaseCosts configured" warning**
- This is informational. Without `toolBaseCosts`, all tools use the default cost estimate (100,000 units). Add entries for your tools to improve budgeting accuracy.

**Model not being downgraded**
- The exact model name must match a key in `modelFallbacks`
- Check model costs in `modelBaseCosts` — fallback must be cheaper than remaining budget
- If you see "no modelFallbacks configured" warning, add a `modelFallbacks` entry

## Next steps

- [Degradation Paths](/how-to/how-to-think-about-degradation-paths-in-cycles-deny-downgrade-disable-or-defer) — strategies beyond simple model downgrade
- [Estimate Exposure Before Execution](/how-to/how-to-estimate-exposure-before-execution-practical-reservation-strategies-for-cycles) — how to set `toolBaseCosts` effectively
- [Shadow Mode](/how-to/shadow-mode-in-cycles-how-to-roll-out-budget-enforcement-without-breaking-production) — roll out enforcement without breaking production
- [Runaway Agents and Tool Loops](/incidents/runaway-agents-tool-loops-and-budget-overruns-the-incidents-cycles-is-designed-to-prevent) — the incidents this plugin helps prevent
