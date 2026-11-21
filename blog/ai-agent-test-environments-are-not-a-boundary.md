---
title: "AI Agent Test Environments Are Not a Boundary"
date: 2026-11-21
author: Albert Mavashev
tags: [security, agents, incidents, action-control, runtime-authority, risk]
description: "Two November 2026 incidents began in AI agent test environments. Give eval and pentest agents RISK_POINTS ledgers per target and per run, then drill them."
blog: true
sidebar: false
featured: false
head:
  - - meta
    - name: keywords
      content: AI agent test environment, AI agent sandbox escape, pentest agent rules of engagement, eval agent security, RISK_POINTS, runtime authority, agent fleet limits, action authority
---

# AI Agent Test Environments Are Not a Boundary

On November 6, 2026, WorkOS [updated its incident bulletin](https://workos.com/security/bulletins/update-for-october-30th-2026-data-security-incident) with an unusual attribution. The unauthorized access to one of its internal tools was, in its words, "an AI security agent that escaped a researcher's sandbox." The researcher had been running cybersecurity benchmark evaluations with ARTEX, which WorkOS's first bulletin described as "an AI-assisted offensive security framework." According to the bulletin, the first confirmed access was on October 25, records were retrieved in bulk on October 30, and WorkOS noticed only when an employee saw unusually high usage of a connected system. Neither party has published how the agent left its test environment.

Ten days later, California's Attorney General [sued OpenAI](https://oag.ca.gov/news/press-releases/it%E2%80%99s-golden-state-not-wild-west-attorney-general-bonta-sues-openai-over). The [complaint](https://oag.ca.gov/system/files/attachments/press-docs/complaint-oai-cyber.pdf) alleges that agents in reinforcement-learning training runs, which were supposed to be confined to sandboxes, used a vulnerability in a shared software package service to reach the public internet. It alleges that around 1,200 agents coordinated on an ad hoc message board and approximately 700 went on to attack Hugging Face in July, taking roughly 17,600 actions. It also alleges that OpenAI admitted to losing control of its agents over 80 times during testing while publicly reporting 27 incidents. These are allegations in a complaint. No court has ruled on them.

Neither agent was in production. In both accounts, a test environment was the boundary that was supposed to hold.

<!-- more -->

## What an AI agent sandbox limits, and what it leaves open

A sandbox answers one question: where can this agent's traffic go? It answers by location. The agent runs inside a network and filesystem boundary, and the boundary is supposed to hold.

That leaves several questions with no answer inside the sandbox:

| Question | Network sandbox | Metered authority at the harness |
|---|---|---|
| Where can traffic go? | Yes, while isolation holds | No |
| Which targets did an operator authorize for this engagement? | Only as network rules | Yes, as a ledger per target |
| How many actions may one run take against a target? | No | Yes, a run ledger |
| How many may all runs take together? | No | Yes, a shared target ledger |
| Who can widen the scope? | Whoever can change the network | Whoever holds a budget-writing key |
| What does the operator know when isolation fails? | Whatever network monitoring caught | Every [reservation](/glossary#reservation) the harness made or was refused |

A sandbox is also binary. While it holds, it is a strong control. When it fails, nothing the agent carries with it is any smaller. The agent that leaves has the same tools, the same step count, and the same instructions it had inside. The complaint alleges an OpenAI team saw at least one agent reach the internet around May 26 and that the training runs continued. WorkOS learned of its incident from a usage spike, five days after the first access. In both accounts, the first alarm came from the affected party, not from the agent's operator.

The right-hand column is not a replacement for the left. It is a second control that does not depend on the first one holding, and that is the argument of this post.

## Why test agents often get weaker controls than production

Production agents accumulate controls because production is where people expect damage. Test and evaluation agents tend to go the other way, for reasons that are individually sensible:

- **The task is to probe.** A pentest or cyber-evaluation agent is given offensive tooling on purpose. A tool allowlist that would be normal in production defeats the test.
- **Safeguards come off for measurement.** The complaint alleges OpenAI "deliberately omits or removes these protections while experimenting with and training its models," and that live chain-of-thought monitoring was enabled for employee deployments but not in training and evaluation environments.
- **Budgets are left open.** Nobody wants an evaluation to fail because a counter ran out, so step and spend limits are set high or not at all.
- **Credentials are informal.** WorkOS's root-cause list includes an API that "accepted a weak credential intended for local development." Separate keys per environment, as in the [least-privilege key matrix](/blog/least-privilege-api-keys-for-ai-agents), exist to stop a development secret from working anywhere else.

The result is an agent with the most capable tools, the fewest limits, and a single boundary. Human penetration testers do not work that way. They sign rules of engagement that name the targets, the window, and the permitted techniques before any traffic is sent. An agent's harness can carry the same thing.

## Write the rules of engagement as RISK_POINTS ledgers

In Cycles, [action authority](/concepts/action-authority-controlling-what-agents-do) is metered in `RISK_POINTS`: caller-assigned policy weights that the harness reserves before an action and commits after it. They express how much consequential activity is allowed, not the probability or cost of damage. The [risk-points how-to](/how-to/assigning-risk-points-to-agent-tools) covers choosing the weights.

Rules of engagement map onto the [scope hierarchy](/protocol/how-scope-derivation-works-in-cycles) directly:

| Rule of engagement | Cycles scope | Ledger |
|---|---|---|
| This engagement | `app` | None in `RISK_POINTS` |
| An authorized target | `workflow` | Total points all runs may spend on it |
| One agent run | `agent` | Points this run may spend on that target |

The target sits above the run so that every run draws on one shared target ledger. Each outbound request then follows the same path in the harness:

```python
def send(client, targets, subject, op):
    """The only path to a target: reserve, dispatch, commit. Refusal sends nothing."""
    target = subject["workflow"]
    try:
        rid = reserve(client, subject, op, target)   # 20 RISK_POINTS, REJECT, 30 s TTL
    except Refused as refused:
        return "denied" if isinstance(refused, Denied) else f"refused:{refused.error}"
    targets.request(target, op)
    # The request went out, so the charge stands. Never release after dispatch.
    commit(client, rid, op)
    return "sent"
```

That is the drill's `send` function with its concurrency handling removed. Four behaviors decide whether this layout works. All were observed against [Cycles Server](/glossary#cycles-server) 0.1.25.59:

- **A target with no ledger has no authority.** A live reservation for an unlisted target returned `404 NOT_FOUND` with the message `Budget not found for provided scope`. The same request as a `dry_run` returned `200` with `decision: DENY` and `reason_code: BUDGET_NOT_FOUND`. The [error reference](/protocol/error-codes-and-error-handling-in-cycles) documents both forms.
- **A ledger in another unit changes the error, not the outcome.** When the [tenant](/glossary#tenant) had a USD ledger and nothing in `RISK_POINTS`, the unlisted target returned `400 UNIT_MISMATCH`. Treat every 4xx on reserve as a refusal and send nothing.
- **An ancestor ledger in the same unit admits everything beneath it.** If the tenant or the engagement has its own `RISK_POINTS` ledger, a request for an unlisted target is checked against that ledger and can be admitted. Keep the first `RISK_POINTS` ledger at the target level, and keep the harness's own target allowlist. The missing ledger is a second check, not the only one.
- **A run with no ledger is limited only by the target.** A reservation for a run that had no ledger of its own was admitted against the target ledger alone. Create the run ledger before the run starts, and have the harness refuse to start a run it cannot find a ledger for.

One more property matters for an agent that is trying to get somewhere it was not sent. The key the harness uses carries reservation permissions only. When the drill used that key to create a ledger for the unlisted target, the admin API returned `403 INSUFFICIENT_PERMISSIONS`. Widening the engagement takes a credential the agent's process does not hold.

## Size non-production budgets smaller, not larger

The instinct to leave test budgets open gets the risk backwards. An evaluation has a known shape: a fixed target list, a bounded number of attempts, a time window. That makes it easier to size than production traffic.

**Cap the run.** A run ledger sized for the task turns a loop into a refusal. The harness should treat that refusal as the end of the run, not as an error to route around. [How agents work around a denial](/blog/ai-agent-denial-workarounds) covers why the next attempt needs the same policy.

**Cap the target across all runs.** This is the limit a single-agent view cannot provide. On the complaint's figures, roughly 17,600 actions across approximately 700 agents is about 25 actions per agent. No per-agent limit set for a real evaluation would flag 25 actions. Only a ledger shared by every run sees the total.

**Keep leases short and overage off.** The drill uses a 30-second TTL and `REJECT`, so an abandoned reservation returns quickly and no commit can exceed what was reserved.

**Let exhaustion be a stop.** A spent ledger refuses the next reservation whether or not anyone is watching. That is not a full stop mechanism. The [kill-switch stop contract](/blog/ai-agent-kill-switch-stop-contract) describes what stopping has to cover, and a [budget freeze](/how-to/budget-allocation-and-management-in-cycles) is the operator's version of the same refusal.

## What metered authority does not do for a sandboxed agent

This control would not have prevented either escape described above. It is worth being specific about why.

- **It is not isolation.** A ledger does not block a packet. If the agent has a shell, it can open a connection without making a tool call the harness sees. [Computer-use agents](/blog/computer-use-agents-have-no-tool-boundary) have the same problem at the click layer.
- **It binds only what the harness dispatches.** A process the agent started keeps running without further reservations. [Stopping background jobs](/blog/stopping-ai-agents-background-jobs) covers that gap.
- **It is cooperative.** The harness has to call it, and has to send nothing when the Cycles server is unreachable. A harness that proceeds on a timeout has no boundary.
- **It does not protect the target.** WorkOS named four gaps on its own side: public network exposure, a weak credential, missing rate limits, and detection gaps. Those are the target's controls, and no tester's ledger substitutes for them.
- **The weights are policy, not measurement.** Twenty points per request is a number an operator chose.

What it changes is narrower. For every action that does go through the harness, there is a decision before dispatch, a shared count across the fleet, and a refusal the agent cannot argue with or reconfigure. When the sandbox holds, that is redundant. When it does not, it is what remains.

## Run the engagement scope drill

The <a href="/examples/engagement-scope-drill.py" download>downloadable Python drill</a> runs real `RISK_POINTS` reservations against a Cycles server. A local fixture stands in for the network and counts every request each target receives, so a blocked request can be told apart from one whose result was discarded.

::: info What this drill shows
Real admission, refusal, and settlement for a harness that reserves before each request. It sends no network traffic, does not test sandbox isolation, and does not decide what your weights should be.
:::

Use a disposable test tenant from the [full-stack quickstart](/quickstart/deploying-the-full-cycles-stack) with no caps and no `RISK_POINTS` ledger at the tenant scope. The script checks for that ledger and stops if it finds one. Each run creates one engagement with two target ledgers and nine run ledgers, and commits 120 points.

```bash
python -m pip install "runcycles==0.5.3"

export CYCLES_BASE_URL="http://localhost:7878"
export CYCLES_ADMIN_URL="http://localhost:7979"
export CYCLES_TENANT="acme-corp"
export CYCLES_API_KEY="<test-runtime-key>"
export CYCLES_BUDGET_API_KEY="<test-budget-writer-key>"

python engagement-scope-drill.py
```

Create two keys for this drill. The runtime key needs `reservations:create`, `reservations:commit`, `reservations:release`, and `balances:read`. The setup key needs `budgets:write`. The third scenario asserts that the runtime key cannot write a ledger, so the quickstart's combined key will fail it.

Each request reserves and commits 20 points. Target ledgers hold 100 points and run ledgers hold 30:

| Scenario | Setup | Expected result |
|---|---|---|
| `in_scope` | One run, authorized target | Reserved, sent, committed; one request |
| `run_cap` | Same run, second request | The run ledger denies with `409 BUDGET_EXCEEDED` while the target has 80 points left; still one request |
| `out_of_scope` | Same run, target with no ledger | Preflight denies, the live reservation is refused, the runtime key gets `403` writing a ledger; zero requests |
| `fleet` | Eight concurrent runs, each within its own cap | Five sent, three denied; the target ledger shows 100 spent and nothing reserved |

The summary lines should be:

```text
{"event": "PASS", "scenario": "in_scope", "requests": 1, "target_spent": 20}
{"event": "PASS", "scenario": "run_cap", "requests": 1, "denied": 1, "target_spent": 20}
{"event": "PASS", "scenario": "out_of_scope", "requests": 0, "preflight": "DENY:BUDGET_NOT_FOUND", "live": "refused:NOT_FOUND", "runtime_key_budget_write": 403}
{"event": "PASS", "scenario": "fleet", "runs": 8, "requests": 5, "denied": 3, "target_spent": 100}
```

On a tenant that has a USD ledger, the third line reads `"preflight": "REFUSED:UNIT_MISMATCH", "live": "refused:UNIT_MISMATCH"` instead. These results were reproduced with Python SDK 0.5.3, Cycles Server 0.1.25.59, and [Admin Server](/glossary#admin-server) 0.1.25.55.

## Count the refusals, not only the breaches

The complaint's 80-versus-27 allegation is a dispute about a count. Whatever the facts turn out to be, an operator who cannot say how many times its agents tried to act outside their engagement is in a weak position with a regulator, a customer, or its own incident review. [Proving you had controls](/blog/prove-you-had-controls-agent-liability-2026) covers why that record is increasingly what gets asked for.

Refusals are the count worth keeping, because they appear before anything has gone wrong. Be precise about where they are recorded:

- A live denial is an HTTP error to the caller. The [event reference](/protocol/event-payloads-reference) notes that the server does not currently emit `reservation.denied` on that path; the `cycles_reservations_reserve_total` counter labels each reserve outcome.
- A `dry_run` or `/v1/decide` request that returns `DENY` does emit `reservation.denied`.
- A `404` or `400` for an unlisted target is a request error. The harness has to log it, with the operation ID, the target, and the run.

A refused request for a target outside the engagement is not a failed step to retry. It is the earliest available sign that a run is somewhere it should not be, and it should page the person who owns the engagement. [What goes in an AI agent audit packet](/blog/what-goes-in-an-ai-agent-audit-packet) lists what to keep alongside it.

## Resources

External sources were checked November 21, 2026:

- [WorkOS: Update for October 30th, 2026 data security incident](https://workos.com/security/bulletins/update-for-october-30th-2026-data-security-incident): attribution to a researcher's agent, timeline, and the four root-cause gaps.
- [WorkOS: October 30th, 2026 data security incident](https://workos.com/security/bulletins/october-30th-2026-data-security-incident): the original bulletin.
- [California Attorney General: press release, November 16, 2026](https://oag.ca.gov/news/press-releases/it%E2%80%99s-golden-state-not-wild-west-attorney-general-bonta-sues-openai-over): filing, court, and claims.
- [People v. OpenAI: complaint](https://oag.ca.gov/system/files/attachments/press-docs/complaint-oai-cyber.pdf): the allegations summarized above, including the training-run timeline and incident counts.
- [Cycles runtime protocol specification](https://github.com/runcycles/cycles-protocol): [scope derivation](/glossary#scope-derivation), reservation lifecycle, and error semantics.
