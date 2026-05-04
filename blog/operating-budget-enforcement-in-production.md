---
title: "When Budget Enforcement Fires: An Operator's Guide to Cycles in Production"
date: 2026-04-01
author: Albert Mavashev
tags: [operations, incident-response, production, observability]
description: "What to do when reservation.denied fires at 2am. Diagnostic decision trees, emergency playbooks, and metrics that predict budget incidents."
blog: true
sidebar: false
head:
  - - meta
    - name: keywords
      content: "AI agent incident response, budget enforcement operations, reservation denied, budget exhaustion, runaway agent, on-call playbook, SRE, budget monitoring, estimate accuracy"
---

# When Budget Enforcement Fires: An Operator's Guide to Cycles in Production

> **Part of: [Multi-Tenant AI Operations Reference](/guides/multi-tenant-operations)** — the full pillar covering scope hierarchy, per-tenant enforcement, multi-agent coordination, tenant lifecycle, and identity.

Budget enforcement works. Your agents are denied when they exceed limits. [Webhook events](/blog/real-time-budget-alerts-for-ai-agents) fire in real time. PagerDuty pages you.

<!-- more -->

Now what?

The architecture post explains how events are delivered. This post covers what happens after the alert: diagnosing the root cause, responding under pressure, and preventing recurrence. If you're an SRE, platform engineer, or on-call operator running Cycles in production, this is your operational reference.

## Severity tiers: which events need action

Not every webhook event is a page. Map events to severity and expected response time so your team knows what demands immediate attention and what can wait.

| Severity | Events | Response | What's Happening |
|---|---|---|---|
| **Critical** | `budget.exhausted`, `budget.over_limit_entered`, `system.store_connection_lost` | Minutes | Agents are blocked or enforcement is degraded. Revenue-impacting. |
| **Warning** | `reservation.denied`, `budget.threshold_crossed` (95%) | Hours | Agents may be failing or budget is nearly depleted. |
| **Info** | `budget.threshold_crossed` (80%), `reservation.commit_overage` | Next business day | Early warning. Review estimates and capacity. |
| **Audit** | `tenant.suspended`, `api_key.revoked`, `api_key.auth_failed` | As needed | Security or lifecycle event. Verify intentional. |

Route critical events to PagerDuty. Route warnings to a Slack channel. Send info to a dashboard or email digest. See the [webhook integrations guide](/how-to/webhook-integrations) for setup.

## Diagnostic decision tree: reservation.denied

`reservation.denied` is the most common operational event. An agent tried to reserve budget and was refused. Here's how to diagnose why.

### Step 1: Identify scope and tenant

The event payload tells you who, what, and where:

```json
{
  "event_type": "reservation.denied",
  "tenant_id": "acme-corp",
  "scope": "tenant:acme-corp/workspace:prod/agent:support-bot",
  "actor": { "type": "api_key", "key_id": "key_9f8e7d6c" },
  "data": { "reason_code": "BUDGET_EXCEEDED", "requested_amount": 5000000 }
}
```

Pull recent denial events for this [tenant](/glossary#tenant) to see if it's a single agent or widespread:

```bash
curl "http://localhost:7979/v1/admin/events?tenant_id=acme-corp&event_type=reservation.denied&limit=50" \
  -H "X-Admin-API-Key: $ADMIN_KEY"
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
| Single agent, many denials in quick succession | Retry loop or runaway agent | Revoke the API key: `DELETE /v1/admin/api-keys/{key_id}` |
| Many agents across workspace, all denied | Budget exhausted for shared scope | Emergency fund: `POST /v1/admin/budgets/fund` with CREDIT |
| Intermittent denials, some agents succeed | Concurrent agents competing for limited remaining budget | Increase allocation or add overdraft buffer |
| Denials started after a deploy | New code version has higher cost estimates | Review and lower estimate amounts in agent code |
| Denials for one tenant only | Tenant-specific budget depleted | Fund that tenant's budget specifically |

## Emergency response playbook

Three scenarios with exact API calls. Bookmark these.

### Scenario A: Budget exhausted — agents blocked

All agents in a workspace are being denied. Revenue-impacting.

```bash
# 1. Confirm the budget state
curl "http://localhost:7979/v1/admin/budgets?scope_prefix=tenant:acme-corp/workspace:prod&unit=USD_MICROCENTS" \
  -H "X-Cycles-API-Key: $API_KEY"
# Look for: remaining=0, status=ACTIVE

# 2. Emergency top-up (add $10 = 10,000,000 microcents)
curl -X POST "http://localhost:7979/v1/admin/budgets/fund?scope=tenant:acme-corp/workspace:prod&unit=USD_MICROCENTS" \
  -H "X-Cycles-API-Key: $API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "amount": {"unit": "USD_MICROCENTS", "amount": 10000000},
    "operation": "CREDIT",
    "reason": "emergency top-up: agents blocked in prod"
  }'

# 3. Verify agents can reserve again
# Agents will automatically succeed on next attempt — no restart needed
```

**Time to resolution:** Under 60 seconds if you have the API key ready.

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

# 2. Revoke the key immediately (permanent, takes effect instantly)
curl -X DELETE "http://localhost:7979/v1/admin/api-keys/key_9f8e7d6c" \
  -H "X-Admin-API-Key: $ADMIN_KEY"

# 3. Check what it was doing (audit trail)
curl "http://localhost:7979/v1/admin/audit/logs?key_id=key_9f8e7d6c&limit=100" \
  -H "X-Admin-API-Key: $ADMIN_KEY"

# 4. Create a new key for the legitimate workload (with tighter scope)
curl -X POST "http://localhost:7979/v1/admin/api-keys" \
  -H "X-Admin-API-Key: $ADMIN_KEY" \
  -H "Content-Type: application/json" \
  -d '{"tenant_id": "acme-corp", "name": "support-bot-v2", "permissions": ["reservations:create", "reservations:commit", "balances:read"]}'
```

**Important:** Revoking a key is permanent via the API — there is no un-revoke. Active reservations created before revocation can still be committed or released using another valid key for the same tenant. Only new requests using the revoked key are blocked.

## Estimate accuracy: the most underrated metric

The gap between what agents *reserve* and what they *commit* is the single best leading indicator of budget incidents.

- **Reserve >> Commit** (ratio > 2:1): Agents over-estimate. Budget *appears* consumed but most is released after commit. You're experiencing false scarcity — budgets run out sooner than actual spend warrants.
- **Reserve << Commit** (ratio < 0.8:1): Agents under-estimate. Overage events fire. Debt accumulates. You'll see `reservation.commit_overage` and eventually `budget.over_limit_entered`.
- **Reserve ≈ Commit** (ratio 0.8-1.2:1): Estimates are accurate. Budget utilization is predictable. This is the target range.

| Reserve:Commit Ratio | What It Means | Action |
|---|---|---|
| > 2:1 | Severe over-estimation | Reduce agent estimate amounts to free budget capacity |
| 1.2 – 2:1 | Moderate buffer | Acceptable for workloads with high variance |
| 0.8 – 1.2:1 | Accurate | Ideal range. No action needed. |
| < 0.8:1 | Under-estimation | Increase estimates or add overdraft buffer |

How to measure: compare `reserved` and `spent` from the balance API over time. A rising `reserved` with flat `spent` signals over-estimation. Rising `debt` with low `reserved` signals under-estimation.

## Five metrics that predict budget incidents

These are the numbers your budget operations dashboard should show. The thresholds below are suggested starting points — tune them based on your workload patterns.

| Metric | What It Shows | Watch For |
|---|---|---|
| **Denial rate** | % of reservation attempts denied | > 5% sustained over 15 minutes |
| **Budget velocity** | $ consumed per hour | > 2x the 7-day rolling average |
| **Estimate accuracy** | reserved / committed ratio | Outside 0.8 – 2.0 range |
| **Time to exhaustion** | Hours until remaining = 0 at current velocity | < 4 hours |
| **[Webhook delivery](/glossary#webhook-delivery) failure rate** | % of deliveries failing | > 10% (your alerting pipeline is degraded) |

**Denial rate** is the most important. A 0% denial rate means budgets are either too generous or enforcement isn't active. A 20% denial rate means agents are routinely failing — either budgets are too tight or there's a systemic issue. Target: < 2% for healthy workloads.

**Budget velocity** catches runaway agents before budgets exhaust. If a workspace normally spends $5/hour and suddenly spends $50/hour, you have a problem — even if the budget isn't exhausted yet.

**Time to exhaustion** is the forward-looking version of budget velocity. If you funded a workspace for 30 days but current velocity projects exhaustion in 6 hours, something changed.

## Prevention: right-sizing budgets

Budget enforcement works best when budgets are calibrated to actual workloads. Here's how to get there:

1. **Start at 2x expected cost.** Over-allocate on day one. You can always reduce later. Under-allocation on a new workload causes immediate agent failures.

2. **Use shadow mode for the first week.** Set [`dry_run: true`](/protocol/dry-run-shadow-mode-evaluation-in-cycles) on reservation requests. The server evaluates the budget decision but doesn't actually reserve funds, so agents are never blocked. Review the decisions to tune budgets before enforcing.

3. **Set overdraft_limit to 10-20% of allocation.** This handles burst variance without blocking agents during normal traffic spikes. A $100 budget with $15 overdraft tolerates short bursts without hitting over-limit.

4. **Configure threshold alerts at 80% and 95%.** Default thresholds fire `budget.threshold_crossed` at 80%, 95%, and 100% utilization. The 80% alert gives you time to fund before agents are affected.

5. **Review monthly.** Are budgets running out mid-cycle? Increase allocation. Is 40% unused at month-end? Reduce allocation to get more accurate cost visibility.

6. **Track estimate accuracy.** If reserve:commit ratio drifts outside 0.8-2.0, agent code needs estimate tuning — not budget changes.

---

**Related reading:**
- [Real-Time Budget Alerts](/blog/real-time-budget-alerts-for-ai-agents) — the webhook event system architecture behind these operational alerts
- [Webhook Integrations](/how-to/webhook-integrations) — PagerDuty, Slack, Datadog, Teams, Opsgenie setup
- [Managing Webhooks](/how-to/managing-webhooks) — create, test, monitor, and troubleshoot subscriptions
- [Monitoring and Alerting](/how-to/monitoring-and-alerting) — Prometheus metrics and Grafana dashboards
- [Cost Estimation Cheat Sheet](/how-to/cost-estimation-cheat-sheet) — pricing reference for estimation
- [Production Operations Guide](/how-to/production-operations-guide) — deployment, Redis HA, [events service](/glossary#events-service)
