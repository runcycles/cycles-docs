---
title: "26 Integrations: Every AI Framework, One Budget Protocol"
date: 2026-04-02
author: Albert Mavashev
tags: [announcement, integrations, langchain, langgraph, autogen, openai, anthropic, groq, django, nextjs, flask, anyagent, runtime-authority]
description: "Cycles now integrates with 27 frameworks across Python, TypeScript, Java, and Rust. One protocol enforces spend limits, action boundaries, and risk controls across every agent stack — before execution."
blog: true
sidebar: false
---

# 26 Integrations: Every AI Framework, One Budget Protocol

When we launched Cycles, the question we heard most was: *"Does this work with my stack?"*

Today the answer is yes — for almost every stack. Cycles now integrates with **27 frameworks** across Python, TypeScript, Java, and Rust. Every LLM call, tool invocation, and agent action in your stack can be governed with the same reserve → commit → release protocol — enforcing spend limits, action boundaries, and risk controls before execution.

<!-- more -->

## What shipped

We added 9 new integration guides, bringing the total from 17 to 26:

### LLM Providers (8)

| Provider | Languages | What's new |
|----------|-----------|------------|
| [OpenAI](/how-to/integrating-cycles-with-openai) | Python, [TypeScript](/how-to/integrating-cycles-with-openai-typescript) | **TypeScript guide added** — `withCycles` and `reserveForStream` with `stream_options: { include_usage: true }` |
| [Anthropic](/how-to/integrating-cycles-with-anthropic) | Python, [TypeScript](/how-to/integrating-cycles-with-anthropic-typescript) | **TypeScript guide added** — streaming via `client.messages.stream()`, per-tool-call tracking |
| [Groq](/how-to/integrating-cycles-with-groq) | Python, TypeScript | **New** — OpenAI-compatible API, Groq-specific pricing, model-downgrade degradation pattern |
| [AWS Bedrock](/how-to/integrating-cycles-with-aws-bedrock) | TypeScript | — |
| [Google Gemini](/how-to/integrating-cycles-with-google-gemini) | TypeScript | — |
| [Ollama / Local LLMs](/how-to/integrating-cycles-with-ollama) | Python, TypeScript | — |

### AI Frameworks (10)

| Framework | Language | What's new |
|-----------|----------|------------|
| [LangGraph](/how-to/integrating-cycles-with-langgraph) | Python | **New** — callback handler in graph nodes, per-node scoping, conditional edges with `client.decide()` |
| [AutoGen](/how-to/integrating-cycles-with-autogen) | Python | **New** — model client wrapper for teams, swarms, and graph flows |
| [AnyAgent](/how-to/integrating-cycles-with-anyagent) | Python | **New** — single callback covers all 7 supported frameworks |
| [LangChain](/how-to/integrating-cycles-with-langchain) | Python, [JS](/how-to/integrating-cycles-with-langchain-js) | — |
| [Vercel AI SDK](/how-to/integrating-cycles-with-vercel-ai-sdk) | TypeScript | — |
| [Spring AI](/how-to/integrating-cycles-with-spring-ai) | Java | — |
| [LlamaIndex](/how-to/integrating-cycles-with-llamaindex) | Python | — |
| [CrewAI](/how-to/integrating-cycles-with-crewai) | Python | — |
| [Pydantic AI](/how-to/integrating-cycles-with-pydantic-ai) | Python | — |

### Agent Platforms (3)

| Platform | Language |
|----------|----------|
| [MCP (Claude, Cursor, Windsurf)](/how-to/integrating-cycles-with-mcp) | TypeScript |
| [OpenAI Agents SDK](/how-to/integrating-cycles-with-openai-agents) | Python |
| [OpenClaw](/how-to/integrating-cycles-with-openclaw) | TypeScript |

### Web Frameworks (5)

| Framework | Language | What's new |
|-----------|----------|------------|
| [Next.js](/how-to/integrating-cycles-with-nextjs) | TypeScript | **New** — route-level guards, server actions, per-[tenant isolation](/glossary#tenant-isolation) |
| [Django](/how-to/integrating-cycles-with-django) | Python | **New** — middleware, exception handling, per-[tenant](/glossary#tenant) budget dashboard |
| [Flask](/how-to/integrating-cycles-with-flask) | Python | **New** — error handlers, `before_request` preflight |
| [Express](/how-to/integrating-cycles-with-express) | TypeScript | — |
| [FastAPI](/how-to/integrating-cycles-with-fastapi) | Python | — |

## The patterns that matter

### Action authority across frameworks

Every integration enforces the same principle: **no agent action executes without authorization**. Whether it's an LLM call in LangGraph, a tool invocation in AutoGen, or an API request in a Django endpoint — the [reservation](/glossary#reservation) happens before the action, not after.

This matters beyond cost. The same protocol that prevents a $50 runaway spend also prevents an agent from sending 200 emails, hitting a rate-limited API in a retry loop, or executing a high-risk tool without approval. The [OpenAI Agents guide](/how-to/integrating-cycles-with-openai-agents) maps tool estimates to budget — `send_email` reserves 50 [RISK_POINTS](/glossary#risk-points) per call while `search_knowledge` uses zero. The [budget authority](/glossary#budget-authority) decides which actions are cheap and which are expensive.

### Graceful degradation with model downgrade

Most authorization systems have two modes: allow or deny. Cycles gives you a third: **downgrade**.

The [Groq guide](/how-to/integrating-cycles-with-groq) introduces a pattern where agents switch models based on remaining authority:

```python
def chat_with_downgrade(prompt: str) -> dict:
    try:
        return primary_chat(prompt)    # GPT-4o: $2.50/$10 per 1M tokens
    except BudgetExceededError:
        return fallback_chat(prompt)   # Groq Llama 4: $0.11/$0.34 per 1M tokens
```

The agent keeps working. The user still gets an answer. The authority boundary holds — just with a different cost profile. This works because Cycles tracks authority per `action_name`, so the budget authority can set different limits for different models and let the application route between them.

## Multi-tenant SaaS guide

Beyond integrations, we shipped a comprehensive [Multi-Tenant SaaS Guide](/how-to/multi-tenant-saas-with-cycles) — the single most-requested doc.

It covers the full lifecycle of per-customer [runtime authority](/glossary#runtime-authority):
- **Customer onboarding** — automated tenant + API key + budget creation
- **Plan tiers** — Free ($5/mo), Pro ($50/mo), Enterprise ($500/mo) with overdraft limits
- **Per-tenant isolation** — one customer's runaway agent cannot affect others
- **[Graceful degradation](/glossary#graceful-degradation)** — upgrade prompts, model downgrade, feature disabling
- **Tenant suspension** — ACTIVE → SUSPENDED → CLOSED lifecycle

Each customer gets independent spend limits, action boundaries, and risk controls — all enforced at the protocol level with cryptographic tenant isolation.

## Try it

Pick your framework from the [integration overview](/how-to/integrations-overview), follow the guide, and have budget governance running in under 10 minutes.

If your stack isn't covered, [open an issue](https://github.com/runcycles/docs/issues). We're prioritizing based on real user requests.

## Related how-to guides

- [Assigning RISK_POINTS to agent tools](/how-to/assigning-risk-points-to-agent-tools)
- [Budget control for LangChain](/how-to/how-to-add-budget-control-to-a-langchain-agent)
- [Handling streaming responses](/how-to/handling-streaming-responses-with-cycles)
