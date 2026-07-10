---
title: "Correlation and Tracing in Cycles"
description: "W3C Trace Context correlation in Cycles — the three-tier model (request_id, trace_id, correlation_id), inbound header precedence, and cross-plane queries."
---

# Correlation and Tracing in Cycles

Cycles produces data on four planes — runtime responses, webhook deliveries, audit-log entries, and emitted events. Correlation identifiers stitch those planes into a single causal picture.

As of the 2026-04-18 spec revision (`cycles-protocol-v0.yaml`), Cycles implements a W3C Trace Context-compatible correlation contract across every server in the suite. This page is the authoritative reference.

## The three-tier model

Cycles carries three correlation identifiers, each with a different grain.

| Identifier | Grain | Lifetime |
|---|---|---|
| `request_id` | One HTTP request | Per-request |
| `trace_id` | One logical operation (may span many requests) | Per-operation |
| `correlation_id` | An event-stream cluster (groups related events) | Server-derived, deterministic |

- **`request_id`** is server-generated for every inbound HTTP request. It appears in every error response, audit-log entry, and event that is causally downstream of that request. Use it to correlate the side effects of one specific HTTP call.
- **`trace_id`** identifies a logical operation that may cross several HTTP boundaries (for example: a client's reserve → multiple provider retries → commit). It is a 32-hex-character W3C Trace Context-compatible identifier. Use it to reconstruct the full operation across planes.
- **`correlation_id`** is set by the server, in one of two shapes depending on the emitting plane. **Protocol event-stream clusters** use a deterministic hash over `(tenant_id, scope, action_kind_or_risk_class, window, window_key)` — every event for the same cluster carries the same value, which is what lets you JOIN threshold-alert → trip → reset chains and `observed_denied` ↔ `reservation.denied` pairs. **Governance/admin operations** (lifecycle, bulk actions, webhook management, tenant-close cascades) use explicit server-composed operation IDs such as `webhook_create:<id>` or `webhook_bulk_action:<action>:<request_id>` — see the [event payload reference](/protocol/event-payloads-reference) for the shapes. Either way it is scoped to the event stream only — it does not appear on responses or audit rows.

::: warning Don't confuse with `metadata.trace_id`
[Standard Metrics and Metadata](/protocol/standard-metrics-and-metadata-in-cycles) documents application-level correlation keys that callers can put in the `metadata` map on commits and events — free-form strings the server stores but does not interpret. Name them distinctly (e.g. `external_trace_id`, `app_request_id`) rather than reusing `trace_id`/`request_id`, which are the server-managed identifiers described on this page (32-hex W3C, flowing on response headers, error bodies, events, audit rows, and webhook deliveries). The two coexist: your `metadata.external_trace_id` joins Cycles data with your own distributed tracing, while the server `trace_id` joins across Cycles planes.
:::

## Inbound header precedence

For every inbound HTTP request, the server derives `trace_id` in this strict order:

1. **`traceparent` header** — W3C Trace Context v00. Adopted when present AND well-formed.
2. **`X-Cycles-Trace-Id` header** — 32 lowercase hex characters (`^[0-9a-f]{32}$`). Used only when there is no valid `traceparent`.
3. **Server-generated** — 16 random bytes encoded as 32 lowercase hex, when neither header is present or well-formed. All-zero is invalid per W3C §3.2.2.3 and is re-rolled.

**Malformed tolerance.** A malformed correlation header MUST NOT cause the request to be rejected. The server silently falls through to the next rule. A misbehaving upstream proxy cannot break the API.

**Disagreement.** If both `traceparent` and `X-Cycles-Trace-Id` are present, valid, and disagree, `traceparent` wins.

## Outbound propagation

### On HTTP responses

Every response on every plane (`2xx`, `4xx`, `5xx`) carries:

```http
X-Cycles-Trace-Id: <32-hex-lowercase>
```

In addition, `ErrorResponse` bodies carry an optional `trace_id` field:

```json
{
  "error": "BUDGET_EXCEEDED",
  "message": "Insufficient budget in scope tenant:acme",
  "request_id": "req-abc-123",
  "trace_id": "0af7651916cd43dd8448eb211c80319c"
}
```

The `trace_id` field is OPTIONAL on the schema. Conformant v0.1.25.14+ runtime servers and v0.1.25.31+ admin servers populate it on every error response.

### On webhook deliveries

Every webhook delivery emitted by the events service carries two cross-surface headers on top of the existing delivery headers:

```http
X-Cycles-Trace-Id: <32-hex-lowercase>
traceparent: 00-<trace_id>-<16-hex-span>-<trace-flags>
```

- `X-Cycles-Trace-Id` — always present. Matches `X-Cycles-Trace-Id` on the originating response.
- `traceparent` — always present. W3C Trace Context v00. The `span-id` is freshly generated per outbound delivery (NOT reused from the inbound request). The `trace-flags` byte preserves the inbound W3C `traceparent` sampling decision when one was present; otherwise defaults to `01` (sampled).

These two are the normative delivery headers per the spec's required-header list. The reference implementation additionally sends an `X-Request-Id` header when the originating event carries a `request_id`, but that header is not part of the spec's required set — the normative carrier for `request_id` is the event envelope body.

### Inside emitted events

Standard event payloads carry:

| Field | Contract |
|---|---|
| `request_id` | Populated on every event causally downstream of an HTTP request — including async and queued work that spans thread / process boundaries. Pre-v0.1.25 events may lack it. |
| `trace_id` | OPTIONAL on the schema; populated by conformant v0.1.25.14+ runtime servers. |
| `correlation_id` | Server-set: a deterministic hash over `(tenant_id, scope, action_kind_or_risk_class, window, window_key)`. Groups related events in the stream. |

### Inside audit-log entries

Every `AuditLogEntry` carries `request_id` and (OPTIONAL) `trace_id`. These fields flow from the inbound request onto the audit row at write time. Admin-driven operations tagged with metadata such as `metadata.actor_type=admin_on_behalf_of` or `metadata.actor_type=admin` carry the same `trace_id` as the request that triggered them.

### Inside webhook delivery records

The `WebhookDelivery` schema carries three OPTIONAL fields as of governance-admin spec v0.1.25.28:

| Field | Purpose |
|---|---|
| `trace_id` | Captured at dispatch time from the originating event. Used by the events service to construct outbound `X-Cycles-Trace-Id` and `traceparent` headers. |
| `trace_flags` | W3C `trace-flags` byte (2 hex chars) to use when building the outbound `traceparent`. Preserves the inbound sampling decision. |
| `traceparent_inbound_valid` | Whether the originating HTTP request presented a valid W3C `traceparent`. When `true`, the dispatcher honors `trace_flags`; when `false` or null, it defaults to `01` (sampled). |

## Cross-plane propagation

`trace_id` travels:

- **Inbound request → response header** — echoed in `X-Cycles-Trace-Id` on every HTTP response.
- **Request → audit-log entry** — written into the audit row for the request's operation.
- **Request → emitted events** — attached to every event that is a side effect of the request, including events emitted from async workers (`ReservationExpiryService` for example mints a fresh `trace_id` per sweep batch so all `reservation.expired` events in that batch correlate to each other).
- **Events → webhook deliveries** — carried through to each outbound HTTP POST as `X-Cycles-Trace-Id` and embedded in `traceparent`.
- **Across thread / queue / process boundaries** — REQUIRED. Async workers MUST propagate the originating `trace_id` when they emit events, write audit rows, or dispatch webhooks.

## Querying by correlation identifiers

The admin plane supports exact-match filters on correlation identifiers:

### `GET /v1/admin/events`

| Query parameter | Effect |
|---|---|
| `trace_id=<32-hex>` | Narrows to events emitted during one logical operation. May span multiple requests. |
| `request_id=<id>` | Narrows to events that are side effects of one specific HTTP request. |

### `GET /v1/admin/audit/logs`

| Query parameter | Effect |
|---|---|
| `trace_id=<32-hex>` | Narrows to audit rows for one logical operation. |
| `request_id=<id>` | Narrows to audit rows for one specific HTTP request. |

These are the only two admin endpoints with server-side correlation filters. The webhook-delivery list endpoints (`GET /v1/admin/webhooks/{subscription_id}/deliveries` and the tenant-scoped variant) accept only `status` / `from` / `to` / pagination parameters — there is no `trace_id` query parameter. To join deliveries into a trace, filter client-side on the `trace_id` field of each `WebhookDelivery` record.

Both filters are post-hydration predicates applied null-safely — entries with null field values (historical writes, off-request emissions, internal sweeper work) cannot satisfy a supplied filter value. Pre-v0.1.25.14 runtime entries and pre-v0.1.25.31 admin entries may lack `trace_id` and silently drop out of these joins; use `request_id` for those (the `request_id` contract predates `trace_id`).

### Phased-rollout tolerance

The four servers don't have to upgrade in lockstep. During a phased rollout, every combination is wire-compatible — but the `trace_id` filter will return partial results until every plane is at the minimum version:

| Plane | Minimum for `trace_id` population |
|---|---|
| Runtime (`cycles-server`) | v0.1.25.14 |
| Admin (`cycles-server-admin`) | v0.1.25.31 |
| Events (`cycles-server-events`) | v0.1.25.7 |
| Dashboard (`cycles-dashboard`) | v0.1.25.39 (consumes the admin filter) |

Concrete effect: if runtime is at v0.1.25.15 (writes `trace_id` on events) but admin is still at v0.1.25.26 (does NOT yet persist `trace_id` on `WebhookDelivery` records), webhook deliveries for that window will lack `trace_id` in admin queries even though the underlying event has one. Upgrade admin to v0.1.25.31+ to close the gap. Events v0.1.25.8 proactively back-fills `trace_id` onto `Delivery` records from the originating `Event.trace_id` during this window as a best-effort safety net.

If you can't upgrade every plane at once, pin `trace_id`-based alerting to queries that tolerate partial coverage (e.g., show results even when some webhook deliveries lack the field).

## A practical join

Given a single failing request, an operator can reconstruct the entire operation by reading the `trace_id` out of the error response, then walking the two admin endpoints that accept a `trace_id` filter — and filtering the delivery list client-side:

```bash
TID=0af7651916cd43dd8448eb211c80319c

# 1. The request reached the server. What decision was recorded?
curl -s "http://localhost:7979/v1/admin/audit/logs?trace_id=$TID" \
  -H "X-Admin-API-Key: $ADMIN_KEY" \
  | jq '.logs[] | {operation, status, error_code, metadata}'

# 2. What events were emitted as side effects?
curl -s "http://localhost:7979/v1/admin/events?trace_id=$TID" \
  -H "X-Admin-API-Key: $ADMIN_KEY" \
  | jq '.events[] | {event_type, data}'

# 3. What webhook deliveries went out as a consequence?
#    (no trace_id query parameter here — filter client-side on the record's trace_id field)
curl -s "http://localhost:7979/v1/admin/webhooks/<subscription-id>/deliveries" \
  -H "X-Admin-API-Key: $ADMIN_KEY" \
  | jq --arg tid "$TID" '.deliveries[] | select(.trace_id == $tid) | {status, response_status, trace_flags}'
```

Three calls, one ID — two server-side filters plus one client-side filter — full causal picture across runtime response → audit row → emitted events → webhook fan-out.

## Logging `trace_id` in client code

Conformant client logging captures both `request_id` and `trace_id` from the error response. When should you use which?

- **`request_id`** is enough when you're debugging a single failed call — it points at one audit row and its immediate side effects.
- **`trace_id`** is the right choice when the symptom may involve retries, async commits, admin-on-behalf-of releases, or cross-plane fan-out. It narrows to one logical operation regardless of how many HTTP hops happened.

Log both. `request_id` is the tightest predicate; `trace_id` is the widest useful one.

```python
try:
    result = summarize(text)
except CyclesProtocolError as e:
    # SDK field (present on v0.1.25-aware SDKs) with response-header fallback.
    trace_id = getattr(e, "trace_id", None) or (
        e.response_headers.get("X-Cycles-Trace-Id") if hasattr(e, "response_headers") else None
    )
    logger.error(
        "cycles error",
        extra={
            "error_code": e.error_code,
            "status": e.status,
            "request_id": e.request_id,
            "trace_id": trace_id,
        },
    )
    raise
```

The SDKs expose `trace_id` on the error object where available. Older SDK versions that predate v0.1.25 support return `None` from `e.trace_id`; the fallback above pulls from the `X-Cycles-Trace-Id` response header instead. That header is always present on v0.1.25.14+ runtime and v0.1.25.31+ admin responses, so the fallback covers every case where the server populates the field.

## Backward compatibility

The correlation contract is purely additive:

- No new REQUIRED fields on existing schemas.
- Old clients silently ignore the new `X-Cycles-Trace-Id` response header.
- Old webhook subscribers silently ignore the new outbound `X-Cycles-Trace-Id` and `traceparent` headers (and the reference implementation's `X-Request-Id`).
- Servers that predate the contract (runtime below v0.1.25.14, admin below v0.1.25.31, events below v0.1.25.7) remain wire-compatible: `trace_id` is an OPTIONAL property, and `ErrorResponse.additionalProperties: false` is preserved because `trace_id` is a DECLARED property, not an undeclared extra.

## Next steps

- [Webhook Event Delivery Protocol](/protocol/webhook-event-delivery-protocol) — the outbound headers in context
- [Error Codes and Error Handling](/protocol/error-codes-and-error-handling-in-cycles) — `trace_id` in error responses
- [Searching and Sorting Admin List Endpoints](/how-to/searching-and-sorting-admin-list-endpoints) — the audit-log filter DSL, including `trace_id` and `request_id` filters
- [Force-Releasing Stuck Reservations](/how-to/force-releasing-stuck-reservations-as-an-operator) — uses `trace_id` to audit admin-on-behalf-of releases
