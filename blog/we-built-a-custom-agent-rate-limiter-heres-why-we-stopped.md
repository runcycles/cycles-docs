---
title: "We Built a Custom Agent Rate Limiter. Here's Why We Stopped."
date: 2026-04-05
author: Albert Mavashev
tags: [engineering, production, costs, agents, best-practices, budgets, runtime-authority, architecture]
description: "A post-mortem of the multi-provider AI agent rate limiter we built at scalerX — three versions, three walls, and why runtime authority is the real problem."
blog: true
sidebar: false
featured: false
---

# We Built a Custom Agent Rate Limiter. Here's Why We Stopped.

At [scalerX](https://scalerx.ai), we built a custom rate limiter to track spend across LLMs, image generation, video generation, and a growing list of paid third-party APIs — stock charts, market data, web search. We built three versions of it over several months. Each version fixed the problem the previous one had. Each version revealed a new problem we hadn't anticipated.

By the time we were planning v4, the realization was hard to avoid: **we weren't building a rate limiter anymore. We were building a [runtime authority](/glossary#runtime-authority) platform, badly.**

This is a post-mortem of why that happened, and why I think most teams building custom multi-provider rate limiters are on the same trajectory.

<!-- more -->

## Why Build It Ourselves

The reasoning at the time was unremarkable:

- Our agents called **many paid providers** — OpenAI, Stable Diffusion, Kling, Google, stock data APIs, web search. No off-the-shelf proxy covered all of them.
- Existing LLM proxies (LiteLLM, Helicone) solved the LLM layer, not the tool-call layer. They wouldn't see the $2 stock chart API call or the $0.30 web search.
- We needed per-user caps — a single customer's runaway agent shouldn't consume another customer's budget.
- "It's just Redis and some counters. How hard could it be?"

We started with a straightforward design, hit a wall, rebuilt, hit another wall, rebuilt again. Here's the story of each wall.

## v1: The Naive Counter — TOCTOU Race Conditions

**Architecture:** Redis hash per user, incremented on each API call. Check before the call, increment after.

```python
# simplified
def check_budget(user_id, cost):
    current = redis.get(f"spend:{user_id}")
    if current + cost > user_budget:
        raise BudgetExceeded()
    return True

def record_spend(user_id, cost):
    redis.incrby(f"spend:{user_id}", cost)
```

This worked in development. It worked in the first few weeks of production. Then we started seeing users exceed their monthly caps by 10-30%.

**The wall: time-of-check-to-time-of-use (TOCTOU) race conditions.**

When a user had 10 concurrent agents running, all 10 could read *"budget has $5 remaining"*, all 10 could decide to proceed, and all 10 could execute — spending $50 against a $5 budget. The check and the increment were two separate Redis operations, and the check was non-binding.

We weren't the first team to hit this. Figma [publicly documented](https://www.figma.com/blog/an-alternative-approach-to-rate-limiting/) the same failure: *"In a distributed environment, the 'read-and-then-write' behavior creates a race condition, which means the rate limiter can at times be too lenient. If only a single token remains and two servers' Redis operations interleave, both requests would be let through."* Redis's own documentation [warns about this pattern](https://redis.io/glossary/redis-race-condition/) and recommends Lua scripts or MULTI/EXEC for atomicity.

We fixed it the way everyone eventually does: Lua script for atomic check-and-decrement.

## v2: Atomic Check with Lua — Multi-Provider Coordination Breaks

**Architecture:** v1 plus a Lua script that reads the current balance, checks against the cap, and decrements in a single atomic operation. GitHub's engineering team [describes the same progression](https://github.blog/engineering/infrastructure/how-we-scaled-github-api-sharded-replicated-rate-limiter-redis/): they moved their storage logic into Lua *"to guarantee atomicity of operations."*

v2 fixed the race condition. Concurrent agents could no longer double-spend. We thought we'd solved it.

Then the second wall hit.

**The wall: multi-provider coordination.**

A single user request often fanned out across multiple providers:
- GPT-4o to generate the plan
- DALL-E or Stable Diffusion to generate an image
- Google/Kling to generate a short video
- A stock data API for context
- A web search API for grounding

Each provider had different pricing models, different rate limits, different response formats, and different failure modes. Our rate limiter checked against a single aggregate dollar budget — but each provider call needed its own cost estimate *before* the call, because you can't undo a video generation after it's been paid for.

We ended up with a fragmented system:
- Custom integration code for every provider
- Manual cost-estimation logic that diverged from real pricing as providers changed their APIs
- No way to enforce provider-specific limits (*"this user can spend $50/month on video but unlimited on search"*)
- Cost estimates drifted: what we predicted vs. what the provider actually billed diverged over time

Worse, OpenAI's own rate limits are [organization- and project-scoped](https://platform.openai.com/docs/guides/rate-limits), vary by model, and some model families share limits. That meant our single-budget design couldn't even represent OpenAI's constraints cleanly, let alone the five other providers we were integrating.

Every provider addition was a week of work. Every provider pricing change was a fire drill. We called this the **whack-a-mole phase**.

## v3: The Per-Provider, Per-User Hierarchy

**Architecture:** v2 plus per-provider budgets, per-user scopes, and a coordination layer that enforced both a provider-specific cap and an aggregate user cap.

We were now maintaining:
- 7+ provider-specific rate limit integrations
- A per-user budget hierarchy
- Atomic decrement Lua scripts per scope
- Cost estimate tables updated manually per provider
- An internal dashboard to track it all

v3 held for a while. Then the third wall showed up — and this one changed how we thought about the whole system.

**The wall: risk wasn't cost.**

An agent got stuck in a loop and [sent 200 emails](/blog/ai-agent-action-control-hard-limits-side-effects) to customers. Token cost: $1.40. Business damage: much larger.

Our rate limiter never fired. Because it measured dollars, and the emails were cheap. The harm was in the action, not the spend.

We started sketching a v4 that would:
- Track a separate "action budget" alongside the dollar budget
- Score different tool calls by risk (send_email = high, search = low)
- Return something richer than ALLOW/DENY — maybe a "proceed but with these restrictions" response
- Support per-run, per-user, per-[tenant](/glossary#tenant) scopes atomically
- Emit events so downstream systems could react to budget exhaustion
- Handle delegation — when agent A spawns agent B, B shouldn't inherit A's full budget

That's when we stopped.

## The Realization: We Were Building Runtime Authority

Each of those v4 requirements has a name in infrastructure engineering:

| What we were building | What it's actually called |
|---|---|
| Atomic check-and-decrement per scope | [Reserve-commit lifecycle](/blog/what-is-runtime-authority-for-ai-agents) |
| ALLOW / restricted-ALLOW / DENY responses | [Three-way decision model](/blog/what-is-runtime-authority-for-ai-agents) |
| Risk-scored tool calls with per-tool limits | [Action authority with RISK_POINTS](/blog/ai-agent-risk-assessment-score-classify-enforce-tool-risk) |
| Per-run, per-user, per-tenant hierarchies | [Hierarchical scopes with attenuation](/blog/agent-delegation-chains-authority-attenuation-not-trust-propagation) |
| Budget sub-allocation for sub-agents | Authority attenuation |
| Events on budget exhaustion | Webhook event emission on budget state transitions |

Put together, those aren't features of a rate limiter. They're the core primitives of a **runtime authority platform** — the pre-execution enforcement layer that sits between an agent's decision to act and the action itself.

We were building infrastructure we didn't want to own. Every week we added to it was a week not building product. And the hard parts — the concurrency correctness, the multi-provider coordination, the risk scoring — are problems other people were already solving as general infrastructure.

That's why I started building [Cycles](/blog/why-i-am-building-cycles). Not because rate limiters are bad. They're fine for what they are. But if what you actually need is pre-execution enforcement across providers, across tenants, across risk tiers, with atomic [reservations](/glossary#reservation) and delegation-aware scoping — you're not building a rate limiter. You're building a runtime authority platform. And there's no advantage to each team rebuilding it in isolation.

## The Build-vs-Buy Pattern for AI Agent Rate Limiters

Looking back, every wall we hit had the same shape:

> **A rate limiter becomes a runtime authority platform the moment you take it seriously in production.**

- Take it seriously enough to survive concurrency → you need atomic operations
- Take it seriously enough to handle multiple providers → you need per-provider scopes with hierarchical aggregation
- Take it seriously enough to handle risk, not just cost → you need action-level authority, not just spend counters
- Take it seriously enough to handle multi-[tenant isolation](/glossary#tenant-isolation) → you need scoped budgets with per-tenant limits
- Take it seriously enough for multi-agent systems → you need attenuation, not trust propagation

Each individual requirement is implementable. The combination is a general infrastructure layer that most product teams don't want to own and shouldn't need to.

## When It's Still Fine to Build Your Own

Custom rate limiters are the right choice when:

- **You have a single provider.** A wrapper around one API with per-user token budgets is a reasonable weekend project.
- **You don't need atomic concurrency.** Prototypes, internal tools, low-traffic agents — race conditions won't bite you for a while.
- **You don't enforce action-level risk.** If all failures are purely financial and bounded, a spend tracker works.
- **You don't have multi-tenancy.** One customer, one budget — the scoping is trivial.

The moment any one of those changes — a second provider, concurrent users, a damaging tool call, a second tenant — the complexity curve bends upward. Not linearly. Categorically.

## The Take

If you're building a custom rate limiter for AI agents right now, you're probably in v1 or v2 of the scalerX arc. That's fine. That's where everyone starts.

Just be honest about what you're trending toward. The v3→v4 transition we almost made is where the build vs. buy calculus changes — because v4 isn't a rate limiter anymore. It's a general authority platform that happens to do rate limiting as one of its features. And general authority platforms are worth building once, not once per team.

---

- [Why I'm Building Cycles](/blog/why-i-am-building-cycles)
- [How Teams Control AI Agents Today — And Where It Breaks](/blog/how-teams-control-ai-agents-today-and-where-it-breaks)
- [What Is Runtime Authority for AI Agents](/blog/what-is-runtime-authority-for-ai-agents)
- [Action Authority: Hard Limits on Agent Side Effects](/blog/ai-agent-action-control-hard-limits-side-effects)
- [Risk Assessment: Score, Classify, and Enforce Tool Risk](/blog/ai-agent-risk-assessment-score-classify-enforce-tool-risk)
- [GitHub: runcycles](https://github.com/runcycles)

## Related how-to guides

- [Assigning RISK_POINTS to agent tools](/how-to/assigning-risk-points-to-agent-tools)
- [Webhook integrations](/how-to/webhook-integrations)
- [Using the Cycles dashboard](/how-to/using-the-cycles-dashboard)
