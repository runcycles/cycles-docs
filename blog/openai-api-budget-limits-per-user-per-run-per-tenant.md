---
title: "OpenAI API Budget Limits: Per-User and Per-Tenant"
date: 2026-03-18
author: Cycles Team
tags: [openai, budgets, agents, per-user, per-tenant]
description: "Enforce OpenAI API budgets per user, run, and tenant before each instrumented call, with atomic reservations, accurate settlement, and scoped ledgers."
blog: true
sidebar: false
head:
  - - meta
    - name: keywords
      content: OpenAI API budget limits, per-user AI budgets, per-tenant AI budgets, run budgets, atomic reservations, AI cost control
---

# OpenAI API Budget Limits: Per-User and Per-Tenant

> **Part of: [LLM Cost Runtime Control Reference](/guides/llm-cost-runtime-control)** — the full pillar covering causes, enforcement patterns, multi-tenant boundaries, and unit economics.

A team runs 30 OpenAI-powered agents across a shared project. In this constructed scenario, they configure a $5,000 monthly project limit. One customer's research agent enters a retry loop and consumes $1,400 before the project reaches that broader boundary.

The problem is scope, not the existence of a provider control. OpenAI now offers both soft spend alerts and optional hard monthly limits at organization and project scope. A hard limit rejects affected traffic with `429 insufficient_quota` after tracked spend reaches the amount, but enforcement is not instantaneous. Neither an organization nor a shared project limit automatically says "this user gets $20 per day" or "this run may reserve $5."

<!-- more -->

## The Granularity Gap in OpenAI Spending Controls

OpenAI provides monthly spend alerts and optional hard spend limits at organization and project scope, plus an OpenAI-assigned monthly usage limit and configurable model rate limits. These controls are useful provider-side boundaries. They do not automatically model individual users, agent runs, or application [tenants](/glossary#tenant) sharing the same project.

Here is the gap:

- **Organization spend limit** — can alert or reject affected traffic at a monthly organization threshold, but it does not distinguish users or runs inside that organization.
- **Project spend limit** — can provide a hard monthly project boundary, but a shared project may contain thousands of agent runs and does not infer their identities.
- **Usage tiers and model rate limits** — constrain approved monthly usage or request/token throughput, not application spend per user or run.

The common thread is that these controls use OpenAI organization, project, and model identities. Application actors need an explicit mapping or a separate runtime boundary.

| Control | Granularity | Blocks next call? | Prevents runaway agent? |
|---|---|---|---|
| OpenAI spend alert | Organization or project | No; traffic continues | Not by itself |
| OpenAI hard spend limit | Organization or project | Yes, with non-instantaneous enforcement | Only when a run has its own project boundary |
| OpenAI usage/rate limit | Organization/project/model | Yes for the applicable quota | Not a spend budget per run |
| **Application per-user budget** | Individual user | **Yes at the mandatory integration boundary** | **Yes for instrumented calls** |
| **Application per-run budget** | Single agent execution | **Yes at the mandatory integration boundary** | **Yes for instrumented calls** |
| **Application per-tenant budget** | Customer / team | **Yes at the mandatory integration boundary** | **Yes for instrumented calls** |

The bottom three rows require an application identity and enforcement boundary outside OpenAI. A Cycles integration can make a deterministic budget decision on the submitted estimate before each instrumented call. For the general argument about why post-hoc controls fail, see [AI Agent Budget Control: Enforce Hard Spend Limits](/blog/ai-agent-budget-control-enforce-hard-spend-limits). For how this compares to other tools in the stack, see [Cycles vs LLM Proxies and Observability Tools](/blog/cycles-vs-llm-proxies-and-observability-tools).

## Three Budget Patterns for OpenAI Agents

Each pattern maps to a specific failure mode. Pick the one that matches your risk, or combine them.

### Pattern 1: Per-User Daily Budget

**Scope:** `tenant:acme/app:chatbot/agent:{user_id}`

One power user sends 500 messages in a day. Each triggers a GPT-4o call. Without a per-user budget, that single user can consume the entire platform's daily spend. With a per-user budget, the 501st call is denied before OpenAI is contacted.

```python
# Scope fields resolve dynamically from request context
@cycles(
    estimate=estimate_openai_cost(prompt, max_tokens=1024),
    action_kind="llm.completion",
    action_name="gpt-4o",
    agent=current_user.id,       # Per-user enforcement
)
def chat(prompt: str) -> str:
    return openai.chat.completions.create(...)
```

**When to use:** consumer-facing apps, internal tools with many users, any system where usage varies widely across individuals.

### Pattern 2: Per-Run Cap

**Scope:** `tenant:acme/workflow:{run_id}`

An autonomous coding agent loops overnight. It hits an ambiguous error, retries with larger context, spawns sub-agents. By morning: 400 GPT-4o calls, $800. With a per-run cap of $5, the agent is denied after attempt 12 and stops cleanly.

```python
@cycles(
    estimate=estimate_openai_cost(prompt, max_tokens=1024),
    action_kind="llm.completion",
    action_name="gpt-4o",
    workflow=run_id,             # Per-run enforcement
)
def agent_step(prompt: str) -> str:
    return openai.chat.completions.create(...)
```

**When to use:** [autonomous agents](/glossary#autonomous-agent), CI/CD pipelines, overnight batch jobs, any workload where a single execution can spiral.

### Pattern 3: Per-Tenant Monthly Limit

**Scope:** `tenant:{customer_id}`

A SaaS platform shares one OpenAI account across 50 customers. One customer's agents consume $3,000 in a week, exhausting the org budget and degrading service for everyone else. With per-tenant budgets, each customer is isolated — one tenant's runaway cannot starve the others.

```python
@cycles(
    estimate=estimate_openai_cost(prompt, max_tokens=1024),
    action_kind="llm.completion",
    action_name="gpt-4o",
    tenant=customer_id,          # Per-tenant enforcement
)
def handle_request(prompt: str) -> str:
    return openai.chat.completions.create(...)
```

**When to use:** SaaS platforms, multi-tenant products, partner integrations, any system where multiple organizations share infrastructure.

| Pattern | Scope string | What it prevents | Best for |
|---|---|---|---|
| Per-user daily | `tenant:acme/app:chatbot/agent:{user_id}` | One user consuming all budget | Consumer apps, internal tools |
| Per-run cap | `tenant:acme/workflow:{run_id}` | Runaway loops, [retry storms](/glossary#retry-storm) | Autonomous agents, batch jobs |
| Per-tenant monthly | `tenant:{customer_id}` | Noisy-neighbor cascading | SaaS, multi-tenant platforms |

For full implementation recipes with admin API setup, reset schedules, and budget creation, see [Common Budget Patterns](/how-to/common-budget-patterns). For how the scope hierarchy works, see [Understanding Tenants, Scopes, and Budgets](/how-to/understanding-tenants-scopes-and-budgets-in-cycles).

## Why Reserve-Commit Works with OpenAI's Token-Based Billing

OpenAI charges per token, and the challenge is that you do not know the exact output token count before the call. You know your input and configure an output ceiling using the field supported by the chosen API and model, but actual output may be much smaller. A reservation can hold the conservative estimate before the call and return unused capacity at settlement.

The reserve-commit lifecycle solves this:

1. **Estimate** — calculate conservative cost using input token count and the configured output ceiling. This illustrative GPT-4o Chat Completions calculation uses its published list rates; always recheck current or contracted pricing:

```
input_cost  = 2,000 input tokens × 250 microcents  = 500,000
output_cost = 1,024 max output   × 1,000 microcents = 1,024,000
total       = 1,524,000 microcents (~$0.015)
```

2. **Reserve** — lock 1,524,000 microcents from the budget. If insufficient, the [reservation](/glossary#reservation) is denied and OpenAI is never called.

3. **Execute** — make the OpenAI API call. The response comes back with `usage.completion_tokens: 600`.

4. **Commit** — report actual cost:

```
actual = 2,000 × 250 + 600 × 1,000 = 1,100,000 microcents
```

5. **Release** — the 424,000 microcent difference is returned to the budget pool automatically.

The lifecycle is model-agnostic, but pricing, token counting, output fields, cached-input discounts, and reasoning usage vary by model and API. For the pricing table in [USD_MICROCENTS](/glossary#usd-microcents), see [Cost Estimation Cheat Sheet](/how-to/cost-estimation-cheat-sheet). For the production decorator pattern with metrics reporting and caps handling, see [Integrating Cycles with OpenAI](/how-to/integrating-cycles-with-openai). For the protocol mechanics, see [How Reserve/Commit Works](/protocol/how-reserve-commit-works-in-cycles).

## Combining Patterns: The Hierarchical Budget Stack

The three patterns are not mutually exclusive. They compose when the operator explicitly provisions the corresponding ledgers. A single instrumented OpenAI call can then be checked against per-user, per-run, and per-tenant scopes atomically:

```
Tenant: customer-a ($500/month)
  └── App: chatbot
       └── Workflow: run-xyz ($3/run)
            └── Agent: user-123 ($10/day)
```

When the agent calls `@cycles(tenant="customer-a", app="chatbot", workflow="run-xyz", agent="user-123")`, the reservation checks all four scopes atomically. If any scope is exhausted, the call is denied:

- User 123 has burned through their $10 daily limit? Denied — even if the tenant has $400 remaining.
- This run has hit its $3 cap? Denied — even if the user has $8 left today.
- The tenant has reached $500 for the month? Denied — even if the user and run have budget.

Each scope catches a different category of failure. The hierarchy ensures that no single level can override the others. For the full [scope derivation](/glossary#scope-derivation) model, see [Understanding Tenants, Scopes, and Budgets](/how-to/understanding-tenants-scopes-and-budgets-in-cycles). For the multi-tenant deep dive, see [Multi-Tenant AI Cost Control](/blog/multi-tenant-ai-cost-control-per-tenant-budgets-quotas-isolation).

## What Happens When Budget Runs Out

An OpenAI call's budget reservation is rejected — then what? A hard stop is one option, but not the only one.

A non-locking `decide` preflight or dry-run evaluation returns the [three-way decision](/glossary#three-way-decision). A live reservation succeeds with `ALLOW` or configured `ALLOW_WITH_CAPS`, or returns an error such as `409 BUDGET_EXCEEDED`:

| Decision | What it means | What to do |
|---|---|---|
| `ALLOW` | Full budget available | Call OpenAI normally |
| `ALLOW_WITH_CAPS` | The deepest matching budget has configured caps | Apply the caps — e.g., reduce `max_tokens` to `caps.max_tokens` |
| `DENY` | Preflight predicts rejection | Do not submit a live call, or use the result only for shadow analysis |

The `ALLOW_WITH_CAPS` decision can carry a configured generic `caps.max_tokens` value. The host must map it to the correct OpenAI field for the selected surface, such as `max_output_tokens` on Responses or the applicable completion-token field, and validate it against model requirements. The current Cycles server does not introduce or tighten that cap automatically as balance falls.

Beyond caps, four degradation strategies apply to OpenAI workloads:

- **Downgrade** — route to a cheaper model after validating the quality trade-off for the workload. Model prices and availability change, so keep the route table tied to current provider data.
- **Disable** — turn off tool use or retrieval augmentation. The model answers from its own knowledge instead of making additional API calls.
- **Defer** — queue the request for a later budget window. Useful for batch processing and non-urgent tasks.
- **Deny** — stop entirely. The right choice when partial results are worse than no results, or when the action has irreversible consequences.

For the full degradation strategy guide, see [Degradation Paths: Deny, Downgrade, Disable, or Defer](/how-to/how-to-think-about-degradation-paths-in-cycles-deny-downgrade-disable-or-defer). For the protocol reference, see [Caps and the Three-Way Decision Model](/protocol/caps-and-the-three-way-decision-model-in-cycles).

## OpenAI sources

OpenAI control behavior was rechecked on July 24, 2026:

- [Spend limits](https://developers.openai.com/api/docs/guides/spend-limits) — soft alerts, optional hard organization/project limits, `429 insufficient_quota`, and non-instantaneous enforcement
- [Managing projects](https://help.openai.com/en/articles/9186755-managing-projects-in-the-api-platform) — project identities, model access, rate limits, and spend-limit configuration

## Next steps

- **[Integrating Cycles with OpenAI](/how-to/integrating-cycles-with-openai)** — production integration with the `@cycles` decorator, `tiktoken`, and caps handling
- **[Common Budget Patterns](/how-to/common-budget-patterns)** — full recipes for per-user, per-run, per-tenant, and model-tier budgets
- **[Cost Estimation Cheat Sheet](/how-to/cost-estimation-cheat-sheet)** — OpenAI, Anthropic, and Google pricing in USD_MICROCENTS
- **[End-to-End Tutorial](/quickstart/end-to-end-tutorial)** — walk through the reserve-commit lifecycle hands-on
- **[Multi-Tenant AI Cost Control](/blog/multi-tenant-ai-cost-control-per-tenant-budgets-quotas-isolation)** — per-tenant budgets, quotas, and hierarchical isolation for SaaS platforms

## Related how-to guides

- [Multi-tenant SaaS guide](/how-to/multi-tenant-saas-with-cycles)
- [Using the Cycles dashboard](/how-to/using-the-cycles-dashboard)
- [Integrating with Anthropic](/how-to/integrating-cycles-with-anthropic)
