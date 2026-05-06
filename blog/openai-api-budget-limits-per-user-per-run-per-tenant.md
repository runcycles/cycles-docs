---
title: "OpenAI API Budget Limits: Per-User and Per-Tenant"
date: 2026-03-18
author: Cycles Team
tags: [openai, budgets, agents, per-user, per-tenant]
description: "OpenAI org-level spending caps are too coarse for agents. Enforce per-user, per-run, and per-tenant limits before every API call."
blog: true
sidebar: false
---

# OpenAI API Budget Limits: Per-User and Per-Tenant

> **Part of: [LLM Cost Runtime Control Reference](/guides/llm-cost-runtime-control)** — the full pillar covering causes, enforcement patterns, multi-tenant boundaries, and unit economics.

A team runs 30 OpenAI-powered agents across their platform. They set a $5,000/month spending cap in the OpenAI dashboard. On Thursday, one customer's research agent enters a retry loop — expanding its context window on each attempt, calling GPT-4o 200+ times in under an hour. The bill: $1,400 for a single agent run.

The org-level cap? Still at 60%. It does not trigger. The problem is not that the cap was wrong. The problem is that it applies to the entire organization. There is no way to say "this user gets $20 per day" or "this run cannot exceed $5" through OpenAI's billing controls alone.

<!-- more -->

## The Granularity Gap in OpenAI Spending Controls

OpenAI provides three levels of spending controls: organization monthly caps, project-level budgets, and usage tier limits. These are designed to protect OpenAI's billing relationship with you. They are not designed to protect you from individual users, individual agent runs, or individual [tenants](/glossary#tenant) running up the bill.

Here is the gap:

- **Org monthly cap** — one number for everything. If you need 200 users each limited to $10/day, there is no way to express that. The cap fires when the org-wide total crosses the threshold, not when any individual crosses theirs.
- **Project budgets** — closer to useful, but project boundaries do not map to user boundaries or run boundaries. A project can contain thousands of agent runs, and the budget does not distinguish between them.
- **Usage tiers** — rate-limiting mechanisms tied to your account's trust level. They throttle requests per minute, not spend per user or per run.

The common thread: these controls protect OpenAI's [exposure](/glossary#exposure) to you. They do not protect your exposure to individual actors within your system.

| Control | Granularity | Blocks next call? | Prevents runaway agent? |
|---|---|---|---|
| OpenAI org monthly cap | Entire organization | No (billing-cycle reactive) | No |
| OpenAI project budget | Per project | Partially (delayed enforcement) | Not per-run |
| OpenAI usage tier | Account level | No (soft rate limit) | No |
| **Per-user daily budget** | Individual user | **Yes (pre-execution)** | **Yes** |
| **Per-run cap** | Single agent execution | **Yes (pre-execution)** | **Yes** |
| **Per-tenant monthly limit** | Customer / team | **Yes (pre-execution)** | **Yes** |

The bottom three rows require enforcement outside of OpenAI — a [runtime authority](/glossary#runtime-authority) that sits between your application and the API, making a deterministic allow/deny decision before every call. For the general argument about why post-hoc controls fail, see [AI Agent Budget Control: Enforce Hard Spend Limits](/blog/ai-agent-budget-control-enforce-hard-spend-limits). For how this compares to other tools in the stack, see [Cycles vs LLM Proxies and Observability Tools](/blog/cycles-vs-llm-proxies-and-observability-tools).

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

OpenAI charges per token, and the challenge is that you do not know the exact output token count before the call. You know your input. You set `max_tokens` for the output ceiling. But the actual output could be 50 [tokens](/glossary#tokens) or 4,000 tokens. You need to reserve budget before the call — and you need to not permanently lose the difference.

The reserve-commit lifecycle solves this:

1. **Estimate** — calculate worst-case cost using input token count and `max_tokens`:

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

This pattern works for every OpenAI model — GPT-4o, GPT-4o-mini, o3, o3-mini, GPT-4.1, GPT-4.1-mini, GPT-4.1-nano — because the lifecycle is model-agnostic. Only the pricing constants change. For the full pricing table in [USD_MICROCENTS](/glossary#usd-microcents), see [Cost Estimation Cheat Sheet](/how-to/cost-estimation-cheat-sheet). For the production decorator pattern with `tiktoken`, metrics reporting, and caps handling, see [Integrating Cycles with OpenAI](/how-to/integrating-cycles-with-openai). For the protocol-level mechanics, see [How Reserve/Commit Works](/protocol/how-reserve-commit-works-in-cycles).

## Combining Patterns: The Hierarchical Budget Stack

The three patterns are not mutually exclusive. They compose. A single OpenAI API call can be checked against per-user, per-run, and per-tenant budgets simultaneously, because the scope hierarchy enforces at every level:

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

An OpenAI call gets denied — then what? A hard stop is one option, but not the only one.

Cycles returns a [three-way decision](/glossary#three-way-decision), not a binary allow/deny:

| Decision | What it means | What to do |
|---|---|---|
| `ALLOW` | Full budget available | Call OpenAI normally |
| `ALLOW_WITH_CAPS` | Budget is getting tight | Respect the caps — e.g., reduce `max_tokens` to the value in `caps.max_tokens` |
| `DENY` | Budget exhausted | Do not call OpenAI — degrade, defer, or inform the user |

The `ALLOW_WITH_CAPS` decision is particularly useful for OpenAI integrations. When the runtime authority returns `caps.max_tokens: 500`, the agent passes that directly to OpenAI's `max_tokens` parameter. The model generates a shorter response — still useful, but cheaper. The user gets an answer instead of an error.

Beyond caps, four degradation strategies apply to OpenAI workloads:

- **Downgrade** — switch from GPT-4o ($10/M output) to GPT-4o-mini ($0.60/M output). A 16x cost reduction with a quality trade-off the user may not even notice for many tasks.
- **Disable** — turn off tool use or retrieval augmentation. The model answers from its own knowledge instead of making additional API calls.
- **Defer** — queue the request for a later budget window. Useful for batch processing and non-urgent tasks.
- **Deny** — stop entirely. The right choice when partial results are worse than no results, or when the action has irreversible consequences.

For the full degradation strategy guide, see [Degradation Paths: Deny, Downgrade, Disable, or Defer](/how-to/how-to-think-about-degradation-paths-in-cycles-deny-downgrade-disable-or-defer). For the protocol reference, see [Caps and the Three-Way Decision Model](/protocol/caps-and-the-three-way-decision-model-in-cycles).

## Next steps

- **[Integrating Cycles with OpenAI](/how-to/integrating-cycles-with-openai)** — production integration with the `@cycles` decorator, `tiktoken`, and caps handling
- **[Common Budget Patterns](/how-to/common-budget-patterns)** — full recipes for per-user, per-run, per-tenant, and model-tier budgets
- **[Cost Estimation Cheat Sheet](/how-to/cost-estimation-cheat-sheet)** — OpenAI, Anthropic, and Google pricing in USD_MICROCENTS
- **[End-to-End Tutorial](/quickstart/end-to-end-tutorial)** — walk through the reserve-commit lifecycle hands-on
- **[Multi-Tenant AI Cost Control](/blog/multi-tenant-ai-cost-control-per-tenant-budgets-quotas-isolation)** — per-tenant budgets, quotas, and hierarchical isolation for SaaS platforms
