---
title: "Debugging AI Agent Spend in Production"
date: 2026-04-17
author: Albert Mavashev
tags: [engineering, debugging, observability, agents, cost-attribution, runtime-authority]
description: "Debug AI agent spend with scope paths, event streams, and trace IDs, then trace unexpected cost increases across tenants, workflows, and providers reliably."
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

This is LLM token attribution at production scale — debugging AI agent spend when the proxy can't tell you *which agent, which workflow, which tool call* drove the spike. This post is about the data model you actually need to answer the question. Not which observability tool to buy — which **fields on which events**, and which **balance queries**, let you drill from "total spend tripled" down to "this workflow, this agent, this tool call, this API key, this trace ID." The answer in Cycles is three primitives captured at enforcement time — **scope path, actor, trace ID** — surfaced through the event stream and the balance API. Everything else is filtering.

Cycles narrows the suspect set structurally; exact tool-call reconstruction still depends on your own application logs keyed by trace ID. The post covers both halves.

<!-- more -->

## Why LLM-proxy observability stops short

When all model traffic is routed through them, proxy and gateway tools can report totals and product-dependent breakdowns by model, key, user, or custom metadata. That is useful, but it is a different data boundary from Cycles scopes and application tool execution.

It stops being useful the moment your system has any of:

- Multiple agents that share an API key (now the proxy lumps them together)
- A single agent that runs in multiple workflows (which workflow spiked?)
- Tool calls that chain (the expensive tool is N layers deep)
- Multi-tenant architecture (which customer's agent?)
- Background vs. interactive work on the same key (which drove the spike?)

The proxy's attribution ceiling is **whatever the caller labels the request with.** If your code sends `user: "alice"` in the OpenAI request, you can filter to Alice. If it doesn't, you can't. And most agent frameworks don't inject hierarchical labels — they call the model provider directly, the proxy sees a raw LLM request, and the tree of "which part of my system caused this" is lost by the time the proxy reports it.

That's not a tool problem. That's a **data-model problem**. The tree has to be captured at enforcement time, not reconstructed after the fact.

## The three primitives for LLM token attribution

Cycles is designed to carry three structural attribution fields through the reserve-commit flow and onto events when your integration provides them:

**`scope` (a path).** Not a flat label. A path like `tenant:acme-corp/workspace:prod/app:support-bot/workflow:handoff/agent:planner/toolset:web-search`. Six standard levels are available, and ordered paths make prefix queries cheap. You can filter at any populated depth: "everything under `tenant:acme-corp/workspace:prod`" or "just this agent segment."

**`actor` (the principal).** Type, key ID, source IP. This is who/what initiated the action at the API boundary — an API key, a service account, a system process. Two agents sharing a budget scope can still be separated if they arrive through distinct actors or correlation paths, so "who spent the money" is separable from "whose budget paid for it."

**`trace_id` and `request_id`.** The trace primitives. Send the same valid W3C `traceparent` or `X-Cycles-Trace-Id` on related reserve, provider, and commit calls, and record the resulting trace ID in application logs. Each Cycles HTTP request also has its own request ID. `correlation_id` is a separate, server-managed event field: the protocol defines deterministic runtime clusters, but the current reference runtime does not populate it on the six event paths below.

Together, these fields make implemented event paths navigable. Exact tool-call reconstruction still depends on the integration propagating correlation identifiers into its own logs.

## What the event stream tells you today (v0.1.25)

The current Admin API `EventType` enum registers **51 event types across seven categories**; only a subset is emitted by current reference-service paths, and the runtime also publishes several additive lifecycle payloads. See the live [Event Payloads Reference](/protocol/event-payloads-reference) for per-event status. This section focuses on six runtime signals that are useful for spend investigations.

These are signal events, not a per-commit spend ledger. The three budget events fire on ledger changes; denial, overage, and expiry describe reservation decisions or lifecycle outcomes. For current quantities, query the balance API (covered in the next section).

### 1. `reservation.denied` — what shadow evaluation would block

Fires when a reservation request with `dry_run: true` or `/v1/decide` returns `DENY`. A live reservation denial is an HTTP error such as `409 BUDGET_EXCEEDED`; the current controller does not emit this event for that exception path.

```json
{
  "event_type": "reservation.denied",
  "scope": "tenant:acme-corp/workspace:prod/workflow:support",
  "actor": {"type": "api_key", "key_id": "key_abc123"},
  "data": {
    "scope": "tenant:acme-corp/workspace:prod/workflow:support",
    "unit": "USD_MICROCENTS",
    "reason_code": "BUDGET_EXCEEDED",
    "requested_amount": 500000,
    "remaining": 100000,
    "action": {"kind": "llm.chat", "name": "support-reply"},
    "subject": {
      "tenant": "acme-corp",
      "workspace": "prod",
      "workflow": "support"
    }
  },
  "trace_id": "0af7651916cd43dd8448eb211c80319c"
}
```

`reason_code` values include `BUDGET_EXCEEDED`, `OVERDRAFT_LIMIT_EXCEEDED`, `DEBT_OUTSTANDING`, `BUDGET_FROZEN`, `BUDGET_CLOSED`, and `TENANT_CLOSED`. A denied reservation dry run derives `remaining` from returned balances; `/v1/decide` currently omits it. This stream answers which shadow evaluations would be blocked. For live denial volume, use application errors or `cycles_reservations_reserve_total{decision="DENY"}`.

### 2. `reservation.commit_overage` — the estimator is wrong

Fires when a commit's requested actual cost exceeds the original estimate. The current runtime sets the envelope scope and populates the full eight-field payload:

```json
{
  "event_type": "reservation.commit_overage",
  "scope": "tenant:acme-corp/workspace:prod/workflow:support",
  "data": {
    "reservation_id": "res_a1b2c3d4",
    "scope": "tenant:acme-corp/workspace:prod/workflow:support",
    "unit": "USD_MICROCENTS",
    "estimated_amount": 400000,
    "actual_amount": 480000,
    "overage": 80000,
    "overage_policy": "ALLOW_IF_AVAILABLE",
    "debt_incurred": 0
  }
}
```

The debugging value is both concentration and magnitude: group by scope, then inspect `estimated_amount`, `actual_amount`, `overage`, and `overage_policy`. A rising overage rate for a workload is an estimator-drift signal, covered in depth in [estimate drift: the silent killer of enforcement](/blog/estimate-drift-silent-killer-of-enforcement).

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

An occasional expiry can follow a client crash, timeout, or deliberately abandoned reservation. A workload-specific increase means reservations are being made but neither commit nor release reaches the server before TTL expiry. That reservation-to-terminal-operation ratio is the signal. A proxy that only sees completed upstream requests cannot reconstruct this client-side lifecycle on its own.

### 4. `budget.exhausted` — remaining hit zero

Fires once when a budget's remaining transitions from above zero to zero. The payload contains `scope`, `unit`, `threshold: 1.0`, `utilization`, `allocated`, `remaining: 0`, `spent`, `reserved`, and `direction: rising`; the envelope adds tenant, actor, and request context. Query the balance API before remediation because the ledger may have changed since emission.

### 5. `budget.over_limit_entered` — debt crossed the ceiling

Fires when debt on an `ALLOW_WITH_OVERDRAFT` budget enters over-limit state. Full payload today:

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

### 6. `budget.debt_incurred` — an operation created new debt

Fires when a reservation commit or direct debit under `ALLOW_WITH_OVERDRAFT` creates new debt. Today's emission populates:

```json
{
  "event_type": "budget.debt_incurred",
  "data": {
    "scope": "tenant:acme-corp/workspace:prod",
    "unit": "USD_MICROCENTS",
    "reservation_id": "res_a1b2c3d4",
    "debt_incurred": 250000,
    "total_debt": 750000,
    "overdraft_limit": 1000000,
    "overage_policy": "ALLOW_WITH_OVERDRAFT"
  }
}
```

`reservation_id` is omitted when a direct debit, rather than a reservation commit, caused the debt. A stream of these on one scope means the overage policy is routinely borrowing — which can be intentional, but the *rate* is a spend signal. If `total_debt` climbs faster than it gets repaid, the budget may be structurally under-allocated or the workload may be behaving unexpectedly.

## What the balance API fills in

Six event types won't tell you "spend this hour by scope." That's not what event streams are for. For that, [query the runtime-plane balance API](/protocol/querying-balances-in-cycles-understanding-budget-state) directly. On port 7878, `GET /v1/balances` takes subject-style filters — `tenant`, `workspace`, `app`, `workflow`, `agent`, `toolset`, plus `include_children=true` for subtree queries — and returns `allocated`, `spent`, `remaining`, `reserved`, `debt` per scope:

```bash
curl -s "http://localhost:7878/v1/balances?tenant=acme&workspace=prod&include_children=true" \
  -H "X-Cycles-API-Key: $KEY"
```

Run that at two points on the same subtree and subtract `spent` to calculate interval consumption, provided no `RESET_SPENT` operation occurs between snapshots. (The admin plane on port 7979 has a separate `GET /v1/admin/budgets?scope_prefix=...&unit=...` query; that's for operator/governance workflows and uses a different parameter shape. This post stays on the runtime plane.)

The division of labor is clean: **events tell you decisions and lifecycle changes; the balance API tells you current quantities.** A mature monitoring setup uses both — events to wake you up, balances to answer "how much."

## Four debugging moves that work today

Concretely — what do you type when the bill is 3× and you have thirty minutes?

**Move 1: Top-N by scope, via runtime balances.** `GET /v1/balances?tenant=X&include_children=true` on the runtime plane (add `workspace`, `app`, etc. to narrow); sort the returned scopes by `spent` descending. The top child scope is the first candidate. If the top is a tenant/workspace you didn't expect to spike, the investigation is now "what changed for that customer." If it's a single workflow or agent scope, drill deeper. This is the first move you run — and it's a balance query, not an event subscription, because today's event stream doesn't carry per-debit amounts.

**Move 2: Health changes in the window.** Subscribe to or query stored events for `budget.exhausted`, `budget.over_limit_entered`, and `budget.debt_incurred` in the last N hours. Any scope that fired these reached a budget boundary or created debt. Cross-reference live application errors and `cycles_reservations_reserve_total{decision="DENY"}` to find enforcement retries. Use `reservation.denied` separately to analyze dry-run or `/v1/decide` calibration behavior.

**Move 3: Estimator drift.** Pull `reservation.commit_overage` volume for the window. A rising rate on a specific client or reservation-id prefix is the estimator on that scope over-committing. The fix is recalibration — not capacity. This is a different root cause than "traffic genuinely increased," and you will misdiagnose it if you only look at totals.

**Move 4: Trace ID join.** Pick the expensive scope from the balance API, then grab a `trace_id` from the event stream or your own request logs and pivot into application logs. This is the step that closes the loop — the balance API and event stream tell you *which scope*, but the propagated trace ID tells you *what code* ran. The balance API gives you ledger quantities, not commit-level records; carrying the same trace context through each related reserve, provider, and settlement call is what makes this move work.

Without step 4, the first three tell you where to look but not what to fix. With step 4, you end with a diff in a specific file.

## What the admin dashboard does on top of this

The [Cycles admin dashboard](/quickstart/deploying-the-cycles-dashboard) is a UI over admin budgets, events, and related APIs. It does not reconstruct commit-level history that those APIs do not expose. What it adds is prebuilt filtering, sorting, and current-state inspection for budgets and events. The APIs remain authoritative; the dashboard shortens routine triage.

The reason to publish the stream and balance APIs as the primary interfaces — not the dashboard — is that every team eventually wants to pipe this data into their own SIEM, data warehouse, or oncall system. If the dashboard is the only view, that integration is a scraping project. If the APIs are, it's a webhook subscription plus a cron.

## What's on the roadmap

A few protocol-defined events would make runtime debugging richer when they come online — `budget.burn_rate_anomaly` as a passive spike detector, `reservation.denial_rate_spike` and `reservation.expiry_rate_spike` for rate anomalies, and `budget.threshold_crossed` for configurable pre-exhaustion warnings. The admin server currently emits `budget.debited` for an operator `DEBIT` funding operation; that is not a per-commit runtime ledger. The [event payloads reference](/protocol/event-payloads-reference) tracks each event's status.

## The non-goal: cost *prediction*

This post is deliberately about *attribution*, not prediction. "Will this change cost more next month" is a different problem — you need historical spend trends, traffic forecasts, and model-pricing assumptions. The attribution story ends at "here's what happened and why"; it's the input to the prediction story, not a substitute for it.

That distinction matters because **you cannot attribute spend you didn't structurally capture.** A dashboard over unstructured logs cannot produce a scope-tree decomposition no matter how good the UI is.

## Bottom line

When the bill surprises you, the question you're asking is structural: which part of the system produced this spend, who initiated it, and what code ran? Cycles supplies scope and actor context on implemented runtime paths and propagates trace context when your integration provides it. The six signals above identify decisions and lifecycle changes, the balance API answers *how much*, and application logs keyed by `trace_id` close the loop back to code.

The observability tools that only see totals aren't wrong. They're answering a different question. Attribution is a data-model commitment you make upstream, not a chart you add downstream.

---

*Related reading: [event payloads reference](/protocol/event-payloads-reference) for emission status of every event type, [estimate drift: the silent killer of enforcement](/blog/estimate-drift-silent-killer-of-enforcement) for the `commit_overage` deep-dive, [webhook event delivery protocol](/protocol/webhook-event-delivery-protocol) for subscription mechanics, [real-time budget alerts for AI agents](/blog/real-time-budget-alerts-for-ai-agents) for the alerting side of the same stream.*

## Related how-to guides

- [Choosing the right overage policy](/how-to/choosing-the-right-overage-policy)
- [Multi-tenant SaaS guide](/how-to/multi-tenant-saas-with-cycles)
- [Webhook integrations](/how-to/webhook-integrations)
