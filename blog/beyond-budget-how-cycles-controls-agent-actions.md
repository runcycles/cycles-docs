---
title: "Beyond Budget: How Cycles Controls Agent Actions, Not Just Spend"
date: 2026-04-02
author: Albert Mavashev
tags: [action-authority, risk-points, runtime-authority, tool-governance, agents]
description: "Cycles isn't just a budget tool. It governs what agents do — tool calls, API requests, emails, deployments — using the same reserve-commit protocol that controls spend. Here's how action authority works."
blog: true
sidebar: false
---

# Beyond Budget: How Cycles Controls Agent Actions, Not Just Spend

> **Part of: [AI Agent Risk & Blast Radius Reference](/guides/risk-and-blast-radius)** — the full pillar covering action authority, risk scoring, blast-radius containment, and degradation paths.

Most people discover Cycles because they need to stop an agent from burning through their OpenAI bill. Fair enough — that's the most visible problem.

But spend is just one dimension of what an [autonomous agent](/glossary#autonomous-agent) can do wrong. An agent that stays within its token budget can still:

- Send 200 customer emails in a retry loop
- Deploy to production without approval
- Call a rate-limited third-party API 500 times in a minute
- Write to a database table it shouldn't touch
- Trigger a webhook that fires a real-world action

These aren't cost problems. They're **authority** problems. The question isn't "how much did it spend?" — it's "should this action have happened at all?"

<!-- more -->

## The same protocol, different units

Cycles' reserve → commit → release lifecycle doesn't care what you're measuring. The protocol works with four unit types:

| Unit | What it measures | Example |
|------|-----------------|---------|
| `USD_MICROCENTS` | Dollar cost | LLM token spend |
| `TOKENS` | Token count | Model-agnostic token budgets |
| `CREDITS` | Abstract [credits](/glossary#credits) | Internal allocation systems |
| `RISK_POINTS` | Action risk | Tool calls, API requests, side effects |

When you use `RISK_POINTS`, you're not tracking cost — you're tracking **consequence**. An agent that reserves 50 risk points for `send_email` and 0 for `search_knowledge` isn't managing a budget. It's managing what the agent is allowed to do.

## How tool estimate mapping works

The [OpenAI Agents SDK integration](/how-to/integrating-cycles-with-openai-agents) implements this directly through `ToolEstimateMap`:

```python
from runcycles_openai_agents import CyclesRunHooks, ToolEstimateMap

hooks = CyclesRunHooks(
    tenant="acme",
    tool_estimates=ToolEstimateMap(
        mapping={
            "send_email": 50,        # high-risk: 50 RISK_POINTS per call
            "update_crm": 10,        # medium-risk: 10 RISK_POINTS
            "deploy_to_prod": 100,   # critical: 100 RISK_POINTS
            "search_knowledge": 0,   # zero estimate: no reservation, no API call
        },
        default_estimate=1,          # unmapped tools: 1 RISK_POINT
    ),
)
```

With a budget of 200 risk points per session:
- The agent can search knowledge unlimited times (0 points each)
- It can send 4 emails (50 × 4 = 200 points)
- It can deploy to production twice (100 × 2 = 200 points)
- It **cannot** send 3 emails and deploy once (150 + 100 = 250 > 200)

The [budget authority](/glossary#budget-authority) decides the risk allocation. The protocol enforces it. The agent never sees the limits — it just gets `DENY` when it tries to exceed them.

## Beyond tool calls: action authority in every integration

You don't need the OpenAI Agents plugin to use [action authority](/glossary#action-authority). The same pattern works with every integration through the `action` field on [reservations](/glossary#reservation):

```python
from runcycles import ReservationCreateRequest, Action, Amount, Unit

# Guard a non-LLM action
res = client.create_reservation(ReservationCreateRequest(
    idempotency_key=key,
    subject=subject,
    action=Action(kind="tool.email", name="send_customer_email"),
    estimate=Amount(unit=Unit.RISK_POINTS, amount=50),
    ttl_ms=30_000,
))

if not res.is_success:
    # Agent is not authorized to send this email
    return "Email blocked — action limit reached."
```

The `action.kind` and `action.name` fields give you per-action-type governance. The budget authority can set different limits for `tool.email` vs `tool.search` vs `tool.deploy`, and the agent's available actions shrink as it consumes its authority.

## Real scenarios

### Scenario 1: Support agent with email limits

A customer support agent can research, draft responses, and search the knowledge base freely. But it can only send 5 emails per session. On the 6th attempt, Cycles returns `DENY`, and the agent queues the email for human review instead.

Without action authority, the agent's retry logic could send the same apology email dozens of times before anyone notices.

### Scenario 2: DevOps agent with deployment gates

A DevOps agent can run diagnostics, read logs, and suggest fixes with no limits. But deployments cost 100 risk points, and the agent has 100 per day. One deployment per day. If it needs a second, it escalates to a human.

Without action authority, a debugging loop that keeps trying "deploy and check if fixed" could push 12 broken builds in an hour.

### Scenario 3: Research agent with API call caps

A research agent calls a third-party API during a research session. Each API call costs 1 risk point, and the agent has 50 points per session. After 50 calls, Cycles denies the 51st — the agent must summarize what it has and stop searching. Without this cap, a recursive research loop could make hundreds of API calls in a single session, burning through external API quotas and producing diminishing returns.

## Cost and consequence together

The most powerful setup uses both `USD_MICROCENTS` for spend and `RISK_POINTS` for actions on the same agent:

```python
# Two separate budgets on the same scope:
# - USD_MICROCENTS budget: $5 spend limit for LLM calls
# - RISK_POINTS budget: 200 points for tool actions
# Each reservation checks its own unit's budget independently.

@cycles(estimate=2_000_000, unit="USD_MICROCENTS",
        action_kind="llm.completion", action_name="gpt-4o")
def call_llm(prompt: str) -> str:
    ...

@cycles(estimate=50, unit="RISK_POINTS",
        action_kind="tool.email", action_name="send_customer_email")
def send_email(to: str, body: str) -> str:
    ...
```

The agent can spend up to $5 on LLM calls (checked against the [USD_MICROCENTS](/glossary#usd-microcents) budget). It can send up to 4 emails (checked against the [RISK_POINTS](/glossary#risk-points) budget, 200 / 50). Each action checks its own unit's budget — the same protocol, the same concurrency safety, the same scope hierarchy, applied to different dimensions of authority.

## Why this matters for multi-agent systems

In multi-agent systems — LangGraph workflows, AutoGen teams, CrewAI crews — action authority becomes critical. Each agent in the system can have its own risk budget:

- The **researcher** agent gets unlimited search but zero email authority
- The **writer** agent gets LLM budget but zero deployment authority
- The **executor** agent gets tool authority but limited LLM budget

The scope hierarchy (`tenant → workspace → app → workflow → agent → toolset`) means these limits are enforced independently per agent. The researcher cannot borrow the executor's deployment authority. A bug in the writer cannot trigger the executor's tools.

This is the same hierarchical isolation that prevents one [tenant](/glossary#tenant) from spending another tenant's budget — applied to actions instead of dollars.

## Key points

- **Cycles governs actions, not just spend.** `RISK_POINTS` track consequence — tool calls, API requests, side effects — using the same reserve-commit protocol.
- **Zero-cost tools skip enforcement.** Assign 0 points to safe actions (search, read) so they never hit the Cycles API.
- **Per-agent action budgets.** In multi-agent systems, each agent gets its own risk allocation through the scope hierarchy.
- **Cost and consequence together.** Use `USD_MICROCENTS` for spend limits and `RISK_POINTS` for action limits on the same agent — both enforced independently.
- **The protocol is the same.** Reserve before the action, commit after, release on error. Whether you're tracking dollars or deployments, the lifecycle is identical.

## Next steps

- [Action Authority: Controlling What Agents Do](/concepts/action-authority-controlling-what-agents-do) — the conceptual foundation
- [OpenAI Agents SDK Integration](/how-to/integrating-cycles-with-openai-agents) — ToolEstimateMap and per-tool governance
- [Understanding Units](/protocol/understanding-units-in-cycles-usd-microcents-tokens-credits-and-risk-points) — USD_MICROCENTS, [TOKENS](/glossary#tokens), CREDITS, RISK_POINTS
- [Degradation Paths](/how-to/how-to-think-about-degradation-paths-in-cycles-deny-downgrade-disable-or-defer) — what to do when action authority is denied
- [Multi-Agent Shared Budgets](/how-to/multi-agent-shared-workspace-budget-patterns) — shared and independent budgets across agents

## Related how-to guides

- [Assigning RISK_POINTS to agent tools](/how-to/assigning-risk-points-to-agent-tools)
- [Integrating with LangGraph](/how-to/integrating-cycles-with-langgraph)
- [Webhook integrations](/how-to/webhook-integrations)
