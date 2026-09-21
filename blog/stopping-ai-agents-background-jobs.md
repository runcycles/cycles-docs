---
title: "You Stopped the Agent. Its Jobs Kept Running."
date: 2026-09-21
author: Albert Mavashev
tags: [operations, incident-response, agents, reliability, runtime-authority]
description: "Stopping an AI agent can leave queued tasks and provider jobs running. Build a shutdown procedure to block new work, verify cancellation, and settle usage."
blog: true
sidebar: false
featured: false
head:
  - - meta
    - name: keywords
      content: AI agent shutdown, AI agent kill switch, background job cancellation, agent incident response, runtime authority, durable settlement
---

# You Stopped the Agent. Its Jobs Kept Running.

Imagine a support agent handling a batch of customer cases. It has queued outbound emails, started a paid document-processing job, and delegated two investigations to separate workers.

An operator notices that the agent selected the wrong customer segment. They stop the agent and freeze its workflow budget. The application dashboard reports that the run has stopped.

Then another email arrives. The document-processing job keeps running. One worker is unreachable, and the other is waiting to retry a failed request.

This is a constructed incident, but the boundary it illustrates is ordinary distributed-systems behavior: the process that requested work and the systems executing that work have separate lifecycles.

**An agent shutdown needs evidence that new work is blocked, dispatched work is accounted for, and completed work is reconciled.** A stopped orchestration loop proves only part of that.

<!-- more -->

## What an AI agent kill switch actually stops

A [scoped kill switch](/blog/ai-agent-kill-switches-should-be-scoped) helps an operator contain the affected workflow without stopping unrelated customers. Its scope still needs an execution boundary.

In Cycles, a [budget freeze](/how-to/budget-allocation-and-management-in-cycles) blocks new [reservations](/glossary#reservation) against that budget. It does not send cancellation requests to your email provider, queue consumers, or document-processing service. Previously admitted work needs separate handling.

This distinction also applies inside the application. Stopping the agent loop prevents that loop from choosing another action. A queue message it already published may remain eligible for delivery. A provider job it already started may continue under the provider's own lifecycle.

Before declaring containment, classify the work you can identify:

| Observed state | Operator action | Evidence to retain |
|---|---|---|
| Proposed, not dispatched | Block admission and suppress new scheduling | Denied or suppressed dispatch attempts |
| Queued, not started | Cancel or quarantine the task; require consumers to check the stop state | Queue disposition and consumer decision |
| Running locally | Request cooperative cancellation; escalate under a tested termination policy | Worker acknowledgment and execution outcome |
| Running at a provider | Use the provider's cancellation or termination operation | Provider job identifier and final reported state |
| Completed or outcome unknown | Reconcile the result; arrange remediation where needed | Side-effect receipt, usage record, or explicit unresolved status |

These are application categories, not Cycles reservation states. A reservation can be released or expired while external work continues. Neither transition proves that the downstream operation stopped.

## Background job cancellation needs confirmation

AWS Batch provides distinct operations for queued and running work. Its [`CancelJob` documentation](https://docs.aws.amazon.com/batch/latest/APIReference/API_CancelJob.html) makes an important behavior explicit: a request can succeed even when the job has already reached `STARTING` or `RUNNING` and no cancellation occurs. Those jobs require [`TerminateJob`](https://docs.aws.amazon.com/batch/latest/APIReference/API_TerminateJob.html), which transitions terminated jobs to `FAILED`.

Query the resulting job state and retain the reason. A successful cancellation request alone does not prove that work stopped.

Temporal supplies another useful distinction. Its [.NET cancellation guide](https://docs.temporal.io/develop/dotnet/workflows/cancellation) documents graceful cancellation with application handling, including Activity heartbeats, and forceful Workflow termination that gives Workflow code no cleanup opportunity. The guide also distinguishes the server receiving a cancellation request from cancellation being applied.

Those are useful orchestration controls. An integration must still establish what happens to an external operation launched by an Activity. Terminating orchestration cannot recall an email already accepted for delivery.

For each integration, document who requests cancellation, who confirms it, the deadline for confirmation, and the escalation when confirmation never arrives. Some operations have no cancellation interface. Mark those as work that must complete or be contained elsewhere, with an explicit remaining [exposure](/glossary#exposure).

## Carry the stop decision to every worker

A reliable shutdown procedure starts before the incident. Record the relationship between the agent run, child workers, queue messages, provider jobs, and reservations as work is dispatched. Persist a dispatch intent before submission; attach the provider identifier once it is known. Ambiguous submissions need lookup or reconciliation using the provider's supported identity mechanism.

Without that inventory, killing the parent can remove the easiest way to find its descendants. [Authority attenuation across delegation](/blog/agent-delegation-chains-authority-attenuation-not-trust-propagation) constrains what children may do; shutdown also needs a way to discover which children exist and reach their execution boundaries.

For the support workflow, the containment procedure would be:

1. **Record the stop durably.** Associate the affected run and scope with an incident identifier. Stop the parent scheduler and prevent its retries from creating replacement work.
2. **Block new protected actions.** Freeze the applicable budget and enforce the application's stop state at dispatch boundaries. Include queued work that already obtained a reservation.
3. **Inventory and cancel outstanding work.** Quarantine queued emails, contact both workers, and request cancellation or termination of the provider job. Repeat discovery while dispatches already in progress are being resolved.
4. **Escalate unresolved execution.** An unreachable worker remains unresolved. Use the tested infrastructure or provider control where necessary, recording the remaining uncertainty.
5. **Reconcile outcomes and usage.** Keep the run stopped while recovery records are collected and assigned to an owner.

The stop check has a race of its own. A worker can read “running,” then dispatch after an operator records “stopped.”

To claim that no new side effect can start after a particular acknowledgment, the application needs an enforced ordering between stop and dispatch at the final boundary. That might use serialized dispatch or an authority version atomically validated with dispatch by the service that performs the action. A version carried only as metadata does not fence anything. Calls already accepted beyond that boundary remain part of the cancellation inventory.

If the integration cannot establish that ordering, document and measure the remaining dispatch window. Do not describe a periodic stop check as instantaneous revocation.

## Cancellation does not erase consumed usage

The document-processing job might consume resources before it stops. The email may already have been sent. Canceling the parent does not establish zero usage for either operation.

The [reserve-commit lifecycle](/protocol/how-reserve-commit-works-in-cycles) needs an outcome-based accounting decision:

- Release a reservation when execution was prevented or usage is demonstrably zero.
- Commit known actual usage for work that ran, including a partially completed operation that failed or was canceled.
- Preserve ambiguous outcomes for reconciliation. A timeout does not establish whether work ran or what it consumed.

These are application accounting requirements. Capture partial usage before cancellation exits through an exception; a lifecycle helper that sees only a failed callback may release its reservation without discovering that usage.

Cycles' [durable settlement behavior](/protocol/sdk-settlement-recovery-and-durability) handles retries once actual usage is known and enters settlement. Restart recovery requires enabled journaling, successful persistence, and storage that survives shutdown. It cannot reconstruct a provider result the application never received. Reconcile missing usage from provider records where possible.

Keep an application-owned incident record of known usage and verify settlement outcomes. A frozen budget can reject an expired reservation's direct-event recovery, and a genuine terminal rejection can end SDK retries and remove the journal entry. Treat that as unresolved accounting requiring an authorized reconciliation procedure, without reopening unsafe dispatch.

Revoke compromised credentials when necessary and arrange recovery through an appropriately authorized principal. Configure stable tenant identity beforehand: journals partition by server and principal, falling back to API-key identity when no tenant is configured. Verify that replacement credentials can discover and settle pending records. Rotation alone does not establish that.

A reservation heartbeat is also separate from execution cancellation. The documented [SDK heartbeat policy](/blog/safe-agent-lease-heartbeats-remaining-ttl) surfaces extension failure without automatically canceling already-authorized work. Letting a lease expire is not a substitute for reaching the worker or provider.

## Run an AI agent shutdown drill

Use a nonproduction workflow with a fake email sink, a controllable job stub, and two workers. Give every task a stable identifier. Configure barriers that let the test pause a task before dispatch, hold a running task, and delay a cancellation response. These are proposed test conditions, not measured Cycles results.

Start with one email queued, one email already accepted by the sink, a provider job running, and two delegated workers. Then issue the stop and exercise each case separately:

| Injected condition | Required observation |
|---|---|
| Deliver the queued email after the stop is recorded | The consumer checks the stop state and suppresses the send |
| Pause a worker after its stop check, then stop the run before dispatch | The final boundary rejects stale dispatch, or the test exposes a documented race |
| Delay the provider's cancellation acknowledgment | The job remains pending cancellation; the UI does not claim it stopped |
| Let the provider finish while cancellation is pending | Record completion and actual usage without launching replacement work |
| Disconnect one worker from the control plane | Keep its status unresolved and trigger the configured escalation |
| Restart a worker with a scheduled retry | The durable stop survives restart and blocks new work for that run |

Inspect the fake sink and provider stub directly. A cancellation log entry alone is insufficient: compare accepted operations before and after the stop, including work admitted before containment took effect. The already accepted email should remain visible as a completed effect requiring reconciliation.

Measure time to enforced dispatch blocking and confirmed termination or completion of each task. Record additional side effects and unresolved usage. Keep unresolved tasks visible in the results. Choose deadlines from the workflow's exposure and cancellation behavior.

## Make the shutdown result reviewable

The operator needs separate answers: is new work blocked, has outstanding execution ended, and has its usage been reconciled? A single “stopped” badge hides those distinctions.

For each known task, retain its last observed state, observation time, cancellation request and response, terminal evidence, side-effect outcome, and settlement status. Assign an owner and next action to every unresolved item. Link those records with the run and incident identifiers using the same discipline as [cross-service trace correlation](/blog/w3c-trace-context-ai-agent-debugging).

For the support incident, a useful report might read: dispatch blocked; queued emails suppressed; one email already delivered; provider job completed during cancellation; one worker stopped; one worker unresolved; usage reconciliation pending. That report tells the operator exactly what still needs attention.

Keep the durable stop in place until recovery is deliberately authorized. Resuming the workflow is another decision: reconcile the old attempts first so a restart does not silently repeat their effects.

## Resources

The provider examples use the [AWS Batch cancellation contract](https://docs.aws.amazon.com/batch/latest/APIReference/API_CancelJob.html), [AWS Batch termination contract](https://docs.aws.amazon.com/batch/latest/APIReference/API_TerminateJob.html), and [Temporal's .NET cancellation and termination guide](https://docs.temporal.io/develop/dotnet/workflows/cancellation), checked September 21, 2026. Use the corresponding contract for each queue, runtime, and provider in your own shutdown procedure.
