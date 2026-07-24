---
title: "Add Cycles to Claude Desktop (MCP)"
description: "Add Cycles budget tools to Claude Desktop with the recommended desktop extension or manual MCP configuration on macOS and Windows."
---

# Add Cycles to Claude Desktop

This page is the exact setup for [Claude Desktop](https://claude.com/download). For the protocol overview and reserve-commit lifecycle, see the [umbrella MCP quickstart](/quickstart/getting-started-with-the-mcp-server).

::: warning MCP availability is not enforcement
Registering this MCP server gives Claude Desktop access to Cycles tools — `cycles_reserve`, `cycles_commit`, `cycles_release`, and balance queries. **MCP is useful for local assistant workflows and discovery. It is not, by itself, a hard runtime control unless the host or tool harness is required to call Cycles before executing the real action.** For production, place the Cycles check in the execution path — SDK wrapper, gateway, or framework adapter. See [Add Cycles with Claude, Codex, Cursor, or Windsurf](/how-to/add-cycles-with-claude-or-codex) for the application-side recipe.
:::

## Prerequisites

- **Claude Desktop installed** ([download](https://claude.com/download))
- **Node.js 20+** on PATH if you use the manual `npx` configuration below.
- **A Cycles API key** (`cyc_live_...`) — see [API key setup](/quickstart/getting-started-with-the-mcp-server#prerequisites). Skip this if you only want to try mock mode below.
- **Cycles server running** locally or remote. Skip this for mock mode.

## Setup

### Desktop extension (recommended)

1. Download `cycles-mcp-server-0.6.0.mcpb` from the [latest Cycles MCP Server release](https://github.com/runcycles/cycles-mcp-server/releases/latest).
2. In Claude Desktop, open **Settings → Extensions → Advanced settings → Install Extension…** and select the downloaded file.
3. Enter your Cycles server URL and API key in the extension configuration screen. To explore without a backend, enable **Mock mode** instead; mock mode is synthetic and performs no enforcement.

Claude Desktop installs the bundled server and makes the Cycles tools available without a hand-edited JSON file. Restart Claude Desktop if the tools do not appear immediately.

### Manual JSON configuration

Use this fallback when desktop extensions are disabled by policy or when you need to manage the launch command directly.

Open **Settings → Developer → Edit Config**. Or edit the file directly:

**macOS:**
```
~/Library/Application Support/Claude/claude_desktop_config.json
```

**Windows:**
```
%APPDATA%\Claude\claude_desktop_config.json
```

On macOS, paste the following, replacing `cyc_live_...` with your real API key:

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

On Windows, launch the `npx.cmd` wrapper through `cmd /c`:

```json
{
  "mcpServers": {
    "cycles": {
      "command": "cmd",
      "args": ["/c", "npx", "-y", "@runcycles/mcp-server"],
      "env": {
        "CYCLES_API_KEY": "cyc_live_...",
        "CYCLES_BASE_URL": "http://localhost:7878"
      }
    }
  }
}
```

**Quit Claude Desktop completely** (cmd+Q on macOS — closing the window is not enough), then reopen. The Cycles tools should appear in the MCP indicator at the bottom of the chat.

> **Security note:** if you put `CYCLES_API_KEY` directly in this file, treat the config file as a secret. For shared machines, use a wrapper script or a local-only test key.

## Try mock mode (no API key required)

For the desktop extension, enable **Mock mode** in its configuration screen. For a manual JSON installation, drop `CYCLES_API_KEY` and `CYCLES_BASE_URL`, and set `CYCLES_MOCK` instead. The server returns realistic synthetic responses with no Cycles backend running. Generated IDs and timestamps vary between calls, and mock mode performs no live enforcement:

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

On Windows, keep the `command: "cmd"` and `["/c", "npx", ...]` argument prefix from the real-mode example.

Useful for trying out the tools before standing up a stack.

## Verify

In Claude Desktop, ask:

> Check the budget balance for tenant acme-corp

Claude should call `cycles_check_balance` and return the balances. If you don't see a tools indicator or the call doesn't fire, see "Common gotchas" below.

## Common gotchas

- **Indicator missing after edit.** Claude Desktop only re-reads the config on a full quit/restart. Closing the window is not enough on macOS.
- **Manual `npx` launch fails on Windows.** Make sure Node 20+ is on PATH and `where npx` resolves, then verify the config uses `command: "cmd"` with `"/c", "npx"` at the start of `args`.
- **`CYCLES_BASE_URL` reachability.** If your Cycles server is in Docker, `localhost:7878` from Claude Desktop on macOS reaches the host's localhost — that works. From inside another container, use `host.docker.internal`.
- **API key starts with `cyc_test_` not `cyc_live_`.** Test keys work but only against test budgets; if you're getting `BUDGET_NOT_FOUND` errors, double-check the tenant has a budget allocated.
- **Where are the logs?** When the indicator stays empty or tools fail silently, Claude writes MCP logs to `~/Library/Logs/Claude/` on macOS and `%APPDATA%\Claude\logs\` on Windows. Tail the `mcp*.log` files while restarting the app.

## What Cycles adds

MCP gives Claude Desktop a standard way to call tools. The Cycles server adds budget checks, caller-assigned risk budgets, tenant scope, and reserve → commit/release accounting as tools. Those tools are cooperative in Claude Desktop; hard enforcement requires a host or application boundary that Claude Desktop cannot bypass.

## Next steps

- [Reserve / commit lifecycle](/quickstart/getting-started-with-the-mcp-server#the-reserve-commit-lifecycle) — what the agent actually does with these tools
- [Claude Code setup](/quickstart/mcp-claude-code) — same protocol, different config
- [HTTP transport](/how-to/running-the-mcp-server-over-http) — for shared / multi-user gateway deployments
- [Integrating Cycles with MCP](/how-to/integrating-cycles-with-mcp) — advanced patterns: preflight decisions, graceful degradation, fire-and-forget events
