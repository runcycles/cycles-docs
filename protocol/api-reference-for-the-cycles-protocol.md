---
title: "API Reference for the Cycles Protocol"
description: "Developer reference for the core Cycles runtime budget endpoints and public CyclesEvidence retrieval endpoints."
---

# API Reference for the Cycles Protocol

This is a developer-friendly reference for the core runtime budget endpoints and public CyclesEvidence retrieval endpoints. The [interactive API reference](/api/) is generated from the YAML spec and remains the exhaustive operation browser.

Tenant-scoped runtime requests require the `X-Cycles-API-Key` header for authentication. Reservation list/detail/release also accept `X-Admin-API-Key` for operator workflows on the small admin-on-behalf-of surface. The two CyclesEvidence read endpoints, `GET /v1/evidence/{evidence_id}` and `GET /v1/.well-known/cycles-jwks.json`, are public by spec because they expose only content-addressed evidence envelopes and public verification keys.

::: info Protocol conformance
Cycles is an **open protocol with a minimum conformance surface**. The active v0.1.25 target requires 12 MUST operations: four core runtime reservation operations plus eight cross-plane event, webhook, balance, and auth-introspection operations. `decide`, reservation listing/detail, and direct-debit events are SHOULD-level runtime operations that the reference servers expose. v0.1.26 action-governance specs are published as upcoming extensions, but they are not required for current conformance and are not enforced by the current reference servers. See [`CONFORMANCE.md`](https://github.com/runcycles/cycles-protocol/blob/main/CONFORMANCE.md) for the authoritative MUST / SHOULD / MAY statement.
:::

## Common headers

### Request headers

| Header | Required | Description |
|---|---|---|
| `Content-Type` | Yes (POST) | `application/json` |
| `X-Cycles-API-Key` | Yes for tenant-scoped runtime endpoints | API key for authentication and tenant derivation |
| `X-Admin-API-Key` | Operator-only on reservation list/detail/release | Admin-on-behalf-of authentication for incident response and inspection |
| `X-Idempotency-Key` | No | Client-provided idempotency key (also accepted in the request body) |

### Response headers

| Header | Description |
|---|---|
| `X-Request-Id` | Unique request identifier for debugging and support |
| `X-Cycles-Trace-Id` | 32-hex W3C Trace Context identifier. Servers MUST echo it on every response (2xx, 4xx, 5xx). The trace ID is taken from an inbound `traceparent` header (preferred) or `X-Cycles-Trace-Id` header when valid, otherwise generated fresh. See [Correlation and Tracing](/protocol/correlation-and-tracing-in-cycles). |
| `X-Cycles-Tenant` | Effective tenant identifier derived from auth context (optional in v0) |
| `X-RateLimit-Remaining` | Number of requests remaining in current window (optional in v0) |
| `X-RateLimit-Reset` | Unix timestamp (seconds) when rate limit resets (optional in v0) |

## Common types

### Subject

The budgeting scope. At least one standard field is required.

```json
{
  "tenant": "acme",
  "workspace": "production",
  "app": "support-bot",
  "workflow": "refund-flow",
  "agent": "planner",
  "toolset": "search-tools",
  "dimensions": {
    "cost_center": "engineering",
    "run_id": "run-12345"
  }
}
```

All fields are optional except that at least one of `tenant`, `workspace`, `app`, `workflow`, `agent`, or `toolset` must be present. The `dimensions` field allows arbitrary key-value pairs for alternative taxonomies — attribution, reporting, and policy facets. Dimensions never derive budget scopes, and v0 servers MAY ignore them for budgeting decisions; anything that needs an enforceable budget belongs in one of the six standard fields.

### Amount

```json
{
  "amount": 5000,
  "unit": "USD_MICROCENTS"
}
```

Units: `USD_MICROCENTS`, `TOKENS`, `CREDITS`, `RISK_POINTS`.

### Action

```json
{
  "kind": "llm.completion",
  "name": "openai:gpt-4o",
  "tags": ["customer-facing", "prod"]
}
```

### Caps (soft constraints)

Returned when the decision is `ALLOW_WITH_CAPS`:

```json
{
  "max_tokens": 500,
  "max_steps_remaining": 3,
  "tool_allowlist": ["search"],
  "tool_denylist": ["code_exec"],
  "cooldown_ms": 2000
}
```

### Error response

```json
{
  "error": "BUDGET_EXCEEDED",
  "message": "Insufficient budget in scope tenant:acme",
  "request_id": "req-abc-123",
  "trace_id": "0af7651916cd43dd8448eb211c80319c",
  "details": {}
}
```

---

## POST /v1/reservations

Reserve budget before executing work.

### Request body

| Field | Type | Required | Description |
|---|---|---|---|
| `idempotency_key` | string | Yes | Unique key for idempotent retries |
| `subject` | Subject | Yes | Budgeting scope |
| `action` | Action | Yes | Action being budgeted |
| `estimate` | Amount | Yes | Estimated cost |
| `ttl_ms` | integer | No | Reservation TTL in ms (default: tenant `default_reservation_ttl_ms` or 60000, range: 1000–86400000, capped to tenant `max_reservation_ttl_ms`) |
| `grace_period_ms` | integer | No | Grace period after TTL for late commits (default: 5000, range: 0–60000) |
| `overage_policy` | string | No | `REJECT`, `ALLOW_IF_AVAILABLE`, or `ALLOW_WITH_OVERDRAFT` (default: tenant `default_commit_overage_policy` or `ALLOW_IF_AVAILABLE`) |
| `dry_run` | boolean | No | If true, evaluate without reserving (default: false) |
| `metadata` | object | No | Arbitrary key-value metadata |

### Response (200 OK)

```json
{
  "reservation_id": "res-abc-123",
  "decision": "ALLOW",
  "expires_at_ms": 1710000060000,
  "affected_scopes": [
    "tenant:acme",
    "tenant:acme/workspace:production"
  ],
  "scope_path": "tenant:acme/workspace:production",
  "reserved": { "amount": 5000, "unit": "USD_MICROCENTS" },
  "balances": [
    {
      "scope": "tenant:acme",
      "scope_path": "tenant:acme",
      "remaining": { "amount": 95000, "unit": "USD_MICROCENTS" },
      "allocated": { "amount": 100000, "unit": "USD_MICROCENTS" },
      "spent": { "amount": 0, "unit": "USD_MICROCENTS" },
      "reserved": { "amount": 5000, "unit": "USD_MICROCENTS" },
      "debt": { "amount": 0, "unit": "USD_MICROCENTS" },
      "overdraft_limit": { "amount": 0, "unit": "USD_MICROCENTS" },
      "is_over_limit": false
    }
  ],
  "caps": null,
  "reason_code": null,
  "retry_after_ms": null
}
```

When `decision` is `ALLOW_WITH_CAPS`, the `caps` field contains soft constraints.

When `decision` is `DENY` (dry_run only), the reservation is not created. For live reservations, insufficient budget returns a `409` error instead of `decision: DENY`.

When `reason_code` is present (on DENY), it provides a machine-readable reason for the denial. `retry_after_ms` optionally suggests when to retry.

### Dry run response

When `dry_run: true`, the response has the same structure but no reservation is persisted. The `reservation_id` and `expires_at_ms` fields are absent. The `affected_scopes` field is always populated, even when the decision is DENY.

### Example

```bash
curl -X POST http://localhost:7878/v1/reservations \
  -H "Content-Type: application/json" \
  -H "X-Cycles-API-Key: your-api-key" \
  -d '{
    "idempotency_key": "req-001",
    "subject": {
      "tenant": "acme",
      "workspace": "production",
      "app": "chatbot"
    },
    "action": {
      "kind": "llm.completion",
      "name": "gpt-4o"
    },
    "estimate": {
      "amount": 5000,
      "unit": "USD_MICROCENTS"
    },
    "ttl_ms": 60000,
    "overage_policy": "REJECT"
  }'
```

### Error responses

| Code | Error | When |
|---|---|---|
| 400 | `INVALID_REQUEST` | Missing or invalid fields |
| 400 | `UNIT_MISMATCH` | `estimate.unit` does not match any budget at the derived scopes (a budget exists in a different unit) |
| 401 | `UNAUTHORIZED` | Missing or invalid API key |
| 403 | `FORBIDDEN` | Tenant mismatch |
| 404 | `NOT_FOUND` | No budget ledger exists at any derived scope in any unit (message: `"Budget not found for provided scope: ..."`) |
| 409 | `BUDGET_EXCEEDED` | Insufficient budget |
| 409 | `BUDGET_FROZEN` | Budget scope is frozen |
| 409 | `BUDGET_CLOSED` | Budget scope is permanently closed |
| 409 | `OVERDRAFT_LIMIT_EXCEEDED` | Scope is over-limit |
| 409 | `DEBT_OUTSTANDING` | Scope has unpaid debt (no overdraft limit configured) |
| 409 | `TENANT_CLOSED` | Owning tenant's status is `CLOSED` (persisting create only, `dry_run` absent or `false`; deployments with a governance plane — spec v0.1.25.13, cycles-server 0.1.25.47+) |
| 409 | `IDEMPOTENCY_MISMATCH` | Same key, different payload |

**Dry run:** when `dry_run=true`, budget-state conditions (`BUDGET_EXCEEDED`, `BUDGET_FROZEN`, `BUDGET_CLOSED`, `OVERDRAFT_LIMIT_EXCEEDED`, `DEBT_OUTSTANDING`, `TENANT_CLOSED` on a closed owning tenant, and the 404 "no budget at any scope" case) surface as `200 OK` with `decision: DENY` and a `reason_code` field — `DecisionReasonCode` is an open string (as of v0.1.25); clients MUST handle unknown values gracefully — not as 4xx/409 errors. Request-validity errors (`INVALID_REQUEST`, `UNIT_MISMATCH`, `UNAUTHORIZED`, `FORBIDDEN`, `IDEMPOTENCY_MISMATCH`) are still returned as 4xx on dry-run. See [Decision reason codes](/protocol/error-codes-and-error-handling-in-cycles#decision-reason-codes).

---

## POST /v1/reservations/{id}/commit

Record actual usage and release the unused remainder.

### Request body

| Field | Type | Required | Description |
|---|---|---|---|
| `idempotency_key` | string | Yes | Unique key for idempotent retries |
| `actual` | Amount | Yes | Actual cost consumed |
| `metrics` | object | No | Standard metrics (see below) |
| `metadata` | object | No | Arbitrary audit metadata |

#### Metrics object

```json
{
  "tokens_input": 150,
  "tokens_output": 80,
  "latency_ms": 320,
  "model_version": "gpt-4o-2024-08-06",
  "custom": { "cache_hit": true }
}
```

### Response (200 OK)

```json
{
  "status": "COMMITTED",
  "charged": { "amount": 3200, "unit": "USD_MICROCENTS" },
  "released": { "amount": 1800, "unit": "USD_MICROCENTS" },
  "balances": [
    {
      "scope": "tenant:acme",
      "scope_path": "tenant:acme",
      "remaining": { "amount": 96800, "unit": "USD_MICROCENTS" },
      "allocated": { "amount": 100000, "unit": "USD_MICROCENTS" },
      "spent": { "amount": 3200, "unit": "USD_MICROCENTS" },
      "reserved": { "amount": 0, "unit": "USD_MICROCENTS" },
      "debt": { "amount": 0, "unit": "USD_MICROCENTS" },
      "overdraft_limit": { "amount": 0, "unit": "USD_MICROCENTS" },
      "is_over_limit": false
    }
  ]
}
```

### Example

```bash
curl -X POST http://localhost:7878/v1/reservations/res-abc-123/commit \
  -H "Content-Type: application/json" \
  -H "X-Cycles-API-Key: your-api-key" \
  -d '{
    "idempotency_key": "commit-001",
    "actual": {
      "amount": 3200,
      "unit": "USD_MICROCENTS"
    },
    "metrics": {
      "tokens_input": 150,
      "tokens_output": 80,
      "latency_ms": 320
    }
  }'
```

### Error responses

| Code | Error | When |
|---|---|---|
| 400 | `UNIT_MISMATCH` | Commit unit differs from reservation unit |
| 401 | `UNAUTHORIZED` | Missing or invalid API key |
| 403 | `FORBIDDEN` | Reservation owned by different tenant |
| 404 | `NOT_FOUND` | Reservation does not exist |
| 409 | `BUDGET_EXCEEDED` | Actual exceeds budget (REJECT only) |
| 409 | `BUDGET_FROZEN` | Budget scope is frozen |
| 409 | `BUDGET_CLOSED` | Budget scope is permanently closed |
| 409 | `OVERDRAFT_LIMIT_EXCEEDED` | Debt would exceed limit (ALLOW_WITH_OVERDRAFT) |
| 409 | `RESERVATION_FINALIZED` | Already committed or released |
| 409 | `TENANT_CLOSED` | Owning tenant's status is `CLOSED` (spec v0.1.25.13, cycles-server 0.1.25.47+); takes precedence over reservation-state errors for non-replay requests |
| 409 | `IDEMPOTENCY_MISMATCH` | Same key, different payload |
| 410 | `RESERVATION_EXPIRED` | TTL + grace period elapsed |

---

## POST /v1/reservations/{id}/release

Cancel a reservation and return all reserved budget to the pool.

### Request body

| Field | Type | Required | Description |
|---|---|---|---|
| `idempotency_key` | string | Yes | Unique key for idempotent retries |
| `reason` | string | No | Human-readable reason for release |

### Response (200 OK)

```json
{
  "status": "RELEASED",
  "released": { "amount": 5000, "unit": "USD_MICROCENTS" },
  "balances": [
    {
      "scope": "tenant:acme",
      "scope_path": "tenant:acme",
      "remaining": { "amount": 100000, "unit": "USD_MICROCENTS" },
      "allocated": { "amount": 100000, "unit": "USD_MICROCENTS" },
      "spent": { "amount": 0, "unit": "USD_MICROCENTS" },
      "reserved": { "amount": 0, "unit": "USD_MICROCENTS" },
      "debt": { "amount": 0, "unit": "USD_MICROCENTS" },
      "overdraft_limit": { "amount": 0, "unit": "USD_MICROCENTS" },
      "is_over_limit": false
    }
  ]
}
```

### Example

```bash
curl -X POST http://localhost:7878/v1/reservations/res-abc-123/release \
  -H "Content-Type: application/json" \
  -H "X-Cycles-API-Key: your-api-key" \
  -d '{
    "idempotency_key": "release-001",
    "reason": "Task cancelled by user"
  }'
```

### Error responses

| Code | Error | When |
|---|---|---|
| 400 | `INVALID_REQUEST` | Malformed request (e.g., missing `idempotency_key`) |
| 401 | `UNAUTHORIZED` | Missing or invalid API key |
| 403 | `FORBIDDEN` | Reservation owned by different tenant |
| 404 | `NOT_FOUND` | Reservation does not exist |
| 409 | `RESERVATION_FINALIZED` | Already committed or released |
| 409 | `TENANT_CLOSED` | Owning tenant's status is `CLOSED` (spec v0.1.25.13, cycles-server 0.1.25.47+); takes precedence over reservation-state errors for non-replay requests |
| 409 | `IDEMPOTENCY_MISMATCH` | Same key, different payload |
| 410 | `RESERVATION_EXPIRED` | TTL + grace period elapsed |

---

## POST /v1/reservations/{id}/extend

Extend the TTL of an active reservation. Used as a heartbeat for long-running operations.

### Request body

| Field | Type | Required | Description |
|---|---|---|---|
| `idempotency_key` | string | Yes | Unique key for idempotent retries |
| `extend_by_ms` | integer | Yes | Milliseconds to extend (range: 1–86400000) |
| `metadata` | object | No | Optional debugging/audit metadata |

### Response (200 OK)

| Field | Type | Required | Description |
|---|---|---|---|
| `status` | string | Yes | Always `"ACTIVE"` after a successful extension |
| `expires_at_ms` | integer (int64) | Yes | New server-authoritative expiry timestamp (ms) |
| `balances` | array of Balance | No | Optional updated balances snapshot after extension |

```json
{
  "status": "ACTIVE",
  "expires_at_ms": 1710000120000,
  "balances": []
}
```

### Example

```bash
curl -X POST http://localhost:7878/v1/reservations/res-abc-123/extend \
  -H "Content-Type: application/json" \
  -H "X-Cycles-API-Key: your-api-key" \
  -d '{
    "idempotency_key": "extend-001",
    "extend_by_ms": 60000
  }'
```

### Error responses

| Code | Error | When |
|---|---|---|
| 400 | `INVALID_REQUEST` | Missing or invalid fields |
| 401 | `UNAUTHORIZED` | Missing or invalid API key |
| 403 | `FORBIDDEN` | Reservation owned by different tenant |
| 404 | `NOT_FOUND` | Reservation does not exist |
| 409 | `RESERVATION_FINALIZED` | Already committed or released |
| 409 | `TENANT_CLOSED` | Owning tenant's status is `CLOSED` (spec v0.1.25.13, cycles-server 0.1.25.47+); takes precedence over reservation-state errors for non-replay requests |
| 409 | `IDEMPOTENCY_MISMATCH` | Same key, different payload |
| 409 | `MAX_EXTENSIONS_EXCEEDED` | Tenant `max_reservation_extensions` limit reached |
| 410 | `RESERVATION_EXPIRED` | Past TTL (no grace period for extend) |

---

## GET /v1/reservations

List reservations with optional filters and pagination.

### Query parameters

| Parameter | Type | Description |
|---|---|---|
| `tenant` | string | Filter by tenant |
| `workspace` | string | Filter by workspace |
| `app` | string | Filter by app |
| `workflow` | string | Filter by workflow |
| `agent` | string | Filter by agent |
| `toolset` | string | Filter by toolset |
| `status` | string | Filter by status: `ACTIVE`, `COMMITTED`, `RELEASED`, `EXPIRED` |
| `idempotency_key` | string | Filter by idempotency key |
| `from` / `to` | string | ISO 8601 inclusive bounds on `created_at_ms`; either side may be supplied alone |
| `expires_from` / `expires_to` | string | ISO 8601 inclusive bounds on `expires_at_ms`; useful for finding stale or soon-expiring reservations |
| `finalized_from` / `finalized_to` | string | ISO 8601 inclusive bounds on `finalized_at_ms`; only COMMITTED and RELEASED rows match |
| `sort_by` | string | Column to sort by (v0.1.25.12+). See [Sorting](#sorting) below. |
| `sort_dir` | string | `asc` or `desc`. Default `desc`. |
| `include` | string | Comma-separated projection tokens: `metadata`, `committed_metadata`, `evidence` |
| `limit` | integer | Max results (1–200, default: 50) |
| `cursor` | string | Opaque cursor from previous response |

Under `X-Cycles-API-Key`, `tenant` is validation-only and must match the authenticated tenant. Under `X-Admin-API-Key`, `tenant` is required as a filter because admin auth has no effective tenant.

### Sorting

`sort_by` (v0.1.25.12+) accepts one of seven column names:

| Value | Sorts by |
|---|---|
| `reservation_id` | Reservation identifier (lexicographic) |
| `tenant` | Tenant slug |
| `scope_path` | Full scope path |
| `status` | Reservation status enum |
| `reserved` | Held amount (numeric, unit-native) |
| `created_at_ms` | Creation timestamp |
| `expires_at_ms` | Expiry timestamp |

Unknown values return `400 INVALID_REQUEST`. `sort_dir` defaults to `desc`; pass `asc` to reverse.

**Cursor-tuple binding.** The opaque cursor binds to the `(sort_by, sort_dir, filters)` tuple it was issued under. Reusing a cursor with a different sort key, direction, or filter set returns `400 INVALID_REQUEST` — a new first-page request must issue a new cursor. Callers that switch sort mid-walk should discard the cursor and restart.

**Sorted hydration warning.** Current reference servers hydrate all matching rows for sorted reservation listings, then sort and slice. When a sorted query hydrates 2,000 or more rows, the server logs a WARN so operators can add narrower filters or plan sorted indices. Rows beyond 2,000 are no longer truncated in v0.1.25.39+.

### Response (200 OK)

```json
{
  "reservations": [
    {
      "reservation_id": "res-abc-123",
      "status": "ACTIVE",
      "subject": { "tenant": "acme", "workspace": "production" },
      "action": { "kind": "llm.completion", "name": "gpt-4o" },
      "reserved": { "amount": 5000, "unit": "USD_MICROCENTS" },
      "expires_at_ms": 1710000060000,
      "created_at_ms": 1710000000000,
      "scope_path": "tenant:acme/workspace:production",
      "affected_scopes": ["tenant:acme", "tenant:acme/workspace:production"]
    }
  ],
  "has_more": false,
  "next_cursor": null
}
```

### Example

```bash
curl -s "http://localhost:7878/v1/reservations?tenant=acme&status=ACTIVE&include=evidence&limit=10" \
  -H "X-Cycles-API-Key: your-api-key"
```

### Error responses

| Code | Error | When |
|---|---|---|
| 400 | `INVALID_REQUEST` | Invalid filter parameters |
| 401 | `UNAUTHORIZED` | Missing or invalid API key |
| 403 | `FORBIDDEN` | Tenant mismatch under tenant auth |

---

## GET /v1/reservations/{id}

Get details of a specific reservation.

### Response (200 OK)

```json
{
  "reservation_id": "res-abc-123",
  "status": "COMMITTED",
  "idempotency_key": "req-001",
  "subject": { "tenant": "acme", "workspace": "production" },
  "action": { "kind": "llm.completion", "name": "gpt-4o" },
  "reserved": { "amount": 5000, "unit": "USD_MICROCENTS" },
  "committed": { "amount": 3200, "unit": "USD_MICROCENTS" },
  "created_at_ms": 1710000000000,
  "expires_at_ms": 1710000060000,
  "finalized_at_ms": 1710000045000,
  "scope_path": "tenant:acme/workspace:production",
  "affected_scopes": ["tenant:acme", "tenant:acme/workspace:production"],
  "metadata": {},
  "committed_metadata": {},
  "evidence": {
    "reserve": {
      "evidence_id": "8403bed43e13ef7d56a8ab402a9d29ee7dd2f405e24c0cacb51068341a5e7030",
      "cycles_evidence_url": "https://cycles.example.com/v1/evidence/8403bed43e13ef7d56a8ab402a9d29ee7dd2f405e24c0cacb51068341a5e7030"
    }
  }
}
```

### Example

```bash
curl -s http://localhost:7878/v1/reservations/res-abc-123 \
  -H "X-Cycles-API-Key: your-api-key"
```

### Error responses

| Code | Error | When |
|---|---|---|
| 401 | `UNAUTHORIZED` | Missing or invalid API key |
| 403 | `FORBIDDEN` | Reservation owned by different tenant |
| 404 | `NOT_FOUND` | Reservation does not exist |
| 410 | `RESERVATION_EXPIRED` | Reservation has expired |

---

## POST /v1/decide

Evaluate a budget decision without creating a reservation. Useful for preflight checks, UI affordances, and routing decisions.

### Request body

| Field | Type | Required | Description |
|---|---|---|---|
| `idempotency_key` | string | Yes | Unique key for idempotent retries |
| `subject` | Subject | Yes | Budgeting scope |
| `action` | Action | Yes | Action being evaluated |
| `estimate` | Amount | Yes | Estimated cost to evaluate |
| `metadata` | object | No | Arbitrary metadata |

### Response (200 OK)

```json
{
  "decision": "ALLOW",
  "affected_scopes": [
    "tenant:acme",
    "tenant:acme/workspace:production"
  ]
}
```

The `reason_code` and `retry_after_ms` fields are present when the decision is `DENY`. `reason_code` is `DecisionReasonCode` — an open string (as of v0.1.25) with seven documented known values: `BUDGET_EXCEEDED`, `BUDGET_FROZEN`, `BUDGET_CLOSED`, `BUDGET_NOT_FOUND`, `OVERDRAFT_LIMIT_EXCEEDED`, `DEBT_OUTSTANDING`, `TENANT_CLOSED` (added in spec v0.1.25.13 for closed owning tenants). Clients MUST handle unknown values gracefully. See [Decision reason codes](/protocol/error-codes-and-error-handling-in-cycles#decision-reason-codes).

### Example

```bash
curl -X POST http://localhost:7878/v1/decide \
  -H "Content-Type: application/json" \
  -H "X-Cycles-API-Key: your-api-key" \
  -d '{
    "idempotency_key": "decide-001",
    "subject": { "tenant": "acme", "workspace": "production" },
    "action": { "kind": "llm.completion", "name": "gpt-4o" },
    "estimate": { "amount": 5000, "unit": "USD_MICROCENTS" }
  }'
```

### Error responses

| Code | Error | When |
|---|---|---|
| 400 | `INVALID_REQUEST` | Missing or invalid fields |
| 400 | `UNIT_MISMATCH` | `estimate.unit` does not match any budget at the derived scopes (a budget exists in a different unit) |
| 401 | `UNAUTHORIZED` | Missing or invalid API key |
| 403 | `FORBIDDEN` | Tenant mismatch |
| 409 | `IDEMPOTENCY_MISMATCH` | Same key, different payload |

Note: decide returns `200` with `decision: DENY` for all budget-state conditions — insufficient remaining, debt, overdraft, frozen, closed, the "no budget exists at any scope" case, and a closed owning tenant — not a `409` or `404`. The specific reason is surfaced in the `reason_code` field. `DecisionReasonCode` is an open string (as of v0.1.25) with seven documented known values: `BUDGET_EXCEEDED`, `BUDGET_FROZEN`, `BUDGET_CLOSED`, `BUDGET_NOT_FOUND`, `OVERDRAFT_LIMIT_EXCEEDED`, `DEBT_OUTSTANDING`, `TENANT_CLOSED` (spec v0.1.25.13; fresh evaluations on a closed owning tenant — never `409 TENANT_CLOSED` on this endpoint, though a present-but-malformed tenant record fails closed with `500 INTERNAL_ERROR`). Clients MUST handle unknown values gracefully. See [Decision reason codes](/protocol/error-codes-and-error-handling-in-cycles#decision-reason-codes) for full semantics. Request-validity errors like `UNIT_MISMATCH` are still returned as `400`.

---

## GET /v1/balances

Query current budget state for one or more scopes.

### Query parameters

| Parameter | Type | Description |
|---|---|---|
| `tenant` | string | Filter by tenant |
| `workspace` | string | Filter by workspace |
| `app` | string | Filter by app |
| `workflow` | string | Filter by workflow |
| `agent` | string | Filter by agent |
| `toolset` | string | Filter by toolset |
| `include_children` | boolean | Include child scopes (default: false) |
| `limit` | integer | Max results (1–200, default: 50) |
| `cursor` | string | Opaque cursor from previous response |

At least one of `tenant`, `workspace`, `app`, `workflow`, `agent`, or `toolset` must be provided. The `tenant` parameter is validation-only: if provided, it must match the effective tenant derived from the API key.

### Response (200 OK)

```json
{
  "balances": [
    {
      "scope": "tenant:acme",
      "scope_path": "tenant:acme",
      "remaining": { "amount": 96800, "unit": "USD_MICROCENTS" },
      "allocated": { "amount": 100000, "unit": "USD_MICROCENTS" },
      "spent": { "amount": 3200, "unit": "USD_MICROCENTS" },
      "reserved": { "amount": 0, "unit": "USD_MICROCENTS" },
      "debt": { "amount": 0, "unit": "USD_MICROCENTS" },
      "overdraft_limit": { "amount": 0, "unit": "USD_MICROCENTS" },
      "is_over_limit": false
    },
    {
      "scope": "workspace:production",
      "scope_path": "tenant:acme/workspace:production",
      "remaining": { "amount": 46800, "unit": "USD_MICROCENTS" },
      "allocated": { "amount": 50000, "unit": "USD_MICROCENTS" },
      "spent": { "amount": 3200, "unit": "USD_MICROCENTS" },
      "reserved": { "amount": 0, "unit": "USD_MICROCENTS" },
      "debt": { "amount": 0, "unit": "USD_MICROCENTS" },
      "overdraft_limit": { "amount": 0, "unit": "USD_MICROCENTS" },
      "is_over_limit": false
    }
  ],
  "has_more": false,
  "next_cursor": null
}
```

### Example

```bash
curl -s "http://localhost:7878/v1/balances?tenant=acme&workspace=production" \
  -H "X-Cycles-API-Key: your-api-key"
```

### Error responses

| Code | Error | When |
|---|---|---|
| 400 | `INVALID_REQUEST` | No subject filter provided |
| 401 | `UNAUTHORIZED` | Missing or invalid API key |
| 403 | `FORBIDDEN` | Tenant mismatch |

---

## POST /v1/events

Record a direct debit event without a prior reservation. Used for post-hoc accounting when the reserve → commit lifecycle does not apply.

### Request body

| Field | Type | Required | Description |
|---|---|---|---|
| `idempotency_key` | string | Yes | Unique key for idempotent retries |
| `subject` | Subject | Yes | Budgeting scope |
| `action` | Action | Yes | Action being recorded |
| `actual` | Amount | Yes | Actual cost to record |
| `overage_policy` | string | No | `REJECT`, `ALLOW_IF_AVAILABLE`, or `ALLOW_WITH_OVERDRAFT` (default: tenant `default_commit_overage_policy` or `ALLOW_IF_AVAILABLE`) |
| `metrics` | object | No | Standard metrics |
| `client_time_ms` | integer | No | Client-side timestamp |
| `metadata` | object | No | Arbitrary metadata |

### Response (201 Created)

```json
{
  "status": "APPLIED",
  "event_id": "evt-abc-123",
  "charged": { "amount": 4400, "unit": "USD_MICROCENTS" },
  "balances": [
    {
      "scope": "tenant:acme",
      "scope_path": "tenant:acme",
      "remaining": { "amount": 95600, "unit": "USD_MICROCENTS" },
      "allocated": { "amount": 100000, "unit": "USD_MICROCENTS" },
      "spent": { "amount": 4400, "unit": "USD_MICROCENTS" },
      "reserved": { "amount": 0, "unit": "USD_MICROCENTS" },
      "debt": { "amount": 0, "unit": "USD_MICROCENTS" },
      "overdraft_limit": { "amount": 0, "unit": "USD_MICROCENTS" },
      "is_over_limit": false
    }
  ]
}
```

`charged` is optional. It is present when `overage_policy` is `ALLOW_IF_AVAILABLE` and the actual amount was capped to the remaining budget, so the client can see the effective charge applied.

### Example

```bash
curl -X POST http://localhost:7878/v1/events \
  -H "Content-Type: application/json" \
  -H "X-Cycles-API-Key: your-api-key" \
  -d '{
    "idempotency_key": "evt-001",
    "subject": {
      "tenant": "acme",
      "workspace": "production"
    },
    "action": {
      "kind": "search.api",
      "name": "google-search"
    },
    "actual": {
      "amount": 1200,
      "unit": "USD_MICROCENTS"
    }
  }'
```

### Error responses

| Code | Error | When |
|---|---|---|
| 400 | `INVALID_REQUEST` | Missing or invalid fields |
| 400 | `UNIT_MISMATCH` | `actual.unit` does not match any budget at the target scope (a budget exists in a different unit) |
| 401 | `UNAUTHORIZED` | Missing or invalid API key |
| 403 | `FORBIDDEN` | Tenant mismatch |
| 404 | `NOT_FOUND` | No budget ledger exists at any derived scope in any unit (message: `"Budget not found for provided scope: ..."`) |
| 409 | `BUDGET_EXCEEDED` | Insufficient budget (REJECT only) |
| 409 | `BUDGET_FROZEN` | Budget scope is frozen |
| 409 | `BUDGET_CLOSED` | Budget scope is permanently closed |
| 409 | `OVERDRAFT_LIMIT_EXCEEDED` | Debt would exceed limit |
| 409 | `IDEMPOTENCY_MISMATCH` | Same key, different payload |

---

## GET /v1/evidence/{evidence_id}

Fetch a signed CyclesEvidence envelope by content id. This endpoint is public: the `evidence_id` is a 64-character lowercase SHA-256 content hash carried by a prior `cycles_evidence` response reference, and the returned envelope is content-addressed and signature-verifiable.

### Path parameters

| Parameter | Type | Required | Description |
|---|---|---|---|
| `evidence_id` | string | Yes | 64 lowercase hex characters; SHA-256 content hash of the evidence envelope |

### Response (200 OK)

Returns the signed envelope as JSON. The exact envelope shape is covered in [CyclesEvidence Envelopes](/protocol/cycles-evidence-envelopes-in-cycles).

```json
{
  "schema_version": "cycles-evidence/v0.1",
  "artifact_type": "reserve",
  "server_id": "https://cycles.example.com/v1",
  "signer_did": "b10554...",
  "issued_at_ms": 1781436904050,
  "trace_id": "b2a0ab88...",
  "payload": { "reserve": { "request": {}, "response": {} } },
  "evidence_id": "8403bed43e13ef7d56a8ab402a9d29ee7dd2f405e24c0cacb51068341a5e7030",
  "signature": "4bc8cb9a..."
}
```

### Example

```bash
curl -s http://localhost:7878/v1/evidence/8403bed43e13ef7d56a8ab402a9d29ee7dd2f405e24c0cacb51068341a5e7030
```

### Error responses

| Code | Error | When |
|---|---|---|
| 400 | `INVALID_REQUEST` | `evidence_id` is not a valid 64-character lowercase hex string |
| 404 | `NOT_FOUND` | Envelope is not available or evidence signing/storage is not configured |
| 429 | `LIMIT_EXCEEDED` | Public endpoint throttled (reference server default: 300 requests/minute per client IP); retry after `Retry-After` |

---

## GET /v1/.well-known/cycles-jwks.json

Fetch the issuing server's public CyclesEvidence JWK Set. This endpoint is public and contains verification keys only; the private signing key is never served.

The path is API-base-relative. If `server_id` is `https://cycles.example.com/v1`, the JWKS URL is `https://cycles.example.com/v1/.well-known/cycles-jwks.json`.

### Response (200 OK)

```json
{
  "keys": [
    {
      "kty": "OKP",
      "crv": "Ed25519",
      "alg": "EdDSA",
      "x": "base64url-public-key",
      "kid": "2026-h2",
      "cycles_nbf_ms": 1781000000000,
      "status": "active"
    }
  ]
}
```

### Example

```bash
curl -s http://localhost:7878/v1/.well-known/cycles-jwks.json
```

### Error responses

| Code | Error | When |
|---|---|---|
| 404 | `NOT_FOUND` | The server does not publish a JWK Set, usually because signer-key resolution is not configured |
| 429 | `LIMIT_EXCEEDED` | Public endpoint throttled (reference server default: 300 requests/minute per client IP); retry after `Retry-After` |

---

## Idempotency

All write operations require idempotency via the `idempotency_key` field in the request body. The `X-Idempotency-Key` header is also accepted; if both are provided, they must match.

- If you retry a request with the same key and the same payload, you get the original successful response. The operation is not applied again.
- If you reuse a key with a different payload, you get `409 IDEMPOTENCY_MISMATCH`.
- If the original request failed, retrying with the same key sends a fresh request.

Idempotency is scoped per (effective tenant, endpoint, idempotency_key).

## Next steps

- [Error Codes and Error Handling](/protocol/error-codes-and-error-handling-in-cycles) — detailed error code reference
- [Self-Hosting the Cycles Server](/quickstart/self-hosting-the-cycles-server) — deploy your own instance
- [Getting Started with the Spring Boot Starter](/quickstart/getting-started-with-the-cycles-spring-boot-starter) — client integration
