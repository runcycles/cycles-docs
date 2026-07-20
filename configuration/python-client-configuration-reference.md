---
title: "Python Client Configuration Reference"
description: "Complete reference for all configuration options in the runcycles Python client, including connection, retry, and timeout settings."
---

# Python Client Configuration Reference

This is the complete reference for all configuration options available in the `runcycles` Python client.

## CyclesConfig

All configuration is provided through the `CyclesConfig` dataclass.

### Required fields

| Field | Type | Description |
|---|---|---|
| `base_url` | `str` | Base URL of the Cycles server (e.g., `http://localhost:7878`) |
| `api_key` | `str` | API key for authentication |

### Subject defaults

These fields set default values for the Subject used in `@cycles` decorators. They apply to all decorated functions unless overridden at the decorator level.

| Field | Type | Default | Description |
|---|---|---|---|
| `tenant` | `str \| None` | `None` | Default tenant |
| `workspace` | `str \| None` | `None` | Default workspace |
| `app` | `str \| None` | `None` | Default application name |
| `workflow` | `str \| None` | `None` | Default workflow |
| `agent` | `str \| None` | `None` | Default agent |
| `toolset` | `str \| None` | `None` | Default toolset |

### HTTP timeouts

| Field | Type | Default | Description |
|---|---|---|---|
| `connect_timeout` | `float` | `2.0` | TCP connection timeout in seconds |
| `read_timeout` | `float` | `5.0` | Read timeout for responses in seconds |

### Retry configuration

Controls the commit retry engine for transient failures.

| Field | Type | Default | Description |
|---|---|---|---|
| `retry_enabled` | `bool` | `True` | Enable automatic commit retries |
| `retry_max_attempts` | `int` | `5` | Maximum number of retry attempts |
| `retry_initial_delay` | `float` | `0.5` | Delay before the first retry (seconds) |
| `retry_multiplier` | `float` | `2.0` | Backoff multiplier between retries |
| `retry_max_delay` | `float` | `30.0` | Maximum delay between retries (seconds) |

#### How retry works

When a commit fails with a transport error or 5xx response, the retry engine schedules a retry using exponential backoff:

```
Attempt 1: wait 0.5s
Attempt 2: wait 1.0s
Attempt 3: wait 2.0s
Attempt 4: wait 4.0s
Attempt 5: wait 8.0s (capped at max_delay)
```

Non-retryable errors (4xx responses) are not retried.

## Programmatic configuration

```python
from runcycles import CyclesConfig

config = CyclesConfig(
    # Required
    base_url="http://localhost:7878",
    api_key="cyc_live_...",

    # Subject defaults
    tenant="acme",
    workspace="production",
    app="support-bot",

    # HTTP settings
    connect_timeout=2.0,
    read_timeout=5.0,

    # Commit retry
    retry_enabled=True,
    retry_max_attempts=5,
    retry_initial_delay=0.5,
    retry_multiplier=2.0,
    retry_max_delay=30.0,
)
```

## Environment variable configuration

Use `CyclesConfig.from_env()` to load configuration from environment variables. The default prefix is `CYCLES_`:

```python
config = CyclesConfig.from_env()
```

| Environment variable | Maps to | Required |
|---|---|---|
| `CYCLES_BASE_URL` | `base_url` | Yes |
| `CYCLES_API_KEY` | `api_key` | Yes |
| `CYCLES_TENANT` | `tenant` | No |
| `CYCLES_WORKSPACE` | `workspace` | No |
| `CYCLES_APP` | `app` | No |
| `CYCLES_WORKFLOW` | `workflow` | No |
| `CYCLES_AGENT` | `agent` | No |
| `CYCLES_TOOLSET` | `toolset` | No |
| `CYCLES_CONNECT_TIMEOUT` | `connect_timeout` | No |
| `CYCLES_READ_TIMEOUT` | `read_timeout` | No |
| `CYCLES_RETRY_ENABLED` | `retry_enabled` | No |
| `CYCLES_RETRY_MAX_ATTEMPTS` | `retry_max_attempts` | No |
| `CYCLES_RETRY_INITIAL_DELAY` | `retry_initial_delay` | No |
| `CYCLES_RETRY_MULTIPLIER` | `retry_multiplier` | No |
| `CYCLES_RETRY_MAX_DELAY` | `retry_max_delay` | No |

A custom prefix can be passed: `CyclesConfig.from_env(prefix="MY_PREFIX_")`.

## `@cycles` decorator parameters

The `@cycles` decorator accepts parameters that control reservation behavior per-call. These are separate from the `CyclesConfig` connection settings above. For full documentation and examples, see [Getting Started with the Python Client — Decorator parameters](/quickstart/getting-started-with-the-python-client#decorator-parameters).

| Parameter | Type | Default | Description |
|---|---|---|---|
| `estimate` | `int \| Callable` | (required) | Estimated cost. Int constant or callable receiving the function's `*args, **kwargs`. |
| `actual` | `int \| Callable \| None` | `None` | Actual cost. Int constant or callable receiving the return value. Defaults to estimate. |
| `action_kind` | `str \| Callable[..., str \| None] \| None` | `None` | Action category (e.g. `"llm.completion"`). |
| `action_name` | `str \| Callable[..., str \| None] \| None` | `None` | Action identifier (e.g. `"gpt-4"`). |
| `action_tags` | `list[str] \| Callable[..., list[str] \| None] \| None` | `None` | Tags for filtering and reporting. |
| `unit` | `Unit \| str` | `USD_MICROCENTS` | Budget unit: `USD_MICROCENTS`, `TOKENS`, `CREDITS`, `RISK_POINTS`. |
| `ttl_ms` | `int` | `60000` | Reservation TTL in milliseconds (range: 1,000–86,400,000). |
| `grace_period_ms` | `int \| None` | `None` | Grace period after TTL expiry in milliseconds. When `None`, the server applies its default (5000ms). Valid range: 0–60,000. |
| `overage_policy` | `str` | `"ALLOW_IF_AVAILABLE"` | `"REJECT"`, `"ALLOW_IF_AVAILABLE"`, or `"ALLOW_WITH_OVERDRAFT"`. |
| `dry_run` | `bool` | `False` | If `True`, evaluate without persisting. Function does not execute. |
| `tenant` | `str \| Callable[..., str \| None] \| None` | `None` | Subject tenant override (takes precedence over config default). |
| `workspace` | `str \| Callable[..., str \| None] \| None` | `None` | Subject workspace override. |
| `app` | `str \| Callable[..., str \| None] \| None` | `None` | Subject app override. |
| `workflow` | `str \| Callable[..., str \| None] \| None` | `None` | Subject workflow override. |
| `agent` | `str \| Callable[..., str \| None] \| None` | `None` | Subject agent override. |
| `toolset` | `str \| Callable[..., str \| None] \| None` | `None` | Subject toolset override. |
| `dimensions` | `dict[str, str] \| Callable[..., dict[str, str] \| None] \| None` | `None` | Custom dimensions for the subject. |
| `client` | `CyclesClient \| AsyncCyclesClient \| None` | `None` | Explicit client. Falls back to module-level default. |
| `use_estimate_if_actual_not_provided` | `bool` | `True` | If `True` and `actual` is `None`, use estimate as actual at commit. |

### Callable resolution semantics

Subject fields, `action_kind`, `action_name`, `action_tags`, and `dimensions` accept a callable in place of a constant (since 0.4.0). The callable is resolved on every call, invoked with the decorated function's `*args, **kwargs` at reservation time. A `None` (or otherwise falsy) result falls through:

- **Subject fields** (`tenant`, `workspace`, `app`, `workflow`, `agent`, `toolset`) — fall back to the `CyclesConfig` default; omitted if that is also unset.
- **`action_kind` / `action_name`** — fall back to `"unknown"`.
- **`action_tags` / `dimensions`** — omitted from the request.

## Setting a default client

Instead of passing `client=` to every `@cycles` decorator, set a module-level default:

```python
from runcycles import CyclesClient, set_default_client, set_default_config

# Option 1: Set a config (client created lazily)
set_default_config(config)

# Option 2: Set an explicit client
set_default_client(CyclesClient(config))
```

## Resolution order

For each Subject field, the decorator resolves the value using this priority:

1. **Decorator parameter** — if set on the `@cycles` decorator, it wins. If the parameter is a callable, it is invoked with the function's `*args, **kwargs` on each call; a falsy result falls through to the next step.
2. **Config default** — if set on the `CyclesConfig` instance

If neither provides a value, the field is omitted from the request.

## Disabling retry

```python
config = CyclesConfig(
    base_url="http://localhost:7878",
    api_key="cyc_live_...",
    retry_enabled=False,
)
```

## Aggressive retry for critical commits

```python
config = CyclesConfig(
    base_url="http://localhost:7878",
    api_key="cyc_live_...",
    retry_max_attempts=10,
    retry_initial_delay=0.2,
    retry_multiplier=1.5,
    retry_max_delay=60.0,
)
```

## Next steps

- [Getting Started with the Python Client](/quickstart/getting-started-with-the-python-client) — quick start guide
- [Error Handling in Python](/how-to/error-handling-patterns-in-python) — exception handling patterns
- [Using the Client Programmatically](/how-to/using-the-cycles-client-programmatically) — direct client usage
- [Server Configuration Reference](/configuration/server-configuration-reference-for-cycles) — server-side properties
