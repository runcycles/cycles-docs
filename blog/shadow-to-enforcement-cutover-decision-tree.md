---
title: "Shadow Mode to Hard Enforcement"
date: 2026-04-23
author: Albert Mavashev
tags:
  - shadow-mode
  - runtime-authority
  - production
  - operations
  - best-practices
  - adoption
description: "When is an AI agent budget policy actually ready for hard enforcement? A signal-driven decision tree — not a calendar — for flipping from dry-run to blocking."
blog: true
sidebar: false
featured: false
head:
  - - meta
    - name: keywords
      content: shadow mode, hard enforcement, AI agent budget rollout, dry-run to production, policy cutover, progressive enforcement
---

# Shadow Mode to Hard Enforcement: The Cutover Decision Tree

An engineering lead two weeks into a Cycles rollout asks the question everybody asks eventually: *when do we turn on enforcement?*

Shadow mode has been instrumented on every model call for ten days. Dry-run decisions are being evaluated and logged. Dashboards show a would-be denial rate around 4%. Some of those denials look like legitimate overages. Some look like estimate drift on a specific agent. The team has a working budget policy for three tenants. A fourth is still draft. Marketing wants a date on the cutover milestone.

A calendar-driven cutover — "it's been two weeks, flip the switch" — is the version that gets teams into trouble. The signal-driven version — "the shape of what we're seeing matches what hard enforcement looks like in production" — is the version that ends quietly. The difference between those two decisions is the difference between a clean cutover and a 3 AM rollback, and most teams don't know which version they made until afterwards.

This post is a decision tree for that call: four signal categories and explicit guidance on what to cut over first, when to stop, and how to reverse course if the signals turn against you.

<!-- more -->

## Why calendar-driven cutovers fail

The pattern is familiar. A team picks a duration — "run it in shadow for a quarter" — hits the date, flips to enforcement, and discovers the first production weekday produces a denial rate several times what the sampled data suggested. The post-mortem typically lands on "shadow didn't sample enough of the high-traffic path" as the root cause.

The failure isn't in the duration. The failure is that a calendar has no opinion about whether the data you gathered covers the workload you're about to enforce against.

Industry patterns learned this years ago. Stripe's rate-limiter post puts it plainly: ["Dark launch each rate limiter to watch the traffic they would block"](https://stripe.com/blog/rate-limiters). Istio ships an `istio.io/dry-run: "true"` annotation (Alpha status) that lets `AuthorizationPolicy` evaluate without blocking so teams can measure. OPA Gatekeeper's [`enforcementAction: dryrun`](https://open-policy-agent.github.io/gatekeeper/website/docs/violations/) does the same for Kubernetes admission, surfacing violations in the constraint's `status` field. Cloudflare's WAF offers a `Log` action before `Block`. Every maturing enforcement tool converges on the same shape — evaluate, measure, calibrate, then flip — and none of them recommend a fixed duration. They recommend a set of signals.

Cycles' shadow mode is `dry_run: true` on a reservation request: the server runs the scope-derivation, budget-check, and caps-computation logic, returns the decision (`ALLOW`, `ALLOW_WITH_CAPS`, or `DENY`) along with affected scopes and optional balance snapshots, and leaves budget state untouched. No reservation is persisted and no balance is modified. The current server emits `reservation.denied` for denied dry-run evaluations, but not a complete allowed-decision/outcome stream, so the application must log every response and actual outcome. The v0.1.26 governance extension specifies a separate tenant-level `observe_mode` and observed-event types, but current v0.1.25.x reference servers only accept the preview fields for compatibility; they do not apply observe mode or emit those preview events. See [How to Add Runtime Enforcement Without Breaking Your Agents](/blog/how-to-add-runtime-enforcement-without-breaking-your-agents).

## The four signal categories

No single number tells you when to cut over. Four categories, evaluated together, do:

| Category | Reads from | Blocks cutover when |
|---|---|---|
| **Cost calibration** | dry-run decisions, reserve-to-commit ratio | Estimates are still drifting; you don't know what you're enforcing against |
| **Policy coverage** | instrumented call sites vs. total | You're about to enforce on a minority of the real traffic |
| **Operational readiness** | team workflows, alerting, degradation paths | Nobody knows what to do when the first denial fires |
| **Reversion readiness** | kill-switch design, rollback plan | There's no path back if enforcement misbehaves |

Each category is a veto. If any of them is red, cutover is premature regardless of how the others look.

## Cost calibration signals

This is where most teams focus first, and where dry-run data is most directly useful.

**False-positive denial rate.** Not every `DENY` in shadow mode is a denial you actually want in production. Some represent estimate errors, misconfigured budgets, or overages the team chose to tolerate. Classify a representative sample, set the acceptable rate from the workflow's user-impact SLO, and do not cut over while unintended denials breach that objective.

A note on terminology: *false-positive denial rate* is the percentage of shadow denials that were unintended. *Sustained denial rate*, referenced in the rollback table later, is the absolute frequency of denials after cutover. The two signals are distinct; don't compare them directly.

**Reserve-to-commit ratio.** Define this as total submitted estimates divided by total actual usage for completed reservations. A ratio trending upward means estimates are growing relative to actuals; a ratio trending downward means actuals are growing relative to estimates. Cycles defines no universal safe band or duration, so choose a workload-specific tolerance and validate the distribution as well as the aggregate. See [Estimate Drift: The Silent Killer of Budget Enforcement](/blog/estimate-drift-silent-killer-of-enforcement).

**Commitment overage rate.** Track the fraction of commits whose actual usage exceeded the estimate. Compare it with the calibrated workload baseline and investigate changes by model, workflow, and tenant; the acceptable rate depends on variance and the configured commit-overage policy.

**Budget utilization distribution.** If your would-be denial rate is an average across tenants, the average is lying to you. Look at the distribution. One tenant at 95% utilization with the rest at 30% means enforcement will hit that one tenant hard and leave the others untouched — which might be fine, or might be a signal that the budget for that tenant was never right. Outlier tenants should be deliberately scoped in or out of the first cutover, not averaged into the decision.

## Policy coverage signals

A budget policy that only sees 60% of the real work produces misleading dry-run data.

**Instrumentation coverage.** The ratio of code paths that call `reserve()` to code paths that call an LLM or a tool. If 30% of your agent calls bypass Cycles because they're in a legacy code path or a background job, the denial rate on the instrumented path says little about what enforcement will do to the whole system. Define a coverage threshold from your threat model and inventory; a high-risk deployment may require every protected path to be instrumented before cutover.

**Scope derivation consistency.** The same logical operation should resolve to the same scope path every time. If a run from agent A sometimes reports `tenant:X/workflow:Y/agent:A` and sometimes reports just `tenant:X`, enforcement against the narrower scope will behave inconsistently. Shadow data is the audit surface for this — run a daily diff over scope paths for a known-fixed workflow.

**Policy freshness.** Verify that every ledger and scope included in the cutover still reflects the intended exposure, current workflow behavior, and current pricing. Age alone does not make a policy wrong, but an unreviewed default should not silently become a hard production boundary.

## Operational readiness signals

Signal category most often underweighted. When the first legitimate denial fires in production, the team's muscle memory is what decides whether the incident is a 5-minute "tune and move on" or a 5-hour war room.

**Alert calibration.** If your alerting thresholds were inherited from a template, they aren't calibrated to your traffic. A denial rate alert at ">1% for 5 minutes" is useless if your healthy baseline under enforcement will be 2%. Derive thresholds from the shadow data you just collected.

**Degradation paths.** For every high-traffic workflow, has the team decided what happens when a reservation is denied? The options are well-understood — model downgrade, capability narrowing, queueing, checkpoint-and-resume, inform-and-stop — and the choice depends on the workflow. See [When Budget Runs Out: Graceful Degradation Patterns](/blog/when-budget-runs-out-graceful-degradation-patterns-for-ai-agents) for the decision matrix. A workflow without a degradation path should not be part of the first cutover.

**Runbook familiarity.** Whoever is on call needs to recognize `BUDGET_EXCEEDED`, `BUDGET_FROZEN`, and `OVERDRAFT_LIMIT_EXCEEDED`, inspect the denying scope, and distinguish a legitimate limit from bad estimates, lifecycle state, or concurrent debt. See [Operating Budget Enforcement in Production](/blog/operating-budget-enforcement-in-production).

## Reversion readiness

The last category is the one that's often skipped because it feels defeatist. It isn't. It's the category that lets you cut over *aggressively* on the signals above, because you have a clean exit if reality disagrees with the data.

**Kill-switch design.** Put `dry_run` behind an application or integration feature flag that can be changed without a deploy. `dry_run` is a request property, not an admin budget setting. The current v0.1.25.x server accepts tenant `observe_mode` configuration but does not apply it to runtime decisions, so do not rely on that field as a cutover switch.

An admin budget freeze is a separate emergency stop, not a rollback to shadow mode. Once a budget is frozen, subsequent live reservations and direct events against that scope fail with `BUDGET_FROZEN` until it is unfrozen; existing reservations can still commit or release. Use the documented admin freeze/unfreeze route for that behavior.

The softer rollback is to make the integration send dry-run evaluations and continue execution while recording the decision in application telemetry. That keeps the evaluation signal without mutating the Cycles ledger.

**Rollback plan written down.** At minimum: (1) use the application feature flag to restore dry-run/bypass behavior; (2) triage the signals that prompted the rollback before attempting enforcement again. Test that path against the rollback-time objective for the workflow.

**Canary scopes.** A small subset of tenants or workflows you're willing to cut over first and watch closely. If the signals on the canary set don't match the shadow data, the decision-tree's veto fires *before* you expand enforcement.

## A suggested progressive enforcement order

Cutover isn't a single on/off switch across the whole stack. When the four signal categories are green, cut over in an order that minimizes blast radius:

1. **Low-traffic, high-cost workflows first.** An overnight batch job or a rarely-used research agent. Enforcement errors here are loud and easy to diagnose.
2. **High-estimate-quality paths next.** Prefer workflows whose estimate distributions stayed within their chosen tolerance during calibration.
3. **High-risk tenants last.** The one tenant with 95% utilization isn't where you want to debug the first week of enforcement. Bring them into hard enforcement after the other paths are running clean.

This is the same shape as a canary deploy. You're looking for disagreements between your pre-cutover model of the system and the post-cutover reality, and you want those disagreements to surface in the lowest-blast-radius environment first.

## Signals that tell you to roll back

Signals that enforcement is misbehaving post-cutover — and therefore reasons to flip the kill switch back to shadow:

| Signal | Rollback criterion |
|---|---|
| Denial rate | Breaches the workflow's calibrated user-impact or availability SLO |
| Business-critical workflow error rate | Reaches the incident threshold declared in the rollout plan |
| `BUDGET_FROZEN` responses | Any appearance on a scope you didn't explicitly freeze |
| Commit-overage rate on a single scope | Leaves the workload-specific baseline enough to threaten availability or exposure objectives |
| Escalation volume from tenants | Breaches the customer-support or incident SLO |

A rollback isn't a failure — it's the plan working. The follow-up is: what category of signal turned out to be under-calibrated, and what needs to change in the shadow data before the next cutover attempt?

## The scorecard

Put the four categories together as a single cutover readiness check. Proceed only when every required category is ready.

| Category | Ready | Needs work | Blocks cutover |
|---|---|---|---|
| **Cost calibration** | False denials, estimate ratio, and overage rate meet workload-specific objectives across representative traffic | A metric is still moving or edge cases are under-sampled | A known legitimate path fails or a known runaway path passes |
| **Policy coverage** | Every protected path in the cutover inventory is instrumented and scope derivation is stable | Some lower-impact paths are explicitly deferred | A required protected path bypasses the boundary or maps inconsistently |
| **Operational readiness** | Alerts use application-side dry-run baselines; degradation paths and runbooks are tested | A noncritical workflow lacks a tested fallback | Operators cannot recognize, mitigate, or roll back an enforcement failure |
| **Reversion readiness** | Kill-switch tested; rollback plan written; canary scopes selected | Kill-switch designed but untested | No rollback mechanism |

## The takeaway

Shadow mode is the dry-run of a production decision. The cutover to hard enforcement isn't about running dry-run for long enough — it's about gathering enough data on the right signals to know what enforcement will actually do, stratifying the first cutover to the lowest-blast-radius paths, and building the exit in advance. Teams that run the signal-driven version of this process discover that the bad days of early enforcement feel like tuning, not firefighting — and the good days feel like nothing at all, which is exactly the point.

## Related reading

- [How to Add Runtime Enforcement Without Breaking Your Agents](/blog/how-to-add-runtime-enforcement-without-breaking-your-agents) — the rollout playbook: instrument, observe, calibrate, enforce
- [Estimate Drift: The Silent Killer of Budget Enforcement](/blog/estimate-drift-silent-killer-of-enforcement) — the reserve-to-commit ratio as a readiness signal
- [Operating Budget Enforcement in Production](/blog/operating-budget-enforcement-in-production) — reason-code-to-response mapping, alerting patterns, incident playbooks
- [When Budget Runs Out: Graceful Degradation Patterns for AI Agents](/blog/when-budget-runs-out-graceful-degradation-patterns-for-ai-agents) — the decision matrix for DENY and ALLOW_WITH_CAPS handling
- [Runtime Authority vs. Guardrails vs. Observability](/blog/runtime-authority-vs-guardrails-vs-observability) — why enforcement sits upstream of observability and downstream of policy
- [Tenant Lifecycle at Scale: Cascade Semantics](/blog/tenant-lifecycle-cascade-semantics-at-scale) — what safe decommissioning looks like once enforcement is live
- [Stripe's rate-limiter dark-launch pattern](https://stripe.com/blog/rate-limiters) — the industry precedent for observe-before-enforce rollouts
- [Google SRE Book: Addressing Cascading Failures](https://sre.google/sre-book/addressing-cascading-failures/) — broader SRE context for progressive enforcement rollout

## Related how-to guides

- [Shadow Mode rollout](/how-to/shadow-mode-in-cycles-how-to-roll-out-budget-enforcement-without-breaking-production)
- [Degradation paths](/how-to/how-to-think-about-degradation-paths-in-cycles-deny-downgrade-disable-or-defer)
- [Using the Cycles dashboard](/how-to/using-the-cycles-dashboard)
