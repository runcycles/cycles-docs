---
title: "Webhook Delivery That Operators Can Trust"
date: 2026-05-01
author: Albert Mavashev
tags:
  - webhook
  - operations
  - reliability
  - incident-response
  - security
description: "A production webhook delivery contract for AI agent events: signed bodies, retries, dedupe keys, stale cutoffs, auto-disable, replay, and traceability."
blog: true
sidebar: false
featured: false
head:
  - - meta
    - name: keywords
      content: webhook delivery, AI agent events, HMAC signature, at-least-once delivery, webhook retries, webhook replay, incident response
---

# Webhook Delivery That Operators Can Trust

A budget denial event fires at 2:14 AM. PagerDuty never opens an incident. Slack never receives the message. The agent owner keeps seeing retries, but the receiver logs are empty because the reverse proxy dropped the request body on the way in.

The problem is not that the event system failed to be clever. The problem is that the delivery contract was not explicit enough for operators to debug it under pressure.

Webhooks become production control signals only when delivery behavior is boring and inspectable: which headers are sent, how signatures are computed, when retries happen, when stale deliveries are abandoned, when broken subscriptions auto-disable, and how replay works.

This is the contract Cycles exposes for AI agent budget and governance events.

## The minimum trustworthy delivery contract

An operator-trustworthy webhook system needs more than "we POST JSON to your endpoint."

| Contract piece | Why operators need it |
|---|---|
| Stable event ID | Deduplicate retries and replay |
| HMAC signature | Verify the event came from the expected sender |
| Trace headers | Join receiver logs to runtime, admin, and audit planes |
| Retry schedule | Predict how long a receiver outage will keep retrying |
| Stale cutoff | Avoid delivering events that are no longer actionable |
| Auto-disable behavior | Stop permanently broken receivers from generating noise forever |
| Delivery history and replay | Reproduce receiver behavior after fixing the endpoint |

Without those details, every incident turns into guesswork: was the event emitted, queued, signed, delivered, retried, ignored, duplicated, or replayed?

## What every Cycles delivery carries

Every outbound [webhook delivery](/glossary#webhook-delivery) includes JSON plus a small set of operational headers:

| Header | Purpose |
|---|---|
| `X-Cycles-Event-Id` | Unique event ID used for deduplication |
| `X-Cycles-Event-Type` | Dot-notation event type such as `budget.exhausted` |
| `X-Cycles-Signature` | [HMAC-SHA256](/glossary#hmac-sha256) over the raw request body using the subscription's [signing secret](/glossary#signing-secret) |
| `X-Cycles-Trace-Id` | 32-hex trace ID shared across runtime, events, audit, and delivery |
| `traceparent` | W3C Trace Context header for downstream tracing |
| `X-Request-Id` | Optional implementation mirror of the event `request_id`; treat the JSON body's `request_id` as the portable contract |

The body is the event object: event type, category, timestamp, [tenant](/glossary#tenant), scope, actor, data, correlation ID, request ID, trace ID, and metadata where present.

That means a receiver can answer three questions without guessing:

1. **Have I processed this exact event before?** Use `X-Cycles-Event-Id`.
2. **Can I trust this body?** Verify `X-Cycles-Signature` against the raw bytes.
3. **Where did this event come from?** Join on `X-Cycles-Trace-Id`, `traceparent`, `request_id`, or `correlation_id`.

For the full delivery reference, see [Webhook Event Delivery Protocol](/protocol/webhook-event-delivery-protocol).

## At-least-once means receivers dedupe

Cycles webhooks are delivered at least once. Duplicates can happen when a network timeout hides a successful receiver response, when the [events service](/glossary#events-service) restarts during delivery, or when an operator replays a delivery.

Events for the same tenant are dispatched in order. Cross-tenant ordering is not guaranteed, so a receiver that aggregates across tenants must not assume a global timeline from arrival order.

That is the right reliability tradeoff for budget and governance events. Losing a `reservation.denied` event is worse than delivering it twice, as long as the receiver deduplicates correctly.

The receiver contract is simple:

```text
verify signature -> dedupe event ID -> perform side effect -> return 2xx
```

The dedupe key is `X-Cycles-Event-Id`. Store it with a TTL at least as long as the delivery replay window you care about. The existing [Webhook Idempotency Patterns](/blog/webhook-idempotency-patterns-for-ai-agent-budget-events) post covers Redis and Postgres receiver implementations in detail.

The important operator point: duplicates are not evidence that the event service is broken. Duplicates are part of the delivery contract. A receiver that pages twice on the same `evt_*` has a receiver bug.

## Retry policy should be visible

Failed deliveries retry with exponential backoff. The default schedule is:

| Attempt | Delay before retry |
|---|---|
| 1 | Immediate initial delivery |
| 2 | 1 second |
| 3 | 2 seconds |
| 4 | 4 seconds |
| 5 | 8 seconds |
| 6 | 16 seconds |

Success is any HTTP 2xx response. Non-2xx responses, timeouts, and transport failures are retryable until retries are exhausted or the delivery becomes stale.

This predictability matters during incidents. If the receiver returns 500 for ten minutes, operators should be able to estimate whether delivery is still retrying, permanently failed, or already stale. They should not have to read service logs to infer the retry ladder.

## Stale delivery cutoff prevents old control signals

Some events are no longer useful after enough time has passed. A `budget.threshold_crossed` event from yesterday may be useful for reporting, but it should not page someone as if the threshold crossed right now. A `system.webhook_delivery_failed` event from an old outage can create false urgency if it lands after the system recovered.

Cycles marks deliveries older than the configured maximum delivery age as `FAILED` without another HTTP attempt. The default is 24 hours.

That stale cutoff is an operator safety feature. It separates durable event history from real-time alert delivery. You can still query events and audit logs, but the webhook pipeline stops pretending old messages are live control signals.

## Auto-disable turns permanent failure into state

Retries handle temporary failure. They do not solve a receiver that is permanently broken: deleted endpoint, bad DNS, expired certificate, wrong HMAC secret, or a handler that always returns 500.

Cycles tracks consecutive delivery failures per subscription. After the configured threshold (default: 10 consecutive failures), the subscription transitions to `DISABLED`. Disabled subscriptions do not keep retrying forever; an operator must fix the receiver and re-enable the subscription.

That transition should be treated like an incident signal:

| Symptom | Likely operator action |
|---|---|
| One delivery failed | Inspect receiver logs and wait for retry |
| Repeated retries | Check endpoint health, signature secret, and reverse proxy behavior |
| Subscription disabled | Fix receiver, replay failed deliveries that exist in delivery history, then re-enable |
| Frequent disable/re-enable loop | Move the receiver behind a more reliable queue or simplify the handler |

Auto-disable is not punishment. It prevents a broken integration from becoming an infinite noise generator.

## Replay should be safe

Operators need replay for two reasons:

1. The receiver was broken and has been fixed.
2. The receiver behavior needs to be reproduced during debugging.

Replay uses the same event identity. A replayed delivery carries the same `X-Cycles-Event-Id`, so a correct receiver recognizes it as duplicate if the original side effect already happened. If the original delivery never processed, replay performs the side effect once.

That is why receiver idempotency and delivery replay have to be designed together. Replay without dedupe can double-page, double-write, or double-charge. Dedupe without replay leaves operators unable to recover after an outage.

## A receiver checklist

Before treating a [webhook subscription](/glossary#webhook-subscription) as production incident infrastructure, configure a signing secret and verify these behaviors:

| Check | Expected behavior |
|---|---|
| Missing signature | Receiver rejects the request |
| Bad signature | Receiver rejects the request with no side effect |
| Duplicate event ID | Receiver returns 2xx and performs no second side effect |
| Valid event | Receiver performs exactly one side effect |
| Slow receiver | Delivery retries according to policy |
| Receiver outage | Subscription eventually disables after consecutive failures |
| Replay after success | Receiver reports duplicate and does not repeat the action |
| Replay after missed delivery | Receiver processes the event once |

The point is not to make webhooks complicated. The point is to make the failure modes testable before the first incident depends on them.

## The takeaway

Operators trust webhook delivery when the contract is explicit. Event IDs make duplicates survivable. Signatures make spoofing detectable. Trace headers make debugging joinable. Retry, stale cutoff, auto-disable, and replay make delivery behavior predictable under failure.

For AI agent governance, those details matter because the webhook is often the bridge between [runtime authority](/glossary#runtime-authority) and human response. A `DENY` decision, a budget exhaustion event, a tenant close, or a webhook failure is only operationally useful if the delivery path is observable enough to trust at 2 AM.

## Related reading

- [Webhook Event Delivery Protocol](/protocol/webhook-event-delivery-protocol) — headers, payload shape, retry policy, lifecycle states, and event types
- [Webhook Integrations](/how-to/webhook-integrations) — PagerDuty, Slack, ServiceNow, Datadog, Teams, and direct receiver examples
- [Webhook Idempotency Patterns for AI Agent Budget Events](/blog/webhook-idempotency-patterns-for-ai-agent-budget-events) — receiver-side dedupe patterns
- [Deploying the Events Service](/quickstart/deploying-the-events-service) — operating the async delivery worker
- [Operational Runbook: Using Cycles Runtime Events](/blog/operational-runbook-using-cycles-runtime-events) — on-call use of runtime events
- [W3C Trace Context for AI Agent Debugging](/blog/w3c-trace-context-ai-agent-debugging) — tracing budget decisions through webhook delivery
