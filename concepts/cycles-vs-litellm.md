---
title: "Cycles vs LiteLLM: Budget Authority vs Proxy Budgets"
description: "LiteLLM routes and rate-limits. Cycles enforces budget authority and action control. See where each fits, where they overlap, and how they work together."
---

# Cycles vs LiteLLM: Budget Authority vs Proxy Budgets

LiteLLM is one of the most popular LLM proxy layers. It routes model calls across providers with automatic fallback, and as of 2025-2026 has added team budgets, per-key spend limits, and rate limiting. If you're already running LiteLLM, you might wonder whether you need Cycles at all.

The answer depends on what failure modes you're trying to prevent.

> **Run the numbers for your workload:** [Cost Calculator →](/calculators/claude-vs-gpt-cost-standalone) — LiteLLM proxies calls to providers; the calculator shows what total spend looks like when no per-call cap fires upstream.

## What each does

| | LiteLLM | Cycles |
|---|---|---|
| **Primary role** | LLM proxy — routing, fallback, cost tracking | Runtime authority — pre-execution enforcement |
| **When it acts** | At the model-call layer | At the agent-action layer |
| **Budget model** | Per-key, per-team, per-user, per-customer, per-model spend limits | Per-tenant, per-workflow, per-run, per-action hierarchical scope derivation |
| **Enforcement** | Block when `max_budget` exceeded | Atomic reserve-commit — budget locked before action |
| **Rate limiting** | RPM, TPM per key/team/user | Not a rate limiter — enforces per-action authority |
| **Action control** | Model access lists (which models a key can call) | [RISK_POINTS](/glossary#risk-points) — per-tool risk scoring and limits |
| **Multi-tenant** | Team/user isolation via `team_id` | Tenant-scoped API keys with hierarchical budget derivation |
| **Concurrency safety** | Eventually consistent (~10 request drift at high traffic) | Atomic Lua-scripted reservations (zero TOCTOU drift) |

## Where LiteLLM's budgets work well

LiteLLM's budget features are genuinely useful:

- **`max_budget` per key** blocks requests when a key's cumulative spend exceeds the cap
- **`soft_budget`** triggers alerts before the hard cutoff, giving teams time to respond
- **`budget_duration`** auto-resets budgets on configurable intervals
- **Per-team budgets** aggregate spend across all keys in a team
- **Webhook alerts** fire on `budget_crossed`, `threshold_crossed`, and `projected_limit_exceeded`

For teams that need basic cost control at the LLM proxy layer, this covers the common case well.

## Where the gaps appear

### 1. Concurrency safety

LiteLLM tracks spend via an in-memory cache synced to Redis every ~10ms. Under high concurrency, budget enforcement is eventually consistent — their docs note approximately 10 requests of drift at 100 RPS across 3 instances.

For a single-agent prototype, this is fine. For concurrent agents sharing a budget, 10 requests of drift means 10 unaccounted charges — the overrun depends on per-request cost ($0.50-$5 at the high end for expensive models). On a small budget, this can be significant. This is the [TOCTOU race condition](/blog/we-built-a-custom-agent-rate-limiter-heres-why-we-stopped) that atomic reservation systems are designed to prevent.

Cycles uses atomic Lua-scripted reservations: the budget check and the decrement happen in a single Redis operation. Zero TOCTOU drift, regardless of concurrency. (Overages can still occur when actual cost exceeds the estimate — these are tracked as debt and surfaced immediately, not silently absorbed.)

### 2. Action-level control

LiteLLM controls which **models** a key can access. It cannot control what **actions** an agent takes with those models.

An agent that sends 200 emails costs $1.40 in tokens. LiteLLM's budget wouldn't fire — the cost is trivial. But the action is catastrophic. Cycles' [RISK_POINTS](/how-to/assigning-risk-points-to-agent-tools) budget scores tools by blast radius (email = 40 points, deploy = 150 points, search = 0), limiting *what* the agent does, not just *how much it spends*.

### 3. Scope hierarchy and delegation

LiteLLM supports budgets across multiple proxy-layer scopes: keys, teams, internal users, end users/customers, and model/provider/tag dimensions. This is meaningful coverage for proxy-level cost governance.

However, these are proxy-layer spend-tracking scopes, not runtime authority scopes. Cycles supports hierarchical scope derivation (tenant → workspace → app → workflow → agent → toolset) where each level can have its own persistent cumulative budget and [authority attenuates](/blog/agent-delegation-chains-authority-attenuation-not-trust-propagation) at each delegation hop — a sub-agent always gets less authority than its parent.

The difference matters in multi-agent systems where a single user request fans out into dozens of sub-agent calls. LiteLLM sees each call as an independent model request at the proxy layer. Cycles sees the delegation chain and enforces aggregate limits across the full scope hierarchy.

### 4. Reserve-commit lifecycle

LiteLLM tracks spend after the fact — the cost is recorded when the model response arrives. If the response is expensive (long output, many tokens), the budget is already spent before LiteLLM knows the cost.

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
| Tool access restrictions (which actions) | Cycles |
| Delegation attenuation for sub-agents | Cycles |
| Provider failover and retry | LiteLLM |

**Concrete integration scenario:** Your agent gets ALLOW_WITH_CAPS from Cycles (budget is low). The caps include a model downgrade hint. Your application passes that hint to LiteLLM, which routes to a cheaper model (GPT-4o-mini instead of GPT-4o). The agent completes the task at lower cost, and both systems record the outcome. Neither tool alone enables this graceful degradation pattern — Cycles decides the constraint, LiteLLM executes the downgrade.

LiteLLM is the **routing and model-access layer**. Cycles is the **authority and enforcement layer**. They're complementary by design.

## What Cycles does not do

Cycles is not a proxy, router, or model-access layer. It doesn't handle provider failover, model selection, or RPM/TPM rate limiting. If you need those (and most production stacks do), you need LiteLLM or a comparable tool alongside Cycles. LiteLLM is also open-source and self-hostable with a large community — a significant advantage for teams that want full control and auditability at the proxy layer. The reserve-commit lifecycle adds [~15ms latency per action](/blog/cycles-server-performance-benchmarks) (p50) — negligible against multi-second LLM calls, but present.

## When LiteLLM alone is enough

- Single-tenant, single-agent prototype
- No concurrent agents sharing budgets
- No action-level risk (agent only reads, never writes/sends/deploys)
- Budget overruns of ~10 requests are acceptable
- No delegation chains or multi-agent systems

## When you need Cycles

- Multiple concurrent agents sharing a budget
- Agent tools with side effects (email, deploy, database mutation)
- Multi-tenant SaaS with per-customer budget isolation
- Multi-agent delegation chains requiring authority attenuation
- Zero-tolerance for budget overruns (financial, compliance)

## Sources

Feature claims verified against [docs.litellm.ai](https://docs.litellm.ai/docs/proxy/users) as of April 2026. Cycles claims based on v0.1.25. These tools evolve quickly — check the linked docs for the latest.

## Related

- [Cycles vs LLM Proxies and Observability Tools](/blog/cycles-vs-llm-proxies-and-observability-tools) — broader comparison
- [What Is Runtime Authority](/blog/what-is-runtime-authority-for-ai-agents) — the enforcement model
- [How Teams Control AI Agents Today](/blog/how-teams-control-ai-agents-today-and-where-it-breaks) — why proxy-layer controls break
