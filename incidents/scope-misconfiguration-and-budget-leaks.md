---
title: "Scope Misconfiguration and Budget Leaks"
description: "How misconfigured subject fields cause budget leaks by bypassing scope-level limits, and how to prevent them with Cycles."
---

# Scope Misconfiguration and Budget Leaks

A failure mode where budget is consumed from unintended scopes due to misconfigured subject fields, or where budget is not properly tracked because scopes don't match.

## The incident

A team sets up per-workspace budgets but their application doesn't consistently pass the `workspace` field in reservations. Some calls include `workspace=prod`, others omit it entirely. The result: calls without a workspace field only check the tenant-level budget, bypassing the workspace limit entirely.

### Example

**Budget setup:**

```
tenant:acme-corp                    → $100/month
tenant:acme-corp/workspace:prod     → $50/month
```

**Application code (inconsistent):**

```python
# Route A: Includes workspace — checks both scopes
@cycles(estimate=2000000, action_kind="llm.completion",
        action_name="gpt-4o", workspace="prod")
def route_a(prompt):
    ...

# Route B: Missing workspace — only checks tenant scope
@cycles(estimate=2000000, action_kind="llm.completion",
        action_name="gpt-4o")
def route_b(prompt):
    ...
```

Route B spends against `tenant:acme-corp` but never touches `tenant:acme-corp/workspace:prod`. The workspace budget appears underutilized while the tenant budget drains from both routes.

## Why this matters

- **Budget bypass.** If the workspace budget is meant to limit production spend, calls that skip the workspace field are unaccounted for at that level.
- **Misleading balances.** The workspace balance report shows less spending than actually occurred. Operators think production is within limits, but the tenant-level budget tells a different story.
- **No enforcement gap.** Cycles enforces exactly what it's told. If the subject doesn't include a scope level, that level is not checked.

## Severity and impact

Scope misconfiguration is uniquely dangerous because it is **silent**. Unlike a budget exceeded error or a denied reservation, a misconfigured scope produces no errors. Calls succeed, money is spent, and the budget reports look normal — until you realize the per-workspace limits you carefully configured are being bypassed entirely.

**Budget bypass scenario:**

```
Budget setup:
  tenant:acme-corp                    → $100/month
  tenant:acme-corp/workspace:prod     → $50/month

Route A (correct scope):   50 calls × $0.50 = $25 → charged to both tenant and workspace
Route B (missing workspace): 200 calls × $0.50 = $100 → charged to tenant only

Result:
  tenant:acme-corp        → $125 spent (OVER BUDGET)
  workspace:prod           → $25 spent  (looks fine!)
```

The workspace dashboard shows $25 spent — well within the $50 limit. But the tenant is $25 over budget because Route B bypassed workspace-level enforcement entirely. An operator looking at workspace reports sees no problem.

**Cascading misconfiguration.** When one team gets scope construction wrong, other teams sharing the same tenant scope bear the cost. Team A's misconfigured calls drain the tenant budget, causing Team B's correctly-scoped calls to be denied with `BUDGET_EXCEEDED` at the tenant level even though their workspace budget has room.

**Audit failure.** Scope mismatches break cost attribution. If finance needs to know how much the "prod" workspace spent, the answer is incomplete because Route B's spend is invisible at that scope level. This makes chargebacks and cost allocation unreliable.

## Common misconfiguration patterns

### 1. Inconsistent subject fields across routes

Different code paths construct subjects differently. One team uses `workspace`, another doesn't.

**Fix:** Centralize subject construction:

```python
def build_subject(**overrides):
    return {
        "tenant": os.environ["CYCLES_TENANT"],
        "workspace": os.environ.get("CYCLES_WORKSPACE", "default"),
        **overrides,
    }
```

### 2. Missing budget at intermediate scope levels

Budgets exist at `tenant:acme` and `tenant:acme/workspace:prod/app:chatbot`, but not at `tenant:acme/workspace:prod`. Per the protocol's skip semantics, scopes without a budget are **skipped** — the reservation checks and debits only the levels that have budgets, so the missing middle level is silently unenforced (no error is raised). Only if *none* of the affected scopes has a budget does the reservation fail, with `404 NOT_FOUND` ("Budget not found for provided scope"). The risk here is not a spurious denial — it's a level you believe is capped that isn't.

**Fix:** Create budgets at every scope level that appears in your subject hierarchy:

```bash
# Create budget at every level
curl -s -X POST .../budgets -d '{"scope": "tenant:acme"}'
curl -s -X POST .../budgets -d '{"scope": "tenant:acme/workspace:prod"}'
curl -s -X POST .../budgets -d '{"scope": "tenant:acme/workspace:prod/app:chatbot"}'
```

### 3. Wrong scope order

Cycles scopes follow a fixed hierarchy: `tenant → workspace → app → workflow → agent → toolset`. Providing fields in a different conceptual mapping (e.g., using `agent` for what's really a workspace concept) causes budget checks against the wrong ledgers.

**Fix:** Map your domain concepts to Cycles scopes consistently. See [Scope Derivation](/protocol/how-scope-derivation-works-in-cycles).

### 4. Typos in scope values

`workspace: "prod"` vs `workspace: "production"` creates two separate scope paths with separate budgets. One gets all the traffic, the other sits unused.

**Fix:** Use constants or enums for scope values, not string literals.

### 5. Dynamic scope values from user input

When scope values are derived from user input (API parameters, form fields, URL paths), unsanitized values create unpredictable scope paths:

```python
# DANGEROUS: user-controlled scope value
@cycles(estimate=2000000, action_kind="llm.completion",
        action_name="gpt-4o",
        workspace=request.headers.get("X-Workspace"))
def handle_request(prompt):
    ...
```

If a user sends `X-Workspace: prod/agent:attacker`, the scope path becomes `tenant:acme-corp/workspace:prod/agent:attacker` — an injected level that has no budget configured. Under the protocol's skip semantics, budget-less scopes are simply skipped: the call is enforced only against whatever parent budgets exist, the injected level goes unenforced, and cost attribution at that level is polluted. The call would fail (`404 NOT_FOUND`) only in the unlikely case that *no* scope in the path has a budget.

**Fix:** Validate and sanitize scope values against an allowlist:

```python
VALID_WORKSPACES = {"prod", "staging", "dev"}

def safe_workspace(raw_value: str) -> str:
    sanitized = raw_value.strip().lower()
    if sanitized not in VALID_WORKSPACES:
        raise ValueError(f"Invalid workspace: {raw_value}")
    return sanitized

@cycles(estimate=2000000, action_kind="llm.completion",
        action_name="gpt-4o",
        workspace=safe_workspace(request.headers.get("X-Workspace", "default")))
def handle_request(prompt):
    ...
```

In TypeScript:

```typescript
const VALID_WORKSPACES = new Set(["prod", "staging", "dev"]);

function safeWorkspace(raw: string | undefined): string {
  const sanitized = (raw ?? "default").trim().toLowerCase();
  if (!VALID_WORKSPACES.has(sanitized)) {
    throw new Error(`Invalid workspace: ${raw}`);
  }
  return sanitized;
}
```

## Detection

### Check for scope inconsistency

Compare the scopes that have budget with the scopes appearing in reservation activity:

```bash
# Budget scopes
curl -s "http://localhost:7878/v1/balances?tenant=acme-corp" \
  -H "X-Cycles-API-Key: $API_KEY" | jq '.balances[].scope'

# Active reservations show which scopes are being used
curl -s "http://localhost:7878/v1/reservations?tenant=acme-corp&status=ACTIVE" \
  -H "X-Cycles-API-Key: $API_KEY" | jq '.reservations[].subject'
```

If reservations are hitting scopes that don't appear in your budget list, you have a configuration gap.

### Use dry-run mode to audit

Run in [shadow mode](/how-to/shadow-mode-in-cycles-how-to-roll-out-budget-enforcement-without-breaking-production) to see all the scopes your application actually uses before creating budgets.

### TypeScript detection example

You can programmatically detect scope gaps by comparing budget scopes against reservation scopes:

```typescript
import { CyclesClient, CyclesConfig } from "runcycles";

const client = new CyclesClient(new CyclesConfig({
  baseUrl: process.env.CYCLES_BASE_URL!,
  apiKey: process.env.CYCLES_API_KEY!,
}));

async function detectScopeGaps(tenant: string): Promise<string[]> {
  const balancesResp = await client.getBalances({ tenant });
  const reservationsResp = await client.listReservations({ tenant, status: "ACTIVE" });

  const balances = balancesResp.body!.balances as Array<{ scope_path: string }>;
  const reservations = reservationsResp.body!.reservations as Array<{ scope_path: string }>;

  const budgetScopes = new Set(balances.map((b) => b.scope_path));

  const gaps = new Set<string>();
  for (const r of reservations) {
    if (!budgetScopes.has(r.scope_path)) {
      gaps.add(r.scope_path);
    }
  }
  return [...gaps];
}

// Usage — deepest reservation scopes with no budget at that level (skipped, unenforced)
const gaps = await detectScopeGaps("acme-corp");
if (gaps.length > 0) {
  console.warn("Reservations whose deepest scope has no budget (level unenforced):", gaps);
}
```

## Monitoring

### Alerting for scope mismatches

::: warning Planned metrics — requires balance-polling sidecar
`cycles_reservations_created_total{scope=...}` and `cycles_scope_spent_total{level=...}` are on the roadmap but not emitted by the current server builds (runtime 0.1.25.46). The server does register `cycles_*` operation counters (`cycles_reservations_*`, `cycles_events_total`, `cycles_overdraft_incurred_total`), but their tags are `decision` / `reason` / `overage_policy` / `tenant` — there is no scope label on them, nor on `http_server_requests_seconds*` — so scope-aware alerts require a sidecar that polls `GET /v1/balances` and `GET /v1/reservations` and pushes labelled gauges (`cycles_scope_spent`, `cycles_scope_allocated`, `cycles_reservations_created`) into your metrics pipeline. See [Balance-polling alerts](/how-to/monitoring-and-alerting#balance-polling-alerts-for-signals-without-a-counter). Once those gauges exist, the rules below apply as-is.
:::

```yaml
# Alert when reservations hit scopes that have no configured budget.
# Requires sidecar gauges: cycles_reservations_created{scope=...}, cycles_scope_allocated{scope=...}.
- alert: CyclesScopeWithoutBudget
  expr: |
    cycles_reservations_created{scope=~".+"}
    unless on(scope) cycles_scope_allocated
  for: 5m
  labels:
    severity: warning
  annotations:
    summary: "Reservations hitting scope {{ $labels.scope }} which has no budget"

# Alert when a scope's spend diverges significantly from its child scopes
# (indicates traffic bypassing child scope). Requires sidecar gauges with a level label.
- alert: CyclesScopeSpendMismatch
  expr: |
    cycles_scope_spent{level="tenant"}
    - sum(cycles_scope_spent{level="workspace"}) by (tenant)
    > 1000000
  for: 10m
  labels:
    severity: warning
  annotations:
    summary: "Tenant spend exceeds sum of workspace spend — possible scope bypass"

# Alert when a workspace scope shows zero spend while tenant scope is active.
- alert: CyclesInactiveChildScope
  expr: |
    cycles_scope_spent{level="workspace"} == 0
    and on(tenant) cycles_scope_spent{level="tenant"} > 0
  for: 30m
  labels:
    severity: info
  annotations:
    summary: "Workspace {{ $labels.workspace }} has zero spend — check for scope misconfiguration"
```

### Key metrics to track

- **Budget coverage ratio:** scopes with budgets vs distinct scopes in reservations. Should be 1.0.
- **Parent-child spend delta:** difference between parent spend and sum of child spend. Non-zero means traffic is bypassing child scopes.
- **Distinct scope count over time:** sudden increases suggest dynamic scope values from user input (pattern #5).

For detailed monitoring setup, see [Monitoring and Alerting](/how-to/monitoring-and-alerting).

## Testing scope configuration

### Python: verify all routes include required scope fields

```python
import pytest
from unittest.mock import patch
from runcycles import get_cycles_context

REQUIRED_SCOPE_LEVELS = {"tenant", "workspace"}

def _capture_scope_path(captured):
    """Mock the LLM call and grab the reservation context while it is live.

    get_cycles_context() only returns the reservation context inside the
    @cycles-guarded call, so capture scope_path from within the mock.
    """
    def _mock(prompt):
        ctx = get_cycles_context()
        captured["scope_path"] = ctx.scope_path
        return "mocked"
    return _mock

def test_route_a_includes_all_scopes():
    """Verify that route_a's reservation covers all required scope levels."""
    captured = {}
    with patch("myapp.call_llm", side_effect=_capture_scope_path(captured)):
        route_a("test prompt")

    missing = {
        level for level in REQUIRED_SCOPE_LEVELS
        if f"{level}:" not in captured["scope_path"]
    }
    assert not missing, f"Route A missing scope levels: {missing}"

def test_route_b_includes_all_scopes():
    """Verify that route_b's reservation covers all required scope levels."""
    captured = {}
    with patch("myapp.call_llm", side_effect=_capture_scope_path(captured)):
        route_b("test prompt")

    missing = {
        level for level in REQUIRED_SCOPE_LEVELS
        if f"{level}:" not in captured["scope_path"]
    }
    assert not missing, f"Route B missing scope levels: {missing}"
```

### TypeScript: centralized scope builder with tests

```typescript
import { withCycles } from "runcycles";

// Centralized scope builder — all routes use this
interface ScopeConfig {
  tenant: string;
  workspace: string;
  app?: string;
}

function buildScope(): ScopeConfig {
  const tenant = process.env.CYCLES_TENANT;
  const workspace = process.env.CYCLES_WORKSPACE;
  if (!tenant) throw new Error("CYCLES_TENANT is required");
  if (!workspace) throw new Error("CYCLES_WORKSPACE is required");
  return { tenant, workspace };
}

// Test that buildScope rejects missing fields
describe("buildScope", () => {
  it("throws if CYCLES_TENANT is missing", () => {
    delete process.env.CYCLES_TENANT;
    process.env.CYCLES_WORKSPACE = "prod";
    expect(() => buildScope()).toThrow("CYCLES_TENANT is required");
  });

  it("throws if CYCLES_WORKSPACE is missing", () => {
    process.env.CYCLES_TENANT = "acme-corp";
    delete process.env.CYCLES_WORKSPACE;
    expect(() => buildScope()).toThrow("CYCLES_WORKSPACE is required");
  });

  it("returns all required fields", () => {
    process.env.CYCLES_TENANT = "acme-corp";
    process.env.CYCLES_WORKSPACE = "prod";
    const scope = buildScope();
    expect(scope).toHaveProperty("tenant", "acme-corp");
    expect(scope).toHaveProperty("workspace", "prod");
  });
});
```

For more testing patterns, see [Testing with Cycles](/how-to/testing-with-cycles).

## Prevention

1. **Centralize subject construction.** Don't let individual routes build subjects ad hoc.
2. **Use environment variables for common fields.** Tenant, workspace, and app should come from configuration, not hardcoded strings.
3. **Audit scope usage regularly.** Compare active reservation scopes against budget scopes.
4. **Create budgets at all hierarchy levels.** Any scope that appears in a subject needs a budget.
5. **Use shadow mode when adding new scope levels.** Verify the new scopes match before enforcing.

## Next steps

- [Scope Derivation](/protocol/how-scope-derivation-works-in-cycles) — how Cycles builds scope paths from subject fields
- [Budget Allocation and Management](/how-to/budget-allocation-and-management-in-cycles) — creating and funding budgets
- [Shadow Mode Rollout](/how-to/shadow-mode-in-cycles-how-to-roll-out-budget-enforcement-without-breaking-production) — testing scopes without enforcement
- [AI Agent Budget Patterns: A Practical Guide](/blog/agent-budget-patterns-visual-guide) — six common patterns to avoid scope misconfiguration
