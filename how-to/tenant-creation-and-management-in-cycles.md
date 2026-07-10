---
title: "Tenant Creation and Management in Cycles"
description: "How to create, configure, and manage tenants in Cycles using the Admin API — including status lifecycle, hierarchical tenants, metadata, and common multi-tenant use cases."
---

# Tenant Creation and Management in Cycles

Tenants are the top-level isolation boundary in Cycles. Every budget, API key, and reservation is scoped to exactly one tenant.

Before you can enforce budgets or issue API keys, you need at least one tenant. This guide covers the full tenant lifecycle through the Admin API. For an overview of how tenants fit into the broader scope and budget model, see [Understanding Tenants, Scopes, and Budgets](/how-to/understanding-tenants-scopes-and-budgets-in-cycles).

## What tenants are and when to create them

A tenant represents an isolated organizational unit in Cycles. Depending on your platform, a tenant might map to:

- a customer account in a SaaS product
- an internal team or department
- a business unit with its own budget
- a partner or reseller in a marketplace

Every API key belongs to one tenant. Every reservation is owned by one tenant. Every balance query is scoped to one tenant. This isolation is enforced at the protocol level — not by convention.

**Create a tenant when you need an independent budget boundary.** If two groups of users should not share budget, they should be separate tenants.

## Creating a tenant

Create a tenant using the Admin API with the `X-Admin-API-Key` header:

```bash
curl -s -X POST http://localhost:7979/v1/admin/tenants \
  -H "Content-Type: application/json" \
  -H "X-Admin-API-Key: $ADMIN_API_KEY" \
  -d '{
    "tenant_id": "acme-corp",
    "name": "Acme Corporation"
  }' | jq .
```

Response:

```json
{
  "tenant_id": "acme-corp",
  "name": "Acme Corporation",
  "status": "ACTIVE",
  "created_at": "2026-03-20T12:00:00Z"
}
```

### Tenant ID format

The `tenant_id` must be:

- **Lowercase alphanumeric with hyphens:** matches `^[a-z0-9-]+$`
- **Between 3 and 64 characters**
- **Kebab-case by convention:** for example, `acme-corp`, `demo-tenant`, `team-engineering`

Choose IDs that are stable and meaningful. The `tenant_id` is used in scope paths (e.g., `tenant:acme-corp/workspace:prod`), API key bindings, and audit logs. It cannot be changed after creation.

### Optional fields on creation

You can provide additional configuration when creating a tenant:

```bash
curl -s -X POST http://localhost:7979/v1/admin/tenants \
  -H "Content-Type: application/json" \
  -H "X-Admin-API-Key: $ADMIN_API_KEY" \
  -d '{
    "tenant_id": "acme-corp",
    "name": "Acme Corporation",
    "parent_tenant_id": "acme-group",
    "default_commit_overage_policy": "ALLOW_IF_AVAILABLE",
    "default_reservation_ttl_ms": 120000,
    "max_reservation_ttl_ms": 7200000,
    "max_reservation_extensions": 5,
    "reservation_expiry_policy": "AUTO_RELEASE",
    "metadata": {
      "billing_id": "cust_12345",
      "plan": "enterprise",
      "region": "us-east-1"
    }
  }' | jq .
```

The accepted optional fields on creation are:

| Field | Default | Description |
|---|---|---|
| `parent_tenant_id` | — | Parent tenant for hierarchical relationships (see [Hierarchical tenants](#hierarchical-tenants)) |
| `default_commit_overage_policy` | `ALLOW_IF_AVAILABLE` | Default overage policy: `REJECT`, `ALLOW_IF_AVAILABLE`, or `ALLOW_WITH_OVERDRAFT` |
| `default_reservation_ttl_ms` | `60000` (60s) | Default TTL when a reservation request does not specify `ttl_ms` |
| `max_reservation_ttl_ms` | `3600000` (1h) | Maximum allowed TTL; requests exceeding this are capped |
| `max_reservation_extensions` | `10` | Maximum TTL extensions per reservation |
| `reservation_expiry_policy` | `AUTO_RELEASE` | How expired reservations are handled: `AUTO_RELEASE`, `MANUAL_CLEANUP`, or `GRACE_ONLY`. **Creation-only** — it cannot be changed via `PATCH` afterwards |
| `metadata` | — | Key-value pairs for external references (up to 32 keys) |

Each of these fields is covered in detail in the sections below.

### Idempotent creation

Tenant creation is idempotent. If you retry a `POST /v1/admin/tenants` request with the same `tenant_id`:

- If the existing tenant has the **same name**, the server returns `200` with the existing tenant (not `201`).
- If the existing tenant has a **different name**, the server returns `409 CONFLICT`.

This makes it safe to retry tenant creation without checking whether the tenant already exists.

## Listing tenants

List all tenants with optional filters:

```bash
# List all active tenants
curl -s "http://localhost:7979/v1/admin/tenants?status=ACTIVE" \
  -H "X-Admin-API-Key: $ADMIN_API_KEY" | jq .
```

Response:

```json
{
  "tenants": [
    {
      "tenant_id": "acme-corp",
      "name": "Acme Corporation",
      "status": "ACTIVE",
      "created_at": "2026-03-20T12:00:00Z"
    }
  ],
  "has_more": false,
  "next_cursor": null
}
```

### Available filters

| Parameter | Description |
|---|---|
| `status` | Filter by status: `ACTIVE`, `SUSPENDED`, or `CLOSED` |
| `parent_tenant_id` | Filter by parent tenant (for hierarchical tenants) |
| `observe_mode` | Filter by observe-mode flag (`true`/`false`) |
| `search` | Case-insensitive substring match over `tenant_id` and `name` |
| `sort_by` / `sort_dir` | Sort key and direction (default: `created_at` descending) |
| `cursor` | Pagination cursor from a previous response |
| `limit` | Page size (default: 50, max: 100) |

See [Searching and Sorting Admin List Endpoints](/how-to/searching-and-sorting-admin-list-endpoints) for the shared `search`/`sort_by`/`sort_dir` parameter vocabulary.

### Cursor-based pagination

For large tenant lists, use cursor-based pagination:

```bash
# First page
curl -s "http://localhost:7979/v1/admin/tenants?limit=10" \
  -H "X-Admin-API-Key: $ADMIN_API_KEY" | jq .

# Next page (use next_cursor from previous response)
curl -s "http://localhost:7979/v1/admin/tenants?limit=10&cursor=eyJ0ZW5..." \
  -H "X-Admin-API-Key: $ADMIN_API_KEY" | jq .
```

Continue until `has_more` is `false`.

## Retrieving a tenant

Get a single tenant by ID:

```bash
curl -s "http://localhost:7979/v1/admin/tenants/acme-corp" \
  -H "X-Admin-API-Key: $ADMIN_API_KEY" | jq .
```

This returns the full tenant object including all configuration, metadata, and timestamps.

## Updating a tenant

Update a tenant with `PATCH`:

```bash
curl -s -X PATCH http://localhost:7979/v1/admin/tenants/acme-corp \
  -H "Content-Type: application/json" \
  -H "X-Admin-API-Key: $ADMIN_API_KEY" \
  -d '{
    "name": "Acme Corp (Enterprise)",
    "metadata": {
      "billing_id": "cust_12345",
      "plan": "enterprise-plus"
    }
  }' | jq .
```

You can update:

- `name` — the display name
- `status` — transition between ACTIVE, SUSPENDED, and CLOSED (see lifecycle below)
- `metadata` — key-value pairs (replaces the full metadata object)
- `default_commit_overage_policy` — the default overage policy for all scopes
- `default_reservation_ttl_ms` — default TTL for reservations (1,000–86,400,000 ms)
- `max_reservation_ttl_ms` — maximum allowed TTL (1,000–86,400,000 ms)
- `max_reservation_extensions` — maximum TTL extensions per reservation (0+)

Fields not included in the `PATCH` request are left unchanged.

## Tenant status lifecycle

::: tip Status changes from the dashboard
Suspend, reactivate, and close are also one-click actions on the Tenants page in the [Cycles Admin Dashboard](/quickstart/deploying-the-cycles-dashboard). The Tenants list also supports **bulk suspend / reactivate** with a multi-select bar and per-tenant progress — useful when you need to lock down or restore many tenants at once during an incident.
:::

Every tenant has a status that controls what operations are allowed:

```
              suspend
  ACTIVE ─────────────► SUSPENDED
    │    ◄─────────────    │
    │       reactivate     │
    │                      │
    │   close              │   close
    ▼                      ▼
  CLOSED ◄────────────────────
```

### ACTIVE

The default state. All operations are allowed:

- New reservations can be created
- Existing reservations can be committed, released, or extended
- Balances can be queried
- New API keys can be issued

### SUSPENDED

A temporary block. Use this when you need to pause a tenant without permanent closure:

- **New reservations are blocked** — the server returns an error for any new reservation attempt
- Existing active reservations **can still be committed or released** — this prevents data loss from in-flight work
- Balances can still be queried
- The tenant can be **reactivated** back to ACTIVE at any time

**When to suspend:**

- A customer's payment has failed
- A security concern requires a temporary freeze
- An investigation is underway
- Usage needs to be paused during a plan change

```bash
# Suspend a tenant
curl -s -X PATCH http://localhost:7979/v1/admin/tenants/acme-corp \
  -H "Content-Type: application/json" \
  -H "X-Admin-API-Key: $ADMIN_API_KEY" \
  -d '{"status": "SUSPENDED"}' | jq .

# Reactivate the tenant
curl -s -X PATCH http://localhost:7979/v1/admin/tenants/acme-corp \
  -H "Content-Type: application/json" \
  -H "X-Admin-API-Key: $ADMIN_API_KEY" \
  -d '{"status": "ACTIVE"}' | jq .
```

### CLOSED

Permanent and irreversible. Use this only when a tenant is being decommissioned:

- All operations are blocked
- The tenant **cannot be reactivated**
- Data is retained for audit purposes
- **All owned objects cascade to terminal states automatically** (v0.1.25.35+)

**When to close:**

- A customer has churned and the account is being archived
- A test or demo tenant is no longer needed
- A department has been merged and its tenant is being retired

```bash
# Close a tenant (irreversible — triggers cascade)
curl -s -X PATCH http://localhost:7979/v1/admin/tenants/acme-corp \
  -H "Content-Type: application/json" \
  -H "X-Admin-API-Key: $ADMIN_API_KEY" \
  -d '{"status": "CLOSED"}' | jq .
```

::: warning
Closing a tenant is irreversible. If you need a temporary block, use SUSPENDED instead.
:::

#### What cascades automatically (v0.1.25.35+)

Pre-v0.1.25.35, closing a tenant was a pure status flip — operators then had to separately drain reservations, freeze budgets, revoke API keys, and disable webhooks by hand. Today, `cycles-server-admin` runs the full cascade in one transaction:

| Owned object | Cascade action | Event kind |
|---|---|---|
| `BudgetLedger` | → `CLOSED` (final balance preserved for audit) | `budget.closed_via_tenant_cascade` |
| `ApiKey` | → `REVOKED` | `api_key.revoked_via_tenant_cascade` |
| Open `Reservation` | → `RELEASED` (reason `tenant_closed`, no overage debt) | `reservation.released_via_tenant_cascade` |
| `WebhookSubscription` | → `DISABLED` (re-enable blocked by Rule 2) | `webhook.disabled_via_tenant_cascade` |

The `*_via_tenant_cascade` identifiers are emitted as Event `event_type`s by the reference server (registered enum constants there, but absent from the published spec's `EventType` enum — so do not rely on cross-server `event_type=` filtering). The matching **audit rows** are written as `operation="tenant_close_cascade"` with `resource_type`/`resource_id`. Instead, all four cascade **event rows** share a server-composed `correlation_id` (`tenant_close_cascade:<tenant_id>:<request_id>`; audit rows carry `request_id`/`trace_id`, not `correlation_id`) — you can find every side effect of a close with one events query:

```bash
# All cascade events for one close
curl -s "http://localhost:7979/v1/admin/events?correlation_id=<id>" \
  -H "X-Admin-API-Key: $ADMIN_API_KEY" | jq '.events[] | {event_type, data}'
```

After the cascade, mutating any owned object returns `409 TENANT_CLOSED` (Rule 2 — Terminal-Owner Mutation Guard). GET endpoints remain available for post-mortem audit reads. See [Tenant-Close Cascade Semantics](/protocol/tenant-close-cascade-semantics) for the full Rule 1 / Rule 2 contract and Mode A / Mode B semantics.

::: warning Don't pre-freeze before closing
On admin v0.1.25.35+, the cascade runs automatically and atomically from the operator's perspective (via Rule 2). **Do not** freeze budgets, revoke keys, or disable webhooks before closing — it's unnecessary, generates audit clutter, and (on future Mode A implementations) can cause cascades to roll back if a pre-freeze step fails. Just close the tenant; the cascade handles everything.

If you're running pre-v0.1.25.35 admin, cascade doesn't run — continue the manual cleanup until you upgrade.
:::

**Operator preview in the dashboard.** The [Cycles Admin Dashboard](/quickstart/deploying-the-cycles-dashboard) (v0.1.25.43+) shows what will be terminated in the CLOSE confirmation dialog before you click through — owned budgets, webhook subscriptions, API keys, and open reservations, with counts. Useful for estimating blast radius before pulling the trigger.

#### What to expect after close

Once you click close, the amber "Tenant closed — all owned objects are read-only." banner renders immediately on the tenant detail page. Behind the scenes, the behavior depends on versions:

| Your admin version | What happens |
|---|---|
| **v0.1.25.36+** (recommended) | Rule 1 cascade runs; Rule 2 guard active on every mutation endpoint. Budgets, API keys, reservations, and webhooks all reach terminal state automatically. Any mutation attempt returns `409 TENANT_CLOSED`. |
| **v0.1.25.35** | Rule 1 cascade runs; Rule 2 guard covers budget + reservation mutations only. Policy, API key, and webhook-admin mutations against the now-closed tenant slip through silently until you upgrade. Cascade itself still completes correctly. |
| **Pre-v0.1.25.35** | No cascade. Dashboard banner still renders (it's purely UI state), but owned objects stay in their pre-close state until you manually freeze / revoke / disable them. |

**Mode B timing.** runcycles' reference server uses Mode B (flip-first with guarded cascade) — `tenant.status` flips to `CLOSED` first, then children cascade inline. A GET against an owned budget in the milliseconds between flip and cascade-completion may still return the pre-terminal status, but any mutation will already be rejected by the Rule 2 guard. The observable window is typically sub-second on a healthy Redis; if it lingers longer, check the admin server's event-emission queue.

**Verify the cascade finished.** One audit query confirms every side effect:

```bash
# Audit rows carry request_id/trace_id (no correlation_id field); the
# cascade correlation_id is composed as tenant_close_cascade:<tenant_id>:<request_id>
RID=$(curl -s "http://localhost:7979/v1/admin/audit/logs?tenant_id=acme-corp&operation=updateTenant&limit=1" \
  -H "X-Admin-API-Key: $ADMIN_API_KEY" | jq -r '.logs[0].request_id')
CID="tenant_close_cascade:acme-corp:$RID"

# Pull every cascade event under that correlation_id
curl -s "http://localhost:7979/v1/admin/events?correlation_id=$CID" \
  -H "X-Admin-API-Key: $ADMIN_API_KEY" | jq '.events[] | {event_type, resource: .data}'
```

You should see one event per owned object — `budget.closed_via_tenant_cascade` per ledger, `api_key.revoked_via_tenant_cascade` per key, `webhook.disabled_via_tenant_cascade` per subscription — and one ledger-level `reservation.released_via_tenant_cascade` per closed budget that had `reserved > 0` (aggregate `released_amount`, not per-reservation). If the count is short, either the cascade is still draining (wait a second and re-query) or you're on pre-v0.1.25.35 admin.

::: info Why tenants cannot be deleted
The admin API intentionally has no `DELETE /v1/admin/tenants/{tenant_id}` endpoint. Tenants are referenced by ID throughout the system — budgets, API keys, reservations, and audit logs all carry a `tenant_id`. Hard deletion would orphan these records and break audit trails.

`CLOSED` achieves the same operational goal: all operations are blocked and no new resources can be created. The difference is that the tenant record and all associated data remain queryable for reporting, compliance, and debugging.

**Cleaning up test tenants:** Use a naming convention like `test-*` or `demo-*` and batch-close them with `bulkActionTenants`:

```bash
curl -X POST http://localhost:7979/v1/admin/tenants/bulk-action \
  -H "X-Admin-API-Key: $ADMIN_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "action": "CLOSE",
    "filter": { "search": "test-" },
    "idempotency_key": "cleanup-2026-04-20-test-tenants"
  }' | jq '{succeeded: (.succeeded | length), failed: .failed}'
```

The cascade runs per-row — each closed tenant's owned objects terminate under its own `correlation_id`. Rows already in the target state (e.g., a tenant that is already CLOSED) land in `skipped[]` with `reason: "ALREADY_IN_TARGET_STATE"`; genuine failures land in `failed[]` with a per-row `error_code` and `message`. The rest of the batch proceeds either way.

The data footprint of a closed tenant is minimal.
:::

### Invalid transitions

The server rejects invalid status transitions with `400 INVALID_REQUEST`:

- `CLOSED → ACTIVE` (cannot reactivate a closed tenant)
- `CLOSED → SUSPENDED` (cannot suspend a closed tenant)

## Configuring tenant defaults

Each tenant has configuration that governs how reservations behave. These properties are set at creation; all except `reservation_expiry_policy` can also be updated later via `PATCH`.

### Settable per tenant

| Property | Default | Description |
|---|---|---|
| `default_commit_overage_policy` | `ALLOW_IF_AVAILABLE` | What happens when actual spend exceeds the reserved amount |
| `default_reservation_ttl_ms` | `60000` (60s) | Default TTL when a reservation request does not specify `ttl_ms` |
| `max_reservation_ttl_ms` | `3600000` (1h) | Maximum allowed TTL; requests exceeding this are capped |
| `max_reservation_extensions` | `10` | Maximum TTL extensions per reservation (prevents zombie reservations) |
| `reservation_expiry_policy` | `AUTO_RELEASE` | How expired reservations are handled. **Creation-only** — not updatable via `PATCH` |

All of these except `reservation_expiry_policy` can also be updated later via `PATCH /v1/admin/tenants/{tenant_id}`. The expiry policy is fixed at creation; to change it you would need a new tenant.

### Commit overage policies

The `default_commit_overage_policy` controls what happens when a commit's `actual` amount exceeds the originally reserved `estimate`:

| Policy | Behavior |
|---|---|
| `REJECT` | Fail the commit if actual > reserved |
| `ALLOW_IF_AVAILABLE` | Charge the delta from remaining budget if sufficient |
| `ALLOW_WITH_OVERDRAFT` | Create debt up to the scope's `overdraft_limit` if budget is insufficient |

Set this at the tenant level to establish a baseline, then override per-budget-ledger or per-reservation as needed.

```bash
curl -s -X PATCH http://localhost:7979/v1/admin/tenants/acme-corp \
  -H "Content-Type: application/json" \
  -H "X-Admin-API-Key: $ADMIN_API_KEY" \
  -d '{"default_commit_overage_policy": "ALLOW_IF_AVAILABLE"}' | jq .
```

### Reservation expiry policies

The `reservation_expiry_policy` controls what happens when a reservation exceeds its TTL without being committed or released:

| Policy | Behavior |
|---|---|
| `AUTO_RELEASE` | Expired reservations are automatically released after a grace period, freeing the reserved budget |
| `MANUAL_CLEANUP` | Expired reservations require explicit release or a cleanup job |
| `GRACE_ONLY` | Allow commits during the grace period, then mark the reservation as `EXPIRED` |

For most deployments, `AUTO_RELEASE` is the safest default — it prevents zombie reservations from permanently locking budget.

### TTL configuration

- **`default_reservation_ttl_ms`** sets the TTL used when a reservation request does not specify `ttl_ms`. A value of 60,000 ms (60 seconds) works well for synchronous LLM calls. Increase it for longer-running workflows.

- **`max_reservation_ttl_ms`** caps the maximum TTL any reservation can request. This prevents callers from holding budget indefinitely. Requests that specify a `ttl_ms` exceeding this value are silently capped.

- **`max_reservation_extensions`** limits how many times a reservation's TTL can be extended. This prevents zombie reservations from being extended forever. A value of 10 is generous for most use cases.

Configure TTL settings per tenant:

```bash
curl -s -X PATCH http://localhost:7979/v1/admin/tenants/acme-corp \
  -H "Content-Type: application/json" \
  -H "X-Admin-API-Key: $ADMIN_API_KEY" \
  -d '{
    "default_reservation_ttl_ms": 120000,
    "max_reservation_ttl_ms": 7200000,
    "max_reservation_extensions": 5
  }' | jq .
```

## Hierarchical tenants

Cycles supports parent-child tenant relationships using the `parent_tenant_id` field. This enables:

- **Organizational hierarchy:** A parent company with subsidiary business units
- **Reseller models:** A partner who manages multiple end-customer tenants
- **Budget delegation:** A parent tenant that distributes budget to child tenants

### Creating a hierarchy

```bash
# Create the parent tenant
curl -s -X POST http://localhost:7979/v1/admin/tenants \
  -H "Content-Type: application/json" \
  -H "X-Admin-API-Key: $ADMIN_API_KEY" \
  -d '{
    "tenant_id": "acme-group",
    "name": "Acme Group (Parent)"
  }' | jq .

# Create child tenants under the parent
curl -s -X POST http://localhost:7979/v1/admin/tenants \
  -H "Content-Type: application/json" \
  -H "X-Admin-API-Key: $ADMIN_API_KEY" \
  -d '{
    "tenant_id": "acme-engineering",
    "name": "Acme Engineering",
    "parent_tenant_id": "acme-group"
  }' | jq .

curl -s -X POST http://localhost:7979/v1/admin/tenants \
  -H "Content-Type: application/json" \
  -H "X-Admin-API-Key: $ADMIN_API_KEY" \
  -d '{
    "tenant_id": "acme-marketing",
    "name": "Acme Marketing",
    "parent_tenant_id": "acme-group"
  }' | jq .
```

### Listing child tenants

```bash
curl -s "http://localhost:7979/v1/admin/tenants?parent_tenant_id=acme-group" \
  -H "X-Admin-API-Key: $ADMIN_API_KEY" | jq .
```

### How hierarchical tenants work

Each child tenant is still a fully independent isolation boundary:

- Child tenants have their own budgets, API keys, and reservations
- A child tenant's API key cannot access the parent tenant's resources (and vice versa)
- Budget is not automatically shared or aggregated between parent and child

The `parent_tenant_id` relationship is useful for:

- **Consolidated billing:** Query all child tenants under a parent for billing reports
- **Administrative grouping:** List and manage related tenants together
- **Organizational modeling:** Reflect your real-world structure in the tenant hierarchy

## Tenant metadata

Each tenant supports a `metadata` field — a map of up to 32 key-value pairs for storing arbitrary information:

```bash
curl -s -X POST http://localhost:7979/v1/admin/tenants \
  -H "Content-Type: application/json" \
  -H "X-Admin-API-Key: $ADMIN_API_KEY" \
  -d '{
    "tenant_id": "acme-corp",
    "name": "Acme Corporation",
    "metadata": {
      "billing_id": "cust_12345",
      "plan": "enterprise",
      "region": "us-east-1",
      "owner_email": "admin@acme.com",
      "stripe_customer_id": "cus_abc123"
    }
  }' | jq .
```

Common metadata patterns:

| Key | Purpose |
|---|---|
| `billing_id` | Link to your billing system's customer ID |
| `plan` | Subscription tier (free, pro, enterprise) |
| `region` | Geographic region for data residency |
| `owner_email` | Primary contact for the tenant |
| `external_id` | ID from your own system for correlation |

::: info
Updating metadata replaces the entire metadata object. To add a new key while keeping existing ones, include all keys in the update.
:::

## End-to-end: onboarding a new tenant

Here is the complete sequence to go from zero to a working tenant with budget enforcement:

### Step 1: Create the tenant

```bash
curl -s -X POST http://localhost:7979/v1/admin/tenants \
  -H "Content-Type: application/json" \
  -H "X-Admin-API-Key: $ADMIN_API_KEY" \
  -d '{
    "tenant_id": "acme-corp",
    "name": "Acme Corporation",
    "metadata": {"plan": "pro"}
  }' | jq .
```

### Step 2: Create an API key for the tenant

```bash
API_KEY=$(curl -s -X POST http://localhost:7979/v1/admin/api-keys \
  -H "Content-Type: application/json" \
  -H "X-Admin-API-Key: $ADMIN_API_KEY" \
  -d '{
    "tenant_id": "acme-corp",
    "name": "production-key",
    "permissions": [
      "reservations:create",
      "reservations:commit",
      "reservations:release",
      "reservations:extend",
      "reservations:list",
      "balances:read",
      "budgets:read",
      "budgets:write"
    ]
  }' | jq -r '.key_secret')

echo "API Key: $API_KEY"
```

::: warning Explicit permissions replace the defaults
An explicit `permissions` array **replaces** the default set — it is not merged with it. A key created with only the six runtime permissions cannot call the budget endpoints in Step 3 (`POST /v1/admin/budgets` requires `budgets:write`). Either include `budgets:read`/`budgets:write` as shown, or omit `permissions` entirely to get the 10-permission default set, which includes them.
:::

Save this key — the full secret is only returned once. See [API Key Management](/how-to/api-key-management-in-cycles) for rotation and security practices.

### Step 3: Create a budget for the tenant

```bash
curl -s -X POST http://localhost:7979/v1/admin/budgets \
  -H "Content-Type: application/json" \
  -H "X-Cycles-API-Key: $API_KEY" \
  -d '{
    "scope": "tenant:acme-corp",
    "unit": "USD_MICROCENTS",
    "allocated": {"amount": 100000000, "unit": "USD_MICROCENTS"}
  }' | jq .
```

This creates a budget of $1.00 (100,000,000 microcents). See [Budget Allocation and Management](/how-to/budget-allocation-and-management-in-cycles) for funding patterns and hierarchical budgets.

### Step 4: Make the first reservation

```bash
RESERVATION_ID=$(curl -s -X POST http://localhost:7878/v1/reservations \
  -H "Content-Type: application/json" \
  -H "X-Cycles-API-Key: $API_KEY" \
  -d '{
    "idempotency_key": "onboard-test-001",
    "subject": {"tenant": "acme-corp"},
    "action": {"kind": "llm.completion", "name": "openai:gpt-4o"},
    "estimate": {"amount": 500000, "unit": "USD_MICROCENTS"},
    "ttl_ms": 30000
  }' | jq -r '.reservation_id')

echo "Reserved: $RESERVATION_ID"
```

If you see `"decision": "ALLOW"`, the tenant is fully operational.

### Step 5: Commit and verify

```bash
# Commit actual spend
curl -s -X POST "http://localhost:7878/v1/reservations/$RESERVATION_ID/commit" \
  -H "Content-Type: application/json" \
  -H "X-Cycles-API-Key: $API_KEY" \
  -d '{
    "idempotency_key": "onboard-commit-001",
    "actual": {"amount": 350000, "unit": "USD_MICROCENTS"}
  }' | jq .

# Check the balance
curl -s "http://localhost:7878/v1/balances?tenant=acme-corp" \
  -H "X-Cycles-API-Key: $API_KEY" | jq .
```

The tenant is now live with budget enforcement.

## Common use cases

### SaaS per-customer isolation

Each customer gets their own tenant with an independent budget:

```bash
# Customer onboarding script
for customer in "startup-co" "bigcorp-inc" "agency-xyz"; do
  curl -s -X POST http://localhost:7979/v1/admin/tenants \
    -H "Content-Type: application/json" \
    -H "X-Admin-API-Key: $ADMIN_API_KEY" \
    -d "{
      \"tenant_id\": \"$customer\",
      \"name\": \"$customer\"
    }"
done
```

This ensures one customer's runaway agent cannot consume another customer's budget. See [Multi-Tenant AI Cost Control](/blog/multi-tenant-ai-cost-control-per-tenant-budgets-quotas-isolation) for the full pattern.

### Internal department budgets

Use tenants to give each department its own spending boundary:

```bash
# Engineering gets a larger budget than marketing
# Create tenants under a parent
for dept in "eng" "marketing" "support"; do
  curl -s -X POST http://localhost:7979/v1/admin/tenants \
    -H "Content-Type: application/json" \
    -H "X-Admin-API-Key: $ADMIN_API_KEY" \
    -d "{
      \"tenant_id\": \"dept-$dept\",
      \"name\": \"Department: $dept\",
      \"parent_tenant_id\": \"company-hq\"
    }"
done
```

### Partner and reseller hierarchies

A reseller manages multiple end-customer tenants:

```bash
# Reseller as parent
curl -s -X POST http://localhost:7979/v1/admin/tenants \
  -H "Content-Type: application/json" \
  -H "X-Admin-API-Key: $ADMIN_API_KEY" \
  -d '{
    "tenant_id": "reseller-alpha",
    "name": "Alpha Partners",
    "metadata": {"type": "reseller", "commission_rate": "15"}
  }' | jq .

# End customers under the reseller
curl -s -X POST http://localhost:7979/v1/admin/tenants \
  -H "Content-Type: application/json" \
  -H "X-Admin-API-Key: $ADMIN_API_KEY" \
  -d '{
    "tenant_id": "alpha-customer-1",
    "name": "Customer One",
    "parent_tenant_id": "reseller-alpha"
  }' | jq .
```

### Environment separation

Use tenants to isolate production from staging and development:

```bash
for env in "acme-prod" "acme-staging" "acme-dev"; do
  curl -s -X POST http://localhost:7979/v1/admin/tenants \
    -H "Content-Type: application/json" \
    -H "X-Admin-API-Key: $ADMIN_API_KEY" \
    -d "{
      \"tenant_id\": \"$env\",
      \"name\": \"Acme ($env)\"
    }"
done
```

Give production a large budget and dev a small one. A bug in staging cannot drain the production budget.

## Best practices

### Naming conventions

Use stable, semantic tenant IDs that reflect your domain:

| Good | Avoid |
|---|---|
| `customer-acme` | `cust_12345` (opaque database ID) |
| `dept-engineering` | `eng` (too short, ambiguous) |
| `partner-alpha` | `PARTNER_ALPHA` (must be lowercase) |

Tenant IDs appear in scope paths (`tenant:customer-acme/workspace:prod`), audit logs, and API key bindings. Choose names that are readable and meaningful to your team.

### One tenant = one isolation boundary

Do not multiplex unrelated customers or teams into a single tenant. If two groups should not share budget, they need separate tenants. Use [hierarchical tenants](#hierarchical-tenants) to model organizational relationships rather than sharing a single tenant.

### Suspend before you close

Use `SUSPENDED` for temporary blocks — payment failures, security investigations, plan changes. A suspended tenant can be reactivated at any time.

Use `CLOSED` only for permanent decommission. It is irreversible. If there is any chance you will need the tenant again, use `SUSPENDED`.

### Use metadata consistently

Pick a standard set of metadata keys and use them across all tenants. This makes it easy to query and correlate tenant data with external systems:

```json
{
  "billing_id": "cust_12345",
  "plan": "enterprise",
  "region": "us-east-1",
  "owner_email": "admin@acme.com"
}
```

### Set overage policy at the tenant level

The `default_commit_overage_policy` establishes a baseline for all scopes under the tenant. The default is `ALLOW_IF_AVAILABLE`, which caps charges to available budget and never creates debt. Switch to `REJECT` for hard stops, or `ALLOW_WITH_OVERDRAFT` when exact accounting with debt is needed.

Override the policy per-budget-ledger or per-reservation for specific scopes that need different behavior.

### Create API keys per environment

Issue separate API keys for production, staging, and development — even within the same tenant. This makes it easy to revoke one environment's access without affecting others. See [API Key Management](/how-to/api-key-management-in-cycles) for rotation practices.

### Automate tenant onboarding

The create tenant → create API key → create budget sequence should be scripted, not manual. This ensures consistency, reduces errors, and makes it easy to onboard new customers at scale.

```bash
# Example: onboard a new customer
TENANT_ID="customer-${CUSTOMER_SLUG}"
curl -s -X POST http://localhost:7979/v1/admin/tenants \
  -H "Content-Type: application/json" \
  -H "X-Admin-API-Key: $ADMIN_API_KEY" \
  -d "{\"tenant_id\": \"$TENANT_ID\", \"name\": \"$CUSTOMER_NAME\"}"

API_KEY=$(curl -s -X POST http://localhost:7979/v1/admin/api-keys \
  -H "Content-Type: application/json" \
  -H "X-Admin-API-Key: $ADMIN_API_KEY" \
  -d "{\"tenant_id\": \"$TENANT_ID\", \"name\": \"prod-key\", \"permissions\": [\"reservations:create\",\"reservations:commit\",\"reservations:release\",\"balances:read\",\"budgets:read\",\"budgets:write\"]}" \
  | jq -r '.key_secret')

# budgets:read/budgets:write are required for the budget call below —
# an explicit permissions array REPLACES the defaults, it is not merged.
# Alternatively, omit "permissions" to get the default set (which includes them).

curl -s -X POST http://localhost:7979/v1/admin/budgets \
  -H "Content-Type: application/json" \
  -H "X-Cycles-API-Key: $API_KEY" \
  -d "{\"scope\": \"tenant:$TENANT_ID\", \"unit\": \"USD_MICROCENTS\", \"allocated\": {\"amount\": $BUDGET_AMOUNT, \"unit\": \"USD_MICROCENTS\"}}"
```

## Troubleshooting

### TENANT_NOT_FOUND

The tenant does not exist. Create it first with `POST /v1/admin/tenants`.

This also occurs when creating an API key for a non-existent tenant — the tenant must exist before you can issue keys for it.

### TENANT_SUSPENDED

The tenant's status is `SUSPENDED`. New reservations are blocked.

To resume operations, reactivate the tenant:

```bash
curl -s -X PATCH http://localhost:7979/v1/admin/tenants/acme-corp \
  -H "Content-Type: application/json" \
  -H "X-Admin-API-Key: $ADMIN_API_KEY" \
  -d '{"status": "ACTIVE"}' | jq .
```

### TENANT_CLOSED

The tenant has been permanently closed. This cannot be reversed. If you need a new tenant, create one with a different `tenant_id`.

### 403 FORBIDDEN (tenant mismatch)

The `subject.tenant` in your request does not match the effective tenant derived from the API key.

Check:
1. The `X-Cycles-API-Key` header is for the correct tenant
2. The `subject.tenant` field matches the API key's tenant
3. Use the `X-Cycles-Tenant` response header (if present) to see which tenant the server resolved

See [Authentication, Tenancy, and API Keys](/protocol/authentication-tenancy-and-api-keys-in-cycles) for the full authentication model.

### 409 CONFLICT on tenant creation

You tried to create a tenant with a `tenant_id` that already exists but with a different `name`. Either:
- Use the existing tenant as-is
- Choose a different `tenant_id`

### Common mistakes

**Creating budgets before tenants.** The tenant must exist before you can create API keys or budgets for it. Follow the onboarding sequence: tenant → API key → budget.

**Using the wrong auth header.** Tenant management uses `X-Admin-API-Key` (system admin). Budget and reservation operations use `X-Cycles-API-Key` (tenant-scoped). See the [Architecture Overview](/quickstart/architecture-overview-how-cycles-fits-together) for which header to use where.

**Closing tenants prematurely.** Use `SUSPENDED` for temporary blocks. Only use `CLOSED` when the tenant is being permanently decommissioned.

## Next steps

- [Tenants, Scopes, and Budgets](/how-to/understanding-tenants-scopes-and-budgets-in-cycles) — how tenants, scopes, and budgets work together
- [API Key Management](/how-to/api-key-management-in-cycles) — create and rotate API keys for your tenants
- [Budget Allocation and Management](/how-to/budget-allocation-and-management-in-cycles) — set up budgets at tenant and sub-scopes
- [Tenant, Workflow, and Run Budgets](/how-to/how-to-model-tenant-workflow-and-run-budgets-in-cycles) — design multi-level budget policies
- [Authentication, Tenancy, and API Keys](/protocol/authentication-tenancy-and-api-keys-in-cycles) — how tenant isolation is enforced at the protocol level
- [Scope Derivation](/protocol/how-scope-derivation-works-in-cycles) — how tenant scopes fit into the budget hierarchy
- [Deploy the Full Stack](/quickstart/deploying-the-full-cycles-stack) — set up the Cycles infrastructure from scratch

## Related concepts

- [Tenant lifecycle cascade semantics](/blog/tenant-lifecycle-cascade-semantics-at-scale)
- [Audit trail as a runtime-authority byproduct](/blog/runtime-authority-byproducts-audit-trail-and-attribution-by-default)
- [Agent delegation chains and authority attenuation](/blog/agent-delegation-chains-authority-attenuation-not-trust-propagation)
