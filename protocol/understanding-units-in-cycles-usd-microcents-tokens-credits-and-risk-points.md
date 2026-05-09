---
title: "Cycles Units: USD, Tokens, Credits, Risk Points"
description: "Reference for the four standard unit types in Cycles and how they affect budget expression, estimation, and ledger interpretation."
---

# Understanding Units in Cycles: USD_MICROCENTS, TOKENS, CREDITS, and RISK_POINTS

Every amount in Cycles — reservations, commits, events, balances — has a unit.

The unit tells the system what is being measured and how to interpret the number.

Cycles defines four standard units:

- **USD_MICROCENTS**
- **TOKENS**
- **CREDITS**
- **RISK_POINTS**

Choosing the right unit affects how budgets are expressed, how estimates are calculated, and how the ledger is interpreted.

## USD_MICROCENTS

USD_MICROCENTS is the default unit and the most precise monetary unit in the protocol.

### Definition

```
1 USD_MICROCENTS = 10⁻⁶ cents = 10⁻⁸ dollars
1 USD = 100 cents = 100,000,000 USD_MICROCENTS
```

### Why microcents?

Model calls are cheap individually. A single GPT-4o-mini call might cost a fraction of a cent.

If the unit were dollars or even cents, many per-call amounts would round to zero. That makes accounting meaningless.

USD_MICROCENTS uses integer arithmetic with enough precision to represent per-call costs without floating point issues.

### Range

The amount field is a 64-bit integer (int64 format) with a minimum of 0. Negative amounts are not valid in standard Amount fields. The SignedAmount variant (used for Balance.remaining) allows negative values to represent overdraft state.

Maximum: `9.22 × 10¹⁸ USD_MICROCENTS ≈ $92.2 billion`

That is more than sufficient for any realistic budget.

### When to use USD_MICROCENTS

- you want to track cost in monetary terms
- you need precision for per-call accounting
- your budgets are expressed in dollars, euros, or other currency (converted to USD_MICROCENTS)
- you want direct correlation between budget state and provider bills

### Example

A model call that costs $0.003:

```
$0.003 = 0.3 cents = 300,000 USD_MICROCENTS
```

Reserve 300,000. If actual usage is 280,000, commit 280,000 and the remaining 20,000 is released automatically.

## TOKENS

TOKENS represents integer token counts, as used by most LLM providers.

### When to use TOKENS

- your budgets are expressed in token counts
- you want direct mapping to provider token metering
- cost varies by model and you want to track consumption in a model-independent unit
- you are budgeting computational capacity rather than monetary cost

### Example

A model call expects to use up to 2,000 input tokens and 500 output tokens.

Reserve 2,500 TOKENS. After the call, actual input was 1,800 and output was 450. Commit 2,250 TOKENS.

### Considerations

Token-based budgeting is simpler but does not account for price differences between models. A budget of 100,000 TOKENS means different monetary costs depending on whether those tokens go to GPT-4o or GPT-4o-mini.

If you need monetary awareness, use USD_MICROCENTS and convert token counts to cost at reservation time.

## CREDITS

CREDITS is a generic integer unit for custom budget systems.

### When to use CREDITS

- your platform defines its own internal currency
- you want to abstract away underlying costs
- different tenants have different pricing and you want to normalize
- you want to decouple budget governance from provider pricing

### Example

A platform defines:

- 1 credit = 1 model call (regardless of model size)
- or 1 credit = some normalized cost unit

Tenants are allocated credits per billing period. Each model call reserves and commits in credits.

### Considerations

Credits require a mapping layer to translate between credits and actual cost. This adds complexity but provides flexibility in pricing and plan design.

## RISK_POINTS

RISK_POINTS is a generic integer unit for risk-based budgeting.

### When to use RISK_POINTS

- you want to budget side-effect risk rather than cost
- some actions are expensive in risk but cheap in money
- you want to limit how many high-risk actions a tenant or workflow can take
- safety governance is more important than cost governance

### Example

A platform defines:

- read-only model call = 1 risk point
- tool invocation with external API = 5 risk points
- write operation (email, ticket, payment) = 20 risk points

A workflow is allowed 100 risk points per run. This bounds the total side-effect surface regardless of monetary cost.

### Considerations

Risk points are subjective. The team must define what each point represents and calibrate the scale. But for systems where side-effect control matters more than cost control, risk points can be more operationally useful than monetary units.

## Unit consistency

All amounts within a single reservation lifecycle must use the same unit.

- The reservation estimate, commit actual, and balance amounts must all be in the same unit
- The server returns `400 UNIT_MISMATCH` if a reserve, decide, commit, or event uses a unit that doesn't match any budget at the derived scopes (when a budget exists at the scope in a different unit). The error details include `expected_units` listing the units for which a budget does exist, so clients can self-correct. When no budget exists at any scope in *any* unit, the server returns `404 NOT_FOUND` with the message `"Budget not found for provided scope: ..."` — the runtime plane uses a single `NOT_FOUND` wire code for all resource-not-found conditions, and the message field carries the specific reason. On `/v1/decide` and dry-run reserve, the same "no budget" condition instead surfaces as `200 DENY` with `reason_code=BUDGET_NOT_FOUND`.

This prevents accidental unit confusion (e.g., reserving in tokens and committing in dollars).

Within a balance, all amount fields (remaining, reserved, spent, allocated, debt, overdraft_limit) share the same unit.

## Choosing a unit

A simple decision framework:

### Use USD_MICROCENTS when:
- monetary cost is the primary concern
- you want direct provider bill correlation
- you need per-call precision
- your budgets are expressed in currency

### Use TOKENS when:
- token consumption is the primary metric
- you budget by computational capacity
- you want model-independent counting
- monetary cost varies and you want to decouple

### Use CREDITS when:
- you have a custom platform currency
- you want to abstract provider pricing
- different tenants have different cost structures
- you want plan-based allocation (e.g., 10,000 credits/month)

### Use RISK_POINTS when:
- side-effect control matters more than cost
- you want to bound high-risk actions
- safety governance is a primary goal
- cost and risk are not well correlated

## Multiple units in one system

A single Cycles deployment can use different units for different scopes or action types.

For example:

- tenant budgets in USD_MICROCENTS (monetary ceiling)
- workflow budgets in TOKENS (capacity planning)
- agent budgets in RISK_POINTS (side-effect control)

However, a single reservation lifecycle uses exactly one unit. Multi-unit atomic operations are a v1+ concern.

## Summary

Units define what Cycles is measuring:

- **USD_MICROCENTS** — monetary cost with per-call precision (default)
- **TOKENS** — LLM token consumption
- **CREDITS** — custom platform currency
- **RISK_POINTS** — side-effect risk accounting

Choosing the right unit depends on whether the primary concern is cost, capacity, pricing abstraction, or safety.

All amounts within a reservation lifecycle and within a balance must use the same unit.

## Next steps

To explore the Cycles stack:

- Read the [Cycles Protocol](https://github.com/runcycles/cycles-protocol)
- Run the [Cycles Server](https://github.com/runcycles/cycles-server)
- Manage budgets with [Cycles Admin](https://github.com/runcycles/cycles-server-admin)
- Integrate with Python using the [Python Client](/quickstart/getting-started-with-the-python-client)
- Integrate with TypeScript using the [TypeScript Client](/quickstart/getting-started-with-the-typescript-client)
- Integrate with Spring AI using the [Spring Client](https://github.com/runcycles/cycles-spring-boot-starter)
