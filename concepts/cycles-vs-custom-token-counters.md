---
title: "Cycles vs Custom Token Counters: Build vs Buy for Agent Budget Control"
description: "In-app token counters break under concurrency, multi-service deployment, and production load. When to adopt a dedicated runtime authority."
---

# Cycles vs Custom Token Counters: Build vs Buy for Agent Budget Control

Every team that runs AI agents in production eventually builds a token counter.

It starts the same way every time.

A developer adds a variable. After each LLM call, increment the counter by the number of tokens used. Before the next call, check if the counter has exceeded the limit.

```python
if total_tokens < max_tokens:
    response = call_llm(prompt)
    total_tokens += response.usage.total_tokens
else:
    raise BudgetExceeded()
```

This works. For a while.

It works when you have one service, one process, one agent, and one developer who understands the counter. It stops working when any of those assumptions change.

This article explains where custom token counters break, why they break, and when to replace them with a dedicated runtime authority.

> **Run the numbers for your workload:** [Cost Calculator →](/calculators/claude-vs-gpt-cost-standalone) — token counters predict; the calculator separates the prediction (rates × volume) from the enforcement layer that bounds reality.

## The natural starting point

Building your own counter is the rational first move.

The requirements seem simple:

- Track how many tokens each run uses
- Stop the run when it exceeds a limit
- Maybe track per-tenant usage for billing

A database column, a Redis key, or even an in-memory variable can handle this. The implementation takes an afternoon. It ships quickly. It solves the immediate problem.

Teams that build counters are not doing anything wrong. They are responding to a real need with the simplest possible solution.

The problems emerge later, when the system grows.

## Where custom counters break

### Concurrency: read-then-increment is a race condition

The basic counter pattern is: read the current value, check if it is under the limit, proceed, then increment.

That is a textbook time-of-check-to-time-of-use (TOCTOU) race condition.

When two agent threads run concurrently:

1. Thread A reads the counter: 900 tokens used out of 1,000 limit.
2. Thread B reads the counter: 900 tokens used out of 1,000 limit.
3. Both threads see headroom. Both proceed.
4. Thread A's call uses 200 tokens. Thread B's call uses 200 tokens.
5. Actual total: 1,300 tokens. Budget exceeded by 30%.

This is not a theoretical concern. It is the most common bug in custom counter implementations.

Solving it correctly requires atomic compare-and-swap operations, database-level locking, or serialized access. Most ad hoc counters do not implement any of these. Even when they do, the implementation is often subtly wrong — it works under light load and breaks under production concurrency.

### Multi-process and multi-service: the counter is local

A counter stored in application memory only exists in one process.

When the system scales to multiple instances, each instance has its own counter. The budget is effectively multiplied by the number of instances. Three replicas of a service, each with a 1,000-token limit, actually allow 3,000 tokens.

Moving the counter to a shared store (Redis, PostgreSQL) solves the locality problem but introduces the concurrency problem. Now every read-check-increment must be atomic across a network boundary. Latency, retries, and connection failures add complexity.

Moving to a shared store also means every service that makes LLM calls needs to know about the counter, use the same key scheme, and handle failures consistently. That coordination cost grows with each new service.

### No reservation model: cannot hold budget for in-flight work

Custom counters typically track what has been used. They do not track what is currently in flight.

Consider an agent that has used 800 of its 1,000 token budget. It starts a new LLM call that is estimated to use 150 tokens. While that call is in flight, another thread checks the counter and sees 800. It also starts a call. Both calls complete. The total is 1,100.

The counter was accurate at the time of the check. It just did not account for work that was already happening.

A reservation model solves this. Before the call, the system reserves 150 tokens. The counter immediately reflects 950 (800 used + 150 reserved). The next thread sees 950 and knows the budget is nearly exhausted.

After the call completes, the reservation is committed at the actual cost. If the call used only 120 tokens, the remaining 30 are released.

Building a correct reservation model on top of a simple counter is a significant engineering effort. It requires atomic reservation, commit, release, and TTL-based expiry for reservations that never complete. Most teams do not build this.

### No hierarchical scopes

A counter tracks one number against one limit.

Production systems need limits at multiple levels:

- **Tenant level:** This customer may spend $500 per month.
- **Workspace level:** This workspace may spend $100 per day.
- **Workflow level:** This workflow type may spend $10 per execution.
- **Agent level:** This agent may spend $2 per session.
- **Toolset level:** This set of tools may spend $0.50 per call.

Enforcing all of these simultaneously means a single request must check budget at multiple levels before proceeding. Each level must be decremented atomically. If any level is insufficient, the action must be denied.

Building this with ad hoc counters means maintaining separate counters per level, with correct rollup logic, atomic multi-key operations, and consistent error handling. The complexity is substantial.

Cycles supports hierarchical scopes natively. A single reservation checks all applicable scopes in one atomic operation.

### No overage policies

A custom counter has two states: under budget and over budget. The response is binary: proceed or fail.

Production systems need more nuance.

When a tenant is approaching their budget limit, the right response might not be "stop." It might be:

- Switch from GPT-4 to GPT-3.5 (cheaper, faster, good enough for this task)
- Reduce the context window from 128K tokens to 16K tokens
- Skip the optional document enrichment step
- Return a cached response instead of a live inference
- Allow the action but flag it for review

This is graceful degradation. It keeps the system running at reduced capability instead of failing hard.

Cycles supports this through its three-way decision model. When budget is low, the system returns ALLOW_WITH_CAPS instead of DENY. The caller receives structured guidance on how to proceed with reduced resources.

Implementing this on top of a custom counter requires the counter to return not just "yes" or "no" but also "how much is left" and "what constraints apply." That turns a simple counter into a policy engine. Most teams do not make that investment.

### Maintenance burden: every new service needs the same logic

When one service has a token counter, it works fine.

When five services have token counters, each implemented slightly differently, the system has five potential sources of budget accounting bugs.

Service A uses Redis with INCR. Service B uses PostgreSQL with a row lock. Service C uses an in-memory counter because "it's just a prototype." Service D was supposed to add a counter but the team ran out of time.

The result is inconsistent enforcement, duplicated logic, and fragile coordination. Every new service that makes LLM calls must re-implement the counter pattern, or integrate with whichever shared counter exists, or — most commonly — skip it and hope for the best.

Cycles centralizes runtime authority in one service. Every client integrates through the same protocol. The budget logic lives in one place. New services call the same API. There is one source of truth for budget state.

## Comparison

| | In-App Counter | Cycles |
|---|---|---|
| **Concurrency safety** | Race conditions under parallel access | Atomic reservations — no TOCTOU bugs |
| **Multi-service** | Counter is local to one process or requires custom shared store | Centralized runtime authority accessible from any service |
| **Reservation model** | None — tracks past usage, not in-flight work | Reserve before execution, commit after, release on cancel |
| **Hierarchical scopes** | Flat — one counter, one limit | Nested — tenant → workspace → app → workflow → agent → toolset |
| **Overage policies** | Binary — allow or deny | Three-way — ALLOW, ALLOW_WITH_CAPS, DENY |
| **Maintenance** | Duplicated across services, each with its own bugs | Single integration point, one protocol, one source of truth |
| **Retry handling** | Fragile — retries may double-count or skip counting | Idempotent — retries tied to the same reservation lifecycle |
| **TTL and expiry** | Manual cleanup if at all | Built-in reservation TTL with automatic expiry and release |
| **Audit trail** | Application logs, if instrumented | Structured reservation and commit records |

## The inflection point: when to move from counters to Cycles

Custom counters are not always wrong. They are a valid solution at a certain scale.

The inflection point comes when one or more of these conditions appear.

### Multiple services making LLM calls

Once budget enforcement must span more than one service, a local counter is no longer sufficient. The coordination cost of keeping multiple counters consistent exceeds the cost of adopting a centralized authority.

### Multi-tenant deployment

When different tenants share the same infrastructure and need independent budget limits, the counter must become tenant-aware. Multiplied by hierarchical scopes (tenant, workspace, run), the counter logic becomes a budget system whether you intended to build one or not.

### Production concurrency

When agents run in parallel — multiple threads, multiple instances, multiple workflows — the TOCTOU race condition becomes a real source of overspend. Solving it correctly with custom code requires careful engineering that is hard to get right and easy to break during refactoring.

### Need for graceful degradation

When the business requires more than hard cutoffs — when "switch to a cheaper model" is the right response instead of "error 403" — a binary counter is no longer expressive enough.

### Compliance or audit requirements

When the organization needs to demonstrate that every LLM call was authorized against a budget, with a clear trail of reservations and commits, ad hoc counters do not provide the necessary structure.

If none of these apply, a custom counter may be all you need. Not every system requires a dedicated runtime authority. A prototype, a single-service application with low concurrency, or an internal tool with one user can work fine with a simple counter.

But if two or more of these conditions are present, the custom counter is likely accumulating correctness debt faster than the team can repay it.

## Migration path

Moving from custom counters to Cycles does not require a big-bang migration.

### Step 1: Deploy in shadow mode

Start Cycles in shadow mode alongside your existing counters. Cycles evaluates budget decisions but does not enforce them. Both systems run in parallel.

Compare the decisions. Does Cycles agree with your counter? Where do they diverge? Divergences usually reveal bugs in the custom counter — race conditions, missing scope checks, or inconsistent state.

See [Shadow Mode Rollout](/how-to/shadow-mode-in-cycles-how-to-roll-out-budget-enforcement-without-breaking-production) for a detailed guide.

### Step 2: Validate scope configuration

Configure Cycles with the same budget limits your counters enforce. Map your counter keys to Cycles scopes. Verify that the hierarchical scopes (tenant, workspace, workflow, run) match your application's budget structure.

### Step 3: Enable enforcement on one service

Pick the lowest-risk service — the one with the simplest counter logic and the least concurrency. Switch it from the custom counter to Cycles. Monitor for a week.

### Step 4: Roll out to remaining services

Move each service from its custom counter to Cycles. With each migration, the custom counter code can be removed. The budget logic converges on a single integration point.

### Step 5: Remove the custom counters

Once all services use Cycles, the custom counter code can be deleted. No more duplicated logic, no more inconsistent enforcement, no more race conditions in hand-rolled concurrency handling.

The result is a system where runtime authority is centralized, concurrency-safe, and consistent across every service that makes LLM calls.

## The build vs buy calculation

Building a custom counter is cheap at first. The initial implementation takes hours.

Maintaining it under production conditions costs more than most teams expect:

- Debugging race conditions that only manifest under load
- Coordinating counter logic across services during refactors
- Adding hierarchical scopes after the fact
- Building reservation semantics on top of a simple increment
- Handling edge cases around retries, crashes, and partial failures
- Explaining to the team why the budget numbers do not add up

Cycles is designed to handle these concerns from the start. It is not a better counter. It is a different primitive — a runtime authority with reservation semantics, hierarchical scopes, and concurrency safety built in.

The question is not whether you can build it yourself. You can.

The question is whether budget accounting is where your team should be spending its engineering time.

## Next steps

- Read the [Cycles Protocol](https://github.com/runcycles/cycles-protocol)
- Run the [Cycles Server](https://github.com/runcycles/cycles-server)
- Integrate with Python using the [Python Client](/quickstart/getting-started-with-the-python-client)
- Integrate with TypeScript using the [TypeScript Client](/quickstart/getting-started-with-the-typescript-client)
- Try the [End-to-End Tutorial](/quickstart/end-to-end-tutorial) — zero to a working budget-guarded LLM call in ten minutes
- [How Much Do AI Agents Actually Cost?](/blog/how-much-do-ai-agents-cost) — per-token pricing across providers and why counting tokens alone isn't enough
