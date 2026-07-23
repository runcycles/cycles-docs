---
title: "Choosing the Right Integration Pattern"
description: "Pick the right Cycles integration pattern for your use case: decorator, streaming adapter, middleware, agent hooks, or programmatic client."
---

# Choosing the Right Integration Pattern

Each Cycles SDK offers multiple integration patterns. This guide helps you pick the right one for your use case.

## Decision tree

<DecisionTree />

## Pattern comparison

| Pattern | Languages | Best for | Streaming | Auto-heartbeat | Auto-commit |
|---|---|---|---|---|---|
| **MCP Server** | Any (agent-native) | Cooperative budget-tool exposure in MCP hosts | — | — | — |
| **Agent framework plugin** | Python, TypeScript | Agent SDKs with lifecycle hooks | — | Yes | Yes |
| **Decorator / HOF** | Python `@cycles`, TS `withCycles`, Java `@Cycles` | Simple function calls | No | Yes | Yes |
| **Streaming adapter** | Python `stream_reservation`, TS `reserveForStream` | Streaming responses | Yes | Yes | Manual |
| **Middleware** | Express, FastAPI | Per-request budget in web apps | Both | Depends | Manual |
| **Programmatic client** | All languages | Full control, complex flows | Both | Manual | Manual |

## Pattern 0: MCP Server (zero-code tool exposure)

If your agent runs in an MCP-compatible host — Claude Desktop, Claude Code, Cursor, or Windsurf — you can expose Cycles tools without an SDK integration. This is cooperative: the standalone MCP server does not automatically wrap or block the host's other tools.

```bash
# Claude Code
claude mcp add \
  --transport stdio \
  --env CYCLES_API_KEY=cyc_live_... \
  --env CYCLES_BASE_URL=http://localhost:7878 \
  cycles \
  -- npx -y @runcycles/mcp-server
```

The agent may call `cycles_reserve`, `cycles_commit`, and other tools as part of its reasoning. No application code wraps the LLM call, so this alone is not a hard limit. Use **Cycles Budget Guard for Claude Code** or a mandatory handler, gateway, harness, or service boundary when the protected action must not bypass the reservation.

**Use when:**
- The agent host supports MCP
- You want budget awareness with zero code changes
- Cooperative, model-managed budget lifecycle is acceptable

**Don't use when:**
- You're building a non-agent application (web API, batch pipeline)
- You need a hard limit but cannot add a mandatory host or application boundary

See [Getting Started with the MCP Server](/quickstart/getting-started-with-the-mcp-server) for setup instructions.

## Pattern 0a: Agent framework plugin

For agent frameworks that expose lifecycle hooks, a plugin implements the framework's hook interface to create reservations on start and commit on end — covering the entire agent run automatically with no per-function decoration.

| Framework | Plugin / package | Hook surface |
|---|---|---|
| OpenAI Agents SDK | `runcycles_openai_agents.CyclesRunHooks` | `RunHooks` interface |
| OpenClaw | Plugin hooks | `before_model_resolve`, `before_tool_call`, etc. |
| **LangChain 1.x** (`langchain.agents.create_agent`) | [**`langchain-runcycles`**](https://pypi.org/project/langchain-runcycles/) — `CyclesToolGate`, `CyclesFanOutGate` | `wrap_tool_call`, `before_model` (`AgentMiddleware` API) |

```python
# LangChain 1.x agent middleware
from langchain.agents import create_agent
from langchain_runcycles import CyclesFanOutGate, CyclesToolGate
from runcycles import Action, Subject

agent = create_agent(
    model="claude-sonnet-4-6",
    tools=[...],
    middleware=[
        CyclesFanOutGate(max_turns=20, client=client, subject=Subject(tenant="acme"), action=Action(kind="model.turn", name="research")),
        CyclesToolGate(client, subject=Subject(tenant="acme"), action={"send_email": Action(kind="tool.call", name="send_email")}, mode="decide"),
    ],
)
```

```python
# OpenAI Agents SDK
from agents import Agent
from runcycles_openai_agents import CyclesRunHooks

hooks = CyclesRunHooks(
    tenant="acme",
    tool_estimates={"send_email": 50, "search": 0},  # default unit: RISK_POINTS
)
result = await hooks.run(agent, input="...")
```

**Use when:**
- You're using an agent framework with lifecycle hooks (OpenAI Agents SDK, OpenClaw, LangChain 1.x `create_agent`)
- You want automatic budget governance on LLM and tool calls, plus best-effort handoff audit events
- You need tool-level risk mapping (different costs per tool)
- You want agent handoff tracking in the Cycles ledger

**Don't use when:**
- You're not using an agent framework (use `@cycles` decorator instead)
- You need per-function control over estimation and commit (use programmatic client)
- You're using bare LangChain (`ChatOpenAI`, chains, RAG) without `create_agent` — use the [LangChain callback handler](/how-to/integrating-cycles-with-langchain#callback-handler-for-non-agent-runnables) instead

See [Integrating with LangChain](/how-to/integrating-cycles-with-langchain) (Python agent middleware), [OpenAI Agents](/how-to/integrating-cycles-with-openai-agents), or [OpenClaw](/how-to/integrating-cycles-with-openclaw).

## Pattern 1: Decorator / Higher-Order Function

The simplest pattern. Wrap a function and let the SDK handle the full reserve-execute-commit lifecycle.

::: code-group
```python [Python]
@cycles(estimate=2000000, action_kind="llm.completion", action_name="gpt-4o")
def ask(prompt: str) -> str:
    return openai.chat.completions.create(
        model="gpt-4o",
        messages=[{"role": "user", "content": prompt}],
    ).choices[0].message.content
```
```typescript [TypeScript]
const ask = withCycles(
  { estimate: 2000000, actionKind: "llm.completion", actionName: "gpt-4o" },
  async (prompt: string) => {
    const res = await openai.chat.completions.create({
      model: "gpt-4o",
      messages: [{ role: "user", content: prompt }],
    });
    return res.choices[0].message.content;
  },
);
```
```java [Java]
@Cycles(estimate = "2000000", actionKind = "llm.completion", actionName = "gpt-4o")
public String ask(String prompt) {
    return callOpenAI(prompt);
}
```
:::

**Use when:**
- The function makes one LLM/API call and returns a result
- You don't need to stream the response
- You want minimal code changes

**Don't use when:**
- The function streams output (use a streaming adapter instead)
- You need to control when the commit happens (use programmatic client)

Note that the decorator *can* commit with actual token-derived costs: both SDKs accept an `actual` callable that receives the function's return value — `@cycles(estimate=..., actual=lambda result: len(result) * 5)` in Python, `withCycles({ estimate: ..., actual: (result) => result.usage.total_tokens * 10 }, ...)` in TypeScript.

## Pattern 2: Streaming adapter

For streaming responses where the function returns before the stream finishes.

### TypeScript (`reserveForStream`)

```typescript
const handle = await reserveForStream({
  client: cyclesClient,
  estimate: 5000000,
  actionKind: "llm.completion",
  actionName: "gpt-4o",
});

try {
  const stream = await openai.chat.completions.create({
    model: "gpt-4o",
    messages: [{ role: "user", content: prompt }],
    stream: true,
  });

  let inputTokens = 0, outputTokens = 0;
  for await (const chunk of stream) {
    // ... consume stream, track tokens ...
  }

  await handle.commit(actualCost, { tokensInput: inputTokens, tokensOutput: outputTokens });
} catch (err) {
  await handle.release("stream_error");
  throw err;
}
```

### Python (`stream_reservation`)

The Python client's equivalent is `client.stream_reservation(...)` — a context manager that reserves on enter and commits (or releases, on exception) on exit:

```python
with client.stream_reservation(
    action=Action(kind="llm.completion", name="gpt-4o"),
    estimate=Amount(unit=Unit.USD_MICROCENTS, amount=5_000_000),
    cost_fn=lambda u: u.tokens_input * 250 + u.tokens_output * 1000,
) as reservation:
    for chunk in stream:
        # ... consume stream, track tokens ...
        reservation.usage.add_output_tokens(chunk_tokens)
# Auto-committed on success, auto-released on exception.
```

**Use when:**
- The LLM response is streamed to the client
- You need to track token counts from stream events
- You want automatic heartbeat during streaming

**Don't use when:**
- The response is not streamed (use `withCycles` instead — simpler)

## Pattern 3: Middleware

For web applications where every request needs budget governance.

::: code-group
```typescript [Express]
// cyclesGuard is an example pattern (not exported by the SDK) — build it from
// the programmatic client; see Integrating Cycles with Express for the full source.
app.post("/api/chat", cyclesGuard({ client, actionKind: "llm.completion", ... }), handler);
```
```python [FastAPI]
@app.post("/api/chat")
@cycles(estimate=2000000, action_kind="llm.completion", action_name="gpt-4o")
async def chat(request: ChatRequest):
    ...
```
:::

See [Integrating Cycles with Express](/how-to/integrating-cycles-with-express) for a complete `cyclesGuard` middleware implementation.

**Use when:**
- Budget enforcement should apply to every request on a route
- You want to return HTTP 402 when budget is exhausted
- Budget should be scoped per-request (e.g., per-tenant)

**Don't use when:**
- Budget logic varies significantly between requests on the same route
- You're not in a web framework context

## Pattern 4: Programmatic client

Full control over the reserve-commit lifecycle. Use this when no higher-level pattern fits.

::: code-group
```python [Python]
client = CyclesClient(config)

reservation = client.create_reservation({
    "idempotency_key": "req-001",
    "subject": {"tenant": "acme-corp"},
    "action": {"kind": "llm.completion", "name": "gpt-4o"},
    "estimate": {"amount": 2000000, "unit": "USD_MICROCENTS"},
    "ttl_ms": 30000,
})

if reservation.status == 409:
    # Live (non-dry-run) denials are HTTP 409 BUDGET_EXCEEDED — there is
    # no decision field to check (decision=DENY only appears when dry_run=true).
    handle_denial()
elif reservation.is_success:
    reservation_id = reservation.body["reservation_id"]
    result = call_llm()
    client.commit_reservation(reservation_id, {
        "idempotency_key": "commit-001",
        "actual": {"amount": actual_cost, "unit": "USD_MICROCENTS"},
    })
```
```typescript [TypeScript]
// The TypeScript client sends and receives wire-format (snake_case) JSON.
const reservation = await client.createReservation({
  idempotency_key: "req-001",
  subject: { tenant: "acme-corp" },
  action: { kind: "llm.completion", name: "gpt-4o" },
  estimate: { amount: 2000000, unit: "USD_MICROCENTS" },
  ttl_ms: 30000,
});

if (reservation.status === 409) {
  // Live (non-dry-run) denials are HTTP 409 BUDGET_EXCEEDED — there is
  // no decision field to check (decision=DENY only appears when dry_run=true).
  handleDenial();
} else if (reservation.isSuccess) {
  const reservationId = reservation.getBodyAttribute("reservation_id") as string;
  const result = await callLLM();
  await client.commitReservation(reservationId, {
    idempotency_key: "commit-001",
    actual: { amount: actualCost, unit: "USD_MICROCENTS" },
  });
}
```
:::

**Use when:**
- You need to inspect the reservation decision before proceeding
- You need to commit with exact actual token counts
- You're building a custom integration layer
- You need to manage TTL extensions manually
- The operation spans multiple steps with different commit points

**Don't use when:**
- A decorator or streaming adapter would work — they handle heartbeat, retry, and cleanup automatically

## Combining patterns

In practice, most applications use multiple patterns:

```python
# Simple calls — decorator
@cycles(estimate=500000, action_kind="llm.completion", action_name="gpt-4o-mini")
def classify(text: str) -> str:
    ...

# Complex flows — programmatic
async def agent_loop(task: str):
    client = CyclesClient(config)
    while not done:
        reservation = client.create_reservation(...)
        result = call_tool(...)
        client.commit_reservation(...)
```

## Next steps

- [Getting Started with the MCP Server](/quickstart/getting-started-with-the-mcp-server) — zero-code runtime authority for Claude / Cursor / Windsurf
- [Integrating with OpenAI Agents](/how-to/integrating-cycles-with-openai-agents) — budget governance for OpenAI Agents SDK
- [Getting Started with Python](/quickstart/getting-started-with-the-python-client)
- [Getting Started with TypeScript](/quickstart/getting-started-with-the-typescript-client)
- [Getting Started with Spring Boot](/quickstart/getting-started-with-the-cycles-spring-boot-starter)
- [Handling Streaming Responses](/how-to/handling-streaming-responses-with-cycles)
