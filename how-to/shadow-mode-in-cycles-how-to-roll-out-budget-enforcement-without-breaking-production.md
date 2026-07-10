---
title: "Shadow Mode in Cycles: How to Roll Out Budget Enforcement Without Breaking Production"
description: "Use shadow mode to evaluate Cycles budget policies against real traffic without blocking execution, then safely transition to enforcement."
---

# Shadow Mode in Cycles: How to Roll Out Budget Enforcement Without Breaking Production

Most teams do not struggle with the idea of budget enforcement.

They struggle with the rollout.

They know autonomous systems can loop, retry, fan out across tools, and create unbounded cost or side effects. They know rate limits and dashboards are not enough.

But they also know that hard enforcement can break production if the policy is wrong.

That is why shadow mode matters.

Shadow mode lets a team evaluate Cycles policies against real traffic **without yet blocking execution**.

It is how you move from theory to production safely.

## Why shadow mode is necessary

In practice, most teams do not know the correct budget thresholds on day one.

They may have good instincts, but they usually do not yet know:

- how much a typical workflow actually consumes
- how often retries happen
- which workflows are naturally bursty
- which tenants have unusual usage patterns
- how often expensive tool paths are taken
- how much estimated usage differs from actual usage

If you enforce too early, you risk false denials, broken workflows, frustrated users, and emergency rollback.

If you never enforce at all, you stay stuck in observability mode forever.

Shadow mode is the bridge between those two states.

## What shadow mode is

In the Cycles protocol, shadow mode is enabled by setting `dry_run: true` on a reservation request. The server evaluates the same reservation and budget logic it would use in enforcement mode, but instead of blocking execution, it returns what **would have happened** — the decision, caps, and affected scopes — in the response. The server must not persist anything for a dry run: no balances are modified, no reservation is created, and no commit or release is required. Recording those would-be outcomes for analysis is the caller's job.

That means your system can answer questions like:

- would this action have been allowed?
- which scope would have denied it?
- how often would this workflow exceed its run budget?
- which tenants are consistently near their limits?
- how accurate are our estimates versus actual usage?

In other words, shadow mode gives you production-grade policy feedback without introducing production-grade disruption.

As a fleet-wide complement to per-request `dry_run`, servers implementing the v0.1.26 admin extension also preview a tenant-level `observe_mode` setting, which lets operators put an entire tenant into shadow evaluation without changing any call sites.

## What shadow mode is not

Shadow mode is not fake traffic.

It is not synthetic testing.

It is not a spreadsheet exercise.

It is not simply “log more metrics.”

It is real policy evaluation against real production behavior, with the difference that the outcome is observed instead of enforced.

That distinction matters.

Teams often think they can skip shadow mode by reading dashboards or replaying logs. Sometimes that helps, but it rarely captures the full reality of live autonomous execution, especially under retries, concurrency, and partial failure.

## The core idea

The Cycles control model is:

1. declare intent
2. reserve exposure
3. execute
4. commit actual usage or release the remainder

In shadow mode, the same model still runs conceptually, but reservation failures become **signals** rather than **hard stops**.

Instead of saying:

::: info
deny this action
:::

the system says:

::: info
this action would have been denied under the current policy
:::

That gives teams a safe way to tune policy before the consequences become user-facing.

## Why shadow mode matters for autonomous systems

Autonomous systems are harder to govern than simple request/response applications because behavior emerges over time.

The cost of a workflow is often not obvious from its starting point.

One execution may:

- call a model once and finish cheaply
- branch into multiple retrieval calls
- invoke several tools
- retry after partial failure
- recurse into additional steps
- continue running in the background

That means the correct budget boundaries are often learned empirically.

Shadow mode gives teams a way to learn those boundaries from reality instead of guessing.

## What teams should measure in shadow mode

A useful shadow rollout is not just “turn it on and watch logs.”

It should answer concrete questions.

### 1. Denial frequency

How often would actions have been denied?

This helps identify whether policy is too strict, too loose, or roughly calibrated.

### 2. Denial location

Which scope would have denied the action?

For example:

- tenant budget
- workflow budget
- run budget

This shows whether the problem is broad account-level consumption or a local execution issue.

### 3. Estimate versus actual usage

How often are your reservations too high or too low?

If estimates are consistently inflated, you may create unnecessary policy pressure.  
If estimates are consistently too low, your controls may be less protective than expected.

### 4. Workflow distribution

Which workflows consume the most exposure?  
Which ones are bursty?  
Which ones are stable?

This helps you decide where workflow-specific policies are worth adding.

### 5. Tenant distribution

Which tenants are close to limits?  
Which tenants have unusual patterns?  
Which ones would be most affected by enforcement?

This is especially important for multi-tenant platforms.

### 6. Runaway behavior indicators

Which runs show repeated retries, recursive tool usage, or unusually long chains of actions?

These are often the strongest signals that run-level limits need tuning.

## A practical rollout sequence

A safe shadow-mode rollout usually follows a progression.

### Phase 1: Instrument core actions

Start by evaluating the highest-value actions in shadow mode, such as:

- model calls
- expensive tool invocations
- side-effecting actions
- long-running workflow steps

Do not try to model every possible action on day one.

### Phase 2: Add the most important scopes

Start with a small set of budget scopes, usually:

- tenant
- run

Those two often provide the clearest operational signal.

Workflow budgets can be added once you understand which process types deserve distinct treatment.

### Phase 3: Collect enough live behavior

Let the system observe enough real production traffic to expose variation.

The goal is not only to capture average behavior, but also:

- spikes
- retries
- partial failures
- unusual tenants
- edge-case workflows

### Phase 4: Review would-deny outcomes

Look at the actions that would have been denied.

Ask:

- would we actually want to stop this?
- should this degrade instead of deny?
- is the budget too strict?
- is the estimate too high?
- is a different scope the right boundary?

### Phase 5: Tune and repeat

Adjust policy, estimate strategy, or degradation logic.

Then continue observing until the system’s would-deny behavior matches operator intent closely enough to justify enforcement.

### Phase 6: Move selected paths to hard enforcement

You do not have to turn on enforcement everywhere at once.

A good rollout often begins with:

- the most expensive actions
- the most predictable workflows
- the most stable tenants
- the clearest runaway failure modes

That keeps the first production enforcement surface narrow and understandable.

## What good shadow-mode outcomes look like

A successful shadow period usually produces a few things.

### Clear budget boundaries

You begin to understand what reasonable tenant, workflow, and run limits look like.

### Estimate quality improves

You learn whether your reservation estimates are directionally correct or need refinement.

### Denial logic becomes intentional

The team stops asking “what number should we pick?” and starts asking “what behavior do we want to allow, degrade, or stop?”

### Enforcement becomes safer

By the time hard enforcement begins, you have already seen the likely denial cases and adjusted policy accordingly.

That is the real value of shadow mode.

## Common mistakes in shadow rollouts

### Mistake 1: Treating shadow mode as a checkbox

Shadow mode is not useful unless someone reviews the results and tunes policy.

If nobody looks at the would-deny outcomes, shadow mode becomes passive logging.

### Mistake 2: Starting with too many scopes

If you begin with tenant, application, workflow, agent, tool, run, environment, and custom policy layers all at once, it becomes difficult to understand what is actually driving decisions.

Start small.

### Mistake 3: Using shadow mode forever

Shadow mode is a transition stage, not the destination.

Its purpose is to make enforcement safer, not to replace enforcement permanently.

### Mistake 4: Ignoring degradation paths

If every policy failure is treated as “allow everything in shadow, deny everything in prod,” you miss a major design opportunity.

Often the right outcome is not binary denial. It may be:

- switch to a smaller model
- disable a costly tool
- reduce concurrency
- move to read-only behavior
- end the run gracefully

Shadow mode should help design those paths too.

### Mistake 5: Looking only at averages

Average usage is not enough.

The important cases are often the long tail:

- the noisy tenant
- the runaway run
- the recursive workflow
- the bursty retry pattern

Those are the cases enforcement must handle well.

## How shadow mode supports trust

One of the hardest parts of introducing a new control layer is trust.

Application teams worry that governance will be too rigid.  
Platform teams worry that application teams will resist enforcement.  
Operators worry that a wrong policy will break production at the worst moment.

Shadow mode lowers that trust barrier.

It lets teams say:

- we are evaluating policy on real workloads
- we know what would have been denied
- we understand where the pressure points are
- we have tested the likely outcomes before turning on hard stops

That makes Cycles easier to adopt operationally.

## A strong first shadow policy

For many teams, a strong first rollout looks like this:

- evaluate **tenant budgets** in shadow mode
- evaluate **run budgets** in shadow mode
- instrument model calls and expensive tools
- record would-deny events
- compare estimated vs actual usage
- review top offending runs and tenants
- add degradation rules before hard enforcement

This is a manageable first policy shape that gives useful signal quickly.

## When to leave shadow mode

A good rule is:

Move to hard enforcement when the shadow outcomes are no longer surprising.

That means:

- denial cases mostly match operator expectations
- estimates are directionally reliable
- major workflows have been observed sufficiently
- degradation paths are defined
- the team understands which scopes are responsible for decisions

When the policy is still producing confusing or obviously wrong results, stay in shadow and keep tuning.

When the policy starts behaving like the system you actually want, it is time to enforce.

## Summary

Shadow mode is how Cycles becomes operationally adoptable.

It lets teams evaluate real reservation and budget policy against real autonomous behavior without breaking production on day one.

That is critical because autonomous systems are hard to model perfectly in advance.

By using shadow mode, teams can:

- learn real consumption patterns
- tune tenant, workflow, and run budgets
- refine estimate quality
- identify runaway behavior
- design degradation paths
- move to enforcement with far more confidence

That is how you roll out runtime authority safely.

## Next steps

To explore the Cycles stack:

- Read the [Cycles Protocol](https://github.com/runcycles/cycles-protocol)
- Run the [Cycles Server](https://github.com/runcycles/cycles-server)
- Manage budgets with [Cycles Admin](https://github.com/runcycles/cycles-server-admin)
- Integrate with Python using the [Python Client](/quickstart/getting-started-with-the-python-client)
- Integrate with TypeScript using the [TypeScript Client](/quickstart/getting-started-with-the-typescript-client)
- Integrate with Spring Boot or Spring AI using the [Spring Boot starter](https://github.com/runcycles/cycles-spring-boot-starter) or the [Spring AI starter](https://github.com/runcycles/cycles-spring-ai-starter)
- [AI Agent Cost Management: The Complete Guide](/blog/ai-agent-cost-management-guide) — the five-tier maturity model including shadow mode rollout
