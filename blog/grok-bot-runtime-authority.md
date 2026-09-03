---
title: "Grok Bot Has a Computer. Where Does Cycles Fit?"
date: 2026-09-03
author: Albert Mavashev
tags:
  - grok-bot
  - computer-use
  - MCP
  - runtime-authority
  - action-authority
  - RISK_POINTS
  - agents
description: "Grok Bot gives persistent AI teammates a shared cloud computer. See where Cycles can enforce budgets and action authority—and where it cannot."
blog: true
sidebar: false
featured: false
head:
  - - meta
    - name: keywords
      content: "Grok Bot, Grokbot, Grok Bot security, Grok Bot MCP, Grok Bot guardrails, computer-use agent governance, AI agent budgets, action authority, runtime authority, Cycles"
---

# Grok Bot Has a Computer. Where Does Cycles Fit?

A Grok Bot routine starts at 8:00 AM while its owner is away. It signs in to a CRM, researches a list of accounts, updates records, hands part of the job to another Bot, and leaves a set of messages ready to send. The workflow is useful precisely because nobody has to supervise every step.

That is also why its control boundary matters.

[SpaceXAI introduced Grok Bot](https://x.ai/news/introducing-grok-bot) in early beta on August 11, 2026, positioning it as a team of always-on agents. [Grok Bot](https://docs.x.ai/grok-bot/overview) is not just another chat surface. Each user gets a persistent cloud computer with a browser, filesystem, and terminal. That computer keeps sessions and files across turns, supports connectors and MCP, and remains available when the user's laptop is closed. Multiple Bots can collaborate and run in parallel.

The important governance question is no longer only, "What can the model say?" It is, "What may this persistent system do next, given everything it has already done?"

Cycles applies to that question—but only when it sits on the path to the consequential action. This post explains the useful integration points, the places Cycles cannot reach, and a practical pattern for combining Grok Bot's native controls with deterministic runtime authority.

<!-- more -->

## What Grok Bot Changes

Three properties make Grok Bot materially different from a one-shot assistant.

First, it has durable execution state. The [cloud computer](https://docs.x.ai/grok-bot/computer-and-apps) keeps browser sessions, files, and command-line credentials. Work can continue after the desktop client closes.

Second, the security boundary is the user, not the Bot. All Bots belonging to one user share the same computer, app logins, files, and command-line credentials. Separate Bot names create useful work identities, but they do not create separate credential or compute boundaries.

Third, successful work can become unattended work. Grok Bot [skills and routines](https://docs.x.ai/grok-bot/skills-routines-and-automations) turn a demonstrated or described process into a scheduled or event-triggered workflow. The docs correctly warn that even a test run can perform real actions.

Together, those properties create a familiar agent-operations shape:

```text
persistent credentials
  + background routines
  + multiple collaborating agents
  + browser and terminal access
  = authority that accumulates while the user is away
```

This does not make Grok Bot unsafe. It makes the product operational rather than conversational—and operational systems need controls that survive retries, handoffs, concurrency, and long-running state.

## Grok Bot Already Has Important Controls

Any useful integration starts by respecting the controls the product already provides.

Grok Bot supports explicit approval boundaries, one-time allow or deny decisions, secure handoff for credentials, local-computer execution policies, connector policy, network egress controls, and an organization-wide off switch. Its [Auto Review](https://docs.x.ai/grok-bot/approvals-security-and-privacy) feature can evaluate tool calls and computer actions before they run. The documentation also recommends least privilege, read-only starting points, draft-first workflows, and approval for sending, purchasing, deleting, publishing, and production changes.

Those controls answer important questions:

- Does this proposed action look sensitive enough to require a person?
- May this user or team install this connector?
- Which destinations may the cloud computer reach?
- Is the Bot allowed to execute on the user's local machine?

Cycles answers a different question:

> Does this next authorized action still fit the cumulative budget assigned to this tenant, workflow, actor, and tool class?

Auto Review is model-based and action-local. Cycles is deterministic and cumulative. A review model can decide that each of ten refunds looks individually valid; Cycles can deny the eleventh refund because the workflow's caller-assigned exposure budget is exhausted. The layers complement each other.

## The Short Answer: Yes, at a Mandatory Boundary

Cycles can govern a Grok Bot action only if every path to that action passes through an enforcement point that calls Cycles before execution.

As of September 3, 2026, Cycles does not ship a Grok Bot-specific adapter. The useful implementation today is an architectural integration at a custom tool or service boundary.

| Grok Bot surface | Cycles fit | What is required |
|---|---|---|
| Custom MCP tool | Strong | Wrap the tool handler with reserve, execute, and settle |
| Internal API reached through the browser or terminal | Strong | Enforce inside the API or service, independent of how the Bot reached it |
| Built-in or catalog connector | Limited | The connector or destination service must expose an enforcement hook; a separate Cycles tool is not enough |
| Arbitrary third-party website | No direct interception | Use Grok Bot approvals, least-privilege accounts, egress policy, and the site's own controls |
| Grok Bot model or plan usage | No documented direct hook | Use the platform's usage allowance; Cycles cannot meter calls it cannot observe |

This distinction is load-bearing. Installing a Cycles MCP server beside an unwrapped `issue_refund` connector does not create hard enforcement. The Bot can still call the other connector directly. The refund handler—or the refund API behind it—must make a successful Cycles reservation a precondition for the side effect.

The same limitation appears with browser actions. Grok Bot can click through a site that has no clean API. Cycles does not see those clicks merely because both products are installed. If the site is yours, put the gate in its mutation endpoint. If the site is not yours, the enforceable controls remain Grok Bot's approvals and Auto Review, the permissions of the signed-in account, network policy, and controls provided by the site.

## The Cleanest Integration: A Cycles-Gated MCP Server

Grok supports [custom MCP connectors](https://docs.x.ai/grok/connectors), and Grok Bot can use connectors where available. That creates a clean controlled path for internal tools.

```text
Grok Bot
   │ proposes refund_customer or publish_campaign
   ▼
Your custom MCP server
   ├── authenticate the connector principal
   ├── authorize the tool and arguments
   ├── reserve budget or RISK_POINTS in Cycles
   └── call the downstream service only after ALLOW
              │
              ├── commit best-known actual exposure after dispatch
              └── release only when execution never started
```

The MCP server remains responsible for authentication and normal application authorization. Cycles does not infer whether a refund recipient is legitimate, whether a production change has the required ticket, or whether the signed-in member may use the tool. It meters the exposure the caller assigns and rejects work that does not fit a configured budget.

A framework-neutral handler has this shape:

```text
authorize(principal, tool, arguments)

reservation = cycles.reserve(
  subject = {
    tenant:   organization_id,
    workspace: member_or_credential_boundary,
    app:      "grok-bot",
    workflow: verified_routine_id_or_interactive,
    agent:    verified_bot_id_or_member_shared,
    toolset:  "customer-refunds"
  },
  action = { kind: "tool.refund", name: "refund_customer" },
  estimate = { unit: "RISK_POINTS", amount: 50 },
  idempotency_key = stable_tool_call_id
)

if reservation is denied:
  return a bounded tool error; do not call the provider

try:
  result = execute_downstream_action()
  cycles.commit(reservation, best_known_actual)
  return result
catch before dispatch:
  cycles.release(reservation)
catch after dispatch or when outcome is unknown:
  cycles.commit(reservation, best_known_actual)
  reconcile asynchronously
```

The settlement rule matters for scheduled and event-triggered routines because retries are normal. Reuse a stable idempotency key for the same logical attempt. Release only when the downstream action definitely did not start. If a timeout makes the outcome ambiguous, committing the best-known actual exposure is safer than returning authority that may already have been consumed. The full lifecycle is covered in [How Reserve → Commit Works](/protocol/how-reserve-commit-works-in-cycles).

## Scope for the Real Security Boundary

Grok Bot's shared-computer model changes how Cycles subjects should be assigned.

| Cycles subject | Suggested Grok Bot mapping |
|---|---|
| `tenant` | Organization or customer account |
| `workspace` | Member, service account, or credential boundary |
| `app` | `grok-bot` |
| `workflow` | Verified routine ID, event workflow, or `interactive` |
| `agent` | Verified Bot ID when the connector receives one; otherwise a shared member-level value |
| `toolset` | Consequence class such as `email`, `refunds`, `publishing`, or `production` |

Do not manufacture Bot-level isolation from a name in natural-language context. Grok Bot's enterprise documentation says Bots normally act as the signed-in member and do not have separately provisioned machine identities. If the connector cannot authenticate a stable Bot or routine identifier, enforce at the member or service-account boundary and keep any Bot name as attribution metadata rather than a trusted security principal.

This is the practical consequence of [Agent Identity Is Not User Identity](/blog/agent-identity-is-not-user-identity): useful attribution and enforceable identity are not automatically the same thing. A future verified Bot identity can narrow budgets further. Until then, the budget scope should match the identity the server can actually trust.

## What to Budget

Use separate ledgers for money and consequence.

- `USD_MICROCENTS` can bound paid downstream API usage that passes through your MCP server or internal service.
- `TOKENS` can bound token-denominated calls made by an instrumented tool, but not Grok Bot's platform-internal model calls.
- `RISK_POINTS` can meter caller-assigned action exposure: for example 5 points for a CRM note, 20 for an external email, 50 for a refund, and 100 for a production change.

Those numbers are illustrative. Cycles does not classify the tool or inspect the arguments. Your application defines the schedule, authorizes the operation, and submits the estimate. A useful schedule can also scale with the action: a $20 refund and a $2,000 refund need not consume the same amount of authority.

The most useful budgets mirror how Grok Bot actually runs:

- Per routine, to stop a background job after bounded cumulative work
- Per member or credential boundary, because Bots share access there
- Per toolset, so research does not consume the same authority as publishing or refunds
- Per tenant, to contain a workflow that touches multiple customers
- Per time window, to bound unattended daily or weekly exposure

These budgets do not replace a human approval rule. A production deployment can require approval *and* consume 100 risk points. One control answers whether the person approved this action; the other answers whether the cumulative allowance still exists.

## Worked Example: A Paid-Media Budget Change

Paid media makes the boundary concrete. xAI's [Grok Bot use-case guide](https://docs.x.ai/grok-bot/use-cases) recommends a draft-first workflow: gather performance data, produce recommendations, and require approval before changing campaigns. Keep that approval. Then place the mutation behind one custom MCP tool, such as `apply_campaign_daily_budget`.

Suppose the Bot proposes raising a campaign from $800 to $950 per day. The execution path is:

1. Grok Bot researches performance and drafts the change.
2. A person approves the consequential tool call through Grok Bot.
3. The gateway authenticates the connector, authorizes the configured ad account, and reads the current $800 budget directly from the provider. It does not trust a model-supplied current value.
4. The gateway computes 35 `RISK_POINTS`—a 25-point base plus 5 points for each started $100 of change—and reserves them against the member, routine, and paid-media toolset.
5. Only after `ALLOW` does it call the provider. The write carries the stable operation ID, the Cycles reservation ID, and the expected $800 current value. A concurrent change causes the provider to reject the mutation instead of applying authority calculated from stale state.
6. The gateway commits after a confirmed write. If the provider times out after dispatch, it conservatively commits and queues reconciliation rather than releasing authority that may have been used.

The result is deliberately layered. Grok Bot records the proposal and approval; the gateway records the authenticated principal, arguments, and downstream request; Cycles records the scoped reservation and settlement. A shared operation ID and reservation ID join those records without pretending that Cycles itself verified the campaign's business rationale.

::: tip Runnable reference
The [`cycles-mcp-server` Grok Bot paid-media gateway](https://github.com/runcycles/cycles-mcp-server/tree/main/examples/grok-bot-paid-media-gateway) includes the MCP tool, authenticated HTTP transport, mock paid-media API, fail-closed settlement behavior, and tests. Deploy it behind HTTPS, add the `/mcp` endpoint as a [custom connector](https://docs.x.ai/grok/connectors), and replace the demo token with OAuth or an identity-aware gateway before production use.
:::

## A Three-Layer Decision

For a consequential custom tool, execution should require all three layers to agree:

```text
1. Grok Bot control
   Auto Review / explicit approval / team policy

2. Application authorization
   Is this principal allowed to invoke this tool with these arguments?

3. Cycles runtime authority
   Does this action still fit the scoped cumulative budget?
```

A denial at any layer stops the action. This is stronger than asking one system to imitate all three jobs.

It also produces cleaner incident response. Grok Bot's action history can show what the Bot attempted and what a person approved. The application log can show which principal and arguments were authorized. Cycles can show which scoped ledger admitted or denied the action and how much cumulative authority remained. Carry one operation ID through all three layers, add the Cycles reservation ID to the downstream request, and retain the provider's request ID for reconciliation.

## Start With One Boundary

The first useful rollout does not require instrumenting every click.

1. Choose one consequential internal tool, such as `send_customer_email` or `issue_refund`.
2. Expose it through an authenticated custom MCP server, or enforce inside its existing API.
3. Keep Grok Bot's approval rule for the action.
4. Run Cycles reservations with `dry_run: true` in shadow mode to calibrate subject mapping and estimates.
5. Make live reservation mandatory before dispatch.
6. Test duplicate events, ambiguous timeouts, handoffs, and parallel routine runs.
7. Add a budget freeze or downstream kill switch to the incident runbook.

Then expand by consequence class, not by raw click count. The goal is not to price every scroll and screenshot. The goal is to place deterministic gates in front of the actions that create cost, external communication, financial movement, data mutation, or production impact.

## The Takeaway

Grok Bot gives an agent continuity: a persistent computer, persistent sessions, collaboration, and routines that continue without a laptop open. Its native approval, Auto Review, connector, identity, and network controls are the first layer of a responsible deployment.

Cycles adds something different where you control the execution boundary: a durable, scoped memory of how much authority has already been consumed, checked before the next action runs.

That makes Cycles a strong fit for Grok Bot's custom MCP tools and protected internal APIs. It is not a native switch for every browser click, built-in connector, or hidden model call. The integration works when the gate is mandatory, the identity scope is honest, and the downstream action cannot bypass it.

A persistent agent can keep working. Runtime authority decides when it must stop.

## Sources and Related Reading

- [Introducing Grok Bot](https://x.ai/news/introducing-grok-bot) — launch positioning, early-beta status, and example workflows
- [Grok Bot overview](https://docs.x.ai/grok-bot/overview) — persistent computers, collaboration, shared state, and routines
- [Grok Bot use cases](https://docs.x.ai/grok-bot/use-cases) — paid-media research, draft-first recommendations, and approval before campaign changes
- [Use the computer and apps](https://docs.x.ai/grok-bot/computer-and-apps) — shared sessions, files, credentials, and connectors
- [Skills and routines](https://docs.x.ai/grok-bot/skills-routines-and-automations) — scheduled work, real test runs, and recommended approval boundaries
- [Approvals, security, and privacy](https://docs.x.ai/grok-bot/approvals-security-and-privacy) — Auto Review, local execution, least privilege, and shared-computer security
- [Grok Bot for teams and enterprises](https://docs.x.ai/grok-bot/teams-and-enterprises) — architecture, identity, MCP policy, network controls, and action recording
- [Grok connectors](https://docs.x.ai/grok/connectors) — custom MCP connector support and authentication
- [Custom MCP tunneling](https://docs.x.ai/grok/connectors/custom-mcp-tunneling) — exposing a local MCP server for temporary connector evaluation
- [Add Hard Budgets to MCP Tools Before They Execute](/blog/mcp-tool-budgets-before-execution) — the complete Cycles MCP wrapper pattern
- [Computer-Use Agents Have No Tool Boundary](/blog/computer-use-agents-have-no-tool-boundary) — why arbitrary browser clicks need target, intent, and context outside Cycles' current schema
- [How Cycles Meters Caller-Assigned Action Exposure](/blog/beyond-budget-how-cycles-controls-agent-actions) — what `RISK_POINTS` do and do not enforce
