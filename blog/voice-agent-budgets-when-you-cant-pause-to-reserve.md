---
title: "Reserving Authority When You Can't Pause"
date: 2026-05-20
author: Albert Mavashev
tags:
  - voice-agents
  - realtime
  - budgets
  - latency
  - runtime-authority
  - agents
  - engineering
  - RISK_POINTS
description: "OpenAI Realtime, Vapi, Retell AI — voice agents can't wait 300ms for ALLOW. Patterns for budget authority when reserve-commit can't sit synchronously in the path."
blog: true
sidebar: false
featured: false
head:
  - - meta
    - name: keywords
      content: "voice agent budgets, realtime API budget control, OpenAI Realtime cost, Vapi pricing, Retell AI budget, voice agent runtime authority, conversational AI cost control, latency budget reserve-commit, agent budget authority"
---

# Reserving Authority When You Can't Pause

A retail-support voice agent gets a call from a customer who is talking about returns, late shipping, and a damaged item. Twelve minutes in, the conversation hits an edge case in the prompt — the agent cannot find the right wrap-up template, so it produces a long, careful, summarizing response. Then another. Then another. The customer is patient; the agent is on-brand; the conversation continues. By minute 17 the session has spent $90 across the realtime model, premium TTS, repeated tool look-ups, the orchestrator, and the carrier minutes. The dollar cap on the customer's plan is $50.

Nobody is at fault on the call. The customer's question was reasonable. The agent's response was reasonable. The model's output was, in some local sense, *good*. The failure is one layer down: nothing between the agent's intent to generate the next audio frame and the actual audio leaving the WebSocket asked whether the session was still allowed to pay for it.

This is the constraint that breaks the reserve-commit pattern the rest of the corpus assumes. The [reserve-commit lifecycle](/protocol/how-reserve-commit-works-in-cycles) — propose, ALLOW / ALLOW_WITH_CAPS / DENY, then act — has a load-bearing assumption: the agent can *wait* for the decision. Voice and realtime agents cannot. The end-of-user-speech to start-of-AI-audio latency budget is roughly 700 ms for a conversation to feel natural, and the current pipelines already spend 300–500 ms of that on the model itself. A 100 ms synchronous gate on every audio frame would push the conversation past the threshold where humans stop hearing it as a conversation.

So the question is not *whether* voice agents need [runtime authority](/glossary#runtime-authority). They need it as much as tool-calling agents do, and in some ways more — the per-minute cost is high, the failure modes are unattended, and sessions can run for many minutes. The question is how to enforce it when the gate cannot sit synchronously in the path.

<!-- more -->

## What's Different About the Voice Surface

Traditional tool-calling agents have natural pause points. A function call returns; the agent decides what to do next; before the next call goes out, a [runtime authority](/glossary#runtime-authority) gate can run. The 50–150 ms a Cycles-style gate adds is invisible to the user, because the user is not waiting on the agent's loop in real time.

Voice agents do not have those pauses. The architecture is roughly:

1. Audio in (microphone → WebSocket → ASR or end-to-end audio model)
2. Model processing (streaming)
3. Audio out (TTS or end-to-end audio model → WebSocket → speaker)
4. Repeat — except (1) and (3) overlap continuously, because the user can interrupt at any moment

The whole loop runs at the cadence of speech. Production deployments on the [OpenAI Realtime API](https://openai.com/index/delivering-low-latency-voice-ai-at-scale/) typically land in a 300–500 ms response window from end-of-user-speech to start-of-agent-audio, with conversation-feel guidance from voice-AI platforms and turn-taking research converging around a ~700 ms ceiling before exchanges start feeling stilted. Inside that budget, the audio buffers are streaming continuously — there is no "before the next call" point where a sync gate can sit.

The cost shape is also different. A single conversation costs real money in a way an LLM-only agent does not:

| Stack | Typical all-in cost | Notes |
|---|---|---|
| OpenAI Realtime API | ~$0.18–$0.46/min uncached, $0.05–$0.10/min with prompt caching | Per [recent pricing analysis](https://callsphere.ai/blog/vw2c-openai-realtime-cost-per-minute-math-2026) |
| ElevenLabs Agents | $0.08–$0.24/min all-in | Hosting + premium TTS bundled |
| Retell AI | $0.07–$0.31/min depending on configuration | Single price for the assembled pipeline; lower end for a basic single-pipeline setup, higher with premium LLM and voice add-ons |
| Vapi | $0.05/min orchestration + BYOK provider stack ≈ $0.115–$0.42/min real-world | Customer wires their own ASR / LLM / TTS |

A 17-minute conversation at premium settings lands between roughly $1.50 and $8.00 of model spend alone, before any tool calls, carrier minutes, or compliance overhead. A runaway loop with repeated tool look-ups, premium TTS, and a premium model can multiply that several-fold. The opener's $90 figure assumes a session that has been triggering an expensive lookup tool on every turn — well within what an unattended loop can produce in under twenty minutes.

The conventional treatment in the corpus — [enforce a dollar cap, reserve before each model call](/blog/ai-agent-budget-control-enforce-hard-spend-limits) — does not directly fit. There is no discrete "model call" in a voice session. There is a continuous stream of audio frames, each of which has been billed by the time the next one ships.

## Where the Action Surface Splits

A voice agent's action surface is not uniformly latency-sensitive. The audio path is. The tool-call path is not. Treating them as one budget is what makes the problem look intractable.

| Path | Latency sensitivity | Cost dominant in | Gate strategy |
|---|---|---|---|
| Streaming audio frames | High (sub-100ms per frame) | Model audio I/O, TTS | Cannot sync-gate per frame; needs predictive or async |
| Tool / function call within session | Low (the conversation already pauses) | Tool side effects | Sync gate fits naturally |
| Premium-tier escalations (voice cloning, higher model, deep research) | Variable | Premium feature surcharges | Sync gate at the escalation moment |
| End-of-call summary / write-back | None | Tool side effects | Sync gate fits naturally |
| Background work (logging, ticket creation) | None | Outbound writes | Async, post-call |

Most of the slow-path actions in a voice session — tool calls, escalations, end-of-call writes — already pause the conversation. They get the same reserve-commit treatment as in any other agent. The fast path — the per-frame audio — is the part that needs a different pattern.

This is the same shape as the [tier model in action authority](/blog/ai-agent-action-control-hard-limits-side-effects) applied to a streaming surface: some actions tolerate a sync gate, some do not. The fix is not to abandon the gate; it is to position it where the latency budget can absorb it.

## Pattern 1: Predictive Reservation, True-Up Later

The simplest pattern. At call start, the agent reserves an upper-bound amount of authority for the call — enough to cover the expected duration plus headroom. Audio frames consume the [reservation](/glossary#reservation) as they ship, with no per-frame round-trip to the gate. At call end (or on graceful timeout), the agent commits the actual consumption.

| Step | When | Latency contribution |
|---|---|---|
| Reserve N minutes of authority at call start | Before WebSocket open | One sync gate, latency-budget-free |
| Stream audio frames, decrement local counter | Throughout call | Zero — local check only |
| Local counter approaches reservation limit | At ~80% consumed | Re-reserve incrementally (sync, but the conversation has a natural turn boundary) |
| Commit actual consumption | At call end | Async, no user-visible latency |

The big variable is *N*. A reservation that is too small forces frequent re-reservations, each of which is a sync gate at an awkward moment in the conversation. A reservation that is too big over-holds budget against the [tenant's](/glossary#tenant) cap and bounds concurrent calls poorly.

The honest answer is empirical. After a few hundred calls, the team has distributions: median call length, 95th percentile, ratio of premium-feature use, etc. The reservation should target the 95th percentile of expected consumption plus a safety margin. The same [estimate drift](/blog/estimate-drift-silent-killer-of-enforcement) considerations apply — reserve-to-actual ratios should be monitored and recalibrated, just at coarser granularity than for tool-calling agents.

The re-reservation step is where most voice teams get the user-visible latency wrong. The naive implementation re-reserves when the counter hits zero, which often coincides with the agent speaking. A better implementation re-reserves at the next turn boundary after crossing the 80% threshold — the conversation already pauses at turn boundaries, so the sync gate fits the existing latency budget.

## Pattern 2: Tier-Aware Gating

The fast-path audio cannot sync-gate. The slow-path tool calls can. Pattern 2 makes that explicit:

- Audio frames draw from a *predicted reservation* (Pattern 1).
- Tool calls go through standard [reserve-commit](/glossary#reservation).
- Premium-tier escalations (mid-call) get their own sync gate.

The implementation lives in the agent harness, not in the runtime authority. The harness routes each proposed action to the appropriate gate. For OpenAI Realtime, that means wrapping the WebSocket so that tool-call events (function-call messages from the model) get a sync gate before being relayed, while audio events do not. For Vapi, where the orchestrator already mediates tool dispatch, the gate plugs into the orchestrator's tool-call layer.

The corpus has a parallel argument in [Cycles vs LLM Proxies and Observability Tools](/blog/cycles-vs-llm-proxies-and-observability-tools): the position of the gate determines what kinds of actions it can govern. For voice, the gate has two positions — one in the per-call reservation lifecycle (slow path) and one at the audio buffer (fast path). They are different gates with different latency budgets, both enforcing the same authority.

## Pattern 3: Time-Bounded Floor Authority

For very high-throughput voice deployments where even per-turn re-reservation feels intrusive, a different shape: each session holds a base authority floor that auto-replenishes at a steady rate (per-second, per-N-[tokens](/glossary#tokens)). The agent does not ask for ALLOW; it draws against the floor as long as the floor is non-zero.

```
session_authority(t) = min(
  base_floor + (replenish_rate × seconds_since_grant),
  hard_cap
) - cumulative_consumed
```

When `session_authority` reaches zero or the [tenant](/glossary#tenant)'s hard cap fires, the session is denied at the *next bracket boundary* — typically a turn end — and the conversation transitions to a graceful close. The agent does not stop mid-frame; it finishes the current utterance and signals end-of-call.

This is the noisy-neighbor pattern from [multi-tenant cost control](/blog/multi-tenant-ai-cost-control-per-tenant-budgets-quotas-isolation) applied to the time domain. A tenant under one runaway call still has its other concurrent calls bounded, because each call's floor draws from the shared replenish budget — the more calls running, the slower the floor refills per call.

The pattern trades fine-grained authority for fast-path responsiveness. A runaway loop within a single call can over-consume by up to one bracket's worth of authority before the gate fires. That is a small constant, not an unbounded loss, and it is recoverable through the post-call commit reconciliation.

## Pattern 4: Speculative Commit with a Deny Window

The most aggressive pattern, for systems where even a turn-boundary check is too slow. The agent acts immediately; the commit lands as soon as the action is observed; a short *deny window* — typically 100–300 ms — allows the runtime to send a `cancel-session` message if a hard cap fires retroactively.

The catch is that audio is *unrecoverable*. By the time the cancel arrives, the previous half-second of speech has already reached the customer's ear. The pattern is acceptable for parts of the surface where rollback is meaningful (a tool call that has not yet been observed externally, a write-back that has not yet been persisted) and dangerous for parts where it is not (audio out).

Most production voice teams use this only on the slow-path tool layer, layered on top of pattern 2. It is named here mostly to be explicit about what it does not solve — fast-path audio cannot be sped up by going asynchronous if the action itself is irreversible.

## Where Each Voice Stack Lets the Gate Sit

A practical view of where a Cycles-style runtime authority gate can be inserted across the major voice stacks:

| Stack | Slow-path gate (tool calls) | Fast-path gate (audio frames) | Mediation point |
|---|---|---|---|
| OpenAI Realtime API | Custom WebSocket relay intercepting `response.function_call` events | Reservation at call start; the customer's relay tracks consumption | Customer's relay server (typically an 80–150 ms hop, the band production voice relays usually target) |
| Vapi | Plug into Vapi's tool-server layer | Reservation against Vapi's per-minute billing surface; orchestration fee tracked separately | Vapi server-side webhook + per-minute polling |
| Retell AI | Custom function endpoints registered with Retell | Reservation against assembled-pipeline price; provider chain tracked through Retell's webhooks | Retell webhook layer |
| ElevenLabs Agents | Tool calls dispatched to the customer's backend | Reservation against ElevenLabs' all-in per-minute price | ElevenLabs webhook + tool dispatcher |

The architecture has a common shape. Each stack exposes a *control surface* (webhook, relay, tool-dispatcher) separate from the audio fast path. The runtime authority gate sits on the control surface for slow-path actions, and the predictive-reservation pattern bounds the fast path through pre-call budgeting.

The amount of work to wire this varies more by team than by stack. Vapi's tool-server model and Retell AI's webhook flow are similar enough that the same Cycles client can wrap both with adapter code. OpenAI Realtime's WebSocket relay needs more custom plumbing but offers the most direct control. ElevenLabs sits closest to a turnkey path with the least customization surface.

## Voice-Specific Failure Modes a Gate Should Catch

The slow-path / fast-path split changes which failure modes are catchable at which layer:

| Failure mode | Where it appears | Where to gate |
|---|---|---|
| Talking-to-itself loop (VAD failure, the agent interrupts itself) | Continuous audio with no user turn | Per-turn reservation re-check; time-bounded floor |
| Stuck conversation (the agent cannot end the call gracefully) | Long sessions with low per-turn cost but high cumulative | Predictive reservation hard cap; bracket-boundary deny |
| Premium-tier escalation runaway | Per-tier surcharges accumulate | Sync gate on each escalation request |
| Cross-call cost amplification (many parallel calls) | Concurrent sessions exceed tenant cap | Hierarchical reservation: per-call floor draws from per-tenant cap |
| Tool-call [retry storm](/glossary#retry-storm) inside a long call | A single tool's retry loop runs forever | Standard [retry-storm idempotency](/blog/retry-storms-and-idempotency-in-agent-budget-systems) at the tool gate |
| Hold music / silence not bounded | The agent waits on a transfer for minutes | Wall-clock cap, not just token-cost cap |
| Provider chain cost drift | Vapi-style BYOK with one provider 3× more expensive than expected | Per-provider reservation accounting |

The wall-clock cap is the one voice teams forget most often. Token-denominated budgets behave well when the agent is talking. They behave poorly during silence — hold music, transfer waits, the customer thinking — because the meter on the carrier line keeps running even when the model is idle. A complete voice gate needs both a [token](/glossary#tokens) budget and a wall-clock budget.

## The PocketOS Pattern at the Voice Layer

The [two-layer fix from PocketOS](/blog/pocketos-aftermath-delete-delay-vs-scoped-tokens) — scoped provider credentials plus agent-side runtime authority — translates to voice without much modification.

**Provider-layer fixes (the voice equivalent of scoped tokens):**

- Per-call hard caps at the provider billing layer — OpenAI, Vapi, Retell AI, and ElevenLabs all expose per-call or per-session limits in some form. Use them as the outer envelope.
- Carrier-minute caps at the SIP / Twilio / telephony layer — independent of the agent's authority, scoped to the call.
- Premium-feature flags that require per-call enablement rather than session-wide grants.

**Agent-layer fixes (the voice equivalent of runtime authority):**

- Predictive reservation per call (pattern 1), with the upper-bound number set against the per-call provider cap.
- Tier-aware gating on slow-path tool calls (pattern 2).
- Floor authority with wall-clock budgeting for the fast path (pattern 3, where the cadence demands it).
- Audit records of the call-level reservation, the runtime decision, and the actual consumption — separate from the provider's billing trail.

Treating these as alternatives is the same framing trap from PocketOS. A provider-level per-call cap without an agent-side gate leaves the agent free to burn the entire cap in a runaway loop. An agent-side gate without provider-level caps leans entirely on the gate's reservation accuracy. Both layers together make each other tractable.

## A Short Checklist for Voice Agent Budgets

For each voice agent the team runs in production:

1. **Is there a per-call hard cap?** If not, a single runaway session has unbounded [exposure](/glossary#exposure).
2. **Is the cap denominated in both tokens and wall-clock seconds?** A session that holds the line silent still burns telephony minutes.
3. **Are tool calls and audio frames on separate gates?** Mixing them means either the audio is slow or the tools are ungoverned.
4. **Does the reservation re-check land on a turn boundary?** If not, the user hears the gate.
5. **Are concurrent calls hierarchical against a tenant cap?** A single tenant should not be able to consume the platform with a hundred parallel calls.
6. **Is the audit trail recording the call-level reservation, the runtime decision, and the per-tier consumption separately?** Provider billing alone collapses these.
7. **Are premium-tier escalations a distinct sync-gated action?** A voice-cloning toggle or a model upgrade mid-call should not be free against the audio reservation.

A team that can answer "yes" to all seven is running runtime authority on the voice surface. Many production voice deployments today rely on the provider's per-call cap alone — which is necessary but not sufficient.

## What Changes When the Gate Moves Off the Hot Path

The shift the patterns above make explicit: the gate can be present without being synchronous. The audit trail still records every consequential action. The authority decision still binds. What changes is *when* the decision is made and *what unit* it is denominated in.

Per-call predictive reservation moves the decision from per-frame to per-call. The reservation is large; the latency is paid once; the accuracy comes from calibration, not from every-frame round-trips. The team accepts a small amount of authority slippage (within one bracket / one turn) in exchange for the conversation feeling natural.

Tier-aware gating preserves the sync gate exactly where it fits — at the slow-path tool layer — and routes the fast path through pre-budgeted authority. The reserve-commit lifecycle the rest of the corpus uses applies unchanged to the slow path. The fast path uses a different lifecycle that produces equivalent audit evidence at the boundaries.

The unifying observation is the same one that drives the [memory-writes](/blog/agent-memory-writes-are-actions-too), [merge-button](/blog/when-coding-agents-press-merge), and [click-surface](/blog/computer-use-agents-have-no-tool-boundary) extensions: the [action authority](/glossary#action-authority) lifecycle is more general than the surface it was first written for. Voice agents add a latency constraint the other surfaces did not have. The lifecycle absorbs it by adjusting when the decision happens — not by abandoning the decision.

The next time a voice agent burns $90 on a 17-minute call, the question worth answering should not be "why didn't the model end the call?" It should be "why did the harness keep streaming audio after the session's authority was exhausted?" That question has a clean answer with a predictive reservation in place. It has no answer at all without one.

## Next Steps

- **[How Reserve-Commit Works in Cycles](/protocol/how-reserve-commit-works-in-cycles)** — the lifecycle this post adapts for streaming surfaces
- **[Tracking Tokens and Cost in a Streaming LLM Response](/blog/tracking-tokens-in-a-streaming-llm-response)** — the closest sibling in the corpus, focused on text streaming
- **[Estimate Drift: The Silent Killer of Budget Enforcement](/blog/estimate-drift-silent-killer-of-enforcement)** — calibration is what makes predictive reservation work
- **[AI Agent Action Control: Hard Limits on Side Effects](/blog/ai-agent-action-control-hard-limits-side-effects)** — the tier framework underlying the slow/fast-path split
- **[Retry Storms and Idempotency in Agent Budget Systems](/blog/retry-storms-and-idempotency-in-agent-budget-systems)** — applies to the tool-call layer inside voice sessions
- **[When Budget Runs Out: AI Agent Degradation Patterns](/blog/when-budget-runs-out-graceful-degradation-patterns-for-ai-agents)** — what graceful close looks like for a voice session
- **[Multi-Tenant AI Cost Control](/blog/multi-tenant-ai-cost-control-per-tenant-budgets-quotas-isolation)** — hierarchical concurrent-call caps
- **[How Decide Works in Cycles](/protocol/how-decide-works-in-cycles-preflight-budget-checks-without-reservation)** — the preflight primitive useful for cheap per-bracket re-checks
