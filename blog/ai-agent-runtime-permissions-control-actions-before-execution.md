---
title: "AI Agent Runtime Permissions: Control Actions Before Execution"
date: 2026-03-23
author: Albert Mavashev
tags: [runtime-authority, action-authority, action-control, agents, side-effects, permissions, engineering]
description: "Agents don't just cost money — they take actions. Learn why runtime permissions are the missing layer for controlling what AI agents can do in production."
blog: true
sidebar: false
---

# AI Agent Runtime Permissions: Control Actions Before Execution

> **Part of: [AI Agent Risk & Blast Radius Reference](/guides/risk-and-blast-radius)** — the full pillar covering action authority, risk scoring, blast-radius containment, and degradation paths.

A team ships an autonomous support agent. It reads tickets, queries a knowledge base, drafts replies, and sends emails. In staging it handles 50 tickets without incident. On day three in production, a customer submits a ticket in a language the model handles poorly. The agent misinterprets the request, drafts a refund confirmation for a billing dispute, and sends it — along with 47 follow-up emails to related accounts offering refunds nobody requested.

Total API cost of the emails: $1.40. Business damage: $34,000 in honored refunds, an incident review, and a week of manual cleanup.

No budget was exceeded. No rate limit was hit. The problem was not spend — it was that the agent had permission to act when it should not have.

<!-- more -->

This is the action problem — and it is why AI agent permissions matter more than most teams realize. Agents are not chatbots that produce text. They are systems that take actions — and every action that changes state outside the agent's own context is a commitment that cannot be revoked by adjusting a dashboard threshold after the fact.

The question is not "how much did it cost?" It is "should it have been allowed to do that?"

## Agents act, not just answer

A chatbot generates text. An agent generates consequences.

When an agent calls a tool, it does not produce a suggestion for a human to review. It executes. The email is sent. The record is updated. The deploy is triggered. The API is called. Each of these actions has a different blast radius, a different degree of reversibility, and a different set of downstream consequences.

| Tier | Category | Examples | Reversibility | Blast radius |
|:----:|----------|----------|--------------|--------------|
| 1 | **Read** | File reads, DB queries, search, web scrape | No state change | None |
| 2 | **Write-local** | File writes, draft creation, log entries | Reversible with effort | Contained to local system |
| 3 | **Write-external** | Emails, Slack messages, ticket creation, third-party API calls | Difficult or impossible to reverse | External parties affected |
| 4 | **Mutation** | DB deletes, config changes, permission grants, record updates | Often irreversible | System-wide |
| 5 | **Execution** | Deploys, CI triggers, payment processing, infrastructure changes | Irreversible in practice | Production users affected |

A tier-1 action that goes wrong is invisible. A tier-3 action that goes wrong is a customer-facing incident. A tier-5 action that goes wrong is a production outage. The risk difference between tiers is not about cost — a deploy and a search query may cost the same in [tokens](/glossary#tokens). The difference is what happens when the action should not have been taken.

Every team building agents implicitly accepts a risk surface defined by which tiers their agents can reach. Most teams have not explicitly decided where that boundary should be — or how to enforce it at runtime.

## Why existing controls do not cover actions

Teams already have controls. The problem is that none of them govern what an agent is allowed to _do_ at runtime.

**Prompt instructions** tell the agent what it should do. They are suggestions encoded in natural language. The model can misinterpret them, deprioritize them under pressure, or simply ignore them when conflicting context is present. Instructions are a best-effort heuristic, not an enforcement mechanism. In the opening scenario, the agent's prompt said "only send emails that match the customer's original request." The model decided 47 related-account refund emails matched.

**Guardrails** validate what the model _said_ — output format, content safety, schema conformance. They operate on the model's response, not on the system's next action. A guardrail that checks whether an email body contains profanity does not check whether the email should be sent at all. Guardrails answer "is this output acceptable?" not "is this action authorized?"

**Rate limits** control velocity — requests per second, calls per minute. An agent can stay well within rate limits and still send 200 wrong emails. Rate limits constrain throughput, not capability. They do not distinguish between a read and a deploy, or between an agent's 1st email and its 200th.

**Observability** tells you what happened. It is retrospective by definition. A dashboard that shows 200 emails were sent is valuable for the post-mortem. It did not stop the agent at email number 5, when the damage was still containable.

| Control | What it governs | When it acts | Can it block an action before execution? |
|---------|----------------|-------------|----------------------------------------|
| Prompt instructions | Agent behavior intent | Before first step | No — advisory only |
| Guardrails | Output quality and safety | During or after generation | No — checks content, not authorization |
| Rate limits | Request velocity | Per-request | No — controls throughput, not capability |
| Observability | Visibility and audit | After execution | No — reports, does not enforce |
| **Runtime permissions** | **Action authorization** | **Before each action** | **Yes** |

The gap is clear. No existing layer provides AI agent action control at the moment it matters — before execution. None of these controls make a pre-execution decision about whether a specific action should proceed given the current runtime context: how many actions have already been taken, which tools have already been used, and what the cumulative [exposure](/glossary#exposure) looks like right now.

## Runtime permissions: the missing layer for AI agent action control

Runtime permissions are pre-execution decisions about whether an agent may invoke a specific tool or take a specific action, made at the moment of execution based on current state.

This is different from static configuration. A static tool allowlist says "this agent can send emails" — a decision made at deploy time. A runtime permission says "this agent can send emails, but it has already sent 5 in this run, and its action budget for external writes is exhausted, so the next email is denied." The first is a capability declaration. The second is a live enforcement decision that adapts as the agent acts.

Runtime permissions use the same [three-way decision](/glossary#three-way-decision) model as budget enforcement:

- **ALLOW** — the action is within limits; proceed normally
- **ALLOW_WITH_CAPS** — the action is allowed but should be constrained (disable certain tools, limit remaining steps)
- **DENY** — the action is not permitted; the agent must stop or degrade

The three-way model is what makes runtime permissions practical. A binary allow/deny forces hard stops. ALLOW_WITH_CAPS enables [graceful degradation](/glossary#graceful-degradation) — the agent loses dangerous capabilities while retaining useful ones.

### Tool allowlists and denylists

Runtime permissions can control which tools are available to an agent at any point during execution. When a [reservation](/glossary#reservation) returns ALLOW_WITH_CAPS, the response includes a `caps` object that may contain:

- **`tool_allowlist`** — only these tools may be used (everything else is implicitly denied)
- **`tool_denylist`** — these specific tools are blocked (everything else is allowed)

This is not static configuration. The allowlist or denylist is computed at decision time based on remaining budget, consumed risk points, and configured policy. An agent that starts with full tool access may lose access to high-risk tools mid-run — not because the code changed, but because the runtime state changed.

### RISK_POINTS: a non-monetary unit for action risk

Dollar budgets measure financial exposure. But the opening scenario shows that the costliest incidents are not the most expensive in token terms. Two hundred wrong emails cost $1.40 in model calls and $34,000 in business damage.

[RISK_POINTS](/glossary#risk-points) is a unit designed for this problem. Instead of denominating action budgets in dollars, teams assign point values to each action class based on blast radius and reversibility:

| Action | Risk points | Rationale |
|--------|:----------:|-----------|
| Read-only model call | 1 | No side effects |
| Internal tool call (search, lookup) | 2 | No external side effects |
| External API read (GET) | 5 | Third-party dependency |
| File write | 10 | Persistent state change, reversible with effort |
| Email or Slack message | 20 | External recipient, irreversible once delivered |
| Database mutation (update/delete) | 25 | Potentially irreversible data change |
| Deploy or CI trigger | 50 | Production impact, affects end users |

A workflow capped at 100 risk points can make dozens of reads (1-2 points each) but only send 5 emails (20 points each) before hitting the limit. The cap forces the agent to prioritize — and forces the team to decide, up front, how much action surface they are willing to expose per run.

The specific point values are team-defined. The value is not in the absolute numbers but in the relative weighting and the hard cap. What matters is that the cap exists and is enforced before the action executes.

## Progressive capability narrowing

As an agent consumes its action budget, its capabilities should shrink. This is not a crash — it is a controlled degradation where the most dangerous tools are removed first.

| Risk budget consumed | Decision | Effect |
|:-------------------:|----------|--------|
| 0–50% | ALLOW | Full tool access — reads, writes, external calls, mutations |
| 50–80% | ALLOW_WITH_CAPS | High-blast-radius actions disabled — no email, no deploy |
| 80–100% | ALLOW_WITH_CAPS | Read-only mode — search and summarize only |
| 100% | DENY | No further actions permitted |

Early in a run, the agent has full access: it can read data, update records, send emails, and trigger deploys. As it consumes risk points, external writes are disabled first — the agent can still read and reason, but it cannot take actions with external consequences. Near the end of its budget, only read-only tools remain.

The agent does not crash. It does not throw an unhandled exception. It continues doing useful work within progressively tighter boundaries. A support agent that runs out of its email budget can still query the knowledge base, update internal notes, and prepare a draft for human review. It just cannot send the email.

This is the "disable" degradation strategy applied to actions rather than cost. The same agent, the same code, the same tools — but the runtime determines which tools are reachable at each step.

## Scoped action authority

Action permissions are hierarchical. The Cycles scope hierarchy — [tenant](/glossary#tenant), workspace, app, workflow, agent, toolset — applies to [action authority](/glossary#action-authority) the same way it applies to [budget authority](/glossary#budget-authority).

```
tenant:acme
└─ workspace:production
   └─ app:support-bot
      └─ workflow:billing-dispute
         └─ agent:resolver
            ├─ toolset:internal-notes   → 200 RISK_POINTS ✓
            ├─ toolset:crm-updates      → 100 RISK_POINTS ✓
            └─ toolset:send-email       → 0 RISK_POINTS   ✗
```

The scoping model enables three patterns that flat permission systems cannot:

**Per-workflow policies.** A billing-dispute workflow blocks autonomous email; a shipping-update workflow allows it. Same agent, same tools, different runtime permissions depending on the workflow context.

**Per-[tenant isolation](/glossary#tenant-isolation).** Customer A's agents can call external APIs; Customer B's cannot. Same codebase, same deployment, different action surfaces configured through budget provisioning — not code changes.

**Scope isolation.** One agent's actions do not erode another agent's permissions. If Agent A exhausts its email budget, Agent B's email budget is unaffected. Each scope path has its own independent ledger.

The operational model is straightforward: **approving an action = adding a budget; revoking an action = removing a budget**. No code changes. No redeployment. No new API keys.

## Runtime vs. design-time vs. post-hoc

The three control points sit at different stages of the agent lifecycle:

| Control point | When | What it sees | Can it prevent? | Example |
|--------------|------|-------------|----------------|---------|
| **Design-time** | Before deployment | Static config, code, prompts | Can exclude capabilities entirely | Remove `send_email` tool from agent definition |
| **Runtime** | Before each action | Cumulative state, remaining budget, current context | Can allow, constrain, or deny per-action | Deny 6th email after 5 already sent in this run |
| **Post-hoc** | After execution | Logs, traces, metrics | Cannot prevent — only report and alert | Dashboard shows 200 emails were sent |

Design-time controls answer "can this agent ever send emails?" Runtime controls answer "should this agent send this email right now, given what it has already done?" Post-hoc controls answer "how many emails did it send?"

Only runtime controls can distinguish the agent's 1st email from its 50th. Only runtime controls can adapt as the agent acts. And only runtime controls can make a decision that changes based on cumulative exposure rather than static policy.

An agent that was correctly configured at design time — with the right tools, the right prompt, the right model — can still produce a catastrophic outcome at runtime when conditions diverge from expectations. This is why AI agent permissions must be enforced at runtime, not just at deploy time. The opening scenario is exactly this: a correctly configured agent operating on unexpected input, with no [runtime authority](/glossary#runtime-authority) to constrain its actions when they became inappropriate.

## Practical patterns

### Pattern 1: Toolset risk budgets

Assign RISK_POINTS per toolset. Each toolset gets an independent budget that governs how many actions of that type are permitted per run.

```python
# Provisioning (operational, not code)
# toolset:send-email → 100 RISK_POINTS (allows ~5 emails at 20 pts each)
# toolset:crm-updates → 200 RISK_POINTS (allows ~8 mutations at 25 pts each)
# toolset:internal-notes → 500 RISK_POINTS (generous for internal operations)

# Agent code — unchanged except for the decorator
@cycles(estimate=20, unit="RISK_POINTS", toolset="send-email",
        action_kind="tool.email", action_name="send-reply")
def send_customer_email(case_id, to, subject, body):
    return _send_email(case_id, to, subject, body)
```

The 6th email attempt hits 120 RISK_POINTS against a 100-point budget. The reservation returns DENY. The email function never executes.

### Pattern 2: Read-only fallback

When the action budget is exhausted, the agent continues in read-only mode instead of stopping entirely.

```python
try:
    send_customer_email(case_id, to, subject, body)
except BudgetExceededError:
    # Action budget exhausted — fall back to read-only
    summary = read_case_summary(case_id)
    draft = prepare_draft_for_review(case_id, summary)
    escalate_to_human(case_id, draft)
```

The agent still produces useful output — a prepared draft and an escalation — without taking the consequential action.

### Pattern 3: Approval gates

A DENY on a high-risk action triggers a human-in-the-loop approval flow instead of a hard stop.

```python
try:
    trigger_deploy(service, version)
except BudgetExceededError:
    # Deploy not approved for autonomous execution
    request_human_approval(
        action="deploy",
        service=service,
        version=version,
        reason="Action budget exceeded — requires manual authorization"
    )
```

The agent cannot deploy autonomously, but it can prepare the deployment and request approval. The human sees exactly what the agent wants to do and decides whether to proceed.

### Pattern 4: Per-tenant action policies

Different tenants get different action surfaces through budget provisioning — not code branching.

```
# Enterprise tenant — full action surface
tenant:enterprise-corp/toolset:send-email    → 500 RISK_POINTS
tenant:enterprise-corp/toolset:deploy        → 200 RISK_POINTS

# Starter tenant — restricted action surface
tenant:starter-co/toolset:send-email         → 50 RISK_POINTS
tenant:starter-co/toolset:deploy             → 0 RISK_POINTS (no budget = always DENY)
```

Same agent code, same deployment. The runtime determines what each tenant's agents can do based on provisioned budgets.

## What this looks like with Cycles

Cycles enforces action authority through the same [reserve-commit protocol](/protocol/how-reserve-commit-works-in-cycles) used for budget authority. RISK_POINTS is a first-class unit alongside [USD_MICROCENTS](/glossary#usd-microcents) and TOKENS. The reserve-commit lifecycle works identically:

1. **Reserve** — before the tool call, request permission by reserving RISK_POINTS
2. **Execute** — only if the reservation succeeds (ALLOW or ALLOW_WITH_CAPS)
3. **Commit** — after execution, confirm the actual risk consumed
4. **Release** — if the action was skipped, release the reservation

The `@cycles` decorator handles this lifecycle transparently:

```python
from runcycles import cycles, BudgetExceededError

@cycles(estimate=20, unit="RISK_POINTS", toolset="send-email",
        action_kind="tool.email", action_name="send-reply")
def send_customer_email(case_id, to, subject, body):
    # This function only executes if the reservation succeeds
    return _send_email(case_id, to, subject, body)
```

The same protocol, the same infrastructure, the same scope hierarchy. Action authority is not a separate system — it is a different unit applied to the same enforcement layer. Teams that already use Cycles for budget authority can add action authority by creating RISK_POINTS budgets for their toolsets. No additional SDK. No new integration.

For agent frameworks (LangGraph, CrewAI, custom loops) and coding agents (Claude Code, Cursor, Windsurf), action authority works through the same integration points — Python decorators, TypeScript higher-order functions, or MCP tool configuration. See [AI Agent Action Control: Hard Limits on Side Effects](/blog/ai-agent-action-control-hard-limits-side-effects) for the full taxonomy and implementation details.

## Next steps

- **[Action Authority: Controlling What Agents Do](/concepts/action-authority-controlling-what-agents-do)** — concept deep dive on action authority and toolset-scoped budgets
- **[AI Agent Action Control: Hard Limits on Side Effects](/blog/ai-agent-action-control-hard-limits-side-effects)** — the taxonomy of consequential actions and RISK_POINTS implementation
- **[Action Authority Demo: Blocking a Customer Email](/blog/action-authority-demo-support-agent-walkthrough)** — hands-on walkthrough of a support agent where Cycles blocks email before execution
- **[Runtime Authority vs Guardrails vs Observability](/blog/runtime-authority-vs-guardrails-vs-observability)** — how runtime authority complements guardrails and observability
- **[What Is Runtime Authority for AI Agents?](/blog/what-is-runtime-authority-for-ai-agents)** — foundational explainer on pre-execution enforcement
- **[Understanding Units in Cycles](/protocol/understanding-units-in-cycles-usd-microcents-tokens-credits-and-risk-points)** — RISK_POINTS, USD_MICROCENTS, TOKENS, and [CREDITS](/glossary#credits) reference
- **[End-to-End Tutorial](/quickstart/end-to-end-tutorial)** — zero to a working budget-guarded app in 10 minutes

## Related how-to guides

- [Assigning RISK_POINTS to agent tools](/how-to/assigning-risk-points-to-agent-tools)
- [Integrating with LangGraph](/how-to/integrating-cycles-with-langgraph)
- [API key management](/how-to/api-key-management-in-cycles)
