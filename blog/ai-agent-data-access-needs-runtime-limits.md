---
title: "AI Agent Data Access Needs Runtime Limits"
date: 2026-08-18
author: Albert Mavashev
tags: [security, agents, runtime-authority, governance, zero-trust, production, risk]
description: "Read-only AI agent tools can still expose sensitive data. Learn how to bound access volume with scoped runtime limits while keeping authorization and DLP."
blog: true
sidebar: false
featured: false
head:
  - - meta
    - name: keywords
      content: "AI agent data access controls, sensitive data exposure, AI agent least privilege, runtime limits, data exfiltration, runtime authority, RISK_POINTS"
---

# AI Agent Data Access Needs Runtime Limits

A support agent has one CRM tool: `get_customer_record`. It cannot update a row, send an email, or issue a refund. Its identity is valid, its token has read-only scope, and every query passes row-level authorization.

Then a poisoned ticket or planning error sends it into a broad search. The agent requests 50 customer records, follows the next page, and repeats. Two hundred pages later, 10,000 records have crossed from the CRM into the agent process and potentially into model context, traces, or temporary memory. No database state changed. The access was still much broader than the task required.

"Read-only" describes mutation capability. It does not bound data [exposure](/glossary#exposure).

<!-- more -->

## Read permission is not an exposure budget

Identity and access systems are the right place to decide which principal may reach which resource. Row filters, field-level permissions, and application-level tenant-data isolation should narrow the records a query can return. Those controls solve problems that a budget ledger does not.

They answer a different question, however. An agent may be authorized to read each of 10,000 customer records individually while having no legitimate reason to collect all 10,000 during one support run. This is the read-side version of the distinction between standing permission and cumulative authority described in [Agent Identity Is Not Agent Authority](/blog/agent-identity-is-not-agent-authority).

Recent agent-security guidance and standards-oriented work identify sensitive-data access, aggregation, and overbroad downstream privileges as distinct concerns. Meta's Agents Rule of Two names access to private data or sensitive systems as one of three properties that create the highest-impact prompt-injection paths when combined. NIST's February 2026 draft agent identity and authorization concept paper asks how policy should handle data sensitivity when an agent aggregates information from multiple resources. OWASP's excessive-agency guidance recommends minimum privileges and preserving the user's authorization context in downstream systems.

Identity, authorization, minimization, and architectural separation remain primary controls. A scoped data-access allowance backed by a `CREDITS` or `RISK_POINTS` budget adds a narrower runtime question:

> Given that this agent is allowed to run this query, how much sensitive data may this run acquire before it must narrow, defer, or stop?

The existing [AI agent risk-assessment framework](/blog/ai-agent-risk-assessment-score-classify-enforce-tool-risk) identifies the problem: regulated or exfiltration-prone deployments may need nonzero risk values for sensitive reads. One operational pattern is to make a data-access allowance cumulative and mandatory at the query boundary.

## Give each control one job

Data-access safety is a stack. Each layer owns a different decision:

| Control | Question it answers | What it does not answer by itself |
|---|---|---|
| Identity and authentication | Who is the agent? | Which specific records this task needs |
| Application authorization | May this identity read these rows and fields? | How many authorized rows the run may accumulate |
| Data minimization and DLP | What content should be omitted, masked, or blocked? | How much permitted content has already been acquired |
| Network and egress controls | Where may data travel? | How much data may be assembled inside the permitted boundary |
| Data-access allowance | Does this bounded read still fit the scoped budget? | Whether the identity, query arguments, or destination are authorized |
| Audit and settlement | What exposure was reserved and committed, what data was returned, and which attempts were rejected? | Preventing access unless paired with a mandatory gate |

Google Cloud, for example, recommends IAM and VPC Service Controls together: IAM provides identity-based access, while VPC Service Controls adds context-based perimeter controls for supported Google-managed services, including controls on data movement across a perimeter. That is useful defense in depth. A data-access allowance addresses a remaining case inside an approved perimeter: the right agent using the right API to retrieve too much permitted data for one task.

This is also why a data-access allowance is not a replacement for the [zero-trust tool boundary](/blog/zero-trust-for-ai-agents-why-every-tool-call-needs-a-policy-decision) or the broader agent security controls stack. The host still has to authenticate the caller, authorize the query and destination, minimize returned fields, and constrain egress. Cycles' budget-authority layer evaluates the caller-assigned amount across server-derived scopes and configured ledgers; it does not inspect returned data or authorize query arguments and destinations.

## Aggregation changes the risk

Record-level authorization is necessary, but agents create an aggregation problem that is easy to miss in conventional access reviews.

A customer-support identity may legitimately retrieve one account at a time. A fraud-review workflow may legitimately retrieve a larger cohort. A general-purpose agent with both grants can assemble a dataset whose sensitivity is greater than any one response suggests. NIST calls out this question directly: when an agent gains access to additional tools and resources, how should the sensitivity of the aggregated data and the user's authority to receive the result be determined?

A data-access allowance does not calculate that sensitivity. A mandatory host integration can enforce the limit after the application has expressed it. Common scope choices include:

- a workflow-scoped allowance that bounds one run;
- an agent-scoped allowance that limits a deployed agent across runs;
- a [tenant](/glossary#tenant)-scoped allowance that prevents one customer from consuming a shared exposure pool; and
- a toolset-scoped allowance that isolates sensitive CRM reads from public knowledge-base searches.

The v0 server derives enforcement scopes only from the standard subject fields: tenant, workspace, app, workflow, agent, and toolset. Optional `dimensions` may carry classifications for reporting, but implementations may ignore them for budgeting. If a classification must enforce a distinct ledger, map it to an enforceable standard scope—often a toolset—or keep the authorization policy in the host.

## Measure access with supported units

The [Cycles v0 unit model](/protocol/understanding-units-in-cycles-usd-microcents-tokens-credits-and-risk-points) defines `USD_MICROCENTS`, `TOKENS`, `CREDITS`, and `RISK_POINTS`. It does not define a `DATA_ACCESS` unit. `CREDITS` and `RISK_POINTS` are optional generic integer units, so an operator should confirm implementation support before using either.

Two mappings are practical:

| Mapping | Better fit | Example |
|---|---|---|
| Count-based `CREDITS` | Records have roughly equal sensitivity and size | One returned customer record consumes one credit |
| Sensitivity-weighted `RISK_POINTS` | Data classes have materially different exposure | A public catalog row costs 0; a customer profile costs 2; a regulated record costs 10 |

The numbers are application policy, not protocol defaults. The server does not inspect a result set, infer sensitivity, or assign points. The host performs that classification and submits the amount.

Avoid treating bytes or [tokens](/glossary#tokens) as a complete sensitivity measure. A short record can contain a Social Security number; a large public manual can contain nothing confidential. Volume is useful only after the application has separated data classes or assigned weights that reflect its own environment.

## Reserve the page before running the query

For paginated sensitive reads, apply the reserve-commit lifecycle to a bounded page rather than an open-ended search followed by after-the-fact accounting.

Suppose an application assigns 2 `RISK_POINTS` to each standard customer record and permits at most 50 records per database request. Before the query, the host reserves the maximum page exposure: 100 points.

```json
{
  "idempotency_key": "run-842-crm-page-03",
  "subject": {
    "tenant": "acme",
    "workflow": "run-842",
    "agent": "support-agent",
    "toolset": "crm-sensitive"
  },
  "action": {
    "kind": "db.query",
    "name": "crm.customer-page",
    "tags": ["prod", "customer-data"]
  },
  "estimate": {
    "unit": "RISK_POINTS",
    "amount": 100
  },
  "ttl_ms": 30000
}
```

The host then executes a query that cannot return more than 50 records. If the database returns 37, the host commits 74 points and the unused 26 are released. If the query fails before any record crosses the boundary, the host releases the [reservation](/glossary#reservation). If 37 records return and downstream summarization later fails, the host still commits 74: the data exposure already occurred.

The order matters:

```text
authorize identity, rows, fields, and query arguments
  -> calculate the maximum exposure of one bounded page
  -> reserve that amount
  -> execute the size-limited query
  -> commit the actual RISK_POINTS for the records returned
  -> request another page only after another reservation succeeds
```

Do not fetch 10,000 records, discover the actual count, and ask the ledger afterward. A post-execution event can record exposure, but it cannot make the original read conditional. The same pre-execution principle used for [MCP tool budgets](/blog/how-to-add-budget-limits-to-an-mcp-server) applies to read tools when acquisition itself is the risk.

At the wire level, live reservations behave differently from preflight decisions: a live reservation can succeed with `ALLOW` or `ALLOW_WITH_CAPS`; insufficient budget on an existing ledger returns an error such as `409 BUDGET_EXCEEDED`. `DENY` is returned by `/decide` and dry-run evaluation, not by a live insufficient-budget reservation. The current cap schema also has no `max_records` field. The host must enforce the query's page limit and choose a smaller follow-up request; the server does not rewrite the query.

## Degrade toward less data

When the data-access allowance runs low, the fallback should reduce acquisition rather than merely produce a shorter answer from the same oversized input.

Useful degradation paths include:

| Instead of | Degrade to |
|---|---|
| Fetching the next 50-record page | Request 10 records after a new reservation succeeds |
| Loading full customer profiles | Return approved fields or a precomputed aggregate |
| Searching every tenant account | Restrict the query to the current customer or case |
| Passing raw records into model context | Aggregate inside the database or protected data boundary and return only the authorized result |
| Continuing an exploratory scan | Defer the work or require explicit human approval |

An `ALLOW_WITH_CAPS` response may still carry supported constraints such as a tool allowlist, token ceiling, remaining-step limit, or cooldown. Apply those when present, but do not reinterpret them as a record limit. The application's bounded-query contract remains the control that limits rows.

Degrade before acquisition, not only after generation. A shorter answer is not a safer fallback if the full sensitive dataset already entered the run.

## Settlement is part of the security claim

For monetary accounting, under-settlement makes a bill inaccurate. For sensitive reads, it can make the exposure ledger inaccurate while the data has already crossed the boundary.

The host therefore needs an honest lifecycle:

- commit the actual amount for returned records even when later processing fails;
- release only when the bounded read did not occur;
- use one reserve key and one settlement key per page, then reuse the relevant key verbatim when retrying the same logical operation;
- preserve known actual exposure across ambiguous commit responses or process restarts; and
- monitor expired reservations as possible settlement gaps, not automatically as unused reads.

The protocol recommends short leases and chunked reserve-commit cycles for bursty work. The [SDK settlement recovery profile](/protocol/sdk-settlement-recovery-and-durability) retries known actual usage through `POST /v1/events` after `410 RESERVATION_EXPIRED`, reusing the stored settlement key. Because the event endpoint is optional in v0, deployments relying on this recovery path must support it. With the default `ALLOW_IF_AVAILABLE` policy, an event may charge less than the submitted actual when remaining budget is insufficient and mark the scope over-limit. Recovery records exposure after the fact; it does not restore the pre-execution hold, so durable client-side settlement still matters.

These records can then join the identity decision, database audit entry, trace, and result classification in an [AI agent audit packet](/blog/what-goes-in-an-ai-agent-audit-packet). The useful claim is not “the agent was read-only.” It is narrower and testable: this identity was authorized for these fields, each bounded page acquired a recorded amount, and the next page stopped when its scoped allowance was unavailable.

## What runtime data-access limits do not solve

A scoped data-access allowance is containment, not a complete data-security system.

It does not:

- detect prompt injection;
- decide which rows or fields an identity may read;
- inspect returned content for secrets or personal data;
- prevent an allowed destination from mishandling data;
- erase information already placed in model context, logs, traces, or memory; or
- prove that every read path uses the mandatory gate.

If one permitted read is itself catastrophic, its allowance should be zero until a stronger authorization or approval path exists. For an agent that processes untrustworthy input, if private-data access and external communication need not coexist in one session, separating them under Meta's Agents Rule of Two is the stronger preventive control. The [lethal-trifecta analysis](/blog/lethal-trifecta-rule-of-two-metered-authority) makes the same point for outbound actions: metering bounds a capability; it does not make prompt injection safe.

The goal is a defense-in-depth stack with explicit ownership. IAM and application policy decide access. Minimization and DLP reduce content. Network controls constrain destinations. A mandatory data-access allowance bounds cumulative acquisition. Audit and settlement show whether the boundary actually held.

## Resource links

1. [Meta AI — Agents Rule of Two: A Practical Approach to AI Agent Security](https://ai.meta.com/blog/practical-ai-agent-security/) — private-data access as one leg of the Rule of Two.
2. [NIST NCCoE — Accelerating the Adoption of Software and AI Agent Identity and Authorization](https://www.nccoe.nist.gov/sites/default/files/2026-02/accelerating-the-adoption-of-software-and-ai-agent-identity-and-authorization-concept-paper.pdf) — February 2026 draft concept paper on authorization, aggregation, delegation, auditing, and least-privilege questions for agents.
3. [OWASP — LLM06:2025 Excessive Agency](https://genai.owasp.org/llmrisk/llm062025-excessive-agency/) — minimum privileges and user-context authorization for downstream systems.
4. [Google Cloud — Overview of VPC Service Controls](https://docs.cloud.google.com/vpc-service-controls/docs/overview) — context-based perimeter controls for supported Google-managed services and data movement across perimeters.
