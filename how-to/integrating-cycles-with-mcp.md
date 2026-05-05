---
title: "Integrating Cycles with MCP"
description: "Expose Cycles runtime tools — decide, reserve, commit, release, balance — to any MCP-compatible agent. Patterns, resources, prompts, and transport options."
---

# Integrating Cycles with MCP

The [Model Context Protocol](https://modelcontextprotocol.io) (MCP) is the standard way AI hosts discover and call tools. The Cycles MCP Server exposes Cycles runtime authority as MCP tools, so MCP-compatible agents (Claude Desktop, Claude Code, Cursor, Windsurf, custom agents) can call `decide`, `reserve`, `commit`, `release`, and balance tools without an SDK integration.

This gives agents a standard way to participate in Cycles workflows. **For hard production enforcement, make the Cycles check part of the actual execution path: the tool call, model call, gateway, or harness must require `reserve` or `decide` before the costly or risky action fires.** The MCP server alone exposes tools; it does not automatically gate every other action the agent might take.

This guide covers the integration patterns, resources, prompts, and transport options available through the MCP server.

::: tip No SDK changes
MCP integration requires no SDK changes in your agent application. You configure the Cycles MCP Server in your host, and the agent can discover Cycles tools.

For deterministic enforcement, do not rely on the model voluntarily calling these tools. Put the Cycles check in the tool execution path or gateway layer.
:::

## Prerequisites

```bash
npm install @runcycles/mcp-server   # or use npx at runtime
```

```bash
export CYCLES_API_KEY="cyc_live_..."    # from Admin Server
export CYCLES_BASE_URL="http://localhost:7878"  # required — your Cycles server URL
```

For local development without an API key:

```bash
export CYCLES_MOCK=true
```

> **Need setup help?** See [Getting Started with the MCP Server](/quickstart/getting-started-with-the-mcp-server) for per-host configuration (Claude Desktop, Claude Code, Cursor, Windsurf).

## Pattern 1: Simple reserve/commit

The most common pattern — reserve budget before a costly operation, commit actual usage after:

**Step 1 — Reserve:**

```json
{
  "idempotencyKey": "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
  "subject": { "tenant": "acme", "agent": "researcher" },
  "action": { "kind": "llm.completion", "name": "claude-sonnet" },
  "estimate": { "unit": "USD_MICROCENTS", "amount": 50000 },
  "ttlMs": 60000
}
```

Response includes `decision: "ALLOW"` and a `reservationId`.

**Step 2 — Execute** the LLM call or tool invocation.

**Step 3 — Commit:**

```json
{
  "reservationId": "rsv_...",
  "idempotencyKey": "commit-a1b2c3d4",
  "actual": { "unit": "USD_MICROCENTS", "amount": 35000 },
  "metrics": {
    "tokensInput": 1200,
    "tokensOutput": 800,
    "latencyMs": 2500,
    "modelVersion": "claude-sonnet-4-20250514"
  }
}
```

The unused 15,000 microcents are returned to the budget pool.

**If the operation fails**, call `cycles_release` instead:

```json
{
  "reservationId": "rsv_...",
  "idempotencyKey": "release-a1b2c3d4",
  "reason": "LLM call failed with timeout"
}
```

## Pattern 2: Preflight + reserve

Use `cycles_decide` for a lightweight check before committing to a reservation. Useful at the start of a workflow to decide strategy:

```json
{
  "idempotencyKey": "decide-uuid",
  "subject": { "tenant": "acme", "workflow": "summarize" },
  "action": { "kind": "llm.completion", "name": "claude-opus" },
  "estimate": { "unit": "USD_MICROCENTS", "amount": 200000 }
}
```

If the decision is `ALLOW`, proceed with a full `cycles_reserve`. If `DENY`, the agent can switch to a cheaper model or skip the operation — without having locked any budget.

## Pattern 3: Graceful degradation

When budget is running low, `cycles_reserve` may return `ALLOW_WITH_CAPS` instead of a flat `ALLOW`. Caps tell the agent how to constrain the operation:

```json
{
  "decision": "ALLOW_WITH_CAPS",
  "reservationId": "rsv_...",
  "caps": {
    "maxTokens": 2000,
    "toolDenylist": ["web_search", "code_execution"],
    "cooldownMs": 5000
  }
}
```

The `caps` payload may include hints such as max tokens, allowed or denied tools, remaining steps, or cooldown timing. Common fields the agent should respect when present:

- max output tokens on the LLM call
- max remaining agent steps
- allowed / denied tool lists
- cooldown between operations to slow spend rate

See [Caps and the Three-Way Decision Model](/protocol/caps-and-the-three-way-decision-model-in-cycles) for the full schema and current field names.

## Pattern 4: Long-running operations

For operations that may exceed the default 60-second TTL, use `cycles_extend` as a heartbeat:

**Reserve with a TTL:**

```json
{
  "idempotencyKey": "long-op-uuid",
  "subject": { "tenant": "acme", "workflow": "data-pipeline" },
  "action": { "kind": "batch", "name": "process-dataset" },
  "estimate": { "unit": "USD_MICROCENTS", "amount": 500000 },
  "ttlMs": 120000
}
```

**Extend periodically** (e.g., every 60 seconds):

```json
{
  "reservationId": "rsv_...",
  "idempotencyKey": "extend-1-uuid",
  "extendByMs": 120000
}
```

**Commit when done.** If the agent crashes, the reservation expires automatically and the budget is returned to the pool.

See [TTL, Grace Period, and Extend](/protocol/reservation-ttl-grace-period-and-extend-in-cycles) for the full TTL model.

## Pattern 5: Fire-and-forget events

When you can't pre-estimate cost (e.g., webhook-triggered actions, post-hoc metering), use `cycles_create_event` to record usage directly:

```json
{
  "idempotencyKey": "event-uuid",
  "subject": { "tenant": "acme", "app": "chatbot" },
  "action": { "kind": "llm.completion", "name": "gpt-4o" },
  "actual": { "unit": "USD_MICROCENTS", "amount": 42000 },
  "metrics": {
    "tokensInput": 3000,
    "tokensOutput": 1500,
    "latencyMs": 1800
  }
}
```

No reservation needed — the event is applied atomically to all derived scopes. See [Events and Direct Debit](/protocol/how-events-work-in-cycles-direct-debit-without-reservation).

> **This is post-hoc metering, not pre-execution enforcement.** `cycles_create_event` records that the action happened — it does not stop the action before it happens. For preventative control, use `cycles_decide` (preflight) or `cycles_reserve` (lock budget) before execution.

## Pattern 6: Multi-step workflow

For workflows with multiple costly steps, check the balance first, then reserve per step:

**Check balance:**

```json
{ "tenant": "acme", "workflow": "research-report" }
```

**Step 1:** `cycles_reserve` → execute → `cycles_commit`

**Step 2:** `cycles_reserve` → execute → `cycles_commit`

**Step 3:** `cycles_reserve` → **DENY** (budget exhausted) → degrade or stop

Each step gets its own reservation, so the budget authority can deny mid-workflow if the agent is burning through budget too fast. **Do not reserve once for an entire long workflow unless you are comfortable locking that whole estimate up front** — per-step reservations give the authority layer a chance to stop mid-run, and unused budget returns to the pool sooner. See [Common Budget Patterns](/how-to/common-budget-patterns) for more examples.

## Tool reference

The MCP server exposes 9 tools:

| Tool | Description |
|------|-------------|
| `cycles_reserve` | Create a budget reservation before executing a costly operation |
| `cycles_commit` | Finalize a reservation with actual usage |
| `cycles_release` | Release an unused reservation back to the budget pool |
| `cycles_extend` | Extend the TTL of an active reservation (heartbeat) |
| `cycles_decide` | Lightweight budget check without creating a reservation |
| `cycles_create_event` | Record usage directly without a reservation (post-hoc metering) |
| `cycles_check_balance` | Query current budget balance for a tenant/scope |
| `cycles_list_reservations` | List active reservations with optional filters |
| `cycles_get_reservation` | Get details of a specific reservation by ID |

## Resources

The MCP server exposes resources for inspecting budget state:

| URI | Description |
|-----|-------------|
| `cycles://balances/{tenant}` | Current budget balance for a tenant scope |
| `cycles://reservations/{reservation_id}` | Reservation details by ID |
| `cycles://docs/quickstart` | Getting started guide |
| `cycles://docs/patterns` | Integration patterns reference |

Use resources when you need to inspect state without calling a tool — for example, reading a tenant's balance as context before deciding on a strategy.

## Prompts

The server ships three prompts that help AI assistants work with Cycles:

### `integrate_cycles`

Generates Cycles integration code for a given language and use case.

| Parameter | Required | Description |
|-----------|----------|-------------|
| `language` | No | Programming language (default: typescript) |
| `use_case` | No | Context: `llm-calls`, `api-gateway`, `multi-agent` |

> "Use the integrate_cycles prompt to generate Python code for an LLM-calls use case"

### `diagnose_overrun`

Guides through debugging budget exhaustion or a stopped run.

| Parameter | Required | Description |
|-----------|----------|-------------|
| `reservation_id` | No | Specific reservation to investigate |
| `scope` | No | Tenant or scope identifier to check |

> "Use the diagnose_overrun prompt to figure out why my agent stopped — scope is tenant:acme"

### `design_budget_strategy`

Recommends scope hierarchy, budget limits, units, TTL settings, and degradation strategy.

| Parameter | Required | Description |
|-----------|----------|-------------|
| `description` | Yes | Description of the workflow to budget |
| `tenant_model` | No | e.g., `per-customer`, `per-team`, `single-tenant` |

> "Use the design_budget_strategy prompt for my multi-agent customer support system with per-customer tenants"

## Transport modes

The Cycles MCP server supports two transports:

- **STDIO** *(default)* — the AI client launches the server as a subprocess via `npx`. One server per developer, per machine. This is what every per-client quickstart uses ([Claude Desktop](/quickstart/mcp-claude-desktop), [Claude Code](/quickstart/mcp-claude-code), [Cursor](/quickstart/mcp-cursor), [Windsurf](/quickstart/mcp-windsurf)).
- **Streamable HTTP / SSE compatibility** — the server runs as a long-lived process and clients connect remotely. Streamable HTTP is the current MCP transport; SSE is the older shape, supported for legacy clients. Use this for shared team gateways, cloud co-deploys with `cycles-server`, CI sidecars, or any case where you want auth and audit in front of MCP.

Quick HTTP start:

```bash
npx @runcycles/mcp-server --transport http
```

The server starts on port 3000 (configurable via `PORT`) with:

- `GET /health` — health check (`{"status": "ok", "version": "..."}`)
- `POST /mcp` — MCP Streamable HTTP endpoint
- `GET /mcp` — MCP SSE endpoint
- `DELETE /mcp` — MCP session cleanup

For the full decision tree, docker-compose example, and auth/scope behavior, see **[Running the MCP server over Streamable HTTP / SSE](/how-to/running-the-mcp-server-over-http)**.

## Error handling

| Error Code | Meaning | Recommended Action |
|---|---|---|
| `BUDGET_EXCEEDED` | Not enough budget | Degrade to cheaper model or stop |
| `RESERVATION_EXPIRED` | TTL elapsed before commit | Re-reserve if work is still needed |
| `RESERVATION_FINALIZED` | Already committed or released | No action needed |
| `DEBT_OUTSTANDING` | Scope has unpaid debt (no overdraft limit) | Wait for admin to fund the budget or configure an overdraft limit |
| `OVERDRAFT_LIMIT_EXCEEDED` | Over-limit state | Wait for admin to reconcile |

See [Error Codes and Error Handling](/protocol/error-codes-and-error-handling-in-cycles) for the full reference.

## Key points

- **No SDK changes for tool exposure.** Add the MCP server to your agent's config and it discovers Cycles tools automatically. Hard enforcement still requires those tools to sit in the execution path.
- **Always finalize reservations.** Every `cycles_reserve` must be followed by `cycles_commit` or `cycles_release` — never leave reservations dangling.
- **Use stable idempotency keys.** Use a unique, stable `idempotencyKey` per logical Cycles operation so retries replay safely and do not double-settle reservations. The same retry of the same logical call must use the **same** key, not a new UUID per attempt.
- **Respect caps.** When the decision is `ALLOW_WITH_CAPS`, constrain the operation accordingly.
- **Heartbeat long operations.** Use `cycles_extend` for operations that may exceed the reservation TTL.
- **Tag for observability.** Use `action.tags` and `metrics.custom` to add context for debugging and auditing.

## Next steps

- [Getting Started with the MCP Server](/quickstart/getting-started-with-the-mcp-server) — setup guide for each AI host
- [Architecture Overview](/quickstart/architecture-overview-how-cycles-fits-together) — how the MCP server fits into the Cycles stack
- [Cost Estimation Cheat Sheet](/how-to/cost-estimation-cheat-sheet) — pricing reference for estimates
- [Troubleshooting and FAQ](/how-to/troubleshooting-and-faq) — common issues and solutions
