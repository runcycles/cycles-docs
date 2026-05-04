---
title: "Agent Identity Is Not User Identity"
date: 2026-05-02
author: Albert Mavashev
tags:
  - security
  - zero-trust
  - agents
  - governance
  - runtime-authority
  - production
description: "Why production AI agents need dedicated identities, scoped credentials, owner mapping, audit trails, and runtime authority instead of borrowed user sessions."
blog: true
sidebar: false
featured: false
head:
  - - meta
    - name: keywords
      content: AI agent identity, agent IAM, AI agent service accounts, agent security, non-human identity, runtime authority, agent audit trail
---

# Agent Identity Is Not User Identity

The audit log says Alice refunded a customer, sent a follow-up email, and opened a Jira ticket. Alice says she did not do any of those things. She clicked "resolve with agent" in the support console and went back to another ticket.

The system is not lying. It is just logging the wrong principal.

An AI agent acting on Alice's behalf is not Alice. It is also not the support application. It is an autonomous runtime actor with its own code path, tool set, budget, memory, retry behavior, and failure modes. If it borrows Alice's session or hides behind one shared service account, the platform weakens the first thing every governance system needs: a stable identity for the thing that actually acted.

Agent identity is becoming its own control plane problem. Microsoft is positioning Agent 365 as an enterprise control plane for observing, governing, and securing agents, including lifecycle management, access control, compliance, and audit. OWASP's 2026 agentic risk taxonomy calls out identity and privilege abuse as a distinct risk category. That separation matters: user identity answers who initiated the work. Agent identity answers which autonomous actor performed each step.

## The Three Principals in Every Agent Action

Many production agent actions involve three different principals:

| Principal | Question it answers | Example |
|---|---|---|
| Human owner | Who is accountable for the agent or request? | Alice, support manager, [tenant](/glossary#tenant) admin |
| Agent identity | Which autonomous actor performed the step? | `support-refund-agent-prod` |
| [Runtime authority](/glossary#runtime-authority) | Should this specific next action still happen? | ALLOW, ALLOW_WITH_CAPS, or DENY |

Collapsing those into one "user" field creates bad evidence. If the agent sends ten emails, the audit trail should not say Alice manually sent ten emails. If the agent drains a run budget, the cost record should not say the support app spent money with no agent attribution. If a delegated sub-agent calls a risky tool, the record should not lose the child identity behind the parent.

This is the same distinction behind [Runtime Authority vs Runtime Authorization](/concepts/runtime-authority-vs-runtime-authorization). Authorization asks whether an identity is allowed to use a tool. Runtime authority asks whether the next action is still bounded by budget, risk, and scope.

Production systems usually need both. The agent identity must be allowed to call the tool, and the action must still fit the live authority budget.

## What Breaks When Agents Borrow User Sessions

Borrowed user sessions feel convenient because they reuse the existing permission model. They also create failure modes that conventional IAM was not designed to handle.

| Pattern | What breaks |
|---|---|
| User session passthrough | Agent actions become indistinguishable from human actions |
| Shared service account | Attribution collapses across agents, tenants, and workflows |
| Broad admin key in runtime | A compromised agent becomes a management-plane actor |
| Parent credential inherited by child | Delegation propagates authority instead of narrowing it |
| No agent owner field | Revocation and incident routing become manual investigation |

One common failure is over-permission. Alice may be allowed to issue refunds up to $500 after reviewing a case. That does not mean a support agent running under Alice's browser session should issue refunds autonomously up to the same ceiling, across retries, across tool calls, and across delegated subtasks.

Human permission and agent authority have different risk profiles. Humans get tired and make mistakes. Agents branch, retry, and scale.

## What a Real Agent Identity Carries

A useful agent identity is more than a name in a log line. It should carry enough metadata for security, operations, and finance to answer the same questions from different angles.

| Field | Why it matters |
|---|---|
| `agent_id` | Stable principal for audit and policy |
| Owner | Human or team accountable for the agent |
| Tenant and environment | Blast-radius boundary for credentials and budgets |
| Purpose | Why the identity exists |
| Toolsets | Which classes of tools the agent may request |
| Budget scopes | Which ledgers the agent can draw from |
| Credential lifetime | Rotation and revocation boundary |
| Delegation policy | Whether child agents can be created, and with what limits |

Microsoft's Agent 365 page describes an agent registry, agent onboarding, lifecycle policies, access control, and audit/logging capabilities. The important architectural signal is that enterprise platforms are starting to treat agents as manageable entities, not invisible extensions of users.

Cycles fits one layer lower in that stack. It does not replace identity governance. It makes each runtime action attributable and bounded once an agent identity reaches the enforcement point.

## Identity Is Not Enough Without Authority

Dedicated agent identity fixes attribution and access. It does not fix cumulative [exposure](/glossary#exposure).

An agent can be correctly identified, correctly authenticated, and correctly authorized to call `send_email`, then send the wrong email 200 times. It can be allowed to call an LLM, then loop until the run budget is exhausted. It can be authorized to delegate to a research agent, then pass too much budget and too many tools to the child.

That is why the runtime path needs two decisions:

```text
1. Authorization: is this agent identity allowed to request this tool?
2. Authority: should this specific action proceed, given budget, risk, and scope right now?
```

The first decision is identity policy. The second decision is [runtime authority](/blog/what-is-runtime-authority-for-ai-agents).

In Cycles, the second decision is expressed through the reserve-commit lifecycle. Before the agent spends [tokens](/glossary#tokens) or invokes a risky tool, it reserves budget or [RISK_POINTS](/glossary#risk-points) against a scoped subject. The server returns ALLOW, ALLOW_WITH_CAPS, or DENY. After execution, the agent commits actual usage or releases unused budget.

The identity of the caller becomes part of the audit trail, but the budget ledger decides whether the action remains within bounds.

## A Production Pattern

A practical production pattern looks like this:

| Layer | Responsibility |
|---|---|
| Enterprise identity | Register agent, owner, environment, and lifecycle state |
| Secret manager / IAM | Issue short-lived or scoped credentials to the agent runtime |
| Cycles API key | Bind runtime calls to a tenant and permission set |
| Runtime authority | Enforce budget, RISK_POINTS, and scope before each action |
| Audit/event stream | Preserve who acted, what was requested, and why it was allowed or denied |

For a support refund agent, that becomes:

```text
owner: support-platform-team
agent_id: support-refund-agent-prod
tenant: acme
environment: production
toolsets: crm.read, refund.issue
risk budget: 200 RISK_POINTS/day
cash budget: $25/run
delegation depth: 0
```

If the agent tries to send an email, the authorization layer can reject the tool. If the agent tries to issue the sixth high-risk refund of the run, the authority layer can DENY even though the agent identity is valid. If the key leaks, the intended blast radius is one tenant and one agent role, not the whole application.

That pattern complements [API Key Management in Cycles](/how-to/api-key-management-in-cycles). API keys are the runtime credential. Agent identity is the principal model around that credential.

## Incident Response Gets Simpler

When agents have their own identities, incident response questions become easier to answer:

- Which agent performed the action?
- Which tenant and environment did it run under?
- Which human or team owns it?
- Which key authenticated the request?
- Which policy allowed the action?
- Which budget or risk allocation was consumed?
- Which child agent, if any, inherited authority?

Without agent identity, these often become forensic reconstruction. With agent identity, they can become filters.

This matters most when the incident spans more than one row. A compromised agent identity can be revoked. Its tenant keys can be rotated. Its webhooks can be paused. Its budgets can be frozen. Its owner can be paged. [Bulk actions](/how-to/using-bulk-actions-for-tenants-and-webhooks) become safer because the target set is defined by a real principal, not an approximate query over logs.

## The Takeaway

Agents should not disappear into user sessions or shared service accounts. In production, an agent is best treated as a non-human principal with an owner, a purpose, credentials, budget scopes, action limits, and audit obligations.

User identity tells you who asked for help. Agent identity tells you what acted. Runtime authority tells you whether the action should have happened at all.

Those are three different questions. A credible production governance stack answers all three.

## Sources

- [Zero Trust for AI Agents](/blog/zero-trust-for-ai-agents-why-every-tool-call-needs-a-policy-decision) - local context on the zero-trust pattern for agents
- [Runtime Authority vs Runtime Authorization](/concepts/runtime-authority-vs-runtime-authorization) - how identity policy and bounded runtime authority compose
- [API Key Management in Cycles](/how-to/api-key-management-in-cycles) - runtime credential scoping and rotation
- [Agent Delegation Chains Need Authority Attenuation](/blog/agent-delegation-chains-authority-attenuation-not-trust-propagation) - child agents should inherit less authority, not equal authority
- [Microsoft Learn: Overview of Microsoft Agent 365](https://learn.microsoft.com/en-us/microsoft-agent-365/overview) - agent registry, lifecycle, access control, compliance, and audit positioning
- [Microsoft Security Blog: Addressing OWASP Top 10 Risks in Agentic AI](https://www.microsoft.com/en-us/security/blog/2026/03/30/addressing-the-owasp-top-10-risks-in-agentic-ai-with-microsoft-copilot-studio/) - Microsoft summary of ASI03 identity and privilege abuse
- [OWASP Top 10 for Agentic Applications 2026](https://genai.owasp.org/resource/owasp-top-10-for-agentic-applications-for-2026/) - agentic risk framework
