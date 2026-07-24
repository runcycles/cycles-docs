---
title: "Caps and the Three-Way Decision Model in Cycles"
description: "How Cycles uses ALLOW, ALLOW_WITH_CAPS, and DENY decisions to provide nuanced budget enforcement beyond binary allow/deny."
---

# Caps and the Three-Way Decision Model in Cycles

Most budget systems make a binary decision: allow or deny.

Cycles adds a third option.

When a reservation or decide request is evaluated, the server returns one of three decisions:

- **ALLOW** — sufficient budget exists, proceed normally
- **ALLOW_WITH_CAPS** — sufficient budget exists, but soft constraints apply
- **DENY** — insufficient budget or policy block

The middle option — ALLOW_WITH_CAPS — is what makes Cycles more useful than a simple gate.

## Where DENY appears

One wire-level detail matters here: `decision: DENY` only ever appears on responses that do not hold budget — `POST /v1/decide` responses and dry-run (`dry_run: true`) reservation responses.

A live (non-dry-run) reservation never returns `decision: DENY`. When budget is unavailable, the server rejects the request with an HTTP `409` error — `BUDGET_EXCEEDED`, or another 409 code such as `OVERDRAFT_LIMIT_EXCEEDED`, `DEBT_OUTSTANDING`, or `TENANT_CLOSED` — instead of a 200 response carrying a DENY decision.

Where callers find the denial reason follows the same split. On a DENY decision (decide or dry run), the response's `reason_code` field carries the machine-readable reason — `BUDGET_EXCEEDED`, `BUDGET_FROZEN`, `BUDGET_CLOSED`, `BUDGET_NOT_FOUND`, `OVERDRAFT_LIMIT_EXCEEDED`, `DEBT_OUTSTANDING`, or `TENANT_CLOSED`. On a live denial, the equivalent information is in the 409 error response's `error` field. See [Decision reason codes](/protocol/error-codes-and-error-handling-in-cycles#decision-reason-codes).

## Why binary decisions are not enough

In practice, many autonomous actions can still produce value in a constrained mode.

A model call does not have to use the maximum token budget.
An agent does not have to invoke every available tool.
A workflow does not have to run at full concurrency.

If the only options are "full speed" or "stop," teams end up choosing one extreme:

- budgets are set too loose (to avoid breaking production)
- or budgets are set too tight (and useful work gets denied unnecessarily)

Caps provide a middle ground.

## What caps are

Caps are operator-configured constraints that the server returns from the deepest matching budget when the decision is ALLOW_WITH_CAPS.

The protocol defines five cap fields:

### max_tokens

The maximum number of tokens the action should consume.

This lets the server say: "you may proceed, but limit output length."

### max_steps_remaining

The maximum number of remaining steps for an agent or loop.

This lets the server say: "you may proceed, but wrap up soon."

### tool_allowlist

A list of tools the action is allowed to use.

If present, only these tools may be invoked. All others are implicitly denied.

### tool_denylist

A list of tools the action is not allowed to use.

If present, all tools except these may be invoked.

The allowlist takes precedence: if `tool_allowlist` is non-empty, the denylist is ignored.

### cooldown_ms

A delay in milliseconds before the next action should begin.

This lets the server throttle execution without denying it outright.

## How caps flow through the system

Caps are returned by the server in two places:

1. **Reservation responses** — when the decision on `POST /v1/reservations` is ALLOW_WITH_CAPS
2. **Decide responses** — when the decision on `POST /v1/decide` is ALLOW_WITH_CAPS

Caps are only present when the decision is ALLOW_WITH_CAPS. They are absent for ALLOW and DENY.

The client is responsible for respecting caps. The server does not enforce them at commit time. They are guidance, not hard blocks.

## When caps appear

In the current server, caps come from the deepest matching budget that has an operator-configured `caps` object. Their presence is configuration-driven, not an automatic response to utilization or remaining balance. A deployment that wants progressive narrowing must change which configured policy or scope applies; the base server does not tighten caps as spend rises.

## Using caps in practice

### Model calls

When `max_tokens` is returned, the client should pass it to the model provider as a generation limit.

This reduces the cost of the call without denying it entirely.

### Agent loops

When `max_steps_remaining` is returned, the agent should plan to finish within that many steps.

This creates a bounded wind-down instead of an abrupt stop.

### Tool selection

When `tool_allowlist` or `tool_denylist` is returned, the agent should filter its available tools accordingly.

This narrows the action surface when the configured policy calls for it without eliminating all capability.

### Pacing

When `cooldown_ms` is returned, the client should wait that long before making the next action.

This reduces execution velocity without stopping the workflow.

## Caps in client code

Inside a `@cycles`-decorated function (Python) or `@Cycles`-annotated method (Java), access caps through the context object:

::: code-group
```python [Python]
from runcycles import cycles, get_cycles_context

@cycles(estimate=1000)
def process(prompt: str) -> str:
    ctx = get_cycles_context()
    if ctx.has_caps():
        if ctx.caps.max_tokens:
            # limit generation length
            pass
        if not ctx.caps.is_tool_allowed("web.search"):
            # skip web search tool
            pass
    return call_llm(prompt)
```
```java [Java (Spring Boot)]
CyclesReservationContext ctx = CyclesContextHolder.get();
if (ctx.hasCaps()) {
    Caps caps = ctx.getCaps();
    if (caps.getMaxTokens() != null) {
        // limit generation length
    }
    if (!caps.isToolAllowed("web.search")) {
        // skip web search tool
    }
}
```
:::

The `@Cycles` annotation logs a warning when ALLOW_WITH_CAPS is returned, so teams can see when caps are being applied even without explicit handling.

## Caps are advisory

Caps are not enforced by the server at commit time.

If the client ignores `max_tokens` and generates more output, the commit will still succeed (subject to the overage policy).

But respecting caps is important for two reasons:

1. It keeps budget consumption aligned with server expectations
2. Lower-cost execution can preserve remaining budget and delay a later hard denial

Caps are configuration supplied with an accepted decision. They are only effective when the caller or a mandatory host boundary applies them.

## Tool list precedence

The tool filtering logic follows a clear precedence:

1. If `tool_allowlist` is non-empty, only those tools are allowed (denylist is ignored)
2. If `tool_allowlist` is empty but `tool_denylist` is non-empty, all tools except those in the denylist are allowed
3. If both are empty or absent, no tool restrictions apply

Tool names are case-sensitive and match the `Action.name` field exactly.

## How caps relate to degradation paths

Caps are the protocol-level mechanism behind the degradation strategies described in the Cycles documentation:

- **Downgrade** — reduce model size or generation length → `max_tokens`
- **Disable** — remove expensive tools → `tool_allowlist` / `tool_denylist`
- **Defer** — slow down execution → `cooldown_ms`
- **Limit scope** — bound remaining steps → `max_steps_remaining`

Caps make these degradation paths concrete and server-driven rather than hardcoded in the client.

## Summary

The three-way decision model — ALLOW, ALLOW_WITH_CAPS, DENY — gives Cycles a richer control surface than binary allow/deny.

Caps provide server-driven guidance that lets clients:

- reduce token consumption
- limit remaining steps
- restrict tool usage
- pace execution

This supports a configured degradation path between full execution and hard denial.

## Next steps

To explore the Cycles stack:

- Read the [Cycles Protocol](https://github.com/runcycles/cycles-protocol)
- Run the [Cycles Server](https://github.com/runcycles/cycles-server)
- Manage budgets with [Cycles Admin](https://github.com/runcycles/cycles-server-admin)
- Integrate with Python using the [Python Client](/quickstart/getting-started-with-the-python-client)
- Integrate with TypeScript using the [TypeScript Client](/quickstart/getting-started-with-the-typescript-client)
- Integrate with Spring Boot or Spring AI using the [Spring Boot starter](https://github.com/runcycles/cycles-spring-boot-starter) or the [Spring AI starter](https://github.com/runcycles/cycles-spring-ai-starter)
