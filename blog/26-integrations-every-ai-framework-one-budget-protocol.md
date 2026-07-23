---
title: "26 Integrations for One AI Budget Protocol"
date: 2026-04-02
author: Albert Mavashev
tags: [announcement, integrations, langchain, langgraph, autogen, openai, anthropic, groq, django, nextjs, flask, anyagent, runtime-authority]
description: "Cycles ships 26 integrations across Python, TypeScript, Java, and Rust. See how one protocol coordinates runtime budget controls across diverse agent stacks."
blog: true
sidebar: false
head:
  - - meta
    - name: keywords
      content: AI framework integrations, agent budget protocol, runtime authority, Python AI agents, TypeScript AI agents, Java AI agents
---

# 26 Cycles Integration Guides at Publication

When we launched Cycles, the question we heard most was: *"Does this work with my stack?"*

At publication on 2026-04-02, the documentation covered **26 integration patterns** across Python, TypeScript, Java, and Rust; see the [integrations overview](/how-to/integrations-overview) for the current list. Each guide shows where an application can insert the same reserve-commit lifecycle. Coverage is not automatic: the integration must route every protected call through the boundary, classify caller-assigned exposure such as `RISK_POINTS`, and retain application authorization for tool permissions.

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
| [LangChain](/how-to/integrating-cycles-with-langchain) | Python, [JS](/how-to/integrating-cycles-with-langchain-js) | — |
| [CrewAI](/how-to/integrating-cycles-with-crewai) | Python | — |
| [AutoGen](/how-to/integrating-cycles-with-autogen) | Python | **New** — model client wrapper for teams, swarms, and graph flows |
| [LlamaIndex](/how-to/integrating-cycles-with-llamaindex) | Python | — |
| [Pydantic AI](/how-to/integrating-cycles-with-pydantic-ai) | Python | — |
| [AnyAgent](/how-to/integrating-cycles-with-anyagent) | Python | **New** — single callback covers all 7 supported frameworks |
| [Vercel AI SDK](/how-to/integrating-cycles-with-vercel-ai-sdk) | TypeScript | — |
| [Spring AI](/how-to/integrating-cycles-with-spring-ai) | Java | — |

### Agent Platforms (3)

| Platform | Language |
|----------|----------|
| [OpenAI Agents SDK](/how-to/integrating-cycles-with-openai-agents) | Python |
| [MCP (Claude, Cursor, Windsurf)](/how-to/integrating-cycles-with-mcp) | TypeScript |
| [OpenClaw](/how-to/integrating-cycles-with-openclaw) | TypeScript |

### Web Frameworks (5)

| Framework | Language | What's new |
|-----------|----------|------------|
| [Django](/how-to/integrating-cycles-with-django) | Python | **New** — middleware, exception handling, per-[tenant](/glossary#tenant) budget dashboard |
| [Flask](/how-to/integrating-cycles-with-flask) | Python | **New** — error handlers, `before_request` preflight |
| [FastAPI](/how-to/integrating-cycles-with-fastapi) | Python | — |
| [Next.js](/how-to/integrating-cycles-with-nextjs) | TypeScript | **New** — route-level guards, server actions, per-[tenant isolation](/glossary#tenant-isolation) |
| [Express](/how-to/integrating-cycles-with-express) | TypeScript | — |

## The patterns that matter

### Budget gates across frameworks

The integration pattern is consistent: put a successful [reservation](/glossary#reservation) before each instrumented LLM call, tool invocation, or API request. That proves budget availability for the submitted Subject and estimate; application authorization still decides whether the specific tool and arguments are permitted.

This can also bound cumulative caller-assigned action exposure. If the host authorizes and instruments `send_email`, for example, the [OpenAI Agents guide](/how-to/integrating-cycles-with-openai-agents) can reserve 50 [RISK_POINTS](/glossary#risk-points) per call while `search_knowledge` uses zero. The application chooses those classifications and prevents unauthorized tools or arguments; the budget authority accounts for what it submits.

For a layer-by-layer view of how the Python integrations above sit relative to wrapper-style libraries, provider-client patches, LLM gateways, and observability tooling — and where each layer covers cost, risk, or audit — see [Python AI Agent Control: Cost, Risk, and Audit by Layer](/blog/python-ai-agent-control-cost-risk-audit-layers).

### Graceful degradation with model downgrade

The Cycles decision model has `ALLOW`, `ALLOW_WITH_CAPS`, and `DENY` for preflight/dry-run evaluation. A caller can implement model downgrade when its configured policy returns caps or when a live reservation is rejected.

The [Groq guide](/how-to/integrating-cycles-with-groq) introduces a pattern where agents switch models based on remaining authority:

```python
def chat_with_downgrade(prompt: str) -> dict:
    try:
        return primary_chat(prompt)    # GPT-4o: $2.50/$10 per 1M tokens
    except BudgetExceededError:
        return fallback_chat(prompt)   # Groq Llama 4: $0.11/$0.34 per 1M tokens
```

In this example the application catches the primary-path budget error and attempts a separately configured fallback. Cycles records `action_name` as context but does not derive budget scopes from it; use standard Subject fields and estimates to give primary and fallback calls the intended budgets.

## Multi-tenant SaaS guide

Beyond integrations, we shipped a comprehensive [Multi-Tenant SaaS Guide](/how-to/multi-tenant-saas-with-cycles) — the single most-requested doc.

It covers the full lifecycle of per-customer [runtime authority](/glossary#runtime-authority):
- **Customer onboarding** — automated tenant + API key + budget creation
- **Plan tiers** — Free ($5/mo), Pro ($50/mo), Enterprise ($500/mo) with overdraft limits
- **Per-tenant isolation** — one customer's runaway agent cannot affect others
- **[Graceful degradation](/glossary#graceful-degradation)** — upgrade prompts, model downgrade, feature disabling
- **Tenant suspension** — ACTIVE → SUSPENDED → CLOSED lifecycle

Each customer can receive independent scope ledgers, while tenant-bound API-key checks reject cross-tenant access. Application authorization and mandatory-boundary coverage remain necessary; this is not cryptographic isolation of arbitrary application actions.

## Try it

Pick your framework from the [integration overview](/how-to/integrations-overview) and follow the guide. Setup time depends on how many execution paths, Subjects, estimates, and failure modes your application must instrument.

If your stack isn't covered, [open an issue](https://github.com/runcycles/cycles-docs/issues). We're prioritizing based on real user requests.

## Related how-to guides

- [Assigning RISK_POINTS to agent tools](/how-to/assigning-risk-points-to-agent-tools)
- [Budget control for LangChain](/how-to/how-to-add-budget-control-to-a-langchain-agent)
- [Handling streaming responses](/how-to/handling-streaming-responses-with-cycles)
