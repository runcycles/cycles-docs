---
title: "How Reserve → Commit Works in Cycles"
description: "Understand the reserve-then-commit lifecycle in Cycles that enforces budget limits before work begins, not after. Covers reserve, commit, and release operations."
---

# How Reserve → Commit Works in Cycles

Most systems discover usage after work is already done.

A model call finishes.  
A tool runs.  
A database is written.  
A provider bill updates later.  
A dashboard shows the damage after the fact.

That is observability.

It is not control.

Cycles uses a different model:

1. **Reserve exposure before execution**
2. **Execute the work**
3. **Commit actual usage or release the remainder**

This is the core execution pattern in Cycles.

It is what makes budget control work in systems with retries, loops, concurrency, and long-running workflows.

## Why reserve first?

In autonomous systems, cost and side effects are often created by software that keeps acting after the initial request is gone.

An agent may:

- call multiple models
- invoke tools recursively
- retry on failure
- fan out into parallel steps
- continue in the background

If you only measure usage after these actions complete, you are not really governing execution.

You are auditing it after the fact.

Reservation changes that.

Before work starts, the system asks:

::: info
Is this action allowed to consume up to this amount of exposure?
:::

If the answer is no, the action can be denied, downgraded, deferred, or rerouted before cost or side effects occur.

## The basic lifecycle

At a high level, Cycles follows this pattern:

### 1. Declare intent

An action identifies the scope and the estimated amount of exposure it may need.

That may correspond to:

- a model call
- a tool invocation
- a workflow step
- an agent run
- any other governable action

### 2. Reserve budget

The runtime attempts to reserve that amount against the relevant budget scopes.

If reservation succeeds, the action is allowed to proceed.

If reservation fails, the system can stop or degrade the action before execution.

### 3. Execute

The work runs.

At this point, the system knows it is operating within a bounded allowance.

### 4. Commit actual usage or release

Once the real usage is known, the runtime commits the actual amount consumed.

If the actual amount is lower than the reserved amount, the unused portion is released automatically as part of the commit. No separate release call is needed.

If work is canceled or fails before any usage occurs, the runtime releases the reservation explicitly, returning the full reserved amount to the budget pool.

::: tip SDK behavior
All official Cycles SDKs — Spring [`@Cycles`](https://github.com/runcycles/cycles-spring-boot-starter), TypeScript [`withCycles`](https://github.com/runcycles/cycles-client-typescript), and Python [`@cycles`](https://github.com/runcycles/cycles-client-python) — implement this lifecycle automatically: commit on success, release on any exception, and retry on transient commit failures. See each SDK's README for the complete budget-outcome-by-scenario table.
:::

## A simple example

Suppose an agent wants to run a tool-assisted task and estimates it may consume 100 units.

The lifecycle looks like this:

1. Reserve 100
2. Execute the task
3. Actual usage ends up being 63
4. Commit 63 (the remaining 37 is released automatically)

Without this model, many systems do one of two bad things:

- they block based on rough static quotas
- they allow execution freely and reconcile later

Cycles allows bounded execution with reconciliation afterward.

## Why commit matters

Reservation alone is not enough.

If you reserve budget and never reconcile actual usage, your system becomes inaccurate very quickly.

You need commit because estimated cost and actual cost are often different.

For example:

- a model call returns sooner than expected
- a tool path exits early
- a workflow skips downstream actions
- a retry path consumes more than the optimistic estimate

Commit turns reserved intent into actual accounted usage.

That keeps balances meaningful.

## Why release matters

Release is just as important as commit.

If you reserve exposure and do not return unused portions, the system slowly accumulates phantom consumption.

That causes two problems:

- budgets appear tighter than they really are
- future work is denied unnecessarily

When actual usage is committed, the protocol automatically releases the unused remainder. But when work is canceled or fails before committing, the runtime must explicitly release the reservation.

Explicit release is especially important for:

- canceled jobs
- partially completed workflows where no usage should be recorded
- guarded speculative execution
- early exits
- timeout handling

## Reserve → commit is different from post-hoc usage tracking

A lot of systems already track usage.

That is not the same thing.

Post-hoc tracking says:

::: info
We can tell you what happened after execution.
:::

Reserve → commit says:

::: info
We decide whether work may proceed before execution, then reconcile actual usage afterward.
:::

That difference is the entire point.

The first model supports reporting.  
The second supports governance.

## Reserve → commit is different from flat quotas

Flat quotas are useful, but limited.

A quota might say:

- tenant A can spend 10,000 units today
- workflow B can use 500 units per run

That helps at the policy level.

But execution still needs a transactional pattern.

Reserve → commit provides that operational layer.

It answers questions like:

- can this action proceed right now?
- how much room has already been set aside?
- how do we avoid double counting?
- what happens if execution fails halfway through?
- how do we reconcile estimates with actuals?

## Why this matters under retries

Retries are one of the main reasons Cycles exists.

In real systems, retries happen because of:

- transient provider errors
- network instability
- worker crashes
- downstream timeouts
- optimistic retry logic

Without careful accounting, retries often create double-spend or hidden overages.

A reserve → commit model, combined with idempotency, gives the runtime a way to keep retries safe.

Instead of each retry being treated as brand-new spend, the system can reason about the same execution lifecycle consistently.

That is how you move from “best effort cost control” to deterministic budget enforcement.

## Why this matters under concurrency

Concurrency makes naive accounting unreliable.

Two workers can both believe budget is available.  
Two steps can race.  
A parent workflow and child tasks can all consume at once.

If accounting is not designed for this, you get inconsistent enforcement, accidental overages, or brittle locking.

Cycles is built around reservation semantics so the system can make budget decisions before work proceeds, rather than discovering collisions only after usage has already occurred.

## Hierarchical reservation

In Cycles, reservation is not limited to one flat counter.

An action may need to satisfy multiple scopes at once, such as:

- tenant
- workspace
- app
- workflow
- agent
- toolset

That means a reservation may need to be valid not only locally, but also against ancestor scopes.

This is important because real systems often need both:

- a global budget boundary
- more specific per-run or per-agent boundaries

Reserve → commit works cleanly with hierarchical governance because the runtime can check and enforce multiple levels before execution begins.

## What happens when reservation fails?

A failed reservation is not just a denial event.

It is a policy decision point.

Depending on the system, failure may result in:

- hard stop
- retry later
- downgrade to a smaller model
- disable expensive tools
- switch to read-only behavior
- reduce concurrency
- require operator approval

This is another reason reserve → commit is powerful.

It creates a place to make a bounded decision before irreversible work begins.

## What happens when work crashes?

Real workflows fail halfway through.

A worker may crash after reservation but before commit.  
A process may be terminated.  
A network partition may delay reconciliation.

A usable budget system has to handle these cases explicitly.

That is why Cycles treats reserve, commit, and release as separate lifecycle events rather than assuming execution is always clean and synchronous.

This lets runtimes manage incomplete work more safely and reconcile state intentionally.

## Mental model

A simple way to think about it is:

- **Reserve** = hold bounded room to act
- **Commit** = record what was actually consumed (auto-releases unused remainder)
- **Release** = cancel the reservation and return what was held

That is the core accounting discipline.

Without reserve, budgets are advisory.  
Without commit, estimates drift from reality.  
Without release, unused allocations become silent waste.

## Why this model matters

Reserve → commit is not extra ceremony.

It is the difference between:

- hoping autonomous systems stay within budget
- and making budget enforcement part of execution itself

As systems become more autonomous, they need more than request throttling and usage dashboards.

They need a runtime model that can:

- authorize bounded work before execution
- keep accounting stable under retries
- reconcile actual usage afterward
- enforce policy across scopes
- degrade safely when budgets are tight

That is what Cycles provides.

## Next steps

To see where this model is defined and implemented:

- Read the [Cycles Protocol](https://github.com/runcycles/cycles-protocol)
- Run the [Cycles Server](https://github.com/runcycles/cycles-server)
- Manage budgets with [Cycles Admin](https://github.com/runcycles/cycles-server-admin)
- Integrate with Python using the [Python Client](/quickstart/getting-started-with-the-python-client)
- Integrate with TypeScript using the [TypeScript Client](/quickstart/getting-started-with-the-typescript-client)
- Integrate with Spring Boot or Spring AI using the [Spring Boot starter](https://github.com/runcycles/cycles-spring-boot-starter) or the [Spring AI starter](https://github.com/runcycles/cycles-spring-ai-starter)
