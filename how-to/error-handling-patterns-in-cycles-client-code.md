---
title: "Error Handling Patterns in Cycles Client Code"
description: "Handle Cycles protocol errors, transport failures, and budget exceeded responses in Python, TypeScript, Rust, and Java client code."
---

# Error Handling Patterns in Cycles Client Code

This guide covers practical patterns for handling Cycles errors in your application — both with the decorator/annotation and with the programmatic client.

For Python-specific patterns (exception hierarchy, FastAPI integration), see [Error Handling in Python](/how-to/error-handling-patterns-in-python).

For TypeScript-specific patterns (exception hierarchy, Express/Next.js integration), see [Error Handling in TypeScript](/how-to/error-handling-patterns-in-typescript).

For Rust-specific patterns (RAII guard safety, `Error` enum matching, Axum integration), see [Error Handling in Rust](/how-to/error-handling-patterns-in-rust).

## Protocol error structure

The Python, Java, and TypeScript clients all expose structured error information when the server returns a protocol-level error.

::: code-group
```python [Python]
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
```java [Java]
public class CyclesProtocolException extends RuntimeException {
    ErrorCode getErrorCode();     // Machine-readable error code
    String getReasonCode();       // String error code
    int getHttpStatus();          // HTTP status from the server
    Integer getRetryAfterMs();    // Suggested retry delay (nullable)

    // Convenience checks
    boolean isBudgetExceeded();
    boolean isOverdraftLimitExceeded();
    boolean isDebtOutstanding();
    boolean isReservationExpired();
    boolean isReservationFinalized();
    boolean isIdempotencyMismatch();
    boolean isUnitMismatch();
}
```
```typescript [TypeScript]
import { CyclesProtocolError } from "runcycles";

// Available properties:
e.status;          // HTTP status code (e.g. 409)
e.errorCode;       // Machine-readable error code (e.g. "BUDGET_EXCEEDED")
e.reasonCode;      // Reason code string
e.retryAfterMs;    // Suggested retry delay in ms (or undefined)
e.requestId;       // Server request ID
e.details;         // Additional error details object

// Convenience checks:
e.isBudgetExceeded();
e.isOverdraftLimitExceeded();
e.isDebtOutstanding();
e.isReservationExpired();
e.isReservationFinalized();
e.isIdempotencyMismatch();
e.isUnitMismatch();
e.isRetryable();
```
:::

## Handling DENY decisions

When a reservation is denied, the decorated function / annotated method does not execute. An exception is thrown instead.

::: code-group
```python [Python]
from runcycles import cycles, BudgetExceededError, CyclesProtocolError

@cycles(estimate=1000)
def summarize(text: str) -> str:
    return call_llm(text)

try:
    result = summarize(text)
except BudgetExceededError:
    result = "Service temporarily unavailable due to budget limits."
except CyclesProtocolError as e:
    if e.retry_after_ms:
        schedule_retry(text, delay_ms=e.retry_after_ms)
        result = f"Request queued. Retrying in {e.retry_after_ms}ms."
    else:
        raise
```
```java [Java]
try {
    return llmService.summarize(text);
} catch (CyclesProtocolException e) {
    if (e.isBudgetExceeded() && e.getRetryAfterMs() != null) {
        scheduleRetry(text, e.getRetryAfterMs());
        return "Request queued. Retrying in " + e.getRetryAfterMs() + "ms.";
    }
    if (e.isBudgetExceeded()) {
        return fallbackSummary(text);
    }
    throw e;
}
```
```typescript [TypeScript]
import { withCycles, BudgetExceededError, CyclesProtocolError } from "runcycles";

const summarize = withCycles(
  { estimate: 1000, actionKind: "llm.completion", actionName: "gpt-4o", client },
  async (text: string) => callLlm(text),
);

try {
  result = await summarize(text);
} catch (err) {
  if (err instanceof BudgetExceededError) {
    result = "Service temporarily unavailable due to budget limits.";
  } else if (err instanceof CyclesProtocolError && err.retryAfterMs) {
    scheduleRetry(text, err.retryAfterMs);
    result = `Request queued. Retrying in ${err.retryAfterMs}ms.`;
  } else {
    throw err;
  }
}
```
:::

## Degradation patterns

::: code-group
```python [Python]
from runcycles import BudgetExceededError

try:
    result = premium_service.analyze(data)   # GPT-4o, high cost
except BudgetExceededError:
    result = basic_service.analyze(data)     # GPT-4o-mini, lower cost
```
```java [Java]
try {
    return premiumService.analyze(data);  // Uses GPT-4o, high cost
} catch (CyclesProtocolException e) {
    if (e.isBudgetExceeded()) {
        return basicService.analyze(data);  // Uses GPT-4o-mini, lower cost
    }
    throw e;
}
```
```typescript [TypeScript]
import { BudgetExceededError } from "runcycles";

try {
  result = await premiumService.analyze(data);   // GPT-4o, high cost
} catch (err) {
  if (err instanceof BudgetExceededError) {
    result = await basicService.analyze(data);   // GPT-4o-mini, lower cost
  } else {
    throw err;
  }
}
```
:::

## Handling debt and overdraft errors

### DebtOutstandingError / DEBT_OUTSTANDING

A scope has unpaid debt and no overdraft limit configured. New reservations are blocked until the debt is resolved or an overdraft limit is set.

::: code-group
```python [Python]
from runcycles import DebtOutstandingError

try:
    result = process(input_data)
except DebtOutstandingError:
    logger.warning("Scope has outstanding debt. Notifying operator.")
    alert_operator("Budget debt detected. Funding required.")
    result = "Service paused pending budget review."
```
```java [Java]
try {
    return service.process(input);
} catch (CyclesProtocolException e) {
    if (e.isDebtOutstanding()) {
        log.warn("Scope has outstanding debt. Notifying operator.");
        alertOperator("Budget debt detected. Funding required.");
        return "Service paused pending budget review.";
    }
    throw e;
}
```
```typescript [TypeScript]
import { DebtOutstandingError } from "runcycles";

try {
  result = await process(inputData);
} catch (err) {
  if (err instanceof DebtOutstandingError) {
    console.warn("Scope has outstanding debt. Notifying operator.");
    alertOperator("Budget debt detected. Funding required.");
    result = "Service paused pending budget review.";
  } else {
    throw err;
  }
}
```
:::

### OverdraftLimitExceededError / OVERDRAFT_LIMIT_EXCEEDED

The scope's debt has exceeded its overdraft limit.

::: code-group
```python [Python]
from runcycles import OverdraftLimitExceededError

try:
    result = process(input_data)
except OverdraftLimitExceededError:
    logger.error("Overdraft limit exceeded. Scope is blocked.")
    result = "Budget limit reached. Please contact support."
```
```java [Java]
try {
    return service.process(input);
} catch (CyclesProtocolException e) {
    if (e.isOverdraftLimitExceeded()) {
        log.error("Overdraft limit exceeded. Scope is blocked.");
        return "Budget limit reached. Please contact support.";
    }
    throw e;
}
```
```typescript [TypeScript]
import { OverdraftLimitExceededError } from "runcycles";

try {
  result = await process(inputData);
} catch (err) {
  if (err instanceof OverdraftLimitExceededError) {
    console.error("Overdraft limit exceeded. Scope is blocked.");
    result = "Budget limit reached. Please contact support.";
  } else {
    throw err;
  }
}
```
:::

## Handling expired reservations

If a function takes longer than the reservation TTL plus grace period, the commit will fail with `RESERVATION_EXPIRED`. Both clients handle heartbeat extensions automatically, but network issues can prevent extensions.

::: code-group
```python [Python]
from runcycles import ReservationExpiredError

try:
    result = long_running_process(data)
except ReservationExpiredError:
    logger.warning(
        "Reservation expired during processing. "
        "Consider increasing ttl_ms or checking network connectivity."
    )
    record_as_event(data)
```
```java [Java]
try {
    return longRunningService.process(data);
} catch (CyclesProtocolException e) {
    if (e.isReservationExpired()) {
        log.warn("Reservation expired during processing. "
            + "Consider increasing ttlMs or checking network connectivity.");
        recordAsEvent(data);
        return result;
    }
    throw e;
}
```
```typescript [TypeScript]
import { ReservationExpiredError } from "runcycles";

try {
  result = await longRunningProcess(data);
} catch (err) {
  if (err instanceof ReservationExpiredError) {
    console.warn(
      "Reservation expired during processing. " +
      "Consider increasing ttlMs or checking network connectivity.",
    );
    await recordAsEvent(data);
  } else {
    throw err;
  }
}
```
:::

## Catching all Cycles errors

::: code-group
```python [Python]
from runcycles import (
    BudgetExceededError,
    DebtOutstandingError,
    OverdraftLimitExceededError,
    CyclesProtocolError,
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
        # Transport failure — the request never got an HTTP response
        logger.error("Transport failure: %s", e)
    else:
        logger.error("Protocol error: %s (code=%s, status=%d)", e, e.error_code, e.status)
    raise

# Note: commit-time RESERVATION_EXPIRED is logged and swallowed by the
# decorator (the function result is returned; spend is not recorded) —
# see the Python error-handling guide for detection options.
```
```java [Java]
try {
    return annotatedMethod();
} catch (CyclesProtocolException e) {
    if (e.isBudgetExceeded()) {
        return fallback();
    } else if (e.isDebtOutstanding()) {
        alertOperator("Debt outstanding");
        return "Service paused";
    } else if (e.isOverdraftLimitExceeded()) {
        return "Budget limit reached";
    } else if (e.isReservationExpired()) {
        recordAsEvent(data);
        return result;
    } else {
        log.error("Protocol error: code={}, status={}", e.getReasonCode(), e.getHttpStatus());
        throw e;
    }
}
```
```typescript [TypeScript]
import {
  BudgetExceededError,
  DebtOutstandingError,
  OverdraftLimitExceededError,
  ReservationExpiredError,
  CyclesProtocolError,
} from "runcycles";

try {
  result = await guardedFunc();
} catch (err) {
  if (err instanceof BudgetExceededError) {
    result = await fallback();
  } else if (err instanceof DebtOutstandingError) {
    alertOperator("Debt outstanding");
    result = "Service paused";
  } else if (err instanceof OverdraftLimitExceededError) {
    result = "Budget limit reached";
  } else if (err instanceof ReservationExpiredError) {
    await recordAsEvent(data);
  } else if (err instanceof CyclesProtocolError) {
    if (err.status === -1) {
      // Transport failure — the request never got an HTTP response
      console.error(`Transport failure: ${err.message}`);
    } else {
      console.error(`Protocol error: ${err.message} (code=${err.errorCode}, status=${err.status})`);
    }
    throw err;
  } else {
    throw err;
  }
}
```
:::

## Web framework error handlers

::: code-group
```python [FastAPI]
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
```java [Spring]
@RestControllerAdvice
public class CyclesExceptionHandler {

    @ExceptionHandler(CyclesProtocolException.class)
    public ResponseEntity<Map<String, Object>> handleCyclesError(
            CyclesProtocolException e) {

        if (e.isBudgetExceeded()) {
            return ResponseEntity.status(429)
                .header("Retry-After",
                    String.valueOf(e.getRetryAfterMs() != null
                        ? e.getRetryAfterMs() / 1000 : 60))
                .body(Map.of(
                    "error", "budget_exceeded",
                    "message", "Budget limit reached. Please try again later."
                ));
        }

        if (e.isDebtOutstanding() || e.isOverdraftLimitExceeded()) {
            return ResponseEntity.status(503)
                .body(Map.of(
                    "error", "service_unavailable",
                    "message", "Service temporarily paused due to budget constraints."
                ));
        }

        return ResponseEntity.status(500)
            .body(Map.of(
                "error", "internal_error",
                "message", "An unexpected error occurred."
            ));
    }
}
```
```typescript [Express]
import type { Request, Response, NextFunction } from "express";
import { CyclesProtocolError } from "runcycles";

function cyclesErrorHandler(err: Error, req: Request, res: Response, next: NextFunction) {
  if (!(err instanceof CyclesProtocolError)) {
    return next(err);
  }

  if (err.isBudgetExceeded()) {
    const retryAfter = err.retryAfterMs ? Math.ceil(err.retryAfterMs / 1000) : 60;
    return res.status(429)
      .set("Retry-After", String(retryAfter))
      .json({ error: "budget_exceeded", message: "Budget limit reached." });
  }

  if (err.isDebtOutstanding() || err.isOverdraftLimitExceeded()) {
    return res.status(503)
      .json({ error: "service_unavailable", message: "Service paused due to budget constraints." });
  }

  return res.status(500)
    .json({ error: "internal_error", message: "An unexpected error occurred." });
}
```
```typescript [Next.js]
import { BudgetExceededError } from "runcycles";

export async function POST(req: Request) {
  try {
    const result = await handleChat(req);
    return new Response(result);
  } catch (err) {
    if (err instanceof BudgetExceededError) {
      return new Response(
        JSON.stringify({ error: "budget_exceeded", message: "Budget limit reached." }),
        { status: 402, headers: { "Content-Type": "application/json" } },
      );
    }
    throw err;
  }
}
```
:::

## Programmatic client error handling

When using the client directly, errors come as response status codes rather than exceptions.

::: code-group
```python [Python]
from runcycles import CyclesClient

with CyclesClient(config) as client:
    response = client.create_reservation(request)

    if response.is_success:
        reservation_id = response.get_body_attribute("reservation_id")
        # Proceed with work
    elif response.is_server_error:
        # Server error — retry with backoff
        logger.warning("Cycles server error: %s", response.error_message)
    elif response.is_transport_error:
        # Network failure — retry with backoff
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
```java [Java]
CyclesResponse<Map<String, Object>> response = cyclesClient.createReservation(request);

if (response.is2xx()) {
    // For non-dry-run reservations, a 2xx response means ALLOW or ALLOW_WITH_CAPS.
    // Insufficient budget returns 409 (handled below by the else branch).
    // Proceed with work
} else if (response.is5xx() || response.isTransportError()) {
    // Server error or network issue — retry
    log.warn("Cycles server error: {}", response.getErrorMessage());
    return retryOrFallback();
} else {
    // Client error (4xx) — do not retry
    // 409 = budget exceeded, debt outstanding, overdraft limit exceeded
    // 400 = invalid request, unit mismatch
    // 410 = reservation expired
    log.error("Cycles client error: status={}, error={}",
        response.getStatus(), response.getErrorMessage());
    throw new RuntimeException("Cycles request failed: " + response.getErrorMessage());
}
```
```typescript [TypeScript]
const response = await client.createReservation(request);

if (response.isSuccess) {
  const reservationId = response.getBodyAttribute("reservation_id") as string;
  // Proceed with work
} else if (response.isServerError || response.isTransportError) {
  // Server error or network failure — retry with backoff
  console.warn(`Cycles server error: ${response.errorMessage}`);
} else {
  // Client error (4xx) — do not retry
  // 409 = budget exceeded, debt outstanding, overdraft limit exceeded
  // 400 = invalid request, unit mismatch
  // 410 = reservation expired
  console.error(`Cycles client error: status=${response.status}, error=${response.errorMessage}`);
}
```
:::

## Transient vs non-transient errors

| Error | Retryable? | Action |
|---|---|---|
| `BUDGET_EXCEEDED` (409) | Maybe | Budget may free up after other reservations commit. Retry with backoff or degrade. |
| `DEBT_OUTSTANDING` (409) | Wait | Requires operator to fund the scope or configure an overdraft limit. Retry after funding. |
| `OVERDRAFT_LIMIT_EXCEEDED` (409) | Wait | Requires operator intervention. |
| `RESERVATION_EXPIRED` (410) | No | Create a new reservation or record as event. |
| `RESERVATION_FINALIZED` (409) | No | Reservation already settled. No action needed. |
| `IDEMPOTENCY_MISMATCH` (409) | No | Fix the idempotency key or payload. |
| `UNIT_MISMATCH` (400) | No | Fix the unit in your request. Inspect `details.expected_units` to see which units are funded at the scope. |
| `INVALID_REQUEST` (400) | No | Fix the request payload. |
| `UNAUTHORIZED` (401) | No | Fix the API key. |
| `FORBIDDEN` (403) | No | Fix the tenant configuration. |
| `NOT_FOUND` (404) | No / Wait | Two cases, distinguished by the `message` field: missing reservation (`"Reservation not found: ..."` — check the reservation ID) or missing budget (`"Budget not found for provided scope: ..."` — operator must create a budget via the admin API). |
| `INTERNAL_ERROR` (500) | Yes | Retry with exponential backoff. |
| Transport error | Yes | Retry with exponential backoff. |

In Python and TypeScript, use `e.is_retryable()` / `e.isRetryable()` to check programmatically — it returns `true` for `INTERNAL_ERROR`, `UNKNOWN`, and any 5xx status.

## Error handling checklist

1. **Always catch protocol errors** (`CyclesProtocolError` / `CyclesProtocolException`) at the boundary where user-facing behavior is determined
2. **Use specific subclasses** (`BudgetExceededError`, `DebtOutstandingError`, etc.) for precise handling in Python
3. **Check `retry_after_ms`** before implementing your own retry delay
4. **Distinguish between DENY and server errors** — DENY means the system is working correctly, server errors mean something is wrong
5. **Log `error_code` and `status`** for debugging
6. **Never swallow errors silently** — at minimum, log them
7. **Handle `RESERVATION_EXPIRED`** by recording usage as an event if the work already completed
8. **Register a global exception handler** in web frameworks for consistent API error responses
9. **Avoid nested budget guards** — Spring throws `IllegalStateException`; TypeScript/Python silently double-count. Place `@Cycles` / `withCycles` / `@cycles` at the outermost call site only (see [Troubleshooting](/how-to/troubleshooting-and-faq#spring-boot-illegalstateexception-nested-cycles))

## Next steps

- [Error Handling in TypeScript](/how-to/error-handling-patterns-in-typescript) — TypeScript exception hierarchy, Express/Next.js patterns
- [Error Handling in Python](/how-to/error-handling-patterns-in-python) — Python exception hierarchy, transport errors, and FastAPI patterns
- [Error Codes and Error Handling](/protocol/error-codes-and-error-handling-in-cycles) — protocol error code reference
- [Degradation Paths](/how-to/how-to-think-about-degradation-paths-in-cycles-deny-downgrade-disable-or-defer) — strategies for handling budget constraints
- [Using the Client Programmatically](/how-to/using-the-cycles-client-programmatically) — direct client usage patterns
