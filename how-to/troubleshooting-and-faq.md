---
title: "Troubleshooting and FAQ"
description: "Solutions to common Cycles issues including budget exceeded errors, reservation failures, connectivity problems, and configuration mistakes."
---

# Troubleshooting and FAQ

Common issues when integrating and operating Cycles, with solutions.

## Reservation and budget issues

### NOT_FOUND on first reservation

**Symptom:** The very first reservation attempt returns `404 NOT_FOUND` with a response message like `"Budget not found for provided scope: tenant:acme-corp"`.

**Cause:** No budget ledger exists for any derived scope in any unit. Creating a tenant does not automatically create a budget. The server checks all scope levels (tenant, workspace, app, etc.) and skips those without a budget — but at least one must exist.

The runtime plane uses a single `NOT_FOUND` wire code for all resource-not-found conditions (missing reservation, missing budget). The `message` field distinguishes them: `"Reservation not found: ..."` vs. `"Budget not found for provided scope: ..."`.

This is distinct from `400 UNIT_MISMATCH` — if a budget exists at the scope but in a different unit (e.g., you requested USD_MICROCENTS but only TOKENS is funded), you get `UNIT_MISMATCH` instead, with `details.expected_units` listing the units that are funded.

On `POST /v1/decide` and `POST /v1/reservations` with `dry_run=true`, the same "no budget" condition doesn't surface as a 404. Those endpoints return `200 OK` with `decision: DENY` and `reason_code: "BUDGET_NOT_FOUND"` in the response body — so a preflight check can distinguish "no budget" from "insufficient budget" without catching an exception.

**Fix:** Create a budget via the admin API:

```bash
curl -s -X POST http://localhost:7979/v1/admin/budgets \
  -H "Content-Type: application/json" \
  -H "X-Cycles-API-Key: $CYCLES_API_KEY" \
  -d '{
    "scope": "tenant:acme-corp",
    "unit": "USD_MICROCENTS",
    "allocated": { "amount": 100000000, "unit": "USD_MICROCENTS" }
  }' | jq .
```

Remember: a reservation is checked against every derived scope that has a budget defined. Scopes without budgets are skipped, but at least one derived scope must have a budget. If you have budgets at multiple levels, each one must have sufficient funds.

### BUDGET_EXCEEDED but I just funded the budget

**Symptom:** You funded a budget, but reservations are still denied.

**Possible causes:**

1. **Scope mismatch.** The funded scope does not match the reservation scope. Check that the scope path is exactly right — `tenant:acme-corp` is different from `tenant:acme-corp/workspace:prod`.

2. **Unit mismatch.** You funded in `TOKENS` but the reservation uses `USD_MICROCENTS`. Each unit has its own separate ledger.

3. **Reserved budget.** Other active reservations may be holding budget. Check balances to see the `reserved` field:

```bash
curl -s "http://localhost:7878/v1/balances?tenant=acme-corp" \
  -H "X-Cycles-API-Key: $API_KEY" | jq .
```

The `remaining` field shows available budget after accounting for active reservations.

4. **Hierarchical exhaustion.** A parent scope may be exhausted even if the child scope has budget. Check balances at all levels.

### RESERVATION_EXPIRED — TTL too short

**Symptom:** Commit fails with `410 RESERVATION_EXPIRED` because the LLM call took longer than expected.

**Fixes:**

- **Increase TTL** when creating reservations. The default is 60 seconds (`ttl_ms: 60000`). For long-running operations, use 120 seconds or more.
- **Use automatic heartbeat.** The SDK clients (Python `@cycles`, TypeScript `withCycles`, Java `@Cycles`) automatically extend the reservation TTL while the operation is running. Ensure you're using the decorator/HOF pattern rather than raw HTTP.
- **For raw HTTP users:** call `POST /v1/reservations/{id}/extend` periodically before the TTL expires.

### DEBT_OUTSTANDING blocking new reservations

**Symptom:** New reservations fail with `409 DEBT_OUTSTANDING` even though the budget was recently funded.

**Cause:** A previous commit with `ALLOW_WITH_OVERDRAFT` created debt. When no `overdraft_limit` is configured (or it is 0), any outstanding debt blocks new reservations until repaid. If an `overdraft_limit > 0` is configured, debt within the limit does not block reservations.

**Fix:** Repay the debt:

```bash
curl -s -X POST "http://localhost:7979/v1/admin/budgets/fund?scope=tenant:acme-corp&unit=USD_MICROCENTS" \
  -H "Content-Type: application/json" \
  -H "X-Cycles-API-Key: $CYCLES_API_KEY" \
  -d '{
    "operation": "REPAY_DEBT",
    "amount": { "amount": 500000, "unit": "USD_MICROCENTS" },
    "idempotency_key": "repay-001"
  }' | jq .
```

### IDEMPOTENCY_MISMATCH on retry

**Symptom:** Retrying a failed request returns `409 IDEMPOTENCY_MISMATCH`.

**Cause:** You're reusing the same idempotency key with a different payload. Idempotency keys must be unique per distinct operation. If the original request *succeeded*, retrying with the same key and same payload returns the original response (safe replay). But if the payload changed, you get a mismatch.

**Fix:** Use a new idempotency key for each distinct operation. Use UUIDs or request-scoped identifiers.

## Authentication and authorization

### UNAUTHORIZED (401)

**Symptom:** All requests fail with `401`.

**Checklist:**

1. Is the `X-Cycles-API-Key` header present in the request?
2. Is the key value correct? (Keys start with `cyc_live_` or `cyc_test_`)
3. Has the key been revoked? Validate it:

```bash
curl -s -X POST http://localhost:7979/v1/auth/validate \
  -H "Content-Type: application/json" \
  -H "X-Admin-API-Key: admin-bootstrap-key" \
  -d '{"key_secret": "cyc_live_..."}' | jq .
```

### FORBIDDEN (403) — tenant mismatch

**Symptom:** Requests return `403 FORBIDDEN`.

**Cause:** The `tenant` field in the reservation subject does not match the tenant associated with the API key.

**Fix:** Ensure the `subject.tenant` matches the API key's tenant. Each API key is scoped to exactly one tenant.

### Missing permissions

**Symptom:** Specific operations fail with `403` even though the API key is valid.

**Cause:** The API key does not have the required permission. Permissions are:

| Operation | Required permission |
|---|---|
| Reserve | `reservations:create` |
| Commit | `reservations:commit` |
| Release | `reservations:release` |
| Extend | `reservations:extend` |
| List reservations | `reservations:list` |
| Balances | `balances:read` |

**Fix:** Create a new API key with the required permissions, or update the existing key's permissions.

## Connection and infrastructure

### Connection refused on port 7878 or 7979

**Symptom:** `ECONNREFUSED` or `Connection refused`.

**Checklist:**

1. Is Docker running? (`docker compose ps`)
2. Are the containers healthy? (`docker compose logs cycles-server`)
3. Is Redis accessible? (`redis-cli -h localhost -p 6379 ping`)
4. Are ports conflicting? Check with `lsof -i :7878` or `netstat -tlnp | grep 7878`.

### Timeout errors

**Symptom:** Requests to Cycles server time out.

**Possible causes:**

1. **Redis is slow or unreachable.** Check Redis connectivity and latency.
2. **Server overloaded.** The reservation Lua scripts are atomic but can queue under very high concurrency.
3. **Network issues.** Ensure the client can reach the server (firewall, DNS, proxy).

**Fix for SDK clients:** Increase the client timeout:

::: code-group
```python [Python]
config = CyclesConfig(
    base_url="http://localhost:7878",
    api_key="cyc_live_...",
    connect_timeout=5.0,  # seconds (default 2.0)
    read_timeout=10.0,    # seconds (default 5.0)
)
```
```typescript [TypeScript]
const config = new CyclesConfig({
  baseUrl: "http://localhost:7878",
  apiKey: "cyc_live_...",
  connectTimeout: 5_000, // ms (default 2000)
  readTimeout: 10_000,   // ms (default 5000)
});
```
:::

## SDK-specific issues

### Python: decorator not working with async functions

**Symptom:** The `@cycles` decorator doesn't seem to work with `async def` functions.

**Fix:** The `@cycles` decorator automatically detects sync vs async functions — no separate decorator is needed. Just use `@cycles` on both:

```python
from runcycles import cycles

# Works with sync functions
@cycles(estimate=5000, action_kind="llm.completion", action_name="gpt-4o")
def ask_sync(prompt: str) -> str:
    ...

# Also works with async functions — auto-detected
@cycles(estimate=5000, action_kind="llm.completion", action_name="gpt-4o")
async def ask_async(prompt: str) -> str:
    ...
```

If you need a fully async programmatic client (not the decorator), use `AsyncCyclesClient`:

```python
from runcycles import AsyncCyclesClient, CyclesConfig

client = AsyncCyclesClient(CyclesConfig.from_env())
```

### TypeScript: streaming response not committing

**Symptom:** Budget is reserved but never committed for streaming calls.

**Cause:** Using `withCycles` for streaming calls. The `withCycles` HOF commits when the wrapped function returns, but streaming functions return before the stream finishes.

**Fix:** Use `reserveForStream` for streaming operations:

```typescript
const handle = await reserveForStream({
  client: cyclesClient,
  estimate: 5000,
  actionKind: "llm.completion",
  actionName: "gpt-4o",
});

try {
  const stream = await openai.chat.completions.create({ stream: true, ... });
  // ... consume stream ...
  await handle.commit(actualCost, { tokensInput, tokensOutput });
} catch (err) {
  await handle.release("stream_error");
  throw err;
}
```

### Spring Boot: @Cycles annotation not intercepting

**Symptom:** Methods annotated with `@Cycles` run without budget enforcement.

**Checklist:**

1. Is `cycles-client-java-spring` on the classpath?
2. Is the `cycles.base-url` property set in `application.yml`?
3. Is the method being called through the Spring proxy? (Direct `this.method()` calls bypass AOP — see below.)
4. Is the class a Spring-managed bean (`@Service`, `@Component`, etc.)?

The most common cause is **self-invocation**: calling a `@Cycles` method from another method in the same class using `this.method()`. Spring's proxy-based AOP cannot intercept these internal calls. The starter logs a `WARN` at startup when it detects beans susceptible to this pattern.

**Fix:** Extract the `@Cycles` method into a separate `@Service`, or self-inject the proxy with `@Lazy @Autowired`. See [Self-Invocation](/quickstart/getting-started-with-the-cycles-spring-boot-starter#self-invocation-internal-method-calls) for full workarounds.

<a id="spring-boot-illegalstateexception-nested-cycles"></a>
### Spring Boot: IllegalStateException — nested @Cycles

**Symptom:** `IllegalStateException("Nested @Cycles not supported")` thrown at runtime.

**Cause:** A `@Cycles`-annotated method called another `@Cycles`-annotated method (even across different beans). The starter prevents this because each reservation is independent — nesting would double-count budget.

**Fix:** Place `@Cycles` at the outermost entry point only. Remove `@Cycles` from inner methods that are called within an already-guarded operation. See [Nesting Prevention](/quickstart/getting-started-with-the-cycles-spring-boot-starter#nesting-prevention) for details.

### TypeScript / Python: nested budget guards double-counting

**Symptom:** Budget is consumed faster than expected when using nested `withCycles` (TypeScript) or `@cycles` (Python) calls.

**Cause:** Unlike Spring, the TypeScript and Python clients do not block nested calls — each guard silently creates an independent reservation. If an outer guard reserves 500 and an inner guard reserves 100, **600 total** is deducted from the budget, not 500.

**Fix:** Place the budget guard at the outermost entry point only. Inner functions should be plain functions without their own guard. See the nesting sections in the [TypeScript](/quickstart/getting-started-with-the-typescript-client#nested-withcycles-calls) and [Python](/quickstart/getting-started-with-the-python-client#nested-cycles-calls) quickstart guides.

## FAQ

### Why can't I delete tenants or budgets?

By design. Cycles uses **status-based lifecycle management** instead of hard deletion for most objects. Tenants, budgets, and reservations are referenced across the system (audit logs, API keys, committed transactions). Deleting them would orphan those records and break audit trails.

Instead, use the cleanup mechanism for each object type:

- **Tenants:** `PATCH status → CLOSED` — blocks all operations, retains data. See [Tenant Lifecycle](/how-to/tenant-creation-and-management-in-cycles#tenant-status-lifecycle).
- **Budgets:** `POST fund` with `RESET` to zero — sets allocated to 0 to block new reservations; retains ledger history. See [Resizing a budget](/how-to/budget-allocation-and-management-in-cycles#resizing-a-budget-reset). (For clearing spent at billing-period boundaries, use `RESET_SPENT` — [Starting a new billing period](/how-to/budget-allocation-and-management-in-cycles#starting-a-new-billing-period-reset-spent).)
- **API Keys:** `DELETE` revokes the key (ACTIVE → REVOKED) but retains the record. See [Revoking API Keys](/how-to/api-key-management-in-cycles#revoking-api-keys).

### Can I use Cycles without Docker?

Yes. Run Redis 7+ natively, build the server JARs with Maven, and start them with `java -jar`. See [Deploy the Full Stack](/quickstart/deploying-the-full-cycles-stack) Option C.

### What happens if the Cycles server goes down?

Your application's behavior depends on your error handling. The SDK clients throw exceptions when the server is unreachable. You should implement a fallback strategy — see [Degradation Paths](/how-to/how-to-think-about-degradation-paths-in-cycles-deny-downgrade-disable-or-defer).

### Can multiple applications share the same Cycles server?

Yes. Each application uses its own tenant (or its own workspace within a tenant). The Cycles server is stateless — all state lives in Redis.

### How do I prove what Cycles decided, after the fact?

Enable **CyclesEvidence**. When the signing identity is configured, decide / reserve / commit / release responses — and budget/lifecycle denials like a `409 BUDGET_EXCEEDED` — carry an optional `cycles_evidence` reference (`evidence_id` + `cycles_evidence_url`). The `evidence_id` is a SHA-256 content address computed synchronously and returned in-band; the `cycles-server-events` tier asynchronously Ed25519-signs the envelope, which you fetch and verify at `GET /v1/evidence/{id}` — offline, without trusting or reaching the live ledger. It's the receipt, not the gate: it doesn't change enforcement, it makes decisions auditable and bindable by other systems. See [CyclesEvidence: Verifiable Audit](/concepts/cycles-evidence-verifiable-audit-for-agent-decisions), the [envelope reference](/protocol/cycles-evidence-envelopes-in-cycles), and the operator [enablement runbook](https://github.com/runcycles/cycles-server-events/blob/main/docs/evidence-identity-enablement.md).

### What happens to evidence if I don't configure the signing identity?

Nothing breaks in the budget-enforcement path — Cycles continues to decide, reserve, commit, and release exactly as before — but verifiable evidence is not available until the shared identity is configured consistently. In fully unconfigured/dev setups, responses omit `cycles_evidence`; if `EVIDENCE_SERVER_ID` is blank on `cycles-server-events`, the evidence signer is disabled and pending source records are left untouched, not dead-lettered. If `EVIDENCE_SERVER_ID` is present but the producer/worker public identity differs, the worker dead-letters on the `evidence_id` cross-check. The events worker's ephemeral-key mode is development-only and only covers the case where `EVIDENCE_SERVER_ID` is present but the signing pair is absent; it is not a production evidence identity and will not match a runtime server publishing a different public signer. Set `EVIDENCE_SERVER_ID` + `EVIDENCE_SIGNING_SIGNER_DID` (public, on both services) and `EVIDENCE_SIGNING_PRIVATE_KEY_HEX` (secret, on `cycles-server-events` only), then watch `evidence:failed` during rollout.

### How do I reset a budget to zero?

Two different "reset to zero" intents — use the right operation for the one you mean.

**To block new reservations** (allocated → 0, decommission a scope):

```bash
# RESET with amount=0 — sets allocated to 0. Spent is preserved in the ledger
# for historical accounting; remaining goes negative if spent > 0.
curl -s -X POST "http://localhost:7979/v1/admin/budgets/fund?scope=tenant:acme-corp&unit=USD_MICROCENTS" \
  -H "Content-Type: application/json" \
  -H "X-Cycles-API-Key: $CYCLES_API_KEY" \
  -d '{"operation": "RESET", "amount": {"amount": 0, "unit": "USD_MICROCENTS"}, "idempotency_key": "decommission-001"}' | jq .
```

**To start a new billing period** (spent → 0, keep allocated at the new period's ceiling):

```bash
# RESET_SPENT with the new period's allocation — sets allocated AND clears spent.
curl -s -X POST "http://localhost:7979/v1/admin/budgets/fund?scope=tenant:acme-corp&unit=USD_MICROCENTS" \
  -H "Content-Type: application/json" \
  -H "X-Cycles-API-Key: $CYCLES_API_KEY" \
  -d '{"operation": "RESET_SPENT", "amount": {"amount": 1000000000, "unit": "USD_MICROCENTS"}, "idempotency_key": "reset-001", "reason": "Monthly billing period reset"}' | jq .
```

See [Starting a new billing period](/how-to/budget-allocation-and-management-in-cycles#starting-a-new-billing-period-reset-spent) for more detail including the optional `spent` override for migrations, prorated signups, and corrections.

### How do I see what's using my budget?

Check active reservations and balances:

```bash
# Active reservations
curl -s "http://localhost:7878/v1/reservations?tenant=acme-corp&status=ACTIVE" \
  -H "X-Cycles-API-Key: $API_KEY" | jq .

# Balance breakdown
curl -s "http://localhost:7878/v1/balances?tenant=acme-corp" \
  -H "X-Cycles-API-Key: $API_KEY" | jq .
```

### Is there a way to test without a running server?

Use [shadow mode / dry-run](/how-to/shadow-mode-in-cycles-how-to-roll-out-budget-enforcement-without-breaking-production) to evaluate budget policies without enforcing them. For unit tests, mock the `CyclesClient` — see [Testing with Cycles](/how-to/testing-with-cycles).

## MCP server issues

### MCP tool calls not enforcing budget

**Symptom:** The MCP tools respond but reservations are not actually created on your Cycles server.

**Checklist:**

1. Is `CYCLES_API_KEY` set in the MCP server environment? Without it, the server cannot authenticate.
2. Is `CYCLES_BASE_URL` set? **There is no default** — this variable is required. Set it to your Cycles server URL (e.g., `http://localhost:7878` for local development).
3. Is `CYCLES_MOCK` set to `"true"`? Mock mode returns synthetic responses without contacting a real server and performs no live enforcement. Remove it for production use. The MCP server refuses mock mode when `NODE_ENV=production` unless `CYCLES_ALLOW_MOCK_IN_PRODUCTION=true` is also set.
4. Does the API key have the permission for the requested tool? The MCP tool set uses the valid runtime permissions `reservations:create`, `reservations:commit`, `reservations:release`, `reservations:extend`, `reservations:list`, and `balances:read`. There are no separate `decide` or `events:create` permission values.

### MCP server not appearing in Claude Desktop or Cursor

**Symptom:** The agent does not see Cycles tools.

**Checklist:**

1. Is the config file in the right location?
   - Claude Desktop macOS: `~/Library/Application Support/Claude/claude_desktop_config.json`
   - Claude Desktop Windows: `%APPDATA%\Claude\claude_desktop_config.json`
2. Is the JSON valid? A trailing comma or missing brace will silently break the config. Validate with `cat claude_desktop_config.json | jq .`
3. Did you restart the application after editing the config? MCP server configs are read at startup.
4. For Claude Code: did you run `claude mcp add cycles -- npx -y @runcycles/mcp-server`? Check with `claude mcp list`.

### MCP decisions always return ALLOW

**Symptom:** Every reservation or decide call returns `ALLOW` regardless of budget state.

**Cause:** The server is running in mock mode (`CYCLES_MOCK=true`), which returns synthetic `ALLOW` responses. Generated IDs and timestamps are not deterministic.

**Fix:** Remove the `CYCLES_MOCK` environment variable and ensure `CYCLES_BASE_URL` and `CYCLES_API_KEY` are set correctly.

## Admin API issues

### Cannot create budget — 401 on admin API

**Symptom:** `POST /v1/admin/budgets` returns `401 UNAUTHORIZED`.

**Common causes:**

1. **Wrong port.** The admin API runs on port **7979**, not 7878. The protocol API (reservations, commits) runs on 7878.
2. **Wrong header.** Tenant-scoped budget and policy endpoints use `X-Cycles-API-Key` with the required permissions. Admin-only operations such as tenant/key management, audit logs, budget PATCH/freeze/unfreeze, and runtime reservation force-release use `X-Admin-API-Key`. Budget list and fund are dual-auth; admin-key calls must include `tenant_id`.
3. **Missing admin permissions.** Default API keys lack `admin:write`. Create a key with `"permissions": ["admin:read", "admin:write"]` — see [API Key Management](/how-to/api-key-management-in-cycles#available-permissions).

### Budget fund operation has no effect

**Symptom:** You called the fund endpoint but the balance did not change.

**Checklist:**

1. **Scope path mismatch.** The scope in the fund request must exactly match the budget scope. `tenant:acme-corp` is not the same as `tenant:acme-corp/workspace:prod`.
2. **Wrong operation.** The `operation` field must be one of `CREDIT`, `DEBIT`, `RESET`, `RESET_SPENT`, or `REPAY_DEBT`. Common confusion: `RESET` with the same amount as the current allocation is a **no-op by design** — it resizes the allocated ceiling but preserves spent, so `remaining` stays at its current value. If you wanted to clear spent for a new billing period, use `RESET_SPENT`. See [Starting a new billing period](/how-to/budget-allocation-and-management-in-cycles#starting-a-new-billing-period-reset-spent).
3. **Check the response.** The fund endpoint returns the updated balance. Verify the response body confirms the change.

### Fund endpoint returns 404 for workspace budget

**Symptom:** Funding a workspace budget returns `404 NOT_FOUND`.

**Cause:** You may be using the old path-based endpoint format. The fund and patch endpoints accept `scope` and `unit` as **query parameters**, not path variables.

**Fix:** Use query parameters:

```bash
curl -X POST "http://localhost:7979/v1/admin/budgets/fund?scope=tenant:acme/workspace:prod&unit=USD_MICROCENTS" \
  -H "Content-Type: application/json" \
  -H "X-Cycles-API-Key: $CYCLES_API_KEY" \
  -d '{
    "operation": "CREDIT",
    "amount": { "amount": 500000, "unit": "USD_MICROCENTS" }
  }'
```

The same pattern applies to the patch endpoint: `PATCH /v1/admin/budgets?scope=...&unit=...`.

### Tenant creation returns 409

**Symptom:** `POST /v1/admin/tenants` returns `409`.

**Cause:** A tenant with that ID already exists. Tenant IDs are unique. If you are rerunning a setup script, this is expected and safe to ignore.

## Common first-integration mistakes

### Commit fails with 410 RESERVATION_EXPIRED

**Symptom:** Reserve succeeds, but commit returns `410 RESERVATION_EXPIRED`.

**Cause:** The reservation expired before the commit arrived. The default TTL (60000 ms) may be too short for long-running LLM calls. (A `404 NOT_FOUND` on commit is a different problem: the reservation never existed — check the `reservation_id` you are passing.)

**Fix:**

- Increase the `ttl_ms` when creating reservations. For LLM calls, 120000 ms or more is typical.
- Use the SDK decorators (`@cycles` in Python, `withCycles` in TypeScript, `@Cycles` in Spring) which automatically extend TTL via heartbeat.
- For raw HTTP: call `POST /v1/reservations/{id}/extend` periodically before the TTL expires.

### Budget math does not add up

**Symptom:** You funded a budget with `100000000` expecting $100, but it shows as $1.

**Cause:** Cycles uses `USD_MICROCENTS` where **1 dollar = 100,000,000 microcents** (1 microcent = 10⁻⁸ dollars).

Quick reference:

| Amount | USD_MICROCENTS |
|---|---|
| $0.01 (1 cent) | 1,000,000 |
| $1.00 | 100,000,000 |
| $10.00 | 1,000,000,000 |
| $100.00 | 10,000,000,000 |

See [Understanding Units](/protocol/understanding-units-in-cycles-usd-microcents-tokens-credits-and-risk-points) for the full unit reference.

### Scopes not matching — reservation denied despite budget existing

**Symptom:** A budget exists but reservations are still denied with `BUDGET_EXCEEDED`.

**Cause:** The budget scope path does not match any of the reservation's derived scopes. Enforcement checks every derived scope that has a budget defined — scopes without budgets are skipped, but at least one derived scope must have a budget. Common mismatches:

- Budget at `tenant:acme-corp/workspace:prod` but subject uses `workspace=staging`
- Budget at `tenant:acme-corp/workspace:prod` but subject omits `workspace` entirely (the derived scopes are just `tenant:acme-corp`, which has no budget)
- Budget uses a different tenant ID than the one in the subject

**Fix:** Check that the scope path on the budget matches the scopes derived from the reservation subject. Use the [Scope Derivation](/protocol/how-scope-derivation-works-in-cycles) reference to understand which scopes are derived. See also [Tenants, Scopes, and Budgets](/how-to/understanding-tenants-scopes-and-budgets-in-cycles).

## Webhook and event delivery issues

### Webhook endpoint not receiving events

**Symptom:** You created a webhook subscription and events are occurring (e.g., reservations being denied), but your endpoint isn't receiving HTTP requests.

**Checklist:**

1. **Is the events service running?** Webhook delivery requires the events service (`cycles-server-events`) to be deployed and connected to the same Redis instance. Check the management port with `curl http://localhost:9980/actuator/health`.
2. **Is the subscription active?** Subscriptions are auto-disabled after 10 consecutive delivery failures. Check status: `GET /v1/admin/webhooks/{id}` — look for `"status": "DISABLED"`.
3. **Does the subscription match the event type?** Check the `event_types` array in your subscription. If it's empty, the subscription receives all event types. If it lists specific types, the event must match.
4. **Does the scope filter match?** If you set a `scope_filter`, only events whose scope matches the filter will be delivered. See [Scope Filter Syntax](/protocol/webhook-scope-filter-syntax) for matching rules.
5. **Is the endpoint reachable from the events service?** The events service makes outbound HTTP POST requests. Verify network connectivity, DNS resolution, and firewall rules.
6. **Is the endpoint returning 2xx?** Non-2xx responses trigger retries. After 5 retries (exponential backoff: 1s, 2s, 4s, 8s, 16s), the delivery is marked FAILED. After 10 consecutive failures, the subscription is disabled.

**Diagnostic:** Test the subscription manually:
```bash
curl -X POST http://localhost:7979/v1/admin/webhooks/{id}/test \
  -H "X-Admin-API-Key: $ADMIN_KEY"
```
This sends a `system.webhook_test` event to your endpoint. If it arrives, the delivery pipeline works and the issue is in event matching (types or scope filter).

### Events received but signature verification fails

**Symptom:** Your endpoint receives events but HMAC signature verification fails.

**Common causes:**

1. **Wrong signing secret.** The secret must match the one returned when you created the subscription. It cannot be retrieved again — only rotated.
2. **Reading parsed body instead of raw bytes.** Signature is computed over the **raw request body bytes**, not a re-serialized JSON object. Middleware that parses JSON before your verification code runs will produce different bytes.
3. **Encoding mismatch.** The signature is a hex-encoded HMAC-SHA256 digest. Verify you're comparing hex strings, not raw bytes.

**Fix for common frameworks:**
- **Express:** Use `express.raw({ type: 'application/json' })` on the webhook route, not `express.json()`
- **Flask:** Use `request.get_data()`, not `request.json`
- **Spring Boot:** Inject `HttpServletRequest` and read `getInputStream()` before any `@RequestBody` binding

### Subscription auto-disabled

**Symptom:** Events stop arriving. The subscription status is `DISABLED`.

**Cause:** 10 consecutive delivery attempts failed (non-2xx response, timeout, or DNS error). This is a safety mechanism to prevent hammering a broken endpoint.

**Fix:**
1. Fix the underlying endpoint issue (check logs for the failure reason)
2. Re-enable the subscription: `PATCH /v1/admin/webhooks/{id}` with `{"status": "ACTIVE"}`
3. Optionally replay missed events: `POST /v1/admin/webhooks/{id}/replay` with a time range

### Duplicate events received

**Symptom:** Your endpoint processes the same event twice.

**Cause:** Cycles delivers events **at-least-once**. Network timeouts or slow responses can cause the events service to retry a delivery that your endpoint actually processed.

**Fix:** Deduplicate by `event_id`. Track processed event IDs (e.g., in a Redis SET with 24-hour TTL) and skip duplicates:

```python
def handle_webhook(event):
    event_id = event["event_id"]
    if redis.sismember("processed_events", event_id):
        return  # Already processed
    redis.sadd("processed_events", event_id)
    redis.expire("processed_events", 86400)  # 24h TTL
    # Process event...
```

### Events delayed or arriving out of order

**Symptom:** Events arrive minutes after the triggering action, or events from different actions arrive in unexpected order.

**Causes:**

1. **Normal delivery latency.** Events are dispatched asynchronously. Under normal load, latency is sub-second. Under high load or after retries, latency can increase.
2. **Retry backoff.** If your endpoint returned a non-2xx response, the next retry is delayed by exponential backoff (1s → 2s → 4s → 8s → 16s).
3. **Stale delivery protection.** Deliveries older than 24 hours are auto-failed on pickup. If the events service was down for 24+ hours, events from that period are not delivered — use the replay API to recover them.

**Ordering guarantee:** Delivery order is not guaranteed — dispatch uses a shared queue with concurrent consumers, and retried deliveries re-enter out of order. Only the stored event log is ordered; consumers should dedupe and sequence on `event_id` and the envelope `timestamp`.

### Expected event type not firing

**Symptom:** You expect a `budget.threshold_crossed` or `tenant.suspended` event but it never arrives.

**Cause:** Some event types are registered in the protocol before every service emits them. See the [Event Payloads Reference](/protocol/event-payloads-reference) for the current emitted/planned status by category.

**Currently emitted:**
- `reservation.denied`, `reservation.commit_overage`, `reservation.expired`
- `budget.exhausted`, `budget.over_limit_entered`, `budget.debt_incurred`

If you're subscribed to an event type marked as planned, no events will arrive until the emitting service version supports it.

## Debugging production incidents

For deeper incident analysis, the Incident Patterns section documents common production failures with root cause analysis and prevention strategies:

- **[Runaway Agents and Tool Loops](/incidents/runaway-agents-tool-loops-and-budget-overruns-the-incidents-cycles-is-designed-to-prevent)** — agents that loop indefinitely, burning budget on repeated tool calls
- **[Retry Storms](/incidents/retry-storms-and-idempotency-failures)** — retries that double-charge or bypass budget checks
- **[Concurrent Agent Overspend](/incidents/concurrent-agent-overspend)** — race conditions where multiple agents collectively exceed a shared budget
- **[Scope Misconfiguration](/incidents/scope-misconfiguration-and-budget-leaks)** — budget leaks caused by incorrect scope hierarchies

## Next steps

- [Error Codes and Error Handling](/protocol/error-codes-and-error-handling-in-cycles) — complete error code reference
- [Testing with Cycles](/how-to/testing-with-cycles) — testing strategies and fixtures
- [Degradation Paths](/how-to/how-to-think-about-degradation-paths-in-cycles-deny-downgrade-disable-or-defer) — handling budget denial gracefully

## Related concepts

- [Retry storms and idempotency in agent budgets](/blog/retry-storms-and-idempotency-in-agent-budget-systems)
- [Tracking tokens in a streaming LLM response](/blog/tracking-tokens-in-a-streaming-llm-response)
- [Audit trail as a runtime-authority byproduct](/blog/runtime-authority-byproducts-audit-trail-and-attribution-by-default)
