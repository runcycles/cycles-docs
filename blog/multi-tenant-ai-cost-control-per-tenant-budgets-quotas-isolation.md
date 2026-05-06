---
title: "Multi-Tenant AI Cost Control: Budgets and Isolation"
date: 2026-03-16
author: Cycles Team
tags: [multi-tenant, budgets, architecture, costs]
description: "One customer's runaway agent can degrade service for every tenant. Enforce per-tenant budgets, hierarchical limits, and scope-level isolation with Cycles."
blog: true
sidebar: false
---

# Multi-Tenant AI Cost Control: Budgets and Isolation

> **Part of: [Multi-Tenant AI Operations Reference](/guides/multi-tenant-operations)** — the full pillar covering scope hierarchy, per-tenant enforcement, multi-agent coordination, tenant lifecycle, and identity.

> **Part of: [LLM Cost Runtime Control Reference](/guides/llm-cost-runtime-control)** — the full pillar covering causes, enforcement patterns, multi-tenant boundaries, and unit economics.

A platform team runs a SaaS product with AI-powered document analysis. Fifty customers share the same infrastructure. One afternoon, a single customer's integration triggers an agent loop — the same 200-page PDF reprocessed 40 times with increasingly long context windows. In three hours, that one [tenant](/glossary#tenant) consumes $4,200 of the platform's $5,000 monthly provider budget.

The other 49 customers start seeing failures. Model calls return rate-limit errors. Jobs queue indefinitely. The platform's shared spending cap — set at the provider level — does not distinguish between customers. It just shuts everything down when the ceiling is reached.

The incident is not a billing surprise for one account. It is a service outage for every account. In multi-tenant AI systems, cost control is not a finance problem. It is an **isolation problem**.

> **Open the noisy-tenant scenario in the calculator:** [Open with these numbers pre-loaded →](/calculators/claude-vs-gpt-cost-standalone#s=eyJ3b3JrbG9hZE5hbWUiOiJNdWx0aS10ZW5hbnQgU2FhUyDigJQgbm9pc3kgdGVuYW50Iiwid29ya2xvYWREZXNjcmlwdGlvbiI6Ik9uZSB0ZW5hbnQgcnVucyBhdCA1MHggdGhlIGF2ZXJhZ2UgbG9hZC4gU2hhcmVkIGJ1ZGdldDsgdGhlaXIgYnVybiBkcmFpbnMgZXZlcnlvbmUncyBoZWFkcm9vbS4iLCJpbnB1dFRva2VucyI6NDAwMCwib3V0cHV0VG9rZW5zIjoxMDAwLCJjYWxsc1BlckRheSI6NTAwMDB9)

<!-- more -->

## The Multi-Tenant Cost Problem

Single-tenant AI applications have a straightforward cost model: one user, one budget, one blast radius. Multi-tenant systems are fundamentally different. Multiple customers share infrastructure, and the economic boundary between them determines whether a cost incident stays contained or cascades.

Without per-tenant enforcement, the failure modes are predictable:

| Scenario | What happens | Who pays the price |
|----------|-------------|-------------------|
| Tenant A runs an agent loop | Consumes 80% of shared budget in hours | All tenants lose access when cap hits |
| Tenant B launches 50 concurrent agents | Exhausts shared rate limits | Other tenants get throttled or denied |
| Tenant C's workflow retries on transient errors | Accumulates $1,200 in retry costs overnight | Platform operator absorbs the loss |
| Monthly cap triggers mid-cycle | Provider blocks all API calls | Every customer's workflows fail simultaneously |
| Usage spike hits during peak hours | Shared capacity saturated | Latency increases for all tenants |

The common thread: **one tenant's behavior affects every other tenant's experience**. This is the noisy-neighbor problem, applied to AI economics.

It also makes billing and trust harder. When a customer asks "why did my costs spike?" and the answer is "because another customer's agent ran away," you have a credibility problem. Customers need predictable usage envelopes — knowing that their allocation is theirs, regardless of what other tenants do.

## Why Provider-Level Caps Fail in Multi-Tenant Systems

Every major AI provider offers some form of spending limit — OpenAI monthly caps, Anthropic usage tiers, AWS Bedrock service quotas. These controls are designed for single-account governance. They sit at the wrong level of the stack for multi-tenant platforms.

**No per-customer isolation.** A $10,000 monthly cap on your OpenAI organization applies to all tenants combined. There is no mechanism to say "Tenant A gets $500, Tenant B gets $200, Tenant C gets $1,000." The cap is a single number shared by everyone.

**No per-workflow or per-run boundaries.** Provider caps do not know what a "workflow" or "run" is in your system. They cannot limit a single agent execution to $25, or cap a particular feature at $100/month per customer. The granularity stops at the account or project level.

**Reactive, not preventive.** Most provider caps operate on billing cycles. They tell you what happened; they do not block the next model call in real time. By the time the cap triggers, the damage is done — and it affects everyone.

The structural problem is clear: provider caps protect the provider's [exposure](/glossary#exposure) to you, not your exposure to individual customers. For multi-tenant AI platforms, the enforcement boundary must exist **per customer, inside your runtime**. This is the problem [Cycles](/) was built to solve — [runtime authority](/glossary#runtime-authority) as infrastructure, enforced before execution, scoped to each tenant.

## What Per-Tenant Budget Enforcement Looks Like

Per-tenant enforcement means treating each customer as an independent budget scope with its own ceiling, its own balance tracking, and its own enforcement decisions.

The core behavior is simple:

1. **Each tenant gets a defined budget** — $500/month, 1M [tokens](/glossary#tokens)/day, whatever matches your pricing model
2. **Every agent action reserves budget from the tenant's scope** before execution — not from a shared pool
3. **When a tenant's budget is exhausted, that tenant is denied** — their agents stop or degrade
4. **Other tenants are completely unaffected** — their budgets, their [reservations](/glossary#reservation), their agent executions continue normally

This is the [reserve-commit pattern](/blog/ai-agent-budget-control-enforce-hard-spend-limits) applied at the tenant boundary. The reservation is atomic and scoped: Tenant A's reservation draws only from Tenant A's balance. Two tenants cannot race on the same budget, and one tenant's exhaustion does not touch another's.

The enforcement point also becomes the [tenancy boundary](/protocol/authentication-tenancy-and-api-keys-in-cycles). Each API request is authenticated to a specific tenant. The budget system validates that the request's tenant matches the scope, and rejects cross-tenant access. Tenant A cannot commit against Tenant B's reservation. The isolation is structural, not policy-based.

## The Hierarchical Budget Model

Tenant-level budgets solve the isolation problem. But within a tenant, you still need to control which workflows, agents, and individual runs can spend how much. This is where hierarchical scoping comes in.

The [Cycles protocol](/glossary#cycles-protocol) defines a canonical [scope hierarchy](/protocol/how-scope-derivation-works-in-cycles): **tenant → workspace → app → workflow → agent → toolset**. Each level is a budget scope. You use the levels that match your product model — most multi-tenant platforms start with tenant and workflow, then add finer-grained scopes as needed. Run-level budgets can be modeled through the `dimensions` field (e.g., `dimensions: { "run": "run-7a3f" }`), which provides additional metadata for execution-specific tracking. Note that v0 servers may not enforce budgets on dimensions — check your server's implementation for dimension-based enforcement support.

```
Tenant: Acme Corp ($2,000/month)
├── Workspace: production
│   ├── Workflow: document-analysis ($800/month)
│   │   ├── Agent: analyzer ($400/month)
│   │   │   └── dimensions: { run: "run-7a3f" } ($25/run)
│   │   └── Agent: summarizer ($400/month)
│   │       └── dimensions: { run: "run-9c1e" } ($25/run)
│   ├── Workflow: chat-assistant ($500/month)
│   │   └── Agent: assistant ($500/month)
│   │       └── dimensions: { run: "session-4d2b" } ($5/session)
│   └── Workflow: code-review ($400/month)
│       └── dimensions: { run: "run-2e8f" } ($10/run)
└── Workspace: staging ($300/month)
```

When an agent makes a reservation, the system checks budget availability **at every derived scope in the path** — the run dimension, the agent, the workflow, the workspace, and the tenant. All must have sufficient budget for the reservation to succeed. If any scope is exhausted, the request is denied.

This means:

- A single run cannot exceed its $25 ceiling, even if the tenant has $1,500 remaining
- An agent cannot exceed its allocation, even if the workflow has capacity
- A workflow cannot exceed its share of the tenant budget
- The tenant cannot exceed their overall limit, regardless of how budget is distributed internally

Scopes compose naturally. You do not need to implement enforcement at every level on day one. Start with tenant budgets for isolation, then add run-level dimensions for execution safety, then layer in workflow and agent budgets as your product matures. The [modeling guide](/how-to/how-to-model-tenant-workflow-and-run-budgets-in-cycles) covers this progression in detail.

## Budgets vs Quotas

Multi-tenant cost control requires two complementary mechanisms: **budgets** and **quotas**. They solve different problems and work together.

| | Budget | Quota |
|--|--------|-------|
| **What it controls** | Total economic exposure (dollars, tokens) | Policy boundaries (counts, rates, access) |
| **How it works** | Real-time balance with reserve/commit | Policy rule checked at request time |
| **Enforcement** | Atomic — tracks cumulative spend | Stateless or counter-based — tracks occurrences |
| **Example** | "$500/month for this tenant" | "Max 100 agent runs per day" |
| **What it prevents** | Overspend, runaway costs | Abuse, resource hogging, plan enforcement |
| **When it triggers** | When balance is exhausted | When count/rate is exceeded |

**Budgets** answer: "How much economic exposure is this tenant allowed to create?" They are real-time enforceable balances — each reservation decrements the balance atomically, and the balance reflects cumulative spend across all workflows, agents, and runs.

**Quotas** answer: "What are the operational rules for this tenant?" They define the policy envelope: maximum concurrent agents, maximum runs per day, maximum tokens per request, which models are available on this plan tier. Quotas are simpler — they typically check a counter or a policy rule, not a running financial balance.

In practice, you need both. A tenant might have a $1,000/month budget _and_ a quota of 500 runs per day. The budget prevents total overspend. The quota prevents a burst pattern that could exhaust the monthly budget in a single day of heavy use. Together, they define a predictable usage envelope that serves both the operator's margins and the customer's expectations.

## What You Get Operationally

Per-tenant budget enforcement, combined with quotas, delivers concrete operational benefits:

- **Fairness**: No tenant can degrade another tenant's experience. Each customer gets their allocation regardless of what others do.
- **Predictable margins**: You know the maximum cost exposure per customer before the month starts. No surprise overages that eat your margins.
- **Incident containment**: A runaway agent in Tenant A's environment is Tenant A's problem, not a platform-wide outage. Other tenants continue operating normally.
- **Customer-specific billing**: Budget tracking per tenant gives you the data for accurate usage-based invoicing — not estimates derived from a shared pool.
- **Tier-based differentiation**: Free tier gets $10/month and 50 runs/day. Pro gets $500/month and 1,000 runs/day. Enterprise gets custom limits. The enforcement system implements your pricing model directly.
- **Auditable enforcement**: Every reservation, commit, and denial is logged per tenant. When a customer asks "why was my agent stopped?", you have a precise answer.

## Design Examples

**SaaS copilot with per-account monthly limits.** Each customer account gets a monthly budget tied to their subscription tier:

| Tier | Monthly budget | Per-session cap | On session exhaustion | On monthly exhaustion |
|------|---------------|----------------|----------------------|----------------------|
| Starter | $50 | $2 | Degrade to shorter responses | Usage notice + upgrade prompt |
| Pro | $500 | $10 | Degrade to cheaper model | Usage notice + overage option |
| Enterprise | Custom | $25 | Degrade to cached results | Admin notification |

Each copilot session runs within a per-session budget nested inside the monthly account budget. The [three-way decision model](/protocol/caps-and-the-three-way-decision-model-in-cycles) (ALLOW, ALLOW_WITH_CAPS, DENY) drives the degradation: as session budget runs low, the system returns ALLOW_WITH_CAPS to reduce token limits before hard-denying.

**Agent platform with per-run ceilings.** A development tools company offers AI agent pipelines that customers configure and run. Each pipeline execution gets a per-run budget based on the pipeline type: code review at $5/run, deep analysis at $30/run, simple chat at $1/run. The tenant's monthly budget caps total spend across all runs. A customer running 200 code reviews in a month spends up to $1,000 — and no more, even if their agents loop.

**Enterprise customer with departmental sub-budgets.** A large enterprise tenant gets $10,000/month. Their IT team allocates sub-budgets by workspace: Engineering gets $5,000, Marketing gets $2,000, Support gets $3,000. Each department's agents draw from their own workspace scope. When Marketing's budget is exhausted mid-month, Engineering and Support are unaffected. The enterprise admin can reallocate budget between workspaces via the [admin API](/how-to/budget-allocation-and-management-in-cycles) without involving the platform operator.

## Rolling It Out

You do not need the full hierarchy on day one. The proven path for multi-tenant platforms:

1. **Start with tenant-level budgets.** This is the highest-leverage change — it creates isolation between customers. Every customer gets a defined ceiling. One tenant's behavior can no longer affect others. Start here even if the limits are generous.

2. **Add run-level budgets next.** Per-run caps are the best defense against runaway execution — loops, [retry storms](/glossary#retry-storm), and recursive tool calls. They protect both the tenant and the platform from a single bad execution.

3. **Use reporting to refine limits.** Once you have tenant and run budgets, the [balance data](/protocol/querying-balances-in-cycles-understanding-budget-state) tells you how customers actually use the system. Use reservation-vs-commit ratios, rejection rates, and exhaustion events to right-size limits.

4. **Layer in workflow and agent budgets.** As your product matures, add scopes that match your product model — per-workflow caps for different features, per-agent budgets for multi-agent systems, per-workspace budgets for enterprise customers.

5. **Differentiate by plan tier.** Map your pricing model directly to budget and quota configurations. Free, Pro, and Enterprise plans get different limits enforced at the same infrastructure layer.

For teams introducing enforcement to an existing system, [shadow mode](/how-to/shadow-mode-in-cycles-how-to-roll-out-budget-enforcement-without-breaking-production) lets you log what would be denied without actually blocking anything — giving you real data to size budgets before flipping to hard enforcement.

## Next steps

- **[How to Model Tenant, Workflow, and Run Budgets](/how-to/how-to-model-tenant-workflow-and-run-budgets-in-cycles)** — detailed guide to designing your scope hierarchy
- **[Scope Derivation](/protocol/how-scope-derivation-works-in-cycles)** — how hierarchical budget paths are built from subject fields
- **[Common Budget Patterns](/how-to/common-budget-patterns)** — practical recipes for per-user, per-conversation, team rollup, and model-tier budgets
- **[Authentication and Tenancy](/protocol/authentication-tenancy-and-api-keys-in-cycles)** — how [tenant isolation](/glossary#tenant-isolation) is enforced at the protocol level
- **[AI Agent Budget Patterns: A Practical Guide](/blog/agent-budget-patterns-visual-guide)** — six common patterns with code examples and trade-offs
- **[AI Agent Budget Control: Enforce Hard Spend Limits](/blog/ai-agent-budget-control-enforce-hard-spend-limits)** — how the reserve-commit pattern works under the hood
- **[AI Agent Cost Management: The Complete Guide](/blog/ai-agent-cost-management-guide)** — the maturity model from no controls to hard enforcement
- **[End-to-End Tutorial](/quickstart/end-to-end-tutorial)** — walk through the full reserve-commit lifecycle hands-on
