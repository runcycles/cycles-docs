---
title: "Can One Busy Tenant Slow Down Everyone Else?"
date: 2026-11-28
author: Albert Mavashev
tags: [engineering, performance, benchmarks, latency, multi-tenant]
description: "A noisy-neighbor load test measures a quiet tenant’s p99 latency as background traffic moves from one tenant to 16. Includes a runnable harness and results."
blog: true
sidebar: false
featured: false
head:
  - - meta
    - name: keywords
      content: "noisy neighbor load test, multi-tenant latency, p99 latency, performance isolation, open-loop load testing, Redis, reserve-commit"
---

# Can One Busy Tenant Slow Down Everyone Else?

Imagine two customers on the same API. One runs a batch job at noon. The other keeps doing ten units of work a second. When the second customer asks how much longer their work took during the batch, the service-wide p99 is a poor place to look. At 200 background cycles a second, that customer's slowest 1% accounts for roughly one cycle in every 2,100 across the service.

We ran that experiment against Cycles. Each cycle was a pair of HTTP calls. A [tenant](/glossary#tenant) reserved one token against its own budget, then immediately committed it. On server 0.1.25.61, at 200 offered background cycles a second, the quiet tenant's median was under 7 ms in all four trials. Its p99, the time within which 99% of completed cycles finished, was **129–180 ms**. We traced the spikes to duplicate work in API-key verification. A separate comparison of the two server versions put the quiet tenant's p99 at **22–25 ms** with the fix.

<!-- more -->

## A load test with a quiet tenant

Cycles gives each tenant its own ledger. Two tenants on the same deployment can still use the same application process, Redis instance and network. For example, Redis executes a Lua script atomically, so another client's command can wait for that script to finish. The HTTP client measures the time spent across the whole path. An increase by itself can't tell us where a request waited. [How multi-tenant budgets work](/blog/multi-tenant-ai-cost-control-per-tenant-budgets-quotas-isolation) · [Why Cycles uses Redis Lua](/blog/why-cycles-runs-budget-authority-on-redis-lua) · [Redis scripting semantics](https://redis.io/docs/latest/develop/programmability/eval-intro/)

Our earlier benchmarks put up to 200 concurrent clients on shared and independent budgets and measured the callers doing the work. This time we kept one tenant's arrival rate fixed while its neighbors got busier. The distinction matters to anyone operating a shared API. The customer opening a support ticket may have changed nothing on their end. [Cycles server benchmarks](/blog/cycles-server-performance-benchmarks) · [What we learned from repeating a p99 benchmark](/blog/proving-a-critical-path-agent-safety-gate)

| What we held fixed | What we varied |
| --- | --- |
| Quiet tenant offered 10 reserve-commit cycles per second | Background offered 0, 50 or 200 cycles per second |
| One tenant-level budget per customer, each funded with 10 million [tokens](/glossary#tokens) | One background tenant sent all the work, or 16 took turns |
| One token reserved and committed per cycle, with no model call between them | Second pass ran the five conditions in reverse order |

The generator scheduled new cycles by the clock, including while earlier cycles were still in flight. A client that waits for each response before sending its next request eases off exactly when the service starts taking longer. An arrival schedule lets you ask what happens to a customer who continues sending traffic through that slowdown. [Grafana's explanation of open and closed load models](https://grafana.com/docs/k6/latest/using-k6/scenarios/concepts/open-vs-closed/)

In a pilot with a two-CPU runtime, all 200 quiet cycles and all 256 background cycles that started during warm-up timed out. The generator missed the other 1,744 scheduled background starts. We started over on an empty stack, gave the runtime eight CPUs and completed one cycle per tenant before applying concurrent load. We changed both conditions together, so the pilot can't tell us which change mattered.

For the measured run, we followed those first 17 cycles with a 20-second warm-up, then measured each condition for 60 seconds per pass. The generator had a two-CPU quota. Redis had one CPU and persistence disabled. All three ran on the same Docker Desktop host, an AMD Ryzen Threadripper 3990X. We used [Cycles server](/glossary#cycles-server) 0.1.25.61, admin 0.1.25.56, Redis 7.4.9 and Node 20.20.2. The two passes shared the same processes and retained their data between conditions.

## Quiet-tenant p99 under background load on 0.1.25.61

Both lines share one quiet-only measurement per pass. Pass 1 ran from zero to 200 offered background cycles per second. Pass 2 ran from 200 back to zero on the same stack. Both lanes used the same Node clock and start time, so each scheduled quiet arrival under load coincided with a scheduled background arrival.

![Quiet-tenant p99 latency across two passes at 0, 50 and 200 offered background cycles per second. Both tenant mixes reach their highest p99 at 200.](/blog/noisy-neighbor-latency.png)

| Offered background cycles/s | Background tenants | Quiet p99, pass 1 | Quiet p99, pass 2 | Missed background starts, pass 1 / pass 2 |
| ---: | ---: | ---: | ---: | ---: |
| 0 | 0 | 18.01 ms | 14.79 ms | 0 / 0 |
| 50 | 1 | 29.62 ms | 17.43 ms | 0 / 0 |
| 50 | 16 | 15.42 ms | 14.08 ms | 0 / 0 |
| 200 | 1 | 174.37 ms | 128.97 ms | 265 / 268 |
| 200 | 16 | 179.82 ms | 152.87 ms | 302 / 328 |

All 6,000 quiet cycles completed. Across both lanes there were zero client timeouts and zero other request errors. At the highest rate the generator offered 12,000 background cycles per minute. It missed 265–328 starts, depending on the trial. That left about 195–196 completed background cycles per second. For a customer with a 100 ms latency objective at p99, all four heavily loaded minutes would have missed the objective even though the median stayed under 7 ms.

On both passes the quiet customer's p99 at 200 was higher with sixteen neighbors than with one. The one-neighbor result itself moved by 45 ms between passes, more than either within-pass gap between the two traffic shapes. With 600 quiet cycles per minute, the nearest-rank p99 is the seventh-slowest completion. That makes the operational decision simpler than the statistical one. Spreading the batch across accounts failed to bring this customer within 100 ms. Ranking the two layouts would take more trials.

## Where the quiet tenant waited

At 200 background cycles per second, the quiet lane's p99 dispatch delay was under 3.5 ms in every trial. Most of the delay in the slow cycles came after dispatch. In a follow-up run on the released server, we captured a JVM profile alongside client timings. All 38 quiet cycles that took over 100 ms started in seconds when BCrypt appeared in CPU samples. In one of those seconds the profiler sampled 45 distinct threads doing BCrypt work.

The server caches the result of verifying an API key for 60 seconds. When the entry expired, several requests could look it up before the first one finished verifying the key. Each then performed the same expensive hash comparison. The fix lets requests share one verification for the same credential and stored hash on each server instance. Every request still reads the current key and tenant records, so revocation and rotation keep their existing behavior. [Merged server change and regression test](https://github.com/runcycles/cycles-server/pull/303)

We then compared the released 0.1.25.61 image with the packaged 0.1.25.62 JAR in that same image. Each version started on a fresh stack. We held the quiet tenant at ten cycles per second and offered 200 background cycles per second for one 100-second window per row and version. The longer windows let the verification cache expire during each measurement.

| Background tenants | Quiet p99 on 0.1.25.61 | Quiet p99 on 0.1.25.62 | Missed background starts, before → after |
| ---: | ---: | ---: | ---: |
| 1 | 228.04 ms | 24.98 ms | 544 → 0 |
| 16 | 195.12 ms | 22.32 ms | 574 → 5 |

All 1,000 quiet cycles completed in each window. Median latency stayed between 6.55 and 6.76 ms across all four windows. The quiet customer's p99 fell by about 89% with either tenant mix. A dashboard showing only the median would have given us little reason to investigate and little evidence that the fix helped. [Benchmark setup and full comparison](https://github.com/runcycles/cycles-server/blob/279b4b9468f3e2903fa92ffb95dae042e3197f43/BENCHMARKS.md#api-key-cache-expiry-under-load--v012562-2026-11-28)

## Run the noisy-neighbor test

To repeat the original two-pass experiment on 0.1.25.61, download the [Compose file](/examples/noisy-neighbor/compose.yaml) and the [Node load generator](/examples/noisy-neighbor/load.mjs) into the same empty directory. Run the following commands there with Docker Compose. The services communicate on a project network without publishing host ports. The admin service provisions disposable tenants before the timed work starts.

```sh
docker compose up -d redis runtime admin
docker compose run --rm -T load > results.jsonl
docker compose down -v
```

Each output line describes one minute. `probe` is the quiet customer and `background` covers the other tenants. Latency starts when the generator dispatches a cycle and ends after it reads the commit response. Each lane reports completed cycles, missed starts, timeouts, other errors and dispatch delay. A cycle more than 25 ms late or arriving with 64 cycles already in flight in its lane counts as a missed start. Reserve and commit each have a five-second client deadline. Read those counts before interpreting a percentile calculated from successful cycles.

For a job queue, give the quiet customer a small job that arrives every 100 ms. Time it from enqueue until the worker acknowledges completion. Then add bulk jobs from one account and repeat with the same jobs spread across accounts. A separate count of jobs still unacknowledged at the deadline keeps a fast percentile from hiding a growing backlog.

**Resources**

- [Reserve-commit request lifecycle](/protocol/how-reserve-commit-works-in-cycles)
- <a href="/examples/noisy-neighbor/results.jsonl" download>Download the ten measured trial summaries (JSON Lines)</a>
