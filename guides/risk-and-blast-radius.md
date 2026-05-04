---
title: "AI Agent Risk & Blast Radius: A Production Reference"
description: "A reference map of bounding what an AI agent can do — risk scoring, action authority, blast-radius containment, degradation paths, and the runtime patterns that keep a single mistake from becoming an incident."
---

# AI Agent Risk & Blast Radius: A Production Reference

Cost is one dimension of runtime authority. The other — and the one that tends to produce the most damaging incidents — is **action authority**: bounding *what* an agent is permitted to do, not just how much it can spend doing it. A single agent action — a deploy, a refund, a deletion, an email blast to the wrong list — can cost more in damage than the agent's entire month of LLM bills. This guide covers risk scoring, blast-radius containment, and the patterns that keep a single mistake from cascading into an incident.

> **This is the action / damage dimension of runtime authority.** For the cost / spend dimension, see [LLM Cost Runtime Control Reference](/guides/llm-cost-runtime-control). For the full product framing across all dimensions, see [Why Cycles](/why-cycles).

> **Quantify it for your agent.** [Open the blast-radius risk calculator →](/calculators/ai-agent-blast-radius-standalone) — name your agent, define its action classes by reversibility and visibility, and see the monthly blast radius. Share the configured view with a teammate.

If you are debugging a live action incident, jump straight to the [Incident Patterns](/incidents/runaway-agents-tool-loops-and-budget-overruns-the-incidents-cycles-is-designed-to-prevent) catalog.

## Why action authority is structurally different from cost control

Cost is a continuous variable: every call shaves a fraction of a budget. Action damage is discrete and sometimes irreversible. A 100,001st LLM call costs 0.01% more than a 100,000th. A first deletion of the wrong table costs everything. Tools built around cost curves — alerting, monitoring, and rate limits — are weak against this second class because action damage is often discrete, not gradual.

- [What Is Runtime Authority for AI Agents?](/blog/what-is-runtime-authority-for-ai-agents) — the foundational concept
- [Beyond Budget: How Cycles Controls Agent Actions](/blog/beyond-budget-how-cycles-controls-agent-actions) — why budget alone is insufficient
- [Runtime Authority vs Guardrails vs Observability](/blog/runtime-authority-vs-guardrails-vs-observability) — the three layers, what each does, what each cannot do

## Action authority: the core concept

Action authority is the runtime decision: "given who this agent is, what it has already done, and what it is asking to do now — should this action be allowed?" That decision happens *before* the side effect, not after.

- [Action authority: controlling what agents do](/concepts/action-authority-controlling-what-agents-do) — the protocol-level model
- [Runtime authority vs authorization](/concepts/runtime-authority-vs-runtime-authorization) — the distinction from per-request auth
- [AI Agent Action Control: Hard Limits on Side Effects](/blog/ai-agent-action-control-hard-limits-side-effects)
- [AI Agent Runtime Permissions: Control Actions Before Execution](/blog/ai-agent-runtime-permissions-control-actions-before-execution)
- [AI Agent Action Authority: Blocking a Customer Email Before Execution](/blog/action-authority-demo-support-agent-walkthrough) — concrete walkthrough

## Risk scoring: not all actions are equal

Reading a file is not the same as sending a refund or executing arbitrary code. Risk needs to be quantified per action class so authority decisions can be made by *risk*, not by call count.

- [AI Agent Risk Assessment: Score, Classify, Enforce Tool Risk](/blog/ai-agent-risk-assessment-score-classify-enforce-tool-risk)
- [Assigning RISK_POINTS to agent tools](/how-to/assigning-risk-points-to-agent-tools) — the implementation pattern
- [Understanding units in Cycles](/protocol/understanding-units-in-cycles-usd-microcents-tokens-credits-and-risk-points) — how risk points sit alongside USD and tokens

## Blast radius: containing damage when something does fire

Even with risk scoring and authority gates, things will fail. Blast-radius design asks: *when* an agent does something wrong, how far can the damage propagate before it is contained? Per-tenant boundaries, per-run budgets, and per-action caps each cap a different blast direction.

- [Multi-tenant SaaS guide](/how-to/multi-tenant-saas-with-cycles) — tenant isolation as blast-radius containment
- [Multi-Tenant AI Cost Control: Budgets and Isolation](/blog/multi-tenant-ai-cost-control-per-tenant-budgets-quotas-isolation)
- [Concurrent agent overspend](/incidents/concurrent-agent-overspend) — the canonical concurrency-blast incident

## High-risk action classes

Some action classes carry asymmetric damage. Each deserves an explicit policy at the authority layer rather than inheriting the default for every other tool the agent has.

- [Cursor AI Agent Reportedly Deleted a Production Database in 9 Seconds](/blog/ai-agent-deleted-prod-database-9-seconds) — the canonical disaster
- [AI Agent Silent Failures: Why 200 OK Is the Most Dangerous Response](/blog/ai-agent-silent-failures-why-200-ok-is-the-most-dangerous-response) — the failure mode that hides damage

## Degradation paths: deny, downgrade, disable, defer

When the authority layer says no, what should the agent do next? Outright denial is sometimes correct, but in many cases a graceful degradation — a smaller model, a smaller scope, a deferred action, a disabled feature — preserves the user experience while bounding the risk.

- [When Budget Runs Out: AI Agent Degradation Patterns](/blog/when-budget-runs-out-graceful-degradation-patterns-for-ai-agents)
- [Degradation paths: deny, downgrade, disable, defer](/how-to/how-to-think-about-degradation-paths-in-cycles-deny-downgrade-disable-or-defer)
- [Caps and the three-way decision model](/protocol/caps-and-the-three-way-decision-model-in-cycles) — protocol-level decision shapes

## Authority attenuation across delegation chains

Agent systems often delegate to sub-agents or tool-using sub-routines. A naive design propagates trust forward; a safe design *attenuates* authority — each layer gets less than the layer that called it, and the policy decision is made fresh at each boundary.

- [Agent Delegation Chains Need Authority Attenuation, Not Trust Propagation](/blog/agent-delegation-chains-authority-attenuation-not-trust-propagation)
- [Zero Trust for AI Agents: Why Every Tool Call Needs a Policy Decision](/blog/zero-trust-for-ai-agents-why-every-tool-call-needs-a-policy-decision)
- [Agents Are Cross-Cutting. Your Controls Aren't.](/blog/agents-are-cross-cutting-your-controls-arent) — why per-service auth does not bound a multi-service agent

## Why framework guardrails are not enough

Agent frameworks (LangChain, LangGraph, CrewAI, AutoGen, OpenAI Agents SDK, etc.) provide orchestration primitives, content guardrails, middleware, and tool-calling patterns. What they usually do not provide is a cross-agent, cross-tenant, ledger-backed runtime authority layer for budget, risk, and action decisions. The policy decision still has to happen, and it has to happen outside the agent loop.

- [OpenAI Agents SDK: Content Guardrails, No Action Control](/blog/openai-agents-sdk-has-guardrails-for-content-but-nothing-for-actions)
- [MCP Tool Poisoning Has an 84% Success Rate — Why Agent Frameworks Still Can't Prevent It](/blog/mcp-tool-poisoning-why-agent-frameworks-cant-prevent-it)

## Identity, keys, and least privilege

Every agent action ultimately resolves to a credential at the call site. Authority bounds what an agent is allowed to attempt; least-privilege keys bound what the underlying API will let the agent do *if* it tries. They are complementary layers.

- [Least-Privilege API Keys for AI Agents](/blog/least-privilege-api-keys-for-ai-agents)
- [API key management in Cycles](/how-to/api-key-management-in-cycles)

## Audit trail and attribution

Authority decisions create an audit trail by side effect: every allow/deny, every degraded action, every reservation that was made and committed or rolled back. That audit is the substrate for compliance, post-incident review, and tenant-level reporting.

- [The AI Agent Audit Trail You're Already Building](/blog/runtime-authority-byproducts-audit-trail-and-attribution-by-default)
- [Operational Runbook: Using Cycles Runtime Events](/blog/operational-runbook-using-cycles-runtime-events)

## Compliance and governance frameworks

Risk and blast-radius design is not just an engineering concern. NIST AI RMF, the EU AI Act, ISO 42001, and OWASP guidance increasingly push teams toward demonstrable controls, traceability, and evidence — not just intent or policy documents.

- [The AI Agent Governance Framework: Mapping NIST, EU AI Act, ISO 42001, and OWASP](/blog/ai-agent-governance-framework-nist-eu-ai-act-iso-42001-owasp-runtime-enforcement)
- [State of AI Agent Governance 2026](/blog/state-of-ai-agent-governance-2026)

## Rolling out enforcement without breaking production

Adding an authority gate to an existing agent system is the riskiest deployment. Shadow mode lets the gate run in observe-only mode against real traffic so policies can be calibrated before any action is denied.

- [Shadow Mode rollout](/how-to/shadow-mode-in-cycles-how-to-roll-out-budget-enforcement-without-breaking-production)
- [Shadow Mode to Hard Enforcement: The Cutover Decision Tree](/blog/shadow-to-enforcement-cutover-decision-tree)

## Incidents this is built to prevent

Most agent damage clusters into a small number of patterns. Recognizing the pattern is half the work.

- [Runaway agents and tool loops](/incidents/runaway-agents-tool-loops-and-budget-overruns-the-incidents-cycles-is-designed-to-prevent)
- [Concurrent agent overspend](/incidents/concurrent-agent-overspend)
- [The State of AI Agent Incidents (2026)](/blog/state-of-ai-agent-incidents-2026)

## The complement guides

This guide focuses on what an agent is allowed to *do*. For what an agent is allowed to *spend*, see [LLM Cost Runtime Control Reference](/guides/llm-cost-runtime-control). For *who* owns which budget under shared infrastructure, see [Multi-Tenant AI Operations Reference](/guides/multi-tenant-operations). Most production incidents touch at least two of the three.
