---
title: "Property Tests for Cycles Budget Authority"
date: 2026-04-16
author: Albert Mavashev
tags: [engineering, testing, operations, property-based-testing, jqwik, concurrency, runtime-authority]
description: "Learn how property-based tests expose concurrency and atomicity failures in Cycles budget authority, including practical jqwik and Spring testing traps."
blog: true
sidebar: false
featured: false
head:
  - - meta
    - name: keywords
      content: "property-based testing, jqwik, jqwik-spring, TOCTOU concurrency testing, BeforeProperty lifecycle, redis lua concurrency, budget exhaustion test, jqwik defaultTries override, distributed systems invariants, shrinking counterexample"
---

# Why We Added Property Tests to Cycles' Budget Authority

The architectural argument for running [budget authority on Redis Lua](/blog/why-cycles-runs-budget-authority-on-redis-lua) is only load-bearing if the invariants it promises — no overdraw, mutually exclusive terminal states, no leaked ACTIVE reservations — actually hold under real concurrent load. Ordinary unit tests can't prove that. By construction, they won't systematically explore the thread interleavings that break atomicity.

This is the story of `BudgetExhaustionConcurrentPropertyTest` — what it tests, why it catches bugs a unit test can't, and two specific jqwik-Spring traps that cost us a day of debugging. If you're writing property tests against a Spring Boot service with jqwik, there's a good chance you'll hit one of these. Possibly both.

<!-- more -->

## The gap a unit test couldn't close

Before this test existed, Cycles' concurrency coverage was two shapes:

- `CyclesProtocolConcurrentBenchmarkTest` drove concurrent reserve→commit lifecycles at 8, 16, and 32 threads. It measured latency and throughput. It **asserted nothing about correctness**. A budget could have silently gone negative and the benchmark would still pass with green numbers.
- `OverdraftIntegrationTest` covered the three [overage policies](/how-to/choosing-the-right-overage-policy) (REJECT, ALLOW_IF_AVAILABLE, ALLOW_WITH_OVERDRAFT) in isolation, sequentially. It proved each policy's happy path. It never exercised any of them under contention.

Both are useful. Neither can fail the way a real concurrency bug would. A unit test that drives N threads with a fixed schedule is still running one specific interleaving — the one the test author thought to write. The interleaving that breaks atomicity is almost never the one the author imagined.

Property-based testing inverts this. You describe the invariants that must hold across *any* interleaving, and the framework generates the interleavings. jqwik shrinks failing cases to minimal reproducers. What you get is a test that assumes you don't know where the bug is — and looks there anyway.

## The three invariants

Under the REJECT overage policy (`overdraft_limit = 0`), the test generates random triples of (threadCount, initialBudget, workload) and drives a mixed reserve/commit/release workload through the full HTTP → Spring → Lua path. After the workload drains and the expiry sweep runs, it asserts:

- **I1 — Never overdraw.** `sum(charged_amount across COMMITTED reservations) ≤ initial_budget`. The service must never record more spend than the budget allowed, under any interleaving of any workload.
- **I2 — Terminal states are mutually exclusive.** A COMMITTED reservation must not also carry `released_amount`. A RELEASED reservation must not carry `charged_amount`. The state machine has to be a machine.
- **I3 — No leaked ACTIVE reservations.** Every reservation reaches a terminal state within TTL + grace + sweep. An ACTIVE row sitting in Redis after the sweep ran isn't "leftover data" — in the Cycles protocol, reservations are bounded by an explicit lifecycle (ACTIVE → COMMITTED/RELEASED/EXPIRED), so a surviving ACTIVE is a lifecycle violation.

The generators are deliberately tuned for exhaustion:

- `threadCount`: 2–16
- `initialBudget`: 1,000–50,000 TOKENS (small on purpose)
- `workload`: 30–200 ops per try

Budgets are small so exhaustion happens early and often. If the budgets were large relative to the workload, the test would exercise the happy path and the invariants would hold trivially. The point is to force the scarce-budget race — multiple threads discovering simultaneously that `remaining` is near zero, each trying to reserve the last few tokens.

When an invariant fails, jqwik shrinks the case automatically: fewer threads, smaller workload, the minimal sequence that still breaks the property. That shrunk counterexample is what you debug from, not the original 200-op run.

## Trap 1: `@BeforeProperty` fires before Spring autowiring

First run. Compiled clean. Test started. Failed immediately:

```
NullPointerException: Cannot invoke
  "redis.clients.jedis.JedisPool.getResource()"
  because "this.jedisPool" is null
  at BudgetExhaustionConcurrentPropertyTest.resetRedis(...)
```

The `resetRedis` method was in a `@BeforeProperty` hook and was trying to flush Redis before each property run. The `@Autowired JedisPool jedisPool` field was null at the time it ran.

Root cause: `jqwik-spring` 0.11.0 does Spring autowiring inside its `AroundPropertyHook`, which wraps the **property body**. `@BeforeProperty` is a lifecycle hook that fires *before* the `AroundPropertyHook` opens. At that moment, Spring hasn't injected anything yet. Every `@Autowired` field on the test class is still null.

This was not obvious from the jqwik-spring documentation we were using. It will probably bite anyone else building Spring + jqwik tests.

The fix is counter-intuitive but simple: **don't use `@BeforeProperty` for setup that needs autowired state.** Move the reset into a regular method called from inside the property body. In our case:

```java
@Property
void budgetInvariantsHoldUnderConcurrentLoad(@ForAll("workloads") Workload w) {
    resetRedisAndSeedApiKey();  // called from the body, not @BeforeProperty
    // ... drive the workload, assert I1, I2, I3
}
```

This runs on every try rather than once per property, which is actually what we wanted anyway — each generated workload needs a clean Redis state to make the invariant checks meaningful. The "bug" forced the right design.

Fix shipped as commit `bb962e9`.

## Trap 2: the override that silently did nothing

With the NPE fixed, the test ran green in the PR build — 20 tries in about 20 seconds. We wanted nightly coverage at 100 tries for deeper exploration, so the nightly workflow ran with `-Djqwik.tries.default=100`.

The job passed. The jqwik summary said `tries = 20`.

The override had silently had no effect. Two compounding causes:

**First:** `@Property(tries = 20)` in the annotation literal beats any runtime override. jqwik's precedence chain is **annotation > system property > config file > built-in default**. A value hard-coded on the `@Property` annotation wins over anything you pass at `mvn test` time. We had put `tries = 20` on the annotation while debugging the NPE and forgotten to remove it.

**Second:** even if we *had* removed it, the system-property name was wrong. We used `-Djqwik.tries.default=100`. The actual property name is `-Djqwik.defaultTries=100`, matching the config-file key `defaultTries`. The misspelled one is silently ignored.

Both bugs were individually harmless; together they produced a knob that looked plumbed but wasn't. The release pipeline would have run "100-try" nightlies forever at 20 tries each and we'd have believed we had deeper coverage than we did.

The fix:

- Removed `tries` from the `@Property` annotation entirely.
- Added `src/test/resources/jqwik.properties` with `defaultTries = 20` as the PR-speed baseline.
- Corrected the nightly workflow to `-Djqwik.defaultTries=100`.
- Runtime-verified: `tries = 100 | checks = 100` in the jqwik summary. Passed in ~2 minutes. Known-good reproducer seed `-2583074049974961229`.

Fix shipped as commit `097a285`.

The lesson that generalized: **a silently-no-op test knob is worse than a loud error.** If a configuration path has no effect, the test framework should refuse to start, not shrug and use the default. jqwik doesn't do this today — so the responsibility lands on whoever is wiring it in. Every runtime override worth having is worth verifying in a smoke run before you trust the nightly to do what you asked.

## Seed as reproducer

When a property test fails, the seed is the reproducer. jqwik prints it at the top of the failure report. Capture it.

On our build, seed `-2583074049974961229` is the known-good seed we re-run after any change that touches the reserve/commit/release path. If that seed starts failing, something upstream of the invariants changed. If it passes, it's not a guarantee — property tests are probabilistic — but it's a cheap smoke check before a deeper run.

For a *failing* seed, commit the seed (and a comment explaining what it found) as a permanent regression case. jqwik can be told to re-run a specific seed via its config. The shrunk counterexample plus the seed is the minimum viable bug report.

We're in the green-run regime today. If that changes, the seed is how we stay honest.

## Where this sits relative to other tests

Property tests don't replace unit tests. They sit above them, and a few things are worth being explicit about:

**Speed.** 20 tries runs in ~20 seconds on Docker Desktop. 100 tries runs in ~2 minutes. That's fine for PR CI and nightly respectively — but it's not fast enough to run on every save during development. Unit tests still carry the tight feedback loop, and the ≥95% JaCoCo line coverage gate on unit + integration tests still matters.

**Output requires engineering judgment.** Unit tests give you "expected X, got Y." Property tests give you a shrunk concurrent counterexample, not a hand-written narrative. Reading that is a skill.

**Scope.** Unit tests prove a function does what it's supposed to. Property tests prove an invariant holds across interleavings the function can't see from the inside. The two questions aren't substitutable. A Lua script that passes every unit test can still have a TOCTOU at the boundary between two scripts — and that's exactly what the property test is there to catch.

The test investment we made at this layer sits on top of the other layers, not in place of them: unit tests for logic, integration tests for spec contracts, [soak tests for long-duration stability](/blog/why-cycles-runs-budget-authority-on-redis-lua), benchmarks for the latency envelope, property tests for concurrent correctness. Removing any one leaves a class of bug uncovered.

## Bottom line

The architectural claim that budget authority runs correctly on Redis Lua is easy to assert and hard to verify. `BudgetExhaustionConcurrentPropertyTest` is one of the ways we verify it: the benchmark test measures latency, this one asserts correctness, both run the same code path against a real Testcontainers Redis through the full HTTP stack.

If you're building property tests over a Spring Boot service that talks to Redis, the two fixes in this post are probably worth stealing before you start.

---

*Related: [Why Cycles runs budget authority on Redis Lua](/blog/why-cycles-runs-budget-authority-on-redis-lua) — the substrate the invariants run against. [Retry storms and idempotency](/blog/retry-storms-and-idempotency-in-agent-budget-systems) — the failure mode property tests were built to catch.*
