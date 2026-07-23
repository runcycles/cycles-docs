---
title: "How to Model Tenant, Workflow, and Run Budgets in Cycles"
description: "Design budget policies using tenant, workflow, and run scopes to bound autonomous execution across multiple levels in Cycles."
---

# How to Model Tenant, Workflow, and Run Budgets in Cycles

Once a team understands reserve → commit, the next question is usually:

**What should we actually budget?**

That is where policy design starts.

In Cycles, budgets are not only about total spend. They are about deciding **which scopes matter**, **where limits should be enforced**, and **how autonomous work should be bounded across different levels of execution**.

A useful Cycles deployment usually does not rely on one global budget alone.

Instead, it combines multiple scopes such as:

- tenant
- workspace
- app
- workflow
- agent
- toolset

This article focuses on three of the most important ones:

- **tenant budgets**
- **workflow budgets**
- **run budgets**

These three scopes are often enough to build a strong first production model.

## Why multiple scopes matter

A single flat budget is simple, but often too blunt.

For example, suppose a platform gives one tenant a daily allowance of 10,000 units.

That may protect the platform overall, but it still leaves important questions unanswered:

- can one workflow consume the entire tenant budget?
- can one runaway execution drain everything?
- should a single run be allowed to recurse indefinitely as long as the tenant still has budget?
- should expensive workflows be bounded differently from cheap ones?

This is why Cycles supports hierarchical budgeting.

Different scopes protect against different failure modes.

## A simple mental model

Think of the scopes like this:

- **Tenant budget** protects the customer or account boundary
- **Workflow budget** protects the logical process boundary
- **Run budget** protects the single execution boundary

Each one solves a different problem.

### Tenant budget

This answers:

::: info
How much total exposure is this customer allowed to create?
:::

It is your platform-level financial and isolation control.

### Workflow budget

This answers:

::: info
How much exposure is this type of process allowed to consume?
:::

It is your product and feature-level control.

### Run budget

This answers:

::: info
How much exposure is this individual execution allowed to consume before it stops?
:::

It is your execution safety control.

All three can matter at the same time.

## Tenant budgets

Tenant budgets are usually the first and most obvious scope.

They are especially important for:

- multi-tenant SaaS systems
- customer-isolated AI platforms
- internal business units
- account-level usage governance

A tenant budget prevents one customer or account from consuming unbounded resources.

### What tenant budgets are good for

Tenant budgets are good at enforcing:

- daily or monthly spend ceilings
- customer usage isolation
- paid plan boundaries
- hard protection against over-consumption

A tenant budget is usually the scope product and finance teams care about first.

### What tenant budgets do not solve by themselves

Tenant budgets alone do not prevent:

- one runaway workflow consuming the full tenant allowance
- a single bad run doing too much damage before the tenant budget is exhausted
- uneven usage between expensive and cheap workflows
- one feature starving another inside the same tenant boundary

That is why tenant budgets should usually be combined with more local controls.

### Example tenant policy

A useful first tenant policy might be:

- each tenant has a daily budget
- all model calls and tool invocations reserve against it
- when exhausted, high-cost actions stop or downgrade

This creates a hard financial boundary.

## Workflow budgets

Workflow budgets are often the most important scope once autonomous behavior becomes real.

A workflow budget answers:

::: info
How much exposure should this type of process be allowed to consume?
:::

For example, not all workflows are equal.

A support triage workflow might need a larger envelope than:

- a simple summarization task
- a classification step
- a low-cost enrichment action

### Why workflow budgets matter

Workflow budgets prevent one class of work from becoming disproportionately expensive.

They are useful for:

- differentiating premium vs standard workflows
- bounding complex agentic behaviors
- controlling expensive feature paths
- keeping budget policy close to product intent

Without workflow budgets, all usage competes at the tenant level, which is often too coarse.

### Example workflow types

A platform might define workflows like:

- `workflow:support-triage`
- `workflow:refund-assistant`
- `workflow:report-generator`
- `workflow:research-agent`

Each can have a different budget profile.

That allows the platform to say:

- support triage may use more budget than summarization
- research may allow broad search but limited side effects
- refund workflows may permit CRM reads but tightly restrict writes

### Workflow budgets are where product policy becomes operational

This is usually the scope where business meaning becomes budget logic.

It is where teams begin translating product intent into execution boundaries.

## Run budgets

Run budgets are the most local and execution-specific scope.

In the Cycles protocol, "run" is not a built-in subject field like tenant or workflow. Instead, run-level budgets are modeled by passing a unique run identifier through one of the standard subject fields — for example, setting `workflow="run-12345"` derives the scope `workflow:run-12345`, or the `agent` field can carry the run identifier. This gives each execution its own scope in the budget hierarchy.

Do not use the `dimensions` field for run budgets. Scopes are derived only from the six standard subject fields (tenant, workspace, app, workflow, agent, toolset). The `dimensions` map never derives scopes, and servers MAY ignore `dimensions` entirely for budgeting decisions — a run identifier placed there would not be enforced.

A run budget answers:

::: info
How much exposure can this single execution consume before it must stop?
:::

This scope is especially important for:

- long-running agents
- recursive tool use
- background jobs
- multi-step workflows
- autonomous loops

### Why run budgets matter

Run budgets are your best defense against runaway execution.

Even if the tenant has plenty of remaining budget, one individual run may still need a hard ceiling.

That protects against:

- infinite loops
- excessive retries
- bad planning behavior
- recursive tool chains
- accidental fan-out

### Example run policy

A workflow run might be allowed:

- up to 500 units total
- downgrade behavior after 400 units
- hard stop at exhaustion

This gives each run a bounded envelope.

Step limits (for example, "no more than 10 model/tool steps") are not something budgets enforce. They come from **Caps** — soft-landing constraints such as `max_steps_remaining` that the server can return from `/decide` or alongside an `ALLOW_WITH_CAPS` reservation decision. Combine a run budget (spend ceiling) with Caps (step and tool constraints) for full run-level control.

### Why run budgets should usually be strict

Tenant budgets can be broad.

Workflow budgets can be product-shaped.

Run budgets should usually be narrow and safety-oriented.

They are your last line of defense against local execution instability.

## How the scopes work together

The real power comes from combining these scopes.

For example, a single action may need to satisfy all of the following:

- tenant still has available budget
- workflow is within its allowed envelope
- run has not exhausted its local execution cap

That means one reservation may be checked across multiple levels.

This is how Cycles turns budgeting into hierarchical governance rather than one flat counter.

## A practical example

Imagine a multi-tenant support platform.

A customer asks an agent to handle a refund issue.

The system may apply:

- **Tenant budget:** customer can consume up to 10,000 units per day
- **Workflow budget:** refund-assistant workflow can consume up to 2,000 units per day
- **Run budget:** this individual refund case can consume up to 250 units

Now suppose the workflow starts looping because the agent repeatedly tries tool calls.

The tenant budget might still have plenty of room.

The workflow budget might still be healthy too.

But the **run budget** can stop this one execution before it becomes a local incident.

That is why all three scopes matter.

## Which scope should enforce first?

In practice, the answer is usually:

**all relevant scopes should be checked before execution proceeds.**

But conceptually:

- tenant budgets protect platform economics
- workflow budgets protect product behavior
- run budgets protect execution safety

If you only have time to add one extra scope beyond tenant, add **run budgets** first.

That is often where the biggest operational safety gain appears.

## Recommended rollout order

If you are starting from scratch, use this rollout order:

### Phase 1: Tenant budgets

Start with account-level or customer-level boundaries.

This gives you immediate financial protection and multi-tenant isolation.

### Phase 2: Run budgets

Next, add hard limits for individual executions.

This protects against loops, runaway retries, and over-consumption inside otherwise healthy tenant budgets.

### Phase 3: Workflow budgets

Then introduce workflow-specific policy.

This helps product teams shape how different features are allowed to consume budget.

That sequence works well because it starts with the simplest boundary, then adds execution safety, then adds product nuance.

## Common mistakes

### Mistake 1: Only using tenant budgets

This makes the platform financially safer, but not necessarily operationally safer.

One runaway run can still do damage before the tenant budget is exhausted.

### Mistake 2: Making all workflows share the same envelope

Not all workflows have the same complexity, value, or risk.

Treating them the same usually leads to either over-permissive or overly restrictive policy.

### Mistake 3: Ignoring run-level ceilings

Run budgets are often the cleanest protection against accidental recursion and fan-out.

Skipping them is one of the fastest ways to leave a gap in the model.

### Mistake 4: Trying to model everything at once

Do not design a perfect hierarchy on day one.

Start with the scopes that map directly to real incidents.

For most teams, that means tenant + run first.

## How to think about policy design

A useful way to design budgets is to ask three questions:

### 1. What boundary are we protecting?

- platform economics?
- product feature behavior?
- individual execution safety?

### 2. What failure mode are we trying to prevent?

- customer over-consumption?
- expensive workflows?
- loops and retries?
- recursive tool use?
- noisy background jobs?

### 3. At what level should the stop happen?

- tenant
- workflow
- run

This keeps policy tied to operational reality instead of abstract hierarchy design.

## A strong default model

For many teams, a strong default looks like this:

- **Tenant budget** for daily or monthly usage boundaries
- **Workflow budget** for expensive or high-value process types
- **Run budget** for hard ceilings on individual executions

That gives you:

- platform isolation
- product-aware budget shaping
- local protection against runaway behavior

It is a practical, comprehensible starting model.

## Summary

Tenant, workflow, and run budgets are not redundant.

They each protect a different part of the system:

- **tenant budgets** protect the account boundary
- **workflow budgets** protect the process boundary
- **run budgets** protect the execution boundary

Cycles is most useful when these scopes are treated as complementary layers of governance rather than competing alternatives.

That is how teams move from simple usage caps to real autonomous execution control.

## Next steps

- [Tenants, Scopes, and Budgets](/how-to/understanding-tenants-scopes-and-budgets-in-cycles) — how tenants, scopes, and budgets work together as a unified model
- [Tenant Creation and Management](/how-to/tenant-creation-and-management-in-cycles) — create and configure tenants before setting up budgets
- [Budget Allocation and Management](/how-to/budget-allocation-and-management-in-cycles) — allocate and fund budgets at each scope level
- [API Key Management](/how-to/api-key-management-in-cycles) — create tenant-scoped API keys
- [Scope Derivation](/protocol/how-scope-derivation-works-in-cycles) — how subject fields map to hierarchical scope paths
- [Deploy the Full Stack](/quickstart/deploying-the-full-cycles-stack) — set up the Cycles infrastructure from scratch
- Integrate with [Python](/quickstart/getting-started-with-the-python-client), [TypeScript](/quickstart/getting-started-with-the-typescript-client), or [Spring AI](/how-to/integrating-cycles-with-spring-ai)
