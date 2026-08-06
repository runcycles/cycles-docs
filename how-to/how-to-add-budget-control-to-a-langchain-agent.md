---
title: "How to Add Budget Control to a LangChain Agent"
description: "A production-safe LangChain 1.x setup using Cycles model, tool, and fan-out middleware."
---

# How to Add Budget Control to a LangChain Agent

This walkthrough gates a LangChain 1.x agent at all three execution boundaries:
model calls, tool side effects, and repeated model turns.

## 1. Install and configure

```bash
pip install "langchain-runcycles>=0.4.0" langchain-openai

export CYCLES_BASE_URL="http://localhost:7878"
export CYCLES_API_KEY="your-api-key"
export CYCLES_TENANT="acme"
export OPENAI_API_KEY="sk-..."
```

Create the tenant budget and API key before running the agent. See
[Deploy the Full Stack](/quickstart/deploying-the-full-cycles-stack) for a local
server setup.

## 2. Build the gated agent

```python
from langchain.agents import create_agent
from langchain.tools import tool
from langchain_runcycles import CyclesFanOutGate, CyclesModelGate, CyclesToolGate
from langchain_runcycles.extractors import openai_cost
from runcycles import Action, Amount, CyclesClient, CyclesConfig, Subject, Unit

client = CyclesClient(CyclesConfig.from_env())
subject = Subject(tenant="acme", workflow="collections", agent="notifier")

@tool
def send_notice(account_id: str, body: str) -> str:
    """Send one collections notice."""
    return f"sent:{account_id}"

agent = create_agent(
    model="gpt-4o",
    tools=[send_notice],
    middleware=[
        CyclesFanOutGate(
            max_turns=12,
            client=client,
            subject=subject,
            action=Action(kind="model.turn", name="collections"),
        ),
        CyclesModelGate(
            client,
            subject=subject,
            action=Action(kind="llm.completion", name="gpt-4o"),
            mode="decide+reserve",
            estimate=Amount(unit=Unit.USD_MICROCENTS, amount=2_000_000),
            cost_fn=openai_cost(
                prompt_per_million_usd=2.50,
                cached_prompt_per_million_usd=1.25,
                completion_per_million_usd=10.00,
            ),
        ),
        CyclesToolGate(
            client,
            subject=subject,
            action={"send_notice": Action(kind="tool.call", name="send_notice")},
            mode="decide+reserve",
            estimate=Amount(unit=Unit.RISK_POINTS, amount=1),
            idempotency_namespace="collections-run-123",
            settlement_error_policy="log",
        ),
    ],
)
```

The model reservation limits cost. The tool reservation uses `RISK_POINTS` so
operators can independently cap side-effect exposure. `settlement_error_policy`
is `"log"` for the notice because an agent retry must not send it twice; durable
settlement recovery still remains queued.

## 3. Invoke and handle denials

```python
result = agent.invoke({
    "messages": [{"role": "user", "content": "Send the approved notice."}],
    "run_id": "collections-run-123",
})
```

When a model reservation is denied, the middleware returns a terminal
`ModelResponse`. When the tool is denied, the model receives a correlated
`ToolMessage`, and `send_notice` never runs. `ALLOW_WITH_CAPS` is also an allowed
decision; apply relevant caps in your host or model configuration.

At the raw API boundary, insufficient reserve returns HTTP 409
`BUDGET_EXCEEDED`. The middleware converts it to the LangChain denial result;
do not write low-level code that treats only 2xx responses as possible denials.

## 4. Understand the failure behavior

Reserve mode is not a three-call teaching snippet. While the handler runs, the
Python SDK heartbeats the lease. After success it journals the exact commit
before the first network attempt. Transient failure survives process restart,
and an expired reservation transitions to an idempotent `/v1/events` recovery.

Only handler failure before an actual is recorded uses release. A commit error
after the action ran never releases known spend.

For completed model streams, LangChain supplies final aggregated normalized
usage and the same settlement path applies. A cancelled partial stream has no
final usage object; reconcile any provider charge from provider telemetry.

## 5. Validate before production

- Use a run-scoped `idempotency_namespace`; do not hard-code one across all runs.
- Keep tool side effects idempotent even when the Cycles reservation key is stable.
- Verify the price rates for the exact model and cache tier you deploy.
- Exercise deny, timeout, process-restart, expired-reservation, and stream-cancel paths.
- Monitor the SDK commit journal and settlement warnings.

## Next steps

- [Full LangChain integration guide](/how-to/integrating-cycles-with-langchain)
- [Caps and the three-way decision model](/protocol/caps-and-the-three-way-decision-model-in-cycles)
- [SDK settlement recovery and durability](/protocol/sdk-settlement-recovery-and-durability)
