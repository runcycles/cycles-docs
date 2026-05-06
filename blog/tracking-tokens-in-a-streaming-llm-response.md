---
title: "Tracking Tokens and Cost in a Streaming LLM Response"
date: 2026-04-19
author: Albert Mavashev
tags: [engineering, streaming, llm, budget-enforcement, python, openai]
description: "Streaming LLM cost tracking breaks reserve-commit in four ways. A Python context manager for OpenAI + Anthropic budget enforcement that handles all four."
blog: true
sidebar: false
featured: false
head:
  - - meta
    - name: keywords
      content: "streaming llm token tracking, streaming llm cost tracking, sse budget enforcement, openai streaming budget, openai streaming cost, anthropic streaming usage tracking, anthropic streaming usage, budget check streaming response, llm streaming reservation, track tokens during stream, budgeted streaming python"
---

# Tracking Tokens and Cost in a Streaming LLM Response

> **Part of: [LLM Cost Runtime Control Reference](/guides/llm-cost-runtime-control)** — the full pillar covering causes, enforcement patterns, multi-tenant boundaries, and unit economics.

Non-streaming LLM calls are the easy case for LLM cost tracking and budget enforcement. You know the max output length, you reserve that many tokens up front, the response comes back, you commit the actual usage from the `usage` field, done. One reserve, one commit, one HTTP request-response on each side.

Streaming — whether an OpenAI chat completion with `stream=True`, an Anthropic SSE response with `message_delta` events, or any provider shipping tokens over Server-Sent Events — breaks that pattern in four specific places, and each one has a wrong answer that looks right until you hit production. This post is about those four failure modes and the pattern that closes all of them: the same pattern the [`runcycles` Python client](https://github.com/runcycles/cycles-client-python) already implements as `StreamReservation`.

<!-- more -->

## Why streaming LLM cost tracking breaks reserve-commit

The obvious first instinct: reserve `max_tokens`, stream the response, commit the total when the stream ends. This works in a demo and breaks in at least four predictable ways once the system sees real traffic.

**1. The final usage lands in the *last* chunk, not the first.** OpenAI's streaming API only includes `usage` in the final chunk, and only if you passed `stream_options={"include_usage": True}`. Anthropic exposes cumulative usage through one or more `message_delta` events, with the final totals available by the end of the stream. If your code commits after the first chunk — or before the stream ends — you either commit the reserved estimate (over-charging) or skip the commit entirely (reservation expires, budget is phantom-released, attribution is lost).

**2. The stream can outlive the TTL.** Cycles reservations have a [default server TTL of 60 seconds](/protocol/reservation-ttl-grace-period-and-extend-in-cycles) (the Python `StreamReservation` raises its own default to 120 seconds) and a hard cap of 24 hours. A slow model, a slow network, or a model that wanders for 2,000 tokens can push stream duration past your TTL. If the reservation expires mid-stream, your commit call returns `410 RESERVATION_EXPIRED` and the budget accounting is wrong in a way you'll only notice when the overage-policy metric starts drifting.

**3. The client can disconnect mid-stream.** The agent framework crashes; the user closes the browser; the network blips. You have *partial* output and no final `usage`. Who pays? The question has a real answer — estimate from what you received and commit a partial cost, or release and accept the estimate loss — but the default behavior in most naive wrappers is "silent leak": reservation expires, budget returns to the pool, and the actual LLM cost you already incurred at the provider is never accounted for against the right scope.

**4. A retry can double-commit.** The commit call fails (network, 5xx). The framework retries. Without an idempotency story at the Cycles protocol layer, the second commit either fails with `IDEMPOTENCY_MISMATCH` (best case — the retry is rejected) or double-debits (worst case — the retry landed against a different reservation). This is not hypothetical; it's exactly what the [retry-storms post](/blog/retry-storms-and-idempotency-in-agent-budget-systems) covers for non-streaming calls, and it gets harder when the commit is asynchronous with the stream close.

Four problems; one context manager closes all four — here's the shape.

## The pattern: track tokens during the stream, commit on exit

**Reserve a generous estimate up front. Accumulate actual usage as chunks arrive. Commit the actual on clean exit; release on exception. Heartbeat-extend the TTL while the stream is running. Send the commit with a stable idempotency key so a network retry replays the original response.**

Each word carries weight:

- **Generous estimate** — overestimate the cost, because under-reservation at request time means a `DENY` before you can even start the stream. The extra is *reserved*, not *spent* — it returns to the pool on commit.
- **Accumulate actual usage** — update a mutable counter from each chunk that carries usage info (final-chunk-only via `stream_options.include_usage` for OpenAI; one-or-more `message_delta` events for Anthropic).
- **Commit actual on clean exit** — the context manager's `__exit__` path when no exception was raised.
- **Release on exception** — the `__exit__` path when the stream was interrupted. Release returns the reservation to the available pool and records the reason.
- **Heartbeat-extend** — a background task calling `POST /v1/reservations/:id/extend` every `ttl_ms/2` so the reservation outlives a long stream.
- **Stable idempotency key on commit** — the commit body carries an `idempotency_key`. Per the [Cycles protocol](/protocol/api-reference-for-the-cycles-protocol), retrying with the same key and same payload returns the original successful response; the operation is not applied again. That's the happy-path retry semantics — not an error code branch.

## The actual Python code

Simplified from [`runcycles/streaming.py`](https://github.com/runcycles/cycles-client-python/blob/main/runcycles/streaming.py) (sync variant shown; `AsyncStreamReservation` is the near-identical async twin, and the real implementation adds a few validation branches omitted here for clarity):

```python
class StreamReservation:
    """Sync context manager: reserve on __enter__, commit/release on __exit__."""

    def __enter__(self) -> StreamReservation:
        body = _build_streaming_reservation_body(...)
        response = self._client.create_reservation(body)
        result = ReservationCreateResponse.model_validate(response.body)

        if result.decision == Decision.DENY:
            raise _build_protocol_exception("Reservation denied", response)

        self._reservation_id = result.reservation_id
        self._start_time = time.monotonic()
        self._heartbeat_thread = self._start_heartbeat()
        return self

    def __exit__(self, exc_type, exc_val, exc_tb) -> None:
        self._heartbeat_stop.set()
        if self._heartbeat_thread:
            self._heartbeat_thread.join(timeout=1.0)
        try:
            if exc_type is not None:
                self._handle_release("stream_failed")
            else:
                self._handle_commit()
        finally:
            _clear_context()
```

Call-site usage is boring by design — that's the point:

```python
with cycles_client.stream_reservation(
    action=Action(kind="llm.completion", name="gpt-4o"),
    estimate=Amount(unit=Unit.USD_MICROCENTS, amount=estimated_cost),
    cost_fn=lambda u: u.tokens_input * 250 + u.tokens_output * 1000,
) as reservation:
    stream = openai_client.chat.completions.create(
        model="gpt-4o",
        messages=[{"role": "user", "content": prompt}],
        max_tokens=max_tokens,
        stream=True,
        stream_options={"include_usage": True},
    )

    for chunk in stream:
        if chunk.choices and chunk.choices[0].delta.content:
            print(chunk.choices[0].delta.content, end="", flush=True)

        # The final chunk carries usage — accumulate it.
        if chunk.usage:
            reservation.usage.tokens_input = chunk.usage.prompt_tokens
            reservation.usage.tokens_output = chunk.usage.completion_tokens
# Auto-committed on exit with actual cost from cost_fn(reservation.usage).
```

The pattern stays readable because the context manager absorbs the ceremony. The caller's responsibilities reduce to three things: estimate the cost before the `with`, update `reservation.usage` during the stream, and handle the LLM API the same way they would without Cycles.

## How each of the four failure modes gets handled

**Final usage in the last chunk.** The `cost_fn` runs *inside* `__exit__`, after the stream has drained. By then, the final `chunk.usage` has written into `reservation.usage.tokens_input` and `tokens_output`, and `cost_fn` converts to the unit the reservation was made in (USD microcents, in the example above). A single commit fires with the actual — not the estimate. If the final chunk never arrives (malformed stream, SDK bug), the commit falls back to the estimate. The [`_resolve_actual_cost`](https://github.com/runcycles/cycles-client-python/blob/main/runcycles/streaming.py) helper is explicit about this fallback order: explicit `actual_cost` set by the caller wins, `cost_fn` output second, reserved estimate last.

**Stream outlives TTL.** The `_start_heartbeat` method spawns a background thread (or asyncio task in the async variant) that calls `extend_reservation` every `max(ttl_ms/2, 1000ms)`. On success, it updates the cached `expires_at_ms` so the caller's view stays consistent. On heartbeat failure, it logs — the commit will still try on exit, and if the reservation did expire, the `RESERVATION_EXPIRED` branch below handles it. Heartbeat failures are visible in metrics; they don't silently drop budget accounting.

**Client disconnect.** The context manager's `__exit__` receives the exception on the way out. `exc_type is not None` routes to `_handle_release`, which calls `POST /v1/reservations/:id/release` with a `reason` payload (e.g., `"stream_failed"`). The reservation transitions to `RELEASED` with the reason recorded in the release event. Partial spend accounting requires one extra line — set `reservation.usage.actual_cost` before the exception propagates — but the default path is "release, don't commit." Whether that's the right accounting depends on provider behavior: if the provider short-circuited before billable generation, you didn't pay either and the release matches; if the provider generated tokens that never made it to the client, you *did* pay, and you should override `actual_cost` in the `except` block before re-raising.

**Retry double-commit.** The primary safety mechanism is idempotent replay. A commit retry that uses the same `idempotency_key` and same body returns the server's original successful response — the operation isn't applied twice. The agent framework's retry logic doesn't need to know about Cycles; the protocol handles the happy path.

Three error codes cover the edge cases where replay isn't what's happening:

- `RESERVATION_FINALIZED` — the reservation is already in a terminal state but the current request is not a same-key replay (e.g., a second client trying to commit against an already-committed reservation). The retry handler logs it and treats it as finalised — no double-debit.
- `RESERVATION_EXPIRED` — the late commit returns `410 RESERVATION_EXPIRED`. Whatever the expiry path already did governs the ledger; the commit itself doesn't retro-apply. The operator sees the expiry event; the retry handler logs and moves on.
- `IDEMPOTENCY_MISMATCH` — the retry sent the same key with a different payload. The handler logs explicitly and does *not* release, because releasing would double-account.

## Reserve in USD, not tokens: the unit mistake in streaming LLM budgets

A naive streaming wrapper reserves in *tokens* because that's what the LLM SDK reports. Cycles lets you reserve in any unit — `TOKENS`, `USD_MICROCENTS`, `CREDITS`, `RISK_POINTS` — and the right choice for LLM budgets is *not* tokens. It's USD_microcents, with a `cost_fn` that converts token counts to cost at request time.

Why: token counts are not comparable across models. 10,000 GPT-4o tokens and 10,000 Claude Sonnet tokens cost very different amounts. If your budget is "$5.00 per user per day," reserving in tokens means your budget cap moves every time the underlying model pricing changes, or every time the agent routes to a different model. Reserving in USD_microcents with a model-aware `cost_fn` makes the budget *model-independent*. The `cost_fn` in the streaming example — `tokens_input * 250 + tokens_output * 1000` — is the pricing for gpt-4o; swap it for the Sonnet pricing and the budget numbers don't change.

This matters specifically for streaming because streaming is when model-switching is most likely — fallback chains, cost-aware routing, provider failover. The unit choice is what keeps budget semantics stable across those transitions.

## When `cost_fn` needs more than prompt + completion tokens

The example `cost_fn` in the Python client — `tokens_input * 250 + tokens_output * 1000` — is correct for a basic `gpt-4o` chat completion. Real agent traffic has three categories of usage that break this simple arithmetic:

- **Cached input tokens.** Anthropic's final usage block includes `cache_read_input_tokens` and `cache_creation_input_tokens`, billed at different rates than fresh input. OpenAI exposes `prompt_tokens_details.cached_tokens`. A `cost_fn` that treats all prompt tokens as uncached over-charges on cached scopes and distorts attribution when the cache hit rate varies across workloads.
- **Reasoning tokens.** OpenAI's `o1`/`o3` series report `completion_tokens_details.reasoning_tokens` — invisible output the model produced internally but never streamed to the client. These are billed as completion tokens at the completion rate; a `cost_fn` that reads `chunk.usage.completion_tokens` alone will get this right, but one that counts visible output chunks will undercount.
- **Tool-use tokens.** When the model calls a tool mid-stream (OpenAI `tool_calls` deltas, Anthropic `tool_use` blocks), the tool input and the model's handling of the tool result both count as tokens. The final `usage` block reflects this; an agent framework that only sums `delta.content` lengths will miss the tool traffic entirely.

The cleanest fix is to extend `StreamUsage` with the fields you need (it has a `custom: dict` slot for exactly this) and write a `cost_fn` that reads the full provider usage shape. The pattern doesn't change; the arithmetic does.

One backpressure note while we're here: if the caller doesn't drain chunks fast enough, the stream stays open, the heartbeat keeps firing, and the reservation stays held. Slow consumers look identical to slow models from the reservation's perspective. The right-sized TTL and the heartbeat limit the blast radius, but a permanently-stuck consumer will eventually trip the max-extensions ceiling and the reservation will expire cleanly rather than hang forever.

## Trade-offs of SSE budget enforcement

Three trade-offs worth naming explicitly.

**The heartbeat adds one extend call per `ttl_ms/2`.** At a 60s TTL, that's one extra Cycles API call every 30 seconds the stream is open. Measurably cheap (~5ms per call at [current benchmark numbers](/blog/cycles-server-performance-benchmarks)), but it's not zero. If your streams are reliably under 60s, raise the TTL so the heartbeat never runs.

**The estimate is reserved, not free.** A generous estimate means that budget is unavailable for other reservations during the stream. If a single agent reserves 50,000 tokens' worth at the start of every stream and actually uses 3,000, concurrent agents on the same scope see the full 50,000 as reserved. The fix is to right-size the estimate — not "generous" as in "3× actual," but "generous" as in "p95 of actual + margin."

**Release-on-exception defaults to zero-cost attribution.** If the provider already started generating tokens before the disconnect, those tokens were paid for at the provider — but the release path doesn't record them as spend. If this matters for your billing model, set `reservation.usage.actual_cost` explicitly in the `except` block before re-raising, and the pattern becomes "commit what you used, release the rest." The default is release-on-exception because that's the safest generic behavior; if your provider billed for partial generation, override `actual_cost` and commit what was actually used.

## Bottom line

Streaming breaks four things: the timing of `usage` arrival, the TTL window, the disconnect path, and the retry semantics. Each one has a naive wrapper that silently corrupts budget accounting; each one has a concrete fix in the pattern above. The Python `StreamReservation` context manager is that pattern codified — reserve-on-enter, heartbeat during, commit-or-release on exit, idempotent retry — so the caller gets streaming budget enforcement without having to get any of the four details right on their own.

The code is in the client today; the four failure modes above are what each line is there to close.

---

*Related: [reservation TTL, grace period, and extend in Cycles](/protocol/reservation-ttl-grace-period-and-extend-in-cycles) for the TTL semantics, [retry storms and idempotency](/blog/retry-storms-and-idempotency-in-agent-budget-systems) for the retry layer, [how reserve-commit works in Cycles](/protocol/how-reserve-commit-works-in-cycles) for the non-streaming case.*
