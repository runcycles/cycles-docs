---
title: "AI Agent Blast Radius Risk Calculator"
description: "Free interactive calculator quantifying the monthly blast radius of AI agent actions — by reversibility, visibility, and audience size — with an editable runtime-authority containment factor."
og:
  preview:
    value: "$342K"
    label: "monthly blast radius — default workload"
    pill: "×14"
    pillCaption: "catastrophic"
  hook: "Model your agent. See the monthly blast radius. Share the URL."
---

# AI Agent Blast Radius Risk Calculator

A free interactive calculator for the action / risk axis of AI agent governance. Cost calculators answer "how much will this workload spend?" Blast-radius calculators answer the harder question: **"if this workload's actions fire when they should not, how much damage is in scope?"**

> **Tip:** [Open fullscreen ↗](/calculators/ai-agent-blast-radius-standalone) for a wider table, share/export buttons, and a shareable URL that preserves your configuration. The same toolbar is also available below.

<BlastRadiusCalculator
  variant="docs"
  standalone-path="/calculators/ai-agent-blast-radius-standalone"
  embed-path="/calculators/ai-agent-blast-radius-embed"
/>

## What "blast radius" means here

**Blast radius is the magnitude of damage that *could* occur if an action fires when it should not — a measure of risk exposure, not a prediction.** Most attempted actions will not actually go wrong, but the radius is always present until something bounds it. The calculator does not claim "you will lose this much money"; it claims "this is the damage envelope you are sitting inside until you put a runtime control in place."

This framing matters because the catastrophic action classes (irreversible + public) usually have *low* error rates. The frequency is small; the radius is enormous. A risk-prediction framing under-rates them. A blast-radius framing exposes them.

## How the calculation works

Each row models one class of action your agent can take. The calculator quantifies monthly blast radius along two orthogonal axes:

**Reversibility** — recovery cost multiplier:

| Level | Factor | Examples |
|---|---|---|
| Reversible | ×1 | Read a file, write a draft, query a database |
| Hard to reverse | ×3 | Refunds (chargeback dispute), partial deletes, ledger corrections |
| Irreversible | ×10 | DROP TABLE, send (anything), publish, deploy |

**Visibility** — reputational reach surcharge:

| Level | Surcharge | Examples |
|---|---|---|
| Internal only | +0 | Backend mutation, log line, internal CRUD |
| Customer-facing | +1 | Email to one customer, single-account change, support ticket reply |
| Public | +4 | Public post, mass email, deploy to prod website, social-media reply, blog publish |

**Severity factor = reversibility multiplier + visibility surcharge.** Additive, not multiplicative — multiplying both produces unbelievable numbers fast (×50+) and damages the calculator's credibility. Additive keeps the math defensible while still capturing that *irreversible + public* is the catastrophic class.

**Per-incident blast** = `(cost_per_action + affected_users × cost_per_user) × severity_factor`

**Monthly blast radius** = `per_incident × calls_per_day × (error_rate / 100) × 30`

**With Cycles** = `monthly_blast × (1 - containment_pct / 100)` — where containment is the share of incidents that runtime [action authority](/concepts/action-authority-controlling-what-agents-do) would prevent before they fire.

## The catastrophic class: irreversible + public

Rows where reversibility is **Irreversible** AND visibility is **Public** are flagged with a warning marker and red outline. This combination — an agent action that cannot be undone *and* reaches a public audience — is the single most under-modeled risk class in agent governance. Examples:

- A coding agent that publishes a release tagged "fixes critical bug" when it actually shipped the bug
- A support agent that posts a public reply on a brand-controlled social account using internal-only language
- A content agent that publishes the wrong draft to the public blog
- A marketing agent that sends a mass email with the wrong subject line or attached customer data

In each case the LLM bill is trivial and would not trigger any cost-based alert. The damage is in the action itself and in the audience reach. No amount of cost monitoring catches this — it is structurally outside the cost dimension.

## What the calculator does not include

- **Regulatory and legal cost.** A wrong action that triggers GDPR breach reporting, FTC inquiry, or contractual penalties can dwarf the modeled per-incident damage. Severity multipliers do not capture this.
- **Cascading damage.** Some actions trigger downstream incidents (a wrong deploy that corrupts a database that triggers a retry storm). The model treats each row independently.
- **Trust-loss compounding.** Repeated incidents within a short window damage trust nonlinearly — the second wrong email blast in a quarter costs more than 2× the first.
- **Containment effectiveness depends on policy.** The "with Cycles" column applies a flat percentage. In reality, containment varies by action class — a per-action `RISK_POINTS` cap on `send_email` may catch 99% of email blast incidents while only catching 60% of database mutation incidents depending on how the policy is written.

Treat the calculator as a directional estimate that exposes the *structure* of agent action risk. Use your own incident history to dial in the multipliers if you have it.

## Why this is symmetric to the cost calculator

The two calculators answer two halves of the same question:

| | Cost calculator | Blast-radius calculator |
|---|---|---|
| Question | "How much will this workload spend?" | "If this workload's actions go wrong, how much damage is in scope?" |
| Inputs | tokens, calls, model rates | actions, reversibility, visibility, error rate |
| Output | $ per call / day / month / year | $ blast radius per month |
| Output type | expected spend | risk exposure (not a prediction) |
| Persuasion column | "Cheapest model — save 30×" | "Δ — monthly risk reduction from containment" |
| Maps to Cycles dimension | Cost runtime control | Action runtime authority |

A real production AI workload has both. Cost is bounded by a [budget](/guides/llm-cost-runtime-control). Damage is bounded by [what you do not let the agent do in the first place](/guides/risk-and-blast-radius). Cycles enforces both at the same runtime gate.

## Related

- [Why Cycles for Action Authority](/why-cycles/action-authority) — the product framing
- [AI Agent Risk & Blast Radius: A Production Reference](/guides/risk-and-blast-radius) — the full topic guide
- [Action authority: controlling what agents do](/concepts/action-authority-controlling-what-agents-do) — the conceptual foundation
- [Assigning RISK_POINTS to agent tools](/how-to/assigning-risk-points-to-agent-tools) — implementation
- [AI Agent Risk Assessment](/blog/ai-agent-risk-assessment-score-classify-enforce-tool-risk) — scoring and classifying tool risk
- [Claude vs GPT Cost Calculator](/calculators/claude-vs-gpt-cost-comparison) — the cost-axis companion
