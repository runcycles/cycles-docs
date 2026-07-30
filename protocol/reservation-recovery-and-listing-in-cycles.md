---
title: "Reservation Recovery and Listing in Cycles"
description: "How to list, filter, and recover reservations in Cycles when clients crash or lose reservation IDs. Includes query parameters and recovery strategies."
---

# Reservation Recovery and Listing in Cycles

In production systems, things go wrong.

A client crashes after creating a reservation but before storing the reservation ID. A network partition delays a commit. An operator needs to find stuck reservations that are holding budget.

The Cycles protocol provides two endpoints for these situations:

- `GET /v1/reservations` — list and filter reservations
- `GET /v1/reservations/{reservation_id}` — get details for a specific reservation

Both are optional in v0 deployments, but they are essential for production operations.

Tenant callers use `X-Cycles-API-Key`. Operators may also use `X-Admin-API-Key` on reservation list/detail; with admin auth, `GET /v1/reservations` requires a `tenant` query parameter because the admin key has no effective tenant.

## Recovering a lost reservation ID

The most common recovery scenario: a client created a reservation, received the response, but crashed before persisting the `reservation_id`.

The reservation exists on the server. Budget is held. But the client has no way to commit or release it.

The solution is to query by idempotency key:

```
GET /v1/reservations?idempotency_key=my-unique-key-123
```

Idempotency keys are expected to be unique per (effective tenant, endpoint, idempotency_key), so the server SHOULD return at most one matching reservation. The spec makes this a SHOULD rather than a MUST, so robust recovery code should tolerate the unlikely case of multiple matches.

The client recovers the `reservation_id` and can then commit or release as needed.

This is why idempotency keys should be generated and persisted before creating the reservation — they serve as the recovery handle.

## Listing reservations

The listing endpoint supports several filters:

### By status

```
GET /v1/reservations?status=ACTIVE
```

Reservation statuses are:

- **ACTIVE** — the reservation is live and budget is held
- **COMMITTED** — actual usage has been recorded
- **RELEASED** — the reservation was canceled and budget returned
- **EXPIRED** — the TTL (plus grace period) elapsed without commit or release

Filtering by `status=ACTIVE` is the most operationally useful — it shows all reservations currently holding budget.

### By subject fields

```
GET /v1/reservations?tenant=acme&app=support-bot
GET /v1/reservations?workflow=refund-assistant
```

Subject filters match against the canonical Subject fields: tenant, workspace, app, workflow, agent, and toolset.

Filtering on custom dimensions is out of scope for v0.

### By idempotency key

```
GET /v1/reservations?idempotency_key=run-abc-step-3
```

The server SHOULD return at most one reservation matching the key. This is the primary recovery mechanism.

### Pagination

Responses are paginated:

- `limit` — maximum results per page (1–200, default 50)
- `cursor` — opaque cursor from a previous response
- `has_more` — whether more results exist
- `next_cursor` — cursor for the next page

### Time-window filters

`GET /v1/reservations` supports three independent ISO 8601 time windows:

- `from` / `to` filter `created_at_ms`.
- `expires_from` / `expires_to` filter `expires_at_ms`.
- `finalized_from` / `finalized_to` filter `finalized_at_ms`.

Each bound is inclusive and may be supplied alone. Blank values are treated as unset. If the lower bound is greater than the upper bound for a pair, the server returns `400 INVALID_REQUEST`. `finalized_at_ms` is only populated on COMMITTED and RELEASED rows, so ACTIVE and EXPIRED rows do not match `finalized_*` filters.

Example: find active reservations that have already passed their expiry:

```bash
curl -G "http://localhost:7878/v1/reservations" \
  -H "X-Cycles-API-Key: $TENANT_API_KEY" \
  --data-urlencode "status=ACTIVE" \
  --data-urlencode "expires_to=2026-07-03T12:00:00Z" \
  --data-urlencode "sort_by=expires_at_ms" \
  --data-urlencode "sort_dir=asc"
```

### Sorting (v0.1.25.12+)

`GET /v1/reservations` accepts two optional query parameters to order results server-side:

- `sort_by` — one of `reservation_id`, `tenant`, `scope_path`, `status`, `reserved`, `created_at_ms`, `expires_at_ms`. When omitted, the server uses its default Redis-SCAN order.
- `sort_dir` — `asc` or `desc`. Defaults to `desc` when `sort_by` is provided.

The `reserved` key sorts by the integer `amount` within each row (well-defined because the v0 single-unit-per-reservation invariant holds). The `scope_path` key sorts lexicographically over the canonical scope path string (e.g. `tenant:acme/workspace:prod/agent:x`). The `tenant` key sorts over `Subject.tenant` only.

Unknown `sort_by` or `sort_dir` values return HTTP 400 `INVALID_REQUEST`. Older servers that don't recognize the params ignore them without error (additive-parameter guarantee).

**Cursor binding.** When `sort_by` is provided, the returned cursor binds to the `(sort_by, sort_dir, filters)` tuple. Reusing a cursor under a different sort key or filter set returns HTTP 400. Reset the cursor whenever you change sort key, direction, or filters.

**Hydration warning.** Current reference servers hydrate all matching rows for sorted reservation listings, then sort and slice. If a sorted query hydrates 2,000 or more rows, the server logs a WARN. Rows beyond 2,000 are not truncated in v0.1.25.39+; narrow filters (`status`, `idempotency_key`, workspace/app/workflow/agent/toolset, or the time-window filters above) still keep incident queries faster and easier to reason about.

```
GET /v1/reservations?status=ACTIVE&sort_by=expires_at_ms&sort_dir=asc&limit=100
```

This returns the 100 oldest-expiring active reservations — useful for incident response when you need to force-release soon-to-expire reservations before they churn.

### Field projection

List rows always include scalar lifecycle fields such as `committed` when present. Larger or optional maps are opt-in through `include`:

- `include=metadata` projects reserve-time metadata.
- `include=committed_metadata` projects commit-time metadata.
- `include=evidence` projects recorded CyclesEvidence refs keyed by `reserve`, `commit`, and `release`.

`include` is projection-only: it does not change which rows match, does not affect ordering, and does not invalidate sorted cursors if it changes between pages.

## Getting reservation details

```
GET /v1/reservations/{reservation_id}
```

Returns the full state of a specific reservation:

- **reservation_id** — the unique identifier
- **status** — current lifecycle state (ACTIVE, COMMITTED, RELEASED, EXPIRED)
- **subject** — the original Subject (tenant, workspace, app, etc.)
- **action** — the original Action (kind, name, tags)
- **reserved** — the amount that was reserved
- **committed** — the amount that was committed (if status is COMMITTED)
- **created_at_ms** — when the reservation was created
- **expires_at_ms** — when the reservation expires (or expired)
- **finalized_at_ms** — when the reservation reached a terminal state; present only on COMMITTED and RELEASED reservations, absent on ACTIVE and EXPIRED ones
- **scope_path** — the canonical scope path
- **affected_scopes** — all scopes impacted by this reservation
- **idempotency_key** — the creation idempotency key (if the server persists it)
- **metadata** — any metadata attached to the reservation
- **committed_metadata** — metadata attached to the commit request, when present
- **evidence** — CyclesEvidence refs keyed by artifact type, when evidence was emitted

This endpoint is useful for debugging specific reservations and understanding their full lifecycle.

## Tenancy enforcement

Both listing and detail endpoints enforce tenant isolation:

- results are scoped to the effective tenant derived from the API key
- if a `tenant` query parameter is provided, it must match the effective tenant
- attempting to get details for a reservation owned by a different tenant returns `403 FORBIDDEN`

A tenant cannot see or access another tenant's reservations.

Under `X-Admin-API-Key`, reservation list requires `tenant` as an explicit filter and reservation detail can read any reservation by ID. This is the admin-on-behalf-of operator path used by the dashboard and incident runbooks.

## Use cases

### Stuck reservation detection

Periodically query `GET /v1/reservations?status=ACTIVE` and check for reservations with `expires_at_ms` in the past that have not yet been finalized.

These may indicate server-side cleanup delays or edge cases worth investigating.

### Budget leak investigation

When budget appears lower than expected, list active reservations to see what is currently held:

```
GET /v1/reservations?status=ACTIVE&tenant=acme&app=support-bot
```

This shows all live reservations holding budget for that app. High counts or large reserved amounts may explain the discrepancy.

### Post-incident analysis

After a budget incident, query reservations by workflow or agent to understand the pattern:

```
GET /v1/reservations?workflow=refund-assistant&status=COMMITTED
```

This shows all committed reservations for that workflow, which helps trace what consumed the budget.

### Client crash recovery

Current official SDK lifecycle helpers replay known-actual settlement from their durable journal automatically. The manual sequence below applies to raw clients and application-owned lifecycles:

1. Check durable local state for in-progress reservation IDs, exact settlement bodies, and idempotency keys
2. For any missing reservation IDs, query by the idempotency key that was generated before the reservation
3. For each recovered reservation, check its status:
   - **ACTIVE**: commit or release depending on whether work completed
   - **EXPIRED**: if work already completed and actual usage is known, record it through `POST /v1/events` with the stored settlement key; if work did not run, no settlement is due; create a new reservation only before starting new work
   - **COMMITTED** or **RELEASED**: no action needed

This recovery pattern depends on persisting idempotency keys before creating reservations and persisting known-actual settlement before its first request. Never compensate with a fresh key while an original request remains ambiguous.

## Error conditions

### GET /v1/reservations (listing)

- `400 INVALID_REQUEST` — malformed query parameters
- `401 UNAUTHORIZED` — invalid API key
- `403 FORBIDDEN` — tenant mismatch

### GET /v1/reservations/{reservation_id} (detail)

- `401 UNAUTHORIZED` — invalid API key
- `403 FORBIDDEN` — reservation owned by a different tenant
- `404 NOT_FOUND` — reservation never existed
- `410 RESERVATION_EXPIRED` — reservation has expired

## Summary

The reservation listing and detail endpoints provide operational visibility and recovery capabilities:

- **Recovery**: query by idempotency key to recover lost reservation IDs
- **Monitoring**: list active reservations to understand what is holding budget
- **Debugging**: get full reservation details including status, amounts, scopes, and timestamps
- **Investigation**: filter by subject fields and status for post-incident analysis

These endpoints are optional in v0, but essential for production operations where client crashes, network issues, and budget investigations are a reality.

## Next steps

To explore the Cycles stack:

- Read the [Cycles Protocol](https://github.com/runcycles/cycles-protocol)
- Run the [Cycles Server](https://github.com/runcycles/cycles-server)
- Manage budgets with [Cycles Admin](https://github.com/runcycles/cycles-server-admin)
- Integrate with Python using the [Python Client](/quickstart/getting-started-with-the-python-client)
- Integrate with TypeScript using the [TypeScript Client](/quickstart/getting-started-with-the-typescript-client)
- Integrate with Spring Boot or Spring AI using the [Spring Boot starter](https://github.com/runcycles/cycles-spring-boot-starter) or the [Spring AI starter](https://github.com/runcycles/cycles-spring-ai-starter)
- Review [SDK Settlement Recovery and Durability](/protocol/sdk-settlement-recovery-and-durability)
