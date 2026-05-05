---
title: "Where Did My Tokens Go? Debugging Agent Spend at Production Scale"
date: 2026-04-17
author: Albert Mavashev
tags: [engineering, debugging, observability, agents, cost-attribution, runtime-authority]
description: "Debug AI agent spend with scope paths, event streams, and correlation IDs — what Cycles' spend-debugging events and balance API actually let you pivot on when the bill triples."
blog: true
sidebar: false
featured: false
head:
  - - meta
    - name: keywords
      content: "agent cost debugging, llm token attribution, llm cost observability, multi-agent cost attribution, which tool call cost most, why is my agent using so many tokens, debugging ai agent spend, cycles scope path, agent observability debugging, ai agent cost breakdown, per-agent cost attribution"
---

# Where Did My Tokens Go? Debugging Agent Spend at Production Scale

> **Part of: [LLM Cost Runtime Control Reference](/guides/llm-cost-runtime-control)** — the full pillar covering causes, enforcement patterns, multi-tenant boundaries, and unit economics.

The bill just tripled. Your agents aren't doing anything new. You open the LLM proxy dashboard and see the total — yes, token usage is up — but the dashboard only shows you *how much*, not *who, where, or why*. An engineer sitting in front of that dashboard at 9am on a Tuesday has maybe thirty minutes to figure out which tool call cost the most before finance escalates.

This is LLM token attribution at production scale — debugging AI agent spend when the proxy can't tell you *which agent, which workflow, which tool call* drove the spike. This post is about the data model you actually need to answer the question. Not which observability tool to buy — which **fields on which events**, and which **balance queries**, let you drill from "total spend tripled" down to "this workflow, this agent, this tool call, this API key, this correlation ID." The answer in Cycles is three primitives captured at enforcement time — **scope path, actor, correlation ID** — surfaced through the event stream and the balance API. Everything else is filtering.

Cycles narrows the suspect set structurally; exact tool-call reconstruction still depends on your own application logs keyed by correlation ID. The post covers both halves.

<!-- more -->

## Why LLM-proxy observability stops short

Proxy tools (LiteLLM, Helicone, OpenRouter, Langfuse) sit between your code and the model provider. They see *every request*, so they can tell you totals, per-model breakdowns, per-API-key breakdowns. That's genuinely useful for a single-agent app.

It stops being useful the moment your system has any of:

- Multiple agents that share an API key (now the proxy lumps them together)
- A single agent that runs in multiple workflows (which workflow spiked?)
- Tool calls that chain (the expensive tool is N layers deep)
- Multi-tenant architecture (which customer's agent?)
- Background vs. interactive work on the same key (which drove the spike?)

The proxy's attribution ceiling is **whatever the caller labels the request with.** If your code sends `user: "alice"` in the OpenAI request, you can filter to Alice. If it doesn't, you can't. And most agent frameworks don't inject hierarchical labels — they call the model provider directly, the proxy sees a raw LLM request, and the tree of "which part of my system caused this" is lost by the time the proxy reports it.

That's not a tool problem. That's a **data-model problem**. The tree has to be captured at enforcement time, not reconstructed after the fact.

## The three primitives for LLM token attribution

Cycles is designed to carry three structural attribution fields through the reserve/commit flow and onto events when your integration provides them:

**`scope` (a path).** Not a flat label. A path like `tenant:acme-corp/workspace:prod/app:support-bot/workflow:handoff/agent:planner/toolset:web-search`. Six levels deep is the current shape; the depth is a design choice that makes prefix queries cheap. You filter at any depth: "everything under `tenant:acme-corp/workspace:prod`" or "just this one agent instance."

**`actor` (the principal).** Type, key ID, source IP. This is who/what initiated the action at the API boundary — an API key, a service account, a system process. Two agents sharing a budget scope can still be separated if they arrive through distinct actors or correlation paths, so "who spent the money" is separable from "whose budget paid for it."

**`correlation_id` and `request_id`.** The trace primitives. Cycles supports `correlation_id` and `request_id` on events (both are optional fields in the schema, populated when the caller provides them). When your integration threads them through consistently — on the reserve, on the commit, on the LLM request, in your own logs — they become the pivot from "this event happened" to "this exact request in your code" in one hop.

These three fields are what make the event stream navigable — a structural commitment that *everything* that affects spend carries enough metadata to find its origin.

## What the event stream tells you today (v0.1.25)

Cycles' protocol defined [40 event types across six categories](/protocol/event-payloads-reference) as of post date — the current Admin API `EventType` enum registers **47 across seven categories** with the `webhook` category added later (see the live [Event Payloads Reference](/protocol/event-payloads-reference) for the per-category breakdown). **At publication, the runtime spend-debugging surface this article focuses on emitted six events**; the rest were protocol-defined and scheduled for later admin-service and runtime hooks. This section is about the six that fired then and what each one tells you about spend.

These are signal events — they fire on budget-health *transitions*. They are not a per-debit ledger. For per-debit spend numbers you query the balance API (covered in the next section); the events tell you when something *changed*.

### 1. `reservation.denied` — who got blocked, and why

Fires when a reserve or decide request returns DENY. Today's payload is deliberately small:

```json
{
  "event_type": "reservation.denied",
  "scope": "tenant:acme-corp/workspace:prod/workflow:support",
  "actor": {"type": "api_key", "key_id": "key_abc123"},
  "data": {
    "scope": "tenant:acme-corp/workspace:prod/workflow:support",
    "reason_code": "BUDGET_EXCEEDED",
    "requested_amount": 500000
  },
  "correlation_id": "req_0af3"
}
```

`reason_code` values include `BUDGET_EXCEEDED`, `OVERDRAFT_LIMIT_EXCEEDED`, `DEBT_OUTSTANDING`, `BUDGET_FROZEN`, `BUDGET_CLOSED`. When you're debugging a spend spike, a denial stream is the *inverse* signal — it's spend that didn't happen. But if denials are up on `scope X` and the total bill is also up, the implication is a client retrying after denials and somehow committing under a different scope.

### 2. `reservation.commit_overage` — the estimator is wrong

Fires when a commit's actual cost exceeded the original estimate. The current emission is minimal on purpose — the full payload is still being wired up — so what you get today is:

```json
{
  "event_type": "reservation.commit_overage",
  "data": {
    "reservation_id": "res_a1b2c3d4",
    "actual_amount": 480000
  }
}
```

Note: today's emission does *not* set the envelope `scope` field on this event, so a scope-filtered webhook subscription won't receive it. Take all `commit_overage` events and correlate `reservation_id` back to your reserve-request logs to get the scope; the full in-payload shape (`scope`, `unit`, `estimated_amount`, `overage`, `overage_policy`, `debt_incurred`) is protocol-defined and will populate in future releases. The debugging value today is volume: a rising commit_overage rate for a tenant is an estimator-drift signal, covered in depth in [estimate drift: the silent killer of enforcement](/blog/estimate-drift-silent-killer-of-enforcement).

### 3. `reservation.expired` — reserved but never committed

Fires from the background expiry sweeper. This one has the full payload today:

```json
{
  "event_type": "reservation.expired",
  "data": {
    "reservation_id": "res_d4e5f678",
    "scope": "tenant:acme-corp/workspace:prod",
    "unit": "USD_MICROCENTS",
    "estimated_amount": 200000,
    "created_at": "2026-04-01T14:30:00.000Z",
    "expired_at": "2026-04-01T14:35:30.000Z",
    "ttl_ms": 300000,
    "extensions_used": 0
  }
}
```

A healthy system produces a trickle of these (a client crash, a timeout). A flood of them from one scope means a specific workload has broken commit-path plumbing — reservations are being made but the commit call never lands. That reservation-to-commit ratio is the signal. Most LLM proxies can't show it at all, because they only see completed requests.

### 4. `budget.exhausted` — remaining hit zero

Fires when a budget's remaining reaches zero. `data` is `null`; the envelope carries the context — `scope`, `tenant_id`, `actor`, `timestamp` identify which budget exhausted and what triggered it. Query the budget's current state via the balance API for the actual numbers. This event is the "something just maxed out" alarm; the interesting follow-up is "which scope, and what was the preceding burn rate."

### 5. `budget.over_limit_entered` — debt crossed the ceiling

Fires when debt on an `ALLOW_WITH_OVERDRAFT` budget exceeds the configured overdraft limit. Full payload today:

```json
{
  "event_type": "budget.over_limit_entered",
  "data": {
    "scope": "tenant:acme-corp/workspace:prod",
    "unit": "USD_MICROCENTS",
    "debt": 1500000,
    "overdraft_limit": 1000000,
    "is_over_limit": true,
    "debt_utilization": 1.5
  }
}
```

If this fires in production, debt is actively accumulating on a scope faster than expected. Combined with `budget.debt_incurred` below, it's the "the agents are eating the overdraft" signal.

### 6. `budget.debt_incurred` — a commit created new debt

Fires when a commit goes through under `ALLOW_WITH_OVERDRAFT` policy and creates new debt (actual cost exceeded remaining budget). Today's emission populates:

```json
{
  "event_type": "budget.debt_incurred",
  "data": {
    "scope": "tenant:acme-corp/workspace:prod",
    "unit": "USD_MICROCENTS",
    "total_debt": 750000,
    "overdraft_limit": 1000000
  }
}
```

A stream of these on one scope means the overage policy is routinely borrowing — which is fine by design, but the *rate* is a spend signal. If `total_debt` on a scope is climbing faster than it gets repaid, the long-run picture is a budget that's structurally under-allocated for its workload.

## What the balance API fills in

Six event types won't tell you "spend this hour by scope." That's not what event streams are for. For that, [query the runtime-plane balance API](/protocol/querying-balances-in-cycles-understanding-budget-state) directly. On port 7878, `GET /v1/balances` takes subject-style filters — `tenant`, `workspace`, `app`, `workflow`, `agent`, `toolset`, plus `include_children=true` for subtree queries — and returns `allocated`, `spent`, `remaining`, `reserved`, `debt` per scope:

```bash
curl -s "http://localhost:7878/v1/balances?tenant=acme&workspace=prod&include_children=true" \
  -H "X-Cycles-API-Key: $KEY"
```

Run that at minute-zero and again at minute-sixty on the same subtree and subtract — that's spend-in-the-hour by scope, from ground truth, no event correlation required. (The admin plane on port 7979 has a separate `GET /v1/admin/budgets?scope_prefix=...&unit=...` query; that's for operator/governance workflows and uses a different parameter shape. This post stays on the runtime plane.)

The division of labor is clean: **events tell you transitions, the balance API tells you quantities.** A mature monitoring setup uses both — events to wake you up, balances to answer "how much."

## Four debugging moves that work today

Concretely — what do you type when the bill is 3× and you have thirty minutes?

**Move 1: Top-N by scope, via runtime balances.** `GET /v1/balances?tenant=X&include_children=true` on the runtime plane (add `workspace`, `app`, etc. to narrow); sort the returned scopes by `spent` descending. The top child scope is the first candidate. If the top is a tenant/workspace you didn't expect to spike, the investigation is now "what changed for that customer." If it's a single workflow or agent scope, drill deeper. This is the first move you run — and it's a balance query, not an event subscription, because today's event stream doesn't carry per-debit amounts.

**Move 2: Health transitions in the window.** Subscribe to or query stored events for `budget.exhausted`, `budget.over_limit_entered`, and `budget.debt_incurred` in the last N hours. Any scope that fired these is at or near a budget boundary — the bill probably won't be news, but *which scope* and *when* will be. Cross-reference with `reservation.denied` volume: if denials and debt both spiked on the same scope, a retry loop is eating the overdraft.

**Move 3: Estimator drift.** Pull `reservation.commit_overage` volume for the window. A rising rate on a specific client or reservation-id prefix is the estimator on that scope over-committing. The fix is recalibration — not capacity. This is a different root cause than "traffic genuinely increased," and you will misdiagnose it if you only look at totals.

**Move 4: Correlation ID trace.** Pick the expensive scope from the balance API, then grab a `correlation_id` from the event stream or your own commit logs and pivot into application logs. You now have the exact function call, prompt, tool invocation. This is the step that closes the loop — the balance API and event stream tell you *which scope*, but `correlation_id` is what tells you *what code* ran. The balance API gives you ledger quantities, not commit-level records; threading a correlation ID through on every reserve/commit call is what makes this move work.

Without step 4, the first three tell you where to look but not what to fix. With step 4, you end with a diff in a specific file.

## What the admin dashboard does on top of this

The [Cycles admin dashboard](/quickstart/deploying-the-cycles-dashboard) is a UI over the same event stream and balance APIs. It doesn't see anything the APIs don't see. What it adds is the filter/group/sort operations prebuilt — "show me spend by scope for the last 24 hours" is a page, not a balance sweep you script. For a one-off incident at 9am, that matters. The APIs are authoritative; the dashboard is fast.

The reason to publish the stream and balance APIs as the primary interfaces — not the dashboard — is that every team eventually wants to pipe this data into their own SIEM, data warehouse, or oncall system. If the dashboard is the only view, that integration is a scraping project. If the APIs are, it's a webhook subscription plus a cron.

## What's on the roadmap

A few protocol-defined events would make the debugging story richer when they come online — `budget.debited` for a per-commit ledger, `budget.burn_rate_anomaly` as a passive spike detector, `reservation.denial_rate_spike` and `reservation.expiry_rate_spike` for rate anomalies, and the planned `budget.threshold_crossed` for proactive warnings at configurable utilization levels. The [event payloads reference](/protocol/event-payloads-reference) tracks which of these are live; the four moves above are structured so they keep working as more of the stream lights up.

## The non-goal: cost *prediction*

This post is deliberately about *attribution*, not prediction. "Will this change cost more next month" is a different problem — you need historical spend trends, traffic forecasts, and model-pricing assumptions. The attribution story ends at "here's what happened and why"; it's the input to the prediction story, not a substitute for it.

That distinction matters because **you cannot attribute spend you didn't structurally capture.** A dashboard over unstructured logs cannot produce a scope-tree decomposition no matter how good the UI is.

## Bottom line

When the bill surprises you, the question you're asking is structural: which part of the system produced this spend, who initiated it, and what code ran? The answer needs three fields captured at the moment of authority — scope path, actor, correlation ID — on every event the system emits and every balance it records. Cycles captures those. The six spend-debugging events above signal the *transitions*, the balance API answers *how much*, and `correlation_id` closes the loop back to code.

The observability tools that only see totals aren't wrong. They're answering a different question. Attribution is a data-model commitment you make upstream, not a chart you add downstream.

---

*Related reading: [event payloads reference](/protocol/event-payloads-reference) for emission status of every event type, [estimate drift: the silent killer of enforcement](/blog/estimate-drift-silent-killer-of-enforcement) for the `commit_overage` deep-dive, [webhook event delivery protocol](/protocol/webhook-event-delivery-protocol) for subscription mechanics, [real-time budget alerts for AI agents](/blog/real-time-budget-alerts-for-ai-agents) for the alerting side of the same stream.*
