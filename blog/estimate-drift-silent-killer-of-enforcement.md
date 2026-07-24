---
title: "Estimate Drift in Budget Enforcement"
date: 2026-04-07
author: Albert Mavashev
tags: [operations, production, observability, runtime-authority, incident-response, calibration]
description: "Detect AI agent estimate drift by comparing reservations with actual usage, segmenting changes by workload, and recalibrating without masking budget intent."
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

You calibrated your budgets against representative traffic, chose enforcement thresholds from the observed data, and moved protected paths to live reservations.

Then three months later, something changes: your `reservation.commit_overage` events start climbing. In overdraft-tolerant setups, debt may begin to accumulate; in capped-charge setups, scopes may start drifting toward `is_over_limit`. A workflow that used to run comfortably starts triggering `budget.over_limit_entered`. Nobody deployed anything. Nobody changed the budgets. Nothing obvious broke.

What happened is **estimate drift**: the cost estimates your AI agents reserve at the start of each action have slowly diverged from what actions actually cost. The budgets are still the same size. The workload is still doing the same kind of work. But the relationship between what you predict and what you spend has drifted. Until it hasn't.

This post is about why estimates drift, how to detect it before it causes incidents, and how to recalibrate without breaking production.

<!-- more -->

## Why AI Agent Cost Estimates Drift Over Time

The [reserve-commit lifecycle](/blog/what-is-runtime-authority-for-ai-agents) is built around a fundamental asymmetry: you must reserve budget **before** an action happens (when the cost is unknown) and commit **after** (when the actual cost is known). The gap between estimate and actual is handled cleanly — unused budget is released on commit. That works perfectly in the short term.

Over time, four forces push estimates away from reality:

**1. Context growth.** An agent that reserves 500 tokens for an LLM call on day one may need 4,000 tokens on day ninety as conversation history, retrieved documents, and tool outputs accumulate. The estimate formula was right for the small context — but the context grew.

**2. Model behavior shifts.** Provider-side model updates can change output verbosity, reasoning depth, and token consumption patterns. OpenAI's [token-counting guidance](https://developers.openai.com/cookbook/examples/how_to_count_tokens_with_tiktoken) cautions that message-token calculations vary by model and should be treated as estimates.

**3. Tool path variance.** The same agent workflow can take different paths through its tool set depending on input. If users start asking more complex questions, the agent starts making more tool calls per run — but the estimate hasn't caught up.

**4. Provider pricing changes.** Token prices change. New models get added. Tool-call overhead appears. A budget estimate that assumed $0.03 per 1K tokens doesn't match a provider that now charges $0.05.

None of these forces fire alarms. They just slowly shift the ratio between what you reserve and what you commit — and that ratio is the canary.

## The Reserve:Commit Ratio

One useful signal for estimate drift is the **reserve-to-commit ratio**: total submitted estimates divided by total actual usage for completed reservations over a window.

| Ratio | Meaning | What's happening |
|---|---|---|
| **Consistently above 1** | Estimates exceed actual usage | The buffer may be intentional, but excessive holds can reduce concurrent headroom or deny calls whose likely actual would fit |
| **Near 1** | Aggregate estimates are close to actual usage | Inspect the distribution because over- and under-estimates can cancel out |
| **Consistently below 1** | Actual usage exceeds estimates | Commit overages are likely; the configured overage policy determines whether they reject, cap the charge, or accrue debt |

There is no implementation-defined target band. Set a tolerance per workload from its variance, concurrency needs, and desired safety margin. The [operator's guide](/blog/operating-budget-enforcement-in-production) covers what to do when enforcement fires in the moment.

**Measurement notes:** compute the ratio against **actual usage**, not the charged amount. In capped-charge setups (`ALLOW_IF_AVAILABLE`), the charged amount can be less than actual when overage is capped, which would mask under-estimation drift. Use completed reservation records or application telemetry; the point-in-time balance fields `reserved` and `spent` do not form this ratio.

The subtle thing about drift is that it can happen in either direction:

- **Over-estimation drift** (ratio rising above its workload baseline): Active reservations hold more headroom than their work tends to consume, and a submitted estimate can be denied even when the eventual actual would have fit. Raising budgets may mask the estimator problem.
- **Under-estimation drift** (ratio falling below its workload baseline): Commits exceed reserves and `reservation.commit_overage` events fire. In overdraft-tolerant setups, debt may accumulate; in capped-charge setups, a scope is marked `is_over_limit` when the full overage cannot be charged.

Both failure modes appear as sustained movement away from the tolerance chosen for that workload.

## Drift Detection: Catching Problems Before Production Incidents

Drift detection is a monitoring problem, not an alerting problem. You're watching for **sustained movement**, not spikes.

### Signal 1: `reservation.commit_overage` rate

This is the most direct under-estimation signal. Every time actual cost exceeds reserved estimate on a commit, Cycles fires a `reservation.commit_overage` event. Track the rate over time:

Compare the rate with the workload's calibrated baseline and segment it by model, workflow, and tenant. A rising rate is evidence that the input distribution or estimator changed; an individual overage may simply be expected variance. Set alerts from your own tolerance rather than a universal percentage.

### Signal 2: Reserve:commit ratio drift over time

Plot the ratio at a window appropriate to your traffic volume. Look for trend, not isolated noise:

- Ratio held steady at 1.05 for three months, then started climbing to 1.4 → over-estimation drift emerging
- Ratio held at 0.95 for two months, then dropped to 0.75 → under-estimation drift, overage events incoming

High-volume workloads can reveal drift quickly; low-volume or seasonal workloads need longer comparison windows. Choose a window that contains enough completed reservations to be representative.

### Signal 3: Per-entity drift segmentation

Drift isn't usually uniform. Segment the ratio by:

- **Per model** — Opus vs. Sonnet may drift at different rates as each provider updates
- **Per tool** — a retrieval tool that started returning longer snippets drags token usage up
- **Per workflow** — complex workflows drift faster than simple ones
- **Per tenant** — if user input complexity varies by customer, so does drift

A 1.1 overall ratio can hide a 0.7 ratio on one specific workflow that's heading toward overages. Segment your dashboards.

### Signal 4: Budget utilization trajectory

If application-side dry-run records established one denial baseline and live enforcement now denies materially more often, compare policy changes, scope mapping, workload mix, and estimate ratios. The ratio helps identify estimate movement, but cannot by itself distinguish every cause.

## Recalibrating Without Breaking Production

Detecting drift is half the battle. The other half is updating estimates without causing a new incident. Two patterns:

### Pattern 1: Gradual estimate migration

Don't change estimate formulas abruptly. Instead:

1. **Evaluate the candidate formula side by side.** Compute what it would have produced over a representative set of production traffic.
2. **Compare candidate estimates to actuals.** If the distribution improves without removing the safety margin you require, the formula is a candidate for rollout.
3. **Roll out per scope.** Apply the new estimate to one workflow, watch the reserve:commit ratio, expand to others if it stabilizes.
4. **Watch `commit_overage` rate** during rollout. Spikes mean your new estimate is still wrong.

This is the estimate-update equivalent of shadow mode itself: observe first, enforce second.

### Pattern 2: Buffer adjustment (tactical fix)

If drift is small but persistent, sometimes the fix is adjusting the safety buffer rather than the core formula.

- Current formula: `estimate = predicted_tokens * cost_per_token * 1.2` (20% buffer)
- Analysis shows the prediction component remains useful but the chosen buffer no longer covers the desired percentile
- Adjust the multiplier to the value measured for that percentile, then validate it against held-out traffic

A buffer adjustment preserves the prediction logic, but it still needs validation: a broad multiplier can hide a model- or workflow-specific error.

### Anti-pattern: Raising budgets to absorb drift

A tempting response to rising overage events is to raise the budget so the warnings stop. That hides estimate drift instead of fixing it and weakens the connection between the ledger and the exposure the operator intended to allow.

Budgets should track *what you want to spend*. Estimates should track *what you actually spend*. When those diverge, fix the estimate. Raising the budget to paper over drift just guarantees a bigger drift-driven incident later.

## Cadence: How Often to Recalibrate

Drift rate varies by workload. Set a cadence based on your signal frequency:

| Workload behavior | Example review cadence |
|---|---|
| Changes frequently or after most releases | Review after material releases and over a representative traffic window |
| Stable but seasonal | Review across comparable seasonal periods |
| Changes rarely | Review when a drift alert, model change, or pricing change fires |

Even stable systems can drift as provider pricing, model behavior, or user input changes. Tie review to those changes and to a recurring interval appropriate for your workload.

## The Take

Estimate drift is the failure mode that turns well-calibrated enforcement into false-positive theater or silent debt accumulation. It's not dramatic — no single event triggers it — which is why it's easy to ignore until it causes an incident.

The defense is continuous ratio monitoring, segmented by the dimensions that matter for your workload (model, tool, workflow, tenant). The reserve-to-commit ratio shows estimate movement, while `reservation.commit_overage` confirms individual under-estimates. The goal is to remain within a workload-specific tolerance, not a universal band.

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
