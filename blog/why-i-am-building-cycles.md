---
title: "Why I'm Building Cycles"
date: 2026-04-04
author: Albert Mavashev
tags: [founder, vision, agents, governance]
description: "After decades building middleware governance, Albert Mavashev saw the same control gap emerge in AI agents. This is why he is building Cycles for production."
blog: true
sidebar: false
featured: false
head:
  - - meta
    - name: keywords
      content: why Cycles, AI agent governance, runtime authority, agent budget enforcement, production AI infrastructure, founder story
---

# Why I'm Building Cycles

For nearly three decades I worked on systems that sat underneath mission-critical enterprise applications: middleware, message brokers, transaction pipelines — the infrastructure that could quietly turn a small failure into a very expensive one. First at Nastel Technologies, then through its rebrand as [meshIQ](https://www.meshiq.com/news-article/nastel-technologies-receives-investment-from-software-growth-partners-and-announces-strategic-rebrand-as-meshiq/). Banks, airlines, telecoms, government agencies. Systems where a single uncontrolled message could cascade into millions in losses.

The lesson I learned the hard way was simple: seeing a failure is not the same as stopping it.

That lesson is why I'm building Cycles.

<!-- more -->

## One Agent, One Loop, One Morning

After meshIQ, I built [scalerX.ai](https://scalerx.ai) — a platform for deploying AI agents on Telegram. Each agent on scalerX connects to multiple models and providers — OpenAI for reasoning, Stable Diffusion for image generation, Google and Kling for video. One morning I woke up to find that an agent had gotten stuck in a tool-call loop overnight. It had generated a dozen images and several videos, cycling between models — each call triggering the next. By the time anyone noticed, that single run had burned through more budget than we'd planned for the entire week. Across three providers. While we slept.

I stared at the logs. The agent had done exactly what it was designed to do — reason, generate, iterate — just without any structural limit on how many times it could repeat the cycle, or any way to enforce a boundary that spanned all three models at once. We had dashboards. We had per-provider usage tracking. None of that mattered, because no single system could answer the only question that would have prevented the damage: *should this next call — to any provider — be allowed to happen at all?*

That was the problem. Not visibility into one LLM's usage. **Enforcement across all of them.**

I'd seen this exact failure mode before. Not in AI. In middleware.

## The Pattern I Couldn't Unsee

In the middleware world, circa 2000, teams would deploy message brokers and integration buses with logging but no pre-execution controls. A misconfigured routing rule could fan out a single message into thousands of downstream calls. A retry loop could amplify one failed transaction into a cascade that burned through compute budgets and overwhelmed dependent services.

We built systems to solve that — systems that intercepted transactions before execution, enforced policies on message flow, and gave operators deterministic control over what could happen — not just visibility into what had already happened. Policy-based routing, message flow control, pre-execution validation. The shift from "detect and respond" to "prevent and enforce" is what made enterprise middleware production-safe.

That scalerX incident brought the pattern into focus: many AI-agent deployments have the same governance gap that enterprise middleware had 25 years ago. Teams may have observability without a shared pre-execution budget boundary. Different technology, similar control-plane problem.

## Why Cycles, Why Now

When I started sketching what became Cycles, I kept coming back to three principles from the middleware governance world:

**1. Enforcement must be atomic.** In enterprise middleware, a half-applied policy is worse than no policy. If you reserve capacity for a transaction, that [reservation](/glossary#reservation) must be atomic—either the full amount is locked across applicable ledgers or none of it is. The Cycles reserve-commit lifecycle closes the shared-ledger [time-of-check-to-time-of-use](https://dev.to/amavashev/your-ai-agent-budget-check-has-a-race-condition-33ei) window between checking and reserving. It does not eliminate races elsewhere in the application or external side effect.

**2. Authority should attenuate, not propagate.** In middleware, a message broker does not have to grant downstream systems the same permissions as the originating system. An orchestrator can apply that principle to agent delegation by provisioning a smaller child scope budget and exposing a narrower tool set at each hop. Cycles enforces the explicitly provisioned sub-budget; the orchestrator owns tool permissions and depth limits.

**3. Control must be structural, not semantic.** You can't rely on an LLM to respect a system prompt that says "don't spend more than $10." That's a semantic control — a suggestion to a probabilistic system. Structural controls operate outside the LLM, at the infrastructure layer, and enforce boundaries deterministically. One is a hope. The other is an engineering guarantee.

These aren't novel ideas. They're battle-tested patterns from decades of distributed systems engineering. What's novel is applying them to autonomous AI agents — where the "messages" are tool calls, the "brokers" are agent orchestrators, and the "transactions" are LLM inference chains that can spawn arbitrary sub-tasks.

## What I'm Not Building

Cycles is not an observability platform. There are excellent tools for watching what agents do. Cycles is not an eval framework. There are good tools for testing agent outputs. Cycles is not an LLM proxy. There are solid products for routing and caching inference calls.

Cycles is a budget-enforcement layer that an application places between the agent's proposal and protected execution. It answers a narrower question: **does the submitted spend or caller-assigned exposure fit the applicable scope ledgers right now?**

At a correctly instrumented mandatory boundary, an insufficient reservation prevents that code path from calling the protected operation. The application must still authorize the tool and arguments and ensure no alternative path bypasses the boundary.

## The Road Ahead

Cycles is early and open source under [Apache 2.0](https://github.com/runcycles). The protocol, server, and client SDKs are available across Python, TypeScript, Java, and Rust. The linked historical post records [26 integration guides at publication](/blog/26-integrations-every-ai-framework-one-budget-protocol); the [integration overview](/how-to/integrations-overview) is the current list.

I've seen this movie before. I know how the first act goes — the technology is exciting, adoption outpaces governance, incidents accumulate, and eventually the industry builds the enforcement layer it should have built from the start.

I'd rather build it now.

I think agent systems will need this layer sooner than most people realize.

---

- [What Is Runtime Authority for AI Agents](/blog/what-is-runtime-authority-for-ai-agents)
- [The True Cost of Uncontrolled AI Agents](/blog/true-cost-of-uncontrolled-agents)
- [GitHub: runcycles](https://github.com/runcycles)
- [Get started in 5 minutes](/quickstart/what-is-cycles)
