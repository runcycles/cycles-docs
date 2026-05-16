---
title: "Rust AI Agent Budget Control: Cycles Guide"
description: "Hard budget limits and action authority for Rust AI agents — Tokio async LLM calls, Axum/Actix middleware, reserve-commit, RAII guards, runcycles crate."
head:
  - - meta
    - name: keywords
      content: "rust ai agent budget, rust llm cost control, rust openai cost limit, rust anthropic budget, rust async llm, rust tokio ai agent, rust ai agent rate limiting, rust llm spending limit, runcycles crate, axum ai agent, actix ai agent"
---

# Rust AI Agent Budget Control — Cycles Integration Guide

If you're building AI agents or LLM-powered services in Rust, hard spending limits and tool-call governance are critical *before* execution, not after. This guide shows how to guard Rust async operations with Cycles budget reservations — from one-liner wrappers to full manual control — covering the patterns Tokio-native applications need: streaming responses, RAII safety, Axum / Actix middleware, and multi-step agent workflows.

Same protocol as the Python, TypeScript, and Spring Boot clients, so the same Cycles server works across polyglot stacks.

## Prerequisites

```toml
# Cargo.toml
[dependencies]
runcycles = "0.2"
tokio = { version = "1", features = ["full"] }
```

Set environment variables:

```bash
export CYCLES_BASE_URL="http://localhost:7878"
export CYCLES_API_KEY="your-api-key"
export CYCLES_TENANT="acme"
```

> **Need an API key?** Create one via the Admin Server — see [Deploy the Full Stack](/quickstart/deploying-the-full-cycles-stack#step-3-create-an-api-key) or [API Key Management](/how-to/api-key-management-in-cycles).

> **Looking for a real LLM example?** The `openai_call` / `stream_llm_response` placeholders below are intentionally generic. For the concrete `async-openai` wiring — including streaming token capture and error mapping — see [Integrate Cycles with async-openai (Rust)](/how-to/integrating-cycles-with-async-openai).

## Quick start

```rust
use runcycles::{CyclesClient, CyclesConfig, with_cycles, WithCyclesConfig, models::Amount};

#[tokio::main]
async fn main() -> Result<(), runcycles::Error> {
    let client = CyclesClient::new(CyclesConfig::from_env()?);

    let reply = with_cycles(
        &client,
        WithCyclesConfig::new(Amount::tokens(1000))
            .action("llm.completion", "gpt-4o"),
        |ctx| async move {
            let result = call_llm("What is budget authority?").await?;
            Ok((result, Amount::tokens(42)))
        },
    ).await?;

    println!("{reply}");
    Ok(())
}
```

`with_cycles` handles the full lifecycle: reserve → execute → commit on success, release on error.

## Three integration levels

### Level 1: `with_cycles()` — automatic lifecycle

The simplest option. Equivalent to Python's `@cycles` decorator:

```rust
use runcycles::{with_cycles, WithCyclesConfig, models::*};

let config = WithCyclesConfig::new(Amount::usd_microcents(2_000_000))
    .action("llm.completion", "gpt-4o")
    .subject(Subject { tenant: Some("acme".into()), ..Default::default() });

let result = with_cycles(&client, config, |ctx| async move {
    // ctx.decision — Allow or AllowWithCaps
    // ctx.caps — soft constraints (max_tokens, tool_denylist, etc.)
    // ctx.reservation_id — for logging

    if let Some(caps) = &ctx.caps {
        if let Some(max_tokens) = caps.max_tokens {
            // Respect server-imposed token limits
        }
    }

    let response = openai_call(&prompt).await?;
    let actual_cost = Amount::usd_microcents(1_800_000);
    Ok((response, actual_cost))
}).await?;
```

The closure receives a `GuardContext` and must return `Result<(T, Amount), Box<dyn Error>>` — the value plus the actual cost for commit.

### Level 2: `ReservationGuard` — RAII manual control

For streaming, multi-step workflows, or when you need to inspect the guard between reserve and commit:

```rust
use runcycles::models::*;

let guard = client.reserve(
    ReservationCreateRequest::builder()
        .subject(Subject { tenant: Some("acme".into()), ..Default::default() })
        .action(Action::new("llm.completion", "gpt-4o"))
        .estimate(Amount::usd_microcents(5_000_000))
        .build()
).await?;

// Check decision
match guard.decision() {
    Decision::Allow => { /* full access */ }
    Decision::AllowWithCaps => {
        // Adapt to caps
        if let Some(caps) = guard.caps() {
            println!("max_tokens: {:?}", caps.max_tokens);
        }
    }
}

// Execute the operation
let (response, actual_tokens) = stream_llm_response(&prompt).await?;

// Commit actual cost (consumes guard — compile-time move safety)
guard.commit(
    CommitRequest::builder()
        .actual(Amount::usd_microcents(actual_tokens))
        .build()
).await?;
```

If the guard is dropped without commit or release (panic, early `?` return), it auto-releases via `Drop` — no leaked reservations.

### Level 3: `CyclesClient` — programmatic API

Full control over every protocol operation:

```rust
use runcycles::models::*;

// Reserve
let res = client.create_reservation(&ReservationCreateRequest::builder()
    .subject(Subject { tenant: Some("acme".into()), ..Default::default() })
    .action(Action::new("tool.call", "search"))
    .estimate(Amount::tokens(500))
    .build()
).await?;

let reservation_id = res.reservation_id
    .expect("ALLOW decision always includes reservation_id");

// Execute
let result = do_work().await;

// Commit or release
match result {
    Ok(value) => {
        client.commit_reservation(
            &reservation_id,
            &CommitRequest::builder()
                .actual(Amount::tokens(320))
                .build()
        ).await?;
    }
    Err(_) => {
        client.release_reservation(
            &reservation_id,
            &ReleaseRequest::new(Some("operation_failed".into()))
        ).await?;
    }
}
```

## RISK_POINTS for action control

Guard non-monetary actions using risk-point budgets:

```rust
use runcycles::models::*;

// Reserve risk points instead of dollars
let guard = client.reserve(
    ReservationCreateRequest::builder()
        .subject(Subject { tenant: Some("acme".into()), ..Default::default() })
        .action(Action::new("tool.email", "send_customer_email"))
        .estimate(Amount::risk_points(50))
        .build()
).await?;

// Execute the action
send_email(&recipient, &body).await?;

// Commit
guard.commit(
    CommitRequest::builder()
        .actual(Amount::risk_points(50))
        .build()
).await?;
```

See [Action Authority](/concepts/action-authority-controlling-what-agents-do) for the full risk-point model.

## Axum middleware

Wrap all routes with budget enforcement:

```rust
use axum::{extract::State, middleware, Router};
use runcycles::{CyclesClient, with_cycles, WithCyclesConfig, models::Amount};

async fn budget_layer(
    State(client): State<CyclesClient>,
    req: axum::http::Request<axum::body::Body>,
    next: middleware::Next,
) -> Result<axum::response::Response, AppError> {
    let config = WithCyclesConfig::new(Amount::usd_microcents(500_000))
        .action("http.request", req.uri().path());

    let response = with_cycles(&client, config, |_ctx| async move {
        let resp = next.run(req).await;
        Ok((resp, Amount::usd_microcents(300_000)))
    }).await?;

    Ok(response)
}

let app = Router::new()
    .route("/chat", axum::routing::post(chat_handler))
    .layer(middleware::from_fn_with_state(client.clone(), budget_layer))
    .with_state(client);
```

## Multi-tenant routing

Extract tenant from request headers and scope budgets per-tenant:

```rust
use axum::extract::State;
use axum::http::HeaderMap;
use runcycles::{CyclesClient, with_cycles, WithCyclesConfig, models::*};

async fn chat(
    State(client): State<CyclesClient>,
    headers: HeaderMap,
    body: String,
) -> Result<String, AppError> {
    let tenant = headers.get("X-Tenant-ID")
        .and_then(|v| v.to_str().ok())
        .ok_or(AppError::missing_tenant())?;

    let config = WithCyclesConfig::new(Amount::usd_microcents(2_000_000))
        .action("llm.completion", "gpt-4o")
        .subject(Subject { tenant: Some(tenant.into()), ..Default::default() });

    let reply = with_cycles(&client, config, |_ctx| async move {
        let result = call_llm(&body).await?;
        Ok((result, Amount::usd_microcents(1_500_000)))
    }).await?;

    Ok(reply)
}
```

## Environment-based configuration

```rust
use runcycles::{CyclesClient, CyclesConfig};

// From environment variables (CYCLES_BASE_URL, CYCLES_API_KEY, etc.)
let client = CyclesClient::new(CyclesConfig::from_env()?);

// From builder
let client = CyclesClient::builder("cyc_live_abc123", "http://localhost:7878")
    .tenant("acme")
    .workspace("prod")
    .connect_timeout(std::time::Duration::from_secs(2))
    .read_timeout(std::time::Duration::from_secs(5))
    .retry_enabled(true)
    .retry_max_attempts(5)
    .build();
```

See [Rust Client Configuration](/quickstart/getting-started-with-the-rust-client#configuration) for all options.

## Blocking client

For synchronous Rust applications (not using tokio). The blocking client uses `create_reservation` / `commit_reservation` / `release_reservation` directly — no `ReservationGuard` (guards require async for heartbeat and Drop):

```rust
use runcycles::{CyclesClient, models::*};

let client = CyclesClient::builder("cyc_live_abc123", "http://localhost:7878")
    .tenant("acme")
    .build_blocking()?;

let res = client.create_reservation(&ReservationCreateRequest::builder()
    .subject(Subject { tenant: Some("acme".into()), ..Default::default() })
    .action(Action::new("llm.completion", "gpt-4o"))
    .estimate(Amount::usd_microcents(2_000_000))
    .build()
)?;

let reservation_id = res.reservation_id
    .expect("ALLOW decision always includes reservation_id");

// ... do work ...

client.commit_reservation(
    &reservation_id,
    &CommitRequest::builder()
        .actual(Amount::usd_microcents(1_500_000))
        .build()
)?;
```

Enable with:

```toml
[dependencies]
runcycles = { version = "0.2", features = ["blocking"] }
```

## Error handling

See [Error Handling in Rust](/how-to/error-handling-patterns-in-rust) for comprehensive patterns including:

- `Error::BudgetExceeded` — DENY handling with retry delay
- `ReservationGuard` RAII safety — compile-time double-commit prevention
- Axum `IntoResponse` error handler
- Transient vs non-transient error table

## Next steps

- [Getting Started with the Rust Client](/quickstart/getting-started-with-the-rust-client) — full quickstart with all three integration levels
- [Error Handling in Rust](/how-to/error-handling-patterns-in-rust) — comprehensive error patterns
- [How to Add Budget and Action Guardrails to Rust AI Agents](/blog/how-to-add-budget-and-action-guardrails-to-rust-ai-agents-with-cycles) — end-to-end agent example
- [Action Authority](/concepts/action-authority-controlling-what-agents-do) — RISK_POINTS for controlling what agents do
- [Degradation Paths](/how-to/how-to-think-about-degradation-paths-in-cycles-deny-downgrade-disable-or-defer) — strategies for handling budget constraints
