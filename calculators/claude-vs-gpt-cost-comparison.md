---
title: "Claude vs GPT Cost Calculator: Compare LLM API Pricing"
description: "Free interactive calculator comparing Claude and OpenAI API costs per call, per day, per month, and per year for editable token volumes and model rates."
og:
  preview:
    value: "$18K"
    label: "monthly — highest vs lowest model, same workload"
    pill: "100×"
    pillCaption: "model spread"
  hook: "Plug in your token volume. Compare leading Claude and GPT models. Share the URL."
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

Default model rates were verified on **September 30, 2026** against [OpenAI API pricing](https://developers.openai.com/api/docs/pricing) and [Anthropic API pricing](https://platform.claude.com/docs/en/about-claude/pricing). The lineup includes GPT-6 Astra, GPT-6.1 Sol, GPT-6 Luna, GPT-6 Sol, Claude Fable 5.1, Claude Opus 5.5, Claude Sonnet 5.5, and Claude Haiku 4.5.

Prices are in USD for standard API processing without caching. GPT rates assume at most **272,000 input tokens per call**; each model's context limit still applies. Model prices change frequently; edit any rate to match current provider pricing or your contract. Shared URLs preserve saved models and rates, so an older link can contain older prices.

The cost for a single LLM call is:

```
cost_per_call = (input_tokens × input_price_per_M + output_tokens × output_price_per_M) ÷ 1,000,000
```

Per-day, per-month, and per-year columns multiply by `calls_per_day`, then by 30 and 365 respectively.

Use total billed output tokens, including [OpenAI reasoning tokens](https://developers.openai.com/api/docs/guides/reasoning#how-reasoning-works) or [Claude thinking tokens](https://platform.claude.com/docs/en/build-with-claude/thinking-steering-and-cost), rather than just the visible answer. Token counts depend on the model's tokenizer, so identical text can produce different counts. The cheapest positive per-year total is highlighted; equal token volumes compare rates, not model quality or equal-text costs.

## What the calculator does not include

- **Prompt caching.** Reads have discounted rates, while cache writes can cost more than ordinary input. Savings depend on the model, cache lifetime, and hit rate; the calculator uses uncached input rates.
- **Batch and Flex discounts.** Both providers publish 50% Batch discounts for the default models. OpenAI also offers Flex pricing. These modes are not selected automatically.
- **Fast and Ultrafast modes, data residency, and tool fees.** These can add charges beyond standard token rates.
- **Fine-tuning costs.** Per-token rates differ for fine-tuned model variants.
- **Reserved or committed-use pricing.** Enterprise contracts often beat list pricing materially.
- **Automatic context-window pricing tiers.** Above 272,000 input tokens, the default GPT models charge 2× the input rate and 1.5× the output rate for the entire request. Enter those rates manually for long-context workloads. Claude Fable 5.1, Opus 5.5, and Sonnet 5.5 have standard rates throughout their 1M-token context windows; Haiku 4.5 has a 200K-token context window. Check model limits before budgeting a request.

For accurate enterprise planning, treat the calculator as a directional estimate and verify with your provider account manager.

## Why estimates are not the same as runtime authority

A common pattern: a team uses a calculator like this to project monthly cost at $4,000, sets up an alert for "$5,000 exceeded," and then loses $40,000 in a weekend to an agent that loops while the on-call team sleeps.

Calculators answer "what *might this workload cost?" Cycles can enforce caller-configured budgets at a mandatory application boundary before protected work begins. Application authorization separately decides which calls and tool arguments are allowed. Cost is one dimension of the resulting control design:

- **Blast radius.** A single agent action — a deploy, an email blast, a database mutation — can cost more in damage than the agent's entire month of LLM bills. The host must authorize the tool and arguments; Cycles can meter caller-assigned action exposure alongside that decision.
- **Risk-weighted budgeting.** Not every tool call is equal. [RISK_POINTS](/how-to/assigning-risk-points-to-agent-tools) lets the caller meter a team-defined exposure score separately from token cost; it is not an authorization decision.
- **Multi-tenant boundaries.** A noisy tenant cannot drain shared headroom from quiet ones. See [Multi-tenant SaaS](/how-to/multi-tenant-saas-with-cycles).

If your projected $4,000/month is the actual constraint, the right response is not an alert at $5,000 but a [pre-execution gate](/protocol/how-decide-works-in-cycles-preflight-budget-checks-without-reservation) that will not let calls proceed beyond the cap — *and* an action-authority layer that prevents the catastrophic single mistake that no cost calculator can predict.

## Related

- [Why Cycles](/why-cycles) — budget authority, application authorization, tenant scoping, and governance together
- [Cost Estimation Cheat Sheet](/how-to/cost-estimation-cheat-sheet) — how to size budgets accurately
- [Action authority: controlling what agents do](/concepts/action-authority-controlling-what-agents-do) — the blast-radius dimension
- [Debugging sudden LLM cost spikes](/troubleshoot/llm-cost-spike-debugging) — what to do when the calculator was wrong
- [Cycles vs Provider Spending Caps](/concepts/cycles-vs-provider-spending-caps) — why provider caps do not bound multi-tenant spend
