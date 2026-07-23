---
title: "Integrating Cycles with Django"
description: "Add budget management to a Django application using middleware, per-tenant isolation, and exception handling with Cycles."
---

# Integrating Cycles with Django

This guide shows how to add budget management to a Django application using middleware, per-tenant isolation, and exception handling.

## Prerequisites

```bash
pip install runcycles django
```

```bash
export CYCLES_BASE_URL="http://localhost:7878"
export CYCLES_API_KEY="your-api-key"   # create via Admin Server — see note below
export CYCLES_TENANT="acme"
```

> **Need an API key?** Create one via the Admin Server — see [Deploy the Full Stack](/quickstart/deploying-the-full-cycles-stack#step-3-create-an-api-key) or [API Key Management](/how-to/api-key-management-in-cycles).

## Client initialization

Create a Cycles client that lives for the process lifetime. Use Django's `AppConfig.ready()` hook:

```python
# myapp/apps.py
from django.apps import AppConfig
from runcycles import CyclesClient, CyclesConfig, set_default_client

class MyAppConfig(AppConfig):
    name = "myapp"

    def ready(self):
        client = CyclesClient(CyclesConfig.from_env())
        set_default_client(client)
        # Store on the module for direct access
        import myapp
        myapp.cycles_client = client
```

Setting the default client means `@cycles`-decorated functions work without passing `client=` explicitly.

## Preflight middleware

Use `client.decide()` to check budget before processing expensive requests:

```python
# myapp/middleware.py
import uuid
from django.http import JsonResponse
from runcycles import DecisionRequest, Subject, Action, Amount, Unit

BUDGET_GUARDED_PATHS = {"/api/chat/", "/api/summarize/"}

class CyclesBudgetMiddleware:
    def __init__(self, get_response):
        self.get_response = get_response

    def __call__(self, request):
        if request.path not in BUDGET_GUARDED_PATHS:
            return self.get_response(request)

        import myapp
        client = myapp.cycles_client
        tenant = request.headers.get("X-Tenant-ID", "acme")

        response = client.decide(DecisionRequest(
            idempotency_key=str(uuid.uuid4()),
            subject=Subject(tenant=tenant, app="my-django-api"),
            action=Action(kind="api.request", name=request.path),
            estimate=Amount(unit=Unit.USD_MICROCENTS, amount=1_000_000),
        ))

        if response.is_success:
            decision = response.get_body_attribute("decision")
            if decision == "DENY":
                return JsonResponse(
                    {"error": "budget_exceeded", "message": "Insufficient budget."},
                    status=402,
                )

        return self.get_response(request)
```

Add the middleware to `settings.py`:

```python
# settings.py
MIDDLEWARE = [
    # ... existing middleware ...
    "myapp.middleware.CyclesBudgetMiddleware",
]
```

## Exception handling middleware

Convert Cycles exceptions into appropriate HTTP responses:

```python
# myapp/middleware.py
from django.http import JsonResponse
from runcycles import BudgetExceededError, CyclesProtocolError

class CyclesExceptionMiddleware:
    def __init__(self, get_response):
        self.get_response = get_response

    def __call__(self, request):
        return self.get_response(request)

    def process_exception(self, request, exception):
        if isinstance(exception, BudgetExceededError):
            return JsonResponse(
                {
                    "error": "budget_exceeded",
                    "message": "Insufficient budget for this request.",
                    "retry_after_ms": exception.retry_after_ms,
                },
                status=402,
            )
        if isinstance(exception, CyclesProtocolError):
            status = 429 if exception.is_retryable() else 503
            return JsonResponse(
                {
                    "error": str(exception.error_code),
                    "message": str(exception),
                    "retry_after_ms": exception.retry_after_ms,
                },
                status=status,
            )
        return None
```

Add it to `MIDDLEWARE` (before `CyclesBudgetMiddleware`):

```python
MIDDLEWARE = [
    # ... existing middleware ...
    "myapp.middleware.CyclesExceptionMiddleware",
    "myapp.middleware.CyclesBudgetMiddleware",
]
```

## Budget-guarded views

Use the `@cycles` decorator on view functions or helper functions:

```python
# myapp/views.py
import json
from django.http import JsonResponse
from django.views.decorators.http import require_POST
from runcycles import cycles, get_cycles_context, CyclesMetrics

PRICE_PER_INPUT_TOKEN = 250
PRICE_PER_OUTPUT_TOKEN = 1_000

@cycles(
    estimate=lambda prompt, **kw: len(prompt.split()) * 2 * PRICE_PER_INPUT_TOKEN
        + kw.get("max_tokens", 1024) * PRICE_PER_OUTPUT_TOKEN,
    actual=lambda result: result["cost"],
    action_kind="llm.completion",
    action_name="gpt-4o",
    unit="USD_MICROCENTS",
)
def guarded_llm_call(prompt: str, max_tokens: int = 1024) -> dict:
    ctx = get_cycles_context()
    if ctx and ctx.has_caps() and ctx.caps.max_tokens:
        max_tokens = min(max_tokens, ctx.caps.max_tokens)

    # Your LLM call here
    response = call_llm(prompt, max_tokens=max_tokens)

    if ctx:
        ctx.metrics = CyclesMetrics(
            tokens_input=response["usage"]["input_tokens"],
            tokens_output=response["usage"]["output_tokens"],
        )

    return {
        "content": response["content"],
        "cost": (response["usage"]["input_tokens"] * PRICE_PER_INPUT_TOKEN
                 + response["usage"]["output_tokens"] * PRICE_PER_OUTPUT_TOKEN),
    }

@require_POST
def chat_view(request):
    body = json.loads(request.body)
    result = guarded_llm_call(body["prompt"])
    return JsonResponse({"response": result["content"]})
```

## Per-tenant isolation

Extract the tenant from request headers and scope budgets per tenant. Subject fields on `@cycles` accept callables (runcycles 0.4.0+) that are invoked with the decorated function's arguments at reservation time — so the tenant can be resolved per call:

```python
# myapp/views.py
from runcycles import cycles

def get_tenant(request) -> str:
    return request.headers.get("X-Tenant-ID", "acme")

@cycles(
    estimate=1_000_000,
    action_kind="llm.completion",
    action_name="gpt-4o",
    # Resolved from this call's kwargs; returning None falls back to the
    # client-config default (CYCLES_TENANT)
    tenant=lambda prompt, **kw: kw.get("tenant", "acme"),
)
def tenant_scoped_call(prompt: str, tenant: str = "acme") -> dict:
    ...

@require_POST
def chat_view(request):
    body = json.loads(request.body)
    tenant = get_tenant(request)
    result = tenant_scoped_call(body["prompt"], tenant=tenant)
    return JsonResponse({"response": result["content"]})
```

## Budget dashboard endpoint

Expose per-tenant budget information:

```python
# myapp/views.py
from django.http import JsonResponse

def budget_view(request, tenant_id):
    import myapp
    client = myapp.cycles_client
    response = client.get_balances(tenant=tenant_id)
    if not response.is_success:
        return JsonResponse({"error": response.error_message}, status=500)
    return JsonResponse(response.body)
```

```python
# urls.py
from django.urls import path
from myapp import views

urlpatterns = [
    path("api/chat/", views.chat_view),
    path("api/budget/<str:tenant_id>/", views.budget_view),
]
```

## Key points

- **Use `CyclesClient` (sync)** in Django — Django views are synchronous by default. Use `AsyncCyclesClient` only with async views.
- **Initialize in `AppConfig.ready()`** — create the client once at startup.
- **Map HTTP errors** — `BudgetExceededError` → 402, retryable errors → 429.
- **Preflight with `decide()`** — lightweight budget check before expensive work.
- **Isolate tenants** — use the `Subject.tenant` field from request headers.
- **Set a default client** — avoids passing `client=` to every `@cycles` decorator.

## Next steps

- [Integrating with FastAPI](/how-to/integrating-cycles-with-fastapi) — async Python web framework integration
- [Error Handling Patterns in Python](/how-to/error-handling-patterns-in-python) — handling budget errors in Python
- [Testing with Cycles](/how-to/testing-with-cycles) — testing budget-guarded code
- [Production Operations Guide](/how-to/production-operations-guide) — running Cycles in production
