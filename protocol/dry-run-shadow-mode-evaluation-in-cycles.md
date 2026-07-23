---
title: "Dry Run: Shadow Mode Evaluation in Cycles"
description: "Test budget enforcement in shadow mode with dry run, evaluating the full reservation path without modifying budget state."
---

# Dry Run: Shadow Mode Evaluation in Cycles

Before enforcing budget limits in production, teams need a way to test the full reservation path without actually holding budget.

That is what dry run provides.

Setting `dry_run: true` on a reservation request tells the server to evaluate the request as if it were real — including scope derivation, budget checks, decision logic, and cap computation — but without modifying any budget state.

## What dry run does

A dry run reservation request:

1. Evaluates the Subject and derives canonical scopes
2. Checks budget availability across all derived scopes
3. Returns a decision (ALLOW, ALLOW_WITH_CAPS, or DENY)
4. Returns affected_scopes showing which scopes were evaluated
5. Returns caps if the decision is ALLOW_WITH_CAPS
6. Optionally returns balance snapshots for operator visibility

All of this happens without:

- creating a reservation
- modifying any balance
- requiring a subsequent commit or release

## Dry run response rules

The protocol defines specific rules for dry run responses:

### reservation_id and expires_at_ms are absent

A dry run does not create a reservation, so `reservation_id` and `expires_at_ms` MUST be absent from the response (not present with a null value — the fields must not appear).

### affected_scopes is always populated

Regardless of the decision outcome — ALLOW, ALLOW_WITH_CAPS, or DENY — the `affected_scopes` field must be populated.

This is important for debugging. Even when a dry run returns DENY, the client can see which scopes were evaluated and identify where the bottleneck is.

### caps follow the same rules

If the decision is ALLOW_WITH_CAPS, `caps` is present with the same constraints that would apply to a real reservation.

If the decision is ALLOW or DENY, `caps` is absent.

### reason_code on DENY

When a dry run returns DENY, the `reason_code` field should be populated. This is the primary diagnostic signal for understanding why the dry run was denied.

`DecisionReasonCode` is an open string (as of v0.1.25) with seven documented known values: `BUDGET_EXCEEDED`, `BUDGET_FROZEN`, `BUDGET_CLOSED`, `BUDGET_NOT_FOUND`, `OVERDRAFT_LIMIT_EXCEEDED`, `DEBT_OUTSTANDING`, `TENANT_CLOSED` (added in spec v0.1.25.13 — a fresh dry run on a closed owning tenant returns `decision=DENY` with this reason, never `409 TENANT_CLOSED`; the persisting create surfaces the same condition as the 409). Clients MUST handle unknown values gracefully — extension specs may add new reason codes additively. See [Decision reason codes](/protocol/error-codes-and-error-handling-in-cycles#decision-reason-codes) for full semantics.

The same field is used by `/v1/decide` responses. Note that on dry_run reserve, the `BUDGET_NOT_FOUND` reason code corresponds to a condition that non-dry reserve would surface as `HTTP 404` with `error=NOT_FOUND` — the wire shape is different, but the underlying "no budget at any derived scope" condition is the same.

### balances are recommended but optional

The server may include balance snapshots in the response. These reflect the current state without any mutation — they show what balances look like without the reservation being applied.

Balance snapshots are recommended for operator visibility but are not required.

## Dry run vs decide

Both dry run and the decide endpoint (`POST /v1/decide`) evaluate budget without modifying state. But they differ in important ways:

### Scope of evaluation

- **decide** is a lightweight preflight check that returns a decision, optional caps, and affected scopes
- **dry_run** evaluates the full reservation creation path, including all normative rules that apply to real reservations

### Response completeness

- **decide** returns decision, caps, reason_code, retry_after_ms, and affected_scopes
- **dry_run** returns everything a real reservation would (except reservation_id and expires_at_ms), including balance snapshots

### Budget denial semantics

- **decide** returns a 200 response with a decision value for budget-state conditions — insufficient budget, debt, and over-limit all surface as `decision: DENY`, never as a 409. Request-validity errors are the exception to this pattern: a wrong unit still returns `400 UNIT_MISMATCH`, and malformed or unauthorized requests return their usual 4xx errors
- **dry_run** may return DENY as the decision value for insufficient budget (unlike a live reservation, which would return `409 BUDGET_EXCEEDED`); as with decide, request-validity errors still return 4xx

This is a subtle but important distinction: a live reservation with insufficient budget fails with a 409 error. A dry run with insufficient budget succeeds with a 200 response containing `decision: DENY`.

### When to use each

Use **decide** for:

- quick feasibility checks
- UI gating
- planning and routing between alternatives

Use **dry_run** for:

- full shadow-mode evaluation of reservation logic
- validating scope derivation and affected scopes
- testing budget policy before enabling enforcement
- monitoring what would happen if enforcement were live

## How to use dry run for shadow mode rollout

The typical shadow mode rollout pattern:

### Phase 1: Observe

Enable dry run on all reservation requests. Log the decisions but do not act on them.

This shows what enforcement would look like without any production impact.

### Phase 2: Alert

Configure alerts for dry run DENY decisions. Investigate whether these denials are expected or would indicate misconfigured budgets.

### Phase 3: Enforce selectively

Switch specific action classes from dry run to live enforcement. Keep others in dry run mode.

### Phase 4: Full enforcement

Once confidence is high, switch all action classes to live enforcement.

## Dry run in client code

The decorator/annotation supports dry run. When enabled, the client evaluates the reservation without holding budget. The decorated function does not execute — a `DryRunResult` is returned instead (Python) or the decision is logged for monitoring (Java). This allows teams to observe what would have happened under enforcement without affecting runtime behavior.

::: code-group
```python [Python]
from runcycles import cycles

@cycles(estimate=1000, dry_run=True)
def summarize(text: str) -> str:
    return call_llm(text)
```
```java [Java (Spring Boot)]
@Cycles(value = "1000", dryRun = true)
public String summarize(String text) {
    return chatModel.call(text);
}
```
:::

## Idempotency on dry run

Dry run requests support idempotency keys. On replay with the same key, the server returns the original response.

However, since dry run does not create a reservation, there is no reservation_id to replay. The replayed response reflects budget state at the time of the original call, not the current state.

## Practical example

A team is rolling out budget enforcement for their support bot. They configure dry run on all model calls:

```json
{
  "idempotency_key": "shadow-run-001",
  "subject": { "tenant": "acme", "app": "support-bot" },
  "action": { "kind": "llm.completion", "name": "openai:gpt-4o" },
  "estimate": { "unit": "USD_MICROCENTS", "amount": 500000 },
  "dry_run": true
}
```

The response comes back:

```json
{
  "decision": "ALLOW_WITH_CAPS",
  "affected_scopes": ["tenant:acme", "tenant:acme/app:support-bot"],
  "caps": {
    "max_tokens": 2048
  }
}
```

This tells the team: if enforcement were live, the request would be allowed but with a token cap. They can use this data to tune budgets before enabling real enforcement.

## Summary

Dry run provides full reservation-path evaluation without budget mutation:

- **decision** is returned as if the reservation were live
- **affected_scopes** is always populated, even on DENY
- **reservation_id** and **expires_at_ms** are absent
- **caps** follow the same rules as live reservations
- **balances** reflect non-mutating evaluation

Use dry run for shadow mode rollouts, policy testing, and building confidence in budget configuration before enabling enforcement.

For quick feasibility checks without full reservation evaluation, use the decide endpoint instead.

## Next steps

To explore the Cycles stack:

- Read the [Cycles Protocol](https://github.com/runcycles/cycles-protocol)
- Run the [Cycles Server](https://github.com/runcycles/cycles-server)
- Manage budgets with [Cycles Admin](https://github.com/runcycles/cycles-server-admin)
- Integrate with Python using the [Python Client](/quickstart/getting-started-with-the-python-client)
- Integrate with TypeScript using the [TypeScript Client](/quickstart/getting-started-with-the-typescript-client)
- Integrate with Spring Boot or Spring AI using the [Spring Boot starter](https://github.com/runcycles/cycles-spring-boot-starter) or the [Spring AI starter](https://github.com/runcycles/cycles-spring-ai-starter)
