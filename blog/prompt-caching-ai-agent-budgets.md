---
title: "Prompt Caching and AI Agent Budgets"
date: 2026-09-27
author: Albert Mavashev
tags: [costs, budgets, agents, engineering, production, runtime-authority]
description: "Prompt caching gives one agent call three prices. Learn why AI agent budgets should reserve for the cache write, settle from usage, and track cache read share."
blog: true
sidebar: false
featured: false
head:
  - - meta
    - name: keywords
      content: prompt caching cost, prompt caching AI agents, cache write pricing, cache hit rate, LLM cost estimation, AI agent budget, reserve commit, Cycles
---

# Prompt Caching and AI Agent Budgets

A team adds one line to its support agent's system prompt: the current date and time, so the model can reason about business hours. Tests pass. Answers improve slightly. Nothing errors.

The provider bill for that agent climbs anyway. The timestamp changes on every request, and it sits at the front of a 20,000-token prefix that used to be served from the prompt cache. In the fixture used later in this post, each follow-up turn goes from $0.0165 to $0.0855, about five times the cost, and the agent's behavior gives no sign of it.

Prompt caching is one of the most effective cost controls available for agent loops, because agents resend the same instructions and tool definitions on every turn. It also changes the arithmetic behind any budget that is enforced before a call runs. One call can now have three different input prices, and the most expensive one is not the uncached price.

This post covers how to size reservations for cached calls, how to settle them from provider usage fields, and how to detect when a cache silently stops working.

<!-- more -->

## How prompt caching changes AI agent costs

Prompt caching stores a processed prompt prefix so a later request with the same prefix can reuse it. Anthropic and OpenAI both price three kinds of input tokens differently on current models:

| Input token state | Anthropic | OpenAI GPT-5.6 and later |
|---|---|---|
| Read from cache | 0.1× base input for most models | 0.1× uncached input |
| Processed without caching | 1× base input | 1× uncached input |
| Written to cache | 1.25× (5-minute TTL) or 2× (1-hour TTL) | 1.25× uncached input |

Sources: Anthropic's [prompt caching documentation](https://platform.claude.com/docs/en/build-with-claude/prompt-caching) and OpenAI's [prompt caching guide](https://developers.openai.com/api/docs/guides/prompt-caching), checked September 27, 2026. Anthropic lists model-specific read-price exceptions, and OpenAI says earlier models have no separate write charge and model-dependent read rates. Check the exact model you deploy.

The table shows the budgeting problem. A cache write costs more than simply not caching. The cheapest outcome and the most expensive outcome for the same request can differ by more than 10× on the cached portion.

Agent loops magnify this because the cacheable prefix is usually the largest part of each request. System instructions, tool schemas, policy text, and retrieved reference material are repeated on every turn, while the new content for a turn is small. When the cache works, most input is billed at the read price. When it stops working, every turn pays at least the uncached price and often the write price.

For a concrete fixture, use per-token rates shaped like a 5-minute cache tier: $3 per million input tokens, $3.75 per million for cache writes, $0.30 per million for cache reads, and $15 per million output tokens. Each turn sends a 20,000-token cacheable prefix, 1,000 new input tokens, and 500 output tokens:

| Turn outcome | Prefix cost | New input | Output | Total |
|---|---:|---:|---:|---:|
| Cache read | $0.0060 | $0.0030 | $0.0075 | **$0.0165** |
| No caching | $0.0600 | $0.0030 | $0.0075 | **$0.0705** |
| Cache write | $0.0750 | $0.0030 | $0.0075 | **$0.0855** |

These are fixture rates for arithmetic, not a quote for a particular model.

## Silent cache misses in agent loops

Caching is a prefix match. Anthropic's documentation states that cache hits require "100% identical prompt segments" up to the cache breakpoint, and OpenAI's guide says reuse "requires the entire rendered prefix to match." A change early in the prompt invalidates everything after it.

Most cache regressions look like harmless product changes:

| Cause | Why the cache misses | Where it shows up |
|---|---|---|
| Timestamp, request ID, or user name in the system prompt | The first bytes change on every request | Every turn is a write or a miss |
| Tool list built from an unordered set or unstable JSON serialization | The prefix bytes change even when the tools do not | Intermittent misses that follow deploys or restarts |
| Tool definitions added, removed, or edited mid-session | Anthropic documents that modifying tool definitions invalidates the entire cache | Cost spike after a mode switch |
| Thinking configuration changed between requests | Anthropic documents that this invalidates cached message blocks | Spikes on routes that vary reasoning settings |
| Human approval or idle pause longer than the TTL | The entry expires before the next turn starts | Rewrites after approval gates and overnight resumes |
| Parallel requests sent before the first response begins | Anthropic notes that an entry becomes available only after the first response begins | Fan-out branches each pay for a write |
| Prefix shorter than the model's minimum cacheable length | Nothing is cached, and no error is returned | Caching never appears to work on a small route |

Two scoping rules also matter operationally. Anthropic isolates caches per workspace on its first-party API, and OpenAI does not share caches across organizations. Splitting identical traffic across workspaces or projects can reduce hit rates without any prompt change.

None of these causes produce an error. The request succeeds, the response is normal, and the only evidence is in the usage fields and the invoice. An agent whose cache hit rate falls from 80% to zero keeps working, with a higher cost per turn.

## Reserve for the cache write, settle at actual

A pre-execution budget has to decide how much to hold before the provider reports usage. For cached calls there are three candidate prices, and only one of them is a safe upper bound.

**Reserving at the cache-read price** assumes a hit. Hits are not guaranteed: OpenAI's guide says a request reuses a prefix only if it "reaches a machine holding a matching entry that has not expired," and every invalidator above turns the expected hit into a write. The actual can be five times the reservation in the fixture.

**Reserving at the uncached price** looks conservative, but it is below the write price. In the fixture, the uncached estimate is $0.0705 and a write costs $0.0855. Even the common 20% estimation buffer, $0.0846, falls short, because the write premium on a prefix-dominated request is about 21% of the uncached total. With a 1-hour TTL at 2× the input price, the write-priced turn would be $0.1305, about 85% above the uncached estimate.

**Reserving at the cache-write price** covers every outcome the provider can bill for that request shape. The reserve-commit lifecycle then settles the actual amount, and the difference returns to the budget:

```text
estimate = cacheable_prefix_tokens × cache_write_rate
         + uncached_input_tokens   × input_rate
         + max_output_tokens       × output_rate
```

Use the write rate for the TTL your application requests. If a route mixes 5-minute and 1-hour breakpoints, price each cached segment at its own tier. Bound the output with an enforced per-call limit so the output term is a real ceiling, and account separately for reasoning tokens where the provider bills them. The [reasoning token budgeting guide](/blog/budgeting-reasoning-tokens-governing-extended-thinking-before-it-bills) covers that part.

### What happens when the estimate is too low

The server's commit overage policy determines what happens when the actual exceeds the reservation:

| Overage policy | Actual above estimate |
|---|---|
| `REJECT` | The commit is rejected with `409 BUDGET_EXCEEDED`. The provider call already ran, so the ledger does not record that spend unless the application reconciles it. |
| `ALLOW_IF_AVAILABLE` (default) | The commit succeeds and charges the overage if it fits; otherwise, the charge is capped and the scope is marked over limit. |
| `ALLOW_WITH_OVERDRAFT` | The commit succeeds within the configured overdraft limit and records debt. |

The Cycles protocol describes the `REJECT` case plainly: "If the action already happened externally, this creates an unaccounted gap." The Python SDK does not release the reservation after a rejected commit, because that would return budget for real spend. The hold remains until its TTL expires. The [overage policy guide](/how-to/choosing-the-right-overage-policy) compares the three policies in detail.

Under the permissive policies, the accounting is preserved but admission was still made against an understated estimate. With concurrent turns, several under-reserved calls can pass admission together and overshoot the available budget.

### The cost of reserving high

Pricing every turn at the write rate holds more budget than most turns use. In the fixture, a turn that hits the cache holds $0.0855 and commits $0.0165. For a single sequential loop, this mainly affects the last turn before exhaustion. For many concurrent turns under one budget, the held amount limits how many can be in flight.

There are two reasonable responses:

1. Keep write-priced reservations and size the budget's concurrency headroom accordingly. This keeps admission strict.
2. Reserve lower, accept overage with `ALLOW_IF_AVAILABLE` or a bounded overdraft, and monitor commit overages as an operating signal. This trades strict admission for less held headroom.

Choose deliberately per route. The failure mode to avoid is pricing at the uncached rate under `REJECT` because it looks conservative.

## Estimate drift runs in both directions

[Estimate drift](/blog/estimate-drift-silent-killer-of-enforcement) usually means actual costs creeping above estimates. Prompt caching adds a second pattern that looks like drift but is not.

With write-priced reservations and a working cache, estimates stay far above actuals. In the stable fixture run, five turns reserve $0.4275 in total and commit $0.1515, a reserve-to-commit ratio of about 2.8. That gap is expected. Recalibrating the estimate down to the cache-read price removes the protection for the next write.

When the cache breaks, actuals rise toward the write-priced estimate. In the fixture's timestamp run, every admitted turn commits exactly its estimate, and the ratio falls to 1.0. A reserve-to-commit ratio that falls sharply after a deploy, with no change in traffic, is a strong hint that the cache stopped working.

Segment the ratio by route, model, and cache TTL before acting on it. A blended ratio across cached and uncached routes can hide both patterns.

## Run a prompt cache budget drill

The <a href="/examples/prompt-cache-budget-drill.py" download>downloadable Python drill</a> pairs a simulated exact-prefix cache with real reservations against a [Cycles server](/glossary#cycles-server). It uses the fixture rates above and a 5-minute sliding TTL, with each turn reserving before the simulated provider call runs.

::: info What this drill shows
Real admission and settlement against synthetic cache behavior, without provider credentials. It does not measure any provider's hit rate, eviction behavior, or latency, and it models a single cache breakpoint. Verify your real cache behavior from provider usage fields.
:::

Use a disposable test tenant from the [full-stack quickstart](/quickstart/deploying-the-full-cycles-stack) with at least $1.00 of available tenant budget and no configured caps. The drill creates four workflow ledgers of $0.30 each and leaves them for inspection.

```bash
python -m pip install "runcycles==0.5.3"

export CYCLES_BASE_URL="http://localhost:7878"
export CYCLES_ADMIN_URL="http://localhost:7979"
export CYCLES_TENANT="acme-corp"
export CYCLES_API_KEY="<test-runtime-key>"
export CYCLES_BUDGET_API_KEY="<test-budget-writer-key>"

python prompt-cache-budget-drill.py
```

The runtime key needs `reservations:create`, `reservations:commit`, `reservations:release`, `reservations:extend`, and `balances:read`. The setup key needs `budgets:write`. The quickstart key can fill both roles for a disposable drill; production setup should keep budget-writing credentials outside the agent process.

The simulated cache stores a hash of the full prefix and refreshes the entry on each read:

```python
def usage(self, prefix: str, now: float) -> dict[str, int]:
    key = hashlib.sha256(prefix.encode()).hexdigest()
    hit = self.entries.get(key, -1.0) > now
    self.entries[key] = now + CACHE_TTL_S  # Written on a miss, refreshed on a hit.
    return {
        "cache_read": PREFIX_TOKENS if hit else 0,
        "cache_write": 0 if hit else PREFIX_TOKENS,
        "input": TAIL_TOKENS,
        "output": MAX_OUTPUT,
    }
```

Each turn runs inside a managed reservation with `overage_policy="REJECT"` and settles the simulated usage:

```python
with client.stream_reservation(
    subject=subject,  # Same tenant and workflow for the whole agent run.
    action=Action(kind="llm.completion", name="cache-drill.turn"),
    estimate=Amount(unit=Unit.USD_MICROCENTS, amount=estimate),
    idempotency_key=operation_id,
    overage_policy="REJECT",
    raise_on_commit_failure=True,
) as reservation:
    usage = cache.usage(prefix, now)  # Simulated provider call, after admission.
    reservation.usage.actual_cost = price(usage)
```

The full script separates admission denial from a rejected commit, declines returned caps it cannot enforce, and checks each workflow's `spent`, `reserved`, and `remaining` balances.

### Four outcomes to inspect

| Scenario | Estimate per turn | Expected result |
|---|---:|---|
| Uncached price plus 20%, stable prefix | $0.0846 | First turn writes the cache; its $0.0855 commit is rejected, and the ledger records no spend |
| Write-priced, stable prefix | $0.0855 | Five turns settle; four read from cache; $0.1515 spent |
| Write-priced, timestamp in prefix | $0.0855 | Every turn writes; the fourth turn is blocked before the provider call; $0.2565 spent |
| Write-priced, 7-minute idle gap after turn two | $0.0855 | The entry expires and is rewritten; five turns settle; $0.2205 spent |

The summary lines should be:

```text
PASS under-reserved: settled=0 blocked=0 unsettled=1 ledger_spent=0 provider_cost=8550000 cache_read_share=0%
PASS stable: settled=5 blocked=0 unsettled=0 ledger_spent=15150000 provider_cost=15150000 cache_read_share=80%
PASS timestamp: settled=3 blocked=1 unsettled=0 ledger_spent=25650000 provider_cost=25650000 cache_read_share=0%
PASS idle-gap: settled=5 blocked=0 unsettled=0 ledger_spent=22050000 provider_cost=22050000 cache_read_share=60%
```

Amounts are in `USD_MICROCENTS`; $1 is 100,000,000. These results were reproduced with Python SDK 0.5.3, Cycles Server 0.1.25.59, and Admin Server 0.1.25.55. The SDK may also log the rejected commit in the first scenario; the summary lines are the drill's result.

The first row is the important one. The provider call ran and would be billed, but the ledger shows nothing spent and a hold that will expire. The timestamp row shows the budget doing its job: the same agent with a broken cache reaches the $0.30 limit after three turns instead of silently continuing at five times the per-turn cost.

## Settle from provider usage fields

Settlement is only as accurate as the usage mapping. The field names look similar across providers but do not mean the same thing:

| Provider | Cache read | Cache write | `input_tokens` means |
|---|---|---|---|
| Anthropic | `cache_read_input_tokens` | `cache_creation_input_tokens`, with 5-minute and 1-hour counts under `cache_creation` | Only uncached tokens after the last breakpoint |
| OpenAI (GPT-5.6 and later) | `input_tokens_details.cached_tokens` | `input_tokens_details.cache_write_tokens` | All input tokens, including cached and written tokens |

Anthropic's total prompt size is the sum of all three input fields. OpenAI's guide computes ordinary input by subtracting cached and written tokens from `input_tokens`. Code that treats `input_tokens` as the total on Anthropic undercounts cached traffic, and code that adds the cache fields to OpenAI's `input_tokens` double-counts. [Where Did My Tokens Go?](/blog/where-did-my-tokens-go-debugging-agent-spend) covers tracing these discrepancies in production.

For LangChain agents, `langchain-runcycles` provides cost extractors that read LangChain's normalized `usage_metadata`. In version 0.4.0, `anthropic_cost` accepts separate cache-read, 5-minute write, and 1-hour write rates, as shown in the [durable LangChain budget guide](/blog/durable-budget-control-for-langchain-agents). `openai_cost` accepts a cached-read rate but has no separate cache-write rate, so written tokens settle at the ordinary prompt rate. For an OpenAI model that bills cache writes, supply your own `cost_fn` until the extractor covers them. [Closing the Estimate-Actual Gap with cost_fn](/blog/langchain-runcycles-cost-fn-actual-cost) explains the contract.

Treat these rates as versioned configuration. Provider cache pricing has changed across model generations, and a stale rate settles a valid-looking but wrong amount.

## Track cache read share as a cost metric

A cache's value shows up in one number: how much of the cacheable input was actually read from cache.

```text
cache_read_share = cache_read_tokens / (cache_read_tokens + cache_write_tokens + uncached_prefix_tokens)
```

In the drill, the stable run reads 80% of its prefix tokens from cache, the idle-gap run reads 60%, and the timestamp run reads none. Record it per route, model, and tenant alongside cost per completed task:

- **Alert on step changes after deploys.** Prompt-assembly changes cause most regressions. A drop from a steady baseline to near zero usually means an invalidator reached the prefix.
- **Assert it in integration tests.** Send the same request twice and assert that the second one reports cache reads. A standing check catches regressions that a one-time look at setup does not.
- **Read it next to the reserve-to-commit ratio.** A falling read share and a ratio falling toward 1.0 point to the same cause.
- **Separate expected writes.** First turns, post-approval resumes, and fan-out branches write by design. Segment by workflow stage so they do not mask a real regression.

A per-run budget and a read-share metric work at different speeds. The budget stops a broken cache from turning one run into an unbounded bill. The metric tells you the cache broke, so you can fix the prompt before every run pays more. The [agentic RAG cost guide](/blog/agentic-rag-cost-control) applies the same idea to cost per useful answer.

Start with the most expensive agent route. Compute the write-priced estimate from its real prefix size, check whether any timestamps or unordered structures reach the prefix, and add cache read share to the dashboard you already use for spend. The [cost estimation cheat sheet](/how-to/cost-estimation-cheat-sheet) has the unit conversions for turning per-token rates into reservation amounts.

## Resources

- <a href="/examples/prompt-cache-budget-drill.py" download>Python prompt cache drill</a>: a simulated cache with real Cycles reservations.
- [Anthropic prompt caching](https://platform.claude.com/docs/en/build-with-claude/prompt-caching): pricing multipliers, TTLs, minimum lengths, and invalidation rules.
- [OpenAI prompt caching](https://developers.openai.com/api/docs/guides/prompt-caching): retention, write pricing, and usage fields.
- [Cycles protocol specification](https://github.com/runcycles/cycles-protocol): commit overage policy semantics.
- [LangChain middleware source](https://github.com/runcycles/langchain-runcycles): cache-aware cost extractors.
