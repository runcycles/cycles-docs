---
title: "OpenAI Agents SDK: Content Guardrails, No Action Control"
date: 2026-03-30
author: Albert Mavashev
tags: [openai, agents, runtime-authority, governance, risk, actions, python, RunHooks]
description: "The OpenAI Agents SDK has content guardrails but no action controls. RunHooks is the ideal insertion point for runtime authority over tools, cost, and risk."
blog: true
sidebar: false
---

# The OpenAI Agents SDK Has Guardrails for Content — But Nothing for Actions

> **Part of: [AI Agent Risk & Blast Radius Reference](/guides/risk-and-blast-radius)** — the full pillar covering action authority, risk scoring, blast-radius containment, and degradation paths.

Two scenarios. Same agent. Very different outcomes.

**Scenario A.** A user asks your support agent to generate instructions for something harmful. The agent's `InputGuardrail` fires, detects the policy violation, and blocks the request before a single token is generated. The system works exactly as designed.

**Scenario B.** The same agent enters a retry loop on a failing API call. It calls `send_email` 200 times. It triggers a staging deployment via `run_deploy`. It burns through $50 in OpenAI API fees. Nothing stops it — because there's nothing _to_ stop it. The SDK has no mechanism for controlling what tools an agent calls, how many times, or at what cost.

The OpenAI Agents SDK handles content safety well. It does not handle [action authority](/glossary#action-authority) at all.

Once `Runner.run()` starts, every tool call executes with full authority. There's no way to say: "this agent can search freely, but must check authorization before sending emails." There's no spending limit per [tenant](/glossary#tenant) or per session. There's no distinction between a read-only lookup and a destructive side-effect.

The SDK's `RunHooks` interface — designed for observability — turns out to be the exact insertion point for fixing this.

<!-- more -->

## Content safety vs action authority

The OpenAI Agents SDK provides a solid foundation for building multi-agent workflows. `Agent` defines behavior. `Runner` orchestrates execution. `Tool` exposes capabilities. `Handoff` enables agent-to-agent delegation. And `InputGuardrail` filters content before the agent starts — blocking harmful prompts, off-topic requests, or policy violations.

What's missing is the other half of governance: runtime authorization for _actions_.

The gap has three dimensions:

**Cost.** There are no spending limits. A tenant running a support agent and a tenant running an analytics pipeline share the same unlimited OpenAI budget. If one tenant's agent enters a retry loop, the entire account pays for it. Provider-level spending caps are account-wide and may react too slowly — by the time they trigger, the damage is done.

**Risk.** Every tool call is treated equally. `search_knowledge_base` and `send_email` have the same authorization status: allowed, unconditionally. There's no mechanism to assign different risk levels, require different authorization thresholds, or enforce different policies per tool.

**Volume.** There's no cap on how many times an agent invokes a specific tool in a single run. An agent that decides to "be thorough" and calls `update_crm` 50 times is indistinguishable from one that calls it once.

This isn't a criticism of the SDK. It's designed for orchestration — defining agents, connecting tools, managing handoffs. Governance is a different layer. But it's the layer that sits between "the agent _can_ do it" and "the agent _should_ do it."

## Why RunHooks are the perfect insertion point

The SDK's `RunHooks` interface exposes seven lifecycle events that fire during an agent run. The documentation positions them for logging and tracing. But they have a property that makes them far more useful: **they're blocking**.

When `on_tool_start` fires before a tool call, any exception it raises cancels the tool execution. The tool never runs. The agent receives an error and can decide how to proceed.

This is exactly what a pre-execution authorization check needs. Here's how the hooks map to a [runtime authority](/glossary#runtime-authority) lifecycle:

| Hook | Authorization question | On DENY |
|------|----------------------|---------|
| `on_tool_start` | "Is this agent authorized to call this tool right now, given its risk level and remaining budget?" | Raise `BudgetExceededError` — tool never executes |
| `on_tool_end` | "Record what actually happened — commit the real cost." | — |
| `on_llm_start` | "Does this agent have budget for another LLM call?" | Raise `BudgetExceededError` — no [tokens](/glossary#tokens) consumed |
| `on_llm_end` | "Commit the reserved amount and record actual token counts as metrics." | — |
| `on_handoff` | "Record that Agent A delegated to Agent B." | — (audit only) |

The critical insight: authorization happens _before_ execution, not after. If the answer is DENY, the expensive API call never fires. No tokens are consumed. No side-effects occur. The agent stops cleanly with a typed exception that your application can handle.

This is the difference between runtime authority and observability. Observability tells you what happened. Authority decides what's _allowed_ to happen.

The reserve-commit pattern makes this concrete:

1. **Before the action:** Reserve budget or risk points. The [Cycles server](/glossary#cycles-server) checks the tenant's remaining balance and returns ALLOW or DENY.
2. **Execute the action:** Only if authorized. The [reservation](/glossary#reservation) holds the estimated cost so concurrent requests don't over-allocate.
3. **After the action:** Commit usage and record token metrics from `response.usage` for observability.
4. **On failure:** Release the reservation to return budget to the pool.

The SDK's hooks bracket every action with a start/end pair — the exact shape needed for reserve/commit.

## Three lines to runtime authority

The [`runcycles-openai-agents`](https://pypi.org/project/runcycles-openai-agents/) package implements `RunHooks` with the full reserve-commit lifecycle:

```python
from runcycles_openai_agents import CyclesRunHooks

hooks = CyclesRunHooks(tenant="acme")
result = await Runner.run(agent, input="Help me with my order", hooks=hooks)
```

That's the entire integration. No decorator on each function. No code changes to your tools. No wrapper around your agent definition.

Behind the scenes, for every LLM call in the agent run:
1. `on_llm_start` creates a reservation with an estimated cost
2. The LLM call executes (only if authorized)
3. `on_llm_end` commits the reservation and records actual token counts from `response.usage` as metrics

For every tool call:
1. `on_tool_start` creates a reservation with the tool's risk-point cost
2. The tool executes (only if authorized)
3. `on_tool_end` commits the actual cost

For every handoff:
1. `on_handoff` records an audit event in the Cycles ledger

If budget is exhausted at any point, `BudgetExceededError` is raised. The agent stops. No further tokens are consumed. No further tools execute.

## Tool estimate mapping: governance beyond tokens

Token costs are one dimension of the problem. But a `send_email` call and a `search_knowledge_base` call consume roughly the same number of tokens — yet their consequences are vastly different.

`ToolEstimateMap` assigns per-call estimates to tools, creating a policy layer on top of the budget:

```python
from runcycles_openai_agents import CyclesRunHooks, ToolEstimateMap

hooks = CyclesRunHooks(
    tenant="acme",
    tool_estimates=ToolEstimateMap(
        mapping={
            "send_email": 50,       # high-risk: 50 RISK_POINTS per invocation
            "update_crm": 10,       # medium-risk: 10 RISK_POINTS
            "run_deploy": 100,      # critical: 100 RISK_POINTS
            "search_knowledge": 0,  # zero estimate: no reservation, no API call
        },
        default_estimate=1,         # unmapped tools: 1 RISK_POINT
    ),
)
```

Zero-estimate tools skip the Cycles API entirely — no network round-trip, no latency overhead for read-only operations. The agent searches and retrieves as fast as the SDK allows.

Higher-estimate tools consume budget proportional to their consequence, not their token usage. An agent with 500 risk points can send 10 emails (50 × 10 = 500) or make 50 CRM updates (10 × 50 = 500) or trigger 5 deployments (100 × 5 = 500) — but not all three. The budget enforces trade-offs that token counting alone cannot express.

The `default_estimate` parameter is a safety net. When someone adds a new tool to the agent and forgets to add it to the estimate map, it still costs 1 point per invocation. No tool runs completely ungoverned.

This isn't just budgeting — it's a policy layer. Tenant A can send 10 emails per session. Tenant B gets 100. Tenant C gets none. The policy is expressed as budget allocation, enforced at runtime, and audited in the Cycles ledger.

For advanced cases, `ToolEstimateConfig` allows custom `action_kind` values per tool, enabling fine-grained filtering in the audit trail:

```python
"update_crm": ToolEstimateConfig(estimate=10, action_kind="tool.crm.update"),
```

## Pre-run authorization check

`cycles_budget_guardrail` plugs into the SDK's `InputGuardrail` system to run a preflight authorization check _before the agent starts_:

```python
from runcycles_openai_agents import cycles_budget_guardrail

guardrail = cycles_budget_guardrail(
    tenant="acme",
    estimate=5_000_000,
    fail_open=True,
)

agent = Agent(
    name="support-bot",
    input_guardrails=[guardrail],
)
```

If the tenant's budget is exhausted, the guardrail trips immediately — zero tokens consumed, zero API calls made, zero tool invocations. This is cheaper and faster than letting the agent start, make an LLM call, and then fail when `on_llm_start` denies the reservation.

The `fail_open=True` default means the agent continues if the Cycles server is unreachable. Infrastructure outages shouldn't block all agents — the guardrail degrades gracefully rather than becoming a single point of failure.

## Multi-agent handoff tracking

In multi-agent workflows, Agent A might hand off to Agent B, which hands off to Agent C. The SDK manages these transitions via `Handoff`. The Cycles hooks add accountability:

Every handoff fires `on_handoff`, which records an audit event in the Cycles ledger with the source and target agent names. Budget is shared across the entire agent graph — Agent B's tool calls deduct from the same pool as Agent A's. There are no per-agent silos.

The result is a complete trace: which agent called which tool, how many tokens each consumed, what risk points were spent, and when handoffs occurred. This is useful for debugging ("why did the agent run cost $12?") and for policy ("the triage agent should hand off to the resolver, not the other way around").

## What this doesn't solve

Runtime action authority is one layer of agent governance. It's not the only one.

**Content filtering** is the SDK's job. `InputGuardrail` blocks harmful prompts. Cycles doesn't inspect content — it controls whether actions are _authorized_ to execute.

**Streaming-aware budget management** isn't supported. The OpenAI Agents SDK doesn't expose streaming-specific lifecycle hooks, so there's no way to track token usage mid-stream. Tokens are committed after the full response is received via `on_llm_end`.

**Exact cost prediction** isn't possible. Estimates are used before the LLM call to reserve budget. After the call, the reserved amount is committed and actual token counts are recorded as metrics. When using `llm_unit=Unit.TOKENS`, actual token counts are committed directly; with the default `llm_unit=Unit.USD_MICROCENTS`, the pre-estimated amount is committed. Either way, token metrics from `response.usage` are always recorded for observability.

**Fail-open is the default.** If the Cycles server is unreachable, the agent continues with full authority. This is a deliberate design choice — budget enforcement should be a guardrail, not a single point of failure. Set `fail_open=False` to enforce strict governance when infrastructure reliability is guaranteed.

These are design choices, not limitations. They keep the integration lightweight and production-safe.

## Getting started

Install the package:

```bash
pip install runcycles-openai-agents
```

Set environment variables (or [load programmatically](/how-to/integrating-cycles-with-openai-agents#prerequisites) from a vault):

```bash
export OPENAI_API_KEY=sk-...
export CYCLES_BASE_URL=http://localhost:7878
export CYCLES_API_KEY=cyc_live_...
```

Add hooks to your agent run:

```python
from agents import Agent, Runner
from runcycles_openai_agents import CyclesRunHooks, cycles_budget_guardrail

guardrail = cycles_budget_guardrail(tenant="acme", estimate=5_000_000)
hooks = CyclesRunHooks(
    tenant="acme",
    tool_estimates={"send_email": 50, "search": 0},
)

agent = Agent(
    name="support-bot",
    instructions="You resolve support cases.",
    input_guardrails=[guardrail],
)

result = await Runner.run(agent, input="Help me!", hooks=hooks)
```

Every LLM call, every tool invocation, and every handoff is now governed. If you need a Cycles server, the [end-to-end tutorial](/quickstart/end-to-end-tutorial) gets you from zero to a running stack in about 10 minutes.

## Further reading

- [OpenAI Agents integration guide](/how-to/integrating-cycles-with-openai-agents) — full configuration reference
- [Action Authority: Controlling What Agents Do](/concepts/action-authority-controlling-what-agents-do) — the concept behind tool-level governance
- [Choosing the Right Integration Pattern](/how-to/choosing-the-right-integration-pattern) — when to use hooks vs decorators vs middleware
- [Error Handling in Python](/how-to/error-handling-patterns-in-python) — handling `BudgetExceededError` and other Cycles exceptions
- [runcycles-openai-agents on PyPI](https://pypi.org/project/runcycles-openai-agents/) — package page
- [Source on GitHub](https://github.com/runcycles/cycles-openai-agents) — full source code and examples
