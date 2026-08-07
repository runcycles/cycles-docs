---
title: "Durable Budget Control for LangChain Agents"
date: 2026-08-07
author: Albert Mavashev
tags: [langchain, tutorial, budgets, reliability, middleware, agents]
description: "Build a LangChain agent that gates model and tool calls before execution, captures actual usage, and preserves settlement after failures."
blog: true
sidebar: false
featured: false
head:
  - - meta
    - name: keywords
      content: "LangChain budget middleware, durable AI agent accounting, CyclesModelGate, CyclesToolGate, create_agent budget control, LangGraph cost control"
---

# Durable Budget Control for LangChain Agents

A LangChain agent can make several model calls, select tools, retry a failed
step, and start another turn without returning control to your application.
That is exactly why a budget check wrapped around the outer HTTP route is not
enough.

The useful control points are inside the loop:

- before another model turn consumes tokens;
- before a tool performs a side effect; and
- before fan-out creates more work.

`langchain-runcycles` exposes those points as `AgentMiddleware` for LangChain
1.x. Version 0.4.0 also routes reserve-mode settlement through the Python SDK's
heartbeat and durable recovery lifecycle, so a failed commit does not erase
known spend.

<!-- more -->

## Install the integration

```bash
pip install "langchain-runcycles==0.4.0" langchain-anthropic
```

Version 0.4.0 requires `runcycles>=0.5.3`. Configure the Cycles client through
environment variables:

```bash
export CYCLES_BASE_URL="http://localhost:7878"
export CYCLES_API_KEY="cyc_live_replace_me"
export CYCLES_TENANT="acme"
```

`langchain-runcycles` is also listed in LangChain's official
[middleware integration directory](https://docs.langchain.com/oss/python/integrations/middleware)
as pre-execution budget authority for model calls, tool calls, and agent loops.

## Compose the three control boundaries

This example gives a support agent three separate controls:

1. a turn cap to stop runaway fan-out;
2. a model reservation settled from normalized provider usage; and
3. a tool reservation before an external email side effect.

```python
from langchain.agents import create_agent
from langchain.tools import tool
from langchain_runcycles import (
    CyclesFanOutGate,
    CyclesModelGate,
    CyclesToolGate,
)
from langchain_runcycles.extractors import anthropic_cost
from runcycles import Action, Amount, CyclesClient, CyclesConfig, Subject, Unit


client = CyclesClient(CyclesConfig.from_env())
subject = Subject(tenant="acme", workflow="support", agent="researcher")


@tool
def send_email(to: str, body: str) -> str:
    """Send an email after all middleware checks pass."""
    # Replace with an idempotent provider call in production.
    return f"Sent to {to}"


agent = create_agent(
    model="claude-sonnet-4-6",
    tools=[send_email],
    middleware=[
        CyclesFanOutGate(
            max_turns=20,
            client=client,
            subject=subject,
            action=Action(kind="model.turn", name="support"),
        ),
        CyclesModelGate(
            client,
            subject=subject,
            action=Action(kind="llm.completion", name="claude-sonnet-4-6"),
            mode="decide+reserve",
            estimate=Amount(unit=Unit.USD_MICROCENTS, amount=2_500_000),
            cost_fn=anthropic_cost(
                input_per_million_usd=3.00,
                output_per_million_usd=15.00,
                cache_read_per_million_usd=0.30,
                cache_creation_5m_per_million_usd=3.75,
                cache_creation_1h_per_million_usd=6.00,
            ),
            settlement_error_policy="raise",
        ),
        CyclesToolGate(
            client,
            subject=subject,
            action={
                "send_email": Action(kind="tool.call", name="send_email"),
            },
            mode="decide+reserve",
            idempotency_namespace=lambda request: request.state.get("run_id"),
            settlement_error_policy="log",
        ),
    ],
)

agent.invoke(
    {
        "messages": [{"role": "user", "content": "Email the customer."}],
        "run_id": "support-run-123",
    }
)
```

The pricing values are configuration, not a live provider-price lookup. Verify
the model and cache tier against the provider's current pricing before
deployment.

The middleware order is intentional. The fan-out gate stops another turn, the
model gate authorizes model spend, and the tool gate separately authorizes the
side effect. A single outer reservation cannot express those boundaries.

## Choose the gate mode deliberately

`CyclesModelGate` and `CyclesToolGate` support three modes:

| Mode | What happens |
|---|---|
| `"decide"` | Run a policy and budget preflight without creating a hold |
| `"reserve"` | Reserve before the handler and settle after it returns |
| `"decide+reserve"` | Run both checks, separating policy from accounting |

Both `ALLOW` and `ALLOW_WITH_CAPS` permit execution. A denied tool becomes a
correlated `ToolMessage` so the model can choose a safer path. A denied model
call returns a `ModelResponse` that ends the loop. The protected handler does
not run on an unproven allow.

Use `"decide"` for action permission without metering. Use a reserve mode when
the action consumes a budget and must settle actual usage afterward.

## What happens after the handler returns

Reserve mode owns more than the happy-path commit:

1. It heartbeats the reservation while the model or tool handler runs.
2. It resolves the actual amount from `cost_fn`, or uses the configured
   estimate with an explicit marker when actual extraction is invalid.
3. It persists the known settlement before the first commit request.
4. It retries eligible failures with the same idempotency key.
5. It replays an unresolved journal after restart.
6. If the reservation expires, it records the spend through `POST /v1/events`.

The default journal lives at `~/.runcycles/commit-journal`. The current process
does not need to stay alive for the settlement intent to survive.

This also changes what must *not* happen. Once the handler returns successfully,
a commit rejection does not release the reservation. Releasing would return
capacity for a model call or side effect that already occurred.

## `raise` and `log` do not change durability

`settlement_error_policy` determines what the current LangChain invocation
observes after recovery is queued:

| Policy | Caller behavior | Recovery behavior |
|---|---|---|
| `"raise"` | Raise `CyclesProtocolError` | Settlement remains journaled and recoverable |
| `"log"` | Log and return the handler result | The same durable recovery continues |

The model gate above uses `"raise"`: the caller must stop or explicitly
reconcile when model accounting does not complete synchronously.

The email tool uses `"log"` because repeating an already-sent email could be
worse than returning while settlement recovery continues. This does not make
the accounting best effort. It makes the application response policy different
from the recovery policy.

The external side effect still needs its own idempotency key. Cycles prevents a
settlement replay from charging twice; it cannot make an email or payment API
idempotent on the application's behalf.

## Stable tool-call identity

LangChain normally supplies `tool_call_id`, which gives the tool reservation a
stable identity. Some runtimes reuse short IDs such as `tc_1` across separate
runs, so the example also supplies an `idempotency_namespace` derived from the
agent's `run_id`.

The resulting key is stable inside one run and distinct across runs. If no
tool-call ID exists, the middleware logs and generates a random fallback; do
not assume that fallback survives a framework redispatch.

Model and fan-out hooks do not have an equivalent stable upstream call ID.
They use a fresh UUID within the optional namespace, so application code should
not treat those keys as durable identities for an independently redispatched
model call.

## Actual usage includes cache details

The model cost extractors read LangChain's normalized
`AIMessage.usage_metadata`. Version 0.4.0 can price cache reads separately and,
for Anthropic-shaped usage, distinguish cache-creation tiers.

That matters because total input tokens alone do not describe the provider
charge when part of the prompt came from cache. The rates remain
caller-supplied; the integration deliberately does not turn provider pricing
pages into an implicit runtime dependency.

If usage metadata is malformed, a count is invalid, or the returned unit does
not match the reservation, the lifecycle commits the configured estimate with
`metadata.actual_source="estimate"`. The action already ran, so invalid
post-action accounting is not converted into a release.

## Async and streaming boundaries

Pass `AsyncCyclesClient` and use `.ainvoke()` for async agents. Completed
`agent.astream(...)` and `agent.astream_events(...)` runs are heartbeated and
settled once from LangChain's final aggregated usage metadata.

A cancelled or failed stream may end before LangChain produces final normalized
usage. In that case, the middleware cannot know the actual amount and releases
the reservation. Reconcile any provider charge for the partial stream from
provider billing telemetry.

This is the same evidence boundary as the core SDK: durable recovery begins
after the actual amount is known. It cannot reconstruct a receipt the provider
never delivered to the application.

## Test the failure path before production

A useful integration test does more than assert that an allowed model call
returns text:

1. run the Cycles server and a test agent;
2. allow the provider handler to return known usage;
3. interrupt the commit response or stop the client process;
4. confirm that a journal record remains;
5. restore connectivity and start the client lifecycle again; and
6. confirm that the ledger records the spend once.

Also test denial before execution, a handler exception that releases the hold,
an expired reservation that switches to event recovery, and a non-idempotent
tool with the caller policy you intend to use.

The shared [SDK recovery conformance matrix](/protocol/sdk-recovery-conformance)
publishes the underlying fleet behavior. Your application test should cover
the final boundary Cycles cannot infer: how your framework and provider expose
actual usage and external side-effect identity.

## Start with one expensive or risky boundary

You do not need to instrument an entire agent graph at once. Begin with one
model call that dominates cost or one tool whose side effect is difficult to
reverse. Add the corresponding gate, run in shadow or dry-run mode if needed,
then move to pre-execution enforcement after the scope and estimate are stable.

From there, add the other boundaries independently. That preserves the reason
for using middleware in the first place: the model loop, tool side effect, and
fan-out decision are different actions with different authority and recovery
requirements.

---

*Continue with the complete [LangChain integration guide](/how-to/integrating-cycles-with-langchain), the [settlement durability contract](/protocol/sdk-settlement-recovery-and-durability), and [the failure story behind this release](/blog/the-model-call-succeeded-then-the-process-died).*
