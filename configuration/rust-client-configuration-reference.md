---
title: "Rust Client Configuration Reference"
description: "Complete reference for the runcycles Rust client: CyclesConfig fields, environment variables, builder API, retry tuning, blocking variant, custom HTTP client."
head:
  - - meta
    - name: keywords
      content: "rust client configuration, runcycles config, cycles rust env vars, rust client builder, rust async client config, cycles rust retry tuning, rust blocking client"
---

# Rust Client Configuration Reference

Complete reference for all configuration options in the `runcycles` Rust client. Targets `runcycles >= 0.3.2`. The async client is the default; the blocking variant is available behind a feature flag.

For the introductory walkthrough, see the [Rust Client Quickstart](/quickstart/getting-started-with-the-rust-client). For runtime error patterns, see [Error Handling in Rust](/how-to/error-handling-patterns-in-rust).

## CyclesConfig

The `CyclesConfig` struct holds all client configuration. It can be constructed via the builder API (recommended), via `CyclesConfig::from_env()`, or by populating the struct fields directly.

### Required fields

| Field | Type | Description |
|---|---|---|
| `base_url` | `String` | Base URL of the [Cycles server](/glossary#cycles-server) (e.g. `http://localhost:7878`) |
| `api_key` | `String` | API key for authentication. [Tenant](/glossary#tenant)-scoped key starting with `cyc_live_` |

### Subject defaults

These fields hold subject values that are stored on the config and available via `client.config()`. **They are not auto-applied to per-request subjects in 0.3.x** — see [Subject defaults: what they do (and don't)](#subject-defaults-what-they-do-and-don-t) below for the actual behavior.

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

`ReservationGuard::commit()` retries transient failures inline and reuses the original `CommitRequest` and idempotency key. HTTP 429 honors `Retry-After`. The heartbeat remains active while inline retries run.

| Field | Type | Default | Description |
|---|---|---|---|
| `retry_enabled` | `bool` | `true` | Enable automatic commit retries |
| `retry_max_attempts` | `u32` | `5` | Maximum retry attempts after the initial commit attempt |
| `retry_initial_delay` | `Duration` | `500 ms` | Delay before the first retry |
| `retry_multiplier` | `f64` | `2.0` | Exponential backoff multiplier between retries |
| `retry_max_delay` | `Duration` | `30_000 ms` | Maximum delay between retries |

Known actual usage is durably journaled before the first commit request. If the retry schedule is exhausted, authentication fails, or a client response remains ambiguous, `commit()` returns `Error::CommitPending` and leaves the record queued for same-key replay. Do not compensate with a different key.

### Durable journal

| Field | Type | Default | Description |
|---|---|---|---|
| `journal_enabled` | `bool` | `true` | Persist unresolved known-actual settlement across process restarts |
| `journal_dir` | `Option<PathBuf>` | `None` | Journal base directory; `None` uses `~/.runcycles/commit-journal` |

Only a schema-valid HTTP `200` commit or schema-valid HTTP `201` event proves success. If commit returns HTTP 410 or `RESERVATION_EXPIRED`, the guard switches the journal to event mode before calling `POST /v1/events` with the original key. Unresolved records replay automatically when a client is created inside a Tokio runtime.

Use `flush_pending_commits_with_timeout(...)` for a bounded startup or graceful-shutdown drain. The blocking client exposes the same operation. Timed-out or failed records remain on disk.

The journal is partitioned by server and principal. Configure `tenant` so pending records remain discoverable after API-key rotation. API keys are not stored in records, but settlement bodies and metadata are; protect the directory as sensitive application state.

## Programmatic configuration

The builder API is the recommended way to construct a client. It exposes connection settings, subject defaults, and every commit-retry setting.

```rust
use runcycles::CyclesClient;
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
.journal_enabled(true)
.journal_dir("/var/lib/my-app/cycles-commit-journal")
.build();
```

You can also construct `CyclesConfig` directly:

```rust
use runcycles::{CyclesClient, CyclesConfig};
use std::time::Duration;

let config = CyclesConfig {
    base_url: "http://localhost:7878".into(),
    api_key: "cyc_live_...".into(),
    tenant: Some("acme-corp".into()),
    workspace: None,
    app: None,
    workflow: None,
    agent: None,
    toolset: None,
    connect_timeout: Duration::from_millis(2_000),
    read_timeout: Duration::from_millis(5_000),
    retry_enabled: true,
    retry_max_attempts: 5,
    retry_initial_delay: Duration::from_millis(500),
    retry_multiplier: 2.0,
    retry_max_delay: Duration::from_secs(30),
    journal_enabled: true,
    journal_dir: None,
};

let client = CyclesClient::new(config);
```

`CyclesConfig` does not implement `Default`; populate every field explicitly when constructing the struct directly, or use the builder.

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
| `CYCLES_JOURNAL_ENABLED` | `journal_enabled` | `true` / `false` | No |
| `CYCLES_JOURNAL_DIR` | `journal_dir` | filesystem path | No |

::: tip Custom env var prefix
The Rust client supports loading from a custom prefix, which is useful when a single process holds connections to multiple Cycles instances:

```rust
let primary  = CyclesConfig::from_env_with_prefix("CYCLES_PRIMARY_")?;
let staging  = CyclesConfig::from_env_with_prefix("CYCLES_STAGING_")?;
```

The default `from_env()` is equivalent to `from_env_with_prefix("CYCLES_")`.
:::

## Subject defaults: what they do (and don't)

The subject fields on `CyclesConfig` (`tenant`, `workspace`, `app`, `workflow`, `agent`, `toolset`) are stored on the config and accessible via `client.config()`, but the high-level helpers in `runcycles` 0.3.x **do not automatically apply them** to the per-request `Subject`. Each `with_cycles()` / `client.reserve()` / `client.create_reservation()` call uses the `Subject` you pass in explicitly (or `Subject::default()` if you pass none).

If you want a single tenant applied to every request, build the subject once and reuse it:

```rust
use runcycles::models::Subject;

let subject = Subject {
    tenant: Some("acme-corp".into()),
    workspace: Some("production".into()),
    ..Default::default()
};

// Pass the same subject to every WithCyclesConfig / ReservationCreateRequest
let cfg = WithCyclesConfig::new(Amount::tokens(1_000))
    .action("llm.completion", "gpt-4o-mini")
    .subject(subject.clone());
```

Future versions of the crate may wire the config's subject defaults into request subjects automatically; this reference will be updated when that lands.

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
runcycles = { version = "0.3", features = ["blocking"] }
```

```rust
use runcycles::{BlockingCyclesClient, CyclesConfig, models::BalanceParams};

let client = BlockingCyclesClient::new(CyclesConfig::from_env()?)?;
let resp = client.get_balances(&BalanceParams {
    tenant: Some("acme-corp".into()),
    ..Default::default()
})?;
```

The blocking client exposes the low-level protocol methods — `create_reservation`, `create_reservation_with_metadata`, `commit_reservation`, `release_reservation`, `extend_reservation`, `decide`, `create_event`, `list_reservations`, `get_reservation`, `get_balances` — plus `config()` and pending-journal flush operations. The high-level `with_cycles()` helper and `ReservationGuard` RAII pattern are async-only in 0.3.x; blocking callers compose the reserve / commit / release sequence and must persist their application-owned settlement requests themselves.

::: warning Don't mix runtimes
The blocking client must not be called from inside a Tokio runtime (it will block the executor). For most applications using `tokio::main`, the async client is correct. The blocking variant is for genuinely synchronous contexts.
:::

## CyclesClientBuilder method reference

| Method | Sets | Notes |
|---|---|---|
| `new(api_key, base_url)` | required fields | The constructor; both args are `impl Into<String>` |
| `.tenant(s)` | config subject default | All subject methods accept `impl Into<String>`. Stored on the config but not auto-applied to request subjects — see [Subject defaults](#subject-defaults-what-they-do-and-don-t). |
| `.workspace(s)` | config subject default | |
| `.app(s)` | config subject default | |
| `.workflow(s)` | config subject default | |
| `.agent(s)` | config subject default | |
| `.toolset(s)` | config subject default | |
| `.connect_timeout(d)` | HTTP | Takes `std::time::Duration` |
| `.read_timeout(d)` | HTTP | Takes `std::time::Duration` |
| `.retry_enabled(b)` | commit retry | Enables or disables inline commit retry |
| `.retry_max_attempts(n)` | commit retry | Sets retry attempts after the initial commit attempt |
| `.retry_initial_delay(d)` | commit retry | Sets the delay before the first retry |
| `.retry_multiplier(n)` | commit retry | Sets the exponential backoff multiplier |
| `.retry_max_delay(d)` | commit retry | Caps the delay between retries |
| `.journal_enabled(b)` | durability | Enables or disables the pending-settlement journal |
| `.journal_dir(path)` | durability | Sets the journal base directory |
| `.http_client(c)` | HTTP | Provide a custom `reqwest::Client`; overrides timeouts |
| `.build()` | finalizes | Returns `CyclesClient` (async) |
| `.build_blocking()` | finalizes | Returns `Result<BlockingCyclesClient, Error>`; requires the `blocking` feature |

## Next steps

- [Rust Client Quickstart](/quickstart/getting-started-with-the-rust-client) — installation and first [reservation](/glossary#reservation)
- [Error Handling in Rust](/how-to/error-handling-patterns-in-rust) — retry, recovery, and [graceful degradation](/glossary#graceful-degradation)
- [Integrating Cycles with Rust](/how-to/integrating-cycles-with-rust) — multi-step flows, streaming, framework integration
- [SDK Settlement Recovery and Durability](/protocol/sdk-settlement-recovery-and-durability) — journal, replay, expiry fallback, and guarantee boundary
- [Server Configuration Reference](/configuration/server-configuration-reference-for-cycles) — server-side properties
- [How Reserve-Commit Works](/protocol/how-reserve-commit-works-in-cycles) — the underlying lifecycle
