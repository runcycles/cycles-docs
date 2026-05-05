---
title: "Exposure: Why Rate Limits Leave Agents Unbounded"
description: "Exposure is the gap between what an agent does and when enforcement stops it. Rate limits and observability don't close that gap — pre-execution authority does."
---

# Exposure: Why Rate Limits Leave Agents Unbounded

Exposure is the total cost, risk, or damage an autonomous system can create before something stops it.

It is not the same as spend. A support agent that sends 200 customer emails costs $1.40 in model tokens — but creates $50,000 in lost pipeline. The spend was trivial. The exposure was catastrophic.

> **Quantify exposure for your agent:** [Blast Radius Risk Calculator →](/calculators/ai-agent-blast-radius-standalone) — model action classes by reversibility and visibility; the catastrophic *irreversible + public* class is what rate limits leave unbounded.

## Why exposure matters

Every autonomous system has two numbers:

1. **Spend** — what it costs to run (tokens, compute, API fees)
2. **Exposure** — what it can do before it is stopped (emails sent, records modified, deploys triggered, dollars committed)

Most cost controls target spend. Rate limits cap requests per second. Provider spending caps pause billing at a monthly threshold. Observability dashboards show what happened after the fact.

None of these bound exposure, because none of them enforce limits **before** the next action executes.

## Rate limits don't help

A rate limit of 100 requests per minute does not prevent an agent from sending 100 emails in that minute. It controls velocity, not authorization. The agent is never asked "should this action proceed?" — it is only told "slow down."

Rate limits are designed for shared infrastructure protection. They are not designed for autonomous agent governance. See [Why Rate Limits Are Not Enough](/concepts/why-rate-limits-are-not-enough-for-autonomous-systems).

## Observability doesn't help

Dashboards and tracing systems record what happened. They can alert after the fact. But by the time a human sees the alert, the agent has already acted. In the email scenario, the 200 messages are sent. In a runaway loop, the budget is already burned.

Observability is essential — but it observes exposure. It does not bound it. See [From Observability to Enforcement](/concepts/from-observability-to-enforcement-how-teams-evolve-from-dashboards-to-budget-authority).

## How reserve-commit bounds exposure

Cycles bounds exposure by requiring agents to **reserve** budget before execution and **commit** the actual cost afterward.

The reservation is the enforcement point. If the budget is exhausted, the reservation is denied, and the action never executes. The maximum possible damage is capped at the reserved amount — not at infinity.

This applies to both financial exposure (USD, tokens) and operational exposure (risk points). A toolset-scoped budget denominated in RISK_POINTS can cap the number of consequential actions an agent takes, regardless of their dollar cost. See [Action Authority](/concepts/action-authority-controlling-what-agents-do).

For practical strategies on sizing reservations and estimating exposure before execution, see [Exposure Estimation](/how-to/how-to-estimate-exposure-before-execution-practical-reservation-strategies-for-cycles).

## Next steps

- [Glossary: Exposure](/glossary#exposure) — formal definition
- [Runaway Agents and Tool Loops](/incidents/runaway-agents-tool-loops-and-budget-overruns-the-incidents-cycles-is-designed-to-prevent) — what unbounded exposure looks like in practice
- [Demos](/demos/) — the runaway agent demo shows a cost runaway stopped at $1.00 by reserve-commit
