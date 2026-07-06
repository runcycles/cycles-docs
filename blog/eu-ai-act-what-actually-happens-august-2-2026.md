---
title: "EU AI Act: What Actually Happens on August 2, 2026"
date: 2026-07-06
author: Albert Mavashev
tags: [governance, compliance, EU AI Act, regulation, agents, runtime-authority, transparency, GPAI]
description: "The Digital Omnibus delayed the EU AI Act's high-risk rules to 2027 and 2028. What still lands August 2, 2026: Article 50 transparency and GPAI enforcement."
blog: true
sidebar: false
featured: false
head:
  - - meta
    - name: keywords
      content: "EU AI Act August 2026, Digital Omnibus AI Act, EU AI Act deadline delay, Article 50 transparency, GPAI enforcement, high-risk AI systems 2027, AI agent compliance, AI Act timeline"
---

# EU AI Act: What Actually Happens on August 2, 2026

If your compliance roadmap says "EU AI Act high-risk obligations apply August 2, 2026," it is out of date as of two weeks ago — and if your reaction is to shelve the whole workstream until 2027, that is a misread in the other direction.

On June 29, 2026, the Council of the EU gave final approval to the Digital Omnibus on AI, following the European Parliament's endorsement on June 16. The package rewrites the AI Act's application timeline: the high-risk obligations that were scheduled for this August moved to late 2027 and 2028. But two things still take effect on August 2, 2026 — Article 50 transparency obligations, which the Commission's own draft guidance says apply to AI agents, and the Commission's enforcement powers over general-purpose AI (GPAI) providers, including fines of up to 3% of worldwide turnover.

This post separates what moved from what didn't, and what each means if you operate AI agents.

<!-- more -->

## What the Digital Omnibus Changed

The Digital Omnibus on AI was proposed by the Commission on November 19, 2025, reached provisional political agreement at the May 6–7 trilogue, and cleared both co-legislators in June. As of publication, the amending regulation has been adopted but not yet published in the Official Journal; publication is expected in mid-to-late July 2026, and the amendments become binding on entry into force. Until then, the dates below reflect the adopted text.

The headline changes to the timeline:

| Obligation | Original date | New date |
|---|---|---|
| High-risk AI systems under Annex III (standalone use cases: employment, credit, education, essential services, and others) | August 2, 2026 | **December 2, 2027** |
| High-risk AI systems under Annex I (AI embedded in regulated products: machinery, medical devices, vehicles) | August 2, 2027 | **August 2, 2028** |
| Article 50(2) machine-readable marking of AI-generated content, for systems already on the market | August 2, 2026 | **December 2, 2026** ([grace period](/glossary#grace-period)) |

The Omnibus also added a new Article 5 prohibition — AI systems that generate non-consensual intimate imagery or child sexual abuse material — with a transitional period ending December 2, 2026.

The stated rationale for the delay is that harmonized standards and conformity assessment infrastructure were not ready. That is a fair reading: the delay is about the certification machinery, not about regulators losing interest in autonomous systems.

## What Still Happens on August 2, 2026

Two EU obligations land on schedule — and, by design, one California law lands the same day. All three are more relevant to agent operators than the delayed ones.

### Article 50: transparency obligations — and they cover agents

Article 50's transparency obligations apply from August 2, 2026, unchanged. People must be informed when they are interacting with an AI system, and AI-generated content must be disclosed (with the marking grace period noted above for systems already on the market).

The part that matters for agent operators: the Commission's draft guidelines on Article 50, published May 8, 2026 ([analysis by Covington](https://www.insideglobaltech.com/2026/05/12/10-takeaways-european-commission-draft-guidelines-on-ai-transparency-under-the-eu-ai-act/)), explicitly bring agentic AI systems into scope of Article 50(1). Where a provider cannot reliably determine whether an agent will interact with natural persons, the draft guidance says the agent "should be instructed to disclose itself as an AI system in every situation where such interaction is likely."

If your agents send emails, respond in support threads, post messages, or place calls, the obligation to look at for August 2026 is Article 50(1) — not Annex III. And "instructed to disclose" is doing a lot of work in that sentence: a disclosure requirement implemented as a system prompt is a policy, not a control. Knowing — and being able to prove — which outbound interactions your agents actually performed is the enforcement-layer version of the same requirement, and it is the kind of evidence an [audit packet](/blog/what-goes-in-an-ai-agent-audit-packet) needs regardless of which regulation is asking.

### GPAI enforcement: the Commission's powers switch on

Obligations for general-purpose AI model providers have been in force since August 2, 2025. What changes on August 2, 2026 is enforcement: the Commission gains its powers under Articles 91–93 to request documentation, conduct evaluations, investigate systemic risk, and require mitigation measures — up to restricting, withdrawing, or recalling a model. Under Article 101, fines for GPAI providers reach **3% of annual worldwide turnover or €15 million, whichever is higher**. Models placed on the market before August 2, 2025 have until August 2, 2027 to comply.

Most teams reading this are deployers, not GPAI providers. The second-order effect still reaches you: model providers responding to documentation requests and evaluation demands should be expected to push requirements downstream — usage attestations, deployment context, incident reporting. Teams that can already answer "what did our agents do with this model, and under what limits" from structured records will find those requests routine. Teams reconstructing from application logs will not.

### The same date in California

California's AI Transparency Act (SB 942, as amended by AB 853 in October 2025) also becomes operative for covered generative AI providers on **August 2, 2026** — the amendment moved the date from January 1, 2026, a change legal commentary attributes to aligning with the EU's Article 50 timeline.

## The Delay Is Not a Pause

Here is the uncomfortable asymmetry: the compliance timeline moved; the incident timeline did not.

The [2026 incident record](/blog/state-of-ai-agent-incidents-2026) — runaway cost loops, production data deletion, mass mis-sent communications, supply chain compromises — accumulated *before* any high-risk obligation applied. Nothing about December 2027 changes what agents are doing in production this quarter. If anything, the Omnibus sharpened the gap the [state of agent governance](/blog/state-of-ai-agent-governance-2026) report documents: adoption keeps compounding while the regulatory backstop just moved 16 months further out.

There is also a practical reason not to stall: the delayed obligations are the ones with the longest build times. Article 12 record-keeping, Article 14 human oversight with a working stop mechanism, Article 9 risk management — these are architectural properties, not documents. Teams that treated August 2026 as the deadline for [mapping those articles to runtime controls](/blog/ai-agent-governance-framework-nist-eu-ai-act-iso-42001-owasp-runtime-enforcement) now have a 17-month head start on a 2027 deadline instead of a scramble. Teams that interpret the delay as permission to defer will rediscover in mid-2027 that an audit trail cannot be backfilled — evidence of decisions [only exists if it was captured when the decision was made](/blog/a-200-ok-is-not-an-audit-trail).

## What to Do in H2 2026

A concrete sequence, in order of deadline pressure:

1. **Inventory agent-to-human interaction surfaces (by August 2).** Every place an agent can interact with a natural person — chat, email, voice, tickets, social — should be treated as a potential Article 50(1) surface. For each, decide how disclosure happens and how you would demonstrate it occurred.
2. **Check your content-marking position (by December 2).** If your systems generate synthetic content and were on the market before August 2026, the marking grace period ends December 2, 2026. California's SB 942 detection and disclosure obligations run on the adjacent track.
3. **Start capturing enforcement evidence now, not in 2027.** Whatever governance controls you run — budgets, action limits, approval gates — configure them to produce durable records of what was allowed, what was denied, and why. [Run the audit drill](/blog/run-audit-evidence-drill-before-audit-day) before anyone official asks: fetch a specific decision from months ago and see whether you can prove it.
4. **Use the extra runway on high-risk obligations deliberately.** If any of your agent use cases plausibly land in Annex III — employment screening, credit decisions, access to essential services — the December 2027 date is your deadline for the controls Articles 9, 12, and 14 require. In practice, that means demonstrable [runtime authority](/blog/what-is-runtime-authority-for-ai-agents): pre-execution enforcement, structured logging, and a stop mechanism that works. Shadow-mode rollout, calibration, and cutover take months in production systems; seventeen is not as many as it sounds.

The Omnibus answered the question "when do the high-risk rules apply" with "later." It did not answer "when should your agents be governed" — that one was answered by your own incident log, and the answer is already in the past tense.

## Sources

1. [Council of the EU — final green light for the AI simplification package](https://www.consilium.europa.eu/en/press/press-releases/2026/06/29/artificial-intelligence-council-gives-final-green-light-to-simplify-and-streamline-rules/) — June 29, 2026
2. [Gibson Dunn — EU AI Act Omnibus Agreement: postponed high-risk deadlines and other key changes](https://www.gibsondunn.com/eu-ai-act-omnibus-agreement-postponed-high-risk-deadlines-and-other-key-changes/)
3. [Enforcement of Chapter V under the EU AI Act](https://artificialintelligenceact.eu/enforcement-of-chapter-v-under-the-eu-ai-act/) — GPAI enforcement powers and Article 101 fines
4. [Covington — 10 takeaways from the Commission's draft guidelines on AI transparency](https://www.insideglobaltech.com/2026/05/12/10-takeaways-european-commission-draft-guidelines-on-ai-transparency-under-the-eu-ai-act/) — May 12, 2026
5. [EU AI Act — Regulation 2024/1689](https://eur-lex.europa.eu/eli/reg/2024/1689/oj)
6. [Orrick — California delays its AI Transparency Act](https://infobytes.orrick.com/2025-10-17/california-delays-its-ai-transparency-act-and-passes-new-content-laws/) — AB 853 and the new operative date
7. [Troutman Pepper — California AI Transparency Act amendments signed into law](https://www.troutmanprivacy.com/2025/10/california-ai-transparency-act-amendments-signed-into-law/) — the EU-alignment rationale for the August 2, 2026 date

## Further Reading

- [AI Agent Governance: Mapping NIST, EU AI Act, ISO 42001, and OWASP to Runtime Enforcement](/blog/ai-agent-governance-framework-nist-eu-ai-act-iso-42001-owasp-runtime-enforcement) — the article-by-article control mapping
- [State of AI Agent Governance 2026](/blog/state-of-ai-agent-governance-2026) — the full landscape report
- [The State of AI Agent Incidents (2026)](/blog/state-of-ai-agent-incidents-2026) — what went wrong before any obligation applied
- [A 200 OK Is Not an Audit Trail](/blog/a-200-ok-is-not-an-audit-trail) — why evidence must be captured at decision time
- [What Goes in an AI Agent Audit Packet?](/blog/what-goes-in-an-ai-agent-audit-packet) — the artifact checklist
- [Run the Audit Evidence Drill Before Audit Day](/blog/run-audit-evidence-drill-before-audit-day) — the practice run
