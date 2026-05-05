---
title: "Getting Started with the Cycles MCP Server"
description: "Expose Cycles budget tools — reserve, commit, release, decide, check balance — to Claude Desktop, Claude Code, Cursor, Windsurf, and any MCP-compatible AI agent. No SDK code changes."
---

# Getting Started with the Cycles MCP Server

[![npm downloads](https://img.shields.io/npm/dt/@runcycles/mcp-server?label=MCP%20Server%20downloads&color=555&style=flat-square)](https://www.npmjs.com/package/@runcycles/mcp-server)

The Cycles MCP Server gives MCP-compatible agents access to Cycles runtime authority tools: reserve, commit, release, decide, check balance, and record events. Instead of integrating an SDK into your application code, you add the MCP server to your agent's tool configuration and the agent gets direct access to those tools.

This is the fastest way to expose Cycles budget tools to an MCP-compatible AI agent. For hard production enforcement, route costly or risky actions through the reserve → execute → commit/release lifecycle, or enforce Cycles in the application/gateway layer.

::: warning What this does and does not enforce
The MCP server **exposes Cycles tools** to the agent. It does not automatically proxy or block every other MCP tool, API call, or model request — the agent can still take actions that bypass Cycles unless those actions go through `cycles_reserve` / `cycles_decide` / `cycles_commit`.

Use this for:
- budget-aware agents and operator workflows
- explicit reserve / commit / release flows
- demos and local integration

For deterministic production enforcement, make the Cycles check part of the tool execution path itself — at the SDK, gateway, or framework adapter layer.
:::

## Prerequisites

- **A running Cycles stack** with a tenant, API key, and budget. If you don't have one yet, follow [Deploy the Full Stack](/quickstart/deploying-the-full-cycles-stack) first.
- **Node.js 20+ with `npx` available** — every per-client config below launches `@runcycles/mcp-server` through `npx`.

::: tip Where do I get my API key?
API keys are created through the **Cycles Admin Server** (port 7979). Use a runtime API key such as `cyc_live_...`. If your stack is already running with a tenant, create one directly:

```bash
curl -s -X POST http://localhost:7979/v1/admin/api-keys \
  -H "Content-Type: application/json" \
  -H "X-Admin-API-Key: admin-bootstrap-key" \
  -d '{
    "tenant_id": "acme-corp",
    "name": "mcp-key",
    "permissions": ["reservations:create","reservations:commit","reservations:release","reservations:extend","reservations:list","balances:read"]
  }' | jq -r '.key_secret'
```

The response returns the full key (e.g. `cyc_live_abc123...`). **Save it — the secret is only shown once.**

The permissions above are enough for the **core reserve / commit / release lifecycle**. If you want the agent to use `cycles_decide` (preflight checks) or `cycles_create_event` (telemetry / governance events), add the corresponding decision and event permissions as configured in your Cycles deployment — otherwise those tools will fail with auth errors.

Need the full setup? See [Deploy the Full Stack — Create an API key](/quickstart/deploying-the-full-cycles-stack#step-3-create-an-api-key). For rotation and lifecycle details, see [API Key Management](/how-to/api-key-management-in-cycles).
:::

## Pick your client

Each client has its own config file path and quirks. Start with the one you use:

| Client | Quickstart |
|---|---|
| **Claude Desktop** | [Add Cycles to Claude Desktop](/quickstart/mcp-claude-desktop) |
| **Claude Code** | [Add Cycles to Claude Code](/quickstart/mcp-claude-code) |
| **Cursor** | [Add Cycles to Cursor](/quickstart/mcp-cursor) |
| **Windsurf** | [Add Cycles to Windsurf](/quickstart/mcp-windsurf) |
| Other MCP-compatible client | Use the STDIO config below as a template |

All of them use the same package — `@runcycles/mcp-server` from npm — launched via `npx`. The differences are config-file paths and a few client-specific gotchas.

### Generic STDIO config (template)

```json
{
  "mcpServers": {
    "cycles": {
      "command": "npx",
      "args": ["-y", "@runcycles/mcp-server"],
      "env": {
        "CYCLES_API_KEY": "cyc_live_...",
        "CYCLES_BASE_URL": "http://localhost:7878"
      }
    }
  }
}
```

### Mock mode (no backend required)

To try the server without a running Cycles stack, set `CYCLES_MOCK: "true"` instead of the API key / base URL. Mock mode returns realistic deterministic responses.

```json
{
  "mcpServers": {
    "cycles": {
      "command": "npx",
      "args": ["-y", "@runcycles/mcp-server"],
      "env": { "CYCLES_MOCK": "true" }
    }
  }
}
```

### Running the server over HTTP / SSE

For a shared remote MCP gateway (multi-developer team, cloud deploy, sidecar in CI), see [Running the MCP server over HTTP](/how-to/running-the-mcp-server-over-http). STDIO is the right default for a single developer on a local machine.

## Your first budget check

Once connected, ask your agent to check a budget balance:

> "Check the budget balance for tenant acme-corp"

The agent will call `cycles_check_balance` with `tenant: "acme-corp"` and return matching balance records — remaining budget, reserved amounts, and total spent. If you need descendant scopes, ask for child scopes explicitly; the tool maps that to `includeChildren: true` where the server supports it.

## The reserve/commit lifecycle

The core pattern is **reserve → execute → commit**, or **release** if the operation fails or is cancelled. Here's how it works through MCP tools:

**Step 1 — Reserve** before doing something expensive:

> "Reserve 500,000 USD_MICROCENTS for an OpenAI GPT-4o call"

The agent calls `cycles_reserve` and gets back a `reservation_id` and a `decision`. If the decision is `ALLOW`, the budget is locked and the agent can proceed.

**Step 2 — Execute** the operation (the LLM call, API request, etc.)

**Step 3 — Commit** actual usage:

> "Commit reservation res_abc123 with actual usage 423,100 USD_MICROCENTS"

The agent calls `cycles_commit` with the `reservation_id` and the actual amount. The difference between the reserved estimate and the actual usage is returned to the budget pool.

If the operation fails or is cancelled, the agent calls `cycles_release` instead to return the full reserved amount.

## Handling decisions

When you call `cycles_reserve` or `cycles_decide`, the server returns one of three decisions:

| Decision | Meaning | Agent should… |
|----------|---------|---------------|
| `ALLOW` | Budget is available, proceed normally | Execute the operation |
| `ALLOW_WITH_CAPS` | Budget is tight, proceed with constraints | Reduce scope — use a cheaper model, fewer tokens, or skip optional tools. The `caps` field contains `maxTokens`, `toolAllowlist`, and `cooldownMs` hints |
| `DENY` | Budget exhausted or insufficient | Stop, inform the user, or switch to a free fallback |

## Available tools

The MCP server exposes 9 tools:

| Tool | Description |
|------|-------------|
| `cycles_reserve` | Reserve budget before a costly operation. Returns a reservation ID and decision |
| `cycles_commit` | Commit actual usage after an operation completes. Records actual usage against the budget |
| `cycles_release` | Release a reservation without committing. Returns budget to the pool |
| `cycles_extend` | Extend the TTL of an active reservation (heartbeat for long-running ops) |
| `cycles_decide` | Lightweight preflight check — ask if an action would be allowed without reserving |
| `cycles_check_balance` | Check current budget balance for a scope |
| `cycles_list_reservations` | List reservations, filtered by status or subject |
| `cycles_get_reservation` | Get details of a specific reservation by ID |
| `cycles_create_event` | Record usage or governance events without a reservation lifecycle. Useful for telemetry; not a substitute for pre-execution enforcement |

## Built-in prompts

The server includes 3 prompts that agents can invoke for guided workflows:

| Prompt | Description |
|--------|-------------|
| `integrate_cycles` | Generate reserve/commit/release patterns for a specific language and use case |
| `diagnose_overrun` | Analyze budget exhaustion — guides through checking balances and listing reservations |
| `design_budget_strategy` | Recommend scope hierarchy, limits, units, and degradation strategy for a workflow |

## Configuration reference

| Variable | Default | Description |
|----------|---------|-------------|
| `CYCLES_API_KEY` | *(required)* | API key for authenticating with the Cycles server |
| `CYCLES_BASE_URL` | *(required)* | Base URL of your Cycles server (e.g., `http://localhost:7878`) |
| `CYCLES_MOCK` | — | Set to `"true"` to use mock mode (no server needed) |
| `PORT` | `3000` | HTTP port when using `--transport http` |

## Next steps

- **[Integrating Cycles with MCP](/how-to/integrating-cycles-with-mcp)** — advanced patterns: preflight decisions, graceful degradation, long-running operations, fire-and-forget events
- **[Running the MCP server over HTTP](/how-to/running-the-mcp-server-over-http)** — when to use HTTP transport, and how to deploy a shared remote MCP gateway
- **[Architecture Overview](/quickstart/architecture-overview-how-cycles-fits-together)** — how the MCP server fits into the full Cycles stack
- **[End-to-End Tutorial](/quickstart/end-to-end-tutorial)** — walk through the complete reserve → commit lifecycle hands-on
- **[Cost Estimation Cheat Sheet](/how-to/cost-estimation-cheat-sheet)** — estimate token costs for popular LLM models
