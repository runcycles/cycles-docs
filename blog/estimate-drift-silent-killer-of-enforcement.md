---
title: "Estimate Drift: The Silent Killer of Budget Enforcement"
date: 2026-04-07
author: Albert Mavashev
tags: [operations, production, observability, runtime-authority, incident-response, calibration]
description: "Cost estimates drift in AI agent production. When reserve:commit ratios wander outside 0.8-1.2, budgets lie. Detect drift early and recalibrate safely."
head:
  - - meta
    - name: keywords
      content: "estimate drift, reserve commit ratio, AI agent budget calibration, drift detection, budget enforcement recalibration, cost estimation AI agents, commit overage"
blog: true
sidebar: false
featured: false
---

# Estimate Drift: The Silent Killer of Budget Enforcement

> **Part of: [LLM Cost Runtime Control Reference](/guides/llm-cost-runtime-control)** — the full pillar covering causes, enforcement patterns, multi-tenant boundaries, and unit economics.

You calibrated your budgets correctly. You ran shadow mode for two weeks. You chose enforcement thresholds based on real data. Enforcement went live and worked.

Then three months later, something changes: your `reservation.commit_overage` events start climbing. In overdraft-tolerant setups, debt may begin to accumulate; in capped-charge setups, scopes may start drifting toward `is_over_limit`. A workflow that used to run comfortably starts triggering `budget.over_limit_entered`. Nobody deployed anything. Nobody changed the budgets. Nothing obvious broke.

What happened is **estimate drift**: the cost estimates your AI agents reserve at the start of each action have slowly diverged from what actions actually cost. The budgets are still the same size. The workload is still doing the same kind of work. But the relationship between what you predict and what you spend has drifted. Until it hasn't.

This post is about why estimates drift, how to detect it before it causes incidents, and how to recalibrate without breaking production.

<!-- more -->

## Why AI Agent Cost Estimates Drift Over Time

The [reserve-commit lifecycle](/blog/what-is-runtime-authority-for-ai-agents) is built around a fundamental asymmetry: you must reserve budget **before** an action happens (when the cost is unknown) and commit **after** (when the actual cost is known). The gap between estimate and actual is handled cleanly — unused budget is released on commit. That works perfectly in the short term.

Over time, four forces push estimates away from reality:

**1. Context growth.** An agent that reserves 500 tokens for an LLM call on day one may need 4,000 tokens on day ninety as conversation history, retrieved documents, and tool outputs accumulate. The estimate formula was right for the small context — but the context grew.

**2. Model behavior shifts.** Provider-side model updates change output verbosity, reasoning depth, and token consumption patterns. OpenAI [warns about this explicitly](https://developers.openai.com/cookbook/examples/how_to_count_tokens_with_tiktoken): *"The exact way that tokens are counted from messages may change from model to model. Consider the counts from the function below an estimate, not a timeless guarantee."*

**3. Tool path variance.** The same agent workflow can take different paths through its tool set depending on input. If users start asking more complex questions, the agent starts making more tool calls per run — but the estimate hasn't caught up.

**4. Provider pricing changes.** Token prices change. New models get added. Tool-call overhead appears. A budget estimate that assumed $0.03 per 1K tokens doesn't match a provider that now charges $0.05.

None of these forces fire alarms. They just slowly shift the ratio between what you reserve and what you commit — and that ratio is the canary.

## The Reserve:Commit Ratio

The single most useful signal for estimate drift is the **reserve-to-commit ratio**: how much budget you reserved divided by how much you actually spent, measured over a window.

| Ratio | Meaning | What's happening |
|---|---|---|
| **> 2:1** | You're reserving 2x what you spend | Estimates are too high — false scarcity, unnecessary denials |
| **1.2 - 2:1** | Moderately over-estimated | Tighten estimates to recover capacity |
| **0.8 - 1.2:1** | Estimates are accurate | The target range |
| **< 0.8:1** | Estimates are too low | Commits consistently exceed reserves — overage events, drift toward over-limit |

The [operator's guide](/blog/operating-budget-enforcement-in-production) defines 0.8-1.2 as the ideal range and 0.8-2.0 as the operationally acceptable watch range. This post focuses on the *why* behind ratio drift over weeks and months; the operator's guide covers *what to do* when enforcement fires in the moment.

**One measurement note:** compute the ratio against **actual spend**, not the charged amount. In capped-charge setups (`ALLOW_IF_AVAILABLE`), the charged amount can be less than actual when overage is capped — using charged amounts would mask under-estimation drift.

The subtle thing about drift is that it can happen in either direction:

- **Over-estimation drift** (ratio climbing above 1.2): Your budgets appear to deplete faster than actual spend justifies. Agents hit denials before they've really used their allocation. Teams respond by raising budgets — which masks the problem instead of fixing it.
- **Under-estimation drift** (ratio falling below 0.8): Commits exceed reserves. `reservation.commit_overage` events fire. In overdraft-tolerant setups, debt may accumulate; in capped-charge setups, scopes can drift toward `is_over_limit`. Eventually you hit `budget.over_limit_entered` in production, with no budget change to blame.

Both failure modes start the same way: a ratio that wanders out of the goldilocks zone and stays there.

## Drift Detection: Catching Problems Before Production Incidents

Drift detection is a monitoring problem, not an alerting problem. You're watching for **sustained movement**, not spikes.

### Signal 1: `reservation.commit_overage` rate

This is the most direct under-estimation signal. Every time actual cost exceeds reserved estimate on a commit, Cycles fires a `reservation.commit_overage` event. Track the rate over time:

As a rule of thumb based on the same calibration logic as denial-rate thresholds:

- **Healthy:** < 1% of commits fire overage
- **Warning:** 1-5% of commits fire overage — investigate specific workflows
- **Drift:** > 5% sustained for a week — recalibrate estimates

The rate matters more than individual events. A single overage is an edge case. A rising rate is drift. Calibrate these thresholds to your own production baseline — what matters is the *trend*, not the exact percentage.

### Signal 2: Reserve:commit ratio drift over time

Plot the ratio weekly. Look for trend, not noise:

- Ratio held steady at 1.05 for three months, then started climbing to 1.4 → over-estimation drift emerging
- Ratio held at 0.95 for two months, then dropped to 0.75 → under-estimation drift, overage events incoming

Drift happens at the timescale of weeks. Daily fluctuations are noise.

### Signal 3: Per-entity drift segmentation

Drift isn't usually uniform. Segment the ratio by:

- **Per model** — Opus vs. Sonnet may drift at different rates as each provider updates
- **Per tool** — a retrieval tool that started returning longer snippets drags token usage up
- **Per workflow** — complex workflows drift faster than simple ones
- **Per tenant** — if user input complexity varies by customer, so does drift

A 1.1 overall ratio can hide a 0.7 ratio on one specific workflow that's heading toward overages. Segment your dashboards.

### Signal 4: Budget utilization trajectory

If shadow mode showed you'd hit denials ~2% of the time, and live enforcement is now denying 5%, with the same budgets and same workload volume — something estimated differently. Either your budgets drifted, your estimates drifted, or the workload drifted. The ratio tells you which.

## Recalibrating Without Breaking Production

Detecting drift is half the battle. The other half is updating estimates without causing a new incident. Two patterns:

### Pattern 1: Gradual estimate migration (safe default)

Don't change estimate formulas abruptly. Instead:

1. **Observe the new target** in shadow mode. Compute what your new estimate formula *would* have produced for the last week of production traffic.
2. **Compare shadow estimates to live actuals.** If shadow estimates are closer to actuals than current estimates, you have your new target.
3. **Roll out per scope.** Apply the new estimate to one workflow, watch the reserve:commit ratio, expand to others if it stabilizes.
4. **Watch `commit_overage` rate** during rollout. Spikes mean your new estimate is still wrong.

This is the estimate-update equivalent of shadow mode itself: observe first, enforce second.

### Pattern 2: Buffer adjustment (tactical fix)

If drift is small but persistent, sometimes the fix is adjusting the safety buffer rather than the core formula.

- Current formula: `estimate = predicted_tokens * cost_per_token * 1.2` (20% buffer)
- Drift shows actuals consistently 30% above estimates
- Adjusted formula: `estimate = predicted_tokens * cost_per_token * 1.4` (40% buffer)

Buffer adjustments are easier to roll out than formula rewrites — they preserve the logic of the estimate while giving it more headroom.

### Anti-pattern: Raising budgets to absorb drift

The most common wrong move: when overage events start climbing, raise the budget so the warnings stop. This is the same mistake as raising a capacity budget when your app has a memory leak. It hides the drift. It doesn't fix it. And it reduces the value of enforcement, because the budget is no longer representing actual intent — it's absorbing calibration error.

Budgets should track *what you want to spend*. Estimates should track *what you actually spend*. When those diverge, fix the estimate. Raising the budget to paper over drift just guarantees a bigger drift-driven incident later.

## Cadence: How Often to Recalibrate

Drift rate varies by workload. Set a cadence based on your signal frequency:

| Signal frequency | Recommended cadence |
|---|---|
| Workload changes weekly (fast iteration) | Review ratios weekly, recalibrate monthly |
| Workload changes monthly (stable) | Review ratios monthly, recalibrate quarterly |
| Workload changes rarely (mature system) | Review quarterly, recalibrate when drift signal fires |

**Don't skip cadence entirely.** Even stable systems drift — provider pricing shifts, model updates happen, user input complexity evolves. An enforcement system you haven't re-examined in six months is probably operating on stale assumptions.

## The Take

Estimate drift is the failure mode that turns well-calibrated enforcement into false-positive theater or silent debt accumulation. It's not dramatic — no single event triggers it — which is why it's easy to ignore until it causes an incident.

The defense is continuous ratio monitoring, segmented by the dimensions that matter for your workload (model, tool, workflow, tenant). The reserve:commit ratio is the leading indicator. The `reservation.commit_overage` event is the confirmation signal. Staying in the 0.8-1.2 band is the goal.

And when drift appears, recalibrate *estimates*, not *budgets*. Estimates track reality. Budgets track intent. If you raise the budget every time estimates drift, the budget stops meaning anything.

---

- [What Is Runtime Authority for AI Agents](/blog/what-is-runtime-authority-for-ai-agents)
- [When Budget Enforcement Fires: An Operator's Guide](/blog/operating-budget-enforcement-in-production)
- [AI Agent Budget Control: Enforce Hard Spend Limits](/blog/ai-agent-budget-control-enforce-hard-spend-limits)
- [AI Agent Cost Management Guide](/blog/ai-agent-cost-management-guide)
- [GitHub: runcycles](https://github.com/runcycles)

## Related how-to guides

- [Shadow Mode rollout](/how-to/shadow-mode-in-cycles-how-to-roll-out-budget-enforcement-without-breaking-production)
- [Cost estimation cheat sheet](/how-to/cost-estimation-cheat-sheet)
- [Using the Cycles dashboard](/how-to/using-the-cycles-dashboard)
