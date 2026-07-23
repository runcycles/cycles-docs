---
title: "How to Add Budget Limits to an MCP Server"
date: 2026-06-29
author: Albert Mavashev
tags:
  - MCP
  - budget-control
  - runtime-authority
  - agents
  - architecture
description: "Add budget limits to an MCP server by wrapping tool handlers with reserve, commit, and release checks before side effects or runaway loops can execute."
blog: true
sidebar: false
featured: false
head:
  - - meta
    - name: keywords
      content: MCP server budget limits, MCP tool budgets, Model Context Protocol governance, AI agent budget control, reserve commit release, runtime authority
---

# How to Add Budget Limits to an MCP Server

An [MCP server](/glossary#mcp-server) starts as an integration convenience.

You expose `search_docs`, `lookup_customer`, `send_email`, `issue_refund`, or `run_report`. The agent host discovers those tools and calls them through a standard protocol instead of a custom integration.

That is the easy part.

The production question comes next: which of those tool calls should still run after the agent has already searched 20 times, retried a failing API, or crossed the customer's budget?

MCP standardizes access to tools. It does not, by itself, decide whether the next tool call is still inside the allowed budget. To add hard budget limits, the MCP server has to put a budget decision in the execution path before the tool handler creates cost or side effects.

This post is the rollout checklist.

<!-- more -->

## 1. Decide what kind of MCP server you are operating

There are two common patterns, and they solve different problems.

| Pattern | What it does | Budget limit behavior |
|---|---|---|
| Cycles MCP server | Exposes Cycles tools such as `cycles_reserve`, `cycles_commit`, and `cycles_release` to an MCP-compatible agent | Cooperative: the agent can call Cycles tools, but other tools are not automatically gated |
| Your application MCP server | Exposes your business tools, data access, or side effects | Enforced when each business tool handler requires a budget decision before it runs |

The [Cycles MCP server quickstart](/quickstart/getting-started-with-the-mcp-server) is the fastest way to let an MCP-compatible agent participate in budget workflows. That is useful for development, evaluation, and agent-assisted integration work.

For hard production enforcement, the budget check must sit on the action path. If `send_email` is the risky tool, then the `send_email` handler needs to require `reserve` or `decide` before sending the email. If the agent can call a second email tool that bypasses that check, the budget is not actually enforcing the action.

The [Cycles MCP integration guide](/how-to/integrating-cycles-with-mcp) makes the same distinction: exposing budget tools through MCP is useful, but preventative control requires the costly or risky action to depend on the budget decision.

## 2. Classify the tools before setting budgets

Not every MCP tool needs the same limit.

Start by grouping tools into practical classes:

| Tool class | Examples | First budget to add |
|---|---|---|
| Read-only lookup | `search_docs`, `lookup_invoice`, `fetch_ticket` | Token, request, or small spend budget |
| Paid external call | web search, enrichment API, model call | Spend or [credits](/glossary#credits) budget |
| Customer-visible side effect | `send_email`, `post_comment`, `create_ticket` | Credits, spend, or risk budget |
| Financial action | `issue_refund`, `adjust_invoice`, `apply_credit` | Small [RISK_POINTS](/glossary#risk-points) budget plus approval for higher-risk cases |
| Infrastructure action | deploy, shell, data migration | Deny by default, then explicit narrow allowance |

This classification does not need to be perfect on day one. It needs to separate harmless read paths from actions that can create cost, customer impact, or operational risk.

The action-control version of this model is covered in [Action Authority: Controlling What Agents Do](/concepts/action-authority-controlling-what-agents-do). The budget-control version starts with the same inventory: what can this tool do, and what could go wrong if it runs repeatedly?

## 3. Put reserve before the handler

For hard limits, the core flow is:

```text
MCP tool call proposed
  ↓
reserve budget for this tenant, run, toolset, and estimate
  ↓
ALLOW / ALLOW_WITH_CAPS, or a budget-exceeded error
  ↓
execute handler only if allowed
  ↓
commit best-known actual usage after execution starts
release only when execution never starts or usage is demonstrably zero
```

The important property is ordering. The handler runs after the budget decision, not before it.

That gives the MCP server a clear failure mode:

- If the reserve call returns `ALLOW`, execute normally.
- If it returns `ALLOW_WITH_CAPS`, apply the cap before execution when the tool supports a smaller limit.
- If a live reserve returns a budget-exceeded error, do not call the handler. `DENY` is returned by `decide` or dry-run flows, not a successful live reservation.
- If the handler fails after execution begins, commit the best-known actual usage, including partial usage.
- Release the [reservation](/glossary#reservation) only when the handler was skipped, cancelled before execution, or failed with demonstrably zero usage.
- Treat an ambiguous commit failure as unsettled. Retry the commit with the same idempotency key; never convert it to a release.

The protocol details are in [How Reserve-Commit Works](/protocol/how-reserve-commit-works-in-cycles). For a concrete TypeScript wrapper, use [Add Hard Budgets to MCP Tools Before They Execute](/blog/mcp-tool-budgets-before-execution) as the implementation companion to this checklist.

## 4. Scope the budget to the thing you actually want to protect

Most budget mistakes come from choosing the wrong boundary.

An organization-level cap may be too broad. A per-tool cap may be too narrow. A per-user cap may be useful for attribution but insufficient for multi-tenant enforcement if every call still lands against the same shared gateway key.

For MCP servers, useful budget boundaries are usually:

- [Tenant](/glossary#tenant): one customer cannot exhaust another customer's allocation.
- Workspace or environment: staging and production have different risk.
- Workflow: support triage gets a different budget from invoice reconciliation.
- Agent run: one runaway conversation cannot consume the whole tenant budget.
- Toolset: email, refund, search, and code execution have different risk.

The [HTTP MCP server guide](/how-to/running-the-mcp-server-over-http) calls out an important deployment detail: the MCP server's Cycles API key is the gateway's identity. Per-user attribution can be carried as audit context, but enforcement still depends on mapping the request to the right tenant and scope before calling Cycles.

If the scope is wrong, the budget decision may be technically successful and operationally useless.

## 5. Use small estimates first, then tune from actuals

Budget limits need estimates before execution and actuals after execution.

For deterministic tools, estimates can be simple:

- `send_email`: fixed credits or RISK_POINTS estimate.
- `lookup_customer`: small fixed credits estimate.
- `issue_refund`: risk score tied to amount band.

For variable-cost tools, start conservative:

- Model calls: estimate [tokens](/glossary#tokens) or microcents from the requested model and max output.
- Search tools: estimate by maximum result count or provider price.
- Batch actions: estimate per item, then cap the item count.

After an execution attempt, commit the best-known actual usage whether the operation succeeded or failed. That feedback loop is what lets operators tune budgets without guessing forever. If a tool regularly commits much less than it reserves, lower the estimate. If it regularly commits more, raise the estimate or cap the request.

For unit choices, see [Understanding Units in Cycles](/protocol/understanding-units-in-cycles-usd-microcents-tokens-credits-and-risk-points).

## 6. Test denial before trusting the rollout

A budget limit is not real until you have watched it deny a tool call before the handler executes.

Use a small test budget and a harmless tool first:

1. Create a tenant or test scope with a small budget.
2. Configure one MCP tool handler to reserve before execution.
3. Call the tool until the budget is exhausted.
4. Confirm the next call is denied before the handler runs.
5. Confirm successful and partially failed calls commit actual usage.
6. Confirm skipped calls and failures before execution release reservations.
7. Simulate an ambiguous commit response and confirm the client retries that commit with the same idempotency key instead of releasing.

Then test the operator path:

- Does the agent degrade gracefully?
- Does the user get a useful failure message?
- Does the audit trail show the denied action?
- Can the operator tell which tenant, workflow, agent, and toolset consumed the budget?

The [first-rollout guide](/quickstart/how-to-choose-a-first-cycles-rollout-tenant-budgets-run-budgets-or-model-call-guardrails) helps choose whether to start with tenant budgets, run budgets, or model-call guardrails. For MCP servers, the best first test is usually one paid or customer-visible tool with a small budget and a clear denial path.

## 7. Avoid the two common false starts

**False start 1: Ask the agent to call budget tools voluntarily.**

That can help during evaluation, but it is not hard enforcement. If the business tool still works when the agent skips `cycles_reserve`, the budget is advisory.

**False start 2: Log usage after the tool runs.**

Post-hoc events are useful for audit, reporting, and tuning. They are not preventative. If the goal is to stop the next side effect, use `decide` or `reserve` before execution.

Those two false starts are why MCP budget limits belong in the handler, gateway, harness, or service boundary that the tool must pass through.

## Resource links

- [Cycles MCP server quickstart](/quickstart/getting-started-with-the-mcp-server) — expose Cycles budget tools to MCP-compatible agents.
- [Cycles MCP integration guide](/how-to/integrating-cycles-with-mcp) — patterns, resources, prompts, and transport options.
- [Running the MCP server over HTTP](/how-to/running-the-mcp-server-over-http) — shared remote MCP gateway deployment notes.
- [Add Hard Budgets to MCP Tools Before They Execute](/blog/mcp-tool-budgets-before-execution) — implementation companion with a TypeScript wrapper.
- [How Reserve-Commit Works](/protocol/how-reserve-commit-works-in-cycles) — lifecycle reference.
- [Understanding Units in Cycles](/protocol/understanding-units-in-cycles-usd-microcents-tokens-credits-and-risk-points) — monetary, token, credit, and risk units.
- [Model Context Protocol documentation](https://modelcontextprotocol.io/docs/getting-started/intro) — official MCP introduction.
