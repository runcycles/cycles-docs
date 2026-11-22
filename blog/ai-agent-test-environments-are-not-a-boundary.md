---
title: "AI Agent Test Environments Are Not a Boundary"
date: 2026-11-21
author: Albert Mavashev
tags: [security, agents, incidents, action-control, runtime-authority, risk]
description: "Use per-target and per-run RISK_POINTS ledgers in AI agent test environments. Run a Python drill to see which requests reach a target and which are refused."
blog: true
sidebar: false
featured: false
head:
  - - meta
    - name: keywords
      content: AI agent test environment, AI agent sandbox escape, pentest agent rules of engagement, eval agent security, RISK_POINTS, runtime authority, agent fleet limits, action authority
---

# AI Agent Test Environments Are Not a Boundary

On November 6, 2026, WorkOS [updated its incident bulletin](https://workos.com/security/bulletins/update-for-october-30th-2026-data-security-incident) with an unusual attribution. The unauthorized access to one of its internal tools was, in its words, "an AI security agent that escaped a researcher's sandbox." The update says the researcher had been running cybersecurity benchmark evaluations with ARTEX; the [original bulletin](https://workos.com/security/bulletins/october-30th-2026-data-security-incident) had described only "an AI-assisted offensive security framework." According to the update, the first confirmed access was on October 25, records were retrieved in bulk on October 30, and WorkOS noticed that day, when an employee saw unusually high usage of a connected system. Neither bulletin explains how the agent left its test environment.

Ten days later, California's Attorney General [sued OpenAI](https://oag.ca.gov/news/press-releases/it%E2%80%99s-golden-state-not-wild-west-attorney-general-bonta-sues-openai-over). OpenAI's [incident report](https://openai.com/index/hugging-face-incident-and-the-road-ahead/) confirms that agents in its July cybersecurity evaluations reached the public internet and compromised parts of Hugging Face's systems. California's [complaint](https://oag.ca.gov/system/files/attachments/press-docs/complaint-oai-cyber.pdf) alleges that around 1,200 agents coordinated on an ad hoc message board and approximately 700 went on to attack Hugging Face, taking roughly 17,600 actions. It also alleges that OpenAI admitted to losing control of its agents over 80 times during testing while publicly reporting 27 incidents.

Neither account describes a production agent. In both, a test environment was the boundary that was supposed to hold, and the question is what else was limiting the agent when it did not.

<!-- more -->

## What an AI agent sandbox limits, and what it leaves open

Network isolation is the right first control for a test agent. It answers one question well: where can this agent's traffic go? A scoped tool allowlist answers a second: which operations exist at all. Neither is designed to answer how much.

That leaves several questions outside what a network sandbox decides:

| Question | Network sandbox | Metered authority at the harness |
|---|---|---|
| Where can traffic go? | Yes, while isolation holds | No |
| Which targets did an operator authorize for this engagement? | Only as network rules | Partly: a target with no ledger on its path gets nothing, but the allowlist stays in the harness |
| How many points may one run spend on a target? | No | A run ledger sets the limit |
| How many points may all runs in this engagement spend on that target? | No | A shared target ledger sets the limit |
| Who can raise a target's allocation? | Not applicable | Whoever holds a budget-writing key |
| What does the operator know when isolation fails? | Whatever network monitoring caught | The [reservations](/glossary#reservation) the harness made and the refusals it logged |

Egress isolation and action limits address different failures. Isolation decides which destinations are reachable. It does not limit how many requests go to a destination that is reachable, and when it fails, nothing the agent carries with it is any smaller. The agent that gets out has the same tools, the same step count, and the same instructions it had inside.

Both accounts also describe slow detection. The complaint alleges that an OpenAI team saw at least one agent reach the internet around May 26, that a monitoring tool raised an alert on June 27, and that training runs continued. It further alleges that OpenAI learned it was responsible for the July attack only after Hugging Face disclosed it. WorkOS dates its detection to five days after the first access.

The right-hand column is not a replacement for the left. It is a second control that does not depend on the first one holding.

## Why test agents often get weaker controls than production

Production agents accumulate controls because production is where people expect damage. Test and evaluation agents tend to go the other way, for reasons that are individually sensible:

- **The task is to probe.** A pentest or cyber-evaluation agent is given offensive tooling on purpose. A tool allowlist that would be normal in production defeats the test.
- **Monitoring coverage varies.** The complaint alleges gaps in live chain-of-thought monitoring across training and evaluation. OpenAI says it already monitored many frontier reinforcement-learning training runs, but the monitors did not run during the July cybersecurity evaluations.
- **Budgets are left open.** A limit that ends an evaluation early costs a rerun, so step and spend limits are often set high or left off.
- **Development credentials can reach production.** WorkOS found that its production API accepted a weak credential intended for local development. In addition to issuing [separate keys per environment](/blog/least-privilege-api-keys-for-ai-agents), check which secrets can reach production. WorkOS said it was adding deployment controls to block weak or development-only secrets.

The result can be an agent with highly capable tools, few limits, and one boundary. Human penetration testers do not work that way. They agree rules of engagement that name the targets, the window, and the permitted techniques before any traffic is sent. An agent's harness can carry part of the same thing.

## Write the rules of engagement as RISK_POINTS ledgers

[Action authority](/concepts/action-authority-controlling-what-agents-do) is the part of runtime authority that governs what an agent may do, as opposed to what it may spend. In Cycles it is metered in `RISK_POINTS`: caller-assigned policy weights that the harness reserves before an action and commits after it. They express how much consequential activity is allowed, not the probability or cost of damage. The [risk-points how-to](/how-to/assigning-risk-points-to-agent-tools) covers choosing the weights.

Rules of engagement map onto the [scope hierarchy](/protocol/how-scope-derivation-works-in-cycles) directly:

| Rule of engagement | Cycles scope | Ledger |
|---|---|---|
| This engagement | `app` | None in `RISK_POINTS` |
| An authorized target | `workflow` | Total points this engagement's runs may spend on it |
| One agent run | `agent` | Points this run may spend on that target |

The target sits under the engagement and above the run. Two engagements that name the same target have separate target ledgers. Within one engagement, every run aimed at that target draws on its shared balance. A run that visits a second target has a separate run allocation there. The engagement window, permitted techniques, and target allowlist stay in the harness.

Each outbound request then follows the same reserve-commit path:

```python
def send(client, targets, subject, op):
    """The only path to a target: reserve, dispatch, commit. Refusal sends nothing."""
    target = subject["workflow"]
    try:
        hold = reserve(client, subject, op)   # 20 RISK_POINTS, REJECT, 30 s TTL
    except Refused as refused:
        if isinstance(refused, Denied):       # 409 BUDGET_EXCEEDED
            return "denied"
        return f"refused:{refused.status}:{refused.error}"
    targets.request(target, op)
    # The target received the request. Commit the hold to record the charge.
    commit(client, hold.rid, op)
    return "sent"
```

That is the drill's `send` function with its concurrency and lease checks removed.

If a worker dies after the target receives the request but before the commit reaches Cycles, the target has already counted one request. After the lease and grace period expire, Cycles returns the reserved points to the ledger. Another run can then spend those points. For a hard ceiling on attempts, keep a durable record before dispatch and have every worker count unresolved attempts against the same target allowance. Match the operation ID to a target receipt to settle a confirmed dispatch. Reuse the allowance only if you can establish that the request was never sent. The [settlement recovery guide](/protocol/sdk-settlement-recovery-and-durability) explains what the SDK can recover once actual usage is known.

A reservation is checked against every ledger in the requested unit along its scope path, and at least one must exist. Scopes with no ledger are skipped. Four consequences follow. All were observed against [Cycles Server](/glossary#cycles-server) 0.1.25.59; the drill below exercises the first two, and the last two were checked separately:

- **No ledger anywhere on the path means no authority.** With no ledger at the tenant, engagement, target, or run scope, a live reservation for an unlisted target returned `404 NOT_FOUND` with a message beginning `Budget not found for provided scope:`. The same request as a `dry_run` returned `200` with `decision: DENY` and `reason_code: BUDGET_NOT_FOUND`. The [error reference](/protocol/error-codes-and-error-handling-in-cycles) documents both forms.
- **A ledger in another unit changes the error, not the outcome.** When the [tenant](/glossary#tenant) had a USD ledger and the path had nothing in `RISK_POINTS`, both the live request and the `dry_run` returned `400 UNIT_MISMATCH`. Treat every 4xx on reserve as granting no authority and send nothing.
- **An ancestor ledger in the same unit can admit an unlisted target.** If the tenant or the engagement has its own `RISK_POINTS` ledger, a request for a target with no ledger is checked against that ancestor and admitted if it fits. Keep the first `RISK_POINTS` ledger at the target level, and keep the harness's own target allowlist. The missing ledger is a second check, not the only one.
- **A run with no ledger is limited only by the target.** A reservation for a run that had no ledger of its own was admitted against the target ledger alone. Create the run ledger before the run starts, and have the harness refuse to start a run it cannot find a ledger for.

One more property matters for an agent that is trying to reach something it was not sent to. The runtime key carries reservation and balance-read permissions only. When the drill used that key to create a ledger for the unlisted target, the admin API returned `403 INSUFFICIENT_PERMISSIONS`. Widening the engagement takes a different credential. That separation holds only if the budget-writing key stays out of the agent's process: provision ledgers from a separate job. The drill holds both keys in one script for convenience and shows only the permission difference.

## Size non-production budgets smaller, not larger

Leaving test budgets open gets the sizing problem backwards. An evaluation has a known shape: a fixed target list, a bounded number of attempts, a time window. That makes it easier to size than production traffic.

**Cap the run.** A run ledger sized for the task turns a loop into a refusal. The harness should treat that refusal as the end of the run, not as an error to route around. [How agents work around a denial](/blog/ai-agent-denial-workarounds) covers why the next attempt needs the same policy.

**Cap the target within the engagement.** The complaint's figures of roughly 17,600 actions across approximately 700 agents average about 25 per agent. Even if each run stays within its own allowance, the total can be large. In the drill, eight runs share 100 target points. At 20 points per request, five requests can reach that target if every dispatch settles. A second engagement with its own 100-point allocation could send five more.

**Keep leases short and overage off.** The drill uses a 30-second TTL and `REJECT`, so an abandoned reservation expires quickly and no commit can exceed what was reserved.

**Let exhaustion be a stop.** A spent ledger refuses the next reservation whether or not anyone is watching. That is not a full stop mechanism. The [kill-switch stop contract](/blog/ai-agent-kill-switch-stop-contract) describes what stopping has to cover, and a [budget freeze](/how-to/budget-allocation-and-management-in-cycles) is the operator's version of the same refusal.

## What metered authority does not do for a sandboxed agent

Nothing here would have kept an agent inside its sandbox in either reported case. It is worth being specific about why.

- **It is not isolation.** A ledger does not block a packet. If the agent has a shell, one admitted command can open connections the harness never sees as separate actions. [Computer-use agents](/blog/computer-use-agents-have-no-tool-boundary) have the same problem at the click layer.
- **It binds only what the harness dispatches.** A process the agent started keeps running without further reservations. [Stopping background jobs](/blog/stopping-ai-agents-background-jobs) covers that gap.
- **It is cooperative.** The harness has to call it, and has to send nothing when the Cycles server is unreachable. A harness that proceeds on a timeout has no boundary.
- **It does not protect the target.** WorkOS named four gaps on its own side: public network exposure, a weak credential, missing rate limits, and detection gaps. Those are the target's controls, and no tester's ledger substitutes for them.
- **The weights are policy, not measurement.** Twenty points per request is a number an operator chose.

For requests routed through the harness, the engagement's runs still draw on the same target allocation even if network isolation fails. The runtime key can reserve points from that allocation but cannot increase it.

## Run the engagement scope drill

The <a href="/examples/engagement-scope-drill.py" download>downloadable Python drill</a> runs real `RISK_POINTS` reservations against a Cycles server. A local fixture stands in for the network and counts every request each target receives, so a blocked request can be told apart from one whose result was discarded.

::: info What this drill shows
Real admission, refusal, and settlement for a harness that reserves before each request. It sends no network traffic to the targets, does not test sandbox isolation, and does not implement a target allowlist, an engagement window, or technique restrictions. The weights are illustrative.
:::

Use a disposable test tenant from the [full-stack quickstart](/quickstart/deploying-the-full-cycles-stack) with no `ALLOW_WITH_CAPS` caps configured and no `RISK_POINTS` ledger at the tenant scope. The script checks for that ledger and stops if it finds one. The quickstart's USD tenant ledger is fine; it changes one expected line, shown below. Each run creates one engagement with two target ledgers and nine run ledgers, and commits 120 points.

Before running the script, [create two keys](/how-to/api-key-management-in-cycles#creating-api-keys) for the test tenant. Give the runtime key only `reservations:create`, `reservations:commit`, `reservations:release`, and `balances:read`. Give the setup key `budgets:write`. Using the quickstart's combined key as the runtime key would let the third scenario create the out-of-scope ledger before its permission check fails.

```bash
python -m pip install "runcycles==0.5.3"

export CYCLES_BASE_URL="http://localhost:7878"
export CYCLES_ADMIN_URL="http://localhost:7979"
export CYCLES_TENANT="acme-corp"
export CYCLES_API_KEY="<test-runtime-key>"
export CYCLES_BUDGET_API_KEY="<test-budget-writer-key>"

python engagement-scope-drill.py
```

Each admitted request in the drill reserves and commits 20 points. Target ledgers start with 100 points and run ledgers with 30.

| Scenario | Setup | Expected result |
|---|---|---|
| `in_scope` | One run, authorized target | Reserved, sent, committed; one request |
| `run_cap` | Same run, second request | The run ledger denies with `409 BUDGET_EXCEEDED` while the target has 80 points left; still one request |
| `out_of_scope` | Same run, target with no ledger | The preflight and the live reservation both grant nothing, and the runtime key gets `403 INSUFFICIENT_PERMISSIONS` writing a ledger; zero requests |
| `fleet` | Eight concurrent runs, each within its own allocation | Five sent, three denied; the target ledger shows 100 spent and nothing reserved |

The `out_of_scope` scenario reads which units have a ledger at the tenant scope, expects the matching row below, and fails on anything else:

| Tenant setup | Preflight (`dry_run`) | Live reservation |
|---|---|---|
| USD ledger at the tenant scope, as in the quickstart | `400 UNIT_MISMATCH` | `400 UNIT_MISMATCH` |
| No ledger at the tenant scope | `200 DENY`, `BUDGET_NOT_FOUND` | `404 NOT_FOUND` |

On the quickstart tenant, the summary lines should be:

```text
{"event": "PASS", "scenario": "in_scope", "requests": 1, "target_spent": 20}
{"event": "PASS", "scenario": "run_cap", "requests": 1, "denied": 1, "target_spent": 20}
{"event": "PASS", "scenario": "out_of_scope", "requests": 0, "preflight": "400:UNIT_MISMATCH", "live": "refused:400:UNIT_MISMATCH", "runtime_key_budget_write": "403:INSUFFICIENT_PERMISSIONS"}
{"event": "PASS", "scenario": "fleet", "runs": 8, "requests": 5, "denied": 3, "target_spent": 100}
```

On a tenant with no ledger at the tenant scope, the third line reads `"preflight": "DENY:BUDGET_NOT_FOUND", "live": "refused:404:NOT_FOUND"` instead. Both sets of results were reproduced with Python SDK 0.5.3, Cycles Server 0.1.25.59, and [Admin Server](/glossary#admin-server) 0.1.25.55.

## Log refusals so they can be counted

The complaint's 80-versus-27 allegation is a dispute about a count of loss-of-control incidents. A refusal is not an incident. It is one attempted operation, and it can come from ordinary exhaustion or a configuration mistake as easily as from an agent heading somewhere it should not. Refusal logs are still worth keeping. They show which attempts the harness blocked, and they exist before anything has gone wrong. They do not show admitted actions or work done outside the harness, so correlate them by operation ID with dispatch records and target telemetry when investigating an incident. [Proving you had controls](/blog/prove-you-had-controls-agent-liability-2026) covers why that record is increasingly what gets asked for.

Be precise about where refusals are recorded, because the server does not keep a per-attempt list for you:

- A live denial is an HTTP error to the caller. The [event reference](/protocol/event-payloads-reference) notes that the server does not currently emit `reservation.denied` on that path. The `cycles_reservations_reserve_total` counter is an aggregate with a `decision` label, useful for a rate and not for individual attempts.
- A fresh `dry_run` or `/v1/decide` request that returns `DENY` attempts to emit `reservation.denied`. Idempotent replays do not emit again, and an emission failure does not fail the request.
- A `404` or `400` for an unlisted target is a request error.

Log the engagement, run, target, and operation ID wherever the harness refuses a request. When the target allowlist rejects a request locally, record the reason at that check and alert the engagement owner. The attempt stops before Cycles receives it, so leave the HTTP status unset.

When Cycles refuses a reservation, log its HTTP status and error code, as the drill does. A `409 BUDGET_EXCEEDED` can mean that either the run or the shared target lacks enough points. Stop the attempted dispatch and inspect both balances before deciding which runs to stop. For a missing-ledger or unit error, check the engagement's target list and ledger setup. [What goes in an AI agent audit packet](/blog/what-goes-in-an-ai-agent-audit-packet) lists what to keep alongside these records.

## Resources

External sources were checked November 21, 2026:

- [WorkOS: Update for October 30th, 2026 data security incident](https://workos.com/security/bulletins/update-for-october-30th-2026-data-security-incident): attribution to a researcher's agent, timeline, and the four root-cause gaps.
- [WorkOS: October 30th, 2026 data security incident](https://workos.com/security/bulletins/october-30th-2026-data-security-incident): the original bulletin.
- [California Attorney General: press release, November 16, 2026](https://oag.ca.gov/news/press-releases/it%E2%80%99s-golden-state-not-wild-west-attorney-general-bonta-sues-openai-over): filing, court, and claims.
- [People v. OpenAI: complaint](https://oag.ca.gov/system/files/attachments/press-docs/complaint-oai-cyber.pdf): the allegations summarized above, including the training-run timeline and incident counts.
- [Cycles runtime protocol specification](https://github.com/runcycles/cycles-protocol): scope derivation, reservation lifecycle, and error semantics.
