---
title: "Enforcing Budgets in Claude Code with Budget Guard"
description: "Install Cycles Budget Guard for Claude Code, reserve budget before gated tool calls, block DENY decisions at dispatch, and retry recorded-action settlement."
---

# Enforcing Budgets in Claude Code with Budget Guard

The [Cycles MCP Server](/how-to/integrating-cycles-with-mcp) gives agents budget *tools* — but honoring a `DENY` inside the agent's tool loop is cooperative: nothing in MCP forces the model to reserve before acting. **Cycles Budget Guard** closes that gap on Claude Code by putting Cycles in the **tool dispatch path**: a `PreToolUse` hook reserves budget before each gated tool call, and a `DENY` blocks the call at the harness layer. The model cannot skip that hook decision.

Repository: [runcycles/cycles-claude-plugin](https://github.com/runcycles/cycles-claude-plugin) (Apache-2.0, zero runtime dependencies). The hooks require Node.js 22 or newer.

## Install

```
/plugin marketplace add runcycles/cycles-claude-plugin
/plugin install cycles-budget-guard@runcycles
```

Then configure the environment Claude Code runs in:

```bash
export CYCLES_BASE_URL=https://your-cycles-server
export CYCLES_API_KEY=your-key
export CYCLES_DEFAULT_TENANT=acme        # one subject field is required; tenant shown
export CYCLES_DEFAULT_APP=claude-code    # optional, finer attribution
```

The protocol requires at least one standard subject field: `tenant`, `workspace`, `app`, `workflow`, `agent`, or `toolset`. It does not specifically require `tenant`; see [Understanding Tenants, Scopes, and Budgets](/how-to/understanding-tenants-scopes-and-budgets-in-cycles) when choosing the routing subject. Without a base URL or subject default, the plugin remains dormant. Once configured, an invalid value blocks calls and identifies the affected variable.

## How Claude Code budget enforcement works

1. **`PreToolUse`** reserves a flat per-call cost. The call is **blocked** on: a Cycles `DENY`; any authoritative protocol rejection (budget exhausted, frozen, or closed; debt; auth failure; invalid request); or any malformed response. Fail-open applies only to genuine outages (5xx, network errors, a four-second timeout). A fail-open call is unmetered because no reservation exists; `CYCLES_CC_FAIL_CLOSED=true` blocks that path.
2. **Tool-list caps are enforced at the gate.** `ALLOW_WITH_CAPS` tool allowlists and denylists block violating calls, with [allowlist precedence defined by the protocol](/protocol/caps-and-the-three-way-decision-model-in-cycles). Max-token, remaining-step, and cooldown caps are added to model context as guidance rather than mechanically enforced by the hook.
3. **`PostToolUse`** (success) durably changes the reservation record from `hold` to `commit`, then attempts settlement. If the reservation expired, was finalized, or is missing, the hook submits an idempotent usage event. This recovery path begins only after the successful outcome is durably recorded.
4. **`PostToolUseFailure`** attempts to release a `hold` for a call Claude Code reports as failed and retains a failed release for retry. A failed tool can still have partial side effects, so this hook outcome is not proof that no work occurred.
5. **`SessionEnd`** retries releases, commits, and usage events for the ending session. **`SessionStart`** replays commit and usage-event records across sessions with the same routing identity, but deliberately leaves unresolved `hold` records to their owning session or server-side TTL. State is scoped per OS user to a routing hash of (base URL, full subject, unit). Different routing identities cannot see one another's records; projects using the same tuple share a recovery scope.

## Budget Guard options

| Variable | Default | Meaning |
|---|---|---|
| `CYCLES_CC_UNIT` | `CREDITS` | Unit requested for each gated reservation |
| `CYCLES_CC_COST` | `1` | Flat amount requested for each gated reservation |
| `CYCLES_CC_SKIP_TOOLS` | `^(Read\|Glob\|Grep\|LS\|NotebookRead\|TodoWrite\|AskUserQuestion)$` | Configurable tools not gated by default. Set `^$` to gate every non-Cycles tool |
| `CYCLES_CC_FAIL_CLOSED` | `false` | `true` blocks calls when the Cycles server is unreachable |
| `CYCLES_CC_TTL_MS` | `1800000` (30 min) | Reservation TTL; must outlive permission prompts and long tool runs |

The Cycles budget tools themselves are never gated (exact-namespace recursion guard). The plugin configures the pinned companion Cycles MCP Server, `@runcycles/mcp-server@0.6.0`, which `npx` fetches as needed rather than the plugin vendoring it. The model can plan with `cycles_check_balance` and explicit reserves while the dispatch hook gates other configured tools.

## Verify enforcement

1. Use a test subject with an exhausted, frozen, or closed Cycles budget.
2. Ask Claude Code to run a gated action such as a `Bash` command.
3. Confirm the reservation is denied and the tool does not execute.
4. Run `/cycles-budget-guard:budget` to inspect the active budget scopes (which reflect your configured subject).

## Failure, retry, and privacy semantics

- **Identity and retries**: when Claude Code supplies a non-empty per-call `tool_use_id`, transport retries reuse the same reservation and distinct IDs remain distinct. Older inputs without `tool_use_id` use a hash of session, prompt, tool, and input; identical fallback calls can collide and undercount.
- **Integrity vs. availability**: a reserve response the plugin cannot interpret (unknown decision, missing reservation id, mistyped caps) is treated as an integrity failure and **denied** — only outages are eligible for fail-open. A malformed settlement response retains local state for retry; state is cleared only after `COMMITTED`, `RELEASED`, or `APPLIED` is confirmed.
- **Privacy**: Cycles hook requests include the configured API credential, subject identifiers, tool name, unit/amount, reservation TTL or ID and fixed settlement reasons as needed, plus opaque idempotency digests computed locally. Raw tool arguments, file contents, and prompts are not included in Cycles request bodies; Claude Code's model-provider traffic is separate. Policy: [runcycles.io/privacy](/privacy).
- **Platform**: Claude Code only. Cowork support is deliberately unclaimed until hook and environment behavior are verified there.

## Choose the Cycles MCP Server or Budget Guard

| Capability | Cycles MCP Server alone | Cycles Budget Guard plugin |
|---|---|---|
| Balance, reservation, and metering tools | Available | Available through the pinned companion server |
| Pre-execution tool blocking | Cooperative only | Hook-enforced for gated tools |
| Host support | Any compatible MCP host | Claude Code only |
| Setup | Add server | Add plugin and environment configuration |

For other hosts, see the [security model](https://github.com/runcycles/cycles-mcp-server#security-model--enforcement-boundary), the [OpenClaw integration](/how-to/integrating-cycles-with-openclaw), and the guide to [choosing an integration pattern](/how-to/choosing-the-right-integration-pattern).
