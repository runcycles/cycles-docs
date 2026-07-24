---
title: "AI Agents: EU AI Act, NIST, ISO 42001, OWASP Map"
date: 2026-04-02
author: Cycles Team
tags: [governance, compliance, EU AI Act, NIST, ISO 42001, OWASP, runtime-authority, agents]
description: "Map EU AI Act, NIST AI RMF, ISO 42001, and OWASP regulatory requirements to runtime enforcement controls — a practical governance framework for AI agents."
blog: true
sidebar: false
featured: true
head:
  - - meta
    - name: keywords
      content: AI agent governance framework, EU AI Act, NIST AI RMF, ISO 42001, OWASP agent security, runtime enforcement
---

# AI Agent Governance: Mapping NIST, EU AI Act, ISO 42001, and OWASP to Runtime Enforcement

> **Part of: [AI Agent Risk & Blast Radius Reference](/guides/risk-and-blast-radius)** — the full pillar covering action authority, risk scoring, blast-radius containment, and degradation paths.

Regulations, management-system standards, and security guidance address different parts of AI governance. Depending on a system's role, risk classification, and use case, teams may need records, risk treatment, human oversight, security controls, or some combination of them.

The EU AI Act's high-risk obligations were rescheduled by the Digital Omnibus adopted in June 2026 — Annex III systems now apply from December 2, 2027 — while [Article 50 transparency and GPAI enforcement still land on August 2, 2026](/blog/eu-ai-act-what-actually-happens-august-2-2026). Organizations can already pursue certification of an AI management system against ISO/IEC 42001, with [ISO/IEC 42006:2025](https://www.iso.org/standard/42006) defining requirements for certification bodies. NIST's AI Risk Management Framework was published in January 2023. OWASP published its [Top 10 for Agentic Applications](https://genai.owasp.org/resource/owasp-top-10-for-agentic-applications-for-2026/) in late 2025. And in February 2026, NIST launched its [AI Agent Standards Initiative](https://www.nist.gov/news-events/news/2026/02/announcing-ai-agent-standards-initiative-interoperable-and-secure) — a direct signal that autonomous systems need governance infrastructure beyond what model-level controls provide.

The gap is not awareness. Teams know governance matters. The gap is implementation: **how do you translate regulatory requirements into enforceable runtime controls?**

This post maps selected obligations and guidance to possible runtime controls — and introduces an engineering maturity model that can feed a broader governance or compliance program.

<!-- more -->

## The Regulatory Landscape for AI Agents in 2026

Four prominent frameworks shape how teams approach autonomous AI systems. Their legal status and scope differ: the EU AI Act is law, NIST AI RMF and OWASP are voluntary guidance, and ISO/IEC 42001 specifies a certifiable organizational management system. Runtime controls can support each program, but none of these sources uniformly requires the seven Cycles-oriented controls described later.

### EU AI Act (Regulation 2024/1689)

The EU AI Act entered into force on August 1, 2024. Its high-risk AI system obligations were originally scheduled to apply from August 2, 2026, but the Digital Omnibus on AI — approved by the Council on June 29, 2026 — moved standalone Annex III systems to **December 2, 2027** and high-risk AI embedded in Annex I regulated products to **August 2, 2028**. Article 50 transparency obligations and Commission enforcement powers over general-purpose AI providers still take effect August 2, 2026; [this post breaks down what applies when](/blog/eu-ai-act-what-actually-happens-august-2-2026). The Act does not use the term "AI agent." It regulates "AI systems" — and whether an agent qualifies as high-risk depends on its intended purpose and whether it falls under an [Annex I or Annex III use case](https://ai-act-service-desk.ec.europa.eu/en/faq). AI agents are not a separate legal category.

For AI agents that qualify as high-risk AI systems, five articles create direct obligations:

**Article 9 — Risk Management System.** Providers of high-risk AI systems must establish a continuous, iterative risk management system throughout the system's lifecycle. This includes identifying foreseeable risks, estimating their severity, and adopting measures to eliminate or mitigate them. For agents, "foreseeable risks" include runaway cost spirals, unauthorized actions, and cascading failures across multi-agent workflows — precisely the failure modes documented in [5 AI Agent Failures Budget Controls Would Prevent](/blog/ai-agent-failures-budget-controls-prevent) and [5 Failures Only Action Controls Would Prevent](/blog/ai-agent-action-failures-runtime-authority-prevents).

**Article 12 — Record-Keeping.** High-risk AI systems must technically allow automatic recording of events over the system lifetime, with logging capabilities appropriate to the system's intended purpose. Specific minimum content applies to some systems, including certain biometric systems. For an agent deployment, teams must determine which system and application records provide the required traceability; Cycles budget [reservation](/glossary#reservation) records can contribute but do not capture complete tool arguments, authorization rationale, or external outcomes.

**Article 13 — Transparency.** Systems must operate with sufficient transparency that deployers can interpret and use the system's output appropriately. For agents, this means the human operator must be able to understand what the agent is doing, why it was allowed to do it, and what constraints are in effect.

**Article 14 — Human Oversight.** High-risk AI systems must be designed to allow effective human oversight, including the ability to understand capabilities and limitations, monitor operation, interpret outputs, and — critically — **interrupt the system's operation via a stop mechanism.** An agent that cannot be stopped mid-execution, or that degrades catastrophically when stopped, fails this requirement.

**Article 15 — Accuracy, Robustness, and Cybersecurity.** Systems must achieve appropriate levels of resilience to errors, faults, and inconsistencies, and must be protected against unauthorized manipulation. For agents operating in multi-[tenant](/glossary#tenant) environments, this means one tenant's agent cannot compromise another tenant's data or budget.

### NIST AI Risk Management Framework (AI RMF 1.0)

Published January 26, 2023, the [NIST AI RMF](https://www.nist.gov/publications/artificial-intelligence-risk-management-framework-ai-rmf-10) defines four core functions: **Govern, Map, Measure, Manage.** It is voluntary, sector-agnostic guidance.

For an agent deployment, a team can apply the four functions along these lines:

| RMF Function | Agent Governance Requirement |
|---|---|
| **Govern** | Define who can deploy agents, what budgets apply, what actions are allowed |
| **Map** | Identify risk surfaces: tool access, cost [exposure](/glossary#exposure), multi-tenant blast radius |
| **Measure** | Track cost variance, action frequency, budget utilization, policy violations |
| **Manage** | Enforce limits, degrade gracefully under constraint, stop agents when necessary |

The February 2026 [AI Agent Standards Initiative](https://www.nist.gov/news-events/news/2026/02/announcing-ai-agent-standards-initiative-interoperable-and-secure) extends this further, signaling that NIST considers [autonomous agents](/glossary#autonomous-agent) a distinct governance challenge that existing frameworks address only partially.

### ISO/IEC 42001:2023 — AI Management System

Published December 2023, [ISO/IEC 42001](https://www.iso.org/standard/42001) specifies requirements for an AI management system (AIMS). It is certifiable — meaning organizations can be audited against it and receive formal certification, similar to ISO 27001 for information security.

Key control areas relevant to AI agents:

- **AI risk assessment and treatment** — requires identifying risks specific to AI systems and implementing controls proportionate to impact. For agents, this includes cost risk, action risk, and delegation risk.
- **AI system lifecycle management** — requires governance throughout development, deployment, operation, and retirement. Agents that run continuously or spawn sub-agents need lifecycle controls that operate at runtime, not just at deployment.
- **Data governance** — requires controls on data used by and generated by AI systems. Agents that access customer data across tenants need isolation guarantees.
- **Third-party management** — requires governance of AI components from external providers. Agents calling external APIs and MCP tools introduce third-party risk at every tool invocation.

ISO 42001 does not prescribe specific technical controls. It requires that you have them, that they are documented, and that they are auditable.

### OWASP Top 10 for Agentic Applications

The [OWASP Top 10 for Agentic Applications](https://genai.owasp.org/resource/owasp-top-10-for-agentic-applications-for-2026/) identifies the ten most critical security risks in production agent systems. Unlike the other frameworks, OWASP is prescriptive about specific attack vectors:

| ID | Risk | Governance Implication |
|---|---|---|
| **ASI01** | Agent Goal Hijack | Actions must be validated against declared intent |
| **ASI02** | Tool Misuse and Exploitation | Per-tool permission checks, not blanket access |
| **ASI03** | Identity and Privilege Abuse | Scoped credentials, least-privilege enforcement |
| **ASI04** | Agentic Supply Chain Vulnerabilities | Tool invocation gated by allow-lists and risk scoring |
| **ASI05** | Unexpected Code Execution (RCE) | Sandboxed execution environments, tool allowlists |
| **ASI06** | Memory & Context Poisoning | Context integrity validation, memory access controls |
| **ASI07** | Insecure Inter-Agent Communication | Authenticated channels, message integrity verification |
| **ASI08** | Cascading Failures | Per-agent isolation, hierarchical budgets |
| **ASI09** | Human-Agent Trust Exploitation | Explicit consent boundaries, action confirmation for high-risk operations |
| **ASI10** | Rogue Agents | Runtime detection and blocking of out-of-policy behavior |

OWASP's principle of **least agency** — granting agents only the minimum autonomy required for safe, bounded tasks — is the security analog of budget enforcement. Both constrain what an agent can do before it does it.

Runtime enforcement directly addresses ASI01 (goal hijack via action validation), ASI02 (tool misuse via permission checks), ASI03 (privilege abuse via scoped access), ASI04 (supply chain via tool allow-lists), ASI08 (cascading failures via scope isolation), and ASI10 (rogue agents via policy enforcement). The remaining four — ASI05 (code execution), ASI06 (memory poisoning), ASI07 (inter-agent communication), and ASI09 (human trust exploitation) — require complementary controls at the execution, memory, and interaction layers.

## The AI Agent Governance Maturity Model

Most teams are somewhere between "we have dashboards" and "we have enforcement." This maturity model describes a progression in runtime-control capability. It does not determine whether a legal or certification requirement is met.

### Level 0: No Governance

Agents run unbounded. No cost limits, no action controls, no audit trail beyond application logs. Teams discover problems through invoices and incident reports.

**Evidence gap:** This level supplies none of the runtime budget evidence discussed in this post. Overall legal or standards conformity still depends on the system's scope and the organization's other controls.

### Level 1: Visibility

Teams deploy observability tooling — [Langfuse](https://langfuse.com/), [LangSmith](https://smith.langchain.com/), provider dashboards. Trace-only deployments reconstruct what agents did after the fact; some products also offer gateway controls, and reporting latency varies by configuration.

**What this can support:** Article 12 record-keeping and NIST Measure activities, if the retained records have the content, scope, and quality the system requires.

**What this does not provide by itself:** A runtime stop mechanism, risk treatment, or the broader processes required by Article 9, Article 14, or ISO/IEC 42001.

### Level 2: Policy

Teams define governance policies: "agents should not spend more than $10 per run," "agents should not send more than 50 emails." Policies exist in documentation, runbooks, or configuration files. Enforcement is manual — humans review dashboards and intervene.

**What this can support:** NIST Govern activities and documented-control elements of an ISO/IEC 42001 program.

**What this does not provide by itself:** Automated enforcement. A policy that depends on a human noticing a dashboard at 2 AM on a Saturday does not prevent a limit breach before intervention. [The checked runaway-loop model](/blog/ai-agent-failures-budget-controls-prevent) illustrates that gap.

### Level 3: Soft Enforcement

Teams implement rate limits, provider cost controls, or application-level counters. These provide useful constraints but have different boundaries: request-count limits control velocity rather than cumulative spend; provider budgets, credits, and quotas use vendor-defined scopes; and non-atomic application counters can [break under concurrency](/blog/vibe-coding-budget-wrapper-vs-budget-authority).

**What this can support:** Risk-mitigation and NIST Manage activities through some automated response.

**What this does not provide by itself:** An atomic shared budget across providers and concurrent workers, a complete system stop mechanism, or a comprehensive action audit trail. The gaps are described in [Why Rate Limits Are Not Enough](/concepts/why-rate-limits-are-not-enough-for-autonomous-systems) and [Cycles vs. Provider Spending Caps](/concepts/cycles-vs-provider-spending-caps).

### Level 4: Runtime Authority

Pre-execution enforcement with atomic budget operations. Every protected action the host instruments passes through a reserve-commit gate before execution. Budgets can follow the protocol subject hierarchy (tenant → workspace → app → workflow → agent → toolset). The application can classify action exposure and submit it as `RISK_POINTS`. Cycles records the budget lifecycle; a complete action audit trail still requires correlated application authorization and outcome logs.

**How these runtime controls can contribute:**

| Requirement | Runtime contribution and boundary |
|---|---|
| Article 9 — Risk management | Budgets and caller-assigned risk-point caps can implement selected cost and exposure treatments within a broader risk-management system |
| Article 12 — Record-keeping | Persisted budget operations and emitted events provide structured lifecycle records; application logs must supply action and outcome context |
| Article 13 — Transparency | Budget state is queryable; hosts can expose constraints alongside the other information deployers need |
| Article 14 — Human oversight | A host can stop an instrumented action on a rejected reservation and can apply configured caps; this is one control in a broader oversight design |
| Article 15 — Robustness | Atomic budget operations prevent concurrent overspend within configured scopes; they do not provide data or credential isolation |
| NIST Govern/Map/Measure/Manage | Runtime infrastructure operationalizes key parts of all four functions (GOVERN also requires organizational policies, competencies, and lifecycle processes beyond any single runtime mechanism) |
| ISO 42001 | Runtime records can contribute evidence for selected documented controls; ISO/IEC 42001 is an organization-wide management system, so Cycles does not establish AIMS conformity |
| OWASP Agentic Top 10 | Budgets can bound cumulative submitted exposure; identity, tool allowlists, argument validation, sandboxing, and other listed mitigations remain separate controls |

This is the level where [runtime authority](/blog/what-is-runtime-authority-for-ai-agents) operates — and where Cycles provides the infrastructure.

### Level 5: Continuous Compliance

Level 4 plus automated compliance reporting, drift detection, and integration with GRC (governance, risk, and compliance) tooling. Event logs export to SIEM systems. Budget policies are versioned and audited. Compliance posture is measured continuously, not assessed annually.

**What this adds:** Proactive compliance management rather than reactive audit preparation. This is the destination for teams pursuing ISO 42001 certification or SOC 2 Type II attestation for their AI systems.

## The Seven Controls

The following seven controls are a practical engineering model for bounded agent operations. They can support parts of the frameworks above, but the mappings are interpretive and do not establish compliance.

### Control 1: Pre-Execution Budget Enforcement

**Framework connection:** This control can serve as one Article 9 risk treatment, one NIST Manage response, or one documented technical control in an ISO/IEC 42001 program when it matches the organization's assessed risks.

**What "good" looks like:** Before every protected LLM call and tool invocation, the integration atomically checks whether budget remains and reserves the estimated cost. If the reservation is rejected, the host does not execute the action.

**What happens without it:** In an illustrative model, a coding agent [loops 240 times over three hours](/blog/ai-agent-failures-budget-controls-prevent), costing $52.80 under the stated token assumptions. A dashboard can show that spend without stopping it.

**How Cycles implements it:** The [reserve-commit protocol](/protocol/how-reserve-commit-works-in-cycles) locks estimated cost before execution and releases unused budget on commit. Wire units are `USD_MICROCENTS`, `TOKENS`, `CREDITS`, and `RISK_POINTS`, enforced at any configured subject scope. A team can model call counts with `CREDITS`; `CALLS` is not a protocol unit.

### Control 2: Action-Level Risk Scoring

**Framework connection:** Risk classification and treatment can support Article 9 risk management, while application-side tool authorization and exposure budgets can support OWASP least-agency and ASI02 mitigations.

**What "good" looks like:** Each action type has an assigned risk score. High-consequence actions (email, deploy, delete, payment) consume more risk budget than low-consequence ones (read, search, summarize). An agent can reason freely but is constrained on dangerous operations.

**What happens without it:** In an [illustrative scenario](/blog/ai-agent-action-control-hard-limits-side-effects), 200 mistaken emails have about $1.40 in modeled token spend but potentially much larger, unquantified external impact. A monetary budget calibrated to [tokens](/glossary#tokens) does not validate message content or recipient authorization.

**How Cycles implements it:** [RISK_POINTS](/concepts/action-authority-controlling-what-agents-do) — budgets denominated in caller-assigned exposure, not dollars. A host might assign `send_email` 20 risk points and `search_knowledge_base` 1. If every authorized email is routed through the required boundary, Cycles rejects the first reservation that exceeds the remaining risk budget. The host still authorizes tools and arguments.

### Control 3: Hierarchical Scope Isolation

**Framework connection:** Budget-scope isolation can contribute to robustness and cascading-failure controls. It does not itself provide the data governance, identity isolation, or third-party management those broader programs may require.

**What "good" looks like:** Budgets follow meaningful organizational scopes. Separate tenant allocations keep one tenant's submitted usage from consuming another tenant's configured allocation; narrower scopes can contain budget impact within a workflow or agent. Data, credential, and execution isolation require additional controls.

**What happens without it:** In an illustrative [multi-tenant SaaS scenario](/blog/multi-tenant-ai-cost-control-per-tenant-budgets-quotas-isolation), one power user's agent can consume most shared API capacity and degrade service for other customers. It is the noisy-neighbor problem applied to AI.

**How Cycles implements it:** [Hierarchical scopes](/protocol/how-scope-derivation-works-in-cycles) check each matching configured ledger atomically across tenant, workspace, app, workflow, agent, and toolset. A unique workflow value can represent a run. Ledgers are independent rather than funded by automatic parent-to-child subdivision.

### Control 4: Correlated Budget and Action Records

**Framework connection:** Correlated records can contribute to Article 12 logging and traceability, Article 13 transparency, NIST Measure activities, and evidence for documented ISO/IEC 42001 controls.

**What "good" looks like:** Persisted budget operations record submitted scope, amounts, timestamps, and status. Application authorization and execution logs record the reservation ID, propagated trace ID, tool, arguments, decision rationale, and outcome. Together, those sources support reconstruction without claiming that a budget record alone describes the action.

**What happens without it:** After an incident, teams spend days reconstructing what happened from scattered application logs, provider billing dashboards, and Slack messages. The [production gap](/blog/ai-agent-production-gap-what-developers-are-saying) is not just operational — it is evidentiary.

**How Cycles implements it:** Persisted reservations and direct-usage [events](/protocol/how-events-work-in-cycles-direct-debit-without-reservation) create queryable budget lifecycle data; emitted event hooks provide additional records. Event retention defaults to 90 days and is configurable. Applications must export the required data and join it to their authorization and outcome logs for long-term evidence. The [admin server](/glossary#admin-server) records management-plane audit operations separately.

### Control 5: Graceful Degradation Under Constraint

**Framework connection:** Rejection handling and controlled degradation can contribute to a broader Article 14 oversight design, Article 15 resilience measures, and NIST Manage responses.

**What "good" looks like:** When an agent hits a budget limit, it does not crash. It degrades: drops to a cheaper model, shortens its response, skips optional steps, or stops and explains what remains. The human operator can adjust the budget and resume — or decide not to.

**What happens without it:** Hard failures without context. The agent crashes mid-task, the user sees an error, and nobody knows whether the work was 10% complete or 90% complete. Worse, the agent may have already taken irreversible actions (sent emails, made API calls) before failing on the next step.

**How Cycles supports it:** Three response types: [ALLOW, ALLOW_WITH_CAPS, DENY](/how-to/how-to-think-about-degradation-paths-in-cycles-deny-downgrade-disable-or-defer). `ALLOW_WITH_CAPS` returns operator-configured caps such as `maxTokens`, `toolDenylist`, or `maxStepsRemaining`; the host must apply them. The current server does not infer or tighten caps from remaining balance.

### Control 6: Least-Privilege Access Control

**Framework connection:** Least-privilege credentials and separate management/runtime planes support OWASP ASI03 mitigations and access-management controls. Cycles API permissions do not replace application or tool credentials.

**What "good" looks like:** The runtime enforcement plane and the management plane are separated. Agent-facing API keys have scoped permissions (reserve, commit, check balance) and cannot modify budgets, create tenants, or access other tenants' data. Administrative operations require separate credentials with audit logging.

**What happens without it:** A compromised agent — or a [tool poisoning attack](/blog/mcp-tool-poisoning-why-agent-frameworks-cant-prevent-it) — escalates from "call a tool" to "modify the budget" to "access another tenant's data."

**How Cycles implements it:** The [runtime server](/security) (port 7878) and admin server (port 7979) are separate processes with separate access controls. API keys support per-permission scoping, rotation, and revocation. Self-hosted deployments keep all data within the organization's infrastructure.

### Control 7: Safe Rollout via Shadow Mode

**Framework connection:** Non-persisting evaluation can support pre-deployment validation, NIST Map and Measure work, and testing of a documented budget control.

**What "good" looks like:** Before enforcing a budget in production, teams route representative protected actions through a non-persisting evaluation. The output shows which submitted budget requests would have been allowed, capped, or denied. Separate policy engines remain responsible for shadow-evaluating application authorization rules.

**What happens without it:** Teams set budgets too tight and block legitimate work, or too loose and miss violations. Either outcome erodes trust in the governance system — and teams revert to no enforcement.

**How Cycles implements it:** [Shadow mode](/how-to/shadow-mode-in-cycles-how-to-roll-out-budget-enforcement-without-breaking-production) runs enforcement logic in dry-run against real production traffic. Teams calibrate budgets based on actual usage patterns before turning enforcement on.

## Compliance Mapping: Framework to Control to Evidence

For teams preparing for audits or certifications, this table gives possible runtime contributions and example evidence sources. No row demonstrates compliance on its own; scope, sufficiency, and the necessary organizational controls must be assessed separately.

| Framework area | Possible runtime contribution | Example evidence sources |
|---|---|---|
| EU AI Act Art. 9 — Risk management | Pre-execution budgets as one selected risk treatment | Risk assessment, approved budget configuration, retained dry-run response analysis |
| EU AI Act Art. 12 — Record-keeping | Correlated budget lifecycle records | Reservation/event exports joined to application authorization and outcome logs |
| EU AI Act Art. 13 — Transparency | Queryable budget state | Balance responses plus deployer instructions and application decision logs |
| EU AI Act Art. 14 — Human oversight | [Graceful degradation](/glossary#graceful-degradation) and a host-enforced stop on rejection | Rejection/caps handling logs, human-oversight procedures, intervention tests |
| EU AI Act Art. 15 — Robustness | Scope-level budget isolation and atomic operations | Budget configuration, concurrency tests, plus broader security and resilience tests |
| NIST AI RMF — Govern | Scope hierarchy, access control | Tenant/workspace/workflow configuration, API key permission matrix |
| NIST AI RMF — Map | Caller-defined exposure taxonomy | Risk assessment, application tool classification, risk-point assignments |
| NIST AI RMF — Measure | Budget utilization tracking | Usage reports, variance analysis, alert history |
| NIST AI RMF — Manage | Pre-execution budget enforcement | Reservation/commit records and retained rejection responses |
| ISO/IEC 42001 — Risk treatment | Selected technical budget controls | Risk-treatment plan, approved configurations, test and lifecycle records |
| ISO/IEC 42001 — Lifecycle management | Budget-control validation before enforcement | Retained dry-run analysis and management-plane change audit records |
| ISO/IEC 42001 — Third-party management | No direct Cycles substitute | Supplier assessments, application tool policy, invocation and authorization logs |
| OWASP ASI02 — Tool misuse and exploitation | Bound cumulative caller-assigned exposure | Application allowlists and validation logs joined to Cycles budget records |
| OWASP ASI03 — Identity and privilege abuse | Least-privilege Cycles API access | API-key permission matrix plus application/tool identity controls |
| OWASP ASI08 — Cascading failures | Hierarchical budget isolation | Per-scope budget utilization and concurrency/containment tests |
| OWASP ASI10 — Rogue agents | Reject over-budget protected calls | Host rejection-handling logs plus application policy and incident records |
| SOC 2 — Security | Runtime/admin plane separation | Network configuration, API key audit, access control matrix |
| SOC 2 — Availability | Budget-based capacity management | Tenant budget allocation, capacity utilization reports |
| SOC 2 — Processing Integrity | Atomic reserve-commit operations | Transaction logs, concurrency test evidence |
| SOC 2 — Confidentiality | No direct Cycles substitute for data isolation | Application authorization, datastore isolation, and cross-tenant access tests |

## From Framework to Implementation

Governance frameworks tell you what to control. They do not tell you how to build the controls. That gap is where most teams stall — and where [runtime authority](/glossary#runtime-authority) infrastructure closes the loop.

Three starting points, depending on where you are today:

**If you have no runtime budget controls yet:** Start with [shadow mode](/how-to/shadow-mode-in-cycles-how-to-roll-out-budget-enforcement-without-breaking-production). Base dry-run does not mutate budget state or persist a reservation. Retain and analyze the responses in your application to learn which submitted estimates and scopes would be allowed, capped, or denied before enforcing them.

**If you have observability but no enforcement:** You already have the visibility (Level 1). Add a [budget-enforced workflow](/quickstart/end-to-end-tutorial) to one high-risk agent — the one that sends emails, makes purchases, or calls external APIs. Prove the model works on a single workflow, then expand.

**If you are preparing for audit or certification:** Treat the mapping table as a prompt for your legal, compliance, and audit teams. Export the necessary Cycles lifecycle data, join it to application authorization and outcome evidence, and let the applicable control owner determine whether the combined evidence is sufficient.

Governance combines organizational processes with technical controls before and after deployment. Runtime budgets are one available component, not a complete governance or compliance system.

## Sources

1. [EU AI Act — Regulation 2024/1689](https://eur-lex.europa.eu/eli/reg/2024/1689/oj) — Entered into force August 1, 2024. High-risk obligations rescheduled by the June 2026 Digital Omnibus to December 2, 2027 (Annex III) and August 2, 2028 (Annex I embedded).
2. [NIST AI Risk Management Framework 1.0](https://www.nist.gov/publications/artificial-intelligence-risk-management-framework-ai-rmf-10) — Published January 26, 2023
3. [NIST AI Agent Standards Initiative](https://www.nist.gov/news-events/news/2026/02/announcing-ai-agent-standards-initiative-interoperable-and-secure) — Announced February 17, 2026
4. [ISO/IEC 42001:2023](https://www.iso.org/standard/42001) — AI Management System standard, published December 2023
5. [OWASP Top 10 for Agentic Applications](https://genai.owasp.org/resource/owasp-top-10-for-agentic-applications-for-2026/) — 2025/2026 edition
6. [EU AI Act FAQ — Classification guidance](https://ai-act-service-desk.ec.europa.eu/en/faq) — AI Act Service Desk, European Commission
7. [Navigating the AI Act — Timeline guidance](https://digital-strategy.ec.europa.eu/en/faqs/navigating-ai-act) — European Commission Digital Strategy

## Further Reading

- [What Is Runtime Authority for AI Agents?](/blog/what-is-runtime-authority-for-ai-agents) — the foundational concept
- [AI Agent Governance: Runtime Enforcement for Security, Cost, and Compliance](/blog/ai-agent-governance-runtime-enforcement-security-cost-compliance) — incidents and the three-pillar framework
- [Zero-Trust for AI Agents](/blog/zero-trust-for-ai-agents-why-every-tool-call-needs-a-policy-decision) — why every tool call needs a policy decision
- [AI Agent Action Control: Hard Limits on Side Effects](/blog/ai-agent-action-control-hard-limits-side-effects) — [RISK_POINTS](/glossary#risk-points) and tool allowlists
- [AI Agent Budget Control: Enforce Hard Spend Limits](/blog/ai-agent-budget-control-enforce-hard-spend-limits) — the reserve-commit protocol
- [Multi-Tenant AI Cost Control](/blog/multi-tenant-ai-cost-control-per-tenant-budgets-quotas-isolation) — per-tenant enforcement and isolation
- [The AI Agent Production Gap](/blog/ai-agent-production-gap-what-developers-are-saying) — what the community is saying
- [Security Overview](/security) — architecture, access control, and data handling

## Related how-to guides

- [Assigning RISK_POINTS to agent tools](/how-to/assigning-risk-points-to-agent-tools)
- [Budget control for LangChain](/how-to/how-to-add-budget-control-to-a-langchain-agent)
- [Multi-tenant SaaS guide](/how-to/multi-tenant-saas-with-cycles)
