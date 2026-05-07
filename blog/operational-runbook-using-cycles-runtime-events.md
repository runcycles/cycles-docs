---
title: "Operational Runbook: Using Cycles Runtime Events"
date: 2026-04-07
author: Albert Mavashev
tags: [engineering, operations, production, incident-response, webhooks, observability, runtime-authority]
description: "Wire Cycles runtime events into on-call: severity tiers, diagnostic trees, and auto-remediation patterns for critical AI agent budget events."
blog: true
sidebar: false
featured: false
---

# Operational Runbook: Using Cycles Runtime Events

Runtime enforcement catches what observability misses — but only if someone is watching. Once you have Cycles enforcing budgets in production, you need a plan for what happens when enforcement fires at 2 AM. That's what runtime events are for.

Cycles emits webhook events on every significant budget state transition: threshold crossings, exhaustion, debt accumulation, denial rate spikes, reservation expirations. These events are the signal layer that connects enforcement to your operational infrastructure — PagerDuty, Slack, auto-remediation scripts, runbooks.

This post is the operator's runbook: which events matter, what they mean, and what to do when they fire.

<!-- more -->

## Why Webhook Events Beat Polling for Budget Alerts

The alternative to events is polling dashboards. That struggles for the same reason observability-only approaches struggle with enforcement: **detection latency**. By the time a dashboard refresh shows budget exhaustion, the response window is often already closing.

(If you want the architectural background on the event system itself, the [Real-Time Budget Alerts post](/blog/real-time-budget-alerts-for-ai-agents) covers the design. The [operator's guide](/blog/operating-budget-enforcement-in-production) covers diagnostic trees for the `reservation.denied` scenario. This post is the event-by-event response reference for the other critical events.)

The cloud providers figured this out years ago. AWS Budgets pushes threshold alerts through SNS. [GCP Budget Notifications](https://cloud.google.com/billing/docs/how-to/budgets-programmatic-notifications) push to Pub/Sub — their docs explicitly state: *"If you use budgets or cost anomaly detection as a cost control tool, email notifications might not be the best method to use to ensure timely action to control your costs."* Azure uses Action Groups for the same fan-out pattern.

Cycles follows the same playbook. Events fire within seconds of the state change, get signed with HMAC-SHA256, and land on your webhook endpoint. Your infrastructure decides what to do with them.

## Event Severity Tiers

Not every event deserves a page. Google's SRE Book [is blunt about this](https://sre.google/sre-book/monitoring-distributed-systems/): *"Every time the pager goes off, I should be able to react with a sense of urgency... Every page should be actionable... When pages occur too frequently, employees second-guess, skim, or even ignore incoming alerts."*

Apply that principle to the events Cycles emits today:

| Tier | Route | Events | SLA |
|---|---|---|---|
| **Critical — page on-call** | PagerDuty/OpsGenie | `budget.exhausted`, `budget.over_limit_entered` | < 5 min response |
| **Warning — alert channel** | Slack/Teams | clusters of `reservation.denied`, `reservation.expired` bursts | < 1 hour review |
| **Info — dashboard + digest** | Grafana/digest email | `budget.debt_incurred`, `reservation.commit_overage` | Next business day |

The split matters. If you page on every commit overage, on-call will learn to ignore the pager. If you only page on exhaustion, you've lost the chance to intervene earlier.

## Runbook: `budget.exhausted`

**Severity:** Critical — all new reservations for this scope are being DENIED until funded.

**Payload fields:** envelope (event_id, event_type, tenant_id, scope, timestamp) with actor context. Query the budget directly for current balance state.

**Immediate triage (first 5 minutes):**

1. **Identify blast radius.** What scope exhausted? Per-tenant? Per-workflow? Per-run? The `scope` field tells you.
2. **Check the active reservations.** Are agents currently blocked? Query the runtime server with `GET /v1/reservations?tenant={tenant}&status=ACTIVE` (authenticated with `X-Cycles-API-Key`) to see what's in flight.
3. **Check the spike pattern.** Is this gradual exhaustion (expected — budget was sized correctly and we need more) or a sudden spike (runaway agent)?

**Root cause decision tree:**

```
Was spend rate normal until recently?
├── YES → Budget is undersized for actual workload
│         → Fund via admin API: POST /v1/admin/budgets/fund?scope={scope}&unit={unit}
│           (CREDIT operation, authenticated with X-Cycles-API-Key)
│         → Review budget sizing for next period
│
└── NO → Check for burst pattern
         ├── Single agent spiking → Runaway / retry loop
         │    → Disable the agent via API key revocation
         │    → Review agent logs for loop source
         │
         └── Distributed spike → Traffic surge
              → Fund budget + rate-limit upstream traffic
              → Review burn_rate_anomaly events
```

**Don't do this:** Immediately raise the budget permanently. That might be the right answer, but confirm there's no runaway agent first. A 3x budget increase in response to a retry loop just gives the loop 3x more runway.

**Automation opportunity:** A `budget.exhausted` event can trigger automatic budget replenishment from a reserve pool *if* `burn_rate_anomaly` hasn't also fired in the last N minutes. This is the AI agent equivalent of the [circuit breaker pattern](https://learn.microsoft.com/en-us/azure/architecture/patterns/circuit-breaker): auto-remediate when it looks normal, escalate when it doesn't.

## Runbook: `budget.over_limit_entered`

**Severity:** Critical — debt has exceeded the configured overdraft limit. New reservations blocked.

**Expected fields include:** `scope`, `unit`, `debt`, `overdraft_limit`, `is_over_limit`. Query the budget directly via the admin API to get full current state.

**Why this fires:** Cycles supports overdraft-tolerant budgets (policy `ALLOW_WITH_OVERDRAFT`) where concurrent commits can push spending past the allocated amount. The `overdraft_limit` caps how far into debt a budget can go before new reservations stop. This event fires when that cap is crossed.

**Immediate triage:**

1. **Verify the debt amount.** Check `budget.debt_incurred` events over the last 24h to understand how debt accumulated.
2. **Decide: pay down debt or raise the limit.** If the overrun reflects legitimate growth, raise `overdraft_limit` via admin API. If it reflects estimation drift or a runaway, repay debt via REPAY_DEBT funding operation.
3. **Watch for `budget.over_limit_exited`.** This confirms recovery.

**Root cause patterns:**
- **Estimation drift:** Your reserve estimates are too low; actuals consistently exceed them. Fix by re-calibrating estimates (see the [shadow mode rollout guide](/blog/how-to-add-runtime-enforcement-without-breaking-your-agents)).
- **Concurrent overspend:** Multiple commits landed at once and pushed debt past the limit. Fix by reducing `overdraft_limit` or tightening per-reservation estimates.
- **Policy mismatch:** Budget was set to `ALLOW_WITH_OVERDRAFT` but the workload needs hard blocking. Change policy to `REJECT` on exhaustion.

## Runbook: `reservation.denied` (individual denials)

**Severity:** Warning — a specific reservation was denied. Aggregate these by scope to detect patterns.

**Expected fields include:** `scope`, `unit`, `reason_code`, plus envelope actor context. Query the event directly for full details.

**When it fires:** Every time a reservation is rejected. Individual events are low severity; the signal is in the *aggregate* — query recent events per scope to detect spikes.

**Triage (when you see a cluster):**

1. **Check denial reasons.** Query the admin API: `GET /v1/admin/events?event_type=reservation.denied&scope={scope}` (authenticated with `X-Admin-API-Key`). What `reason_code` values are showing up?
2. **Common reason codes:**
   - `BUDGET_EXCEEDED` — per-scope sub-budget is tight while parent has room. Check budget hierarchy.
   - `OVERDRAFT_LIMIT_EXCEEDED` — hitting the debt ceiling, not the allocated ceiling.
   - `BUDGET_FROZEN` — someone froze the budget via `POST /v1/admin/budgets/freeze`. Unfreeze with `POST /v1/admin/budgets/unfreeze` (X-Admin-API-Key) once investigation is complete.
   - `DEBT_OUTSTANDING` — unresolved debt blocking new reservations.
3. **Look at agent behavior.** Are specific agents being denied repeatedly? That's a retry loop signature — the agent keeps trying the same denied reservation.

**Don't do this:** Raise the budget to make denials go away without understanding why. High denial rates often indicate bad agent behavior (loop, estimation drift, fanout explosion) that raising the budget just hides.

**Aggregation pattern:** Run a scheduled job that queries recent `reservation.denied` events per scope, counts them per window, and pages if the count crosses a threshold. This is the practical implementation of denial-rate alerting using the event stream.

## Runbook: `reservation.commit_overage`

**Severity:** Info — a reservation committed more than it estimated.

**Expected fields include:** `scope`, `unit`, `estimated_amount`, `actual_amount`, `overage`. Compute percentages client-side from the estimated and actual amounts.

**When it fires:** After a commit, when actual usage exceeded the reserved estimate. The reservation still succeeds — this event is a calibration signal.

**Why it matters:** Persistent overage events indicate your reserve estimates are too low. Your budgets are effectively tighter than you think, because actuals consistently exceed what you reserved. Left unaddressed, this drifts into `budget.over_limit_entered` incidents.

**Triage:**

1. **Check for concentration.** Is overage happening at a specific workflow step, or spread evenly? A single workflow with 50% average overage needs targeted estimate fixes.
2. **Look at the overage distribution.** 5-10% drift is normal. 50%+ is a calibration problem.
3. **Fix the estimate source.** If your estimates come from token-count predictions, add a safety margin. If they come from prior-run averages, widen the window or use p95 instead of mean.

**Automation opportunity:** A commit overage dashboard per workflow lets you spot drifting estimates before they cause incidents. This is a dashboard event, not a paging event.

## Runbook: `reservation.expired`

**Severity:** Warning — a reservation expired without being committed or released.

**Expected fields include:** `scope`, `reservation_id`, `estimated_amount`, `created_at`, `expired_at`, `ttl_ms`, `extensions_used`

**When it fires:** Reservations have a TTL. If the client doesn't commit (or release) within that window plus a grace period, the background expiry sweeper expires the reservation automatically. This event fires when that happens.

**Why it matters:** A single expired reservation is usually a client crash or slow downstream. A burst of expired reservations is a pattern — something is systematically preventing commits from landing.

**Triage (on a burst):**

1. **Check for clustered scopes.** Are expirations concentrated in one workflow? That workflow's downstream may be hanging.
2. **Look at estimated vs. actual duration.** Compare `ttl_ms` against how long the operation actually takes. If TTL is short relative to real work, expirations are expected. Tune TTL or grace period up.
3. **Check client logs.** Expired reservations usually indicate the client crashed between reserve and commit — look for panics, timeouts, or container restarts in the agent logs.

**Budget accounting impact:** Expired reservations release their reserved estimate back to the budget, but the estimated amount was held for the duration. If expirations are frequent, effective budget utilization drops without the work actually completing.

**Don't do this:** Just lengthen the TTL everywhere without understanding why. Longer TTLs mean more budget held by orphaned reservations.

## Webhook Consumption Patterns

The runbooks above assume your webhook handlers are reliable. Industry patterns to follow:

**Signature verification first.** Stripe's webhook docs [are explicit](https://docs.stripe.com/webhooks): *"Always verify that webhook events originate from Stripe before acting on them."* Cycles signs every event with HMAC-SHA256 in the `X-Cycles-Signature` header. Verify before processing.

**Return 2xx quickly, process asynchronously.** Stripe again: *"Your endpoint must quickly return a successful status code (2xx) prior to any complex logic that could cause a timeout."* Enqueue the event to your own durable queue, return 200, then process. This pattern is universal — Shopify, GitHub, and Stripe all recommend it.

**Deduplicate by event ID.** Cycles delivers events at-least-once. The `event_id` field is unique; track which IDs you've processed and skip duplicates. Stripe's guidance: *"You can guard against duplicated event receipts by logging the event IDs you've processed, and then not processing already-logged events."*

**Set a dead-letter policy.** Cycles retries webhook delivery up to 5 times with exponential backoff (1s, 2s, 4s, 8s, 16s) and auto-disables subscriptions after 10 consecutive failures. But you also need a DLQ for events you received but couldn't process. A malformed payload shouldn't crash your consumer.

## PagerDuty and Slack Integration Recipes

**PagerDuty (critical events):**

```
Cycles webhook → Your transformer → PagerDuty Events API v2
  event_action: "trigger"
  severity: "critical"
  dedup_key: event.scope + event.event_type
  custom_details: event payload
```

The `dedup_key` is essential. Without it, repeated `budget.exhausted` events for the same scope will create page storms. With it, PagerDuty groups them into one incident that acknowledges/resolves cleanly.

**Slack (warning events):**

Use a transformer that formats the event into a Slack message with the scope, severity, and a link to the Cycles admin dashboard for that scope. Keep it actionable — the on-call should be able to triage from the notification without clicking through.

**Auto-remediation (info events):**

Some events are safe to auto-remediate. `reservation.commit_overage` can trigger an estimate recalibration job. `budget.debt_incurred` at low levels can trigger a pre-configured budget top-up from a reserve pool. These don't need human involvement — they need to happen consistently, not emotionally.

## On-Call Quick Reference

| Event | Page? | First check | Likely fix |
|---|---|---|---|
| `budget.exhausted` | Yes | Burst vs. gradual? | Fund budget (verify no runaway) |
| `budget.over_limit_entered` | Yes | Debt source? | Repay debt or raise limit |
| Cluster of `reservation.denied` | No (Slack) | Denial reason codes | Depends on reason code |
| Burst of `reservation.expired` | No (Slack) | Clustered scopes? | Fix downstream or tune TTL |
| `budget.debt_incurred` | No (dashboard) | Overdraft policy? | Verify intentional |
| `reservation.commit_overage` | No (dashboard) | Estimate accuracy | Recalibrate estimates |

## The Take: Events Make Enforcement Operational

Runtime events are how enforcement becomes operational. Without them, you have a system that blocks actions silently. With them, enforcement integrates with the same infrastructure you already use for billing alerts, quota notifications, and on-call rotations — the same pattern AWS, GCP, and Azure all converged on.

Your job as an operator is to route each event to the right response: page for critical, Slack for warning, dashboard for info, audit log for compliance. When something goes wrong, you want to know in the next five seconds — not the next five hours.

---

- [Real-Time Budget Alerts for AI Agents](/blog/real-time-budget-alerts-for-ai-agents)
- [When Budget Enforcement Fires: An Operator's Guide](/blog/operating-budget-enforcement-in-production)
- [How to Add Runtime Enforcement Without Breaking Your Agents](/blog/how-to-add-runtime-enforcement-without-breaking-your-agents)
- [What Is Runtime Authority for AI Agents](/blog/what-is-runtime-authority-for-ai-agents)
- [The State of AI Agent Incidents 2026](/blog/state-of-ai-agent-incidents-2026)
- [Webhook Integrations Guide (how-to)](/how-to/webhook-integrations)
- [GitHub: runcycles](https://github.com/runcycles)

## Related how-to guides

- [Shadow Mode rollout](/how-to/shadow-mode-in-cycles-how-to-roll-out-budget-enforcement-without-breaking-production)
- [API key management](/how-to/api-key-management-in-cycles)
- [Using the Cycles dashboard](/how-to/using-the-cycles-dashboard)
