---
title: "How Much Do AI Agents Actually Cost?"
date: 2026-03-13
author: Cycles Team
tags: [costs, agents, guide]
description: "AI agent cost breakdown across OpenAI, Anthropic, and Google, with current token rates and illustrative support, coding, and data-pipeline scenarios today."
blog: true
sidebar: false
head:
  - - meta
    - name: keywords
      content: AI agent costs, LLM pricing, agent cost calculator, OpenAI costs, Anthropic costs, AI budget planning
---

# How Much Do AI Agents Actually Cost?

> **Part of: [LLM Cost Runtime Control Reference](/guides/llm-cost-runtime-control)** — the full pillar covering causes, enforcement patterns, multi-tenant boundaries, and unit economics.

Consider a support agent handling 100 conversations a day on Claude Sonnet 5.5. At 4,000 input [tokens](/glossary#tokens) and 800 output tokens per call, three calls per conversation cost $144 per 30-day month. Twelve calls per conversation cost $576. The model and token rates are unchanged; the execution pattern accounts for the difference.

> **Explore your own call volume and token mix:** use the [Claude vs GPT cost calculator](/calculators/claude-vs-gpt-cost-comparison).

<!-- more -->

This post breaks down representative token prices and four illustrative agent workloads. Prices were checked against provider documentation on **November 14, 2026**. These are model-token estimates, not total operating budgets: add tool services, compute, storage, observability, and development and operations work separately.

## Per-Token Pricing by Provider

All prices are USD per 1 million tokens, using standard paid text rates from each provider's direct API. They exclude caching, batch/flex discounts, faster service tiers, tools, and regional premiums. Third-party hosting and negotiated contracts can differ.

### [OpenAI](https://developers.openai.com/api/docs/pricing)

| Model | Input (per 1M tokens) | Output (per 1M tokens) |
|---|---|---|
| gpt-6-astra | $10.00 | $50.00 |
| gpt-6.1-sol | $2.00 | $10.00 |
| gpt-6.1-terra | $1.00 | $5.00 |
| gpt-6-luna | $0.10 | $0.50 |
| gpt-6-sol | $2.00 | $10.00 |

For these models, prompts above 272,000 input tokens use 2× the input rate and 1.5× the output rate for the whole request, not just tokens above the threshold.

### [Anthropic](https://platform.claude.com/docs/en/about-claude/pricing)

| Model | Input (per 1M tokens) | Output (per 1M tokens) |
|---|---|---|
| Claude Fable 5.2 | $8.00 | $40.00 |
| Claude Opus 5.5 | $4.00 | $20.00 |
| Claude Sonnet 5.5 | $2.00 | $10.00 |
| Claude Haiku 5.5 | $0.10 | $0.50 |

Haiku 5.5 prompts above 100,000 input tokens use $0.50 input / $2.50 output for the whole request. The other Claude models listed here retain their standard rates across their supported context windows.

### [Google](https://aistudio.google.com/docs/pricing)

| Model | Input (per 1M tokens) | Output (per 1M tokens) | Rate timing |
|---|---|---|---|
| Gemini 4 Carbon | $2.00 | $10.00 | Through November 30, 2026; then $4.00 / $20.00 |
| Gemini 3.8 Flash | $0.75 | $3.75 | Through December 31, 2026; then $1.50 / $7.50 |
| Gemini 3.5 Flash-Lite | $0.30 | $2.50 | Standard text rates |
| Gemini 2.5 Flash-Lite | $0.10 | $0.40 | Earlier model, still listed |

Google lists Gemini 2.5 Pro and 2.5 Flash as deprecated. On December 1, 2026, their API aliases are scheduled to route to Gemini 3.8 Flash and Gemini 3.5 Flash-Lite respectively, at the replacement models' rates. Recheck model availability and pricing before deployment.

Within this selection, output prices span $0.40 to $50 per million tokens, a 125× range. That is a rate comparison, not a quality or total-cost ranking. Different models can require different numbers of tokens and attempts to complete the same task.

## Why AI Agent Costs Grow

A simple interaction may need one model call. An agent that plans, calls tools, inspects results, and revises its work may need several. Measure calls per completed task, including unsuccessful runs, before extrapolating a prototype's bill.

### Calls, Retries, and Fan-Out

The coding example below assumes 25 calls per task; that is a planning input, not an industry benchmark. Likewise, one coordinator and four workers making eight calls each produce 40 calls per workflow. A tool operation does not necessarily require a new model call: its result might be processed in code or included in the next planned call.

A retry can add model usage, tool charges, or only another network attempt, depending on what runs again. Count these separately. The [cost estimation cheat sheet](/how-to/cost-estimation-cheat-sheet) explains how to turn measured token and call counts into an estimate.

### Context Growth

If each turn resends all prior content and adds 2,000 tokens, input length grows from 2,000 tokens on turn one to 16,000 on turn eight. Total input across the eight calls is:

**2,000 × (1 + 2 + 3 + 4 + 5 + 6 + 7 + 8) = 72,000 tokens.**

Under this assumption, cumulative input grows quadratically with the number of turns. It is not an unavoidable billing curve: truncation, summarization, selective retrieval, and prompt caching change what is sent or billed at the uncached rate.

## Illustrative AI Agent Cost Scenarios

These examples hold token counts constant across models to isolate pricing. They are not measured customer bills or predictions of equal task quality. Tokenizers, reasoning effort, tool use, and success rates vary; measure each candidate on your own workload. Output counts must include billable reasoning or thinking tokens, not just the visible answer.

Every scenario assumes each request stays below the applicable long-context price threshold, with no cache hits or retries. A low average alone does not establish that: price individual requests at their applicable tier when some prompts cross a threshold.

The calculation is:

**Cost per call = (input tokens × input rate + output tokens × output rate) / 1,000,000.**

**Daily cost = cost per call × calls per day. Monthly cost = daily cost × 30.**

Monthly figures use 30 active days at the snapshot rates; they are not calendar-month forecasts across a scheduled price change. Totals are calculated before rounding and displayed to cents.

### Scenario 1: Customer support bot

A support bot looks up orders, checks policies, and generates responses.

| Parameter | Value |
|---|---|
| Conversations per day | 100 |
| Turns per conversation | 8 |
| LLM calls per turn | 1.5 on average |
| Total calls per day | 1,200 |
| Avg input tokens per call | 4,000 |
| Avg output tokens per call | 800 |

| Model | Cost per call | Daily cost | Monthly cost |
|---|---|---|---|
| gpt-6.1-sol | $0.016 | $19.20 | $576.00 |
| gpt-6.1-terra | $0.008 | $9.60 | $288.00 |
| gpt-6-luna | $0.0008 | $0.96 | $28.80 |
| Claude Sonnet 5.5 | $0.016 | $19.20 | $576.00 |
| Claude Haiku 5.5 | $0.0008 | $0.96 | $28.80 |
| Gemini 3.5 Flash-Lite | $0.0032 | $3.84 | $115.20 |

At these token counts, the model-token estimate ranges from $28.80 to $576 per month. A cheaper model only saves money in practice if its additional retries, escalations, and human review do not erase the rate advantage.

### Scenario 2: Coding agent

An agent reads code, generates changes, runs tests, and iterates on failures.

| Parameter | Value |
|---|---|
| Tasks per day | 50 |
| LLM calls per task | 25 assumed average |
| Total calls per day | 1,250 |
| Avg input tokens per call | 6,000 |
| Avg output tokens per call | 2,000 |

| Model | Cost per call | Daily cost | Monthly cost |
|---|---|---|---|
| gpt-6-astra | $0.16 | $200.00 | $6,000.00 |
| gpt-6.1-sol | $0.032 | $40.00 | $1,200.00 |
| gpt-6.1-terra | $0.016 | $20.00 | $600.00 |
| Claude Sonnet 5.5 | $0.032 | $40.00 | $1,200.00 |
| Claude Opus 5.5 | $0.064 | $80.00 | $2,400.00 |

The Opus example costs $2,400 per month under these assumptions. Routing only selected subtasks to a more expensive model can reduce the blended rate; evaluate cost per successfully completed task as well as cost per call.

### Scenario 3: Data pipeline agent

An agent extracts data, classifies content, and summarizes documents.

| Parameter | Value |
|---|---|
| Documents per day | 1,000 |
| LLM calls per document | 3 |
| Total calls per day | 3,000 |
| Avg input tokens per call | 3,000 |
| Avg output tokens per call | 500 |

| Model | Cost per call | Daily cost | Monthly cost |
|---|---|---|---|
| gpt-6-luna | $0.00055 | $1.65 | $49.50 |
| gpt-6.1-terra | $0.0055 | $16.50 | $495.00 |
| Gemini 2.5 Flash-Lite | $0.0005 | $1.50 | $45.00 |
| Gemini 3.5 Flash-Lite | $0.00215 | $6.45 | $193.50 |
| Claude Haiku 5.5 | $0.00055 | $1.65 | $49.50 |

The lowest token estimate here is $45 per month. Check extraction accuracy and failure handling before routing by price. If the pipeline can run asynchronously, separately evaluate the provider's batch rates and turnaround constraints.

### Scenario 4: Multi-agent workflow

A coordinator dispatches to four workers: a researcher, a writer, a reviewer, and a formatter. All five agents make eight calls each in this constructed example, including coordination and final synthesis.

| Parameter | Value |
|---|---|
| Workflows per day | 40 |
| Agents per workflow | 5, including the coordinator |
| Calls per agent per workflow | 8 |
| Total calls per day | 1,600 |
| Avg input tokens per call | 5,000 |
| Avg output tokens per call | 1,500 |

| Model | Cost per call | Daily cost | Monthly cost |
|---|---|---|---|
| gpt-6.1-sol | $0.025 | $40.00 | $1,200.00 |
| gpt-6.1-terra | $0.0125 | $20.00 | $600.00 |
| Claude Sonnet 5.5 | $0.025 | $40.00 | $1,200.00 |
| Mixed: Sonnet 5.5 coordinator + Haiku 5.5 workers | $0.006 average | $9.60 | $288.00 |

The mixed row assigns 20% of calls to Sonnet and 80% to Haiku, with identical token counts per call: `0.2 × $0.025 + 0.8 × $0.00125 = $0.006`. That is 76% below the all-Sonnet estimate. Different worker prompts, output lengths, or orchestration ratios change the result.

## What Can Change the Estimate?

### Retry Overhead

Suppose each attempt independently has a 5% chance of failure and the application allows up to three retries, stopping on success. Expected attempts per original operation are `1 + 0.05 + 0.05² + 0.05³ = 1.052625`: about **5.26% more attempts**. Translating that into dollars requires knowing which attempts incur charges and how many tokens they consume.

Failures during an outage may be correlated. If three nested layers each allow three total attempts (the initial attempt plus two retries), a persistent failure can reach `3 × 3 × 3 = 27` downstream attempts. That is a worst-case count under those assumptions, not an average billing multiplier. Assign retry responsibility deliberately and bound both attempts and elapsed time.

### Tool and Infrastructure Charges

[Function definitions consume input tokens](https://developers.openai.com/api/docs/guides/function-calling#token-usage); generated tool names and arguments consume output tokens; results included in a later prompt consume input tokens. A large retrieved document can add much more input than the tool call itself. The scenario averages must already include this traffic or be adjusted for it.

Hosted tools and external services may also charge per search, execution, storage unit, or request. Track these alongside model tokens, and add the application infrastructure and engineering work needed to operate the service. A token-only table cannot establish the full cost of running an agent.

### Concurrency and Rate Limits

Ten simultaneous workflows from Scenario 4 represent 400 total calls, not 400 simultaneous calls. If each workflow runs four workers concurrently and each worker issues one call at a time, up to 40 worker calls could overlap; coordinator scheduling can change the peak.

Concurrency alone does not change the token price. It can trigger throttling, queues, and additional attempts, so model the scheduler and retry policy separately from total call volume.

## What Budget Enforcement Changes

Token rates help choose a model; measured call patterns help size the workload. Concurrent agents also need a shared allocation boundary. [Runtime budget enforcement](/concepts/why-rate-limits-are-not-enough-for-autonomous-systems) reserves capacity before protected work and reconciles actual usage afterward.

In Cycles, the application uses the [reserve-commit lifecycle](/protocol/how-reserve-commit-works-in-cycles) around each instrumented operation. A live reservation request that cannot fit the budget returns `409 BUDGET_EXCEEDED`; the application must stop or choose a permitted alternative. A successful reservation covers the requested estimate. For a firm spend boundary, bound the operation's possible usage and reserve enough to cover it; settlement of usage above the reservation follows the configured [overage policy](/glossary#overage-policy). Reconciliation cannot undo an external call or cover uninstrumented work.

## Next Steps

For implementation, the [end-to-end tutorial](/quickstart/end-to-end-tutorial) walks through a budget-guarded OpenAI call. [Common budget patterns](/how-to/common-budget-patterns) explains how to organize allocations across users, workflows, and tenants. The [AI agent cost management guide](/blog/ai-agent-cost-management-guide) places those controls alongside monitoring and alerting.
