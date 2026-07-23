---
title: "Five Lessons from a Production OpenClaw Plugin"
date: 2026-03-28
author: Albert Mavashev
tags: [openclaw, plugins, engineering, hooks, workarounds, developer-experience, production, openclaw-plugin-development]
description: "Five implementation lessons from building an OpenClaw budget plugin: model-call blocking limits, hook metadata gaps, config traps, and safe workarounds."
blog: true
sidebar: false
head:
  - - meta
    - name: keywords
      content: OpenClaw plugin development, OpenClaw hooks, budget plugin, agent cost control, plugin workarounds, production agents
---

# Five Lessons from Building a Production OpenClaw Plugin

We built a non-trivial [budget enforcement plugin](https://github.com/runcycles/cycles-openclaw-budget-guard) for OpenClaw and ran into several behaviors that were not obvious from the public plugin surface: missing model metadata, no clean way to block model calls, install-time config validation traps, and a security-scanner false positive. The most surprising discovery: OpenClaw's `before_model_resolve` hook has no way to prevent a model call — we had to redirect to a fake model name to force a provider-side rejection.

This post is a practical writeup of the five issues that mattered most, the workarounds we shipped, and the feature requests we filed.

*None of this is a complaint about OpenClaw. The platform is well-designed and the hook lifecycle is the right abstraction. These are field notes from building a production plugin, shared so other developers don't have to rediscover the same things.*

<!-- more -->

## Lesson 1: The model name isn't in the model resolve event

The `before_model_resolve` hook is called before the LLM provider is invoked. You'd expect the event to include which model is being resolved. It doesn't.

```typescript
// What we expected
interface BeforeModelResolveEvent {
  model: string;
  prompt: string;
}

// What OpenClaw actually passes
interface BeforeModelResolveEvent {
  prompt: string;  // that's it
}
```

We discovered this by logging `Object.keys(event)` — which returned `["prompt"]`. No `model`, `modelId`, `modelName`, `model_id`, or any variant.

**Why it matters:** Our plugin needs the model name to look up per-model cost estimates, apply fallback chains (Opus → Sonnet → Haiku), and track per-model spend in the session summary. Without it, budget enforcement for models is blind.

**Workaround:** We added a `defaultModelName` config property and a multi-source auto-detection chain that checks `api.config`, `api.pluginConfig`, and several nested paths:

```typescript
const eventModel = event.model
  ?? (event as Record<string, unknown>).modelId
  ?? (event as Record<string, unknown>).modelName
  ?? (ctx.metadata as Record<string, unknown>)?.model
  ?? config.defaultModelName;
```

If none of those resolve, the plugin logs the available keys at info level so operators can configure `defaultModelName`:

```
before_model_resolve: cannot determine model name.
Event keys: [prompt]. Metadata keys: [].
Set defaultModelName in plugin config.
```

**Feature request:** [openclaw/openclaw#55771](https://github.com/openclaw/openclaw/issues/55771) — include `model` and `provider` in the `before_model_resolve` event.

## Lesson 2: You can't cleanly block a model call

OpenClaw's `before_tool_call` hook has clean blocking semantics:

```typescript
// Tool hooks support this — works perfectly
return { block: true, blockReason: "Budget exhausted" };
```

The `before_model_resolve` hook has no equivalent. The return type only supports `{ modelOverride?, providerOverride? }`. There is no `block` field and no `shouldStop` policy in the hook runner.

Our first implementation threw `BudgetExhaustedError`. OpenClaw caught it (the default `catchErrors: true` behavior), logged "handler failed," and proceeded with the model call. The agent got a response, so that implementation did not enforce the budget.

**Workaround:** We redirect to a non-existent model. When budget is exhausted, the plugin returns:

```typescript
return { modelOverride: "__cycles_budget_exhausted__" };
```

OpenClaw passes this to the LLM provider, which rejects it (`model not found`). The provider rejects the call before generation, so the agent produces no response. The user sees:

```
Agent failed before reply: Unknown model: openai/__cycles_budget_exhausted__
```

Not pretty, but the budget is enforced. The model call costs nothing because the provider never executes it.

**Feature request:** We've asked for `block` support in `before_model_resolve`, matching the `before_tool_call` pattern.

## Lesson 3: Your plugin initializes multiple times

A smaller but confusing runtime behavior: OpenClaw calls the plugin's default export once per internal channel or worker — typically 4–5 times on startup. Each instance gets its own isolated state, which is correct for concurrency. But our startup banner printed 5 times and it looked broken.

**Workaround:** A module-level `startupBannerShown` flag shows the full config banner once; subsequent inits get a one-liner with a sequential instance counter: `Cycles Budget Guard initialized (tenant=cyclist, dryRun=false, instance=3)`.

## Lesson 4: process.env triggers a security warning

OpenClaw's plugin installer scans the bundled `dist/index.js` for dangerous code patterns. Our plugin read `process.env.CYCLES_API_KEY` as a config fallback, and the same bundle contained `fetch()` calls for [webhook delivery](/glossary#webhook-delivery) and OTLP metrics.

The scanner flagged this combination:

```
WARNING: Plugin "openclaw-budget-guard" contains dangerous code patterns:
Environment variable access combined with network send — possible
credential harvesting
```

This is a false positive — we read the API key to authenticate with the [Cycles server](/glossary#cycles-server), not to exfiltrate it. But users see "dangerous code patterns" during `openclaw plugins install` and understandably hesitate.

**Workaround:** We removed all `process.env` access from the plugin. Both `cyclesBaseUrl` and `cyclesApiKey` are now required in the plugin config. For secrets management, we document OpenClaw's built-in env var interpolation:

```json
{
  "cyclesBaseUrl": "${CYCLES_BASE_URL}",
  "cyclesApiKey": "${CYCLES_API_KEY}"
}
```

OpenClaw resolves `${...}` before passing config to the plugin, so the env var access happens in OpenClaw's trusted code — not in the scanned plugin bundle.

Verification: `grep -c process.env dist/index.js` returns `0`.

## Lesson 5: The plugin contract has undocumented rules

Several behaviors of the OpenClaw plugin system are not documented but are critical to get right:

**`api.pluginConfig` vs `api.config`:** Your plugin config is on `api.pluginConfig` (from `plugins.entries.<id>.config` in `openclaw.json`). We initially read `api.config` — which is the *full system config* — and couldn't figure out why our settings were always undefined.

**Manifest `id` derivation:** The `id` field in `openclaw.plugin.json` must match what OpenClaw derives from the npm package name. For `@runcycles/openclaw-budget-guard`, OpenClaw strips the scope and gets `openclaw-budget-guard`. Our manifest originally said `cycles-openclaw-budget-guard` — a mismatch warning on every load.

**Config validation timing:** If your `configSchema` includes `required` fields, OpenClaw validates during `openclaw plugins install` — before the user has written any config. We had `required: ["tenant"]` which crashed the install. Fix: remove `required` from the schema and validate at runtime in your `resolveConfig()`.

**Install-time loading:** OpenClaw loads and executes the plugin during install to inspect it. If your plugin throws on missing config, the install fails with a confusing error. Wrap your initialization in try/catch and log a friendly message:

```typescript
try {
  config = resolveConfig(raw);
} catch (err) {
  api.logger.warn(`[openclaw-budget-guard] Skipping registration: ${err.message}`);
  return;
}
```

## What OpenClaw gets right

This post focuses on rough edges, but the foundation is solid:

- **The 5-hook lifecycle is well-designed.** `before_model_resolve` → `before_prompt_build` → `before_tool_call` → `after_tool_call` → `agent_end` covers the full agent execution lifecycle. You can build meaningful enforcement without modifying agent code.
- **`before_tool_call` blocking is clean.** `{ block: true, blockReason }` with `shouldStop` is exactly the right pattern. We just want the same for model calls.
- **Plugin isolation per channel is correct.** Each channel gets its own plugin instance with its own state. No shared-state bugs across concurrent sessions.
- **`api.logger` integration works well.** Plugin log output appears in OpenClaw's log stream with proper prefixes and levels.
- **The install/enable flow is simple.** `openclaw plugins install` + `openclaw plugins enable` — two commands and you're running.

## What we'd like to see

These are filed or planned feature requests:

1. **`block` support in `before_model_resolve`** — same pattern as `before_tool_call`
2. **Model name in `before_model_resolve` event** — `event.model` and `event.provider` ([#55771](https://github.com/openclaw/openclaw/issues/55771))
3. **`after_model_call` hook** — with `tokensInput`, `tokensOutput`, `latencyMs` for actual cost tracking
4. **Channel/worker ID on the `api` object** — so plugins can differentiate instances in logs
5. **Plugin contract documentation** — `api.pluginConfig` vs `api.config`, manifest `id` rules, config validation timing, install-time behavior

## Build your own

If you're building an OpenClaw plugin, start with our source as a reference: [github.com/runcycles/cycles-openclaw-budget-guard](https://github.com/runcycles/cycles-openclaw-budget-guard). The patterns for config resolution, hook registration, state management, and error handling are all used in our released plugin.

Full integration guide: [Integrating Cycles with OpenClaw](/how-to/integrating-cycles-with-openclaw)

## Related reading

- [We Gave Our OpenClaw Agent a $5 Budget and Watched It Adapt](/blog/openclaw-budget-guard-five-dollar-agent) — what [graceful degradation](/glossary#graceful-degradation) looks like in practice
- [Your OpenClaw Agent Has No Spending Limit](/blog/openclaw-budget-guard-stop-agents-burning-money) — the five problems the plugin solves
- [Action Authority: Controlling What Agents Do](/concepts/action-authority-controlling-what-agents-do) — why cost limits alone aren't enough

## Related how-to guides

- [Webhook integrations](/how-to/webhook-integrations)
- [API key management](/how-to/api-key-management-in-cycles)
- [Integrating with OpenAI](/how-to/integrating-cycles-with-openai)
