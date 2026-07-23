---
title: "Action Authority: Controlling What Agents Do"
description: "Model action exposure with caller-assigned risk-point budgets, then combine Cycles reservations with application authorization at the tool boundary."
---

# Action Authority: Controlling What Agents Do

Budget authority controls how much an agent spends. Action authority controls what it does.

Both are dimensions of [runtime authority](/blog/what-is-runtime-authority-for-ai-agents) — the pre-execution control layer that decides whether an agent's next action should proceed. Budget authority caps financial exposure. Action authority caps operational exposure: emails sent, deploys triggered, records modified, files deleted.

## Why cost budgets are not enough

A support agent that sends 200 customer emails costs $1.40 in model tokens. A per-run budget of $100, $50, even $5 would not have stopped a single email. The risk was not monetary — it was reputational, operational, and commercial.

Dollar budgets are the wrong unit for action authority. The problem is not "the agent spent too much." The problem is "the agent did something it should not have done."

## RISK_POINTS — budgeting what money cannot measure

Cycles supports a **RISK_POINTS** unit for caller-assigned action exposure. Instead of denominating budgets in dollars or tokens, the application assigns point values to action classes based on blast radius:

| Action | Risk points | Rationale |
|--------|------------|-----------|
| Read CRM record | 0 | No side effects |
| Add internal note | 1 | Low blast radius, reversible |
| Send customer email | 50 | High blast radius, irreversible |
| Trigger deployment | 100 | Production impact |

A workflow can get a fixed risk-point budget. Every consequential action routed through the mandatory reservation boundary deducts from it. When that budget is exhausted, the boundary rejects another metered action. Application authorization still decides which tools and arguments are permitted.

## Toolset-scoped budgets

Caller-assigned exposure budgets can use **toolset-scoped budgets** — separate budgets for different categories of tools within the same agent run:

- **Internal tools** (CRM reads, note-taking) get a generous risk-point budget
- **External tools** (customer email, deploy) get a restrictive one

The agent can exhaust its email budget while an independent internal-tool budget remains available. The host decides whether to continue with read-only work. A live reservation succeeds with `ALLOW` or configured `ALLOW_WITH_CAPS`, or returns an error when budget is unavailable.

## Graceful degradation, not hard stops

Action authority does not require killing the agent. An application can select progressively stricter configured policies:

- **Normal phase**: Full tool access after application authorization
- **Restricted phase**: High-blast-radius actions disabled
- **Read-only phase**: Search and summarize only
- **Insufficient risk budget**: No further metered action in that scope

The current server does not switch these phases or tighten caps automatically as risk points are consumed. The application selects the policy or scope and enforces the returned tool-list caps.

This is the "disable" degradation strategy applied to action authority rather than cost control. See [Degradation Paths](/how-to/how-to-think-about-degradation-paths-in-cycles-deny-downgrade-disable-or-defer).

## Next steps

- [Glossary: Action Authority](/glossary#action-authority) — formal definition
- [AI Agent Action Control: Hard Limits on Side Effects](/blog/ai-agent-action-control-hard-limits-side-effects) — deep dive on the problem and solution
- [Runaway Agent Demo](/demos/) — a budget-bound loop demonstrating the same reservation boundary; it is not an application-permission demo
- [Exposure](/concepts/exposure-why-rate-limits-leave-agents-unbounded) — the broader concept of unbounded agent risk
