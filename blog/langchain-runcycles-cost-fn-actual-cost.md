---
title: "Closing the Estimate-Actual Gap with cost_fn"
date: 2026-05-15
author: Albert Mavashev
tags: [langchain, engineering, runtime-authority, budgets, integration, agents]
description: "langchain-runcycles 0.2.0 adds cost_fn to CyclesModelGate: reserve at estimate, commit at the LangChain ModelResponse's actual reported token usage per call."
blog: true
sidebar: false
featured: false
head:
  - - meta
    - name: keywords
      content: "langchain-runcycles, CyclesModelGate, cost_fn, LangChain agent middleware, AgentMiddleware, wrap_model_call, per-call actual cost, openai_cost extractor, anthropic_cost extractor, reserve commit lifecycle"
---

# Closing the Estimate-Actual Gap with cost_fn

When [`langchain-runcycles` 0.1.5](https://github.com/runcycles/langchain-runcycles/releases/tag/v0.1.5) shipped `CyclesModelGate` on 2026-05-10, the release notes called out the known limitation directly:

> Commits at the configured `estimate`, not actual token cost.

That is one of the easiest silent bugs to ship in reserve-commit middleware.

The reserve path is correct: authorize before the model call, pre-debit the budget, block if the [tenant](/glossary#tenant) is out of room. But if the commit path blindly settles at the configured estimate, the ledger stops tracking what the model actually used — even when the provider just reported the exact token counts on the way out, ready to be converted into a real cost number.

[`langchain-runcycles` 0.2.0](https://github.com/runcycles/langchain-runcycles/releases/tag/v0.2.0) closes that gap with `cost_fn`. This post is about why the gap exists at all, what closing it looks like in `AgentMiddleware`, and why a separate v0.2.3 correctness patch on settlement HTTP failures matters for the same reason.

<!-- more -->

## Why "commit at estimate" is the default, and the problem with it

The reserve-commit lifecycle has an unavoidable asymmetry: at reserve time the action has not happened yet, so the cost is unknown; the [reservation](/glossary#reservation) has to be sized by an estimate. At commit time the action has happened, so the actual cost is in hand — except that the cleanest default is "use the same estimate we reserved with, because the middleware has no opinion about how to read provider response shapes."

The default works. It also creates a structural bias: every commit is sized to the worst case the estimate covered, regardless of what the model actually billed. Budgets get consumed faster than the workload actually costs. The downstream consequences are exactly the ones described in [Estimate Drift: The Silent Killer of Budget Enforcement](/blog/estimate-drift-silent-killer-of-enforcement) — once the estimate-to-actual ratio drifts, enforcement thresholds stop tracking real spend.

The fix is structural: commit at actual, not at estimate, whenever the provider gives you usage to read.

## How CyclesModelGate commits actual cost: the cost_fn callback

The middleware needs a callback that runs after the wrapped model call returns but before the commit goes out, takes whatever the model returned, and produces an `Amount` to commit. That is `cost_fn` — exported on the package root as the `CostFn` type alias for user-supplied extractors:

```python
from langchain_runcycles import CostFn  # alias for Callable[[Any], Amount] — (model_response) -> Amount
```

When `CyclesModelGate` is constructed with a `cost_fn`, the middleware calls it after the wrapped model handler returns and uses the returned `Amount` for `commit_reservation` instead of the configured estimate. When `cost_fn` is `None` (the default), behavior is identical to 0.1.x — the estimate gets committed.

The integration looks like this:

```python
from langchain.agents import create_agent
from langchain_runcycles import CyclesModelGate
from langchain_runcycles.extractors import openai_cost
from runcycles import Action, Amount, CyclesClient, CyclesConfig, Subject, Unit

client = CyclesClient(CyclesConfig(base_url="http://localhost:7878", api_key="..."))

model_gate = CyclesModelGate(
    client,
    subject=Subject(tenant="acme", agent="researcher"),
    action=Action(kind="llm.completion", name="gpt-4o"),
    mode="reserve",
    estimate=Amount(unit=Unit.USD_MICROCENTS, amount=2_000_000),  # $0.02 worst case
    cost_fn=openai_cost(
        prompt_per_million_usd=2.50,
        completion_per_million_usd=10.00,
    ),
)

agent = create_agent(model="gpt-4o", tools=[...], middleware=[model_gate])
```

The pre-call [reservation](/glossary#reservation) still books `$0.02` (the estimate). After the model returns, `openai_cost` reads `AIMessage.usage_metadata`, multiplies [tokens](/glossary#tokens) by the configured rates, and produces an `Amount`. The commit goes out at that real number — typically below the worst-case estimate, sometimes above it when the prompt or response runs unusually long.

If the actual exceeds the reserved estimate, normal Cycles commit-overage policy applies — `cost_fn` is not a way to bypass the pre-call envelope, just a way to settle the reservation with the provider-reported number. The reserve still has to be sized large enough to cover the call's realistic worst case.

## The extractors module

Writing a `cost_fn` from scratch every time would invite the same off-by-10x unit-conversion error that hit the `cycles-spring-ai-starter` 0.3.0 docs. `langchain-runcycles` 0.2.0 ships two factory functions:

```python
from langchain_runcycles.extractors import openai_cost, anthropic_cost

# Factory kwargs follow each provider's historical pricing vocabulary.
# Both extractors read LangChain's normalized usage_metadata fields
# (`input_tokens` / `output_tokens`) under the hood.
openai = openai_cost(
    prompt_per_million_usd=2.50,
    completion_per_million_usd=10.00,
)

anthropic = anthropic_cost(
    input_per_million_usd=3.00,
    output_per_million_usd=15.00,
)
```

Both factories use keyword-only pricing args. That is a deliberate choice — `openai_cost(2.50, 10.00)` would TypeError, which is exactly the kind of error a developer wants at construction time rather than after a quarter of skewed accounting. The asymmetry between input/prompt cost and output/completion cost is real and persistent; the API surface should not let a caller accidentally swap them. The OpenAI factory uses `prompt` / `completion` and the Anthropic factory uses `input` / `output` to match each vendor's historical pricing vocabulary; under the hood, both extractors read the same normalized LangChain `usage_metadata` fields (`input_tokens` / `output_tokens`), so the kwarg naming is purely a developer-facing affordance.

Both extractors return `Amount` in `USD_MICROCENTS` so the commit path doesn't need a unit translation. For provider-specific tokenizers or custom pricing, write your own `cost_fn` — the contract is just a callable that receives the model response and returns an `Amount` (the exported `CostFn` alias is `Callable[[Any], Amount]`).

## When cost_fn fails

Anything that runs between the model returning and the agent receiving the result is a potential way to break the agent. The release notes for 0.2.0 are explicit about this: *"cost_fn errors never erase the model result."* When `cost_fn(result)` raises or returns a non-`Amount`, `CyclesModelGate` logs a warning and falls back to the configured `estimate` for the commit. The model result is still returned to the agent. Locked down by `tests/test_model_gate.py::test_cost_fn_exception_falls_back_to_estimate`, `::test_cost_fn_invalid_return_falls_back_to_estimate`, and the async siblings.

That fallback only catches *structural* failures — an exception or an invalid return type. A `cost_fn` that runs to completion and returns a perfectly valid `Amount` based on stale provider pricing will not be caught. The extractor produces a wrong number, the commit lands at the wrong number, and the budget side drifts silently. This is the same drift covered in [Estimate Drift: The Silent Killer of Budget Enforcement](/blog/estimate-drift-silent-killer-of-enforcement), just at a different layer. The operational implication is that pricing functions should be versioned, tested against the provider's published pricing page, and treated as policy configuration — not throwaway glue code. The middleware fallback is structural insurance, not a substitute for keeping the rates current.

## v0.2.3: failed commits must not look successful

The 0.2.0 cost_fn work is half the actuals story. The other half is whether commit and release calls actually report their outcomes — and through v0.2.2, they did not. The runcycles SDK returns `CyclesResponse.http_error(...)` on HTTP failures *without raising*. The middleware in 0.2.0–0.2.2 only caught raised exceptions, so a failed commit silently looked like a successful commit, and the documented `settlement_error_policy` contract was bypassed.

[v0.2.3](https://github.com/runcycles/langchain-runcycles/releases/tag/v0.2.3) fixes that on both `CyclesModelGate` and `CyclesToolGate`, sync and async paths. Commit HTTP failures now surface via the same `settlement_error_policy` as exceptions:

- `settlement_error_policy="raise"` (default) → `RuntimeError` carrying `denial_reason(response)`.
- `settlement_error_policy="log"` → warning logged, handler result preserved.

Release HTTP failures (best-effort by design) log a warning and never raise. Log message wording also changed from "commit failed" to "commit raised" vs "commit returned HTTP failure" so operators can distinguish the two failure modes in audit logs.

This is a small patch in line count and a meaningful patch in semantics. Reserve-at-estimate / commit-at-actual is structurally honest only if the commit outcome is itself reported honestly. A middleware that silently treats a failed commit as success would let `cost_fn` produce the correct actual amount and then discard it — the budget side would never learn what the model actually cost.

## The pattern, generalized

Two things have to be true for "commit at actual" to be operationally useful:

1. **Reserve sizes a worst-case envelope; commit lands the real number.** The asymmetry between the two times is structural, not accidental. Any middleware that pre-debits a budget around an action with unknown cost has to size by estimate. Any middleware that has access to the action's actual cost afterward should commit by actual.

2. **Settlement outcomes must be observable, not silently absorbed.** A successful-looking commit that didn't actually land is worse than a clearly-failed commit — the first lies to the budget; the second triggers operator response.

The same shape is what [`cycles-spring-ai-starter` 0.2.0](/blog/cycles-spring-ai-starter-advisors-walkthrough) did for the Spring AI advisor chain: reserve with the configured estimate, commit on `ChatResponse.Usage` when the provider populates it, fall back to estimate when it does not. The LangChain story differs in shape — `AgentMiddleware` is a hook lifecycle, not an advisor chain — but the asymmetry is identical and the resolution is the same.

The contrast worth being honest about is with `langchain-runcycles`' sibling post on [LangGraph](/blog/langgraph-budget-control-durable-execution-retries-fan-out). That post is about graph-level controls — per-run, per-node, durable-execution retries, [fan-out](/glossary#fan-out) across sub-graphs. This post is about the middleware-level cost-actuals problem that sits one layer below the graph. Both layers compose; neither replaces the other. The LangGraph piece is about *where* the gate runs; this post is about *what number it commits*.

## What's still open

The v0.2.x line is now feature-complete on the original v0.2.0 scope: cost_fn shipped in v0.2.0, streaming-path verification + regression tests shipped in v0.2.1, the multi-tenant fan-out + HITL demo shipped in v0.2.2, and the settlement-honesty fix shipped in v0.2.3. The remaining gap is on the tool side:

- **`cost_fn` on `CyclesToolGate`** is tracked as a v0.3.0 candidate ([issue #20](https://github.com/runcycles/langchain-runcycles/issues/20)). Tool calls today still commit at estimate because most tool callbacks don't expose token usage. Some tools that wrap an LLM call internally could provide a `cost_fn` for the same actual-cost-at-commit shape; the v0.3.0 design needs to decide whether the tool-side hook receives a `ToolMessage` or something richer, and how to surface tool-side errors without breaking the tool result path.

## Closing

The estimate-as-actual gap is one of the easiest silent failure modes to ship in reserve-commit middleware, and it is fixable with the same shape across frameworks: a callback that reads the provider's reported usage and produces an `Amount` for commit. `cost_fn` is the LangChain implementation. The same pattern lives behind `cycles-spring-ai-starter`'s `Usage` extraction and behind any [runtime authority](/glossary#runtime-authority) implementation that aims to bill agents at what they actually cost rather than what the worst-case estimate covered.

The release-by-release sequence is worth recording for the trail it leaves. 0.1.5 shipped with the limitation explicit in the release notes. 0.2.0 added `cost_fn` to close it. 0.2.3 caught a separate silent-success bug in settlement reporting that would have made the 0.2.0 fix less useful than it should be. Each release moved one gap from known-limitation status to closed, with the contract documented in tests on the way out.

## Further reading

- [Estimate Drift: The Silent Killer of Budget Enforcement](/blog/estimate-drift-silent-killer-of-enforcement) — the conceptual sibling: why drift between estimate and actual erodes enforcement
- [Pre-Call Budget Reservation as a Spring AI Advisor](/blog/cycles-spring-ai-starter-advisors-walkthrough) — the same lifecycle in Spring AI's advisor chain
- [LangGraph Budget Control for Durable Execution, Retries, and Fan-Out](/blog/langgraph-budget-control-durable-execution-retries-fan-out) — the graph-level controls one layer above this middleware
- [26 Integrations, Every AI Framework, One Budget Protocol](/blog/26-integrations-every-ai-framework-one-budget-protocol) — the broader integration map
- [What is Runtime Authority for AI Agents?](/blog/what-is-runtime-authority-for-ai-agents) — the conceptual baseline

## External references

- [`langchain-runcycles` on GitHub](https://github.com/runcycles/langchain-runcycles) — source, releases, integration tests
- [`langchain-runcycles` on PyPI](https://pypi.org/project/langchain-runcycles/) — `0.2.3` current at publication
- [LangChain `AgentMiddleware` reference](https://docs.langchain.com/oss/python/langchain/middleware/) — the framework hook this package implements
- [Cycles Protocol](https://github.com/runcycles/cycles-protocol) — the open spec for runtime budget and [action authority](/glossary#action-authority)
