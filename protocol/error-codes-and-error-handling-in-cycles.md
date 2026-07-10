---
title: "Error Codes and Error Handling in Cycles"
description: "Reference for all Cycles error codes and structured error responses, with guidance on handling each failure condition in client applications."
---

# Error Codes and Error Handling in Cycles

Cycles uses structured error responses with specific error codes for every failure condition.

Understanding these codes is essential for building a production integration. Each code tells the client exactly what happened and what to do about it.

## Error response format

Every error response follows the same structure:

```json
{
  "error": "BUDGET_EXCEEDED",
  "message": "Insufficient budget in scope tenant:acme",
  "request_id": "req-abc-123",
  "trace_id": "0af7651916cd43dd8448eb211c80319c",
  "details": {}
}
```

- **error** — a machine-readable error code from the fixed enum
- **message** — a human-readable explanation
- **request_id** — a unique identifier for one HTTP request
- **trace_id** — OPTIONAL. 32-hex W3C Trace Context identifier for the logical operation this request belongs to. Conformant v0.1.25.14+ runtime servers and v0.1.25.31+ admin servers populate it on every error response. See [Correlation and Tracing](/protocol/correlation-and-tracing-in-cycles).
- **details** — optional additional context

Every response — error or success — also carries an `X-Cycles-Trace-Id` HTTP response header with the same 32-hex identifier. Log both `request_id` and `trace_id` when handling errors; `trace_id` is the cross-plane join key for admin audit, events, and webhook delivery queries.

## The error codes

The runtime protocol defines 17 wire error codes (the `ErrorCode` enum in the runtime OpenAPI spec — `LIMIT_EXCEEDED` was added in spec v0.1.25.12, `TENANT_CLOSED` in spec v0.1.25.13). `TENANT_CLOSED` mirrors the governance/admin plane's lifecycle error of the same name — raised by the [tenant-close cascade](/protocol/tenant-close-cascade-semantics) against objects owned by closed tenants — so all 17 codes covered here are now part of the runtime wire contract. The admin-plane error enum has additional codes that aren't; see the admin OpenAPI spec for the full set.

Each code has a specific HTTP status code and meaning.

### INVALID_REQUEST (400)

The request is malformed or missing required fields.

Common causes:

- missing required fields (subject, action, estimate, idempotency_key)
- Subject with only `dimensions` and no standard field (tenant, workspace, app, workflow, agent, toolset)
- field values exceeding length limits
- invalid parameter values

**What to do:** fix the request. This is not retryable without changes.

### UNAUTHORIZED (401)

The `X-Cycles-API-Key` header is missing or the API key is invalid.

**What to do:** check the API key configuration. Not retryable without a valid key.

### FORBIDDEN (403)

The request is authenticated but not authorized for the target resource.

Common causes:

- Subject.tenant does not match the effective tenant derived from the API key
- attempting to commit/release/extend a reservation owned by a different tenant
- querying balances for a different tenant

**What to do:** ensure the tenant in the Subject matches the API key's tenant. Not retryable without fixing the tenant mismatch.

### NOT_FOUND (404)

The runtime plane uses a single `NOT_FOUND` wire code for all resource-not-found conditions. The `message` field carries the specific reason. Two distinct conditions surface here:

**Missing reservation.** The specified reservation ID does not exist. This is different from `RESERVATION_EXPIRED` — a 404 means the reservation was never created, while `RESERVATION_EXPIRED` means it existed but its TTL has passed. **What to do:** verify the reservation ID. If the client lost the ID, use `GET /v1/reservations` with the `idempotency_key` filter to recover it.

**Missing budget.** Returned on `POST /v1/reservations` and `POST /v1/events` when no budget ledger exists at any derived scope in any unit. The wire response looks like:

```json
{
  "error": "NOT_FOUND",
  "message": "Budget not found for provided scope: tenant:acme/workspace:prod",
  "request_id": "req-abc-123"
}
```

Distinct from `UNIT_MISMATCH (400)` — "missing budget" means *no budget exists at all*, while `UNIT_MISMATCH` means a budget exists at the scope but in a different unit than the request. **What to do:** create a budget via `POST /v1/admin/budgets` for at least one scope in the hierarchy. See [Budget Allocation and Management](/how-to/budget-allocation-and-management-in-cycles#how-budget-lookup-works-during-reservations).

On `POST /v1/decide` and `POST /v1/reservations` with `dry_run=true`, the "missing budget" condition does NOT surface as a 404. Those endpoints return `200` with `decision=DENY` and `reason_code=BUDGET_NOT_FOUND` instead — see [Decision reason codes](#decision-reason-codes) below.

### BUDGET_EXCEEDED (409)

Budget is insufficient for the requested operation.

This appears in three contexts:

1. **Reservation:** the scope does not have enough remaining budget for the estimate
2. **Commit with REJECT policy:** actual exceeds reserved
3. **Event with REJECT policy:** insufficient budget for the event amount

Note: commits with ALLOW_IF_AVAILABLE never return 409. Instead, the charge is capped to the available remaining budget.

**What to do:** depends on context:

- for reservations: degrade (smaller model, fewer tools), defer, or deny the action
- for commits: the work already happened — consider switching to ALLOW_IF_AVAILABLE or ALLOW_WITH_OVERDRAFT
- for events: adjust the amount or change the overage policy

### BUDGET_FROZEN (409)

The budget scope has been frozen by an operator. Operations that would modify the budget (reserve, commit, event) are rejected while the scope is frozen.

**What to do:** wait for the operator to unfreeze the budget, or escalate. Not retryable until the freeze is lifted.

### BUDGET_CLOSED (409)

The budget scope has been permanently closed. No further budget operations are allowed against this scope.

**What to do:** create a new budget scope or contact the operator. Not retryable against this scope.

<a id="tenant-closed-409"></a>
### TENANT_CLOSED (409)

The owning tenant has been permanently closed. Every mutating admin-plane operation on any object owned by a closed tenant — budgets, reservations, API keys, webhook subscriptions, policies — is rejected with this code. GET endpoints remain available for post-mortem audit reads.

This error is issued by the **Rule 2 — Terminal-Owner Mutation Guard** half of the cascade contract (governance-admin spec v0.1.25.29, shipped in `cycles-server-admin` v0.1.25.35; full coverage v0.1.25.36). Rule 2's counterpart — **Rule 1 — Close Cascade** — runs at tenant-close time and automatically drives owned objects to terminal states (`BudgetLedger → CLOSED`, `ApiKey → REVOKED`, open reservations → `RELEASED`, `WebhookSubscription → DISABLED`), so by the time you see this error the owned objects are already terminal. There is no way to "undo" a close; this is not a race condition that will resolve on retry.

**On the runtime plane** (runtime spec v0.1.25.13, shipped in `cycles-server` 0.1.25.47): the persisting reservation mutations — create (`dry_run` absent or `false`), commit, release, extend — return `409 TENANT_CLOSED` once the owning tenant's `CLOSED` flip is durable. For non-replay mutations it takes precedence over the reservation-state errors (`RESERVATION_FINALIZED`, `RESERVATION_EXPIRED`); same-key replays of mutations that succeeded before the close return their original stored response. Fresh (non-replay) `dry_run=true` create and `POST /v1/decide` evaluations never 409 for this condition — they return `200` with `decision=DENY` and `reason_code=TENANT_CLOSED` (see [Decision reason codes](#decision-reason-codes)). A present-but-malformed tenant record (undecodable JSON, missing or unrecognized `status`) fails closed with `500 INTERNAL_ERROR` before any mutation; deployments with no tenant records at all are not guarded. A mutation-surface `409 TENANT_CLOSED` on the evidence endpoints (persisting create, commit, release) emits an `error` CyclesEvidence envelope and stamps `cycles_evidence` on the response. Note that the cascade also revokes the tenant's API keys and the runtime auth filter rejects CLOSED-tenant keys per request, so tenant-key calls usually fail with `401` first — the 409 surfaces mainly on admin-key mutations and in the post-flip/pre-revocation window. `cycles-server` 0.1.25.46 and earlier surface closed tenants on the runtime plane only as `401`s (revoked/rejected keys) or budget-state errors such as `BUDGET_CLOSED`.

**What to do:** the tenant and its owned objects are read-only. Create a new tenant or escalate. **Not retryable against any object owned by this tenant** — unlike `BUDGET_FROZEN` (which an operator may unfreeze), `TENANT_CLOSED` is terminal. Implement no retry logic for this error.

**For client-app developers.** If your users encounter `TENANT_CLOSED`, escalate to your platform operator — they control tenant lifecycle; a client cannot un-close a tenant. New workloads require a fresh active tenant. To proactively detect closed tenants and surface a friendlier message before mutation attempts, call `GET /v1/admin/tenants/{tenant_id}` (admin-scoped) or check the response of any `GET /v1/balances` / `GET /v1/reservations` call — reads against a closed tenant still succeed and return status metadata.

**In bulk-action responses:** rows targeting a closed tenant go into the `failed[]` bucket with `error_code=TENANT_CLOSED`; the rest of the batch continues.

See [Tenant-Close Cascade Semantics](/protocol/tenant-close-cascade-semantics) for the full Rule 1 / Rule 2 contract, affected endpoints, and Mode A vs Mode B cascade behavior.

### RESERVATION_EXPIRED (410)

The reservation's TTL plus grace period has elapsed.

The reservation has been finalized as EXPIRED and its budget has been returned to the pool.

**What to do:** create a new reservation if the work still needs to proceed. If the work already completed, the usage may need to be recorded as an event instead.

### RESERVATION_FINALIZED (409)

An operation was attempted on a reservation that is already in a terminal state (COMMITTED or RELEASED).

This typically happens when trying to extend a reservation that has already been committed.

**What to do:** no action needed on the reservation. If the extend was meant to keep a different reservation alive, check the reservation ID.

### IDEMPOTENCY_MISMATCH (409)

The same idempotency key was used with a different request payload.

This means the client sent a request with an idempotency key that was already used for a different operation.

**What to do:** use a unique idempotency key for each distinct operation. If this is a legitimate retry, ensure the request payload matches the original exactly.

### UNIT_MISMATCH (400)

The unit in the request does not match any budget stored for the derived scopes, but at least one of those scopes has a budget in a different unit.

Returned on four operations:

1. **Reserve** — `estimate.unit` does not match any budget at the derived scopes (a budget exists in a different unit)
2. **Commit** — `actual.unit` differs from the reservation's `estimate.unit`
3. **Event** — `actual.unit` does not match the budget stored for the target scope
4. **Decide** — `estimate.unit` does not match any budget at the derived scopes. This is an exception to `/decide`'s general "return `decision=DENY` (200) without 4xx" pattern, which applies only to budget-state conditions (debt, overdraft, insufficient remaining), not request-validity errors like a wrong unit.

When the cause is a wrong unit (rather than the absence of any budget at the scope), the server populates the error response's `details` object with:

- `scope` — the canonical scope identifier where the mismatch was detected
- `requested_unit` — the unit supplied by the client
- `expected_units` — array of units for which a budget does exist at that scope

so clients can self-correct without a separate lookup. `NOT_FOUND (404)` (with a `"Budget not found for provided scope: ..."` message) is reserved for the case where the target scope has no budget in **any** unit.

**What to do:** switch the request to one of the units listed in `details.expected_units`, or create a budget in the requested unit via `POST /v1/admin/budgets`.

### OVERDRAFT_LIMIT_EXCEEDED (409)

Appears in two contexts:

1. **During commit:** when `overage_policy=ALLOW_WITH_OVERDRAFT` and `(current_debt + delta) > overdraft_limit`
2. **During reservation:** when the scope is in over-limit state (`is_over_limit=true`) due to prior concurrent commits pushing debt past the limit

**What to do:**

- if during commit: the debt limit has been reached. The work already happened. An operator needs to fund the scope.
- if during reservation: the scope is blocked. Wait for debt to be repaid, or escalate to an operator. The client should retry with exponential backoff.

### DEBT_OUTSTANDING (409)

A new reservation was attempted against a scope that has outstanding debt (debt > 0) and no overdraft limit configured (overdraft_limit is absent or 0).

When an `overdraft_limit > 0` is configured, debt within the limit does not block new reservations. Only scopes without an overdraft limit treat any debt as blocking.

**What to do:** wait for debt to be repaid through budget funding, or configure an overdraft limit if debt within a limit is acceptable. Retry with exponential backoff, or escalate to an operator.

Note: when `is_over_limit=true`, the server returns `OVERDRAFT_LIMIT_EXCEEDED` instead of `DEBT_OUTSTANDING`, even if debt > 0. `OVERDRAFT_LIMIT_EXCEEDED` takes precedence.

### MAX_EXTENSIONS_EXCEEDED (409)

The tenant's `max_reservation_extensions` limit has been reached for this reservation. No further extensions are allowed.

**What to do:** commit or release the reservation. If more time is needed, create a new reservation after committing the current one.

### LIMIT_EXCEEDED (429)

The client has exceeded the server's rate limit. Added in spec v0.1.25.12, mirroring the governance-plane code of the same name; the reference runtime server enforces it on the **public (unauthenticated)** endpoints — `GET /v1/evidence/*` and the CyclesEvidence JWKS — since v0.1.25.46 (default 300 requests/minute per client IP, per instance; see [Public endpoint rate limiting](/configuration/server-configuration-reference-for-cycles#public-endpoint-rate-limiting-v0-1-25-46)). Authenticated `/v1` endpoints are not rate limited by the reference server (abuse there is key-attributable).

The 429 response carries throttling headers alongside the standard correlation headers:

- `Retry-After` — seconds to wait before retrying
- `X-RateLimit-Reset` — when the current window resets
- `X-RateLimit-Remaining: 0`

**What to do:** wait for the `Retry-After` interval, then retry. If you hit this limit during legitimate operation, raise `CYCLES_PUBLIC_RATE_LIMIT_REQUESTS_PER_MINUTE` or rate-limit at your ingress instead.

### INTERNAL_ERROR (500)

An unexpected server error occurred.

Since `cycles-server` 0.1.25.47 this is also the deliberate fail-closed response when a tenant record exists but its status cannot be determined (undecodable JSON, non-object, missing or unrecognized `status`) — the closed-tenant guard refuses to treat a corrupt governance record as an open tenant, on the dry-run/decide surface too. That variant will not resolve on retry; the operator must repair the tenant record.

**What to do:** retry with exponential backoff. If the error persists, contact the Cycles server operator.

## Error handling by operation

### Reserve errors

| Error | HTTP | Meaning |
|---|---|---|
| BUDGET_EXCEEDED | 409 | Insufficient budget |
| BUDGET_FROZEN | 409 | Budget scope is frozen |
| BUDGET_CLOSED | 409 | Budget scope is permanently closed |
| TENANT_CLOSED | 409 | Owning tenant is closed (cycles-server 0.1.25.47+, spec v0.1.25.13). Persisting create only — a fresh `dry_run=true` returns `200 decision=DENY reason_code=TENANT_CLOSED` instead |
| OVERDRAFT_LIMIT_EXCEEDED | 409 | Scope is over-limit |
| DEBT_OUTSTANDING | 409 | Scope has unresolved debt (no overdraft limit configured) |
| IDEMPOTENCY_MISMATCH | 409 | Same key, different payload |
| NOT_FOUND | 404 | No budget exists at any derived scope in any unit (message: `"Budget not found for provided scope: ..."`) |
| UNIT_MISMATCH | 400 | `estimate.unit` does not match any budget at the derived scopes (budget exists in a different unit) |
| INVALID_REQUEST | 400 | Malformed request |
| UNAUTHORIZED | 401 | Invalid API key |
| FORBIDDEN | 403 | Tenant mismatch |

### Decide errors

| Error | HTTP | Meaning |
|---|---|---|
| UNIT_MISMATCH | 400 | `estimate.unit` does not match any budget at the derived scopes (budget exists in a different unit) |
| INVALID_REQUEST | 400 | Malformed request |
| UNAUTHORIZED | 401 | Invalid API key |
| FORBIDDEN | 403 | Tenant mismatch |
| IDEMPOTENCY_MISMATCH | 409 | Same key, different payload |

Note: decide returns `200` with `decision: DENY` for budget-state conditions (insufficient remaining, debt, overdraft, and the "no budget exists at any scope" case — surfaced via `reason_code` from the [DecisionReasonCode enum](#decision-reason-codes)), not a `409` or `404` error. The same holds for a closed owning tenant (cycles-server 0.1.25.47+, spec v0.1.25.13): a fresh (non-replay) evaluation returns `200 decision=DENY reason_code=TENANT_CLOSED`, never `409 TENANT_CLOSED` — though a present-but-malformed tenant record fails closed with `500 INTERNAL_ERROR`. Request-validity errors like `UNIT_MISMATCH` are still returned as 400. The same applies to `POST /v1/reservations` when `dry_run=true`.

### Commit errors

| Error | HTTP | Meaning |
|---|---|---|
| BUDGET_EXCEEDED | 409 | Actual exceeds budget (REJECT only) |
| BUDGET_FROZEN | 409 | Budget scope is frozen |
| BUDGET_CLOSED | 409 | Budget scope is permanently closed |
| TENANT_CLOSED | 409 | Owning tenant is closed (cycles-server 0.1.25.47+, spec v0.1.25.13); takes precedence over reservation-state errors for non-replay requests |
| OVERDRAFT_LIMIT_EXCEEDED | 409 | Debt would exceed limit (ALLOW_WITH_OVERDRAFT) |
| RESERVATION_EXPIRED | 410 | Past TTL + grace period |
| RESERVATION_FINALIZED | 409 | Already committed or released |
| UNIT_MISMATCH | 400 | Unit differs from reservation |
| NOT_FOUND | 404 | Reservation never existed |
| IDEMPOTENCY_MISMATCH | 409 | Same key, different payload |
| UNAUTHORIZED | 401 | Invalid API key |
| FORBIDDEN | 403 | Reservation owned by different tenant |

### Release errors

| Error | HTTP | Meaning |
|---|---|---|
| TENANT_CLOSED | 409 | Owning tenant is closed (cycles-server 0.1.25.47+, spec v0.1.25.13); takes precedence over reservation-state errors for non-replay requests |
| RESERVATION_EXPIRED | 410 | Past TTL + grace period |
| RESERVATION_FINALIZED | 409 | Already committed or released |
| IDEMPOTENCY_MISMATCH | 409 | Same key, different payload |
| NOT_FOUND | 404 | Reservation never existed |
| UNAUTHORIZED | 401 | Invalid API key |
| FORBIDDEN | 403 | Reservation owned by different tenant |

### Extend errors

| Error | HTTP | Meaning |
|---|---|---|
| INVALID_REQUEST | 400 | Missing or invalid fields |
| TENANT_CLOSED | 409 | Owning tenant is closed (cycles-server 0.1.25.47+, spec v0.1.25.13); takes precedence over reservation-state errors for non-replay requests |
| RESERVATION_EXPIRED | 410 | Past TTL (no grace period for extend) |
| RESERVATION_FINALIZED | 409 | Already committed or released |
| MAX_EXTENSIONS_EXCEEDED | 409 | Tenant max_reservation_extensions limit reached |
| IDEMPOTENCY_MISMATCH | 409 | Same key, different payload |
| NOT_FOUND | 404 | Reservation never existed |
| UNAUTHORIZED | 401 | Invalid API key |
| FORBIDDEN | 403 | Reservation owned by different tenant |

### Event errors

| Error | HTTP | Meaning |
|---|---|---|
| BUDGET_EXCEEDED | 409 | Insufficient budget (REJECT only) |
| BUDGET_FROZEN | 409 | Budget scope is frozen |
| BUDGET_CLOSED | 409 | Budget scope is permanently closed |
| OVERDRAFT_LIMIT_EXCEEDED | 409 | Debt would exceed limit (ALLOW_WITH_OVERDRAFT) |
| NOT_FOUND | 404 | No budget exists at any derived scope in any unit (message: `"Budget not found for provided scope: ..."`) |
| UNIT_MISMATCH | 400 | `actual.unit` does not match any budget at the target scope (budget exists in a different unit) |
| INVALID_REQUEST | 400 | Malformed request |
| UNAUTHORIZED | 401 | Invalid API key |
| FORBIDDEN | 403 | Tenant mismatch |
| IDEMPOTENCY_MISMATCH | 409 | Same key, different payload |

Note: `/v1/events` is not part of the closed-tenant mutation guard's surface — the runtime spec's `TENANT_CLOSED` binding covers the persisting reservation mutations (create/commit/release/extend) only. A closed owning tenant surfaces on `/v1/events` as `401` (the auth filter rejects revoked/CLOSED-tenant keys) or `BUDGET_CLOSED` (the cascade closes the tenant's budgets).

## Decision reason codes

Separately from the 4xx error code list, `POST /v1/decide` and `POST /v1/reservations` with `dry_run=true` may return `200 OK` with `decision: DENY` and a machine-readable `reason_code`. As of v0.1.25, `DecisionReasonCode` is an **open string** (was a closed enum in v0.1.24 and earlier — widened so future extension specs can add reason codes without a breaking protocol bump). Documented known values:

| reason_code | Meaning |
|---|---|
| `BUDGET_EXCEEDED` | Remaining amount insufficient on at least one derived scope (evaluated against the requested `estimate.amount`). |
| `BUDGET_FROZEN` | A derived scope has a budget in `FROZEN` status (operator-set, no mutations allowed). |
| `BUDGET_CLOSED` | A derived scope has a budget in `CLOSED` status (permanently closed). |
| `BUDGET_NOT_FOUND` | No budget exists at any derived scope in the requested unit. On non-dry reserve and `/v1/events` paths this same underlying condition surfaces as `HTTP 404` with `error=NOT_FOUND` instead. |
| `OVERDRAFT_LIMIT_EXCEEDED` | Either `debt + delta > overdraft_limit` on commit, OR the scope is in over-limit state (`is_over_limit=true`) and no new reservations are permitted until reconciled. |
| `DEBT_OUTSTANDING` | A derived scope has `debt > 0` and `overdraft_limit == 0` (no policy permits further debt accrual). |
| `TENANT_CLOSED` | The owning tenant's status is `CLOSED` (deployments with a governance plane; added in spec v0.1.25.13, emitted by cycles-server 0.1.25.47+ on fresh dry-run/decide evaluations). The persisting mutation surface reports the same condition as `HTTP 409` with `error=TENANT_CLOSED` instead — see [TENANT_CLOSED (409)](#tenant-closed-409). |

**Why this is a separate enum.** The 4xx error codes surface request-level failures in the `error` field. Decision reason codes surface budget-state outcomes in the `reason_code` field on successful HTTP responses. Some labels overlap (e.g. `BUDGET_EXCEEDED`) because the same underlying condition is reported differently depending on the endpoint: `/decide` and dry-run reserve surface it as a non-4xx DENY decision, while non-dry reserve surfaces it as a `409` error.

**Forward compatibility.** Because `DecisionReasonCode` is an open string (since v0.1.25), **clients MUST handle unknown values gracefully** — treat as DENY, log the raw string, do not crash on enum parsing. Known values above are stable; future values will always be additive (e.g., v0.1.26 extension specs may emit `ACTION_QUOTA_EXCEEDED`, `ACTION_KIND_DENIED`, `ACTION_KIND_NOT_ALLOWED`).

## Idempotency and error handling

Errors interact with idempotency in specific ways:

- **Successful replay:** if you retry a request with the same idempotency key and payload, you get the original successful response. The operation is not applied again.
- **Payload mismatch:** if you reuse a key with a different payload, you get `409 IDEMPOTENCY_MISMATCH`.
- **Failed original:** if the original request failed (e.g., BUDGET_EXCEEDED), retrying with the same key sends a fresh request. Idempotency only applies to successful operations.

## Correlation identifiers

Every error response carries two server-generated identifiers:

- **`request_id`** — unique per HTTP request. Useful for correlating errors with server logs, debugging with the Cycles operator, and tracking specific failures in client-side monitoring.
- **`trace_id`** — 32-hex W3C Trace Context identifier. OPTIONAL on the schema; populated by conformant v0.1.25.14+ runtime and v0.1.25.31+ admin servers. Scopes a logical operation that may span multiple HTTP requests. Also echoed in the `X-Cycles-Trace-Id` response header.

Log both when handling errors. `trace_id` is usually the right choice for cross-plane root-cause analysis:

```bash
# Find everything that happened under one trace
GET /v1/admin/audit/logs?trace_id=<32-hex>
GET /v1/admin/events?trace_id=<32-hex>
```

`request_id` narrows to the side effects of one specific HTTP call. See [Correlation and Tracing](/protocol/correlation-and-tracing-in-cycles) for the full contract.

## Summary

Cycles provides 17 specific error codes that tell the client exactly what went wrong:

- **400** for request validation issues (INVALID_REQUEST, UNIT_MISMATCH)
- **401** for authentication failures (UNAUTHORIZED)
- **403** for authorization failures (FORBIDDEN)
- **404** for missing resources (NOT_FOUND) — covers both missing reservations and missing budgets, distinguished by the `message` field
- **409** for budget and state conflicts (BUDGET_EXCEEDED, BUDGET_FROZEN, BUDGET_CLOSED, TENANT_CLOSED, OVERDRAFT_LIMIT_EXCEEDED, DEBT_OUTSTANDING, RESERVATION_FINALIZED, IDEMPOTENCY_MISMATCH, MAX_EXTENSIONS_EXCEEDED)
- **410** for expired reservations (RESERVATION_EXPIRED)
- **429** for rate limiting on public endpoints (LIMIT_EXCEEDED)
- **500** for server errors (INTERNAL_ERROR)

Additionally, `/v1/decide` and dry-run reserve surface budget-state conditions via a `reason_code` field on `200 DENY` responses rather than as 4xx errors. These values come from a separate [DecisionReasonCode](#decision-reason-codes) enum — distinct from the 4xx error code list.

Handling these codes correctly is the difference between a fragile integration and a production-grade one.

## Debugging with `trace_id`

When an error response carries `trace_id`, the fastest way to reconstruct the full operation is a three-call walk across the admin plane:

```bash
TID=<value from X-Cycles-Trace-Id header or error-body trace_id>
curl -s "http://localhost:7979/v1/admin/audit/logs?trace_id=$TID" -H "X-Admin-API-Key: $ADMIN_KEY"
curl -s "http://localhost:7979/v1/admin/events?trace_id=$TID"     -H "X-Admin-API-Key: $ADMIN_KEY"
```

See [Correlation and Tracing](/protocol/correlation-and-tracing-in-cycles) for the full contract (W3C Trace Context precedence, outbound headers on webhook deliveries, cross-plane propagation rules).

## Next steps

To explore the Cycles stack:

- Read the [Cycles Protocol](https://github.com/runcycles/cycles-protocol)
- [Correlation and Tracing](/protocol/correlation-and-tracing-in-cycles) — `trace_id` as the cross-plane join key for debugging
- Run the [Cycles Server](https://github.com/runcycles/cycles-server)
- Manage budgets with [Cycles Admin](https://github.com/runcycles/cycles-server-admin)
- Integrate with Python using the [Python Client](/quickstart/getting-started-with-the-python-client)
- Integrate with TypeScript using the [TypeScript Client](/quickstart/getting-started-with-the-typescript-client)
- Integrate with Spring Boot or Spring AI using the [Spring Boot starter](https://github.com/runcycles/cycles-spring-boot-starter) or the [Spring AI starter](https://github.com/runcycles/cycles-spring-ai-starter)
