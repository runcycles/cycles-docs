---
title: "Budget Limits for Claude Code, Cursor & Windsurf"
date: 2026-03-19
author: Cycles Team
tags: [MCP, claude-code, cursor, windsurf, budgets, agents]
description: "Add Cycles budget tools to Claude Code, Cursor, and Windsurf, then place hard enforcement safely in a required hook, handler, gateway, or runtime boundary."
blog: true
sidebar: false
head:
  - - meta
    - name: keywords
      content: Claude Code budget limits, Cursor budget limits, Windsurf budget limits, MCP budget tools, Cycles Budget Guard, AI coding agent cost control
---

# Budget Limits for Claude Code, Cursor & Windsurf

A developer starts a Claude Code session at 2 PM to refactor an authentication module. The agent reads 40 files, generates test suites, rewrites three services, discovers a dependency conflict, and spirals into a research loop — reading documentation, trying alternative approaches, generating more tests. At 5 PM the developer checks the bill: $47.

The agent was productive. It was also unsupervised for three hours. No one told it to stop after $10. Nothing in Claude Code, Cursor, or Windsurf provides a built-in mechanism to say "stop spending after this amount." The host runs the agent. The agent calls tools. Nothing in that loop enforces a dollar ceiling.

<!-- more -->

## The Unsupervised Session Problem

MCP hosts — Claude Code, Cursor, Windsurf — are built for long autonomous sessions. A developer starts a task, the agent runs independently, calling tools, reading files, making model calls, sometimes for hours. That is the value proposition: autonomous productivity.

But autonomy without a budget boundary creates open-ended economic [exposure](/glossary#exposure).

Traditional API usage is human-paced. A developer writes a prompt, gets a response, writes the next prompt. Each request has a natural pause where a human is in the loop. In a coding agent session, the agent decides when to make the next call, how many files to read, whether to retry, whether to spawn sub-tasks. The developer is not watching every step — they are writing code in another tab, or they walked away to get coffee.

Three characteristics make MCP host sessions uniquely expensive when things go sideways:

1. **Long duration** — sessions run for minutes to hours, not milliseconds. A 3-hour Claude Code session with continuous tool use generates far more API calls than any single-request integration.
2. **Tool-heavy** — each tool call can trigger further LLM calls. Reading a file, searching a codebase, generating code, running tests — the agent chains these together, and each link in the chain costs money.
3. **Self-directed** — the agent decides the next step. If it thinks "I should read 20 more files to understand this better," it does. If it decides to regenerate a test suite three times, it does. There is no approval gate between steps.

| | Traditional API call | MCP host session |
|---|---|---|
| Duration | Milliseconds to seconds | Minutes to hours |
| Who decides next action | Human or application | Agent |
| Tool calls per session | 1 | 10–500+ |
| Cost predictability | High | Low |
| Human oversight | Per-request | Periodic check-in |

The result: a single MCP host session can cost more than thousands of traditional API calls — and the developer has no visibility into the running total until after the fact. For the broader argument about uncontrolled agent spend, see [The True Cost of Uncontrolled AI Agents](/blog/true-cost-of-uncontrolled-agents). For why post-hoc controls do not stop the next action, see [AI Agent Budget Control: Enforce Hard Spend Limits](/blog/ai-agent-budget-control-enforce-hard-spend-limits).

## Budget Tools via MCP—and Where Enforcement Lives

Adding the Cycles MCP server does not require application code.

The Cycles [MCP Server](/glossary#mcp-server) is added to the host's configuration file. The agent discovers it as a tool provider through MCP's standard tool discovery protocol. From that point, the agent has access to budget tools — `cycles_reserve`, `cycles_commit`, `cycles_release`, `cycles_check_balance`, `cycles_decide`, and more. No SDK or wrapper is required for tool exposure; a separate mandatory boundary is still required for hard enforcement.

Tool discovery is cooperative, however: installing the standalone server does not force the host to call `cycles_reserve` before every other tool. Hard enforcement requires a boundary the action cannot bypass:

- **Claude Code:** install **Cycles Budget Guard for Claude Code**, whose `PreToolUse` hook can require a Cycles decision before a tool runs.
- **Cursor and Windsurf:** put the check in each MCP tool handler, or in a gateway, harness, or service boundary that every costly action must cross.
- **Evaluation and assisted workflows:** expose the standalone Cycles tools and instruct the agent to use them, while treating the result as advisory unless the host also has a mandatory gate.

**Claude Code:**

```bash
claude mcp add \
  --transport stdio \
  --env CYCLES_API_KEY=cyc_live_... \
  --env CYCLES_BASE_URL=http://localhost:7878 \
  cycles \
  -- npx -y @runcycles/mcp-server
```

The `--env` flags store the server environment with the registration. On native Windows, launch `npx` through `cmd /c`; the [Claude Code quickstart](/quickstart/mcp-claude-code) includes the exact platform guidance.

**Cursor / Windsurf:**

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

**Claude Desktop:**

Download `cycles-mcp-server-0.6.0.mcpb` from the [latest release](https://github.com/runcycles/cycles-mcp-server/releases/latest), then choose **Settings → Extensions → Advanced settings → Install Extension…**. Enter the Cycles URL and API key in the extension settings. The [Claude Desktop quickstart](/quickstart/mcp-claude-desktop) also documents manual macOS and Windows JSON configurations.

That is the entire setup for exposing Cycles tools. No `pip install`, project dependency, or agent-code change is required. Add one of the enforcement boundaries above before calling the result a hard limit.

For local development without a running [Cycles server](/glossary#cycles-server), enable mock mode by setting `CYCLES_MOCK=true`. It returns synthetic successful responses without an API key; generated IDs and timestamps vary between calls, and mock mode does not model denials or real budget state. For complete per-host setup instructions, see [Getting Started with the MCP Server](/quickstart/getting-started-with-the-mcp-server). For how the MCP server fits into the full stack, see [Architecture Overview](/quickstart/architecture-overview-how-cycles-fits-together).

## Session-Level and Tool-Level Budget Design

Two budget levels matter for MCP host sessions. Both become enforced only when a mandatory hook, handler, gateway, or runtime calls Cycles on the execution path.

### Session-level budget

Cap the total assigned usage for an entire coding session. Before each protected operation, the enforcement boundary reserves against the session budget. When a new reservation is rejected, the host can wind down gracefully.

**Scope:** `tenant:dev-team/workflow:{session_id}` — for example, a $10 measured-cost budget in a custom handler or a 20-credit tool-call budget in Budget Guard.

Measured-cost integrations must estimate conservatively and report best-known actual usage. **Cycles Budget Guard for Claude Code does not measure model-provider dollars or gate model requests.** It reserves and commits one operator-configured amount per gated tool call (`CYCLES_CC_UNIT`, default `CREDITS`; `CYCLES_CC_COST`, default `1`).

### Tool-level budget

Each individual operation protected by your handler or hook gets its own [reservation](/glossary#reservation) within the session scope. A custom model gateway can reserve measured LLM cost. Budget Guard instead gates Claude Code tool calls with fixed per-call accounting.

Here is how measured-cost session and operation budgets can interact in a custom handler or harness. This is not the Budget Guard plugin's fixed-cost accounting:

```
Session starts → cycles_check_balance (remaining: $10.00)
  │
  ├─ Step 1:  cycles_reserve ($0.50) → ALLOW
  │           execute (read files, plan approach)
  │           cycles_commit ($0.32) → remaining: $9.68
  │
  ├─ Step 2:  cycles_reserve ($0.50) → ALLOW
  │           execute (generate code)
  │           cycles_commit ($0.41) → remaining: $9.27
  │
  ├─ ...steps 3-17 proceed normally...
  │           remaining: $1.80
  │
  ├─ Step 18: cycles_reserve ($0.50) → ALLOW_WITH_CAPS
  │           caps: { maxTokens: 500, maxStepsRemaining: 3 }
  │           caps surfaced as guidance → agent chooses a shorter response
  │           cycles_commit ($0.15) → remaining: $1.65
  │
  ├─ Step 19: cycles_reserve ($0.50) → ALLOW_WITH_CAPS
  │           caps: { maxTokens: 256, toolDenylist: ["web_search"] }
  │           custom handler blocks web_search and applies supported caps
  │           cycles_commit ($0.10) → remaining: $1.55
  │
  └─ Step 20: cycles_reserve ($0.50) → 409 BUDGET_EXCEEDED
              session winds down → agent summarizes work done
```

For a live, non-dry-run reservation, insufficient budget is an error such as HTTP `409 BUDGET_EXCEEDED`, not a successful response with `DENY`. `DENY` is part of the `decide` and dry-run decision model. The host must handle either form before it invokes the costly tool.

For the six MCP integration patterns (simple reserve-commit, preflight, [graceful degradation](/glossary#graceful-degradation), long-running, fire-and-forget, multi-step), see [Integrating Cycles with MCP](/how-to/integrating-cycles-with-mcp). For per-run and per-conversation budget recipes, see [Common Budget Patterns](/how-to/common-budget-patterns).

## Applying Configured Caps

Configured caps let a Cycles-aware enforcement boundary do more than allow or deny.

When the deepest matching budget has caps configured, the [runtime authority](/glossary#runtime-authority) can return `ALLOW_WITH_CAPS`. This is not triggered automatically by a low balance. The MCP server normalizes the protocol's snake_case cap names to camelCase. **Cycles Budget Guard for Claude Code enforces `toolAllowlist` and `toolDenylist` in its `PreToolUse` hook.** It supplies `maxTokens`, `maxStepsRemaining`, and `cooldownMs` to Claude as additional context; those fields are advisory unless another host or handler enforces them.

- **`toolAllowlist` / `toolDenylist`** — Budget Guard can allow or block matching Claude Code tools before execution
- **`maxTokens: 500`** — context tells Claude to prefer a shorter response; it is not a hard model-token limit in the plugin
- **`maxStepsRemaining: 3`** — context tells Claude to wrap up; the plugin does not count or block steps
- **`cooldownMs: 5000`** — context asks Claude to slow down; the plugin does not impose a timer

Consider a concrete scenario: a developer is using Claude Code to refactor a payment service. The matched budget is configured with `maxStepsRemaining: 5` and `toolDenylist: ["web_search"]`. Budget Guard reserves its configured fixed amount before the next gated tool call. The hook blocks `web_search` and supplies the step cap as guidance, so the agent can:

1. Finishes the current refactoring task with shorter responses
2. Skips the "let me research best practices for payment idempotency" step it was planning
3. Commits the changes it has made so far
4. Tells the developer: "Session budget is nearly exhausted. I've completed the core refactoring. The idempotency improvements can be done in a follow-up session."

Without the enforced denylist and a finite tool-call budget, the agent could continue invoking gated tools until a person intervened.

| Decision | What the agent sees | What the agent does |
|---|---|---|
| `ALLOW` | Reservation accepted with no configured caps | Proceed normally |
| `ALLOW_WITH_CAPS` | Reservation accepted and configured caps returned | Enforce supported caps and apply the others as guidance |
| `DENY` from `decide` or dry-run; `BUDGET_EXCEEDED` from live reserve | Budget exhausted | Stop gracefully, summarize work done, inform developer |

For the full protocol reference on the [three-way decision](/glossary#three-way-decision) model, see [Caps and the Three-Way Decision Model](/protocol/caps-and-the-three-way-decision-model-in-cycles). For designing degradation strategies, see [Degradation Paths: Deny, Downgrade, Disable, or Defer](/how-to/how-to-think-about-degradation-paths-in-cycles-deny-downgrade-disable-or-defer).

## Wrapper vs. Authority: Why Config Beats Code

A natural objection: "Can I just put budget tracking in my agent's system prompt?"

Yes, you can tell the agent to count [tokens](/glossary#tokens) and stop after a threshold. Some developers do this. But prompt-based budget tracking is a wrapper, not an authority. The agent is policing itself — and agents are not reliable self-policers.

Prompt-based tracking breaks in practice because:

- **Agents hallucinate token counts.** An agent told to "track your token usage" will estimate, round, lose count, or simply stop tracking after the context grows long enough.
- **Instructions degrade under long contexts.** A system prompt instruction to "stop after $10" competes with every other instruction in the context. In a 100k-token conversation, budget tracking is easily forgotten.
- **No atomicity.** If two concurrent sessions share a budget, prompt-based tracking cannot prevent both from spending simultaneously. Each agent sees its own estimate of what is left.
- **No enforcement.** The agent can choose to ignore its own tracking. An external authority becomes preventative only when a required execution boundary refuses to run the tool after a denial.

The Cycles-backed approach is structurally different when the call is mandatory. The runtime authority has external state and atomic reservation semantics, while the Budget Guard hook, wrapped handler, gateway, or harness makes the result unavoidable. The standalone MCP server supplies the budget tools; the required boundary supplies hard enforcement.

For the extended argument about why the gap between a wrapper and an authority is larger than it looks, see [Vibe Coding a Budget Wrapper vs. Owning a Runtime Authority](/blog/vibe-coding-budget-wrapper-vs-budget-authority).

## Next steps

- **[Getting Started with the MCP Server](/quickstart/getting-started-with-the-mcp-server)** — per-host configuration for Claude Desktop, Claude Code, Cursor, and Windsurf
- **[Integrating Cycles with MCP](/how-to/integrating-cycles-with-mcp)** — advanced patterns: preflight decisions, graceful degradation, long-running operations, fire-and-forget events
- **[Caps and the Three-Way Decision Model](/protocol/caps-and-the-three-way-decision-model-in-cycles)** — protocol reference for ALLOW, ALLOW_WITH_CAPS, and DENY
- **[End-to-End Tutorial](/quickstart/end-to-end-tutorial)** — walk through the complete reserve-commit lifecycle hands-on
- **[Vibe Coding a Budget Wrapper vs. Owning a Runtime Authority](/blog/vibe-coding-budget-wrapper-vs-budget-authority)** — why external runtime authority beats self-policing
