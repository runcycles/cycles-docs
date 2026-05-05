---
title: "Add Cycles to Claude Code (MCP)"
description: "60-second setup for adding Cycles budget enforcement to Claude Code via the MCP server. CLI registration, project-scoped vs global config, common gotchas."
---

# Add Cycles to Claude Code

This page is the exact setup for [Claude Code](https://www.claude.com/claude-code). For the protocol overview and reserve/commit lifecycle, see the [umbrella MCP quickstart](/quickstart/getting-started-with-the-mcp-server).

## Prerequisites

- **Claude Code installed** ([install guide](https://docs.claude.com/en/docs/claude-code))
- **A Cycles API key** (`cyc_live_...`) — see [API key setup](/quickstart/getting-started-with-the-mcp-server#prerequisites). Skip this for mock mode.
- **Cycles server running** locally or remote. Skip for mock mode.

## Setup

The fastest path is the CLI, passing env vars at registration so they ride with the server config:

```bash
claude mcp add \
  --transport stdio \
  --env CYCLES_API_KEY=cyc_live_... \
  --env CYCLES_BASE_URL=http://localhost:7878 \
  cycles \
  -- npx -y @runcycles/mcp-server
```

`claude mcp add` defaults to `local` scope, which records the server in your user-level Claude Code config scoped to the current project's directory. To share with teammates, add `--scope project` (or `-s project`) — it writes a committable `.mcp.json` file at the project root. For a global server available in every project, use `--scope user`.

## Project-scoped config (alternative)

If you'd rather hand-edit a committable `.mcp.json` in your project root, use `${VAR}` expansion so secrets stay out of git:

```json
{
  "mcpServers": {
    "cycles": {
      "command": "npx",
      "args": ["-y", "@runcycles/mcp-server"],
      "env": {
        "CYCLES_API_KEY": "${CYCLES_API_KEY}",
        "CYCLES_BASE_URL": "${CYCLES_BASE_URL:-http://localhost:7878}"
      }
    }
  }
}
```

Commit `.mcp.json`, but **do not commit real secrets**. Each developer sets `CYCLES_API_KEY` in their own shell or secret manager. The first time someone opens the project, Claude Code prompts to approve the new MCP server.

## Try mock mode (no API key required)

```bash
claude mcp add --transport stdio --env CYCLES_MOCK=true cycles -- npx -y @runcycles/mcp-server
```

Returns realistic deterministic responses with no Cycles backend running.

## Verify

In Claude Code, ask:

> Check the budget balance for tenant acme-corp

Claude Code should invoke `cycles_check_balance` (you'll see a tool-call indicator) and return the balances. List registered MCP servers any time with:

```bash
claude mcp list
```

## Common gotchas

- **Env vars not captured automatically.** `claude mcp add` records the command but does NOT capture your current shell env. Either pass `--env KEY=VALUE` flags at registration (recommended) or use a project `.mcp.json` with `${VAR}` expansion.
- **CLI option order matters.** `--transport`, `--env`, and `--scope` must come before the server name (`cycles`). Arguments after `--` are passed to `@runcycles/mcp-server`.
- **Native Windows needs a wrapper.** If Claude Code runs on native Windows rather than WSL, use `-- cmd /c npx -y @runcycles/mcp-server` after the server name so Windows can launch `npx`.
- **Three scopes, not two.** `local` is the default and applies only to the current project, stored in your user config. `project` writes a shared `.mcp.json` in the project root. `user` applies in every project. If the same server name appears in multiple scopes, Claude Code uses the highest-precedence definition: **local → project → user**.
- **First-time approval prompt.** Claude Code prompts before running a new MCP server. If you don't see the Cycles tools, check that you didn't miss the prompt.
- **`claude mcp add` updates Claude Code's view, not Claude Desktop's.** Each client has its own config — see [Claude Desktop setup](/quickstart/mcp-claude-desktop) if you want both.

## What Cycles adds

MCP gives Claude Code a standard way to call tools. Cycles adds runtime authority before those tools run: budget checks, risk limits, tenant scope, and reserve → commit / release accounting.

## Next steps

- [Reserve / commit lifecycle](/quickstart/getting-started-with-the-mcp-server#the-reserve-commit-lifecycle) — what the agent actually does with these tools
- [Claude Desktop setup](/quickstart/mcp-claude-desktop) — same protocol, different config
- [Cursor setup](/quickstart/mcp-cursor) · [Windsurf setup](/quickstart/mcp-windsurf)
- [HTTP transport](/how-to/running-the-mcp-server-over-http) — for shared / multi-user gateway deployments
- [Integrating Cycles with MCP](/how-to/integrating-cycles-with-mcp) — advanced patterns
