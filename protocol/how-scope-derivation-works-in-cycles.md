---
title: "How Scope Derivation Works in Cycles"
description: "Learn how the Cycles server derives hierarchical budget scopes from subject fields to enforce limits at multiple levels."
---

# How Scope Derivation Works in Cycles

Budget enforcement in Cycles is hierarchical.

A single action does not just charge one counter. It may need to satisfy limits at multiple levels — tenant, workspace, app, workflow, agent, toolset — all at once.

That is what makes Cycles different from flat usage counters.

But how does the server know which budget scopes to check and charge?

That is scope derivation.

## What scope derivation is

Scope derivation is the process by which the server transforms a Subject (a bag of dimension fields) into an ordered set of canonical scope identifiers.

Derivation happens wherever a Subject is submitted: reserve (`POST /v1/reservations`), decide (`POST /v1/decide`), and event (`POST /v1/events`). When one of those requests is processed, the server derives every scope that needs to be affected. Commit and release do not take a Subject — they operate on the scopes already derived at reserve time.

For example, given a Subject with:

- tenant: `acme`
- app: `support-bot`
- workflow: `refund-assistant`

The server derives these scopes (in canonical order):

1. `tenant:acme`
2. `tenant:acme/app:support-bot`
3. `tenant:acme/app:support-bot/workflow:refund-assistant`

Only explicitly provided levels are included — `workspace` is not present in the subject, so it is skipped. Each of these scopes is a separate budget boundary. A reservation is enforced at every derived scope that has a budget defined — at least one scope must have a budget.

## The canonical hierarchy

The Cycles protocol defines a fixed ordering for Subject fields:

```
tenant → workspace → app → workflow → agent → toolset
```

This ordering is normative. The server always processes fields in this order, and `affected_scopes` in responses are always returned in this canonical order.

## Gap-skipping

Not every Subject includes all six fields. When a field is missing from the hierarchy, the server skips it — only explicitly provided levels appear in the scope path.

For example, given:

- tenant: `acme`
- agent: `summarizer-v2`

The derived scope path is:

```
tenant:acme/agent:summarizer-v2
```

And the derived scopes are:

1. `tenant:acme`
2. `tenant:acme/agent:summarizer-v2`

Intermediate levels (`workspace`, `app`, `workflow`) are not present in the subject and are not filled with "default". This means operators only need to create budgets at levels they actually use, rather than at every intermediate level in the hierarchy.

Scopes without budgets are skipped during enforcement — at least one derived scope must have a budget defined.

## Field value charset

Standard-field values (tenant, workspace, app, workflow, agent, toolset) SHOULD match `^[a-zA-Z0-9_.-]+$` (normative as of the 2026-07-03 spec revision).

Canonical scope identifiers and scope paths use `:` and `/` as structural delimiters, so delimiter, whitespace, and control characters have no stable canonical encoding.

Servers MAY reject out-of-pattern values with `400 INVALID_REQUEST` — the reference implementation does. Portable clients SHOULD restrict themselves to the pattern above and MUST NOT rely on out-of-pattern values being accepted.

## Why hierarchical scopes matter

Hierarchical scopes enable layered budget governance.

### Tenant-level protection

The tenant scope ensures that all actions under a tenant count against the tenant's total budget.

No matter which app, workflow, or agent is running, the tenant boundary is always checked.

### App-level isolation

Different applications under the same tenant can have different budgets.

A support bot and a research agent can each have their own budget envelope, preventing one from consuming the other's allocation.

### Workflow-level control

Within an app, different workflows can have different cost profiles.

A refund workflow may justify more budget than a simple FAQ response.

### Agent-level boundaries

Within a workflow, individual agents can be bounded separately.

A planning agent and an execution agent can each have their own limits.

### Toolset-level restrictions

Within an agent, different toolsets can be governed independently.

Web search tools may have a different budget than database query tools.

## Atomic reservation across scopes

When a reservation is created, budget is reserved atomically across all derived scopes.

If any scope has insufficient budget, the reservation fails entirely. There is no partial reservation.

This prevents situations where a reservation succeeds at the local level but violates a parent boundary.

For example, if a workflow has budget remaining but the tenant is exhausted, the reservation is denied at the tenant scope.

## affected_scopes in responses

Reservation and decision responses include an `affected_scopes` field listing all scopes that were charged (or would be charged), in canonical order.

Event responses do not include `affected_scopes` — for `POST /v1/events`, read the charged scopes from the `scope_path` on each entry in the response's `balances` array instead.

Where present, `affected_scopes` tells the client exactly which budget boundaries were affected, which is useful for:

- debugging denial reasons
- understanding which scope is the bottleneck
- monitoring budget pressure across the hierarchy

## scope_path

The `scope_path` field in responses is the full canonical path for the reservation.

For example: `tenant:acme/app:support-bot/workflow:refund-assistant`

This uniquely identifies the leaf scope in the hierarchy.

## Custom dimensions

The Subject also supports a `dimensions` field for custom key-value pairs.

For example:

```json
{
  "tenant": "acme",
  "app": "support-bot",
  "dimensions": {
    "cost_center": "engineering",
    "run": "run-12345"
  }
}
```

In v0, servers MAY ignore dimensions for budgeting decisions entirely (the reference server does — scopes derive only from the six standard fields), but they must accept and round-trip the data.

Dimensions have hard limits: at most 16 keys, and each value at most 256 characters. Keys SHOULD be lowercase and match `^[a-z0-9_.-]+$` for stable canonicalization; values are opaque strings.

Dimensions never replace the standard fields. A Subject containing only `dimensions` — with no tenant, workspace, app, workflow, agent, or toolset — is invalid, and the server MUST return `400 INVALID_REQUEST`.

Dimensions are not budget-scope fields — they serve enterprise taxonomies, attribution/reporting, and policy uses (the v0.1.26 action-quota preview keys its `per_run` window off `dimensions.run_id`). To give each run an enforceable budget, encode the run id in a Subject field (e.g. `workflow: "run-{id}"`, deriving the scope `workflow:run-{id}`) — see [modeling tenant, workflow, and run budgets](/how-to/how-to-model-tenant-workflow-and-run-budgets-in-cycles).

## Scope derivation and balances

When querying balances (`GET /v1/balances`), the same scope hierarchy applies. At least one standard subject filter (tenant, workspace, app, workflow, agent, toolset) must be provided.

Returning child scopes is opt-in: pass `include_children=true` (the default is `false`). Be aware that `include_children` MAY be ignored by v0 implementations, so do not depend on child rows being present.

This gives operators visibility into budget state at any level of the hierarchy.

## Practical implications

### Budget allocation flows top-down

Tenant budgets constrain everything beneath them. If the tenant is exhausted, no child scope can reserve budget, even if the child has its own allocation.

### Pressure signals flow bottom-up

When a workflow or agent scope runs low, that pressure is visible at higher levels through balance queries and denial signals.

### Scope design is a policy decision

The scopes you populate on each Subject determine which budget boundaries are checked.

If you only provide tenant and workflow, the server derives scopes for tenant and workflow — intermediate levels are skipped. Agent and toolset scopes are not checked.

This means scope design is part of policy design. More scopes mean finer-grained control but more configuration.

## Summary

Scope derivation transforms Subject fields into a hierarchical set of budget boundaries:

- The canonical order is: tenant → workspace → app → workflow → agent → toolset
- Missing fields are skipped (not filled with "default")
- Reservations are atomic across all derived scopes
- Balances, affected_scopes, and scope_path all follow the same hierarchy
- Custom dimensions extend the model for additional taxonomies

Understanding scope derivation is essential for designing effective budget policy in Cycles.

## Next steps

- [Tenants, Scopes, and Budgets](/how-to/understanding-tenants-scopes-and-budgets-in-cycles) — how the three building blocks fit together
- [Budget Allocation and Management](/how-to/budget-allocation-and-management-in-cycles) — create budgets at each scope level
- [Common Budget Patterns](/how-to/common-budget-patterns) — practical scope hierarchy recipes
- [Tenant, Workflow, and Run Budgets](/how-to/how-to-model-tenant-workflow-and-run-budgets-in-cycles) — multi-level policy design
- [Scope Misconfiguration and Budget Leaks](/incidents/scope-misconfiguration-and-budget-leaks) — what can go wrong with scope design
