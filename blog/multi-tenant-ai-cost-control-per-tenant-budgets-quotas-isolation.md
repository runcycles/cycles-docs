---
title: "Multi-Tenant AI Cost Control: Budgets and Isolation"
date: 2026-03-16
author: Cycles Team
tags: [multi-tenant, budgets, architecture, costs]
description: "One customer's runaway agent can degrade service for every tenant. Enforce per-tenant budgets, hierarchical limits, and scope-level isolation with Cycles."
blog: true
sidebar: false
head:
  - - meta
    - name: keywords
      content: multi-tenant AI cost control, per-tenant budgets, tenant isolation, hierarchical budgets, AI SaaS budgets, runtime authority
---

# Multi-Tenant AI Cost Control: Budgets and Isolation

> **Part of: [Multi-Tenant AI Operations Reference](/guides/multi-tenant-operations)** — the full pillar covering scope hierarchy, per-tenant enforcement, multi-agent coordination, tenant lifecycle, and identity.

> **Part of: [LLM Cost Runtime Control Reference](/guides/llm-cost-runtime-control)** — the full pillar covering causes, enforcement patterns, multi-tenant boundaries, and unit economics.

Consider a SaaS product with AI-powered document analysis and 50 customers on shared infrastructure. One customer's integration reprocesses the same 200-page PDF 40 times with growing context. Without tenant-scoped enforcement, that [tenant](/glossary#tenant) can consume a disproportionate share of the platform's monthly provider budget; the exact cost depends on model, tokens, and retries.

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

## Where Provider Controls Stop in Multi-Tenant Systems

Major providers offer different controls: OpenAI has soft spend alerts and optional hard monthly organization/project limits, Anthropic uses prepaid credits and usage tiers with workspace reporting, and AWS Bedrock exposes capacity quotas plus separate billing controls. These remain useful outer boundaries.

**No automatic customer mapping.** A $10,000 hard limit on one shared OpenAI project applies to all application tenants using that project. A platform can create separate provider projects, workspaces, or keys where supported, but it must maintain that mapping; the provider does not infer "Tenant A gets $500, Tenant B gets $200."

**No automatic workflow or run identity.** Provider controls operate on vendor identities, billing windows, credits, or quotas. A shared identity does not express a $25 application run or a $100/month feature budget unless the platform creates and enforces that mapping.

**Different timing and fallback semantics.** Alerts are reactive; credit, quota, and hard-limit controls can reject requests. OpenAI documents that hard spend-limit enforcement is not instantaneous, and no provider knows which application-specific fallback is safe.

The structural gap is the application's own customer hierarchy. A multi-tenant platform needs a per-customer boundary in its runtime unless it is willing to mirror every tenant and workflow into provider identities. Cycles supplies shared budget state for caller-submitted tenant and subject scopes; the application must instrument every protected path.

## What Per-Tenant Budget Enforcement Looks Like

Per-tenant enforcement means treating each customer as an independent budget scope with its own ceiling, its own balance tracking, and its own enforcement decisions.

The core behavior is simple:

1. **Each tenant gets a defined budget** — $500/month, 1M [tokens](/glossary#tokens)/day, whatever matches your pricing model
2. **Every protected agent path submits the tenant scope** and reserves before execution
3. **When a tenant's budget is exhausted, that tenant is denied** — their agents stop or degrade
4. **Other tenants are completely unaffected** — their budgets, their [reservations](/glossary#reservation), their agent executions continue normally

This is the [reserve-commit pattern](/blog/ai-agent-budget-control-enforce-hard-spend-limits) applied at the tenant boundary. The reservation is atomic and scoped: Tenant A's reservation draws only from Tenant A's balance. Two tenants cannot race on the same budget, and one tenant's exhaustion does not touch another's.

The enforcement point also becomes the [tenancy boundary](/protocol/authentication-tenancy-and-api-keys-in-cycles). Each API request is authenticated to a specific tenant. The budget system validates that the request's tenant matches the scope, and rejects cross-tenant access. Tenant A cannot commit against Tenant B's reservation. The isolation is structural, not policy-based.

## The Hierarchical Budget Model

Tenant-level budgets solve the isolation problem. But within a tenant, you still need to control which workflows, agents, and individual runs can spend how much. This is where hierarchical scoping comes in.

The [Cycles protocol](/glossary#cycles-protocol) defines a canonical [scope hierarchy](/protocol/how-scope-derivation-works-in-cycles): **tenant → workspace → app → workflow → agent → toolset**. Each populated standard field derives a budget scope. You use the levels that match your product model—most multi-tenant platforms start with tenant and workflow, then add finer-grained scopes as needed. Because `run` is not a standard Subject field, model an enforceable run budget by carrying a unique run identifier in a standard field, such as `workflow: "run-7a3f"`. Custom `dimensions` can carry attribution metadata, but the reference server does not derive budget scopes from them.

```
Tenant: Acme Corp ($2,000/month)
├── Workspace: production
│   ├── App: document-analysis ($800/month)
│   │   ├── Workflow: run-7a3f ($25/run)
│   │   └── Workflow: run-9c1e ($25/run)
│   ├── Workflow: chat-assistant ($500/month)
│   │   └── Agent: assistant ($500/month)
│   └── Workflow: code-review ($400/month)
│       └── Agent: reviewer ($400/month)
└── Workspace: staging ($300/month)
```

When an agent makes a reservation, the system checks every applicable ledger among the scopes derived from the six standard fields. Every configured ledger must have sufficient budget for the reservation to succeed; derived scopes with no ledger are skipped. In the run example, the unique `workflow:run-7a3f` scope supplies the per-run boundary.

This means:

- A run's submitted reservations cannot oversubscribe its $25 ledger even if the tenant ledger has room
- An agent's submitted reservations cannot oversubscribe its ledger even if the workflow ledger has room
- A workflow ledger can bound submitted reservations across its instrumented agents
- A tenant ledger can bound submitted reservations across instrumented descendant paths

Scopes compose naturally. You do not need to implement enforcement at every level on day one. Start with tenant budgets for isolation, then add run-specific standard-field scopes for execution safety, and layer in product-workflow or agent budgets as your model matures. The [modeling guide](/how-to/how-to-model-tenant-workflow-and-run-budgets-in-cycles) covers the trade-offs involved in choosing which standard field carries a run identifier.

## Budgets vs Quotas

Multi-tenant cost control requires two complementary mechanisms: **budgets** and **quotas**. They solve different problems and work together.

| | Budget | Quota |
|--|--------|-------|
| **What it controls** | Total economic exposure (dollars, tokens) | Policy boundaries (counts, rates, access) |
| **How it works** | Real-time balance with reserve-commit | Policy rule checked at request time |
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

Each copilot session runs within a per-session budget nested inside the monthly account budget. The [three-way decision model](/protocol/caps-and-the-three-way-decision-model-in-cycles) can carry operator-configured caps such as lower token limits through `ALLOW_WITH_CAPS`. The application must select and enforce that degradation policy; the current server does not tighten caps automatically as the session balance falls.

**Agent platform with per-run ceilings.** A development tools company offers AI agent pipelines that customers configure and run. Each pipeline execution maps its run ID to a unique workflow ledger: code review at $5/run, deep analysis at $30/run, simple chat at $1/run. A separate tenant ledger constrains aggregate submitted usage. Exact maximum settled spend still depends on mandatory coverage and the configured commit overage policy, so size strict estimates conservatively.

**Enterprise customer with departmental ledgers.** In this illustrative structure, a tenant has a $10,000 monthly ledger and explicit workspace ledgers set to Engineering $5,000, Marketing $2,000, and Support $3,000. Each protected call consumes the matching tenant and workspace ledgers. When Marketing's workspace ledger is exhausted, its next reservation fails while the other workspace ledgers can retain capacity. Operators can adjust allocations through separately authorized [admin API](/how-to/budget-allocation-and-management-in-cycles) mutations; Cycles does not transfer balances automatically.

## Rolling It Out

You do not need the full hierarchy on day one. A practical sequence for multi-tenant platforms:

1. **Start with tenant-level budgets.** This creates budget isolation between customers on mandatory instrumented paths. It does not isolate shared provider rate limits, credentials, data, or compute capacity; use separate controls for those resources.

2. **Add run-level budgets next.** Per-run caps are the best defense against runaway execution — loops, [retry storms](/glossary#retry-storm), and recursive tool calls. They protect both the tenant and the platform from a single bad execution.

3. **Use reporting to refine limits.** Once you have tenant and run budgets, the [balance data](/protocol/querying-balances-in-cycles-understanding-budget-state) tells you how customers actually use the system. Use reservation-vs-commit ratios, rejection rates, and exhaustion events to right-size limits.

4. **Layer in workflow and agent budgets.** As your product matures, add scopes that match your product model — per-workflow caps for different features, per-agent budgets for multi-agent systems, per-workspace budgets for enterprise customers.

5. **Differentiate by plan tier.** Map your pricing model to budget configurations. If you also use an external quota system, keep its plan limits aligned; the current v0.1.25 reference server does not implement the v0.1.26 action-quota preview.

For teams introducing enforcement to an existing system, [shadow mode](/how-to/shadow-mode-in-cycles-how-to-roll-out-budget-enforcement-without-breaking-production) returns what would be denied without blocking. Log those non-persisting responses in the application, alongside actual outcomes, to size budgets before enabling hard enforcement.

## Next steps

- **[How to Model Tenant, Workflow, and Run Budgets](/how-to/how-to-model-tenant-workflow-and-run-budgets-in-cycles)** — detailed guide to designing your scope hierarchy
- **[Scope Derivation](/protocol/how-scope-derivation-works-in-cycles)** — how hierarchical budget paths are built from subject fields
- **[Common Budget Patterns](/how-to/common-budget-patterns)** — practical recipes for per-user, per-conversation, team rollup, and model-tier budgets
- **[Authentication and Tenancy](/protocol/authentication-tenancy-and-api-keys-in-cycles)** — how [tenant isolation](/glossary#tenant-isolation) is enforced at the protocol level
- **[AI Agent Budget Patterns: A Practical Guide](/blog/agent-budget-patterns-visual-guide)** — six common patterns with code examples and trade-offs
- **[AI Agent Budget Control: Enforce Hard Spend Limits](/blog/ai-agent-budget-control-enforce-hard-spend-limits)** — how the reserve-commit pattern works under the hood
- **[AI Agent Cost Management: The Complete Guide](/blog/ai-agent-cost-management-guide)** — the maturity model from no controls to hard enforcement
- **[End-to-End Tutorial](/quickstart/end-to-end-tutorial)** — walk through the full reserve-commit lifecycle hands-on

## Related how-to guides

- [Multi-agent shared budgets](/how-to/multi-agent-shared-workspace-budget-patterns)
- [Integrating with AWS Bedrock](/how-to/integrating-cycles-with-aws-bedrock)
- [Multi-tenant SaaS guide](/how-to/multi-tenant-saas-with-cycles)
