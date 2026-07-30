---
title: "Cycles Budget Enforcement Benchmarks"
date: 2026-04-04
author: Cycles Team
tags: [engineering, performance, benchmarks, scaling, latency, throughput, redis]
description: "Review published Cycles budget-enforcement benchmarks across operations, including latency, throughput, concurrency, and the methodology behind each result."
blog: true
sidebar: false
head:
  - - meta
    - name: keywords
      content: "ai agent performance, budget enforcement latency, cycles protocol benchmarks, redis lua performance, agent cost control overhead, reserve commit latency, ai agent throughput, cycles server scaling"
---

# AI Agent Budget Enforcement Latency: Cycles Server Performance Benchmarks

The first question teams ask when evaluating runtime budget enforcement for AI agents: **how much latency does this add?** Budget enforcement sits in the critical path of every agent action. If it's slow, agents are slow. If it doesn't scale, your system doesn't scale.

We benchmarked every protocol operation end-to-end and under concurrent load. Here are the numbers.

<!-- more -->

## The Setup

All benchmarks measure **full HTTP round-trip latency** — not just Redis time, but the entire stack:

```
HTTP request → Spring Boot routing → Auth filter (API key validation)
→ JSON deserialization → Redis EVALSHA (atomic Lua script)
→ Response serialization → HTTP response
```

**Benchmark environment:** Cycles Server **v0.1.25.3**, Spring Boot 3.5, Java 21, Redis 7 in Testcontainers, AMD Ryzen Threadripper 3990X 64-Core, and localhost networking. The run used 200 measured iterations per operation after 50 warmup iterations for JIT, connection-pool, and script-cache priming. These are historical measurements on this setup, not current-release or production-latency guarantees. Network topology, Redis placement, contention, and hardware can move results in either direction.

## Write-Path Latency

| Operation           |  p50   |  p95   |  p99   |  min   |  max   |
|---------------------|--------|--------|--------|--------|--------|
| **Reserve**         |  6.2ms |  7.3ms |  7.9ms |  4.6ms | 16.3ms |
| **Commit**          |  4.1ms |  5.2ms |  5.7ms |  3.1ms |  6.3ms |
| **Release**         |  4.8ms |  6.1ms |  6.5ms |  3.2ms |  6.9ms |
| **Extend**          |  7.4ms |  9.2ms | 10.2ms |  5.4ms | 19.3ms |
| **Decide**          |  5.5ms |  6.7ms |  7.0ms |  3.8ms | 20.5ms |
| **Event**           |  5.2ms |  6.2ms |  6.9ms |  3.3ms |  8.4ms |

### What these numbers mean for your agents

**The reserve-commit lifecycle** (the most common pattern) takes about **15ms end-to-end** — 6.2ms to reserve budget before the LLM call, 4.1ms to commit actual usage after:

| Lifecycle           |  p50    |  p95    |  p99    |
|---------------------|---------|---------|---------|
| Reserve + Commit    |  14.9ms |  17.5ms |  18.4ms |
| Reserve + Release   |  11.4ms |  15.5ms |  16.7ms |

For context, an external LLM call can take much longer than the 14.9ms p50 lifecycle measured here, depending on model, output size, network, and provider load. Measure the relative overhead in your own deployment rather than assuming this benchmark's ratio.

If you just need a quick budget check without reserving (e.g., pre-flight check in a UI), **Decide** gives you a yes/no answer in ~5.5ms.

**Events** (direct debit without [reservation](/glossary#reservation)) are 5.2ms p50 — useful for logging post-hoc usage where you don't need the reserve-commit guarantee.

## Read-Path Latency

Read operations are the fastest — no Lua script overhead, just direct Redis hash reads with pipelined multi-scope queries:

| Operation              |  p50   |  p95   |  p99   |  min   |  max   |
|------------------------|--------|--------|--------|--------|--------|
| **GET reservation**    |  2.8ms |  3.6ms |  4.0ms |  2.0ms |  5.3ms |
| **GET balances**       |  2.9ms |  3.7ms |  3.9ms |  2.1ms |  4.0ms |
| **LIST reservations**  |  3.3ms |  4.6ms |  5.2ms |  2.3ms |  5.9ms |
| **Decide (pipelined)** |  3.5ms |  4.5ms |  5.7ms |  2.8ms |  6.9ms |

Fetching a single reservation or checking balances takes just **2.8-2.9ms** — fast enough to call on every page load or agent step without concern. Listing reservations with filters adds less than 1ms more due to SCAN iteration.

The pipelined Decide path (3.5ms) is faster than the write-path Decide (5.5ms) because the read pipeline batches all scope lookups into a single Redis round-trip instead of executing them inside a Lua script.

### Why Extend is slower

Extend (7.4ms) is the slowest single operation because it does the most work atomically inside Redis: read reservation state, validate expiration and extension limits, update TTL, update the sorted set index, read scope hierarchy, and snapshot balances across all affected budgets. All in one atomic Lua script — no round-trips, but more Redis commands per execution.

## Concurrent Throughput

Single-threaded latency doesn't tell you how the system behaves when 32 agents hit it simultaneously. We ran reserve-commit lifecycles at increasing concurrency:

| Threads | Throughput    |  p50    |  p95    |  p99    |  max    | Errors |
|---------|---------------|---------|---------|---------|---------|--------|
|       8 |    816 op/s   |   9.6ms |  11.6ms |  21.0ms |  24.5ms |      0 |
|      16 |  1,162 op/s   |  13.7ms |  19.2ms |  22.4ms |  28.7ms |      0 |
|      32 |  2,873 op/s   |  10.8ms |  15.1ms |  19.3ms |  43.1ms |      0 |

### Key observations

**Measured concurrency scaling.** Throughput increased 3.5x when the test moved from 8 to 32 threads. Three concurrency points are not enough to establish a general scaling curve or saturation limit.

**Zero errors under load.** No budget violations, no connection pool exhaustion, no timeouts at any concurrency level. Zero errors across all 5 benchmarked versions, at every concurrency level.

**Measured tail latency.** The 32-thread run measured 19.3ms p99. Whether that is acceptable depends on the protected operation and the caller's latency objective.

**2,873 complete lifecycles per second** at 32 threads means each thread completes a full reserve-commit cycle (two HTTP calls, two Lua script executions, two auth checks) in ~11ms average.

## Reserve Fan-Out: 1 to 200 Clients

The server's v0.1.25.59 benchmark suite measures reserve-only latency at 1, 10,
50, and 200 simultaneous clients. We ran every table cell in three separate
Maven, Spring, and Testcontainers processes on the same Threadripper reference
host described above, with Java 21, Spring Boot 3.5.16, Redis 7 Alpine,
Docker Desktop 29.6.1, and localhost networking.

Each trial performs at least 50 warmup requests and reaches every logical
client, with warmup concurrency capped at 50. It then resets the Redis ledger
before a five-second measured window. Isolating every cell this way prevents a
low-concurrency result from warming the next level and keeps the comparison
independent of test-suite order.

| Clients | Budget shape | Reserve p99 median (range) | Throughput median (range) | Errors | Ledger mismatches |
|---:|---|---:|---:|---:|---:|
| 1 | Shared tenant budget | 32.4ms (30.8–34.5ms) | 49.6 reserves/s (46.6–58.0) | 0 | 0 |
| 1 | Independent agent leaf budgets | 32.8ms (26.4–40.7ms) | 56.2 reserves/s (52.0–60.4) | 0 | 0 |
| 10 | Shared tenant budget | 40.6ms (40.1–46.4ms) | 430.0 reserves/s (424.8–435.8) | 0 | 0 |
| 10 | Independent agent leaf budgets | 42.6ms (37.9–43.2ms) | 426.0 reserves/s (426.0–434.6) | 0 | 0 |
| 50 | Shared tenant budget | 113.8ms (100.1–126.5ms) | 998.8 reserves/s (994.8–1,022.4) | 0 | 0 |
| 50 | Independent agent leaf budgets | 117.0ms (115.4–165.6ms) | 986.0 reserves/s (817.6–990.6) | 0 | 0 |
| 200 | Shared tenant budget | 1,325.9ms (1,131.0–1,738.1ms) | 927.8 reserves/s (886.8–954.2) | 0 | 0 |
| 200 | Independent agent leaf budgets | 929.1ms (651.8–1,040.6ms) | 833.0 reserves/s (832.6–864.6) | 0 | 0 |

The shared shape sends every client through one tenant ledger. The isolated
shape removes that parent budget and assigns each client an independent
agent-level leaf ledger. Across all 24 measured windows, 70,046 successful
reservations completed with zero request errors and zero mismatches between
successful responses and Redis `reserved` totals.

At 1 and 10 clients, shared-ledger p99 remained 32–41ms in this fresh-process
test. At 50 clients it reached 114ms. At 200 clients, both shapes saturated the
single application instance and its HTTP/Redis capacity; the shared atomic
ledger raised median p99 from 929ms to 1.326s, but it was not the only source
of queueing.

These are burst-saturation measurements, not typical per-action latency or a
latency SLO. The previous 532ms homepage figure is superseded: review found
that its 200-client cell inherited warm state from preceding suite tests and
used sequential warmups that did not control wide-fan-out connection state.
Deployment topology, server replicas, client pooling, and Redis placement can
materially change the result; rerun the suite in the target environment.

## Runaway Agent Demo: v0.1.23 vs v0.1.24

Synthetic benchmarks show per-operation overhead. But what does budget enforcement look like when a real agent runs away? We ran the same demo against both v0.1.23.3 and v0.1.24.1 — an agent making LLM calls in a tight loop, first unguarded (no budget), then guarded (with a $1.00 budget).

| Metric               | v0.1.23.3 | v0.1.24.1 | Notes              |
|-----------------------|-----------|-----------|---------------------|
| **Unguarded calls**   | 595       | 597       | Same (~600)         |
| **Unguarded spend**   | $5.95     | $5.97     | Same (~$6)          |
| **Unguarded duration**| 30.1s     | 30.1s     | Identical           |
| **Guarded calls**     | 100       | 100       | Identical           |
| **Guarded spend**     | $1.0000   | $1.0000   | Identical           |
| **Guarded duration**  | 67.8s     | 7.5s      | **9x faster**       |
| **Budget stop**       | 409 BUDGET_EXCEEDED | 409 BUDGET_EXCEEDED | Identical behavior |

The two unguarded baselines were close: 595 versus 597 calls and 30.1 seconds in both runs. That is a useful check on this demo, not proof that all environmental variables were controlled.

With budget enforcement enabled, both observed runs stopped at 100 calls and $1.00 of modeled spend. The measured guarded duration was 7.5 seconds on v0.1.24.1 versus 67.8 seconds on v0.1.23.3, about a **9x improvement** in this demo.

The v0.1.24 release included BCrypt caching, EVALSHA pipelining, and in-Lua balance snapshots. The before/after demo is consistent with those changes reducing overhead, but it does not isolate each optimization's contribution. The guarded v0.1.24 run finishes sooner than the unguarded run because it stops after 100 rather than roughly 600 calls; the enforcement overhead itself is still measurable.

## Performance Across Versions

We track benchmarks across every release. Here's how the key metrics have trended from v0.1.24.0 through v0.1.25.3 — five versions over two weeks:

| Version | Reserve+Commit p50 | Throughput (32 threads) | Read p50 (GET balances) | Errors |
|---|---|---|---|---|
| v0.1.24.0 | 12.9ms | 2,555 op/s | 2.8ms | 0 |
| v0.1.24.2 | 12.9ms | 2,737 op/s | 2.1ms | 0 |
| v0.1.24.3 | 14.3ms | 2,534 op/s | 2.1ms | 0 |
| v0.1.25.1 | 16.0ms | 2,584 op/s | 4.1ms | 0 |
| **v0.1.25.3** | **14.9ms** | **2,873 op/s** | **2.9ms** | **0** |

**What this shows:**

- **Observed p50 range.** Reserve-plus-commit p50 stayed between 12.9ms and 16.0ms across these runs. The table alone cannot distinguish environmental noise from code-level effects.
- **Observed throughput range.** The 32-thread measurements ranged from 2,534 to 2,873 operations per second; v0.1.25.3 was the highest of the five recorded runs.
- **No large regression is visible in this sample.** The releases added asynchronous event-emission and retention features while remaining within the measured ranges. A controlled A/B test would be needed to attribute overhead, or its absence, to an individual feature.
- **Zero errors across every version, at every concurrency level.** No budget violations, no connection pool exhaustion, no timeouts.

For full per-version benchmark data and analysis, see [`BENCHMARKS.md`](https://github.com/runcycles/cycles-server/blob/main/BENCHMARKS.md) in the server repository.

## What's in the critical path

Every operation goes through these layers, and we optimized each one:

### Auth: BCrypt caching

API key validation uses BCrypt, which is intentionally slow (~100ms). We cache validation results in-memory (SHA-256 of key → result, 60s TTL), so BCrypt runs once per key per minute. Every request after the first is a hash lookup.

### Redis: EVALSHA + atomic Lua

All mutations are atomic Lua scripts executed via `EVALSHA` (sends a 40-character SHA1 hash instead of the full script text). No multi-step Redis transactions, no optimistic locking, no retries. One network round-trip, one atomic execution.

### Balance snapshots: zero extra round-trips

Every mutation response includes current balance snapshots for all affected scopes. These are collected **inside** the Lua script after mutations complete — no separate Java-side Redis calls. This is what gives you the `balances` array in every response without additional latency.

### Tenant config: in-memory cache

[Tenant](/glossary#tenant) configuration (default TTLs, overage policies, extension limits) is cached in-memory with a 60s TTL. Config changes propagate within a minute without restart.

### Event emission: async and off the hot path

As of the current v0.1.25 runtime, a DENY from a dry-run reservation or `/v1/decide`, plus each commit overage, queues an event; live reservation exceptions do not emit `reservation.denied`. `EventEmitterService` uses a dedicated bounded `ThreadPoolExecutor`, so emission does not wait on Redis, but an event can be dropped and logged if the queue is saturated. Redis commands for event storage and subscription lookup are pipelined. The runtime balance events (`budget.exhausted`, `budget.over_limit_entered`, `budget.debt_incurred`) inspect the balance list returned by the Lua operation without an extra balance read.

## How we measure

Our benchmarks run as JUnit integration tests against a real Redis instance (Testcontainers). No mocks, no stubs, no synthetic loads — the same code path as production.

```bash
# Run benchmarks (requires Docker)
mvn test -Pbenchmark

# Run everything except benchmarks (default build)
mvn verify
```

Benchmarks are excluded from the default build so they don't slow down CI. The test harness warms up the JIT compiler, connection pool, and EVALSHA script cache before measuring — just like a production server that's been running for more than a few seconds.

Source: [`CyclesProtocolBenchmarkTest`](https://github.com/runcycles/cycles-server/blob/main/cycles-protocol-service/cycles-protocol-service-api/src/test/java/io/runcycles/protocol/api/CyclesProtocolBenchmarkTest.java), [`CyclesProtocolConcurrentBenchmarkTest`](https://github.com/runcycles/cycles-server/blob/main/cycles-protocol-service/cycles-protocol-service-api/src/test/java/io/runcycles/protocol/api/CyclesProtocolConcurrentBenchmarkTest.java), and [`CyclesProtocolReadBenchmarkTest`](https://github.com/runcycles/cycles-server/blob/main/cycles-protocol-service/cycles-protocol-service-api/src/test/java/io/runcycles/protocol/api/CyclesProtocolReadBenchmarkTest.java).

## The bottom line

In this v0.1.25.3 benchmark, write-operation p50 values were **4.1-7.4ms**, read-operation p50 values were **2.8-3.5ms**, and a full reserve-commit lifecycle measured **14.9ms p50**. The 32-thread test measured **2,873 complete lifecycles per second** with zero errors during the run. These figures describe the benchmark, not an SLO for later releases or other environments.

Whether the overhead is material depends on workload latency and deployment topology. The separate runaway-agent demo shows the behavioral value of a hard budget boundary; it should not be treated as a general performance comparison.

## FAQ

### How much latency does Cycles add to LLM calls?

The v0.1.25.3 benchmark measured a full reserve-commit lifecycle at 14.9ms p50. Relative overhead depends on the protected operation: 15ms is about 3% of a 500ms call, and a larger share of shorter tool calls. The same benchmark measured read-query p50 values between 2.8ms and 3.5ms. Re-run the suite against your release and infrastructure before setting latency objectives.

### Does Cycles scale horizontally?

The [Cycles server](/glossary#cycles-server) keeps ledger state in Redis, so multiple application instances can share a supported Redis deployment behind a load balancer. This benchmark covered one server instance and standalone Redis; it does not establish Redis Cluster compatibility or multi-instance scaling behavior.

### What happens if the Cycles server is slow or unavailable?

The protocol is designed for the [reserve-commit pattern](/protocol/how-reserve-commit-works-in-cycles). If a reserve call is slow, the agent waits before making the LLM call (fail-safe). If the server is unavailable, the reserve fails and the agent doesn't proceed — preventing uncontrolled spend. Commits and events can be retried with [idempotency keys](/glossary#idempotency-key). Read-only endpoints (balance checks, reservation lookups) are the fastest at 2.8-3.5ms and can be used for status dashboards without concern.

### How does this compare to LLM proxy approaches?

LLM proxies add latency on every token streamed. Cycles operates at the action level — one reserve before the call, one commit after — so latency scales with the number of agent actions, not the number of [tokens](/glossary#tokens). For a 10,000-token completion, a proxy adds overhead to every chunk; Cycles adds two calls totaling ~15ms.

---

*Questions about performance in your specific deployment? Check the [server configuration reference](/configuration/server-configuration-reference-for-cycles).*

## Related how-to guides

- [Webhook integrations](/how-to/webhook-integrations)
- [API key management](/how-to/api-key-management-in-cycles)
- [Using the Cycles dashboard](/how-to/using-the-cycles-dashboard)
