---
title: "Real-Time Budget Alerts for AI Agents: Designing Cycles' Webhook Event System"
date: 2026-04-01
author: Albert Mavashev
tags: [engineering, webhooks, architecture, observability]
description: "How we designed a webhook event system that delivers AI agent budget alerts to PagerDuty, Slack, and custom systems — architecture, delivery guarantees, and failure handling."
blog: true
sidebar: false
head:
  - - meta
    - name: keywords
      content: "webhook events, AI agent budget alerts, AI cost management, LLM spend control, HMAC signing, event-driven architecture, PagerDuty integration, budget monitoring, real-time alerts, webhook delivery, at-least-once delivery, webhook retry"
---

# Real-Time Budget Alerts for AI Agents: Designing Cycles' Webhook Event System

> **Part of: [LLM Cost Runtime Control Reference](/guides/llm-cost-runtime-control)** — the full pillar covering causes, enforcement patterns, multi-tenant boundaries, and unit economics.

Consider a common scenario: an infrastructure team has budget dashboards. Prometheus scrapes every 15 seconds. Grafana panels show utilization curves. Alert rules fire when thresholds cross 90%.

<!-- more -->

An agent hit a retry loop on a Friday afternoon. It burned through $450 of budget in under 3 minutes. The 90% threshold alert fired at minute one. The on-call engineer saw it at minute four — after the Slack notification, after checking context, after pulling up the dashboard. By then the budget was exhausted, 12 other agents in the same workspace were blocked, and a customer-facing workflow was down.

The monitoring worked. The problem was latency. Polling-based alerting has a structural delay between "state changed" and "someone knows about it." For budget enforcement, where a single runaway agent can exhaust funds in seconds, that delay is where the damage happens.

## The detection gap

Representative detection latencies for a budget exhaustion event:

| Detection Method | Typical Time to Alert | Typical Time to Human Action |
|---|---|---|
| Polling dashboard (60s interval) | 30-60s | 2-5 minutes |
| Prometheus alert (15s scrape + 1m for-duration) | ~75s | 3-6 minutes |
| Webhook event (push on state change) | <1s | 1-3 minutes |

The webhook doesn't make humans faster. It eliminates the detection delay entirely. The event fires the instant the budget state changes — not on the next scrape, not after a for-duration averaging window.

This is why we built a webhook event system into Cycles v0.1.25.

## 41 event types across 6 categories

> **As of post date.** The current Admin API `EventType` enum registers **47 event types across 7 categories** (the `webhook` category was added later). For the live count and per-category breakdown, see the [Event Payloads Reference](/protocol/event-payloads-reference).

Every observable state change in the system produces an event. We organized them into 6 categories covering the full lifecycle:

| Category | Count | Covers |
|---|---|---|
| **budget** | 16 | Created, funded, debited, reset, reset_spent (billing period), frozen, closed, threshold crossed, exhausted, over-limit, debt incurred, burn rate anomaly |
| **[reservation](/glossary#reservation)** | 5 | Denied, denial rate spike, expired, expiry rate spike, commit overage |
| **[tenant](/glossary#tenant)** | 6 | Created, updated, suspended, reactivated, closed, settings changed |
| **api_key** | 6 | Created, revoked, expired, permissions changed, auth failed, auth failure rate spike |
| **policy** | 3 | Created, updated, deleted |
| **system** | 5 | Store connection lost/restored, high latency, [webhook delivery](/glossary#webhook-delivery) failed, webhook test |

The six events that matter most for incident response:

| Event | When It Fires | Why It Matters |
|---|---|---|
| `budget.exhausted` | Remaining = 0 | All reservations for this scope will be denied until funded |
| `budget.over_limit_entered` | Debt exceeds overdraft limit | New reservations blocked; operator intervention required |
| `reservation.denied` | Agent can't reserve budget | Agents are failing — check if budget needs funding or if there's a runaway consumer |
| `budget.threshold_crossed` | Utilization crosses 80%, 95%, or 100% | Early warning before exhaustion |
| `api_key.auth_failed` | Authentication attempt with invalid key | Security event — possible credential leak or misconfiguration |
| `system.store_connection_lost` | Redis connection failed | Infrastructure incident — budget enforcement depends on Redis availability |

Every event includes a standard payload: who caused it (`actor`), what changed (`data`), where it happened (`scope` path like `tenant:acme-corp/workspace:prod/agent:support-bot`), and a millisecond-precision `timestamp`. Events are emitted by both the runtime enforcement server (reserve/commit operations) and the admin control plane (CRUD operations) — a single [webhook subscription](/glossary#webhook-subscription) captures both.

## Architecture: why a separate delivery service

The most important engineering decision in this system: webhook delivery runs as its own service, separate from the runtime enforcement server and the admin API.

```
Runtime server (port 7878) ──┐
                             ├── LPUSH dispatch:pending
Admin server (port 7979) ────┘
                                    │
                              Redis ─┤
                                    │
Events service (port 7980) ──── BRPOP → HTTP POST with HMAC signature
```

Three services, three workloads, three scaling profiles:

| Service | Workload | Latency Target | Scaling Driver |
|---|---|---|---|
| Runtime (reserve/commit) | Synchronous, hot path | [<10ms p99](/blog/cycles-server-performance-benchmarks) | Agent request volume |
| Admin (CRUD) | Synchronous, operator-facing | <200ms | Human operator actions |
| Events (webhook delivery) | Asynchronous, variable latency | Best-effort | Subscription count × event rate |

Why not embed delivery in the runtime server? Webhook endpoints are external HTTP services with unpredictable latency. A slow endpoint or DNS timeout would add hundreds of milliseconds to the reserve/commit path. For a system designed to enforce budgets at sub-10ms latency, that's unacceptable. Even running delivery on a background thread doesn't help — thread pool exhaustion from slow endpoints would eventually affect the main request threads.

Why not embed in the [admin server](/glossary#admin-server)? Same problem, different magnitude. Admin API latency matters less (operators tolerate 200ms), but a webhook endpoint that hangs for 30 seconds ties up a thread pool slot. Multiply by 50 subscriptions and a burst of events, and the admin API becomes unresponsive for tenant management.

The shared Redis queue solves both problems. Admin and runtime servers fire-and-forget — LPUSH a delivery ID to `dispatch:pending` and return immediately. The [events service](/glossary#events-service) does the slow work: load the event, look up the subscription, compute the HMAC signature, make the HTTP call, handle retries. If the events service falls behind, the queue buffers. If the events service is down entirely, events accumulate in Redis with a 90-day TTL and drain when it restarts.

Multiple events service instances can run concurrently. BRPOP is atomic — each delivery is processed by exactly one consumer. No distributed locking, no coordination, no split-brain risk. Scale horizontally by adding instances.

## Delivery guarantees: at-least-once with HMAC signing

We chose at-least-once delivery over exactly-once. In a distributed system where the webhook receiver is an external HTTP service, exactly-once is impossible without two-phase commit — and two-phase commit across the internet is a fiction. The practical choice is: deliver at least once and give receivers the tools to deduplicate.

Every delivery includes an `X-Cycles-Event-Id` header containing the event's unique ID. Receivers store processed event IDs and skip duplicates. This is the same pattern used by Stripe, GitHub, and every other webhook system at scale.

### Why HMAC-SHA256?

We evaluated four approaches for webhook payload verification:

| Approach | Proves Identity | Proves Integrity | Setup Complexity | Industry Standard |
|---|---|---|---|---|
| Bearer token in header | Yes | No | Low | Common but incomplete |
| IP allowlisting | Partial | No | Medium | Brittle with CDNs/proxies |
| mTLS | Yes | Yes | High | Heavy for webhook receivers |
| **[HMAC-SHA256](/glossary#hmac-sha256)** | **Yes** | **Yes** | **Low** | **GitHub, Stripe, Slack** |

HMAC-SHA256 proves both identity (the sender knows the shared secret) and integrity (the body hasn't been modified in transit). It requires no certificate infrastructure, no IP management, and no special HTTP client configuration. Receivers verify with 3 lines of code in any language.

The signature is sent in the `X-Cycles-Signature` header as `sha256=<hex>`, matching GitHub's webhook signature format. [Signing secrets](/glossary#signing-secret) can be encrypted at rest in Redis using AES-256-GCM (enabled via the `WEBHOOK_SECRET_ENCRYPTION_KEY` environment variable). When configured, a compromise of the Redis data store doesn't expose the signing secrets.

## Failure handling: what happens when things break

This is the section that matters most for on-call engineers evaluating whether to trust this system with their alerting pipeline.

| Scenario | What Happens | Recovery |
|---|---|---|
| Endpoint returns 500 | Retry with exponential backoff (default: 1s, 2s, 4s, 8s, 16s) | Auto-recovers when endpoint returns 2xx |
| Endpoint unreachable | Same retry sequence | Auto-recovers when reachable |
| Endpoint down for hours | Retries exhaust (5 by default) → delivery marked FAILED | Re-enable subscription via API, replay missed events |
| 10 consecutive failures | Subscription auto-disabled (status → DISABLED) | Fix endpoint, PATCH subscription to ACTIVE (resets counter) |
| Events service down | Events accumulate in Redis (90-day TTL) | Drains backlog on restart; deliveries older than 24h auto-fail |
| Redis down | Budget enforcement is unavailable; event delivery enqueue fails (logged, does not block API callers) | Enforcement and event delivery resume when Redis recovers |

Two design decisions are worth calling out:

**Stale delivery protection.** If the events service is down for a week and then restarts, it won't deliver week-old webhook notifications. Deliveries older than 24 hours (configurable via `MAX_DELIVERY_AGE_MS`) are automatically marked FAILED. This prevents flooding receivers with irrelevant historical alerts. If you need those events, use the replay API to selectively re-deliver.

**Auto-disable with manual re-enable.** After 10 consecutive delivery failures (configurable via `disable_after_failures`), the subscription is automatically disabled. This prevents hammering a dead endpoint for hours. Re-enabling is a single API call that resets the failure counter. We chose manual re-enable over automatic re-enable to avoid surprise traffic spikes when endpoints recover.

## Retention and resource management

Event data doesn't grow without bounds:

| Data | TTL | Cleanup |
|---|---|---|
| Event records (`event:{id}`) | 90 days | Redis EXPIRE on creation |
| Delivery records (`delivery:{id}`) | 14 days | Redis EXPIRE on creation |
| ZSET index entries | N/A | Hourly trimming via `RetentionCleanupService` |
| Dispatch queue (`dispatch:pending`) | Self-draining | Consumed by BRPOP |

All TTLs are configurable via environment variables (`EVENT_TTL_DAYS`, `DELIVERY_TTL_DAYS`) — no code changes, no redeployment. The events service is optional: if you don't deploy it, admin and runtime servers are completely unaffected. Events accumulate in Redis until either the TTL expires or you start the events service.

## Integration: PagerDuty in 5 minutes

Creating a webhook subscription and routing events to PagerDuty takes two steps:

```bash
# 1. Create subscription for critical budget events
curl -X POST http://localhost:7979/v1/admin/webhooks \
  -H "X-Admin-API-Key: $ADMIN_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "url": "https://your-middleware.example.com/cycles-to-pagerduty",
    "event_types": [
      "budget.exhausted",
      "budget.over_limit_entered",
      "reservation.denied"
    ]
  }'
```

The response includes a signing secret (returned once — store it). Your middleware transforms Cycles events into PagerDuty Events API v2 format, mapping `budget.exhausted` to severity `critical` and `reservation.denied` to `warning`. Use the `event_id` as PagerDuty's `dedup_key` to correlate retried deliveries to the same alert.

We have full integration guides with code examples for [PagerDuty, Slack, Datadog, Microsoft Teams, Opsgenie, and ServiceNow](/how-to/webhook-integrations), plus a [custom receiver pattern](/how-to/webhook-integrations#integration-custom-receiver-direct) with signature verification in Python, Node.js, and Go.

Tenants can also create their own webhook subscriptions via `/v1/webhooks` using their API key — restricted to budget, reservation, and tenant events (27 of 41 types as of post date; the live count is 27 of 47 — see the [Webhook Event Delivery Protocol](/protocol/webhook-event-delivery-protocol#tenant-accessible-events) for current category eligibility). Admin-only events (api_key, policy, webhook, system) require admin key access.

Webhook URLs are validated at creation time with SSRF protection enabled by default: RFC 1918 private IP ranges, loopback, and link-local addresses are blocked, and HTTPS is required in production. These can be configured via `PUT /v1/admin/config/webhook-security` for environments that need internal endpoint access.

## What's next

The v0.1.25 event system delivers threshold alerts at the default levels (80%, 95%, 100% utilization). Coming next on the implementation roadmap:

- **Per-subscription threshold customization**: override the default 80%/95%/100% thresholds for specific subscriptions — e.g., a high-priority workspace that should alert at 50%
- **Burn rate anomaly detection**: alert when spend rate exceeds the rolling average by a configurable multiplier
- **Rate spike detection**: alert on reservation denial rate spikes and expiry rate spikes across rolling windows

These are defined in the [v0.1.25 spec](https://github.com/runcycles/cycles-protocol/blob/main/cycles-governance-admin-v0.1.25.yaml) as `WebhookThresholdConfig`. The schema is finalized; server-side implementation is on the roadmap.

---

**Get started:**
- [Managing Webhooks](/how-to/managing-webhooks) — create, test, monitor, and troubleshoot subscriptions
- [Webhook Integrations](/how-to/webhook-integrations) — PagerDuty, Slack, Datadog, Teams, Opsgenie, ServiceNow code examples
- [Webhooks and Events Concepts](/concepts/webhooks-and-events) — architecture, delivery semantics, security model
- [Deploy the Full Stack](/quickstart/deploying-the-full-cycles-stack) — admin + runtime + events in one command
