---
title: "Integrating Cycles with FastAPI"
description: "Add budget management to a FastAPI application using middleware, dependency injection, and per-tenant isolation with Cycles."
---

# Integrating Cycles with FastAPI

This guide shows how to add budget management to a FastAPI application using middleware, dependency injection, per-tenant isolation, and exception handling.

## Prerequisites

```bash
pip install runcycles fastapi uvicorn
```

```bash
export CYCLES_BASE_URL="http://localhost:7878"
export CYCLES_API_KEY="your-api-key"   # create via Admin Server — see note below
export CYCLES_TENANT="acme"
```

> **Need an API key?** Create one via the Admin Server — see [Deploy the Full Stack](/quickstart/deploying-the-full-cycles-stack#step-3-create-an-api-key) or [API Key Management](/how-to/api-key-management-in-cycles).

## Client lifecycle

Use FastAPI's lifespan to manage the `AsyncCyclesClient`:

```python
from contextlib import asynccontextmanager
from fastapi import FastAPI
from runcycles import AsyncCyclesClient, CyclesConfig, set_default_client

@asynccontextmanager
async def lifespan(app: FastAPI):
    client = AsyncCyclesClient(CyclesConfig.from_env())
    set_default_client(client)
    app.state.cycles_client = client
    yield
    await client.aclose()

app = FastAPI(lifespan=lifespan)
```

Setting the default client means `@cycles`-decorated functions work without passing `client=` explicitly.

## Exception handlers

Convert Cycles exceptions into appropriate HTTP responses:

```python
from fastapi import Request
from fastapi.responses import JSONResponse
from runcycles import BudgetExceededError, CyclesProtocolError

@app.exception_handler(BudgetExceededError)
async def budget_exceeded_handler(request: Request, exc: BudgetExceededError):
    return JSONResponse(
        status_code=402,
        content={
            "error": "budget_exceeded",
            "message": "Insufficient budget for this request.",
            "retry_after_ms": exc.retry_after_ms,
        },
    )

@app.exception_handler(CyclesProtocolError)
async def protocol_error_handler(request: Request, exc: CyclesProtocolError):
    status = 429 if exc.is_retryable() else 503
    return JSONResponse(
        status_code=status,
        content={
            "error": str(exc.error_code),
            "message": str(exc),
            "retry_after_ms": exc.retry_after_ms,
        },
    )
```

## Preflight middleware

Use `client.decide()` to check budget before processing expensive requests. This avoids starting work that will be denied:

```python
import uuid
from runcycles import DecisionRequest, Subject, Action, Amount, Unit

@app.middleware("http")
async def budget_preflight(request: Request, call_next):
    if request.url.path not in ("/chat", "/summarize"):
        return await call_next(request)

    tenant = request.headers.get("X-Tenant-ID", "acme")
    client = request.app.state.cycles_client

    response = await client.decide(DecisionRequest(
        idempotency_key=str(uuid.uuid4()),
        subject=Subject(tenant=tenant, app="my-api"),
        action=Action(kind="api.request", name=request.url.path),
        estimate=Amount(unit=Unit.USD_MICROCENTS, amount=1_000_000),
    ))

    if response.is_success:
        decision = response.get_body_attribute("decision")
        if decision == "DENY":
            return JSONResponse(
                status_code=402,
                content={"error": "budget_exceeded"},
            )

    return await call_next(request)
```

## Per-tenant isolation

Use Cycles' subject hierarchy to isolate budgets per tenant. Extract the tenant from request headers, and pass it through to a subject callable on the decorator — subject fields on `@cycles` accept callables (runcycles 0.4.0+) that are invoked with the decorated function's arguments at reservation time:

```python
from fastapi import Header, Depends
from runcycles import cycles, get_cycles_context, CyclesMetrics

def get_tenant(x_tenant_id: str = Header(default="acme")) -> str:
    return x_tenant_id

@cycles(
    estimate=lambda prompt, **kw: kw.get("max_tokens", 256) * 1_000,
    actual=lambda result: result.get("cost", 0),
    action_kind="llm.completion",
    action_name="gpt-4o",
    unit="USD_MICROCENTS",
    # Resolved from this call's kwargs; returning None falls back to the
    # client-config default (CYCLES_TENANT)
    tenant=lambda prompt, **kw: kw.get("tenant", "acme"),
)
async def guarded_llm_call(prompt: str, tenant: str = "acme") -> dict:
    ...

@app.get("/chat")
async def chat(prompt: str, tenant: str = Depends(get_tenant)):
    result = await guarded_llm_call(prompt, tenant=tenant)
    return {"response": result["content"]}
```

Each tenant's requests are charged against their own budget scope. If you need control beyond what the decorator offers (custom reservation lifecycles, streaming), drop down to the programmatic client — see [Handling Streaming Responses](/how-to/handling-streaming-responses-with-cycles).

## Budget dashboard endpoint

Expose per-tenant budget information:

```python
from fastapi import HTTPException

@app.get("/budget/{tenant_id}")
async def get_budget(tenant_id: str, request: Request):
    client = request.app.state.cycles_client
    response = await client.get_balances(tenant=tenant_id)
    if not response.is_success:
        raise HTTPException(status_code=500, detail=response.error_message)
    return response.body
```

## Key points

- **Use `AsyncCyclesClient`** in FastAPI — it shares the same async event loop.
- **Manage lifecycle with lifespan** — create the client on startup, close on shutdown.
- **Map HTTP errors** — `BudgetExceededError` → 402, retryable errors → 429.
- **Preflight with `decide()`** — lightweight budget check before expensive work.
- **Isolate tenants** — use the `Subject.tenant` field from request headers.
- **Set a default client** — avoids passing `client=` to every `@cycles` decorator.

## Full example

See [`examples/fastapi_integration.py`](https://github.com/runcycles/cycles-client-python/blob/main/examples/fastapi_integration.py) for a complete, runnable server.

## Next steps

- [Error Handling Patterns in Python](/how-to/error-handling-patterns-in-python) — handling budget errors in Python
- [Handling Streaming Responses](/how-to/handling-streaming-responses-with-cycles) — budget-managed streaming
- [Testing with Cycles](/how-to/testing-with-cycles) — testing budget-guarded code
- [Production Operations Guide](/how-to/production-operations-guide) — running Cycles in production
- [FastAPI example (Python)](https://github.com/runcycles/cycles-client-python/tree/main/examples/fastapi_integration.py) — runnable FastAPI integration
