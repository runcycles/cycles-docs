---
title: Webhooks and Events
description: How Cycles emits events and delivers them to external systems via webhooks
---

# Webhooks and Events

Cycles emits **events** for every observable state change — budget exhaustion, reservation denials, tenant lifecycle changes, API key operations, and system health. **Webhooks** deliver these events to external endpoints via HTTP POST with HMAC-SHA256 signatures.

## Core Concepts

### Events

An event is an immutable record of a state change. Every event has:
- **event_id** — unique identifier; the key consumers dedupe on
- **event_type** — dotted format like `budget.exhausted` or `reservation.denied`
- **category** — one of: budget, reservation, tenant, api_key, policy, webhook, system
- **timestamp** — when the event occurred
- **tenant_id** — which tenant is affected
- **source** — which service emitted it (an open string; e.g. `cycles-server`, `cycles-admin`, `expiry-sweeper`, `anomaly-detector`)
- **data** — optional event-specific payload (varies by type)

Events are stored in Redis with a 90-day TTL (configurable).

### Webhook Subscriptions

A subscription defines which events to deliver and where:
- **url** — HTTPS endpoint to receive HTTP POST requests
- **event_types** — specific events to receive (e.g., `["budget.exhausted", "reservation.denied"]`)
- **event_categories** — receive all events in a category (additive with event_types)
- **scope_filter** — optional scope-path filter; only events whose scope matches are delivered (see [Webhook Scope Filter Syntax](/protocol/webhook-scope-filter-syntax))
- **signing_secret** — HMAC-SHA256 key for payload verification

### Delivery Semantics

- **At-least-once** — events may be delivered more than once. Deduplicate using `event_id`.
- **Best-effort ordering** — first-attempt deliveries are dispatched from a single FIFO queue, but retried deliveries may arrive out of order. Consumers should dedupe and sequence on `event_id` and timestamp.
- **Non-blocking** — webhook delivery never blocks the API operation that produced the event.
- **Retry with backoff** — failed deliveries retry with exponential backoff (default: 5 retries).
- **Auto-disable** — subscriptions are disabled after consecutive failures (default: 10).

## Architecture

<EventFlowDiagram />

The events service is **optional**. If not deployed, events accumulate in Redis with TTL and are delivered when the service starts.

## 51 Registered Event Types

| Category | Count | Examples |
|---|---|---|
| budget | 17 | `budget.exhausted`, `budget.threshold_crossed`, `budget.over_limit_entered`, `budget.funded`, `budget.closed_via_tenant_cascade` |
| reservation | 6 | `reservation.denied`, `reservation.commit_overage`, `reservation.released_via_tenant_cascade` |
| tenant | 6 | `tenant.created`, `tenant.suspended`, `tenant.closed` |
| api_key | 7 | `api_key.created`, `api_key.revoked`, `api_key.revoked_via_tenant_cascade` |
| policy | 3 | `policy.created`, `policy.updated`, `policy.deleted` |
| webhook | 7 | `webhook.created`, `webhook.paused`, `webhook.disabled_via_tenant_cascade` |
| system | 5 | `system.store_connection_lost`, `system.webhook_delivery_failed` |

The four `*_via_tenant_cascade` types were added to the enum in governance spec revision v0.1.25.35.

## Tenant Self-Service

Tenants can create their own webhook subscriptions via `/v1/webhooks` (requires `webhooks:write` permission). Tenant webhooks are restricted to budget, reservation, and tenant events: 29 of the 51 registered event types — including the `budget.*` and `reservation.*` `_via_tenant_cascade` fan-out events emitted during a tenant close (see [Tenant-Close Cascade Semantics](/protocol/tenant-close-cascade-semantics)). API key, policy, webhook lifecycle, and system events are admin-only: a tenant-owned subscription can neither carry them nor receive them from the event stream, enforced at write, dispatch, and last-mile delivery (governance WEBHOOK SUBSCRIPTION INVARIANT 2; the one exception is the owner-triggered `/test` probe — see [Tenant-accessible events](/protocol/webhook-event-delivery-protocol#tenant-accessible-events)).

## Security

- **HMAC-SHA256** — every delivery includes `X-Cycles-Signature: sha256=<hex>` for payload verification
- **Encryption at rest** — signing secrets are encrypted in Redis with AES-256-GCM using `WEBHOOK_SECRET_ENCRYPTION_KEY`; admin and events fail startup without the key unless plaintext is explicitly enabled for local development
- **SSRF prevention** — private IP ranges blocked by default, HTTPS required in production

## Learn More

- [Webhook Integrations Guide](/how-to/webhook-integrations) — PagerDuty, Slack, ServiceNow examples with code
- [Security Hardening](/how-to/security-hardening) — webhook URL security and secret rotation
- [Production Operations](/how-to/production-operations-guide) — events service deployment and failure handling
