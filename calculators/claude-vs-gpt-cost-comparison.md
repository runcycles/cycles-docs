---
title: "Claude vs GPT Cost Calculator: Compare LLM API Pricing"
description: "Free interactive calculator comparing Claude and OpenAI API costs per call, per day, per month, and per year for editable token volumes and model rates."
og:
  preview:
    value: "$10K"
    label: "monthly — highest vs lowest model, same workload"
    pill: "24×"
    pillCaption: "model spread"
  hook: "Plug in your token volume. Compare every Claude and GPT model. Share the URL."
---

# Claude vs GPT Cost Calculator

A free interactive calculator that compares per-call, per-day, per-month, and per-year cost across the major Claude and OpenAI models for any token volume and call rate.

> **Tip:** [Open fullscreen ↗](/calculators/claude-vs-gpt-cost-standalone) for a wider table, share/export buttons, and a shareable URL that preserves your configuration. The same toolbar is also available below.

<CostCalculator
  variant="docs"
  standalone-path="/calculators/claude-vs-gpt-cost-standalone"
  embed-path="/calculators/claude-vs-gpt-cost-embed"
/>

## How the calculation works

Model prices change frequently. The defaults are starting points, not a pricing guarantee — edit any rate to match the current provider pricing page or your contracted rates.

The cost for a single LLM call is:

```
cost_per_call = (input_tokens × input_price_per_M + output_tokens × output_price_per_M) ÷ 1,000,000
```

Per-day, per-month, and per-year columns multiply by `calls_per_day`, then by 30 and 365 respectively.

The pricing rates default to widely-published reference values, but they are user-editable above so you can plug in current or contracted rates. The cheapest per-year row is highlighted.

## What the calculator does not include

- **Prompt caching discounts.** Anthropic's `cache_control` blocks bill cache hits at a fraction of base input pricing (for example, Opus 4.7 cache hits at $0.50 / MTok vs $5 / MTok base input). OpenAI also offers cached-input and Batch API pricing on supported models, but the discount varies by model. If a meaningful share of your prompts are reused, your real cost may be 30–60% lower than the calculator suggests.
- **Batch API discounts.** Both providers offer batch-processing discounts (Anthropic at 50%; OpenAI varies).
- **Fine-tuning costs.** Per-token rates differ for fine-tuned model variants.
- **Reserved or committed-use pricing.** Enterprise contracts often beat list pricing materially.
- **Context-window pricing tiers.** Some providers charge differently for very long contexts.

For accurate enterprise planning, treat the calculator as a directional estimate and verify with your provider account manager.

## Why estimates are not the same as runtime authority

A common pattern: a team uses a calculator like this to project monthly cost at $4,000, sets up an alert for "$5,000 exceeded," and then loses $40,000 in a weekend to an agent that loops while the on-call team sleeps.

Calculators answer "what *should* we spend?" Cycles answers a broader question — "what *should be allowed to happen at all?" — by enforcing both budgets and action authority at runtime, before each call or tool invocation leaves your application. Cost is one dimension of that. The other dimensions matter just as much in production:

- **Blast radius.** A single agent action — a deploy, an email blast, a database mutation — can cost more in damage than the agent's entire month of LLM bills. [Action authority](/concepts/action-authority-controlling-what-agents-do) caps *what* agents do, not just *how much* they spend.
- **Risk-weighted authorization.** Not every tool call is equal. Reading a file is not the same as sending a refund or executing code. [RISK_POINTS](/how-to/assigning-risk-points-to-agent-tools) lets you allocate authority by danger, not by token count.
- **Multi-tenant boundaries.** A noisy tenant cannot drain shared headroom from quiet ones. See [Multi-tenant SaaS](/how-to/multi-tenant-saas-with-cycles).

If your projected $4,000/month is the actual constraint, the right response is not an alert at $5,000 but a [pre-execution gate](/protocol/how-decide-works-in-cycles-preflight-budget-checks-without-reservation) that will not let calls proceed beyond the cap — *and* an action-authority layer that prevents the catastrophic single mistake that no cost calculator can predict.

## Related

- [Why Cycles](/why-cycles) — cost, action authority, multi-tenant isolation, and governance, together
- [Cost Estimation Cheat Sheet](/how-to/cost-estimation-cheat-sheet) — how to size budgets accurately
- [Action authority: controlling what agents do](/concepts/action-authority-controlling-what-agents-do) — the blast-radius dimension
- [Debugging sudden LLM cost spikes](/troubleshoot/llm-cost-spike-debugging) — what to do when the calculator was wrong
- [Cycles vs Provider Spending Caps](/concepts/cycles-vs-provider-spending-caps) — why provider caps do not bound multi-tenant spend
