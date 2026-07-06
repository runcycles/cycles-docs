---
title: "OWASP Agentic Top 10: What Can Be Enforced?"
date: 2026-07-20
author: Albert Mavashev
tags: [security, OWASP, agents, governance, runtime-authority, action-control, compliance]
description: "OWASP's June 2026 data says prompt injection touches six of ten agentic risks. Which ASI categories a pre-execution authority layer can actually enforce."
blog: true
sidebar: false
featured: false
head:
  - - meta
    - name: keywords
      content: "OWASP agentic top 10, ASI01, agent goal hijack, tool misuse, OWASP AI agent security, prompt injection enforcement, pre-execution enforcement, runtime authority, agentic applications security"
---

# OWASP Agentic Top 10: What Can Be Enforced?

Seemingly every security vendor wrote a "what the OWASP Agentic Top 10 means" post within a month of its December 2025 release. Far fewer wrote the follow-up question: for each of the ten, is there a control that *enforces* — decides before the action executes — or only one that detects, filters, or reviews after the fact?

The question got sharper in June, when the OWASP GenAI Security Project's *State of Agentic AI Security and Governance* report ([coverage](https://www.helpnetsecurity.com/2026/06/11/owasp-prompt-injection-ai-security-failures/)) found prompt injection functioning as a universal joint of agentic incidents — mapping to **six of the ten** ASI categories. The architectural reason is one sentence: models treat the system prompt, the user request, and retrieved external text as a single stream of [tokens](/glossary#tokens). If six of ten risks share a root cause that years of detection research hasn't closed, the practical question is not "how do we stop injection" but "which of the ten can be made survivable regardless of whether injection succeeds."

This post goes category by category. The [full framework mapping](/blog/ai-agent-governance-framework-nist-eu-ai-act-iso-42001-owasp-runtime-enforcement) covers OWASP alongside the EU AI Act, NIST, and ISO 42001; here the lens is narrower and more operational.

<!-- more -->

## The enforceability test

A control *enforces* an ASI category when it can render the harmful outcome unreachable by construction — a decision point outside the model, evaluated before execution, that no amount of context manipulation can rewrite. Anything else — classifiers, sandboxes, reviews, monitoring — is valuable, but it reduces probability rather than bounding outcome. The [guardrails vs. observability vs. authority](/blog/runtime-authority-vs-guardrails-vs-observability) distinction, applied per risk.

## Category by category

| ASI | Risk | Pre-execution enforceable? | The enforcing control |
|---|---|---|---|
| ASI01 | Agent Goal Hijack | **Partially** | Can't stop the hijack; can bound what a hijacked agent executes — action quotas, [RISK_POINTS](/glossary#risk-points), destination allow-lists |
| ASI02 | Tool Misuse & Exploitation | **Yes** | Per-tool budgets and quotas decided before each call |
| ASI03 | Identity & Privilege Abuse | **Yes** | Scoped credentials + per-scope authority; a stolen token is a [bounded liability](/blog/least-privilege-api-keys-for-ai-agents) |
| ASI04 | Agentic Supply Chain Vulnerabilities | **Partially** | Provenance and signing are ecosystem work; runtime limits bound what a [poisoned skill](/blog/agent-skills-are-the-new-supply-chain) can spend and do |
| ASI05 | Unexpected Code Execution | **No** | Sandboxing and execution isolation — a different layer's job |
| ASI06 | Memory & Context Poisoning | **Partially** | Can't validate memory content; can gate [memory writes as actions](/blog/agent-memory-writes-are-actions-too) with budgets |
| ASI07 | Insecure Inter-Agent Communication | **No** | Authenticated channels, message integrity — transport-layer work |
| ASI08 | Cascading Failures | **Yes** | Hierarchical scope isolation + [authority attenuation](/blog/agent-delegation-chains-authority-attenuation-not-trust-propagation) per delegation hop |
| ASI09 | Human-Agent Trust Exploitation | **No** | Disclosure, UX, and consent design |
| ASI10 | Rogue Agents | **Yes** | Every action passes a policy gate; out-of-policy behavior is denied, not detected |

Four clean yeses, three partials, three nos. A note on scoring: the [framework pillar](/blog/ai-agent-governance-framework-nist-eu-ai-act-iso-42001-owasp-runtime-enforcement) counts six categories as directly addressable by runtime enforcement; this post applies a stricter test — outcome structurally unreachable, not merely bounded — under which ASI01 and ASI04 grade as partial, and ASI06 earns partial credit the pillar didn't count, because memory *writes* can be gated as actions even where memory *content* cannot be validated. Worth being precise about each class.

**The yeses (ASI02, 03, 08, 10)** share a shape: the risk *is* an action pattern — too many tool calls, over-privileged access, unbounded delegation, out-of-policy behavior. Where the risk is an action pattern, a pre-execution decision on each action is not mitigation; it is the shape of the fix. This is the territory where "we monitor for it" should raise an auditor's eyebrow, because enforcement is available.

**The partials (ASI01, 04, 06)** are the injection-shaped ones — and this is where the June report's six-of-ten finding matters. You cannot enforce your way out of the hijack itself; the model's intent is not an enforceable surface. What you can enforce is the consequence budget: a goal-hijacked agent with a five-send quota and a priced action vocabulary is a contained incident, not a breach narrative. Same logic as [metering the trifecta's action leg](/blog/lethal-trifecta-rule-of-two-metered-authority) — determinism about outcomes, agnosticism about intent.

**The nos (ASI05, 07, 09)** deserve equal honesty: sandboxing, transport security, and interaction design are not authority problems, and a budget gate contributes little. A vendor mapping all ten categories to their product is telling you about their marketing, not their architecture.

## What this means for a 2026 control review

Three practical consequences:

1. **Prioritize the enforceable four.** They cover the incident classes with the worst blast radius in the [2026 catalog](/blog/state-of-ai-agent-incidents-2026) — [tool loops](/glossary#tool-loop), credential abuse, delegation cascades — and they're the categories where "we couldn't have prevented it" no longer holds up, because prevention is a deployable control rather than a research problem.
2. **For the partials, write the consequence budget down.** The June report's regulatory context — DORA's four-hour incident notification, NIS2's 24-hour early warning — means "injection happened" will need an accompanying "and here is what it was structurally limited to." That sentence requires limits that existed before the incident.
3. **Stop accepting detection where enforcement exists.** The report, citing IBM data, notes only 37% of organizations have shadow-AI detection policies — but detection maturity is the wrong ladder for ASI02/03/08/10. The right question in a control review is not "would we notice" but "would it execute."

OWASP gave the field a shared vocabulary for agentic risk. The vocabulary now needs a second column — *detected or denied* — and the honest answer differs by category. Filling that column in honestly is the control review that matters.

## Sources

1. [OWASP Top 10 for Agentic Applications (2026)](https://genai.owasp.org/resource/owasp-top-10-for-agentic-applications-for-2026/) — December 2025
2. [Help Net Security — OWASP: prompt injection drives most production agentic failures](https://www.helpnetsecurity.com/2026/06/11/owasp-prompt-injection-ai-security-failures/) — on the June 2026 *State of Agentic AI Security and Governance* report
3. [OWASP GenAI Security Project](https://genai.owasp.org/) — project home

## Further Reading

- [AI Agent Governance: Mapping NIST, EU AI Act, ISO 42001, and OWASP to Runtime Enforcement](/blog/ai-agent-governance-framework-nist-eu-ai-act-iso-42001-owasp-runtime-enforcement) — the four-framework pillar
- [Runtime Authority vs Guardrails vs Observability](/blog/runtime-authority-vs-guardrails-vs-observability) — the three-layer distinction this post applies
- [Lethal Trifecta, Rule of Two, and Metered Authority](/blog/lethal-trifecta-rule-of-two-metered-authority) — consequence budgets for injection-shaped risk
- [Zero Trust for AI Agents](/blog/zero-trust-for-ai-agents-why-every-tool-call-needs-a-policy-decision) — the per-tool-call policy decision
- [The State of AI Agent Incidents (2026)](/blog/state-of-ai-agent-incidents-2026) — which categories are actually firing
