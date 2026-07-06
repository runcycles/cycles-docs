---
title: "Prove You Had Controls: Agent Liability in 2026"
date: 2026-07-23
author: Albert Mavashev
tags: [governance, compliance, liability, agents, audit, evidence, runtime-authority, enterprise]
description: "The CMA says you're liable for what your agents do. Contracts exclude the damages. Insurers ask for oversight evidence. Signed decision records serve all three."
blog: true
sidebar: false
featured: false
head:
  - - meta
    - name: keywords
      content: "AI agent liability, CMA AI agents guidance, agentic AI liability gap, AI insurance, agent oversight evidence, DMCCA AI, AI agent audit trail, signed evidence, who is liable AI agent"
---

# Prove You Had Controls: Agent Liability in 2026

Three developments this year, from three different institutions, converge on one sentence: when your AI agent causes harm, you will be asked to prove what controls you had — and "we had a system prompt" will not be an answer.

The regulator's version is the bluntest. On March 9, 2026, the UK Competition and Markets Authority published [guidance on complying with consumer law when using AI agents](https://www.gov.uk/government/publications/complying-with-consumer-law-when-using-ai-agents). Its core allocation is unambiguous: the business *deploying* the agent — not the lab that trained the model, not the vendor that supplied the framework — bears responsibility for what the agent says and does to consumers. Under the DMCCA, the CMA can impose fines of up to 10% of global annual turnover for consumer-law breaches, without going to court first.

The contracts, meanwhile, point the same direction from the other side. And the insurance market is starting to price the difference between governed and ungoverned agents. This post walks the three pressures and the one artifact that serves all of them.

<!-- more -->

## Pressure one: the regulator holds the deployer

The CMA guidance is consumer-law-specific and UK-specific, but its structure reads like the template regulators will reach for: liability follows deployment, not development. Your agent misquotes a refund policy, obstructs a cancellation, or misleads a customer about what it can do — that is your breach, even if the underlying model and the agent framework were built entirely by others. The guidance also lands on transparency ground that should look familiar: consumers must not be misled about whether they are dealing with an AI agent — the same family of disclosure obligations arriving via [EU AI Act Article 50 and California's SB 942 — as amended by AB 853 — on August 2](/blog/eu-ai-act-what-actually-happens-august-2-2026).

The operational consequence is the evidentiary one. A deployer defending its "reasonable steps" needs to show what the agent was permitted to do, what it was prevented from doing, and that the prevention actually operated — not as policy documents, but as records of decisions.

## Pressure two: the contract leaves you holding it

Clifford Chance's [analysis of the agentic liability gap](https://www.cliffordchance.com/insights/resources/blogs/talking-tech/en/articles/2026/02/agentic-ai-and-the-liability-gap-your-contracts-may-not-cover.html) reads like a structural diagram of the same problem from the procurement side. Standard technology contracts, written for passive software, allocate agentic risk almost entirely to the customer: "as is" provisions extend to the agent's autonomous decisions; the damages agents actually cause — lost profits, lost data, consequential harm — sit in the standard exclusion lists; liability caps pegged to subscription fees are a rounding error against a real incident.

One gap in their list deserves more attention than it gets: customers typically lack contractual rights to the supplier's decision logs, real-time suspension mechanisms, or cooperation during investigations — while bearing full regulatory accountability. The party liable for the agent's actions often has no contractual right to the evidence of those actions. Any governance record that lives solely inside a vendor's platform is a record you may not have on the day you need it. The conclusion is not subtle: **the liable party must own the enforcement layer and its records**, independent of any single agent vendor.

## Pressure three: the insurer wants to see the controls

An AI-specific insurance market is forming — [Munich Re's aiSure](https://www.munichre.com/en/solutions/for-industry-clients/insure-ai.html) performance coverage and Lloyd's-market AI liability products from MGAs like [Armilla](https://www.armilla.ai/) are the visible early entries — and it prices the way liability insurance generally prices: on demonstrable controls. Armilla's published underwriting approach assesses a model's reliability, the governance practices around it, and the potential impact of its failures — which are the same questions the CMA and the contract analysis raise: what can the agent do, what stops it, and how would you evidence that after the fact? An applicant who answers with monitoring [dashboards](/glossary#dashboard) is describing how they would *watch* a loss; an applicant who answers with pre-execution limits and decision records is describing why the loss stays small. Only one of those is an answer built to narrow a premium.

## The artifact all three ask for

Notice what the three pressures have in common. None of them primarily asks whether your agent misbehaved — agents will misbehave; everyone in the chain now assumes it. They ask what bounded it and **how you prove the bound existed and operated**.

That artifact has a specific shape:

1. **Decisions, not logs.** An application log says what the agent did. An authority record carries a verdict — the action, the limit it was evaluated against, and [the policy that decided it](/blog/a-200-ok-is-not-an-audit-trail). The denials matter most: a record of the send that didn't happen is the single best exhibit that oversight was real.
2. **Captured at decision time.** Evidence assembled after the incident is reconstruction; evidence emitted by the enforcement point as a byproduct of enforcement is testimony. This cannot be backfilled — which is why the [audit-drill advice](/blog/run-audit-evidence-drill-before-audit-day) is to test retrieval before anyone official asks.
3. **Verifiable by a third party.** A regulator, counterparty, or insurer who wasn't in the room needs records that survive skepticism — signed, content-addressed, resolvable to a known signer, with [rotation that doesn't rewrite history](/blog/rotating-keys-shouldnt-rewrite-history). A [complete audit packet](/blog/what-goes-in-an-ai-agent-audit-packet) is the assembled form.
4. **Owned by the deployer.** Per pressure two: if it lives only in a vendor's platform, it is not your evidence.

Teams running [runtime authority](/glossary#runtime-authority) get most of this as a side effect — every reserve, commit, and deny is already a scoped, timestamped decision record; the [evidence layer](/blog/audit-evidence-has-to-survive-production) adds the signatures and survivability. Which reframes the cost conversation: enforcement infrastructure is usually justified by prevented incidents, but 2026 is adding a second justification that fires even in the incident-free case. The controls you can prove are becoming the controls that count — to a regulator computing a fine, a counterparty reading an exclusion clause, and an underwriter setting a premium.

The uncomfortable version, for the roadmap meeting: liability has already been allocated to you. The only open question is whether, on the day it crystallizes, you are holding evidence or holding a dashboard.

## Sources

1. [CMA — Complying with consumer law when using AI agents](https://www.gov.uk/government/publications/complying-with-consumer-law-when-using-ai-agents) — March 9, 2026; see also the companion [Agentic AI and consumers](https://www.gov.uk/government/publications/agentic-ai-and-consumers/agentic-ai-and-consumers)
2. [Clifford Chance — Agentic AI and the liability gap: your contracts may not cover it](https://www.cliffordchance.com/insights/resources/blogs/talking-tech/en/articles/2026/02/agentic-ai-and-the-liability-gap-your-contracts-may-not-cover.html) — February 2026
3. [TLT — Agentic AI: CMA publishes guidance on consumer law and DMCCA risks](https://www.tlt.com/insights-and-events/insight/agentic-ai-cma-publishes-guidance-on-consumer-law-and-dmcca-risks) — DMCCA enforcement context

## Further Reading

- [A 200 OK Is Not an Audit Trail](/blog/a-200-ok-is-not-an-audit-trail) — decisions vs. logs
- [What Goes in an AI Agent Audit Packet?](/blog/what-goes-in-an-ai-agent-audit-packet) — the assembled evidence artifact
- [Run the Audit Evidence Drill Before Audit Day](/blog/run-audit-evidence-drill-before-audit-day) — testing retrieval before it's compulsory
- [Audit Evidence Has to Survive Production](/blog/audit-evidence-has-to-survive-production) — crashes, rotation, retention
- [EU AI Act: What Actually Happens on August 2, 2026](/blog/eu-ai-act-what-actually-happens-august-2-2026) — the disclosure obligations landing the same season
- [The AI Agent Audit Trail You're Already Building](/blog/runtime-authority-byproducts-audit-trail-and-attribution-by-default) — evidence as an enforcement byproduct
