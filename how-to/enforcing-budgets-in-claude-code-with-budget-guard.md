---
title: "Enforcing Budgets in Claude Code with Budget Guard"
description: "Install the Cycles Budget Guard plugin: PreToolUse hooks reserve budget before every tool call, a Cycles DENY blocks execution at the dispatch layer, and every executed action is settled — commit, release, or fallback event."
---

# Enforcing Budgets in Claude Code with Budget Guard

The [Cycles MCP server](/how-to/integrating-cycles-with-mcp) gives agents budget *tools* — but honoring a DENY inside the agent's tool loop is cooperative: nothing in MCP forces the model to reserve before acting. The **Cycles Budget Guard plugin** closes that gap on Claude Code by putting Cycles in the **dispatch path**: a `PreToolUse` hook reserves budget before each gated tool call, and a DENY blocks the call at the harness layer. The model cannot skip it.

Repository: [runcycles/cycles-claude-plugin](https://github.com/runcycles/cycles-claude-plugin) (Apache-2.0, zero runtime dependencies).

## Install

```
/plugin marketplace add runcycles/cycles-claude-plugin
/plugin install cycles-budget-guard@runcycles
```

(Also submitted to the official `claude-plugins-official` directory — install from there once listed.)

Then configure the environment Claude Code runs in:

```bash
export CYCLES_BASE_URL=https://your-cycles-server
export CYCLES_API_KEY=your-key
export CYCLES_DEFAULT_TENANT=acme        # required — defines whose budget is charged
export CYCLES_DEFAULT_APP=claude-code    # optional, finer attribution
```

Unconfigured (no base URL or no subject default), the plugin is fully dormant — it never half-enforces. An **invalid** value fails loudly by blocking calls with an error naming the variable.

## What happens on every gated tool call

1. **PreToolUse** reserves a flat per-call cost. The call is **blocked** on: a Cycles `DENY`; any authoritative protocol rejection (budget exhausted, frozen, or closed; debt; auth failure; invalid request); or any malformed response — a garbled answer never grants execution. Fail-open applies only to genuine outages (5xx, network errors, a 4-second timeout), and `CYCLES_CC_FAIL_CLOSED=true` blocks on those too.
2. **Caps are enforced, not advisory.** `ALLOW_WITH_CAPS` tool allow/denylists block violating calls at the gate (allowlist precedence per the protocol spec); remaining caps (max tokens, cooldown) are injected into the model's context.
3. **PostToolUse** (success) commits the reservation. If the reservation expired mid-run — long tool, permission prompt — the executed action is still charged via an idempotent usage event. **Executed actions are never released.**
4. **PostToolUseFailure** releases the hold: failed attempts return budget instead of charging it.
5. **SessionEnd / SessionStart** settle anything the per-call hooks could not. Recovery is scoped by a routing hash of (server, subject, unit), so a machine running multiple projects can never charge one project's budget for another's action.

## Configuration reference

| Variable | Default | Meaning |
|---|---|---|
| `CYCLES_CC_UNIT` | `CREDITS` | Unit charged per tool call |
| `CYCLES_CC_COST` | `1` | Flat cost reserved + committed per call |
| `CYCLES_CC_SKIP_TOOLS` | `^(Read\|Glob\|Grep\|LS\|NotebookRead\|TodoWrite\|AskUserQuestion)$` | Tools never gated (default: local zero-cost reads). Set `^$` to gate everything |
| `CYCLES_CC_FAIL_CLOSED` | `false` | `true` blocks calls when the Cycles server is unreachable |
| `CYCLES_CC_TTL_MS` | `1800000` (30 min) | Reservation TTL; must outlive permission prompts and long tool runs |

The Cycles budget tools themselves are never gated (exact-namespace recursion guard), and the plugin bundles the pinned Cycles MCP server so the model can plan with `cycles_check_balance` and explicit reserves while the hooks enforce. `/cycles-budget-guard:budget` prints a budget status report.

## Semantics worth knowing

- **Identity and retries**: idempotency keys derive from Claude Code's per-call `tool_use_id` — transport retries replay the same reservation; distinct identical calls charge separately.
- **Integrity vs. availability**: a response the plugin cannot interpret (unknown decision, missing reservation id, mistyped caps) is treated as an integrity failure and **denied** — only outages are eligible for fail-open. Settlement responses must confirm `COMMITTED`/`RELEASED`/`APPLIED` before local state is cleared.
- **Privacy**: only subject identifiers, tool *names*, unit/amount, and locally computed hash digests leave the machine. Tool arguments, file contents, and prompts are never transmitted. Policy: [runcycles.io/privacy](/privacy).
- **Platform**: Claude Code only. Cowork support is deliberately unclaimed until hook and environment behavior are verified there.

## When to use which

| | MCP server alone | Budget Guard plugin |
|---|---|---|
| Model can check balances, reserve, meter | ✅ | ✅ (bundled server) |
| DENY blocks tool execution | ❌ cooperative | ✅ dispatch-path |
| Works on any MCP host | ✅ | Claude Code only |
| Setup | add server | add plugin + env |

For other hosts, see the [security model](https://github.com/runcycles/cycles-mcp-server#security-model--enforcement-boundary) and the dispatch-path integrations (OpenClaw guard, framework middleware).
