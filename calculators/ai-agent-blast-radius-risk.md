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

**Runaway blast** = `per_incident × runaway_ceiling` — one action looping N times (the [runaway / tool-loop](/incidents/runaway-agents-tool-loops-and-budget-overruns-the-incidents-cycles-is-designed-to-prevent) failure mode) before it is stopped. The **runaway ceiling** is an action *count*. A host-enforced per-run count cap sets it directly, while a mandatory reservation of caller-assigned [`RISK_POINTS`](/how-to/assigning-risk-points-to-agent-tools) can bound cumulative attempts indirectly—roughly `budget ÷ risk_points_per_attempt`, and fewer if other attempts draw on the same budget. Enter the effective ceiling your actual authorization and budget controls enforce.

**With configured containment** = `monthly_blast × (1 - containment_pct / 100)` — where containment is your assumed share of incidents prevented by mandatory application authorization plus any enforced count or exposure budget. The slider is a scenario input, not a measured Cycles effectiveness rate.

The table shows **three** numbers per action: **Blast / incident** (a single wrong fire — the discrete, worst-case exposure), **Runaway blast** (that incident × the runaway ceiling — a looping agent before it is stopped), and **Blast / mo** (the expected loss at your error rate). This is deliberate: catastrophic classes fire rarely, so the monthly figure alone under-rates them — the per-incident and runaway radii are what a risk-prediction framing misses.

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
| Output | $ per call / day / month / year | $ blast radius per incident + per month |
| Output type | expected spend | risk exposure (not a prediction) |
| Persuasion column | "Cheapest model — save 43×" | "Δ — monthly risk reduction from containment" |
| Maps to Cycles dimension | Cost runtime control | Action runtime authority |

A real production AI workload has both. A mandatory [budget boundary](/guides/llm-cost-runtime-control) can bound submitted spend, subject to estimation, settlement, overage policy, and coverage. Damage is bounded by [what the host does not let the agent do in the first place](/guides/risk-and-blast-radius). The host can compose authorization with a Cycles `RISK_POINTS` reservation at the same dispatch boundary; Cycles does not supply the permission decision.

## Related

- [Why Cycles for Action Authority](/why-cycles/action-authority) — the product framing
- [AI Agent Risk & Blast Radius: A Production Reference](/guides/risk-and-blast-radius) — the full topic guide
- [Action authority: controlling what agents do](/concepts/action-authority-controlling-what-agents-do) — the conceptual foundation
- [Assigning RISK_POINTS to agent tools](/how-to/assigning-risk-points-to-agent-tools) — implementation
- [AI Agent Risk Assessment](/blog/ai-agent-risk-assessment-score-classify-enforce-tool-risk) — scoring and classifying tool risk
- [Claude vs GPT Cost Calculator](/calculators/claude-vs-gpt-cost-comparison) — the cost-axis companion
