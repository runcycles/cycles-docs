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

<!-- more -->

## Why a Phased Rollout, Per Surface

The reasons that make calendar-driven cutovers fail for budget enforcement apply unchanged to the new surfaces. The healthy pattern is the same: instrument first, observe, calibrate, then enforce — per surface, not in one big bang. The [synthesis post](/blog/what-four-new-surfaces-taught-us) framed reserve-commit as the stable layer the four surfaces preserved at their boundaries: every surface gets the same shape of rollout, with different specifics in the middle.

The four-week structure that fits most teams:

| Week | Goal | Output |
|---|---|---|
| 1 | Inventory the agent fleet's action surfaces | Surface-by-surface list with current gate state |
| 2 | Shadow-mode instrumentation, per surface | Dry-run decisions flowing for every surface |
| 3 | Per-surface gate primitives + calibration | Surface-specific caps tuned against shadow data |
| 4 | Cutover, surface by surface, in false-positive-cost order | Hard enforcement on the surface where a wrongful denial costs least first; remaining surfaces on a planned schedule |

The schedule is illustrative. Teams with mature shadow-mode tooling and a single surface in scope can move faster; teams adopting all four surfaces simultaneously will usually want two weeks per surface, not one. The structure is the load-bearing piece, not the calendar.

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

The output is usually a mess of rows where the team realizes a third of the agent's actions don't have any pre-execution gate and another third have a gate that does the wrong thing (rate limit when it should be authority, content guardrail when it should be [action authority](/glossary#action-authority)). That mess is the actual inventory.

A useful sanity check at the end of week 1: every row in the inventory should map to exactly one of the canonical surfaces (outbound tool, memory write, merge, click, voice, or a sibling not yet covered). Rows that don't map are typically either misclassified or signal a new surface the corpus has not addressed yet. Either is worth a separate conversation before instrumentation.

## Week 2: Shadow-Mode Instrumentation Per Surface

Once the inventory exists, every row needs a shadow-mode path. The general dry-run pattern from [How to Add Runtime Enforcement Without Breaking Your Agents](/blog/how-to-add-runtime-enforcement-without-breaking-your-agents) applies; what changes per surface is what gets instrumented.

| Surface | Shadow-mode call | What to log |
|---|---|---|
| Outbound tool calls | `decide()` / `reserve(dry_run: true)` before the tool dispatches | Tool name, args, would-be decision, would-be caps |
| Memory writes | `decide()` against the write target + scope before the memory layer persists | Operation, scope, provenance fields, would-be decision |
| Merge buttons | Pre-execution hook on `gh pr merge` (or equivalent) in the agent harness | Source branch, target branch, head SHA, agent identity, would-be decision |
| Computer-use clicks | Pre-emission hook on the click event in the agent harness | URL pattern, DOM target (if available), action verb, screenshot crop, would-be decision |
| Voice frames | [Reservation](/glossary#reservation)-at-call-start probe, plus per-turn-boundary dry-run | Call-level features, predicted consumption, would-be reservation amount |

The output of week 2 is a stream of dry-run decisions per surface. Teams with mature event pipelines route these into the same observability stack they use for everything else; teams without can start with structured logs. Either works for the calibration phase.

A few practical things to watch for during week 2:

- **Volume.** Memory writes and clicks generate far more decisions per unit time than tool calls or merges. Don't accidentally page on every shadow decision; aggregate first.
- **Sampling.** For very high-frequency surfaces (clicks, voice frames), sampling the shadow stream is acceptable as long as the sampler is deterministic per session. Random sampling across sessions makes the calibration data hard to interpret.
- **PII.** Memory write payloads, voice transcripts, and screenshot crops are all PII-bearing in many deployments. The shadow stream needs the same redaction the production audit trail has. Treat shadow-mode data with at least the same care as the production logs.

## Week 3: Per-Surface Gate Primitives and Calibration

With shadow data flowing, week 3 is where the per-surface specifics enter the picture. Each surface gets its own gate primitives, calibrated against the shadow stream.

### Memory writes

| Gate primitive | What it does | Tune against |
|---|---|---|
| Per-tenant write quota | Cap writes per run per tenant scope | Distribution of writes-per-run from shadow data |
| TTL on unverified facts | Facts written without corroboration auto-expire | Survival rate of memory entries vs production retention need |
| Per-write provenance | Run ID + agent identity + risk-budget context attached to every write | Existing audit trail — fields you already log |
| Scope isolation enforcement | Reject cross-tenant writes unless explicitly allowed | Shadow events showing cross-tenant attempts |

Calibration target (starting heuristic): when shadow mode is evaluating the proposed quotas, the would-be denial rate on memory writes typically sits in the 1–5% band once the calibration data has stabilized — which usually takes at least a week of representative production traffic. Substantially higher rates suggest the quota is too tight; substantially lower rates suggest the quota isn't constraining anything in practice. Tune from the shadow data, not from this band alone. (Calibrating four surfaces in parallel typically requires extending Week 3 to 2–3 weeks; the table above is the single-surface schedule.)

### Merge buttons

| Gate primitive | What it does | Tune against |
|---|---|---|
| Distinct-approver rule | Block merges where author and approver share the same agent identity | Sample of agent-authored PRs and their approval chains |
| `requires_human_approval` cap | Force a human in the loop on protected-branch merges from agents | Frequency of agent-merge requests in shadow data |
| Per-session promotion budget | Cap [RISK_POINTS](/glossary#risk-points) for merges in a single session | Distribution of merges-per-session from shadow data |
| Deploy-gate cap | Allow merge but defer auto-deploy until a human releases | Auto-deploy [fan-out](/glossary#fan-out) from shadow data |

Calibration target: shadow data should show clean separation between routine PR merges (small risk, low session totals) and the runaway-fanout patterns the gate is meant to catch. If the two populations overlap on the risk axis, the caps need tightening.

### Computer-use clicks

| Gate primitive | What it does | Tune against |
|---|---|---|
| `requires_fresh_screenshot` cap | Click must use a recent screenshot, not one cached more than N seconds ago | Distribution of screenshot-to-click latency from shadow data |
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

Calibration target: the reserve-to-commit ratio (per the [estimate-drift framework](/blog/estimate-drift-silent-killer-of-enforcement)) should sit between 0.8 and 1.2 on call-level reservations after the first week of shadow data. If it's drifting, recalibrate before cutover.

Across all four surfaces, the calibration signals echo the [shadow-to-enforcement decision tree](/blog/shadow-to-enforcement-cutover-decision-tree): false-positive denial rate, calibration accuracy (where it can be defined — voice has a true reserve-to-commit ratio; the others use cap-fire rate vs shadow baseline as the analogue), instrumentation coverage, and operational readiness. The thresholds vary by surface; the questions don't.

## Week 4: Cutover, Lowest-False-Positive-Cost Surface First

The cutover decision is per-surface, not all-or-nothing. The order below is ranked by *cost of a false-positive denial* — what happens if the gate denies an action the team meant to allow — not by the action's own blast radius (which the four siblings address). Lowest-cost-of-false-positive first:

1. **Memory writes** — the highest-volume surface, where a denied write is cheap to recover from. The agent can retry or work around; few false-positive denials produce immediate customer-facing damage. Good first.
2. **Computer-use clicks** — similar volume, more sensitive to false positives because a denied click can break a workflow mid-step. The fresh-screenshot cap is the one that needs the most calibration headroom.
3. **Voice frames** — lower per-call volume but higher per-failure visibility (a denied frame mid-conversation is audible). The predictive reservation pattern means most of the cutover risk is concentrated in the first 24 hours.
4. **Merge buttons** — lowest volume but highest cost per false-positive denial. A denied merge that should have been allowed produces a stuck PR and an engineering escalation. Last.

Each cutover follows the same per-surface checklist:

- Shadow data shows the calibration targets met for at least the last 7 days
- The team has classified a sample of would-be denials. >85% in the intended class is a minimum triage bar before cutover; substantially higher fractions are the target for sensitive surfaces (merge, voice mid-conversation)
- An on-call rotation knows what to do when the first denial fires (per the [operating-budget-enforcement guide](/blog/operating-budget-enforcement-in-production))
- The kill switch is wired and tested — flipping the gate back to shadow mode should take seconds, not a deploy
- The rollback decision tree (below) is reviewed and signed off

The cutover itself is undramatic when the calibration is good. The first denial that fires looks like the shadow denials the team has been classifying for days. The on-call playbook handles it. The next 24 hours produce some scattered denials, mostly on patterns the team has seen before. By day 3, the metrics stabilize.

The cutover is undramatic in a different way when the calibration is bad. The first hour produces a denial rate the team has not seen before. The on-call playbook handles five denials, then ten, then a hundred. The kill switch is for that hour. Treat its existence as a routine operational primitive, not a failure marker.

## The Rollback Decision Tree

| Signal observed | Reaction |
|---|---|
| Denial rate >2× shadow-data rate, sustained over 1 hour | Flip the gate back to shadow mode; resume tuning |
| Denial rate >5× shadow-data rate, sustained over 15 minutes | Kill switch — gate fully off; incident review |
| Reserve-to-commit ratio drifts outside 0.8–1.2 in a 24-hour window *(voice-specific; the ratio is well-defined for predictive reservation but not for the other surfaces' cap-fire denominators)* | Adjust reservation estimates; keep enforcement live |
| A specific tenant produces a disproportionate share of denials (rough starting heuristic: >20%) | Partial rollback — exempt that tenant scope, keep enforcement on the rest |
| The same agent identity produces a disproportionate share of denials (rough starting heuristic: >40%) | Scope rollback — exempt that agent, investigate separately |
| Surface-specific cap fires above the calibrated baseline (rough starting heuristic: a 30%+ jump from shadow data, e.g. on `requires_fresh_screenshot`) | Tune the cap, do not roll the whole surface back |

The decision tree is per-surface. Memory writes rolling back does not require clicks to roll back. The point of cutting over one surface at a time is that the blast radius of a bad cutover is bounded to that surface.

## What to Monitor After Cutover

The metrics that matter day-1 are not the same as the metrics that matter month-1. Both phases have their own [dashboards](/glossary#dashboard).

**First 72 hours:**

- Sustained denial rate per surface, per tenant
- Kill-switch state (boolean — is the gate live or off?)
- Page volume from the on-call rotation
- A sample of denied actions, manually classified — confirms the gate is denying the intended pattern

**First month:**

- Voice reserve-to-commit ratio, trending; for the other three surfaces, cap-fire rates vs the shadow-mode baseline
- Drift in (target, intent) distribution for clicks — A/B tests, new admin features, agent prompt updates all show up here first
- Memory store growth + write-quota utilization per tenant
- Per-session promotion budget consumption vs cap
- Per-call voice reservation accuracy

**Ongoing:**

- Anything in the surface-specific drift signals from [policy drift](/blog/policy-drift-in-ai-agents). Memory writes, in particular, are a slow-drift surface — what shadow data shows in week 1 may not be what production looks like in month 3.

A runbook entry per surface is the minimum bar. Most teams find they want one per surface plus one cross-surface entry for the kill switch.

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
- **Don't treat the cutover date as the goal.** The goal is the enforcement that works in production. A cutover that has to roll back the same week was not a successful cutover.
- **Don't tune away the denial rate to zero.** A gate that never fires is a gate that is not protecting anything. Some denial rate is expected and healthy.
- **Don't separate authority from observability.** The same audit trail that catches drift in policy is the audit trail that proves to auditors the system was under control. They are not two systems.

## What Action Authority Adoption Is

A minimum bar: the inventory from week 1, the shadow data from week 2, the per-surface caps tuned in week 3, and the per-surface cutover in week 4 (or weeks 4–N for multi-surface adoption) in false-positive-cost order with a tested kill switch, runbook entries committed before the cutover, and the discipline of treating each new surface as its own rollout on its own schedule.

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
