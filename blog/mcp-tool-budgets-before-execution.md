---
title: "Add Hard Per-Run Budgets to MCP Tools Before They Execute"
date: 2026-05-06
author: Albert Mavashev
tags:
  - MCP
  - typescript
  - budget-control
  - runtime-authority
  - architecture
description: "MCP makes tools easy to expose, but it does not decide whether the next call should still run. Add a reserve / execute / commit wrapper around MCP tools to enforce tenant and run budgets before side effects happen."
blog: true
sidebar: false
featured: false
head:
  - - meta
    - name: keywords
      content: MCP budget control, MCP tool guardrails, Model Context Protocol, agent budget enforcement, runtime authority, reserve commit, AI agent cost control
---

# Add Hard Per-Run Budgets to MCP Tools Before They Execute

The Model Context Protocol makes it easy to expose a tool to an agent. Decide on a name, describe the inputs, ship the server, and the agent can call it.

What MCP does not do is decide whether *this specific call*, right now, should still happen.

The first call is fine. The second is fine. The twelfth is the problem — the agent is in a retry loop, fan-out has multiplied the request count, the tenant's budget is gone, and the next `send_email` or `web_search` or `refund.issue` is about to fire anyway. Tracing tells you what happened. The dashboard updates after the fact. Neither stops the call.

Cycles closes that loop with a `reserve → execute → commit` wrapper around every MCP tool. The wrapper asks before each call: *given everything this agent has already done, should this one still run?* If Cycles denies or rejects the reservation, the tool never executes. If the reservation is allowed, the tool runs and actual usage is committed back. If the tool throws, the reservation is released so the budget isn't double-charged.

This post shows the pattern, the policy it enforces, and the TypeScript code that implements it.

## The pattern

Every MCP tool call passes through three states:

```text
Agent proposes a tool call
  ↓
reserve(tenant, run, tool, estimate)  →  ALLOW | DENY
  ↓ (if ALLOW)
tool executes
  ↓
commit(reservation_id, actual_usage)   on success
release(reservation_id)                on failure
```

`reserve` is the gate. It returns a reservation ID and a decision. `commit` records what the tool actually consumed in the reserved unit — for example microcents, tokens, credits, or risk points — usually less than the estimate. (Action-count quotas, when enabled through the v0.1.26 action-governance preview, are enforced at reservation time from the action kind, not at commit.) `release` returns unused budget to the tenant when the tool throws or is cancelled.

If you want a lower-overhead preflight that doesn't lock budget, swap `client.createReservation` for `client.decide` — similar decision shape, no reservation written. Use it for "should the agent even propose this tool?" checks; use `reserve` for hard enforcement before execution. The wrapper below uses `reserve` because the goal is to block calls that shouldn't happen, not to predict them.

The MCP server itself doesn't change. The wrapper sits between the MCP transport (STDIO, HTTP, whatever) and the tool's handler. Every approved tool gets the same treatment: same `reserve` call shape, same metadata, same release-on-error behavior.

## The policy this enforces

Start with spend. That's the stable v0.1.25 baseline and the path most teams should evaluate first:

| Category | Example caps | What it stops |
|---|---|---|
| **Spend** | `$1.00 per run`, `$50 per tenant per day` | Runaway LLM completions, fan-out across paid APIs |

If you're evaluating the v0.1.26 action-governance preview, the same wrapper can also carry action kinds for two more categories:

| Preview category | Example caps | What it stops |
|---|---|---|
| **Action count** | `max 20 llm.completion`, `max 5 web.search`, `max 2 message.email.send` | Retry storms; "the 12th call" pattern |
| **Risk class / allow-deny** | `deny code.exec.shell`, `deny deploy.service` unless explicitly allowlisted | Catastrophic side effects from a bad plan |

You don't need any of the preview categories on day one. Pick one tenant, one workflow, one risky action kind, and one small spend budget. After that path works, layer on a quota or allow-deny rule if you're tracking the preview. See [Evaluate Cycles for multi-tenant AI agents](/how-to/evaluate-cycles-for-agent-saas) for the fit checklist and 15-minute local test.

The wrapper code below stays the same regardless of which category you enforce — Cycles handles the policy resolution server-side. You just pass tenant, run, tool, action kind, and an estimate.

## The TypeScript wrapper

This is a complete, framework-neutral wrapper using the [`runcycles`](https://www.npmjs.com/package/runcycles) TypeScript client. Drop it around any MCP tool handler and the call is gated.

```typescript
import { CyclesClient, CyclesConfig, Unit } from 'runcycles'

const client = new CyclesClient(new CyclesConfig({
  baseUrl: process.env.CYCLES_BASE_URL!,    // http://localhost:7878 in dev
  apiKey: process.env.CYCLES_API_KEY!,
}))

interface ToolContext {
  tenantId: string         // your customer's tenant in Cycles
  workspace: string        // e.g. 'production', 'staging'
  app: string              // e.g. 'mcp', 'web-agent', 'support-bot'
  runId: string            // a stable ID per agent run / conversation
  toolCallId: string       // stable per proposed MCP tool call within a run;
                           // distinguishes a legitimate second send_email from
                           // a network retry of the first one
  toolName: string         // 'send_email', 'web_search', etc.
  actionKind: string       // 'message.email.send', 'web.search', 'llm.completion', ...
  estimateMicrocents: number
}

export class DeniedByCyclesError extends Error {
  constructor(message: string) { super(message); this.name = 'DeniedByCyclesError' }
}

export async function gatedToolCall<T>(
  ctx: ToolContext,
  execute: () => Promise<{ result: T; actualMicrocents: number }>,
): Promise<T> {
  // Stable idempotency key so a network retry hits the same reservation
  // and doesn't double-charge — but a legitimately different tool call
  // gets a distinct key. The toolCallId is what distinguishes the two:
  // pass the same ID across retries of one MCP call, a different ID for
  // the next call.
  const idempotencyKey = [
    ctx.tenantId,
    ctx.runId,
    ctx.toolCallId,
    ctx.toolName,
    ctx.actionKind,
  ].join(':')

  const response = await client.createReservation({
    idempotency_key: idempotencyKey,
    subject: { tenant: ctx.tenantId, workspace: ctx.workspace, app: ctx.app },
    action: { kind: ctx.actionKind, name: ctx.toolName },
    estimate: { unit: Unit.USD_MICROCENTS, amount: ctx.estimateMicrocents },
    ttl_ms: 60_000,
    // Cycles' formal scope hierarchy is tenant -> workspace -> app -> workflow
    // -> agent -> toolset; runs don't have a dedicated slot, so we put runId
    // in metadata for dashboard filtering and audit. If you enable v0.1.26
    // per-run action quotas, pass run_id through the formal subject dimensions
    // expected by your v0.1.26 server/client surface — metadata alone is not
    // enough to drive quota evaluation.
    metadata: {
      run_id: ctx.runId,
      tool_call_id: ctx.toolCallId,
      tool_name: ctx.toolName,
    },
  })

  // Insufficient budget on a non-dry-run reservation surfaces as HTTP 409,
  // not decision=DENY. Treat any non-success as a denial the agent must
  // handle — winding down, downgrading, or stopping. Do NOT silently retry.
  if (!response.isSuccess) {
    // Wrap the server message rather than passing it through verbatim — server
    // errors can carry policy IDs or internal field names you may not want in
    // a customer-facing response. Log response.errorMessage server-side instead.
    throw new DeniedByCyclesError(
      `Cycles denied ${ctx.actionKind} for ${ctx.toolName}.`,
    )
  }

  const reservationId = response.getBodyAttribute('reservation_id') as string

  try {
    const { result, actualMicrocents } = await execute()
    await client.commitReservation(reservationId, {
      idempotency_key: `commit:${idempotencyKey}`,
      actual: { unit: Unit.USD_MICROCENTS, amount: actualMicrocents },
    })
    return result
  } catch (err) {
    // Tool threw or was cancelled — give the budget back so the next
    // legitimate call isn't denied because of a failed attempt.
    try {
      await client.releaseReservation(reservationId, {
        idempotency_key: `release:${idempotencyKey}`,
        reason: err instanceof Error ? err.message : 'tool execution failed',
      })
    } catch {
      // Don't mask the original tool error. Log release failures in production.
    }
    throw err
  }
}
```

Wrapping an MCP tool handler is then a one-liner per tool:

```typescript
import { randomUUID } from 'node:crypto'

server.tool('send_email', emailSchema, async (args) => {
  // Real MCP tool calls may have _meta undefined or missing fields —
  // validate before trusting it in production.
  const meta = args._meta
  if (!meta?.tenantId || !meta?.runId) {
    throw new Error('send_email requires _meta.tenantId and _meta.runId')
  }

  return gatedToolCall(
    {
      tenantId: meta.tenantId,
      workspace: meta.workspace ?? 'production',
      app: 'mcp',
      runId: meta.runId,
      toolCallId: meta.toolCallId ?? randomUUID(),
      toolName: 'send_email',
      actionKind: 'message.email.send',
      estimateMicrocents: 50_000,  // ~$0.0005 baseline
    },
    async () => {
      const sent = await sendEmail(args)
      return { result: sent, actualMicrocents: 50_000 }
    },
  )
})
```

For production, prefer a stable tool-call ID from your agent runtime or MCP transport over `randomUUID()`. The ID should stay the same across network retries of the same MCP call, but be different for distinct tool calls inside the same run — that's exactly what makes idempotency safe under retry without collapsing two legitimate calls.

A few things this wrapper does deliberately:

- **Idempotency keys** are derived, not random. A retried network call hits the same reservation and doesn't double-charge. Commit and release each get their own derived key off the same base.
- **Denials throw `DeniedByCyclesError`**, not silent fallthroughs. The agent has to handle them — by stopping, downgrading, or asking for more budget.
- **Release on any throw**, including cancellations. Unused budget goes back to the tenant.
- **Metadata travels with every call**: tenant, workspace, run, tool, action kind. That's what the dashboard groups by, and what your future audit query will join on.

## Why this matters

An MCP gateway answers *can this tool be reached?* — authentication, allowlisting, transport. That's a real control. It is not the same question as *should this specific call still run?*

The first question is about access. The second is about [exposure](/glossary#exposure) — the cumulative cost, action count, or blast radius the agent has already accumulated. Two questions, two layers. A gateway without runtime authority is a pass/fail access system; the 201st email goes through if the tool is allowed at all. Runtime authority without a gateway has to trust the tool inventory.

Most production incidents we see are not unknown tools. They are approved tools called too many times, in the wrong scope, after the budget should have run out. That's exactly the gap a per-run budget closes.

For the architecture-side detail of where this sits relative to gateways and authorization, see [MCP Gateways Are Not Runtime Authority](/blog/mcp-gateways-are-not-runtime-authority).

## Try it

```bash
npm install @runcycles/mcp-server
npm install runcycles
```

Then bring up the local stack so you can watch denials happen in the dashboard while you wire this up:

- [Deploying the Full Cycles Stack](/quickstart/deploying-the-full-cycles-stack) — runtime server, admin server, dashboard, in one `docker-compose up`.
- [Integrating Cycles with MCP](/how-to/integrating-cycles-with-mcp) — the implementation deep-dive: patterns, resources, prompts, transport options.
- [Evaluate Cycles for multi-tenant AI agents](/how-to/evaluate-cycles-for-agent-saas) — fit checklist, non-fit cases, 15-minute local test.

## Send me your MCP/tool-call flow

If you're wiring this into a real product and want a sanity check before you ship, paste the rough shape of your agent's tool-call flow — `agent → tool → API → side effect` — to [Contact Us](/contact) with the subject **"agent flow review."** I'll mark where `reserve`, `commit`, and `release` belong, or tell you if Cycles isn't the right fit. Honest answers, not sales calls.
