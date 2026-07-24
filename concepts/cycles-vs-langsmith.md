---
title: "Cycles vs LangSmith: Budget Layers Compared"
description: "Compare Cycles application-boundary budgets with LangSmith tracing and its private-beta LLM Gateway spend policies."
---

# Cycles vs LangSmith: Budget Layers Compared

LangSmith is one of the most widely adopted observability platforms for LLM applications. If you're building with LangChain or LangGraph, you're probably already using it — or evaluating it.

LangSmith is no longer only an observability comparison. Its private-beta LLM Gateway can proxy supported provider calls and enforce spend policies. Cycles remains an application-boundary budget service with reserve-commit semantics. Understanding the enabled LangSmith surface and the traffic each boundary covers prevents both gaps and redundancy.

> **Run the numbers for your workload:** [Cost Calculator →](/calculators/claude-vs-gpt-cost-standalone) · [Blast Radius Risk Calculator →](/calculators/ai-agent-blast-radius-standalone) — observability records what happened; the calculators show what *will* happen at your token volume and action profile.

## What each does

| | LangSmith | Cycles |
|---|---|---|
| **When it acts** | Observability records execution; LLM Gateway evaluates policy before a proxied model call | Application reserves before protected execution and settles afterward |
| **What it answers** | "What happened?" and, in Gateway, "Does this provider request fit the spend policy?" | "Can this submitted amount be held against every matching ledger?" |
| **Core mechanism** | Tracing, evaluation, and private-beta provider proxy policies | Reserve → commit → release |
| **Cost control** | Hard Gateway caps by organization, workspace, API key, or user over hourly through monthly windows | Atomic budgets across populated tenant → workspace → app → workflow → agent → toolset scopes |
| **Application actions** | Traces tool runs; Gateway governs supported LLM-provider traffic | Can meter caller-assigned tool exposure; host still authorizes tools and arguments |
| **Settlement** | Gateway tracks spend against caps | Explicit estimate hold, best-known actual commit, and release |
| **Deployment** | LangSmith-managed Gateway is in private beta | Self-hosted service and open protocol |

## The fundamental difference

LangSmith Observability tells you what an agent did across traces and runs. That information drives optimization, debugging, evaluation, and capacity planning.

When traffic is routed through the private-beta LLM Gateway, LangSmith can also evaluate hard spend policies on each incoming provider request. Its documented scopes are organization, workspace, API key, and user, with hourly, daily, weekly, or monthly windows. A blocked request receives `402`, and the violation is attached to a trace.

Cycles operates at the boundary the application chooses. Before a protected LLM or tool call executes, the host requests an atomic hold against matching ledgers. If the reservation fails and the host honors that result, the protected operation does not run. If it succeeds, the host commits best-known actual usage or releases an unused hold.

## Where the boundaries differ

### Provider gateway versus application boundary

LangSmith's Gateway protects LLM calls routed through that proxy and currently documents OpenAI, Anthropic, Bedrock, Baseten, Fireworks, Gemini, and Vertex AI providers. Calls that bypass the Gateway, plus arbitrary application tools such as refunds, emails, database writes, and deployments, need another mandatory control point.

Cycles is provider-neutral and can sit around any instrumented operation. Coverage is not automatic: bypass paths remain outside its budget boundary, and action authorization remains application logic.

### Spend policy versus reserve-commit

LangSmith documents real-time spend tracking and a pre-execution block when a proxied request would cross a Gateway cap. Cycles exposes a different lifecycle: reserve an estimate atomically, hold it while work is in flight, then commit actual usage or release it. That distinction matters when many calls start concurrently or when an application needs to account for work that can fail after admission.

Do not infer one product's concurrency or overage semantics from the other. Validate Gateway behavior against the private-beta version you are using; configure Cycles estimation and commit-overage policy for the application boundary you own.

### Budget exposure is not tool permission

LangSmith can trace a `send_email` run. A host can separately require a Cycles `RISK_POINTS` reservation before each authorized attempt. Neither a Gateway spend policy nor a risk-point balance decides whether a recipient, tool, or argument is authorized. Keep identity, credentials, allowlists, and argument validation at the host or gateway that executes the action.

## Where Cycles stops

Cycles does not replace LangSmith. It has no:

- **Trace visualization** — no flame graphs, no chain-of-thought replay
- **Evaluation framework** — no LLM-as-judge, no dataset management
- **Prompt management** — no prompt hub, no versioning, no sharing
- **Prompt debugging** — no A/B testing, no dataset-driven evaluation
- **Latency profiling** — no per-step timing breakdown

These are observability concerns. Cycles is not an observability tool.

## How they work together

The strongest production setup uses both:

```
Application action
  → host authorization
  → Cycles reserve (application-scope budget)
  → optional LangSmith LLM Gateway (provider spend policy, redaction, credentials)
  → provider
  → Cycles commit/release + LangSmith trace
```

### Practical example

A customer support agent built with LangChain:

1. **Cycles** checks budget before each instrumented LLM call and tool invocation. If a matching budget has `max_tokens` configured, an accepted request can return `ALLOW_WITH_CAPS`; if a live reservation lacks budget, it returns an error such as `409 BUDGET_EXCEEDED`. The application applies caps or handles the denial.

2. **LangSmith Observability** traces the instrumented chain execution. If the team also uses the private-beta Gateway, provider calls pass its spend and data policies before being forwarded.

The overlap is provider spend enforcement; the differences are boundary, scope vocabulary, lifecycle, deployment, and observability depth. Cycles does not visualize a chain execution, while LangSmith's provider Gateway does not automatically govern every application tool.

### Feeding Cycles data into LangSmith

The commit metrics (`StandardMetrics` — tokens, latency, model version) attached to each commit are available through the Cycles API. Teams that want unified dashboards can:

- Tag LangSmith traces with the Cycles `reservation_id` for cross-referencing
- Use LangSmith's custom metadata to include Cycles decision outcomes (`ALLOW`, `DENY`, `ALLOW_WITH_CAPS`)
- Build alerting rules in LangSmith that flag traces where Cycles returned `ALLOW_WITH_CAPS` — indicating that configured caps applied

## Decision guide

**Use LangSmith when you need to:**
- Debug why an agent produced a bad response
- Evaluate response quality across datasets
- Profile latency across chain steps
- Track cost attribution across runs and users
- Enforce supported-provider spend policies through its private-beta LLM Gateway

**Use Cycles when you need to:**
- Reserve estimated exposure atomically before protected application work
- Use the protocol's tenant, workspace, app, workflow, agent, and toolset scope hierarchy
- Settle best-known actual usage after execution
- Meter non-LLM work and caller-assigned action exposure
- Return configured caps for the host to apply

**Use both when you need to:**
- Run agents in production with both visibility and enforcement
- Correlate rich execution traces with reserve-commit budget records
- Debug why an agent was denied (LangSmith trace + Cycles decision)
- Layer provider-gateway policies under broader application budgets

## Key points

- **Compare enabled surfaces.** LangSmith Observability is retrospective; its private-beta LLM Gateway adds pre-execution provider spend policies.
- **Compare boundaries, not slogans.** Gateway policies cover routed provider traffic. Cycles covers instrumented application paths and exposes reserve-commit settlement.
- **Authorization remains separate.** Neither cost control grants permission to invoke an application tool.
- **Use correlated records.** LangSmith traces and Cycles reservation IDs can explain both execution and budget treatment.

LangSmith behavior was rechecked on July 24, 2026 against the official [LLM Gateway overview](https://docs.langchain.com/langsmith/llm-gateway) and [spend-policy documentation](https://docs.langchain.com/langsmith/llm-gateway-spend-policies). The Gateway is documented as private beta, so verify availability and semantics for your account.

## Next steps

- [From Observability to Enforcement](/concepts/from-observability-to-enforcement-how-teams-evolve-from-dashboards-to-budget-authority) — the evolution from dashboards to runtime authority
- [Cycles vs LLM Proxies and Observability Tools](/blog/cycles-vs-llm-proxies-and-observability-tools) — how Cycles complements LiteLLM, Portkey, Helicone, and Langfuse
- [Integrating with LangChain](/how-to/integrating-cycles-with-langchain) — add Cycles to your LangChain application
- [Integrating with LangGraph](/how-to/integrating-cycles-with-langgraph) — budget governance for LangGraph workflows
