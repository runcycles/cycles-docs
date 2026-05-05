---
title: "Add Cycles to Windsurf (MCP)"
description: "60-second setup for adding Cycles budget enforcement to Windsurf (Codeium) via the MCP server. Config path, mock mode, common gotchas."
---

# Add Cycles to Windsurf

This page is the exact setup for [Windsurf](https://codeium.com/windsurf). For the protocol overview and reserve/commit lifecycle, see the [umbrella MCP quickstart](/quickstart/getting-started-with-the-mcp-server).

## Prerequisites

- **Windsurf installed** ([download](https://codeium.com/windsurf))
- **A Cycles API key** (`cyc_live_...`) — see [API key setup](/quickstart/getting-started-with-the-mcp-server#prerequisites). Skip for mock mode.
- **Cycles server running** locally or remote. Skip for mock mode.

## Setup

Edit Windsurf's MCP config file:

The fastest way to open the active config is from inside the app: **Windsurf Settings → Cascade → MCP Servers → View Raw Config**. Or open it directly:

**macOS / Linux:**
```
~/.codeium/windsurf/mcp_config.json
```

**Windows** (location varies by install — common paths):
```
%USERPROFILE%\.codeium\windsurf\mcp_config.json
%APPDATA%\Codeium\Windsurf\mcp_config.json
```

If neither path exists, use the in-app **View Raw Config** option above to find the active file.

Create the file if it doesn't exist:

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

Set `CYCLES_API_KEY` and `CYCLES_BASE_URL` in the environment where Windsurf can read them. Open Windsurf's settings → Cascade → MCP servers, and `cycles` should appear in the list. Toggle on / refresh if needed.

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

In Windsurf's Cascade chat, ask:

> Check the budget balance for tenant acme-corp

Cascade should invoke `cycles_check_balance` and return the balances. The tool call should be visible in the chat trail.

## Common gotchas

- **Config is typically user-scoped.** Per-project / per-workspace MCP overrides are rolling out across Windsurf release channels; check Windsurf's settings panel for "MCP servers" before assuming. If your build only supports user-scoped, use a wrapper script as the `command` that reads the right secret based on the working directory to vary keys per project.
- **Cascade mode required.** MCP tools are only available in Cascade (Windsurf's agent mode), not in inline completions or plain chat.
- **Use env interpolation for secrets.** Windsurf expands `${env:NAME}` in MCP config fields including `env`, `url`, `serverUrl`, and `headers`. If Windsurf was launched from a GUI and cannot see your shell variables, set them in your OS environment or use a wrapper script.
- **Tools list refreshes on Windsurf restart.** If you edit the config and the tools don't show, fully quit and reopen Windsurf (closing the window is not enough on macOS).
- **Cascade has a total MCP tool limit** (currently 100 tools across all enabled servers). Cycles exposes only ~9 tools, but if you have many MCP servers enabled at once you may hit the cap — disable unused tools in the MCP settings panel.

## What Cycles adds

MCP gives Windsurf a standard way to call tools. Cycles adds runtime authority before those tools run: budget checks, risk limits, tenant scope, and reserve → commit / release accounting.

## Next steps

- [Reserve / commit lifecycle](/quickstart/getting-started-with-the-mcp-server#the-reserve-commit-lifecycle) — what the agent actually does with these tools
- [Cursor setup](/quickstart/mcp-cursor) — same protocol, different config
- [Claude Desktop](/quickstart/mcp-claude-desktop) · [Claude Code](/quickstart/mcp-claude-code)
- [HTTP transport](/how-to/running-the-mcp-server-over-http) — for shared / multi-user gateway deployments
- [Integrating Cycles with MCP](/how-to/integrating-cycles-with-mcp) — advanced patterns
