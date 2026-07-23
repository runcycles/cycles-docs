---
title: "How-To Guides"
description: "Recipes for working with Cycles — integrate with LLM providers and agent frameworks, design budget hierarchies for multi-tenant SaaS, run in production, and troubleshoot."
---

# How-To Guides

Recipes for common tasks with Cycles, organized by what you're trying to do.

## Integrate Cycles into your app

- [Add Cycles with Claude or Codex](/how-to/add-cycles-with-claude-or-codex) — wire Cycles into an existing codebase using AI assistants.
- [Add Cycles to an existing application](/how-to/adding-cycles-to-an-existing-application) — manual integration steps.
- [Choose the right integration pattern](/how-to/choosing-the-right-integration-pattern) — decorator, middleware, manual, or framework-native.
- [Migrate from a custom rate limiter](/how-to/migrating-from-custom-rate-limiter-to-cycles)
- [Evaluate Cycles for an agent SaaS](/how-to/evaluate-cycles-for-agent-saas) — fit/no-fit framing and a 15-minute test.
- [Integrations overview](/how-to/integrations-overview) · [Ecosystem](/how-to/ecosystem)

### LLM providers

[OpenAI (Python)](/how-to/integrating-cycles-with-openai) · [OpenAI (TypeScript)](/how-to/integrating-cycles-with-openai-typescript) · [OpenAI (Rust / async-openai)](/how-to/integrating-cycles-with-async-openai) · [Anthropic (Python)](/how-to/integrating-cycles-with-anthropic) · [Anthropic (TypeScript)](/how-to/integrating-cycles-with-anthropic-typescript) · [AWS Bedrock](/how-to/integrating-cycles-with-aws-bedrock) · [Google Gemini](/how-to/integrating-cycles-with-google-gemini) · [Groq](/how-to/integrating-cycles-with-groq) · [Ollama / local LLMs](/how-to/integrating-cycles-with-ollama)

### Agent frameworks

[OpenAI Agents SDK](/how-to/integrating-cycles-with-openai-agents) · [LangChain (Python)](/how-to/integrating-cycles-with-langchain) · [LangChain.js](/how-to/integrating-cycles-with-langchain-js) · [LangGraph](/how-to/integrating-cycles-with-langgraph) · [LlamaIndex](/how-to/integrating-cycles-with-llamaindex) · [CrewAI](/how-to/integrating-cycles-with-crewai) · [AutoGen](/how-to/integrating-cycles-with-autogen) · [Pydantic AI](/how-to/integrating-cycles-with-pydantic-ai) · [any-agent](/how-to/integrating-cycles-with-anyagent) · [MCP](/how-to/integrating-cycles-with-mcp) · [OpenClaw](/how-to/integrating-cycles-with-openclaw)

### Web frameworks

[Vercel AI SDK](/how-to/integrating-cycles-with-vercel-ai-sdk) · [Next.js](/how-to/integrating-cycles-with-nextjs) · [Express](/how-to/integrating-cycles-with-express) · [FastAPI](/how-to/integrating-cycles-with-fastapi) · [Django](/how-to/integrating-cycles-with-django) · [Flask](/how-to/integrating-cycles-with-flask) · [Spring AI](/how-to/integrating-cycles-with-spring-ai) · [Rust](/how-to/integrating-cycles-with-rust)

## Design budget hierarchies

- [Choosing the right overage policy](/how-to/choosing-the-right-overage-policy) — reject, allow-if-available, or allow-with-overdraft.
- [Multi-tenant SaaS guide](/how-to/multi-tenant-saas-with-cycles)
- [Budget templates](/how-to/budget-templates) · [Common budget patterns](/how-to/common-budget-patterns)
- [Multi-agent shared workspace budgets](/how-to/multi-agent-shared-workspace-budget-patterns)
- [Cost estimation cheat sheet](/how-to/cost-estimation-cheat-sheet)
- [Budget allocation and management](/how-to/budget-allocation-and-management-in-cycles)
- [Tenant, workflow, and run budgets](/how-to/how-to-model-tenant-workflow-and-run-budgets-in-cycles)
- [Estimate exposure before execution](/how-to/how-to-estimate-exposure-before-execution-practical-reservation-strategies-for-cycles)
- [Assigning RISK_POINTS to agent tools](/how-to/assigning-risk-points-to-agent-tools)
- [Degradation paths](/how-to/how-to-think-about-degradation-paths-in-cycles-deny-downgrade-disable-or-defer)
- [Budget control for LangChain agents](/how-to/how-to-add-budget-control-to-a-langchain-agent)
- [Shadow mode rollout](/how-to/shadow-mode-in-cycles-how-to-roll-out-budget-enforcement-without-breaking-production)

## Operate Cycles in production

- [Production operations guide](/how-to/production-operations-guide)
- [Upgrade Cycles safely](/how-to/upgrading-cycles) — preflight, rolling order, migration checks, rollback, and verification.
- [Redis backup, restore, and disaster recovery](/how-to/redis-backup-restore-disaster-recovery) — protect and recover the complete Cycles state store.
- [Monitoring and alerting](/how-to/monitoring-and-alerting) · [Observability setup](/how-to/observability-setup) · [Prometheus metrics reference](/how-to/prometheus-metrics-reference)
- [Security hardening](/how-to/security-hardening)
- [Tenant management](/how-to/tenant-creation-and-management-in-cycles) · [API key management](/how-to/api-key-management-in-cycles)
- [Tenants, scopes, and budgets](/how-to/understanding-tenants-scopes-and-budgets-in-cycles)
- [Rolling over billing periods](/how-to/rolling-over-billing-periods-with-reset-spent)
- [Bulk actions for tenants and webhooks](/how-to/using-bulk-actions-for-tenants-and-webhooks)
- [Force-releasing stuck reservations](/how-to/force-releasing-stuck-reservations-as-an-operator)
- [Searching admin list endpoints](/how-to/searching-and-sorting-admin-list-endpoints)
- [Webhook integrations](/how-to/webhook-integrations) · [Managing webhooks](/how-to/managing-webhooks)
- [Custom field resolvers](/how-to/custom-field-resolvers-in-cycles)
- [Programmatic client usage](/how-to/using-the-cycles-client-programmatically) · [Dashboard guide](/how-to/using-the-cycles-dashboard)
- [Client performance tuning](/how-to/client-performance-tuning)

## Handle errors and edge cases

- [Error handling patterns](/how-to/error-handling-patterns-in-cycles-client-code)
- Language-specific patterns: [Python](/how-to/error-handling-patterns-in-python) · [TypeScript](/how-to/error-handling-patterns-in-typescript) · [Rust](/how-to/error-handling-patterns-in-rust)
- [Handling streaming responses](/how-to/handling-streaming-responses-with-cycles)
- [Testing with Cycles](/how-to/testing-with-cycles)
- [Troubleshooting and FAQ](/how-to/troubleshooting-and-faq)

## Run the MCP server

- [Run the MCP server over HTTP](/how-to/running-the-mcp-server-over-http)

## Related

- [**Quickstart**](/quickstart/) — get started with a specific stack.
- [**Cycles Protocol**](/protocol/) — the open specification.
- [**How Cycles compares**](/concepts/comparisons) — vs LiteLLM, Helicone, rate limiters, provider caps, DIY wrappers.
