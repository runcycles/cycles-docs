---
title: "Agent Registries Are Not Runtime Governance"
date: 2026-05-05
author: Albert Mavashev
tags:
  - security
  - governance
  - agents
  - runtime-authority
  - production
description: "Agent registries help inventory owners, lifecycle, and access, but runtime governance still needs per-action budget, risk, scope, and audit decisions."
blog: true
sidebar: false
featured: false
head:
  - - meta
    - name: keywords
      content: AI agent registry, agent governance, AI agent inventory, agent lifecycle management, runtime governance, agent audit, AI agent control plane
---

# Agent Registries Are Not Runtime Governance

The security review starts with a simple question: how many agents do we have in production?

The answer is not simple. Some agents live in the support platform. Some are embedded in developer tools. Some are marketplace skills wrapped around scripts. Some run as scheduled workflows. A few were created by business teams and never entered the normal application inventory.

That is why agent registries matter.

A registry gives the organization a place to record what agents exist, who owns them, what environment they run in, and which lifecycle state they are in. Microsoft Agent 365 is positioned around this kind of enterprise problem: observe, govern, and secure agents through centralized registry, lifecycle management, access control, compliance, and audit.

That is necessary infrastructure. It is not the same thing as runtime governance.

The registry tells you what the agent is supposed to be. Runtime governance decides whether the next action should happen now.

## What a Registry Is Good At

An agent registry is an inventory and lifecycle control point. It helps answer questions that every production governance program eventually asks.

| Registry question | Example answer |
|---|---|
| Which agents exist? | `support-refund-agent-prod`, `sales-research-agent` |
| Who owns them? | Support platform team, revenue operations |
| Where do they run? | Production, staging, developer workstation |
| What is their lifecycle state? | Draft, approved, suspended, retired |
| Which identity or key is assigned? | [Tenant](/glossary#tenant)-scoped runtime credential |
| Which tools are approved? | CRM read, ticket create, email send |
| Which compliance review applies? | Data handling, access review, audit retention |

These are real controls. Without them, incident response becomes discovery. Operators spend the first hour of an incident figuring out whether the agent is sanctioned, who owns it, and where to disable it.

A registry is also the right place to manage approval workflows. Before an agent reaches production, someone should know its owner, purpose, environment, data classes, toolsets, and expected operating envelope.

## What the Registry Does Not Decide

A registry usually stores intended state. It does not automatically know what has already happened inside a live run.

| Runtime question | Why registry state is insufficient |
|---|---|
| Has this tenant exhausted its budget? | Requires live ledger state |
| Has this workflow already used its risk allowance? | Requires cumulative action accounting |
| Is this the 1st or 201st email in the run? | Requires per-run action history |
| Is this delegated child agent narrower than the parent? | Requires scoped authority at delegation time |
| Should the agent degrade instead of stop? | Requires ALLOW_WITH_CAPS semantics |
| Is the [reservation](/glossary#reservation) safe under concurrency? | Requires atomic reserve-commit logic |

The difference is timing. Registry review happens before deployment or during lifecycle management. Runtime governance happens at the moment an action is proposed.

Those moments have different information.

At registration time, you know the intended owner and approved capabilities. At runtime, you know the current [tenant](/glossary#tenant), workflow, toolset, estimate, remaining budget, previous actions, retry behavior, and accumulated [exposure](/glossary#exposure).

## The Approved-Agent Failure Mode

Many production failures do not come from unknown agents. They come from approved agents behaving badly under a specific input, failure mode, or workload spike.

| Approved state | Runtime failure |
|---|---|
| Agent is registered | It loops on a retryable error |
| Owner is assigned | The owner is not paged until the budget is exhausted |
| Tool is approved | The tool is called too many times |
| Key is valid | The key is used outside the intended workflow |
| Policy is documented | The action exceeds the live risk budget |
| Audit is enabled | The log shows what happened after the side effect |

This is why "approved" cannot be the last governance decision.

An approved support agent may be allowed to send customer emails. It should not send 400 emails in one run. An approved coding agent may be allowed to edit source files. It should not use the same authority to modify deployment scripts. An approved research agent may be allowed to call web search. It should not spend the entire tenant budget on one task.

The registry answers whether the agent belongs in the system. [Runtime authority](/glossary#runtime-authority) answers whether this action still belongs in this run.

## The Two-Control-Plane Pattern

The safer pattern is to compose lifecycle governance and runtime authority.

```text
Agent registry
  -> records owner, purpose, lifecycle state, approved toolsets
Runtime authority
  -> evaluates each proposed action against budget, risk, and scope
Tool execution
  -> proceeds only when the live decision allows it
Audit stream
  -> preserves both lifecycle context and runtime decision context
```

That split keeps each layer honest.

The registry should not try to become a high-frequency budget ledger. It is optimized for inventory, review, lifecycle, and compliance workflows.

Runtime authority should not try to become the enterprise system of record for agent ownership. It is optimized for fast, atomic, per-action decisions.

Together, they produce a better control plane than either layer can provide alone.

## What to Pass from Registry to Runtime

The useful integration is not "registry versus runtime." It is "registry metadata attached to runtime decisions."

A runtime authority request can carry:

| Field | Example |
|---|---|
| `agent_id` | `support-refund-agent-prod` |
| Owner | `support-platform-team` |
| Lifecycle state | `approved` |
| Tenant | `acme` |
| Environment | `production` |
| Toolset | `refund.issue` |
| Risk tier | `high` |
| Budget scope | `tenant:acme/workflow:refund/run:4821` |

Some of this metadata is enforcement input; some is audit context. The important part is that it travels with the runtime decision.

The server can then evaluate live policy against a meaningful identity and scope. The audit trail can show not just "a key made a request," but which registered agent, under which tenant, in which workflow, consumed which budget or [RISK_POINTS](/glossary#risk-points).

That is the bridge between lifecycle governance and [runtime authority](/glossary#runtime-authority).

## Incident Response Gets Cleaner

When a registry and runtime ledger are connected, incident response becomes more direct.

The registry tells operators:

- which agent exists
- who owns it
- which environment it runs in
- which credentials and approved toolsets are associated with it
- whether it should be suspended, retired, or reviewed

Runtime authority tells operators:

- which actions were allowed, capped, or denied
- which budget or risk scope was consumed
- whether the incident is isolated to one tenant, workflow, or agent
- whether child agents inherited narrower authority
- whether enforcement stopped the side effect before it happened

That makes fleet operations safer. A registry can help identify the affected population. [Bulk actions](/how-to/using-bulk-actions-for-tenants-and-webhooks) can suspend tenants, pause webhooks, or adjust budgets for that population. Runtime events, balances, and [reservation](/glossary#reservation) records confirm what was allowed, capped, denied, or settled.

## Where Cycles Fits

Cycles is not an agent registry. It does not replace Microsoft Agent 365, an internal CMDB, a marketplace approval flow, or an IAM platform.

Cycles sits at the runtime decision point. It uses scoped budgets, reserve-commit semantics, [idempotency keys](/glossary#idempotency-key), and audit events to decide whether a proposed action remains within bounds.

That makes it complementary to registry systems. The registry defines the agent's intended envelope. Cycles meters and enforces the envelope while the agent runs.

The same pattern appears in [Zero Trust for AI Agents](/blog/zero-trust-for-ai-agents-why-every-tool-call-needs-a-policy-decision): every consequential action needs a policy decision before execution. Registry approval is one input to that decision. It is not the whole decision.

## The Takeaway

Agent registries are becoming necessary enterprise infrastructure. They give teams inventory, ownership, lifecycle state, access review, and audit context.

But runtime governance asks a different question: should this specific next action proceed, given the budget, risk, scope, and history already consumed?

Production systems need both. The registry says what the agent is supposed to be. Runtime authority decides what the agent is still allowed to do.

## Sources

- [Microsoft Learn: Overview of Microsoft Agent 365](https://learn.microsoft.com/en-us/microsoft-agent-365/overview) - agent registry, lifecycle, access control, compliance, and audit positioning
- [Microsoft Security Blog: Zero Trust for AI](https://www.microsoft.com/en-us/security/blog/2026/03/19/new-tools-and-guidance-announcing-zero-trust-for-ai/) - zero trust framing for the AI lifecycle and agent behavior
- [OWASP Top 10 for Agentic Applications 2026](https://genai.owasp.org/resource/owasp-top-10-for-agentic-applications-for-2026/) - agentic risk framework for autonomous systems
- [Zero Trust for AI Agents](/blog/zero-trust-for-ai-agents-why-every-tool-call-needs-a-policy-decision) - local context on pre-execution policy decisions
- [Runtime Authority vs Runtime Authorization](/concepts/runtime-authority-vs-runtime-authorization) - how identity policy and bounded runtime authority compose
- [API Key Management in Cycles](/how-to/api-key-management-in-cycles) - runtime credential scoping and rotation
- [Runtime Authority Byproducts: Audit Trail and Attribution by Default](/blog/runtime-authority-byproducts-audit-trail-and-attribution-by-default) - audit value created by runtime enforcement
