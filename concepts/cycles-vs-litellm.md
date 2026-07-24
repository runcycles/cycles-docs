---
title: "Cycles vs LiteLLM: Budget Authority vs Proxy Budgets"
description: "LiteLLM routes model traffic and supports gateway budgets. Cycles meters caller-submitted work across application scopes. See how the layers fit together."
---

# Cycles vs LiteLLM: Budget Authority vs Proxy Budgets

LiteLLM is one of the most popular LLM proxy layers. It routes model calls across providers with automatic fallback, and as of 2025-2026 has added team budgets, per-key spend limits, and rate limiting. If you're already running LiteLLM, you might wonder whether you need Cycles at all.

The answer depends on what failure modes you're trying to prevent.

> **Run the numbers for your workload:** [Cost Calculator →](/calculators/claude-vs-gpt-cost-standalone) — LiteLLM proxies calls to providers; the calculator shows what total spend looks like when no per-call cap fires upstream.

## What each does

| | LiteLLM | Cycles |
|---|---|---|
| **Primary role** | LLM proxy — routing, fallback, cost tracking | Runtime authority — pre-execution enforcement |
| **When it acts** | At the model-call layer | At any application boundary the caller instruments |
| **Budget model** | Per-key, per-team, per-user, per-customer, per-model spend limits | Standard tenant → workspace → app → workflow → agent → toolset ledgers; a workflow value can be unique per run |
| **Enforcement** | Block when `max_budget` exceeded | Atomic reserve-commit — budget locked before action |
| **Rate limiting** | RPM, TPM per key/team/user | Not a rate limiter — enforces configured cumulative budgets |
| **Action control** | Model access lists (which models a key can call) | Caller-assigned [RISK_POINTS](/glossary#risk-points) budget; host authorizes tools |
| **Multi-tenant** | Team/user isolation via `team_id` | Tenant-scoped API keys with hierarchical budget derivation |
| **Concurrency model** | Gateway spend counters and budget checks | Atomic estimate reservation before protected work |

## Where LiteLLM's budgets work well

LiteLLM's budget features are genuinely useful:

- **`max_budget` per key** blocks requests when a key's cumulative spend exceeds the cap
- **`soft_budget`** triggers alerts before the hard cutoff, giving teams time to respond
- **`budget_duration`** auto-resets budgets on configurable intervals
- **Per-team budgets** aggregate spend across all keys in a team
- **Webhook alerts** fire on `budget_crossed`, `threshold_crossed`, and `projected_limit_exceeded`

For teams that need basic cost control at the LLM proxy layer, this covers the common case well.

## Where the gaps appear

### 1. Different accounting boundaries

LiteLLM can block inference requests against configured key, team, user, customer, and project budgets. Those are gateway spend controls and should be used when they match the workload.

Cycles uses a different accounting primitive: it atomically reserves a caller estimate before protected work begins, then commits the actual amount. This prevents concurrent requests from all relying on the same unreserved capacity. Actual usage can still exceed the estimate; the configured commit-overage policy determines whether the overage is rejected, charged from remaining capacity, or recorded as debt.

### 2. Action-level control

LiteLLM controls which **models** a key can access. It cannot control what **actions** an agent takes with those models.

An application can assign higher [RISK_POINTS](/how-to/assigning-risk-points-to-agent-tools) estimates to higher-blast-radius tool attempts and require a Cycles reservation before invoking them. That bounds submitted cumulative exposure. Cycles does not decide whether the tool or its arguments are authorized; the host must enforce that separately.

### 3. Scope hierarchy and delegation

LiteLLM supports budgets across multiple proxy-layer scopes: keys, teams, internal users, end users/customers, and model/provider/tag dimensions. This is meaningful coverage for proxy-level cost governance.

However, these are proxy-layer spend-tracking scopes, not the same application hierarchy. Cycles derives tenant → workspace → app → workflow → agent → toolset scopes, where explicitly provisioned ledgers can impose overlapping ceilings. A child call can consume both a shared ancestor ledger and a narrower agent ledger. Cycles does not transfer a parent allocation to the child; action masks and delegation-depth limits remain orchestration logic.

The difference matters in multi-agent systems where a single user request fans out into dozens of sub-agent calls. LiteLLM sees the gateway identity and metadata on each inference request. Cycles evaluates the tenant and subject scopes the host submits; it does not discover a delegation chain automatically.

### 4. Reserve-commit lifecycle

LiteLLM checks configured gateway budgets before routing and records actual inference cost. Cycles adds an explicit caller-estimated hold before work, including for non-LLM operations.

Cycles [reserves budget before the action](/blog/what-is-runtime-authority-for-ai-agents) based on an estimate, executes only if approved, and commits the actual cost after. The unused difference is released. The budget cannot be silently drained by concurrent requests. If actual cost exceeds the estimate, the overage is tracked as debt and surfaced via webhook events — not silently absorbed.

## Better together: LiteLLM + Cycles

LiteLLM and Cycles solve different problems at different layers. Running both gives you capabilities neither provides alone:

```
Request flow:
  Agent decides to act
    → Cycles: "Should this action happen?" (reserve-commit, RISK_POINTS)
    → LiteLLM: "Which model should handle this?" (routing, fallback)
    → Provider: Execute the call
    → LiteLLM: Record cost, check key budget
    → Cycles: Commit actual cost, release unused reservation
```

**What this stack gives you:**

| Capability | Who provides it |
|---|---|
| Model routing and provider fallback | LiteLLM |
| RPM/TPM rate limiting | LiteLLM |
| Pre-execution budget authority | Cycles |
| Action-level RISK_POINTS control | Cycles |
| Team-level cost visibility | LiteLLM |
| Atomic per-action budget enforcement | Cycles |
| Model access restrictions (which models) | LiteLLM |
| Tool access restrictions (which actions) | Application/harness; Cycles can return configured allow/deny cap fields |
| Delegation attenuation for sub-agents | Cycles (pattern via hierarchical scopes) |
| Provider failover and retry | LiteLLM |

**Concrete integration scenario:** The deepest matching Cycles budget is configured with a model cap, so the agent receives `ALLOW_WITH_CAPS`. Your application maps that cap to a cheaper LiteLLM route (for example, GPT-4o-mini instead of GPT-4o). Cycles returns the configured constraint; LiteLLM executes the downgrade. The current Cycles server does not select a model or add caps automatically when balance is low.

LiteLLM is the **routing and model-access layer**. Cycles is the **authority and enforcement layer**. They're complementary by design.

## What Cycles does not do

Cycles is not a proxy, router, or model-access layer. It doesn't handle provider failover, model selection, or RPM/TPM rate limiting. If you need those (and most production stacks do), you need LiteLLM or a comparable tool alongside Cycles. LiteLLM is also open-source and self-hostable with a large community — a significant advantage for teams that want full control and auditability at the proxy layer. The reserve-commit lifecycle adds [~15ms latency per action](/blog/cycles-server-performance-benchmarks) (p50) — negligible against multi-second LLM calls, but present.

## When LiteLLM alone is enough

- Single-tenant, single-agent prototype
- No action-level risk (agent only reads, never writes/sends/deploys)
- Proxy identities and spend limits match the required budget boundaries
- All governed cost flows through the LiteLLM gateway

## When you need Cycles

- Multiple concurrent agents sharing a budget
- Agent tools with side effects (email, deploy, database mutation)
- Multi-tenant SaaS with per-customer budget isolation
- Multi-agent delegation chains requiring authority attenuation
- You need an explicit atomic estimate hold before concurrent work starts

## Sources

Feature claims verified against [LiteLLM's current gateway documentation](https://docs.litellm.ai/) on July 24, 2026. Cycles claims are based on v0.1.25. These tools evolve quickly—check the linked docs for the latest.

## Related

- [Cycles vs LLM Proxies and Observability Tools](/blog/cycles-vs-llm-proxies-and-observability-tools) — broader comparison
- [What Is Runtime Authority](/blog/what-is-runtime-authority-for-ai-agents) — the enforcement model
- [How Teams Control AI Agents Today](/blog/how-teams-control-ai-agents-today-and-where-it-breaks) — why proxy-layer controls break
