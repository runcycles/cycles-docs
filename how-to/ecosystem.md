---
title: "Integration Ecosystem"
description: "Explore the full Cycles integration ecosystem — SDKs, AI providers, frameworks, and tools that work with runtime authority for autonomous agents."
---

# Integration Ecosystem

Cycles integrates with the tools, frameworks, and AI providers you already use. Whether you're building autonomous agents, adding runtime authority to an existing application, or exploring what's possible with controlled AI spending, there's an integration path for you.

## AI Model Providers

### OpenAI

Integrate Cycles with GPT-5.6 and other models available through the OpenAI API. Reserve budget per protected request and use standard subject fields for enforceable workflow or agent scopes.

- [OpenAI integration guide (Python)](/how-to/integrating-cycles-with-openai)
- [OpenAI integration guide (TypeScript)](/how-to/integrating-cycles-with-openai-typescript)
- [openai.com](https://openai.com)

### Anthropic

Use Cycles with Claude models to set spending limits on autonomous agent workflows powered by Anthropic's API. Available in both Python and TypeScript.

- [Anthropic integration guide (Python)](/how-to/integrating-cycles-with-anthropic)
- [Anthropic integration guide (TypeScript)](/how-to/integrating-cycles-with-anthropic-typescript)
- [anthropic.com](https://anthropic.com)

### Google Gemini

Add runtime authority to applications built on Google's Gemini family of models.

- [Gemini integration guide](/how-to/integrating-cycles-with-google-gemini)
- [ai.google.dev](https://ai.google.dev)

### AWS Bedrock

Cycles works with AWS Bedrock's multi-model platform, giving you budget control across any foundation model available through Bedrock.

- [AWS Bedrock integration guide](/how-to/integrating-cycles-with-aws-bedrock)
- [aws.amazon.com/bedrock](https://aws.amazon.com/bedrock)

### Ollama / Local LLMs

Budget control for local model runners — track GPU time and compute costs for self-hosted models. Works with Ollama, vLLM, text-generation-inference, and LocalAI.

- [Ollama integration guide](/how-to/integrating-cycles-with-ollama)
- [ollama.com](https://ollama.com)

### Groq

Budget governance for Groq's LPU-accelerated inference. Uses the OpenAI-compatible API with current Groq model IDs and pricing, plus an application-owned fallback pattern after a primary route's budget reservation is rejected.

- [Groq integration guide](/how-to/integrating-cycles-with-groq)
- [groq.com](https://groq.com)

## AI Frameworks & SDKs

### LangChain (Python)

[![PyPI downloads](https://img.shields.io/pypi/dm/langchain-runcycles?label=downloads&color=555&style=flat-square)](https://pypi.org/project/langchain-runcycles/)

Build budget-aware LangChain agents in Python. The `langchain-runcycles` package ships three `AgentMiddleware` classes — `CyclesModelGate`, `CyclesToolGate`, and `CyclesFanOutGate` — that gate model calls, tool calls, and runaway agent loops in `create_agent` workflows. The parent `runcycles` SDK includes a lifecycle-managed callback recipe for bare runnables (chains and RAG), with heartbeat and durable settlement rather than an in-memory-only commit path.

- [langchain-runcycles on PyPI](https://pypi.org/project/langchain-runcycles/)
- [LangChain integration guide](/how-to/integrating-cycles-with-langchain)
- [Source on GitHub](https://github.com/runcycles/langchain-runcycles)
- [Python LangChain documentation](https://docs.langchain.com/oss/python/langchain/overview)

### LangChain.js

The same LangChain integration, purpose-built for JavaScript and TypeScript environments.

- [LangChain.js integration guide](/how-to/integrating-cycles-with-langchain-js)
- [JavaScript LangChain documentation](https://docs.langchain.com/oss/javascript/langchain/overview)

### LangGraph

Budget control for LangGraph stateful agent workflows. Use LangChain's callback handler inside graph nodes, or scope budgets per node with the `@cycles` decorator. Supports conditional routing based on remaining budget.

- [LangGraph integration guide](/how-to/integrating-cycles-with-langgraph)
- [langchain-ai.github.io/langgraph](https://langchain-ai.github.io/langgraph/)

### Vercel AI SDK

Add Cycles runtime authority to applications built with the Vercel AI SDK for seamless spending control in Next.js and other Vercel-deployed projects.

- [Vercel AI SDK integration guide](/how-to/integrating-cycles-with-vercel-ai-sdk)
- [ai-sdk.dev](https://ai-sdk.dev/)

### Spring AI

Integrate Cycles with Spring AI to bring runtime authority to Java and Kotlin AI applications. Two paths:

- **Auto-wired advisor** ([`cycles-spring-ai-starter`](https://github.com/runcycles/cycles-spring-ai-starter)) — zero-code gating of every `ChatClient.call()`. Recommended for pure Spring AI apps.
- **`@Cycles` annotation** ([`cycles-client-java-spring`](https://github.com/runcycles/cycles-spring-boot-starter)) — method-level gating with SpEL-driven estimates. Use for non-Spring-AI code paths.

See the [integration guide](/how-to/integrating-cycles-with-spring-ai) for the comparison + when to use each.

- [Spring AI integration guide](/how-to/integrating-cycles-with-spring-ai)
- [Spring AI strategic quickstart](/quickstart/how-to-add-hard-budget-limits-to-spring-ai-with-cycles)
- [spring.io/projects/spring-ai](https://spring.io/projects/spring-ai)

### LlamaIndex

Add budget governance to LlamaIndex RAG pipelines. Guard retrieval and generation stages separately for fine-grained cost control.

- [LlamaIndex integration guide](/how-to/integrating-cycles-with-llamaindex)
- [llamaindex.ai](https://www.llamaindex.ai)

### CrewAI

Budget control for CrewAI multi-agent workflows. Scope budgets per agent and per crew with hierarchical budget paths.

- [CrewAI integration guide](/how-to/integrating-cycles-with-crewai)
- [crewai.com](https://www.crewai.com)

### Pydantic AI

Guard Pydantic AI agent runs and tool calls with the `@cycles` decorator. Works with structured output and tool scoping.

- [Pydantic AI integration guide](/how-to/integrating-cycles-with-pydantic-ai)
- [Pydantic AI documentation](https://pydantic.dev/docs/ai/overview/)

### AnyAgent

Budget governance for AnyAgent's unified agent interface. A single callback covers all seven supported frameworks (OpenAI Agents, LangChain, LlamaIndex, Google, Agno, smolagents, TinyAgent) with no per-framework code.

- [AnyAgent integration guide](/how-to/integrating-cycles-with-anyagent)
- [mozilla-ai.github.io/any-agent](https://mozilla-ai.github.io/any-agent/)

### AutoGen

Budget governance for Microsoft AutoGen multi-agent workflows. Wrap the model client with Cycles reservations for per-call and per-agent cost control across teams, swarms, and graph flows.

- [AutoGen integration guide](/how-to/integrating-cycles-with-autogen)
- [microsoft.github.io/autogen](https://microsoft.github.io/autogen/)

## Web Frameworks

### Next.js

Add budget governance to Next.js applications with route-level budget guards, server actions, and client-side error handling. Works with any LLM provider.

- [Next.js integration guide](/how-to/integrating-cycles-with-nextjs)
- [nextjs.org](https://nextjs.org)

### Express.js

Add Cycles middleware to your Express.js API to enforce runtime authority on any route that triggers AI spending.

- [Express.js integration guide](/how-to/integrating-cycles-with-express)
- [expressjs.com](https://expressjs.com)

### Django

Add Cycles middleware to Django applications for budget-checked views, per-tenant isolation, and preflight budget guards.

- [Django integration guide](/how-to/integrating-cycles-with-django)
- [djangoproject.com](https://www.djangoproject.com)

### Flask

Add Cycles budget guards to Flask applications with error handlers, `before_request` hooks, and per-tenant isolation.

- [Flask integration guide](/how-to/integrating-cycles-with-flask)
- [flask.palletsprojects.com](https://flask.palletsprojects.com)

### FastAPI

Use the Cycles Python client with FastAPI for high-performance, budget-aware AI APIs.

- [FastAPI integration guide](/how-to/integrating-cycles-with-fastapi)
- [fastapi.tiangolo.com](https://fastapi.tiangolo.com)

## Agent Platforms

### MCP (Model Context Protocol)

Cycles provides an MCP server that exposes runtime authority as tools for any MCP-compatible client, including Claude Desktop, Claude Code, Cursor, and Windsurf.

- [MCP integration guide](/how-to/integrating-cycles-with-mcp)
- [modelcontextprotocol.io](https://modelcontextprotocol.io)

### OpenAI Agents SDK

[![PyPI downloads](https://img.shields.io/pypi/dm/runcycles-openai-agents?label=downloads&color=555&style=flat-square)](https://pypi.org/project/runcycles-openai-agents/)

Add budget governance to OpenAI Agents SDK workflows. The plugin hooks into the SDK's `RunHooks` interface to enforce budgets on LLM calls and tool invocations, and emits best-effort zero-amount audit events for agent handoffs — with tool risk mapping and pre-run guardrails.

- [runcycles-openai-agents on PyPI](https://pypi.org/project/runcycles-openai-agents/)
- [OpenAI Agents integration guide](/how-to/integrating-cycles-with-openai-agents)
- [Source on GitHub](https://github.com/runcycles/cycles-openai-agents)

### OpenClaw

[![npm downloads](https://img.shields.io/npm/dt/@runcycles/openclaw-budget-guard?label=downloads&color=555&style=flat-square)](https://www.npmjs.com/package/@runcycles/openclaw-budget-guard)

Connect Cycles to OpenClaw for budget-controlled multi-agent orchestration.

- [@runcycles/openclaw-budget-guard on npm](https://www.npmjs.com/package/@runcycles/openclaw-budget-guard)
- [OpenClaw integration guide](/how-to/integrating-cycles-with-openclaw)

## Official SDKs

### Python Client

[![PyPI downloads](https://img.shields.io/pypi/dm/runcycles?label=downloads&color=555&style=flat-square)](https://pypi.org/project/runcycles/)

The official Cycles Python client. Install from PyPI and start enforcing budgets in minutes.

- [runcycles on PyPI](https://pypi.org/project/runcycles/)
- [Python quickstart](/quickstart/getting-started-with-the-python-client)

### TypeScript Client

[![npm downloads](https://img.shields.io/npm/dt/runcycles?label=downloads&color=555&style=flat-square)](https://www.npmjs.com/package/runcycles)

The official Cycles TypeScript client for Node.js and browser environments.

- [runcycles on npm](https://www.npmjs.com/package/runcycles)
- [TypeScript quickstart](/quickstart/getting-started-with-the-typescript-client)

### Rust Client

[![crates.io](https://img.shields.io/crates/v/runcycles?label=crates.io&color=555&style=flat-square)](https://crates.io/crates/runcycles)

The official Cycles Rust client (currently 0.3.2). Async-first, built for budget-aware agents and services in Rust.

- [runcycles on crates.io](https://crates.io/crates/runcycles)
- [Rust quickstart](/quickstart/getting-started-with-the-rust-client)

### AP2 Payment-Mandate Guard (Python)

[![PyPI downloads](https://img.shields.io/pypi/dm/runcycles-ap2?label=downloads&color=555&style=flat-square)](https://pypi.org/project/runcycles-ap2/)

Runtime authority guard for AP2 (Agent Payments Protocol) — reserve, commit, and release around agent payment mandates. It deduplicates Cycles accounting and rejects divergent reuse of an `open_mandate_hash`; identical retries still require PSP idempotency or a separate consume-once claim to prevent duplicate charges. Works with Google's AP2 spec and any AP2-compatible SDK.

- [runcycles-ap2 on PyPI](https://pypi.org/project/runcycles-ap2/)
- [Source on GitHub](https://github.com/runcycles/cycles-ap2-python)

### MCP Server

[![npm downloads](https://img.shields.io/npm/dt/@runcycles/mcp-server?label=downloads&color=555&style=flat-square)](https://www.npmjs.com/package/@runcycles/mcp-server)

The Cycles MCP server exposes runtime authority as tools for Claude Desktop, Claude Code, Cursor, and Windsurf.

- [@runcycles/mcp-server on npm](https://www.npmjs.com/package/@runcycles/mcp-server)
- [MCP quickstart](/quickstart/getting-started-with-the-mcp-server)

### Spring Boot Starter (generic `@Cycles` AOP)

[![Maven Central](https://img.shields.io/maven-central/v/io.runcycles/cycles-client-java-spring?label=Maven%20Central&color=555&style=flat-square)](https://central.sonatype.com/artifact/io.runcycles/cycles-client-java-spring)

Auto-configured Cycles integration for Spring Boot applications using the `@Cycles` annotation with SpEL-driven cost estimates. Available on Maven Central.

- [cycles-client-java-spring on Maven Central](https://central.sonatype.com/artifact/io.runcycles/cycles-client-java-spring)
- [Spring Boot quickstart](/quickstart/getting-started-with-the-cycles-spring-boot-starter)

### Spring AI Starter (advisor-based)

[![Maven Central](https://img.shields.io/maven-central/v/io.runcycles/cycles-spring-ai-starter?label=Maven%20Central&color=555&style=flat-square)](https://central.sonatype.com/artifact/io.runcycles/cycles-spring-ai-starter)

Spring AI-specific starter that auto-wires Cycles `CallAdvisor` + `StreamAdvisor` onto every `ChatClient`, gating non-streaming and streaming LLM invocations through Cycles without code changes at call sites. Also ships `CyclesToolGate` (opt-in per-tool gating), a pluggable `SubjectResolver` for per-request tenant attribution, and an `ObservationConvention` that emits Cycles attribution + `cycles.reservation_id` on chat-client traces. Companion to the generic Spring Boot starter — depend on this for Spring AI apps.

- [cycles-spring-ai-starter on Maven Central](https://central.sonatype.com/artifact/io.runcycles/cycles-spring-ai-starter)
- [Spring AI integration guide](/how-to/integrating-cycles-with-spring-ai)

## Protocol & Standards

### Cycles Protocol

The Cycles Protocol is an open specification for runtime authority in autonomous agent systems, licensed under Apache 2.0. Build your own implementation or contribute to the spec.

- [Cycles Protocol on GitHub](https://github.com/runcycles/cycles-protocol)

### OpenAPI Specification

A complete OpenAPI specification is available for the Cycles API, making it straightforward to generate clients in any language or integrate with API tooling.

- [Interactive API Reference](/api/)

## Community Tools

The Cycles ecosystem grows with every project that adopts runtime authority. If you've built a library, plugin, tool, or integration that works with Cycles, we want to hear about it.

Building something with Cycles? Add a [Built with Cycles badge](/community/badges) to your project and let the community know what you're working on.
