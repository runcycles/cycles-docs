---
title: "NIST Agent Overlays and the Missing Control"
date: 2026-08-03
author: Albert Mavashev
tags: [governance, compliance, NIST, agents, security, runtime-authority, standards]
description: "NIST's COSAiS is drafting SP 800-53 overlays for AI agents. CSA's gap analysis names the missing piece: scoping agent permissions to task context at runtime."
blog: true
sidebar: false
featured: false
head:
  - - meta
    - name: keywords
      content: "NIST COSAiS, AI agent control overlays, SP 800-53 AI agents, NIST AI Agent Standards Initiative, CAISI, agent permissions task context, agent security controls, NIST agent overlay single agent multi-agent"
---

# NIST Agent Overlays and the Missing Control

Europe's dates get the headlines — [August 2 came and went](/blog/eu-ai-act-what-actually-happens-august-2-2026) with GPAI enforcement switching on — but the US standards track matters more for what many US-facing engineering teams will actually be audited against. And that track moved twice this year: NIST's Center for AI Standards and Innovation (CAISI) launched the [AI Agent Standards Initiative](https://www.nist.gov/news-events/news/2026/02/announcing-ai-agent-standards-initiative-interoperable-and-secure) in February — among the first US government programs dedicated to security and interoperability standards for agentic AI — and NIST's [COSAiS project](https://csrc.nist.gov/projects/cosais) (Control Overlays for Securing AI Systems) is drafting SP 800-53 overlays that include two aimed squarely at agents: **Using AI Agent Systems (Single Agent)** and **(Multi-Agent)**.

For anyone who has lived through a FedRAMP or 800-53 assessment, the significance is mechanical: overlays are how new technology categories get absorbed into the control regime auditors already run. When the agent overlays land, "do you deploy AI agents" becomes a question with a control checklist attached.

Which makes the gap analysis worth reading closely — because the sharpest sentence about these overlays wasn't written by NIST.

<!-- more -->

## What COSAiS is building

COSAiS proposes five overlays on the SP 800-53 catalog: generative AI (LLM/assistant), predictive AI, single-agent systems, multi-agent systems, and controls for AI developers. The project moved from concept paper (August 2025) to a first annotated outline for discussion (January 2026, covering the predictive-AI overlay), with the agent overlays still in development. It builds on the existing NIST stack — SP 800-218A, the draft AI 800-1, the adversarial ML taxonomy — rather than inventing a parallel one.

That approach is the point: rather than a new framework to adopt, it retrofits agents into the one federal systems and their vendors already operate. The [Cloud Security Alliance's research note](https://labs.cloudsecurityalliance.org/research/csa-research-note-nist-ai-agent-standards-initiative-2026040/) on the initiative frames the value precisely — a path to agentic security "using existing authorization and audit machinery" — and recommends starting gap analysis now rather than waiting for final publication.

## The control that isn't in the catalog

CSA's note also states, more plainly than any vendor could, what the current SP 800-53 catalog is missing for agents. It

> lacks purpose-built controls for distinguishing an AI agent from a human operator, scoping agent permissions to a defined task context, or linking agent actions to a non-human principal for forensic attribution.

And it names the default failure mode: agents today are treated as generic service accounts, holding "indefinite standing permissions with no mechanism for scoping those permissions to a specific task or time window." The acute gaps cluster in four control families — Access Control, Identification and Authentication, Audit and Accountability, and Supply Chain Risk Management.

Read those three missing capabilities again, because together they are a specification:

1. **Distinguishing agent from human** — an identity problem, and the piece the ecosystem is furthest along on: [dedicated agent identities](/blog/agent-identity-is-not-agent-authority) from Entra Agent ID, Okta, and their peers.
2. **Linking actions to a non-human principal for forensic attribution** — an evidence problem: decision records keyed to agent identity, [captured at enforcement time](/blog/a-200-ok-is-not-an-audit-trail), assembled into an [audit packet](/blog/what-goes-in-an-ai-agent-audit-packet) an assessor can verify.
3. **Scoping permissions to a defined task context** — and here is the one with no incumbent answer. A standing permission says what an agent may ever do. Task-context scoping says what *this run, on this task, right now* may do — which requires per-run allowances, evaluated per action, that expire with the task. That is not an entry in any identity catalog; it is a budget: spend, [RISK_POINTS](/glossary#risk-points), action quotas, [attenuated at each delegation](/blog/agent-delegation-chains-authority-attenuation-not-trust-propagation), enforced before execution and settled after.

"Indefinite standing permissions" is the service-account model that CSA correctly identifies as the failure mode — and it cannot be fixed with better-shaped standing permissions. Time-boxed, task-boxed, consumable authority is a different primitive. It is the difference between an agent that *can* send email and an agent that *may send three more emails before this run's allowance is exhausted*. When the overlay drafts ask how permissions are scoped to task context, the teams with a real answer will be the ones running [runtime authority](/glossary#runtime-authority) — whatever they call it.

## What to do before the overlays are final

CSA's advice is to run the gap analysis now, ahead of assessors' cycles. A concrete version, in control-family order:

- **AC (Access Control):** Inventory every agent's standing permissions. For each, ask what the task-scoped version would be — per-run budget, action quota, expiry — and whether anything today enforces it. The [risk-scoring guide](/blog/ai-agent-risk-assessment-score-classify-enforce-tool-risk) is the pricing exercise.
- **IA (Identification & Authentication):** Ensure agents authenticate as agents — dedicated identities, not [borrowed user sessions or shared service accounts](/blog/agent-identity-is-not-user-identity).
- **AU (Audit & Accountability):** Check that agent actions resolve to a non-human principal *and a decision* — what was allowed or denied, against which limit. Application logs alone will not satisfy a forensic-attribution control; enforcement records will.
- **SR (Supply Chain):** Apply the same inventory to [skills and tools your agents load](/blog/agent-skills-are-the-new-supply-chain) — provenance in, bounded authority out.

There is a familiar pattern here. ISO 27001, SOC 2, FedRAMP — each time, the organizations that treated the draft-standard period as build time passed their first assessments with infrastructure, while everyone else passed them with spreadsheets and exceptions. The agent overlays are in that draft period now. The missing control has a name and a shape; the only question is whether you install it before or after it becomes a finding.

## Sources

1. [NIST — COSAiS: Control Overlays for Securing AI Systems](https://csrc.nist.gov/projects/cosais) — overlay list, basis, and timeline
2. [CSA — Research note on the NIST AI Agent Standards Initiative](https://labs.cloudsecurityalliance.org/research/csa-research-note-nist-ai-agent-standards-initiative-2026040/) — the gap analysis and quoted language
3. [NIST — AI Agent Standards Initiative announcement](https://www.nist.gov/news-events/news/2026/02/announcing-ai-agent-standards-initiative-interoperable-and-secure) — February 17, 2026

## Further Reading

- [Agent Identity Is Not Agent Authority](/blog/agent-identity-is-not-agent-authority) — the identity leg, and where it stops
- [AI Agents: EU AI Act, NIST, ISO 42001, OWASP Map](/blog/ai-agent-governance-framework-nist-eu-ai-act-iso-42001-owasp-runtime-enforcement) — the four-framework control mapping
- [AI Agent Risk Assessment: Score, Classify, Enforce](/blog/ai-agent-risk-assessment-score-classify-enforce-tool-risk) — pricing actions for task-scoped budgets
- [What Goes in an AI Agent Audit Packet?](/blog/what-goes-in-an-ai-agent-audit-packet) — the forensic-attribution artifact
- [Least-Privilege API Keys for AI Agents](/blog/least-privilege-api-keys-for-ai-agents) — narrowing the standing-permission surface
- [State of AI Agent Governance 2026](/blog/state-of-ai-agent-governance-2026) — the regulatory landscape this initiative joins
