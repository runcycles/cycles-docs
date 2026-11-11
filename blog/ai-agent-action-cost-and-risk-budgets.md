---
title: "When One AI Agent Action Needs Two Budgets"
date: 2026-11-11
author: Albert Mavashev
tags: [agents, risk, action-control, budgets, costs, runtime-authority]
description: "Some AI agent actions cost money and carry risk at once. Admit them against USD and RISK_POINTS budgets, release cleanly on denial, and gate ongoing spend."
blog: true
sidebar: false
featured: false
head:
  - - meta
    - name: keywords
      content: AI agent cost and risk budgets, agent action budgets, RISK_POINTS, AI agent cloud spend, cloud provisioning agent, multi-unit reservation, reserve-commit, action authority, agent spend limits
---

# When One AI Agent Action Needs Two Budgets

In May 2026, an [autonomous agent](/glossary#autonomous-agent) asked to join DN42, a volunteer-run BGP network, so it could index the network. According to [Lan Tian's account](https://lantian.pub/en/article/fun/ai-agent-bankrupted-their-operator-scan-dn42lantian.lantian), its plan described hourly full-port scans from five AWS `m8g.12xlarge` instances behind a shared anycast address. A mailing-list message from someone identifying as the operator later reported an AWS bill of $6,531.30, and the operator attributed it to the agent repeatedly deploying the same CloudFormation template. Lan Tian concluded that the plan vastly exceeded what the task needed, and that the operator apparently told the agent to continue without inspecting the plan.

The plan carried two different kinds of [exposure](/glossary#exposure). The scan would affect other people's networks. The infrastructure behind it would keep billing whether or not anyone needed it. A spend limit alone could admit a cheap but disruptive scan. A consequence limit alone could admit an expensive, harmless cluster. Some actions need both checks, and both must pass before the action runs. The rest of this post covers admitting one action against a dollar ledger and a `RISK_POINTS` ledger, and what to do when only one of them says yes.

<!-- more -->

## Cost and risk are separate limits on one agent action

Most agent actions draw clearly on one budget. A model call costs money and changes nothing outside the conversation. A database delete may cost nothing to issue and still be the most consequential step in a run. [How Cycles meters action exposure](/blog/beyond-budget-how-cycles-controls-agent-actions) covers that split, with model calls in `USD_MICROCENTS` and tool actions in `RISK_POINTS`.

A smaller class of actions draws on both at once:

| Action | Cost exposure | Consequence exposure |
|---|---|---|
| Launch compute instances | Per-hour billing that continues after the call | Production change; capacity others depend on |
| Send paid outbound messages at volume | Per-message provider charges | Customer contact that cannot be recalled |
| Start or raise an ad campaign | Committed media spend | Public brand exposure |
| Call a paid enrichment API that writes to a CRM | Per-record charges | Overwritten customer data |
| Run a network scan from rented infrastructure | Instance and transfer charges | Traffic against systems the agent does not own |

The two units answer different questions, and neither converts into the other. Dollars measure spend. [RISK_POINTS](/protocol/understanding-units-in-cycles-usd-microcents-tokens-credits-and-risk-points) are caller-assigned policy weights. They express how much consequential activity a run may accumulate, not the probability or monetary value of damage. They are a form of [action authority](/concepts/action-authority-controlling-what-agents-do), not pricing. [Scoring tool risk](/blog/ai-agent-risk-assessment-score-classify-enforce-tool-risk) and the [risk-points how-to](/how-to/assigning-risk-points-to-agent-tools) cover how to choose those weights. Folding risk into a dollar figure hides the decision you most need to see: a scan that costs two cents is not a two-cent risk.

## One reservation holds one unit

The Cycles runtime spec is explicit: "A reservation lifecycle is denominated in exactly one unit (single-unit reserve/commit/release). Multi-unit atomic reservation/settlement is a v1+ concern." Reserve is atomic across all derived scopes for that unit. It is not atomic across units, so an action that needs dollars and risk points needs two [reservations](/glossary#reservation), and the host has to combine them.

A few behaviors matter when you set this up. These were observed against [Cycles Server](/glossary#cycles-server) 0.1.25.59:

- **One scope can carry both ledgers.** A workflow scope with a USD budget and a `RISK_POINTS` budget returns one balance row per unit. Read balances by scope and unit, not by scope alone.
- **Ancestors in the other unit do not block.** A `RISK_POINTS` reservation on a workflow with a risk budget was admitted even though the tenant above it had only a USD budget.
- **A missing ledger is a request error, not a denial.** A `RISK_POINTS` reservation where only USD budgets exist returns `400 UNIT_MISMATCH`, with `expected_units` in the error details. Treat it as a configuration fault and fail closed.
- **Each unit needs its own [idempotency key](/glossary#idempotency-key).** The spec enforces idempotency per tenant, endpoint, and key. Reusing the risk reservation's key for the cost reservation returned `409 IDEMPOTENCY_MISMATCH`. Derive both keys from one operation ID, for example `{op}-risk-reserve` and `{op}-usd-p1-reserve`, and put the operation ID in each reservation's `metadata`.

## Admit both budgets before dispatch

The action runs only after both reservations succeed. That requires a few decisions in advance.

**Use one fixed order.** The drill below reserves `RISK_POINTS` first, then dollars. Reservations do not wait on each other, so the order does not create deadlocks. It does decide which ledger carries a brief hold when the second reservation is denied. Putting the unit most likely to deny first keeps those holds rare.

**Release the first hold on a definitive refusal.** A denied live reservation returns `409 BUDGET_EXCEEDED`; other 4xx responses, such as `UNIT_MISMATCH`, are equally definitive. When the second reservation is refused, release the first one immediately, with a reason, instead of leaving it until its TTL expires. Until released, it can deny unrelated work that needs only that unit.

**Resolve an ambiguous result by key, never by dispatch.** If the second reservation request times out, retry it with the same idempotency key until you learn whether it was created. If you stop trying, release what you hold and let any unconfirmed reservation expire. The action itself does not run. [Retry storms and idempotency](/blog/retry-storms-and-idempotency-in-agent-budget-systems) covers why the key must stay stable across retries.

**Apply caps from either reservation.** Either reservation can return `ALLOW` or `ALLOW_WITH_CAPS`. When both return [caps](/protocol/caps-and-the-three-way-decision-model-in-cycles), the host should apply the stricter value of each constraint: the smaller `max_tokens` and `max_steps_remaining`, the larger `cooldown_ms`, the intersection of the tool allowlists, and the union of the denylists. If the executor cannot enforce a returned constraint, release both reservations and decline the action.

**Do not treat a preflight as admission.** A `dry_run` or `/v1/decide` check on each unit returns `ALLOW`, `ALLOW_WITH_CAPS`, or `DENY` for that moment; a live reservation that does not fit returns `409 BUDGET_EXCEEDED` instead. Concurrent work can change the answer between the two.

**Admit each deployment once.** In the DN42 account, the operator blamed the bill on the agent deploying the same template more than once. Give each deployment request a stable operation ID, admit it once, and make the executor reject a second creation under the same ID. A retry should find the first deployment, not pay for another.

The admission step in the drill reduces to this:

```python
def admit_launch(client, subject, op):
    """Both reservations must succeed before dispatch. Fixed order: risk, then cost."""
    risk_rid, risk_capped = reserve(client, subject, op, RISK, LAUNCH_POINTS, "risk")
    try:
        usd_rid, usd_capped = reserve(client, subject, op, USD, PERIOD_ESTIMATE, "usd-p1")
    except Refused as refused:
        # Definitive: no cost reservation exists, so return the risk hold now.
        release(client, risk_rid, f"{op}-risk", f"Cost reservation refused: {refused.error}")
        raise
    if risk_capped or usd_capped:
        # This fixture cannot enforce caps, so it declines the action entirely.
        reason = "Caps returned; executor cannot enforce them"
        release(client, risk_rid, f"{op}-risk", reason)
        release(client, usd_rid, f"{op}-usd-p1", reason)
        raise RuntimeError("Use a test tenant without caps; this fixture cannot enforce them")
    return risk_rid, usd_rid
```

`Refused` covers every definitive 4xx, including `UNIT_MISMATCH`. `Denied` is its `409 BUDGET_EXCEEDED` subclass. A transport error or 5xx on the second request is ambiguous, so the drill stops for inspection rather than releasing.

This is the low-level shape, not a production adapter. It has no durable journal or same-key retry. A crash or an unresolved second request leaves the first hold to expire through its TTL. A production executor should record the operation ID and both reservation IDs before dispatch.

## Ongoing cloud spend needs ongoing admission

A launched instance keeps billing after the agent's step completes. One reservation cannot cover that indefinitely. The spec caps `ttl_ms` at 24 hours and recommends short TTLs, with "chunked reserve/commit cycles for long-running actions rather than a single large reservation."

For compute, that suggests a period lease:

1. Admit the launch against both budgets, reserving the cost ceiling for the first billing period.
2. At the end of each period, commit the metered usage for that period.
3. Admit the next period with a new cost reservation before it starts.
4. If the next period is denied, tear the resource down.

Each period's reservation stays open while the resource runs, so keep it alive with a heartbeat that extends its TTL, as the [lease heartbeat guide](/blog/safe-agent-lease-heartbeats-remaining-ttl) describes. The drill below compresses each period into an immediate commit.

**Do not gate teardown on the budget that ran out.** If stopping a resource requires the same cost admission that just failed, an exhausted budget prevents you from stopping the spend. Teardown should be an authenticated, logged path that does not need a new cost reservation. The [background-jobs shutdown guide](/blog/stopping-ai-agents-background-jobs) covers work that outlives a stopped agent loop, and the [kill-switch stop contract](/blog/ai-agent-kill-switch-stop-contract) covers what a stop path must guarantee.

Commit from your own metering, not from the provider's bill. AWS states that [AWS Budgets information](https://docs.aws.amazon.com/cost-management/latest/userguide/budgets-managing-costs.html) "is updated up to three times a day," and that costs can exceed a notification threshold before the notification arrives. [InfoQ's review of agent billing incidents](https://infoq.com/news/2026/07/ai-agents-billing-guardrails/) makes the same point and recommends controls that fire at action time, such as alerts on instance launches. Budget admission needs a figure at period end, so compute it from the executor's own record of instance time and the rate you priced. Reconcile against the invoice later. A shortfall the invoice reveals can be recorded as a [direct debit event](/protocol/how-events-work-in-cycles-direct-debit-without-reservation).

## Settle each budget on its own terms

The two reservations close independently. Decide the rule for each outcome before the agent runs:

| Outcome | `RISK_POINTS` reservation | USD reservation |
|---|---|---|
| Companion reservation refused before dispatch | Release | Release, or never created |
| Provider accepted the request | Commit the fixed policy charge | Commit metered usage for the period |
| Provider rejected it, nothing created | Release | Release |
| Provider call timed out, outcome unknown | Hold and reconcile | Hold and reconcile |
| Partial success, such as two of five instances | Commit the policy charge for what was accepted | Commit metered usage for what is running |

The unknown-outcome row matters most. Releasing the risk hold on a timeout returns authority for an action that may already be running. Keep both holds while the executor checks what the provider created. A hold still expires at its TTL, so extend it during reconciliation, and keep an application-level stop on the operation in case it lapses. The [AI SRE change-limits post](/blog/ai-sre-agent-production-change-limits) applies the same rule to production remediation.

Size estimates for the [overage policy](/glossary#overage-policy) you choose. With `REJECT`, a commit above the reserved amount fails, so the period estimate needs to be a real ceiling. [Estimate drift](/blog/estimate-drift-silent-killer-of-enforcement) is what usually breaks that assumption. Neither ledger shares a transaction with the cloud provider. The spec's payment-rail boundary says a commit records economic exposure; it does not prove that funds moved.

## Run the cost and risk budget drill

The <a href="/examples/two-budget-action-drill.py" download>downloadable Python drill</a> runs real reservations in both units against a Cycles server, with local fixtures in place of a cloud API. It counts every launch and teardown the fixture receives, so you can tell a blocked action from one whose result was discarded.

::: info What this drill shows
Real admission and settlement across two units, with synthetic prices and policy weights. It does not call a cloud provider, measure real billing, test crash recovery, or decide what your risk weights should be.
:::

Use a disposable test tenant from the [full-stack quickstart](/quickstart/deploying-the-full-cycles-stack), with a USD tenant budget, no caps, and no competing traffic. Each run creates four workflows, each with a USD ledger and a `RISK_POINTS` ledger, and commits $1.05 plus 60 points in total. The script checks first that the tenant has at least $1.50 available. That covers the $1.05 committed plus the final $0.40 renewal attempt, so every denial comes from a workflow budget rather than the tenant. Repeated runs consume more test allocation.

```bash
python -m pip install "runcycles==0.5.3"

export CYCLES_BASE_URL="http://localhost:7878"
export CYCLES_ADMIN_URL="http://localhost:7979"
export CYCLES_TENANT="acme-corp"
export CYCLES_API_KEY="<test-runtime-key>"
export CYCLES_BUDGET_API_KEY="<test-budget-writer-key>"

python two-budget-action-drill.py
```

The runtime key needs `reservations:create`, `reservations:commit`, `reservations:release`, and `balances:read`. The setup key needs `budgets:write`. The quickstart key has both and can fill both roles for this disposable drill. In production, keep budget-writing credentials out of the agent process.

Each launch reserves 20 `RISK_POINTS` and a $0.40 first-period cost ceiling, then commits 20 points and $0.35 of synthetic usage:

| Scenario | Workflow budgets | Expected result |
|---|---|---|
| `risk_denied` | $1.00, 10 points | Risk denies; the cost ledger is never touched; zero launches |
| `cost_denied` | $0.20, 50 points | Risk admits, cost denies, the risk hold is released; zero launches |
| `race` | $1.00, 60 points | Three concurrent launches: all three risk reservations fit, two cost reservations fit, and the third attempt releases its risk hold; two launches |
| `renewal` | $0.70, 50 points | One launch; the second period's $0.40 does not fit the remaining $0.35, so the instance is torn down without a new reservation |

The race scenario holds admitted reservations until every attempt has its decision, so the holds overlap. After it finishes, the risk ledger shows 40 points spent and nothing reserved. The released 20 points are back in the pool.

The summary lines should be:

```text
{"event": "PASS", "scenario": "risk_denied", "launches": 0, "usd_spent": 0, "risk_spent": 0}
{"event": "PASS", "scenario": "cost_denied", "launches": 0, "usd_spent": 0, "risk_spent": 0}
{"event": "PASS", "scenario": "race", "launches": 2, "usd_spent": 70000000, "risk_spent": 40}
{"event": "PASS", "scenario": "renewal", "launches": 1, "teardowns": 1, "usd_spent": 35000000, "risk_spent": 20}
```

These results were reproduced with Python SDK 0.5.3, Cycles Server 0.1.25.59, and [Admin Server](/glossary#admin-server) 0.1.25.55. A tenant with $1.49 available stopped at the script's balance check with nothing spent.

## Record both decisions as one action

An auditor reviewing the launch needs both decisions, not just whichever ledger happened to deny. Each reservation and commit carries its own reservation ID and, where evidence is configured, its own [CyclesEvidence](/glossary#cyclesevidence) reference. Link them through the shared operation ID in `metadata`. To correlate them in logs and events as well, send the same W3C `traceparent` on both reservation requests; the server echoes the trace ID as `X-Cycles-Trace-Id`. The [trace context guide](/blog/w3c-trace-context-ai-agent-debugging) covers the propagation rules. [What goes in an AI agent audit packet](/blog/what-goes-in-an-ai-agent-audit-packet) lists the rest of the record.

## What would have stopped the DN42 plan

A host enforcing both limits gives the operator two independent stops. The cost ceiling for five large instances has to fit a budget sized for the task. Scanning infrastructure the agent does not own has to fit a risk allowance the operator chose in advance. Either boundary would likely have stopped the plan before the bill, without depending on someone reading the plan first. An [approval queue](/blog/ai-agent-approval-queues-need-runtime-authority) helps only when the reviewer reads what they approve; a budget boundary holds either way.

Both limits hold only if the executor is the only path to the cloud API. If the agent also holds credentials that can launch instances directly, neither budget sees the launch.

## Resources

External sources were checked November 11, 2026:

- [Lan Tian: AI Agent Bankrupted Their Operator While Trying to Scan DN42](https://lantian.pub/en/article/fun/ai-agent-bankrupted-their-operator-scan-dn42lantian.lantian): primary account of the incident, the agent's plan, and the reported bill.
- [AWS: Managing your costs with AWS Budgets](https://docs.aws.amazon.com/cost-management/latest/userguide/budgets-managing-costs.html): update cadence and notification delay for budget data.
- [InfoQ: AI Agents with Cloud Credentials Are Outrunning Billing Guardrails](https://infoq.com/news/2026/07/ai-agents-billing-guardrails/): billing-alert lag and action-time controls for agents holding cloud credentials.
- [Cycles runtime protocol specification](https://github.com/runcycles/cycles-protocol): single-unit reservation lifecycle, idempotency, TTL limits, and the payment-rail boundary.
