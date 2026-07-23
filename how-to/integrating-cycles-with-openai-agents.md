---
title: "OpenAI Agents SDK Budget Control (Python)"
description: "Budget control for OpenAI Agents SDK workflows in Python — automatic reservation lifecycles for LLM and tool calls, plus best-effort handoff audit events."
---

# OpenAI Agents SDK Budget Control (Python)

[![PyPI](https://img.shields.io/pypi/v/runcycles-openai-agents)](https://pypi.org/project/runcycles-openai-agents/)
[![PyPI downloads](https://img.shields.io/pypi/dm/runcycles-openai-agents?label=downloads&color=555&style=flat-square)](https://pypi.org/project/runcycles-openai-agents/)

This guide shows how to add budget governance to [OpenAI Agents SDK](https://github.com/openai/openai-agents-python) workflows using the [`runcycles-openai-agents`](https://pypi.org/project/runcycles-openai-agents/) plugin. The plugin hooks into the SDK's native `RunHooks` interface to automatically reserve, commit, and release budget for LLM calls and tool invocations, and attempts to record agent handoffs as zero-amount direct-debit events — with no per-function decoration required.

## Prerequisites

```bash
pip install runcycles-openai-agents
```

Set environment variables:

```bash
export OPENAI_API_KEY="sk-..."         # required by the OpenAI Agents SDK
export CYCLES_BASE_URL="http://localhost:7878"
export CYCLES_API_KEY="cyc_live_..."    # create via Admin Server — see note below
```

> **Prefer not to use environment variables?** All settings can be loaded programmatically from any secret manager, vault, or encrypted config file:
>
> ```python
> from runcycles import CyclesConfig, AsyncCyclesClient
> from runcycles_openai_agents import CyclesRunHooks
>
> config = CyclesConfig(
>     base_url=load_from_vault("cycles_base_url"),
>     api_key=load_from_vault("cycles_api_key"),
> )
> hooks = CyclesRunHooks(client=AsyncCyclesClient(config), tenant="acme")
> ```
>
> See [Python Client Configuration](/configuration/python-client-configuration-reference) for all options.

> **Need a Cycles server or API key?** See [Deploy the Full Stack](/quickstart/deploying-the-full-cycles-stack) or [API Key Management](/how-to/api-key-management-in-cycles). For tenant and budget setup, see [Tenant Management](/how-to/tenant-creation-and-management-in-cycles) and [Budget Allocation](/how-to/budget-allocation-and-management-in-cycles).

::: tip 60-Second Quick Start
```python
from agents import Agent
from runcycles_openai_agents import CyclesRunHooks

hooks = CyclesRunHooks(tenant="acme")
agent = Agent(name="helper", instructions="You are a helpful assistant.")
result = await hooks.run(agent, input="What is budget authority?")
print(result.final_output)
```
That's it — every LLM call and tool invocation in the agent run is now budget-guarded. If the budget is exhausted, `BudgetExceededError` is raised _before_ the call is made. Read on for production patterns with tool estimate mapping and pre-run guardrails.
:::

## How it works

The plugin implements the SDK's `RunHooks` interface. Every hook in the agent lifecycle maps to a Cycles API call:

| Hook | Cycles API Call | Blocking | Detail |
|------|----------------|----------|--------|
| `on_tool_start` | `create_reservation` (tool estimate) | Raises on DENY | Budget reserved based on tool estimate map |
| `on_tool_end` | `commit_reservation` | No | Commits at the tool's reserved estimate |
| `on_llm_start` | `create_reservation` (LLM estimate) | Raises on DENY | Budget reserved before each LLM call |
| `on_llm_end` | `commit_reservation` | No | Commits at the reserved estimate — or at the actual token count when `llm_unit=Unit.TOKENS`. Token counts from `response.usage` are always recorded in `CyclesMetrics` |
| `on_handoff` | `create_event` (audit trail) | No | Attempts a zero-amount `RISK_POINTS` event; failures are logged and do not stop the handoff |

Reservations include automatic heartbeat. Extensions stop after `heartbeat_max_age_ms` (10 minutes by default) or the optional `heartbeat_max_extensions` cap, so raise those limits for longer operations. Heartbeat is skipped when `ttl_ms` is below 2000, since the minimum 1-second extend interval would exceed the TTL window.

## Tool estimate mapping

Assign per-call estimates to tools. Higher-estimate tools (send_email, deploy) consume budget faster. Zero-estimate tools skip the Cycles API entirely:

```python
from runcycles import Unit
from runcycles_openai_agents import CyclesRunHooks, ToolEstimateMap, ToolEstimateConfig

hooks = CyclesRunHooks(
    tenant="acme",
    tool_estimates=ToolEstimateMap(
        mapping={
            "send_email": 50,                       # 50 RISK_POINTS (default unit)
            "update_crm": ToolEstimateConfig(
                estimate=10,
                action_kind="tool.crm.update",
                unit=Unit.RISK_POINTS,              # explicit unit
            ),
            "search_knowledge": 0,                  # zero estimate — no reservation
        },
        default_estimate=1,                         # unmapped tools: 1 RISK_POINT
        default_unit=Unit.RISK_POINTS,              # unit for int shorthand values
    ),
)
```

Or use a simple dict:

```python
hooks = CyclesRunHooks(
    tenant="acme",
    tool_estimates={"send_email": 50, "search": 0},  # default unit: RISK_POINTS
)
```

## Pre-run guardrail

`cycles_budget_guardrail` returns an `InputGuardrail` that calls `/v1/decide` before the agent starts. If the tenant is suspended or budget is exhausted, the guardrail trips and the agent never runs — zero tokens consumed:

```python
from agents import Agent
from runcycles_openai_agents import cycles_budget_guardrail

guardrail = cycles_budget_guardrail(
    tenant="acme",
    estimate=5_000_000,       # expected total run estimate
    fail_open=True,           # allow if Cycles server is down
)

agent = Agent(
    name="support-bot",
    input_guardrails=[guardrail],
)
```

## Error handling

When budget is denied, the hooks raise `BudgetExceededError` — the agent stops and no further tokens are consumed. Use `hooks.run()` so failures and cancellations also release reservations that are still pending:

```python
from runcycles import BudgetExceededError

try:
    result = await hooks.run(agent, input="...")
except BudgetExceededError as e:
    print(f"Budget denied: {e}")
```

`hooks.run()` wraps `Runner.run()` and performs run-scoped cleanup when the run raises or is cancelled. Streaming runs get the same boundary through `hooks.run_streamed()`:

```python
streamed = hooks.run_streamed(agent, input="...")
async for event in streamed.stream_events():
    handle(event)
```

The OpenAI Agents SDK does not expose a general `RunHooks.on_error` callback. If you call bare `Runner.run(..., hooks=hooks)` or `Runner.run_streamed(..., hooks=hooks)`, automatic exception/cancellation cleanup cannot run. Prefer the wrappers, especially for concurrent runs. In a single-run bare-Runner error path, call `release_pending()`; it raises rather than guessing when multiple runs have pending reservations.

See [Error Handling Patterns in Python](/how-to/error-handling-patterns-in-python) for more patterns.

## Fail-open / fail-closed

`CyclesRunHooks` is fail-closed by default (`fail_open=False`): a transport failure while creating a reservation raises and prevents the governed call. Opt into availability-first behavior explicitly:

```python
hooks = CyclesRunHooks(tenant="acme", fail_open=True)
```

The separate `cycles_budget_guardrail()` helper defaults to `fail_open=True`; pass `fail_open=False` there if the pre-run decision must also fail closed.

A successful non-DENY response that omits `reservation_id` is currently logged and allowed to proceed without a hold. Alert on the `cycles: no reservation_id` warning if malformed upstream responses must not pass unnoticed.

## Configuration reference

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `client` | `AsyncCyclesClient` | `None` | Explicit client (or auto-created from config/env) |
| `config` | `CyclesConfig` | `None` | Creates client if no client given |
| `tenant` | `str` | `None` | Subject.tenant |
| `workspace` | `str` | `None` | Subject.workspace |
| `app` | `str` | `None` | Subject.app |
| `workflow` | `str` | `None` | Subject.workflow |
| `agent` | `str` | `None` | Subject.agent (overridden by actual agent name) |
| `toolset` | `str` | `None` | Subject.toolset |
| `tool_estimates` | `dict` or `ToolEstimateMap` | `{}` | Tool name → per-call estimate (default unit: RISK_POINTS) |
| `default_tool_estimate` | `int` | `1` | Estimate for unmapped tools |
| `llm_estimate` | `int` | `500_000` | Per-LLM-call estimate (~$0.005 in USD_MICROCENTS) |
| `llm_unit` | `Unit` | `USD_MICROCENTS` | Unit for LLM reservations |
| `fail_open` | `bool` | `False` | Allow LLM/tool execution if reservation creation fails |
| `ttl_ms` | `int` | `60_000` | Reservation TTL (heartbeat extends at half-interval) |
| `heartbeat_max_age_ms` | `int` | `600_000` | Maximum age of a pending operation for heartbeat extension |
| `heartbeat_max_extensions` | `int` or `None` | `None` | Optional cap on heartbeat extensions per reservation |
| `commit_max_attempts` | `int` | `2` | Attempts for transport, 429, and 5xx commit failures |
| `overage_policy` | `CommitOveragePolicy` | `ALLOW_IF_AVAILABLE` | Overage policy for commits |
| `dry_run` | `bool` | `False` | Shadow mode — no budget consumed |

## Comparison with manual integration

If you're already using the `@cycles` decorator from the [Python client](/quickstart/getting-started-with-the-python-client), the plugin automates the same reserve → commit → release pattern at the agent framework level:

| Concern | `@cycles` decorator | `CyclesRunHooks` plugin |
|---------|---------------------|-------------------------|
| Reserve before LLM call | Your code (per function) | Automatic via `on_llm_start` |
| Reserve before tool call | Your code (per function) | Automatic via `on_tool_start` |
| Commit after completion | Your code (per function) | Automatic via `on_llm_end` / `on_tool_end` |
| Release on run error or cancellation | Your code | Automatic with `hooks.run()` / `hooks.run_streamed()`; `release_pending()` for a single bare-Runner error path |
| Tool estimate policies | Not applicable | `ToolEstimateMap` with per-tool estimates |
| Pre-run guardrail | Not applicable | `cycles_budget_guardrail` |
| Agent handoff tracking | Not applicable | Best-effort audit events via `on_handoff` |
| Heartbeat for long tools | Not applicable | Automatic TTL extension |

The plugin is the recommended approach for OpenAI Agents SDK users. It requires no per-function decoration; use its run wrappers so hook governance and run-scoped cleanup stay paired. Handoff audit events are best effort and log failures without blocking the handoff.

## Examples

See the [`examples/`](https://github.com/runcycles/cycles-openai-agents/tree/main/examples) directory for runnable integration examples:

| Example | Description |
|---------|-------------|
| [`basic_budget.py`](https://github.com/runcycles/cycles-openai-agents/blob/main/examples/basic_budget.py) | LLM token budget enforcement |
| [`tool_governance.py`](https://github.com/runcycles/cycles-openai-agents/blob/main/examples/tool_governance.py) | Tool estimate mapping — higher-estimate tools consume more |
| [`multi_agent.py`](https://github.com/runcycles/cycles-openai-agents/blob/main/examples/multi_agent.py) | Multi-agent handoff with shared budget |

## Next steps

- [Error Handling Patterns in Python](/how-to/error-handling-patterns-in-python) — handling budget errors
- [Degradation Paths](/how-to/how-to-think-about-degradation-paths-in-cycles-deny-downgrade-disable-or-defer) — strategies for graceful degradation
- [Testing with Cycles](/how-to/testing-with-cycles) — testing budget-guarded code
- [Production Operations Guide](/how-to/production-operations-guide) — running Cycles in production
- [Cost Estimation Cheat Sheet](/how-to/cost-estimation-cheat-sheet) — pricing reference for estimation
- [runcycles-openai-agents on PyPI](https://pypi.org/project/runcycles-openai-agents/) — package page
- [Source on GitHub](https://github.com/runcycles/cycles-openai-agents) — full source code and examples

## Related concepts

- [Audit trail as a runtime-authority byproduct](/blog/runtime-authority-byproducts-audit-trail-and-attribution-by-default)
- [Graceful degradation patterns](/blog/when-budget-runs-out-graceful-degradation-patterns-for-ai-agents)
- [Multi-agent coordination failure: structural prevention](/blog/multi-agent-coordination-failure-structural-prevention)
