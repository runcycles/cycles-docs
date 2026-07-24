---
title: "Rolling Out Action Authority on New Surfaces"
date: 2026-06-20
author: Albert Mavashev
tags:
  - action-authority
  - action-control
  - operations
  - shadow-mode
  - runtime-authority
  - agents
  - production
  - adoption
description: "Memory, merge, click, voice — the rollout playbook: per-surface inventory, shadow mode, gate primitives, cutover order, rollback tree, and runbook entries."
blog: true
sidebar: false
featured: false
head:
  - - meta
    - name: keywords
      content: "action authority rollout, runtime authority adoption, agent governance shadow mode, action control cutover, agent gate deployment playbook, runtime authority operations"
---

# Rolling Out Action Authority on New Surfaces

The recent five-post arc went through what [runtime authority](/glossary#runtime-authority) looks like on four new agent surfaces: [memory writes](/blog/agent-memory-writes-are-actions-too), [merge buttons](/blog/when-coding-agents-press-merge), [computer-use clicks](/blog/computer-use-agents-have-no-tool-boundary), and [voice frames](/blog/voice-agent-budgets-when-you-cant-pause-to-reserve), plus the [synthesis](/blog/what-four-new-surfaces-taught-us) of what the four had in common. The framing is consistent; the patterns are recognizable. A team that buys the framing arrives at the obvious next question.

*Monday morning. Which surface goes first, what do you instrument, and how do you know when to flip the gate from observing to enforcing?*

This post is the operational answer. It is shorter on theory and longer on artifacts: an inventory template, per-surface instrumentation patterns, calibration metrics, a cutover criteria checklist, and a rollback decision tree. Most of it is the same shape the [shadow-to-enforcement cutover post](/blog/shadow-to-enforcement-cutover-decision-tree) already established for budget enforcement — the playbook does not change; the per-surface specifics do.

::: warning Current implementation boundary
The shipped Cycles server can evaluate scoped budgets, including caller-assigned `RISK_POINTS`, and return the protocol's five standard cap fields. It does not yet implement the v0.1.26 action registry, native action quotas, or custom caps such as `requires_human_approval` and `requires_fresh_screenshot`. In this playbook, those are application-side gate rules enforced by the host or handler; Cycles supplies budget evaluation and settlement evidence.
:::

<!-- more -->

## Why a Phased Rollout, Per Surface

The reasons that make calendar-driven cutovers fail for budget enforcement apply unchanged to the new surfaces. The healthy pattern is the same: instrument first, observe, calibrate, then enforce — per surface, not in one big bang. The [synthesis post](/blog/what-four-new-surfaces-taught-us) framed reserve-commit as the stable layer the four surfaces preserved at their boundaries: every surface gets the same shape of rollout, with different specifics in the middle.

The following four-phase schedule is an illustrative planning aid:

| Week | Goal | Output |
|---|---|---|
| 1 | Inventory the agent fleet's action surfaces | Surface-by-surface list with current gate state |
| 2 | Shadow-mode instrumentation, per surface | Application logs combining host-rule preflight results with Cycles dry-run budget decisions |
| 3 | Per-surface gate primitives + calibration | Application gate rules and Cycles budget amounts tuned against shadow data |
| 4 | Cutover, surface by surface, in false-positive-cost order | Hard enforcement on the surface where a wrongful denial costs least first; remaining surfaces on a planned schedule |

Choose the duration of each phase from traffic volume, workload variation, surface criticality, and the time needed to exercise rare failure cases. The structure matters more than the calendar.

## Week 1: Inventory the Action Surfaces

The first practical task is to know what surfaces the agent actually touches. Most teams discover at least one surface they hadn't classified.

For each agent in scope, list every consequential action it can take. The inventory template:

| Field | What goes in it | Example |
|---|---|---|
| Agent | Identity of the agent (per [agent-identity-is-not-user-identity](/blog/agent-identity-is-not-user-identity)) | `support-refund-agent-prod` |
| Surface | Which of the canonical surfaces it uses | Outbound tool calls + memory writes |
| Tool / action class | The specific call shape | `crm.update_customer`, `memory.add` |
| Current gate | What governs it today, if anything | Branch protection / OAuth scope / nothing |
| Blast radius tier | 0–4 from the [risk-assessment](/blog/ai-agent-risk-assessment-score-classify-enforce-tool-risk) framework | 3 (Mutation, per-[tenant](/glossary#tenant)) |
| Reversibility | Reversible / hard-to-reverse / irreversible | Hard-to-reverse |
| Frequency | Calls per hour at production volume | ~200/hr |
| Existing audit | Where the action shows up if it goes wrong | CRM audit log only |

The output often exposes actions without a pre-execution authorization or budget gate, as well as controls that answer a different question—for example, a rate limit cannot validate a merge target, and a content guardrail cannot bound cumulative spend.

Use the listed surfaces as prompts, not a closed taxonomy. If an action does not fit them, document its actual execution boundary, authorization control, exposure unit, and recovery path before instrumentation.

## Week 2: Shadow-Mode Instrumentation Per Surface

Once the inventory exists, each protected row needs an application-side preflight path. Host rules evaluate authorization and action-specific conditions. A separate Cycles `decide()` or `reserve(dry_run: true)` call can evaluate the caller-assigned budget without persistence. The general dry-run pattern from [How to Add Runtime Enforcement Without Breaking Your Agents](/blog/how-to-add-runtime-enforcement-without-breaking-your-agents) applies; what changes per surface is what the host validates and records.

| Surface | Shadow-mode call | What to log |
|---|---|---|
| Outbound tool calls | Host authorization plus `decide()` / `reserve(dry_run: true)` before dispatch | Tool identity, validated arguments or a safe digest, host-rule result, Cycles budget decision |
| Memory writes | Host validates tenant and write target; Cycles evaluates submitted exposure | Operation, scope, provenance fields, host-rule result, Cycles budget decision |
| Merge buttons | Pre-execution hook on `gh pr merge` (or equivalent) in the agent harness | Source branch, target branch, head SHA, agent identity, host-rule result, Cycles budget decision |
| Computer-use clicks | Pre-emission hook on the click event in the agent harness | URL pattern, DOM target (if available), action verb, host-rule result, Cycles budget decision |
| Voice calls | Call-start estimate plus host-controlled re-evaluation points | Call-level features, predicted consumption, host-rule result, Cycles budget decision |

The output of phase 2 is an application-owned stream of preflight results per surface. Cycles dry runs create no reservation or balance mutation. The current server emits `reservation.denied` for denied evaluations, but the application must log all responses and later outcomes for a complete stream.

A few practical things to watch for during week 2:

- **Volume.** Memory writes and clicks generate far more decisions per unit time than tool calls or merges. Don't accidentally page on every shadow decision; aggregate first.
- **Sampling.** For very high-frequency surfaces (clicks, voice frames), sampling the shadow stream is acceptable as long as the sampler is deterministic per session. Random sampling across sessions makes the calibration data hard to interpret.
- **PII.** Memory write payloads, voice transcripts, and screenshot crops are all PII-bearing in many deployments. The shadow stream needs the same redaction the production audit trail has. Treat shadow-mode data with at least the same care as the production logs.

## Week 3: Per-Surface Gate Primitives and Calibration

With shadow data flowing, week 3 is where the per-surface specifics enter the picture. Each surface gets its own gate primitives, calibrated against the shadow stream.

### Memory writes

| Gate primitive | What it does | Tune against |
|---|---|---|
| Per-tenant write quota | Host counter, or caller-assigned `RISK_POINTS` reserved by every protected write | Distribution of writes and assigned exposure from application shadow data |
| TTL on unverified facts | Facts written without corroboration auto-expire | Survival rate of memory entries vs production retention need |
| Per-write provenance | Run ID + agent identity + risk-budget context attached to every write | Existing audit trail — fields you already log |
| Scope isolation enforcement | Host rejects cross-tenant writes unless explicitly authorized | Application preflight records showing cross-tenant attempts |

Calibration target: exercise legitimate writes, cross-tenant attempts, duplicate instrumentation, and the runaway pattern the boundary is meant to contain. Set acceptable false-denial and missed-detection rates from the memory product's own SLOs; Cycles defines no standard percentage or observation duration.

### Merge buttons

| Gate primitive | What it does | Tune against |
|---|---|---|
| Distinct-approver rule | Block merges where author and approver share the same agent identity | Sample of agent-authored PRs and their approval chains |
| Human-approval rule | Force a human in the loop on protected-branch merges from agents | Frequency of agent-merge requests in shadow data |
| Per-session promotion budget | Cap [RISK_POINTS](/glossary#risk-points) for merges in a single session | Distribution of merges-per-session from shadow data |
| Deploy-gate rule | Allow merge but defer auto-deploy until a human releases | Auto-deploy [fan-out](/glossary#fan-out) from shadow data |

Calibration target: shadow data should show clean separation between routine PR merges (small risk, low session totals) and the runaway-fanout patterns the gate is meant to catch. If the two populations overlap on the risk axis, the application rules or assigned reservation amounts need tightening.

### Computer-use clicks

| Gate primitive | What it does | Tune against |
|---|---|---|
| Fresh-screenshot rule | Click must use a recent screenshot, not one cached more than N seconds ago | Distribution of screenshot-to-click latency from shadow data |
| Cross-tenant navigation deny | Block clicks that change the tenant context of the session | Cross-tenant URL transitions observed in shadow |
| Target-intent risk schedule | Risk-score clicks by (URL pattern, DOM target, action verb) | Shadow data on which (target, intent) tuples actually fire in production |
| Session budget denominated in risk, not count | Per the click sibling: a session that can do 800 read-clicks should not get to do 800 destructive clicks for the same authority | Distribution of high-risk-tier vs low-risk-tier clicks per session |

Calibration target: the would-be denial rate on clicks should distinguish the routine path (fill form → submit) from the runaway/escalation path. When the shadow data produces a clearly bimodal distribution, the cap belongs in the gap; when it does not, the schedule needs more (target, intent) features before the cap can be tuned reliably.

### Voice frames

| Gate primitive | What it does | Tune against |
|---|---|---|
| Predictive reservation per call | Reserve N minutes of authority at call start | Call-duration distribution from shadow + safety margin |
| Wall-clock cap on session | Bound total call time, not just token spend | Carrier-minute distribution |
| Tier-aware gating | Slow-path tool calls sync-gated; fast-path audio against predictive reservation | Shadow data on which calls trigger tool look-ups |
| Per-turn-boundary re-check | Re-reservation lands at turn boundaries, not mid-utterance | Turn-boundary timing observed in shadow |

Calibration target: choose a reserve-to-commit tolerance from call-duration variance and the amount of concurrent headroom you need. The [estimate-drift framework](/blog/estimate-drift-silent-killer-of-enforcement) explains why Cycles defines no universal ratio band or observation duration.

Across all four surfaces, the calibration signals echo the [shadow-to-enforcement decision tree](/blog/shadow-to-enforcement-cutover-decision-tree): false-positive denial rate, calibration accuracy (where it can be defined — voice has a true reserve-to-commit ratio; the others use cap-fire rate vs shadow baseline as the analogue), instrumentation coverage, and operational readiness. The thresholds vary by surface; the questions don't.

## Week 4: Cutover, Lowest-False-Positive-Cost Surface First

The cutover decision is per-surface, not all-or-nothing. Rank your own surfaces by the cost of a false-positive denial, recoverability, traffic volume, and action blast radius. One illustrative order is:

1. **Memory writes** — first only when a denied write is recoverable and does not discard required state.
2. **Computer-use clicks** — later when a denial can interrupt a workflow mid-step.
3. **Voice calls** — later when a failed call-start reservation or host re-check is immediately user-visible.
4. **Merge buttons** — later when a false denial blocks a time-sensitive delivery path.

Your ordering may be different: for example, an ephemeral memory write can be less important than a merge, while a durable compliance record can be more important.

Each cutover follows the same per-surface checklist:

- Application-side shadow data covers representative normal traffic and the known failure cases
- The team has classified enough would-be denials to meet the surface's false-denial SLO
- An on-call rotation knows what to do when the first denial fires (per the [operating-budget-enforcement guide](/blog/operating-budget-enforcement-in-production))
- The application kill switch is wired, tested, and meets the surface's rollback-time objective without a redeploy
- The rollback decision tree (below) is reviewed and signed off

After cutover, compare live denials, user impact, and application-rule results with the calibrated baseline. Use the kill switch when the surface breaches its rollback objective; the required window depends on traffic and impact.

## The Rollback Decision Tree

| Signal observed | Reaction |
|---|---|
| Denial rate breaches the surface's user-impact or availability SLO | Restore the application gate to dry-run/bypass mode; resume tuning |
| A single denial causes an unacceptable irreversible outcome | Stop the affected surface and begin incident review |
| Reserve-to-commit ratio leaves the workload-specific tolerance *(voice-call estimate example)* | Re-evaluate estimates; roll back if the drift threatens availability or exposure objectives |
| One tenant or agent dominates unexpected denials | Investigate its scope mapping and workload; use a scoped rollback only if that exemption is authorized and safe |
| An application rule fires materially above its calibrated baseline | Tune or roll back that host rule based on its surface-specific SLO |

The decision tree is per-surface. Memory writes rolling back does not require clicks to roll back. The point of cutting over one surface at a time is that the blast radius of a bad cutover is bounded to that surface.

## What to Monitor After Cutover

The metrics that matter day-1 are not the same as the metrics that matter month-1. Both phases have their own [dashboards](/glossary#dashboard).

**Initial observation window:**

- Sustained denial rate per surface, per tenant
- Kill-switch state (boolean — is the gate live or off?)
- Page volume from the on-call rotation
- A sample of denied actions, manually classified — confirms the gate is denying the intended pattern

**Longer comparison window:**

- Voice reserve-to-commit ratio, trending; for the other three surfaces, application-rule fire rates vs the shadow-mode baseline
- Drift in (target, intent) distribution for clicks — A/B tests, new admin features, agent prompt updates all show up here first
- Memory store growth + write-quota utilization per tenant
- Per-session promotion budget consumption vs cap
- Per-call voice reservation accuracy

**Ongoing:**

- Anything in the surface-specific drift signals from [policy drift](/blog/policy-drift-in-ai-agents). Memory writes, in particular, are a slow-drift surface — what shadow data shows in week 1 may not be what production looks like in month 3.

A runbook entry per enforced surface keeps its host rules, budget integration, and rollback procedure explicit. A cross-surface entry can document shared application kill switches.

## A Short Runbook Template

For each surface that has cut over to enforcement, commit the following entries to the team's on-call runbook:

1. **Where the gate lives** — file path, server endpoint, policy ID
2. **How to flip it off** — exact command or UI step for the kill switch
3. **What a healthy denial looks like** — sample classified shadow denial from the calibration phase
4. **What an unhealthy denial pattern looks like** — sample anomaly from the rollback decision tree
5. **Who to page** — owner of the surface's policy, separate from the agent owner
6. **How to read the metrics** — link to the dashboard, with the three signals that matter most for this surface
7. **What to do on the first denial after a deploy** — separate playbook entry because deploys are a common source of drift

A team without these runbook entries in place at cutover is one routine on-call rotation away from rediscovering them under pressure.

## What Action Authority Adoption Is Not

A few patterns to avoid, drawn from teams that have done this before:

- **Don't cut over all surfaces simultaneously.** The whole point of per-surface gates is per-surface blast radius. A simultaneous cutover collapses that property.
- **Don't skip shadow mode because "we already know what to enforce."** The team that knows what to enforce is the team that has been wrong before; the shadow phase is how you find out where you're wrong this time.
- **Don't treat the cutover date as the goal.** The goal is enforcement that meets the surface's exposure and availability objectives; rollback is a designed response, not proof that the rollout failed.
- **Don't infer effectiveness from denial rate alone.** A zero production-denial rate can be valid, but test cases must demonstrate that the boundary denies the failures it is meant to catch.
- **Don't separate authority from observability.** Correlate host authorization records, Cycles lifecycle data, and action outcomes. Together they can support an audit, but budget records alone do not prove the action was authorized or compliant.

## What Action Authority Adoption Is

A practical readiness package includes the surface inventory, application-owned preflight records, tested host rules, calibrated budget amounts, a per-surface cutover order, a tested application kill switch, and runbook entries written before enforcement.

The framework is the cheap part. The rollout is the work.

## Next Steps

- **[Shadow Mode to Hard Enforcement: The Cutover Decision Tree](/blog/shadow-to-enforcement-cutover-decision-tree)** — the signal-driven decision tree this post extends per surface
- **[How to Add Runtime Enforcement Without Breaking Your Agents](/blog/how-to-add-runtime-enforcement-without-breaking-your-agents)** — the underlying shadow-mode instrumentation playbook
- **[Operating Budget Enforcement in Production](/blog/operating-budget-enforcement-in-production)** — the on-call patterns that apply to action-authority gates unchanged
- **[Estimate Drift: The Silent Killer of Budget Enforcement](/blog/estimate-drift-silent-killer-of-enforcement)** — calibration signals that apply to every surface
- **[Operational Runbook: Using Cycles Runtime Events](/blog/operational-runbook-using-cycles-runtime-events)** — how to wire the events into on-call
- **[What Four New Surfaces Taught Us](/blog/what-four-new-surfaces-taught-us)** — the synthesis this rollout playbook supports
- **[Agent Memory Writes Are Actions, Too](/blog/agent-memory-writes-are-actions-too)** — surface 1
- **[When Coding Agents Press Merge](/blog/when-coding-agents-press-merge)** — surface 2
- **[Computer-Use Agents Have No Tool Boundary](/blog/computer-use-agents-have-no-tool-boundary)** — surface 3
- **[Reserving Authority When You Can't Pause](/blog/voice-agent-budgets-when-you-cant-pause-to-reserve)** — surface 4
