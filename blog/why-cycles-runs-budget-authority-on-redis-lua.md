---
title: "Why Cycles Runs Budget Authority on Redis Lua"
date: 2026-04-15
author: Albert Mavashev
tags: [engineering, architecture, operations, redis, lua, concurrency, runtime-authority]
description: "Learn why Cycles uses Redis and Lua for atomic budget authority, low-latency decisions, retry safety, and correctness under concurrent agent traffic at scale."
blog: true
sidebar: false
featured: false
head:
  - - meta
    - name: keywords
      content: "redis lua budget authority, EVALSHA atomicity, ai agent concurrency, TOCTOU budget check, single-threaded lua redis, budget enforcement architecture, reserve commit atomic, agent runtime authority substrate"
---

# Why Cycles Runs Budget Authority on Redis Lua

Every architectural choice in a runtime-authority system is a bet against a specific failure mode. This post is about one bet: **budget authority in Cycles runs as atomic Lua scripts inside Redis.** Not app-layer locks over a SQL database, not optimistic CAS loops, not a distributed lock service in front of a cache. Lua on Redis, executed via `EVALSHA`.

This is the reasoning — what the constraints are, why the alternatives didn't clear them, what the substrate costs us in return, and how we prove the resulting system holds under load.

<!-- more -->

## The constraints, stated plainly

[Budget authority](/glossary#runtime-authority) sits in the critical path of every agent action. A reserve call gates the LLM request that follows it; a commit call records what actually got spent. That position produces three non-negotiable requirements:

1. **Atomicity across scopes.** A single reserve touches multiple budgets — user, team, tenant, global. Either all of them reserve the estimate or none of them do. A partial reserve is worse than no reserve: it debits budgets the agent never actually used.

2. **Low-latency single-operation envelope.** In the original v0.1.25.3 benchmark environment, Reserve measured 6.2ms p50, Commit 4.1ms p50, and the full Reserve+Commit lifecycle 14.9ms p50 end to end. Those figures are environment-specific observations, not an SLA; the design requirement is to keep authority overhead small relative to model and tool execution and to regression-test hot-path releases on comparable hardware.

3. **Correctness under retry storms.** Agent frameworks retry aggressively. An agent that times out on reserve will retry; a network blip between client and server produces duplicate commits. The substrate must make "same reserve attempted twice" exactly equivalent to "same reserve attempted once" — and it has to do so without a coordinator that reintroduces the latency problem. The [retry-storm post](/blog/retry-storms-and-idempotency-in-agent-budget-systems) covers the semantics; here we care about what substrate enforces them.

Those three together sharply narrow the space.

## Why the obvious alternatives didn't clear the bar

**Postgres with row locks.** Atomicity: yes. Envelope: no. Under concurrent load against the same scope row, `SELECT ... FOR UPDATE` queues writers behind an exclusive lock; add network round-trip, MVCC bookkeeping, and WAL commit, and the 10ms envelope is gone before the second concurrent request lands. Hot-row contention degrades non-linearly — the tail gets ugly fast. Postgres is an excellent *durable record* of budget state. It's the wrong place to make the decision.

**App-layer distributed locks** (Redisson, ZooKeeper, etcd). Two round-trips per mutation minimum: acquire the lock, do the work, release the lock. Worse, the "check then act" window reopens at the application layer — unless you also serialize every read-modify-write inside the lock, which is what you were trying to avoid. And now lock-service availability becomes budget-authority availability with extra steps.

**Optimistic concurrency with CAS loops.** Works beautifully for low-contention keys. Under a real retry storm — fifty agents racing against the same tenant budget after an LLM outage — retry amplification dominates. The 51st request is retrying behind 50 others that are all retrying behind each other. This is a known failure mode; it's the one we specifically need to not have.

**In-memory only.** No durability across process restarts. No multi-instance story. Non-starter for a service you deploy.

What remains is "atomic primitive, inside the store, one round-trip." Redis Lua is the substrate that matches the description.

## What Lua on Redis actually gives you

Four properties, each with a concrete pointer into the code.

**Atomicity by construction.** Redis is single-threaded during script execution — while a script runs, nothing else runs on that Redis instance. The TOCTOU window between "check if remaining ≥ estimate" and "decrement remaining" closes by definition. `reserve.lua` uses this directly: it reads `status`, `remaining`, `debt`, `is_over_limit`, and `overdraft_limit` for every affected scope in a single `HMGET` pass, validates all of them, *then* does the `HINCRBY` mutations. If any scope fails validation, no scope gets mutated. This is atomic across scopes because it's atomic across the whole script — no lock, no transaction, no retry logic.

**One round-trip per mutation.** `EVALSHA` sends the script digest and arguments. Redis executes and returns without a multi-step transaction, optimistic retry, or coordinator. Avoiding extra network turns is one reason the original v0.1.25.3 test measured a 14.9ms Reserve+Commit p50; absolute latency still depends on host, container, JVM, and Redis placement.

**Time authority inside the script.** Every Cycles Lua script calls `redis.call('TIME')` for the current timestamp rather than accepting a client-supplied one. The comment at the top of `expire.lua` says why directly:

> Use Redis TIME for consistency with reserve/commit/release/extend scripts, which all use Redis TIME for expires_at comparisons. Using Java-provided time (ARGV[2]) could cause clock-skew issues between the app server and Redis.

This matters specifically for grace-window comparisons. A reservation has an `expires_at` plus a `grace_ms` window during which a late commit still succeeds. If the app server's clock drifts forward, a client-timestamped expire call could declare a reservation dead that hasn't actually aged out — silently charging a budget for an action that was about to succeed. `redis.call('TIME')` removes that failure mode by making Redis the single clock.

**Balance snapshots free.** Because the script already has post-mutation state sitting in local variables, returning it costs nothing — no additional Redis calls, no Java-side second fetch. Every reserve/commit/release response in Cycles includes a `balances[]` array with the current state of every affected scope. This is what makes "show me the budget right now" cheap enough to put in dashboards without worrying about it.

## The boundaries we deliberately accepted

Lua on Redis isn't free. The honest trade-offs:

**Serialized execution.** Every script on a given Redis instance runs single-threaded. Strong scaling through 32 threads (2,873 ops/sec in the benchmark) holds because each script is short — hundreds of microseconds of Lua plus a handful of Redis commands. A long-running script would head-of-line-block every other client on that instance. The discipline this imposes: scripts stay bounded. No loops over unbounded collections, no scanning, no blocking commands inside a script. The six scripts in Cycles (reserve, commit, release, extend, event, expire) are 64–337 lines each; the longest runs in single-digit milliseconds.

**Redis availability equals budget-authority availability.** This is a real failure domain and we don't paper over it. Mitigation is layered: the Cycles server itself is stateless, so horizontal replication is a load-balancer problem; Redis Sentinel or Cluster covers the Redis layer; and the protocol's failure semantics are fail-safe by design — if reserve fails, the agent doesn't proceed, which means it doesn't spend. Unavailability degrades to "agents pause," not "agents run unbudgeted."

**No cross-shard atomicity.** If you shard Redis, a scope tree that spans shards breaks atomicity — the whole argument in Section 3 rests on "one Redis instance during script execution." Cycles keeps a tenant's entire scope tree on a single shard; tenants are the shard key. This is a design constraint, not a workaround: if your authority model needs to atomically touch scopes across tenants, Lua-on-Redis stops being the right answer.

**Script debugging is hard.** No stack traces, limited observability inside a running script, and a bug in Lua can corrupt state in ways that are very annoying to reason about after the fact. The mitigation is aggressive testing at the script layer — covered in the next section — not better debugging tools.

## How we prove the system holds

The architectural argument above is load-bearing only if the resulting system actually behaves the way the argument claims. Evidence, not claims:

**Property-based testing at the authority layer.** `BudgetExhaustionConcurrentPropertyTest` uses jqwik to throw random concurrent sequences of reserve/commit/release at the Lua scripts, then checks invariants after each sequence: `remaining` never goes negative, `reserved` is always ≥ 0, no phantom keys, idempotency keys map 1:1 to reservations. 1,000 passing tries on the current build. A property test finds the TOCTOU cases a unit test can't, because the bug only exists when two threads interleave at exactly the wrong place.

**Soak-test invariants.** The nightly soak test drives a mixed reserve+commit/release workload at ~100 ops/sec for 30 minutes and asserts four invariants at the end:

- **S1** — JVM heap used at end < 2× heap used at start (after forced GC). Catches real leaks.
- **S2** — average latency in the final minute < 3× the baseline-minute average. Catches connection-pool exhaustion, queue backup, feedback loops.
- **S3** — `reservation:res_*` key count ≤ `ops × 1.1`; `idem:*` key count ≤ `ops × 2.1` (one idempotency key per reserve, one per commit). Catches unbounded key growth.
- **S4** — every entry in the `reservation:ttl` sorted set has a matching `reservation:res_*` hash. Catches orphaned index entries — a commit that cleaned up the hash but forgot the index.

First 30-minute run: 179,944 reserves, 91,507 commits, 0 errors. Heap 1.14× baseline. Latency 0.25× baseline (finished below baseline because JIT warmup lands inside the measurement window). All four invariants held.

**Automated performance-regression gate.** Every release runs the benchmark suite three times, medians the results, and compares against `baseline.json` at a 25% threshold. A change that regresses Reserve+Commit p50 or 32-thread throughput by more than 25% fails the release job before the Docker image gets built. A looser 30% trend threshold runs nightly against a rolling 7-run median; real regressions show as sustained steps, not single-run noise.

**Concurrent throughput numbers.** The [benchmark post](/blog/cycles-server-performance-benchmarks) has the original table; the architectural point is that one-round-trip atomic scripts enable high throughput without a separate coordinator. The historical 2,870+ lifecycle/s result belongs to that documented v0.1.25.3 environment, not every server version or deployment.

## When Lua on Redis stops being the right answer

Architectural honesty requires naming the exit ramps. Here are the conditions that would push *any* team — us included — off this substrate:

- **Your scope tree exceeds what one Redis shard can hold.** Single-tenant authority trees at Cycles scale comfortably inside a shard today; a tenant with billions of active scopes is a different problem.
- **Your audit-history requirement exceeds what TTL-based cleanup supports.** Cycles keeps expired reservations for 30 days on the hash itself (`PEXPIRE` in `expire.lua`) and emits events on the way out, which most compliance regimes can consume. If you need seven-year queryable history joined against transactional data, the authority record and the audit record need to be separate systems.
- **You need multi-region active-active authority.** Redis Enterprise Active-Active (CRDTs) solves this with real money and real complexity; the single-shard atomicity argument degrades under eventual-consistency semantics, and you're back to deciding what "a reserve succeeded" means across regions.
- **You need to JOIN budget state against relational data inside the critical path.** That's a Postgres-shaped problem, not a Redis-shaped one.

If one of those is load-bearing for your system, the shape of the answer changes — most likely Postgres-backed authority with Redis as a cache — and so does the latency envelope and the concurrency model. Lua on Redis is not universally correct. It is the substrate these constraints named.

## Bottom line

We built budget authority on Redis Lua because the requirements named the substrate: atomicity across scopes, low request-path overhead, and correctness under retry storms. `EVALSHA` gives one-round-trip atomicity; single-threaded script execution closes the shared-ledger check/reserve TOCTOU window without an application lock; `redis.call('TIME')` removes application-clock skew; and returning post-mutation snapshots from inside the script removes a second network hop.

The trade-offs — single-shard atomicity, Redis as a coupled failure domain, hard-to-debug scripts — are real and we account for them with fail-safe semantics, property tests at the script layer, a soak invariant suite, and a release-time regression gate that fails the build before a slower script ever reaches production.

That's the bet. The code, the tests, and the benchmark numbers are how we check whether it's still paying off.

---

*More detail on the protocol itself: [how reserve-commit works](/protocol/how-reserve-commit-works-in-cycles), [reservation TTL and grace](/protocol/reservation-ttl-grace-period-and-extend-in-cycles), [why Cycles is built for real failure modes](/concepts/idempotency-retries-and-concurrency-why-cycles-is-built-for-real-failure-modes).*
