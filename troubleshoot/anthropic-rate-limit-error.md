---
title: "Anthropic API Rate Limit Errors: How to Diagnose and Prevent"
description: "Why the Anthropic Claude API returns 429 and 529 errors, the input/output token limits unique to Anthropic, and how to keep production agents available under load."
---

# Anthropic API Rate Limit Errors: How to Diagnose and Prevent

A practical guide to the rate limits enforced by the Anthropic Claude API and how to keep production AI agents available when load grows.

> **What does the workload behind your 429s actually cost?** [Cost Calculator →](/calculators/claude-vs-gpt-cost-standalone) — model the input/output volume that drives you into Anthropic's TPM/ITPM limits. The monthly total tells you what a runtime budget gate would need to bound.

## TL;DR

The Anthropic API enforces independent limits on **input tokens per minute**, **output tokens per minute**, and **requests per minute**, separately for each model. A `429` means you hit one of those rate limits; a `529 overloaded_error` means Anthropic itself is under pressure and is shedding load. The two require different fixes: backoff with jitter for 429s, retry with longer windows (or fall back to a different model) for 529s. Permanent prevention is gating calls before they leave your system based on *your* per-tenant budget — not Anthropic's.

## What these errors mean

Anthropic returns two distinct error classes that look similar but have different causes:

| HTTP code | `error.type` | What it means |
|---|---|---|
| `429` | `rate_limit_error` | Your account exceeded a per-minute quota |
| `529` | `overloaded_error` | Anthropic itself is overloaded; not your fault |

Anthropic's per-minute limits are split into three independent quotas, each enforced per model:

- **Input tokens per minute (ITPM)** — billable input tokens consumed
- **Output tokens per minute (OTPM)** — billable output tokens generated
- **Requests per minute (RPM)** — count of API calls

Long-context calls can hit ITPM far before they hit RPM, especially on current Claude models with large context windows. Streaming completions hold OTPM headroom for the duration of the stream.

Response headers expose the current state:

- `anthropic-ratelimit-input-tokens-limit` / `-remaining` / `-reset`
- `anthropic-ratelimit-output-tokens-limit` / `-remaining` / `-reset`
- `anthropic-ratelimit-requests-limit` / `-remaining` / `-reset`
- `retry-after` (on 429 and 529)

## Common causes

- **High input-token workloads.** RAG, long-context summarization, and large-document Q&A drive ITPM exhaustion fast even at modest request rates.
- **Bursty parallelism.** Async fan-out across documents, users, or chunks creates a synchronized spike that exceeds ITPM or RPM at the second-level granularity.
- **Tier limits.** Anthropic's usage tiers (Tier 1–4) have very different ceilings; teams on Tier 1 routinely hit limits well before they expect.
- **Retry compounding.** A single 529 retried aggressively becomes a self-inflicted 429. Both errors cascade if you do not differentiate them.
- **Streaming saturation.** Holding many streams open at once consumes OTPM headroom for the lifetime of the stream, not just the moment a token is emitted.
- **Shared keys across environments.** Staging traffic competing with production for the same per-org quota.

## How to fix it

1. **Differentiate 429 from 529 in your retry logic.** A 429 means you should slow down; a 529 means Anthropic is having a moment and you should retry on a longer interval, or fall back to a different model entirely (e.g., from Claude Opus to Claude Sonnet).

2. **Always honor `retry-after` when present.** Override your default backoff if the header is set — it is the authoritative wait time.

3. **Backoff with jitter, capped at 60 seconds.** Exponential doubling from 1 second. Add randomized jitter so concurrent clients do not re-collide.

4. **Bound concurrent in-flight requests.** A semaphore sized to your tier (start at 10 for Tier 1, scale up as the tier increases) eliminates the burst class of 429.

5. **Reduce input tokens before the call.** Truncate, summarize, or use prompt caching for repeated context. On current supported models, cache hits reduce effective ITPM pressure and bill cached input at a fraction of the standard rate; older models may handle cached tokens differently, so verify against the [current rate-limits documentation](https://platform.claude.com/docs/en/api/rate-limits).

6. **Cap `max_tokens` for cost and safety, not OTPM headroom.** Anthropic evaluates OTPM as output tokens are produced; `max_tokens` does not reserve OTPM capacity up front. Still, keeping `max_tokens` close to realistic output length limits worst-case cost and runaway responses.

7. **Shard across keys for batch workloads.** Background jobs (evaluation, batch summarization) should use a separate API key with its own quota so they do not starve user-facing traffic.

8. **Add a circuit breaker that distinguishes the two error classes.** On sustained 529s, route to a fallback model. On sustained 429s, throttle locally before more calls reach Anthropic.

## How to prevent it permanently

Anthropic's rate limits protect Anthropic. They do not understand:

- Which of *your* tenants is responsible for the burst
- Which agent or workflow ran the 60K-token prompt
- Whether a retry storm is in progress
- Whether the budget for this work has already been spent

Patterns that prevent the underlying class of incident, not just the symptom:

- **Per-tenant token budgets.** Cap tenants at a fraction of your Anthropic quota. A single noisy customer cannot drain shared headroom. See [Multi-tenant SaaS](/how-to/multi-tenant-saas-with-cycles).
- **Pre-execution gating.** Before sending the request to Anthropic, check whether *this caller* has budget. If not, deny locally — no 429, no retry, no incident. See [How decide works](/protocol/how-decide-works-in-cycles-preflight-budget-checks-without-reservation).
- **Atomic reservations.** Ten parallel agents seeing the same available budget and all proceeding is the classic TOCTOU pattern. Cycles' atomic reserve → commit eliminates it. See [Concurrent agent overspend](/incidents/concurrent-agent-overspend).
- **Graceful degradation.** When budget is low, Cycles returns `ALLOW_WITH_CAPS` with a reduced `max_tokens`, so the agent still runs but at a smaller cost footprint. See [Degradation paths](/how-to/how-to-think-about-degradation-paths-in-cycles-deny-downgrade-disable-or-defer).

## Related

- [Integrating Cycles with Anthropic](/how-to/integrating-cycles-with-anthropic) — drop-in budget governance for Claude calls
- [Cycles vs Rate Limiting](/concepts/cycles-vs-rate-limiting) — why provider rate limits do not bound your cost
- [Retry storms and idempotency failures](/incidents/retry-storms-and-idempotency-failures) — how retries amplify rate-limit incidents
- [OpenAI 429 troubleshooting](/troubleshoot/openai-rate-limit-429) — same pattern, different vendor
