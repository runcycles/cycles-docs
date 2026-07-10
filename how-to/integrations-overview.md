---
title: "Integrations Overview"
description: "Overview of all supported Cycles integrations — LLM providers, frameworks, and web servers — with language support and streaming capabilities."
---

# Integrations Overview

Cycles integrates with LLM providers, agent frameworks, and web servers. Each integration wraps model calls with the reserve → commit → release lifecycle so that every call is budget-checked before execution.

## Supported integrations

| Integration | Language | Streaming | Pattern |
|-------------|----------|-----------|---------|
| **LLM Providers** | | | |
| [OpenAI (Python)](/how-to/integrating-cycles-with-openai) | Python | Yes | Decorator |
| [OpenAI (TypeScript)](/how-to/integrating-cycles-with-openai-typescript) | TypeScript | Yes | `withCycles` / `reserveForStream` |
| [Anthropic (Python)](/how-to/integrating-cycles-with-anthropic) | Python | Yes | Decorator |
| [Anthropic (TypeScript)](/how-to/integrating-cycles-with-anthropic-typescript) | TypeScript | Yes | `withCycles` / `reserveForStream` |
| [AWS Bedrock](/how-to/integrating-cycles-with-aws-bedrock) | TypeScript | Yes | `withCycles` / `reserveForStream` |
| [Google Gemini](/how-to/integrating-cycles-with-google-gemini) | TypeScript | Yes | `withCycles` / `reserveForStream` |
| [Groq](/how-to/integrating-cycles-with-groq) | Python / TypeScript | — | Decorator / `withCycles` |
| [Ollama / Local LLMs](/how-to/integrating-cycles-with-ollama) | Python / TypeScript | — | Decorator / `withCycles` |
| **AI Frameworks** | | | |
| [LangChain](/how-to/integrating-cycles-with-langchain) | Python | Yes | Agent middleware ([`langchain-runcycles`](https://pypi.org/project/langchain-runcycles/)) — `CyclesModelGate` + `CyclesToolGate` + `CyclesFanOutGate` for `create_agent`; callback handler for non-agent runnables |
| [LangChain.js](/how-to/integrating-cycles-with-langchain-js) | TypeScript | Yes | Callback handler |
| [LangGraph](/how-to/integrating-cycles-with-langgraph) | Python | — | Agent middleware ([`langchain-runcycles`](https://pypi.org/project/langchain-runcycles/)) for `create_agent` nodes; callback handler / decorator for raw `StateGraph` |
| [Vercel AI SDK](/how-to/integrating-cycles-with-vercel-ai-sdk) | TypeScript | Yes | `reserveForStream` |
| [Spring AI](/how-to/integrating-cycles-with-spring-ai) | Java | Yes | `@Cycles` annotation |
| [LlamaIndex](/how-to/integrating-cycles-with-llamaindex) | Python | — | Decorator |
| [CrewAI](/how-to/integrating-cycles-with-crewai) | Python | — | Decorator |
| [Pydantic AI](/how-to/integrating-cycles-with-pydantic-ai) | Python | — | Decorator |
| [AnyAgent](/how-to/integrating-cycles-with-anyagent) | Python | — | Callback (lifecycle hooks) |
| [AutoGen](/how-to/integrating-cycles-with-autogen) | Python | — | Model client wrapper |
| **Agent Platforms** | | | |
| [MCP Server](/how-to/integrating-cycles-with-mcp) | TypeScript (Node.js) | — | MCP tools |
| [OpenAI Agents](/how-to/integrating-cycles-with-openai-agents) | Python | — | RunHooks (lifecycle hooks) |
| [OpenClaw](/how-to/integrating-cycles-with-openclaw) | TypeScript | Yes | Plugin (lifecycle hooks) |
| [AP2 (Agent Payments Protocol)](https://pypi.org/project/runcycles-ap2/) | Python | — | Payment-mandate guard ([`runcycles-ap2`](https://pypi.org/project/runcycles-ap2/)) — reserve / commit / release around AP2 mandates for consume-once and double-spend prevention |
| **Runtime SDKs** | | | |
| [Rust](/how-to/integrating-cycles-with-rust) | Rust | Yes | Tokio async client + RAII guards |
| **Web Frameworks** | | | |
| [Next.js](/how-to/integrating-cycles-with-nextjs) | TypeScript | Yes | `withCycles` / Middleware |
| [Express](/how-to/integrating-cycles-with-express) | TypeScript | Yes | Middleware / `withCycles` |
| [Django](/how-to/integrating-cycles-with-django) | Python | — | Middleware / Decorator |
| [Flask](/how-to/integrating-cycles-with-flask) | Python | — | Decorator / `before_request` |
| [FastAPI](/how-to/integrating-cycles-with-fastapi) | Python | — | Middleware / Decorator |

## Integration patterns

Cycles offers several integration approaches depending on your stack:

### MCP Server

The zero-code approach. Add the Cycles MCP Server to your AI agent's tool configuration and the agent gets direct access to budget tools via the Model Context Protocol. No SDK integration in the agent's code required — the agent discovers and calls `cycles_reserve`, `cycles_commit`, and other tools through standard MCP tool discovery.

Best for: Claude Desktop, Claude Code, Cursor, Windsurf, and any MCP-compatible AI host.

### Decorator / Higher-order function

The simplest approach. Wrap your LLM-calling function and Cycles handles reservation, commit, and release automatically.

- **Python:** `@cycles` decorator
- **TypeScript:** `withCycles` higher-order function

Best for: individual model calls, simple request-response flows.

### RunHooks / Lifecycle hooks

For agent frameworks that expose lifecycle hooks. A plugin implements the framework's hook interface to create reservations on start and commit on end — covering the entire agent run automatically.

- **OpenAI Agents SDK:** `CyclesRunHooks` implements the SDK's `RunHooks` interface
- **OpenClaw:** Plugin hooks into `before_model_resolve`, `before_tool_call`, etc.

Best for: multi-agent workflows, tool governance, agent handoff tracking.

### Agent middleware (LangChain 1.x)

For LangChain agents built with `langchain.agents.create_agent`. The [`langchain-runcycles`](https://pypi.org/project/langchain-runcycles/) package provides `AgentMiddleware` subclasses (`CyclesModelGate`, `CyclesToolGate`, `CyclesFanOutGate`) that intercept model calls, tool calls, and model turns *before* execution — denial returns a `ToolMessage` so the agent recovers gracefully, and fan-out can be capped at the model-turn level.

Best for: production LangChain agents, anything using `create_agent`, agent-style LangGraph nodes.

### Callback handler

For agent frameworks like LangChain that fire events on every LLM call. A custom callback handler creates reservations on `llm_start` and commits on `llm_end`.

Best for: bare LangChain runnables (`ChatOpenAI` / chains / RAG), non-agent LangGraph nodes, multi-turn agents on the legacy `bind_tools` flow without `create_agent`.

### `reserveForStream`

For streaming responses where the actual cost is only known after the stream completes. Reserves budget upfront, auto-extends the reservation TTL during streaming, and commits actual usage when the stream finishes.

Best for: streaming chat UIs, Vercel AI SDK, any provider with streaming support.

### Programmatic client

Direct access to the Cycles client for full control over the reservation lifecycle. Use when the higher-level patterns don't fit your architecture.

Best for: custom frameworks, complex orchestration, batch processing.

See [Choosing the Right Integration Pattern](/how-to/choosing-the-right-integration-pattern) for detailed guidance.

## Adding a new integration

All integrations follow the same protocol:

1. **Reserve** budget before the LLM call with an estimated cost
2. **Execute** the model call (respecting any caps returned)
3. **Commit** actual cost from token usage after execution
4. **Release** on error to free held budget

See [Using the Cycles Client Programmatically](/how-to/using-the-cycles-client-programmatically) for the full client API reference.

## Webhook & Observability Integrations

Cycles emits webhook events for budget state changes, reservation denials, tenant lifecycle, and more. Connect to external alerting and incident management systems:

| Integration | Use Case | Guide |
|---|---|---|
| **PagerDuty** | On-call incident response for budget exhaustion and over-limit | [Webhook Integrations](/how-to/webhook-integrations#integration-pagerduty) |
| **Slack** | Channel notifications for budget thresholds and tenant alerts | [Webhook Integrations](/how-to/webhook-integrations#integration-slack) |
| **ServiceNow** | Incident creation for critical budget events | [Webhook Integrations](/how-to/webhook-integrations#integration-servicenow) |
| **Custom receiver** | Direct HTTP endpoint with HMAC verification | [Webhook Integrations](/how-to/webhook-integrations#integration-custom-receiver-direct) |

See [Webhook Integrations](/how-to/webhook-integrations) for full examples with signature verification code in Python, Node.js, and Go.

## Next steps

- [Adding Cycles to an Existing Application](/how-to/adding-cycles-to-an-existing-application) — step-by-step guide for your first integration
- [Webhook Integrations](/how-to/webhook-integrations) — PagerDuty, Slack, ServiceNow webhook examples
- [Cost Estimation Cheat Sheet](/how-to/cost-estimation-cheat-sheet) — pricing reference for estimation
- [Error Handling Patterns](/how-to/error-handling-patterns-in-cycles-client-code) — handling budget errors across languages

## Read the foundations

For the layer-by-layer view of where these integrations sit relative to other agent control approaches — wrappers, provider-client patches, framework hooks, LLM gateways, observability — and why runtime authority complements them rather than replaces them:

- [Python AI Agent Control: Cost, Risk, and Audit by Layer](/blog/python-ai-agent-control-cost-risk-audit-layers) — six layers walked through, what each covers across cost / risk / audit, and where each stops short.
- [Beyond Budget: How Cycles Controls Agent Actions, Not Just Spend](/blog/beyond-budget-how-cycles-controls-agent-actions) — why every integration enforces on cost AND action authority, not just dollars.
- [Why Local-First Agent Runtimes Need Runtime Authority](/blog/every-local-first-agent-runtime-needs-budget-authority) — local-first / BYOK category context for OpenClaw, Cline, Aider, Continue, and similar runtimes.
- [Agents Are Cross-Cutting. Your Controls Aren't.](/blog/agents-are-cross-cutting-your-controls-arent) — the structural argument for why agent governance has to span every integration the agent uses.

## Related concepts

- [Tracking tokens in a streaming LLM response](/blog/tracking-tokens-in-a-streaming-llm-response)
- [What is runtime authority?](/blog/what-is-runtime-authority-for-ai-agents)
- [AI agent action control: hard limits on side effects](/blog/ai-agent-action-control-hard-limits-side-effects)
