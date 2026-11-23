---
title: "What Would Make an AI Agent Insurable?"
date: 2026-11-23
author: Albert Mavashev
tags: [governance, risk, agents, action-control, runtime-authority, compliance]
description: "Insurers bound losses with aggregate limits, sublimits, and exclusions. Give an AI agent's authority the same shape with RISK_POINTS ledgers and a Python drill."
blog: true
sidebar: false
featured: false
head:
  - - meta
    - name: keywords
      content: "AI agent insurance, insurable AI agent, AI liability insurance, agent underwriting, aggregate limit, sublimit, exclusion, RISK_POINTS, bounded exposure, runtime authority, action authority"
---

# What Would Make an AI Agent Insurable?

A renewal questionnaire arrives with a new section. It asks which AI agents the company runs, who is responsible for each one, and what stops an agent from repeating a harmful action a thousand times before anyone notices. The first two answers are a spreadsheet. The third is usually a paragraph about monitoring.

That section is no longer hypothetical. A November 2, 2026 [Insurance Business report](https://www.insurancebusinessmag.com/us/news/technology/ai-agents-are-moving-faster-than-human-oversight--and-insurers-are-taking-notice-595827.aspx) says that "some carriers are issuing supplemental applications that examine governance and the technology businesses use," with questions about AI tool inventories and who owns each deployment. The same report quotes Lockton's Ashley Bennett Jones on what is still unsettled: "There's no clear answer yet to how responsibility will be allocated when autonomous systems interact and cause harm."

An insurance policy answers the question "how much can this cost?" with numbers written down in advance: a limit per occurrence, an aggregate limit for the period, sublimits for particular kinds of loss, and exclusions. Most agent deployments cannot answer the same question about themselves. This post takes those four terms and shows how far an agent's [runtime authority](/glossary#runtime-authority) can be given the same shape, what that would and would not tell an underwriter, and a drill that checks the arithmetic against a live server.

<!-- more -->

## Why AI agent risk is hard to underwrite today

Three things are true at once in the 2026 market.

**Most of the risk is covered by accident.** A July 2026 report by 37 authors, [Underwriting the Agent Economy](https://arxiv.org/abs/2607.11999), says "the vast majority of AI agent risk sits in 'silent coverage' within existing cyber, professional liability, and general liability policies." Several of its authors work at AIUC, which sells agent standards and insurance, so read it as an informed party's case and not a neutral survey. It reports a gap in perception: nearly 50% of surveyed Lloyd's Market Association underwriters believed their policyholders had "adequate" AI risk management, while a Deloitte survey found that 1 in 5 businesses reported a mature governance model for [autonomous agents](/glossary#autonomous-agent).

**Insurers are carving the risk out.** The same report notes that the Insurance Services Office filed endorsements, effective January 2026, that let carriers exclude generative AI from commercial general liability policies, and that several large carriers have filed their own exclusion forms. It calls exclusions "a healthy market correction" that still leaves buyers without cover.

**Affirmative cover exists, with stated limits.** [Armilla](https://www.armilla.ai/), a Lloyd's coverholder, lists "AI Agent Mistakes" among the things its policy responds to, with "limits up to US$25 million aggregate per insured, and up to US$5 million per model." [AIUC-1](https://www.aiuc-1.com/) is a certification standard for agents with quarterly retesting; its security domain aims to "prevent agents from taking actions beyond their authorized scope." These are real products, and the [liability post](/blog/prove-you-had-controls-agent-liability-2026) covers what they ask a buyer to prove.

The research literature is converging on what an underwriter would rate. Quanyan Zhu's [Insurance of Agentic AI](https://arxiv.org/abs/2606.05449) proposes "underwriting according to levels of autonomy and action authority" and calls the degree of autonomy "a first-order rating variable." A second paper, on [trace-economic underwriting](https://arxiv.org/abs/2606.16465), sorts logged agent actions into classes such as read, write, financial, and delete, and argues that "deductibles, limits, coinsurance, exclusions, sublimits, and reinsurance are not post-hoc legal details" but part of the risk model.

Those terms all sit on the insurer's side of the contract. They cap what the insurer pays. They do not cap what the agent does. The insured still has to answer the questionnaire's third question, and the [exposure](/concepts/exposure-why-rate-limits-leave-agents-unbounded) of an agent with tools and no spending limit on its actions is open-ended.

## Policy terms an agent runtime can enforce

[`RISK_POINTS`](/glossary#risk-points) are caller-assigned weights for actions: an operator decides that an email costs 10 points and a refund costs 30, and the agent's harness reserves those points before each action. A ledger holds an allocation at one scope. That is enough to write the four policy terms down as things a server checks.

| Policy term | Agent equivalent | Where it is enforced |
|---|---|---|
| Aggregate limit for the period | A `RISK_POINTS` ledger for the whole policy | Cycles, on every [reservation](/glossary#reservation) |
| Sublimit | A ledger for one action class, under the aggregate | Cycles, on every reservation in that class |
| Exclusion | A ledger for the class with an allocation of zero | Cycles, on every reservation in that class |
| Per-occurrence limit | A ceiling on the points one action may reserve | The harness, before it reserves |
| Endorsement | A funding operation on a ledger | Whoever holds a budget-writing key |
| Loss run | Committed reservations, by action class | Harness records, reconciled with ledger balances |

The scope layout puts the policy at the `app` level, the action class at `workflow`, and the agent at `agent`. The class sits above the agent so that every agent draws on one sublimit. Each action then follows the same reserve-commit path:

```python
def act(client, journal, subject, op):
    action_class = subject["workflow"]
    points = WEIGHTS[action_class]
    if points > PER_OCCURRENCE:
        # Refused in the harness. Cycles never sees this attempt.
        journal.refuse(op, action_class, "PER_OCCURRENCE")
        return "refused:local:PER_OCCURRENCE"
    try:
        hold = reserve(client, subject, op)
    except Denied:
        journal.refuse(op, action_class, "BUDGET_EXCEEDED", status=409)
        return "denied"
    journal.dispatch(op, action_class)
    # The action ran. Commit the hold to record the charge.
    commit(client, hold.rid, op, points)
    journal.settle(op, action_class, points)
    return "sent"
```

That is the drill's `act` function with its concurrency and lease checks removed.

A reservation is checked against every ledger in the requested unit along its scope path. Four behaviors follow, all observed against [Cycles Server](/glossary#cycles-server) 0.1.25.59 and exercised by the drill below:

- **The aggregate applies to every class.** A reservation for any action under the policy scope is checked against the policy ledger, whether or not its class has a ledger of its own.
- **A sublimit can refuse while the aggregate has room.** With a 60-point refund ledger under a 200-point aggregate, the third 30-point refund returned `409 BUDGET_EXCEEDED` with 140 points still unspent at the policy scope.
- **An exclusion needs a ledger, with nothing in it.** A ledger created with an allocation of zero refused every reservation in its class with `409 BUDGET_EXCEEDED`. The same request as a `dry_run` returned `200` with `decision: DENY` and `reason_code: BUDGET_EXCEEDED`. Leaving the ledger out does the opposite: a class with no ledger is covered by the aggregate alone, as the [test-environment post](/blog/ai-agent-test-environments-are-not-a-boundary) found for unlisted targets.
- **The agent cannot raise its own limit.** A `CREDIT` funding request to the policy ledger from a key holding only reservation and balance permissions returned `403 INSUFFICIENT_PERMISSIONS`. Raising a limit takes `budgets:write`, which is why the runtime key and the budget key should be [separate keys](/blog/least-privilege-api-keys-for-ai-agents).

The per-occurrence limit is the odd one out. A ledger refuses a single reservation larger than what remains in it, which is not the same as a ceiling on each reservation. In this design that check lives in the harness, next to the weight table.

## State the bound before the period starts

With those ledgers in place, the answer to the questionnaire's third question is a sentence that can be checked:

> In this period, actions routed through the harness can commit at most 200 points. At most 60 of those can be refunds. None can be deletes. No single action is weighted above 40.

Three of those four numbers are not the operator's word. Anyone with a `balances:read` key can read `allocated`, `spent`, `reserved`, and `remaining` for each ledger from the [balances endpoint](/protocol/querying-balances-in-cycles-understanding-budget-state), before the period starts and at any point during it. The fourth, the per-occurrence ceiling, is harness configuration and has to be shown some other way.

The statement holds until someone with a budget-writing key changes a ledger. A mid-period `CREDIT` is the equivalent of an endorsement that raises a limit, and it should be treated like one: requested by a named person, recorded with a reason, and visible to whoever relies on the bound. The funding request carries a `reason` field and an [idempotency key](/glossary#idempotency-key) for that purpose.

What the statement bounds is committed points. Whether 200 points is a tolerable amount of harm depends entirely on how the weights were chosen, which is the subject of the [risk-point assignment guide](/how-to/assigning-risk-points-to-agent-tools) and the first item in the limits below.

## Renew the period without losing the record

A policy period ends, and the limits start again. In Cycles that is a `RESET_SPENT` funding operation on each ledger with a limit: it restates the allocation and clears `spent` while leaving live reservations alone. The [period rollover guide](/how-to/rolling-over-billing-periods-with-reset-spent) covers the operation and its idempotency key.

Two details matter for a record that someone else will read.

- **Read the period's totals before the reset.** After `RESET_SPENT`, the ledger's `spent` counter no longer shows the old period. In the drill, the aggregate ledger reads 200 spent before renewal and 10 after one new action. The period's loss run has to be captured first and stored outside the ledger.
- **The exclusion needs no renewal.** A zero-allocation ledger has nothing to reset. In the drill, a delete is still refused after the other ledgers are renewed. A policy that instead creates new scopes for each period would have to recreate every exclusion ledger, and a missed one would leave that class covered by the aggregate.

## What a points limit does not tell an underwriter

It would be easy to overstate this. None of the sources above evaluates Cycles, no insurer is known to accept a ledger as a policy term, and whether one ever would is the insurer's decision.

- **Points are not money.** A 30-point refund can be for $5 or $50,000 unless the harness ties the weight to the amount. A points limit bounds how many weighted actions happen, not how severe each one is. For actions with a face value, reserve that value in a monetary unit as well, as the [two-budget post](/blog/ai-agent-action-cost-and-risk-budgets) describes.
- **The insured writes the weights.** An operator who sets a destructive action to 1 point has a large limit in practice. An underwriter would need to review the weight table the way they review a schedule of insured property.
- **Only routed actions count.** The limits apply to actions that go through the harness. An agent with another path to the same tool is outside them.
- **Committed is not attempted.** If a worker dies after an action runs and before the commit arrives, the reservation expires after its lease and [grace period](/glossary#grace-period), and the points return to the ledger. The bound on committed points still holds, but the number of actions that actually ran can exceed it. The [settlement recovery guide](/protocol/sdk-settlement-recovery-and-durability) covers what can be recovered.
- **It says nothing about correlated loss.** An insurer's hardest problem with agents is many policyholders failing at once for a shared reason, such as one upstream model. A per-policy ledger does not address that.
- **A limit is not a finding of fault.** Whether a loss is covered turns on policy wording and facts. A ledger shows what was permitted and what was refused.

What it does give is narrower and still uncommon: a ceiling that exists before the loss, that the agent cannot move, and that a third party can read.

## Run the bounded exposure drill

The <a href="/examples/bounded-exposure-drill.py" download>downloadable Python drill</a> runs real `RISK_POINTS` reservations against a Cycles server. A local fixture stands in for the outside world and records every action that runs, so a refused action can be told apart from one that ran and was not recorded.

::: info What this drill shows
Real admission, refusal, settlement, and period rollover for a harness that reserves before each action. It performs no real emails, refunds, or deletes, does not connect points to money, and keeps no durable record of dispatched actions. The weights and limits are illustrative.
:::

Use a disposable test [tenant](/glossary#tenant) from the [full-stack quickstart](/quickstart/deploying-the-full-cycles-stack) with no `ALLOW_WITH_CAPS` caps configured and no `RISK_POINTS` ledger at the tenant scope. The script checks for that ledger and stops if it finds one. The quickstart's USD tenant ledger does not affect the result. Each run creates one policy with three ledgers and commits 210 points across two periods.

Before running the script, [create two keys](/how-to/api-key-management-in-cycles#creating-api-keys) for the test tenant. Give the runtime key only `reservations:create`, `reservations:commit`, `reservations:release`, and `balances:read`. Give the budget key `budgets:write`. Using the quickstart's combined key as the runtime key would let the first scenario raise the aggregate limit before its permission check fails.

```bash
python -m pip install "runcycles==0.5.3"

export CYCLES_BASE_URL="http://localhost:7878"
export CYCLES_ADMIN_URL="http://localhost:7979"
export CYCLES_TENANT="<test-tenant>"
export CYCLES_API_KEY="<test-runtime-key>"
export CYCLES_BUDGET_API_KEY="<test-budget-writer-key>"

python bounded-exposure-drill.py
```

The policy has a 200-point aggregate, a 60-point refund sublimit, an exclusion for deletes, and a 40-point per-occurrence limit. Emails weigh 10 points, refunds 30, deletes 40, and exports 80.

| Scenario | What happens | Expected result |
|---|---|---|
| `stated_bound` | Read the terms from the ledgers; the runtime key tries to raise the aggregate | Terms match; `403 INSUFFICIENT_PERMISSIONS` |
| `per_occurrence` | One 80-point export | Refused in the harness; no reservation |
| `exclusion` | One delete | Preflight `DENY`; live `409 BUDGET_EXCEEDED` |
| `sublimit` | Three refunds by one agent | Two run; the third is denied |
| `aggregate` | Twenty agents each attempt one email at once | Fourteen run; six are denied |
| `loss_run` | Reconcile harness records with the ledgers | 16 actions, 200 points, 9 refusals |
| `renewal` | One email before and after `RESET_SPENT`, then a delete | Denied, then sent; delete still denied |

A passing run ends each scenario with a `PASS` line. These were reproduced with `runcycles` 0.5.3, Cycles Server 0.1.25.59, and Cycles [Admin Server](/glossary#admin-server) 0.1.25.55:

```json
{"event": "PASS", "scenario": "stated_bound", "aggregate": 200, "sublimits": {"refund": 60}, "excluded": ["delete"], "per_occurrence": 40, "runtime_key_raise_limit": "403:INSUFFICIENT_PERMISSIONS"}
{"event": "PASS", "scenario": "per_occurrence", "actions": 0, "reservations": 0}
{"event": "PASS", "scenario": "exclusion", "actions": 0, "preflight": "DENY:BUDGET_EXCEEDED", "live": "denied"}
{"event": "PASS", "scenario": "sublimit", "actions": 2, "denied": 1, "sublimit_spent": 60, "aggregate_spent": 60}
{"event": "PASS", "scenario": "aggregate", "agents": 20, "actions": 14, "denied": 6, "aggregate_spent": 200}
{"event": "PASS", "scenario": "loss_run", "actions": 16, "committed_by_class": {"email": 140, "refund": 60}, "aggregate_spent": 200, "aggregate_limit": 200, "refusals": {"BUDGET_EXCEEDED": 8, "PER_OCCURRENCE": 1}}
{"event": "PASS", "scenario": "renewal", "before": "denied", "after": "sent", "excluded_after": "denied", "aggregate_spent": 10}
```

The script also prints one line per preflight, reservation, dispatch, commit, and refusal. The `aggregate` scenario is the one to read closely. No agent in it does anything unusual: each attempts one 10-point email. Twenty of them together would commit 200 points on top of the 60 already spent, and the shared ledger admits fourteen.

## What to keep for the loss run

The `loss_run` scenario reconciles two records, and a real deployment needs both.

The ledgers hold totals. They show 200 points spent against the aggregate and 60 against the refund sublimit. They do not show that 140 points went to email, because email has no ledger of its own in this policy. A per-class total exists on the server only for classes that have a ledger.

The harness holds the detail. Its records show which operation ran in which class, which reservation paid for it, and which attempts were refused and why. The drill checks that every dispatched action has a committed reservation and that the harness totals equal the ledger totals. A mismatch in either direction is worth an alert, since it means an action ran without a charge or a charge has no action behind it.

Refusals need the same care as in any other deployment. A live `409 BUDGET_EXCEEDED` is an HTTP response, not a stored record, and a per-occurrence refusal never reaches the server at all. Log both where they happen, with the policy, action class, agent, and operation ID. [What goes in an AI agent audit packet](/blog/what-goes-in-an-ai-agent-audit-packet) lists what to keep alongside them.

An underwriter may never ask for any of this. The questionnaire's third question still deserves a better answer than a paragraph about monitoring, and a limit that can be read from a ledger is one.

## Resources

External sources were checked November 23, 2026:

- [Insurance Business: AI agents are moving faster than human oversight, and insurers are taking notice](https://www.insurancebusinessmag.com/us/news/technology/ai-agents-are-moving-faster-than-human-oversight--and-insurers-are-taking-notice-595827.aspx): supplemental applications and unsettled liability allocation, November 2, 2026.
- [Underwriting the Agent Economy: The Blueprint for an AI Insurance Stack](https://arxiv.org/abs/2607.11999): silent coverage, exclusion filings, and the survey figures.
- [Insurance of Agentic AI](https://arxiv.org/abs/2606.05449): underwriting by autonomy and action authority.
- [When Agent Automation Becomes Profitable](https://arxiv.org/abs/2606.16465): trace-economic underwriting and contract terms as part of the risk model.
- [Armilla AI](https://www.armilla.ai/) and [AIUC-1](https://www.aiuc-1.com/): current affirmative cover and certification.
- [Cycles runtime protocol specification](https://github.com/runcycles/cycles-protocol): reservation lifecycle, funding operations, and error semantics.
