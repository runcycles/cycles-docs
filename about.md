---
title: "About Cycles"
description: "Cycles is an open-source runtime authority layer for AI agents — built by operators who've spent decades keeping mission-critical systems from quietly turning a small failure into an expensive one."
---

# About Cycles

Cycles is the [runtime authority](/blog/what-is-runtime-authority-for-ai-agents) layer for AI agents. It sits between an agent's decision to act and the action itself, and it answers one question on every tool call, for every agent, in every delegation chain: *is this agent allowed to do this, right now, given what it's already done?*

If the answer is no, the action doesn't happen. Not "gets logged for later review." Not "triggers an alert." **Doesn't happen.**

## Who's building this

Cycles is built by [Albert Mavashev](https://github.com/amavashev) and a small team.

Before Cycles, Albert spent nearly three decades on the infrastructure that sits underneath mission-critical enterprise systems — middleware, message brokers, transaction pipelines — first at Nastel Technologies, then through its [rebrand as meshIQ](https://www.meshiq.com/news-article/nastel-technologies-receives-investment-from-software-growth-partners-and-announces-strategic-rebrand-as-meshiq/), serving banks, airlines, telecoms, and government agencies. The systems where one uncontrolled message could cascade into millions in losses.

The full origin story — including the overnight agent loop that burned through a week's budget in one morning — is in the founder post: [Why I'm Building Cycles](/blog/why-i-am-building-cycles).

## What we believe

Three convictions shape every design decision in Cycles. They aren't new ideas — they're battle-tested patterns from distributed-systems engineering, applied to autonomous agents.

**Enforcement must be atomic.** A half-applied budget is worse than no budget. Cycles uses a reserve-commit lifecycle: budget is atomically reserved before an agent acts, actual usage is committed after, and unused capacity is released. No race conditions. No [time-of-check-to-time-of-use](https://dev.to/amavashev/your-ai-agent-budget-check-has-a-race-condition-33ei) gaps.

**Authority must attenuate, not propagate.** When an agent spawns a sub-agent, the sub-agent gets a carved-out sub-budget and a restricted action mask. [Authority can only decrease with depth, never increase](/blog/agent-delegation-chains-authority-attenuation-not-trust-propagation).

**Control must be structural, not semantic.** You can't rely on an LLM to respect a system prompt that says "don't spend more than $10." That's a suggestion to a probabilistic system. Structural controls operate outside the LLM, at the infrastructure layer, and enforce boundaries deterministically. One is a hope. The other is an engineering guarantee.

## What Cycles is not

Cycles is **not** an observability platform, an eval framework, or an LLM proxy. There are good tools in all three categories, and Cycles integrates with many of them. Cycles is the enforcement layer — the piece that's been missing.

## How it ships

Cycles is open source under [Apache 2.0](https://github.com/runcycles). The protocol, server, and client SDKs are available across Python, TypeScript, Java, and Rust. It integrates with [28 frameworks, providers, and platforms](/how-to/integrations-overview) (26 at [launch](/blog/26-integrations-every-ai-framework-one-budget-protocol)).

## Where to go next

- **Read:** [Why Cycles](/why-cycles) — the four problems Cycles solves, by role
- **Try:** [Quickstart](/quickstart/what-is-cycles) — get a budget enforced in about 10 minutes
- **Follow along:** [Blog](/blog/) — field notes on agent governance, unit economics, and runtime authority
- **Get in touch:** [Contact](/contact) — a founder reads every message
