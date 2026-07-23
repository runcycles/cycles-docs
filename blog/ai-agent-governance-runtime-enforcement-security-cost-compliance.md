---
title: "AI Agent Runtime Enforcement: Security and Cost"
date: 2026-03-25
author: Cycles Team
tags: [governance, security, compliance, agents, production, MCP, multi-agent]
description: "Most AI agent deployments lack runtime governance. Pre-execution enforcement — not dashboards — is the missing layer for agent security, cost, and compliance."
blog: true
sidebar: false
featured: true
head:
  - - meta
    - name: keywords
      content: AI agent governance, runtime enforcement, agent security, AI cost control, compliance audit trail, MCP governance, runtime authority
---

# AI Agent Governance: Runtime Enforcement for Security, Cost, and Compliance

> **Part of: [AI Agent Risk & Blast Radius Reference](/guides/risk-and-blast-radius)** — the full pillar covering action authority, risk scoring, blast-radius containment, and degradation paths.

Since December 2025, NIST, OWASP, Google Research, and the Linux Foundation ecosystem have all signaled the same thing from different angles: agentic systems need stronger standards, clearer execution boundaries, and real runtime governance. OWASP published its [Top 10 for Agentic Applications](https://genai.owasp.org/2025/12/09/owasp-top-10-for-agentic-applications-the-benchmark-for-agentic-security-in-the-age-of-autonomous-ai/) in December 2025. The same month, the Linux Foundation announced the [Agentic AI Foundation](https://www.linuxfoundation.org/press/linux-foundation-announces-the-formation-of-the-agentic-ai-foundation) — co-founded by Anthropic, OpenAI, and Block, with Google, Microsoft, and AWS as platinum members. In January 2026, Google Research published [scaling principles for multi-agent architectures](https://research.google/blog/towards-a-science-of-scaling-agent-systems-when-and-why-agent-systems-work/). In February, [NIST launched its AI Agent Standards Initiative](https://www.nist.gov/news-events/news/2026/02/announcing-ai-agent-standards-initiative-interoperable-and-secure).

The reason is not theoretical. It's empirical: **more than half of enterprises have not implemented an AI governance framework.** A [Gartner survey](https://futurecio.tech/the-what-why-and-how-of-ai-governance-in-2024/) found that only 46% of organizations have implemented one — meaning the majority are operating without formal governance. A [2025 EY survey](https://www.ey.com/en_uk/insights/ai/how-can-responsible-ai-bridge-the-gap-between-investment-and-impact) found that 64% of surveyed organizations experienced more than $1 million in losses from AI-related risks broadly — a figure that is likely worse for [autonomous agents](/glossary#autonomous-agent), where each failure can compound through tool calls and sub-agent delegation. By some estimates, [over 80% of AI projects fail to reach production](https://www.rand.org/pubs/research_reports/RRA2680-1.html).

These are not model capability problems. They are governance problems — and they have a common root cause.

<!-- more -->

## The Root Cause: Agents Act, But Nobody Authorizes

A chatbot generates text. An agent _acts_. It sends emails, writes database records, triggers deployments, calls external APIs, spawns sub-agents, and loops until it decides it's done. Each action creates consequences that persist after the agent stops.

Governance is the infrastructure that answers three questions before each action:

1. **Security** — Is this agent authorized to take this action?
2. **Cost** — Is there budget remaining for this action?
3. **Compliance** — Will this action be recorded with sufficient detail for audit?

Most agent architectures answer none of these at runtime. They answer them in retrospect — through dashboards, alerts, and incident reviews.

The distinction matters. Governance is not observability. Observability tells you what happened. Governance decides what _should_ happen. The first is a camera. The second is a lock.

## The Three Pillars of Agent Governance

### Pillar 1: Security — Who Can Do What?

The security surface of AI agents expanded dramatically in early 2026. Real incidents, not hypotheticals:

- **ClawJacked** (February 2026): Researchers demonstrated that malicious websites can hijack locally-running AI agents via WebSocket, executing arbitrary tool calls through the user's agent session.
- **Tool hub [exposure](/glossary#exposure)**: An audit of ClawHub found [824 unauthorized or harmful capabilities](https://blog.sshh.io/p/everything-wrong-with-mcp) out of 10,700 published tools. Separately, Knostic discovered 1,862 internet-exposed [MCP servers](/glossary#mcp-server) — all 119 manually verified had zero authentication.
- **Replit database deletion**: Replit's AI coding assistant [deleted a user's production database](https://techcrunch.com/2025/10/02/after-nine-years-of-grinding-replit-finally-found-its-market-can-it-keep-it/) containing 100+ executive contacts, then fabricated 4,000 fake records to cover its tracks.
- **OpenAI Operator purchase**: OpenAI's Operator agent [reportedly made an unauthorized $31.43 purchase from Instacart](https://incidentdatabase.ai/cite/1028/), bypassing user confirmation safeguards.
- **Rogue agent collaboration**: Researchers [demonstrated](https://www.theregister.com/2026/03/12/rogue_ai_agents_worked_together/) that compromised agents can coordinate to escalate privileges and compromise downstream systems. In connected multi-agent architectures, a single poisoned agent can rapidly corrupt downstream decision-making — what OWASP categorizes as [ASI08: Cascading Failures](https://genai.owasp.org/resource/owasp-top-10-for-agentic-applications-for-2026/).

These incidents share a pattern: the agent had the _capability_ to act but no _authority_ check before acting. MCP defines how agents discover and call tools. It does not define whether a given agent, in a given context, should be allowed to call a given tool right now.

The missing layer is runtime authorization — a decision point between "the agent wants to do X" and "X happens."

### Pillar 2: Cost — How Much Can Be Spent?

Cost governance for agents is well-documented. The short version: agents amplify API costs by 3–10x compared to single-call chatbots. A proof-of-concept costing $500/month [scaled to $847,000/month](https://medium.com/@klaushofenbitzer/token-cost-trap-why-your-ai-agents-roi-breaks-at-scale-and-how-to-fix-it-4e4a9f6f5b9a) in production. A data enrichment agent [misinterpreted an API error and ran 2.3 million calls over a weekend](https://rocketedge.com/2026/03/15/your-ai-agent-bill-is-30x-higher-than-it-needs-to-be-the-6-tier-fix/), costing $47,000.

The deeper point is that **cost governance is security governance**. An uncontrolled spend spiral is a denial-of-service attack on your own infrastructure. When one runaway agent exhausts a shared rate limit, every other agent and user on the platform is affected. When a monthly budget burns out in a week, teams add manual approval steps — which defeats the purpose of autonomy.

For detailed cost analysis and enforcement patterns, see [AI Agent Budget Control: Enforce Hard Spend Limits](/blog/ai-agent-budget-control-enforce-hard-spend-limits) and [The True Cost of Uncontrolled AI Agents](/blog/true-cost-of-uncontrolled-agents).

### Pillar 3: Compliance — Can You Prove What Happened?

NIST's AI Agent Standards Initiative signals that regulatory scrutiny of autonomous agents is no longer hypothetical. SOC2 and GDPR already require audit trails for automated systems that process user data. Most agent architectures cannot provide one.

The compliance gap has three dimensions:

1. **Reconstruction**: Can you trace what an agent did, step by step, including which tools it called, what data it accessed, and what decisions it made?
2. **Authorization**: Can you prove that each action was checked against a policy before execution — not just logged after the fact?
3. **Attribution**: Can you tie each action to a specific [tenant](/glossary#tenant), user, workflow, and run — with timestamps and amounts?

An [NBER study from February 2026](https://www.nber.org/papers/w32879) found that 89% of firms reported zero measurable productivity change from AI adoption broadly. While the study covers AI adoption in general — not agent governance specifically — one contributing factor is clear: compliance requirements slow or block deployment entirely. Teams that cannot demonstrate governance over their agents cannot deploy them in regulated environments.

Observability tools (Langfuse, LangSmith, Arize) record what happened. They provide reconstruction. But they do not provide authorization proof — because the authorization never happened. You cannot audit a decision that was never made.

## Why Current Tools Don't Cover Governance

Each category of existing tools covers a fragment of the governance problem. Most address one or two pillars but not all three:

| Tool category | Security | Cost | Compliance |
|---|---|---|---|
| **Observability** (Langfuse, LangSmith, Arize) | Visibility only | Visibility only | Partial reconstruction |
| **Rate limiters** | Velocity control | Velocity control | No |
| **Provider caps** (OpenAI monthly limits) | No | Coarse, org-level | No |
| **Content guardrails** (Guardrails AI, NeMo) | Content filtering | No | No |
| **MCP / A2A protocols** | Tool discovery | No | No |
| **[Runtime authority](/glossary#runtime-authority)** | Pre-execution decision point | Pre-execution budget enforcement | Enforcement and settlement evidence |

The common thread: observability, rate limiting, and content guardrails are all either **retrospective** (they record what happened) or **wrong-granularity** (they control velocity, not total exposure, and operate at org level instead of per-agent, per-run, per-tenant).

Governance requires mandatory controls between "the agent decided to act" and "the action executed." For instrumented actions, [runtime authority](/blog/what-is-runtime-authority-for-ai-agents) can make an atomic budget decision there. Application authorization, argument validation, identity controls, and full tool-call audit records remain part of the wider control system.

## Runtime Authority as the Governance Layer

Runtime authority is an architectural layer for pre-execution budget decisions and settlement evidence through the **reserve-commit lifecycle**. It supports cost and caller-assigned exposure budgets, but it does not replace the application's security policy or compliance logging.

### How it works

1. **Reserve** — Before a consequential action, a mandatory runtime boundary requests a budget reservation. A successful live reservation returns `ALLOW` or `ALLOW_WITH_CAPS`; insufficient budget is an error such as `409 BUDGET_EXCEEDED`. `DENY` is used by `decide` and dry-run flows. Application authorization remains a separate check unless the deployment implements the governance extensions.
2. **Execute** — Only if authorized. The action happens.
3. **Commit** — After execution starts, the runtime reports best-known actual usage, including partial usage from a failed operation. The difference between estimated and actual is returned to the budget pool.
4. **Release** — If execution is skipped, cancelled before it starts, or demonstrably consumes zero usage, the client releases the [reservation](/glossary#reservation).

Reserve, commit, and release operations create budget lifecycle records with fields such as scope, timestamp, amount, unit, action context, and status; optional evidence can support later verification. Non-persisting `decide` and dry-run evaluations are not a complete audit log. Record tool arguments, identity-policy decisions, and application rationale in the application or gateway.

### Modeling action exposure with RISK_POINTS

Dollar budgets control spend. [RISK_POINTS](/glossary#risk-points) let an application budget a caller-assigned measure of action exposure. Each action class can receive a point value based on blast radius:

| Action class | Risk points | Rationale |
|---|:---:|---|
| Read-only model call | 1 | No side effects |
| Internal tool call (search, lookup) | 2 | No external impact |
| File write | 10 | Persistent state change |
| Email or Slack message | 20 | External recipient, irreversible |
| Database mutation (update/delete) | 25 | Potentially irreversible |
| Deploy or CI trigger | 50 | Production impact |

A mandatory handler that reserves 20 points per email and 50 per deploy can use a 100-point budget to bound those attempts. The current server treats `RISK_POINTS` as a budget unit; the caller assigns the points and must make the reservation unavoidable. The published v0.1.26 governance extension describes richer action registries and allow/deny policy, but that extension is not yet implemented in `cycles-server`. For the broader [action authority](/glossary#action-authority) model, see [AI Agent Action Control: Hard Limits on Side Effects](/blog/ai-agent-action-control-hard-limits-side-effects).

### Hierarchical scope as organizational governance

Cycles enforces configured budgets across the standard subject hierarchy atomically in a single reservation:

```
tenant:acme-corp
  └─ workspace:engineering
       └─ app:support-platform
            └─ workflow:ticket-triage
                 └─ agent:classifier
                      └─ toolset:email-tools
```

When a reservation is created at the agent level, the system checks budget availability at every ancestor scope simultaneously. A single agent cannot exceed its own budget, the workflow budget, the workspace budget, or the tenant budget — and concurrent agents drawing from the same pool cannot oversubscribe it, because reservations are atomic (backed by Redis Lua scripts).

This lets a budget hierarchy mirror organizational boundaries. Enforcement applies where budgets and the mandatory reservation boundary are configured.

### Outcome-aware governance flow

The dispatch adapter must report whether execution started; a `finally` block alone cannot distinguish a pre-dispatch validation failure from a partial side effect:

```text
reserve 20 caller-assigned RISK_POINTS with a stable idempotency key
if the live reservation is rejected or malformed:
    do not call send_email

persist the active hold
attempt = send_email_with_outcome(ticket)  # returns started, actual, result/error

if attempt.started:
    commit best-known actual usage with a stable commit key
else if attempt was skipped or demonstrably used zero:
    release with a stable release key
else:
    retain the hold for reconciliation; do not release an ambiguous attempt

verify COMMITTED, RELEASED, or an idempotent APPLIED usage event
before clearing the durable settlement record
report the original tool error and any settlement error separately
```

### Code example: exposing Cycles tools to Claude Code or Cursor

One config addition exposes the Cycles tools:

```json
{
  "mcpServers": {
    "cycles": {
      "command": "npx",
      "args": ["-y", "@runcycles/mcp-server"],
      "env": {
        "CYCLES_API_KEY": "cyc_live_...",
        "CYCLES_BASE_URL": "http://localhost:7878"
      }
    }
  }
}
```

The agent gains nine budget-aware tools (`cycles_reserve`, `cycles_commit`, `cycles_decide`, and others). They do not automatically wrap its existing tools. Use **Cycles Budget Guard for Claude Code**, or place Cycles in a required tool handler, gateway, harness, or service boundary, to ensure every protected action passes through the check. For setup details, see [Getting Started with the MCP Server](/quickstart/getting-started-with-the-mcp-server).

## The Governance Checklist for Production Agents

Before deploying an agent to production, use these questions to identify control gaps. A "yes" requires evidence from the actual execution path, not merely a documented intent.

1. **Budget boundaries** — Does every agent run have a maximum cost, enforced before execution?
2. **Action severity tiers** — Does the application classify consequential actions and assign any `RISK_POINTS` used for per-run exposure budgets?
3. **[Tenant isolation](/glossary#tenant-isolation)** — Is it impossible for Agent A's workload to consume Agent B's budget, even under concurrent execution?
4. **Audit trail** — Are budget lifecycle records joined with application logs for identity, tool arguments, authorization decisions, and rationale?
5. **[Graceful degradation](/glossary#graceful-degradation)** — When budget is exhausted, do agents degrade to read-only instead of hard-failing or silently continuing?
6. **Retry safety** — Are commits idempotent, so retries cannot cause double-settlement?
7. **Scope hierarchy** — Do budgets enforce at every organizational level (tenant → workspace → agent) atomically?

Teams that answer "yes" to all seven have a stronger runtime-control foundation, not a complete governance guarantee. Dashboards provide necessary observability, but they do not establish pre-execution enforcement.

## Getting Started

Three paths, depending on your current state:

1. **See what budget enforcement would do — without blocking anything.** [Shadow mode](/how-to/shadow-mode-in-cycles-how-to-roll-out-budget-enforcement-without-breaking-production) evaluates calls without denying them. It lowers rollout risk, but still requires ordinary production safeguards and does not validate unimplemented action-governance policy.

2. **Expose budget tools to MCP-based agents.** If your agents use Claude Desktop, Claude Code, Cursor, or Windsurf, the [MCP server integration](/quickstart/getting-started-with-the-mcp-server) adds Cycles tools with a config change. Add a mandatory enforcement boundary for hard limits.

3. **See enforcement stop a runaway agent in real time.** The [60-second demo](/demos/) shows budget enforcement preventing a [tool loop](/glossary#tool-loop) — from reservation to denial to graceful degradation. No setup required.

## Sources

1. [NIST AI Agent Standards Initiative](https://www.nist.gov/news-events/news/2026/02/announcing-ai-agent-standards-initiative-interoperable-and-secure) — February 17, 2026
2. [OWASP Top 10 for Agentic Applications](https://genai.owasp.org/2025/12/09/owasp-top-10-for-agentic-applications-the-benchmark-for-agentic-security-in-the-age-of-autonomous-ai/) — December 10, 2025
3. [Linux Foundation Agentic AI Foundation](https://www.linuxfoundation.org/press/linux-foundation-announces-the-formation-of-the-agentic-ai-foundation) — December 9, 2025
4. [Google Research: Scaling Agent Systems](https://research.google/blog/towards-a-science-of-scaling-agent-systems-when-and-why-agent-systems-work/) — January 28, 2026
5. [Gartner AI Governance Survey](https://futurecio.tech/the-what-why-and-how-of-ai-governance-in-2024/) — 46% have implemented a framework
6. [EY Responsible AI survey](https://www.ey.com/en_uk/insights/ai/how-can-responsible-ai-bridge-the-gap-between-investment-and-impact) — 64% of surveyed organizations experienced more than $1M in losses from AI-related risks broadly
7. [RAND Corporation](https://www.rand.org/pubs/research_reports/RRA2680-1.html) — AI project failure estimates
8. [Knostic MCP security analysis](https://blog.sshh.io/p/everything-wrong-with-mcp) — 1,862 exposed servers
9. [Replit database deletion incident](https://techcrunch.com/2025/10/02/after-nine-years-of-grinding-replit-finally-found-its-market-can-it-keep-it/) — TechCrunch, October 2025
10. [Rogue agents working together](https://www.theregister.com/2026/03/12/rogue_ai_agents_worked_together/) — compromised agents escalating privileges

## Further Reading

- [What Is Runtime Authority for AI Agents?](/blog/what-is-runtime-authority-for-ai-agents) — the foundational concept
- [AI Agent Action Control: Hard Limits on Side Effects](/blog/ai-agent-action-control-hard-limits-side-effects) — RISK_POINTS and tool allowlists
- [Cycles vs. LLM Proxies and Observability Tools](/blog/cycles-vs-llm-proxies-and-observability-tools) — why dashboards aren't governance
- [Multi-Agent Budget Control](/blog/multi-agent-budget-control-crewai-autogen-openai-agents-sdk) — CrewAI, AutoGen, OpenAI Agents SDK
- [The AI Agent Production Gap](/blog/ai-agent-production-gap-what-developers-are-saying) — what the community is saying
- [AI Agent Runtime Permissions](/blog/ai-agent-runtime-permissions-control-actions-before-execution) — controlling actions before execution

## Related how-to guides

- [Assigning RISK_POINTS to agent tools](/how-to/assigning-risk-points-to-agent-tools)
- [Integrating with MCP](/how-to/integrating-cycles-with-mcp)
- [Using the Cycles dashboard](/how-to/using-the-cycles-dashboard)
