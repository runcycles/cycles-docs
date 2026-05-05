---
title: "Add Hard Per-Run Budgets to MCP Tools Before They Execute"
date: 2026-05-05
author: Albert Mavashev
tags:
  - MCP
  - typescript
  - budget-control
  - runtime-authority
  - architecture
description: "MCP makes tools easy to expose. It does not decide whether the next call should still run. A reserve / execute / commit wrapper around every MCP tool call gives agents per-run, per-tenant budget enforcement before the side effect happens."
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

Cycles closes that loop with a `reserve → execute → commit` wrapper around every MCP tool. The wrapper asks before each call: *given everything this agent has already done, should this one still run?* If the answer is `DENY`, the tool never executes. If the answer is `ALLOW`, the tool runs and actual usage is committed back. If the tool throws, the reservation is released so the budget isn't double-charged.

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

`reserve` is the gate. It returns a reservation ID and a decision. `commit` records what the tool actually used (cost in microcents, tokens, action count, whatever you're tracking) — usually less than the estimate. `release` returns unused budget to the tenant when the tool throws or is cancelled.

The MCP server itself doesn't change. The wrapper sits between the MCP transport (STDIO, HTTP, whatever) and the tool's handler. Every approved tool gets the same treatment: same `reserve` call shape, same metadata, same release-on-error behavior.

## The policy this enforces

Three categories of cap make sense for almost every agent product:

| Category | Example caps | What it stops |
|---|---|---|
| **Spend** | `$1.00 per run`, `$50 per tenant per day` | Runaway LLM completions, fan-out across paid APIs |
| **Action count** | `max 20 llm.completion`, `max 5 web.search`, `max 2 message.email.send` | Retry storms; "the 12th call" pattern |
| **Risk class** | `deny code.exec.shell`, `deny deploy.service` unless explicitly allowlisted | Catastrophic side effects from a bad plan |

You don't need all three on day one. Pick one tenant, one workflow, one risky action kind, one small budget. See [Evaluate Cycles for multi-tenant AI agents](/how-to/evaluate-cycles-for-agent-saas) for the fit checklist and 15-minute local test.

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
  runId: string            // a stable ID per agent run / conversation
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
  // and doesn't double-charge. (tenant + run + tool + action) is usually
  // enough; add a sequence number if the agent fires the same tool twice
  // in a single run.
  const idempotencyKey = `${ctx.tenantId}:${ctx.runId}:${ctx.toolName}:${ctx.actionKind}`

  const response = await client.createReservation({
    idempotency_key: idempotencyKey,
    subject: { tenant: ctx.tenantId, workspace: ctx.workspace, app: 'mcp' },
    action: { kind: ctx.actionKind, name: ctx.toolName },
    estimate: { unit: Unit.USD_MICROCENTS, amount: ctx.estimateMicrocents },
    ttl_ms: 60_000,
    metadata: { run_id: ctx.runId },
  })

  // Insufficient budget on a non-dry-run reservation surfaces as HTTP 409,
  // not decision=DENY. Treat any non-success as a denial the agent must
  // handle — winding down, downgrading, or stopping. Do NOT silently retry.
  if (!response.isSuccess) {
    throw new DeniedByCyclesError(
      `Cycles denied ${ctx.actionKind} for ${ctx.toolName}: ${response.errorMessage}`,
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
    await client.releaseReservation(reservationId, {
      idempotency_key: `release:${idempotencyKey}`,
      reason: err instanceof Error ? err.message : 'tool execution failed',
    }).catch(() => {})
    throw err
  }
}
```

Wrapping an MCP tool handler is then a one-liner per tool:

```typescript
server.tool('send_email', emailSchema, async (args) => {
  return gatedToolCall(
    {
      tenantId: args._meta.tenantId,
      workspace: args._meta.workspace ?? 'production',
      runId: args._meta.runId,
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
- [Evaluate Cycles for multi-tenant AI agents](/how-to/evaluate-cycles-for-agent-saas) — fit checklist, anti-patterns, 15-minute local test.

## Send me your MCP/tool-call flow

If you're wiring this into a real product and want a sanity check before you ship, paste the rough shape of your agent's tool-call flow — `agent → tool → API → side effect` — to [Contact Us](/contact) with the subject **"agent flow review."** I'll mark where `reserve`, `commit`, and `release` belong, or tell you if Cycles isn't the right fit. Honest answers, not sales calls.
