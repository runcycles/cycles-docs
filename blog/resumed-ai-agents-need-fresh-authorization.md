---
title: "Resumed AI Agents Need Fresh Authorization"
date: 2026-11-14
author: Albert Mavashev
tags: [agents, security, governance, reliability, runtime-authority, production]
description: "Resuming AI agents can revive stale permissions and replay side effects. Test revocation, shared budgets, and uncertain outcomes before the next action runs."
blog: true
sidebar: false
featured: false
head:
  - - meta
    - name: keywords
      content: AI agent resumption, agent authorization, agent checkpoint security, durable agents, agent recovery, runtime authority, shared budgets, idempotency
---

# Resumed AI Agents Need Fresh Authorization

A support agent pauses overnight with a refund ready to submit. Its saved state contains the customer, the amount, an approval, and the next tool call.

While it is idle, an operator revokes its refund permission. Another worker consumes most of the shared action budget. An earlier refund request also completes at the payment provider, but its response never reaches the agent.

The replacement worker restores the checkpoint successfully. It has enough context to continue the task. Before it sends anything, it must establish which actions are still permitted and which actions already happened.

This is a constructed incident. It illustrates a deployment requirement: **a resumed agent's next consequential action must pass current authorization and recovery checks.** Restoring conversation history or a sandbox does not establish those facts.

<!-- more -->

Here, *fresh authorization* means an automated check against the current controls at the action boundary. It does not mean asking a person to approve every resumed turn. Existing user intent can remain valid while a particular permission, approval, allocation, or target state has changed.

## Why AI agent resumption needs its own review

Recent infrastructure releases make long-lived agent execution easier to operate:

| Development | Useful capability | Question to test in your deployment |
|---|---|---|
| Google's November 5 announcement of [Agent Substrate 1.0 and general availability on GKE](https://cloud.google.com/blog/products/containers-kubernetes/open-infrastructure-for-autonomous-agents-comes-to-cncf) | Persistent agent state is separated from reusable workers; idle state can be snapshotted and restored. | Does a replacement worker encounter the current access and allocation controls? |
| Anthropic's November 12 [self-hosted Managed Agents private beta](https://claude.com/resources/articles/self-hosted-claude-managed-agents) | Teams can host the agent service, sandboxes, credentials, and session history in their own environment. | Which trusted services own permissions and unresolved operation records across restarts? |
| OpenAI's [scheduled automations](https://developers.openai.com/api/docs/guides/agents-api/sessions/automations) and [session configuration updates](https://developers.openai.com/api/docs/guides/agents-api/configuration#update-settings-for-an-existing-session) | A schedule can continue an existing session, and its tools can change during its lifetime. | Is the next dispatched operation evaluated under the current configuration? |

These platforms already provide useful security building blocks. Google's announcement describes identity-based gateways and secret injection. Anthropic describes separation between the agent loop and sandbox, credential handling outside the sandbox, network restrictions, and session records. The point is to verify how your application's business authorization composes with those controls. These announcements do not establish vulnerabilities in the platforms.

Resumption concentrates several forms of [policy drift](/blog/policy-drift-in-ai-agents) at one boundary. The conversation may be unchanged while the permissions, target resource, worker identity, or remaining budget has moved on.

## Separate saved work from current authority

A checkpoint can preserve a plan, files, messages, and references to pending operations. Treat embedded claims such as "approved," "budget remaining," or "not yet sent" as observations that need verification.

Keep the authoritative records outside the agent's editable checkpoint and restore process:

| Record | Owner and resumption check |
|---|---|
| Principal and scope | The trusted host authenticates the worker and binds it to the intended [tenant](/glossary#tenant), run, and resource. A tenant name supplied by the model is insufficient. |
| Permissions and stop state | The policy or action service evaluates current grants, revocation, and any durable stop. Restoring an older checkpoint must not clear a stop. |
| Human approval | The approval service checks the approved arguments, target, expiry, and revocation status. |
| Remaining allocation | The shared ledger supplies current capacity, including other workers' spend and outstanding holds. |
| External operation outcome | A durable operation record and downstream evidence establish whether work was accepted, completed, rejected, or remains uncertain. |

"Outside the checkpoint" is a trust boundary, not necessarily a different database product. The worker must be unable to rewrite the authority records or restore them to an earlier version. Backups of an entire control plane require their own reconciliation procedure; this article concerns restoring agent execution state.

For [human approval](/blog/ai-agent-approval-queues-need-runtime-authority), the original approval may still be usable if its scope and conditions remain valid. A changed amount or recipient needs a decision under the approval policy. A remembered approval in conversation history cannot replace that check.

## Reconcile the old operation before admitting new work

The first recovery question is whether the proposed action already happened. A timeout leaves that uncertain. Restarting the process does not turn uncertainty into failure.

Before first dispatch, persist a stable business operation ID, the intended arguments, and the downstream request identity outside the agent checkpoint. Bind that record to trusted scope and add receipts as they arrive. A restored worker should find the same operation even if the checkpoint predates the response.

If the operation completed, recover the result and settle known usage. Do not send another refund to make the local history look complete. If the result is uncertain, use a permitted status lookup or the downstream service's documented idempotent recovery path. Verify its key scope, payload-matching rules, and retention window. For example, [Stripe documents those limits explicitly](https://docs.stripe.com/api/idempotent_requests); an [idempotency key](/glossary#idempotency-key) is not an unlimited replay guarantee.

A retry that could create an effect still needs current authorization, even with the original idempotency key. If permission has been revoked, restrict recovery to permitted status queries. Revoking refund access need not prevent a separately authorized reconciliation worker from querying an existing refund. If no safe lookup or replay is available, hold the operation for reconciliation.

Keep distinct identities for the business operation and each endpoint's idempotent request. Preserve the appropriate keys when recovering the same request. Minting a new key after a timeout can turn a retry into a second effect. Conversely, copying a successful admission response from an earlier request does not establish current permission for new work.

The [spend-recovery walkthrough](/blog/the-model-call-succeeded-then-the-process-died) covers the accounting side of this boundary. Accounting recovery and external-effect deduplication require separate evidence.

## Enforce current authorization at dispatch

For work that remains to be done, bind the next action to the authenticated principal, intended scope, exact arguments, and current target state. Evaluate permission and approval conditions, then obtain the required allocation before dispatch. For a versioned resource, have the receiving service enforce the expected version so an intervening update is not overwritten.

The check must protect the actual execution route. A gateway cannot enforce a decision on a direct SDK call carrying a separate credential. Include alternate tools, child workers, scheduled tasks, and delayed retries in the route inventory.

Also test the gap between admission and execution. A stop may arrive after permission was checked but before a queued request reaches its destination. Where possible, make the receiving action service validate current policy or a revocable, scoped execution grant when it accepts the operation. Document any revocation delay, queue behavior, and remaining race window. A check at session startup alone cannot close that window.

For high-impact operations, define what happens when current authority cannot be obtained. A stale cached approval or an exception handler that proceeds anyway defeats a fail-closed policy. The [stop-contract guide](/blog/ai-agent-kill-switch-stop-contract) explains how to make route coverage and revocation timing testable.

## Run three resumption acceptance tests

Run these procedures against a nonproduction deployment using a fake refund sink or provider test environment. They are an integration test plan, not reported test results for the platforms above. First prove that the normal authorized path produces exactly one accepted operation; otherwise, a disconnected executor could appear to pass every denial test.

Use a separate trusted observer to inspect accepted effects and ledger changes. Record the checkpoint, principal, scope, operation ID, policy revision, decisions, and downstream receipts. Each test changes a different condition so a permission denial does not mask a broken budget gate.

### Test 1: Revoke permission while the agent is suspended

1. Pause immediately before the refund's authorization check and save the checkpoint. Confirm the worker is allowed to issue the test refund at this point.
2. Revoke that permission through the trusted control plane. Wait for the documented propagation boundary and record it.
3. Restore the checkpoint onto a replacement worker and deliver the original task again, including a delayed retry.
4. Inspect the refund sink independently of the agent's response.

**Pass:** zero new accepted refunds after the effective revocation boundary, with evidence that the replacement worker reached and was rejected by the intended control. The worker must not restore the previous grant or escape through an alternate credential.

Repeat with an approval that expires during suspension, and with the authority service unavailable. For the declared fail-closed operation, neither condition may silently admit a new refund. Separately inject revocation after admission but before dispatch to measure the race window described above.

### Test 2: Consume the shared allocation elsewhere

1. Start with a fresh shared allocation of 100 `RISK_POINTS` and no outstanding holds. The pending action requires 20 points. Save a checkpoint before reserving those points.
2. Keep permissions valid. Have another worker reserve and commit 90 points against the same governing ledger.
3. Restore the checkpoint and attempt the pending action.
4. Inspect both the ledger and the sink.

**Pass:** the restored worker reaches live admission on the intended governing scope and receives `BUDGET_EXCEEDED`, with no new reservation or dispatch and unchanged balances. The 20-point action cannot fit the remaining 10 points. The restart must neither reset the ledger nor silently map the task to a new allocation.

In a separate fixture, resume two workers with the same business operation ID concurrently and sufficient capacity. After both workers finish, require exactly one accepted business effect. A shared ID alone does not enforce this: the integration needs coordinated operation ownership or downstream deduplication that remains valid throughout recovery.

Record the actual derived scope, not just the run label printed by the agent. The [scope-derivation reference](/protocol/how-scope-derivation-works-in-cycles) is useful when verifying which Cycles ledgers the request encounters.

### Test 3: Lose the response after the effect succeeds

1. Keep permissions and capacity sufficient. Let the fake provider accept one refund and durably record its operation identity.
2. Drop the response before the agent records success, then terminate the worker.
3. Restore the earlier checkpoint and redeliver the task with the same business operation ID and arguments.
4. Let the integration perform its documented outcome-recovery procedure.

**Pass:** the sink still contains exactly one accepted refund, the durable application record obtains its original receipt, and known usage is reconciled without duplicate settlement. A second HTTP request can be legitimate if the provider deduplicates it; count accepted effects separately from transport attempts.

Also test a sink that cannot return a reliable outcome and no longer guarantees deduplication. The expected result is an unresolved operation held for reconciliation, with no blind replacement refund. Successful state restoration is not a reason to discard that uncertainty.

## Where Cycles belongs in the resumption path

Cycles supplies shared budget admission and usage settlement for instrumented operations. For Test 2, a new live [reservation](/glossary#reservation) that cannot fit the remaining allocation returns HTTP `409` with `BUDGET_EXCEEDED`. A frozen governing ledger instead produces `BUDGET_FROZEN`. A successful dry-run or preflight decision does not hold capacity for later execution.

The application must bind trusted scope, require successful live admission before dispatch, and preserve operation and request identities through recovery. Keep the ledger outside the checkpoint restore. If the previous attempt already consumed resources, reconcile that usage rather than releasing it as though no work happened. A saved reservation ID or an idempotently replayed success must not be treated as a fresh authorization check; reconcile the original reservation's lifecycle before deciding what new admission is needed.

Budget admission remains separate from business permission. Cycles does not independently validate a payment recipient, revoke a provider credential, or deduplicate the provider's refund. Its reserve-commit lifecycle also does not make an external side effect atomic with a permission change. Bound the possible usage of new work and reserve enough to cover it; settlement policy cannot undo an already completed action.

## Make resumption an operational contract

Document which state is restored, which authority is re-evaluated, how ambiguous operations are recovered, and which evidence proves the outcome. Retest after changes to checkpoints, worker identities, credentials, dispatch routes, or queue handling.

For the opening scenario, an acceptable result is specific: the restored worker is blocked from creating a new refund, the shared ledger retains the other worker's consumption, and the earlier refund is reconciled through its original operation record. The agent can continue useful work within the permissions that remain.

## Further reading

Use [budget allocation and management](/how-to/budget-allocation-and-management-in-cycles) to inspect the ledger boundary. When one action consumes both money and risk capacity, the [two-budget admission walkthrough](/blog/ai-agent-action-cost-and-risk-budgets) explains the additional ordering and cleanup requirements.

Product documentation and announcements were checked on November 14, 2026. Verify availability and behavior for the versions deployed in your environment.
