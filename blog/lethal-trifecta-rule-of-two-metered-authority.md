---
title: "Lethal Trifecta, Rule of Two, and Metered Authority"
date: 2026-07-16
author: Albert Mavashev
tags: [security, agents, prompt-injection, runtime-authority, action-control, architecture, best-practices]
description: "Willison's lethal trifecta and Meta's Rule of Two both subtract agent capabilities. A third option: keep all three legs and meter the most dangerous one."
blog: true
sidebar: false
featured: false
head:
  - - meta
    - name: keywords
      content: "lethal trifecta, agents rule of two, prompt injection mitigation, AI agent security, agent capability subtraction, metered authority, action budgets, runtime authority, indirect prompt injection"
---

# Lethal Trifecta, Rule of Two, and Metered Authority

The two most useful frames in agent security are both subtraction arguments.

Simon Willison's [lethal trifecta](https://simonwillison.net/2025/Jun/16/the-lethal-trifecta/) names the dangerous combination: access to private data, [exposure](/glossary#exposure) to untrusted content, and the ability to communicate externally. His claim is blunt — combine all three and "an attacker can easily trick it into accessing your private data and sending it to that attacker" — and so is his mitigation: "the only way to stay safe there is to avoid that lethal trifecta combination entirely." Remove a leg.

Meta's [Agents Rule of Two](https://ai.meta.com/blog/practical-ai-agent-security/) (October 2025) systematizes the same instinct: within a session, an agent must satisfy **no more than two** of — processing untrustworthy inputs, accessing sensitive data or systems, changing state or communicating externally. Follow it and the highest-impact consequences of prompt injection are, in Meta's words, deterministically reduced.

Both frames are correct, and both are honest about why they work: they don't try to *detect* injection — a fight Willison is rightly skeptical anyone is winning — they make the worst outcome structurally unreachable. The problem is what they cost. This post is about a third option for the cases where that cost is the product.

<!-- more -->

## The subtraction tax

Look at what the most valuable agent deployments of 2026 actually are. A support agent that reads customer tickets (untrusted input), consults account history (private data), and replies to the customer (external communication). A coding agent that reads issues and dependencies (untrusted), accesses the repository (sensitive), and [opens or merges pull requests](/blog/when-coding-agents-press-merge) (state change). An outreach agent, a procurement agent, a triage agent — the pattern repeats because the trifecta legs are not incidental capabilities. **They are the job description.** An agent that reads, knows, and acts is the product; remove a leg and you have removed the reason it was built.

Teams facing this today resolve it in one of three ways: quietly run the trifecta anyway and hope (many, judging by the [incident record](/blog/state-of-ai-agent-incidents-2026)); insert a human approval on every consequential action, which works until [approval fatigue](/blog/ai-agent-approval-queues-need-runtime-authority) turns the human into a rubber stamp; or genuinely restructure into Rule-of-Two-compliant sessions, which is the right call more often than teams want to hear — but not always available.

## The third option: keep all three, meter the third leg

The trifecta's three legs are not equally dangerous. Reading untrusted content corrupts *intent*. Accessing private data creates *stakes*. But nothing bad has actually happened until the third leg fires — the send, the write, the merge, the call. Exfiltration, in the end, is an action.

That asymmetry is the opening. Instead of removing the action leg, put it behind a pre-execution gate — [runtime authority](/glossary#runtime-authority) with a metered allowance:

- **Every externally visible action is priced** — in [RISK_POINTS](/glossary#risk-points) by blast radius, and in count per action class. A `reply_to_ticket` costs little; an `email_external` costs much; a `merge_pr` may cost the whole budget.
- **Every run carries a bounded allowance**, scoped to this agent, this workflow, this [tenant](/glossary#tenant). The agent that has been successfully injected does not thereby acquire a bigger budget.
- **The gate checks before execution.** Application authorization enforces destinations and arguments; a mandatory Cycles reservation bounds caller-assigned cumulative exposure. The current server does not inspect recipients or implement action-class quotas, so those controls must live in the host or gateway.

The property this preserves is the one that makes the subtraction frames trustworthy: **determinism**. This is not a classifier guessing whether the model was manipulated — a probabilistic guardrail of exactly the kind Willison discounts. It is a counter and a policy, evaluated outside the model, on infrastructure the model's context cannot rewrite. An injected agent can want anything; it can *do* at most its allowance.

## What metering does not fix — said plainly

Metering does not make prompt injection safe. An attacker who hijacks an agent with a ten-external-sends budget gets up to ten malicious sends to allow-listed destinations before the wall. If a single permitted action is catastrophic — one wire transfer, one production delete — a meter set above zero is a meter set wrong, and that action either needs its own near-zero quota, a human gate, or removal from the agent's reach entirely, which is Rule of Two again for that action class.

## How the frames compose

So the frames compose rather than compete:

| Frame | Move | Best when |
|---|---|---|
| Lethal trifecta / Rule of Two | Remove or separate a leg per session | The capability isn't core to the product; single actions are catastrophic |
| Metered authority | Keep all legs; bound the action leg with priced, counted, pre-execution allowances | All three legs *are* the product; damage scales with action count |
| Both | Rule of Two for the catastrophic action classes; metering for the rest | Almost every real deployment |

One more property tips the balance in production: a meter produces a record. Every `ALLOW` and `DENY` is a decision with a reason, a scope, and a timestamp — the [audit evidence](/blog/a-200-ok-is-not-an-audit-trail) that a leg you removed can never generate, because removed legs don't leave receipts. When the security review asks "how do you know the agent never exfiltrated," an architecture answer is good; an architecture answer *plus a ledger of every denied send* is better.

The [agent security controls map](/blog/agent-security-controls-map) places these layers side by side: prompt hygiene and detection reduce the *rate* of hijacks, subtraction bounds the *worst case*, metered authority bounds the *blast radius* of everything in between. Willison and Meta gave the field two deterministic frames. For the agents whose job is the trifecta, the meter is a third — not instead of the first two, but for the ground they deliberately don't cover.

## Sources

1. [Simon Willison — The lethal trifecta for AI agents](https://simonwillison.net/2025/Jun/16/the-lethal-trifecta/) — June 16, 2025
2. [Meta AI — Agents Rule of Two: a practical approach to AI agent security](https://ai.meta.com/blog/practical-ai-agent-security/) — October 31, 2025
3. [Simon Willison — on the Rule of Two and "The Attacker Moves Second"](https://simonwillison.net/2025/Nov/2/new-prompt-injection-papers/) — November 2, 2025

## Further Reading

- [Agent Security Controls Map](/blog/agent-security-controls-map) — where each control layer sits and what job it owns
- [Beyond Budget: How Cycles Controls Agent Actions](/blog/beyond-budget-how-cycles-controls-agent-actions) — the action-authority mechanics
- [AI Agent Risk Assessment: Score, Classify, Enforce](/blog/ai-agent-risk-assessment-score-classify-enforce-tool-risk) — pricing actions by blast radius
- [MCP Tool Poisoning: 84% Success Rate](/blog/mcp-tool-poisoning-why-agent-frameworks-cant-prevent-it) — why detection alone keeps losing
- [The Moltbook Exposure](/blog/moltbook-exposure-agent-tokens-no-gates) — injection at social scale, and bounding what a hijacked agent can do
- [When Budget Runs Out: Degradation Patterns](/blog/when-budget-runs-out-graceful-degradation-patterns-for-ai-agents) — what agents do at the wall
