---
title: "OpenAI Agents SDK Guardrails vs Action Control"
date: 2026-03-30
author: Albert Mavashev
tags: [openai, agents, runtime-authority, governance, risk, actions, python, RunHooks]
description: "OpenAI Agents SDK tool guardrails validate individual function tools. They aren't cross-tenant budget or risk authority — RunHooks is where that fits."
blog: true
sidebar: false
head:
  - - meta
    - name: keywords
      content: OpenAI Agents SDK guardrails, OpenAI RunHooks, AI agent action control, tool guardrails, runtime authority, Python agents
---

# OpenAI Agents Guardrails and Cumulative Action Budgets

> **Part of: [AI Agent Risk & Blast Radius Reference](/guides/risk-and-blast-radius)** — the full pillar covering action authority, risk scoring, blast-radius containment, and degradation paths.

Two scenarios. Same agent. Very different outcomes.

**Scenario A.** A user asks your support agent to generate instructions for something harmful. The agent's `InputGuardrail` fires, detects the policy violation, and blocks the request before a single token is generated. The system works exactly as designed.

**Scenario B.** The same agent enters a retry loop on a failing API call. It calls `send_email` 200 times. It triggers a staging deployment via `run_deploy`. It burns through $50 in OpenAI API fees. Tool guardrails could validate any one of those calls in isolation — but no SDK primitive tracks cumulative spend, cumulative risk, or cumulative tool counts across the run, across handoffs, or across tenants. The 200th `send_email` looks no different from the 1st.

The OpenAI Agents SDK handles content safety well, and tool guardrails handle per-call function-tool validation. What it does not provide is a cross-cutting ledger that tracks cumulative spend or caller-assigned action exposure across calls, agents, and tenants. That ledger complements—not replaces—the SDK's tool authorization.

Tool guardrails fire on individual function-tool calls — they don't fire on hosted tools, built-in execution tools, or handoffs, and they don't share state across the run. So once `Runner.run()` starts, there's no central authority that asks: how much has *this tenant* already spent, how many times has *this agent* called *this tool*, has the cumulative risk budget been exhausted? There's no per-tenant spending limit, no first-class risk score, and no shared ledger between a read-only lookup and a destructive side-effect.

The SDK's `RunHooks` interface — designed for observability — turns out to be the exact insertion point for fixing this.

<!-- more -->

## Content safety vs action authority

The OpenAI Agents SDK provides a solid foundation for building multi-agent workflows. `Agent` defines behavior. `Runner` orchestrates execution. `Tool` exposes capabilities. `Handoff` enables agent-to-agent delegation. `InputGuardrail` and `OutputGuardrail` filter content at the agent boundary, and tool guardrails wrap individual function-tool invocations and can block, replace, or tripwire a single call before it executes.

What none of those primitives provide is cross-cutting [runtime authority](/glossary#runtime-authority) — a shared ledger that LLM and tool lifecycle hooks can consult before execution, with handoffs recorded alongside them. That's the layer this post is about.

The gap has three dimensions:

**Cost.** There are no spending limits. A tenant running a support agent and a tenant running an analytics pipeline share the same unlimited OpenAI budget. If one tenant's agent enters a retry loop, the entire account pays for it. Provider-level spending caps are account-wide and may react too slowly — by the time they trigger, the damage is done.

**Risk.** Tool guardrails let you write a custom validator per function tool, but there's no first-class concept of a risk level or an authorization threshold, and no shared ledger that tallies cumulative risk across the run. `search_knowledge_base` and `send_email` have to be policed by independently maintained guardrail code; nothing tracks "this agent has already burned its risk budget for the session."

**Volume.** A tool guardrail sees one call at a time. Counting "how many times has this agent called `update_crm` in this run" requires custom closure state, and the count doesn't survive across runs or tenants. An agent that decides to "be thorough" and calls `update_crm` 50 times in a single run still slips past per-call validation.

This isn't a criticism of the SDK. Content guardrails cover prompts and responses; tool guardrails cover per-call function-tool validation. The missing piece addressed here is cumulative accounting shared across governed LLM and tool calls, agents, and tenants.

## Why RunHooks are a useful insertion point

The SDK's `RunHooks` interface exposes seven lifecycle events that fire during an agent run. The documentation positions them for logging and tracing. But they have a property that makes them far more useful: **they're blocking**.

When `on_tool_start` fires before a tool call, any exception it raises cancels the tool execution. The tool never runs. The agent receives an error and can decide how to proceed.

This gives an integration a mandatory point for a pre-execution budget check. Here's how the hooks map to a [runtime authority](/glossary#runtime-authority) lifecycle:

| Hook | Budget question | On budget rejection |
|------|----------------------|---------|
| `on_tool_start` | "Does the caller-assigned estimate fit the applicable tool-exposure ledger?" | Raise `BudgetExceededError`—tool never executes |
| `on_tool_end` | "Commit the caller-assigned tool estimate." | — |
| `on_llm_start` | "Does an applicable ledger have budget for another LLM call?" | Raise `BudgetExceededError`—no [tokens](/glossary#tokens) consumed |
| `on_llm_end` | "Commit the reserved amount and record actual token counts as metrics." | — |
| `on_handoff` | "Attempt to record that Agent A delegated to Agent B." | — (best-effort audit only) |

The critical insight is placement: after application authorization and before execution, the hook creates a live reservation. If the reservation is rejected, the protected API or tool call does not run and the integration raises a typed exception. `DENY` is the decision value for `decide` and dry-run flows; a live reserve failure is an error such as `409 BUDGET_EXCEEDED`.

This is the difference between runtime budget authority and observability. Observability reports what happened; the budget boundary can reject an instrumented operation before it happens. Tool permission still belongs to the application.

The reserve-commit pattern makes this concrete:

1. **Before the action:** Reserve budget or caller-assigned risk points. The [Cycles server](/glossary#cycles-server) checks the relevant scoped budgets; a live reservation succeeds with `ALLOW` or configured `ALLOW_WITH_CAPS`, or returns a budget error.
2. **Execute the action:** Only after application authorization and a successful reservation. The [reservation](/glossary#reservation) holds the estimate so concurrent requests do not over-allocate.
3. **After the action:** Commit usage and record token metrics from `response.usage` for observability.
4. **On failure:** Release the reservation to return budget to the pool.

The SDK's LLM and tool hooks expose start/end pairs — the exact shape needed for reserve/commit. Handoffs expose a single audit hook, so the plugin attempts a zero-amount event rather than a reservation lifecycle for them. A failed event call is logged and does not stop the handoff.

## Three lines to runtime authority

The [`runcycles-openai-agents`](https://pypi.org/project/runcycles-openai-agents/) package implements `RunHooks` with the full reserve-commit lifecycle:

```python
from runcycles_openai_agents import CyclesRunHooks

hooks = CyclesRunHooks(tenant="acme")
result = await hooks.run(agent, input="Help me with my order")
```

No decorator is needed on each function and the tool definitions do not change. Calling the integration's run wrapper pairs the SDK hooks with run-scoped cleanup on exceptions and cancellation.

Behind the scenes, for every LLM call in the agent run:
1. `on_llm_start` creates a reservation with an estimated cost
2. The LLM call executes after the reservation succeeds
3. `on_llm_end` commits the reservation and records actual token counts from `response.usage` as metrics

For every tool call:
1. `on_tool_start` creates a reservation with the tool's risk-point cost
2. The application-authorized tool executes after the reservation succeeds
3. `on_tool_end` commits the tracked reservation estimate; the hook does not derive a cost from the tool result

For every handoff:
1. `on_handoff` attempts a zero-amount audit event in the Cycles ledger; a failed event response logs a warning

If an applicable budget is exhausted, the next governed hook raises `BudgetExceededError` before its protected call. Code paths outside the hooks are unaffected.

## Tool estimate mapping: exposure beyond tokens

Token costs are one dimension of the problem. But a `send_email` call and a `search_knowledge_base` call consume roughly the same number of tokens — yet their consequences are vastly different.

`ToolEstimateMap` assigns caller-defined per-call estimates to tools:

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

Zero-estimate tools skip the Cycles API entirely. In this example the application classifies search as read-only, but the integration does not verify that classification.

Higher-estimate tools consume budget proportional to their consequence, not their token usage. An agent with 500 risk points can send 10 emails (50 × 10 = 500) or make 50 CRM updates (10 × 50 = 500) or trigger 5 deployments (100 × 5 = 500) — but not all three. The budget enforces trade-offs that token counting alone cannot express.

The `default_estimate` parameter is a safety net. When someone adds a new tool and forgets to add it to the estimate map, that unmapped tool still submits a 1-point reservation. A tool explicitly mapped to zero skips the Cycles API, and any tool path outside these hooks remains unaffected.

This supports caller-assigned exposure budgeting. The application classifies `send_email`, restricts which tools are available, and supplies the risk-point estimate; Cycles enforces the applicable ledgers. Different tenant scopes can therefore receive different cumulative email exposure budgets, including an explicit zero-allocation ledger when submitted email reservations must be rejected.

For advanced cases, `ToolEstimateConfig` allows custom `action_kind` values per tool, enabling fine-grained filtering in the audit trail:

```python
"update_crm": ToolEstimateConfig(estimate=10, action_kind="tool.crm.update"),
```

## Pre-run budget check

`cycles_budget_guardrail` plugs into the SDK's `InputGuardrail` system to run a non-locking budget preflight _before the agent starts_:

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

Every handoff fires `on_handoff`, which attempts an audit event with the source and target agent names. This path is best effort: a failed Cycles response is logged and does not block the handoff. Agent B's tool calls share Agent A's budget only where their configured subject scopes overlap; explicitly allocated narrower agent scopes can impose additional per-agent limits.

Successful lifecycle and handoff records provide a trace of which agent called which tool, token metrics, committed risk points, and handoff timing. This is useful for debugging ("why did the agent run cost $12?") and for policy review ("the triage agent should hand off to the resolver, not the other way around").

## What this doesn't solve

Runtime action authority is one layer of agent governance. It's not the only one.

**Content filtering and tool authorization remain application concerns.** SDK input and tool guardrails can validate content and individual calls. Cycles does not inspect content or infer permission from the action name; it enforces the caller-assigned budget submitted at the hook boundary.

**Mid-stream token settlement isn't supported.** `hooks.run_streamed()` provides streaming execution with run-scoped cleanup, but the SDK hooks still commit LLM usage after the response completes through `on_llm_end`; they do not debit each streamed chunk.

**Exact cost prediction** isn't possible. Estimates are used before the LLM call to reserve budget. After the call, the reserved amount is committed and actual token counts are recorded as metrics. When using `llm_unit=Unit.TOKENS`, actual token counts are committed directly; with the default `llm_unit=Unit.USD_MICROCENTS`, the pre-estimated amount is committed. Either way, token metrics from `response.usage` are always recorded for observability.

**Fail-open defaults differ by component.** `cycles_budget_guardrail()` defaults to `fail_open=True`, so a failed preflight decision can allow the run. `CyclesRunHooks` defaults to `fail_open=False`, so LLM and tool reservation failures block unless you explicitly opt into fail-open behavior.

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

result = await hooks.run(agent, input="Help me!")
```

LLM and tool calls that pass through these hooks now submit their configured budget reservations, and handoffs attempt best-effort zero-amount events. If you need a Cycles server, follow the [end-to-end tutorial](/quickstart/end-to-end-tutorial).

## Further reading

- [OpenAI Agents integration guide](/how-to/integrating-cycles-with-openai-agents) — full configuration reference
- [Action Authority: Controlling What Agents Do](/concepts/action-authority-controlling-what-agents-do) — the concept behind tool-level governance
- [Choosing the Right Integration Pattern](/how-to/choosing-the-right-integration-pattern) — when to use hooks vs decorators vs middleware
- [Error Handling in Python](/how-to/error-handling-patterns-in-python) — handling `BudgetExceededError` and other Cycles exceptions
- [runcycles-openai-agents on PyPI](https://pypi.org/project/runcycles-openai-agents/) — package page
- [Source on GitHub](https://github.com/runcycles/cycles-openai-agents) — full source code and examples

## Related how-to guides

- [Assigning RISK_POINTS to agent tools](/how-to/assigning-risk-points-to-agent-tools)
- [Degradation paths](/how-to/how-to-think-about-degradation-paths-in-cycles-deny-downgrade-disable-or-defer)
- [Handling streaming responses](/how-to/handling-streaming-responses-with-cycles)
