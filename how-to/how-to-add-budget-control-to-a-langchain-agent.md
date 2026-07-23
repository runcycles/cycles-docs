---
title: "How to Add Budget Control to a LangChain Agent"
description: "Wrap a LangChain create_agent run with per-run budget limits using Cycles reservations — without rewriting agent logic. Python examples with the @cycles decorator."
---

# How to Add Budget Control to a LangChain Agent

LangChain makes it easy to build agents that call LLMs, search the web, execute code, and chain tool calls together. What it doesn't give you is any way to cap how much a single agent run is allowed to spend.

That's fine when you're experimenting. It's a real problem when you're running agents in production — especially across multiple users or tenants. A single misbehaving agent loop can burn through hundreds of dollars before anyone notices.

This guide shows how to add per-run budget control to a LangChain agent using [Cycles](https://runcycles.io) — without rewriting your agent logic.

::: tip Pick the right pattern for your shape

Three patterns, three different scopes — pick based on what you actually want to budget.

- **Building with `create_agent` (LangChain 1.x agents)?** Use [`langchain-runcycles`](https://pypi.org/project/langchain-runcycles/) middleware. `CyclesToolGate` gates tool calls *before* they execute (denial returns a `ToolMessage` so the agent recovers); `CyclesFanOutGate` caps model turns. See [the agent middleware section](/how-to/integrating-cycles-with-langchain#agent-middleware-via-langchain-runcycles).
- **Want per-LLM-call tracking** (reservation around every model invocation)? Install [`CyclesBudgetHandler`](/how-to/integrating-cycles-with-langchain#callback-handler-for-non-agent-runnables) — works on any LangChain runnable.
- **This page** covers a third pattern: a **single reservation around the entire agent run**, plus optional tool-level checks. Best when you want one cap per run regardless of how many LLM/tool calls happen inside.
:::

## The problem

Here's a typical LangChain agent loop:

```python
from langchain.agents import create_agent
from langchain_openai import ChatOpenAI
from langchain_core.tools import tool

@tool
def search_web(query: str) -> str:
    """Search the web for information."""
    return your_search_implementation(query)

agent = create_agent(
    model=ChatOpenAI(model="gpt-4o"),
    tools=[search_web],
    system_prompt="You are a research assistant.",
)

result = agent.invoke(
    {"messages": [{"role": "user", "content": "Research the top 10 competitors..."}]}
)
```

This works. But there's no limit on how many LLM calls the agent makes, how many tool invocations it triggers, or what it costs. If the agent gets stuck in a loop, retries a failing tool, or expands scope unexpectedly, it keeps running — and spending — until it either finishes or hits the provider's rate limits.

## The fix: reserve before, commit after

The pattern Cycles uses is borrowed from database transactions:

1. **Reserve** budget before the agent run starts
2. **Execute** the agent if the reservation is granted
3. **Commit** actual usage after — releases unused budget back to the pool
4. **Release** the full reservation if the run fails

This gives you hard limits that are enforced *before* spend happens — not discovered afterward on your bill.

## Prerequisites

```bash
pip install runcycles langchain langchain-openai
```

```bash
export CYCLES_BASE_URL="http://localhost:7878"
export CYCLES_API_KEY="your-api-key"
export OPENAI_API_KEY="sk-..."
```

> **Need an API key?** Create one via the Admin Server — see [Deploy the Full Stack](/quickstart/deploying-the-full-cycles-stack#step-3-create-an-api-key) or [API Key Management](/how-to/api-key-management-in-cycles).

## Per-run budget wrapper

Wrap your agent invocation in a single Cycles reservation:

```python
import uuid
from langchain.agents import create_agent
from langchain_openai import ChatOpenAI
from langchain_core.tools import tool
from runcycles import (
    CyclesClient, CyclesConfig, ReservationCreateRequest,
    CommitRequest, ReleaseRequest, Subject, Action, Amount,
    Unit, BudgetExceededError, CyclesProtocolError,
)

client = CyclesClient(CyclesConfig.from_env())

@tool
def search_web(query: str) -> str:
    """Search the web for information."""
    return your_search_implementation(query)

def run_agent_with_budget(
    user_input: str,
    tenant: str,
    budget_microcents: int,
) -> dict:
    key = str(uuid.uuid4())

    # 1. Reserve budget for the entire run
    res = client.create_reservation(ReservationCreateRequest(
        idempotency_key=key,
        subject=Subject(tenant=tenant, workflow="research"),
        action=Action(kind="agent.run", name="research-task"),
        estimate=Amount(unit=Unit.USD_MICROCENTS, amount=budget_microcents),  # 1 USD = 100_000_000 microcents
        ttl_ms=120_000,
    ))

    if not res.is_success:
        error = res.get_error_response()
        if error and error.error == "BUDGET_EXCEEDED":
            raise BudgetExceededError(
                error.message, status=res.status,
                error_code=error.error, request_id=error.request_id,
            )
        msg = error.message if error else (res.error_message or "Reservation failed")
        raise CyclesProtocolError(msg, status=res.status)

    reservation_id = res.get_body_attribute("reservation_id")
    decision = res.get_body_attribute("decision")

    # 2. Execute the agent — apply any configured caps
    try:
        if decision == "ALLOW_WITH_CAPS":
            llm = ChatOpenAI(model="gpt-4o-mini")
        else:
            llm = ChatOpenAI(model="gpt-4o")
        agent = create_agent(
            model=llm,
            tools=[search_web],
            system_prompt="You are a research assistant.",
        )

        result = agent.invoke(
            {"messages": [{"role": "user", "content": user_input}]}
        )

        # 3. Commit actual usage
        client.commit_reservation(reservation_id, CommitRequest(
            idempotency_key=f"commit-{key}",
            actual=Amount(
                unit=Unit.USD_MICROCENTS,
                amount=budget_microcents // 2,  # replace with real tracking
            ),
        ))
        return result

    except Exception:
        # 4. Release on failure — budget returns to the pool
        client.release_reservation(
            reservation_id,
            ReleaseRequest(idempotency_key=f"release-{key}"),
        )
        raise

# Run it
result = run_agent_with_budget(
    user_input="Research the top 10 competitors in the CRM space",
    tenant="acme",
    budget_microcents=5_000_000_000,  # $50.00
)
```

::: info Crash safety
If the agent crashes before committing or releasing, the reservation expires automatically after `ttl_ms` and the held budget returns to the pool. See [TTL, Grace Period, and Extend](/protocol/reservation-ttl-grace-period-and-extend-in-cycles).
:::

## Adding tool-level budget checks

Individual tools can also reserve budget before costly operations. If the tool's reservation is denied, it returns a skip message instead of failing:

```python
@tool
def search_web(query: str) -> str:
    """Search the web for information."""
    tool_key = str(uuid.uuid4())

    # Reserve before the tool call
    res = client.create_reservation(ReservationCreateRequest(
        idempotency_key=tool_key,
        subject=Subject(tenant="acme", toolset="web-search"),
        action=Action(kind="tool.call", name="search-web"),
        estimate=Amount(unit=Unit.USD_MICROCENTS, amount=100_000_000),  # $1.00
        ttl_ms=30_000,
    ))

    if not res.is_success:
        return "Budget exhausted — skipping web search."

    tool_reservation_id = res.get_body_attribute("reservation_id")

    # Execute the tool
    results = your_search_implementation(query)

    # Commit actual usage
    client.commit_reservation(tool_reservation_id, CommitRequest(
        idempotency_key=f"commit-{tool_key}",
        actual=Amount(unit=Unit.USD_MICROCENTS, amount=40_000_000),  # $0.40
    ))

    return results
```

## Multi-tenant scoping

Use the `Subject` hierarchy to give each customer their own budget scope:

```python
def run_for_customer(customer_id: str, user_input: str):
    return run_agent_with_budget(
        user_input=user_input,
        tenant=customer_id,
        budget_microcents=10_000_000_000,  # $100.00, or pull from the customer's plan
    )
```

Each customer's spend is tracked independently. One customer burning through their budget doesn't affect others.

## Graceful degradation with ALLOW_WITH_CAPS

When the deepest matching budget has caps configured, Cycles can return `ALLOW_WITH_CAPS`. Use the returned caps to switch to a cheaper model or limit tool access. This is configuration-driven, not an automatic low-balance transition:

```python
res = client.create_reservation(ReservationCreateRequest(
    idempotency_key=key,
    subject=Subject(tenant=tenant, workflow="research"),
    action=Action(kind="agent.run", name="research-task"),
    estimate=Amount(unit=Unit.USD_MICROCENTS, amount=5_000_000_000),  # $50.00
    ttl_ms=120_000,
))

if not res.is_success:
    # Budget denial arrives as a 409 BUDGET_EXCEEDED error — handle it here
    error = res.get_error_response()
    if error and error.error == "BUDGET_EXCEEDED":
        raise BudgetExceededError(
            error.message, status=res.status,
            error_code=error.error, request_id=error.request_id,
        )
    raise CyclesProtocolError(...)

# On success, decision is ALLOW or ALLOW_WITH_CAPS
decision = res.get_body_attribute("decision")

if decision == "ALLOW_WITH_CAPS":
    # This example maps the configured caps policy to a cheaper model.
    llm = ChatOpenAI(model="gpt-4o-mini")
else:
    # ALLOW — full capacity
    llm = ChatOpenAI(model="gpt-4o")
```

See [Caps and Three-Way Decisions](/protocol/caps-and-the-three-way-decision-model-in-cycles) for more on how `ALLOW_WITH_CAPS` works and what cap fields are available.

## What you get

With this pattern in place:

- **Per-tenant isolation** — `Subject(tenant="acme")` means each customer's budget is tracked and enforced independently
- **Graceful degradation** — `ALLOW_WITH_CAPS` lets agents downgrade instead of stopping cold
- **Automatic reconciliation** — committing less than the reserved amount releases the difference back to the pool
- **Crash safety** — if the agent crashes before committing, the reservation expires automatically and budget is released

## Next steps

- [Integrating Cycles with LangChain](/how-to/integrating-cycles-with-langchain) — per-LLM-call callback handler pattern
- [Reserve / Commit Lifecycle](/protocol/how-reserve-commit-works-in-cycles) — protocol deep-dive
- [Degradation Paths](/how-to/how-to-think-about-degradation-paths-in-cycles-deny-downgrade-disable-or-defer) — strategies for deny, downgrade, disable, or defer
- [Add to a Python App](/quickstart/getting-started-with-the-python-client) — Python client quickstart
