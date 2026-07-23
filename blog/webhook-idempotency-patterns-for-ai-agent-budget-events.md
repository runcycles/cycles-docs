---
title: "Webhook Idempotency for Agent Budget Events"
date: 2026-04-24
author: Albert Mavashev
tags:
  - webhook
  - engineering
  - reliability
  - production
  - runtime-authority
  - best-practices
  - integrations
description: "How to design idempotent webhook receivers for Cycles budget events: X-Cycles-Event-Id dedup, HMAC verification, Redis vs Postgres patterns, and replay testing."
blog: true
sidebar: false
featured: false
head:
  - - meta
    - name: keywords
      content: webhook idempotency, at-least-once delivery, X-Cycles-Event-Id, HMAC webhook verification, deduplication, budget events, Stripe-style webhooks
---

# Webhook Idempotency Patterns for AI Agent Budget Events

At 11:42 PM, PagerDuty fires on a `reservation.denied` event. At 11:42 PM, PagerDuty fires again on the same `reservation.denied` event. The on-call engineer pages an agent owner twice, who calmly notes that there's only one denial in the Cycles audit log. The webhook delivered twice, the pager receiver processed both deliveries, and the duplicate turned one incident into two acknowledgments and twice the noise budget.

This is what at-least-once delivery actually looks like in production. It's not a bug in the webhook pipeline — it's the contract. Cycles' event delivery, like Stripe's webhooks, GitHub's deliveries, and AWS SNS messages, offers at-least-once semantics, which is another way of saying "assume your receiver will see the same event more than once and design accordingly." Teams that skip the dedup step aren't absent from the contract; they're just the receiver that didn't hold up their end.

This post is about what "hold up their end" looks like. Cycles ships a specific header, a specific signing shape, and a specific retry schedule, and the idempotency story follows cleanly once the contract is visible. Three working receiver patterns — Redis for speed, Postgres for durability, and a minimal Node.js variant — cover most real production shapes.

<!-- more -->

## What Cycles actually delivers

Every outbound webhook POST Cycles makes carries four headers worth knowing by name:

| Header | Purpose |
|---|---|
| `X-Cycles-Event-Id` | Unique identifier per *event*, format `evt_*`. The primary dedup key. |
| `X-Cycles-Signature` | HMAC-SHA256 over the raw JSON body, format `sha256=<hex>`. Proves sender identity. |
| `X-Cycles-Trace-Id` | 32-hex W3C Trace Context id for cross-plane correlation. |
| `traceparent` | Full W3C Trace Context header (`version-trace_id-span_id-flags`) so consumer tracers parent their spans. |

The delivery contract the rest of this post assumes:

- **At-least-once delivery.** Retries happen on network timeouts, events-service restarts, and operator-triggered event replay. The same `X-Cycles-Event-Id` may arrive multiple times.
- **Exponential backoff.** Default schedule is 1s, 2s, 4s, 8s, 16s — capped at 60s — across up to six total attempts (initial + five retries). Success is any HTTP 2xx; any other response is a retry.
- **Auto-disable after ten consecutive failures.** The subscription is paused and must be re-enabled via `PATCH /v1/admin/webhooks/{id}`. This prevents a permanently broken receiver from accumulating a backlog of stale deliveries.
- **Stale-delivery timeout.** Deliveries older than 24 hours are marked `FAILED` without another HTTP attempt.

The full spec lives in [Webhook Event Delivery Protocol](/protocol/webhook-event-delivery-protocol). The [Security](/security#webhook-security) page covers signing-secret rotation and SSRF protection. This post focuses on the receiver side.

## The duplicate-cost trap

The most expensive consequence of skipping dedup isn't double-pager noise. It's cost amplification downstream.

A Cycles `budget.threshold_crossed` event that fires twice, each triggering a Slack notification plus a Datadog metric plus a database row, multiplies its downstream footprint by two. A `budget.debited` event duplicated through a receiver that writes to an internal ledger will double-charge that ledger. A `tenant.closed` cascade event that naively triggers a customer-email flow sends two emails on the same close.

The shape of the damage is consistent: the Cycles event is the root-of-trust statement ("this happened once"), and every duplicate processing of that event multiplies its side effects in downstream systems that have no way to know the event was a retry. Dedup at the receiver is what closes that gap.

For a deeper treatment of how retry behaviors amplify across an agent stack, see [Retry Storms and Idempotency in Agent Budget Systems](/blog/retry-storms-and-idempotency-in-agent-budget-systems). This post is the receiver-side counterpart: the retry contract is unavoidable, so the receiver's job is to make duplicate delivery indistinguishable from single delivery by the time any side effect fires.

## Pattern 1 — Redis `SET NX` for fast dedup

The shortest path to a correct receiver. Store every seen `X-Cycles-Event-Id` with a TTL comfortably longer than Cycles' stale-delivery window (default 24h). Redis's `SET NX` ("set if not exists") returns `False` when the key already existed, which is your dedup signal.

```python
from fastapi import FastAPI, Request, HTTPException
import hmac, hashlib, os, redis

app = FastAPI()
r = redis.from_url(os.environ["REDIS_URL"])
SIGNING_SECRET = os.environ["CYCLES_SIGNING_SECRET"].encode()

def verify(body: bytes, header: str) -> bool:
    expected = "sha256=" + hmac.new(SIGNING_SECRET, body, hashlib.sha256).hexdigest()
    # Constant-time compare to avoid timing attacks
    return hmac.compare_digest(expected, header or "")

@app.post("/cycles/webhook")
async def handle_webhook(request: Request):
    body = await request.body()
    sig = request.headers.get("x-cycles-signature", "")
    event_id = request.headers.get("x-cycles-event-id", "")

    if not verify(body, sig):
        raise HTTPException(401, "bad signature")
    if not event_id:
        raise HTTPException(400, "missing event id")

    # Dedup: SET NX returns True only for the first delivery
    if not r.set(f"seen:{event_id}", "1", nx=True, ex=48 * 3600):
        return {"status": "duplicate", "event_id": event_id}

    event = await request.json()
    # ...route to PagerDuty / Slack / Datadog / internal ledger
    return {"status": "processed", "event_id": event_id}
```

A 48-hour TTL leaves comfortable margin above Cycles' 24-hour stale-delivery ceiling. Shorter TTLs risk processing a replayed event as new; longer TTLs cost Redis memory without materially improving protection for the default delivery window. Operators who run their own long-tail replay processes may want to keep a longer dedup window deliberately.

The `hmac.compare_digest` call is doing real work. A naive `==` comparison leaks the position of the first mismatched byte through timing, which is enough for a sufficiently motivated attacker to forge a valid signature one byte at a time. Use the standard library's constant-time compare — every modern language ships one.

## Pattern 2 — Postgres `INSERT ... ON CONFLICT` for durable dedup

When dedup state must survive a Redis flush, or when the receiver already talks to Postgres for its own state, an UPSERT is cleaner than a second datastore:

```python
# Same HMAC verify as above; dedup now lives in Postgres
async def handle_webhook_durable(request: Request, db):
    body = await request.body()
    sig = request.headers.get("x-cycles-signature", "")
    event_id = request.headers.get("x-cycles-event-id", "")

    if not verify(body, sig):
        raise HTTPException(401, "bad signature")
    if not event_id:
        raise HTTPException(400, "missing event id")

    # Returns 1 row inserted if new, 0 if duplicate
    inserted = await db.execute("""
        INSERT INTO processed_cycles_events (event_id, processed_at)
        VALUES ($1, NOW())
        ON CONFLICT (event_id) DO NOTHING
    """, event_id)

    if inserted == 0:
        return {"status": "duplicate", "event_id": event_id}

    event = await request.json()
    # ...side effects
    return {"status": "processed", "event_id": event_id}
```

Two operational notes:

- **Primary key on `event_id`** is what makes the dedup work. Don't be clever with a surrogate key.
- **Prune the table.** A daily job that deletes rows older than 48 hours keeps the table small; the audit record of which events were processed should live in the receiver's domain table, not in the dedup index.

## Pattern 3 — Node.js / Express with a raw-body verify

The Express gotcha worth calling out: by default, `body-parser` consumes the request stream, leaving the HMAC check to recompute against the *parsed-then-reserialized* body, which whitespace-dependent signatures will reject. Capture the raw body first.

```javascript
const express = require('express');
const crypto = require('crypto');
const Redis = require('ioredis');

const app = express();
const redis = new Redis(process.env.REDIS_URL);
const SIGNING_SECRET = process.env.CYCLES_SIGNING_SECRET;

// Capture raw body alongside the parsed version
app.use('/cycles/webhook', express.json({
  verify: (req, _res, buf) => { req.rawBody = buf; }
}));

function verify(rawBody, header) {
  const expected = 'sha256=' + crypto
    .createHmac('sha256', SIGNING_SECRET)
    .update(rawBody)
    .digest('hex');
  // timingSafeEqual requires equal-length Buffers
  const a = Buffer.from(expected);
  const b = Buffer.from(header || '');
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

app.post('/cycles/webhook', async (req, res) => {
  if (!verify(req.rawBody, req.get('x-cycles-signature'))) {
    return res.status(401).send('bad signature');
  }
  const eventId = req.get('x-cycles-event-id');

  // SET with NX + EX in one atomic call
  const fresh = await redis.set(`seen:${eventId}`, '1', 'EX', 172800, 'NX');
  if (fresh === null) {
    return res.status(200).json({ status: 'duplicate', event_id: eventId });
  }

  // ...side effects
  res.status(200).json({ status: 'processed', event_id: eventId });
});
```

## Dedup across the boundary

Most real receivers aren't the last stop — they relay to PagerDuty, Slack, Datadog, or an internal ledger. Each of those downstream systems has its own dedup primitive: PagerDuty exposes a `dedup_key`, Slack is effectively single-shot per channel, Datadog dedups metrics by tag tuple.

The pattern that keeps downstream duplicates from sneaking through: *use the Cycles `X-Cycles-Event-Id` as the dedup key on outbound calls wherever the downstream supports one*. A Cycles event that becomes a PagerDuty incident should pass `evt_abc123` as PagerDuty's `dedup_key`. If Cycles retries and your own receiver dedup somehow misses (a Redis flush, a race), PagerDuty's second-layer dedup will still collapse them into one alert.

This is the same insight that makes Stripe's webhook guidance recommend you [process the event only once](https://docs.stripe.com/webhooks#handle-duplicate-events) using the top-level `id`: the event ID carried through every hop of the delivery chain is cheaper than reconstructing it later. GitHub's [`X-GitHub-Delivery`](https://docs.github.com/en/webhooks/using-webhooks/handling-webhook-deliveries#ensuring-secure-deliveries) plays the same role. Cycles' `X-Cycles-Event-Id` is the equivalent primitive.

For the `trace_id` propagation story — how the W3C header on each webhook delivery lets downstream consumers parent their tracing spans under the originating budget decision — see [W3C Trace Context for AI Agent Debugging](/blog/w3c-trace-context-ai-agent-debugging).

## Testing idempotency

The easiest replay loop uses the admin API's webhook-delivery history:

```bash
# List recent deliveries for a subscription
curl -s -H "X-Admin-API-Key: $ADMIN_KEY" \
  "http://localhost:7979/v1/admin/webhooks/whsub_abc/deliveries?limit=5" | jq

# Trigger a replay on this subscription
curl -X POST -H "X-Admin-API-Key: $ADMIN_KEY" \
  "http://localhost:7979/v1/admin/webhooks/whsub_abc/replay"
```

The replay re-sends the original POST to the configured URL with the same `X-Cycles-Event-Id`. A correctly-built receiver will verify the signature, check its dedup store, and return `200 {"status": "duplicate"}` without firing a side effect. A receiver without dedup will fire twice.

A minimal test harness:

```python
def test_duplicate_event_is_ignored(client):
    event = {"event_type": "reservation.denied", "tenant_id": "acme", ...}
    headers = sign(event)

    r1 = client.post("/cycles/webhook", json=event, headers=headers)
    r2 = client.post("/cycles/webhook", json=event, headers=headers)

    assert r1.status_code == 200
    assert r2.status_code == 200
    assert count_side_effects() == 1
```

Run this against every receiver you ship. The test is trivial; the failure it catches — a duplicate charge, a double-page, a double-email — is the kind of incident that leaves an apology in the postmortem.

## The operational takeaway

At-least-once delivery isn't a Cycles quirk; it's the delivery contract every major webhook system has chosen over the alternatives (at-most-once loses events on a single network glitch; exactly-once requires consensus the sender and receiver don't share). The receiver's job is the dedup half of that contract. Four working moves:

1. Capture and store `X-Cycles-Event-Id` with a 24–48 hour TTL using whichever backing store you trust for durability.
2. Verify the `X-Cycles-Signature` on the *raw* body, with a constant-time compare.
3. Propagate `X-Cycles-Event-Id` into any downstream dedup key your integrations support.
4. Test replay — the admin API's delivery-replay endpoint makes this a five-minute check.

Four moves, and the duplicate-pager incident at the top of this post becomes a non-event.

## Related reading

- [Webhook Event Delivery Protocol](/protocol/webhook-event-delivery-protocol) — the authoritative spec for delivery, retry, headers, and status lifecycle
- [Security — Webhook security](/security#webhook-security) — HMAC signing, SSRF protection, signing-secret encryption at rest
- [Webhook Integrations](/how-to/webhook-integrations) — verification code in Python, Node.js, Go, and Java with PagerDuty / Slack / Datadog / Teams / ServiceNow examples
- [Real-Time Budget Alerts for AI Agents](/blog/real-time-budget-alerts-for-ai-agents) — the event-system architecture the receiver is talking to
- [Operational Runbook: Using Cycles Runtime Events](/blog/operational-runbook-using-cycles-runtime-events) — severity tiers and triage patterns for the events you're about to dedup on
- [Retry Storms and Idempotency in Agent Budget Systems](/blog/retry-storms-and-idempotency-in-agent-budget-systems) — the sender-side counterpart to this receiver-side playbook
- [W3C Trace Context for AI Agent Debugging](/blog/w3c-trace-context-ai-agent-debugging) — how `trace_id` + `traceparent` on outbound webhooks let downstream consumers parent their tracing spans
- [Stripe's webhook best practices](https://docs.stripe.com/webhooks#handle-duplicate-events) — the canonical industry precedent for at-least-once handling
- [GitHub webhook delivery handling](https://docs.github.com/en/webhooks/using-webhooks/handling-webhook-deliveries) — `X-GitHub-Delivery` as the sibling primitive to `X-Cycles-Event-Id`
