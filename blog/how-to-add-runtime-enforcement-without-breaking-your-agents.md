---
title: "Add Runtime Enforcement Without Breaking Agents"
date: 2026-04-06
author: Albert Mavashev
tags: [engineering, production, best-practices, agents, runtime-authority, architecture, shadow-mode]
description: "Use shadow mode to introduce runtime enforcement, calibrate policy against real traffic, and cut over safely without disrupting production AI agents reliably."
blog: true
sidebar: false
featured: false
head:
  - - meta
    - name: keywords
      content: runtime enforcement, AI agent shadow mode, policy calibration, safe rollout, production agents, runtime authority
---

# How to Add Runtime Enforcement Without Breaking Your Agents

A common objection to adding runtime enforcement to a running agent system isn't cost. It's fear: *"what if it blocks something legitimate?"*

It's a fair fear. Enforcement that fires at the wrong time looks identical to a broken system. A customer agent that can't send a confirmation email because the budget ran out is indistinguishable, from the customer's perspective, from a bug.

This post is about the answer to that fear: **shadow mode** (also called dry-run). Run enforcement in observe-only mode against real production traffic, watch what it *would* have done, calibrate, then progressively turn it on. In Cycles, this is enabled by setting `dry_run: true` on reservation requests — the server evaluates the full reservation path (scope derivation, budget checks, decision, caps) and returns the decision it would have made, without creating a reservation or touching balances.

It's not a new idea. WAFs, rate limiters, and admission controllers all provide observe-before-block rollout patterns; the agent-specific failure modes are what differ here.

<!-- more -->

## Shadow Mode Is an Established Pattern

Before diving into the agent-specific parts, it's worth noting that this is how safety-critical enforcement gets deployed across the industry:

| System | Shadow mode mechanism |
|---|---|
| **Istio** | `istio.io/dry-run: "true"` annotation — policies evaluate but don't block |
| **OPA Gatekeeper** | `enforcementAction: dryrun` — violations logged, admission proceeds |
| **Cloudflare WAF** | `Log` action available for observe-first rollout before `Block` |
| **Google Binary Authorization** | Dry-run mode logs violations, deployments proceed |
| **Stripe rate limiters** | *"Dark launch each rate limiter to watch the traffic they would block"* ([Stripe Engineering](https://stripe.com/blog/rate-limiters)) |
| **ML models** | Shadow deployment — new model sees production traffic, predictions logged but not acted on |

The pattern is consistent across the industry: **observe → calibrate → enforce progressively → keep a kill switch.**

Cycles follows the same playbook, with one important difference: agents have failure modes that static infrastructure doesn't. An agent in a retry loop generates hundreds of reservation attempts per minute. A multi-agent delegation chain can fan out into dozens of sub-agent calls from a single user request. Shadow mode surfaces those patterns *before* you discover them as outages.

## The Shadow Mode Rollout Sequence

Here's the progression we recommend, and the questions each phase answers:

| Phase | Duration | Mode | Question it answers |
|---|---|---|---|
| **1. Instrument** | 1-2 days | Reservation calls with `dry_run: true`; no reservation or balance mutation | Are we sending the right signals? |
| **2. Shadow observation** | 1-2 weeks | `dry_run: true` — evaluate but don't block | What *would* enforcement have done? |
| **3. Calibrate** | 1 week | Adjust budgets based on shadow data | Are our budgets the right size? |
| **4. Progressive enforcement** | 2-4 weeks | Enforce on low-risk paths first | Does enforcement work in practice? |
| **5. Full enforcement** | Ongoing | All scopes enforcing | Are budgets still right as usage evolves? |

The durations are illustrative, not product requirements. Adjust them to traffic volume, workload criticality, and how quickly your application-side observation store accumulates representative outcomes.

## Phase 1: Instrument

Before enforcement exists in shadow mode or otherwise, the agent needs to call the enforcement API at the protected points in its lifecycle. Each model or tool path with positive cost or side-effect exposure should produce a reservation attempt. A sub-agent handoff needs its own reservation only when the application assigns positive exposure to the handoff; otherwise record the handoff as application telemetry or a zero-amount Cycles event.

This phase is about catching **missing signals**. If the agent sometimes calls a tool without first reserving, shadow mode will look cleaner than reality — because the dangerous calls aren't being checked. The instrument phase ensures the shape of the data is correct before you start measuring it.

**What you're looking for:** dry-run calls matching the protected action paths, decisions returning for every attempt, and no gaps where a path assigned positive exposure acts without evaluation. (In dry-run, the response has no `reservation_id` — that appears only once you move to live reservations in Phase 4.)

## Phase 2: Shadow Observation

This is the core observation phase. Shadow mode returns what enforcement *would* do—which reservations would return `DENY`, `ALLOW_WITH_CAPS`, or `ALLOW`—without blocking or persisting a reservation.

Every dry-run request returns a decision without blocking or executing the proposed action. The application chooses to proceed and must log each response with the proposed action, run identifier, and actual outcome if it wants a record to analyze later; the server does not create a durable shadow reservation.

**What to measure during shadow mode:**

1. **Denial rate** — what percentage of reservations would have been denied?
2. **Denial location** — which scopes fire most often? (tenant, workspace, app, workflow, agent, or toolset?) If you need a ledger per run, map the run ID to `subjects.workflow`; a run ID in `dimensions` is attribution only.
3. **Estimate accuracy** — how far are estimates from actual usage captured separately by the application? Dry-run produces no commit.
4. **Workflow distribution** — are denials concentrated in specific agent workflows?
5. **Runaway indicators** — are there bursts of reservations that look like retry loops?

This data is what distinguishes calibrated enforcement from decorative enforcement.

## Phase 3: Calibrate Against Your SLOs

After enough representative traffic, your application-side shadow dataset can inform budget sizing.

There is no universal acceptable denial percentage. Classify each would-deny outcome against your workload and user-impact objectives:

| Shadow result | Question to answer | Typical response |
|---|---|---|
| Legitimate paths are denied | Is the estimate, scope mapping, or limit wrong? | Fix the signal or resize the budget |
| Known runaway cases are allowed | Is the path missing instrumentation or is the limit too loose? | Add coverage or tighten the relevant ledger |
| Denials cluster in one workflow | Does that workflow need a distinct policy or degradation path? | Tune that workflow instead of broad tenant limits |
| Normal and failure scenarios behave as intended | Does the observed sample cover representative traffic and edge cases? | Begin progressive enforcement |

A zero shadow-denial rate can be valid for stable traffic, but it does not prove that the limits catch the failures you care about. Exercise known retry, fan-out, and runaway scenarios as well as normal traffic.

## Phase 4: Progressive Enforcement

When you change protected paths from `dry_run: true` to live reservations, do not change every path at once. Progressive enforcement follows the same logic as canary deployments. Google's SRE Workbook [describes canarying](https://sre.google/workbook/canarying-releases/) as a partial, time-limited change evaluated before wider rollout.

For agent enforcement, "fractions" means **by risk tier**:

1. **Low-risk paths first** — read-only tools, search, lookup. If budget here is wrong, the blast radius is a slow response, not a broken workflow.
2. **Medium-risk paths next** — generation, summarization, database reads. A wrong denial here is noticeable but recoverable.
3. **High-risk paths last** — email sending, deployments, payments, database mutations. These are the actions you most want to enforce, but also the ones where a false positive hurts most.

This ordering inverts the usual intuition ("enforce the dangerous ones first"). The reason is calibration confidence. By the time you're enforcing on `send_email`, you've already validated your budget sizing on lower-risk paths. A surprise at the email level is much more expensive than a surprise at the search level.

**Keep a kill switch.** An application feature flag that restores `dry_run: true` or bypasses the integration without a redeploy — the [kill switch pattern](https://launchdarkly.com/docs/home/flags/killswitch) — lets operators respond promptly if enforcement starts producing incorrect denials.

## Phase 5: Full Enforcement + Continuous Calibration

Agents evolve and usage patterns change. Continue watching denial rate, estimate accuracy, and workflow distribution after enforcement begins, and recalibrate when behavior changes.

Most importantly: when you add new agent workflows or tools, **re-enter shadow mode for those paths**. Don't assume your existing calibration covers them.

## What Shadow Mode Reveals That You Can't See Otherwise

Before enforcement, application-side shadow records can expose three patterns without intentionally blocking live work:

### Runaway loop signatures

An application shadow log showing 47 reservation attempts from one run in 90 seconds may indicate a retry loop. Correlate the dry-run responses with application traces to distinguish retries, intentional fan-out, and duplicate instrumentation.

### Delegation chain amplification

In multi-agent systems, a single user request can fan out into many sub-agent calls. Cycles dry-run responses show the submitted subjects, estimates, and hypothetical budget decisions; they do not infer the delegation graph, depth, or tool permissions. Join application handoff logs to those responses when evaluating whether explicit child ledgers and narrower host permissions are needed.

### Where you need degradation paths

Shadow mode doesn't just tell you *whether* to enforce. It tells you *where you need [graceful degradation](/how-to/how-to-think-about-degradation-paths-in-cycles-deny-downgrade-disable-or-defer)*. If shadow data shows repeated denials at a specific workflow step, the answer isn't always "raise the budget." Sometimes it's "this workflow needs a model downgrade path" or "this action should be deferred when budget is tight." Shadow mode reveals the shape of those needs before enforcement surfaces them as user-facing failures.

## Common Shadow Mode Mistakes

**Treating shadow mode as a checkbox.** A short sample may miss periodic jobs, traffic spikes, or rare failure paths. Observe enough representative traffic and exercise known edge cases before drawing conclusions.

**Enabling too many scopes at once.** Dry-run evaluation does not consume balances, but interpreting many simultaneous budget scopes is still difficult. Start with one or two standard scopes, such as tenant and workflow, and add more once those are calibrated.

**Staying in shadow mode forever.** The purpose of shadow mode is to prepare for enforcement, not replace it. Move a path to live reservations when its representative outcomes, degradation behavior, and rollback procedure meet your own cutover criteria.

**Looking only at averages.** A low overall denial rate can hide a much higher rate on one workflow. Break metrics down by scope and workflow, then inspect whether the concentrated denials are intended.

**Ignoring estimate accuracy.** If your estimates are consistently 3x higher than actuals, your budgets are effectively 3x tighter than you think. Estimate drift is the silent killer of calibrated enforcement.

## The Take

Shadow mode turns enforcement from an all-or-nothing cutover into a measurable, reversible rollout. The same observe-before-block pattern used in policy and traffic-control systems applies to AI agents, with application logging added because Cycles dry-run responses do not persist reservation state.

If you're considering runtime enforcement and the fear is "what if it blocks something legitimate," dry-run evaluation lets you test the answer. Collect representative application-side results, size the budgets against your own SLOs, and then enforce progressively from lower-impact to higher-impact paths.

For production paths with meaningful user impact, skipping observation increases the chance that an incorrectly sized or mis-scoped budget blocks legitimate work. If an emergency or low-risk rollout cannot support a long shadow period, compensate with narrower scope, explicit degradation behavior, and a tested rollback switch.

---

- [What Is Runtime Authority for AI Agents](/blog/what-is-runtime-authority-for-ai-agents)
- [How Teams Control AI Agents Today — And Where It Breaks](/blog/how-teams-control-ai-agents-today-and-where-it-breaks)
- [Risk Assessment: Score, Classify, and Enforce Tool Risk](/blog/ai-agent-risk-assessment-score-classify-enforce-tool-risk)
- [Budget Patterns Visual Guide](/blog/agent-budget-patterns-visual-guide)
- [Shadow Mode Rollout Guide (how-to)](/how-to/shadow-mode-in-cycles-how-to-roll-out-budget-enforcement-without-breaking-production)
- [GitHub: runcycles](https://github.com/runcycles)
