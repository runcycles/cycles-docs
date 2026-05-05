---
title: "AI Agent Budget Enforcement Latency: Cycles Server Performance Benchmarks"
date: 2026-04-04
author: Cycles Team
tags: [engineering, performance, benchmarks, scaling, latency, throughput, redis]
description: "How much latency does AI agent budget enforcement add? Published p50/p95/p99 benchmarks for every Cycles operation — 2,870+ ops/sec at 32 threads, zero errors across five versions."
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

**Environment:** Spring Boot 3.5 / Java 21 / Redis 7 (Testcontainers), AMD Ryzen Threadripper 3990X 64-Core, localhost networking. Production with dedicated Redis will be faster. 200 measured iterations per operation after 50 warmup iterations (JIT, connection pool, script cache primed). Numbers below reflect **v0.1.25.3** (latest). See [version history](#performance-across-versions) for trends.

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

For context, a typical LLM API call takes 500ms-30s depending on the model and token count. **Budget enforcement adds ~15ms to a multi-second operation** — less than the variance in your LLM provider's response time.

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

Single-threaded latency doesn't tell you how the system behaves when 32 agents hit it simultaneously. We ran Reserve→Commit lifecycles at increasing concurrency:

| Threads | Throughput    |  p50    |  p95    |  p99    |  max    | Errors |
|---------|---------------|---------|---------|---------|---------|--------|
|       8 |    816 op/s   |   9.6ms |  11.6ms |  21.0ms |  24.5ms |      0 |
|      16 |  1,162 op/s   |  13.7ms |  19.2ms |  22.4ms |  28.7ms |      0 |
|      32 |  2,873 op/s   |  10.8ms |  15.1ms |  19.3ms |  43.1ms |      0 |

### Key observations

**Near-linear scaling.** Throughput scales 3.5x when going from 8 to 32 threads (4x threads). The sub-linear factor is expected — Redis Lua scripts are serialized (single-threaded execution) and connection pool contention increases.

**Zero errors under load.** No budget violations, no connection pool exhaustion, no timeouts at any concurrency level. Zero errors across all 5 benchmarked versions, at every concurrency level.

**Tail latency stays tight.** p99 at 32 threads is 19.3ms — well within acceptable bounds for a pre-execution check that gates a multi-second LLM call.

**2,873 complete lifecycles per second** at 32 threads means each thread completes a full Reserve→Commit cycle (two HTTP calls, two Lua script executions, two auth checks) in ~11ms average.

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

The unguarded baseline is identical — same agent, same workload, same ~600 calls burning ~$6 in 30 seconds. That confirms the comparison is fair.

With budget enforcement enabled, both versions stop the agent at exactly 100 calls and $1.00 of spend. The budget boundary is airtight in both versions. The difference is how fast the guarded agent completes: v0.1.24.1 finishes in **7.5 seconds** versus 67.8 seconds on v0.1.23.3 — a **9x improvement** in end-to-end guarded runtime.

The speedup comes from the optimizations described below: BCrypt caching, EVALSHA pipelining, and in-Lua balance snapshots. In v0.1.23, each budget check added enough overhead that 100 guarded calls took longer than 600 unguarded calls. In v0.1.24, budget enforcement overhead is invisible — the guarded run is faster simply because it makes fewer calls.

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

- **Latency is stable.** Reserve+Commit p50 has stayed in the 12.9-16.0ms range across all versions. The variation is environmental (container warmth, Docker engine version), not code regressions.
- **Throughput is stable or improving.** 32-thread throughput has ranged from 2,534-2,873 ops/sec. The v0.1.25.3 number (2,873) is the highest recorded, despite adding webhook event emission infrastructure in v0.1.25.
- **New features haven't added overhead.** Between v0.1.24.0 and v0.1.25.3, we added: async webhook event emission, 11 event model classes, AES-256-GCM encryption for webhook secrets, TTL retention cleanup, and 4 new runtime events (budget.exhausted, budget.over_limit_entered, budget.debt_incurred, reservation.expired). None of these moved the performance needle — because event emission runs on a separate async thread pool and never touches the request hot path.
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

As of v0.1.25, every reservation deny and commit overage triggers a webhook event. These events are emitted asynchronously via `CompletableFuture.runAsync()` on a dedicated daemon thread pool — they never block the request thread. Redis commands for event storage and subscription lookup are pipelined into a single round-trip. The runtime balance events (budget.exhausted, budget.over_limit_entered, budget.debt_incurred) only inspect the in-memory balance list returned by the Lua script — no additional Redis calls.

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

Budget enforcement with Cycles adds **4-7ms per write operation** and **2.8-3.5ms per read** in the typical case. A full reserve-commit lifecycle adds **~15ms** to an LLM call that takes seconds. At 32 concurrent threads, the server sustains **2,870+ complete lifecycles per second** with zero errors — stable across five versions and two weeks of feature development.

The overhead is small enough that you shouldn't notice it. In our runaway agent demo, v0.1.24 stops a $6 agent at exactly $1.00 — and the guarded run finishes **9x faster** than the previous version. If you don't enforce budgets, the cost of a single runaway agent will be orders of magnitude larger than any latency you saved.

## FAQ

### How much latency does Cycles add to LLM calls?

A full reserve-commit lifecycle adds ~15ms (p50) to your agent's LLM call. Since most LLM API calls take 500ms-30s, budget enforcement adds less than 3% overhead in the worst case and is effectively invisible in practice. This latency has been stable across five versions of the server. Read-only queries (balance checks, reservation lookups) add just 2.8-3.5ms.

### Does Cycles scale horizontally?

The [Cycles server](/glossary#cycles-server) is stateless — all state lives in Redis. You can run multiple server instances behind a load balancer. Redis itself can be scaled with Redis Cluster for sharding across multiple nodes. Our benchmarks show a single instance handling 2,870+ complete lifecycles per second.

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
