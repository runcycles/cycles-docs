---
title: "Add Hard Budgets to MCP Tools Before They Execute"
date: 2026-05-05
author: Albert Mavashev
tags:
  - MCP
  - typescript
  - budget-control
  - runtime-authority
  - architecture
description: "MCP exposes tools, but it does not decide whether the next call should run. Wrap MCP handlers with Cycles reserve/commit checks before side effects happen."
blog: true
sidebar: false
featured: false
head:
  - - meta
    - name: keywords
      content: MCP budget control, MCP tool guardrails, Model Context Protocol, agent budget enforcement, runtime authority, reserve commit, AI agent cost control
---

# Add Hard Budgets to MCP Tools Before They Execute

The Model Context Protocol makes it easy to expose a tool to an agent. Decide on a name, describe the inputs, ship the server, and the agent can call it.

What MCP does not do is decide whether *this specific call*, right now, should still happen.

The first call is fine. The second is fine. The twelfth is the problem — the agent is in a retry loop, fan-out has multiplied the request count, the tenant's budget is gone, and the next `send_email` or `web_search` or `refund.issue` is about to fire anyway. Tracing tells you what happened. The dashboard updates after the fact. Neither stops the call.

Cycles closes that loop with a `reserve → execute → settle` wrapper around every MCP tool. The wrapper asks before each call: *given everything this agent has already done, should this one still run?* If Cycles rejects the reservation, the tool never executes. If the reservation is allowed, the tool runs and best-known actual usage is committed, including usage from a partial failure. A reservation is released only when execution never starts or usage is demonstrably zero.

This post shows the pattern, the policy it enforces, and the TypeScript code that implements it.

<!-- more -->

## The pattern

Every MCP tool call passes through three states:

```text
Agent proposes a tool call
  ↓
reserve(subject, action, estimate)  →  ALLOW | ALLOW_WITH_CAPS | error
  ↓ (if allowed, with caps applied)
tool executes
  ↓
commit(reservation_id, actual_usage)   after execution starts
release(reservation_id)                only if skipped or zero usage
```

`reserve` is the gate. It returns a reservation ID and a decision. For a non-dry-run reservation, insufficient budget is an HTTP error such as `409 BUDGET_EXCEEDED`; a successful response can be `ALLOW` or `ALLOW_WITH_CAPS`. `commit` records what the tool actually consumed in the reserved unit — for example microcents, tokens, credits, or risk points — whether the tool succeeded or failed after consuming usage. `release` returns the reservation only when execution was skipped, cancelled before it began, or demonstrably consumed zero usage. [How Reserve-Commit Works](/protocol/how-reserve-commit-works-in-cycles) covers the lifecycle and failure boundaries in detail.

If you want a lower-overhead preflight that doesn't lock budget, swap `client.createReservation` for `client.decide` — similar decision shape, no reservation written. Use it for "should the agent even propose this tool?" checks; use `reserve` for hard enforcement before execution. The wrapper below uses `reserve` because the goal is to block calls that shouldn't happen, not to predict them.

The MCP protocol and transport don't change. The wrapper sits between the MCP transport (STDIO or HTTP) and the tool's handler — only the handler code is wrapped. Every approved tool gets the same `reserve` call shape, metadata, and explicit settlement based on whether execution started. Stable operation keys provide the retry behavior described in [Idempotency, Retries, and Concurrency](/concepts/idempotency-retries-and-concurrency-why-cycles-is-built-for-real-failure-modes).

## The policy this enforces

Start with spend. That's the stable v0.1.25 baseline and the path most teams should evaluate first:

| Category | Example caps | What it stops |
|---|---|---|
| **Spend** | `$1.00 per run` where `dimensions.run` is enforced, `$50 per tenant per day` | Runaway LLM completions, fan-out across paid APIs |

Two more categories will be available once the v0.1.26 action-governance extensions ship in `cycles-server`. The spec is published and SHOULD-level for protocol conformance today, but the runtime enforcement is **not yet implemented in runcycles' servers** — these are illustrative for what's coming, not testable yet:

| Upcoming category | Example caps | What it stops |
|---|---|---|
| **Action count** | `max 20 llm.completion`, `max 5 web.search`, `max 2 message.email.send` | Retry storms; "the 12th call" pattern |
| **Risk class / allow-deny** | `deny code.exec.shell`, `deny deploy.service` unless explicitly allowlisted | Catastrophic side effects from a bad plan |

The action-kind slugs above (`message.email.send`, `web.search`, `code.exec.shell`, `deploy.service`) are illustrative — the formal v0.1.26 action-kind registry is upcoming, and only `llm.completion` is currently used as a documented action kind across shipped guides. Treat your own slugs as a convention until the registry lands.

Stick with spend on day one. Pick one tenant, one workflow, one risky action kind, and one small spend budget. If you want run-level spend budgets, model the run as `subject.dimensions.run` and verify your Cycles deployment derives budget scope from that custom dimension; the base protocol requires custom dimensions to be accepted and round-tripped, but v0 implementations may ignore them for budget decisions. Once `cycles-server` ships the v0.1.26 enforcement, layer on a quota or allow-deny rule. See [Evaluate Cycles for multi-tenant AI agents](/how-to/evaluate-cycles-for-agent-saas) for the fit checklist and 15-minute local test.

The reserve and settlement wrapper can keep the same shape if the future governance categories ship, while policy resolution remains server-side. Today, use it with shipped budget units and caller-supplied context. The [MCP integration guide](/how-to/integrating-cycles-with-mcp) covers the cooperative standalone-server pattern and the separate hard-enforcement boundary.

## The TypeScript wrapper

This framework-neutral control-flow template uses the [`runcycles`](https://www.npmjs.com/package/runcycles) TypeScript client. The client intentionally returns raw wire responses, so the wrapper validates the fields it relies on. Supply a durable settlement store whose startup worker replays pending records; an in-memory queue is not sufficient across process crashes.

```typescript
import { createHash } from 'node:crypto'
import { CyclesClient, CyclesConfig, Unit } from 'runcycles'

const client = new CyclesClient(new CyclesConfig({
  baseUrl: process.env.CYCLES_BASE_URL!,    // http://localhost:7878 in dev
  apiKey: process.env.CYCLES_API_KEY!,
}))

interface ToolContext {
  tenantId: string         // your customer's tenant in Cycles
  workspace: string        // e.g. 'production', 'staging'
  app: string              // e.g. 'mcp', 'web-agent', 'support-bot'
  workflow?: string        // optional — workflow-level budget scope (e.g.
                           // 'support-triage', 'invoice-processing'). Required
                           // if you cap budgets at the workflow level.
  toolsetName: string      // category of tool, e.g. 'email', 'refund', 'search'
                           // — matches subject.toolset in the formal scope hierarchy.
                           // Multiple tools share one toolset; do not pass per-tool slugs.
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

export class UnsettledReservationError extends Error {
  constructor(message: string) { super(message); this.name = 'UnsettledReservationError' }
}

type CyclesDecision = {
  decision: 'ALLOW' | 'ALLOW_WITH_CAPS'
  caps?: Record<string, unknown>
}

type PendingSettlement = {
  key: string
  kind: 'hold' | 'commit' | 'release'
  reservationId: string
  subject: Record<string, unknown>
  action: Record<string, unknown>
  operationKey?: string
  actualMicrocents?: number
  reason?: string
}

// Implement this with a durable database or queue. On startup, replay commit
// and release records with their original idempotency keys. Never convert an
// ambiguous commit into a release.
declare const settlementStore: {
  put(record: PendingSettlement): Promise<void>
  remove(key: string): Promise<void>
}

type ToolAttempt<T> =
  | { status: 'succeeded'; result: T; actualMicrocents: number }
  | { status: 'failed'; error: unknown; actualMicrocents: number }
  | { status: 'skipped'; error: unknown }

export async function gatedToolCall<T>(
  ctx: ToolContext,
  execute: (cycles: CyclesDecision) => Promise<ToolAttempt<T>>,
): Promise<T> {
  // Stable idempotency key so a network retry hits the same reservation
  // and doesn't double-charge — but a legitimately different tool call
  // gets a distinct key. The toolCallId is what distinguishes the two:
  // pass the same ID across retries of one MCP call, a different ID for
  // the next call.
  const idempotencyKey = `mcp_${createHash('sha256')
    .update(JSON.stringify([
      ctx.tenantId,
      ctx.runId,
      ctx.toolCallId,
      ctx.toolName,
      ctx.actionKind,
    ]))
    .digest('hex')}`

  const subject = {
    tenant: ctx.tenantId,
    workspace: ctx.workspace,
    app: ctx.app,
    ...(ctx.workflow ? { workflow: ctx.workflow } : {}),
    toolset: ctx.toolsetName,
    // Run is not a standard subject field. Use dimensions.run only after
    // verifying your Cycles deployment derives budget scope from it.
    dimensions: { run: ctx.runId },
  }
  const action = { kind: ctx.actionKind, name: ctx.toolName }

  const response = await client.createReservation({
    idempotency_key: idempotencyKey,
    subject,
    action,
    estimate: { unit: Unit.USD_MICROCENTS, amount: ctx.estimateMicrocents },
    ttl_ms: 60_000,
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

  const reservationId = response.getBodyAttribute('reservation_id')
  const decision = response.getBodyAttribute('decision')
  const rawCaps = response.getBodyAttribute('caps')
  const affectedScopes = response.getBodyAttribute('affected_scopes')
  const reserveFields = new Set([
    'decision',
    'reservation_id',
    'reserved',
    'expires_at_ms',
    'scope_path',
    'affected_scopes',
    'caps',
    'balances',
    'reason_code',
    'retry_after_ms',
    'cycles_evidence',
  ])
  if (
    !response.body ||
    Object.keys(response.body).some((key) => !reserveFields.has(key)) ||
    typeof reservationId !== 'string' ||
    reservationId.length === 0 ||
    (decision !== 'ALLOW' && decision !== 'ALLOW_WITH_CAPS') ||
    !Array.isArray(affectedScopes) ||
    !affectedScopes.every((scope) => typeof scope === 'string') ||
    (decision === 'ALLOW' && rawCaps !== undefined) ||
    (decision === 'ALLOW_WITH_CAPS' && rawCaps === undefined)
  ) {
    throw new UnsettledReservationError(
      `Malformed successful reserve response (request ${response.requestId ?? 'unknown'}). ` +
      'Do not execute; retain the request for operator reconciliation.',
    )
  }

  const settlementKey = `settlement:${idempotencyKey}`
  await settlementStore.put({
    key: settlementKey,
    kind: 'hold',
    reservationId,
    subject,
    action,
  })
  // Validate the closed Caps schema only after durably recording the plausible
  // hold. If validation fails, the action remains blocked and the hold is
  // reconciled or expires; it is never treated as permission to execute.
  const caps = validateCaps(rawCaps)

  const commitKey = `commit:${idempotencyKey}`
  const commitActual = async (actualMicrocents: number): Promise<void> => {
    const pending: PendingSettlement = {
      key: settlementKey,
      kind: 'commit',
      reservationId,
      subject,
      action,
      operationKey: commitKey,
      actualMicrocents,
    }
    await settlementStore.put(pending)

    // A timeout can leave the outcome ambiguous. Retry the same commit key;
    // never release. The durable record remains until COMMITTED or APPLIED is
    // confirmed.
    let lastError: unknown
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const commitResponse = await client.commitReservation(reservationId, {
        idempotency_key: commitKey,
        actual: { unit: Unit.USD_MICROCENTS, amount: actualMicrocents },
      })
      if (
        commitResponse.isSuccess &&
        commitResponse.getBodyAttribute('status') === 'COMMITTED'
      ) {
        await settlementStore.remove(settlementKey)
        return
      }
      lastError = new Error(commitResponse.errorMessage ?? 'commit unconfirmed')

      const code = commitResponse.getErrorResponse()?.error
      if (
        code === 'RESERVATION_EXPIRED' ||
        code === 'RESERVATION_FINALIZED' ||
        code === 'NOT_FOUND'
      ) {
        const detail = await client.getReservation(reservationId)
        const status = detail.getBodyAttribute('status')
        if (detail.isSuccess && status === 'COMMITTED') {
          await settlementStore.remove(settlementKey)
          return
        }
        if (
          (detail.isSuccess && (status === 'RELEASED' || status === 'EXPIRED')) ||
          (!detail.isSuccess && detail.getErrorResponse()?.error === 'NOT_FOUND')
        ) {
          const eventResponse = await client.createEvent({
            idempotency_key: `event:${idempotencyKey}`,
            subject,
            action,
            actual: { unit: Unit.USD_MICROCENTS, amount: actualMicrocents },
            metadata: { reservation_id: reservationId, settlement_fallback: true },
          })
          if (
            eventResponse.isSuccess &&
            eventResponse.getBodyAttribute('status') === 'APPLIED'
          ) {
            await settlementStore.remove(settlementKey)
            return
          }
          lastError = new Error(eventResponse.errorMessage ?? 'usage event unconfirmed')
        }
      }
    }
    throw new UnsettledReservationError(
      `Settlement remains pending for ${reservationId}; the recovery worker must retry ` +
      `${commitKey}. Do not release it. Last error: ${String(lastError)}`,
    )
  }

  const releaseUnused = async (reason: string): Promise<void> => {
    const releaseKey = `release:${idempotencyKey}`
    await settlementStore.put({
      key: settlementKey,
      kind: 'release',
      reservationId,
      subject,
      action,
      operationKey: releaseKey,
      reason,
    })
    const releaseResponse = await client.releaseReservation(reservationId, {
      idempotency_key: releaseKey,
      reason,
    })
    if (
      !releaseResponse.isSuccess ||
      releaseResponse.getBodyAttribute('status') !== 'RELEASED'
    ) {
      throw new UnsettledReservationError(
        `Could not confirm release for ${reservationId}: ${releaseResponse.errorMessage}`,
      )
    }
    await settlementStore.remove(settlementKey)
  }

  let toolAttempt: ToolAttempt<T>
  try {
    toolAttempt = await execute({ decision, caps })
  } catch (err) {
    // The wrapper cannot tell whether an unexpectedly thrown handler consumed
    // usage. Keep the reservation for reconciliation instead of releasing it.
    throw new UnsettledReservationError(
      `Tool outcome is unknown for ${reservationId}; measure usage and commit it. ` +
      `Do not release this reservation. Handler error: ${String(err)}`,
    )
  }

  if (toolAttempt.status === 'skipped') {
    await releaseUnused('tool skipped before execution')
    throw toolAttempt.error
  }

  // Commit usage after every execution attempt, including failed attempts.
  await commitActual(toolAttempt.actualMicrocents)

  if (toolAttempt.status === 'failed') {
    throw toolAttempt.error
  }

  return toolAttempt.result
}

function validateCaps(value: unknown): Record<string, unknown> | undefined {
  if (value === undefined) return undefined
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new DeniedByCyclesError('Malformed caps in successful reserve response')
  }

  const caps = value as Record<string, unknown>
  const allowed = new Set([
    'max_tokens',
    'max_steps_remaining',
    'tool_allowlist',
    'tool_denylist',
    'cooldown_ms',
  ])
  for (const [key, cap] of Object.entries(caps)) {
    if (!allowed.has(key)) {
      throw new DeniedByCyclesError(`Unknown Cycles cap: ${key}`)
    }
    if (key === 'tool_allowlist' || key === 'tool_denylist') {
      if (
        !Array.isArray(cap) ||
        !cap.every((item) => typeof item === 'string' && item.length <= 256)
      ) {
        throw new DeniedByCyclesError(`Malformed Cycles cap: ${key}`)
      }
    } else if (typeof cap !== 'number' || !Number.isInteger(cap) || cap < 0) {
      throw new DeniedByCyclesError(`Malformed Cycles cap: ${key}`)
    }
  }
  return caps
}
```

Wrapping an MCP tool handler is then a one-liner per tool. **Note:** MCP's protocol-level `_meta` field is a free-form bag — there's no standard schema for `tenantId`, `runId`, etc. The example below assumes your agent runtime populates `_meta` with the four fields the wrapper needs. Plumbing them in is your responsibility; once they're there, the wrapper is the same everywhere.

```typescript
import { randomUUID } from 'node:crypto'

server.tool('send_email', emailSchema, async (args) => {
  // _meta is invented for this example. Validate before trusting it.
  // Production callers should populate it from the agent runtime (e.g. via
  // request-scoped context) and use a typed schema rather than ad-hoc fields.
  const meta = args._meta
  if (!meta?.tenantId || !meta?.runId) {
    throw new Error('send_email requires _meta.tenantId and _meta.runId')
  }

  return gatedToolCall(
    {
      tenantId: meta.tenantId,
      workspace: meta.workspace ?? 'production',
      app: 'mcp',
      workflow: meta.workflow,  // optional — set to enforce a workflow-level budget
      toolsetName: 'email',  // category — send_email and send_sms would share this
      runId: meta.runId,
      toolCallId: meta.toolCallId ?? randomUUID(),
      toolName: 'send_email',
      actionKind: 'message.email.send',  // illustrative; see action-kind note above
      estimateMicrocents: 50_000,  // ~$0.0005 baseline
    },
    async ({ caps }) => {
      // ALLOW_WITH_CAPS means "run, but respect these constraints." For a
      // side-effecting tool, fail closed if the caps disallow this tool.
      //
      // Per the protocol, tool_allowlist takes precedence over tool_denylist:
      // when a non-empty allowlist is returned, the denylist is ignored
      // entirely — the allowlist is the sole authority for which tools may
      // run.
      const allowlist = caps?.tool_allowlist
      const hasAllowlist = Array.isArray(allowlist) && allowlist.length > 0

      if (hasAllowlist) {
        if (!allowlist.includes('send_email')) {
          return {
            status: 'skipped',
            error: new DeniedByCyclesError('Cycles caps allowlist excludes send_email.'),
          }
        }
        // Allowlist includes this tool → permitted. Denylist is ignored
        // when an allowlist is present.
      } else {
        const denylist = caps?.tool_denylist
        if (Array.isArray(denylist) && denylist.includes('send_email')) {
          return {
            status: 'skipped',
            error: new DeniedByCyclesError('Cycles caps disallow send_email.'),
          }
        }
      }

      try {
        const sent = await sendEmail(args)
        return { status: 'succeeded', result: sent, actualMicrocents: 50_000 }
      } catch (error) {
        // This example uses the full estimate as the best-known actual after
        // dispatch begins. Use provider-reported usage when it is available.
        return { status: 'failed', error, actualMicrocents: 50_000 }
      }
    },
  )
})
```

For production, prefer a stable tool-call ID from your agent runtime or MCP transport over `randomUUID()`. The ID should stay the same across network retries of the same MCP call, but be different for distinct tool calls inside the same run — that's exactly what makes idempotency safe under retry without collapsing two legitimate calls.

A few things this wrapper does deliberately:

- **Idempotency keys** are derived, not random. A retried network call hits the same reservation and doesn't double-charge. Commit and release each get their own derived key off the same base.
- **Denials throw `DeniedByCyclesError`**, not silent fallthroughs. The agent has to handle them — by stopping, downgrading, or asking for more budget.
- **`ALLOW_WITH_CAPS` reaches the handler**. The handler must respect caps before side effects happen, or return `skipped` so the wrapper releases the reservation.
- **Execution failures are committed**, using provider-reported usage or the best conservative measurement available. Only `skipped` outcomes are released.
- **Ambiguous outcomes fail closed for settlement.** An unexpected handler throw or unconfirmed commit leaves the reservation unreleased until the same commit is retried or an operator reconciles it.
- **Context travels with every call** in the right slot: tenant / workspace / app / workflow / toolset live in `subject`, action kind and tool name in `action`, run ID in `subject.dimensions.run`, and free-form fields (run_id, tool_call_id, tool_name) in `metadata`. That's the context available for dashboard views and audit queries — subject to your server's and dashboard's support for custom dimensions (filtering on `dimensions.run` is out of scope for v0 unless your implementation explicitly supports it).

## Why this matters

An MCP gateway answers *can this tool be reached?* — authentication, allowlisting, transport. That's a real control. It is not the same question as *should this specific call still run?*

The first question is about access. The second is about [exposure](/glossary#exposure) — the cumulative cost, action count, or blast radius the agent has already accumulated. Two questions, two layers. A gateway without runtime authority is a pass/fail access system; the 201st email goes through if the tool is allowed at all. Runtime authority without a gateway has to trust the tool inventory.

Many production incidents we see are not unknown tools. They are approved tools called too many times, in the wrong scope, after the budget should have run out. That's exactly the gap a per-tool-call reservation closes; when run dimensions are enforced, the same pattern also caps the whole run.

For the architecture-side detail of where this sits relative to gateways and authorization, see [MCP Gateways Are Not Runtime Authority](/blog/mcp-gateways-are-not-runtime-authority).

## Try it

```bash
npm install runcycles
npm install @modelcontextprotocol/sdk zod   # if you are building the MCP server yourself
```

Then bring up the local stack so you can watch denials happen in the dashboard while you wire this up:

- [Deploying the Full Cycles Stack](/quickstart/deploying-the-full-cycles-stack) — runtime server, admin server, dashboard, in one `docker-compose up`.
- [Integrating Cycles with MCP](/how-to/integrating-cycles-with-mcp) — the implementation deep-dive: patterns, resources, prompts, transport options.
- [Evaluate Cycles for multi-tenant AI agents](/how-to/evaluate-cycles-for-agent-saas) — fit checklist, non-fit cases, 15-minute local test.

## Send me your MCP/tool-call flow

If you're wiring this into a real product and want a sanity check before you ship, paste the rough shape of your agent's tool-call flow — `agent → tool → API → side effect` — to [Contact Us](/contact) with the subject **"agent flow review."** I'll mark where `reserve`, `commit`, and `release` belong, or tell you if Cycles isn't the right fit. Honest answers, not sales calls.
