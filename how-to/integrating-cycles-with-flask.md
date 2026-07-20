---
title: "Integrating Cycles with Flask"
description: "Add budget management to a Flask application using error handlers, per-tenant isolation, and preflight budget checks with Cycles."
---

# Integrating Cycles with Flask

This guide shows how to add budget management to a Flask application using error handlers, per-tenant isolation, and preflight budget checks.

## Prerequisites

```bash
pip install runcycles flask
```

```bash
export CYCLES_BASE_URL="http://localhost:7878"
export CYCLES_API_KEY="your-api-key"   # create via Admin Server — see note below
export CYCLES_TENANT="acme"
```

> **Need an API key?** Create one via the Admin Server — see [Deploy the Full Stack](/quickstart/deploying-the-full-cycles-stack#step-3-create-an-api-key) or [API Key Management](/how-to/api-key-management-in-cycles).

## Client initialization

Create a Cycles client at app startup:

```python
from flask import Flask
from runcycles import CyclesClient, CyclesConfig, set_default_client

app = Flask(__name__)

client = CyclesClient(CyclesConfig.from_env())
set_default_client(client)
app.config["CYCLES_CLIENT"] = client
```

Setting the default client means `@cycles`-decorated functions work without passing `client=` explicitly.

## Error handlers

Convert Cycles exceptions into appropriate HTTP responses:

```python
from flask import jsonify
from runcycles import BudgetExceededError, CyclesProtocolError

@app.errorhandler(BudgetExceededError)
def handle_budget_exceeded(exc):
    return jsonify({
        "error": "budget_exceeded",
        "message": "Insufficient budget for this request.",
        "retry_after_ms": exc.retry_after_ms,
    }), 402

@app.errorhandler(CyclesProtocolError)
def handle_protocol_error(exc):
    status = 429 if exc.is_retryable() else 503
    return jsonify({
        "error": str(exc.error_code),
        "message": str(exc),
        "retry_after_ms": exc.retry_after_ms,
    }), status
```

## Budget-guarded routes

Use the `@cycles` decorator on route handler functions or helper functions:

```python
from flask import request, jsonify
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
    # Subject fields accept callables (runcycles 0.4.0+): resolved from the
    # call's arguments before the reservation is created
    tenant=lambda prompt, **kw: kw.get("tenant", "acme"),
)
def guarded_llm_call(prompt: str, max_tokens: int = 1024, tenant: str = "acme") -> dict:
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

@app.route("/chat", methods=["POST"])
def chat():
    body = request.get_json()
    result = guarded_llm_call(body["prompt"])
    return jsonify({"response": result["content"]})
```

## Preflight budget check

Use `client.decide()` with a `before_request` hook to check budget before processing expensive requests:

```python
import uuid
from flask import request, jsonify, g
from runcycles import DecisionRequest, Subject, Action, Amount, Unit

BUDGET_GUARDED_PATHS = {"/chat", "/summarize"}

@app.before_request
def budget_preflight():
    if request.path not in BUDGET_GUARDED_PATHS:
        return None

    tenant = request.headers.get("X-Tenant-ID", "acme")
    g.tenant = tenant

    response = client.decide(DecisionRequest(
        idempotency_key=str(uuid.uuid4()),
        subject=Subject(tenant=tenant, app="my-flask-api"),
        action=Action(kind="api.request", name=request.path),
        estimate=Amount(unit=Unit.USD_MICROCENTS, amount=1_000_000),
    ))

    if response.is_success:
        decision = response.get_body_attribute("decision")
        if decision == "DENY":
            return jsonify({"error": "budget_exceeded"}), 402

    return None
```

## Per-tenant isolation

Extract the tenant from request headers and scope budgets per tenant. The `tenant=lambda ...` callable on the `guarded_llm_call` decorator above (runcycles 0.4.0+) reads the `tenant` keyword argument on each call and scopes the reservation's subject to that tenant:

```python
from flask import request, g

@app.before_request
def extract_tenant():
    g.tenant = request.headers.get("X-Tenant-ID", "acme")

@app.route("/chat", methods=["POST"])
def chat():
    body = request.get_json()
    result = guarded_llm_call(body["prompt"], tenant=g.tenant)
    return jsonify({"response": result["content"]})
```

Each tenant's requests are charged against their own budget scope. Subject callables that return `None` fall back to the client-config default (`CYCLES_TENANT`).

## Budget dashboard endpoint

Expose per-tenant budget information:

```python
@app.route("/budget/<tenant_id>")
def get_budget(tenant_id):
    response = client.get_balances(tenant=tenant_id)
    if not response.is_success:
        return jsonify({"error": response.error_message}), 500
    return jsonify(response.body)
```

## Key points

- **Use `CyclesClient` (sync)** in Flask — Flask views are synchronous.
- **Initialize at app startup** — create the client once, store in `app.config`.
- **Map HTTP errors** — `BudgetExceededError` → 402, retryable errors → 429.
- **Preflight with `before_request`** — lightweight budget check before expensive work.
- **Isolate tenants** — use `g.tenant` from request headers.
- **Set a default client** — avoids passing `client=` to every `@cycles` decorator.

## Next steps

- [Integrating with Django](/how-to/integrating-cycles-with-django) — Django web framework integration
- [Integrating with FastAPI](/how-to/integrating-cycles-with-fastapi) — async Python web framework integration
- [Error Handling Patterns in Python](/how-to/error-handling-patterns-in-python) — handling budget errors in Python
- [Testing with Cycles](/how-to/testing-with-cycles) — testing budget-guarded code
- [Production Operations Guide](/how-to/production-operations-guide) — running Cycles in production
