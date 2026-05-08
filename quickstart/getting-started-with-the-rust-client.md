---
title: "Rust Client Quickstart — Budget Control for AI Agents"
description: "Add runtime authority to Rust AI agents with the runcycles crate: async reserve-commit enforcement, RAII guards, caps, and audit records."
head:
  - - meta
    - name: keywords
      content: "rust ai agent, rust llm budget, rust llm cost control, rust openai budget, rust anthropic budget, rust ai agent rate limit, rust async ai agent, runcycles, cycles rust client"
---

# Rust Client Quickstart — Budget Control for AI Agents

[![Crates.io downloads](https://img.shields.io/crates/d/runcycles?label=crates.io%20downloads&color=555&style=flat-square)](https://crates.io/crates/runcycles)

Building AI agents in Rust with Tokio? You need hard limits on LLM spending and tool-call exposure **before** they execute, not after. The Cycles Rust client (`runcycles` crate) gives any async Rust application a reserve-commit budget enforcement layer with three integration levels — from a one-line `with_cycles()` wrapper to RAII guards to a low-level programmatic client.

Same wire protocol as the [Python](/quickstart/getting-started-with-the-python-client), [TypeScript](/quickstart/getting-started-with-the-typescript-client), and [Spring Boot](/quickstart/getting-started-with-the-cycles-spring-boot-starter) clients — switch languages without changing your Cycles server.

::: tip Cycles enforces three runtime-authority pillars
- **Spend** — reserve-commit budget enforcement before LLM calls and tool actions
- **Risky actions** — three-way decisions (`ALLOW` / `ALLOW_WITH_CAPS` / `DENY`) with caps for tool allowlists/denylists, max tokens, max steps, and cooldowns
- **Audit** — reservations, commits, releases, and decisions produce structured records for compliance and incident review
:::

The `runcycles` crate provides three levels of budget enforcement for any async Rust application:

1. **`with_cycles()`** — automatic reserve → execute → commit/release (like Python's `@cycles` decorator)
2. **`ReservationGuard`** — RAII guard for manual control (streaming, multi-step workflows)
3. **`CyclesClient`** — low-level programmatic API for full control

All three share the same lifecycle:

1. **Before the operation:** evaluates the estimate, creates a reservation, and checks the decision
2. **While the operation runs:** maintains the reservation with automatic heartbeat extensions
3. **After the operation returns:** commits actual usage and releases any unused remainder
4. **If the operation fails:** releases the reservation to return budget to the pool

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
cargo add runcycles
```

Or add to `Cargo.toml`:

```toml
[dependencies]
runcycles = "0.2"
tokio = { version = "1", features = ["full"] }
```

Requires Rust 1.88+. Dependencies (`reqwest`, `serde`, `tokio`) are installed automatically.

## Configuration

```rust
use runcycles::CyclesClient;

let client = CyclesClient::builder(
    "cyc_live_...",        // from Admin Server — see tip above
    "http://localhost:7878",
)
.tenant("acme-corp")
.build();
```

Or from environment variables:

```bash
export CYCLES_BASE_URL=http://localhost:7878
export CYCLES_API_KEY=cyc_live_...   # from Admin Server /v1/admin/api-keys response
export CYCLES_TENANT=acme-corp
```

```rust
let config = CyclesConfig::from_env().expect("missing CYCLES_ env vars");
let client = CyclesClient::new(config);
```

## Automatic lifecycle with `with_cycles()`

The simplest way to add budget enforcement — wrap any async operation:

```rust
use runcycles::{CyclesClient, with_cycles, WithCyclesConfig, models::*};

let reply = with_cycles( // [!code focus]
    &client,
    WithCyclesConfig::new(Amount::tokens(1000))
        .action("llm.completion", "gpt-4o")
        .subject(Subject { tenant: Some("acme-corp".into()), ..Default::default() }),
    |ctx| async move { // [!code focus]
        // ctx.caps, ctx.decision, ctx.reservation_id available
        let response = call_llm("Hello").await;
        let actual_tokens = 42; // from your LLM response usage stats
        Ok((response, Amount::tokens(actual_tokens))) // [!code focus]
    },
).await?;
// On success → auto-commits actual_tokens. On error → auto-releases.
```

The closure returns `Ok((result, actual_cost))` — a tuple of your return value and the actual `Amount` spent. If the closure returns `Err`, the reservation is released automatically.

### `WithCyclesConfig` parameters

| Parameter | Default | Description |
|---|---|---|
| `new(estimate)` | (required) | `Amount` — estimated cost to reserve |
| `.action(kind, name)` | `"unknown"` | Action category and identifier (e.g. `"llm.completion"`, `"gpt-4o"`) |
| `.subject(subject)` | `Default` | Who is spending (tenant, workspace, app, etc.) |
| `.ttl_ms(ms)` | `60000` | Reservation TTL in milliseconds |
| `.grace_period_ms(ms)` | server default | Grace period after TTL expiry |
| `.overage_policy(policy)` | server default | `Reject`, `AllowIfAvailable`, or `AllowWithOverdraft` |
| `.action_tags(tags)` | `None` | Tags for filtering/reporting |
| `.metrics(metrics)` | `None` | Attach observability metrics to the commit |

### Accessing context inside the closure

The closure receives a `GuardContext` with the reservation state:

```rust
|ctx| async move {
    // Budget decision
    println!("Decision: {:?}", ctx.decision);       // Allow or AllowWithCaps
    println!("Reservation: {}", ctx.reservation_id);

    // Check caps (if ALLOW_WITH_CAPS)
    if let Some(caps) = &ctx.caps { // [!code focus]
        let max_tokens = caps.max_tokens.unwrap_or(1000); // [!code focus]
        if !caps.is_tool_allowed("web_search") {
            // skip web search — budget policy restricts it
        }
    }

    let result = call_llm("Hello").await;
    Ok((result, Amount::tokens(42)))
}
```

## RAII guard for manual control

For streaming, multi-step workflows, or when you need full control over when to commit:

```rust
use runcycles::{CyclesClient, models::*};

// 1. Reserve
let guard = client.reserve( // [!code focus]
    ReservationCreateRequest::builder()
        .subject(Subject { tenant: Some("acme-corp".into()), ..Default::default() })
        .action(Action::new("llm.completion", "gpt-4o"))
        .estimate(Amount::tokens(2000))
        .ttl_ms(30_000_u64)
        .build()
).await?;

// 2. Check caps
if let Some(caps) = guard.caps() {
    println!("Max tokens: {:?}", caps.max_tokens);
}

// 3. Execute (e.g. stream chunks, accumulate tokens)
let mut total_tokens = 0i64;
for chunk in stream_llm("Write a poem").await {
    total_tokens += chunk.tokens;
}

// 4. Commit — consumes the guard (double-commit = compile error) // [!code focus]
guard.commit( // [!code focus]
    CommitRequest::builder()
        .actual(Amount::tokens(total_tokens))
        .metrics(CyclesMetrics {
            tokens_input: Some(100),
            tokens_output: Some(total_tokens - 100),
            ..Default::default()
        })
        .build()
).await?;

// guard.commit(...) here would be a COMPILE ERROR
```

### Guard lifecycle

- **`guard.commit(self)`** — consumes the guard, commits actual spend. Compile error to call twice.
- **`guard.release(self, reason)`** — consumes the guard, returns budget. Use on error.
- **`guard.extend(ms)`** — manually extend TTL (normally automatic via heartbeat).
- **Drop without commit/release** — logs a warning and spawns a best-effort release.

## Low-level programmatic client

For full control over individual API calls:

```rust
use runcycles::{CyclesClient, models::*};

// Create reservation
let resp = client.create_reservation( // [!code focus]
    &ReservationCreateRequest::builder()
        .subject(Subject { tenant: Some("acme-corp".into()), ..Default::default() })
        .action(Action::new("llm.completion", "gpt-4o"))
        .estimate(Amount::usd_microcents(500_000))
        .ttl_ms(30_000_u64)
        .build()
).await?;

let reservation_id = resp.reservation_id.unwrap();

// Execute your operation...

// Commit
client.commit_reservation(&reservation_id, // [!code focus]
    &CommitRequest::builder()
        .actual(Amount::usd_microcents(420_000))
        .metrics(CyclesMetrics {
            tokens_input: Some(1200),
            tokens_output: Some(800),
            ..Default::default()
        })
        .build()
).await?;
```

### Preflight decision check

```rust
let resp = client.decide( // [!code focus]
    &DecisionRequest::builder()
        .subject(Subject { tenant: Some("acme-corp".into()), ..Default::default() })
        .action(Action::new("llm.completion", "gpt-4o"))
        .estimate(Amount::usd_microcents(500_000))
        .build()
).await?;

println!("Decision: {:?}", resp.decision); // Allow, AllowWithCaps, or Deny
```

### Querying balances

```rust
let resp = client.get_balances(&BalanceParams {
    tenant: Some("acme-corp".into()),
    ..Default::default()
}).await?;

for balance in &resp.balances {
    println!("{}: {} remaining", balance.scope, balance.remaining.amount);
}
```

### Recording events (direct debit)

```rust
let resp = client.create_event( // [!code focus]
    &EventCreateRequest::builder()
        .subject(Subject { tenant: Some("acme-corp".into()), ..Default::default() })
        .action(Action::new("api.call", "geocode"))
        .actual(Amount::usd_microcents(1_500))
        .build()
).await?;
```

## Decision handling

When the reservation decision comes back, each API level handles it:

- **`with_cycles()`** — returns `Err(Error::BudgetExceeded)` on DENY. Closure never runs.
- **`ReservationGuard`** — `client.reserve()` returns `Err(Error::BudgetExceeded)` on DENY.
- **Low-level** — `resp.decision` can be checked directly.

```rust
use runcycles::Error;

match client.reserve(/* ... */).await {
    Ok(guard) => {
        // ALLOW or ALLOW_WITH_CAPS — proceed
        guard.commit(/* ... */).await?;
    }
    Err(Error::BudgetExceeded { message, retry_after, .. }) => { // [!code focus]
        println!("Budget exceeded: {message}");
        if let Some(delay) = retry_after {
            tokio::time::sleep(delay).await;
            // retry...
        }
    }
    Err(Error::Api { status, code, .. }) => {
        println!("API error ({status}): {code:?}");
    }
    Err(Error::Transport(e)) => {
        println!("Network error (retryable): {e}");
    }
    Err(e) => {
        println!("Other error: {e}");
    }
}
```

## Suggested walkthrough

Follow this order to build understanding progressively:

**1. Reserve and commit with `with_cycles()`**

```rust
use runcycles::{CyclesClient, with_cycles, WithCyclesConfig, models::*};

let client = CyclesClient::builder("cyc_live_...", "http://localhost:7878")
    .tenant("acme-corp")
    .build();

let result = with_cycles( // [!code focus]
    &client,
    WithCyclesConfig::new(Amount::tokens(1000))
        .action("llm.completion", "gpt-4o")
        .subject(Subject { tenant: Some("acme-corp".into()), ..Default::default() }),
    |_ctx| async move {
        Ok(("Hello!".to_string(), Amount::tokens(42)))
    },
).await?;

println!("{result}");
```

**2. Check your balance**

```rust
let resp = client.get_balances(&BalanceParams {
    tenant: Some("acme-corp".into()),
    ..Default::default()
}).await?;
println!("{:?}", resp.balances);
```

**3. Try a dry run**

```rust
let resp = client.create_reservation(
    &ReservationCreateRequest::builder()
        .subject(Subject { tenant: Some("acme-corp".into()), ..Default::default() })
        .action(Action::new("llm.completion", "gpt-4o"))
        .estimate(Amount::tokens(500))
        .dry_run(true) // [!code focus]
        .build()
).await?;
println!("Decision: {:?}", resp.decision);
// Check balances — they haven't changed
```

**4. Use the RAII guard with caps**

```rust
let guard = client.reserve(/* ... */).await?;

if guard.is_capped() { // [!code focus]
    let caps = guard.caps().unwrap();
    println!("Max tokens: {:?}", caps.max_tokens);
}

guard.commit(CommitRequest::builder().actual(Amount::tokens(100)).build()).await?;
```

**5. Handle denials gracefully**

```rust
use runcycles::Error;

match with_cycles(&client, WithCyclesConfig::new(Amount::tokens(999_999_999))
    .action("llm.completion", "gpt-4o")
    .subject(Subject { tenant: Some("acme-corp".into()), ..Default::default() }),
    |_ctx| async move { Ok(("".to_string(), Amount::tokens(0))) },
).await {
    Ok(_) => println!("Success"),
    Err(Error::BudgetExceeded { message, .. }) => { // [!code focus]
        println!("Budget exhausted: {message} — using fallback");
    }
    Err(e) => println!("Error: {e}"),
}
```

## Lifecycle summary

For each `with_cycles()` call or `ReservationGuard`:

1. Estimate is provided via `Amount`
2. Reservation is created on the Cycles server
3. Decision is checked (ALLOW / ALLOW_WITH_CAPS / DENY)
4. If DENY: `Error::BudgetExceeded` is returned, operation does not run
5. Heartbeat extension is scheduled (background tokio task at TTL/2)
6. Operation executes
7. On success: commit is sent with actual amount and optional metrics
8. On error: reservation is released to return budget
9. Heartbeat is cancelled
10. If guard is dropped without commit/release: best-effort release via `tokio::spawn`

## Next steps

- [Error Handling Patterns](/how-to/error-handling-patterns-in-cycles-client-code) — general error handling patterns
- [API Reference](/api/) — interactive endpoint documentation
- [How Reserve/Commit Works](/protocol/how-reserve-commit-works-in-cycles) — the core protocol lifecycle
