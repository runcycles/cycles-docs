---
title: "How Cycles Meters Caller-Assigned Action Exposure"
date: 2026-04-02
author: Albert Mavashev
tags: [action-authority, RISK_POINTS, runtime-authority, tool-governance, agents]
description: "Learn how Cycles meters caller-assigned risk budgets while application authorization controls which agent tools and arguments may execute at runtime boundaries."
blog: true
sidebar: false
head:
  - - meta
    - name: keywords
      content: AI agent action control, action authority, RISK_POINTS, reserve commit, tool governance, runtime authority
---

# Beyond Spend: Metering Caller-Assigned Action Exposure

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

When you use `RISK_POINTS`, the application submits its own exposure estimate rather than a monetary cost. That budget can bound repeated authorized attempts, but it does not decide whether the principal may call `send_email` or whether particular recipients and arguments are safe.

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

With a budget of 200 risk points per session, assuming every protected tool attempt passes through the hooks:
- The agent can search knowledge unlimited times (0 points each)
- It can send 4 emails (50 × 4 = 200 points)
- It can deploy to production twice (100 × 2 = 200 points)
- It **cannot** send 3 emails and deploy once (150 + 100 = 250 > 200)

The application decides the estimates and provisions the budget. The plugin requires a live reservation before nonzero mapped attempts; it separately depends on the host and SDK to authorize and dispatch the tool.

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
    # The submitted exposure does not fit the configured budget.
    return "Email blocked — action limit reached."
```

The `action.kind` and `action.name` fields describe the attempted operation in the lifecycle record. Current budget selection follows tenant and subject scopes, not an allow/deny rule inferred from those action strings. To isolate email, search, and deploy exposure, the caller can use distinct toolset subjects and provision explicit budgets for them. The host must still authorize the action.

## Illustrative scenarios

### Scenario 1: Support agent with email limits

A customer support host can allow research and drafting while requiring a 20-point reservation for every authorized email attempt against a 100-point session budget. The sixth attempt does not fit, and the host can queue it for human review.

Without action authority, the agent's retry logic could send the same apology email dozens of times before anyone notices.

### Scenario 2: DevOps agent with deployment gates

A DevOps host can authorize diagnostics separately while assigning 100 risk points to each deployment attempt against a 100-point daily budget. A second attempt does not fit unless the host provisions more budget after its normal approval process.

Without action authority, a debugging loop that keeps trying "deploy and check if fixed" could push 12 broken builds in an hour.

### Scenario 3: Research agent with API call caps

A research host can assign 1 risk point to each third-party API attempt and provide 50 points per session. At a mandatory boundary, the 51st attempt does not fit. The host decides whether to summarize, defer, or request more budget.

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

The instrumented LLM path can reserve against a $5 [USD_MICROCENTS](/glossary#usd-microcents) budget. The mandatory email handler can separately authorize the call and reserve 50 points against a 200-point [RISK_POINTS](/glossary#risk-points) budget. Each submitted unit uses the same budget protocol; authorization remains outside that protocol.

## Why this matters for multi-agent systems

In multi-agent systems — LangGraph workflows, AutoGen teams, CrewAI crews — action authority becomes critical. Each agent in the system can have its own risk budget:

- The **researcher** host role allows search and denies email
- The **writer** host role receives LLM budget while the host denies deployment
- The **executor** host role can receive a narrow toolset budget and a smaller LLM budget

Caller-supplied agent and toolset subjects can isolate budgets when the corresponding ledgers are explicitly provisioned. Missing budgets are skipped, so a zero allocation or host denial—not an absent ledger—is required to block a path. Tool inventory and credentials remain host controls.

This is the same hierarchical isolation that prevents one [tenant](/glossary#tenant) from spending another tenant's budget — applied to actions instead of dollars.

## Key points

- **Cycles meters submitted exposure as well as spend.** `RISK_POINTS` carry the application's estimate through the same reserve-commit protocol.
- **Zero-estimate tools skip this plugin's reservation.** The host still authorizes them and may need independent audit logging.
- **Per-agent exposure budgets require explicit subjects and ledgers.** They are not inferred from the agent graph.
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
