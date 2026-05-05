---
title: "Add Cycles to Cursor (MCP)"
description: "60-second setup for adding Cycles budget enforcement to Cursor via the MCP server. Project vs global config paths, common gotchas, and verification."
---

# Add Cycles to Cursor

This page is the exact setup for [Cursor](https://cursor.com). For the protocol overview and reserve/commit lifecycle, see the [umbrella MCP quickstart](/quickstart/getting-started-with-the-mcp-server).

## Prerequisites

- **Cursor installed** ([download](https://cursor.com))
- **A Cycles API key** (`cyc_live_...`) — see [API key setup](/quickstart/getting-started-with-the-mcp-server#prerequisites). Skip for mock mode.
- **Cycles server running** locally or remote. Skip for mock mode.

## Setup

Cursor reads MCP config from two locations:

- **Project-scoped:** `.cursor/mcp.json` in the project root (commit to share with teammates)
- **User-scoped:** `~/.cursor/mcp.json` (applies to every project)

Pick one. Most teams want project-scoped so the config travels with the repo. Create the file:

```json
{
  "mcpServers": {
    "cycles": {
      "command": "npx",
      "args": ["-y", "@runcycles/mcp-server"],
      "env": {
        "CYCLES_API_KEY": "${env:CYCLES_API_KEY}",
        "CYCLES_BASE_URL": "${env:CYCLES_BASE_URL}"
      }
    }
  }
}
```

Set `CYCLES_API_KEY` and `CYCLES_BASE_URL` in the environment where Cursor can read them. Open Cursor's settings panel → MCP, and you should see `cycles` listed. Toggle it on if it isn't already. Cursor may prompt to approve the new server the first time.

## Try mock mode (no API key required)

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

Returns realistic deterministic responses with no Cycles backend running.

## Verify

In Cursor's tool-enabled Agent / Composer flow, ask:

> Check the budget balance for tenant acme-corp

Cursor should invoke `cycles_check_balance` (you'll see the tool-call expand in the chat) and return balances. The MCP indicator in Cursor's settings should show the server as connected.

## Common gotchas

- **MCP tools only fire in Cursor's agentic / tool-enabled mode**, not plain autocomplete or basic chat. The exact label varies across Cursor releases — check the mode toggle in the chat panel.
- **Project vs user scope.** If both `.cursor/mcp.json` and `~/.cursor/mcp.json` define `cycles`, project wins inside that project's workspace.
- **Use env interpolation for secrets.** Cursor expands `${env:NAME}` in MCP config fields including `env`, so project config can be shared without committing the API key. If Cursor was launched from a GUI and cannot see your shell variables, use a local `.env` via `envFile` or set the variables in your OS environment.
- **`.cursor/` should be `.gitignore`d if it contains secrets.** If you commit `.cursor/mcp.json` with the API key in plain text, it ends up in git history. Commit only env references or mock-mode config; keep any local `.env` file out of git.
- **If Cursor changes config locations**, use **Settings → MCP** to open or verify the active config file — the in-app path is the source of truth.

## What Cycles adds

MCP gives Cursor a standard way to call tools. Cycles adds runtime authority before those tools run: budget checks, risk limits, tenant scope, and reserve → commit / release accounting.

## Next steps

- [Reserve / commit lifecycle](/quickstart/getting-started-with-the-mcp-server#the-reserve-commit-lifecycle) — what the agent actually does with these tools
- [Windsurf setup](/quickstart/mcp-windsurf) — same protocol, different config
- [Claude Desktop](/quickstart/mcp-claude-desktop) · [Claude Code](/quickstart/mcp-claude-code)
- [HTTP transport](/how-to/running-the-mcp-server-over-http) — for shared / multi-user gateway deployments
- [Integrating Cycles with MCP](/how-to/integrating-cycles-with-mcp) — advanced patterns
