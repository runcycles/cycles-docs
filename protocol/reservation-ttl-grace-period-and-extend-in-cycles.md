---
title: "Reservation TTL, Grace Period, and Extend in Cycles"
description: "How reservation time-to-live, grace periods, and the extend operation prevent phantom budget consumption in Cycles. Configure TTL and handle long-running tasks."
---

# Reservation TTL, Grace Period, and Extend in Cycles

Reservations in Cycles do not live forever.

Every reservation has a time-to-live (TTL). When the TTL (plus grace period) elapses without a commit or release, the reservation expires and the held budget returns to the available pool.

This is by design.

Without TTL, a crashed client or lost network connection could lock budget indefinitely. That would create phantom consumption — budget that appears used but is not serving any real work.

TTL prevents that. But it also creates a design question: how should long-running work keep its reservation alive?

That is where extend comes in.

## How TTL works

When a reservation is created, the server sets an expiration time:

```
expires_at_ms = created_at_ms + ttl_ms
```

The default TTL is 60 seconds (`ttl_ms: 60000`). The allowed range is 1 second to 24 hours (`1000` to `86400000` milliseconds).

Tenant-level TTL controls are reference-server behavior, not part of the v0 protocol: through the Admin API, tenant administrators can change the default with `default_reservation_ttl_ms` and restrict the range with `max_reservation_ttl_ms` — any requested TTL exceeding the tenant maximum is capped automatically.

When server time passes `expires_at_ms`, the reservation has expired: it can no longer be extended. In-flight commits and releases are still accepted during the grace period (below). Once the grace period has also elapsed without a commit or release, the server marks the reservation `EXPIRED` and returns the reserved budget to the available pool.

## How grace period works

Real systems have in-flight operations. A commit request may be in transit when the TTL expires.

The grace period provides a short window after TTL expiration during which commits and releases are still accepted:

```
hard_expiry = expires_at_ms + grace_period_ms
```

The default grace period is 5 seconds (`grace_period_ms: 5000`).

The allowed range is 0 to 60 seconds (`0` to `60000` milliseconds).

During the grace period:

- commit and release are still accepted
- extend is not accepted (the reservation must be extended before TTL expires)

After the grace period, the reservation is marked `EXPIRED`. Any attempt to commit or release returns `410 RESERVATION_EXPIRED`. (Expiry is not a finalization — only `COMMITTED` and `RELEASED` are finalized states, which is why an expired reservation returns `410 RESERVATION_EXPIRED` rather than `409 RESERVATION_FINALIZED`.)

### Why the grace period maximum is 60 seconds

The 60-second ceiling is an interoperability constraint. Longer grace periods would extend the window during which a crashed client can keep budget locked, increasing the risk of zombie reservations.

For operations that need more time, use extend as a heartbeat rather than relying on a long grace period.

## How extend works

`POST /v1/reservations/{reservation_id}/extend` extends the TTL of an active reservation.

The `extend_by_ms` parameter is added to the current `expires_at_ms` (not to the request time):

```
new_expires_at_ms = current_expires_at_ms + extend_by_ms
```

The allowed range for `extend_by_ms` is 1 millisecond to 24 hours (`1` to `86400000` milliseconds).

Extend requires an `idempotency_key`. Replaying the same request with the same idempotency key returns the original response.

### What extend does not change

Extend updates only the expiration time. It does not change:

- the reserved amount
- the unit
- the subject
- the action
- the scope path
- the affected scopes

The reservation is the same reservation. It just lives longer.

### Error conditions

- If the reservation is already `COMMITTED` or `RELEASED`: `409 RESERVATION_FINALIZED`
- If the reservation has already expired (past `expires_at_ms`): `410 RESERVATION_EXPIRED`
- If the tenant's `max_reservation_extensions` limit has been reached: `409 MAX_EXTENSIONS_EXCEEDED`
- If the reservation was never created: `404 NOT_FOUND`

Note: extend must happen before TTL expires, not during the grace period. The grace period only covers commit and release.

### Extension limits

Tenant administrators can set `max_reservation_extensions` via the Admin API to limit how many times a single reservation can be extended (default: 10). This prevents infinite zombie reservations from clients that heartbeat indefinitely without committing or releasing.

## The heartbeat pattern

For long-running workflows:

1. Create a reservation with a bounded TTL
2. Schedule heartbeat extensions from the server's returned remaining lifetime
3. When work completes, commit actual usage
4. If the heartbeat stops (crash, timeout), the reservation expires naturally and budget is returned

This pattern keeps budget locked only while the client is actively running. If the client crashes, the reservation expires quickly and budget is freed.

### Server-authoritative scheduling

Since runtime spec revision 0.1.25.16, successful create and extend responses can carry `remaining_ttl_ms`. It is computed from the authoritative server clock and is the normative scheduling input whenever present.

Recompute the schedule from every exact, schema-valid HTTP `200` create or extend response:

```text
rtt = monotonic receive time - monotonic send time
lead_floor = max(0, remaining_ttl_ms - rtt)
attempt_budget = max(enforced request timeout, 1000ms, 2 × max observed rtt)
safety_margin = max(1000ms, 2 × max observed rtt)
retry_reserve = 2 × attempt_budget + safety_margin
next_delay = max(0, lead_floor - retry_reserve)
```

The reserve leaves room for one failed attempt, a same-key recovery attempt, and scheduling/network margin. For example, a returned 60-second lead, 10-second request timeout, and 1.5-second maximum observed RTT produce a 23-second retry reserve and a cadence of about 37 seconds.

::: warning Keep extend timeouts well below the lease
The default 60-second TTL cannot support a safe positive delay if one extend attempt may consume 30 seconds: the retry reserve is at least 61 seconds. Configure the enforced per-extend timeout well below half the smallest expected lease. Current official SDK defaults use finite 7–12 second attempt budgets.
:::

After a timeout, connection failure, 5xx, 429, or malformed/other 2xx response, the client keeps the same idempotency key and recomputes the retry window from the last valid server response:

```text
current_lead = max(0, last lead_floor - monotonic elapsed time)
retry_window = current_lead - attempt_budget - safety_margin
```

For a timeout, connection error, 5xx, or ambiguous 2xx, the recovery delay is:

```text
retry_delay = min(30000ms, current_lead / 4, retry_window)
```

The client may keep retrying while the freshly recomputed window is positive. A zero window permits one immediate same-key recovery attempt; if that also fails before an intervening success, the client stops. A negative window proves that no complete attempt plus margin fits. The client also stops if neither monotonic elapsed time nor the window decreases between consecutive failures, which prevents a coarse-clock zero-time loop.

A 429 delay is honored only when a valid non-negative delta-seconds `Retry-After` fits inside the window; the heartbeat does not accept the HTTP-date form or invent an earlier retry. Any other 4xx stops and surfaces without rotating the key.

If the initial create is ambiguous, no valid lead exists yet. The client makes at most one immediate retry with the same create key, then stops and surfaces if that retry is also ambiguous.

If a valid response produces zero delay, one immediate extension with a fresh key is allowed. A second consecutive zero-delay success stops the heartbeat instead of burning the server's extension limit in a tight loop. Missing or unreliable monotonic timing also produces zero delay and therefore reaches this guard.

### Same-key replay and `remaining_ttl_ms`

A successful create or extend replay returns the original response except for `remaining_ttl_ms`, which the server recomputes when constructing the replay. The value is `0` when the reservation is no longer active and may conservatively understate lead if a later, separately keyed extension moved expiry farther out.

This field is volatile transport metadata. It is deliberately excluded from the CyclesEvidence payload, so recomputing it does not change the original evidence identity.

### Older servers without the field

When `remaining_ttl_ms` is absent, a client cannot reliably infer the true lease from `expires_at_ms`: server policy may cap either each extension grant or the maximum lead beyond server time. The official SDKs retain a bounded measured-grant heuristic as a non-normative, best-effort fallback. The exact schema-valid HTTP `200` success rule still applies; only scheduling changes.

The fallback intentionally prefers over-beating and possible extension-budget exhaustion over an unobservable lease lapse. This differs from the field-bearing path, which has enough information to prove when no safe retry fits and stop. Do not use the fallback merely because local monotonic timing is unavailable; a field-bearing response still requires the primary algorithm.

## The clients handle this automatically

Python `@cycles`, TypeScript `withCycles`, Spring `@Cycles`, and Rust `ReservationGuard` schedule extensions in the background and stop the heartbeat when the lifecycle closes.

Heartbeat failures use a warning policy: each failure reports the reservation ID and retry/stop disposition, but it does not cancel the guarded work or suppress final settlement. Recoverable failures retry with the same key. Permanent conditions — `RESERVATION_EXPIRED`, `RESERVATION_FINALIZED`, `MAX_EXTENSIONS_EXCEEDED`, `TENANT_CLOSED`, and `NOT_FOUND` — stop the heartbeat.

If known spend reaches commit after the reservation expires, current SDK lifecycle helpers recover it through a durable `POST /v1/events` fallback. See [SDK Settlement Recovery and Durability](/protocol/sdk-settlement-recovery-and-durability).

## Choosing TTL values

### Short TTL (10–30 seconds)

Best for:

- model calls and tool invocations that complete quickly
- actions with predictable duration
- systems where fast budget recovery matters

### Medium TTL (30–120 seconds)

Best for:

- multi-step workflows
- actions with moderate latency
- systems using heartbeat extension

### Long TTL (2–60 minutes)

Best for:

- batch processing
- background jobs with known duration
- systems where extend is not practical

Use long TTLs sparingly. They increase the risk of zombie reservations.

## Choosing grace period values

### Default (5 seconds)

Sufficient for most synchronous operations where commits arrive shortly after execution.

### Higher (10–30 seconds)

Useful for:

- streaming model calls with high latency
- slow external APIs
- actions where commit may be delayed by processing

### Zero

Use zero grace period when:

- strict TTL enforcement is required
- the client always commits well before expiration
- zombie prevention is a priority

## Common mistakes

### Mistake 1: Using large TTLs instead of heartbeats

A 10-minute TTL works but locks budget for the full duration if the client crashes. Prefer short TTLs with extend.

### Mistake 2: Relying on grace period for normal operation

The grace period is a safety net, not a design tool. If commits routinely arrive during the grace period, the TTL is too short.

### Mistake 3: Forgetting to handle RESERVATION_EXPIRED

If a commit arrives after the grace period, it is rejected. Do not create a new reservation after the work already ran; that would treat completed work as new authorization. Recover known spend as an idempotent direct event. Current official SDK lifecycle helpers do this automatically and persist the recovery across restart.

### Mistake 4: Extending after TTL expires

Extend must happen before `expires_at_ms`. If the client waits too long between heartbeats, the reservation may expire before the next extend arrives.

## Summary

Reservations in Cycles are time-bounded by design:

- **TTL** controls how long budget is held
- **Grace period** provides a short safety window after TTL for in-flight commits
- **Extend** refreshes TTL as a heartbeat for long-running operations

The recommended pattern for most systems:

- Keep TTL bounded and choose an enforced request timeout that leaves room for the retry reserve
- Schedule from `remaining_ttl_ms` whenever the server supplies it
- Reuse the same idempotency key for ambiguous extend recovery
- Set grace period to 5–10 seconds
- Recover known spend through an idempotent event if commit reaches an expired reservation

This keeps budget locked only while work is actively running, and recovers quickly when clients crash.

## Next steps

To explore the Cycles stack:

- Read the [Cycles Protocol](https://github.com/runcycles/cycles-protocol)
- Run the [Cycles Server](https://github.com/runcycles/cycles-server)
- Manage budgets with [Cycles Admin](https://github.com/runcycles/cycles-server-admin)
- Integrate with Python using the [Python Client](/quickstart/getting-started-with-the-python-client)
- Integrate with TypeScript using the [TypeScript Client](/quickstart/getting-started-with-the-typescript-client)
- Integrate with Spring Boot or Spring AI using the [Spring Boot starter](https://github.com/runcycles/cycles-spring-boot-starter) or the [Spring AI starter](https://github.com/runcycles/cycles-spring-ai-starter)
