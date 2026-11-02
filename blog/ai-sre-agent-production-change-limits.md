---
title: "AI SRE Agents Need Limits on Production Changes"
date: 2026-11-02
author: Albert Mavashev
tags: [agents, operations, incident-response, action-control, runtime-authority, production]
description: "AI SRE agents can widen an outage while trying to fix it. Bound production changes across retries and workers, verify recovery, and define when to escalate."
blog: true
sidebar: false
featured: false
head:
  - - meta
    - name: keywords
      content: AI SRE agents, automated incident remediation, production change limits, agent action authority, incident response, RISK_POINTS
---

# AI SRE Agents Need Limits on Production Changes

An on-call agent sees elevated checkout errors and replaces an unhealthy replica. Errors continue, so it replaces another. A second worker receives a related alert and starts changing the same service. The first agent then proposes a shared configuration change because the replacements did not help.

This is a constructed incident. Each proposed intervention has a plausible explanation, but the responders are expanding the set of changes while their evidence remains uncertain. Their model usage can be inexpensive even as their production impact grows.

An AI SRE agent needs an explicit allowance for the whole recovery attempt: which resources it may change, how much intervention may accumulate, and what evidence requires it to stop. Urgency does not establish authority to widen that allowance.

<!-- more -->

## AI incident remediation is reaching execution

Recent implementations connect agent investigation to concrete remediation workflows. In its October 7, 2026 [remediation architecture](https://aws.amazon.com/blogs/machine-learning/automate-remediation-post-aws-devops-agent-investigation/), AWS describes a custom workflow that consumes DevOps Agent findings, selects from curated Lambda tools, and pauses infrastructure mutations for human approval. These controls give operators a defined review and execution path.

The October 12 [Daimler Truck case study](https://aws.amazon.com/blogs/industries/automating-incident-resolution-with-a-multi-agent-self-healing-sre-solution-on-aws/) describes another approach: agents investigate incidents, prepare and validate fixes, and open pull requests for engineering review before deployment. The design also includes alert deduplication, repository restrictions, and policy controls.

These examples make a practical design question timely: how should an incident's permissions behave across successive fixes, overlapping responders, and changes made by humans? A team adopting either pattern still needs to define that contract for its own production environment.

## Define production change limits before the incident

Start with a narrow runbook that operators already understand. For the checkout example, assume the team has approved replacement of an individually identified stateless replica, with availability checks enforced by the executor. Shared configuration, database changes, and access grants require separate decisions.

The following is an illustrative application policy, not a Cycles API payload or a generally safe production default:

| Boundary | Example incident policy |
|---|---|
| Ownership | One trusted incident record for checkout in one production region. |
| Permitted operation | Replace a specifically identified unhealthy replica after runbook preconditions pass. |
| Cumulative intervention | At most two accepted replacement operations across every responder. |
| Concurrent intervention | One operation in progress; retain the slot until its outcome and stabilization checks are resolved. |
| Availability | Enforce the runbook's minimum healthy capacity before each replacement. |
| Operation stabilization | Confirm the replacement restored expected healthy capacity without worsening service metrics during its observation window. |
| Validity | Stop admitting mutations after ten minutes; expiry does not cancel work already accepted. |
| Escalation | Stop mutations on an unknown outcome, a conflicting change, exhausted allowance, or a failed stabilization check. |
| Recovery evidence | Error rate and latency return to the service's defined thresholds for the configured observation window. |

The executor must authenticate callers and enforce these rules on every mutation path. An agent with separate administrator credentials could bypass the policy. The [action-authority guide](/concepts/action-authority-controlling-what-agents-do) explains the division between application permissions and metered [exposure](/glossary#exposure).

Approval should bind the exact operation and target. The [approval-envelope pattern](/blog/ai-agent-approval-queues-need-runtime-authority) supplies that handoff. A broad instruction to repair checkout cannot substitute for a resource boundary and an escalation rule.

## Share the allowance across responders

A new alert, retry, or child worker must not manufacture another recovery allowance. Have a trusted coordinator map related alerts to the incident record and assign every responder to its scope. The agent cannot select a fresh incident identifier to regain capacity.

Deduplication and shared limits serve different purposes. Deduplication suppresses repeated triggers; a shared allowance bounds distinct interventions that remain legitimate candidates. [Authority attenuation across delegation](/blog/agent-delegation-chains-authority-attenuation-not-trust-propagation) means a child receives a narrower assignment within the incident's existing boundary.

Make admission durable and concurrency-safe. In this example, the executor atomically claims the incident's single mutation slot and records the operation before dispatch. A second responder cannot start another mutation while that slot is occupied. Keep unresolved operations visible after a worker restart. An expired worker lease alone is insufficient evidence that the downstream change stopped.

Also coordinate different incidents that touch the same service. Per-incident limits do not prevent two separately classified incidents from each replacing a replica. The service needs a shared disruption limit or an exclusive change owner, enforced with its availability checks. Existing deployment automation and human procedures must participate in that coordination for the stated limit to hold.

## Meter action exposure separately from model spend

Where a team wants a weighted intervention allowance, Cycles can contribute caller-assigned `RISK_POINTS` through the [reserve-commit lifecycle](/protocol/how-reserve-commit-works-in-cycles). The executor chooses the weights and reserves before dispatch. Points express policy; they do not measure the probability or monetary value of damage.

For an illustrative fixed-charge policy, assign 30 points to each accepted replacement and provision 60 points for the incident. Configure a shared workflow budget and map every responder to the same tenant, workspace, app, and workflow through trusted host code. Reusing a workflow name under a different scope prefix does not establish a shared budget. Two accepted replacements consume 60 points; another 30-point [reservation](/glossary#reservation) cannot fit. A retry that retrieves the same completed operation's receipt does not authorize another replacement.

This arithmetic assumes no replenishment, a fixed charge for each accepted operation, and mandatory admission through the executor. A new attempt after a confirmed failure is still a new intervention. Define that accounting rule before the incident; charging only successful repairs would give failed interventions a way to consume production capacity without consuming their allowance.

Require a successful live reservation with `ALLOW`, or `ALLOW_WITH_CAPS` whose returned constraints the host can enforce. A `DENY` decision or reservation error must stop dispatch. A budget result does not authorize a target, validate a diagnosis, or establish spare capacity. Resource restrictions, operation counts, approval expiry, and the mutation slot remain application responsibilities.

Persist downstream operation identifiers and reconcile what actually executed. Release when the action was prevented and no charge is due. Under the example policy, commit the fixed charge once acceptance is established, even if the replacement fails to restore service. A timeout leaves the outcome unresolved: retain the application stop on further mutations while reconciling it. Reservation expiry must not silently reopen the incident. The budget ledger and the production service do not share an atomic transaction.

## Recheck production state before a fix

Between diagnosis and execution, another operator may deploy a fix or change the target. Bind the proposed mutation to the expected resource state and enforce that precondition at the write boundary where the target API supports it.

For example, Kubernetes documents [conditional updates using resource versions](https://kubernetes.io/docs/reference/using-api/api-concepts/#updates-to-existing-resources) to detect lost updates. The appropriate mechanism depends on the operation; reading a version and then issuing an unconditional mutation leaves a race. A version check on one object also does not establish service-wide availability.

A conflict should return the operation for reassessment. Automatically refreshing the version and retrying the same stale plan defeats the protection. If an API cannot enforce the required condition, use a controlled execution path with a documented remaining race, or keep that operation outside autonomous remediation.

Rollback requires the same attention to current state. It consumes a separately authorized action and can conflict with a human fix or changed data. The [agent rollback risk drill](/blog/ai-agent-rollback-risk) examines those cases in detail. Keep a deliberately authorized recovery path available to operators; do not let the agent replenish its own allowance or label a new mutation “undo” to bypass admission.

## Separate stabilization from incident recovery

The operation's stabilization window begins after its outcome is known. During that window, keep the mutation slot occupied and verify that expected healthy capacity returned without worsening service metrics. A provider reporting successful execution proves that an operation completed, not that checkout recovered.

In the example, an unknown outcome, worsening availability, or a failed stabilization check stops automated mutations and escalates to the incident owner. The owner can review new evidence and explicitly authorize a revised plan. If the first replacement stabilizes but another individually identified unhealthy replica remains, a second replacement may proceed after fresh precondition checks, within the remaining allowance.

Incident closure has a separate threshold: service error rate and latency must recover for the configured recovery window. Once those criteria are met, close mutation admission for this incident. If two interventions finish without recovery, escalate; successful replacements do not justify an open-ended repair loop.

Record the observed service metrics, their timestamps, accepted changes, unresolved operations, and the reason for stopping. Read-only investigation may continue under its existing permissions. The [agent shutdown procedure](/blog/stopping-ai-agents-background-jobs) covers dispatched work that can outlive a stopped orchestration loop.

## Drill the remediation boundary

Exercise the policy against a fake production API before connecting it to live infrastructure. Give the stub controllable acceptance, delayed responses, version conflicts, and health observations. These are proposed acceptance tests, not reported benchmark results.

| Injected condition | Required observation |
|---|---|
| Deliver the same alert twice | Both deliveries resolve to the same incident; no fresh allowance appears. |
| Start two responders together | Only one claims the mutation slot; inspect the stub's accepted-operation count. |
| Accept a replacement, then lose the response | The incident remains blocked on an unknown outcome; reconciliation finds the original operation without a second mutation. |
| Restart the coordinator while a change is unresolved | Durable state preserves the blocked slot and operation identity. |
| Have a human change the target after approval | The stale mutation fails its execution-time precondition and requires reassessment. |
| Complete two permitted replacements | A third mutation is blocked even when proposed by a new worker. |
| Send another incident against the same service | The service's shared disruption control still applies. |
| Return successful execution while healthy capacity fails to recover | The failed stabilization check triggers escalation, even though the tool reported success. |
| Stabilize replacements while service errors remain elevated | Keep the incident unresolved; exhausting the intervention allowance triggers escalation. |

Inspect downstream acceptance and service state alongside the decision log. A logged denial is useful evidence only when the denied path could not also reach production through another credential or tool.

For the opening incident, the desired behavior is explicit: one responder replaces one replica and the other waits. The executor checks stabilization and remaining authority before admitting a second replacement. Failed stabilization or exhausted authority triggers escalation. The shared configuration change needs a new reviewed plan. The agent has helped with diagnosis and bounded intervention while preserving the operator's decision about what happens next.

## Resources

The external examples and API guidance were checked November 2, 2026:

- [AWS: Automate remediation post AWS DevOps Agent investigation](https://aws.amazon.com/blogs/machine-learning/automate-remediation-post-aws-devops-agent-investigation/) — curated remediation tools and approval before infrastructure changes.
- [AWS: Multi-agent SRE solution at Daimler Truck](https://aws.amazon.com/blogs/industries/automating-incident-resolution-with-a-multi-agent-self-healing-sre-solution-on-aws/) — investigation, validated fixes, and engineering review.
- [Kubernetes: Updates to existing resources](https://kubernetes.io/docs/reference/using-api/api-concepts/#updates-to-existing-resources) — concurrency semantics for resource updates.
