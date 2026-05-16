---
title: "Rust Client Configuration Reference"
description: "Complete reference for the runcycles Rust client: CyclesConfig fields, environment variables, builder API, retry tuning, blocking variant, custom HTTP client."
head:
  - - meta
    - name: keywords
      content: "rust client configuration, runcycles config, cycles rust env vars, rust client builder, rust async client config, cycles rust retry tuning, rust blocking client"
---

# Rust Client Configuration Reference

Complete reference for all configuration options in the `runcycles` Rust client. Targets `runcycles >= 0.2.0`. The async client is the default; the blocking variant is available behind a feature flag.

For the introductory walkthrough, see the [Rust Client Quickstart](/quickstart/getting-started-with-the-rust-client). For runtime error patterns, see [Error Handling in Rust](/how-to/error-handling-patterns-in-rust).

## CyclesConfig

The `CyclesConfig` struct holds all client configuration. It can be constructed via the builder API (recommended), via `CyclesConfig::from_env()`, or by populating the struct fields directly.

### Required fields

| Field | Type | Description |
|---|---|---|
| `base_url` | `String` | Base URL of the [Cycles server](/glossary#cycles-server) (e.g. `http://localhost:7878`) |
| `api_key` | `String` | API key for authentication. [Tenant](/glossary#tenant)-scoped key starting with `cyc_live_` |

### Subject defaults

These fields set default Subject values applied to every request unless overridden at the call site. Override at the call site by passing an explicit `Subject` to the request builder.

| Field | Type | Default | Description |
|---|---|---|---|
| `tenant` | `Option<String>` | `None` | Default tenant |
| `workspace` | `Option<String>` | `None` | Default workspace |
| `app` | `Option<String>` | `None` | Default application name |
| `workflow` | `Option<String>` | `None` | Default workflow |
| `agent` | `Option<String>` | `None` | Default agent |
| `toolset` | `Option<String>` | `None` | Default toolset |

### HTTP timeouts

| Field | Type | Default | Description |
|---|---|---|---|
| `connect_timeout` | `Duration` | `2_000 ms` | TCP connection timeout |
| `read_timeout` | `Duration` | `5_000 ms` | Read timeout for responses |

`Duration` values are constructed with `std::time::Duration::from_millis(...)` or `from_secs(...)` in programmatic configuration. Environment variables are expressed in milliseconds (see below).

### Retry configuration

Controls the commit retry engine for transient failures. The same engine runs in the async client and the blocking variant.

| Field | Type | Default | Description |
|---|---|---|---|
| `retry_enabled` | `bool` | `true` | Enable automatic commit retries |
| `retry_max_attempts` | `u32` | `5` | Maximum number of retry attempts |
| `retry_initial_delay` | `Duration` | `500 ms` | Delay before the first retry |
| `retry_multiplier` | `f64` | `2.0` | Exponential backoff multiplier between retries |
| `retry_max_delay` | `Duration` | `30_000 ms` | Maximum delay between retries (cap) |

#### How retry works

When a commit fails with a transport error or a 5xx response, the retry engine schedules a retry using exponential backoff:

```
Attempt 1: wait 500 ms
Attempt 2: wait 1_000 ms
Attempt 3: wait 2_000 ms
Attempt 4: wait 4_000 ms
Attempt 5: wait 8_000 ms (capped at retry_max_delay if smaller)
```

Non-retryable errors (4xx responses other than 429, validation failures, deserialization errors) are not retried. `BudgetExceeded` carries a server-suggested `retry_after` that callers can apply manually.

## Programmatic configuration

The builder API is the recommended way to construct a client:

```rust
use runcycles::{CyclesClient, CyclesConfig};
use std::time::Duration;

let client = CyclesClient::builder(
    "cyc_live_...",
    "http://localhost:7878",
)
.tenant("acme-corp")
.workspace("production")
.app("support-bot")
.connect_timeout(Duration::from_millis(2_000))
.read_timeout(Duration::from_millis(5_000))
.retry_enabled(true)
.retry_max_attempts(5)
.retry_initial_delay(Duration::from_millis(500))
.retry_multiplier(2.0)
.retry_max_delay(Duration::from_secs(30))
.build();
```

Or construct `CyclesConfig` directly and pass it to `CyclesClient::new`:

```rust
use runcycles::{CyclesClient, CyclesConfig};
use std::time::Duration;

let config = CyclesConfig {
    base_url: "http://localhost:7878".into(),
    api_key: "cyc_live_...".into(),
    tenant: Some("acme-corp".into()),
    connect_timeout: Duration::from_millis(2_000),
    read_timeout: Duration::from_millis(5_000),
    retry_enabled: true,
    retry_max_attempts: 5,
    retry_initial_delay: Duration::from_millis(500),
    retry_multiplier: 2.0,
    retry_max_delay: Duration::from_secs(30),
    ..Default::default()
};

let client = CyclesClient::new(config);
```

## Environment variable configuration

Use `CyclesConfig::from_env()` to load configuration from environment variables. The default prefix is `CYCLES_`:

```rust
use runcycles::CyclesConfig;

let config = CyclesConfig::from_env().expect("missing required CYCLES_* env vars");
```

| Environment variable | Maps to | Type | Required |
|---|---|---|---|
| `CYCLES_BASE_URL` | `base_url` | string | Yes |
| `CYCLES_API_KEY` | `api_key` | string | Yes |
| `CYCLES_TENANT` | `tenant` | string | No |
| `CYCLES_WORKSPACE` | `workspace` | string | No |
| `CYCLES_APP` | `app` | string | No |
| `CYCLES_WORKFLOW` | `workflow` | string | No |
| `CYCLES_AGENT` | `agent` | string | No |
| `CYCLES_TOOLSET` | `toolset` | string | No |
| `CYCLES_CONNECT_TIMEOUT` | `connect_timeout` | milliseconds (integer) | No |
| `CYCLES_READ_TIMEOUT` | `read_timeout` | milliseconds (integer) | No |
| `CYCLES_RETRY_ENABLED` | `retry_enabled` | `true` / `false` | No |
| `CYCLES_RETRY_MAX_ATTEMPTS` | `retry_max_attempts` | integer | No |
| `CYCLES_RETRY_INITIAL_DELAY` | `retry_initial_delay` | milliseconds (integer) | No |
| `CYCLES_RETRY_MULTIPLIER` | `retry_multiplier` | float | No |
| `CYCLES_RETRY_MAX_DELAY` | `retry_max_delay` | milliseconds (integer) | No |

::: tip Custom env var prefix
Unlike most clients in the corpus, the Rust client supports loading from a custom prefix. Useful when a single process runs multiple Cycles instances against different servers:

```rust
let primary  = CyclesConfig::from_env_with_prefix("CYCLES_PRIMARY_")?;
let staging  = CyclesConfig::from_env_with_prefix("CYCLES_STAGING_")?;
```

The default `from_env()` is equivalent to `from_env_with_prefix("CYCLES_")`.
:::

## Resolution order

For each Subject field, the request builder resolves values in this priority:

1. **Per-call value** — passed explicitly to the request builder (e.g. `Subject { tenant: Some("override".into()), .. }`)
2. **Config default** — set on the `CyclesConfig` / builder

If neither provides a value, the field is omitted from the request and the server applies its own defaults.

## Custom `reqwest::Client`

By default, the client creates its own `reqwest::Client` with the configured timeouts. Pass a custom one when you need shared connection pooling, custom middleware, TLS pinning, or proxy support:

```rust
use runcycles::CyclesClient;
use reqwest::Client;
use std::time::Duration;

let http = Client::builder()
    .pool_max_idle_per_host(20)
    .timeout(Duration::from_secs(10))
    .build()?;

let client = CyclesClient::builder(
    "cyc_live_...",
    "http://localhost:7878",
)
.http_client(http)  // overrides connect_timeout / read_timeout from config
.tenant("acme-corp")
.build();
```

When a custom `reqwest::Client` is provided, the config's `connect_timeout` and `read_timeout` are ignored — set them on the `reqwest::Client` instead.

## Blocking client variant

For applications running in synchronous contexts (CLI tools, sync HTTP frameworks like `rouille`, embedded scripts), the crate ships a blocking variant behind a feature flag.

```toml
# Cargo.toml
[dependencies]
runcycles = { version = "0.2", features = ["blocking"] }
```

```rust
use runcycles::{BlockingCyclesClient, CyclesConfig};

let client = BlockingCyclesClient::new(CyclesConfig::from_env()?);
let resp = client.get_balances(&BalanceParams {
    tenant: Some("acme-corp".into()),
    ..Default::default()
})?;
```

The blocking client mirrors the async client's surface but uses `reqwest::blocking::Client` underneath. The reserve-commit lifecycle, retry engine, and error types are identical; only the await points are removed.

::: warning Don't mix runtimes
The blocking client must not be called from inside a Tokio runtime (it will block the executor). For most applications using `tokio::main`, the async client is correct. The blocking variant is for genuinely synchronous contexts.
:::

## Disabling retry

```rust
let client = CyclesClient::builder("cyc_live_...", "http://localhost:7878")
    .retry_enabled(false)
    .build();
```

## Aggressive retry for critical commits

```rust
use std::time::Duration;

let client = CyclesClient::builder("cyc_live_...", "http://localhost:7878")
    .retry_max_attempts(10)
    .retry_initial_delay(Duration::from_millis(200))
    .retry_multiplier(1.5)
    .retry_max_delay(Duration::from_secs(60))
    .build();
```

## CyclesClientBuilder method reference

| Method | Sets | Notes |
|---|---|---|
| `new(api_key, base_url)` | required fields | The constructor; both args are `impl Into<String>` |
| `.tenant(s)` | subject default | All subject methods accept `impl Into<String>` |
| `.workspace(s)` | subject default | |
| `.app(s)` | subject default | |
| `.workflow(s)` | subject default | |
| `.agent(s)` | subject default | |
| `.toolset(s)` | subject default | |
| `.connect_timeout(d)` | HTTP | Takes `std::time::Duration` |
| `.read_timeout(d)` | HTTP | Takes `std::time::Duration` |
| `.retry_enabled(b)` | retry | Toggle the retry engine |
| `.retry_max_attempts(n)` | retry | |
| `.retry_initial_delay(d)` | retry | Takes `std::time::Duration` |
| `.retry_multiplier(f)` | retry | Takes `f64` |
| `.retry_max_delay(d)` | retry | Takes `std::time::Duration` |
| `.http_client(c)` | HTTP | Provide a custom `reqwest::Client`; overrides timeouts |
| `.build()` | finalizes | Returns `CyclesClient` (async) |
| `.build_blocking()` | finalizes | Returns `BlockingCyclesClient`; requires the `blocking` feature |

## Next steps

- [Rust Client Quickstart](/quickstart/getting-started-with-the-rust-client) — installation and first [reservation](/glossary#reservation)
- [Error Handling in Rust](/how-to/error-handling-patterns-in-rust) — retry, recovery, and [graceful degradation](/glossary#graceful-degradation)
- [Integrating Cycles with Rust](/how-to/integrating-cycles-with-rust) — multi-step flows, streaming, framework integration
- [Server Configuration Reference](/configuration/server-configuration-reference-for-cycles) — server-side properties
- [How Reserve-Commit Works](/protocol/how-reserve-commit-works-in-cycles) — the underlying lifecycle
