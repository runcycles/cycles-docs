---
title: "OpenAI 429 Too Many Requests: Causes and Fixes"
description: "Why OpenAI returns HTTP 429 errors, how to read the rate limit headers, fixes that work under load, and how to prevent the underlying cost class permanently."
---

# OpenAI 429 Too Many Requests: Causes and Fixes

A practical guide to diagnosing and resolving HTTP 429 errors from the OpenAI API in production AI agents and applications.

> **What does saturating your TPM actually cost?** [Cost Calculator →](/calculators/claude-vs-gpt-cost-standalone) — model the call volume that drives you into the rate limit; the per-month total is the budget your runtime gate should bound.

## TL;DR

OpenAI returns `429 Too Many Requests` when you exceed one of your organization, project, or model limits — commonly requests per minute (RPM), tokens per minute (TPM), requests or tokens per day (RPD / TPD), images per minute (IPM), or related usage limits. The fix in the moment is backoff that respects `Retry-After` when present, otherwise the `x-ratelimit-reset-*` headers. The fix permanently is **never sending the call in the first place when your own per-tenant or per-agent budget says you should not** — provider rate limits protect OpenAI, not your spend.

## What this error means

The OpenAI API enforces multiple independent rate and usage limits per organization, project, and model:

- **RPM (requests per minute)** — number of API calls
- **TPM (tokens per minute)** — total input + output tokens per minute
- **RPD / TPD (requests / tokens per day)** — daily counterparts
- **IPM (images per minute)** — for image-generating models
- **Monthly organization usage limits** — separate from per-minute / per-day rate limits, enforced against accumulated spend
- **Concurrent request caps** — parallel in-flight requests for some models

Hitting any one of these returns a 429. Response headers expose the current state:

- `x-ratelimit-limit-requests` — your RPM ceiling
- `x-ratelimit-limit-tokens` — your TPM ceiling
- `x-ratelimit-remaining-requests` / `x-ratelimit-remaining-tokens` — what is left in the current window
- `x-ratelimit-reset-requests` / `x-ratelimit-reset-tokens` — when the window resets
- `Retry-After` — how long the client should wait before retrying (not always present)

The response body includes an error object and message describing the limit condition; route primarily on HTTP status and rate-limit headers rather than brittle message parsing.

## Common causes

- **Burst traffic** — a single request did not exceed the limit, but ten parallel ones did
- **Long context windows** — a 60K-token prompt counts toward TPM the same way as 60 separate 1K-token calls
- **Retry storms** — a failure pattern where transient errors trigger immediate retries that compound the load
- **Tier mismatch** — the account is on a lower tier than the workload requires (free / Tier 1 limits are much lower than most teams expect)
- **Shared keys** — multiple services or environments using the same API key contend for the same per-org quota
- **Streaming completions held open** — long-running streams continue to consume TPM headroom while they run

## How to fix it

1. **Read the response headers, do not just retry blindly.** Check `Retry-After` first; if absent, parse `x-ratelimit-reset-tokens` or `x-ratelimit-reset-requests` to know exactly when the window will allow the next call.

2. **Implement exponential backoff with jitter.** Start at 1 second and double on each retry up to a sensible cap (30–60 seconds). Add randomized jitter so retrying clients do not synchronize and re-collide on the next window boundary.

3. **Distinguish RPM from TPM exhaustion.** If `remaining-requests` is 0, you have a request-rate problem — batch or queue requests. If `remaining-tokens` is 0, you have a token-rate problem — shrink prompts, reduce `max_tokens`, or shard across keys.

4. **Cap concurrent in-flight calls.** A bounded concurrency semaphore (10–50, depending on your tier) prevents the burst-bucket case entirely. Most failures we see are from unbounded async fan-out, not from sustained throughput.

5. **Request a tier upgrade once your traffic is real.** OpenAI lifts limits automatically as spend accumulates, but you can also fill out the rate-limit-increase form for specific models. Tier 4 and Tier 5 limits are an order of magnitude higher than Tier 1.

6. **Move long-context work off the hot path.** Summarization, batch evaluation, and retrieval-heavy workloads should run with their own key and concurrency budget so they do not starve user-facing requests.

7. **Add a circuit breaker.** After N consecutive 429s, stop calling for a fixed cool-down window. Failing fast is better than amplifying the rate-limit incident.

## How to prevent it permanently

Provider rate limits exist to protect the provider's infrastructure. They do not protect *your* spend, and they do not understand *your* multi-tenant or per-agent boundaries. Three patterns that genuinely prevent rate-limit-driven incidents:

- **Per-tenant budget enforcement.** A noisy tenant that consumes the entire RPM quota is a tenant-isolation failure, not an OpenAI failure. Cycles enforces per-tenant budgets at the reservation layer, so a single customer cannot starve others. See [Multi-tenant SaaS guide](/how-to/multi-tenant-saas-with-cycles).
- **Pre-execution gate.** Before issuing the OpenAI call, check whether the caller still has budget. If not, deny the call locally — no 429 to handle, no retry storm to avoid. See [How decide works](/protocol/how-decide-works-in-cycles-preflight-budget-checks-without-reservation).
- **Atomic reservations under concurrency.** When ten agents check the budget in parallel, all ten believing there is room, you get a synchronized burst into the OpenAI quota. Cycles solves this with atomic reserve → commit → release. See [Concurrent agent overspend](/incidents/concurrent-agent-overspend).

## Related

- [Cycles vs Rate Limiting](/concepts/cycles-vs-rate-limiting) — why rate limiting alone does not bound cost
- [Integrating Cycles with OpenAI](/how-to/integrating-cycles-with-openai) — drop-in budget governance for OpenAI calls
- [Retry storms and idempotency failures](/incidents/retry-storms-and-idempotency-failures) — when retries make incidents worse
- [Choosing the right overage policy](/how-to/choosing-the-right-overage-policy) — how to behave when budget is exhausted
