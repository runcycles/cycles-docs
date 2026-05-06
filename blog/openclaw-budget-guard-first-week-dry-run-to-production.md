---
title: "Your First Week with Cycles Budget Guard for OpenClaw"
date: 2026-05-06
author: Albert Mavashev
tags: [openclaw, budgets, agents, production, operations, dry-run, cost-control, best-practices]
description: "An operator playbook for the first week after installing cycles-openclaw-budget-guard. Five days of dry-run, then a signal-driven cutover to failClosed."
blog: true
sidebar: false
featured: false
---

# Your First Week with Cycles Budget Guard for OpenClaw

You ran `openclaw plugins install @runcycles/openclaw-budget-guard`. You enabled it. You opened `openclaw.json` to fill in the config and stalled out — the typical examples set `failClosed: true` with carefully tuned `toolBaseCosts` and `modelBaseCosts`, and you don't have those numbers yet because you haven't run anything in production. Picking them blind is how teams end up rolling back enforcement on day one.

This post is the day-2 playbook. The earlier OpenClaw posts cover the *why* ([Your OpenClaw Agent Has No Spending Limit](/blog/openclaw-budget-guard-stop-agents-burning-money)), the *what [graceful degradation](/glossary#graceful-degradation) looks like* ([the $5 budget walkthrough](/blog/openclaw-budget-guard-five-dollar-agent)), and the *plugin-author internals* ([Five Lessons](/blog/openclaw-plugin-lessons-learned)). They all stop at the moment of install. This one picks up there: five steps, six days, dry-run to `failClosed`, every config value derived from your own session data instead of guessed.

<!-- more -->

## The principle: don't tune what you haven't observed

The plugin's `toolBaseCosts`, `modelBaseCosts`, `toolCallLimits`, and `lowBudgetThreshold` aren't independent knobs. They're a fitted curve to your workload. The agent that reads PDFs all day has different `toolCallLimits` than the agent that drafts emails. The team running mostly Sonnet has a different `lowBudgetThreshold` than the team running mostly Opus. A config copied from someone else's blog post is a config copied from someone else's traffic.

The cure is to flip the order. Run in dry-run with the event log on, *then* derive the numbers, *then* turn on enforcement. This is the same pattern the [shadow-to-enforcement decision tree](/blog/shadow-to-enforcement-cutover-decision-tree) applies generally — applied here specifically to the OpenClaw plugin's surface.

## Day 1: Dry-run with the event log on

Start with the smallest config that produces useful data:

```json
{
  "plugins": {
    "entries": {
      "openclaw-budget-guard": {
        "config": {
          "tenant": "your-tenant",
          "cyclesBaseUrl": "http://unused",
          "cyclesApiKey": "unused",
          "dryRun": true,
          "dryRunBudget": 1000000000,
          "enableEventLog": true,
          "logLevel": "info",
          "defaultModelName": "anthropic/claude-sonnet-4-20250514"
        }
      }
    }
  }
}
```

Three things matter here:

- **`dryRun: true` with a large `dryRunBudget`.** Budget is tracked in-memory; nothing is enforced. Set the budget high enough that you won't trigger low-budget mode by accident — at this stage, you want to see what *natural* spend looks like, not what degradation looks like.
- **`enableEventLog: true`.** Every reserve, commit, downgrade, and decision is logged. Without it, the session summary tells you the totals but not the path that produced them.
- **`defaultModelName`.** Per [Lesson 1](/blog/openclaw-plugin-lessons-learned), OpenClaw's `before_model_resolve` event doesn't include the model name. Set `defaultModelName` to whatever your agent actually uses, or every model call shows up unattributed.

Run normally for a day. Don't tune. Don't flip switches. Just collect.

## Day 2–3: Read the session summary and derive cost estimates

At `agent_end`, the plugin attaches a `SessionSummary` to `ctx.metadata["openclaw-budget-guard"]` and prints it in the log when `enableEventLog` is on. The shape from a representative session looks like:

```json
{
  "remaining": 850000000,
  "spent": 150000000,
  "costBreakdown": {
    "model:anthropic/claude-sonnet-4-20250514": { "count": 22, "totalCost": 66000000 },
    "model:anthropic/claude-opus-4-20250514":   { "count": 4,  "totalCost": 60000000 },
    "tool:web_search":     { "count": 12, "totalCost": 12000000 },
    "tool:code_execution": { "count": 3,  "totalCost": 6000000 },
    "tool:read_file":      { "count": 18, "totalCost": 1800000 }
  },
  "unconfiguredTools": [
    { "name": "read_file",        "callCount": 18, "estimatedTotalCost": 1800000 },
    { "name": "format_markdown",  "callCount": 9,  "estimatedTotalCost": 900000 }
  ]
}
```

Two things to do with this:

**Promote `unconfiguredTools` into `toolBaseCosts`.** Every entry in that list is a tool that fell back to the plugin's default estimate (`100000` [USD_MICROCENTS](/glossary#usd-microcents), per the [integration reference](/how-to/integrating-cycles-with-openclaw#tool-cost-estimation)). The default is rarely right. For each entry, decide a more accurate estimate:

| Tool category | Reasonable starting estimate (USD_MICROCENTS) |
|---|---|
| Local file read / format / math | 10,000 – 50,000 |
| In-process compute, no I/O | 50,000 – 200,000 |
| External API (search, scrape, single call) | 500,000 – 2,000,000 |
| Code execution sandbox | 1,000,000 – 10,000,000 |
| LLM-as-tool (sub-agent, summarizer) | priced like a model call |

The integration guide gives the same band: `"External API tools (web search, code execution) typically cost 500K-1M. Lightweight tools (text formatting, math) cost 10K-50K."` Start at the low end of each band. The plugin's session summaries will tell you over the next couple of days whether you under-estimated.

**Confirm or update `modelBaseCosts`.** The plugin reserves a fixed amount per model call regardless of token count, and the [$5 walkthrough](/blog/openclaw-budget-guard-five-dollar-agent) flagged that this produces ±20% variance. That's fine for budget *enforcement* — you're approximating, not billing — but the estimates need to be in the right ballpark relative to each other or `downgrade_model` won't pick the right fallback. A rough Anthropic-pricing-anchored ratio:

| Model | Starting estimate (USD_MICROCENTS) |
|---|---|
| Claude Opus 4 | 15,000,000 |
| Claude Sonnet 4 | 3,000,000 |
| Claude Haiku 4.5 | 1,000,000 |

These are *per-call* averages, not per-token. Adjust upward if your prompts run long. After a few sessions, divide each model's `totalCost` by `count` from the session summary — that's your observed average — and update `modelBaseCosts` to match.

A concrete fitted config after day 3 looks like:

```json
{
  "modelBaseCosts": {
    "anthropic/claude-opus-4-20250514":   15000000,
    "anthropic/claude-sonnet-4-20250514": 3000000,
    "anthropic/claude-haiku-4-5-20251001": 1000000
  },
  "modelFallbacks": {
    "anthropic/claude-opus-4-20250514": ["anthropic/claude-sonnet-4-20250514", "anthropic/claude-haiku-4-5-20251001"]
  },
  "toolBaseCosts": {
    "web_search":      1000000,
    "code_execution":  5000000,
    "read_file":         50000,
    "format_markdown":   10000
  }
}
```

Don't enforce yet. Re-run with this config in dry-run for another day and watch `unconfiguredTools` shrink toward empty.

## Day 4: Set `toolCallLimits` from observed call counts

`toolBaseCosts` controls *spend*. `toolCallLimits` controls *side-effects*. They're independent knobs and you need both — an agent can exhaust budget without hitting call limits, or hit call limits while well under budget. The integration guide's [tip on this](/how-to/integrating-cycles-with-openclaw#tool-call-limits) is worth reading in place; the short version is that `send_email: 10` blocks the eleventh email regardless of how cheap email is.

Pull invocation counts from the session summaries you've collected. For each consequential tool — anything that writes, sends, deploys, or calls a paid third-party API — pick a limit at roughly **the p95 of observed call counts, not the mean**. The mean represents normal behavior; the p95 represents the upper bound of what your healthy sessions actually do. Anything above p95 is more likely a [tool loop](/glossary#tool-loop) than legitimate work.

| Tool kind | Suggested limit shape |
|---|---|
| `send_email`, `post_message`, `notify` | Tight — single-digit caps; over-sending is almost always a bug |
| `deploy`, `create_resource`, `delete_*` | Tight — caps at or near 1; rare-by-design |
| `web_search`, `read_url` | Generous — 20–50; agents legitimately search a lot, but a runaway hits the cap before the budget |
| `read_file`, `format_*`, in-process tools | Usually no limit needed; budget catches loops indirectly |

The pattern is: **tight on side-effects, generous on reads, none on cheap utilities.** The first two categories are where blast radius lives.

A worked example from the session above (`web_search: 12 calls`, `code_execution: 3 calls`) might land on:

```json
{
  "toolCallLimits": {
    "web_search":     25,
    "code_execution": 10,
    "send_email":      5,
    "deploy":          2
  }
}
```

The `web_search` cap is roughly 2× the observed call count; `code_execution` is ~3×; the `send_email` and `deploy` limits are policy, not data, because you weren't using those tools in shadow. As more sessions accumulate, switch to the actual p95 across sessions instead of a single-session multiplier.

## Day 5: Pick `lowBudgetThreshold` from your spend curve

`lowBudgetThreshold` is the inflection point where the plugin switches from "pass everything through" to "apply degradation strategies" ([reference](/how-to/integrating-cycles-with-openclaw#budget-levels-and-model-downgrading)). The default is 10,000,000 USD_MICROCENTS ($0.10). For most production workloads the default is too low — by the time you're $0.10 from the wall, there's no runway left for `downgrade_model` to do meaningful work.

A useful heuristic: set `lowBudgetThreshold` to **roughly the cost of the most expensive 5–10 calls you'd want to gracefully complete** under degradation. If your typical Opus call is $0.15, ten of them is $1.50 — that's your threshold. The agent crosses into low-budget mode early enough to actually adapt.

Read this off your event log. With `enableEventLog: true`, every [reservation](/glossary#reservation) logs the running balance:

```
Model reserved: anthropic/claude-sonnet-4-20250514 (estimate=3000000, remaining=147000000)
```

Look at the `remaining` values across a representative session. The threshold you want is somewhere between *"agent is two thirds done"* and *"agent has one Opus call left"*. That's where degradation has time to matter.

Then pick the strategies. The conservative starting set is:

```json
{
  "lowBudgetStrategies": ["downgrade_model", "reduce_max_tokens", "disable_expensive_tools"],
  "maxTokensWhenLow": 1024,
  "expensiveToolThreshold": 5000000
}
```

`downgrade_model` requires `modelFallbacks`. `disable_expensive_tools` requires that `toolBaseCosts` is populated for the tools you might want to disable — the plugin compares against `expensiveToolThreshold`, so an unconfigured tool falling back to the default estimate won't be disabled even if it's actually expensive in reality. This is one more reason day 2–3 has to come before day 5.

## Day 6: Cutover — `failClosed: true`

Now apply the [cutover decision tree](/blog/shadow-to-enforcement-cutover-decision-tree) to your collected dry-run data. The OpenClaw-specific reading of its four signal categories:

| Category | OpenClaw-specific check | Green when |
|---|---|---|
| **Cost calibration** | Compare per-call observed cost (from `costBreakdown.totalCost / count`) against your configured `toolBaseCosts` and `modelBaseCosts` | Per-call observations within ~20% of estimates for a steady week |
| **Policy coverage** | `unconfiguredTools` list across recent session summaries | List is empty (or only contains tools you've explicitly chosen not to budget) |
| **Operational readiness** | Has anyone on the team seen `BudgetExhaustedError` or `ToolBudgetDeniedError` in dry-run logs and known what to do? | Yes — at least one rehearsed denial |
| **Reversion readiness** | Can you flip `failClosed: false` (or `dryRun: true`) without a deploy? | Yes — config-toggle path tested |

If those are all green, flip to:

```json
{
  "dryRun": false,
  "failClosed": true,
  "cyclesBaseUrl": "${CYCLES_BASE_URL}",
  "cyclesApiKey": "${CYCLES_API_KEY}"
}
```

Note the env-var interpolation. Per [Lesson 4](/blog/openclaw-plugin-lessons-learned), the plugin no longer reads `process.env` directly — OpenClaw resolves `${...}` before passing config in.

The first 24 hours after cutover, treat any of these as a rollback signal:

- A sustained denial rate noticeably higher than what dry-run predicted. The dry-run data is your baseline; significant deviation means an estimate is wrong, not the policy.
- Per-call observed cost on any specific tool more than 2× its `toolBaseCosts` estimate. That's [estimate drift](/blog/estimate-drift-silent-killer-of-enforcement) — fix the number, don't tighten the threshold.
- Any `BudgetExhaustedError` on a workflow without a graceful degradation path. Add the path before re-enforcing on that workflow.

The reversion is one toggle: `failClosed: false` keeps the plugin instrumented but turns the hard block back into a warning. It's a softer rollback than `dryRun: true` and preserves your real budget data while you fix the calibration. The general rollback discussion in the cutover post applies — this is just the OpenClaw-shaped version.

## Sidebar: tool call limits as supply-chain protection

OpenClaw's ClawHub marketplace had [1,184 malicious skills flagged in early 2026](/blog/mcp-tool-poisoning-why-agent-frameworks-cant-prevent-it). The agent-framework market is converging on the same supply-chain risk shape that npm and PyPI have been living with for a decade. Budget enforcement isn't a substitute for skill-vetting, but `toolCallLimits` and `disable_expensive_tools` *are* a meaningful blast-radius limiter when a skill misbehaves.

A compromised skill can't send 10,000 emails if `toolCallLimits.send_email: 10`. A skill that's secretly running an expensive sub-agent gets caught by `disable_expensive_tools` once budget tightens. This is a side benefit, not the primary purpose — but it's a reason to be slightly more aggressive with limits on tools you don't fully trust.

## What you now have

After six days, the config in `openclaw.json` is no longer copy-paste. Every number in it is traceable to a session summary line you can point at. `toolBaseCosts` matches what tools actually cost in your traffic. `toolCallLimits` matches your healthy upper bound. `lowBudgetThreshold` is set to where degradation can still do something useful. And the cutover from dry-run to `failClosed` happened on data, not on a calendar.

The session summary keeps doing this work after cutover, too. Treat it as a weekly tuning ritual: open the latest one, look for tools where `costBreakdown.totalCost / count` has drifted from your `toolBaseCosts` estimate, look for new tools showing up in `unconfiguredTools`, look for `count` values approaching their `toolCallLimits`. The numbers move as your agents change. The discipline of letting the data set the config is what keeps enforcement healthy past day six.

## Resources

- [Integrating Cycles with OpenClaw](/how-to/integrating-cycles-with-openclaw) — full configuration reference
- [`cycles-openclaw-budget-guard` on GitHub](https://github.com/runcycles/cycles-openclaw-budget-guard) — source and issue tracker
- [Deploying the Full Cycles Stack](/quickstart/deploying-the-full-cycles-stack) — when you're ready to leave dry-run

## Related reading

- [Your OpenClaw Agent Has No Spending Limit — Here's How to Fix That](/blog/openclaw-budget-guard-stop-agents-burning-money) — the awareness post; the five problems this plugin solves
- [We Gave Our OpenClaw Agent a $5 Budget and Watched It Adapt](/blog/openclaw-budget-guard-five-dollar-agent) — what graceful degradation looks like once the config is tuned
- [Five Lessons from Building a Production OpenClaw Plugin](/blog/openclaw-plugin-lessons-learned) — the engineering field notes referenced throughout this post
- [Shadow Mode to Hard Enforcement: The Cutover Decision Tree](/blog/shadow-to-enforcement-cutover-decision-tree) — the general framework applied here
- [Estimate Drift: The Silent Killer of Budget Enforcement](/blog/estimate-drift-silent-killer-of-enforcement) — what to do when observed cost diverges from `toolBaseCosts`
- [When Budget Runs Out: Graceful Degradation Patterns](/blog/when-budget-runs-out-graceful-degradation-patterns-for-ai-agents) — the decision matrix for DENY and ALLOW_WITH_CAPS handling
- [Operating Budget Enforcement in Production](/blog/operating-budget-enforcement-in-production) — what to do when the first denial fires
