---
title: "Client Performance Tuning"
description: "Tune timeouts, connection pooling, and retry strategies across Python, TypeScript, and Spring Boot Cycles clients for high-throughput workloads."
---

# Client Performance Tuning

The default client configuration works well for most workloads. This guide covers when and how to tune for high-throughput or latency-sensitive scenarios.

::: tip When to tune
Consider tuning when you observe any of these:
- Concurrent reservation count regularly exceeds 100
- Client-side p99 latency exceeds 50ms
- Commit retry rate exceeds 5%
- Connection timeout errors in client logs

For server-side benchmarks and baseline expectations, see the [Performance Benchmarks](/blog/cycles-server-performance-benchmarks) blog post.
:::

## Timeout tuning

All three clients configure two timeouts: connection (TCP handshake) and read (waiting for server response).

### Default values

| Setting | Python | TypeScript | Spring Boot |
|---|---|---|---|
| Connect timeout | `connect_timeout=2.0` (seconds) | `connectTimeout=2000` (ms) | `cycles.http.connect-timeout=2s` |
| Read timeout | `read_timeout=5.0` (seconds) | `readTimeout=5000` (ms) | `cycles.http.read-timeout=5s` |

::: info TypeScript timeout behavior
Node's built-in `fetch` does not distinguish connection from read timeout. `connectTimeout` and `readTimeout` are summed into a single `AbortSignal.timeout()` value (default: 7000ms total).
:::

### Tuning profiles

Choose a profile based on your deployment topology:

**Co-located (client and server on same network):**

```python
# Python
config = CyclesConfig(
    base_url="http://cycles-server:7878",
    api_key="cyc_live_...",
    connect_timeout=0.5,   # 500ms — same-network handshake is fast
    read_timeout=2.0,      # 2s — server p99 is <5ms, leave headroom
)
```

```typescript
// TypeScript
const config = new CyclesConfig({
  baseUrl: "http://cycles-server:7878",
  apiKey: "cyc_live_...",
  connectTimeout: 500,
  readTimeout: 2000,
});
```

```yaml
# Spring Boot
cycles:
  http:
    connect-timeout: 500ms
    read-timeout: 2s
```

**Cross-region or high-latency network:**

```python
# Python
config = CyclesConfig(
    base_url="https://cycles.us-east.example.com",
    api_key="cyc_live_...",
    connect_timeout=5.0,   # TLS handshake across regions
    read_timeout=15.0,     # account for network jitter
)
```

```yaml
# Spring Boot
cycles:
  http:
    connect-timeout: 5s
    read-timeout: 15s
```

**High-throughput with aggressive retry:**

```python
# Python — fail fast, retry quickly
config = CyclesConfig(
    base_url="http://cycles-server:7878",
    api_key="cyc_live_...",
    connect_timeout=1.0,
    read_timeout=3.0,
    retry_max_attempts=10,
    retry_initial_delay=0.1,
    retry_multiplier=1.5,
    retry_max_delay=5.0,
)
```

::: warning
Never set the read timeout below the server's expected p99 latency. At default load, the server's p99 for reserve+commit is ~20ms. Under heavy load it can reach 50ms+. A read timeout of 100ms will cause spurious failures.
:::

## Connection pooling

### Python (httpx)

The Python client uses `httpx.Client`, which manages a connection pool automatically. Key details:

- Connections are reused across requests (HTTP keep-alive)
- Pool timeout is hardcoded at 5 seconds (time to acquire a connection from the pool)
- Write timeout is hardcoded at 5 seconds
- httpx uses its default limits: 100 max connections, of which up to 20 are kept alive for reuse — with no per-host cap (all connections can go to the single Cycles server)

The constructor accepts only a `CyclesConfig` — there is no parameter for injecting a custom httpx transport or client, so the pool limits are not tunable per client. For most workloads, the defaults are sufficient. If you see `PoolTimeout` errors, you have more than 100 concurrent requests in flight on a single client instance. Solutions:

1. **Use multiple client instances** — partition by tenant or workload so each instance carries a share of the concurrency (each gets its own 100-connection pool).

2. **Bound your concurrency** — cap in-flight Cycles calls below the pool size (e.g. an `asyncio.Semaphore` around reservation calls, or a bounded worker pool).

### TypeScript (fetch)

The TypeScript client uses Node's built-in `fetch`, which relies on the runtime's HTTP agent for connection reuse:

- Node.js 20+ reuses connections automatically via its global `undici` agent
- No explicit pool configuration is exposed
- Keep-alive is enabled by default

For high-throughput Node.js services, ensure you're running Node 20+ where `fetch` connection reuse is reliable.

### Spring Boot (Reactor Netty)

The Spring Boot starter uses `WebClient` backed by Reactor Netty's `HttpClient`. Reactor Netty manages its own connection pool:

- Default pool: Reactor Netty's shared global pool — max connections is `2 × max(available processors, 8)` (so 16 on small hosts), with no idle timeout by default
- The 45-second default is the **pending-acquire timeout**: how long a request waits to acquire a connection from the pool before failing, not an idle timeout
- Configure via Reactor Netty system properties (`reactor.netty.pool.maxConnections`, `reactor.netty.pool.acquireTimeout`) or provide a custom `WebClient` bean

To customize the connection pool:

```java
@Bean
public WebClient cyclesWebClient(CyclesProperties props) {
    ConnectionProvider provider = ConnectionProvider.builder("cycles")
        .maxConnections(200)
        .pendingAcquireTimeout(Duration.ofSeconds(10))  // default: 45s
        .maxIdleTime(Duration.ofSeconds(30))
        .build();

    HttpClient httpClient = HttpClient.create(provider)
        .option(ChannelOption.CONNECT_TIMEOUT_MILLIS,
            (int) props.getHttp().getConnectTimeout().toMillis())
        .responseTimeout(props.getHttp().getReadTimeout());

    return WebClient.builder()
        .clientConnector(new ReactorClientHttpConnector(httpClient))
        .baseUrl(props.getBaseUrl())
        .defaultHeader("X-Cycles-API-Key", props.getApiKey())
        .build();
}
```

## Retry strategy tuning

The commit retry engine handles transient failures (network errors, 5xx responses) with exponential backoff. Two common profiles:

### Fast-fail (latency-sensitive paths)

Fail quickly so the caller can degrade. Use when the user is waiting for a response.

| Setting | Python | TypeScript | Spring Boot |
|---|---|---|---|
| Max attempts | `retry_max_attempts=2` | `retryMaxAttempts: 2` | `cycles.retry.max-attempts=2` |
| Initial delay | `retry_initial_delay=0.1` | `retryInitialDelay: 100` | `cycles.retry.initial-delay=100ms` |
| Multiplier | `retry_multiplier=1.5` | `retryMultiplier: 1.5` | `cycles.retry.multiplier=1.5` |
| Max delay | `retry_max_delay=1.0` | `retryMaxDelay: 1000` | `cycles.retry.max-delay=1s` |
| Total worst-case | ~250ms | ~250ms | ~250ms |

### Durable (must-commit workloads)

Retry aggressively because the action already happened and the ledger must reflect it.

| Setting | Python | TypeScript | Spring Boot |
|---|---|---|---|
| Max attempts | `retry_max_attempts=10` | `retryMaxAttempts: 10` | `cycles.retry.max-attempts=10` |
| Initial delay | `retry_initial_delay=0.2` | `retryInitialDelay: 200` | `cycles.retry.initial-delay=200ms` |
| Multiplier | `retry_multiplier=1.5` | `retryMultiplier: 1.5` | `cycles.retry.multiplier=1.5` |
| Max delay | `retry_max_delay=60.0` | `retryMaxDelay: 60000` | `cycles.retry.max-delay=60s` |
| Total worst-case | ~2 minutes | ~2 minutes | ~2 minutes |

### When to disable retry

```python
config = CyclesConfig(base_url="...", api_key="...", retry_enabled=False)
```

Disable retry when:
- You handle retries at a higher level (e.g. job queue with built-in retry)
- You need deterministic latency with no background work
- Testing, where retry masks failures

## Anti-patterns

### Creating a new client per request

Every `CyclesClient` instance creates a new HTTP connection pool. Creating one per request wastes connections and prevents reuse.

```python
# BAD — new client (and connection pool) for every call
@cycles(estimate=1000, client=CyclesClient(config))
def process(text: str) -> str:
    return call_llm(text)
```

```python
# GOOD — reuse a single client via module default
client = CyclesClient(config)
set_default_client(client)

@cycles(estimate=1000)
def process(text: str) -> str:
    return call_llm(text)
```

The same applies in TypeScript (`setDefaultClient`) and Spring Boot (the auto-configured `CyclesClient` bean is a singleton).

### Expensive estimate computations in the hot path

The estimate callable runs synchronously before each reservation. Keep it fast:

```python
# BAD — network call in the estimate
@cycles(estimate=lambda text: fetch_token_count_from_api(text))
def process(text: str) -> str:
    return call_llm(text)
```

```python
# GOOD — pre-compute or use a fast heuristic
@cycles(estimate=lambda text: len(text) // 4)  # ~4 characters per token
def process(text: str) -> str:
    return call_llm(text)
```

## High-throughput checklist

1. **Reuse a single client instance** across all requests (all 3 clients)
2. **Warm up on startup** — make a lightweight call through the client so its connection pool is established before real traffic arrives:
   ```python
   client = CyclesClient(config)
   client.get_balances(tenant="my-tenant")  # any cheap read warms the pool
   ```
   To check server availability without an API key, use the public readiness probe (`GET /actuator/health/readiness`). Note that the aggregate `/actuator/health` and other actuator endpoints require the admin key since server 0.1.25.45 — only the liveness and readiness probes are public.
3. **Graceful shutdown** — commit or release active reservations before process exit
4. **Pre-compute estimates** outside the decorator/HOF hot path
5. **Lower timeouts** if co-located, raise if cross-region
6. **Use durable retry** for must-commit workloads
7. **Monitor** retry rates and timeout errors — rising rates signal infrastructure issues

## Server-side tuning

For server-side performance:

- **Redis connection pool** — default 128 connections. See [Production Operations Guide](/how-to/production-operations-guide).
- **Expiry sweep interval** — default 5000ms. See [Server Configuration Reference](/configuration/server-configuration-reference-for-cycles).
- **Benchmarks** — Reserve 5.3ms p50, 2,632 reserve+commit lifecycles/sec at 32 threads. See [Performance Benchmarks](/blog/cycles-server-performance-benchmarks).

## Next steps

- [Production Operations Guide](/how-to/production-operations-guide) — server infrastructure and Redis tuning
- [Monitoring and Alerting](/how-to/monitoring-and-alerting) — metrics and alerting setup
- [Observability Setup](/how-to/observability-setup) — Prometheus, Grafana, and Datadog integration
- [Python Client Configuration](/configuration/python-client-configuration-reference) — all Python config options
- [TypeScript Client Configuration](/configuration/typescript-client-configuration-reference) — all TypeScript config options
- [Spring Client Configuration](/configuration/client-configuration-reference-for-cycles-spring-boot-starter) — all Spring Boot config options
