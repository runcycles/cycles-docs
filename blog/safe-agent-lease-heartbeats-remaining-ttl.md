---
title: "Safe Lease Heartbeats for AI Agents"
date: 2026-08-01
author: Albert Mavashev
tags: [engineering, distributed-systems, leases, heartbeats, retries, idempotency, SDKs]
description: "Why safe agent lease heartbeats require server-authoritative remaining TTL, monotonic timing, bounded retry windows, and fresh idempotent replay responses."
blog: true
sidebar: false
featured: false
head:
  - - meta
    - name: keywords
      content: "AI agent lease heartbeat, remaining TTL, distributed lease renewal, idempotent heartbeat retry, monotonic clock scheduling, reservation extend, safe retry window"
---

# The Lease Heartbeat We Couldn't Make Safe Without One More Field

A reservation expires at an authoritative Unix timestamp. The client knows when it sent the request, when the response arrived, and how much time the server says it added.

That sounds like enough information to schedule the next heartbeat.

It was not.

While hardening long-running reservation support across the Cycles protocol, server, and four SDKs, we found that no portable client algorithm could be both safe and extension-efficient across all server policies the protocol allowed. The missing observable was not another timestamp. It was the server's current view of the lease remaining: `remaining_ttl_ms`.

This is the protocol-design story behind that field, the retry window built around it, and the idempotent-replay exception it forced through the stack.

<!-- more -->

## The job of a lease heartbeat

Cycles reservations hold budget or action authority before protected work begins. Every hold has a bounded TTL so a crashed client cannot lock capacity forever. If work lasts longer than the lease, the client calls `POST /v1/reservations/{reservation_id}/extend` as a heartbeat.

A useful heartbeat has to satisfy competing requirements:

- extend early enough that a slow or failed attempt can recover before expiry;
- avoid extending so often that it burns the tenant's extension limit;
- use the same idempotency key when a response is ambiguous;
- respect server throttling without sleeping past the provable lease window; and
- stop when another complete attempt plus margin is no longer demonstrably safe.

“Extend halfway through the TTL” works only if the client actually knows how much TTL remains.

## Why `expires_at_ms - now` is not portable

`expires_at_ms` remains the authoritative server expiry. The problem is converting it into a safe client-side duration.

The expiry is expressed in server wall-clock time. A reliable scheduler should use a client monotonic clock so an NTP adjustment or manual clock change cannot move its timer. Subtracting the client's wall clock assumes synchronization the protocol does not guarantee.

The HTTP `Date` header does not repair that assumption. It has whole-second resolution, may be generated at different points during response creation, and can be replaced by intermediaries. It is useful transport metadata, not a lease-scheduling clock.

Even perfect clocks would leave another ambiguity: server policy can change what “extend by 60 seconds” means in practice.

## Two legal server regimes

Consider two servers that both accept a request to extend by 60 seconds.

An **additive-delta server** advances the existing expiry:

```text
new expiry = previous expiry + granted extension
```

An early heartbeat can accumulate lead on this server. Extending sooner may create more room for later recovery.

A **maximum-lead server** clamps the new expiry relative to its current time:

```text
new expiry = min(candidate expiry, server now + policy maximum lead)
```

An early heartbeat cannot accumulate lead beyond the policy ceiling. It may consume one of a finite number of extensions while barely moving the expiry.

Both behaviors are useful. A tenant may cap each requested extension, cap total lead, or do both. But the correct client cadence differs between them.

We tried to infer the regime from the granted expiry change and elapsed time. That works for some histories, not all legal histories. A maximum-lead server can echo the client's call spacing, including spacing that looks like an additive grant. Initial TTL policy can also hide the lead the client thought it requested.

The conclusion was stronger than “our heuristic needs tuning”: without the server returning its current remaining lead, no portable algorithm can guarantee both safe renewal and efficient extension use across every allowed policy regime.

## The missing observable: `remaining_ttl_ms`

Successful create and extend responses can now carry:

```json
{
  "expires_at_ms": 1785585660000,
  "remaining_ttl_ms": 60000
}
```

`expires_at_ms` answers **when the server says the lease expires**. `remaining_ttl_ms` answers **how much lead the server observed while constructing this response**.

The field is optional for rolling compatibility with older servers, but it is the normative scheduling input whenever present. A client recomputes its schedule from every exact, schema-valid successful create or extend response. It does not carry forward a cadence inferred from an earlier response.

## Turning remaining lead into a safe delay

The client first measures the individual attempt with a monotonic clock:

```text
rtt = monotonic response_received - monotonic attempt_sent
lead_floor = max(0, remaining_ttl_ms - rtt)
```

Subtracting the complete round trip is conservative. Some or all of that time may have elapsed after the server measured the value. The result is a lower bound, not an optimistic estimate.

The client then budgets for failure:

```text
attempt_budget = max(
  enforced request timeout,
  1000ms,
  2 × maximum observed rtt
)

safety_margin = max(
  1000ms,
  2 × maximum observed rtt
)

retry_reserve = 2 × attempt_budget + safety_margin
next_delay = max(0, lead_floor - retry_reserve)
```

Why reserve two attempts? The next scheduled extension can fail after consuming its full timeout, and an ambiguous failure must leave room for recovery with the same key. The safety margin covers scheduling and network uncertainty around those attempts.

All of this arithmetic uses milliseconds, must not wrap on overflow, and rounds in the conservative direction: budgets and margins up, lead and delays down.

## Request timeout is part of lease correctness

This calculation exposed an operational dead zone in an otherwise common configuration.

With the default 60-second lease and a 30-second enforced request timeout:

```text
retry_reserve >= 2 × 30s + 1s = 61s
```

The reserve is already longer than the lease before subtracting the successful attempt's RTT. Every success therefore produces `next_delay = 0`. The client cannot establish a positive safe cadence.

With a 10-second timeout, a 1.5-second maximum observed RTT, and a 60-second `lead_floor`:

```text
attempt_budget = 10s
safety_margin = 3s
retry_reserve = 23s
next_delay = 37s
```

The exact cadence still depends on the response's current lead and measured RTT. The lesson is the important part: an HTTP timeout is not merely a transport preference when the request renews a lease. It determines whether recovery can fit inside the lease at all.

Official SDK defaults use finite attempt budgets well below 30 seconds. Deployments that shorten reservation TTLs must shorten their extend timeout accordingly.

## A failed heartbeat gets a shrinking window

After a timeout, connection failure, 5xx, 429, or ambiguous 2xx, the client starts from the last schema-valid response and deducts all elapsed monotonic time:

```text
current_lead = max(0, last lead_floor - elapsed_since_valid_response)
retry_window = current_lead - attempt_budget - safety_margin
```

If `retry_window` is negative, no complete retry plus margin is provably safe. The client stops and surfaces the failure.

For a timeout, connection error, 5xx, or ambiguous 2xx, the next recovery delay is bounded by all three values:

```text
retry_delay = min(30000ms, current_lead / 4, retry_window)
```

The client may continue recovery while a freshly recomputed window remains positive. Each failed attempt consumes time, so every decision must recalculate the window rather than reuse the previous one.

A zero window permits one immediate recovery attempt. If that attempt also fails before an intervening success, the client stops even if coarse timer resolution still reports zero elapsed time. It also stops if neither elapsed time nor the retry window decreases between failures. That progress guard prevents a zero-time retry loop.

## The idempotency key depends on what happened

Two immediate retries can look similar while requiring opposite key behavior:

| Situation | Key behavior | Bound |
|---|---|---|
| Extend failed or returned an ambiguous response | Reuse the same key | Retry only inside the recomputed safe window |
| Extend succeeded but produced `next_delay = 0` | Use a fresh key for the next logical extension | Permit one immediate fresh extension, then stop if its success also produces zero delay |

Reusing the key after an ambiguous response prevents a lost-response extend from being applied twice. Using a fresh key after a proven success represents a genuinely new extension.

The two-consecutive-zero-success guard matters for maximum-lead servers. Without it, a client whose retry reserve is longer than the policy lead could consume all permitted extensions in a tight loop without creating more safety.

If monotonic attempt timing is unavailable, the field-bearing client cannot pretend the request took zero time or fall back to the older heuristic. Unknown timing produces no provable positive delay and reaches the same zero-delay guard.

## `Retry-After` does not override lease safety

HTTP 429 adds another clock to the problem: the server's requested delay.

The Cycles contract accepts a non-negative delta-seconds `Retry-After` for heartbeat recovery. The client retries only if that delay fits inside the freshly computed `retry_window`.

If the header is missing, invalid, overflows during conversion, or asks the client to wait longer than the safe window, the client does not invent an earlier retry that would violate throttling. It stops and reports that the lease cannot be safely renewed.

The HTTP-date form is intentionally unsupported here. Converting it into a safe monotonic delay would reintroduce the wall-clock assumptions the algorithm was designed to avoid.

Other 4xx responses stop and surface without rotating the idempotency key. Permanent reservation conditions—expired, finalized, maximum extensions reached, tenant closed, or not found—also stop the heartbeat.

## The replay response cannot be entirely byte-identical

Idempotency usually means returning the original successful response verbatim. `remaining_ttl_ms` required one narrow exception.

Consider a lost response:

```text
Client                         Server
  |--- EXTEND key=A ----------->|  extension applied
  |        response lost        X
  |                             |
  |--- EXTEND key=A ----------->|  idempotent replay
  |<-- original outcome + ------|
  |    fresh remaining_ttl      |
```

If the server replayed the originally stored remaining TTL, it would already be stale by at least the recovery delay. A client could schedule from lead that no longer exists.

The server therefore returns the original successful response except for `remaining_ttl_ms`, which it recomputes from the original expiry and current authoritative server time. It returns zero when the reservation is no longer active. It may conservatively understate lead when a later, separately keyed extension moved the expiry outward; understating is safe, overstating is not.

This field is volatile transport metadata, so it is excluded from the signed CyclesEvidence payload. Recomputing it cannot change the evidence identity for the original decision.

The exception also caught assumptions in the implementation. Server replay tests that compared entire bodies byte-for-byte had to compare equality modulo this one field and pin the safe direction: replayed remaining TTL must not exceed the original observation for the same expiry.

## Why older servers deliberately behave differently

Older servers do not return `remaining_ttl_ms`. Official SDKs retain a bounded measured-grant heuristic for compatibility, but it is explicitly non-normative and best effort.

The fallback prefers bounded over-beating—and eventual extension-budget exhaustion—over silently allowing an unobservable lease lapse. The primary path makes the opposite-looking choice: when authoritative data proves that another attempt cannot fit, it stops.

That asymmetry is deliberate:

- the field-bearing path can prove when safety is gone;
- the fieldless path cannot prove the current lead and chooses the more conservative liveness heuristic.

The fallback is not equivalent safety, and clients must not enter it merely because their own monotonic timing is unavailable.

## One algorithm across four SDKs

The final contract was implemented across Python, TypeScript, Java/Spring, and Rust. When the field is present, all four official lifecycle helpers use per-attempt RTT, their enforced finite HTTP timeout, the retry reserve, shrinking same-key recovery window, 429 bound, progress guard, and consecutive-zero-delay guard.

Heartbeat failures remain observable without canceling work that was already authorized. If the stopped heartbeat lets the reservation expire before known usage can be committed, the [durable settlement fallback](/protocol/sdk-settlement-recovery-and-durability) records that usage through an idempotent direct event.

The shared [recovery conformance matrix](/protocol/sdk-recovery-conformance) verifies the surrounding failure behavior across all four SDKs. The normative algorithm itself lives in the protocol; the [TTL and extend guide](/protocol/reservation-ttl-grace-period-and-extend-in-cycles) translates it into operational configuration.

## The broader lesson

Distributed lease APIs often expose an expiry timestamp and leave heartbeat cadence as “client policy.” That is sufficient only when the protocol also constrains clocks, server extension semantics, timeout budgets, and replay behavior tightly enough for the client to reason safely.

Cycles did not constrain all of those variables, and some flexibility was intentional. The right fix was not a smarter client guess. It was one more server-authoritative observation, paired with an algorithm that treats uncertainty as consumed lease time.

The field is small. The contract around it is not. That contract is what turns a heartbeat from a timer into a bounded safety argument.

---

*Related: [what we had to prove before putting runtime authority in the critical path](/blog/proving-a-critical-path-agent-safety-gate), [reservation TTL and extend operations](/protocol/reservation-ttl-grace-period-and-extend-in-cycles), and [retry storms and idempotency](/blog/retry-storms-and-idempotency-in-agent-budget-systems).*
