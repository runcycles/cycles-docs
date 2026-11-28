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

We ran that experiment against Cycles. Each cycle was a pair of HTTP calls. A [tenant](/glossary#tenant) reserved one token against its own budget, then immediately committed it. At 200 offered background cycles a second, the quiet tenant's median was under 7 ms in all four trials. Its p99, the time within which 99% of completed cycles finished, was **129–180 ms**. Splitting the batch across sixteen tenant accounts still left the quiet customer waiting.

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

In a pilot with a two-CPU runtime, the five-second client deadline expired on every dispatched warm-up cycle. We started over on an empty stack, gave the runtime eight CPUs and completed one cycle per tenant before applying concurrent load. We changed both conditions together, so the pilot can't tell us which change mattered.

For the measured run, we followed those first 17 cycles with a 20-second warm-up, then measured each condition for 60 seconds per pass. The generator had a two-CPU quota. Redis had one CPU and persistence disabled. All three ran on the same Docker Desktop host, an AMD Ryzen Threadripper 3990X. We used [Cycles server](/glossary#cycles-server) 0.1.25.61, admin 0.1.25.56, Redis 7.4.9 and Node 20.20.2. The two passes shared the same processes and retained their data between conditions.

## Quiet-tenant p99 under background load

Each pass had one idle minute. Both lines in its panel start at that same measurement.

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

One reason to keep the generator's own timings is to see whether it woke up late. At 200 background cycles per second the quiet lane's p99 dispatch delay was under 3.5 ms in every trial. The much longer tail was observed after dispatch. Both streams still shared one Node process and HTTP client, so that interval includes client-side waits as well as the application and Redis. To identify the next bottleneck, I'd put the quiet probe on a second host and time reserve and commit separately.

## Run the noisy-neighbor test

Download the [Compose file](/examples/noisy-neighbor/compose.yaml) and the [Node load generator](/examples/noisy-neighbor/load.mjs) into the same empty directory. Run the following commands there with Docker Compose. The services communicate on a project network without publishing host ports. The admin service provisions disposable tenants before the timed work starts.

```sh
docker compose up -d redis runtime admin
docker compose run --rm -T load > results.jsonl
docker compose down -v
```

Each output line describes one minute. `probe` is the quiet customer and `background` covers the other tenants. Latency starts when the generator dispatches a cycle and ends after it reads the commit response. Each lane reports completed cycles, missed starts, timeouts, other errors and dispatch delay. A cycle more than 25 ms late or arriving with 64 cycles already in flight in its lane counts as a missed start. Each HTTP call has a five-second deadline. Read those counts before interpreting a percentile calculated from successful cycles.

For a job queue, give the quiet customer a small job that arrives every 100 ms. Time it from enqueue until the worker acknowledges completion. Then add bulk jobs from one account and repeat with the same jobs spread across accounts. A separate count of jobs still unacknowledged at the deadline keeps a fast percentile from hiding a growing backlog.

**Resources**

- [Reserve-commit request lifecycle](/protocol/how-reserve-commit-works-in-cycles)
- [Measured trial summaries](/examples/noisy-neighbor/results.jsonl)
