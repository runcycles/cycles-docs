---
title: "How to Add Runtime Enforcement Without Breaking Your Agents"
date: 2026-04-06
author: Albert Mavashev
tags: [engineering, production, best-practices, agents, runtime-authority, architecture, shadow-mode]
description: "Shadow mode is the safe way to add runtime enforcement to AI agents. Roll out observe-first, calibrate, then enforce without breaking production."
blog: true
sidebar: false
featured: false
---

# How to Add Runtime Enforcement Without Breaking Your Agents

The #1 objection to adding runtime enforcement to a running agent system isn't cost. It's fear: *"what if it blocks something legitimate?"*

It's a fair fear. Enforcement that fires at the wrong time looks identical to a broken system. A customer agent that can't send a confirmation email because the budget ran out is indistinguishable, from the customer's perspective, from a bug.

This post is about the answer to that fear: **shadow mode** (also called dry-run). Run enforcement in observe-only mode against real production traffic, watch what it *would* have done, calibrate, then progressively turn it on. In Cycles, this is enabled by setting `dry_run: true` on reservation requests — the server evaluates the full reservation path (scope derivation, budget checks, decision, caps) and returns the decision it would have made, without creating a reservation or touching balances.

It's not a new idea — it's how every serious piece of enforcement infrastructure gets rolled out, from WAFs to rate limiters to Kubernetes admission controllers. The specifics for AI agents are what's new.

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
| **1. Instrument** | 1-2 days | Reservation calls with `dry_run: true`, no budget state created | Are we sending the right signals? |
| **2. Shadow observation** | 1-2 weeks | `dry_run: true` — evaluate but don't block | What *would* enforcement have done? |
| **3. Calibrate** | 1 week | Adjust budgets based on shadow data | Are our budgets the right size? |
| **4. Progressive enforcement** | 2-4 weeks | Enforce on low-risk paths first | Does enforcement work in practice? |
| **5. Full enforcement** | Ongoing | All scopes enforcing | Are budgets still right as usage evolves? |

The first four phases take **4-8 weeks** for most teams. That might sound long — it's not. The cost of breaking a production agent system with over-tight budgets on day one is larger than the cost of a careful rollout.

## Phase 1: Instrument

Before enforcement exists in shadow mode or otherwise, the agent needs to call the enforcement API at the right points in its lifecycle. Every LLM call, every tool call, every sub-agent spawn should produce a reservation attempt.

This phase is about catching **missing signals**. If the agent sometimes calls a tool without first reserving, shadow mode will look cleaner than reality — because the dangerous calls aren't being checked. The instrument phase ensures the shape of the data is correct before you start measuring it.

**What you're looking for:** reservation calls matching the agent's actual tool call rate, decisions returning for every attempt, no gaps where the agent acts without reserving. (In dry-run, the response has no `reservation_id` — that appears only once you move to live reservations in Phase 4.)

## Phase 2: Shadow Observation

This is the meat of the rollout. Shadow mode logs what enforcement *would* do — which reservations would be DENIED, which would return ALLOW_WITH_CAPS, which would pass — without actually blocking anything.

Every reservation returns a decision. The agent proceeds regardless. But now you have a record of what enforcement would have looked like.

**What to measure during shadow mode:**

1. **Denial rate** — what percentage of reservations would have been denied?
2. **Denial location** — which scopes fire most often? (per-run, per-tenant, per-workflow?)
3. **Estimate accuracy** — how far off are your cost predictions from actual commits?
4. **Workflow distribution** — are denials concentrated in specific agent workflows?
5. **Runaway indicators** — are there bursts of reservations that look like retry loops?

This data is what distinguishes calibrated enforcement from decorative enforcement.

## Phase 3: Calibrate — The Goldilocks Zone

After 1-2 weeks of shadow observation, you have real numbers. Now you decide what your budgets should actually be.

There's a useful heuristic for denial rates:

| Denial rate (shadow mode) | What it means | What to do |
|---|---|---|
| **> 5%** | Budgets are too tight — enforcement would break legitimate work | Increase limits, review specific denied workflows |
| **3-5%** | Budgets are catching edge cases but running warm | Investigate specific denials before enforcing |
| **1-3%** | The goldilocks zone — catching real anomalies without blocking legitimate work | Ready to enforce |
| **0%** | Budgets are decorative — too loose to catch anything | Tighten limits, they're not doing work |

The 5% threshold isn't arbitrary. At that rate, one in twenty legitimate user interactions would fail in production. That's not enforcement — that's an incident.

But zero denials is equally wrong. A budget that never fires isn't preventing anything. It's documentation that says *"we have a budget,"* and that documentation has no enforcement value. If shadow mode shows 0% denial rate over two weeks of real traffic, your limits are too high to catch the incidents you're trying to prevent.

The honest answer is usually somewhere in the 1-3% range. That's the zone where enforcement catches real anomalies (retry loops, runaway agents, tool access abuse) without blocking legitimate work. Note that this is the calibration-time shadow rate — once you're enforcing in steady state, target a [sustained denial rate under 2%](/blog/operating-budget-enforcement-in-production).

## Phase 4: Progressive Enforcement

When you flip the switch from shadow to enforce, don't flip all of it at once. Progressive enforcement is the rule for the same reason canary deployments are. Google's SRE Workbook [defines canarying as](https://sre.google/workbook/canarying-releases/) *"a partial and time-limited deployment of a change in a service and its evaluation"* — the same logic applies to enforcement rollout.

For agent enforcement, "fractions" means **by risk tier**:

1. **Low-risk paths first** — read-only tools, search, lookup. If budget here is wrong, the blast radius is a slow response, not a broken workflow.
2. **Medium-risk paths next** — generation, summarization, database reads. A wrong denial here is noticeable but recoverable.
3. **High-risk paths last** — email sending, deployments, payments, database mutations. These are the actions you most want to enforce, but also the ones where a false positive hurts most.

This ordering inverts the usual intuition ("enforce the dangerous ones first"). The reason is calibration confidence. By the time you're enforcing on `send_email`, you've already validated your budget sizing on lower-risk paths. A surprise at the email level is much more expensive than a surprise at the search level.

**Keep a kill switch.** A feature flag that can disable enforcement without a redeploy — the [kill switch pattern](https://launchdarkly.com/docs/home/flags/killswitch) — is standard practice for exactly this reason. If enforcement starts firing incorrectly at 2 AM, you want to flip back to shadow mode in seconds, not wait for a deploy cycle.

## Phase 5: Full Enforcement + Continuous Calibration

Agents evolve. Usage patterns change. A budget that was right at month 1 won't be right at month 6. In practice, shadow mode rollout never really ends — you keep running enforcement continuously, but you also keep watching the metrics shadow mode taught you to watch: denial rate, estimate accuracy, workflow distribution.

Most importantly: when you add new agent workflows or tools, **re-enter shadow mode for those paths**. Don't assume your existing calibration covers them.

## What Shadow Mode Reveals That You Can't See Otherwise

Beyond calibration, shadow mode surfaces three things production monitoring alone misses:

### Runaway loop signatures

A shadow log that shows 47 reservation attempts from a single run in 90 seconds isn't a calibration issue. It's a retry loop your agent is in. Shadow mode catches this as a pattern — the enforcement layer is the first system that sees the loop as a loop, because it's the only system counting reservations per scope.

### Delegation chain amplification

In multi-agent systems, a single user request can fan out into dozens of sub-agent calls. Shadow mode shows you the [delegation topology](/blog/agent-delegation-chains-authority-attenuation-not-trust-propagation) — which parents spawn how many children, how deep the chains go, and whether sub-agents are getting over-broad authority. This is the data that justifies adding [authority attenuation](/blog/agent-delegation-chains-authority-attenuation-not-trust-propagation) vs. just capping top-level budgets.

### Where you need degradation paths

Shadow mode doesn't just tell you *whether* to enforce. It tells you *where you need [graceful degradation](/how-to/how-to-think-about-degradation-paths-in-cycles-deny-downgrade-disable-or-defer)*. If shadow data shows repeated denials at a specific workflow step, the answer isn't always "raise the budget." Sometimes it's "this workflow needs a model downgrade path" or "this action should be deferred when budget is tight." Shadow mode reveals the shape of those needs before enforcement surfaces them as user-facing failures.

## Common Shadow Mode Mistakes

**Treating shadow mode as a checkbox.** Running shadow mode for three days, seeing low denial rates, and declaring victory. Real usage patterns take 1-2 weeks to emerge.

**Enabling too many scopes at once.** Shadow mode is cheap, but interpreting five simultaneous budget scopes is not. Start with 1-2 scopes (per-run, per-tenant), add more once those are calibrated.

**Staying in shadow mode forever.** The purpose of shadow mode is to enable enforcement, not to replace it. Teams that stay in shadow mode past calibration are paying the cost of enforcement infrastructure without getting the benefit. If your numbers are stable for two weeks, enforce.

**Looking only at averages.** A 1% average denial rate with 20% denials on one specific workflow means that workflow is broken. Always break metrics down by scope and workflow, not just overall.

**Ignoring estimate accuracy.** If your estimates are consistently 3x higher than actuals, your budgets are effectively 3x tighter than you think. Estimate drift is the silent killer of calibrated enforcement.

## The Take

Shadow mode is the pattern that makes runtime enforcement deployable. It turns enforcement from a risky all-or-nothing cutover into a measurable, reversible rollout. It's how Stripe launches rate limiters, how Cloudflare launches WAF rules, how Google launches binary authorization policies. The same pattern works for AI agents — with the specific twist that agents generate failure patterns (retry loops, delegation fan-out) that static infrastructure doesn't.

If you're considering adding runtime enforcement to your agents and the fear is "what if it blocks something legitimate" — shadow mode is the answer. You don't have to guess. Run it in observe mode for two weeks, look at the denial rate, decide if your budgets are the right size, then enforce progressively from low-risk to high-risk paths.

Most importantly: **don't skip it**. The teams that skip shadow mode and go straight to enforcement are the teams that have the "enforcement blocked legitimate work" incident in week one. That incident is how organizations lose trust in enforcement entirely — and end up with observability-only systems that can see problems but can't prevent them.

---

- [What Is Runtime Authority for AI Agents](/blog/what-is-runtime-authority-for-ai-agents)
- [How Teams Control AI Agents Today — And Where It Breaks](/blog/how-teams-control-ai-agents-today-and-where-it-breaks)
- [Risk Assessment: Score, Classify, and Enforce Tool Risk](/blog/ai-agent-risk-assessment-score-classify-enforce-tool-risk)
- [Budget Patterns Visual Guide](/blog/agent-budget-patterns-visual-guide)
- [Shadow Mode Rollout Guide (how-to)](/how-to/shadow-mode-in-cycles-how-to-roll-out-budget-enforcement-without-breaking-production)
- [GitHub: runcycles](https://github.com/runcycles)
