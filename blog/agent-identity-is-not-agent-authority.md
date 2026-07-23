---
title: "Agent Identity Is Not Agent Authority"
date: 2026-07-13
author: Albert Mavashev
tags: [identity, agents, governance, runtime-authority, security, enterprise, comparisons]
description: "Okta, Microsoft Entra, and A2A now give AI agents identities. Identity answers who an agent is — not what it may do next, how much, or at whose expense."
blog: true
sidebar: false
featured: false
head:
  - - meta
    - name: keywords
      content: "agent identity, Okta for AI Agents, Microsoft Entra Agent ID, agent authority, AI agent identity management, agent access management, runtime authority, agent governance"
---

# Agent Identity Is Not Agent Authority

2026 is the year agent identity shipped. [Okta for AI Agents went generally available on April 30](https://www.okta.com/blog/ai/okta-for-ai-agents-general-availability/). [Microsoft Entra Agent ID](https://learn.microsoft.com/en-us/entra/agent-id/what-are-agent-identities) gives every agent a first-class identity in the [tenant](/glossary#tenant) — Copilot Studio mints one automatically for each agent a user creates, with the creator recorded as sponsor. Agent-to-agent protocols define [agent cards](/blog/a2a-vs-mcp-vs-runtime-authority) that can be signed. The identity giants looked at the agent problem and did what identity giants do, and did it well.

Okta's launch blueprint frames the mission as answering three questions: *where are my agents, what can they connect to, and what can they do?* The first two are identity and access questions, and identity infrastructure genuinely answers them. The third one it does not answer — and the gap between "what can they do" as an access-management question and "what may this agent do next" as a runtime question is where many of 2026's agent-governance failures live.

<!-- more -->

## What agent identity actually gives you

The identity layer solves problems nothing else does:

- **Attribution.** Entra Agent ID exists in part so that "operations performed by AI agents" are distinguishable from operations performed by humans and service accounts. An audit log where agents are indistinguishable from users is an audit log that answers nothing.
- **Ownership and lifecycle.** Every Copilot Studio agent gets an identity with a recorded sponsor; identities can be created and retired in bulk without orphaned credentials. Okta's discovery pitch — finding sanctioned and shadow agents alike and registering them as first-class identities — attacks the "we don't know what's running" problem, which is real: Okta cites Gravitee research that [88% of organizations report suspected or confirmed agent security incidents while only 22% treat agents as identity-bearing entities](https://www.okta.com/newsroom/press-releases/showcase-2026/).
- **Scoped access and revocation.** Conditional Access policies on agent identities, right-sized roles, one-click revocation for an agent behaving unexpectedly. This is [agent identity done properly](/blog/agent-identity-is-not-user-identity) — dedicated identities instead of borrowed user sessions.

If your agents run on shared service accounts or borrowed user [tokens](/glossary#tokens) today, adopt this layer. Nothing below argues otherwise.

## The question identity cannot answer

Now watch what happens on an ordinary afternoon. Your support agent — properly registered, sponsored, governed by Conditional Access, holding exactly the Microsoft Graph scopes it needs — reads a poisoned ticket and decides to email 200 customers. Every one of those sends is *authorized* in the identity sense: valid token, correct scopes, policy-compliant session. Identity infrastructure will do precisely what it is designed to do, which is authenticate the agent flawlessly while it does the wrong thing two hundred times.

The distinction is between **standing permission and per-action judgment**:

| | Identity & access layer | [Runtime authority](/glossary#runtime-authority) layer |
|---|---|---|
| Question | Who is this agent, and what *class* of things may it access? | Should *this specific action* proceed, right now? |
| Granted | At registration / token issuance | Decided at execution time, per action |
| Unit | Roles, scopes, group memberships | Budgets: spend and caller-assigned exposure such as [RISK_POINTS](/glossary#risk-points) |
| Failure it prevents | The wrong principal getting in | The right principal doing too much |
| Revocation | Kill the agent's access | Deny the next action; let the agent keep working within limits |

"Can send email" is a scope. "Can this host reserve one more caller-assigned unit for the 201st email, given that this run's budget is exhausted?" is a separate decision — one that requires cumulative state evaluated before execution. Identity systems do keep state — session controls, sign-in risk, near-real-time revocation — but not that application-specific budget ledger. It was never their job. The [runtime authority vs. runtime authorization](/concepts/runtime-authority-vs-runtime-authorization) distinction in our docs is exactly this line: authorization grants access; authority meters and bounds each instrumented use of it. The current Cycles server does not count email actions by kind automatically; the host assigns and reserves the amount.

The [Moltbook exposure](/blog/moltbook-exposure-agent-tokens-no-gates) made the same point from the failure side: even *perfect* verification of who an agent is says nothing about what it may do next, at whose expense. And the delegation version compounds it — an identity system can tell you agent B was spawned by agent A, but [attenuating B's authority below A's](/blog/agent-delegation-chains-authority-attenuation-not-trust-propagation) is a budget operation, not an identity one.

## Why the two keep getting conflated

Partly vocabulary: "what can the agent do" reads as one question, and access-management marketing understandably claims it. Partly architecture: identity is where enterprises already have muscle memory, so the first governance instinct is to reach for the tool that worked for humans. And partly because the identity layer *does* offer one authority-shaped control — revocation. But revocation is binary and reactive: it answers "this agent should stop existing," not "this agent should do less." A [kill switch is not a governance policy](/blog/ai-agent-kill-switches-should-be-scoped), and an organization whose only lever between "full access" and "revoked" is panic will use neither well.

The tell is what each layer counts. Identity systems count principals, sessions, and grants. Authority systems count actions, dollars, tokens, and risk — cumulatively, per scope, against limits, before execution.

## How they compose

This is not a rivalry; it is a stack, and each layer makes the other more valuable:

1. **Identity feeds authority its subject.** A budget decision needs to know whose budget — the agent identity (and its sponsor, tenant, and delegation chain) is the key the authority layer scopes budgets to. Ungoverned identity makes authority decisions unattributable; ungoverned authority makes identities well-labeled blank checks.
2. **Authority adds budget lifecycle evidence.** Identity logs say who authenticated and what was accessed. Live reservations and settlement show what was held and charged against which scoped budget. The application must log non-persisting preflight outcomes and correlate them with the attempted email — the difference between "the agent connected to the email service 200 times" and "sends 1–200 settled within budget; send 201 was blocked after its reservation failed." Together, those records can form [evidence](/blog/what-goes-in-an-ai-agent-audit-packet).
3. **Revocation becomes the last resort instead of the only resort.** With per-action budgets underneath, a misbehaving agent degrades — capped, downgraded, denied — long before anyone needs the identity-level kill switch.

## The Takeaway

If you are rolling out Okta for AI Agents or Entra Agent ID this year: good, and finish the job. Register the agents, scope the credentials, map the sponsors — then attach [the layer that decides, action by action](/blog/what-is-runtime-authority-for-ai-agents), what each verified identity may actually spend and do. *Who* is answered. *How much* and *what next* are still open, and they are not identity questions.

## Sources

1. [Okta — Okta for AI Agents general availability](https://www.okta.com/blog/ai/okta-for-ai-agents-general-availability/) — April 2026 (April 30 GA per Okta's March press release)
2. [Okta — blueprint for the secure agentic enterprise](https://www.okta.com/newsroom/press-releases/showcase-2026/) — the three-questions framing and the 88% / 22% figures
3. [Microsoft Learn — What are agent identities? (Entra Agent ID)](https://learn.microsoft.com/en-us/entra/agent-id/what-are-agent-identities) — capabilities, Copilot Studio behavior, licensing

## Further Reading

- [Agent Identity Is Not User Identity](/blog/agent-identity-is-not-user-identity) — the prequel: why agents need dedicated identities at all
- [Runtime Authority vs. Runtime Authorization](/concepts/runtime-authority-vs-runtime-authorization) — the docs treatment of the access/authority line
- [The Moltbook Exposure](/blog/moltbook-exposure-agent-tokens-no-gates) — what unverified identity plus unscoped authority looks like in the wild
- [Agent Delegation Chains Need Authority Attenuation](/blog/agent-delegation-chains-authority-attenuation-not-trust-propagation) — why delegation is a budget problem
- [AI Agent Kill Switches Should Be Scoped](/blog/ai-agent-kill-switches-should-be-scoped) — degrading before revoking
- [What Is Runtime Authority for AI Agents?](/blog/what-is-runtime-authority-for-ai-agents) — the authority layer itself
