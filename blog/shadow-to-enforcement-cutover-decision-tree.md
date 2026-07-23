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

This post is a decision tree for that call. Four signal categories, suggested threshold ranges, and explicit guidance on what to cut over first, when to stop, and how to reverse course if the signals turn against you.

<!-- more -->

## Why calendar-driven cutovers fail

The pattern is familiar. A team picks a duration — "run it in shadow for a quarter" — hits the date, flips to enforcement, and discovers the first production weekday produces a denial rate several times what the sampled data suggested. The post-mortem typically lands on "shadow didn't sample enough of the high-traffic path" as the root cause.

The failure isn't in the duration. The failure is that a calendar has no opinion about whether the data you gathered covers the workload you're about to enforce against.

Industry patterns learned this years ago. Stripe's rate-limiter post puts it plainly: ["Dark launch each rate limiter to watch the traffic they would block"](https://stripe.com/blog/rate-limiters). Istio ships an `istio.io/dry-run: "true"` annotation (Alpha status) that lets `AuthorizationPolicy` evaluate without blocking so teams can measure. OPA Gatekeeper's [`enforcementAction: dryrun`](https://open-policy-agent.github.io/gatekeeper/website/docs/violations/) does the same for Kubernetes admission, surfacing violations in the constraint's `status` field. Cloudflare's WAF offers a `Log` action before `Block`. Every maturing enforcement tool converges on the same shape — evaluate, measure, calibrate, then flip — and none of them recommend a fixed duration. They recommend a set of signals.

Cycles' shadow mode is `dry_run: true` on a reservation request: the server runs the full scope-derivation, budget-check, and caps-computation logic, returns the decision (`ALLOW`, `ALLOW_WITH_CAPS`, or `DENY`) along with affected scopes and optional balance snapshots, and leaves budget state untouched. No reservation is persisted, no balance is modified, and base `dry_run` does not emit a reservation event — the decision round-trips in the response. (Teams that want emission-driven observation can use the `observe_mode` extension introduced in v0.1.26, which emits `reservation.observed_allowed` / `reservation.observed_denied`; that's a different track from base dry-run.) Your agent proceeds regardless of the result. See [How to Add Runtime Enforcement Without Breaking Your Agents](/blog/how-to-add-runtime-enforcement-without-breaking-your-agents) for the basic instrumentation playbook. This post is about what to read off those dry-run responses before you stop reading and start blocking.

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

**False-positive denial rate.** Not every `DENY` in shadow mode is a denial you actually want in production. Some fraction represent estimate errors, misconfigured budgets, or legitimate overages the team chose to tolerate. A reasonable target is the 3–8% band on the fraction of would-be denials that represent work you'd want to let through. Higher than that, and your first day of enforcement produces a tide of pages. The healthiest teams classify a sample of shadow denials manually for at least a few days before cutover — it's the only way to separate "the policy caught a real problem" from "the estimate was too tight."

A note on terminology: *false-positive denial rate* is the percentage of shadow denials that were unintended. *Sustained denial rate*, referenced in the rollback table later, is the absolute frequency of denials after cutover. The two signals are distinct; don't compare them directly.

**Reserve-to-commit ratio.** When reservations commit with the actual usage they reserved, the ratio hovers near 1.0. The band that's safe to enforce on is roughly 0.8–1.2 — held steady for at least a week, not just a single two-day sample. A ratio trending downward (you're over-reserving) means enforcement will reject legitimate work because your estimates are inflated. A ratio trending upward (you're under-reserving) means enforcement will under-protect. See [Estimate Drift: The Silent Killer of Budget Enforcement](/blog/estimate-drift-silent-killer-of-enforcement) for the operator diagnostic on this ratio.

**Commitment overage rate.** The fraction of commits that exceeded their reservations. Under 1% is healthy. 1–5% is an amber signal — tune estimates, don't cut over yet. Over 5% and the estimates themselves are wrong, not the policy.

**Budget utilization distribution.** If your would-be denial rate is an average across tenants, the average is lying to you. Look at the distribution. One tenant at 95% utilization with the rest at 30% means enforcement will hit that one tenant hard and leave the others untouched — which might be fine, or might be a signal that the budget for that tenant was never right. Outlier tenants should be deliberately scoped in or out of the first cutover, not averaged into the decision.

## Policy coverage signals

A budget policy that only sees 60% of the real work produces misleading dry-run data.

**Instrumentation coverage.** The ratio of code paths that call `reserve()` to code paths that call an LLM or a tool. If 30% of your agent calls bypass Cycles because they're in a legacy code path or a background job, the 4% denial rate on the instrumented path tells you approximately nothing about what enforcement will do to the whole system. Target: at least 90% of model calls and 80% of tool calls instrumented before cutover.

**Scope derivation consistency.** The same logical operation should resolve to the same scope path every time. If a run from agent A sometimes reports `tenant:X/workflow:Y/agent:A` and sometimes reports just `tenant:X`, enforcement against the narrower scope will behave inconsistently. Shadow data is the audit surface for this — run a daily diff over scope paths for a known-fixed workflow.

**Policy freshness.** Does every tenant and workflow have a budget policy that was authored this quarter, or are you still running day-one defaults for half your scopes? Outdated policies are more dangerous under enforcement than under shadow, because shadow just logs them and enforcement blocks on them.

## Operational readiness signals

Signal category most often underweighted. When the first legitimate denial fires in production, the team's muscle memory is what decides whether the incident is a 5-minute "tune and move on" or a 5-hour war room.

**Alert calibration.** If your alerting thresholds were inherited from a template, they aren't calibrated to your traffic. A denial rate alert at ">1% for 5 minutes" is useless if your healthy baseline under enforcement will be 2%. Derive thresholds from the shadow data you just collected.

**Degradation paths.** For every high-traffic workflow, has the team decided what happens when a reservation is denied? The options are well-understood — model downgrade, capability narrowing, queueing, checkpoint-and-resume, inform-and-stop — and the choice depends on the workflow. See [When Budget Runs Out: Graceful Degradation Patterns](/blog/when-budget-runs-out-graceful-degradation-patterns-for-ai-agents) for the decision matrix. A workflow without a degradation path should not be part of the first cutover.

**Runbook familiarity.** Whoever is on call needs to recognize a `BUDGET_EXCEEDED` error, a `BUDGET_FROZEN` error, and an `OVERDRAFT_LIMIT_EXCEEDED` error, and know which of the three requires a budget top-up versus a policy review versus paging the tenant. See [Operating Budget Enforcement in Production](/blog/operating-budget-enforcement-in-production) for the reason-code-to-response mapping.

## Reversion readiness

The last category is the one that's often skipped because it feels defeatist. It isn't. It's the category that lets you cut over *aggressively* on the signals above, because you have a clean exit if reality disagrees with the data.

**Kill-switch design.** A feature flag, a config toggle, or a small code path that flips every call back to `dry_run: true` without a deploy. On self-hosted Cycles, this is usually a process environment variable or an admin-API budget setting toggled per scope. Either way, the engineer on call shouldn't have to push code to roll back.

The effect you're after is a scope-level freeze via the admin API: once a budget is frozen, subsequent reservations against that scope return `BUDGET_FROZEN` until the scope is unfrozen, and in-flight commits are not affected. The exact admin route shape varies by deployment — check your admin API surface for the freeze/unfreeze endpoints it exposes; the semantics matter more than the literal path.

The hard freeze isn't always the right first move. The softer version — flipping the scope's policy back to `dry_run: true` without losing the data path — is usually preferable, because it leaves the shadow signal intact while stopping the blocking behavior.

**Rollback plan written down.** Two steps minimum: (1) flip the kill switch to restore shadow mode; (2) triage the signals that prompted the rollback before attempting re-enforcement. Teams that write this down in advance spend minutes on rollback, not hours.

**Canary scopes.** A small subset of tenants or workflows you're willing to cut over first and watch closely. If the signals on the canary set don't match the shadow data, the decision-tree's veto fires *before* you expand enforcement.

## A suggested progressive enforcement order

Cutover isn't a single on/off switch across the whole stack. When the four signal categories are green, cut over in an order that minimizes blast radius:

1. **Low-traffic, high-cost workflows first.** An overnight batch job or a rarely-used research agent. Enforcement errors here are loud and easy to diagnose.
2. **High-estimate-quality paths next.** The workflows where your reserve-to-commit ratio was tightest in shadow. These are the paths where enforcement does exactly what the data predicted.
3. **High-risk tenants last.** The one tenant with 95% utilization isn't where you want to debug the first week of enforcement. Bring them into hard enforcement after the other paths are running clean.

This is the same shape as a canary deploy. You're looking for disagreements between your pre-cutover model of the system and the post-cutover reality, and you want those disagreements to surface in the lowest-blast-radius environment first.

## Signals that tell you to roll back

Signals that enforcement is misbehaving post-cutover — and therefore reasons to flip the kill switch back to shadow:

| Signal | Rollback threshold (rough guide) |
|---|---|
| Denial rate | Sustained 3× shadow baseline for >10 minutes |
| Business-critical workflow error rate | Any noticeable spike in a monitored production flow |
| `BUDGET_FROZEN` responses | Any appearance on a scope you didn't explicitly freeze |
| Commit-overage rate on a single scope | Sustained >2% — usually means a model change invalidated the reserve-to-commit estimate for that scope |
| Escalation volume from tenants | Any concentrated cluster, especially within the first hour |

A rollback isn't a failure — it's the plan working. The follow-up is: what category of signal turned out to be under-calibrated, and what needs to change in the shadow data before the next cutover attempt?

## The scorecard

Put the four categories together as a single cutover readiness check. If every row is green, cut over. If any row is amber, fix that category first. If any row is red, cutover is premature regardless of how the others look.

| Category | Green | Amber | Red |
|---|---|---|---|
| **Cost calibration** | False-positive denials <5%, R/C ratio 0.8–1.2 steady ≥1 week, overage <1% | Overage 1–5%, ratio drifting | Overage >5%, ratio outside 0.8–1.2 |
| **Policy coverage** | ≥90% model calls, ≥80% tool calls instrumented; scope derivation stable | 70–90% coverage; occasional scope inconsistency | <70% coverage or day-one policies still in place |
| **Operational readiness** | Alerts calibrated to shadow baseline; degradation paths defined for high-traffic workflows; runbook familiar | Alerts on templates; some workflows without degradation path | No one on call has responded to a dry-run alert |
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
