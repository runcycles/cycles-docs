---
title: "A Model Upgrade Needs an Authority Review"
date: 2026-11-24
author: Albert Mavashev
tags: [agents, engineering, runtime-authority, action-control, evaluation, shadow-mode]
description: "A new model can pass the same evals and still take more actions. Diff its action footprint in RISK_POINTS before cutover, with a runnable drill included."
blog: true
sidebar: false
featured: false
head:
  - - meta
    - name: keywords
      content: "model upgrade, model migration, AI agent regression testing, action footprint, tool call regression, RISK_POINTS, shadow mode, dry run, runtime authority, action authority"
---

# A Model Upgrade Needs an Authority Review

A support agent moves to a newer model on a Tuesday. The migration checklist is green: the same tickets resolve, the eval score is flat, and the cost per ticket is down. By Friday the finance team asks why goodwill credits doubled. Nobody changed the agent's permissions. The agent had always been allowed to issue credits. The old model almost never did.

That scenario is an illustration, not a reported incident. The pattern behind it has been measured. A [Toloka analysis](https://toloka.ai/blog/gpt-5.6-got-smarter-then-it-kept-acting/) of 711 enterprise workflow tasks, bylined July 16, 2026, compared GPT-5.5 with two GPT-5.6 variants and summarized the newer model this way: "GPT-5.6 typically does the intelligent part, then keeps acting."

A model swap leaves the agent's [action authority](/glossary#action-authority) untouched and changes how much of it gets used. This post argues that the change deserves an authority review, proposes a way to measure it before cutover, and includes a drill that runs the measurement against a live server.

<!-- more -->

## Why agent evals miss a change in actions

**Many evals grade outcomes.** A ticket counts as resolved when the refund exists and the customer got a reply. A grader like that does not fail a run for a second reply or an unrequested credit. A grader that checks the exact final state catches the extra writes that leave a record, and still misses a read-back that leaves the data identical. Toloka's grader scored "only on the exact final database state," and every effort-matched GPT-5.6 configuration scored below GPT-5.5, by 3.7 to 8.7 percentage points. The post examines 123 strong regressions, counted as task and configuration pairs, and two reviewer-model passes classed 39 and 43 of them as surplus action: a duplicate case, ticket, or notification, or a correct action followed by more writes. Its trajectory analysis reports exact duplicate calls rising "from 19% to 24–30%."

The authors state one alternative they could not exclude: the two models were collected in different months, so hidden serving-side drift is possible. Their tasks are private, and this is one vendor's benchmark.

**Operational behavior varies more than answer quality.** [Arize ran seven models](https://arize.com/blog/what-we-learned-testing-7-models-under-the-same-agent-harness/) through one harness on 19 read and analysis tasks, ten times each, in a May 2026 post. Correctness stayed within a 5.5-point band. Average tool calls per task ranged from 1.45 for Sonnet 4.6 to 5.82 for Gemini 3 Flash. Its summary: "Operational behavior moved more than final-answer quality." Those tasks only read data, on one fixture, so the result shows that tool-call volume differs between models and says nothing about writes.

**Vendors tell you to measure.** OpenAI's [upgrade guide for GPT-5.6 Sol](https://developers.openai.com/api/docs/guides/upgrading-to-gpt-5p6-sol.md) says "Do not perform a blind model-string replacement" and lists "tool choice, tool arguments, retries, loop count, and completion rate" among the things to measure. [OpenRouter's regression-testing guide](https://openrouter.ai/blog/tutorials/ai-agent-regression-testing-after-a-prompt-or-model-change/) says to "hold the prompt, tools, cases, judge, and inference parameters still and vary only the model," and to assert on which tools were called with which arguments. Microsoft's Waldek Mastykarz, comparing two Claude Sonnet versions across 150 runs in [a July 2026 post](https://developer.microsoft.com/blog/not-all-model-upgrades-are-upgrades/), found the newer one used 12 times more tokens at the median on the 120 architecture runs. That post measures tokens and cost, not actions.

This guidance is sound. Assertions on tool calls and hard invariants catch a wrong or forbidden call in a single case, and a footprint does not replace them. What a footprint adds is a total across a batch of tasks, in a unit that weighs each action by its consequence, so that two runs can be compared class by class.

Earlier posts made the argument in principle. [Pace AI Agent Authority as Models Advance](/blog/pace-ai-agent-authority) says a model upgrade should trigger a review of the agent's boundary, and [Policy Drift in AI Agents](/blog/policy-drift-in-ai-agents) lists a model change among the things that move an agent away from what was approved. This post is about how to run that review.

## Measure the action footprint in RISK_POINTS

[`RISK_POINTS`](/glossary#risk-points) are caller-assigned weights for actions. The operator decides that a lookup weighs 1 point, a reply 10, and a refund 30, and the harness reserves those points before each action and commits them after. [Assigning RISK_POINTS to agent tools](/how-to/assigning-risk-points-to-agent-tools) covers how to choose the weights.

An **action footprint** is the committed points by action class for a fixed set of tasks. It is this post's term, not a protocol object. Two footprints over the same tasks are directly comparable:

| Action class | Weight | Incumbent | Candidate | Change |
|---|---|---|---|---|
| `lookup` | 1 | 12 | 24 | +12 |
| `reply` | 10 | 120 | 160 | +40 |
| `update` | 20 | 40 | 40 | 0 |
| `refund` | 30 | 120 | 120 | 0 |
| `credit` | 30 | 0 | 60 | new |
| **Total** | | **292** | **404** | **+112** |

Those numbers come from the drill below, where two fixed scripts stand in for the models. The candidate script resolves the same twelve tickets and then keeps going: a second reply on four of them, a goodwill credit on two, and a read-back lookup after every one. Both runs resolve twelve of twelve tickets under an outcome grader.

The table carries three kinds of signal:

- **Volume in a class that was already used.** Replies went up by a third.
- **A class the incumbent never touched.** The credit tool was always in the catalogue. Now it is in use.
- **Cheap growth.** Lookups doubled and added 12 points. Weighting keeps that from drowning out the other two.

To get a footprint, give each model its own [scope](/glossary#scope) for the rehearsal, with a ledger per action class, and point the tools at stubs. The drill maps the rehearsal run to `workflow` and the action class to `toolset`, so the server keeps a running total for every class. Give the rehearsal ledgers a large allocation. They are there to measure, and a tight limit would cut the candidate's footprint short and hide the difference.

## Why a dry run does not measure a footprint

Cycles has a [shadow mode](/protocol/dry-run-shadow-mode-evaluation-in-cycles): a [reservation](/glossary#reservation) request sent with `dry_run: true` is evaluated in full, creates no reservation, and changes no balance. It is the right tool for [rolling out enforcement on live traffic](/blog/how-to-add-runtime-enforcement-without-breaking-your-agents). It is easy to assume it also answers the upgrade question, by replaying the candidate's actions as dry runs against production-sized ledgers and counting the denials.

It does not, because a dry run holds nothing. Each one is checked against the balances as they stand, and the previous dry run left them unchanged. The drill sends the candidate's whole plan, 48 actions worth 404 points, as dry runs against a 327-point aggregate. All 48 come back `ALLOW`. Each action fits on its own. The plan does not.

A footprint needs accumulation, so the rehearsal uses real reservations and real commits in a scope set aside for it. Dry runs stay useful for the other question: whether a single action would be admitted right now.

## Gate the model cutover on a stated tolerance

A diff needs a threshold agreed before anyone sees the result. The drill states a tolerance in points per class for the task set:

```python
# Points per class the operator accepts over the incumbent's footprint for
# this ticket set without a review. A class the incumbent never used has no
# entry, so any use of it fails the gate.
TOLERANCE = {"lookup": 15, "reply": 20, "update": 0, "refund": 0}
```

Against the table above, lookups pass at +12, replies fail at +40, and credits fail as a new class. The gate's verdict is `review`, not `reject`. A second reply might be a courtesy the business wants. A credit might be exactly what a better model should offer. Someone who owns the refund policy has to decide that, and the footprint tells them where to look.

A footprint that shrinks also deserves a look. A candidate that sends fewer replies may be skipping a required one.

## Hold allocations steady through the cutover

Rehearsal tasks are not production traffic, so the gate will miss things. The second control is to leave the production allocations where the incumbent's footprint put them and let the candidate run inside them. For one workload of twelve tickets starting from fresh balances, the drill sizes each class ledger at the incumbent's footprint plus the tolerance, and the aggregate at their sum:

| Ledger | Allocation |
|---|---|
| Aggregate | 327 |
| `lookup` | 27 |
| `reply` | 140 |
| `update` | 40 |
| `refund` | 120 |
| `credit` | none |

Two rules in the drill's harness shape what follows. It stops a ticket at the first refusal, and its grader counts a ticket as resolved when every required action ran, whatever else ran with it.

The incumbent resolves twelve of twelve tickets inside those limits. The candidate resolves nine and commits exactly 327 points. Held allocations bound the upgrade. They also show two things that are easy to get wrong.

**A class with no ledger draws on the aggregate.** Nobody provisioned a `credit` ledger, because the incumbent never issued one. The server [derives a scope path](/protocol/how-scope-derivation-works-in-cycles) from the subject, checks the reservation against every ledger on it, and skips levels that have none, so the candidate's two credits were admitted against the aggregate alone. They took 60 points that the allocation had sized for other work. Three second replies and eight read-backs had taken another 38 by the time the aggregate reached zero, on the ninth ticket's required reply.

**The refusal lands on whatever comes next.** All four refusals in that run were 1-point lookups: the ninth ticket's read-back, which came after its required actions, and the first action of each remaining ticket. The lookup ledger still had 10 points. The aggregate had none. The live `409 BUDGET_EXCEEDED` on the pinned server did not name the ledger that refused, so an operator reading the refusals alone would investigate lookups. Finding out which ledger was short, and which classes used it up, takes the balances and the harness's record of what ran.

The fix for the first problem is to make the new class explicit. The drill's last scenario adds a zero-allocation ledger for `credit` to the same limits. The server refuses a reservation when a ledger's remaining points are below the estimate, so a ledger with nothing in it refuses every action with a positive weight. Now both credits are refused, and the candidate resolves ten tickets on 320 points.

The last two tickets are each refused their required reply. By then the reply ledger is empty, with 40 of its 140 points spent on second replies, and the aggregate has fewer than 10 points left, so either ledger would have refused. A ledger counts points in a class. It cannot tell a required reply from a surplus one. Holding allocations steady limits how much more the new model can do, and it does not choose which actions get dropped.

So the order of work is:

1. Rehearse both models on the same tasks and diff the footprints.
2. Give every class in the tool catalogue a ledger before cutover, at zero for classes the incumbent never used.
3. Cut over with allocations unchanged.
4. Widen a class when someone has reviewed why the candidate uses more of it. [Budget allocation and management](/how-to/budget-allocation-and-management-in-cycles) covers the funding operations, which need a key the agent's runtime does not hold.

A model is not a scope level in any of this. In production the agent keeps the same subject before and after the upgrade, which is why the allocations carry over without anyone touching them. So do the spend and the open holds. The drill starts every run from fresh balances, and a real cutover starts from whatever remains in the current budget period, so read the remaining balance before applying a sizing rule to it.

## What a footprint diff does not tell you

**It is only as good as the task set.** Twelve replayed tickets say little about the thirteenth. A candidate can match the incumbent on rehearsal and diverge on inputs nobody replayed.

**Points are not harm.** The weights are an operator's judgment. A refund to the wrong customer and a refund to the right one weigh the same. A lower footprint does not make a model safer, and a higher one does not make it worse.

**Arguments are invisible.** A footprint counts a refund. It does not see the amount. Argument checks belong in tool-sequence assertions and in the tools themselves.

**It covers actions the harness mediates.** A model that reaches a side effect through a path that never reserves leaves no points behind. [Computer-use agents](/blog/computer-use-agents-have-no-tool-boundary) are the hard case.

**Stubs change behavior.** A model that reads back after a write may act differently when the stub returns a canned record. Keep stub responses realistic and identical for both runs.

**Runs vary.** Real models are not deterministic. One rehearsal per model is an anecdote. Arize ran each task ten times and Toloka five. The drill's scripts are deterministic so that its arithmetic can be checked, and that is the only reason its numbers repeat.

## Run the footprint drill

The <a href="/examples/model-upgrade-footprint-drill.py" download>downloadable Python drill</a> runs real `RISK_POINTS` reservations against a [Cycles server](/glossary#cycles-server). It calls no model. Two fixed scripts choose the actions, and a local fixture records every action that runs.

::: info What this drill shows
Real admission, refusal, and settlement for two scripted action sequences, and the ledger arithmetic that follows. It says nothing about how any real model behaves, sends no replies, and issues no refunds or credits. The weights, tolerance, and scripts are illustrative.
:::

Use a disposable test [tenant](/glossary#tenant) from the [full-stack quickstart](/quickstart/deploying-the-full-cycles-stack) with no policy configured to return `ALLOW_WITH_CAPS` and no `RISK_POINTS` ledger at the tenant scope. The script checks for that ledger and stops if it finds one. Each run creates five workflow scopes under one app, with 28 ledgers between them, and commits 1,635 points.

[Create two keys](/how-to/api-key-management-in-cycles#creating-api-keys) for the test tenant. Give the runtime key `reservations:create`, `reservations:commit`, `reservations:release`, and `balances:read`. Give the budget key `budgets:write`. The script holds both in one process for convenience. A real harness gets only the runtime key.

```bash
python -m pip install "runcycles==0.5.3"

export CYCLES_BASE_URL="http://localhost:7878"
export CYCLES_ADMIN_URL="http://localhost:7979"
export CYCLES_TENANT="<test-tenant>"
export CYCLES_API_KEY="<test-runtime-key>"
export CYCLES_BUDGET_API_KEY="<test-budget-writer-key>"

python model-upgrade-footprint-drill.py
```

| Scenario | What happens | Expected result |
|---|---|---|
| `same_outcome` | Both scripts work twelve tickets against measuring ledgers | Twelve of twelve resolved, both runs |
| `footprint` | Read committed points by class from the ledgers; reconcile with the harness journal | 292 and 404 |
| `gate` | Compare class by class with the tolerance | `review`: replies and credits over, lookups within |
| `dry_run` | Send the candidate's 48 planned actions as dry runs against a 327-point aggregate | 48 `ALLOW`; nothing spent |
| `held` | Both scripts run inside incumbent-sized allocations | Incumbent 12 of 12; candidate 9 of 12 on 327 points |
| `new_class` | Same allocations plus a zero-allocation `credit` ledger | Candidate 10 of 12 on 320 points; credits refused |

A passing run ends each scenario with a `PASS` line. These were reproduced with `runcycles` 0.5.3, Cycles Server 0.1.25.59, and Cycles [Admin Server](/glossary#admin-server) 0.1.25.55:

```json
{"event": "PASS", "scenario": "same_outcome", "tickets": 12, "incumbent_resolved": 12, "candidate_resolved": 12}
{"event": "PASS", "scenario": "footprint", "incumbent": {"lookup": 12, "refund": 120, "reply": 120, "update": 40}, "incumbent_total": 292, "candidate": {"credit": 60, "lookup": 24, "refund": 120, "reply": 160, "update": 40}, "candidate_total": 404}
{"event": "PASS", "scenario": "gate", "verdict": "review", "over": {"credit": "new class: 60 points", "reply": "+40 over a tolerance of 20"}, "within": {"lookup": "+12 within a tolerance of 15"}}
{"event": "PASS", "scenario": "dry_run", "preflights": 48, "allow": 48, "planned_points": 404, "aggregate": 327, "spent_after": 0}
{"event": "PASS", "scenario": "held", "aggregate": 327, "incumbent_resolved": 12, "candidate_resolved": 9, "candidate_spent": 327, "candidate_by_class": {"credit": 60, "lookup": 17, "refund": 90, "reply": 120, "update": 40}, "candidate_denied": {"lookup": 4}}
{"event": "PASS", "scenario": "new_class", "candidate_resolved": 10, "candidate_spent": 320, "candidate_by_class": {"lookup": 20, "refund": 120, "reply": 140, "update": 40}, "candidate_denied": {"credit": 2, "reply": 2}}
```

The script also prints one line per refusal and one per finished run. Its harness records a refusal and stops the ticket. A real harness would choose a [degradation path](/how-to/how-to-think-about-degradation-paths-in-cycles-deny-downgrade-disable-or-defer) at that point, such as handing the ticket to a person, and the drill does not implement one. Its outcome-only grader is the kind the first scenario is meant to show the limits of.

To use the method on a real upgrade, replace the two scripts with your agent running on each model, keep the prompt, tools, and task set fixed, point the tools at stubs, and run each model several times. Report the spread of each class's points across runs alongside the mean.

A model upgrade is usually reviewed as a change in quality and cost. Its footprint by action class is a third thing to read, and the review that reads it can decide what the new model is allowed to do more of before production does.

## Resources

External sources were checked November 24, 2026:

- [Toloka: GPT-5.6 got smarter. Then it kept acting.](https://toloka.ai/blog/gpt-5.6-got-smarter-then-it-kept-acting/): exact-state grading on 711 tasks, surplus actions, and duplicate calls.
- [Arize: What we learned testing 7 models under the same agent harness](https://arize.com/blog/what-we-learned-testing-7-models-under-the-same-agent-harness/): tool calls per task across seven models.
- [Microsoft: Not all model upgrades are upgrades](https://developer.microsoft.com/blog/not-all-model-upgrades-are-upgrades/): token use and cost across two Claude Sonnet versions.
- [OpenAI: Upgrading to GPT-5.6 Sol](https://developers.openai.com/api/docs/guides/upgrading-to-gpt-5p6-sol.md): the vendor's validation list for an upgrade.
- [OpenRouter: AI Agent Regression Testing After a Prompt or Model Change](https://openrouter.ai/blog/tutorials/ai-agent-regression-testing-after-a-prompt-or-model-change/): what to hold fixed and what to assert.
- [Cycles runtime protocol YAML](https://github.com/runcycles/cycles-protocol/blob/main/cycles-protocol-v0.yaml): reservation lifecycle, `dry_run`, and error semantics.
