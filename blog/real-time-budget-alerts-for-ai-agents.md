---
title: "Real-Time Budget Alerts for AI Agents"
date: 2026-04-01
author: Albert Mavashev
tags: [engineering, webhooks, architecture, observability]
description: "Design real-time AI agent budget alerts with webhooks, delivery guarantees, retry handling, and integrations for PagerDuty, Slack, and internal systems."
blog: true
sidebar: false
head:
  - - meta
    - name: keywords
      content: "webhook events, AI agent budget alerts, AI cost management, LLM spend control, HMAC signing, event-driven architecture, PagerDuty integration, budget monitoring, real-time alerts, webhook delivery, at-least-once delivery, webhook retry"
---

# Real-Time Budget Alerts for AI Agents: Designing Cycles' Webhook Event System

> **Part of: [LLM Cost Runtime Control Reference](/guides/llm-cost-runtime-control)** — the full pillar covering causes, enforcement patterns, multi-tenant boundaries, and unit economics.

Consider an illustrative scenario: an infrastructure team has budget dashboards. Prometheus scrapes every 15 seconds. Grafana panels show utilization curves. Application alert rules fire when thresholds cross 90%.

<!-- more -->

An agent hit a retry loop on a Friday afternoon. It burned through $450 of budget in under 3 minutes. The 90% threshold alert fired at minute one. The on-call engineer saw it at minute four — after the Slack notification, after checking context, after pulling up the dashboard. By then the budget was exhausted, 12 other agents in the same workspace were blocked, and a customer-facing workflow was down.

The monitoring worked. The problem was latency. Polling-based alerting has a structural delay between "state changed" and "someone knows about it." For budget enforcement, where a single runaway agent can exhaust funds in seconds, that delay is where the damage happens.

## The detection gap

The delivery paths have different latency characteristics:

| Detection Method | Detection boundary | Main delay |
|---|---|---|
| Polling dashboard | Next query or refresh | Poll interval |
| Prometheus alert | Next scrape plus alert rule evaluation | Scrape interval and configured `for` duration |
| Webhook event | Implemented state transition enqueues delivery | Queueing, receiver latency, and retries |

A webhook can avoid waiting for the next metrics scrape, but it is still asynchronous and has no sub-second end-to-end guarantee. The events service must be running, the event type must have an implemented emission hook, and delivery latency depends on the queue and receiver.

This is why we built a webhook event system into Cycles v0.1.25.

## 41 event types across 6 categories

> **As of post date.** The current Admin API `EventType` enum registers **51 event types across 7 categories** (the `webhook` category and the tenant-close cascade types were added later). For the live count and per-category breakdown, see the [Event Payloads Reference](/protocol/event-payloads-reference).

The original v0.1.25 schema organized 41 registered event types into 6 categories. Registration did not mean every type was emitted; the live reference distinguishes implemented hooks from planned types:

| Category | Count | Covers |
|---|---|---|
| **budget** | 16 | Created, funded, debited, reset, reset_spent (billing period), frozen, closed, threshold crossed, exhausted, over-limit, debt incurred, burn rate anomaly |
| **[reservation](/glossary#reservation)** | 5 | Denied, denial rate spike, expired, expiry rate spike, commit overage |
| **[tenant](/glossary#tenant)** | 6 | Created, updated, suspended, reactivated, closed, settings changed |
| **api_key** | 6 | Created, revoked, expired, permissions changed, auth failed, auth failure rate spike |
| **policy** | 3 | Created, updated, deleted |
| **system** | 5 | Store connection lost/restored, high latency, [webhook delivery](/glossary#webhook-delivery) failed, webhook test |

Examples of currently emitted events useful for incident response:

| Event | When It Fires | Why It Matters |
|---|---|---|
| `budget.exhausted` | A matching ledger transitions from positive remaining to zero | New positive reservations that derive that scope and unit may be denied |
| `budget.over_limit_entered` | A ledger transitions into `is_over_limit` | New reservations matching that ledger are blocked until state is reconciled |
| `reservation.denied` | A dry-run reserve or decide evaluation resolves to a budget-state denial | Inspect the hypothetical reason and scope; use runtime metrics/application errors for live 4xx denials |
| `reservation.commit_overage` | Committed actual exceeds the reservation estimate | Recalibrate estimates and inspect the overage policy result |
| `api_key.auth_failed` | Authentication attempt with invalid key | Security event — possible credential leak or misconfiguration |
| `system.webhook_delivery_failed` | A delivery permanently fails after retries | Inspect the event store or metrics; this loop-safe meta-event is not recursively delivered as another webhook |

`budget.threshold_crossed` and `system.store_connection_lost` are registered protocol event types but are not emitted by the current reference services.

Every event includes the common envelope fields defined by the protocol, including its type, category, source, tenant, and timestamp. Optional fields such as `actor`, `data`, and `scope` depend on the event type and producer. The runtime and admin services emit selected registered lifecycle events; registering an event type does not guarantee that every state change produces one. A matching [webhook subscription](/glossary#webhook-subscription) can receive events from both planes.

## Architecture: why a separate delivery service

The most important engineering decision in this system: webhook delivery runs as its own service, separate from the runtime enforcement server and the admin API.

```
Runtime server (port 7878) ──┐
                             ├── LPUSH dispatch:pending
Admin server (port 7979) ────┘
                                    │
                              Redis ─┤
                                    │
Events service (port 7980) ── BLMOVE pending → processing
                                  │
                                  └── HTTP POST with HMAC → durable state → ack
```

Three services, three workloads, three scaling profiles:

| Service | Workload | Latency Target | Scaling Driver |
|---|---|---|---|
| Runtime (reserve-commit) | Synchronous, hot path | [Reserve 7.9ms and commit 5.7ms p99 in the published v0.1.25.3 benchmark](/blog/cycles-server-performance-benchmarks) | Agent request volume |
| Admin (CRUD) | Synchronous, operator-facing | Deployment-defined | Human and automation requests |
| Events (webhook delivery) | Asynchronous, variable latency | At-least-once with retries; no fixed latency SLO | Subscription count × event rate |

Why not embed delivery in the runtime server? Webhook endpoints are external HTTP services with unpredictable latency. A slow endpoint or DNS timeout can add hundreds of milliseconds to the reserve-commit path. The published v0.1.25.3 benchmark measured a reserve-plus-commit lifecycle at 18.4ms p99 on its stated hardware, so external delivery latency belongs off that hot path. Even a background executor needs strict isolation and backpressure to avoid resource contention with request processing.

Why not embed in the [admin server](/glossary#admin-server)? Same problem, different magnitude. Admin API latency matters less (operators tolerate 200ms), but a webhook endpoint that hangs for 30 seconds ties up a thread pool slot. Multiply by 50 subscriptions and a burst of events, and the admin API becomes unresponsive for tenant management.

The shared Redis queue isolates both workloads. Admin and runtime producers enqueue delivery IDs on `dispatch:pending`; the [events service](/glossary#events-service) does the slow work: load the event and subscription, compute the HMAC signature, make the HTTP call, and handle retries. If the worker falls behind, pending IDs buffer in Redis. Event records default to a 90-day TTL and delivery records to 14 days; on restart, deliveries older than the configured 24-hour maximum age are failed rather than sent late.

Multiple events service instances can safely share the queue. `BLMOVE` atomically claims a delivery from `dispatch:pending` into `dispatch:processing`; durable state and retry writes precede an owner-token-checked acknowledgement, and stale in-flight claims can be recovered. Delivery remains at-least-once, so a crash or ambiguous HTTP outcome can produce a redelivery. A fleet-wide ordering lease currently serializes the claim/send section: extra replicas provide failover, not additional webhook throughput.

## Delivery guarantees: at-least-once with HMAC signing

The reference service uses at-least-once delivery. Because it cannot atomically commit both the receiver's external side effect and its own acknowledgement, an ambiguous outcome can be redelivered. Receivers therefore need idempotent processing or event-ID deduplication.

Every delivery includes an `X-Cycles-Event-Id` header containing the event's unique ID. Receivers store processed event IDs and skip duplicates, a standard webhook idempotency pattern.

### Why HMAC-SHA256?

We evaluated four approaches for webhook payload verification:

| Approach | Proves Identity | Proves Integrity | Setup Complexity | Industry Standard |
|---|---|---|---|---|
| Bearer token in header | Yes | No | Low | Common but incomplete |
| IP allowlisting | Partial | No | Medium | Brittle with CDNs/proxies |
| mTLS | Yes | Yes | High | Heavy for webhook receivers |
| **[HMAC-SHA256](/glossary#hmac-sha256)** | **Yes** | **Yes** | **Low** | **GitHub, Stripe, Slack** |

HMAC-SHA256 proves possession of the shared secret and protects body integrity in transit. It requires no certificate infrastructure or IP allowlist, and common cryptography libraries can verify it.

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
| Dispatch queue (`dispatch:pending`) | Self-draining | Claimed by `BLMOVE` into `dispatch:processing` |
| In-flight queue (`dispatch:processing`) | Self-draining | Acked after durable state/retry writes; stale claims recovered to pending |

Record TTLs are configurable through `EVENT_TTL_DAYS` and `DELIVERY_TTL_DAYS`; changing them requires updating the service configuration and restarting the affected deployment, but no code change. The events service is optional for runtime budget enforcement. Without it, webhook deliveries are not processed, and queued records remain only for their configured retention windows.

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

The response includes a signing secret (returned once—store it). Your middleware can map `budget.exhausted` to severity `critical` and `reservation.denied` to a nonpaging calibration signal. Use the `event_id` as PagerDuty's `dedup_key` to correlate retried deliveries to the same alert. Live reservation errors require a metric or application alert because the current exception path does not emit `reservation.denied`.

We have full integration guides with code examples for [PagerDuty, Slack, Datadog, Microsoft Teams, Opsgenie, and ServiceNow](/how-to/webhook-integrations), plus a [custom receiver pattern](/how-to/webhook-integrations#integration-custom-receiver-direct) with signature verification in Python, Node.js, and Go.

Tenants can also create their own webhook subscriptions via `/v1/webhooks` using their API key — restricted to budget, reservation, and tenant events (27 of 41 types as of post date; the live count is 29 of 51 — see the [Webhook Event Delivery Protocol](/protocol/webhook-event-delivery-protocol#tenant-accessible-events) for current category eligibility). Admin-only events (api_key, policy, webhook, system) require admin key access.

Webhook URLs are validated at creation time with SSRF protection enabled by default: RFC 1918 private IP ranges, loopback, and link-local addresses are blocked, and HTTPS is required in production. These can be configured via `PUT /v1/admin/config/webhook-security` for environments that need internal endpoint access.

## Registered but not yet emitted alerts

The v0.1.25 governance schema registers `WebhookThresholdConfig` and event types for utilization thresholds, burn-rate anomalies, and reservation denial/expiry spikes. The current reference services do not produce those automatic alerts. Use Prometheus or application telemetry for pre-exhaustion thresholds today, and consult the [Event Payloads Reference](/protocol/event-payloads-reference) before subscribing to a registered event type.

---

**Get started:**
- [Managing Webhooks](/how-to/managing-webhooks) — create, test, monitor, and troubleshoot subscriptions
- [Webhook Integrations](/how-to/webhook-integrations) — PagerDuty, Slack, Datadog, Teams, Opsgenie, ServiceNow code examples
- [Webhooks and Events Concepts](/concepts/webhooks-and-events) — architecture, delivery semantics, security model
- [Deploy the Full Stack](/quickstart/deploying-the-full-cycles-stack) — admin + runtime + events in one command

## Related how-to guides

- [Rolling over billing periods](/how-to/rolling-over-billing-periods-with-reset-spent)
- [Prometheus metrics reference](/how-to/prometheus-metrics-reference)
- [Multi-tenant SaaS guide](/how-to/multi-tenant-saas-with-cycles)
