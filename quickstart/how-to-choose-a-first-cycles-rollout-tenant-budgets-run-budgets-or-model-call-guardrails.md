---
title: "Your First Cycles Rollout: Budgets vs Guardrails"
description: "Decide where to start with Cycles: tenant budgets for cost isolation, run budgets for runaway prevention, or model-call guardrails for low-friction adoption."
---

# How to Choose a First Cycles Rollout: Tenant Budgets, Run Budgets, or Model-Call Guardrails?

One of the first questions teams ask after understanding Cycles is:

**Where should we start?**

That is the right question.

A good first rollout is not the most complete rollout.  
It is the rollout that gives meaningful control quickly, with the least operational friction.

Most teams do not need to model every scope, every workflow, and every action on day one.

They need one of three practical starting points:

- **tenant budgets**
- **run budgets**
- **model-call guardrails**

Each is valid.  
Each solves a different problem.  
The best choice depends on the failure mode you are trying to prevent first.

## The wrong way to start

A common mistake is to begin with a fully generalized policy hierarchy:

- tenant
- workspace
- app
- workflow
- agent
- toolset
- action type
- model class
- side-effect category

That may be a good end state.

It is usually a bad starting point.

Why?

Because early adoption succeeds when policy is:

- easy to explain
- easy to observe
- tied to real incidents
- narrow enough to tune
- valuable enough to justify operational change

The first Cycles rollout should solve a visible problem, not express the entire ontology of your platform.

## The three best starting points

Most first rollouts should begin with one of these:

### 1. Tenant budgets

Start here if your first priority is **platform economics and customer isolation**.

### 2. Run budgets

Start here if your first priority is **preventing runaway execution**.

### 3. Model-call guardrails

Start here if your first priority is **getting a minimal, low-friction integration into production**.

These are not competing strategies forever.  
They are different first wedges.

## Option 1: Start with tenant budgets

Tenant budgets are usually the best first rollout when the core concern is:

- one customer consuming too much
- lack of multi-tenant isolation
- weak plan enforcement
- surprise provider bills
- no hard per-account usage boundary

A tenant budget answers:

::: info
How much total exposure is this customer allowed to create?
:::

That makes it a strong economic and operational starting point.

### Why tenant budgets are attractive

Tenant budgets are easy to explain.

You can say:

- each tenant gets a daily, weekly, or monthly envelope
- all governed actions count against that envelope
- once exhausted, certain actions stop, downgrade, or defer

This is intuitive for operators, finance, product, and customer-facing teams.

### What tenant budgets solve well

Tenant budgets are strong at:

- hard customer-level limits
- usage isolation
- paid plan enforcement
- predictable top-level exposure boundaries
- straightforward dashboarding and reporting

### What tenant budgets do not solve alone

They do not fully protect against:

- a single runaway run inside a healthy tenant
- workflow-specific over-consumption
- repeated tool loops in one execution
- noisy local failure modes that stay under tenant ceilings

So tenant budgets are often a strong commercial first step, but not always the strongest operational safety step.

### Choose tenant budgets first if:

- you are multi-tenant
- spend isolation is the immediate pain
- you need clear account-level boundaries
- customer over-consumption is more urgent than runaway loops
- you want the easiest policy story for internal stakeholders

## Option 2: Start with run budgets

Run budgets are usually the best first rollout when the core concern is:

- loops
- recursive tool use
- retry storms
- agent over-execution
- long-running workflows that drift out of bounds

A run budget answers:

::: info
How much exposure can this individual execution consume before it must stop or degrade?
:::

That makes it the strongest first step for many autonomous systems.

### Why run budgets are attractive

Run budgets map directly to the incident that usually forces teams to care:

- one agent got stuck
- one workflow kept retrying
- one process used tools too many times
- one background task consumed far more than intended

Run budgets are where “bounded execution” becomes real.

### What run budgets solve well

Run budgets are strong at:

- stopping runaway loops
- limiting recursive tool chains
- bounding one workflow execution
- protecting against local over-consumption
- creating clear envelopes around autonomous behavior

### What run budgets do not solve alone

They do not fully protect against:

- aggregate tenant overuse across many healthy runs
- plan-level commercial limits
- one customer launching many runs in parallel
- uneven cost distribution across workflow types

So run budgets are often the strongest operational safety wedge, but not the full economic model.

### Choose run budgets first if:

- your biggest fear is runaway execution
- you have already seen loops, retries, or recursive tool behavior
- you want the fastest path to bounded autonomy
- you care more about local incident prevention than plan enforcement
- your system is agentic or workflow-heavy

## Option 3: Start with model-call guardrails

Model-call guardrails are usually the best first rollout when the core concern is:

- keeping integration simple
- proving value quickly
- getting Cycles into production with minimal architecture change
- controlling the most obvious source of cost first

A model-call guardrail means:

- reserve before a model invocation
- execute the call
- commit actual usage afterward (unused remainder is released automatically)
- or release explicitly if the call is canceled

This is often the easiest place to introduce Cycles because model calls are already clear cost events.

### Why model-call guardrails are attractive

They have the lowest integration friction.

Instead of redesigning all workflow and tool policy upfront, the team can start by guarding the most expensive or frequent model calls.

This works especially well in Spring AI or JVM systems where the first integration surface is already clear.

### What model-call guardrails solve well

They are strong at:

- putting hard checks around model spend
- proving reserve → commit in a small surface area
- enabling shadow mode quickly
- creating an adoption path without deep workflow modeling
- reducing initial rollout complexity

### What model-call guardrails do not solve alone

They do not fully protect against:

- tool costs
- side-effecting actions
- whole-run overages across many steps
- tenant-level aggregate usage
- expensive non-model paths

So they are often the easiest first rollout, but not the most complete.

### Choose model-call guardrails first if:

- you want the lowest-friction first integration
- model usage is your dominant cost center
- you are integrating through Spring AI or a similar runtime
- you want to prove Cycles value before adding broader policy
- your current system is not yet deeply autonomous but is heading there

## How to decide among the three

A simple decision rule works well.

### Choose tenant budgets when the first problem is:
**Who is allowed to consume how much overall?**

### Choose run budgets when the first problem is:
**How do we stop one execution from going too far?**

### Choose model-call guardrails when the first problem is:
**What is the smallest useful place we can start enforcing?**

That framing usually makes the right first rollout obvious.

## A quick decision matrix

### Start with tenant budgets if:
- you are multi-tenant
- customers need isolated limits
- commercial plan boundaries matter now
- leadership wants predictable account-level controls
- the platform needs a top-level spend envelope

### Start with run budgets if:
- you have agent loops or autonomous workflows
- runaway execution is the main incident class
- retries and recursive tools are common
- local execution safety matters most
- one bad run can cause meaningful damage

### Start with model-call guardrails if:
- you want a simple first integration
- you already know where model calls happen
- LLM spend is the most obvious first budget surface
- you need to demonstrate value fast
- you want to start in shadow mode with minimal disruption

## What I would recommend by system type

### Multi-tenant AI SaaS platform
Start with **tenant budgets**, then add **run budgets**.

Why:
You need commercial isolation first, but you will likely need local execution safety soon after.

### Agentic workflow platform
Start with **run budgets**, then add **tenant budgets**.

Why:
Your first operational risk is usually one execution doing too much.

### Spring AI app with growing LLM spend
Start with **model-call guardrails**, then add **run budgets**.

Why:
The fastest first integration is around model calls, but bounded execution will matter as autonomy increases.

### Internal enterprise assistant
Start with **run budgets** or **model-call guardrails**, depending on architecture.

Why:
Tenant isolation may matter less initially than preventing loops and keeping model cost bounded.

### AI gateway or proxy product
Start with **tenant budgets** plus **model-call guardrails**.

Why:
The gateway naturally sees account and request boundaries first.

## A strong default rollout path

If you want a generally strong sequence, this is a good one:

### Phase 1: Model-call guardrails
Get Cycles into the execution path around model calls.

### Phase 2: Run budgets
Add bounded execution for complete runs or workflow instances.

### Phase 3: Tenant budgets
Add top-level account or customer boundaries.

### Phase 4: Workflow-specific policies
Differentiate expensive or high-value processes.

This sequence works well because it moves from easiest integration to strongest operational safety to strongest commercial control.

## Start narrow, not broad

Another common mistake is to ask:

::: info
What is the perfect first policy model?
:::

A better question is:

::: info
What is the narrowest rollout that prevents the incident we care about most?
:::

That mindset leads to faster adoption.

The first Cycles rollout should aim for:

- one clear scope
- one clear integration point
- one clear incident class
- one clear operational win

That is enough.

## Shadow mode can reduce rollout risk

No matter which first rollout you choose, shadow mode is often the safest way to start.

That means:

- evaluate reservations
- observe would-allow and would-deny decisions
- compare estimates with actuals
- tune thresholds before hard enforcement

This is especially useful if you are unsure whether tenant ceilings, run envelopes, or model-level estimates are well calibrated yet.

## Common mistakes

### Mistake 1: Starting with tenant budgets when the real pain is runaway runs

This gives account-level control but may leave the main operational incident unchanged.

### Mistake 2: Starting with run budgets when the real business pressure is customer over-consumption

This improves execution safety, but may not solve the commercial problem leadership actually cares about.

### Mistake 3: Starting with every action type at once

This makes policy hard to reason about and adoption harder than necessary.

### Mistake 4: Treating model-call guardrails as the final state

They are often the best starting point, but many systems eventually need broader workflow and scope-level policy.

### Mistake 5: Choosing based on architecture purity instead of real incidents

The right first rollout is the one tied to actual pain.

## A practical recommendation

If you are unsure, use this order of preference:

- choose **run budgets** first if you already have autonomous loops or multi-step workflows
- choose **tenant budgets** first if you are multi-tenant and commercial isolation is the main concern
- choose **model-call guardrails** first if you need the lowest-friction path to proving value

That is a strong default rule.

## Summary

The best first Cycles rollout depends on what you need to control first:

- **tenant budgets** for account-level boundaries and usage isolation
- **run budgets** for bounded execution and runaway loop prevention
- **model-call guardrails** for the simplest first integration around LLM cost

Do not start by modeling everything.

Start with the scope that most directly addresses your current incident or pressure point.

That is how Cycles becomes adoptable, useful, and operationally credible.

## Next steps

To explore the Cycles stack:

- Read the [Cycles Protocol](https://github.com/runcycles/cycles-protocol)
- Run the [Cycles Server](https://github.com/runcycles/cycles-server)
- Manage budgets with [Cycles Admin](https://github.com/runcycles/cycles-server-admin)
- Integrate with Python using the [Python Client](/quickstart/getting-started-with-the-python-client)
- Integrate with TypeScript using the [TypeScript Client](/quickstart/getting-started-with-the-typescript-client)
- Integrate with Spring AI using the [Spring Client](https://github.com/runcycles/cycles-spring-boot-starter)
