---
title: "Agent Skills Are the New Supply Chain"
date: 2026-05-04
author: Albert Mavashev
tags:
  - security
  - supply-chain
  - agents
  - governance
  - action-control
description: "Agent skills turn reusable workflows into executable supply chain risk. Govern them with inventory, provenance, sandboxing, runtime limits, and audit."
blog: true
sidebar: false
featured: false
head:
  - - meta
    - name: keywords
      content: agent skills security, AI agent supply chain, agentic skills, AI plugin security, tool governance, runtime authority, action control
---

# Agent Skills Are the New Supply Chain

A developer installs a "support triage" skill from a marketplace. The skill has a friendly description, a clean README, and a few scripts. It reads tickets, summarizes customer sentiment, opens Jira issues, and sends Slack updates.

It also has filesystem access, network egress, prompt instructions, tool orchestration logic, and a release channel the platform updates automatically.

That is not just a helper. It is part of the executable supply chain.

The software industry learned to treat packages, containers, and CI actions as supply chain risk because they execute inside trusted environments. Agent skills should be reviewed through the same lens. They are reusable behaviors that tell agents how to plan, which tools to chain, what files to inspect, what data to persist, and when to call out to external systems.

Model-level and MCP-level controls do not cover the whole skill risk surface. The skill layer is where capability turns into workflow.

## Tools Are Capabilities. Skills Are Behavior.

The difference matters:

| Layer | What it defines | Example |
|---|---|---|
| Model | Reasoning and language behavior | Interpret ticket text |
| MCP tool | Available operation | `crm.read_customer`, `jira.create_issue` |
| Skill | Multi-step workflow | Read CRM, summarize, create ticket, notify Slack |
| [Runtime authority](/glossary#runtime-authority) | Whether each next step is still allowed | ALLOW, ALLOW_WITH_CAPS, DENY |

An MCP tool says what can be called. A skill says how to use tools in sequence.

That can make skills riskier than their individual tool list suggests. A read-only CRM tool plus a Slack tool may look safe in isolation. A skill that reads sensitive customer data and posts summaries to a public channel has a different risk profile. The risk lives in orchestration, not only in the tool inventory.

The emerging OWASP Agentic Skills Top 10 project makes a similar separation: MCP is the tool communication layer, while skills encode the behavior layer. That behavior layer needs its own governance.

## The Skill Supply Chain Looks Familiar

Agent skills inherit old software supply chain risks and add agent-specific ones.

| Traditional package risk | Agent skill version |
|---|---|
| Typosquatting | Fake skill impersonates a trusted workflow |
| Dependency confusion | Skill pulls an unexpected helper package or script |
| Malicious update | Clean skill becomes risky after approval |
| Overbroad permissions | Skill asks for filesystem, shell, network, and secrets |
| Hidden side effect | Workflow sends data to an external endpoint |
| Weak isolation | Skill runs with host-level access |
| Poor provenance | No signer, hash, owner, or review record |

The extra agent-specific problem is that instructions are executable in a softer way than code. A skill can change behavior through Markdown, YAML, prompt templates, examples, memory files, tool descriptions, or scripts. Review has to cover both code and instructions.

That is why install-time scanning is incomplete by itself. You also need to know what the skill can do at runtime.

## A Skill Manifest Should Be Treated Like a Contract

Every production skill should have a manifest that a human reviewer and an enforcement layer can understand.

A useful manifest includes:

| Manifest field | Purpose |
|---|---|
| Name and version | Stable inventory and pinning |
| Publisher and signer | Provenance and trust |
| Owner | Internal accountability |
| Toolsets requested | Capability review |
| Data classes accessed | Privacy and compliance review |
| Network destinations | Egress control |
| Filesystem scope | Local blast radius |
| Risk tier | Runtime budget sizing |
| Update policy | Pin, review, auto-update, or block |
| Emergency disable path | Incident response |

This is not paperwork. It is the input to policy.

If a skill declares `toolset:slack` and `toolset:crm`, the runtime can budget those separately. If it declares production write access, the risk score should be higher. If it declares external network egress, the approval path should be different from a local summarization skill.

The manifest is the bridge between supply-chain review and runtime enforcement.

## Runtime Limits Catch What Review Misses

Static review is necessary, but it does not cover runtime behavior.

A skill can be safe at install time and unsafe under a specific input. A clean skill can be prompt-injected through a ticket body. A minor update can add a new tool chain. A dependency can drift. A legitimate workflow can loop.

Runtime authority gives each skill a budgeted execution envelope:

| Runtime control | What it limits |
|---|---|
| Per-run budget | Total model or API spend for one invocation |
| Toolset [RISK_POINTS](/glossary#risk-points) | High-blast-radius action allowance |
| Tenant scope | Which customer's budgets and data are reachable |
| ALLOW_WITH_CAPS | Degrade to safer behavior before hard denial |
| DENY | Stop an action before the side effect |
| Audit trail | Preserve why each action was allowed or blocked |

The important property is that the skill does not control the budget ledger. It can propose the next action, but it cannot grant itself more authority to take that action.

That is the same pattern behind [AI Agent Action Control](/blog/ai-agent-action-control-hard-limits-side-effects): classify actions by blast radius, assign RISK_POINTS, and enforce before execution.

## Inventory Is an Incident Response Primitive

When a skill compromise is reported, the first operator question is not "what is a skill?" It is:

- Where is this skill installed?
- Which tenants use it?
- Which agents can invoke it?
- Which toolsets does it request?
- Which versions are pinned?
- Which executions happened after the bad version appeared?
- Can we disable it without taking down unrelated workflows?

If the platform cannot answer those questions, the incident response plan becomes manual investigation.

That is why inventory, provenance, and runtime logs belong together. The supply-chain system tells you where the skill is. Runtime authority tells you what it did and what it was blocked from doing. Bulk operations give you a way to disable or constrain affected tenants and workflows without writing a one-off production script.

For the operator side of that response, see [Using Bulk Actions for Tenants, Webhooks, and Budgets](/how-to/using-bulk-actions-for-tenants-and-webhooks).

## A Practical Governance Model

A production skill governance model can start small:

1. **Inventory every installed skill.** Include owner, version, source, signer, and allowed environments.
2. **Pin versions by default.** Allow auto-updates for low-risk skills only when rollback is available.
3. **Require manifests.** Toolsets, data classes, egress, filesystem scope, and risk tier should be explicit.
4. **Review scripts and natural-language instructions.** Markdown, YAML, examples, and prompts can change behavior just like code.
5. **Sandbox execution.** Separate filesystem, network, and secret access from the host where possible.
6. **Assign RISK_POINTS by toolset.** Reads, writes, external sends, and production mutations should not share one pool.
7. **Run new skills in shadow mode.** Observe what would be denied before hard enforcement.
8. **Create an emergency disable lane.** Operators need one path to pause a skill across affected scopes.

This sequence avoids the two common extremes: trusting marketplace skills because they are convenient, or banning all skills because they are risky. The production answer is managed adoption with bounded authority.

## The Takeaway

Agent skills are not just prompts, plugins, or convenience wrappers. They are executable workflow supply chain. In production, they need provenance, manifests, sandboxing, version pinning, runtime limits, audit trails, and incident-response controls.

The skill decides what the agent should try next. Runtime authority decides whether the next action is still allowed.

That separation is what makes skills usable in production.

## Sources

- [OWASP Agentic Skills Top 10](https://owasp.org/www-project-agentic-skills-top-10/) - skill-layer risks, governance checklist, and behavior-layer framing
- [OWASP Agentic Skills Security Assessment Checklist](https://owasp.org/www-project-agentic-skills-top-10/checklist.html) - script and natural-language instruction review guidance
- [OWASP Top 10 for Agentic Applications 2026](https://genai.owasp.org/resource/owasp-top-10-for-agentic-applications-for-2026/) - broader agentic risk framework
- [Microsoft Security Blog: Addressing OWASP Top 10 Risks in Agentic AI](https://www.microsoft.com/en-us/security/blog/2026/03/30/addressing-the-owasp-top-10-risks-in-agentic-ai-with-microsoft-copilot-studio/) - lifecycle governance and deployed-agent controls
- [MCP Tool Poisoning Has an 84% Success Rate](/blog/mcp-tool-poisoning-why-agent-frameworks-cant-prevent-it) - tool metadata and supply-chain attack context
- [AI Agent Risk Assessment](/blog/ai-agent-risk-assessment-score-classify-enforce-tool-risk) - scoring tool risk before production
- [Shadow Mode to Hard Enforcement](/blog/shadow-to-enforcement-cutover-decision-tree) - signal-driven cutover from observe-only to blocking
- [Webhook Event Delivery Protocol](/protocol/webhook-event-delivery-protocol) - event delivery reliability for governance signals
