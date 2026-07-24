---
title: "How to Add Hard Budget Limits to Spring AI with Cycles"
description: "Add pre-execution runtime authority to Spring AI: reserve-commit enforcement for model calls, tools, agent loops, caps, and audit records."
---

# How to Add Hard Budget Limits to Spring AI with Cycles

Most AI applications start with observability.

You log model usage.  
You watch provider dashboards.  
You add alerts for abnormal spend.  
You maybe enforce a few request-level limits.

That is useful.

But once your system starts running autonomous workflows, tool-calling loops, retries, or multi-step agent behavior, observability alone stops being enough.

At that point, you need a control layer that can decide **before execution** whether work is allowed to proceed.

That is where Cycles fits.

::: tip Cycles provides three runtime-authority pillars
- **Spend** — reserve-commit budget enforcement before instrumented LLM calls and tool actions
- **Risky actions** — callers can budget assigned `RISK_POINTS`; applications must apply preflight decisions and any configured caps
- **Audit** — reservations, commits, releases, and direct-usage events create lifecycle records; non-persisting preflight decisions need application logging
:::

## The problem

In a simple application, one request often maps to one model call.

In a real Spring AI system, one user action can become:

- multiple LLM calls
- retrieval steps
- tool invocations
- retries on transient failure
- multi-step planning
- background follow-up work

A provider dashboard can show this after the fact.

A rate limiter can slow it down.

Neither one guarantees that the workflow stays inside a hard budget boundary.

## What Cycles adds

Cycles adds a deterministic budget-control pattern around autonomous work:

1. **Reserve exposure before execution**
2. **Execute the model or tool call**
3. **Commit actual usage or release the remainder**

This turns budget enforcement into part of the runtime path, instead of a reporting function that happens later.

In a Spring AI application, that usually means guarding:

- model invocations
- tool-calling steps
- agent loop iterations
- workflow branches
- high-cost external actions

## The mental model

Think of Cycles as a **runtime authority for autonomous agents**.

Spring AI handles prompting, model interaction, retrieval, and orchestration.

Cycles handles:

- whether an action is allowed to proceed
- how much budget is reserved for it
- how actual usage is reconciled
- how limits apply across scopes such as tenant, workspace, app, workflow, or agent

The goal is not to replace Spring AI.

The goal is to add hard budget control to it.

## Where to integrate in a Spring AI application

There are several natural integration points.

### 1. Before a model call

Before invoking a chat model or completion model, reserve budget for the expected exposure.

This is the cleanest and most common place to start.

### 2. Before a tool invocation

If tools can create meaningful cost or side effects, reserve budget before the tool runs.

This matters for:

- external APIs
- search services
- database writes
- email dispatch
- ticket creation
- payment actions

### 3. Around an agent loop iteration

If your application runs iterative planning or autonomous loops, reserve budget per step or per iteration.

That gives you a bounded envelope around recursive behavior.

### 4. Around an entire workflow or run

You can also reserve and track at a higher scope:

- per tenant
- per workspace
- per app
- per workflow
- per agent

In practice, many systems use more than one level.

For example:

- tenant daily budget
- workflow execution budget
- model-call budget per step

## A simple integration flow

At a high level, the application flow looks like this:

### Step 1: Identify the scope

Determine which budget scopes apply.

Examples:

- tenant: `acme`
- app: `support-bot`
- workflow: `refund-assistant`

### Step 2: Estimate required exposure

Before calling the model or tool, estimate how much budget the step may need.

This does not need to be perfect.  
It just needs to be sufficient to reserve bounded room to act.

### Step 3: Reserve budget

Call Cycles to reserve budget for the step.

If reservation succeeds, continue.

If reservation fails, decide how to degrade:

- stop the action
- return a fallback response
- switch to a smaller model
- skip expensive tools
- move to a lower-cost workflow path

### Step 4: Execute the step

Run the Spring AI call, tool invocation, or workflow action.

### Step 5: Commit actual usage

Once actual usage is known, commit the real amount consumed. If the actual amount is less than the reserved estimate, the unused remainder is released automatically.

### Step 6: Release if canceled

If the work is canceled or fails before producing any usage, release the reservation explicitly to return the reserved amount to the budget pool.

## Example pattern

A simplified application flow might look like this:

1. user asks a question
2. app selects tenant and workflow scope
3. app reserves 100 units before invoking the chat model
4. Spring AI executes the model call
5. actual usage comes back as 68 units
6. app commits 68 (remaining 32 is released automatically)

If the next step wants to invoke an external tool, it goes through the same pattern again.

This is how hard budget boundaries become part of runtime execution.

## Why this works better than post-hoc limits

Many teams already have some form of usage tracking.

That is not the same as pre-execution budget control.

Post-hoc tracking tells you:

::: info
what happened after the work completed
:::

Cycles tells you:

::: info
whether the submitted estimate fits the matching budget ledgers, how much room remains, and what the instrumented work commits afterward
:::

Application authorization still decides whether the caller may perform the action; Cycles accounts for the submitted exposure.

That distinction becomes critical in long-running or multi-step systems.

Without it, you are often reacting after the expensive part has already happened.

## A common first use case

One of the best first integrations is:

**guard every Spring AI model call with a Cycles reservation**

Why start there?

Because it gives you immediate value with minimal architecture change. With [`cycles-spring-ai-starter`](https://github.com/runcycles/cycles-spring-ai-starter), this is literally a Maven dependency plus a few `cycles.spring-ai.*` properties — the `CallAdvisor` and `StreamAdvisor` auto-wire onto every `ChatClient` you build through the auto-configured `ChatClient.Builder`. No call-site changes.

You can begin by enforcing:

- per-tenant budget (set the tenant on `CyclesProperties`, or supply a `SubjectResolver` bean that pulls tenant from your authenticated principal)
- per-workflow budget
- optional per-run envelope by resolving that run ID into `subjects.workflow`

`run` is not a separate Cycles scope. The standard hierarchy is `tenant → workspace → app → workflow → agent → toolset`; a run ID stored only in `dimensions` is attribution and does not create an enforceable ledger.

Then expand to:

- tool invocations (opt in with `cyclesToolGate.wrap(myTool)`)
- retrieval steps
- external side-effecting actions

This staged rollout works well because you do not need to boil the ocean on day one.

## Shadow evaluation before enabling the advisors

The current `cycles-spring-ai-starter` advisors implement the live reserve → model call → commit/release lifecycle. They do not expose a shadow-mode property: a Cycles dry-run response deliberately has no `reservation_id`, while the advisor requires one before it invokes the model.

To evaluate policy before enabling the advisors, make an explicit Cycles reservation request with `dry_run: true` alongside the existing model path, then log the hypothetical decision and the model's actual usage in your application. Dry runs create no reservation, balance mutation, or commit; the current server does emit `reservation.denied` for denied evaluations, but not a complete record of allowed decisions and outcomes. Once those results meet your cutover criteria, enable the starter for live enforcement. See the [shadow-mode rollout guide](/how-to/shadow-mode-in-cycles-how-to-roll-out-budget-enforcement-without-breaking-production).

## Handling failure correctly

A real integration must handle more than the happy path.

That includes:

- retries
- worker crashes
- partial completion
- timeouts
- duplicate requests

This is why reserve, commit, and release are separate lifecycle events.

The application should not assume execution is always synchronous or clean.

A production integration should be designed so that:

- retries are idempotent
- duplicate actions do not double-spend
- incomplete work can be reconciled
- unused reservations do not leak forever

That is where Cycles adds real operational value beyond simple counters or provider dashboards.

## What to budget first

If you are integrating Cycles into Spring AI for the first time, start with the highest-value, easiest-to-measure boundaries.

A good initial rollout is:

- model calls
- tool invocations with external cost
- tenant-level daily or monthly budgets
- per-workflow execution envelopes

Do not start by trying to model every possible action in your system.

Start with the actions most likely to create budget surprises.

## Good first policies

Examples of useful first policies include:

- hard cap per tenant
- hard cap per workflow, with a run ID mapped to `subjects.workflow` when each execution needs its own ledger
- application-side dry-run evaluation before enabling the advisors on new workflows
- downgrade path when reservation fails
- application-configured tool fallback or denial handling
- per-workspace limits for staging vs production

These are practical controls that map well to real incidents.

## Why this matters for Spring AI teams

Spring AI makes it easier to build AI applications on the JVM.

As those applications become more autonomous, they need a way to bound total exposure, not just log it.

That is the role Cycles plays.

It brings:

- pre-execution budget checks
- retry-safe enforcement
- multi-scope budget enforcement
- live advisor enforcement after separate dry-run calibration
- a clean reserve → commit / release lifecycle

In other words, it gives Spring AI applications a way to move from “watching usage” to **governing execution**.

## Practical rollout plan

A simple rollout path looks like this:

### Phase 1: Observe
Issue explicit `dry_run: true` evaluations beside the existing model calls and retain the responses and actual usage in application telemetry.

### Phase 2: Guard core model usage
Add reservation and commit around the most expensive model calls.

### Phase 3: Expand to tools
Guard tool invocations and side-effecting actions.

### Phase 4: Add hierarchical budgets
Apply policies at tenant, app, and workflow scopes. Map a run ID to the workflow subject only when you intentionally want a separate ledger per execution.

### Phase 5: Enforce degradation paths
When reservations fail, downgrade or reroute instead of simply crashing.

That sequence keeps adoption manageable.

## Summary

If you are building with Spring AI, budget enforcement should not live only in dashboards, billing pages, or after-the-fact alerts.

It should be part of the execution path.

Cycles makes that possible by introducing a deterministic runtime pattern:

- reserve before execution
- commit actual usage afterward (unused remainder is released automatically)
- release explicitly if work is canceled
- enforce policy across scopes
- stay safe under retries and concurrency

That is how Spring AI systems move from useful prototypes to governed production runtimes.

## Next steps

For the Spring AI integration specifically:

- **Start here:** [Integrating Cycles with Spring AI](/how-to/integrating-cycles-with-spring-ai) — concrete Maven/Gradle setup, configuration reference, code examples for the auto-wired chat advisor, per-tool gating, observation convention, and the v0.3.0 extension points (`SubjectResolver` for per-request attribution, `PromptTokenEstimator` for real BPE token counts).
- **Starter on GitHub:** [`cycles-spring-ai-starter`](https://github.com/runcycles/cycles-spring-ai-starter) — Spring AI-specific advisors auto-wired onto every `ChatClient`. Companion to `cycles-spring-boot-starter` (used for non-Spring-AI Spring Boot code paths via the `@Cycles` annotation).

To explore the broader Cycles stack:

- Read the [Cycles Protocol](https://github.com/runcycles/cycles-protocol)
- Run the [Cycles Server](https://github.com/runcycles/cycles-server)
- Manage budgets with [Cycles Admin](https://github.com/runcycles/cycles-server-admin)
- Integrate with Python using the [Python Client](/quickstart/getting-started-with-the-python-client)
- Integrate with TypeScript using the [TypeScript Client](/quickstart/getting-started-with-the-typescript-client)
