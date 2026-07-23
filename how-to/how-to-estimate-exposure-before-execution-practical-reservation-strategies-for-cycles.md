---
title: "How to Estimate Exposure Before Execution: Practical Reservation Strategies for Cycles"
description: "Practical strategies for estimating budget reservations before execution, including how to handle over- and under-reserving in Cycles."
---

# How to Estimate Exposure Before Execution: Practical Reservation Strategies for Cycles

One of the first practical questions teams ask when adopting Cycles is:

**How do we know how much to reserve before the work actually runs?**

That is the right question.

Cycles requires a system to reserve bounded exposure before execution, then commit actual usage afterward. But many real workloads do not know their exact final cost in advance.

A model call may return sooner than expected.  
A tool path may branch differently.  
A workflow may exit early.  
A retry may or may not happen.  
An agent may decide not to invoke a tool after all.

This is normal.

Cycles does not require perfect prediction.  
It requires a reservation strategy that is **good enough to bound execution before work starts**, while still allowing accurate reconciliation afterward.

This article explains practical ways to estimate exposure before execution, how to think about over-reserving versus under-reserving, and how teams can improve reservation quality over time.

## The goal is not perfect prediction

A common mistake is to think reservation only works if the system can predict exact usage in advance.

That is not how real systems behave.

Reservation is not a prophecy.  
It is a **bounded allowance**.

The system is asking:

::: info
How much room should this action be allowed to consume before it proceeds?
:::

That means a useful estimate should be:

- directionally reasonable
- safe enough for the action type
- tied to likely execution shape
- reconcilable against actual usage later

Perfect precision is not required.

## Why estimation matters

The reservation amount affects both safety and usability.

If you reserve too little:

- the system may deny actions that should have been allowed
- work may run out of budget too early
- expensive steps may not have enough room to complete safely
- policy may become brittle

If you reserve too much:

- too much budget is tied up temporarily
- other work may be denied unnecessarily
- tenant or run pressure may appear higher than it really is
- capacity may look artificially constrained

This is why reservation quality matters, even if perfection is impossible.

## A simple mental model

Think of reservation as an **execution envelope**.

The estimate does not need to equal the exact final usage.

It needs to define a bounded space in which the action is allowed to operate.

Then, once execution finishes:

- actual usage is committed
- unused remainder is released

That means reservation quality should be judged by whether it creates a usable and safe envelope, not by whether it predicts the future exactly.

## The main reservation strategies

There is no single correct estimation method.

Most teams start with one or more of these strategies:

- fixed reservation
- class-based reservation
- heuristic reservation
- historical percentile reservation
- stepwise reservation
- conservative plus degradation reservation

Each has tradeoffs.

## 1. Fixed reservation

This is the simplest strategy.

Every action of a given type reserves the same amount.

Examples:

- every chat model call reserves 100 units
- every web search tool call reserves 25 units
- every workflow step reserves 50 units

### Why fixed reservation is useful

It is easy to explain and easy to implement.

It is often the best first strategy when:

- the team is just starting
- the action shape is fairly stable
- the first goal is getting Cycles into production
- shadow mode is being used to calibrate later

### Limitations

Fixed reservation can be too blunt when action cost varies widely.

It may lead to:

- chronic over-reservation for cheap actions
- under-reservation for expensive ones
- poor fit for broad workflow classes

Still, it is often a very good first rollout.

## 2. Class-based reservation

This strategy uses different fixed reservations for different classes of actions.

Examples:

- small-model call = 40 units
- large-model call = 120 units
- read-only tool = 20 units
- external write-capable tool = 80 units
- short workflow step = 30 units
- high-risk workflow step = 150 units

### Why class-based reservation is useful

It is more expressive than one flat number, while still staying operationally simple.

This is often the best next step after fixed reservation.

It works well when the team can identify clear categories such as:

- model size
- tool type
- side-effect level
- workflow tier
- risk class

### Limitations

Class definitions can drift over time, and some actions still vary a lot within a class.

But for many systems, class-based reservation offers a strong balance between simplicity and control.

## 3. Heuristic reservation

This strategy estimates exposure based on properties known before execution.

Examples:

- expected token count
- prompt length
- number of tool candidates
- workflow type
- whether retrieval is enabled
- whether external side effects are possible
- current phase of the run
- whether the model is large or small

### Why heuristic reservation is useful

It allows reservation to respond to real input shape.

For example:

- larger prompts may reserve more
- tool-enabled calls may reserve more than model-only calls
- workflows with write capability may reserve more than read-only workflows

### Limitations

Heuristics can become overly complicated if the team tries to model too many variables too early.

A good heuristic should improve safety and fit without turning into a fragile prediction engine.

## 4. Historical percentile reservation

This strategy uses observed past usage to set reservation levels.

For example:

- reserve at the 90th percentile of prior actual usage for this action class
- reserve at the 95th percentile for high-side-effect actions
- reserve based on rolling usage history for a workflow type

### Why historical percentile reservation is useful

It is grounded in real system behavior.

This often works well once the team has enough observed usage from:

- shadow mode
- production logs
- stable workflow patterns
- repeated model/tool usage classes

### Limitations

Historical strategies can be misleading when:

- workflows change rapidly
- new action types have little history
- usage distributions are unstable
- tail-risk actions matter more than the average

Still, percentile-based reservation is often one of the best ways to improve estimate quality over time.

## 5. Stepwise reservation

This strategy reserves separately at each step rather than trying to reserve one large amount for an entire run upfront.

Examples:

- reserve for the next model call
- commit actual usage
- reserve again for the next tool step
- repeat as the workflow evolves

### Why stepwise reservation is useful

It matches the reality that many autonomous workflows unfold incrementally.

The system often knows much more about the next step than the entire future path.

This can reduce unnecessary over-reservation.

It is especially useful for:

- agent loops
- tool-calling systems
- branching workflows
- uncertain execution paths

### Limitations

Stepwise reservation introduces more lifecycle events and may require tighter integration with the runtime.

But in many autonomous systems, it is the most realistic strategy.

## 6. Conservative plus degradation reservation

This strategy intentionally reserves conservatively, then uses degradation when reservation fails.

Examples:

- reserve enough for the high-quality path
- if reservation fails, retry with a smaller model estimate
- if reservation still fails, disable optional tools
- if reservation still fails, deny or defer

### Why this is powerful

It allows the system to combine estimation with policy.

Instead of trying to predict one perfect number, the platform can ask:

- is the premium path affordable?
- if not, is the cheaper path affordable?
- if not, should optional capability be removed?
- if not, should execution stop?

This is often a more robust operational model than insisting on one “correct” estimate.

## Choosing the right strategy

A simple rule works well:

- use **fixed** when you need the fastest first rollout
- use **class-based** when action categories are clear
- use **heuristics** when pre-execution signals are meaningful
- use **historical percentiles** when behavior is stable and measured
- use **stepwise** when workflows evolve dynamically
- use **conservative plus degradation** when multiple execution paths exist

In practice, many mature systems combine several of these.

## A practical rollout path

Most teams should not begin with sophisticated estimation.

A strong rollout path is:

### Phase 1: Fixed or class-based reservation

Get reserve → commit / release working first.

### Phase 2: Shadow measurement

Compare estimates with actual usage.

Look for:

- chronic over-reservation
- chronic under-reservation
- high-variance action classes
- workflows with unstable cost shape

### Phase 3: Add simple heuristics or percentiles

Improve the biggest mismatches first.

Do not optimize everything at once.

### Phase 4: Add degradation-aware reservation

Introduce cheaper fallback paths when premium paths cannot reserve enough budget.

This is usually the point where estimation becomes part of a broader control strategy instead of a standalone numeric exercise.

## How to think about over-reserving vs under-reserving

This is one of the most important design decisions.

### Over-reserving

Over-reserving is safer in the sense that work is less likely to run out of budget unexpectedly.

But it can also create:

- false pressure on shared scopes
- unnecessary denials
- poor concurrency utilization
- operator confusion about apparent scarcity

### Under-reserving

Under-reserving makes budget look more available than it really is.

But it can also lead to:

- actions getting partway through without enough room
- repeated reservation failures mid-run
- weaker protection against expensive paths
- policy that appears permissive but is actually fragile

### The right balance

A good default is:

- slightly conservative for high-risk or high-side-effect actions
- tighter and more efficient for stable low-risk actions

Not every action class should be treated the same.

## Estimation should reflect action shape, not only cost

Another common mistake is to think only in terms of average spend.

A better question is:

::: info
What kind of action is this, and how uncertain is its execution path?
:::

For example:

- a deterministic read-only lookup may need a narrow envelope
- a model call with optional retrieval may need a broader one
- a tool-enabled planning step may need a much broader one
- a side-effecting action may justify conservative reservation even if average cost is low

This is why action shape matters just as much as average usage.

## Good first estimation rules

If a team is starting from scratch, these are often strong defaults:

- use fixed reservation for model calls
- use class-based reservation for tools
- reserve more for write-capable or irreversible actions
- reserve by workflow tier for high-level runs
- use stepwise reservation for multi-step agents
- improve with shadow-mode measurement before adding complexity

This gets you operational value quickly without over-engineering.

## What to measure while improving estimates

A team refining reservation quality should track:

- estimate vs actual ratio
- denial frequency by action class
- unused remainder by action class
- actions that regularly exceed estimate
- workflows with high variance
- pressure at tenant, workflow, and run scopes
- degradation frequency when premium reservations fail

These signals tell you where the estimate strategy is helping and where it needs refinement.

## Common mistakes

### Mistake 1: Waiting for perfect estimates before rollout

This delays adoption unnecessarily.

Start with a reasonable envelope and improve from real usage.

### Mistake 2: Using one global reservation number for everything

This is simple, but often too blunt once workflows vary meaningfully.

### Mistake 3: Making estimation logic too complex too early

If the estimation model is hard to explain, it will be hard to trust and operate.

### Mistake 4: Ignoring the difference between risky and merely expensive actions

Side-effecting actions may justify more conservative reservation even when average cost is not high.

### Mistake 5: Failing to compare estimates with actuals

Without feedback, reservation quality does not improve.

## A useful principle

A reservation strategy is good when it helps the system:

- bound execution before work starts
- avoid unnecessary denial
- reconcile cleanly afterward
- remain understandable to operators
- improve over time from observed behavior

That is the standard.

Not prediction perfection.

## Summary

Cycles does not require exact foresight.

It requires a practical way to reserve bounded room for execution before work begins, then reconcile actual usage afterward.

Teams can do that with strategies such as:

- fixed reservation
- class-based reservation
- heuristic estimation
- historical percentile tuning
- stepwise reservation
- conservative reservation plus degradation

The best first strategy is usually the simplest one that creates a safe and understandable execution envelope.

From there, real usage data can make estimates better over time.

That is how reservation becomes operationally useful instead of theoretically perfect.

## Next steps

To explore the Cycles stack:

- Read the [Cycles Protocol](https://github.com/runcycles/cycles-protocol)
- Run the [Cycles Server](https://github.com/runcycles/cycles-server)
- Manage budgets with [Cycles Admin](https://github.com/runcycles/cycles-server-admin)
- Integrate with Python using the [Python Client](/quickstart/getting-started-with-the-python-client)
- Integrate with TypeScript using the [TypeScript Client](/quickstart/getting-started-with-the-typescript-client)
- Integrate with Spring Boot or Spring AI using the [Spring Boot starter](https://github.com/runcycles/cycles-spring-boot-starter) or the [Spring AI starter](https://github.com/runcycles/cycles-spring-ai-starter)
