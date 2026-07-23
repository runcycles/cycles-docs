---
title: "Agent Memory Writes Are Actions, Too"
date: 2026-05-16
author: Albert Mavashev
tags:
  - action-authority
  - action-control
  - memory
  - agents
  - governance
  - runtime-authority
  - security
  - RISK_POINTS
description: "Agent memory writes change future runs. Treat mem0, Letta, Zep, and Claude-style memory mutations as RISK_POINTS-budgeted actions under runtime authority."
blog: true
sidebar: false
featured: false
head:
  - - meta
    - name: keywords
      content: "agent memory governance, mem0 security, Letta memory, Zep memory, memory poisoning, OWASP ASI06, runtime authority, action authority, AI agent risk points, memory write enforcement"
---

# Agent Memory Writes Are Actions, Too

A support agent reads a ticket, summarizes it, and saves a note to long-term memory: *"Customer accounts under domain acme.com prefer collections-tone follow-ups."* The note is wrong. The ticket was unusual, the model overgeneralized, and nothing in the run looked anomalous — the model spend was $0.04, no external tool fired, no email was sent.

A week later, a different agent run for a different acme.com user reads that note out of memory before drafting a reply. It writes the email in collections tone. The send tool is gated and the email is blocked at execution — but the conversation summary it persisted to memory now records that the customer "responded poorly to standard outreach." The next run inherits both notes.

No model call exceeded its budget. No tool tier crossed its threshold. The agent that caused the damage spent four cents. The damage was that it *wrote*.

Memory writes are actions. Most [action authority](/glossary#action-authority) discussions in the corpus — [hard limits on side effects](/blog/ai-agent-action-control-hard-limits-side-effects), [tool risk scoring](/blog/ai-agent-risk-assessment-score-classify-enforce-tool-risk), [delegation chains](/blog/agent-delegation-chains-authority-attenuation-not-trust-propagation) — frame actions as outbound side effects: an email leaves the system, a deploy runs, a record is mutated in an external service. Memory writes have a different shape. They persist *into the next run's input*. The blast radius is forward in time, not outward in space.

<!-- more -->

## Memory Is a Tool That Writes the Future

The shift in 2025–2026 is that memory has moved from a research concept to a deployed primitive. [mem0](https://github.com/mem0ai/mem0) describes itself as a universal memory layer with explicit `add` / `update` / `delete` operations, and ships integrations across many popular agent frameworks in Python and TypeScript. [Letta](https://www.letta.com/blog/agent-memory) (formerly MemGPT, renamed in 2024) implements a three-tier model — core memory in the context window, recall memory on disk, archival memory queried as a tool — with the agent itself paging blocks in and out. Zep and several adjacent projects offer graph-shaped memory with similar semantics. Anthropic and OpenAI ship platform-native memory features inside Claude and ChatGPT respectively.

Each of these systems is well-designed for what it is: a layer that captures facts, preferences, and conversation summaries so the agent does not start from zero on every run. None of them is, by itself, a governance system. The memory layer's job is to remember. Deciding whether the next memory write *should* be remembered is a different layer.

The OWASP Top 10 for Agentic Applications, [published December 2025](https://genai.owasp.org/2025/12/09/owasp-top-10-for-agentic-applications-the-benchmark-for-agentic-security-in-the-age-of-autonomous-ai/), names this gap explicitly as **ASI06: Memory & Context Poisoning**. The corpus has touched it in passing — see the framework map in [State of AI Agent Governance 2026](/blog/state-of-ai-agent-governance-2026) — but the runtime-authority treatment has been missing.

## What a Memory Operation Actually Does

To classify memory writes the way we classify other actions, it helps to be precise about which operations a memory layer exposes. The names below are conceptual — mem0, Letta, Zep, and bespoke RAG-style stores label them differently — but the operation set across these systems is close to:

| Operation | What it does | Persistence | Read amplification |
|---|---|---|---|
| `add` / `upsert` | Insert a new fact, preference, or summary | Until explicitly removed | Every future run that retrieves this scope |
| `update` | Overwrite or refine an existing fact | Until next update or removal | Replaces prior reads with the new version |
| `delete` / `forget` | Remove a fact | Permanent within the store | Future runs no longer see it |
| `pin` / `unpin` | Mark a fact as always-in-context | Long-lived | Loaded on every run, not just retrieval matches |
| `archive` / `recall` | Move between hot context and cold storage | Hot vs cold | Affects which queries can retrieve it |

The properties that make these operations behave differently from outbound tool calls:

- **The blast radius is temporal, not spatial.** A bad email reaches the recipient and stops. A bad memory write reaches every future run that retrieves the affected scope.
- **The write is read-amplified.** One `add` can be retrieved by thousands of downstream queries. If the scope spans [tenants](/glossary#tenant), the amplification crosses tenant boundaries too.
- **Reversibility is conditional.** `delete` removes the fact only if the system knows the fact is wrong. Many poisoned memories look plausible.
- **Attribution decays over time.** The agent that wrote the bad fact may not be the agent that reads it. Without per-write provenance, "who poisoned the memory" becomes archaeology.
- **The action does not show up in cost.** A 200-token `add` costs less than a single retry. Cost-shaped budgets see nothing.

These are the properties that turn memory mutations into a structural compromise rather than a transient exploit — the framing OWASP uses for ASI06.

## Placing Memory Writes in the Action Tier Model

The tier model from [AI Agent Risk Assessment](/blog/ai-agent-risk-assessment-score-classify-enforce-tool-risk) classifies tools 0–4 by blast radius and reversibility. Memory writes do not fit cleanly into any single tier — different operations behave differently, and the *scope* of the write matters as much as the operation.

A useful first pass:

| Memory operation | Scope | Default tier | Rationale |
|---|---|---|---|
| `add` to per-user scope | One user | 2 (Write-external, contained) | Affects future runs for one principal |
| `add` to per-tenant scope | One tenant | 3 (Mutation) | Affects every agent run for the tenant |
| `add` to shared / global scope | All tenants | 4 (Execution-equivalent) | Cross-tenant contamination if misclassified |
| `update` of a pinned core memory | Always-in-context | 4 (Execution-equivalent) | Loaded on every run regardless of retrieval |
| `delete` of a verified fact | Any | 3 (Mutation) | Irreversible without backup; affects future retrieval |
| `archive` (move out of hot context) | Any | 1 (Write-local) | Reversible via `recall`; affects retrieval visibility but not stored content |

This is a starting point, not a verdict. As with the tool-tier model, the value is in the *exercise* — forcing the team to ask, for each memory scope they expose, what the worst-case downstream effect of a single bad write looks like. A team running per-tenant memory namespaces has a different tier map than a team running shared embeddings across their whole customer base.

The recent April 2026 mem0 algorithm shift — moving from `update`/`delete` semantics toward append-only `add` extraction, per [their published benchmarks](https://mem0.ai/blog/state-of-ai-agent-memory-2026) — does not eliminate the tiering problem; it changes which operation does the damage. An append-only store with no policy on what gets appended still accumulates poison; the operation tier of `add` matters more in that model, not less.

## What Reserve-Commit Looks Like for Memory Writes

The reserve-commit lifecycle covered in [How Reserve-Commit Works in Cycles](/protocol/how-reserve-commit-works-in-cycles) was originally framed around model spend and external side effects. The same primitive applies cleanly to memory operations — what changes is the unit being reserved.

A `memory.add` to a per-tenant scope, modeled as an action authority [reservation](/glossary#reservation), looks like:

1. The agent proposes a write — fact text, scope path, source provenance.
2. The runtime reserves [RISK_POINTS](/glossary#risk-points) against the run's action budget, sized by tier (e.g., 25 points for a per-tenant `add`).
3. A live reservation succeeds with `ALLOW` or `ALLOW_WITH_CAPS`, or rejects insufficient budget. The standard cap fields are `maxTokens`, `maxStepsRemaining`, `toolAllowlist`, `toolDenylist`, and `cooldownMs`; memory-specific limits such as write counts, allowed scopes, and provenance requirements must be enforced by the memory handler or a future extension.
4. The write executes against the memory layer.
5. The agent commits an `Amount` representing best-known actual usage, including usage from a partial failure. It releases only when the write never starts or demonstrably consumes zero usage.

The shape is identical to a `send_email` or `deploy` reservation. The substantive change is what the cap means. In the MCP response, `toolAllowlist: ["memory.add_user_scope"]` can express the memory equivalent of a read-only fallback: the agent can still write notes about its own user but cannot mutate shared knowledge. `toolDenylist: ["memory.update_pinned"]` can disable the operations with the largest blast radius. The current server returns caps configured on the deepest matching budget; the memory handler must enforce the returned list.

An application can implement the progressive narrowing pattern from the [action control post](/blog/ai-agent-action-control-hard-limits-side-effects) by selecting stricter budget policy or scopes as the workflow changes. That policy can remove shared-scope writes before per-user writes, but Cycles does not automatically tighten caps as the remaining balance falls.

## A RISK_POINTS Schedule for Memory Operations

The point values below are illustrative. Like the tool schedule in [AI Agent Risk Assessment](/blog/ai-agent-risk-assessment-score-classify-enforce-tool-risk), the relative weighting matters more than the absolute numbers, and every team's schedule should reflect its own scope topology.

| Memory operation | Scope | Risk points | Comparable outbound action |
|---|---|---:|---|
| `read` / retrieve | Any | 1 | Read-only DB query |
| `add` to per-run scratchpad | Ephemeral | 2 | Internal log write |
| `add` to per-user memory | One user | 10 | File write |
| `update` to per-user memory | One user | 15 | DB record update |
| `add` to per-tenant memory | One tenant | 25 | DB mutation |
| `update` to per-tenant memory | One tenant | 30 | DB mutation, broad reach |
| `add` to shared / global memory | All tenants | 50 | Deploy or config change |
| `update` to pinned core memory | Always-in-context | 50 | Permission grant |
| `delete` of verified fact | Any | 25 | DB delete |

A workflow capped at 100 risk points can do 50 reads and 4 per-user writes, or 4 per-tenant writes and nothing else, or one shared-scope write and a handful of reads. The cap forces prioritization at write time, not after the bad fact has been retrieved a thousand times. For per-tool point assignment in Cycles, see [Assigning RISK_POINTS to agent tools](/how-to/assigning-risk-points-to-agent-tools).

## Why Existing Controls Do Not Govern Memory Writes

A handful of layers in the typical agent stack touch memory in some way. None of them, in their default configuration, acts as a [runtime authority](/glossary#runtime-authority) for memory writes.

| Layer | What it does | What it does not do |
|---|---|---|
| Memory layer (mem0, Letta, Zep) | Stores and retrieves facts | Does not decide whether a given write *should* be persisted under a given run's risk budget |
| [MCP server](/glossary#mcp-server) in front of the memory tool | Brokers tool calls | In its default configuration, sees one call at a time without cross-run amplification context |
| RAG retrieval reranker | Filters what gets read | Operates at read time; the bad fact is already in the store |
| Memory hygiene / guard products | Validate hashes, detect tampering | Detect *attacks*; do not bound *authorized but ill-advised* writes |
| Observability / tracing | Records what was written | Records, not enforces |

The closest adjacent category is memory-poisoning detection — projects like the [OWASP Agent Memory Guard](https://owasp.org/www-project-agent-memory-guard/) and several commercial products use SHA-256 cryptographic baselines and tamper-detection heuristics to flag attacks. Those defenses cover deliberate poisoning by an attacker. They do not cover a separate failure mode: an authorized agent making an authorized write that turns out to be wrong. Runtime authority is the layer that decides whether the write should happen at all, before the question of whether the write was *malicious* even arises.

This is the same structural argument made in [Agents Are Cross-Cutting. Your Controls Aren't.](/blog/agents-are-cross-cutting-your-controls-arent) and [MCP Gateways Are Not Runtime Authority](/blog/mcp-gateways-are-not-runtime-authority): tool-local controls govern themselves, not the agent's cumulative [exposure](/glossary#exposure) across the dimensions the agent actually spans. Memory is one more such dimension.

## Memory Writes Drive Policy Drift

[Policy Drift in AI Agents](/blog/policy-drift-in-ai-agents) listed memory as one of the surfaces along which approved agent behavior diverges from live behavior. The post named it; this is the mechanism.

An agent approved on day one with a clean memory store behaves differently after 30 days of accumulated facts. Some of those facts are correct refinements. Some are model-generated overgeneralizations. Some are stale — true at the time, no longer true. The agent's effective prompt is the union of its approved system prompt and whatever its retrieval layer pulled from memory. Static policy review, performed once at approval time, cannot bound what that union becomes over time without a runtime check at every write.

Two patterns are useful in combination:

- **Per-write provenance** — every memory entry carries the run ID, agent identity, and risk-budget context at the time of the write. When a downstream incident traces back to a poisoned memory, attribution exists. The byproduct argument in [The AI Agent Audit Trail You're Already Building](/blog/runtime-authority-byproducts-audit-trail-and-attribution-by-default) applies here unchanged.
- **TTL on unverified facts** — facts written without independent verification expire automatically unless promoted. Expiration-style mitigations are recommended in several recent agent-security write-ups, including the OWASP ASI06 discussion. The effect is that drift has a half-life: a bad fact written today is gone in 30 days unless something corroborates it.

Neither pattern is a memory layer feature in the typical sense. Both are runtime authority concerns — enforced at write time, recorded at the same layer that decides budgets and tool gates.

## Tenant Isolation Becomes a Memory Problem

The multi-tenant arguments in [Multi-Tenant AI Cost Control](/blog/multi-tenant-ai-cost-control-per-tenant-budgets-quotas-isolation) and [Agent Identity Is Not User Identity](/blog/agent-identity-is-not-user-identity) translate directly to memory scopes. A platform that shares a single embeddings collection across all customers has a cross-tenant amplifier: one customer's poisoned write affects retrieval for every other customer whose vectors land in the same neighborhood.

The fixes are familiar from the budget side of the protocol:

- Memory scopes mirror [scope](/glossary#scope) paths — `tenant:acme/agent:support` writes only to that scope, retrievals only resolve within it.
- Cross-tenant writes are a distinct action class with a higher risk-point cost or an application-enforced denial.
- Audit and attribution are per-scope, not per-store.

A memory layer that does not enforce scopes is the memory equivalent of a budget system that does not enforce per-tenant caps. The damage looks the same: one tenant's bad behavior degrades service for every tenant.

## A Short Checklist for Memory Governance

For each memory layer in production, ask:

1. **Are writes tiered?** Is a per-user `add` separated from a per-tenant `add` from a shared `add`, with different runtime gates on each?
2. **Are write quotas enforced per run?** Can a single runaway agent flood the store, or is `memory.add` budgeted like any other action?
3. **Is every write attributed?** Run ID, agent identity, prompt, retrieval context — enough to trace a downstream incident back to its source.
4. **Do unverified facts expire?** TTL on writes that lack corroboration shrinks the drift surface.
5. **Are tenant scopes isolated at the store level, not only at the application level?** Application bugs are common; store-level isolation survives them.
6. **Are pinned / always-loaded memories on a separate, stricter gate?** A bad pin is loaded on every run; the blast radius is permanent until cleared.

A memory layer can answer few of these questions on its own. The questions are runtime authority concerns, applied to a write surface that most stacks currently treat as silent state.

## What Changes When Memory Writes Are Budgeted

Treating memory writes as actions has a few non-obvious consequences.

Memory becomes a budgeted resource at the workflow level, not an infinite background service. A workflow's effective scope is not just *which tools can it call* but *which memory scopes can it write*, and how many writes per run. The team designing the agent has to choose which writes are worth the budget, which is roughly the same as choosing which long-lived state the agent actually needs.

Memory drift becomes a measurable, bounded property. Without write quotas, drift accumulates at the rate of usage. With them, drift is bounded by the same risk budget that bounds everything else, and detectable when the budget runs out unexpectedly. Estimate-drift logic similar to the one described in [Estimate Drift: The Silent Killer of Budget Enforcement](/blog/estimate-drift-silent-killer-of-enforcement) applies in this dimension too.

Incident response gets faster. When an agent starts behaving oddly and the cause is a poisoned memory, the audit trail of recent writes — bounded in size by the per-run quota — narrows the search to a small set of candidates. Without that quota, "what changed in memory" is an open question with no obvious end.

And the model of what an "agent action" is gets a little closer to the real shape of the system. Outbound side effects matter because they reach external parties. Memory writes matter because they reach the next run. Both are actions. Both deserve a mandatory reservation before execution and accurate settlement afterward — not only retrospective analysis after the next agent has already read what the previous one wrote.

## Next Steps

- **[AI Agent Action Control: Hard Limits on Side Effects](/blog/ai-agent-action-control-hard-limits-side-effects)** — the parent action-control framing this post extends
- **[AI Agent Risk Assessment: Score, Classify, Enforce](/blog/ai-agent-risk-assessment-score-classify-enforce-tool-risk)** — how to build a risk schedule for your own tool set
- **[Policy Drift in AI Agents](/blog/policy-drift-in-ai-agents)** — the broader drift surface memory writes belong to
- **[Agent Identity Is Not User Identity](/blog/agent-identity-is-not-user-identity)** — why per-write provenance has to name the agent, not the user
- **[State of AI Agent Governance 2026](/blog/state-of-ai-agent-governance-2026)** — the OWASP ASI06 landing slot for memory & context poisoning
- **[How Reserve-Commit Works in Cycles](/protocol/how-reserve-commit-works-in-cycles)** — the lifecycle that applies, unchanged, to memory operations
- **[Assigning RISK_POINTS to agent tools](/how-to/assigning-risk-points-to-agent-tools)** — the per-tool schedule mechanism, now extended to memory ops
