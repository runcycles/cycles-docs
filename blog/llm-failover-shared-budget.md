---
title: "LLM Failover Needs a Shared Budget"
date: 2026-10-01
author: Albert Mavashev
tags: [costs, budgets, agents, cost-control, production, runtime-authority]
description: "LLM failover can spend twice on one task. Learn how shared budgets, per-attempt reservations, and usage reconciliation keep provider fallback costs accountable."
blog: true
sidebar: false
featured: false
head:
  - - meta
    - name: keywords
      content: LLM failover, LLM fallback cost, shared AI agent budget, provider retries, usage reconciliation, reserve commit, Cycles
---

# LLM Failover Needs a Shared Budget

A support agent has ten cents left for a task. Its primary model fails after consuming three cents. The fallback needs an eight-cent [reservation](/glossary#reservation). The fallback works in isolation, but the task can no longer afford to start it.

This is an illustrative workload, with fixed synthetic costs. It captures a production design problem: a fallback policy chooses another model, while a budget policy decides whether another attempt may run. Both decisions belong in the execution path.

Every independently dispatched provider attempt needs admission against the same task budget. A provider failure can lead to another attempt; a budget refusal needs its own handling. A timeout also needs usage reconciliation, because a missing response is not evidence of zero cost.

<!-- more -->

## Where LLM fallback costs accumulate

Fallback tools already solve useful reliability problems. [LiteLLM supports retries followed by ordered model-group fallbacks](https://docs.litellm.ai/docs/proxy/reliability). [LangChain's Model Fallback middleware](https://docs.langchain.com/oss/python/langchain/middleware/built-in#model-fallback) switches to alternative models when a model call fails. Those mechanisms help a task finish when one route is unavailable.

The accounting boundary depends on who dispatches and bills the work. [OpenRouter documents pricing based on the model ultimately used](https://openrouter.ai/docs/guides/routing/model-fallbacks#pricing). Do not infer multiple charges merely because a managed service tried several routes internally. Check the service's billing contract and returned usage.

This post addresses application-managed attempts with independently reportable usage. The application may receive billable usage from a partial response, then dispatch a second request elsewhere. It needs to preserve both attempts in the task's accounting. Provider errors do not all imply charges, and they do not all prove the absence of charges.

An initial estimate also does not automatically transfer to a fallback. Different models, output limits, cache behavior, and context tiers can change the amount needed. Recompute it from the actual fallback request. The [cost estimation cheat sheet](/how-to/cost-estimation-cheat-sheet) covers conversions; the [prompt caching budget guide](/blog/prompt-caching-ai-agent-budgets) explains why an assumed cache hit can understate [exposure](/glossary#exposure).

## One task budget, separate attempt reservations

Use a stable budget scope for the task and a separate reservation identity for each provider execution. In this drill, a unique `workflow` subject identifies one task, and an explicit budget is provisioned at `tenant:<tenant>/workflow:<workflow>`. All attempts use that same subject. A run ID stored only in metadata would not create this boundary.

The [hierarchy and budget patterns guide](/how-to/common-budget-patterns) describes how to choose scopes. Parent budgets still matter: a task can have room while its [tenant](/glossary#tenant) does not.

Keep transport replay separate from a new provider execution:

| Operation | Identity and accounting |
|---|---|
| Replay a reservation request after a transport error | Preserve that request's [idempotency key](/glossary#idempotency-key) and payload; do not dispatch until admission is resolved. |
| Dispatch another provider attempt | Give it a new attempt identity and reservation, under the same task scope. |
| Replay settlement after a lost acknowledgement | Preserve the commit key and actual amount; do not repeat the provider call. |

This is the distinction behind [retry storms and idempotency](/blog/retry-storms-and-idempotency-in-agent-budget-systems). Budget API idempotency prevents duplicate ledger mutations within the protocol's retention rules. It does not make a separate provider API call idempotent.

The admission gate must surround each independently dispatched attempt. If a gateway performs hidden retries inside one instrumented call, either integrate at its dispatch boundary or size and reconcile the outer reservation according to that service's documented billing behavior. Turning on a fallback list does not establish where accounting happens.

## Account for failed and uncertain attempts

Before choosing another route, classify the preceding attempt using usage evidence:

| Evidence | Ledger action | What happens next |
|---|---|---|
| Confirmed no usage | Release the reservation. | A new attempt can request its own reservation. |
| Known billable usage, even though the task failed | Commit that actual amount. | Request admission for the next attempt against the reduced balance. |
| Usage unknown, such as a timeout after dispatch | Keep the unresolved reservation while its lease remains valid, and record the uncertainty. | Another attempt must fit alongside the hold; production policy may instead stop pending reconciliation. |

A lease is temporary. Expiry restores reserved capacity; it does not prove the provider did no work or cancel an external invoice. A production system needs durable attempt records, bounded deadlines, and a reconciliation path when usage cannot be obtained before expiry. It may need to stop further execution until uncertainty is resolved. The [settlement recovery documentation](/protocol/sdk-settlement-recovery-and-durability) explains another boundary: retrying a known commit cannot recover usage that was never received.

Likewise, a conservative estimate needs enforceable request limits and every relevant billable category. A percentage buffer alone cannot guarantee the provider's final charge. The drill uses `REJECT` so an actual amount above the reservation is refused at commit; that refusal cannot undo provider work already performed.

## Run the shared-budget failover drill

The <a href="/examples/llm-failover-budget-drill.py" download>downloadable Python drill</a> calls a real Cycles runtime and Admin API, but uses local provider fixtures. It makes no LLM API calls and uses no current model prices. Its provider-call counters let you distinguish a blocked execution from an execution whose result was merely discarded.

Use a disposable test tenant. Each invocation creates three new workflow budgets of $0.10 and commits $0.16 in total. Give the tenant **at least $0.20 of available capacity** with no competing traffic or caps. Peak combined spend and reservations reaches $0.18, so a tenant allocation of exactly $0.16 is insufficient. Repeated invocations consume additional tenant capacity.

Install Python 3.10 or later and the SDK version used for this drill:

```bash
python -m venv .venv
# Activate .venv using your shell's activation command.
python -m pip install runcycles==0.5.3
```

Set these environment variables using your own test credentials:

| Variable | Purpose |
|---|---|
| `CYCLES_BASE_URL` | Runtime URL, for example `http://localhost:7878`. |
| `CYCLES_ADMIN_URL` | Admin API URL, for example `http://localhost:7979`. |
| `CYCLES_TENANT` | ID of the disposable tenant with a funded tenant budget. |
| `CYCLES_API_KEY` | Tenant key with `reservations:create`, `reservations:commit`, `reservations:release`, and `balances:read`. |
| `CYCLES_BUDGET_API_KEY` | Tenant key with `budgets:write`, used to create the workflow budgets. |

Download the linked script, then run:

```bash
python llm-failover-budget-drill.py
```

The [end-to-end tutorial](/quickstart/end-to-end-tutorial) covers provisioning a tenant and credentials. The script uses the low-level client so the admission and settlement requests remain visible. It has no automatic transport retries, durable journal, or lease heartbeat. An unexpected API response stops execution; inspect the printed attempt IDs before cleaning up the disposable tenant. It is a short, single-process exercise with 60-second reservation leases, not a production failover adapter.

### Case 1: confirmed unused primary

The primary reserves $0.04 and reports a failure with confirmed zero usage. The script releases the hold. The backup reserves $0.08, runs once, and commits $0.06. The task finishes with $0.06 spent and $0.04 remaining.

### Case 2: failed primary with known usage

The primary reserves $0.04, fails, and reports $0.03 of usage. Committing that amount leaves $0.07. The backup's $0.08 reservation returns HTTP `409` with `BUDGET_EXCEEDED` before its provider fixture runs.

The chain stops. Both the backup and the third provider have zero calls. This is an explicit policy choice: the sample does not reinterpret budget refusal as provider failure and continue searching. An application can deliberately select a cheaper, acceptable route under a [degradation policy](/how-to/how-to-think-about-degradation-paths-in-cycles-deny-downgrade-disable-or-defer), but that route still needs admission.

For a live reservation, insufficient budget is an error response. Do not write this path as a successful reservation response with `decision: DENY`. Accepted live reservations use `ALLOW` or `ALLOW_WITH_CAPS`. This fixture rejects caps before dispatch because it has no adapter to enforce them.

### Case 3: timeout, then a late usage receipt

The primary reserves $0.04 and returns an unknown-usage failure. The hold stays in place. A smaller backup reserves $0.05 and commits $0.04. At that point the task has $0.04 spent, $0.04 reserved, and $0.02 remaining.

The fixture then supplies the primary's late $0.03 receipt while its lease is still live. Committing it leaves $0.07 spent and $0.03 remaining. The script repeats that identical commit to verify that settlement replay does not double-charge or dispatch either provider again. A real application must obtain authoritative usage evidence; it cannot manufacture a receipt from its original estimate.

The final verified results are:

| Scenario | Calls per provider | Final spent | Final reserved | Final remaining |
|---|---|---|---|---|
| `unused` | `[1, 1]` | $0.06 | $0.00 | $0.04 |
| `blocked` | `[1, 0, 0]` | $0.03 | $0.00 | $0.07 |
| `unknown` | `[1, 1]` | $0.07 | $0.00 | $0.03 |

These are assertions against the workflow ledgers and fixture call counts. They validate the application's dispatch boundary, rather than provider availability or real-world billing behavior.

## Put the budget boundary around provider dispatch

A useful failover policy answers three questions together: which route is acceptable, what happened to the previous attempt's usage, and whether the next attempt fits. Keeping those decisions together makes a timeout, a provider error, and a budget refusal distinguishable in both code and operations.

Start with one task scope and explicit per-attempt accounting. Then test the failure that matters most: the fallback is healthy, but the task cannot afford it. The expected result is a recorded refusal and zero calls to that provider.

## Resources

- <a href="/examples/llm-failover-budget-drill.py" download>Run the failover drill</a> against a disposable Cycles tenant.
- [LiteLLM reliability documentation](https://docs.litellm.ai/docs/proxy/reliability) describes retry and fallback configuration.
- [OpenRouter fallback pricing](https://openrouter.ai/docs/guides/routing/model-fallbacks#pricing) explains its managed-route billing boundary.
