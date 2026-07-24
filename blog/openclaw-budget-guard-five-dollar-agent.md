---
title: "We Gave Our OpenClaw Agent a $5 Budget"
date: 2026-03-28
author: Albert Mavashev
tags: [openclaw, budgets, agents, graceful-degradation, model-downgrade, production, cost-control, ai-agent-cost, llm-cost-management]
description: "A constructed OpenClaw walkthrough showing how a $5 Cycles budget can downgrade models, disable expensive tools, and stop new work safely before the cap."
blog: true
sidebar: false
head:
  - - meta
    - name: keywords
      content: OpenClaw budget, five dollar agent, model downgrade, graceful degradation, AI agent cost control, Cycles Budget Guard
---

# We Gave Our OpenClaw Agent a $5 Budget and Watched It Adapt

Too many AI agent cost controls are kill switches. Budget runs out, agent dies mid-task, user gets nothing. [Cycles](https://runcycles.io) does something different: it makes the agent *adapt*.

A research agent running on OpenClaw picks up a complex competitive analysis. It starts with Claude Opus to draft the report, calls web search to find market data, runs code execution to build charts, and iterates. Normal sessions cost $2–4. This one is harder — it needs 3x the usual tool calls.

Without budget enforcement, the session would have cost roughly $12. The agent doesn't know or care. It calls whatever model and tool the task needs, and the bill arrives later.

We set a $5 budget using the [`cycles-openclaw-budget-guard`](https://github.com/runcycles/cycles-openclaw-budget-guard) plugin and let it run. It didn't stop. It *adapted*.

When the session crossed the $1.50 low-budget threshold, the plugin downgraded from Opus to Sonnet. As budget tightened further, it blocked expensive tools like code execution and injected budget hints into the system prompt. The model responded by writing shorter outputs and skipping optional searches. The task finished with $0.15 remaining — $4.85 total instead of $12.

That's the difference between a kill switch and [runtime authority](/blog/what-is-runtime-authority-for-ai-agents).

> **TL;DR:** Configure the plugin with a budget, model fallbacks, and tool-cost estimates, and it can downgrade models or block expensive tools before the cap is exhausted.

*Note: This is a constructed walkthrough using real plugin fields and control paths. The costs and session behavior are illustrative, not provider billing data or a measured production incident.*

<!-- more -->

## What the logs looked like

Here is representative plugin output for the walkthrough, at info level:

```
Cycles Budget Guard for OpenClaw v0.7.5
  tenant: research-team
  defaultModelName: anthropic/claude-opus-4-8
  failClosed: true
  lowBudgetThreshold: 150000000

Model reserved: anthropic/claude-opus-4-8 (estimate=5000000, remaining=500000000)
Model committed: anthropic/claude-opus-4-8 (cost=5000000 USD_MICROCENTS)
Tool reserved: web_search (estimate=5000000, remaining=495000000)
Tool committed: web_search (cost=5000000 USD_MICROCENTS)
Model reserved: anthropic/claude-opus-4-8 (estimate=5000000, remaining=490000000)
Model committed: anthropic/claude-opus-4-8 (cost=5000000 USD_MICROCENTS)
...
Budget level changed: healthy → low (remaining=150000000)
Budget low — downgrading model anthropic/claude-opus-4-8 → anthropic/claude-sonnet-4-6
Model reserved: anthropic/claude-sonnet-4-6 (estimate=3000000, remaining=147000000)
...
Tool "code_execution" blocked: cost 10000000 exceeds expensive threshold 5000000
...
Model committed: anthropic/claude-sonnet-4-6 (cost=3000000 USD_MICROCENTS)
Agent session budget summary: remaining=15000000 spent=485000000 reservations=72
```

Every [reservation](/glossary#reservation), commit, downgrade, and block is visible. No digging through provider dashboards. This is what AI agent cost management looks like when it's built into the execution lifecycle — not bolted on after the fact.

## What the agent saw

When budget first crossed the `lowBudgetThreshold` ($1.50), the plugin triggered model downgrade and tool blocking. Later in the same session, with only 7% of budget remaining, the plugin injected this into the system prompt:

```
Budget: 35000000 USD_MICROCENTS remaining. Budget is low — prefer cheaper models
and avoid expensive tools. 7% of budget remaining. Est. ~11 tool calls and
~3 model calls remaining at current rate. Limit responses to 1024 tokens.
```

In this walkthrough, the model responds to this signal by reducing optional web searches, writing tighter prose, and skipping an optional summary. That response is illustrative: prompt hints can influence model behavior, but they are not an enforcement guarantee.

The hard control remains the reservation and tool policy. The prompt hint is only a soft signal that may help a model wind down gracefully.

## What the session summary can tell you

The excerpt below shows selected fields; additional component entries are omitted, so the visible subtotals do not add up to the full `spent` value.

```json
{
  "remaining": 15000000,
  "spent": 485000000,
  "costBreakdown": {
    "model:anthropic/claude-opus-4-8": { "count": 8, "totalCost": 40000000 },
    "model:anthropic/claude-sonnet-4-6": { "count": 14, "totalCost": 42000000 },
    "tool:web_search": { "count": 9, "totalCost": 45000000 },
    "tool:code_execution": { "count": 3, "totalCost": 30000000 }
  },
  "unconfiguredTools": [
    { "name": "read_file", "callCount": 4, "estimatedTotalCost": 4000000 }
  ]
}
```

Three things jumped out:

1. **The configured Opus estimate was $0.05 per call; Sonnet was $0.03.** The summary exposes the actual call mix and the estimates the plugin committed. It does not establish equivalent model quality or reproduce the provider bill.

2. **Code execution was blocked after 3 calls.** Each call cost $0.10. The `disable_expensive_tools` strategy kicked in at low budget. The agent compensated by describing the analysis in text instead of generating charts.

3. **`read_file` was unconfigured.** The session summary flagged it — 4 calls using the default estimate. Now we know to add it to `toolBaseCosts`.

## Three patterns we observed

The walkthrough highlights three operating patterns worth testing on your own workload.

### Model downgrade is a controlled tradeoff, not a quality guarantee

In this configuration, the fixed Sonnet estimate is 40% lower than the Opus estimate. Whether the quality tradeoff is acceptable depends on the task and must be evaluated with your own outputs.

The key is configuring the fallback chain correctly. `"anthropic/claude-opus-4-8": ["anthropic/claude-sonnet-4-6", "anthropic/claude-haiku-4-5-20251001"]` gives the plugin two steps to try. It picks the lowest configured estimate that fits within the remaining budget.

### Tool limits catch more bugs than budget limits

A `toolCallLimits: { "web_search": 20 }` caught a search loop that budget enforcement alone would have allowed to continue. Each search cost $0.05 — cheap individually, but 200 of them would have burned $10 on a single tool. The limit fired at call #21 and the agent adapted by working with the data it already had.

### The session summary is your tuning guide

Every session produces a cost breakdown. After a few days, patterns are obvious: which tools are overpriced in your estimates, which models are being downgraded too aggressively, which tools need explicit `toolCallLimits`. The `unconfiguredTools` list is a concrete TODO — no guessing about what to configure next.

## What we'd change

Three things we learned the hard way:

**Enable `enableEventLog` from day one.** When a session behaves unexpectedly, the event log records the plugin's budget sequence—which tools it blocked, when it selected a fallback, and why a reservation was denied. It does not replace OpenClaw or provider logs for tool arguments, model output, or external outcomes.

**Model costs are estimates.** The plugin reserves a fixed amount per model call regardless of how many [tokens](/glossary#tokens) are actually used. A short response costs the same as a long one. The `modelCostEstimator` callback can improve this if you have a proxy that tracks token usage; otherwise, compare estimates with provider telemetry and tune them for your workload.

**OpenClaw doesn't pass the model name in hook events.** We had to add `defaultModelName` to the config because the `before_model_resolve` event only contains `{ prompt }`. We've filed a [feature request](https://github.com/openclaw/openclaw/issues/55771) — until it's resolved, set `defaultModelName` to your agent's model.

## The config that made it work

```json
{
  "plugins": {
    "entries": {
      "openclaw-budget-guard": {
        "config": {
          "cyclesBaseUrl": "${CYCLES_BASE_URL}",
          "cyclesApiKey": "${CYCLES_API_KEY}",
          "tenant": "research-team",
          "defaultModelName": "anthropic/claude-opus-4-8",
          "modelFallbacks": {
            "anthropic/claude-opus-4-8": ["anthropic/claude-sonnet-4-6", "anthropic/claude-haiku-4-5-20251001"]
          },
          "modelBaseCosts": {
            "anthropic/claude-opus-4-8": 5000000,
            "anthropic/claude-sonnet-4-6": 3000000,
            "anthropic/claude-haiku-4-5-20251001": 1000000
          },
          "toolBaseCosts": {
            "web_search": 5000000,
            "code_execution": 10000000,
            "read_file": 1000000
          },
          "toolCallLimits": {
            "web_search": 20,
            "code_execution": 10
          },
          "lowBudgetStrategies": ["downgrade_model", "reduce_max_tokens", "disable_expensive_tools"],
          "maxTokensWhenLow": 1024,
          "expensiveToolThreshold": 5000000,
          "lowBudgetThreshold": 150000000,
          "failClosed": true
        }
      }
    }
  }
}
```

> **New to Cycles?** [Cycles](https://runcycles.io) is an open-source [runtime authority](/glossary#runtime-authority) system for AI agents. It enforces budgets, action limits, and resource boundaries — before execution, not after. The [`cycles-openclaw-budget-guard`](https://github.com/runcycles/cycles-openclaw-budget-guard) plugin brings Cycles to OpenClaw without changing agent logic. See [What is Cycles?](/quickstart/what-is-cycles) to learn more.

## Try it

```bash
openclaw plugins install @runcycles/openclaw-budget-guard
```

Start with [dry-run mode](/how-to/integrating-cycles-with-openclaw#dry-run-mode) to see degradation without a [Cycles server](/glossary#cycles-server). Then [deploy the full stack](/quickstart/deploying-the-full-cycles-stack) and watch your agent adapt instead of crash. Full documentation: [Integrating Cycles with OpenClaw](/how-to/integrating-cycles-with-openclaw). Source: [github.com/runcycles/cycles-openclaw-budget-guard](https://github.com/runcycles/cycles-openclaw-budget-guard).

## Related reading

- [Your OpenClaw Agent Has No Spending Limit — Here's How to Fix That](/blog/openclaw-budget-guard-stop-agents-burning-money) — the first post in this series, covering the five problems the plugin solves
- [Your AI Agent Just Burned $6 in 30 Seconds](/blog/runaway-demo-agent-cost-blowup-walkthrough) — step-by-step walkthrough of a runaway agent demo with Cycles
- [AI Agent Budget Control: Enforce Hard Spend Limits](/blog/ai-agent-budget-control-enforce-hard-spend-limits) — why cost control must happen before execution
- [Degradation Paths in Cycles](/how-to/how-to-think-about-degradation-paths-in-cycles-deny-downgrade-disable-or-defer) — deny, downgrade, disable, or defer
- [How Much Do AI Agents Cost?](/blog/how-much-do-ai-agents-cost) — the economics of agent execution
