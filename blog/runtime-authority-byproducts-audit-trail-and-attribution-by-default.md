---
title: "The AI Agent Audit Trail You're Already Building"
date: 2026-04-27
author: Cycles Team
tags: [runtime-authority, governance, audit, finops, compliance, costs, agents, engineering]
description: "Runtime authority's hidden byproduct: ledger-ready audit, cost, and attribution records for AI agents — useful for compliance, FinOps, and platform chargeback."
blog: true
sidebar: false
featured: false
head:
  - - meta
    - name: keywords
      content: AI agent audit trail, runtime authority evidence, AI cost attribution, FinOps chargeback, reservation lifecycle, agent governance
---

# The AI Agent Audit Trail You're Already Building

A platform-engineering lead got three questions in one week:

- The CFO: *"What does it cost to serve customer X this quarter?"*
- The auditor: *"Show me evidence that the agent's spending was authorized, with rationale and timestamp."*
- The data team: *"Why is our AI bill 6× engineering's? Can you break it down by team?"*

Three different stakeholders. Three different vocabularies. One underlying need: a record of every agent action — *who*, *what*, *when*, *how much*, and *with what authority*.

The lead's existing tools couldn't answer any of them cleanly. The provider invoice was one line. The APM trace had spans but no costs. The SIEM logged tool calls but not money. Each question would have meant a separate instrumentation project.

It turns out the data was already there. The team had deployed [Cycles](/quickstart/what-is-cycles) for runtime authority — to stop runaway spend and block risky actions before they execute. The byproduct of that enforcement is a *ledger-ready* record of every metered agent action: structured, idempotent, attributable, and exportable into audit, finance, and observability systems. The lead had been sitting on the answer to all three questions for months.

This post is about that byproduct. What runtime authority *also* gives you when you turn it on, and why three different teams in your org each get something they've been struggling to build.

<!-- more -->

## What runtime authority actually persists

The core Cycles lifecycle is [reserve → execute → commit or release](/protocol/how-reserve-commit-works-in-cycles), with `decide()` available as an optional preflight check before reservation. The framing in the docs is a control story — *no action proceeds until the budget is locked, and we know exactly how much was used after.* That control story is the headline.

The bookkeeping story is the byproduct. Persisting lifecycle operations produce structured records; non-persisting preflight evaluations must be logged by the caller:

| Operation | What it records | Why it matters as evidence |
|---|---|---|
| `decide()` *(optional preflight)* | Returns subject evaluation, decision (`ALLOW` / `ALLOW_WITH_CAPS` / `DENY`), `reason_code`, and affected scopes but does not persist them | Caller can write an application audit record with machine-readable rationale |
| `reserve` | actual lock against the budget, hold token, expiry | Authoritative "we said yes and here's what we held" |
| `commit` | actual cost (separate from estimate), final balance impact, lifecycle close | Authoritative "this is what was used" |
| `release` / `expired-reservation` | unused portion returned to the budget | Authoritative "this is what was given back" |

The [subject hierarchy](/protocol/how-scope-derivation-works-in-cycles) supports up to six levels — `tenant`, `workspace`, `app`, `workflow`, `agent`, and `toolset`. The more consistently you populate it, the better the attribution: aggregating by `tenant` gives cost-per-customer, by `workflow` gives cost-per-conversation, by `agent` gives cost-per-component. The point is that attribution is *structural* — a field on the record, not a SQL join across log streams stitched together after the fact.

What you have, after running with Cycles in production for a quarter, is a multi-million-row ledger with fields that look like rows in a financial system: *who*, *what*, *when*, *how much committed against estimate*, *which authority granted it*. That's the data exhaust. We argue it's also the deliverable.

## Risk and compliance: audit evidence by default

Regulators have caught up to the AI agent surface. For high-risk AI systems, [EU AI Act Article 12](/blog/ai-agent-governance-framework-nist-eu-ai-act-iso-42001-owasp-runtime-enforcement) requires automatic logging capabilities that support traceability and post-market monitoring over the system's lifetime. Cycles contributes concrete reservation and settlement records with scope, amount, status, and timestamps. Applications still need to preserve non-persisting preflight denials, tool arguments, identity-policy outcomes, and business rationale. SOC 2 Type II audits can also bring agentic systems and their controls into scope, while ISO 42001 supplies an AI management-system framework; neither makes the Cycles ledger a complete compliance record by itself.

The standard pattern for satisfying these is to bolt on an audit logger after the fact: pick fields, write to a separate store, hope the schema covers what an auditor will ask for. The pattern is fragile because it's *secondary* — the auditor and the engineer disagree on what's worth logging, and engineering wins by default.

Cycles improves that foundation. Reservation and settlement records are both enforcement state and an audit substrate; when you use `decide()`, copy its non-persisting response into your application audit store. Depending on the operation and deployment, the combined records can carry:

- The subject scope, with up to six levels of attribution
- The decision and the `reason_code` (machine-readable rationale)
- The idempotency key, when supplied, which supports replay-safe handling on retries
- The timestamp and the actor

When an auditor asks *"can you show me an action that was attempted but blocked, with reason and authority?"* the answer comes from the application audit record for preflight outcomes plus any correlated lifecycle evidence. When they ask *"how do I know this record was actually produced by Cycles at the time you say?"* — if you stored the raw [HMAC-SHA256-signed webhook body](/blog/webhook-idempotency-patterns-for-ai-agent-budget-events), the signature, and the `X-Cycles-Event-Id` in your audit store, you have evidence that Cycles delivered that event, with a primitive that lets you safely dedupe and replay. The ledger becomes tamper-evident only to the extent your downstream store preserves the signed payload — that piece is on the operator, not the protocol.

The companion post — [The AI Agent Governance Framework](/blog/ai-agent-governance-framework-nist-eu-ai-act-iso-42001-owasp-runtime-enforcement) — maps specific regulatory clauses to runtime enforcement controls. This post is the inverse: it explains why the protocol *already* produces the evidence those clauses ask for, before anyone tells you the regulator is asking.

## Finance and FP&A: cost attribution and forecasting

The CFO's question — *what does it cost to serve customer X?* — is a unit-economics question. It's the question that any company building AI features into a product with a revenue model has to answer eventually, and most can't.

The reason most can't is that the cost data lives in three places: the LLM provider invoice (one line), the application logs (per-request token counts that nobody aggregates by customer), and the cloud bill (compute and storage, customer-agnostic). To get cost-per-customer you have to stitch.

Cycles' subject hierarchy collapses the stitch. When your integration populates the subject hierarchy consistently, each commit is tagged with the customer (`tenant`), the feature (`app`), the workflow, and the agent. Aggregating by `tenant` gives cost-per-customer. Aggregating by `app` gives cost-per-feature. Aggregating by `workflow` gives cost-per-conversation. The math is `SELECT SUM(committed) GROUP BY ...`.

The deep dive on cost-per-conversation, cost-per-user, cohort margin, and the full unit-economics picture is in [AI Agent Unit Economics: Cost and Margin Analysis](/blog/ai-agent-unit-economics-cost-per-conversation-per-user-margin). Read that for the math.

What that post doesn't lead with is **forecasting**. Once you have a quarter of structured commit data, the trajectory is computable. Token velocity per workflow, peak vs average, the slope of the spend curve as a feature scales — these are the inputs to next-quarter financial planning. They're also the data you bring into a board meeting when an investor asks about COGS for the AI feature: not a slide that says "estimated $X per seat," but a chart with actuals and a credibility-bearing forecast.

The before-and-after for a finance team:

| Question | Without per-action ledger | With Cycles ledger |
|---|---|---|
| What did customer X cost? | Estimate from logs + heuristic | `GROUP BY tenant` on commit data |
| What's the margin on Feature Y? | "Hard to say" | Cost subtracted from feature revenue |
| What's the run-rate trajectory? | Provider invoice + spreadsheet | Live aggregation against committed data |
| Which 5 customers drive 50% of spend? | Quarter-end exercise | Standing query |

None of this requires Cycles to be a billing engine or a financial data warehouse. It just has to be the *source record system* the warehouse pulls from.

## Platform engineering: chargeback and showback

The third stakeholder is closer to home. Every platform team running AI infrastructure inside a larger company is being asked the same question with increasing pointedness: *which team is burning the AI budget?*

Today the answer is usually some version of *"I don't know — the OpenAI bill is one number."* That answer was acceptable when the AI bill was a footnote on the cloud spend. It stops being acceptable when the AI line passes the database line, which is happening.

Cycles' subject hierarchy gives platform teams a clean answer: workspace and app levels are the natural mapping for organizational structure. A `workspace` corresponds to a team, an `app` corresponds to a service or product surface, and the `tenant` corresponds to the company or environment. Issuing API keys per workspace gives the platform team a metered surface that maps cleanly to cost centers.

Querying `GET /v1/balances?tenant=acme&include_children=true` returns balances at every scope underneath, in the shape documented in the [API reference](/protocol/api-reference-for-the-cycles-protocol):

```json
{
  "balances": [
    {
      "scope": "workspace:data-team",
      "scope_path": "tenant:acme/workspace:data-team",
      "spent":     { "amount": 184320, "unit": "USD_MICROCENTS" },
      "remaining": { "amount":  15680, "unit": "USD_MICROCENTS" }
    },
    {
      "scope": "workspace:engineering",
      "scope_path": "tenant:acme/workspace:engineering",
      "spent":     { "amount":  41200, "unit": "USD_MICROCENTS" },
      "remaining": { "amount": 158800, "unit": "USD_MICROCENTS" }
    }
  ]
}
```

(Excerpted — the full response also returns `allocated`, `reserved`, `debt`, and `is_over_limit` per scope.) The data team's question — *why is our AI bill 6× engineering's?* — answers itself. The chargeback report becomes a standing query, not a quarter-end fire drill.

A side benefit worth flagging: this kills shadow AI spend. Engineers can't quietly move workloads off the metered surface unless they leave Cycles entirely, and leaving Cycles costs them the runtime authority that's stopping the runaway loops they've already been bitten by. The metering is sticky because the enforcement is valuable — different from observability tools, which tend to atrophy because nobody's blocked when they're missing.

## What makes this a ledger, not a log

A reasonable objection: every observability tool produces records. Why call this a ledger?

The distinction matters. A *log* is an append-only stream optimized for debugging — high-cardinality, tolerant of duplicates and gaps, generally not signed. A *ledger* is a record system you can settle accounts against — idempotent, signed, with provenance per record.

Cycles' record stream satisfies the ledger criteria, by protocol design:

- **Idempotency is protocol-defined**, especially around commit/release and retry safety. When an idempotency key is supplied, the server enforces replay semantics per tenant, endpoint, and key: successful replays return the original response, while mismatched payloads return `IDEMPOTENCY_MISMATCH`. That is what prevents retries from double-charging. The [glossary](/glossary#idempotency-key) covers the broader semantics.
- **Webhook deliveries are HMAC-SHA256 signed** with a unique `X-Cycles-Event-Id` per event, delivered with at-least-once semantics. Subscribers dedupe by event ID and verify the signature; the protocol guarantees they can detect tampering and replay.
- **Events carry W3C trace context** (`traceparent` / `X-Cycles-Trace-Id`), which means cross-system correlation — the ledger entry, the application trace, and the LLM provider span can be tied together by ID, not by timestamp guesswork.

That's the difference between a Datadog APM trace (a log of what happened) and a row in a financial system (a record you can audit, settle, and certify). For deeper coverage of the webhook-delivery side, see [Webhook Idempotency Patterns for AI Agent Budget Events](/blog/webhook-idempotency-patterns-for-ai-agent-budget-events).

Honest scoping: Cycles is not a billing engine, not a SIEM, and not a FinOps platform. It is a source of scoped budget lifecycle data that those systems can consume. Datadog, Honeycomb, CloudZero, Splunk, and the various LLMOps platforms each cover slices of the larger story. Your integration supplies the tool identity and business context, logs non-persisting decisions, and correlates external outcomes with what Cycles reserved and committed.

## What this post does not yet claim

Some byproducts are real but require additional integration work, and we don't want to overclaim:

- **Pricing-model enablement.** Usage-based pricing, credit wallets, and tiered plans need a billing engine downstream. Cycles produces the metering input that Stripe/Lago/Orb consume; we don't produce invoices.
- **Carbon and ESG reporting.** Token counts feed carbon estimates well, but Cycles doesn't ship the carbon-coefficient mapping. The plumbing is there; the partnership work isn't.
- **VC and acquisition due diligence.** The data exists in the ledger; turning it into a board deck or an acquisition data room is on you. We're not in the analyst-services business.

These are roadmap pointers and partner-integration territory, not features being claimed today.

## Why this matters in production

Most AI infrastructure layers solve one stakeholder's problem. Observability platforms serve operations. The OpenAI dashboard serves engineers. A separate audit log serves compliance — usually built reactively after a question is asked.

The Cycles ledger can anchor answers for all three stakeholders when it is combined with the application's decision and action logs. Risk and compliance get correlated preflight rationale and lifecycle evidence. Finance gets per-subject cost attribution. Platform engineering gets workspace-level chargeback. The reason it works is that each of those stakeholders is asking the same underlying question — *"who took which action with what authority and at what cost"* — phrased in three different professional vocabularies.

You build the enforcement layer because runaway spend and risky actions are real and acute. You get the ledger because the act of enforcing produces records that, by protocol design, are structured the way an auditor, a CFO, and a platform engineer all need them.

The circuit-breaker framing is the front door. The ledger is the back office that keeps the company running.

## Related reading

- [AI Agent Unit Economics: Cost and Margin Analysis](/blog/ai-agent-unit-economics-cost-per-conversation-per-user-margin) — cost per conversation, per user, per cohort; margin analysis using Cycles' subject hierarchy
- [The AI Agent Governance Framework](/blog/ai-agent-governance-framework-nist-eu-ai-act-iso-42001-owasp-runtime-enforcement) — mapping NIST, EU AI Act, ISO 42001, and OWASP requirements to runtime enforcement controls
- [Webhook Idempotency Patterns for AI Agent Budget Events](/blog/webhook-idempotency-patterns-for-ai-agent-budget-events) — receiver-side idempotency patterns for at-least-once webhook delivery
- [Operational Runbook: Using Cycles Runtime Events](/blog/operational-runbook-using-cycles-runtime-events) — turning the same event stream into PagerDuty / Slack / auto-remediation signal
- [Where Did My Tokens Go? Debugging Agent Spend](/blog/where-did-my-tokens-go-debugging-agent-spend) — observability companion for the cost-attribution flow
- [How decide() works in Cycles](/protocol/how-decide-works-in-cycles-preflight-budget-checks-without-reservation) — preflight budget checks and the decision API
- [How scope derivation works in Cycles](/protocol/how-scope-derivation-works-in-cycles) — the six-level subject hierarchy and how it's resolved

## Related how-to guides

- [Webhook integrations](/how-to/webhook-integrations)
- [API key management](/how-to/api-key-management-in-cycles)
- [Using the Cycles dashboard](/how-to/using-the-cycles-dashboard)
