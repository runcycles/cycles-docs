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

For long-running workflows, the recommended approach is:

1. Create a reservation with a short TTL (10–30 seconds)
2. Start a background heartbeat that calls extend at regular intervals (typically TTL / 2)
3. When work completes, commit actual usage
4. If the heartbeat stops (crash, timeout), the reservation expires naturally and budget is returned

This pattern keeps budget locked only while the client is actively running. If the client crashes, the reservation expires quickly and budget is freed.

### Example timing

- TTL: 20 seconds
- Heartbeat interval: 10 seconds (TTL / 2)
- Extension per heartbeat: `extend_by_ms: 10000`
- Grace period: 5 seconds

The client creates a reservation at T=0, expiring at T=20.

At T=10, T=20, T=30, etc., the client calls extend. Each extension adds 10 seconds to the current `expires_at_ms`, not to the time of the request: the heartbeat at T=10 moves expiry from T=20 to T=30, and the heartbeat at T=20 moves it from T=30 to T=40. The expiry stays a constant 20 seconds (the original TTL) ahead of the clock.

If the client crashes at T=25, the last successful heartbeat (at T=20) left the expiry at T=40. The reservation expires at T=40; in-flight commits and releases are still accepted through the grace period, until T=45. At T=45, the reservation is marked `EXPIRED` and budget is released.

Total lockout after crash: ~20 seconds.

Compare this to a single 10-minute TTL, where a crash at T=1 would lock budget for roughly the full 10 minutes plus grace period.

## The clients handle this automatically

The Cycles clients schedule heartbeat extensions for you: the `@cycles` decorator (Python), the TypeScript client, the `@Cycles` annotation (Java, Spring Boot starter), and the Rust client's reservation guard all do this out of the box:

- The heartbeat interval is `ttl_ms / 2` (minimum 1 second)
- Extensions run in the background (a thread or asyncio task in Python, a thread pool in Java, a tokio task in Rust)
- The heartbeat stops when the function/method returns (commit or release)

This means most users do not need to implement extend logic manually.

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

If a commit arrives after the grace period, it will be rejected. The system should handle this gracefully — retry with a new reservation if the work succeeded, or accept the loss.

### Mistake 4: Extending after TTL expires

Extend must happen before `expires_at_ms`. If the client waits too long between heartbeats, the reservation may expire before the next extend arrives.

## Summary

Reservations in Cycles are time-bounded by design:

- **TTL** controls how long budget is held
- **Grace period** provides a short safety window after TTL for in-flight commits
- **Extend** refreshes TTL as a heartbeat for long-running operations

The recommended pattern for most systems:

- Keep TTL short (10–30 seconds)
- Use extend as a heartbeat (interval = TTL / 2)
- Set grace period to 5–10 seconds
- Handle RESERVATION_EXPIRED gracefully

This keeps budget locked only while work is actively running, and recovers quickly when clients crash.

## Next steps

To explore the Cycles stack:

- Read the [Cycles Protocol](https://github.com/runcycles/cycles-protocol)
- Run the [Cycles Server](https://github.com/runcycles/cycles-server)
- Manage budgets with [Cycles Admin](https://github.com/runcycles/cycles-server-admin)
- Integrate with Python using the [Python Client](/quickstart/getting-started-with-the-python-client)
- Integrate with TypeScript using the [TypeScript Client](/quickstart/getting-started-with-the-typescript-client)
- Integrate with Spring Boot or Spring AI using the [Spring Boot starter](https://github.com/runcycles/cycles-spring-boot-starter) or the [Spring AI starter](https://github.com/runcycles/cycles-spring-ai-starter)
