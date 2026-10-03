---
title: "AI Agent Rollbacks Can Make Incidents Worse"
date: 2026-10-03
author: Albert Mavashev
tags: [security, agents, incident-response, action-control, runtime-authority, production]
description: "AI agent rollbacks can overwrite legitimate changes. Learn how scoped recovery permissions, version checks, and replay protection limit damage during repairs."
blog: true
sidebar: false
featured: false
head:
  - - meta
    - name: keywords
      content: AI agent rollback risk, AI agent incident recovery, compensating transactions, recovery permissions, optimistic concurrency, action authority, RISK_POINTS
---

# AI Agent Rollbacks Can Make Incidents Worse

An agent suspends the wrong customer accounts. An operator tells it to undo the changes. The agent restores its saved snapshots, including accounts a support team has already corrected. The rollback overwrites the team's work.

This is a constructed incident, but the failure is concrete: the agent knows what it changed earlier and assumes that knowledge is sufficient to change the system again. It does not check what happened in between.

Recovery is another exercise of authority. It needs a defined target, a permitted change, a current-state check, and evidence that the repair completed. An instruction to “fix what you did” supplies none of those boundaries on its own.

<!-- more -->

## Why AI agent rollback creates new risk

The word *rollback* covers several different operations. Rolling back an uncommitted database transaction is a database capability. Reversing an already completed business action usually requires another action, with its own consequences.

| Original action | Proposed repair | Risk that remains |
|---|---|---|
| Change an account's status | Restore the previous status | Someone may have legitimately changed the account since. |
| Send the wrong customer email | Send a correction | The first message remains delivered; the correction reaches another audience boundary. |
| Deploy a faulty service version | Redeploy an earlier version | Data or schema changes may make the earlier version incompatible. |
| Grant broad access | Revoke the grant | Revocation does not retract data already accessed or copied. |

The question is whether the proposed repair is valid *now*. The [tool-risk classification guide](/blog/ai-agent-risk-assessment-score-classify-enforce-tool-risk) applies to the repair as well as the original action. Naming a tool `undo`, `restore`, or `recover` does not reduce its privileges or impact.

Established workflow patterns help here. Microsoft's [compensating-transaction guidance](https://learn.microsoft.com/en-us/azure/architecture/patterns/compensating-transaction) explains that restoration can overwrite concurrent changes, compensation can itself fail, and some cases need manual intervention. [AWS's saga guidance](https://docs.aws.amazon.com/prescriptive-guidance/latest/cloud-design-patterns/saga-orchestration.html) provides a way to coordinate forward operations and compensation across services. Neither supplies the application's business judgment about which repair is appropriate.

## Contain the incident before authorizing recovery

First stop the source of new damage. A repair racing an agent that is still making the same mistake can produce an endless sequence of changes and reversals. The [agent shutdown guide](/blog/stopping-ai-agents-background-jobs) covers queued jobs, child workers, and external operations that can outlive the parent process.

Containment should preserve the information needed for recovery: original operation IDs, affected resource IDs, before-and-after values where appropriate, versions, and downstream receipts. Do not infer the repair set from the agent's latest explanation alone.

Separate the original workload's execution authority from recovery authority. Keep the faulty workflow stopped while an authorized recovery worker receives access to a reviewed set of changes. That worker may be automated, human-operated, or agent-assisted. In each case, its executor should enforce the same narrow boundary.

A separate worker is useful only when the permissions are actually different. Handing it the original administrator credential and a more cautious prompt preserves the original [exposure](/glossary#exposure).

## Bind recovery permissions to a specific change

An [approval envelope](/blog/ai-agent-approval-queues-need-runtime-authority) should identify more than a tool name. For the account example, the application needs these facts:

| Recovery constraint | Example |
|---|---|
| Authorized principal | The designated recovery worker, authenticated by the host. |
| Original operation | The recorded change that suspended this account. |
| Resource boundary | One [tenant](/glossary#tenant) and one account ID. |
| Permitted mutation | Restore the recorded previous `status`; preserve other fields. |
| State precondition | The account still has the version and status produced by the original change. |
| Validity | A short expiry and a way to revoke the grant. |
| Completion identity | One repair operation ID, preserved across transport retries. |

The grant and original change receipt must come from a trusted service. The agent may propose a repair, but it cannot approve its own targets, extend its expiry, or replace the recorded prior value. This is the same reason [delegated authority must narrow](/blog/agent-delegation-chains-authority-attenuation-not-trust-propagation) as work crosses execution boundaries.

When the precondition fails, stop that repair and request a new decision. Automatically refreshing the expected version would erase the reason for having a precondition: the reviewed recovery plan no longer describes the current state.

## Check the version at the write boundary

A preview is useful, but a preview followed by an unconditional write leaves a race. Another operator can change the account after the preview and before the repair.

For a database-backed mutation, include the expected state in the write itself. The drill below uses this shape:

```sql
UPDATE accounts
SET status = ?, version = version + 1
WHERE tenant = ? AND account_id = ? AND version = ? AND status = ?;
```

The parameters come from the trusted change receipt. A repair proceeds only when exactly one row matches. It changes the approved field and advances the version; it does not restore a whole-row snapshot. Every writer must follow the versioning rule, or a version check cannot reliably detect intervening updates.

The grant check, conditional update, and completion receipt share one SQLite transaction in this example. SQLite documents both [transaction behavior](https://www.sqlite.org/lang_transaction.html) and [conditional updates](https://www.sqlite.org/lang_update.html). `BEGIN IMMEDIATE` acquires the write transaction before these checks; competing writers may have to wait or receive a busy error. The script propagates database errors instead of treating them as permission to proceed.

For a remote service, use its supported conditional-write and idempotency mechanisms where available. A local receipt table and a remote mutation do not become atomic just because the application calls them in sequence. If the remote response is lost, reconcile the operation's outcome before issuing another consequential action. The [retry and idempotency guide](/blog/retry-storms-and-idempotency-in-agent-budget-systems) explains why transport replay needs a stable identity.

## Run the agent rollback risk drill

The <a href="/examples/agent-rollback-risk-drill.py" download>downloadable Python drill</a> uses Python 3.10 or later and only the standard library. It creates a temporary SQLite database, runs four checks, and removes the temporary database on normal exit. It needs no API keys and makes no external calls.

```bash
python agent-rollback-risk-drill.py
```

The fixture begins with two accounts mistakenly changed from `active` at version 1 to `suspended` at version 2. Trusted setup code records those changes and gives `recovery-worker` a separate, expiring grant for each one.

| Scenario | Expected result |
|---|---|
| `scoped_repair` | Account 1 returns to `active` at version 3; its unrelated note remains unchanged. |
| `stale_state` | A support intervention moves account 2 to `manual-review` at version 3. The old recovery grant cannot overwrite it. |
| `wrong_principal` | The original agent cannot execute the recovery worker's grant. |
| `replay_after_reconnect` | Reopening the database and repeating the first operation returns its persisted receipt without another mutation. |

All four records should report `"result": "PASS"`. The database should contain exactly one completed repair.

The replay returns evidence of an earlier completion, not a claim about the account's current state. It remains subject to the grant's current expiry and revocation checks. If that grant is no longer valid, an authorized reconciliation path must inspect the recorded outcome; it must not blindly issue a replacement repair.

The example's trust boundary is deliberately small. Identity and grants are fixtures. A production executor must authenticate the caller, protect grant and change records, control revocation, and prevent direct database access from bypassing the handler. The drill demonstrates local conditional mutation and durable replay after reconnect; it does not implement a distributed recovery service or simulate power-loss durability.

## Bound cumulative recovery exposure

Target and version checks answer whether one repair is authorized and still applicable. They do not decide how much recovery work may proceed unattended across an incident. A valid repair to one account does not imply permission to repair every account the agent can discover.

Set an explicit recovery scope and escalation threshold. For example, allow an operator-reviewed set of account-status repairs, while routing customer notifications, access changes, or uncertain external outcomes to separate approval paths. Avoid a generic recovery tool that can run arbitrary SQL or shell commands.

Where cumulative exposure needs metering, the host can assign `RISK_POINTS` to authorized recovery attempts and require a Cycles [reservation](/glossary#reservation) before dispatch. These points express application policy, not a probability of harm or a safety score computed by the server. The [risk-points guide](/how-to/assigning-risk-points-to-agent-tools) explains that responsibility.

Cycles does not validate the repair's target, inspect database versions, or perform compensation. Its reservation and the resource's transaction are separate operations. Keep authorization and the conditional write in the host or target service, and reconcile the reservation according to what actually executed. Releasing a reservation does not undo a database mutation. Completing a repair also does not erase the exposure recorded for the original action.

If the faulty workflow's budget is frozen, recovery needs a deliberately provisioned path whose affected scopes permit execution. An extra child allowance cannot bypass a frozen ancestor. Design that incident procedure in advance instead of broadly reopening the faulty workload during recovery. The SQLite drill does not implement this optional Cycles integration.

## Close the incident with verified outcomes

A repair report should connect the original change, the approved recovery plan, the execution receipt, and a subsequent state check. The [agent audit-packet guide](/blog/what-goes-in-an-ai-agent-audit-packet) describes how to assemble evidence across systems. Record conflicts and unknown outcomes alongside successful repairs; a partial recovery should remain visibly partial.

For the account example, the right ending is specific: account 1 was repaired once, account 2 was left untouched after a version conflict, and the conflict remains open for review. A green “rollback complete” banner would hide the most important remaining decision.

The recovery mechanism deserves the same scrutiny as the action that caused the incident. Test the point at which it must stop: a legitimate intervening change, an expired grant, the wrong caller, or an outcome that cannot yet be established.

## Resources

- <a href="/examples/agent-rollback-risk-drill.py" download>Agent rollback risk drill</a> — local grants, conditional writes, and persisted repair receipts.
- [Microsoft: Compensating Transaction pattern](https://learn.microsoft.com/en-us/azure/architecture/patterns/compensating-transaction) — application-specific recovery and concurrent changes.
- [AWS: Saga orchestration pattern](https://docs.aws.amazon.com/prescriptive-guidance/latest/cloud-design-patterns/saga-orchestration.html) — coordinating operations and compensation across services.
