---
title: "Commit Overage Policies in Cycles"
description: "How Cycles handles commits that exceed the reserved amount using three overage policies: REJECT, ALLOW_IF_AVAILABLE, and ALLOW_WITH_OVERDRAFT."
---

# Commit Overage Policies in Cycles: REJECT, ALLOW_IF_AVAILABLE, and ALLOW_WITH_OVERDRAFT

::: warning Version note
In v0.1.24, the hardcoded fallback default changed from `REJECT` to `ALLOW_IF_AVAILABLE`. If you are running a server version prior to v0.1.24 and do not set an explicit overage policy on your requests or tenant configuration, the server defaults to `REJECT`. See the [changelog](/changelog) for details.
:::

When actual usage differs from the reserved estimate, the system needs a policy for what to do.

If actual is less than reserved, the unused remainder is released automatically. That is straightforward.

But if actual is more than reserved, the system has a decision to make.

That is what commit overage policies control.

## Quick reference: which policy to use

| Policy | Best for | Commits rejected? | Creates debt? | Tradeoff |
|---|---|---|---|---|
| **REJECT** | Well-estimated actions where hard budget stops are acceptable | Yes, if actual > reserved | No | Strictest enforcement, but rejected commits leave unaccounted gaps |
| **ALLOW_IF_AVAILABLE** (default) | Most workloads — variable-cost actions, LLM calls, tool invocations | Never | No | Always records usage, caps charge to available budget, blocks future reservations when exhausted |
| **ALLOW_WITH_OVERDRAFT** | Must-record actions — external imports, side-effecting operations, SLA-critical work | Only if debt would exceed overdraft limit | Yes | Most accurate ledger, requires operator debt reconciliation |

**Common patterns:**
- **LLM completions with unpredictable token counts** → ALLOW_IF_AVAILABLE
- **Tool calls with known fixed costs** → REJECT (with buffer) or ALLOW_IF_AVAILABLE
- **External API usage imports** → ALLOW_WITH_OVERDRAFT (work already happened)
- **Multi-tenant platform default** → ALLOW_IF_AVAILABLE (safe default, no debt)
- **Strict per-agent budget caps** → REJECT (hard stop when budget is gone)

For a scenario-driven guide, see [Choosing the Right Overage Policy](/how-to/choosing-the-right-overage-policy).

## The three policies

Cycles defines three overage policies, set at reservation time (or on events):

- **REJECT** — refuse the commit if actual exceeds reserved
- **ALLOW_IF_AVAILABLE** — allow if remaining budget can cover the difference
- **ALLOW_WITH_OVERDRAFT** — allow and create debt if necessary

Each policy makes a different tradeoff between ledger accuracy and budget strictness.

### Resolution order

When a reservation or event is created, the server resolves the overage policy in this order:

1. **Request-level** `overage_policy` — if the client specifies one, it is used
2. **Tenant default** `default_commit_overage_policy` — if the tenant has one configured via the Admin API
3. **Hardcoded fallback** — `ALLOW_IF_AVAILABLE`

This means tenant administrators can set an org-wide default (e.g. `REJECT`) and individual requests can still override it.

### Step 0: the commit must be valid

Overage policies only come into play after the commit passes basic validation. Before any policy branch is evaluated, the server checks that:

1. The reservation exists and is owned by the effective tenant — otherwise `404 NOT_FOUND` or `403 FORBIDDEN`
2. The reservation is still committable — not already `COMMITTED` or `RELEASED` (`409 RESERVATION_FINALIZED`) and not past `expires_at_ms + grace_period_ms` (`410 RESERVATION_EXPIRED`)
3. The `actual.unit` matches the reservation's `estimate.unit` — otherwise `400 UNIT_MISMATCH`

A commit that fails any of these checks is rejected regardless of overage policy. Even ALLOW_IF_AVAILABLE, which never rejects a commit on budget grounds, does not accept an invalid commit.

## REJECT

REJECT is the strictest overage policy. Tenant administrators can set it as the default for all reservations and events in their tenant by setting `default_commit_overage_policy` via the Admin API.

REJECT is the simplest and strictest policy.

If `actual > reserved`, the commit is rejected with `409 BUDGET_EXCEEDED`.

### When REJECT is right

- the system can predict costs well enough to reserve sufficient room
- hard budget enforcement is more important than ledger completeness
- a 10–20% buffer on estimates is acceptable
- rejected commits will be retried with a new reservation

### The risk with REJECT

If the action already happened — the model call returned, the tool executed — rejecting the commit creates an unaccounted gap.

The work occurred but is not recorded in the budget ledger. Budget appears more available than it really is.

This is why the spec recommends adding a 10–20% buffer to estimates when using REJECT.

### Practical guidance

- Use REJECT when estimates are reliable
- Add estimation buffers to avoid frequent rejections
- Monitor how often commits are rejected — high rejection rates signal estimation problems

## ALLOW_IF_AVAILABLE (default)

ALLOW_IF_AVAILABLE is the default overage policy when neither the request nor the tenant configuration specifies one. It ensures commits always succeed — the action already happened, so the ledger must reflect it as accurately as possible.

The server checks whether remaining budget across all affected scopes can cover the full delta between actual and reserved.

If yes: the commit succeeds and the full delta is charged atomically.

If no: the commit still succeeds, but the delta is **capped** to the minimum available remaining across all affected scopes (floor 0). The charge is `estimate + capped_delta`. Scopes where the full delta could not be covered are marked `is_over_limit=true`, blocking future reservations until reconciled.

### When ALLOW_IF_AVAILABLE is right

- the system wants to allow modest overages when budget permits
- strict estimation is difficult
- the system should never create debt
- budget accuracy matters but some flexibility is acceptable
- commits should never be rejected after the action has happened

### How it works

**Full delta available:** Suppose a reservation held 100 units and actual usage was 130 units. The delta is 30 units. The server checks whether all affected scopes have at least 30 units of remaining budget. If yes: commit succeeds, 130 is charged.

**Capped delta:** Suppose budget remaining is 200, estimate is 200, actual is 201. The delta is 1 unit. After reservation, remaining is 0. The server caps the delta to 0 (nothing available). Charge is `200 + 0 = 200`. The scope is marked `is_over_limit=true`, blocking future reservations. Budget after: remaining=0, spent includes 200, no debt.

### The key properties

ALLOW_IF_AVAILABLE never creates debt. It never rejects a commit. It charges the maximum amount possible without creating debt, and blocks future reservations when the full overage could not be covered.

This makes it a safe default — work is always accounted for, and the system self-limits when budget is exhausted.

## ALLOW_WITH_OVERDRAFT

ALLOW_WITH_OVERDRAFT allows the commit to succeed even when remaining budget cannot cover the delta.

Instead, the overage is recorded as debt against the scope.

### When ALLOW_WITH_OVERDRAFT is right

- the action has already happened and the ledger must reflect it
- concurrent execution makes strict pre-commit enforcement impractical
- accurate accounting is more important than strict budget boundaries
- the team has processes to reconcile debt afterward

### How it works

Suppose a reservation held 100 units and actual usage was 150 units.

Remaining budget on the scope is only 20 units.

With ALLOW_WITH_OVERDRAFT:

1. The server checks: `(current_debt + delta) <= overdraft_limit`
2. If yes: the commit succeeds, the delta becomes debt, remaining goes negative
3. If no: the commit is rejected with `409 OVERDRAFT_LIMIT_EXCEEDED`

### The overdraft limit

The `overdraft_limit` is set per scope (outside the v0 protocol — typically via admin/operator configuration).

It defines the maximum debt a scope can carry.

If no overdraft_limit is set (or it is zero), ALLOW_WITH_OVERDRAFT behaves like ALLOW_IF_AVAILABLE.

## How to choose

A simple decision framework:

### Use REJECT when:
- estimates are reliable
- you prefer hard stops over partial accounting
- you can add estimation buffers
- you have retry logic for rejected commits

### Use ALLOW_IF_AVAILABLE when:
- estimates sometimes miss
- you want flexibility without debt
- remaining budget is the natural boundary
- you do not want to set up overdraft monitoring

### Use ALLOW_WITH_OVERDRAFT when:
- the work has already happened and must be accounted for
- concurrent execution makes exact pre-commitment impractical
- ledger accuracy is a hard requirement
- you have operator processes for debt reconciliation

## Overage policies on events

Events (`POST /v1/events`) also support all three overage policies with the same semantics.

Since events do not have a preceding reservation, the "overage" is simply whether the event amount exceeds available budget for the scope.

- REJECT: event is rejected if budget is insufficient
- ALLOW_IF_AVAILABLE: event is applied if budget can cover it; if the amount exceeds remaining budget, the charge is capped and the response includes a `charged` field showing the effective amount
- ALLOW_WITH_OVERDRAFT: event is applied with debt if necessary

## Overage policies and concurrency

REJECT and ALLOW_IF_AVAILABLE are atomic per commit.

ALLOW_WITH_OVERDRAFT is also atomic per individual commit, but the overdraft limit check is not atomic across concurrent commits. Multiple concurrent commits may each individually pass the check but collectively push debt past the limit.

This is by design. All commits represent work that already happened. The scope enters over-limit state and blocks future reservations until debt is repaid.

## A practical rollout

A safe rollout path for overage policies:

### Phase 1: Start with REJECT

Use REJECT with 15–20% estimation buffers. Monitor commit rejection rates.

### Phase 2: Move to ALLOW_IF_AVAILABLE for high-variance actions

For actions where estimation is difficult, switch to ALLOW_IF_AVAILABLE. This reduces rejected commits while maintaining budget boundaries.

### Phase 3: Use ALLOW_WITH_OVERDRAFT for must-record actions

For actions where the work has already happened (external API calls, side-effecting operations), use ALLOW_WITH_OVERDRAFT. Set up overdraft monitoring and debt reconciliation processes.

## Summary

The three commit overage policies give teams control over the tradeoff between budget strictness and ledger accuracy:

- **REJECT** — strictest, may create unaccounted gaps
- **ALLOW_IF_AVAILABLE** (default) — flexible, no debt, always commits, caps overage to available
- **ALLOW_WITH_OVERDRAFT** — most accurate, creates debt, requires reconciliation

Most systems benefit from using different policies for different action classes: REJECT for well-estimated actions, ALLOW_IF_AVAILABLE for variable ones, and ALLOW_WITH_OVERDRAFT for must-record side effects.

## Next steps

To explore the Cycles stack:

- Read the [Cycles Protocol](https://github.com/runcycles/cycles-protocol)
- Run the [Cycles Server](https://github.com/runcycles/cycles-server)
- Manage budgets with [Cycles Admin](https://github.com/runcycles/cycles-server-admin)
- Integrate with Python using the [Python Client](/quickstart/getting-started-with-the-python-client)
- Integrate with TypeScript using the [TypeScript Client](/quickstart/getting-started-with-the-typescript-client)
- Integrate with Spring Boot or Spring AI using the [Spring Boot starter](https://github.com/runcycles/cycles-spring-boot-starter) or the [Spring AI starter](https://github.com/runcycles/cycles-spring-ai-starter)
