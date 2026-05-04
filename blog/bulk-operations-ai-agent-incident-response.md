---
title: "Bulk Operations Are Incident Response Infrastructure"
date: 2026-04-30
author: Albert Mavashev
tags:
  - operations
  - incident-response
  - production
  - audit
  - governance
description: "Why AI agent platforms need previewed, idempotent bulk actions to contain tenant, webhook, and budget incidents without blind production scripts at 2 AM."
blog: true
sidebar: false
featured: false
head:
  - - meta
    - name: keywords
      content: AI agent incident response, bulk operations, admin API, tenant suspension, webhook pause, budget reset, idempotency, audit trail
---

# Bulk Operations Are Incident Response Infrastructure

A trial abuse incident starts quietly. One [tenant](/glossary#tenant) is noisy, then twelve, then forty. Webhook deliveries spike. Budget denials pile up. Support agents are still running, but the customer-facing symptom is no longer one runaway workflow. It is a fleet state problem.

At that point, a single-object admin API is not enough. You do not want an operator pasting 40 tenant IDs into a shell loop at 2 AM. You want a controlled bulk operation: preview the target set, confirm the count, execute with one [idempotency key](/glossary#idempotency-key), inspect per-row outcomes, and leave an audit trail that explains exactly what happened.

Bulk operations are not a [dashboard](/glossary#dashboard) convenience. They are incident response infrastructure.

## Why shell loops fail under pressure

The first version of bulk response in many platforms is a script:

```bash
for tenant in $(cat tenants.txt); do
  curl -X PATCH "$ADMIN/tenants/$tenant" \
    -H "X-Admin-API-Key: $ADMIN_KEY" \
    -d '{"status":"SUSPENDED"}'
done
```

That script is fast to write and hard to trust.

| Failure mode | What happens |
|---|---|
| Target set drift | Tenants change status after the file is generated |
| Partial failure | Row 17 fails, rows 18-40 may or may not run |
| Retry ambiguity | Re-running the script can repeat side effects |
| Weak audit trail | The platform sees many unrelated single-object calls |
| Poor blast-radius review | The operator does not get a server-counted preview |

In an AI agent platform, those problems map directly to user-visible consequences. Suspending one extra tenant can interrupt production traffic. Missing one abusive tenant leaves spend running. Replaying a budget adjustment can move money twice if the operation is not idempotent.

The safer shape is a first-class bulk endpoint with explicit safety gates.

## The preview-propose-execute-reconcile loop

Cycles [bulk actions](/glossary#bulk-action) use a filter, not a raw ID list. The operator describes the target population using the same filters the list endpoint supports. Then the server resolves the set and applies the action per row.

The operational loop is:

1. **Preview.** Run the corresponding list query and count the target rows.
2. **Propose.** Build the bulk request with the same filter, an `expected_count`, and an incident-linked `idempotency_key`.
3. **Execute.** POST the bulk action once.
4. **Reconcile.** Inspect `succeeded`, `failed`, and `skipped`.
5. **Audit.** Query the audit log by operation, request/trace context, or search for the incident-linked idempotency key if your deployment records it in audit metadata.

That flow turns a dangerous "loop over everything that matches this text file" into a bounded operation the server can reject before touching anything.

```bash
curl -X POST http://localhost:7979/v1/admin/tenants/bulk-action \
  -H "X-Admin-API-Key: $ADMIN_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "action": "SUSPEND",
    "idempotency_key": "ops-INC-842-suspend-trial-abuse",
    "expected_count": 42,
    "filter": {
      "status": "ACTIVE",
      "search": "trial-"
    }
  }'
```

If the server resolves 40 tenants instead of 42, the request fails with `COUNT_MISMATCH` and no rows are touched. That one field catches the race between "the operator previewed the list" and "the operator clicked execute."

The other safety gates are equally important:

- `idempotency_key` is required; there is no best-effort bulk mode.
- An empty `filter` is rejected; the server refuses to act on every tenant or webhook without at least one constraint.
- A filter that matches more than 500 rows fails with `LIMIT_EXCEEDED`; the operator must narrow the target set and run multiple bounded calls.

## Three bulk lanes operators actually need

The most useful bulk operations line up with the surfaces that move during incidents:

| Endpoint | Incident use case |
|---|---|
| `POST /v1/admin/tenants/bulk-action` | Suspend abusive tenants, reactivate after containment, close terminated tenants |
| `POST /v1/admin/webhooks/bulk-action` | Pause noisy subscriptions, resume after receiver recovery, delete retired endpoints |
| `POST /v1/admin/budgets/bulk-action` | Reset billing periods, repay debt, credit or debit scoped budget ledgers |

Tenant and webhook bulk actions are state transitions. Budget bulk actions move value, so they are stricter: the filter must include `tenant_id`, and actions like `CREDIT`, `DEBIT`, `RESET`, `REPAY_DEBT`, and `RESET_SPENT` require an amount.

That `tenant_id` requirement is a feature, not a limitation. Cross-tenant budget mutation is exactly where blast radius gets hard to reason about. If you are rolling over budgets for many tenants, iterate one tenant at a time with separate idempotency keys and separate audit entries.

## Partial success is not a bug

Bulk operations return three buckets:

| Bucket | Meaning |
|---|---|
| `succeeded` | The row transitioned or value movement applied |
| `failed` | The row matched the filter but could not perform the action |
| `skipped` | The row was already in the target state |

This is the right behavior for incident response. A single tenant already being suspended should not poison the entire operation. A webhook that is already paused should not turn into a failed incident action. A closed tenant should show up as an explicit per-row failure instead of hiding behind an aggregate 500.

The response is the operator's reconciliation checklist:

```json
{
  "action": "SUSPEND",
  "idempotency_key": "ops-INC-842-suspend-trial-abuse",
  "total_matched": 42,
  "succeeded": [{ "id": "tenant-abc" }],
  "failed": [
    {
      "id": "tenant-ghi",
      "error_code": "INVALID_TRANSITION",
      "message": "cannot SUSPEND from CLOSED"
    }
  ],
  "skipped": [
    {
      "id": "tenant-jkl",
      "reason": "ALREADY_IN_TARGET_STATE"
    }
  ]
}
```

The important invariant is that every matched row lands in exactly one bucket. That makes the response useful for a runbook record, not just for the UI that rendered it.

## Idempotency turns retries into evidence

Every bulk request requires an `idempotency_key`. A replay within the idempotency window returns the original response instead of re-running the filter.

That detail matters because incident commands fail in boring ways: the operator's laptop loses network, a reverse proxy times out, the dashboard refreshes, or the admin API responds after the browser has already given up. Without idempotency, the operator has to guess whether the action applied. With idempotency, they can send the same request again and get the same outcome.

Budget bulk actions go one step further. The server derives per-row idempotency keys from the bulk key plus row identity, so a retry of a narrower failed subset does not double-apply the rows that already landed.

The runbook implication is simple: make idempotency keys human-readable and incident-linked:

| Weak key | Better key |
|---|---|
| `bulk-1` | `ops-INC-842-suspend-trial-abuse` |
| `retry` | `period-rollover-2026-05-acme` |
| Random UUID only | `debt-cleanup-2026-04-28-acme` |

The key will appear in audit metadata. Name it like evidence someone will read later.

## Bulk actions need audit and events

A bulk invocation writes one audit entry with the aggregate outcome: action, filter, count, succeeded IDs, failed rows, skipped rows, duration, and idempotency key. That is the compliance artifact for the operator action.

Successful row mutations also emit normal lifecycle events. Suspending 40 tenants emits tenant suspension events. Resetting budgets emits budget reset events. Pausing webhooks emits webhook pause events. The bulk operation itself is one command; the per-row effects still show up in the event stream where downstream systems expect them.

Correlation IDs are what connect those two views. For example:

| Bulk surface | Correlation shape |
|---|---|
| Tenants | `tenant_bulk_action:<action>:<request_id>` |
| Budgets | `budget_bulk_action:<action>:<request_id>` |
| Webhooks | `webhook_bulk_action:<action>:<request_id>` |

Tenant close has an extra dimension because close cascades into owned budgets, [reservations](/glossary#reservation), API keys, and webhooks. The top-level `tenant.closed` event can reconstruct the bulk invocation; each tenant's cascade correlation can reconstruct the side effects under that tenant. See [Tenant Lifecycle at Scale: Cascade Semantics](/blog/tenant-lifecycle-cascade-semantics-at-scale) for the closure model.

## The dashboard should make the same guarantees

A governance dashboard is useful only if it preserves the same safety properties as the API:

- Filter before action.
- Show the server-counted target count.
- Require confirmation with a blast-radius summary.
- Send `expected_count`.
- Show per-row results.
- Link to audit entries and emitted events.

If the UI hides those details, it turns a controlled bulk endpoint back into a button that operators have to trust. The API already knows the safety model. The dashboard should surface it.

For the operator surface, see [AI Agent Governance Dashboard](/blog/ai-agent-governance-admin-dashboard-monitor-control-budgets-risk) and [Using the Cycles Dashboard](/how-to/using-the-cycles-dashboard).

## The takeaway

Agent incidents are often fleet problems. A single tenant, webhook, or budget endpoint is necessary, but it is not sufficient once the incident spans many rows. The safe bulk primitive is not "run this action many times." It is "resolve this filtered population, prove the count still matches, execute each row idempotently, and record every outcome."

That is the difference between an operator containing an incident and an operator running an unreviewed script against production.

## Related reading

- [Using Bulk Actions for Tenants, Webhooks, and Budgets](/how-to/using-bulk-actions-for-tenants-and-webhooks) — request shape, response buckets, safety gates, and error reference
- [Operating Budget Enforcement in Production](/blog/operating-budget-enforcement-in-production) — on-call response when enforcement fires
- [Operational Runbook: Using Cycles Runtime Events](/blog/operational-runbook-using-cycles-runtime-events) — event-driven incident response patterns
- [Tenant Lifecycle at Scale: Cascade Semantics](/blog/tenant-lifecycle-cascade-semantics-at-scale) — why tenant close is a subtree operation
- [Searching and Sorting Admin List Endpoints](/how-to/searching-and-sorting-admin-list-endpoints) — building safe filters before bulk actions

## Related how-to guides

- [Rolling over billing periods](/how-to/rolling-over-billing-periods-with-reset-spent)
- [Webhook integrations](/how-to/webhook-integrations)
- [API key management](/how-to/api-key-management-in-cycles)
