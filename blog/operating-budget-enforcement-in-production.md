---
title: "Operating Cycles Budget Enforcement"
date: 2026-04-01
author: Albert Mavashev
tags: [operations, incident-response, production, observability]
description: "Respond to reservation denials with diagnostic decision trees, emergency playbooks, and leading metrics for operating Cycles budget controls in production."
blog: true
sidebar: false
head:
  - - meta
    - name: keywords
      content: "AI agent incident response, budget enforcement operations, reservation denied, budget exhaustion, runaway agent, on-call playbook, SRE, budget monitoring, estimate accuracy"
---

# When Budget Enforcement Fires: An Operator's Guide to Cycles in Production

> **Part of: [Multi-Tenant AI Operations Reference](/guides/multi-tenant-operations)** — the full pillar covering scope hierarchy, per-tenant enforcement, multi-agent coordination, tenant lifecycle, and identity.

An instrumented action can be denied when a matching budget has insufficient room. If you run the events service and configure a matching [webhook subscription](/blog/real-time-budget-alerts-for-ai-agents), the resulting event can reach your incident tooling.

<!-- more -->

Now what?

The architecture post explains how events are delivered. This post covers what happens after the alert: diagnosing the root cause, responding under pressure, and preventing recurrence. If you're an SRE, platform engineer, or on-call operator running Cycles in production, this is your operational reference.

## Severity tiers: which events need action

Not every webhook event is a page. Map events to severity and expected response time so your team knows what demands immediate attention and what can wait.

| Severity | Events | Response | What's Happening |
|---|---|---|---|
| **Critical** | `budget.exhausted` or `budget.over_limit_entered` on a customer-critical scope | Per your SLO | New positive reservations matching the affected ledger may be blocked. |
| **Warning** | Rising live-denial metric or application 4xx errors; rising `reservation.commit_overage` | Per your SLO | Protected actions may be failing, or estimates may need recalibration. |
| **Info** | `budget.funded`, `budget.debited`, `budget.reset`, `budget.debt_repaid` | Routine review | An operator or automation changed ledger state. |
| **Audit** | `tenant.suspended`, `api_key.revoked`, `api_key.auth_failed` | As needed | Security or lifecycle event. Verify intentional. |

These severity assignments are examples; route events according to the affected scope and your service SLOs. The current reference server emits exhaustion at 100% utilization, but does not automatically emit configurable 80% or 95% `budget.threshold_crossed` alerts. Calculate early-warning thresholds from balance snapshots or your telemetry. See the [webhook integrations guide](/how-to/webhook-integrations) for delivery setup.

## Diagnostic decision tree: a budget denial

A live reservation that cannot proceed returns a protocol error such as `409 BUDGET_EXCEEDED`; the current exception path does not emit `reservation.denied`. Detect live failures through application error handling or `cycles_reservations_reserve_total{decision="DENY"}`. The `reservation.denied` event is emitted only when a dry-run reservation or `/v1/decide` evaluation returns `DENY`, making it useful for calibration rather than proof that live work was blocked.

### Step 1: Identify scope and tenant

The event payload tells you who, what, and where:

```json
{
  "event_type": "reservation.denied",
  "tenant_id": "acme-corp",
  "scope": "tenant:acme-corp/workspace:prod/agent:support-bot",
  "actor": { "type": "api_key", "key_id": "key_9f8e7d6c" },
  "data": {
    "scope": "tenant:acme-corp/workspace:prod/agent:support-bot",
    "unit": "USD_MICROCENTS",
    "reason_code": "BUDGET_EXCEEDED",
    "requested_amount": 5000000,
    "remaining": 0,
    "action": { "kind": "llm.chat", "name": "support-reply" },
    "subject": { "tenant": "acme-corp", "workspace": "prod", "agent": "support-bot" }
  }
}
```

For a hypothetical denial, pull recent `reservation.denied` events for this [tenant](/glossary#tenant). For a live incident, start from the application's error response and runtime metric tags instead:

```bash
curl "http://localhost:7979/v1/admin/events?tenant_id=acme-corp&event_type=reservation.denied&limit=50" \
  -H "X-Admin-API-Key: $ADMIN_KEY"

# Live reservation denials (Prometheus; tenant tag is optional by configuration)
sum by (tenant, reason) (
  rate(cycles_reservations_reserve_total{decision="DENY"}[5m])
)
```

### Step 2: Check the budget

The runtime server and [admin server](/glossary#admin-server) can both answer the budget question, but through different endpoints. Use whichever is available in your environment:

```bash
# Runtime server — protocol spec uses individual subject params
curl "http://localhost:7878/v1/balances?tenant=acme-corp&workspace=prod" \
  -H "X-Cycles-API-Key: $API_KEY"

# Admin server — governance spec uses scope_prefix
curl "http://localhost:7979/v1/admin/budgets?scope_prefix=tenant:acme-corp/workspace:prod&unit=USD_MICROCENTS" \
  -H "X-Cycles-API-Key: $API_KEY"
```

Look at the response:

- **`remaining` = 0**: Budget exhausted. Needs funding.
- **`remaining` > 0 but < `requested_amount`**: Agent is requesting more than available. Estimate may be too high.
- **`is_over_limit` = true**: Debt exceeded overdraft limit. Needs debt repayment before new [reservations](/glossary#reservation) are allowed.
- **`status` = FROZEN**: Budget was frozen by an operator. Check if intentional.

### Step 3: Determine root cause

| Symptom | Likely Cause | Immediate Fix |
|---|---|---|
| Single key, many denials in quick succession | Retry loop, intentional fan-out, or duplicate instrumentation | Correlate with application traces; revoke the key if the activity is unauthorized or cannot be stopped safely |
| Many agents across one workspace, all denied at the same scope | Shared ledger exhausted, frozen, closed, or over-limit | Inspect the reason code and ledger state before funding or changing policy |
| Intermittent denials, some agents succeed | Limited remaining budget, varying estimates, or concurrent reservations | Inspect estimates and active reservations; resize only if the allocation is actually wrong |
| Denials started after a deploy | Changed estimates, scope mapping, or workload behavior | Compare the deployed signals with the previous version |
| Denials for one tenant only | A tenant-owned ledger or tenant lifecycle state is denying work | Inspect that tenant's denying scope and reason code |

## Emergency response playbook

Three scenarios with exact API calls. Bookmark these.

### Scenario A: Budget exhausted — agents blocked

All agents in a workspace are being denied. Revenue-impacting.

```bash
# 1. Confirm the budget state
curl "http://localhost:7979/v1/admin/budgets?scope_prefix=tenant:acme-corp/workspace:prod&unit=USD_MICROCENTS" \
  -H "X-Cycles-API-Key: $API_KEY"
# Look for: remaining=0, status=ACTIVE

# 2. Emergency top-up (add $10 = 1,000,000,000 microcents)
curl -X POST "http://localhost:7979/v1/admin/budgets/fund?scope=tenant:acme-corp/workspace:prod&unit=USD_MICROCENTS" \
  -H "X-Cycles-API-Key: $API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "amount": {"unit": "USD_MICROCENTS", "amount": 1000000000},
    "operation": "CREDIT",
    "reason": "emergency top-up: agents blocked in prod"
  }'

# 3. Verify a new reservation succeeds
# No restart is required, but other denying scopes or states can still block it
```

### Scenario B: Over-limit — debt exceeds overdraft

An agent committed more than estimated (via `ALLOW_WITH_OVERDRAFT` policy), accumulating debt past the overdraft limit. New reservations are blocked.

```bash
# 1. Check debt level
curl "http://localhost:7979/v1/admin/budgets?scope_prefix=tenant:acme-corp/workspace:prod&unit=USD_MICROCENTS" \
  -H "X-Cycles-API-Key: $API_KEY"
# Look for: debt > overdraft_limit, is_over_limit=true

# 2. Repay debt (bring below overdraft_limit)
curl -X POST "http://localhost:7979/v1/admin/budgets/fund?scope=tenant:acme-corp/workspace:prod&unit=USD_MICROCENTS" \
  -H "X-Cycles-API-Key: $API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "amount": {"unit": "USD_MICROCENTS", "amount": 5000000},
    "operation": "REPAY_DEBT",
    "reason": "resolve over-limit: repay accumulated debt"
  }'

# 3. Verify is_over_limit is cleared
# is_over_limit returns to false automatically when debt < overdraft_limit
```

### Scenario C: Suspected runaway agent

One API key is generating hundreds of reservation attempts per minute.

```bash
# 1. Identify the key from denial events
# Event data: actor.key_id = "key_9f8e7d6c"

# 2. Revoke the key if the activity is unauthorized or cannot be stopped
curl -X DELETE "http://localhost:7979/v1/admin/api-keys/key_9f8e7d6c" \
  -H "X-Admin-API-Key: $ADMIN_KEY"

# 3. Check what it was doing (audit trail)
curl "http://localhost:7979/v1/admin/audit/logs?key_id=key_9f8e7d6c&limit=100" \
  -H "X-Admin-API-Key: $ADMIN_KEY"

# 4. Create a new key for the legitimate workload (with tighter scope)
curl -X POST "http://localhost:7979/v1/admin/api-keys" \
  -H "X-Admin-API-Key: $ADMIN_KEY" \
  -H "Content-Type: application/json" \
  -d '{"tenant_id": "acme-corp", "name": "support-bot-v2", "permissions": ["reservations:create", "reservations:commit", "reservations:release", "balances:read"]}'
```

**Important:** Revoking a key is permanent via the API — there is no un-revoke. Active reservations created before revocation can still be committed or released using another valid key for the same tenant. Only new requests using the revoked key are blocked.

## Estimate accuracy: the most underrated metric

The gap between what agents *reserve* and what they *commit* is a useful leading indicator of budget pressure.

| Reserve:Commit Ratio | What It Means | Action |
|---|---|---|
| Consistently above 1 | Estimates exceed actual usage | Decide whether the safety buffer is intentional; excessive buffers can reduce concurrent headroom |
| Near 1 | Estimates are close to actual usage | Verify the distribution, not just the aggregate |
| Consistently below 1 | Actual usage exceeds estimates | Improve the estimator and review the configured commit-overage policy |

There is no universal healthy band: a deterministic call can target a narrow tolerance, while a high-variance tool may need a larger safety buffer. Calculate the ratio from completed reservation estimates and their actual amounts in application telemetry or exported reservation records. The balance API's `reserved` field is a point-in-time total of active holds and `spent` is cumulative, so dividing those two fields is not a reserve-to-commit ratio.

## Five metrics that predict budget incidents

These are useful numbers for a budget operations dashboard. Derive alert thresholds from workload baselines, service objectives, and the time operators need to respond.

| Metric | What It Shows | Watch For |
|---|---|---|
| **Denial rate** | % of reservation attempts denied | Deviation from the expected, classified baseline |
| **Budget velocity** | Units consumed per time window | Unexpected change after accounting for seasonality and traffic |
| **Estimate accuracy** | Estimate / actual ratio per completed reservation | Drift outside the tolerance chosen for that workload |
| **Time to exhaustion** | Time until remaining reaches zero at current velocity | Less than the funding or degradation response lead time |
| **[Webhook delivery](/glossary#webhook-delivery) failure rate** | % of deliveries failing | Breach of your alert-delivery SLO |

Interpret denial rate in context. A zero rate can be correct for normal traffic but does not prove that tested runaway cases are bounded. A high rate can be intentional on abusive traffic or harmful on ordinary user workflows; classify denials before changing limits.

**Budget velocity** catches runaway agents before budgets exhaust. If a workspace normally spends $5/hour and suddenly spends $50/hour, you have a problem — even if the budget isn't exhausted yet.

**Time to exhaustion** is the forward-looking version of budget velocity. If you funded a workspace for 30 days but current velocity projects exhaustion in 6 hours, something changed.

## Prevention: right-sizing budgets

Budget enforcement works best when budgets are calibrated to actual workloads. Here's how to get there:

1. **Size from representative data and failure objectives.** Use workload percentiles, concurrency, estimate uncertainty, and the maximum exposure you are prepared to accept. A universal multiplier cannot encode those trade-offs.

2. **Evaluate representative traffic with dry runs.** Set [`dry_run: true`](/protocol/dry-run-shadow-mode-evaluation-in-cycles) on reservation requests. The server returns a hypothetical decision without creating a reservation or balance mutation; the application must retain that response and actual outcome for analysis. Observe enough traffic and edge cases for your workload rather than relying on a fixed duration.

3. **Configure overdraft only when the accounting policy needs it.** `overdraft_limit` applies to `ALLOW_WITH_OVERDRAFT`. Size it from the largest tolerated overage and concurrent-commit behavior, then monitor and reconcile debt. Do not add overdraft merely to hide an undersized budget.

4. **Create early-warning alerts from balances or telemetry.** Choose utilization and time-to-exhaustion thresholds that leave enough response time. The current reference runtime emits `budget.exhausted` on the transition to zero remaining; configurable pre-exhaustion `budget.threshold_crossed` emission is not implemented.

5. **Review on a workload-appropriate cadence.** Revisit budgets after model, price, traffic, or workflow changes and at the boundaries that matter to your billing period.

6. **Track estimate accuracy.** Investigate drift outside the tolerance chosen for each workload. Fix estimate formulas when they stop tracking reality; change budgets only when the intended exposure changes.

---

**Related reading:**
- [Real-Time Budget Alerts](/blog/real-time-budget-alerts-for-ai-agents) — the webhook event system architecture behind these operational alerts
- [Webhook Integrations](/how-to/webhook-integrations) — PagerDuty, Slack, Datadog, Teams, Opsgenie setup
- [Managing Webhooks](/how-to/managing-webhooks) — create, test, monitor, and troubleshoot subscriptions
- [Monitoring and Alerting](/how-to/monitoring-and-alerting) — Prometheus metrics and Grafana dashboards
- [Cost Estimation Cheat Sheet](/how-to/cost-estimation-cheat-sheet) — pricing reference for estimation
- [Production Operations Guide](/how-to/production-operations-guide) — deployment, Redis HA, [events service](/glossary#events-service)

## Related how-to guides

- [Shadow Mode rollout](/how-to/shadow-mode-in-cycles-how-to-roll-out-budget-enforcement-without-breaking-production)
- [Prometheus metrics reference](/how-to/prometheus-metrics-reference)
- [Multi-tenant SaaS guide](/how-to/multi-tenant-saas-with-cycles)
