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

Default model rates were verified on **November 12, 2026** against [OpenAI API pricing](https://developers.openai.com/api/docs/pricing) and [Anthropic API pricing](https://platform.claude.com/docs/en/about-claude/pricing). The presets include GPT-6 Astra, GPT-6.1 Sol, GPT-6.1 Terra, GPT-6 Luna, GPT-6 Sol, Claude Fable 5.2, Claude Opus 5.5, Claude Sonnet 5.5, and Claude Haiku 5.5.

Prices are in USD for standard API processing without caching. Editable cells contain **base rates** while automatic context pricing is enabled. For the listed GPT models, prompts above **272,000 input tokens** apply 2× input and 1.5× output rates to the entire call. Claude Haiku 5.5 applies 5× input and output rates above **100,000 input tokens** ($0.50 input / $2.50 output per million at default rates). Fable 5.2, Opus 5.5, and Sonnet 5.5 have no long-context price increase.

Multipliers apply by exact preset model name, including when you edit its base rates. Turn automatic context pricing off to enter effective rates directly. Custom or renamed models use the entered rates unchanged. Context and output limits are not enforced; verify that your workload fits each model. If calls cross a pricing threshold, estimate each group separately rather than using an average prompt length.

Shared URLs preserve saved models, rates, and the context-pricing setting. Older links with saved models stay in manual pricing mode to avoid applying a surcharge twice. **Replace rows with latest presets** refreshes the lineup and enables automatic context pricing while keeping your workload inputs. Workload-only links use current defaults.

The cost for a single LLM call is:

```
cost_per_call = (input_tokens × effective_input_price_per_M + output_tokens × effective_output_price_per_M) ÷ 1,000,000
```

Per-day, per-month, and per-year columns multiply by `calls_per_day`, then by 30 and 365 respectively.

For example, GPT-6.1 Sol at 2,000 input tokens, 800 output tokens, and 10,000 calls/day costs **$0.012/call, $120/day, $3,600 per 30-day month, and $43,800 per 365-day year**. CSV and Markdown exports retain numeric precision instead of rounding totals to whole dollars. Invalid inputs show a dash and are excluded from the cheapest-model comparison.

Use total billed output tokens, including [OpenAI reasoning tokens](https://developers.openai.com/api/docs/guides/reasoning#how-reasoning-works) or [Claude thinking tokens](https://platform.claude.com/docs/en/build-with-claude/thinking-steering-and-cost), rather than just the visible answer. Token counts depend on the model's tokenizer, so identical text can produce different counts. The cheapest positive per-year total is highlighted; equal token volumes compare rates, not model quality or equal-text costs.

## What the calculator does not include

- **Prompt caching.** Reads have discounted rates, while cache writes can cost more than ordinary input. Savings depend on the model, cache lifetime, and hit rate; the calculator uses uncached input rates.
- **Batch and Flex discounts.** Both providers publish 50% Batch discounts for the default models. OpenAI also offers Flex pricing. These modes are not selected automatically.
- **Fast and Ultrafast modes, data residency, and tool fees.** These can add charges beyond standard token rates.
- **Fine-tuning costs.** Per-token rates differ for fine-tuned model variants.
- **Reserved or committed-use pricing.** Enterprise contracts often beat list pricing materially.
- **Model-limit validation and custom-model pricing tiers.** The calculator estimates cost; it does not confirm that a model accepts the requested input or output length. Automatic tiers cover only the named presets.

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
