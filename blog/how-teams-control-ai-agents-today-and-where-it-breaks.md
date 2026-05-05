---
title: "How Teams Control AI Agents Today — And Where It Breaks"
date: 2026-04-05
author: Albert Mavashev
tags: [engineering, risk, governance, agents, best-practices, production, costs, security, multi-agent, action-control]
description: "Most teams control AI agents with system prompts, rate limits, or dashboards. Here's why each breaks — and why risk, not just cost, is the real gap."
blog: true
sidebar: false
featured: false
---

# How Teams Control AI Agents Today — And Where It Breaks

If you're running AI agents in production, you've probably built some version of a control layer. Maybe it's a system prompt that says "don't exceed $10." Maybe it's a rate limit on your LLM proxy. Maybe it's a Slack alert wired to your OpenAI bill. Maybe you've gone further and built a custom rate limiter that tracks spend across multiple providers.

These are reasonable first steps. Every team starts here.

The problem is that each of these approaches breaks in a specific, predictable way — and the failures split into two categories that require very different solutions: **cost failures** and **risk failures**.

<!-- more -->

## Five Ways Teams Guard AI Agents in Production

Before we get to where things break, here's what most teams are actually doing:

### 1. System Prompt Instructions

The simplest approach: tell the agent what not to do.

*"Do not spend more than $10 per session." "Do not send emails without user confirmation." "Limit yourself to 5 tool calls per request."*

This is a semantic control — a natural-language instruction to a probabilistic system. It works often enough in testing to feel reliable — until it doesn't.

### 2. LLM Proxy Rate Limits

Tools like LiteLLM, Helicone, or custom API gateways that sit between your agent and the model provider. They enforce token-per-minute caps, request rate limits, per-key spend thresholds, and in some cases hard budget ceilings per team or user.

### 3. Framework-Native Guards

LangGraph checkpoints, CrewAI guardrails, AutoGen termination conditions. These are control mechanisms built into the orchestration framework itself — usually a max iteration count or a callback that can halt execution.

### 4. Spend Dashboards and Alerts

Provider dashboards (OpenAI usage page, Anthropic console) or custom monitoring that tracks spend and fires alerts when thresholds are crossed.

### 5. Build Your Own Rate Limiter

This is what we did at [scalerX](https://scalerx.ai). When your agents call across multiple providers — LLMs, image generation, video generation, stock chart APIs, market data feeds, web search — no off-the-shelf proxy covers all of them. So you build a custom rate limiter that tracks usage across providers, enforces per-agent or per-user caps, and tries to keep aggregate spend under control. It works — until it doesn't.

---

## Where Cost Controls Break

Here's how each approach holds up against cost and risk:

| Approach | Cost control | Risk control |
|---|---|---|
| System prompts | Suggestion | Suggestion |
| Proxy rate limits | Per-provider only | Blind |
| Framework guards | Framework-specific | Coarse-grained |
| Spend dashboards | Post-hoc | Absent |
| Custom rate limiter | Partial | Absent |

Each approach has a specific failure mode when it comes to controlling spend:

**System prompts** are suggestions, not constraints. An LLM can and does ignore them — especially under complex reasoning chains, tool-use loops, or adversarial inputs. You cannot enforce a budget by asking a probabilistic system to count. A [$12,400 weekend batch run](/blog/true-cost-of-uncontrolled-agents) doesn't happen because the agent decided to ignore its instructions. It happens because the agent was doing exactly what it was told — just more times than anyone anticipated.

**Proxy rate limits** manage request and spend controls well at the LLM layer — but they don't unify into a general action-governance layer for the entire agent runtime. If your agent calls OpenAI for reasoning, Stable Diffusion for images, and a paid data API for stock quotes, no single proxy sees the aggregate cost across all of them. Rate limits also throttle everything equally — they can't distinguish between a $0.03 lookup and a $7.20 multi-step research chain. And they typically operate per-key, not per-agent, per-[tenant](/glossary#tenant), or per-workflow.

**Framework guards** are tightly coupled to one orchestration layer. A max-iteration count in LangGraph doesn't protect you if the agent makes an expensive external API call on iteration one. And if you switch frameworks — or run agents across multiple frameworks — each guard is framework-specific and none of them compose.

**Spend dashboards** report what already happened. Alert latency is measured in minutes. Agents make decisions in milliseconds. By the time your Slack notification fires, the budget is already blown. As we've written before: [observability tells you what happened; it doesn't stop what shouldn't happen next](/blog/cycles-vs-llm-proxies-and-observability-tools).

**Custom rate limiters** get closest to solving the cost problem — but they're an endless game of whack-a-mole. We built ours at scalerX to track spend across LLMs, image generation, video generation, stock data APIs, web search, and more. Every provider required custom integration code and manual maintenance whenever pricing or APIs changed. It was brittle, it only covered cost — no concept of action-level risk — and it could only throttle, not make context-aware decisions like "allow this call at a lower tier" or "deny this tool but permit that one."

These are real limitations, but they're recoverable. Overspend hurts, but it's bounded — you can set hard caps at the provider level, rotate API keys, or kill a process. The money is gone, but the blast radius is financial. (For a deeper look at the full cost picture, see our [AI agent cost management guide](/blog/ai-agent-cost-management-guide).)

Risk is different.

---

## Where Risk Controls Break — The Harder Problem

Cost measures how much an agent spends. Risk measures what an agent does — and the security implications of those actions. The gap in agent risk management is wider than the cost gap, because most teams haven't built any risk controls at all.

Consider an agent with tool access to send emails. It enters a loop and sends 200 messages to customers. The token cost is $1.40. The business damage — customer trust, support escalation, potential regulatory [exposure](/glossary#exposure) — could be $50,000 or more. No cost cap in the world prevents that, because the cost was trivial. The harm was in the action.

This is where every approach listed above fails simultaneously:

**System prompts can be bypassed.** Prompt injection — whether from user input, retrieved documents, or tool outputs — can redirect an agent's behavior within its existing permissions. The agent still has email access. The system prompt said "only send emails the user approves." The injected context convinced the agent that the user approved. OWASP's Top 10 for Agentic Applications [lists Agent Goal Hijack (ASI01) as the first entry](/blog/zero-trust-for-ai-agents-why-every-tool-call-needs-a-policy-decision) — and prompt injection is one of the primary attack vectors.

**Proxy rate limits don't see tool calls.** A proxy sits between your agent and the LLM provider. It sees token usage. It doesn't see that the agent called `send_email()` 200 times, or `delete_record()` on a production database, or `deploy()` to a live environment. Tool calls are invisible to the proxy layer.

**Framework guards are coarse-grained.** A max-iteration limit might stop a loop, but it can't express "allow `search()` unlimited times, allow `send_email()` three times per run, deny `delete_record()` entirely." You can wire custom pre-execution checks into frameworks like LangGraph or CrewAI, but they stay custom, framework-specific, and hard to generalize across providers. No major framework provides this as a first-class, cross-provider, pre-execution runtime primitive today — what we call [action authority](/blog/ai-agent-action-control-hard-limits-side-effects).

**Spend dashboards don't measure risk.** A dashboard that shows $1.40 in token spend gives you zero signal that 200 emails just went out. The cost metric and the risk metric are completely decoupled. You can be under budget and in a crisis.

**Custom rate limiters don't measure risk either.** Even the most sophisticated DIY solution — like the one we built at scalerX — only tracks cost. It can tell you an agent has spent $4.80 across three providers. It can't tell you the agent just called `send_email()` 200 times, because tool calls aren't spend events. Building action-level awareness into a custom rate limiter means rebuilding it from the ground up as something that isn't a rate limiter anymore.

### Delegation amplifies both problems

The gap widens further in multi-agent systems. When agent A spawns agent B, which spawns agent C, each hop in the [delegation chain](/blog/agent-delegation-chains-authority-attenuation-not-trust-propagation) can amplify both cost and risk:

- **Cost amplification:** A single user request fans out into dozens of sub-agent calls. No single agent exceeds its local budget, but the aggregate spend across the chain is unbounded.
- **Risk amplification:** Sub-agents often inherit broad tool access unless scope narrowing is designed explicitly — and most frameworks make broad delegation easy while attenuation remains opt-in. Agent C, three hops removed from the original request, can end up with the same permissions as agent A.

Without enforcement at every hop, delegation chains become unauditable multiplication of both spend and blast radius.

---

## The Common Root: Pre-Execution Enforcement

Cost and risk are different failure modes, but they share the same architectural gap: **no decision happens before the action**.

- Cost needs a system that asks: *"Does this agent have enough budget for this call, across all providers, right now?"*
- Risk needs a system that asks: *"Is this agent allowed to perform this action, given its current scope, permissions, and what it's already done?"*

Both questions must be answered before execution — not after. Both require atomic decisions that account for concurrent agents, hierarchical scopes, and the full chain of delegation. And both need a three-way answer — [**ALLOW**, **ALLOW_WITH_CAPS**, or **DENY**](/blog/what-is-runtime-authority-for-ai-agents) — because the choice isn't always binary.

This is the layer that's missing. Not better monitoring. Not smarter prompts. Not tighter rate limits. A structural enforcement point that sits between the agent's decision to act and the action itself, and answers one question deterministically: **should this happen?**

We call this [runtime authority](/blog/what-is-runtime-authority-for-ai-agents).

---

## Structural AI Agent Guardrails: From Observation to Enforcement

The shift isn't conceptual — it's architectural. Instead of hoping guardrails hold, you enforce bounds at the infrastructure layer before the agent acts:

| Current Approach | Structural Alternative |
|---|---|
| System prompt: "don't exceed $10" | [Reserve-commit lifecycle](/blog/what-is-runtime-authority-for-ai-agents): budget atomically locked before each call |
| Proxy rate limit per provider | Cross-provider budget scope: one enforcement point across all models and tools |
| Framework max-iteration count | [Action authority with RISK_POINTS](/blog/ai-agent-risk-assessment-score-classify-enforce-tool-risk): per-tool limits scored by blast radius, not just iteration count |
| Spend dashboard + alert | Pre-execution DENY: the call doesn't happen, not "we'll tell you it happened" |
| Custom rate limiter across providers | [Reserve-commit](/blog/what-is-runtime-authority-for-ai-agents) with built-in [action authority](/glossary#action-authority): one system for both cost and risk, no custom integration per provider |
| Inherited permissions in delegation | [Authority attenuation](/blog/agent-delegation-chains-authority-attenuation-not-trust-propagation): each sub-agent gets a carved-out sub-budget and restricted action mask |

The pattern is the same in every row: move the decision upstream, from after execution to before it. From semantic to structural. From observation to enforcement.

---

## Evaluating Your AI Agent Risk and Cost Controls

Five questions that reveal whether your current controls are sufficient:

1. **Can you enforce a budget that spans multiple LLM providers and tool APIs in a single agent run?** If not, your cost controls have blind spots.
2. **Can you limit how many times a specific tool is called per run — not just total iterations?** If not, your risk controls are coarse-grained.
3. **When agent A delegates to agent B, does B's budget and permission scope automatically narrow?** If not, your delegation chains amplify risk.
4. **If an agent exceeds a limit, does the call get blocked before execution — or reported after?** If after, you have observability, not enforcement.
5. **Can you answer all of the above with a single system?** If not, you're stitching together controls that don't compose.

If you're hitting these gaps, you're not alone — this is the [production gap](/blog/ai-agent-production-gap-what-developers-are-saying) most teams encounter as agents move from prototypes to production. The guardrails that worked in development — system prompts, iteration limits, spend alerts — don't survive contact with real workloads, real users, and real security threats.

The missing layer is pre-execution enforcement. [Here's what that looks like](/quickstart/what-is-cycles).

---

- [What Is Runtime Authority for AI Agents](/blog/what-is-runtime-authority-for-ai-agents)
- [Action Authority: Hard Limits on Agent Side Effects](/blog/ai-agent-action-control-hard-limits-side-effects)
- [Risk Assessment: Score, Classify, and Enforce Tool Risk](/blog/ai-agent-risk-assessment-score-classify-enforce-tool-risk)
- [The True Cost of Uncontrolled AI Agents](/blog/true-cost-of-uncontrolled-agents)
- [GitHub: runcycles](https://github.com/runcycles)

## Related how-to guides

- [Assigning RISK_POINTS to agent tools](/how-to/assigning-risk-points-to-agent-tools)
- [Integrating with LangGraph](/how-to/integrating-cycles-with-langgraph)
- [API key management](/how-to/api-key-management-in-cycles)
