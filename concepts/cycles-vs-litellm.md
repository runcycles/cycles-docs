---
title: "Cycles vs LiteLLM: Application and Gateway Budgets"
description: "Compare LiteLLM budget reservations and agent session limits with Cycles accounting across application scopes for protected model calls, paid APIs, and tools."
---

# Cycles vs LiteLLM: Application and Gateway Budgets

LiteLLM routes model calls across providers with fallback, enforces gateway budgets, and documents budget reservations enabled by default. It also provides agent iteration and session-spend limits. Advance reservation alone is therefore not a Cycles distinction.

The useful comparison is the accounting boundary. Cycles exposes a caller-facing reservation lifecycle for operations the application instruments, so model calls, paid APIs, and other tool operations can consume shared application budgets. LiteLLM may already cover your workload when its gateway paths, scopes, and enforcement semantics match your requirements.

## What each does

| | LiteLLM | Cycles |
|---|---|---|
| **Primary role** | Gateway routing, fallback, budget enforcement, and cost tracking | Budget accounting for instrumented application operations |
| **Coverage** | Routed model calls; agent controls and MCP tool-cost tracking | Any operation the host protects with the lifecycle, including calls outside a gateway |
| **Budget scopes** | Keys, teams, users, customers, and other gateway dimensions; agent/session controls | Tenant → workspace → app → workflow → agent → toolset; a workflow value can identify a run |
| **Reservations** | Gateway estimates, reserves before supported provider calls, and reconciles actual cost | Caller submits an estimate, reserves before protected work, and commits actual usage |
| **Concurrency** | Reservations account for in-flight estimates; coverage and failure behavior depend on route and configuration | Atomic holds across matching provisioned ledgers; actual overages follow the configured policy |
| **Rate and iteration limits** | RPM/TPM and agent session iteration limits | Cumulative budgets; not an RPM/TPM limiter or automatic iteration counter |
| **Tool governance** | [MCP permissions](https://docs.litellm.ai/docs/mcp_control) apply to routed tools | Caller-assigned [RISK_POINTS](/glossary#risk-points) budgets; host authorizes tools and arguments |
| **Integration** | Route supported traffic through the gateway and configure controls | Instrument each protected operation and submit its scopes, estimate, and settlement |

## LiteLLM budget reservations and agent budgets

LiteLLM's [budget reservation documentation](https://docs.litellm.ai/docs/proxy/users#budget-reservation) describes this sequence:

1. Estimate request cost from the request body and model pricing.
2. Reserve capacity against the applicable budget.
3. Reject before the provider call if the reservation would exceed the budget.
4. Replace the reservation with actual cost after the response is priced.

Reservations are enabled by default. Routes without token pricing fall back to recorded-spend enforcement, and batch submission cannot reserve the full job cost. Configured budgets require a database; the separate `fail_closed_budget_enforcement` setting addresses degraded or stale budget state. Check those deployment details when evaluating a hard ceiling.

LiteLLM also documents [`max_iterations` and `max_budget_per_session`](https://docs.litellm.ai/docs/a2a_iteration_budgets). These require session attribution; the agent setup uses `require_trace_id_on_calls_by_agent`. The session-budget guide describes checking accumulated spend before calls and adding cost after successful LLM calls, with counters expiring after one hour by default. Do not assume the session limiter has the same reservation semantics as every gateway budget.

Tool costs are also in scope for LiteLLM: [MCP cost tracking](https://docs.litellm.ai/docs/mcp_cost) supports fixed tool/server prices and custom post-call cost hooks. That establishes tool accounting, not an identical pre-execution reservation guarantee for every MCP operation. Evaluate the actual route and configured controls.

## Where Cycles adds an application budget boundary

### Shared accounting across protected services

A workflow might call a model through LiteLLM, query a paid data API directly, and dispatch a metered background job. Cycles can reserve each operation against the same workflow and tenant ledgers, even when those operations use different transports or never enter the gateway.

This coverage is explicit. The host must protect every relevant dispatch, supply an estimate in a consistent unit, and settle actual usage. Cycles does not automatically discover tool calls, provider prices, or work that bypasses the integration. The [cost-estimation guide](/how-to/how-to-estimate-exposure-before-execution-practical-reservation-strategies-for-cycles) explains this responsibility.

### Application scope hierarchy

Cycles derives scopes in the order tenant → workspace → app → workflow → agent → toolset. Only submitted levels are included, and only provisioned budgets participate. A child operation can consume both a shared tenant or workflow budget and a narrower agent budget. At least one derived scope must have a budget.

LiteLLM already provides multiple budget identities and agent/session controls. The evaluation question is whether those scopes express the application's required shared ceilings. Cycles' hierarchy does not automatically discover delegation, transfer parent allocations, or enforce child permissions; the orchestrator supplies the scopes and authorizes the work.

### Explicit lifecycle and overage handling

Cycles exposes reserve, commit, release, and reservation extension to the caller. The host reserves before dispatch, commits after work, and releases a hold when work is canceled before any usage occurs. Long-running work can [extend its reservation lease](/protocol/reservation-ttl-grace-period-and-extend-in-cycles).

Atomic reservations protect estimated capacity. They do not guarantee that actual external charges stay below an estimate. Under the [authoritative protocol](/cycles-protocol-v0.yaml), `REJECT` rejects an over-estimate commit, which can leave an accounting gap for work already performed. The default `ALLOW_IF_AVAILABLE` charges the delta up to available capacity and marks an uncovered overage as over-limit, without creating debt. `ALLOW_WITH_OVERDRAFT` can record debt subject to its specified limits. Choose and test the policy explicitly; debt is not the outcome of every overage.

### Caller-assigned exposure budgets

The host can assign [RISK_POINTS to tool attempts](/how-to/assigning-risk-points-to-agent-tools) and meter their cumulative exposure separately from money. This can apply to protected operations outside the gateway. It does not establish whether a tool or its arguments are authorized; that remains application policy.

## Using LiteLLM and Cycles together

For a protected model call, both layers can enforce a budget:

```text
Application authorizes the operation
  → Cycles: reserve estimate against application scopes
  → LiteLLM: apply gateway policy, reserve supported cost, and route
  → Provider: execute if admitted
  → LiteLLM: reconcile its reservation with actual cost
  → Application: commit the operation's actual usage to Cycles
```

For a direct paid API or background job, the application uses the same Cycles lifecycle around that service's dispatch. If LiteLLM rejects before execution and no usage occurred, release the Cycles hold. If work incurred cost before failing, settle that usage; a failed response does not necessarily mean zero cost.

Each ledger serves its own budget boundary. Recording one model charge in both systems does not mean the provider charged twice; do not sum those records as separate expenses. Retries and fallbacks that incur additional charges must be included in the application's estimate and settlement.

Cycles can return configured `ALLOW_WITH_CAPS` constraints, which the host can map to a cheaper LiteLLM route. Cycles does not select the model or automatically add caps when balance becomes low.

## A workload to evaluate across several services

The following is an evaluation design with synthetic prices, not a measured product benchmark or a packaged runnable demo. Use a provisioned Cycles stack from the [end-to-end tutorial](/quickstart/end-to-end-tutorial), a configured LiteLLM gateway, and deterministic service fixtures with request logs. Record exact image versions, pricing, budget settings, and commands with any published results.

Configure a shared tenant budget of $10 and a workflow budget of $1 using `USD_MICROCENTS` (100,000,000 units per dollar). Submit the same tenant/workflow on all operations and use separate agent identifiers for concurrent workers. Begin each trial with fresh ledgers and fixed costs equal to estimates:

| Operation | Service path | Estimate and actual cost |
|---|---|---|
| Model request | Through LiteLLM to a provider fixture | $0.20 |
| Paid search | Direct HTTP service fixture | $0.30 |
| Document processing | Separate metered worker fixture | $0.40 |

Reserve all three operations before permitting any to finish. Their holds total $0.90. While they remain active, attempt another $0.20 model operation: its Cycles reservation should be rejected, with no corresponding LiteLLM or provider invocation. Commit the first three operations and verify $0.90 charged at both workflow and tenant scopes, zero remaining holds, and $0.10 workflow capacity left. The tenant charge is the same consumption aggregated at an ancestor, not another $0.90 of expense.

In separate fresh trials, cancel the search before dispatch and verify its $0.30 hold becomes available; replay an identical commit with the same idempotency key and verify no duplicate debit; then set an actual cost above its estimate and inspect the configured overage policy. A replay-safe Cycles commit does not make a service dispatch idempotent: use the service's own mechanism for that.

For the LiteLLM baseline, keep native reservations enabled, configure applicable gateway and agent/session budgets, and include supported MCP accounting when routing tools through MCP. Report exactly which operations each configuration covers. A direct service outside the gateway demonstrates a coverage boundary; it does not prove LiteLLM cannot govern a version of that operation routed through its supported interfaces.

## Choosing the boundary

LiteLLM alone may cover the budget requirement when all governed operations use supported gateway paths and its scopes, session controls, and enforcement behavior fit the workload. Concurrency, multiple tenants, or multiple agents alone do not establish a need for Cycles.

Consider adding Cycles when protected operations across several services need shared application ledgers, a caller-managed lifecycle, or separately metered exposure budgets. Account for the integration work: the host must enforce the boundary, estimate usage, handle leases and failures, and settle charges. Cycles does not provide provider routing, failover, caching, or application authorization.

## Sources

LiteLLM claims checked against its [budget documentation](https://docs.litellm.ai/docs/proxy/users#budget-reservation), [agent iteration budgets](https://docs.litellm.ai/docs/a2a_iteration_budgets), and [MCP cost tracking](https://docs.litellm.ai/docs/mcp_cost) on September 4, 2026. These are documentation claims, not results from testing a pinned LiteLLM deployment. Cycles lifecycle and scope claims follow the repository's [authoritative YAML specification](/cycles-protocol-v0.yaml); verify the deployed implementation against that contract.

## Related

- [Cycles vs LLM Proxies and Observability Tools](/blog/cycles-vs-llm-proxies-and-observability-tools) — gateway, application budget, and tracing boundaries
- [What Is Runtime Authority](/blog/what-is-runtime-authority-for-ai-agents) — the enforcement model
- [How Teams Control AI Agents Today](/blog/how-teams-control-ai-agents-today-and-where-it-breaks) — matching controls to application boundaries
