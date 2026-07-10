---
title: "Tenant Lifecycle at Scale: Cascade Semantics"
date: 2026-04-23
author: Albert Mavashev
tags:
  - multi-tenant
  - governance
  - production
  - operations
  - runtime-authority
  - best-practices
description: "What happens when you close an AI-agent tenant matters more than how you close it. A walk through cascade semantics, terminal-owner guards, and the zombie-budget problem."
blog: true
sidebar: false
featured: false
head:
  - - meta
    - name: keywords
      content: multi-tenant AI agents, tenant decommissioning, tenant lifecycle, cascade semantics, zombie budgets, SaaS tenant deletion
---

# Tenant Lifecycle at Scale: Cascade Semantics

> **Part of: [Multi-Tenant AI Operations Reference](/guides/multi-tenant-operations)** — the full pillar covering scope hierarchy, per-tenant enforcement, multi-agent coordination, tenant lifecycle, and identity.

A customer cancels. The support ticket is resolved. You click "close tenant" in your admin console, the status flips from `ACTIVE` to `CLOSED`, the incident is filed. Three days later, a monitoring alert fires: that tenant's webhook subscription just delivered to a third-party endpoint that shouldn't be reachable anymore. An audit check the next week finds one of the tenant's API keys still authorizing reservations in production. By the time the alert rolls up, the post-termination spend on the closed tenant is a number nobody wants to write into a customer-refund line item.

Nothing was deleted. The problem is subtler than that: the tenant was marked closed, but every object the tenant *owned* — budgets, keys, webhook subscriptions, policies, in-flight reservations — kept operating as if nothing had changed. A tenant isn't a leaf in the data model; it's the root of a tree, and "closing" it is a statement about the whole subtree, not just the row at the top.

Multi-tenant platforms that have lived long enough to face this problem — Stripe Connect, AWS Organizations, Okta tenant deletion, Slack workspace archival — have converged on the same pattern: terminal states must *cascade*, and the cascade must be enforceable against concurrent mutations. This post is about what that pattern looks like when the owned objects are AI-agent budgets and reservations, and what Cycles ships to make it safe by default.

<!-- more -->

## The zombie-budget problem

The category name for the failure at the top of this post is a *zombie object*: a child whose parent has entered a terminal state, but which the system still treats as live. The zombie keeps authorizing operations, emitting events, drawing cost, or exposing surface area until something else notices and manually cleans it up.

In an AI-agent budget system, zombies are particularly expensive because every owned object has an independent decision surface:

| Owned object | What a zombie can still do |
|---|---|
| **API key** | Authorize reservations, commits, and admin calls against closed-tenant scopes |
| **Budget ledger** | Accept new reservations; balance queries still return values the operator assumes are stale |
| **Open reservation** | Get committed or extended even after the owning tenant is marked closed |
| **Webhook subscription** | Keep delivering events to third-party endpoints past the off-boarding date |
| **Policy / rate limiter** | Keep enforcing rules the operator thought were decommissioned |

Any combination of these carries real operational and security risk: silent post-termination spend, leftover attack surface, and audit-trail gaps that are awkward to explain after the fact.

## Two rules that close the gap

The Cycles governance-admin spec addresses this directly with a two-rule contract, formalized in the `CASCADE SEMANTICS` section of the v0.1.25 governance-admin yaml.

**Rule 1 — Close Cascade.** When a tenant transitions to `CLOSED`, the server drives every owned object to its terminal state. In the atomic presentation (Mode A, below), the spec's recommended order within the single transaction is:

1. Drain open reservations (released with reason `tenant_closed`; no overage debt recorded).
2. Close budget ledgers (final balance snapshot preserved for audit; no new reservations accepted).
3. Disable webhook subscriptions and revoke API keys (either order).
4. Flip `tenant.status` to `CLOSED` last.

Mode B (below) inverts this by design — the tenant flip commits *first*, and the children converge afterward under the Rule 2 guard. Since the runcycles reference server implements Mode B, don't build tooling that depends on this ordering; depend on the terminal states and the guard.

Each mutated object produces a dedicated record: an Event row under a reserved dotted name — `budget.closed_via_tenant_cascade`, `api_key.revoked_via_tenant_cascade`, `reservation.released_via_tenant_cascade` (ledger-level), `webhook.disabled_via_tenant_cascade` — plus an audit row written as `operation="tenant_close_cascade"` with `resource_type`/`resource_id`. The event rows all share a server-composed `correlation_id` (`tenant_close_cascade:<tenant_id>:<request_id>`) on the emitted event rows, so an auditor can reconstruct the cascade in a single events query (audit rows join via `request_id`/`trace_id`).

**Rule 2 — Terminal-Owner Mutation Guard.** Every mutating endpoint on an owned object first checks the parent tenant's status. If the tenant is `CLOSED`, the endpoint returns `409 Conflict` with `error: "TENANT_CLOSED"`, regardless of the per-object terminal state. The guard applies across the budget, reservation, policy, API key, and webhook planes. `GET` endpoints remain available — closed-tenant state is readable for post-mortems and compliance evidence.

Rule 1 is about *reaching* a consistent terminal state. Rule 2 is about *defending* that terminal state against the inevitable race with in-flight requests.

## Two implementation modes that look the same to clients

How these rules are implemented can vary. A protocol spec that only accepted one shape would be unnecessarily restrictive, so Cycles' cascade section describes two conformant modes:

**Mode A — Atomic Cascade.** All owned-object terminal transitions plus the tenant flip commit in a single transaction. Rollback on failure. Strongest guarantee and easiest to reason about, but requires a transactional store that can hold the whole cascade under one commit. Works well on SQL; harder on Redis without scripting everything into one Lua call.

**Mode B — Flip-First with Guarded Cascade.** The tenant flip to `CLOSED` commits first. Rule 2 immediately becomes enforceable on every dependent mutation, which closes the door against new activity. The cascade then proceeds across owned objects, either inline in the same request or via a reconciler. Conformant when:

- Rule 2 activates at or before the flip's durability.
- Cascade operations are idempotent (replay-safe if a reconciler retries a partial step).
- Convergence within a documented bound.
- Observable reads of non-terminal children remain consistent until the cascade reaches them.

The important property is that both modes produce the same *client-observable* outcome: once the tenant is `CLOSED`, every mutation against any owned object returns a `409` with `error: "TENANT_CLOSED"`, regardless of which per-object row flipped first. The mode is an implementation detail the spec deliberately leaves open — a transactional SQL backend can deliver Mode A cleanly, while a Redis-backed admin can opt into Mode B as long as the guard activates at or before the flip's durability.

## Where operators actually trip

Three failure modes are worth watching for — they tend to surface far more often than the zombie-budget story itself:

**Mistaking closure for suspension.** Operators hit "close tenant" when they want "suspend tenant." Closure is terminal. The spec allows `* → CLOSED` from any prior state — including direct `ACTIVE → CLOSED` — but no transitions out of `CLOSED`: `CLOSED → ACTIVE` is not valid, and neither is `CLOSED → SUSPENDED`. Once a tenant is closed, it remains read-only — recovery from `CLOSED` is not supported by design. The reversible path is `ACTIVE → SUSPENDED → ACTIVE`. This mirrors how AWS Organizations treats member-account closure: a deliberate one-way operation, not a toggle.

**Forgetting bulk-action semantics.** If a bulk endpoint — say, mass-revoke of 500 API keys across a tenant — runs while the tenant is closing, the per-row behavior matters. Cycles bulk actions return a mixed response: every row that was mutated reports success; every row that hit the terminal-owner guard lands in `failed[]` with an `error_code` of `TENANT_CLOSED`, and the rest of the batch proceeds. Operators who reach for `--exit-on-error`-style semantics are surprised when a partial bulk continues. The right default is a partial-success rollup, because the alternative — failing the whole batch on any `TENANT_CLOSED` — would mean a concurrent tenant close effectively poisons every unrelated bulk action in the stack.

**Assuming webhook disablement is reversible.** Once a webhook subscription goes to `DISABLED` via cascade, re-enabling it is blocked by Rule 2: the subscription is an owned object of a closed tenant, and the parent check rejects the mutation. Rule 2 is what makes `DISABLED` effectively terminal in the cascade flow. If you need to migrate webhook deliveries to a new tenant, the operator pattern is to provision a new subscription under a new (or still-`ACTIVE`) tenant and drain delivery there — never try to reopen the old one.

The [Multi-Tenant AI Cost Control](/blog/multi-tenant-ai-cost-control-per-tenant-budgets-quotas-isolation) post goes deeper on why per-tenant isolation at the budget layer is a prerequisite for safe cascades. If your budgets aren't tenant-scoped to start with, cascade has nothing to cascade over.

## A close, end-to-end

A close is a status transition on the tenant resource. The admin API exposes it in two shapes: a per-tenant `updateTenant` via `PATCH /v1/admin/tenants/{tenant_id}`, or a `bulkActionTenants` call to `POST /v1/admin/tenants/bulk-action` for closing many tenants in one operation. Both paths trigger the same cascade semantics.

```bash
# Close one tenant via updateTenant
curl -X PATCH \
  -H "X-Admin-API-Key: $ADMIN_KEY" \
  -H "Idempotency-Key: close-acme-corp-2026-04-23" \
  -H "Content-Type: application/json" \
  --data '{"status": "CLOSED"}' \
  "http://localhost:7979/v1/admin/tenants/acme-corp"
```

The response acknowledges the status flip. Mode B permits an implementation to return once the flip is durable while a reconciler completes the cascade in the background — but note the runcycles Redis-backed server flips first and then runs the cascade **inline, before responding**, so by the time you read the PATCH response the cascade is done. A follow-up query confirms the aftermath — either the audit trail (`operation=tenant_close_cascade`, inspecting `resource_type`/`resource_id`) or the events API (`correlation_id=tenant_close_cascade:<tenant_id>:<request_id>` for the dotted event types):

```bash
# Pull cascade audit entries tied to this close
curl -s -H "X-Admin-API-Key: $ADMIN_KEY" \
  "http://localhost:7979/v1/admin/audit/logs?tenant_id=acme-corp&operation=tenant_close_cascade" \
  | jq '.logs[] | {operation, resource_type, resource_id}'
```

You'll see one record per owned object — one `budget.closed_via_tenant_cascade` per ledger, one `api_key.revoked_via_tenant_cascade` per key, one `webhook.disabled_via_tenant_cascade` per subscription — plus one **ledger-level** `reservation.released_via_tenant_cascade` per closed budget that had `reserved > 0`, carrying the aggregate `released_amount` (not one event per reservation). The corresponding event rows all share the server-composed cascade `correlation_id`, which is how an auditor reconstructs the cascade without having to cross-join on timestamp (audit rows join via the originating `request_id`).

A subsequent attempt to mutate an owned object under the closed tenant returns the terminal-owner guard's `409`. Reservation lifecycle lives on the runtime plane — the spec's Rule 2 explicitly scopes reservation create/commit/release/extend, so the `409 TENANT_CLOSED` below is the normative contract — implemented in `cycles-server` 0.1.25.47, which added `TENANT_CLOSED` to the runtime error enum per spec revision v0.1.25.13 (on 0.1.25.46 and earlier, the runtime plane surfaces closed tenants only as `401`s from revoked keys or `BUDGET_CLOSED`):

```bash
# Mutation on a released reservation under a closed tenant
# (reachable with a not-yet-revoked tenant key in the post-flip window —
# once the cascade revokes the key, the 401 below wins first. Of the four
# guarded mutations only release also accepts an admin key on the runtime
# plane, so an admin-on-behalf-of release hits this 409 with no race.)
curl -i -X POST \
  -H "X-Cycles-API-Key: $TENANT_KEY" \
  "http://localhost:7878/v1/reservations/res-xyz/commit"
# → HTTP/1.1 409 Conflict
# → { "error": "TENANT_CLOSED", "trace_id": "..." }
```

A request that tries to authenticate with a key revoked by the cascade takes a different path — the API key check fails at the auth layer before the terminal-owner guard is ever consulted:

```bash
# Revoked key -> auth-layer rejection, not TENANT_CLOSED
curl -i -H "X-Cycles-API-Key: $REVOKED_TENANT_KEY" \
  "http://localhost:7878/v1/reservations/res-xyz/commit"
# → HTTP/1.1 401 Unauthorized (revoked-key path)
```

Both responses are closed doors, but they're closed by different enforcement stages: Rule 2 (the terminal-owner guard) catches mutation attempts on owned objects; the API-key auth layer catches the revoked-key call before the request even reaches the object it wanted to mutate.

The `trace_id` on either response is the thread back to the audit row and the original reservation. See [W3C Trace Context for AI Agent Debugging](/blog/w3c-trace-context-ai-agent-debugging) for the debug loop that follows.

## How this compares to the patterns you already know

The cascade pattern isn't novel. It's the default in well-designed multi-tenant SaaS:

| Platform | Closure model | What cascades | Reversibility |
|---|---|---|---|
| **AWS Organizations** | Member account closure | IAM users, access keys, and resource cleanup orchestrated by AWS; the closed account stays visible with a `CLOSED` label for up to 90 days before removal from the console | One-way |
| **Stripe Connect** | Account rejection via `POST /v1/accounts/:id/reject` | Charges refused, payouts held, API keys de-scoped | One-way after rejection |
| **Okta** | Tenant deletion | SSO sessions terminated, service accounts deprovisioned | One-way after hard delete |
| **Slack** | Channel archival (workspace-level has its own process) | Channels made read-only, integrations disabled | Channel archival is reversible (archive/unarchive) |
| **Cycles** | Tenant CLOSED via two-rule cascade | Budgets, keys, reservation aggregates, webhook subscriptions (policy rows are not terminal-transitioned; their mutations are blocked by Rule 2) | One-way; use `SUSPENDED` for reversible block |

The pattern is consistent: *terminal states must enforce themselves against the whole subtree*, and operators need a distinct *suspended* state for the much more common case of "pause this customer without terminating anything."

## Operator checklist for safe tenant closes

Before you close a tenant in production, the five things worth checking:

1. **Confirm intent.** Is the right state `SUSPENDED` (reversible) or `CLOSED` (terminal)? If in doubt, start with `SUSPENDED`; `SUSPENDED → CLOSED` is legal, `CLOSED → SUSPENDED` isn't.
2. **Drain known long-running workflows.** In-flight reservations will be released automatically with `reason: tenant_closed`, but if your system equates "reservation released" with "agent must retry," now is the time to signal the agent stack that a close is coming.
3. **Snapshot what will be terminated.** List the tenant's open budgets, API keys, and webhook subscriptions via the admin `GET` endpoints before the close. These rows stay readable forever, but downstream reports sometimes aggregate only on `ACTIVE` rows — a pre-close snapshot avoids a surprise gap in month-end reconciliation.
4. **Use a dedicated `Idempotency-Key`.** Close is idempotent — re-issuing on an already-`CLOSED` tenant is a no-op — but the idempotency key lets you safely retry across network flaps.
5. **Verify cascade completion.** Query the audit trail for the tenant and confirm one `*_via_tenant_cascade` record per owned object — the event rows share the cascade `correlation_id` (`tenant_close_cascade:<tenant_id>:<request_id>`). Rule 2 is already active at the moment of the flip, so on reconciler-based Mode B implementations any lag between the flip and the cascade records is an enforcement-safe interval (the runcycles server cascades inline before responding, so there should be no lag) — a persistent shortfall is a signal worth paging the operator channel on.

## The takeaway

Closing a tenant is a statement about an entire subtree of owned objects, not a single row. Multi-tenant platforms that tried to make it a single-row state flip built themselves a permanent source of zombie-budget incidents. Cycles' two-rule contract — cascade on close, guard every owned mutation — makes the safe path the default path, and lets both atomic and flip-first implementations meet the same observable contract.

A useful way to reason about a tenant close isn't "I'll turn this customer off." It's "I'm committing to a terminal statement about every reservation, key, budget, webhook, and policy they own," knowing that the stack enforces that statement even against requests that were already in flight when you clicked the button.

## Related reading

- [Tenant-Close Cascade Semantics](/protocol/tenant-close-cascade-semantics) — the authoritative spec, including the full state machine and Mode A / Mode B conformance rules
- [Multi-Tenant AI Cost Control](/blog/multi-tenant-ai-cost-control-per-tenant-budgets-quotas-isolation) — per-tenant isolation as the foundation for safe tenant lifecycle
- [Agent Delegation Chains and Authority Attenuation](/blog/agent-delegation-chains-authority-attenuation-not-trust-propagation) — how authority narrows through the scope tree, and why cascade respects that shape
- [W3C Trace Context for AI Agent Debugging](/blog/w3c-trace-context-ai-agent-debugging) — debugging cascade events and `TENANT_CLOSED` responses across planes
- [Shadow Mode to Hard Enforcement: The Cutover Decision Tree](/blog/shadow-to-enforcement-cutover-decision-tree) — readiness signals to evaluate before enforcing against a tenant you'd later need to close
- [Admin API Guide — Tenant Lifecycle](/admin-api/guide) — operator-facing endpoint reference for close, suspend, and recover
- [AWS Organizations account closure documentation](https://docs.aws.amazon.com/organizations/latest/userguide/orgs_manage_accounts_close.html) — a reference implementation of tenant-scope cascade in a large SaaS

## Related how-to guides

- [Shadow Mode rollout](/how-to/shadow-mode-in-cycles-how-to-roll-out-budget-enforcement-without-breaking-production)
- [Multi-tenant SaaS guide](/how-to/multi-tenant-saas-with-cycles)
- [Webhook integrations](/how-to/webhook-integrations)
