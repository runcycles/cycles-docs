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

Consider an illustrative customer-support agent running on GPT-4o. A prototype-based estimate puts it at $800 per month; production-shaped assumptions put it at $4,200. The model rate is unchanged. The scenario reaches the higher total because it assumes 11 LLM calls per conversation instead of three, growing contexts, and additional retries on tool failures. The per-token price is not the only variable; the execution pattern is.

> **Recreate the "estimated $800, actual $4,200" scenario in the calculator:** [Open with these numbers pre-loaded →](/calculators/claude-vs-gpt-cost-standalone#s=eyJ3b3JrbG9hZE5hbWUiOiJDdXN0b21lciBzdXBwb3J0IGJvdCIsIndvcmtsb2FkRGVzY3JpcHRpb24iOiIxMSBMTE0gY2FsbHMgcGVyIGNvbnZlcnNhdGlvbi4gQ29udGV4dCB3aW5kb3dzIGdyb3cgd2l0aCBlYWNoIHR1cm4uIEVzdGltYXRlZCAkODAwL21vLCBhY3R1YWwgJDQsMjAwLiIsImlucHV0VG9rZW5zIjo1MDAwLCJvdXRwdXRUb2tlbnMiOjEyMDAsImNhbGxzUGVyRGF5IjozMzAwfQ)

<!-- more -->

This post is a reference guide. We break down representative per-token pricing across major providers, then show what those prices mean under illustrative agent workload assumptions. Pricing was verified against provider documentation on **July 24, 2026**; recheck the linked provider pages before making a purchasing decision.

## Per-Token Pricing by Provider

All prices below are per 1 million [tokens](/glossary#tokens). Every provider charges separately for input tokens (what you send) and output tokens (what the model generates). Agents are output-heavy relative to simple completions, because they generate tool calls, reasoning chains, and structured responses.

### [OpenAI](https://developers.openai.com/api/docs/models/gpt-4o)

| Model | Input (per 1M tokens) | Output (per 1M tokens) | Notes |
|---|---|---|---|
| gpt-4o | $2.50 | $10.00 | Flagship multimodal model |
| gpt-4o-mini | $0.15 | $0.60 | Cost-optimized for high-volume |
| gpt-4.1 | $2.00 | $8.00 | General-purpose model with long context |
| gpt-4.1-mini | $0.40 | $1.60 | Balanced cost/capability |
| o3 | $2.00 | $8.00 | Reasoning model |
| o4-mini | $1.10 | $4.40 | Compact reasoning model |

### [Anthropic](https://platform.claude.com/docs/en/about-claude/pricing)

| Model | Input (per 1M tokens) | Output (per 1M tokens) | Notes |
|---|---|---|---|
| Claude Opus 4.8 | $5.00 | $25.00 | Premium Opus tier |
| Claude Sonnet 5 | $2.00 | $10.00 | Introductory rate through August 31, 2026; $3/$15 afterward |
| Claude Haiku 4.5 | $1.00 | $5.00 | Fast, lower-cost tier |

### [Google](https://ai.google.dev/gemini-api/docs/pricing)

| Model | Input (per 1M tokens) | Output (per 1M tokens) | Notes |
|---|---|---|---|
| Gemini 2.5 Pro | $1.25 | $10.00 | Advanced reasoning |
| Gemini 2.5 Flash | $0.30 | $2.50 | Hybrid reasoning and throughput |
| Gemini 2.5 Flash-Lite | $0.10 | $0.40 | Lower-cost high-volume option |

A quick observation: even within this small representative set, output pricing ranges from $0.40 per million tokens for Gemini 2.5 Flash-Lite to $25 for Claude Opus 4.8—a 62.5x spread. Model selection is a major cost lever, but only if the cheaper model still meets the workload's quality, latency, and tool-use requirements.

## Why Agents Cost More Than You Think

A chatbot makes one call per user message. An agent makes many.

The disconnect between "per-token pricing looks cheap" and "my agent bill is huge" comes down to four multipliers that compound against each other.

### Calls Per Task

A simple Q&A interaction is one LLM call. A coding agent that reads a file, plans a change, writes code, runs tests, reads the output, and iterates is 15-40 calls for a single task. A deep research agent that searches, reads, synthesizes, and cross-references can hit 80-200 calls. The per-token price is irrelevant if you don't know your call count.

### Retries and Retry Cascades

Each retry is a full LLM call, not a cheap repeat. Layered retry logic (SDK, framework, application) can multiply a single failed call into 27 actual calls. We cover the mechanics in detail in [The True Cost of Uncontrolled AI Agents](/blog/true-cost-of-uncontrolled-agents).

### Context Growth

Every turn of an agent conversation appends to the context window. Turn 1 might send 2,000 tokens. Turn 8 sends 16,000 tokens because it includes the entire conversation history. This is not linear cost growth — it's quadratic-ish, because each call sends everything that came before it plus the new content.

For an 8-turn conversation where each turn adds 2,000 tokens of new content:
- Turn 1 input: 2,000 tokens
- Turn 4 input: 8,000 tokens
- Turn 8 input: 16,000 tokens
- **Total input tokens across all 8 turns: 72,000** (not 16,000)

### Fan-Out

Multi-agent architectures multiply everything. A coordinator dispatching to 5 sub-agents turns a single request into 30-50 calls — and each sub-agent has its own retry logic and growing context. See [the cost amplification math](/blog/true-cost-of-uncontrolled-agents#the-math-how-agents-amplify-api-costs) for the full breakdown.

## Real-World Cost Scenarios

Here is what four common deployment shapes cost under explicit assumptions. These are planning examples, not measured customer bills; your token mix, caching, tools, retries, and negotiated pricing will change the result.

### Scenario 1: Customer support bot

A support bot handling customer questions — looking up orders, checking policies, generating responses.

| Parameter | Value |
|---|---|
| Conversations per day | 100 |
| Turns per conversation | 8 |
| LLM calls per turn | 1.5 (some turns need tool lookups) |
| Total calls per day | 1,200 |
| Avg input tokens per call | 4,000 (grows with conversation) |
| Avg output tokens per call | 800 |

| Model | Cost per call | Daily cost | Monthly cost |
|---|---|---|---|
| gpt-4o | $0.018 | $21.60 | $648 |
| gpt-4o-mini | $0.00108 | $1.30 | $38.88 |
| Claude Sonnet 5 | $0.016 | $19.20 | $576 |
| Claude Haiku 4.5 | $0.008 | $9.60 | $288 |
| Gemini 2.5 Flash | $0.0032 | $3.84 | $115.20 |

Under these assumptions, the same support bot costs about $39 per month on gpt-4o-mini or $576 on Claude Sonnet 5 at its introductory rate. That spread is material, but it is not a quality-adjusted comparison.

### Scenario 2: Coding agent

An agent that reads codebases, generates changes, runs tests, and iterates on failures. Longer context windows because code files are large.

| Parameter | Value |
|---|---|
| Tasks per day | 50 |
| LLM calls per task | 25 (avg of 15-40 range) |
| Total calls per day | 1,250 |
| Avg input tokens per call | 6,000 (code context is large) |
| Avg output tokens per call | 2,000 |

| Model | Cost per call | Daily cost | Monthly cost |
|---|---|---|---|
| gpt-4o | $0.035 | $43.75 | $1,313 |
| gpt-4.1 | $0.028 | $35.00 | $1,050 |
| Claude Sonnet 5 | $0.032 | $40.00 | $1,200 |
| Claude Opus 4.8 | $0.080 | $100.00 | $3,000 |
| o3 | $0.028 | $35.00 | $1,050 |

At this volume, the illustrative Claude Opus 4.8 workload costs $3,000 per month. That reflects the combination of a premium model and agent-scale call volume. Routing only the hardest subtasks to a premium model can reduce the blended rate.

### Scenario 3: Data pipeline agent

An agent that processes documents — extracting data, classifying content, generating summaries.

| Parameter | Value |
|---|---|
| Documents per day | 1,000 |
| LLM calls per document | 3 (extract, classify, summarize) |
| Total calls per day | 3,000 |
| Avg input tokens per call | 3,000 |
| Avg output tokens per call | 500 |

| Model | Cost per call | Daily cost | Monthly cost |
|---|---|---|---|
| gpt-4o-mini | $0.00075 | $2.25 | $67.50 |
| gpt-4.1-mini | $0.002 | $6.00 | $180 |
| Gemini 2.5 Flash-Lite | $0.0005 | $1.50 | $45 |
| Gemini 2.5 Flash | $0.00215 | $6.45 | $193.50 |
| Claude Haiku 4.5 | $0.0055 | $16.50 | $495 |

High-volume, repeatable pipelines are where lower-cost models can materially change unit economics. Under this example, Gemini 2.5 Flash-Lite processes 1,000 documents per day for $45 per month. Measure extraction quality on your own data before routing solely on price.

### Scenario 4: Multi-agent workflow

A coordinator agent dispatches work to specialized sub-agents — a planner, a researcher, a writer, a reviewer, and a formatter. Each sub-agent makes its own LLM calls.

| Parameter | Value |
|---|---|
| Workflows per day | 40 |
| Agents per workflow | 5 |
| Calls per agent per workflow | 8 |
| Total calls per day | 1,600 |
| Avg input tokens per call | 5,000 |
| Avg output tokens per call | 1,500 |

| Model | Cost per call | Daily cost | Monthly cost |
|---|---|---|---|
| gpt-4o | $0.028 | $44.00 | $1,320 |
| gpt-4.1 | $0.022 | $35.20 | $1,056 |
| Claude Sonnet 5 | $0.025 | $40.00 | $1,200 |
| Mixed (Sonnet 5 coordinator + Haiku 4.5 workers) | $0.015 avg | $24.00 | $720 |

The "mixed" row assumes one Sonnet 5 coordinator call for every four Haiku 4.5 worker calls. It is 40% cheaper than the all-Sonnet example under this exact mix; different orchestration ratios produce different savings.

## The Hidden Cost Multipliers

The scenarios above assume clean execution — no failures, no retries, no runaway loops. Production isn't clean. Here are the multipliers that turn estimates into surprises.

### Retry Overhead

A 5% tool failure rate with 3 retries per failure adds 15% to your total call count. That's the optimistic case. If retry logic exists at multiple layers (SDK, framework, application), failures cascade multiplicatively. A 5% failure rate with three-layer retry logic can produce a 45% increase in actual calls.

### Growing Context Windows

The estimates above use average token counts. But agent conversations grow over time. A coding agent that starts with a 4,000-token context on step 1 might be sending 30,000 tokens by step 20 — because every previous step's output is in the context. The last few steps of a long agent run can cost 5-8x more than the first few steps.

### Tool Call Overhead

Each tool call adds tokens in both directions — the tool call schema in the output and the tool result in the next input. A single function call might add 200-500 tokens of overhead per round-trip. An agent that makes 3 tool calls per step adds 600-1,500 tokens of pure overhead per step, compounding across the conversation.

### Concurrency Spikes

Ten users triggering multi-agent workflows simultaneously means 160 concurrent LLM calls in Scenario 4. If your rate limits can't handle the burst, you get 429 errors, which trigger retries, which create more load. Concurrency doesn't just multiply cost linearly — it creates failure modes that multiply cost super-linearly.

## What Budget Enforcement Changes

Knowing your costs is the first step. Controlling them is the next.

Agent costs are a function of call patterns, not just token prices. A 10% change in model pricing matters far less than a runaway loop that makes 500 calls instead of 50. We wrote about [why monitoring alone isn't sufficient](/blog/true-cost-of-uncontrolled-agents#the-observability-gap) and how [pre-execution runtime authority](/blog/true-cost-of-uncontrolled-agents#runtime-authority-as-infrastructure) closes the gap.

[Cycles](/) can provide this layer at the operations your application instruments. The application reserves an estimate before protected work and commits actual usage afterward. A live reservation that cannot fit returns an error; the application decides how to stop or degrade.

## From cost visibility to cost control

Token rates help choose a model; call-shape measurements help size the workload. Neither guarantees that concurrent agents stay within a shared allocation. A [runtime budget boundary](/concepts/why-rate-limits-are-not-enough-for-autonomous-systems) adds that third concern: reserve capacity before each instrumented operation, then reconcile the actual amount.

## Next steps

If you're estimating costs for a new agent deployment or trying to understand an existing one:

- The [Cost Estimation Cheat Sheet](/how-to/cost-estimation-cheat-sheet) provides formulas and lookup tables for quick sizing
- [Common Budget Patterns](/how-to/common-budget-patterns) covers the most effective ways to structure budgets across the scenarios described above
- [AI Agent Cost Management: The Complete Guide](/blog/ai-agent-cost-management-guide) — the maturity model from monitoring to hard enforcement
- [AI Agent Budget Control: Enforce Hard Spend Limits](/blog/ai-agent-budget-control-enforce-hard-spend-limits) — how the reserve-commit pattern works
- [5 AI Agent Failures Budget Controls Would Prevent](/blog/ai-agent-failures-budget-controls-prevent) — concrete failure scenarios with dollar-amount breakdowns
- The [End-to-End Tutorial](/quickstart/end-to-end-tutorial) walks through setting up Cycles with a working agent in under 30 minutes

The cheapest agent incident is the one that never happens. Start by knowing your numbers. Then put a system in place to enforce them.

## Related how-to guides

- [Integrating with AWS Bedrock](/how-to/integrating-cycles-with-aws-bedrock)
- [Using the Cycles dashboard](/how-to/using-the-cycles-dashboard)
- [Integrating with OpenAI](/how-to/integrating-cycles-with-openai)
