---
title: "Force-Releasing Stuck Reservations as an Operator"
description: "How Cycles operators can force-release hung reservations on the runtime plane using AdminKeyAuth, with full audit tagging."
---

# Force-Releasing Stuck Reservations as an Operator

Reservations can get stuck. A client crashes without committing. A network partition hangs a request indefinitely. A bug in an agent leaves a reservation open past its intended lifetime. The budget stays reserved, and — because `remaining = allocated - spent - reserved - debt` — other work starts getting denied even though no actual money was spent.

The normal path is to wait for the reservation to expire (`ttl_ms` plus the grace period) and let the server-side sweeper release it. That is usually fine. But during an incident you often cannot wait: customer-facing agents are failing reservation requests *right now* because budget is parked on a hung run that has already been cancelled upstream.

For this case the runtime plane supports **admin-on-behalf-of release** on `POST /v1/reservations/{id}/release` (added in `cycles-server` v0.1.25.8). Operators can force-release any reservation with `X-Admin-API-Key`; no tenant-scoped API key is required. Every such call is tagged in the audit log so the action is never invisible.

::: tip When to reach for this
Use force-release only when you cannot wait for normal expiry and you have confirmed the downstream work is truly dead. Releasing a reservation whose client is still executing will cause the client's commit to land on a freshly-restored balance — double-counting. If there is any doubt, wait for expiry.
:::

## Admin-authenticated request

The force-release call is the standard release endpoint authenticated with the runtime server's admin key:

```bash
curl -X POST "http://localhost:7878/v1/reservations/rsv_abc123/release" \
  -H "X-Admin-API-Key: $ADMIN_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "idempotency_key": "incident-2026-04-17-release-rsv_abc123",
    "reason": "Force-release during incident INC-842; client confirmed dead by oncall"
  }'
```

The runtime server:

1. Validates the `X-Admin-API-Key` against its local `ADMIN_API_KEY` env var (must match the admin server's key — deploy them with the same value).
2. Looks up the reservation owner from the reservation ID and skips tenant-key ownership checks because this is the admin-on-behalf-of path.
3. Runs the `release.lua` script to return `reserved` budget to the pool.
4. Writes an audit entry with `operation = releaseReservation`, `resource_type = reservation`, `resource_id = <reservation_id>`, and `metadata.actor_type = admin_on_behalf_of`.

Response is identical to a normal release:

```json
{
  "status": "RELEASED",
  "released": { "amount": 5000, "unit": "USD_MICROCENTS" },
  "balances": []
}
```

::: warning ADMIN_API_KEY must be the same on both planes
Admin-on-behalf-of authenticates on the runtime plane, so `cycles-server` and `cycles-server-admin` must share the same `ADMIN_API_KEY`. If the runtime plane has a different value, the request returns `401 UNAUTHORIZED`. If the runtime plane has no admin key configured, the request fails closed as a server misconfiguration and the release does not happen.
:::

## Finding the reservation to release

You usually do not know the `reservation_id` off the top of your head. Two common paths to find it:

### From an idempotency key

If the client was built to generate idempotency keys for reservations before calling reserve (which it should be — that is the canonical recovery pattern), you can look up the reservation from the key the application last logged:

```bash
curl -G "http://localhost:7878/v1/reservations" \
  -H "X-Admin-API-Key: $ADMIN_KEY" \
  --data-urlencode "tenant=acme-corp" \
  --data-urlencode "idempotency_key=run-ac35f-step-4" | jq .
```

Idempotency keys are unique per `(tenant, endpoint, key)`, so this returns at most one match.

### From a filtered listing

If the client did not log the key, find it by subject and status:

```bash
curl -G "http://localhost:7878/v1/reservations" \
  -H "X-Admin-API-Key: $ADMIN_KEY" \
  --data-urlencode "tenant=acme-corp" \
  --data-urlencode "status=ACTIVE" \
  --data-urlencode "app=support-bot" \
  --data-urlencode "sort_by=expires_at_ms" \
  --data-urlencode "sort_dir=asc" \
  --data-urlencode "limit=20" | jq .
```

Oldest-expiring first is the most operationally useful view — hung reservations usually have `expires_at_ms` well in the past. See [Reservation Recovery and Listing](/protocol/reservation-recovery-and-listing-in-cycles#sorting-v0-1-25-12) for the full sort parameter catalog.

## Audit trail

Every force-release is captured in the audit log. Query it from the admin plane:

```bash
curl -G "http://localhost:7979/v1/admin/audit/logs" \
  -H "X-Admin-API-Key: $ADMIN_KEY" \
  --data-urlencode "operation=releaseReservation" \
  --data-urlencode "resource_type=reservation" \
  --data-urlencode "resource_id=rsv_abc123" | jq .
```

Fields to expect on the audit entry:

| Field | Meaning |
|-------|---------|
| `operation` | `releaseReservation` |
| `resource_type` | `reservation` |
| `resource_id` | The reservation ID |
| `metadata.actor_type` | `admin_on_behalf_of` (distinguishes from tenant-initiated releases) |
| `tenant_id` | Tenant the reservation belonged to |
| `metadata.reason` | Free-form text from the request body, sanitized for CR/LF if provided |
| `request_id` | The HTTP request id for the release call |
| `trace_id` | The cross-plane trace id for joining to events and webhook deliveries |

The audit entry is retained under the authenticated-audit retention policy (default 400 days in v0.1.25.20+). This comfortably covers SOC2 audit windows.

### Joining release → events → webhook delivery with `trace_id`

Every response from the runtime server — including the force-release response — carries an `X-Cycles-Trace-Id` header and a `trace_id` field in error bodies (v0.1.25.14+). Use it to see the full consequences of a force-release across planes:

```bash
TID=<32-hex from X-Cycles-Trace-Id response header>

# The audit entry for this specific release
curl -s "http://localhost:7979/v1/admin/audit/logs?trace_id=$TID" \
  -H "X-Admin-API-Key: $ADMIN_KEY"

# Events emitted as a side effect (reservation.released, budget.*)
curl -s "http://localhost:7979/v1/admin/events?trace_id=$TID" \
  -H "X-Admin-API-Key: $ADMIN_KEY"

# Webhook deliveries that went out — the deliveries endpoint has no trace_id
# query parameter, but each delivery row carries trace_id; filter client-side
curl -s "http://localhost:7979/v1/admin/webhooks/<subscription-id>/deliveries" \
  -H "X-Admin-API-Key: $ADMIN_KEY" | jq --arg tid "$TID" '.deliveries[] | select(.trace_id == $tid)'
```

This is useful for confirming that a subscriber alerting channel (oncall rotation, incident tracker) received the `reservation.released` notification before you close the incident. Requires `cycles-server-admin` v0.1.25.31+. See [Correlation and Tracing](/protocol/correlation-and-tracing-in-cycles).

## Recovery checklist

A pragmatic runbook for hung-reservation incidents:

1. **Confirm the client is dead.** Check logs, look for the idempotency key, grep for the reservation ID in traces. If the client is still running, do not force-release — either wait for TTL or release from the client itself.
2. **Find the reservation.** Use idempotency key lookup first, filtered listing second.
3. **Inspect it.** `GET /v1/reservations/{id}` returns the full state — status, subject, reserved amount, TTL, and finalized time (null if still ACTIVE).
4. **Decide: release vs wait.** If `expires_at_ms` is within minutes, waiting is safer. If it is hours away and budget is being denied right now, force-release.
5. **Force-release with a reason.** Include the incident ID and the reason in both `idempotency_key` and `reason` — the audit entry is the record of why.
6. **Verify.** Re-fetch the reservation; it should now be `RELEASED` with a `finalized_at_ms`.
7. **Post-incident.** Document the hung reservation in the incident report. If the pattern repeats, look at shortening client TTLs or adding heartbeat extension.

::: tip Dashboard equivalent
The Reservations page in the [Cycles Admin Dashboard](/quickstart/deploying-the-cycles-dashboard) exposes this exact flow — filter to `status=ACTIVE`, sort by `expires_at_ms` ascending, click a row, and use the **Force Release** button. The dashboard sends the admin-authenticated call through its nginx reverse proxy to the runtime plane.
:::

## Failure modes

- **401 UNAUTHORIZED** — the admin key is wrong.
- **403 FORBIDDEN** — you used tenant-key auth and that tenant does not own the reservation. Under `X-Admin-API-Key`, admin-on-behalf-of skips tenant ownership checks on this allowlisted endpoint.
- **500 INTERNAL_ERROR** — the runtime server does not have `ADMIN_API_KEY` configured for the admin-on-behalf-of path.
- **404 NOT_FOUND** — the reservation never existed.
- **409 RESERVATION_FINALIZED** — the reservation is already `COMMITTED` or `RELEASED`.
- **410 RESERVATION_EXPIRED** — the reservation already expired before you got to it; the budget is already back.

## Next steps

- [Reservation Recovery and Listing](/protocol/reservation-recovery-and-listing-in-cycles) — listing and sort parameters
- [Production Operations Guide](/how-to/production-operations-guide) — broader runbook patterns
- [Admin API reference](/admin-api/) — audit log query endpoints
- [Security Hardening](/how-to/security-hardening) — protecting the admin key across planes
