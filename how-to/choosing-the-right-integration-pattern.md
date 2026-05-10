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
| **MCP Server** | Any (agent-native) | MCP-compatible AI agents | — | — | — |
| **Agent framework plugin** | Python, TypeScript | Agent SDKs with lifecycle hooks | — | Yes | Yes |
| **Decorator / HOF** | Python `@cycles`, TS `withCycles`, Java `@Cycles` | Simple function calls | No | Yes | Yes |
| **Streaming adapter** | TS `reserveForStream` | Streaming responses | Yes | Yes | Manual |
| **Middleware** | Express, FastAPI | Per-request budget in web apps | Both | Depends | Manual |
| **Programmatic client** | All languages | Full control, complex flows | Both | Manual | Manual |

## Pattern 0: MCP Server (zero-code)

If your agent runs in an MCP-compatible host — Claude Desktop, Claude Code, Cursor, or Windsurf — you don't need any SDK integration. Add the Cycles MCP Server to your agent's tool configuration and the agent gets direct access to budget tools via MCP discovery.

```bash
# Claude Code
claude mcp add cycles -- npx -y @runcycles/mcp-server

# Set required environment variables
export CYCLES_API_KEY=cyc_live_...
export CYCLES_BASE_URL=http://localhost:7878
```

The agent calls `cycles_reserve`, `cycles_commit`, and other tools as part of its reasoning. No application code wraps the LLM call.

**Use when:**
- The agent host supports MCP
- You want budget awareness with zero code changes
- The agent should self-manage its own budget lifecycle

**Don't use when:**
- You're building a non-agent application (web API, batch pipeline)
- You need to wrap specific functions with budget governance in your own code

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
from agents import Agent, Runner
from runcycles_openai_agents import CyclesRunHooks

hooks = CyclesRunHooks(
    tenant="acme",
    tool_estimates={"send_email": 50, "search": 0},  # default unit: RISK_POINTS
)
result = await Runner.run(agent, input="...", hooks=hooks)
```

**Use when:**
- You're using an agent framework with lifecycle hooks (OpenAI Agents SDK, OpenClaw, LangChain 1.x `create_agent`)
- You want budget governance on every LLM call, tool invocation, and handoff automatically
- You need tool-level risk mapping (different costs per tool)
- You want agent handoff tracking in the Cycles ledger

**Don't use when:**
- You're not using an agent framework (use `@cycles` decorator instead)
- You need per-function control over estimation and commit (use programmatic client)
- You're using bare LangChain (`ChatOpenAI`, chains, RAG) without `create_agent` — use the [LangChain callback handler](/how-to/integrating-cycles-with-langchain#callback-handler-for-bare-runnables-chains-and-rag) instead

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
- The function streams output (use `reserveForStream` instead)
- You need to control when the commit happens (use programmatic client)
- You need to pass actual token counts to the commit (the decorator commits automatically)

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
app.post("/api/chat", cyclesGuard({ client, actionKind: "llm.completion", ... }), handler);
```
```python [FastAPI]
@app.post("/api/chat")
@cycles(estimate=2000000, action_kind="llm.completion", action_name="gpt-4o")
async def chat(request: ChatRequest):
    ...
```
:::

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

reservation = client.create_reservation(
    idempotency_key="req-001",
    subject={"tenant": "acme-corp"},
    action={"kind": "llm.completion", "name": "gpt-4o"},
    estimate={"amount": 2000000, "unit": "USD_MICROCENTS"},
    ttl_ms=30000,
)

if reservation.decision == "DENY":
    handle_denial()
else:
    result = call_llm()
    client.commit_reservation(
        reservation.reservation_id,
        idempotency_key="commit-001",
        actual={"amount": actual_cost, "unit": "USD_MICROCENTS"},
    )
```
```typescript [TypeScript]
const reservation = await client.createReservation({
  idempotencyKey: "req-001",
  subject: { tenant: "acme-corp" },
  action: { kind: "llm.completion", name: "gpt-4o" },
  estimate: { amount: 2000000, unit: "USD_MICROCENTS" },
  ttlMs: 30000,
});

if (reservation.body.decision === "DENY") {
  handleDenial();
} else {
  const result = await callLLM();
  await client.commitReservation(reservation.body.reservationId, {
    idempotencyKey: "commit-001",
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
