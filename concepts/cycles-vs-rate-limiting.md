---
title: "Cycles vs Rate Limiting: Why Velocity Controls Fail for AI Agents"
description: "Rate limiters control request velocity but cannot govern total spend. See how Cycles adds cost-aware runtime authority where rate limits fall short."
---

# Cycles vs Rate Limiting: Why Velocity Controls Fail for AI Agents

Rate limiting is one of the most widely deployed control patterns in software.

It works. It has worked for decades.

But it was designed for a different problem than the one AI agents create.

Rate limiters answer: **how fast?**

Cycles answers: **how much?**

That distinction determines whether your system can burn through $10,000 overnight while staying perfectly within its RPM limit.

> **Run the numbers for your workload:** [Cost Calculator →](/calculators/claude-vs-gpt-cost-standalone) — rate limits do not bound spend; the calculator shows what one un-budgeted runaway loop is worth at your token rate.

## What rate limiting does well

Rate limiters are effective at three things.

### Abuse prevention

A rate limiter keeps a bad actor from hammering your API. It sets a ceiling on request velocity per caller, per endpoint, or per time window. That is essential for any public-facing service.

### Traffic shaping

Rate limiters smooth bursty traffic. They protect downstream services from sudden spikes, keep queue depths manageable, and help maintain latency targets under load.

### Fairness

In multi-tenant systems, rate limiters ensure one tenant cannot monopolize shared resources. Every caller gets a fair share of throughput.

These are real, valuable properties. Nothing in this article suggests removing your rate limiter.

The question is whether rate limiting alone is sufficient when autonomous agents enter the picture.

It is not.

## Where rate limiting fails for AI agents

AI agents break the assumptions that make rate limiting sufficient.

### Rate limiters do not track cumulative cost

A rate limiter knows how many requests passed through in the last minute. It does not know how much those requests cost in total.

An agent that makes 10 requests per minute stays within a 60 RPM limit. But if each request triggers a long-context GPT-4 call with tool use, the cost per request might be $0.50 or more. That is $300 per hour. $7,200 per day. All within the rate limit.

The rate limiter sees normal traffic. The bill tells a different story.

### Rate limiters cannot distinguish cheap calls from expensive calls

To a rate limiter, every request is identical. A call that uses 100 input tokens and a call that uses 100,000 input tokens count the same: one request.

This is the fundamental mismatch. AI workloads have extreme cost variance between requests. A simple classification call might cost $0.001. A multi-turn agentic workflow with tool calls might cost $5.00. Both are one request.

Rate limiting treats them identically. Runtime authority cannot afford to.

### Rate limiters have no per-run or per-workflow awareness

A rate limiter operates at the connection level. It does not know that five requests belong to the same agent run, or that a workflow has fanned out into twelve parallel sub-tasks.

It cannot enforce: "this workflow may only spend $2 total." It can only enforce: "this caller may make N requests per time window."

That means an agent can spawn sub-tasks, retry failed steps, and loop through tool calls — all within the rate limit — while the total cost of a single run spirals.

### An agent can stay within RPM limits and burn $10K overnight

This is not a theoretical risk. It is the most common failure mode teams report.

The agent is well-behaved. It respects rate limits. It does not spike. It does not look like abuse.

It simply runs continuously, making steady, moderately expensive calls. Each call is allowed. The total is not governed.

By morning, the bill is $10,000. Nothing in the rate limiter flagged it.

The problem is not velocity. The problem is unbounded cumulative spend.

### No graceful degradation

When a rate limiter triggers, it returns 429 Too Many Requests. The client backs off and retries.

That is a binary response: allowed or throttled.

AI agents need a richer vocabulary. Sometimes the right answer is not "stop" but "continue with a cheaper model." Or "reduce the number of tool calls." Or "skip the optional enrichment step."

Rate limiters cannot express these nuances. They have one lever: velocity.

## Comparison

| | Rate Limiter | Cycles |
|---|---|---|
| **Controls** | Request velocity (RPM, RPS) | Total budgeted exposure (cost, tokens, units) |
| **Granularity** | Per-caller, per-endpoint, per-time-window | Per-tenant, per-workspace, per-workflow, per-agent |
| **Cost-aware** | No — every request counts equally | Yes — reserves estimated cost, commits actual cost |
| **Pre-execution budget check** | Velocity only — no cumulative awareness | Yes — checks remaining budget across all scopes before execution |
| **Concurrency-safe** | Yes for velocity counting | Yes — atomic reservations prevent race conditions on budget |
| **Degradation support** | No — binary allow/throttle | Yes — three-way decision: ALLOW, ALLOW_WITH_CAPS, DENY |

## How Cycles works where rate limiting cannot

Cycles introduces a reserve-then-commit model that is fundamentally different from velocity counting.

Before an agent action executes:

1. The system declares how much budget the action is expected to consume.
2. Cycles checks whether that budget is available across all applicable scopes (tenant, workspace, workflow, agent).
3. If available, the budget is atomically reserved. No other concurrent request can claim the same budget.
4. The action executes.
5. After execution, the system commits the actual cost. If the actual cost is less than the reservation, the remainder is released automatically.

This model answers questions that rate limiters cannot:

- Has this run already consumed too much? Then deny or degrade the next step.
- Is the tenant approaching its daily limit? Then switch to a cheaper model.
- Are concurrent requests about to exceed the workflow budget? The reservation is atomic — only one will succeed.
- Did the action cost less than expected? The unused budget is released for other work.

## The concurrency problem

Rate limiters handle concurrency well for velocity. They are designed for it.

But budget governance under concurrency is a different problem.

Consider two agent threads running in parallel against the same workflow budget. The budget has $5 remaining. Both threads check the budget, both see $5 available, and both proceed. Total spend: $10 against a $5 budget.

This is a classic time-of-check-to-time-of-use (TOCTOU) race condition. Rate limiters do not protect against it because they do not track cumulative spend.

Cycles handles this with atomic reservations. When the first thread reserves $5, that budget is immediately unavailable to the second thread. The second thread's reservation attempt sees the reduced balance and can be denied or degraded.

No race condition. No overspend.

## When to use both together

Rate limiting and Cycles solve different problems. Most production systems should use both.

**Keep your rate limiter for:**

- Abuse prevention — stopping bad actors from flooding your API
- Traffic shaping — smoothing bursts to protect downstream services
- Fairness — ensuring no single caller monopolizes throughput
- DDoS mitigation — absorbing malicious traffic spikes

**Add Cycles for:**

- Budget governance — bounding total spend per tenant, workflow, or run
- Cost-aware decisions — distinguishing cheap calls from expensive ones
- Graceful degradation — downgrading to cheaper models when budget is low
- Pre-execution enforcement — stopping expensive work before it starts
- Concurrency-safe accounting — preventing race conditions on budget

The two sit at different points in the request path.

A rate limiter typically sits at the edge — at the API gateway or load balancer. It decides whether the request may enter the system at all.

Cycles sits inside the application logic — at the point where an agent is about to make an expensive decision. It decides whether that specific action is allowed given the current budget state.

A request can pass the rate limiter (it is within velocity limits) and still be denied by Cycles (the budget is exhausted). These are independent, complementary checks.

## The architecture in practice

A typical flow looks like this:

```
Request arrives
    → Rate limiter: within RPM? → Yes → proceed
    → Cycles: budget available? → Reserve
        → Execute agent action (LLM call, tool use)
        → Cycles: commit actual cost, release remainder
```

If the rate limiter says no, the request never reaches Cycles. That is correct — abuse prevention should happen first.

If the rate limiter says yes but Cycles says no, the agent action does not execute. That is also correct — the work is within velocity limits but exceeds budget.

If both say yes, the action proceeds with reserved budget. After execution, the actual cost is committed and any unused reservation is released.

## The key insight

Rate limiting and runtime authority are orthogonal controls.

Rate limiting governs the speed of requests. It prevents bursts and abuse. It is stateless in the sense that it does not track what those requests cost in aggregate.

Runtime authority governs the total exposure of execution. It prevents overspend and cost runaway. It is stateful — it tracks reservations, commits, and remaining balances across scopes.

An AI agent that respects rate limits can still create unbounded cost.

An AI agent governed by Cycles cannot exceed its budget, regardless of how fast or slow it operates.

Rate limiting answers **how fast?**

Cycles answers **how much?**

Production systems need both answers.

## Next steps

- Read the [Cycles Protocol](https://github.com/runcycles/cycles-protocol)
- Run the [Cycles Server](https://github.com/runcycles/cycles-server)
- Integrate with Python using the [Python Client](/quickstart/getting-started-with-the-python-client)
- Integrate with TypeScript using the [TypeScript Client](/quickstart/getting-started-with-the-typescript-client)
- Try the [End-to-End Tutorial](/quickstart/end-to-end-tutorial) — zero to a working budget-guarded LLM call in ten minutes
- [The True Cost of Uncontrolled AI Agents](/blog/true-cost-of-uncontrolled-agents) — what happens when rate limits are the only line of defense
