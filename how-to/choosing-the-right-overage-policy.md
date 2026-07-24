---
title: "Choosing the Right Overage Policy"
description: "Practical guidance for selecting the right Cycles overage policy for your use case: REJECT, ALLOW_IF_AVAILABLE, or ALLOW_WITH_OVERDRAFT."
---

# Choosing the Right Overage Policy

Cycles provides three overage policies that control what happens when actual usage exceeds the reserved estimate. This guide helps you pick the right one based on your use case.

For detailed mechanics and implementation, see [Commit Overage Policies](/protocol/commit-overage-policies-in-cycles-reject-allow-if-available-and-allow-with-overdraft).

## Decision flowchart

Ask these questions in order:

1. **Has the work already happened?** (external import, retroactive accounting, side effect already fired)
   → **ALLOW_WITH_OVERDRAFT** — the ledger must reflect reality. Note that debt is bounded by the scope's `overdraft_limit`: if the commit would push debt beyond it, the server rejects it with `409 OVERDRAFT_LIMIT_EXCEEDED`, so size the limit for your import volumes

2. **Can you estimate costs reliably?** (fixed-price APIs, known token counts, deterministic operations)
   → **REJECT** with a 10–20% buffer — hard enforcement is safe when estimates are tight

3. **Everything else** — variable-cost LLM calls, tool invocations, streaming responses, multi-step agents
   → **ALLOW_IF_AVAILABLE** (the default) — does not reject a valid commit merely because of overage, never creates debt, and caps the charged delta at available budget

## By use case

### LLM completions (GPT-4, Claude, Gemini)

**Recommended:** ALLOW_IF_AVAILABLE

Token counts vary by prompt, context window, and model behavior. Estimation is inherently imprecise. For an instrumented call whose commit passes ownership, state, expiry, and unit validation, ALLOW_IF_AVAILABLE records the submitted actual but caps the charged overage when budget runs low.

```python
@cycles(estimate=50000, action_kind="llm.completion", action_name="openai:gpt-4o")
def call_llm(prompt: str) -> str:
    return openai_client.chat(prompt)
```

### Tool invocations with known costs

**Recommended:** REJECT or ALLOW_IF_AVAILABLE

If a tool call has a fixed, predictable cost (e.g., a search API at $0.01/query), REJECT with a buffer works well. If cost varies, use ALLOW_IF_AVAILABLE.

```python
# Fixed cost — REJECT is safe
@cycles(estimate=1000, overage_policy="REJECT", action_kind="tool.search", action_name="google-search")
def search(query: str) -> list:
    return search_api.query(query)
```

### External usage imports

**Recommended:** ALLOW_WITH_OVERDRAFT

When importing usage from an external billing system, the work already happened. The budget ledger must reflect it regardless of remaining budget.

```python
from runcycles import EventCreateRequest, Subject, Action, Amount

# Recording usage from an external gateway
client.create_event(EventCreateRequest(
    idempotency_key="import-ext-001",
    subject=Subject(tenant="acme", app="gateway"),
    action=Action(kind="llm.completion", name="external:model"),
    actual=Amount(amount=usage_amount, unit="USD_MICROCENTS"),
    overage_policy="ALLOW_WITH_OVERDRAFT"
))
```

### Multi-step agent workflows

**Recommended:** ALLOW_IF_AVAILABLE

Agents that chain multiple LLM calls and tool invocations have highly variable total cost. ALLOW_IF_AVAILABLE lets each step commit without risk of rejection, while the budget boundary naturally stops new reservations when funds run out.

### Multi-tenant platforms

**Recommended:** ALLOW_IF_AVAILABLE as the tenant default

Set `default_commit_overage_policy: ALLOW_IF_AVAILABLE` at the tenant level. This gives tenants a safe default — no debt, no rejected commits — while individual requests can override to REJECT or ALLOW_WITH_OVERDRAFT as needed.

### SLA-critical operations

**Recommended:** ALLOW_WITH_OVERDRAFT

When an operation must succeed even when the budget is exhausted — critical alerts, compliance actions, safety-related tool calls — use ALLOW_WITH_OVERDRAFT so budget exhaustion alone does not block the action. This is not unlimited: debt is bounded by the scope's `overdraft_limit`, and a commit that would push debt beyond that limit is rejected with `409 OVERDRAFT_LIMIT_EXCEEDED`. Set an `overdraft_limit` large enough to cover your worst-case SLA-critical burst, and monitor debt so it is repaid before the limit is reached.

### Background batch processing

**Recommended:** REJECT

For batch jobs where individual items can be retried, REJECT provides hard budget control. If an item exceeds budget, skip it and retry later when budget is replenished.

## Mixing policies

Most production systems use different policies for different action classes:

| Action class | Policy | Why |
|---|---|---|
| LLM completions | ALLOW_IF_AVAILABLE | Variable cost, always record |
| Fixed-cost tools | REJECT | Predictable, retry-safe |
| External imports | ALLOW_WITH_OVERDRAFT | Already happened |
| Agent orchestration | ALLOW_IF_AVAILABLE | Variable, multi-step |
| Safety-critical ops | ALLOW_WITH_OVERDRAFT | Not blocked by exhaustion (up to `overdraft_limit`) |

## Setting the default

The overage policy resolves in this order (most specific wins):

1. **Request-level** `overage_policy` field — per-call override on the reservation or event
2. **Policy-level** — pattern-based override configured via the Admin API
3. **Budget ledger-level** `commit_overage_policy` — override for a specific scope's ledger
4. **Tenant default** `default_commit_overage_policy` — set via Admin API

If none of these is set, the server falls back to `ALLOW_IF_AVAILABLE`.

For most teams, leaving the default as ALLOW_IF_AVAILABLE and overriding per-request for specific action classes is the simplest approach.

## Summary

- **REJECT** — hard stops, best when estimates are reliable, may leave unaccounted gaps
- **ALLOW_IF_AVAILABLE** — safe default, always commits, caps at budget, no debt
- **ALLOW_WITH_OVERDRAFT** — ledger accuracy above all, creates debt, requires reconciliation

When in doubt, use ALLOW_IF_AVAILABLE. It handles the widest range of scenarios without operational overhead.

## Next steps

- [Commit Overage Policies](/protocol/commit-overage-policies-in-cycles-reject-allow-if-available-and-allow-with-overdraft) — detailed mechanics and concurrency semantics
- [Cost Estimation Cheat Sheet](/how-to/cost-estimation-cheat-sheet) — how estimation strategy ties to overage policy
- [Debt, Overdraft, and the Over-Limit Model](/protocol/debt-overdraft-and-the-over-limit-model-in-cycles) — understanding debt and reconciliation
- [How Events Work](/protocol/how-events-work-in-cycles-direct-debit-without-reservation) — direct debit without reservation
