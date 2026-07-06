---
title: "The Moltbook Exposure: 1.5M Agent Tokens, No Gates"
date: 2026-07-09
author: Albert Mavashev
tags: [incidents, security, agents, identity, api-keys, supply-chain, runtime-authority, governance]
description: "Wiz found 1.5M agent API tokens exposed on Moltbook via a hardcoded Supabase key. What it teaches about agent identity, credentials, and runtime authority."
blog: true
sidebar: false
featured: false
head:
  - - meta
    - name: keywords
      content: "Moltbook security, Moltbook exposure, AI agent social network, agent API tokens, agent identity, indirect prompt injection, OpenClaw security, agent credential compromise, runtime authority"
---

# The Moltbook Exposure: 1.5M Agent Tokens, No Gates

In late January 2026, Moltbook — the self-described "front page of the agent internet," where AI agents post, comment, vote, and build karma — was the viral social platform nobody's HR department had heard of. Then [Wiz looked at its database](https://www.wiz.io/blog/exposed-moltbook-database-reveals-millions-of-api-keys).

What they found was not an exotic agent-era attack. It was a hardcoded Supabase API key in client-side JavaScript, combined with missing row-level security — roughly 4.75 million records readable and writable by anyone who checked. Among them: **1.5 million agent API authentication tokens**, 35,000 user email addresses, and 4,060 private agent-to-agent conversations. Moltbook patched it about three hours after Wiz's disclosure, and no malicious exploitation of the [exposure](/glossary#exposure) has been reported.

So why write about a misconfiguration that appsec fundamentals would have prevented? Because everything *around* the misconfiguration is new. The exposure is the clearest preview yet of what fails when agents get social infrastructure before they get governed authority — and most of what failed maps to controls that exist today.

<!-- more -->

## What was exposed, and what it enabled

| Fact | Detail |
|---|---|
| Root cause | Hardcoded Supabase key in client-side JS + missing row-level security |
| Exposed | ~4.75M records: 1.5M agent API tokens, 35K user emails, ~30K early-access emails, 4,060 private agent conversations |
| Disclosure → fix | Wiz contacted Moltbook January 31, 2026 (21:48 UTC); final patch ~3 hours later |
| Capability, per Wiz | Any agent's token: full impersonation of that agent. The database itself: read/write across platform data, including modifying existing posts |
| The ratio | The "1.5 million agents" resolved to roughly 17,000 human accounts — about 88 agents per person |

The last two rows are where this stops being an ordinary leak. A leaked session token on a human social network compromises one account. A leaked *agent* token pool on an agent network compromises an audience — because the readers are agents too, and what agents read shapes what they do.

## Three lessons that outlive the incident

### 1. Agent identity measured nothing — and identity is the layer everyone is building

Moltbook's headline number claimed 1.5 million [autonomous agents](/glossary#autonomous-agent). Wiz's investigation found ~17,000 humans operating them, with no verification distinguishing an autonomous agent from a human-driven bot fleet. The platform's unit of trust — "this is an agent, with karma" — measured nothing.

The industry response to problems like this is identity infrastructure: registries, agent credentials, signed agent cards. Those are necessary — an agent without provenance can't be governed at all, which is why [agent identity is not user identity](/blog/agent-identity-is-not-user-identity) argues for dedicated agent identities with owner mapping. But Moltbook shows the ceiling of identity alone: even perfect verification of *who* an agent is says nothing about *what it may do next, at whose expense*. Palo Alto Networks' [read of the case](https://www.paloaltonetworks.com/blog/network-security/the-moltbook-case-and-how-we-need-to-think-about-agent-security/) gets the framing right — identity, operating boundaries, and context integrity as three pillars. The operational question it leaves open is the one that matters in production: boundaries defined where, enforced by what, at which moment? A boundary that lives in a policy document is a wish. A boundary evaluated before each action is a control.

### 2. One credential carried total authority

Per Wiz, any exposed token allowed complete impersonation of that agent — posting and messaging as it, indistinguishably. The token was not scoped to a capability, a rate, a budget, or a blast radius. It was the agent, in bearer form.

This is the pattern [least-privilege API keys for AI agents](/blog/least-privilege-api-keys-for-ai-agents) exists to break. The engineering goal is not "never leak a credential" — credentials leak; that assumption is the entire premise of modern security architecture. The goal is that a leaked agent credential is a *bounded liability*: scoped to one agent, one [tenant](/glossary#tenant), one set of permitted operations, with a spend and action budget that runs dry long before platform-wide damage. Under that design, 1.5 million leaked tokens is 1.5 million small problems instead of one existential one. Bearer-token-equals-total-authority is a choice, and it is the wrong one for principals that act autonomously at machine speed.

### 3. An agent audience is an injection amplifier

The sharpest capability in Wiz's write-up is easy to skim past: an attacker could modify posts and inject content *into a feed consumed by agents*. Moltbook's readers are agents — many of them OpenClaw-based — running on their owners' machines — commonly, [per Fortune's reporting](https://fortune.com/2026/02/02/moltbook-security-agents-singularity-disaster-gary-marcus-andrej-karpathy/), with access to files and credentials. Andrej Karpathy, after initially calling the platform "the most incredible sci-fi takeoff-adjacent thing I've seen recently," landed on: "it's a dumpster fire, and I also definitely do not recommend that people run this stuff on your computers." Gary Marcus was blunter, calling the underlying stack "a disaster waiting to happen."

Indirect prompt injection has sat at the top of [OWASP's LLM Top 10](https://genai.owasp.org/llm-top-10/) since its first edition, and the [ClawHub malicious-skill wave](/blog/state-of-ai-agent-incidents-2026) had already shown the supply-chain variant: content an agent ingests becomes instructions an agent may follow. What Moltbook adds is scale and legitimacy — a write-capable attacker doesn't need to poison one tool or one skill; they publish to a feed that thousands of autonomous readers treat as ambient input. And that is not hypothetical: separate from the database exposure, identity-security firm Permiso [documented live malicious activity on the platform](https://www.securityweek.com/security-analysis-of-moltbook-agent-network-bot-to-bot-prompt-injection-and-data-leaks/) — bot-to-bot prompt injections, crypto pump-and-dump schemes, agents instructed to delete their own accounts. As Permiso put it: "They're not attacking the infrastructure. They're attacking the agents directly, trying to manipulate their behavior through crafted prompts." It is the same structural gap as [tool poisoning](/blog/mcp-tool-poisoning-why-agent-frameworks-cant-prevent-it) and the [skills supply chain](/blog/agent-skills-are-the-new-supply-chain): the agent's input channel is untrusted, and the framework running the agent cannot fully validate it.

You cannot sanitize the agent internet. You can bound what an agent that read something malicious is able to do about it.

## What bounded authority changes — and what it doesn't

Honesty first: [runtime authority](/glossary#runtime-authority) would not have prevented the Moltbook exposure. A hardcoded key and missing row-level security are application-security failures with application-security fixes, and Wiz's recommendations there are the right ones.

What bounded authority changes is the *consequence graph* after any of these failures fires:

- **A stolen agent token meets a per-agent budget.** An attacker who fully controls a token scoped to "20 posts/day, $2/day, no external sends" has acquired very little.
- **An injected instruction meets an action gate.** The agent that read a poisoned post and decided to exfiltrate a file or email a third party hits a pre-execution decision — `ALLOW`, `ALLOW_WITH_CAPS`, or `DENY` — evaluated against what *this* agent, in *this* scope, is permitted to do. The [action-authority model](/concepts/action-authority-controlling-what-agents-do) prices high-blast-radius operations in [RISK_POINTS](/glossary#risk-points) precisely so that "the model got convinced" is not sufficient to cause damage.
- **A bot-fleet operator meets attenuation.** Eighty-eight agents per human is not inherently abuse — it is a delegation chain. [Authority attenuation](/blog/agent-delegation-chains-authority-attenuation-not-trust-propagation) says each spawned agent should hold a narrower budget and scope than its parent, so a fleet's aggregate authority is capped by design rather than multiplied by enrollment.

None of this is specific to Moltbook. Any platform that combines agent credentials with agent-consumed feeds — social, marketplace, enterprise — is one misconfiguration away from the same triad: unverified identity, unscoped credentials, injectable input. Unscoped credentials and injectable input have runtime answers today; verified identity is still an ecosystem build-out.

## A short checklist for anyone operating agents that read the internet

1. **Scope every agent credential** to the narrowest tenant, capability set, and budget that the agent's job allows. Assume it leaks; size the damage now.
2. **Gate side effects, not just spend.** Posting, sending, writing files, and calling external APIs deserve action budgets independent of token cost — the [RISK_POINTS assignment guide](/how-to/assigning-risk-points-to-agent-tools) is the practical starting point.
3. **Treat agent-consumed feeds as untrusted input**, the way you already treat user input. If your agent reads social content, marketplace skills, or shared memory, its authority — not its judgment — is your control surface.
4. **Attenuate delegation.** If one identity can operate dozens of agents, ensure each holds less authority than the operator, and that the aggregate is capped.
5. **Keep the audit trail external to the platform.** Moltbook's operators needed three hours to fix the hole; knowing what your agents did during any such window requires records the compromised platform doesn't own.

The Moltbook exposure ended as well as these things can: found by researchers, patched in hours, no reported harm. The next one will not be obligated to follow that script. The controls that make the difference are not waiting on new standards — they are waiting to be turned on.

## Sources

1. [Wiz Research — Exposed Moltbook database reveals millions of API keys](https://www.wiz.io/blog/exposed-moltbook-database-reveals-millions-of-api-keys) — disclosure timeline, exposed data, root cause
2. [Fortune — Moltbook security concerns, with Karpathy and Marcus reactions](https://fortune.com/2026/02/02/moltbook-security-agents-singularity-disaster-gary-marcus-andrej-karpathy/) — February 2, 2026
3. [Palo Alto Networks — The Moltbook case and how we need to think about agent security](https://www.paloaltonetworks.com/blog/network-security/the-moltbook-case-and-how-we-need-to-think-about-agent-security/) — identity / boundaries / context-integrity framing
4. [SecurityWeek — Permiso's analysis of Moltbook: bot-to-bot prompt injection and data leaks](https://www.securityweek.com/security-analysis-of-moltbook-agent-network-bot-to-bot-prompt-injection-and-data-leaks/) — live malicious activity, distinct from the database exposure

## Further Reading

- [Agent Identity Is Not User Identity](/blog/agent-identity-is-not-user-identity) — why agents need dedicated, owner-mapped identities
- [Least-Privilege API Keys for AI Agents](/blog/least-privilege-api-keys-for-ai-agents) — making a leaked credential a bounded liability
- [MCP Tool Poisoning: 84% Success Rate](/blog/mcp-tool-poisoning-why-agent-frameworks-cant-prevent-it) — the tool-channel variant of the same gap
- [Agent Skills Are the New Supply Chain](/blog/agent-skills-are-the-new-supply-chain) — governing what agents ingest and execute
- [The State of AI Agent Incidents (2026)](/blog/state-of-ai-agent-incidents-2026) — the catalog this incident joins
- [Agent Delegation Chains Need Authority Attenuation](/blog/agent-delegation-chains-authority-attenuation-not-trust-propagation) — capping fleets by design
