---
title: "Salesforce and ServiceNow Govern Their Own Agents. Who Governs the Whole System?"
date: 2026-03-27
author: Albert Mavashev
tags: [governance, enterprise, salesforce, servicenow, agentforce, cross-platform, action-authority]
description: "Both platforms have invested heavily in AI agent governance. But neither acts as a neutral, shared pre-execution control plane across Salesforce, ServiceNow, and custom runtimes. That gap is where cross-platform agent governance lives."
blog: true
sidebar: false
---

# Salesforce and ServiceNow Govern Their Own Agents. Who Governs the Whole System?

> **Part of: [Multi-Tenant AI Operations Reference](/guides/multi-tenant-operations)** — the full pillar covering scope hierarchy, per-tenant enforcement, multi-agent coordination, tenant lifecycle, and identity.

> **Part of: [AI Agent Risk & Blast Radius Reference](/guides/risk-and-blast-radius)** — the full pillar covering action authority, risk scoring, blast-radius containment, and degradation paths.

A batch of 200 overdue invoices hits the system on a Tuesday afternoon. Salesforce Agentforce picks up the cases and starts auto-generating follow-up emails. Simultaneously, the invoicing system raises incidents in ServiceNow, and Now Assist begins auto-reassigning them, posting updates to customer Slack channels, and triggering escalation workflows. By the time anyone notices, 200 customer emails have gone out from Salesforce, 200 Slack notifications have gone out from ServiceNow, and 15 incidents have been auto-escalated to the wrong team.

The Salesforce admin checks Einstein usage. Everything looks normal — the agent did what it was configured to do. The ServiceNow admin checks Now Assist logs. Same story. Each platform governed its own agents correctly. Nobody governed the _aggregate_.

This is becoming a natural failure mode of multi-platform agent deployments — and the risk grows as enterprises move Agentforce and Now Assist from pilot to production.

<!-- more -->

## The Cross-Platform Blind Spot

Many large enterprises run both Salesforce and ServiceNow. Salesforce handles customer-facing CRM — sales, service, marketing. ServiceNow handles internal operations — IT service management, HR, facilities. Many also run custom AI agents built on LangChain, Spring AI, or internal tooling.

Each platform is shipping AI agents aggressively:

- **Salesforce Agentforce** — [autonomous agents](/glossary#autonomous-agent) that handle sales outreach, case resolution, lead nurturing, and customer communications within the Salesforce ecosystem.
- **ServiceNow Now Assist** — AI agents that triage incidents, auto-resolve tickets, generate knowledge articles, and manage change requests within ServiceNow.
- **Custom agents** — LangChain, CrewAI, AutoGen, or bespoke agents that operate outside both platforms, calling APIs, querying databases, and interacting with third-party services.

Both platforms have invested substantially in AI governance. Salesforce offers the Einstein Trust Layer for content safety, Agentforce guardrails for topic classification, and the [Agentforce Command Center](https://www.salesforce.com/news/press-releases/2025/06/23/agentforce-3-announcement/) for visibility and control across its ecosystem. ServiceNow provides [AI Control Tower](https://www.servicenow.com/products/ai-control-tower.html) for centralized AI monitoring, AI Agent Fabric for connecting third-party agents, and flow-level governance controls within the Now Platform.

This is not a claim that Salesforce and ServiceNow lack governance. Both offer substantial observability, analytics, and governance features within their own ecosystems — and both are expanding those capabilities aggressively. The gap is different: neither platform acts as a vendor-neutral, shared pre-execution control plane across Salesforce, ServiceNow, _and_ custom runtimes simultaneously. Each governs its own agents. Nobody governs the aggregate.

Three questions that illustrate this gap:

1. **"How much are we spending on AI across all platforms this quarter?"** — The CFO asks this. The answer requires reconciling Salesforce Einstein usage reports, ServiceNow AI consumption logs, cloud provider invoices, and custom agent costs across different billing systems with different units and cadences. There is overlap, double-counting, and no way to attribute costs to business outcomes.

2. **"Show me a complete log of all AI-initiated actions that modified customer data in the last 90 days, across all systems."** — The SOC2 auditor asks this. The security team can pull Salesforce audit logs and ServiceNow `sys_audit` records separately. But neither captures AI-initiated actions specifically (vs. human-initiated), and there is no way to correlate activity across platforms into a single timeline.

3. **"Can we prove that our AI agents cannot send more than N customer communications per hour, across all systems?"** — The CISO asks this. Salesforce can limit Agentforce actions within Salesforce. ServiceNow can limit Now Assist actions within ServiceNow — and [AI Agent Fabric](https://www.servicenow.com/platform/ai-agent-fabric.html) can connect third-party agents into ServiceNow's governance model. But no vendor-neutral shared pre-execution ledger enforces a combined limit across Salesforce, ServiceNow, and custom runtimes simultaneously. The Tuesday email storm was technically within each platform's individual limits.

## Why a Neutral Governance Plane Is Needed

Both Salesforce and ServiceNow are expanding their AI governance capabilities — and those capabilities are real and valuable within each platform's ecosystem. Salesforce's Command Center gives Agentforce operators visibility and control. ServiceNow's AI Control Tower provides centralized monitoring. AI Agent Fabric connects third-party agents into ServiceNow's governance model.

But each platform's governance is anchored to its own ecosystem. The structural challenge is not that these platforms lack governance — it is that cross-platform governance requires a neutral party.

**Platform governance is platform-scoped.** Salesforce's Agentforce Command Center monitors and controls Agentforce agents. It does not monitor Now Assist agents, LangChain agents, or custom agents running outside Salesforce. ServiceNow's AI Control Tower governs agents within the Now Platform. [AI Agent Fabric](https://www.servicenow.com/platform/ai-agent-fabric.html) connects and controls third-party agents — but it brings them into ServiceNow's governance model, not into a vendor-neutral shared ledger. Even when a platform can connect to third-party agents, that is not the same as a neutral pre-execution authority enforced across Salesforce, ServiceNow, and custom runtimes simultaneously.

**Shared limits require a shared ledger.** If a Salesforce agent and a ServiceNow agent both handle the same customer interaction, enforcing a combined risk limit across both requires a single ledger that both platforms write to before acting. Neither platform provides this — and building it requires the kind of vendor-neutral protocol that neither platform is positioned to offer for the other's agents.

**Neither can enforce pre-execution authority on the other.** Salesforce cannot intercept a ServiceNow flow before it executes. ServiceNow cannot block an Agentforce action before it sends an email. The only entity that can sit between both platforms is a third party that both platforms call into before acting.

This is a familiar pattern. No single SaaS platform built cross-platform identity — Okta exists because cross-platform identity requires a neutral third party that every platform authenticates against. Cross-platform AI agent governance follows the same architectural logic: a neutral governance plane that every agent runtime calls before every consequential action.

## Unified Governance: One Protocol, Every Platform

The [Cycles protocol](/glossary#cycles-protocol) was designed for exactly this problem. A single Cycles [tenant](/glossary#tenant) spans all platforms. The subject hierarchy maps naturally to enterprise organizational structure:

```
tenant:acme-corp                          → $50,000/month total AI budget
│                                         → 10,000 RISK_POINTS/day action limit
│
├─ app:salesforce                         → $20,000/month
│  ├─ workflow:case-triage                → $5,000/month
│  └─ workflow:lead-nurture               → $8,000/month
│
├─ app:servicenow                         → $15,000/month
│  ├─ workflow:incident-auto-resolve      → $7,000/month
│  └─ workflow:hr-onboarding              → $3,000/month
│
└─ app:custom-agents                      → $15,000/month
   └─ agent:knowledge-bot                 → $5,000/month
```

The `tenant:acme-corp` scope acts as a hard cap across all platforms. Even if individual platform budgets sum to more than $50K, the tenant-level budget prevents collective overspend. This is the existing Cycles hierarchical scope model — no protocol changes required.

### Two governance dimensions

**[Budget authority](/glossary#budget-authority) ([USD_MICROCENTS](/glossary#usd-microcents))** controls how much AI agents can spend across all platforms. Every model call, API invocation, and external service request is governed by a single, unified budget. When the Salesforce Agentforce agent spends $35,000 by the 20th of the month, the ServiceNow Now Assist agents see their remaining budget drop accordingly. Concurrent [reservations](/glossary#reservation) from both platforms against the same budget are handled atomically by the [Cycles server](/glossary#cycles-server).

**[Action authority](/glossary#action-authority) ([RISK_POINTS](/glossary#risk-points))** controls what agents _do_ across all platforms. A single customer interaction spanning both platforms might look like this:

| Platform | Action | Risk Points |
|----------|--------|:-----------:|
| Salesforce | Read case details | 0 |
| ServiceNow | Read related incidents | 0 |
| Salesforce | Update case status | 5 |
| ServiceNow | Reassign incident | 10 |
| Salesforce | Send customer email | 50 |
| ServiceNow | Post to Slack channel | 20 |

The risk budget is scoped to the interaction — via `dimensions.correlation_id` — not to the platform. When the risk budget is exhausted, all platforms stop consequential actions while reads and internal operations continue.

This is action authority applied across platforms. Dollar budgets control cost. RISK_POINTS control behavior. A support agent that sends 200 customer emails costs $1.40 in [tokens](/glossary#tokens). The risk is not monetary — it is reputational and operational. RISK_POINTS capture what [money cannot measure](/concepts/action-authority-controlling-what-agents-do).

### How agents connect: thin connectors, not platform lock-in

Connecting a platform to the Cycles governance plane requires a minimal connector — a thin HTTP wrapper that calls the Cycles API before and after agent actions. The connector complexity is comparable to integrating with any external REST API, which both platforms do routinely.

**Salesforce**: A minimal Apex connector would expose three static methods — `reserve()`, `commit()`, `release()` — making HTTP callouts to the Cycles server via a Named Credential. An Invocable Action wrapper would expose the same lifecycle to Flow Builder and Agentforce action definitions. No custom objects, no triggers, no scheduled jobs.

**ServiceNow**: A minimal Script Include connector would provide the same three methods — `reserve()`, `commit()`, `release()` — making REST calls via a Connection & Credential Alias. A Flow Designer action would expose the lifecycle to Now Assist workflows. No tables, no UI pages, no scheduled jobs.

In both cases, the connector stores no data in the platform — all state lives in the Cycles server. The connector can be added or removed with zero side effects. The argument "just build governance in Apex" or "just build it in ServiceNow scripting" applies to the connector itself. It does not apply to the cross-platform governance logic — atomic budget enforcement across concurrent agents on different platforms, hierarchical scope enforcement, idempotent commit/release with automatic expiry. Building that correctly requires exactly what the Cycles server already provides.

## How this works in practice

### Scenario 1: The CISO needs a kill switch

A batch processing error triggers AI agents on both platforms simultaneously. Salesforce Agentforce starts auto-sending follow-up emails. ServiceNow Now Assist starts posting updates to customer Slack channels.

With a shared RISK_POINTS budget of 500 per hour at the tenant level — where `email.send` costs 50 points and `slack.notify` costs 20 points — the cascade is contained. After 8 emails (400 points) and 5 Slack notifications (100 points), the budget is exhausted. The 9th email attempt from the Salesforce connector:

```json
// POST /v1/reservations
{
  "idempotency_key": "sf-email-009",
  "subject": {
    "tenant": "acme-corp",
    "app": "salesforce",
    "agent": "agentforce-case-bot",
    "toolset": "customer-email"
  },
  "action": { "kind": "tool.email", "name": "send-follow-up" },
  "estimate": { "unit": "RISK_POINTS", "amount": 50 }
}
```

```json
// 409 Conflict
{
  "error": "BUDGET_EXCEEDED",
  "message": "Insufficient risk-point budget at scope tenant:acme-corp",
  "request_id": "req_7x9f..."
}
```

The reservation is denied before the email function executes. The next Slack notification attempt from ServiceNow returns the same `409 BUDGET_EXCEEDED`. Both platforms halt customer-facing actions simultaneously, while internal reads, note-taking, and status updates continue unaffected.

The Cycles reservation ledger records every governed action — every attempt, every allow, every deny — with timestamps, platform origin, agent identity, and risk points consumed.

If the CISO needs to halt all AI agent activity immediately — not wait for a budget to drain, but stop everything now — the Cycles Admin API supports a tenant-level kill switch:

```
PATCH /v1/admin/tenants/acme-corp
{ "status": "SUSPENDED" }
```

A suspended tenant blocks all operations at the authentication layer. Every subsequent request from any connector — Salesforce, ServiceNow, custom agents — returns `401 UNAUTHORIZED` with reason `TENANT_SUSPENDED` before any reservation logic runs. No agent code changes. No platform logins. One API call, universal stop.

When the incident is resolved, reactivate with `{ "status": "ACTIVE" }` and agents resume normally. The suspension is reversible; closure (`CLOSED`) is not.

### Scenario 2: The CFO wants a single number

The quarterly AI spend review. Instead of reconciling billing systems across multiple providers:

```
GET /v1/balances?tenant=acme-corp
```

Returns total AI spend across all platforms — for every action routed through Cycles. Drill down by `app` to see per-platform spend. Drill down by `workflow` to see per-process spend. Because every Cycles reservation includes `dimensions.correlation_id` — the case number, ticket ID, or customer ID that triggered the interaction — the finance team can attribute AI costs to business outcomes: cost per resolved case, cost per auto-resolved incident, cost per qualified lead. Across all platforms. In real time.

### Scenario 3: The auditor asks for logs

SOC2 Type II audit. The auditor requests a complete log of all AI-initiated actions that modified customer data in the last 90 days, across all systems.

The Cycles reservation ledger contains every governed action. A single query returns them:

```
GET /v1/reservations?tenant=acme-corp&status=COMMITTED
```

Each entry in the response includes the full context:

```json
{
  "reservations": [
    {
      "reservation_id": "res_8f3a...",
      "status": "COMMITTED",
      "subject": {
        "tenant": "acme-corp",
        "app": "salesforce",
        "agent": "agentforce-case-bot",
        "toolset": "customer-email",
        "dimensions": {
          "platform": "salesforce",
          "correlation_id": "CASE-4782"
        }
      },
      "action": { "kind": "tool.email", "name": "send-customer-reply" },
      "reserved": { "unit": "RISK_POINTS", "amount": 50 },
      "created_at_ms": 1743091200000,
      "affected_scopes": [
        "tenant:acme-corp",
        "tenant:acme-corp/app:salesforce",
        "tenant:acme-corp/app:salesforce/agent:agentforce-case-bot",
        "tenant:acme-corp/app:salesforce/agent:agentforce-case-bot/toolset:customer-email"
      ]
    }
  ],
  "has_more": true,
  "next_cursor": "eyJ..."
}
```

Action kind, agent identity, timestamp, platform origin, correlation ID, risk points — all in one response, across all platforms. Filter by `app`, `agent`, or `toolset` to narrow to a specific platform or action type. Paginate with `cursor` for the full history. The audit trail is generated as a side effect of enforcement — not as a separate logging concern. Enforcement guarantees a trail for governed actions; logging alone does not guarantee control. For the compliance model behind this, see [AI Agent Governance: Runtime Enforcement for Security, Cost, and Compliance](/blog/ai-agent-governance-runtime-enforcement-security-cost-compliance).

## Protocol, Not Platform

The governance plane is the Cycles server — the same [open protocol](/protocol/how-reserve-commit-works-in-cycles) that already integrates with [LangChain](/how-to/integrating-cycles-with-langchain), [Vercel AI SDK](/how-to/integrating-cycles-with-vercel-ai-sdk), [Spring Boot](/quickstart/getting-started-with-the-cycles-spring-boot-starter), and [MCP-based agents](/quickstart/getting-started-with-the-mcp-server). Adding Salesforce and ServiceNow connectors would extend the same reserve-commit lifecycle to two more platforms. The protocol does not change. The server does not change. The governance model does not change.

Cross-platform correlation works through the existing `dimensions` field on the Cycles Subject. Both connectors include `dimensions.platform` and `dimensions.correlation_id`. When a Salesforce case triggers a ServiceNow incident — a common integration pattern — both connectors pass the same correlation ID. The Cycles server tracks all reservations under this correlation, producing a unified timeline of what happened, on which platform, in what order.

A Salesforce reserve and a ServiceNow reserve against the same tenant look identical at the protocol level:

```json
// From Salesforce Agentforce — send customer email
{
  "subject": {
    "tenant": "acme-corp",
    "app": "salesforce",
    "workflow": "case-triage",
    "agent": "agentforce-case-bot",
    "toolset": "customer-email",
    "dimensions": {
      "platform": "salesforce",
      "correlation_id": "CASE-4782"
    }
  },
  "action": { "kind": "tool.email", "name": "send-customer-reply" },
  "estimate": { "unit": "RISK_POINTS", "amount": 50 }
}
```

```json
// From ServiceNow Now Assist — post Slack notification
{
  "subject": {
    "tenant": "acme-corp",
    "app": "servicenow",
    "workflow": "incident-auto-resolve",
    "agent": "now-assist-incident",
    "toolset": "customer-notifications",
    "dimensions": {
      "platform": "servicenow",
      "correlation_id": "CASE-4782"
    }
  },
  "action": { "kind": "tool.slack", "name": "post-customer-channel" },
  "estimate": { "unit": "RISK_POINTS", "amount": 20 }
}
```

Both hit the same tenant budget. Both consume from the same risk-point pool. Both are governed by the same hierarchical scope enforcement. The Cycles server does not need to know anything about Salesforce or ServiceNow — it sees subjects, actions, and amounts. The platform-specific logic lives entirely in the thin connectors.

## Why Now

Three forces are converging:

**Agentforce and Now Assist are scaling to production.** Salesforce shipped [Agentforce GA in October 2024](https://www.salesforce.com/news/press-releases/2024/10/29/agentforce-general-availability-announcement/). ServiceNow introduced Now Assist AI Agents as part of the [Yokohama release in early 2025](https://www.servicenow.com/company/media/press-room/yokohama-release.html). Enterprises that piloted these capabilities throughout 2025 are now deploying them to production at scale. The cross-platform governance gap becomes real the moment a customer interaction triggers agents on both platforms simultaneously — a pattern that becomes increasingly likely as workflows span both systems.

**AI governance expectations are rising across compliance frameworks.** Organizations are mapping AI agent activity into existing SOC 2 and ISO 27001 control programs, while newer AI-focused frameworks like [NIST AI RMF](https://www.nist.gov/itl/ai-risk-management-framework) and ISO/IEC 42001 increase expectations around governance, traceability, and risk management. The question "show me your AI audit trail" is appearing more frequently in audits — and a cross-platform audit trail that covers Salesforce, ServiceNow, and custom agents in a single ledger is significantly harder to produce than a platform-specific one.

**AI spend is crossing the visibility threshold.** As enterprises scale from pilot to production, AI spend that was acceptable during experimentation becomes a line item the CFO scrutinizes. The first question is always "can we see this by platform and by business process?" Without a unified governance plane, the answer requires manual reconciliation across multiple billing systems.

A common trigger is simple: an enterprise deploys Agentforce to production and discovers that a customer support interaction kicked off agents on both platforms, with no coordination, no shared limit, and no unified audit trail. The first cross-platform incident creates the urgency.

## Getting Started

1. **See what cross-platform governance looks like.** The [60-second demo](/demos/) shows budget enforcement stopping a runaway agent in real time. The same mechanism works across platforms — one budget, multiple agents, shared enforcement.

2. **Understand the action authority model.** The [action authority demo](/demos/) walks through a support agent where internal actions proceed but the customer email is blocked. Cross-platform action authority is the same pattern applied to agents on Salesforce, ServiceNow, and custom frameworks simultaneously.

3. **Run the Cycles server.** The [Docker quickstart](/quickstart/deploying-the-full-cycles-stack) stands up the full stack — Redis, Cycles server, admin API — in one command. From there, adding platform connectors is a matter of pointing HTTP callouts at the server.

4. **Read the protocol.** The [reserve-commit lifecycle](/protocol/how-reserve-commit-works-in-cycles) is the same for every integration — Python, TypeScript, Java, and MCP. If you've used any Cycles integration, the cross-platform model is the same protocol with a shared tenant. Salesforce and ServiceNow connectors follow the same pattern.

## Further Reading

- [AI Agent Governance: Runtime Enforcement for Security, Cost, and Compliance](/blog/ai-agent-governance-runtime-enforcement-security-cost-compliance) — the three-pillar governance framework
- [Action Authority: Controlling What Agents Do](/concepts/action-authority-controlling-what-agents-do) — RISK_POINTS and toolset-scoped budgets
- [AI Agent Action Authority: Blocking a Customer Email Before Execution](/blog/action-authority-demo-support-agent-walkthrough) — step-by-step demo walkthrough
- [What Is Runtime Authority for AI Agents?](/blog/what-is-runtime-authority-for-ai-agents) — the foundational concept
- [Multi-Agent Budget Control](/blog/multi-agent-budget-control-crewai-autogen-openai-agents-sdk) — shared budgets across multiple agent frameworks

## Related how-to guides

- [Assigning RISK_POINTS to agent tools](/how-to/assigning-risk-points-to-agent-tools)
- [Multi-agent shared budgets](/how-to/multi-agent-shared-workspace-budget-patterns)
- [Budget control for LangChain](/how-to/how-to-add-budget-control-to-a-langchain-agent)
