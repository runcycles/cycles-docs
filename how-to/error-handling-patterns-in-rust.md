---
title: "Rust Error Handling for AI Agent Budget Failures"
description: "Idiomatic Rust patterns for Cycles budget errors in async AI agents — retries, RAII safety, graceful degradation, with_cycles, ReservationGuard, CyclesClient."
head:
  - - meta
    - name: keywords
      content: "rust error handling ai agent, rust async error handling, rust budget exceeded, rust llm retry, rust raii safety, runcycles error patterns"
---

# Rust Error Handling for AI Agent Budget Failures

When your Rust async AI agent hits a budget limit, runs out of tokens, or sees a transient network failure mid-reservation — what should it do? This guide covers idiomatic Rust patterns for handling Cycles errors in async applications: retries, RAII-driven cleanup, graceful degradation, and the `BUDGET_EXCEEDED` / `RESERVATION_EXPIRED` decision points. Patterns work with `with_cycles()`, `ReservationGuard`, and the programmatic `CyclesClient`.

::: tip Also available
See [Error Handling in Python](/how-to/error-handling-patterns-in-python) or [TypeScript](/how-to/error-handling-patterns-in-typescript) for equivalent patterns, or the [general Error Handling Patterns](/how-to/error-handling-patterns-in-cycles-client-code) for language-agnostic concepts.
:::

## Error enum

The `runcycles` crate uses a single `Error` enum (not a trait-object hierarchy):

```
Error
├── Transport(reqwest::Error)        — network failure, timeout, DNS
├── Api { status, code, message, … } — server returned an error response
├── BudgetExceeded { message, … }    — budget insufficient (HTTP 409)
├── CommitPending { reservation_id, last_error } — settlement is durably queued
├── CommitRecoveryFailed { … }       — fallback failed without durable journaling
├── Deserialization(serde_json::Error) — response body parse failure
├── Config(String)                    — invalid client configuration
└── Validation(String)                — invalid request (caught before sending)
```

## Error methods

Every `Error` variant exposes convenience methods:

```rust
use runcycles::Error;

fn handle(err: &Error) {
    err.is_retryable()       // true for Transport, 5xx, BudgetExceeded with retry_after,
                             // or Api with a retryable code (INTERNAL_ERROR / unrecognized)
    err.is_budget_exceeded() // true for BudgetExceeded or Api with code BudgetExceeded
    err.retry_after()        // Option<Duration> — server-suggested delay
    err.request_id()         // Option<&str> — server-assigned request ID
    err.error_code()         // Option<ErrorCode> — parsed error code
}
```

## Handling DENY decisions

When a reservation is denied, `with_cycles()` returns `Err(Error::BudgetExceeded { .. })`. The guarded closure does not execute.

### Basic catch

```rust
use runcycles::{with_cycles, WithCyclesConfig, Error, models::Amount};

let config = WithCyclesConfig::new(Amount::tokens(1000))
    .action("llm.completion", "gpt-4o");

let result = with_cycles(&client, config, |ctx| async move {
    let response = call_llm(&prompt).await?;
    let actual = Amount::tokens(42);
    Ok((response, actual))
}).await;

match result {
    Ok(response) => println!("Success: {response}"),
    Err(Error::BudgetExceeded { message, .. }) => {
        println!("Budget exceeded: {message}");
        // Fall back to cheaper model or cached response
    }
    Err(e) => return Err(e.into()),
}
```

The closure receives a `GuardContext` (with `decision`, `caps`, `reservation_id`, `affected_scopes`) and must return `Result<(T, Amount), Box<dyn std::error::Error + Send + Sync>>` (note: not `runcycles::Error`) — the value plus the actual cost for commit.

### With retry delay

The server may include a suggested retry delay:

```rust
match result {
    Err(Error::BudgetExceeded { retry_after, .. }) if retry_after.is_some() => {
        let delay = retry_after.unwrap();
        println!("Budget exceeded. Retrying in {delay:?}");
        tokio::time::sleep(delay).await;
        // Retry the operation
    }
    Err(Error::BudgetExceeded { .. }) => {
        // No retry hint — degrade immediately
        fallback_response()
    }
    _ => { /* ... */ }
}
```

### Degradation pattern

```rust
let premium = WithCyclesConfig::new(Amount::tokens(2000))
    .action("llm.completion", "gpt-4o");

let result = with_cycles(&client, premium, |_ctx| async move {
    let r = call_llm_gpt4o(&prompt).await?;
    Ok((r, Amount::tokens(1800)))
}).await;

let response = match result {
    Ok(r) => r,
    Err(Error::BudgetExceeded { .. }) => {
        // Try cheaper model with lower estimate
        let budget = WithCyclesConfig::new(Amount::tokens(500))
            .action("llm.completion", "gpt-4o-mini");
        with_cycles(&client, budget, |_ctx| async move {
            let r = call_llm_gpt4o_mini(&prompt).await?;
            Ok((r, Amount::tokens(300)))
        }).await?
    }
    Err(e) => return Err(e.into()),
};
```

## ReservationGuard RAII safety

The `ReservationGuard` provides compile-time and runtime safety that Python and TypeScript cannot:

### Compile-time: no double-commit

`commit()` and `release()` take `self` by value, consuming the guard. You cannot call either twice:

```rust
let guard = client.reserve(request).await?;

guard.commit(commit_req).await?;
// guard.commit(another_req).await?;  // ← Compile error: use of moved value
```

### Runtime: auto-release on drop

If a guard is dropped without `commit()` or `release()` (panic, early `?` return, scope exit), it attempts a best-effort release:

```rust
async fn process(client: &CyclesClient) -> Result<String, Error> {
    let guard = client.reserve(request).await?;

    let result = do_work().await?;  // ← If this fails, guard is dropped

    // Guard auto-releases via Drop — budget returns to pool
    // No leaked reservation, no manual cleanup needed

    guard.commit(commit_req).await?;
    Ok(result)
}
```

### Inspecting caps before execution

```rust
let guard = client.reserve(request).await?;

if guard.is_capped() {
    if let Some(caps) = guard.caps() {
        if let Some(max_tokens) = caps.max_tokens {
            // Reduce output length
            prompt_config.max_tokens = max_tokens as usize;
        }
        if let Some(ref denylist) = caps.tool_denylist {
            // Remove denied tools
            available_tools.retain(|t| !denylist.contains(&t.name));
        }
    }
}

let result = execute_with_config(&prompt_config).await?;
guard.commit(commit_req).await?;
```

## Handling API errors

`Error::Api` covers all non-budget server errors:

`ReservationGuard::commit()` handles an expired commit itself: it switches the durable record to event mode and calls `POST /v1/events`. The HTTP 410 arm below therefore applies to low-level client calls, where the application owns persistence and event construction.

```rust
match result {
    Err(Error::Api { status, code, message, request_id, .. }) => {
        match status {
            409 => {
                // Note: the client converts 409s carrying BUDGET_EXCEEDED,
                // DEBT_OUTSTANDING, or OVERDRAFT_LIMIT_EXCEEDED into
                // Error::BudgetExceeded before they reach this arm — see
                // "Handling budget denials" above. Only non-budget 409s
                // (e.g. RESERVATION_FINALIZED) arrive as Error::Api.
                match code {
                    Some(ErrorCode::ReservationFinalized) => {
                        tracing::warn!("Reservation already finalized — no action needed");
                    }
                    _ => tracing::error!("API error 409: {message}"),
                }
            }
            410 => {
                // Reservation expired — work may have already run
                tracing::warn!("Reservation expired. Recording as event.");
                record_as_event(&client, actual_cost).await?;
            }
            400 => {
                // Invalid request — do not retry
                tracing::error!("Invalid request: {message}");
            }
            500.. => {
                // Server error — retry
                tracing::error!(
                    request_id = request_id.as_deref().unwrap_or("unknown"),
                    "Server error {status}: {message}"
                );
            }
            _ => tracing::error!("Unexpected status {status}: {message}"),
        }
    }
    _ => { /* ... */ }
}
```

## Handling transport errors

Network failures, timeouts, DNS resolution:

```rust
match result {
    Err(Error::Transport(ref reqwest_err)) => {
        if reqwest_err.is_timeout() {
            tracing::warn!("Cycles request timed out — retrying");
        } else if reqwest_err.is_connect() {
            tracing::error!("Cannot reach Cycles server — check network");
        } else {
            tracing::error!("Transport error: {reqwest_err}");
        }
        // All transport errors are retryable
    }
    _ => { /* ... */ }
}
```

## Catching all Cycles errors

```rust
use runcycles::{with_cycles, WithCyclesConfig, Error, models::{Amount, ErrorCode}};

let config = WithCyclesConfig::new(Amount::tokens(1000))
    .action("llm.completion", "gpt-4o");

let result = with_cycles(&client, config, |ctx| async move {
    let value = do_work().await?;
    Ok((value, Amount::tokens(800)))
}).await;

match result {
    Ok(value) => Ok(value),

    // Budget denied — degrade. This also covers 409s the client
    // collapses into BudgetExceeded (DEBT_OUTSTANDING,
    // OVERDRAFT_LIMIT_EXCEEDED); inspect `message` if you need
    // to tell them apart.
    Err(Error::BudgetExceeded { message, .. }) => {
        tracing::info!("Budget exceeded: {message}");
        Ok(fallback_value())
    }

    // Server/protocol error — check retryability
    Err(e @ Error::Api { .. }) if e.is_retryable() => {
        tracing::warn!("Retryable API error: {e}");
        Err(e)
    }

    // Network failure — retry
    Err(e @ Error::Transport(_)) => {
        tracing::warn!("Transport error: {e}");
        Err(e)
    }

    // Non-retryable — fail
    Err(e) => {
        tracing::error!("Non-retryable error: {e}");
        Err(e)
    }
}
```

## Axum error handler

For Axum web applications, convert Cycles errors to HTTP responses:

```rust
use axum::response::{IntoResponse, Response};
use axum::http::StatusCode;
use axum::Json;
use runcycles::Error;
use serde_json::json;

impl IntoResponse for AppError {
    fn into_response(self) -> Response {
        match &self.0 {
            Error::BudgetExceeded { retry_after, .. } => {
                let retry_secs = retry_after
                    .map(|d| d.as_secs().to_string())
                    .unwrap_or_else(|| "60".to_string());

                (
                    StatusCode::TOO_MANY_REQUESTS,
                    [("Retry-After", retry_secs)],
                    Json(json!({"error": "budget_exceeded", "message": "Budget limit reached."})),
                ).into_response()
            }

            // Debt and overdraft 409s arrive as Error::BudgetExceeded
            // (the client collapses those codes), so they are handled by
            // the arm above. Remaining Api errors:
            _ => {
                (
                    StatusCode::INTERNAL_SERVER_ERROR,
                    Json(json!({"error": "internal_error", "message": "An unexpected error occurred."})),
                ).into_response()
            }
        }
    }
}

struct AppError(Error);
impl From<Error> for AppError {
    fn from(e: Error) -> Self { Self(e) }
}
```

## Transient vs non-transient errors

| Error | Retryable? | Action |
|---|---|---|
| `BudgetExceeded` (409) | Maybe | Budget may free up. Check `retry_after`. Retry or degrade. |
| `BudgetExceeded` carrying a debt message (409 `DEBT_OUTSTANDING`) | Wait | Requires operator to fund the scope; the client collapses this code into `BudgetExceeded`. |
| `BudgetExceeded` carrying an overdraft message (409 `OVERDRAFT_LIMIT_EXCEEDED`) | Wait | Requires operator intervention; also collapsed into `BudgetExceeded`. |
| `CommitPending` | Replay queued | Do not compensate with a new key; drain or allow startup replay. |
| `Api` with `ReservationExpired` (410) | No | Guard commit recovers automatically; low-level callers persist and record the known spend as a same-key event. |
| `Api` with `ReservationFinalized` (409) | No | Already settled. No action needed. |
| `Api` with 5xx | Yes | Retry with exponential backoff. |
| `Transport` | Yes | Retry with exponential backoff. |
| `Deserialization` | No | Bug — report. |
| `Config` | No | Fix configuration before startup. |
| `Validation` | No | Fix request parameters. |

Use `error.is_retryable()` to check programmatically.

## Rust-specific advantages

| Feature | Rust | Python / TypeScript |
|---|---|---|
| Double-commit prevention | **Compile-time** (guard consumed by value) | Runtime exception |
| Auto-release on failure | **RAII Drop** (works on panic, `?`, scope exit) | `try/finally` or `async with` |
| Error exhaustiveness | **`match` requires all variants** | Catch-all or unhandled |
| Retryability check | `error.is_retryable()` built-in | `error.is_retryable()` |
| Heartbeat | Automatic via `tokio::spawn` | Automatic via background task |

## Error handling checklist

1. **Always match on `Error::BudgetExceeded`** at the boundary where user-facing behavior is determined
2. **Use `guard.is_capped()`** to inspect ALLOW_WITH_CAPS decisions before executing
3. **Let RAII handle cleanup** — don't manually release in every error path; the `Drop` impl does it
4. **Check `error.is_retryable()`** before implementing retry logic
5. **Check `error.retry_after()`** before choosing your own delay
6. **Log `error.request_id()`** for debugging server-side issues
7. **Treat `Error::CommitPending` as queued, not rejected** — never compensate with a different key
8. **Handle low-level reservation expiry** by durably recording known usage as a same-key event; guarded commit does this automatically
9. **Implement `IntoResponse`** in web frameworks for consistent API error responses

## Next steps

- [Getting Started with the Rust Client](/quickstart/getting-started-with-the-rust-client) — `with_cycles()`, `ReservationGuard`, and `CyclesClient` setup
- [Error Codes and Error Handling](/protocol/error-codes-and-error-handling-in-cycles) — protocol error code reference
- [Degradation Paths](/how-to/how-to-think-about-degradation-paths-in-cycles-deny-downgrade-disable-or-defer) — strategies for handling budget constraints
- [SDK Settlement Recovery and Durability](/protocol/sdk-settlement-recovery-and-durability) — journal, replay, expiry fallback, and guarantee boundary
- [How to Add Budget and Action Guardrails to Rust AI Agents](/blog/how-to-add-budget-and-action-guardrails-to-rust-ai-agents-with-cycles) — end-to-end Rust agent example
