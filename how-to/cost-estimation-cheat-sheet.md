---
title: "Cost Estimation Cheat Sheet"
description: "Quick reference for estimating LLM call costs in Cycles, including USD_MICROCENTS conversions and provider pricing tables."
---

# Cost Estimation Cheat Sheet

This guide answers the most common question when adopting Cycles: **how much should I reserve for a given LLM call?**

For the broader strategy guide on estimation approaches, see [Estimate Exposure Before Execution](/how-to/how-to-estimate-exposure-before-execution-practical-reservation-strategies-for-cycles).

## The unit: USD_MICROCENTS

Cycles uses **USD_MICROCENTS** as its primary currency unit:

```
1 USD_MICROCENT = 10⁻⁶ cents = 10⁻⁸ dollars
$1.00 = 100,000,000 microcents
$0.01 = 1,000,000 microcents
```

The formula for converting provider pricing to microcents:

```
microcents = (price_per_million_tokens / 1,000,000) × token_count × 100,000,000
```

Simplified:

```
microcents = price_per_million_tokens × token_count × 100
```

## Provider pricing reference

### OpenAI

| Model | Input (per 1M tokens) | Output (per 1M tokens) | Input (microcents/token) | Output (microcents/token) |
|---|---|---|---|---|
| gpt-5.6-sol | $5.00 | $30.00 | 500 | 3,000 |
| gpt-5.6-terra | $2.50 | $15.00 | 250 | 1,500 |
| gpt-5.6-luna | $1.00 | $6.00 | 100 | 600 |
| gpt-5 | $1.25 | $10.00 | 125 | 1,000 |
| gpt-5-mini | $0.25 | $2.00 | 25 | 200 |
| gpt-5-nano | $0.05 | $0.40 | 5 | 40 |
| gpt-4o | $2.50 | $10.00 | 250 | 1,000 |
| gpt-4o-mini | $0.15 | $0.60 | 15 | 60 |
| gpt-4.1 | $2.00 | $8.00 | 200 | 800 |
| gpt-4.1-mini | $0.40 | $1.60 | 40 | 160 |
| gpt-4.1-nano | $0.10 | $0.40 | 10 | 40 |
| o3 | $2.00 | $8.00 | 200 | 800 |
| o3-mini | $1.10 | $4.40 | 110 | 440 |
| o4-mini | $1.10 | $4.40 | 110 | 440 |

### Anthropic

| Model | Input (per 1M tokens) | Output (per 1M tokens) | Input (microcents/token) | Output (microcents/token) |
|---|---|---|---|---|
| Claude Opus 4.8 | $5.00 | $25.00 | 500 | 2,500 |
| Claude Sonnet 4.6 | $3.00 | $15.00 | 300 | 1,500 |
| Claude Haiku 4.5 | $1.00 | $5.00 | 100 | 500 |

### Google

| Model | Input (per 1M tokens) | Output (per 1M tokens) | Input (microcents/token) | Output (microcents/token) |
|---|---|---|---|---|
| Gemini 2.5 Pro | $1.25 | $10.00 | 125 | 1,000 |
| Gemini 2.5 Flash | $0.30 | $2.50 | 30 | 250 |
| Gemini 2.5 Flash-Lite | $0.10 | $0.40 | 10 | 40 |

### Groq on-demand

| Model | Input (per 1M tokens) | Output (per 1M tokens) | Input (microcents/token) | Output (microcents/token) |
|---|---|---|---|---|
| openai/gpt-oss-20b | $0.075 | $0.30 | 7.5 | 30 |
| openai/gpt-oss-120b | $0.15 | $0.60 | 15 | 60 |
| qwen/qwen3.6-27b | $0.60 | $3.00 | 60 | 300 |

> Open-model pricing and availability vary by host. The table above is specifically Groq's on-demand pricing, not a universal rate for those model families. Round the final reservation amount up when a per-token conversion is fractional. Self-hosted models have no provider token invoice, but still consume compute; use a unit that matches what you want to bound. See the [Groq integration guide](/how-to/integrating-cycles-with-groq) and [Ollama integration guide](/how-to/integrating-cycles-with-ollama).

::: info Note
Provider rates above were checked on July 24, 2026. The OpenAI table includes the current GPT-5.6 family plus selected older models that still appear in examples. GPT-5.6 cache reads are discounted, cache writes cost 1.25 times the uncached input rate, and requests above 272,000 input tokens use higher rates for the full request. Prices, caching rules, long-context tiers, and regional premiums change; check each provider's pricing page before deploying. The formulas remain the same.
:::

## Quick estimation formula

For a single LLM call:

```
estimate = (max_input_tokens × input_microcents) + (max_output_tokens × output_microcents)
```

Then add a safety buffer:

```
reservation_amount = estimate × 1.2   # 20% buffer
```

### Example: GPT-5.6 Luna call with 2,000 input tokens, 1,000 max output tokens

```
input_cost  = 2,000 × 100 = 200,000 microcents
output_cost = 1,000 × 600 = 600,000 microcents
total       = 800,000 microcents ($0.008)
with buffer = 960,000 microcents
```

### Example: Claude Sonnet 4.6 call with 4,000 input tokens, 2,000 max output tokens

```
input_cost  = 4,000 × 300   = 1,200,000 microcents
output_cost = 2,000 × 1,500 = 3,000,000 microcents
total       = 4,200,000 microcents ($0.042)
with buffer = 5,040,000 microcents
```

## Estimation helpers in code

::: code-group
```python [Python]
import math

# Simple cost estimator
def estimate_cost(input_tokens: int, max_output_tokens: int, model: str) -> int:
    """Return estimated cost in USD_MICROCENTS with 20% buffer."""
    rates = {
        "gpt-5.6-sol":     (500, 3000),
        "gpt-5.6-terra":   (250, 1500),
        "gpt-5.6-luna":    (100, 600),
        "gpt-4o":          (250, 1000),
        "gpt-4o-mini":     (15, 60),
        "gpt-4.1":         (200, 800),
        "gpt-4.1-mini":    (40, 160),
        "gpt-4.1-nano":    (10, 40),
        "claude-sonnet":   (300, 1500),
        "claude-haiku":    (100, 500),
        "gemini-2.5-pro":  (125, 1000),
        "gemini-2.5-flash":(30, 250),
        "groq:gpt-oss-20b":(7.5, 30),
        "groq:gpt-oss-120b":(15, 60),
        "groq:qwen3.6-27b": (60, 300),
    }
    input_rate, output_rate = rates.get(model, (100, 600))
    estimate = (input_tokens * input_rate) + (max_output_tokens * output_rate)
    return math.ceil(estimate * 1.2)

# Usage with the @cycles decorator
@cycles(
    estimate=lambda prompt, max_tokens=1000: estimate_cost(
        len(prompt) // 4, max_tokens, "gpt-5.6-luna"
    ),
    action_kind="llm.completion",
    action_name="openai:gpt-5.6-luna",
)
def ask(prompt: str, max_tokens: int = 1000) -> str:
    ...
```
```typescript [TypeScript]
function estimateCost(inputTokens: number, maxOutputTokens: number, model: string): number {
  const rates: Record<string, [number, number]> = {
    "gpt-5.6-sol":     [500, 3000],
    "gpt-5.6-terra":   [250, 1500],
    "gpt-5.6-luna":    [100, 600],
    "gpt-4o":          [250, 1000],
    "gpt-4o-mini":     [15, 60],
    "gpt-4.1":         [200, 800],
    "gpt-4.1-mini":    [40, 160],
    "gpt-4.1-nano":    [10, 40],
    "claude-sonnet":   [300, 1500],
    "claude-haiku":    [100, 500],
    "gemini-2.5-pro":  [125, 1000],
    "gemini-2.5-flash":[30, 250],
    "groq:gpt-oss-20b":[7.5, 30],
    "groq:gpt-oss-120b":[15, 60],
    "groq:qwen3.6-27b": [60, 300],
  };
  const [inputRate, outputRate] = rates[model] ?? [100, 600];
  const estimate = inputTokens * inputRate + maxOutputTokens * outputRate;
  return Math.ceil(estimate * 1.2);
}

const ask = withCycles(
  {
    estimate: (prompt: string) => estimateCost(Math.ceil(prompt.length / 4), 1000, "gpt-5.6-luna"),
    actionKind: "llm.completion",
    actionName: "openai:gpt-5.6-luna",
  },
  async (prompt: string) => { ... },
);
```
:::

## Common reservation amounts

Quick reference for typical operations (including 20% buffer):

| Operation | Model | Typical Estimate (microcents) | Approx USD |
|---|---|---|---|
| Short chat reply (500 in / 200 out) | gpt-5.6-luna | 204,000 | $0.002 |
| Long chat reply (2,000 in / 1,000 out) | gpt-5.6-luna | 960,000 | $0.010 |
| Document summary (8,000 in / 2,000 out) | gpt-5.6-luna | 2,400,000 | $0.024 |
| Short chat reply (500 in / 200 out) | gpt-4o-mini | 23,400 | $0.0002 |
| Long chat reply (2,000 in / 1,000 out) | claude-sonnet | 2,520,000 | $0.025 |
| Code generation (4,000 in / 4,000 out) | claude-sonnet | 8,640,000 | $0.086 |

## When you don't know the exact token count

Use these rules of thumb:

- **1 token is roughly 4 characters** of English text (or ~0.75 words)
- For input: count the prompt characters and divide by 4
- For output: use the `max_tokens` parameter you're passing to the provider
- **Always round up** — over-reserving temporarily locks budget but releases the unused portion on commit

## Using TOKENS unit instead of USD_MICROCENTS

If you prefer to budget in tokens rather than dollars:

```python
@cycles(estimate=2000, unit="TOKENS", action_kind="llm.completion", action_name="gpt-5.6-luna")
def ask(prompt: str) -> str:
    ...
```

This is simpler but does not account for different costs across models. Use `TOKENS` when all your calls use the same model, or when you want model-agnostic budgets.

## Overage policies and estimation

Your estimation strategy should match your [overage policy](/protocol/commit-overage-policies-in-cycles-reject-allow-if-available-and-allow-with-overdraft):

| Policy | Estimation approach |
|---|---|
| **REJECT** | Reserve conservatively (use 120-150% buffer). Under-reserving causes commit failures. |
| **ALLOW_IF_AVAILABLE** | Reserve your best estimate. If actual exceeds reserved, the delta is deducted from remaining budget. |
| **ALLOW_WITH_OVERDRAFT** | Reserve normally. Overage is allowed up to the overdraft limit. Best for SLA-critical operations. |

## Next steps

- [Estimate Exposure Before Execution](/how-to/how-to-estimate-exposure-before-execution-practical-reservation-strategies-for-cycles) — detailed strategy guide for improving estimation over time
- [Understanding Units](/protocol/understanding-units-in-cycles-usd-microcents-tokens-credits-and-risk-points) — how USD_MICROCENTS, TOKENS, CREDITS, and RISK_POINTS work
- [Commit Overage Policies](/protocol/commit-overage-policies-in-cycles-reject-allow-if-available-and-allow-with-overdraft) — what happens when actual exceeds estimated
- [How Much Do AI Agents Actually Cost?](/blog/how-much-do-ai-agents-cost) — per-token pricing across providers with real-world cost scenarios
