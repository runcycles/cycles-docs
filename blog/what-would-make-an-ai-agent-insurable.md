---
title: "What Would Make an AI Agent Insurable?"
date: 2026-11-23
author: Albert Mavashev
tags: [governance, risk, agents, action-control, runtime-authority, compliance]
description: "Policy limits, sublimits, and exclusions cap what an insurer pays. Give an AI agent's action authority the same shape with RISK_POINTS ledgers and a drill."
blog: true
sidebar: false
featured: false
head:
  - - meta
    - name: keywords
      content: "AI agent insurance, insurable AI agent, AI liability insurance, agent underwriting, aggregate limit, sublimit, exclusion, RISK_POINTS, bounded exposure, runtime authority, action authority"
---

# What Would Make an AI Agent Insurable?

Picture a renewal questionnaire with a new section. It asks which AI agents the company runs, who is responsible for each one, and what stops an agent from repeating a harmful action a thousand times before anyone notices. The first two answers are a spreadsheet. The third is usually a paragraph about monitoring.

The first two questions are already being asked. A November 2, 2026 [Insurance Business report](https://www.insurancebusinessmag.com/us/news/breaking-news/ai-agents-are-moving-faster-than-human-oversight--and-insurers-are-taking-notice-595827.aspx) by Gia Snape says some carriers are issuing supplemental applications that examine governance, including whether a company keeps an inventory of its AI tools and who is responsible for each deployment. Snape also writes that there is "no clear answer yet to how responsibility will be allocated when autonomous systems interact and cause harm." The third question is this post's own illustration.

An insurance policy states in advance how much it will pay: an aggregate limit for the period, sublimits for particular kinds of loss, and exclusions. This post takes those terms and shows how far an agent's [action authority](/glossary#action-authority) can be given the same shape, what that would and would not tell an underwriter, and a drill that checks the arithmetic against a live server.

<!-- more -->

## Why AI agent risk is hard to underwrite today

**Much of the risk sits in policies that never mention AI.** A July 2026 report by 37 authors, [Underwriting the Agent Economy](https://arxiv.org/abs/2607.11999), argues that most AI agent risk currently sits in what it calls "silent coverage" inside existing cyber, professional liability, and general liability policies, where it is unpriced and its coverage is uncertain. Several of its authors work at AIUC, which develops an agent standard and offers audits and insurance, so read it as an informed party's case and not a neutral survey.

**Some insurers are excluding it.** The same report notes that the Insurance Services Office filed endorsements, effective January 2026, that let carriers exclude generative AI from commercial general liability policies, and that several large carriers have filed their own exclusion forms. It describes exclusions as a healthy market correction that still does not give insurers visibility into the risk.

**Affirmative cover exists, with stated limits.** [Armilla](https://www.armilla.ai/), a Lloyd's coverholder, lists "AI Agent Mistakes" among the claims its policy responds to, with limits of up to US$25 million aggregate per insured and up to US$5 million per model. The [liability post](/blog/prove-you-had-controls-agent-liability-2026) covers Armilla's underwriting approach. [AIUC-1](https://www.aiuc-1.com/) is a certification standard for agents with quarterly retesting, and [AIUC](https://www.aiuc.com/) describes its security domain as meant to "prevent agents from taking actions beyond their authorized scope."

Two recent papers propose what an underwriter might rate. Quanyan Zhu's [Insurance of Agentic AI](https://arxiv.org/abs/2606.05449) proposes "underwriting according to levels of autonomy and action authority" and treats the degree of autonomy as a first-order rating variable. A paper on [trace-economic underwriting](https://arxiv.org/abs/2606.16465) sorts logged agent actions into classes such as read, write, financial, and delete, and treats deductibles, limits, exclusions, and sublimits as part of the risk model and not as legal detail added afterwards.

Limits, sublimits, and exclusions define what a policy pays. They do not limit what the agent does. An agent with tools and no ceiling on its actions has open-ended [exposure](/concepts/exposure-why-rate-limits-leave-agents-unbounded), whatever the policy says.

## Policy terms an agent runtime can enforce

[`RISK_POINTS`](/glossary#risk-points) are caller-assigned weights for actions. An operator decides that an email weighs 10 points and a refund 30, and the agent's harness reserves those points before each action. A ledger holds an allocation of points at one scope. Three policy terms have a close equivalent in ledgers, and a fourth control has to live in the harness:

| Control | Insurance term it resembles | Agent equivalent | Where it is enforced |
|---|---|---|---|
| Ceiling for the period | Aggregate limit | A `RISK_POINTS` ledger for the whole policy | Cycles, on every [reservation](/glossary#reservation) |
| Ceiling for one kind of action | Sublimit | A ledger for one action class, under the aggregate | Cycles, on every reservation in that class |
| A kind of action that is never funded | Exclusion | A ledger for the class with an allocation of zero | Cycles, on every reservation in that class with a positive weight |
| Ceiling for one action | None exact | A maximum weight for a single action | The harness, before it reserves |

The analogy is to the shape of the terms and nothing more. An insurance limit caps a payment after a loss. A ledger checks an action's weight before dispatch. The fourth row is deliberately not called a per-occurrence limit: in a policy, one occurrence can cover several related actions, and nothing here groups actions that way.

The scope layout puts the policy at the `app` level, the action class at `workflow`, and the agent at `agent`. The class sits above the agent so that every agent draws on one sublimit. Each action then follows the same reserve-commit path:

```python
def act(client, journal, subject, op):
    action_class = subject["workflow"]
    points = WEIGHTS[action_class]
    if points > PER_ACTION:
        # Refused in the harness. Cycles never sees this attempt.
        journal.refuse(op, action_class, "PER_ACTION")
        return "refused:local:PER_ACTION"
    journal.reserving(op, action_class)
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

That is the drill's `act` function with its synchronization and lease checks removed.

A reservation is checked against every ledger in the requested unit along its scope path. Four behaviors follow, all observed against [Cycles Server](/glossary#cycles-server) 0.1.25.59 and exercised by the drill below:

- **The aggregate applies to every class.** A reservation for any action under the policy scope is checked against the policy ledger, whether or not its class has a ledger of its own.
- **A sublimit can refuse while the aggregate has room.** With a 60-point refund ledger under a 200-point aggregate, the third 30-point refund returned `409 BUDGET_EXCEEDED` with 140 points still unspent at the policy scope.
- **An exclusion needs a ledger with nothing in it, and positive weights.** A ledger created with an allocation of zero refused a 40-point reservation in its class with `409 BUDGET_EXCEEDED`. The same request as a `dry_run` returned `200` with `decision: DENY` and `reason_code: BUDGET_EXCEEDED`. Two conditions apply. The server refuses when the remaining points are less than the estimate, so a zero-point reservation would pass, and the harness must assign the action to the right class. Leaving the ledger out does the opposite of excluding: a class with no ledger is funded by the aggregate alone, as the [test-environment post](/blog/ai-agent-test-environments-are-not-a-boundary) found for unlisted targets.
- **The runtime key cannot raise a limit.** A `CREDIT` funding request to the policy ledger from a key holding only reservation and balance permissions returned `403 INSUFFICIENT_PERMISSIONS`. Raising a limit takes `budgets:write`. That protects the limit only if the agent cannot reach the budget key and cannot change the harness's routing or weight table, which is why the two should be [separate keys](/blog/least-privilege-api-keys-for-ai-agents) held by separate processes.

## State the bound before the period starts

With those ledgers in place, the answer to the questionnaire's third question is a sentence that can be checked:

> In this period, while the stated allocations remain in force, actions routed through the harness can commit at most 200 points. At most 60 of those can be refunds. None can be deletes. The harness dispatches no action weighted above 40.

The first three numbers can be read from the server. On the pinned server, a key with `balances:read` gets `allocated`, `spent`, `reserved`, and `remaining` for each ledger in its tenant from the [balances endpoint](/protocol/querying-balances-in-cycles-understanding-budget-state). Of those four amounts, the protocol requires only `remaining` in a balance row, so check what your server returns before relying on the other three. The fourth number is harness configuration and has to be shown some other way.

The sentence says "commit" on purpose. If a worker dies after an action runs and before its commit arrives, the reservation expires after its lease and [grace period](/glossary#grace-period), and the points return to the ledger. Committed points never exceed the allocation, but the total weight of the actions that actually ran can. A record written before dispatch shows that an action was intended, not whether it ran. Closing the gap means recovering the tool's receipt or querying the operation's outcome, then retrying settlement durably. The [settlement recovery guide](/protocol/sdk-settlement-recovery-and-durability) covers the retry once actual usage is known.

Whether 200 points is a tolerable amount of harm depends on how the weights were chosen. The [risk-point assignment guide](/how-to/assigning-risk-points-to-agent-tools) covers that.

## Amend, renew, and keep the record

Three operations change or close out a period, and each has a detail worth getting right.

**Amending a limit.** A mid-period `CREDIT` raises a ledger's allocation. It resembles the effect of an endorsement that raises a limit, though an endorsement amends the insurance contract and a `CREDIT` only changes a ledger. The funding request accepts a `reason`, and the drill sends an [idempotency key](/glossary#idempotency-key) so a retry does not apply twice. Neither records who approved the change. Keep that approval separately.

**Renewing the period.** A `RESET_SPENT` funding operation restates a ledger's allocation and clears `spent` while leaving live reservations alone. The [period rollover guide](/how-to/rolling-over-billing-periods-with-reset-spent) covers it. Each ledger is reset by its own request, so a refund that commits between the aggregate's reset and the sublimit's reset is counted in different periods at the two scopes. The drill avoids this by finishing all work first. A live deployment needs a common cutoff: drain in-flight work before the resets, or give each period its own scopes.

**Keeping the closing total.** After `RESET_SPENT`, the ledger's `spent` counter no longer shows the old period. In the drill, the aggregate reads 200 spent before renewal and 10 after one new action. The reset response includes `previous_spent`, so the closing total can be captured from the reset itself and stored outside the ledger.

The exclusion needs no renewal, because a zero-allocation ledger has nothing to reset. In the drill, a delete is still refused after the other ledgers are renewed. A design that creates new scopes for each period has to recreate every exclusion ledger, and a missed one leaves that class funded by the aggregate.

## What a points limit does not tell an underwriter

None of the sources above evaluates Cycles, and this post has no evidence that any insurer accepts a ledger as a policy term. Whether one would is the insurer's decision.

- **Points are not money.** A 30-point refund can be for $5 or $50,000 unless the harness ties the weight to the amount. A points limit bounds how many weighted actions are committed, not how severe each one is. For actions with a face value, reserve that value in a monetary unit as well, as the [two-budget post](/blog/ai-agent-action-cost-and-risk-budgets) describes.
- **The insured writes the weights.** An operator who sets a destructive action to 1 point has a large limit in practice. Anyone relying on the bound would need to review the weight table and the class assignments.
- **Only routed actions count.** The limits apply to actions that go through the harness. An agent with another path to the same tool is outside them.
- **It does not address correlated loss.** The July report treats accumulation, where many policyholders fail for a shared reason such as one upstream model, as a separate problem. A per-policy ledger does nothing about it.
- **A limit is not a finding of fault.** Whether a loss is covered turns on policy wording and facts. Balances show held and spent points. Harness logs, and decision evidence where the server provides it, identify individual refusals.

What remains is a ceiling that is set before any loss, that the runtime key cannot move, and that someone other than the operator can read.

## Run the bounded exposure drill

The <a href="/examples/bounded-exposure-drill.py" download>downloadable Python drill</a> runs real `RISK_POINTS` reservations against a Cycles server. A local fixture stands in for the outside world and records every action that runs, so a refused action can be told apart from one that ran and was not recorded.

::: info What this drill shows
Real admission, refusal, settlement, and period rollover for a harness that reserves before each action. It performs no real emails, refunds, or deletes, does not connect points to money, and keeps no durable record of dispatched actions. The weights and limits are illustrative.
:::

Use a disposable test [tenant](/glossary#tenant) from the [full-stack quickstart](/quickstart/deploying-the-full-cycles-stack) with no policy configured to return `ALLOW_WITH_CAPS` and no `RISK_POINTS` ledger at the tenant scope. The script checks for that ledger and stops if it finds one. The quickstart's USD tenant ledger does not affect the result. Each run creates one policy with three ledgers and commits 210 points across two periods.

Before running the script, [create two keys](/how-to/api-key-management-in-cycles#creating-api-keys) for the test tenant. Give the runtime key only `reservations:create`, `reservations:commit`, `reservations:release`, and `balances:read`. Give the budget key `budgets:write`. Using the quickstart's combined key as the runtime key would let the first scenario raise the aggregate limit before its permission check fails. The script holds both keys in one process for convenience. A real harness gets only the runtime key.

```bash
python -m pip install "runcycles==0.5.3"

export CYCLES_BASE_URL="http://localhost:7878"
export CYCLES_ADMIN_URL="http://localhost:7979"
export CYCLES_TENANT="<test-tenant>"
export CYCLES_API_KEY="<test-runtime-key>"
export CYCLES_BUDGET_API_KEY="<test-budget-writer-key>"

python bounded-exposure-drill.py
```

The policy has a 200-point aggregate, a 60-point refund sublimit, a zero-allocation ledger for deletes, and a 40-point per-action ceiling. Emails weigh 10 points, refunds 30, deletes 40, and exports 80.

| Scenario | What happens | Expected result |
|---|---|---|
| `stated_bound` | Read the terms from the ledgers; the runtime key tries to raise the aggregate | Terms match; `403 INSUFFICIENT_PERMISSIONS` |
| `per_action` | One 80-point export | Refused in the harness; no reservation requested |
| `exclusion` | One delete | Preflight `DENY`; live `409 BUDGET_EXCEEDED` |
| `sublimit` | Three refunds by one agent | Two run; the third is denied |
| `aggregate` | Twenty agents each attempt one email, with overlapping holds | Fourteen run; six are denied |
| `period_record` | Reconcile harness records with the ledgers | 16 actions, 200 points, 9 refusals |
| `renewal` | `RESET_SPENT` on both funded ledgers, then one email and one delete | Closing total 200; email sent; delete denied |

A passing run ends each scenario with a `PASS` line. These were reproduced with `runcycles` 0.5.3, Cycles Server 0.1.25.59, and Cycles [Admin Server](/glossary#admin-server) 0.1.25.55:

```json
{"event": "PASS", "scenario": "stated_bound", "aggregate": 200, "sublimits": {"refund": 60}, "excluded": ["delete"], "per_action": 40, "runtime_key_raise_limit": "403:INSUFFICIENT_PERMISSIONS"}
{"event": "PASS", "scenario": "per_action", "actions": 0, "reservations": 0}
{"event": "PASS", "scenario": "exclusion", "actions": 0, "preflight": "DENY:BUDGET_EXCEEDED", "live": "denied"}
{"event": "PASS", "scenario": "sublimit", "actions": 2, "denied": 1, "sublimit_spent": 60, "aggregate_spent": 60}
{"event": "PASS", "scenario": "aggregate", "agents": 20, "actions": 14, "denied": 6, "aggregate_spent": 200}
{"event": "PASS", "scenario": "period_record", "actions": 16, "committed_by_class": {"email": 140, "refund": 60}, "aggregate_spent": 200, "aggregate_limit": 200, "refusals": {"BUDGET_EXCEEDED": 8, "PER_ACTION": 1}}
{"event": "PASS", "scenario": "renewal", "closing_spent": 200, "after": "sent", "excluded_after": "denied", "aggregate_spent": 10}
```

The script also prints one line per preflight, reservation, dispatch, commit, and refusal. In the `aggregate` scenario no agent does anything unusual: each attempts one 10-point email. Admitted reservations are held open until all twenty requests are decided, so the holds overlap. Twenty emails would commit 200 points on top of the 60 already spent, and the shared ledger admits fourteen.

## What to keep as the period's record

The `period_record` scenario reconciles two sets of records, and a real deployment needs both. This is a record of exposure and control activity. It is not a loss run, which lists claims with paid and reserved amounts, though it could accompany one.

The ledgers hold totals. They show 200 points spent against the aggregate and 60 against the refund sublimit. They do not show that 140 points went to email, because email has no ledger of its own in this policy. The server has a per-class total only for classes that have a ledger.

The harness holds the detail. Its records show which operation ran in which class, which reservation paid for it, and which attempts were refused and why. The drill checks that the dispatched actions and committed reservations match by operation and class, that the harness totals equal the ledger totals, and that the refusal counts are the expected ones. A mismatch in either direction is worth an alert, since it means an action ran without a charge or a charge has no action behind it.

Refusals need their own logging. A live `409 BUDGET_EXCEEDED` creates no reservation and no spend, and a per-action refusal never reaches the server. Log both where they happen, with the policy, action class, agent, and operation ID. If your server has the [evidence layer](/blog/audit-evidence-has-to-survive-production) enabled, keep any evidence reference it returns with a denial. [What goes in an AI agent audit packet](/blog/what-goes-in-an-ai-agent-audit-packet) lists what to keep alongside these records.

An underwriter may never ask for any of this. The questionnaire's third question still deserves a more specific answer than a paragraph about monitoring, and a limit that can be read from a ledger is one.

## Resources

External sources were checked November 23, 2026:

- [Insurance Business: AI agents are moving faster than human oversight, and insurers are taking notice](https://www.insurancebusinessmag.com/us/news/breaking-news/ai-agents-are-moving-faster-than-human-oversight--and-insurers-are-taking-notice-595827.aspx): supplemental applications and unsettled liability allocation, November 2, 2026.
- [Underwriting the Agent Economy: The Blueprint for an AI Insurance Stack](https://arxiv.org/abs/2607.11999): silent coverage, exclusion filings, and accumulation risk.
- [Insurance of Agentic AI](https://arxiv.org/abs/2606.05449): underwriting by autonomy and action authority.
- [When Agent Automation Becomes Profitable](https://arxiv.org/abs/2606.16465): trace-economic underwriting and contract terms as part of the risk model.
- [Armilla AI](https://www.armilla.ai/), [AIUC](https://www.aiuc.com/), and [AIUC-1](https://www.aiuc-1.com/): current affirmative cover and certification.
- [Cycles runtime protocol YAML](https://github.com/runcycles/cycles-protocol/blob/main/cycles-protocol-v0.yaml): reservation lifecycle and error semantics.
- [Cycles governance and admin YAML](https://github.com/runcycles/cycles-protocol/blob/main/cycles-governance-admin-v0.1.25.yaml): funding operations, including `CREDIT` and `RESET_SPENT`.
