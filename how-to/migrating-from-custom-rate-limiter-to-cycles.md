---
title: "Migrating from a Custom Rate Limiter to Cycles"
description: "Step-by-step migration guide: replace your custom Redis-based agent rate limiter with Cycles in 4 weeks. Includes code translation, shadow mode validation, and rollback plan."
---

# Migrating from a Custom Rate Limiter to Cycles

If you've built a custom rate limiter for your AI agents — Redis counters, per-provider spend tracking, manual cost tables — and you're hitting the walls described in [We Built a Custom Agent Rate Limiter. Here's Why We Stopped](/blog/we-built-a-custom-agent-rate-limiter-heres-why-we-stopped), this guide walks you through replacing it with Cycles.

The migration is **zero-risk** because Cycles runs in [shadow mode](/how-to/shadow-mode-in-cycles-how-to-roll-out-budget-enforcement-without-breaking-production) alongside your existing limiter. You validate before you cut over. If anything looks wrong, your old limiter is still enforcing.

**Timeline:** 4 weeks (1 week setup, 2 weeks shadow mode, 1 week cut-over + cleanup)

## Before you start

**You'll need:**
- Docker (for Cycles server + Redis)
- Your current rate limiter code (to compare behavior)
- An admin API key (created during setup)
- ~30 minutes for initial deployment

**Your existing limiter keeps running** throughout phases 1-3. You only disable it in phase 4 after Cycles is validated.

## Phase 1: Deploy Cycles alongside your existing limiter (days 1-2)

### Start the server

```bash
docker compose -f docker-compose.yml up -d
```

See the [full deployment guide](/quickstart/deploying-the-full-cycles-stack) for details. The Cycles server runs on port 7878, the admin server on port 7979.

### Create your first tenant and API key

```bash
# Create a tenant matching your current user/org concept
curl -X POST http://localhost:7979/v1/admin/tenants \
  -H "X-Admin-API-Key: $ADMIN_KEY" \
  -H "Content-Type: application/json" \
  -d '{"tenant_id": "acme-corp", "name": "Acme Corp"}'

# Create an API key for your application
curl -X POST http://localhost:7979/v1/admin/api-keys \
  -H "X-Admin-API-Key: $ADMIN_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "tenant_id": "acme-corp",
    "name": "app-server",
    "permissions": ["reservations:create", "reservations:commit", "reservations:release", "reservations:extend", "reservations:list", "balances:read"]
  }'
# Save the returned api_key value — it won't be shown again
```

### Create a budget matching your current cap

Map your existing rate limit to a Cycles budget:

```bash
# If your current cap is $50/month per user (1 USD = 100,000,000 microcents)
curl -X POST http://localhost:7979/v1/admin/budgets \
  -H "Content-Type: application/json" \
  -H "X-Cycles-API-Key: $CYCLES_API_KEY" \
  -d '{
    "scope": "tenant:acme-corp",
    "unit": "USD_MICROCENTS",
    "allocated": { "amount": 5000000000, "unit": "USD_MICROCENTS" }
  }'
```

## Phase 2: Map your current system to Cycles

Before writing code, translate your existing concepts:

| Your custom rate limiter | Cycles equivalent |
|---|---|
| Redis counter per user | [Budget scope](/how-to/understanding-tenants-scopes-and-budgets-in-cycles) (per-tenant) |
| `GET balance → check → INCRBY` | [Reserve](/glossary#reservation) (atomic, no TOCTOU) |
| Report actual cost after call | [Commit](/glossary#commit) (reconciles estimate vs actual) |
| Cancel a pending operation | [Release](/glossary#release) (returns held budget) |
| Per-provider spend tracking | Multi-scope budgets (one per provider, or single aggregate) |
| Manual cost estimate table | `estimate` field on reservation |
| "Overspend by 10% OK" policy | `ALLOW_WITH_OVERDRAFT` [overage policy](/how-to/choosing-the-right-overage-policy) |
| Hard deny at cap | `REJECT` overage policy |
| Per-user monthly cap | Tenant budget with periodic reset via admin API |
| Alert on threshold | [Webhook events](/protocol/webhook-event-delivery-protocol) (`budget.exhausted`) |
| No action-level control | [RISK_POINTS](/how-to/assigning-risk-points-to-agent-tools) budgets |
| No retry deduplication | [Idempotency keys](/glossary#idempotency-key) on every operation |

## Phase 3: Dual-write in shadow mode (weeks 1-2)

This is the critical phase. Your existing limiter keeps enforcing. Cycles runs alongside in shadow mode, logging what it *would* do.

### Install the Python client

```bash
pip install runcycles
```

### Add Cycles calls next to your existing limiter

**Before (your custom limiter only):**

```python
import redis

r = redis.Redis()

def check_and_charge(user_id, estimated_cost):
    balance = int(r.get(f"budget:{user_id}") or 0)
    cap = int(r.get(f"cap:{user_id}") or 50_000_000)
    if balance + estimated_cost > cap:
        raise Exception("Budget exceeded")
    # ... do the LLM call ...
    actual_cost = get_actual_cost()
    r.incrby(f"budget:{user_id}", actual_cost)
```

**After (dual-write with Cycles in shadow mode):**

```python
import redis
from runcycles import (
    CyclesConfig, CyclesClient, DecisionRequest,
    Subject, Action, Amount, Unit
)
import uuid

r = redis.Redis()

config = CyclesConfig(
    base_url="http://localhost:7878",
    api_key="cyc_live_...",
    tenant="acme-corp",
)
client = CyclesClient(config)

def check_and_charge(user_id, estimated_cost):
    # Your existing limiter still enforces
    balance = int(r.get(f"budget:{user_id}") or 0)
    cap = int(r.get(f"cap:{user_id}") or 50_000_000)
    if balance + estimated_cost > cap:
        raise Exception("Budget exceeded")

    # Cycles shadow check — decide() evaluates without creating a reservation
    try:
        response = client.decide(DecisionRequest(
            idempotency_key=str(uuid.uuid4()),
            subject=Subject(tenant="acme-corp", workspace="production", agent=user_id),
            action=Action(kind="llm.completion", name="gpt-4o"),
            estimate=Amount(unit=Unit.USD_MICROCENTS, amount=estimated_cost),
        ))
        # Log: would Cycles have allowed or denied this?
        decision = response.get_body_attribute("decision")
        print(f"Cycles decision: {decision} for {user_id}")
    except Exception as e:
        # Shadow check failure should never block your app
        print(f"Cycles shadow error (non-blocking): {e}")

    # ... do the LLM call ...
    actual_cost = get_actual_cost()

    # Your existing limiter records actual spend
    r.incrby(f"budget:{user_id}", actual_cost)
```

### What to watch during shadow mode

Run for **1-2 weeks** and compare:

| Metric | What to check |
|---|---|
| **Agreement rate** | How often does Cycles agree with your limiter? (should be >95%) |
| **False denials** | Did Cycles deny something your limiter allowed? (indicates budget too tight) |
| **Missed denials** | Did your limiter deny something Cycles would have allowed? (indicates your limiter is tighter) |
| **Decision latency** | How much time does the Cycles call add? (expect ~5ms p50 for decide) |

If agreement is <90%, your Cycles budget needs adjusting before cut-over.

## Phase 4: Cut over (week 3)

When shadow mode looks good (>95% agreement, no surprises), switch Cycles from shadow to enforcement:

### Step 1: Replace decide() with create_reservation()

```python
# Switch from shadow decide() to enforcing create_reservation()
from runcycles import (
    ReservationCreateRequest, CommitRequest,
    Subject, Action, Amount, Unit
)

response = client.create_reservation(ReservationCreateRequest(
    idempotency_key=idempotency_key,
    subject=Subject(tenant="acme-corp", workspace="production", agent=user_id),
    action=Action(kind="llm.completion", name="gpt-4o"),
    estimate=Amount(unit=Unit.USD_MICROCENTS, amount=estimated_cost),
))

# Now check the decision — Cycles is enforcing
if not response.is_success:
    raise Exception("Budget exceeded")

reservation_id = response.get_body_attribute("reservation_id")
```

### Step 2: Add commit after work completes

```python
# After the LLM call, commit actual cost
client.commit_reservation(reservation_id, CommitRequest(
    idempotency_key=f"commit-{idempotency_key}",
    actual=Amount(unit=Unit.USD_MICROCENTS, amount=actual_cost),
))
```

### Step 3: Disable old limiter

```python
# Uses imports and client setup from Phase 3 + Phase 4 Step 1
import uuid

def check_and_charge(user_id, estimated_cost):
    # OLD LIMITER — disabled, kept as comment for rollback
    # balance = int(r.get(f"budget:{user_id}") or 0)
    # cap = int(r.get(f"cap:{user_id}") or 50_000_000)
    # if balance + estimated_cost > cap:
    #     raise Exception("Budget exceeded")

    # Cycles enforcing
    idempotency_key = str(uuid.uuid4())
    response = client.create_reservation(ReservationCreateRequest(
        idempotency_key=idempotency_key,
        subject=Subject(tenant="acme-corp", workspace="production", agent=user_id),
        action=Action(kind="llm.completion", name="gpt-4o"),
        estimate=Amount(unit=Unit.USD_MICROCENTS, amount=estimated_cost),
    ))

    if not response.is_success:
        raise Exception("Budget exceeded")

    reservation_id = response.get_body_attribute("reservation_id")

    # ... do the LLM call ...
    actual_cost = get_actual_cost()

    client.commit_reservation(reservation_id, CommitRequest(
        idempotency_key=f"commit-{idempotency_key}",
        actual=Amount(unit=Unit.USD_MICROCENTS, amount=actual_cost),
    ))
```

### Or use the decorator (cleaner)

```python
import openai
from runcycles import cycles, set_default_client

set_default_client(client)

@cycles(
    estimate=lambda prompt, max_tokens: max_tokens * 10,
    actual=lambda result: len(result) * 5,
    action_kind="llm.completion",
    action_name="gpt-4o",
    workspace="production",
)
def call_llm(prompt: str, max_tokens: int) -> str:
    return openai.chat.completions.create(
        model="gpt-4o",
        messages=[{"role": "user", "content": prompt}],
        max_tokens=max_tokens,
    ).choices[0].message.content
```

The decorator handles reserve, commit, release (on failure), and idempotency automatically.

## Phase 5: Cleanup (week 4)

- Remove commented-out limiter code
- Remove old Redis keys (`DEL budget:* cap:*`)
- Consider adding [RISK_POINTS](/how-to/assigning-risk-points-to-agent-tools) budget for action control
- Set up [webhook integrations](/how-to/webhook-integrations) (PagerDuty, Slack)
- Review [common budget patterns](/how-to/common-budget-patterns) for multi-tenant, per-workflow structures

## Rollback plan

At **any phase**, you can revert to your old limiter:

1. Re-enable old limiter code (uncomment)
2. Switch Cycles calls back to `client.decide()` (shadow mode) or remove them entirely
3. No data migration needed — both systems track state independently

The migration is safe because:
- Phase 1-3: your old limiter is still enforcing
- Phase 4: you can re-enable the old limiter in minutes
- The two systems share no state — reverting Cycles does not affect your Redis counters

## What you gain after migration

| Capability | Custom limiter | After migration (Cycles) |
|---|---|---|
| Atomic budget check | No (TOCTOU race) | Yes (atomic Lua script) |
| Cross-provider budget | Manual per-provider tracking | Single scope hierarchy |
| Retry deduplication | No | Idempotency keys on every operation |
| Action-level risk control | No | RISK_POINTS budgets |
| Webhook alerts | Custom implementation | Built-in (47 registered event types across 7 categories, PagerDuty/Slack) |
| Multi-tenant isolation | Manual Redis key prefixing | Built-in scope hierarchy |
| Delegation attenuation | No | Sub-budget carving for sub-agents |
| Shadow mode validation | No | `decide()` endpoint for shadow evaluation |
| Graceful degradation | No | ALLOW_WITH_CAPS with tool denylists |

## Common migration questions

**Can I migrate one agent at a time?**
Yes. Each agent can have its own subject scope. Migrate `agent:support-bot` first, then `agent:sales-bot`, etc. Unmigrated agents keep using the old limiter.

**What if my budget periods don't match?**
Use the admin API to reset budgets on your schedule: `POST /v1/admin/budgets/fund?scope={scope}&unit={unit}` with a `RESET_SPENT` operation (clears `spent` for the new period). This can be triggered from a cron job. For migrations where you need to import a customer mid-period with existing consumption, `RESET_SPENT` also accepts an optional `spent` field to set the starting consumption explicitly.

**Do I need to migrate all providers at once?**
No. You can start with one provider (e.g., OpenAI) and add others incrementally. Each reservation specifies the provider via the `action` field.

**What about historical spend data?**
Cycles starts fresh. Keep your old Redis data for comparison during shadow mode. After migration is complete, the old data can be archived or deleted.

**What if Cycles server goes down?**
Your application code should handle reservation failures gracefully. If the reserve call fails, decide whether to fail-safe (block the action) or fail-open (allow the action without enforcement). See [degradation paths](/how-to/how-to-think-about-degradation-paths-in-cycles-deny-downgrade-disable-or-defer) for patterns.

## Next steps

- [Full Stack Deployment Guide](/quickstart/deploying-the-full-cycles-stack) — detailed server setup
- [Python Client Quickstart](/quickstart/getting-started-with-the-python-client) — SDK reference
- [Common Budget Patterns](/how-to/common-budget-patterns) — per-tenant, per-workflow, per-run structures
- [Assigning RISK_POINTS to Tools](/how-to/assigning-risk-points-to-agent-tools) — add action authority after cost control
- [Shadow Mode Rollout](/how-to/shadow-mode-in-cycles-how-to-roll-out-budget-enforcement-without-breaking-production) — detailed shadow mode guide

## Related concepts

- [AI agent action control: hard limits on side effects](/blog/ai-agent-action-control-hard-limits-side-effects)
- [Agent delegation chains and authority attenuation](/blog/agent-delegation-chains-authority-attenuation-not-trust-propagation)
- [Graceful degradation patterns](/blog/when-budget-runs-out-graceful-degradation-patterns-for-ai-agents)
