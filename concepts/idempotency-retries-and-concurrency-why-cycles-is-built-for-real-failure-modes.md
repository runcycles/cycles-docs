---
title: "Idempotency, Retries, and Concurrency in Cycles"
description: "Learn how Cycles handles idempotency, retries, and concurrency to provide reliable budget enforcement under real-world failure conditions."
---

# Idempotency, Retries, and Concurrency: Why Cycles Is Built for Real Failure Modes

Most budget systems look correct in the happy path.

A request arrives.  
The system checks a counter.  
Work executes.  
Usage is recorded.  
Everything looks fine.

Real systems do not behave that cleanly.

They retry.  
They time out.  
They crash halfway through execution.  
They send duplicate requests.  
They run multiple workers at once.  
They fan out across steps that all consume budget concurrently.

That is where naive accounting breaks down.

Cycles is built for these conditions on purpose.

It is not only a budgeting model.  
It is a runtime control model designed for failure, duplication, and concurrent execution.

## Why happy-path accounting is not enough

A simple usage counter can tell you how much was spent after work is done.

That may be enough for reporting.

It is usually not enough for safe enforcement.

Consider a few common failure cases:

- a client retries because it did not receive a response
- a worker crashes after reservation but before reconciliation
- two workers both try to reserve against the same remaining budget
- a duplicate message is processed twice
- a workflow branch commits usage after a parent path already retried
- actual usage arrives late, out of order, or more than once

If the accounting model is not designed for these cases, the system tends to produce one of three outcomes:

- accidental double-spend
- false denials caused by leaked reservations
- inconsistent enforcement under concurrency

These are not edge cases in autonomous systems.  
They are normal operating conditions.

## The problem with naive budget checks

A naive budget check often looks like this:

1. read current balance
2. compare against requested amount
3. if enough remains, proceed
4. update the balance later

That seems reasonable until two things happen at once.

For example:

- worker A reads available budget = 100
- worker B reads available budget = 100
- both decide to proceed
- both consume 80

Now the system has allowed 160 units of work against 100 units of available budget.

This is the classic race condition that appears whenever control decisions are separated from atomic state changes.

Cycles exists to avoid this category of failure.

## Why idempotency matters

Idempotency means the same logical action can be retried safely without being counted multiple times.

This is essential because retries happen for many reasons:

- the client timed out waiting for a response
- the network dropped after the server processed the request
- a worker crashed after partially completing work
- a message broker redelivered the same event
- an upstream service retried defensively

Without idempotency, every retry looks like a new request.

That can create:

- duplicate reservations
- duplicate commits
- duplicate releases
- budget drift
- over-counting that has nothing to do with real usage

In a production control plane, retry safety is not optional.  
It is part of correctness.

## Why reservation alone is not enough

Some systems try to solve budgeting with simple pre-checks or flat quota decrements.

That helps, but it is still incomplete.

Cycles uses a lifecycle:

1. reserve
2. execute
3. commit actual usage or release the remainder

Each part exists because execution is messy.

### Reserve

Reserve creates bounded room to act before work begins.

### Commit

Commit reconciles estimated usage with actual usage after work completes.

### Release

Release returns any unused reservation when work exits early, is canceled, or consumes less than expected.

Without all three, real failure handling becomes unreliable.

## Retries create two different kinds of problems

Retries are often discussed as one thing, but they actually create two different accounting problems.

### 1. Duplicate intent

The same logical operation may be submitted more than once.

Example:

- the client sends a reservation request
- the server processes it
- the response is lost
- the client retries

If the second request is treated as new, the system may reserve twice.

### 2. Duplicate completion

The same execution may attempt to commit or release more than once.

Example:

- a worker completes a task
- commit is sent
- timeout occurs before acknowledgment
- the worker retries the commit

If commit is not idempotent, the system may count actual usage multiple times.

Both problems are common.  
Both must be handled explicitly.

## Why concurrency changes everything

Concurrency is where many “good enough” budget systems fail.

A single-threaded demo can make almost anything look correct.

Production systems are different.

Multiple requests may:

- reserve simultaneously
- commit simultaneously
- release simultaneously
- affect shared parent scopes
- race at both local and ancestor levels

This becomes even more complex in hierarchical models where one action may consume budget from several scopes at once, such as:

- tenant
- workflow
- run

If these mutations are not handled carefully, concurrency breaks the guarantee that budgets are meant to provide.

That is why Cycles is built around deterministic reservation semantics rather than loose after-the-fact reconciliation.

## Hierarchical budgets make naive logic even less safe

Flat counters are already easy to get wrong.

Hierarchical governance makes the problem more important.

Suppose an action must be valid against:

- tenant budget
- workflow budget
- run budget

A naive system might check these one at a time without a coherent control model.

That can create partial success conditions such as:

- local scope looks valid
- ancestor scope is exhausted
- a concurrent request changes shared state between checks
- a retry replays part of the sequence

Now the system has to answer difficult questions:

- was the action really allowed?
- what should be rolled back?
- which scopes were partially consumed?
- did duplicate handling happen consistently?

This is why budget control in autonomous systems cannot be reduced to “just keep a counter.”

## What Cycles is designed to protect against

Cycles is built for conditions like:

- duplicate reservation attempts
- duplicate commit attempts
- duplicate release attempts
- worker crashes after reserve
- worker crashes after partial execution
- network retries
- concurrent reservation pressure
- hierarchical scope contention
- partial completion with leftover reserved budget

These are the conditions that make simple usage tracking insufficient.

They are also the conditions that determine whether a control layer can be trusted in production.

## Why commit and release must be explicit lifecycle events

A common mistake is to assume that if work starts and finishes normally, accounting is easy.

But real systems often produce incomplete execution paths.

For example:

- work reserves budget but exits before making the expensive call
- work consumes only part of the reserved amount
- work completes but the accounting acknowledgment is delayed
- work is retried by a second worker while the first result is uncertain

If commit and release are not first-class lifecycle events, the system has no clean way to reconcile what actually happened.

That creates either leakage or double counting.

Explicit lifecycle events make these transitions governable.

## Why observability alone is not enough

Some teams try to solve these issues with logging, traces, dashboards, and periodic reconciliation.

Those are valuable tools.

They are not the same as runtime correctness.

Observability can tell you:

- a duplicate happened
- a retry occurred
- usage drift appeared
- a workflow behaved oddly

But it cannot prevent the initial overage or race by itself.

A runtime authority must do more than explain failure after the fact.  
It must remain correct enough under failure to make enforcement meaningful.

## A concrete example

Imagine a workflow step that estimates it needs 100 units.

The system reserves 100 and begins execution.

Then:

- the worker calls a model
- the model call succeeds
- the worker crashes before commit
- the job is retried on another worker

Now the platform must reason about several things:

- was the original reservation already created?
- should the retry create another reservation?
- did actual usage already happen once?
- if the retry commits, is that a duplicate or new consumption?
- if the original reservation is still outstanding, when is the remainder released?

This is not a rare corner case.  
This is exactly the kind of ambiguity production systems create.

A runtime model that ignores these realities becomes financially noisy and operationally untrustworthy.

## Cycles is about bounded execution under uncertainty

One of the key ideas behind Cycles is that enforcement has to survive imperfect information.

At the moment a decision is made, the system may not yet know:

- whether a prior request will be retried
- whether a worker will crash
- whether actual usage will equal the estimate
- whether another concurrent path is about to consume shared budget

That is why Cycles does not rely on a single final usage event.

It uses a lifecycle that can tolerate uncertainty more gracefully:

- reserve bounded room first
- execute work
- reconcile actuals later
- return unused remainder
- remain safe under duplicate and concurrent behavior

## What “real failure modes” means in practice

When we say Cycles is built for real failure modes, we mean it is designed for environments where the following are normal:

- retries are expected
- duplicate delivery happens
- workers fail mid-flight
- state transitions are not perfectly synchronized
- multiple actors compete for shared budget
- long-running workflows can outlive the request that started them

This is the world of production autonomous systems.

A budget system that assumes clean sequential execution may work in a demo and fail in the exact situations where control matters most.

## The design goal

The design goal is not to pretend failure disappears.

The design goal is to make budget governance remain meaningful even when failure occurs.

That means the system should strive to ensure that:

- the same logical action is not charged multiple times by accident
- concurrent actions cannot overrun budget due to naive race conditions
- partial execution can be reconciled explicitly
- reservations do not leak forever
- retries do not make accounting non-deterministic
- enforcement remains understandable under load

This is what separates a production control layer from a reporting wrapper.

## Summary

Autonomous systems operate in an environment shaped by retries, crashes, duplicates, and concurrency.

Any budget control model that ignores these realities will eventually produce drift, ambiguity, or broken enforcement.

That is why Cycles is built around:

- reservation before execution
- commit of actual usage afterward
- release of unused remainder
- idempotent lifecycle handling
- concurrency-aware budget enforcement
- hierarchical policy evaluation across scopes

These are not implementation details.

They are the difference between “tracking usage” and **governing execution under real production conditions**.

## Next steps

To explore the Cycles stack:

- Read the [Cycles Protocol](https://github.com/runcycles/cycles-protocol)
- Run the [Cycles Server](https://github.com/runcycles/cycles-server)
- Manage budgets with [Cycles Admin](https://github.com/runcycles/cycles-server-admin)
- Integrate with Python using the [Python Client](/quickstart/getting-started-with-the-python-client)
- Integrate with TypeScript using the [TypeScript Client](/quickstart/getting-started-with-the-typescript-client)
- Integrate with Spring AI using the [Spring Client](https://github.com/runcycles/cycles-spring-boot-starter)
- [5 Real-World AI Agent Failures That Budget Controls Would Have Prevented](/blog/ai-agent-failures-budget-controls-prevent) — concrete incidents involving retry storms and concurrency races
- [From Observability to Enforcement](/concepts/from-observability-to-enforcement-how-teams-evolve-from-dashboards-to-budget-authority) — how teams evolve from dashboards to runtime authority
- [Cycles vs Custom Token Counters](/concepts/cycles-vs-custom-token-counters) — why ad hoc counters break under the concurrency and retry patterns discussed here
