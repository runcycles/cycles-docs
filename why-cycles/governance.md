---
title: "Prove to Auditors Your Agents Are Under Control"
description: "Auditors ask how you control your AI agents. Dashboards show what happened. Cycles answers: pre-execution enforcement with a structured audit trail."
---

# Prove to an Auditor That Your Agents Are Under Control

An auditor asks how you govern your AI agents. You show a monitoring dashboard — cost graphs, token counts, action logs. They ask: "What prevents the agent from taking an unauthorized action before the dashboard updates?"

You don't have an answer. The dashboard shows what happened. It does not prevent what should not happen. For high-risk or tightly governed AI uses, observation alone is not governance.

## Why existing controls don't satisfy auditors

**Monitoring dashboards are post-hoc.** They record what happened — after it happened. For AI agents that qualify as high-risk AI systems, the EU AI Act's [Article 14](/blog/ai-agent-governance-framework-nist-eu-ai-act-iso-42001-owasp-runtime-enforcement) requires human oversight, including the ability to intervene in or interrupt the system's operation. A dashboard that shows a cost spike at 2 AM is not, by itself, a runtime interruption mechanism.

**Provider spending caps are fragmented and have no audit trail.** A single agent workflow can span multiple providers — OpenAI for reasoning, Anthropic for code generation, Google for search, plus external APIs for tools. Each provider has its own spending cap, but no single cap sees the total workflow cost. When OpenAI's monthly limit fires, it blocks the entire organization — while spend on Anthropic and Google continues unchecked. There is no record of which tenant, which workflow, or which agent triggered the limit. An auditor cannot trace a spending event to a responsible scope — because each provider's cap only sees its own slice.

**Prompt-level guardrails are suggestions, not enforcement.** A system prompt that says "do not send more than 10 emails" is an instruction to a probabilistic model. It is not a control. An auditor asks: "Can the agent violate this rule?" If the answer is "yes, if the model decides to," it is not an auditable control point.

## How Cycles provides auditable enforcement

Every budget operation in Cycles — every [reservation, commit, release, and event](/protocol/how-events-work-in-cycles-direct-debit-without-reservation) — produces a structured record with amount, timestamp, and status. Each record can carry up to six levels of scope context — tenant, workspace, app, workflow, agent, and toolset — depending on how your integration populates the subject hierarchy.

The scope hierarchy maps directly to organizational accountability. Tenant = business unit or customer. Workspace = environment. Workflow = process or run. An auditor can trace any action to the budget scope that authorized it — without reconstructing the chain from scattered application logs.

```bash
# Which agent spent how much, on what, and when?
curl -s "http://localhost:7878/v1/reservations?tenant=acme-corp&status=COMMITTED" \
  -H "X-Cycles-API-Key: $CYCLES_API_KEY"
```

The event log is queryable two ways: through the [Cycles Admin Dashboard](/how-to/using-the-cycles-dashboard) — a dedicated **Audit** view with `resource_type`, `resource_id`, and time-window filters, CSV / JSON export, and `trace_id` correlation pivots into the Events view — and through the REST API for programmatic pipelines. Keep hot retention for operational queries and export events to cold storage for long-term compliance, depending on your deployment configuration. Self-hosted deployments keep all data within your infrastructure — nothing leaves your network.

## What happens now

- **Every action is recorded before execution.** The reservation creates a pre-execution control record, and the full audit trail is completed by commit, release, and event records. The evidence exists before and after the action runs — not reconstructed from logs after an incident.
- **Scope hierarchy maps to organizational accountability.** Tenant, workspace, workflow, agent — each level maps to a responsible party. Auditors can trace any action to the budget scope that authorized it.
- **Pre-execution denial is provable.** When a budget is exhausted, the reservation is denied and the action never executes. The denial itself is a record — proof the control worked.
- **Retention and export are configurable.** Hot storage for operational queries, queryable via dashboard or API, exportable to cold storage for long-term compliance — sized to your deployment. No log pipeline to build.

## The difference

| | Without Cycles | With Cycles |
|---|---|---|
| Audit trail | Reconstructed from scattered logs after incident | Structured record per action, queryable via API |
| Cost visibility | Fragmented across provider dashboards | Unified budget per tenant/workflow/run, all providers |
| Stop mechanism | Dashboard alert → human checks Slack | Budget exhaustion → DENY before execution |
| Scope attribution | "Something spent $4,200" | "tenant:acme/workflow:run-123 spent $4,200" |
| Auditor evidence | Screenshots of monitoring dashboards (post-hoc observation) | Audit view with structured filters + CSV/JSON export, or REST API |
| Time to produce audit report | Days of log reconstruction | Filter the Audit view, export — or a single API query |

## Regulatory context

The applicability of these frameworks depends on your system's risk classification, jurisdiction, and intended use. Cycles provides the runtime enforcement layer — one component of the governance infrastructure these frameworks require, not the full organizational governance system.

| Framework | What it requires | What Cycles provides |
|---|---|---|
| EU AI Act Art. 9 (high-risk systems) | Risk management system throughout lifecycle | Hierarchical budgets bound cost and action risk per scope |
| EU AI Act Art. 12 (high-risk systems) | Automatic logging for traceability | Cycles contributes runtime enforcement records: reservations, commits, denials, events, scope, timestamp, and status |
| EU AI Act Art. 14 (high-risk systems) | Human oversight / intervention mechanisms | Budget exhaustion produces a `DENY` that stops execution before the action runs — one runtime control point in a broader oversight design |
| NIST AI RMF — Map | Identify context and risk surfaces | Scope hierarchy + [RISK_POINTS](/concepts/action-authority-controlling-what-agents-do) classify tool-level blast radius |
| NIST AI RMF — Manage | Enforce limits, degrade gracefully | Reserve-commit gate enforces limits before execution |
| ISO 42001 | AI management system with documented controls | Budget policies and event logs serve as documented, enforceable controls |

For the full regulatory mapping — including OWASP Top 10 for Agentic Applications and SOC 2 Trust Service Criteria — see the [AI Agent Governance Framework](/blog/ai-agent-governance-framework-nist-eu-ai-act-iso-42001-owasp-runtime-enforcement).

## Go deeper

- [AI Agent Governance Framework](/blog/ai-agent-governance-framework-nist-eu-ai-act-iso-42001-owasp-runtime-enforcement) — mapping NIST, EU AI Act, ISO 42001, and OWASP to runtime controls
- [AI Agent Risk Assessment](/blog/ai-agent-risk-assessment-score-classify-enforce-tool-risk) — tool-level risk scoring methodology with worksheet template
- [Zero Trust for AI Agents](/blog/zero-trust-for-ai-agents-why-every-tool-call-needs-a-policy-decision) — why every tool call needs a policy decision
- [Security Overview](/security) — audit trail, access control, and data residency
- [Event Log API](/protocol/how-events-work-in-cycles-direct-debit-without-reservation) — how events and audit records work
