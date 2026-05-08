---
title: "Getting Started with the Python Client"
description: "Add runtime authority — spend, action, and audit controls — to Python AI apps using the runcycles package. Quickstart for the @cycles decorator, async support, and the programmatic CyclesClient."
---

# Getting Started with the Python Client

[![PyPI downloads](https://img.shields.io/pypi/dm/runcycles?label=PyPI%20downloads&color=555&style=flat-square)](https://pypi.org/project/runcycles/)

The `runcycles` Python package provides both a `@cycles` decorator and a programmatic `CyclesClient` for adding budget enforcement to any Python application.

The decorator wraps any function in a reserve → execute → commit lifecycle:

1. **Before the function runs:** evaluates the estimate, creates a reservation, and checks the decision
2. **While the function runs:** maintains the reservation with automatic heartbeat extensions
3. **After the function returns:** commits actual usage and releases any unused remainder
4. **If the function raises:** releases the reservation to return budget to the pool

::: tip Cycles enforces three runtime-authority pillars
- **Spend** — reserve-commit budget enforcement before LLM calls and tool actions
- **Risky actions** — three-way decisions (`Allow` / `AllowWithCaps` / `Deny`) with caps for tool denylists, max tokens, max steps, and cooldowns
- **Audit** — every reservation, commit, release, and decision is a signed event for compliance and incident review
:::

## Prerequisites

You need a running Cycles stack with a tenant, API key, and budget. If you don't have one yet, follow [Deploy the Full Stack](/quickstart/deploying-the-full-cycles-stack) first.

::: tip Where do I get my API key?
API keys are created through the **Cycles Admin Server** (port 7979) and always start with `cyc_live_`. If your stack is already running with a tenant, create one directly:

```bash
curl -s -X POST http://localhost:7979/v1/admin/api-keys \
  -H "Content-Type: application/json" \
  -H "X-Admin-API-Key: admin-bootstrap-key" \
  -d '{
    "tenant_id": "acme-corp",
    "name": "dev-key",
    "permissions": ["reservations:create","reservations:commit","reservations:release","reservations:extend","reservations:list","balances:read"]
  }' | jq -r '.key_secret'
```

The response returns the full key (e.g. `cyc_live_abc123...`). **Save it — the secret is only shown once.**

Need the full setup? See [Deploy the Full Stack — Create an API key](/quickstart/deploying-the-full-cycles-stack#step-3-create-an-api-key). For rotation and lifecycle details, see [API Key Management](/how-to/api-key-management-in-cycles).
:::

## Verify your server is running

Before writing any code, confirm the Cycles Server is reachable:

```bash
curl -sf http://localhost:7878/actuator/health | jq .
```

You should see `{"status":"UP"}`. If this fails, check that the server is running per [Deploy the Full Stack](/quickstart/deploying-the-full-cycles-stack).

::: info Two API key types
Cycles uses two different authentication headers:

- **`X-Admin-API-Key`** — used with the **Admin Server** (port 7979) to manage tenants, budgets, and API keys. This is the bootstrap secret (e.g. `admin-bootstrap-key`).
- **`X-Cycles-API-Key`** — used with the **Cycles Server** (port 7878) for runtime operations (reservations, commits, balances). This is the tenant-scoped key starting with `cyc_live_...`.

The `runcycles` client uses `X-Cycles-API-Key` automatically. You only need `X-Admin-API-Key` when calling the Admin Server directly (e.g. to create tenants or API keys).
:::

## Installation

```bash
pip install runcycles
```

Requires Python 3.10+. Dependencies (`httpx`, `pydantic >= 2.0`) are installed automatically.

## Configuration

```python
from runcycles import CyclesConfig

config = CyclesConfig(
    base_url="http://localhost:7878",
    api_key="cyc_live_...",  # from Admin Server — see tip above
    tenant="acme-corp",
)
```

Or from environment variables:

```bash
export CYCLES_BASE_URL=http://localhost:7878
export CYCLES_API_KEY=cyc_live_...   # from Admin Server /v1/admin/api-keys response
export CYCLES_TENANT=acme-corp
```

```python
config = CyclesConfig.from_env()
```

## The @cycles decorator

The simplest usage — wrap a function with a fixed estimate:

```python
from runcycles import CyclesClient, cycles, set_default_client

client = CyclesClient(config)
set_default_client(client)

@cycles(estimate=1000) # [!code focus]
def summarize(text: str) -> str:
    return call_llm(text)

result = summarize("Hello world")
```

This reserves 1000 USD_MICROCENTS before `summarize()` runs, then commits the same amount afterward.

### Dynamic estimates

The estimate can be a callable that receives the function's arguments:

```python
@cycles(estimate=lambda text, max_tokens: max_tokens * 10) # [!code focus]
def generate(text: str, max_tokens: int) -> str:
    return call_llm(text, max_tokens=max_tokens)
```

### Specifying actual usage

By default, the estimate is used as the actual amount at commit time. To calculate actual usage from the return value:

```python
@cycles(
    estimate=5000,
    actual=lambda result: len(result) * 5, # [!code focus]
)
def chat(prompt: str) -> str:
    return call_llm(prompt)
```

### Decorator parameters

| Parameter | Default | Description |
|---|---|---|
| `estimate` | (required) | `int` or callable returning `int`. Estimated amount. |
| `actual` | `None` | `int` or callable receiving the return value. Defaults to estimate. |
| `action_kind` | `None` | Action category (e.g. `"llm.completion"`). |
| `action_name` | `None` | Action identifier (e.g. `"gpt-4"`). |
| `action_tags` | `None` | List of tags for filtering/reporting. |
| `unit` | `USD_MICROCENTS` | Budget unit: `USD_MICROCENTS`, `TOKENS`, `CREDITS`, `RISK_POINTS`. |
| `ttl_ms` | `60000` | Reservation TTL in milliseconds. |
| `grace_period_ms` | `None` | Grace period after TTL expiry. When `None`, server default (5000ms) applies. |
| `overage_policy` | `"ALLOW_IF_AVAILABLE"` | `"REJECT"`, `"ALLOW_IF_AVAILABLE"`, or `"ALLOW_WITH_OVERDRAFT"`. |
| `dry_run` | `False` | If `True`, evaluate without persisting. Function does not execute. |
| `tenant` | `None` | Subject tenant override. |
| `workspace` | `None` | Subject workspace override. |
| `app` | `None` | Subject app override. |
| `workflow` | `None` | Subject workflow override. |
| `agent` | `None` | Subject agent override. |
| `toolset` | `None` | Subject toolset override. |
| `dimensions` | `None` | Custom dimensions dict. |
| `client` | `None` | Explicit client. Falls back to module default. |
| `use_estimate_if_actual_not_provided` | `True` | If `True` and `actual` is `None`, use estimate as actual at commit. |

## Accessing reservation context at runtime

Inside a decorated function, the current reservation context is available via `get_cycles_context()`:

```python :line-numbers
from runcycles import cycles, get_cycles_context, CyclesMetrics

@cycles(estimate=1000)
def process(text: str) -> str:
    ctx = get_cycles_context() # [!code focus]

    # Check reservation details
    print(f"Reservation: {ctx.reservation_id}")
    print(f"Decision: {ctx.decision}")

    # Check caps (if ALLOW_WITH_CAPS)
    if ctx.has_caps():
        max_tokens = ctx.caps.max_tokens
        if not ctx.caps.is_tool_allowed("web.search"):
            pass  # skip web search

    # Attach metrics for the commit
    ctx.metrics = CyclesMetrics(
        tokens_input=150,
        tokens_output=80,
        latency_ms=320,
        model_version="gpt-4o-mini",
    )

    # Attach metadata for audit
    ctx.commit_metadata = {"request_id": "req-abc-123"}

    return call_llm(text)
```

## Decision handling

When the reservation decision comes back, the decorator handles each case:

- **ALLOW** — the function runs normally.
- **ALLOW_WITH_CAPS** — the function runs. Caps are available through `get_cycles_context()` for the function to inspect and respect.
- **DENY** — the function does not run. A `BudgetExceededError` (or appropriate subclass) is raised.

```python
from runcycles import BudgetExceededError, CyclesProtocolError

try:
    result = summarize("Hello")
except BudgetExceededError: # [!code focus]
    result = fallback_response()
except CyclesProtocolError as e:
    if e.retry_after_ms:
        # retry after suggested delay
        pass
    result = fallback_response()
```

## Async support

The `@cycles` decorator works with async functions automatically:

```python
from runcycles import AsyncCyclesClient, cycles, set_default_client

async_client = AsyncCyclesClient(config)
set_default_client(async_client)

@cycles(estimate=1000) # [!code focus]
async def async_summarize(text: str) -> str:
    return await call_llm_async(text)

result = await async_summarize("Hello")
```

## Programmatic client

For full control, use `CyclesClient` directly:

```python :line-numbers
from runcycles import (
    CyclesClient, ReservationCreateRequest, CommitRequest, ReleaseRequest,
    Subject, Action, Amount, Unit, CyclesMetrics,
)

with CyclesClient(config) as client:
    # 1. Reserve
    response = client.create_reservation(ReservationCreateRequest( # [!code focus]
        idempotency_key="req-001",
        subject=Subject(tenant="acme", agent="support-bot"),
        action=Action(kind="llm.completion", name="gpt-4"),
        estimate=Amount(unit=Unit.USD_MICROCENTS, amount=500_000),
        ttl_ms=30_000,
    ))

    if not response.is_success:
        raise RuntimeError(f"Reservation failed: {response.error_message}")

    reservation_id = response.get_body_attribute("reservation_id")

    # 2. Execute
    try:
        result = call_llm("Hello")

        # 3. Commit
        client.commit_reservation(reservation_id, CommitRequest( # [!code focus]
            idempotency_key="commit-001",
            actual=Amount(unit=Unit.USD_MICROCENTS, amount=420_000),
            metrics=CyclesMetrics(tokens_input=1200, tokens_output=800),
        ))

    except Exception:
        # 4. Release on failure
        client.release_reservation(reservation_id, ReleaseRequest(
            idempotency_key="release-001",
            reason="Processing failed",
        ))
        raise
```

### Preflight decision check

```python
from runcycles import DecisionRequest

response = client.decide(DecisionRequest( # [!code focus]
    idempotency_key="decide-001",
    subject=Subject(tenant="acme"),
    action=Action(kind="llm.completion", name="gpt-4"),
    estimate=Amount(unit=Unit.USD_MICROCENTS, amount=500_000),
))

decision = response.get_body_attribute("decision")  # "ALLOW" or "DENY"
```

### Querying balances

```python
response = client.get_balances(tenant="acme")
print(response.body)
```

### Recording events (direct debit)

```python
from runcycles import EventCreateRequest

response = client.create_event(EventCreateRequest( # [!code focus]
    idempotency_key="evt-001",
    subject=Subject(tenant="acme"),
    action=Action(kind="api.call", name="geocode"),
    actual=Amount(unit=Unit.USD_MICROCENTS, amount=1_500),
))
```

## Suggested walkthrough

Follow this order to build understanding progressively:

**1. Reserve and commit with a fixed estimate**

```python
from runcycles import CyclesClient, CyclesConfig, cycles, set_default_client

config = CyclesConfig(base_url="http://localhost:7878", api_key="cyc_live_...", tenant="acme-corp")
client = CyclesClient(config)
set_default_client(client)

@cycles(estimate=1000) # [!code focus]
def hello(name: str) -> str:
    return f"Hello, {name}!"

result = hello("world")
print(result)
```

**2. Check your balance**

```python
response = client.get_balances(tenant="acme-corp")
print(response.body)
```

**3. Try a dry run**

```python
@cycles(estimate=500, dry_run=True)
def dry_run_func() -> str:
    return "This won't consume budget"

dry_run_func()
# Check balances — they haven't changed
```

**4. Use dynamic estimates with metrics**

```python :line-numbers
from runcycles import get_cycles_context, CyclesMetrics

@cycles(
    estimate=lambda prompt, max_tokens: max_tokens * 10, # [!code focus]
    actual=lambda result: len(result) * 5, # [!code focus]
    action_kind="llm.completion",
    action_name="gpt-4",
)
def generate(prompt: str, max_tokens: int) -> str:
    ctx = get_cycles_context()
    ctx.metrics = CyclesMetrics(tokens_input=len(prompt), tokens_output=max_tokens)
    return f"Generated response for: {prompt}"

result = generate("Explain budgets", max_tokens=500)
```

**5. Handle denials gracefully**

```python
from runcycles import BudgetExceededError

@cycles(estimate=999_999_999)
def expensive_func() -> str:
    return "This needs a lot of budget"

try:
    expensive_func()
except BudgetExceededError: # [!code focus]
    print("Budget exhausted — using fallback")
```

## Nested `@cycles` calls

Calling a `@cycles`-decorated function from inside another `@cycles`-decorated function is allowed — it will not raise an error. However, each decorator creates an **independent reservation** that deducts budget separately:

```python
@cycles(estimate=100, action_name="inner")
def inner_call():
    return "done"

@cycles(estimate=500, action_name="outer")
def outer_call():
    return inner_call()  # creates a SECOND reservation — 600 total deducted, not 500
```

This means nested decorators **double-count budget**. The outer reservation already covers the full estimated cost of the operation, so an inner reservation deducts additional budget from the same pool.

**Recommended pattern:** Place `@cycles` at the outermost entry point only. Inner functions should be plain functions without their own guard:

```python
def inner_call():  # no @cycles — called within a guarded operation
    return "done"

@cycles(estimate=500, action_name="outer")
def outer_call():
    return inner_call()  # single reservation — 500 total
```

## Lifecycle summary

For each `@cycles`-decorated function call:

1. Estimate is evaluated (callable or fixed value)
2. Reservation is created on the Cycles server
3. Decision is checked (ALLOW / ALLOW_WITH_CAPS / DENY)
4. If DENY: exception is raised, function does not run
5. Heartbeat extension is scheduled (background thread)
6. Function executes
7. Actual usage is evaluated (callable, fixed value, or estimate)
8. Commit is sent with actual amount and optional metrics
9. Heartbeat is cancelled
10. If function raised: reservation is released instead of committed

## Next steps

- [Integrating with OpenAI Agents SDK](/how-to/integrating-cycles-with-openai-agents) — budget governance for multi-agent workflows
- [Error Handling in Python](/how-to/error-handling-patterns-in-python) — Python-specific exception hierarchy and patterns
- [Error Handling Patterns](/how-to/error-handling-patterns-in-cycles-client-code) — general error handling patterns
- [API Reference](/api/) — interactive endpoint documentation
- [Using the Client Programmatically](/how-to/using-the-cycles-client-programmatically) — programmatic client reference
