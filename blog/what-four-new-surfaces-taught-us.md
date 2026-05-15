---
title: "What Four New Surfaces Taught Us"
date: 2026-05-21
author: Albert Mavashev
tags:
  - action-authority
  - action-control
  - runtime-authority
  - agents
  - governance
  - architecture
description: "Memory writes, merges, clicks, voice. Each needed a different shape of the gate. The action authority lifecycle absorbed all four — here's what it means."
blog: true
sidebar: false
featured: false
head:
  - - meta
    - name: keywords
      content: "action authority generalization, runtime authority lifecycle, agent gate patterns, agent surface taxonomy, reserve-commit beyond tools, agent governance synthesis"
---

# What Four New Surfaces Taught Us

The last week of posts went deep on four agent surfaces the corpus had not treated as first-class action classes: [memory writes](/blog/agent-memory-writes-are-actions-too), [merge buttons](/blog/when-coding-agents-press-merge), [computer-use clicks](/blog/computer-use-agents-have-no-tool-boundary), and [voice frames](/blog/voice-agent-budgets-when-you-cant-pause-to-reserve). Each had its own shape, its own blast radius, its own opener-scenario disaster. Each ended up running through the same [reserve-commit lifecycle](/protocol/how-reserve-commit-works-in-cycles) the rest of the corpus uses for outbound side effects.

That was not the starting assumption. Memory writes looked like background state; the merge button looked like a CI/CD concern; clicks looked like UI automation; voice frames looked like a billing problem. The thesis that they were all *actions* — bound by the same authority lifecycle, just with different feature vectors — was the conclusion the posts argued for, not the premise.

A week later, the conclusion is firmer than I expected. The lifecycle generalized. The patterns are recognizably the same family. What changed across the surfaces was not the *primitives* — it was the *binding* of those primitives to the agent's actual shape.

<!-- more -->

## The Primitive That Held

[Reserve-commit](/glossary#reservation) is propose → ALLOW / ALLOW_WITH_CAPS / DENY → act → commit. It was originally written for one shape of action: a tool call with structured arguments, with a discrete moment between intent and execution where the gate could sit.

Across four surfaces, that abstract description held. What changed:

- For memory writes, the "discrete moment" is between the model emitting an `add` / `update` instruction and the memory layer persisting it.
- For merge buttons, it sits between the agent's `gh pr merge` intent and the call leaving the harness.
- For clicks, it sits between the model's click target resolution and the mouse event firing on the page.
- For voice frames, it sits *before the call begins*, in the form of a predictive [reservation](/glossary#reservation) that the audio loop draws against.

Voice is the load-bearing case. The other three sites preserve the per-action gate; voice moves it to a per-call gate plus per-bracket re-checks. The primitive is the same — *propose, decide, act, commit* — but the cadence at which it runs is different. The lifecycle did not have to be rewritten to accommodate that. It just had to be re-bound.

## What Differed Between Surfaces

Four things varied. None broke the primitive.

**The feature vector.** Outbound tool calls had a tool name and structured arguments to gate on. Memory writes had an operation + a scope. Merges had a branch + an author + an approver. Clicks had a URL pattern + a DOM target + an action verb + (for pixel agents) a screenshot crop. Voice had a tier + a duration + a wall-clock budget. The rule body looked at different things; the rule shape stayed.

**The blast radius shape.** Outbound side effects radiate outward — an email reaches one recipient. Memory writes radiate forward in time — one bad fact reaches every future retrieval. Merges fan out through CI/CD — one merge triggers a deploy matrix. Clicks land at exactly one DOM element but the wrong DOM element changes the entire blast radius. Voice frames don't have a discrete radius at all; they accumulate cost continuously. The rule body absorbed each, but the *risk scoring* had to be surface-aware.

**The timing of the decision.** Tool calls and merges sync-gate cleanly because the agent already pauses. Memory writes sync-gate because the write is itself a moment. Clicks sync-gate at the per-click level but require freshness re-checks against the screenshot the model used. Voice cannot sync-gate per frame and has to pre-reserve. Same lifecycle, different *when*.

**The audit unit.** Tool calls record one decision per call. Memory writes record one per fact, with provenance. Merges record one per merge attempt, separate from Git's audit trail. Clicks record one per click attempt, separate from the application logs. Voice records one per call plus per-bracket re-checks. Same audit primitive (pre-execution decision + commit + release); different cardinality.

The four-surface table:

| Surface | Feature vector | Blast radius | Gate timing | Audit cardinality |
|---|---|---|---|---|
| Outbound tool calls | tool + args | Outward in space | Sync per call | 1 per call |
| Memory writes | operation + scope | Forward in time | Sync per write | 1 per fact |
| Merge buttons | branch + author + approver | [Fan-out](/glossary#fan-out) via CI/CD | Sync per merge | 1 per merge |
| Clicks | URL + DOM/region + intent | Single DOM target; severity depends on target + context | Sync per click + freshness | 1 per click |
| Voice frames | tier + duration + wall-clock | Continuous accumulation | Predictive + per-bracket | 1 per call (with periodic re-checks) |

The lifecycle itself does not appear in this table: the table tracks what varies (binding and cadence), not the decision primitive (propose → decide → act → commit), which the four surfaces preserved at their boundaries.

## What Each Surface Added

Memory writes added the *temporal* dimension to [action authority](/glossary#action-authority). The corpus had thought of blast radius as spatial — how far does the side effect reach? Memory forced the temporal axis: how far forward does this write propagate, retrieved at what amplification, by what future runs? The TTL-on-unverified-facts pattern and the per-write provenance argument are both temporal patterns that did not exist in the old action-authority framing.

Merge buttons added the *trust elevation* dimension. The corpus had treated authorship and execution as separate but symmetric concerns. Merge made it asymmetric — the *promotion* of a state into the trunk is a distinct action from the *creation* of that state. The bot-reviewer loophole (an agent author and an agent approver satisfying a one-approval rule) shows up most cleanly at the merge layer, where the audit trail is built around author + approver pairs. Analogous approval loops can exist for deploys and other promotion gates, but the merge surface is where the corpus first foregrounded distinct-approver caps as a framework primitive.

Computer-use clicks added the *(target, intent, context)* dimension. The corpus had quietly assumed that tool names carried semantic information. When every state-changing tool is `click`, the rule body has to look at what is being clicked, where, why, in what URL, with what DOM context. The schedule rows changed from `tool_name -> points` to `(URL pattern × DOM target × action verb × site authority) -> points`. The framework absorbed this by realizing the *tool name* was always just one feature; for screen-control agents it just happens to be uninformative.

Voice frames added the *latency constraint* dimension. The corpus had implicitly assumed the gate could sit anywhere — that "before the action" was a moment with no upper bound on its duration. Voice put a ~700 ms ceiling on the conversation's response latency, leaving no room for a synchronous per-frame gate. A sync gate that fits that budget is impossible for the audio path; a predictive reservation that pre-pays for the call is the answer. The framework absorbed this by separating the *decision* from the *enforcement timing* — the decision still happens, just earlier.

Each addition was a load-bearing constraint that the framework's prior shape did not foreground. Each made the framework's generality more visible.

## What This Predicts for the Next Surface

If the lifecycle generalized this cleanly across four surfaces, what does it predict about the next one?

The next surface that needs first-class treatment is probably one where one of these dimensions stretches further:

- **Multi-agent voice-to-voice.** Two voice agents talking to each other over a phone bridge — a credit-card dispute handled by the bank's voice agent and the merchant's voice agent in real time. The latency constraint stays; the *trust* relationship is now agent-to-agent rather than agent-to-human. The [authority attenuation](/blog/agent-delegation-chains-authority-attenuation-not-trust-propagation) argument plausibly applies, with the audit unit shifting from *the call* to *the conversation*. The likely shape: same lifecycle, new feature vector (peer-agent identity, conversation budget, attenuation level) — though the deny-side mechanics for two simultaneously running fast paths are genuinely new and would need to be worked through.

- **Embodied agents.** A robot arm in a warehouse acting on physical inventory. The feature vector plausibly includes a *position*, a *force*, a *contact prediction* — and the irreversibility is genuinely physical. Rollback windows are much narrower if they exist at all. The framework's likely shape: same lifecycle, new feature vector, much stricter cap policies because the deny-window pattern barely applies to a moving robot arm. Whether the lifecycle holds at all here is the open question; physical irreversibility is the strongest test the framework has not yet faced.

- **Agent-controlled infrastructure provisioning.** The agent says `terraform apply` against a real cloud. The feature vector is the resource diff, the environment, the cost delta. This is closer to the merge surface but with a much larger blast radius and a much wider time-to-discovery. Probably absorbs cleanly into the lifecycle; the schedule is likely dominated by Tier 4 events.

In each case, the surface adds at least one feature that prior surfaces did not have. The hypothesis the four-surface evidence supports is that the lifecycle does not break — it just needs a new feature vector and a tuned schedule. The substrate is uniform; the surfaces are not. Each new surface remains a real test of that hypothesis, not a forgone conclusion.

## What Did Not Generalize

Two things did *not* generalize cleanly, and both are worth flagging.

**Provider-side fixes are surface-specific.** Scoped [tokens](/glossary#tokens) for infrastructure APIs, branch protection rules for merges, browser-session scoping for clicks, provider per-call caps for voice. Each is a real and useful fix; none of them transfers to the next surface without redesign. The corpus's [PocketOS argument](/blog/pocketos-aftermath-delete-delay-vs-scoped-tokens) — that provider scoping and agent-side authority are two layers and neither is sufficient alone — turns out to be true on every surface, with different provider mechanisms each time.

**The agent harness does most of the surface-specific work.** The [runtime authority](/glossary#runtime-authority) decision is abstract. Turning that decision into "do not let this click fire" or "do not let this audio frame stream" or "do not let this memory write persist" requires harness code that knows the surface. The corpus's split between *authority* and *enforcement* — authority decides, harness enforces — held up. But the enforcement side is where most of the engineering effort goes when adopting the framework on a new surface.

The framework's portability is real but partial. The decision model transfers. The integration work does not.

## Reserve-Commit Is the Stable Layer

The most useful thing the four surfaces taught us is structural: the [action authority lifecycle](/glossary#action-authority) — propose, decide, act, commit — held up as the stable layer in this stack. Surfaces will keep arriving — multi-agent voice, embodied agents, infrastructure provisioning, whatever the next frontier model surface adds — and each will have its own feature vector and its own enforcement work. Across the four surfaces here, the decision shape, the audit shape, and the [three-way decision](/glossary#three-way-decision) model did not need to change; the bet is that the same holds for surfaces still to come, though each will earn that conclusion the same way these did — by being walked through end to end.

Voice is the partial exception worth being explicit about. Slow-path tool calls in a voice session preserve reserve-commit unchanged, but the fast audio path uses predictive reservation and floor-authority patterns that move the per-action decision earlier in time. The decision shape — propose, decide, audit — is preserved at the boundaries; the cadence is different. That is the cleanest demonstration of what "the lifecycle generalized" means in practice: the primitives held, the binding shifted.

Posts like the four siblings are useful in two ways. First, they extend the framework to new surfaces in practice, so the corpus has a worked example for the next team facing one of them. Second, they probe the framework's generality — every surface that fits with the lifecycle preserved at its boundaries is evidence that the framework is *the right shape*, not just *one reasonable shape*. Four surfaces, with the lifecycle preserved at the decision boundaries, is evidence of shape rather than coincidence.

The next time a team adopts runtime authority on a new agent surface, the lifecycle is the most likely starting point — though new surfaces should be expected to stretch the binding the way voice did with the audio path. The questions are: *what is the feature vector for the rule body, what is the schedule for risk-point assignment, where does the gate sit (per-action, per-call, or pre-reserved against a cumulative budget), and what does the harness have to do to honor the decision?*

## Next Steps

- **[Agent Memory Writes Are Actions, Too](/blog/agent-memory-writes-are-actions-too)** — the temporal-dimension extension
- **[When Coding Agents Press Merge](/blog/when-coding-agents-press-merge)** — the trust-elevation extension
- **[Computer-Use Agents Have No Tool Boundary](/blog/computer-use-agents-have-no-tool-boundary)** — the (target, intent, context) extension
- **[Reserving Authority When You Can't Pause](/blog/voice-agent-budgets-when-you-cant-pause-to-reserve)** — the latency-constraint extension
- **[What Is Runtime Authority for AI Agents?](/blog/what-is-runtime-authority-for-ai-agents)** — the framework anchor
- **[Runtime Authority vs Guardrails vs Observability](/blog/runtime-authority-vs-guardrails-vs-observability)** — the layer comparison
- **[How Reserve-Commit Works in Cycles](/protocol/how-reserve-commit-works-in-cycles)** — the lifecycle that absorbed all four surfaces
- **[AI Agent Action Control: Hard Limits on Side Effects](/blog/ai-agent-action-control-hard-limits-side-effects)** — the parent post the four siblings extend
