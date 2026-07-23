---
title: "Error Handling Patterns in Python"
description: "Practical patterns for handling Cycles errors in Python using the @cycles decorator and the programmatic CyclesClient. Covers retries, fallbacks, and logging."
---

# Error Handling Patterns in Python

This guide covers practical patterns for handling Cycles errors in Python applications — both with the `@cycles` decorator and with the programmatic `CyclesClient`.

::: tip Also available
See [Error Handling in TypeScript](/how-to/error-handling-patterns-in-typescript) or [Rust](/how-to/error-handling-patterns-in-rust) for equivalent patterns, or the [general Error Handling Patterns](/how-to/error-handling-patterns-in-cycles-client-code) for language-agnostic concepts.
:::

## Exception hierarchy

The `runcycles` package provides a typed exception hierarchy:

```
CyclesError (base)
├── CyclesProtocolError (server returned a protocol-level error)
│   ├── BudgetExceededError
│   ├── OverdraftLimitExceededError
│   ├── DebtOutstandingError
│   ├── ReservationExpiredError
│   └── ReservationFinalizedError
└── CyclesTransportError (exported for user code; not raised by the SDK)
```

`CyclesTransportError` is exported but never raised by the SDK itself — transport failures surface as `status == -1` instead. See [Transport errors](#transport-errors) below.

## CyclesProtocolError

When the `@cycles` decorator encounters a DENY decision or a protocol error, it raises `CyclesProtocolError`. A specific subclass (`BudgetExceededError`, etc.) is raised only when the server returns a matching HTTP error code; a 200 response with `decision=DENY` raises plain `CyclesProtocolError` with `reason_code` set:

```python
from runcycles import CyclesProtocolError

# Available attributes:
e.status           # HTTP status code (e.g. 409)
e.error_code       # Machine-readable error code (e.g. "BUDGET_EXCEEDED")
e.reason_code      # Reason code string
e.retry_after_ms   # Suggested retry delay in ms (or None)
e.request_id       # Server request ID
e.details          # Additional error details dict

# Convenience checks:
e.is_budget_exceeded()
e.is_overdraft_limit_exceeded()
e.is_debt_outstanding()
e.is_reservation_expired()
e.is_reservation_finalized()
e.is_idempotency_mismatch()
e.is_unit_mismatch()
e.is_retryable()
```

## Handling DENY decisions

When a reservation is denied, the decorated function does not execute. An exception is raised instead.

### Basic catch

```python
from runcycles import cycles, BudgetExceededError

@cycles(estimate=1000)
def summarize(text: str) -> str:
    return call_llm(text)

try:
    result = summarize(text)
except BudgetExceededError:
    result = "Service temporarily unavailable due to budget limits."
```

### With retry delay

The server may include a `retry_after_ms` hint suggesting when budget might become available:

```python
from runcycles import CyclesProtocolError

try:
    result = summarize(text)
except CyclesProtocolError as e:
    if e.is_budget_exceeded() and e.retry_after_ms:
        schedule_retry(text, delay_ms=e.retry_after_ms)
        result = f"Request queued. Retrying in {e.retry_after_ms}ms."
    elif e.is_budget_exceeded():
        result = fallback_summary(text)
    else:
        raise
```

### Degradation patterns

```python
from runcycles import BudgetExceededError

try:
    result = premium_service.analyze(data)   # GPT-4o, high cost
except BudgetExceededError:
    result = basic_service.analyze(data)     # GPT-4o-mini, lower cost
```

## Handling debt and overdraft errors

### DebtOutstandingError

A scope has unpaid debt and no overdraft limit configured. New reservations are blocked until the debt is resolved or an overdraft limit is set.

```python
from runcycles import DebtOutstandingError

try:
    result = process(input_data)
except DebtOutstandingError:
    logger.warning("Scope has outstanding debt. Notifying operator.")
    alert_operator("Budget debt detected. Funding required.")
    result = "Service paused pending budget review."
```

### OverdraftLimitExceededError

The scope's debt has exceeded its overdraft limit.

```python
from runcycles import OverdraftLimitExceededError

try:
    result = process(input_data)
except OverdraftLimitExceededError:
    logger.error("Overdraft limit exceeded. Scope is blocked.")
    result = "Budget limit reached. Please contact support."
```

## Handling expired reservations

If a function takes longer than the reservation TTL plus grace period, the commit fails with `RESERVATION_EXPIRED`. The decorator handles heartbeat extensions automatically, but network issues can prevent extensions.

With the decorator, a commit-time `RESERVATION_EXPIRED` is **not** raised to your code. The decorator logs a warning (`"Reservation already finalized/expired"` on the `runcycles` logger) and the decorated call returns its result normally — the work succeeded, but the spend was not recorded. Detect these cases through logs or monitoring, and record the usage as an event if the spend must land on the ledger. If you need to observe commit failures directly, use the programmatic client, where `commit_reservation()` returns a `CyclesResponse` whose error code you can inspect (see [Programmatic client error handling](#programmatic-client-error-handling)).

`ReservationExpiredError` is raised only when reservation *creation* returns the `RESERVATION_EXPIRED` error code — never from a commit inside the decorator.

## Catching all Cycles errors

```python
from runcycles import (
    BudgetExceededError,
    DebtOutstandingError,
    OverdraftLimitExceededError,
    CyclesProtocolError,
    CyclesError,
)

try:
    result = guarded_func()
except BudgetExceededError:
    result = fallback()
except DebtOutstandingError:
    alert_operator("Debt outstanding")
    result = "Service paused"
except OverdraftLimitExceededError:
    result = "Budget limit reached"
except CyclesProtocolError as e:
    if e.status == -1:
        # Network-level failure at reserve time — retry with backoff
        logger.error("Transport error: %s", e)
    else:
        # Any other protocol error
        logger.error("Protocol error: %s (code=%s, status=%d)", e, e.error_code, e.status)
    raise
```

## Programmatic client error handling

When using `CyclesClient` directly, errors come as response status codes rather than exceptions:

```python
from runcycles import CyclesClient, ReservationCreateRequest

with CyclesClient(config) as client:
    response = client.create_reservation(request)

    if response.is_success:
        reservation_id = response.get_body_attribute("reservation_id")
        # Proceed with work
    elif response.is_server_error:
        # Server error — retry with backoff
        logger.warning("Cycles server error: %s", response.error_message)
    elif response.is_transport_error:
        # Network failure (status == -1) — retry with backoff
        logger.warning("Transport error: %s", response.error_message)
    else:
        # Client error (4xx) — do not retry
        # 409 = budget exceeded, debt outstanding, overdraft limit exceeded
        # 400 = invalid request, unit mismatch
        # 410 = reservation expired
        logger.error(
            "Cycles client error: status=%d, error=%s",
            response.status, response.error_message,
        )
```

## Transport errors

When the HTTP request itself fails (DNS resolution, connection refused, timeout), how it surfaces depends on the API:

- **Decorator:** a transport failure at reserve time raises `CyclesProtocolError` with `status == -1` and `error_code=None`. Transport failures at commit time are retried in the background by the commit retry engine, not raised.
- **Programmatic client:** calls never raise for transport failures — they return a `CyclesResponse` with `is_transport_error == True` and `status == -1`.

```python
from runcycles import CyclesProtocolError

try:
    result = guarded_func()
except CyclesProtocolError as e:
    if e.status == -1:
        logger.error("Network error reaching Cycles: %s", e)
        # Retry or degrade
    else:
        raise
```

The `CyclesTransportError` class is exported for use in your own code (e.g. wrapping transport-level failures in higher-level integrations), but the SDK itself never raises it.

## FastAPI / Starlette error handler

For web applications, register a global exception handler:

```python
from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse
from runcycles import CyclesProtocolError

app = FastAPI()

@app.exception_handler(CyclesProtocolError)
async def cycles_error_handler(request: Request, exc: CyclesProtocolError):
    if exc.is_budget_exceeded():
        retry_after = exc.retry_after_ms // 1000 if exc.retry_after_ms else 60
        return JSONResponse(
            status_code=429,
            content={"error": "budget_exceeded", "message": "Budget limit reached."},
            headers={"Retry-After": str(retry_after)},
        )

    if exc.is_debt_outstanding() or exc.is_overdraft_limit_exceeded():
        return JSONResponse(
            status_code=503,
            content={"error": "service_unavailable", "message": "Service paused due to budget constraints."},
        )

    return JSONResponse(
        status_code=500,
        content={"error": "internal_error", "message": "An unexpected error occurred."},
    )
```

## Transient vs non-transient errors

| Error | Retryable? | Action |
|---|---|---|
| `BUDGET_EXCEEDED` (409) | Maybe | Budget may free up after other reservations commit. Retry with backoff or degrade. |
| `BUDGET_FROZEN` (409) | Wait | Budget scope frozen by an operator. Retry after it is unfrozen. |
| `BUDGET_CLOSED` (409) | No | Budget scope is permanently closed. Route spend elsewhere. |
| `DEBT_OUTSTANDING` (409) | Wait | Requires operator to fund the scope or configure an overdraft limit. Retry after funding. |
| `OVERDRAFT_LIMIT_EXCEEDED` (409) | Wait | Requires operator intervention. |
| `MAX_EXTENSIONS_EXCEEDED` (409) | No | Tenant's `max_reservation_extensions` limit reached. Commit or release; use a longer initial `ttl_ms`. |
| `RESERVATION_EXPIRED` (410) | No | Create a new reservation or record as event. |
| `RESERVATION_FINALIZED` (409) | No | Reservation already settled. No action needed. |
| `IDEMPOTENCY_MISMATCH` (409) | No | Fix the idempotency key or payload. |
| `UNIT_MISMATCH` (400) | No | Fix the unit in your request. Inspect `details.expected_units` to see which units are funded at the scope. |
| `INVALID_REQUEST` (400) | No | Fix the request payload. |
| `NOT_FOUND` (404) | No / Wait | Two cases, distinguished by the `message` field: missing reservation (`"Reservation not found: ..."` — check the reservation ID) or missing budget (`"Budget not found for provided scope: ..."` — operator must create a budget via the admin API). |
| `INTERNAL_ERROR` (500) | Yes | Retry with exponential backoff. |
| Transport error | Yes | Retry with exponential backoff. |

Use `e.is_retryable()` to check programmatically — it returns `True` for `INTERNAL_ERROR`, `UNKNOWN`, and any 5xx status.

## Error handling checklist

1. **Always catch `CyclesProtocolError`** at the boundary where user-facing behavior is determined
2. **Use specific subclasses** (`BudgetExceededError`, `DebtOutstandingError`, etc.) for precise handling
3. **Check `retry_after_ms`** before implementing your own retry delay
4. **Distinguish between DENY and server errors** — DENY means the system is working correctly, server errors mean something is wrong
5. **Log `error_code` and `status`** for debugging
6. **Never swallow errors silently** — at minimum, log them
7. **Watch for commit-time `RESERVATION_EXPIRED`** in logs/monitoring (the decorator does not raise it) and record usage as an event if the work already completed
8. **Register a global exception handler** in web frameworks for consistent API error responses

## Next steps

- [Getting Started with the Python Client](/quickstart/getting-started-with-the-python-client) — decorator and client setup
- [Error Codes and Error Handling](/protocol/error-codes-and-error-handling-in-cycles) — protocol error code reference
- [Degradation Paths](/how-to/how-to-think-about-degradation-paths-in-cycles-deny-downgrade-disable-or-defer) — strategies for handling budget constraints
