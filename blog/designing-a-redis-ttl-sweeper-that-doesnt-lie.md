---
title: "Designing a Redis TTL Sweeper That Doesn't Lie"
date: 2026-04-17
author: Albert Mavashev
tags: [engineering, architecture, operations, redis, lua, background-jobs, ttl]
description: "A Redis TTL sweeper must avoid duplicate action, missed candidates, and clock-skew errors. Learn seven correctness properties and two production bugs."
blog: true
sidebar: false
featured: false
head:
  - - meta
    - name: keywords
      content: "redis ttl sweeper, expire.lua, reservation expiry, background job design, redis keyspace notifications, zrangebyscore sweep, grace period expiry, atomic expiry lua, orphan ttl cleanup, clock skew redis"
---

# Designing a Redis TTL Sweeper That Doesn't Lie

A "TTL sweeper" is any background job whose job is to find entries that have expired and transition them to a terminal state. Reservations, sessions, locks, bookings, pending jobs — the shape is always the same. You have an ordered index of deadlines; periodically you look at the ones that have passed; for each one you do *something* that must not be undone.

Getting this wrong is easy. A sweeper that misses candidates silently underbills. A sweeper that double-acts corrupts the ledger. A sweeper that blocks on OOM stops sweeping at exactly the moment it was designed for — right after an outage, when the backlog is largest. A sweeper that trusts the app-server clock over the database clock will expire things early under skew.

This post documents the design we ended up with in Cycles — a 132-line Java service calling a 64-line Lua script — plus the seven properties that design enforces, and the two bugs we shipped and fixed before the design was actually right.

<!-- more -->

## What a correct sweeper has to do

Seven properties a correct sweeper needs to enforce:

1. **Never miss a candidate.** Every entry past its deadline eventually gets swept.
2. **Never act twice on the same entry.** Two sweeper instances, or two passes of one, must not double-debit.
3. **Never block on OOM.** The backlog after a two-hour outage must not crash the process trying to sweep it.
4. **Respect the grace window.** Some systems allow late commits within a post-deadline grace period. The sweeper must not touch an entry that is still eligible.
5. **Tolerate clock skew.** The decision of "is this past its deadline?" cannot depend on the app server's wall clock being in sync with the Redis clock.
6. **Clean up its own index orphans.** If the entry in the index points to something that no longer exists, the index entry has to go away.
7. **Leave an audit trail.** An operator six days later must be able to reconstruct "this thing was expired, at this time, and its state at the moment of expiry was this."

Each of the seven is a failure mode waiting to happen if you ignore it. What follows is how we enforce all seven.

## Why not Redis keyspace notifications

The obvious Redis-native answer is `notify-keyspace-events` — subscribe to `__keyevent@0__:expired`, let Redis tell you when a TTL fires. We didn't use it. Three reasons:

- **Fire-and-forget.** If your subscriber is disconnected when Redis emits the notification, the event is gone. There is no replay. For an authoritative ledger, this is a non-starter — the budget has to be released even if your service restarted five seconds ago.
- **Off by default.** `notify-keyspace-events` is empty by default on most managed Redis (AWS ElastiCache, Azure Cache, Redis Cloud). Teams adopting Cycles would have to enable a config flag on their Redis, which we can't require.
- **No durable, queryable ordering.** Notifications fire when the eviction happens, which is whenever Redis gets around to it. You can't ask "what expired between 12:00:00 and 12:00:05?" The answer is whatever the subscriber happened to see.

Keyspace notifications are fine for observability — a log stream saying "stuff is expiring." They are the wrong primitive for cleanup that has to stay consistent with a ledger.

## The design: ZSET + scheduled poll + atomic Lua

Three pieces:

**A sorted set, `reservation:ttl`, keyed by `expires_at_ms`.** Every reservation that enters ACTIVE state writes its id into this zset with its deadline as the score. The sweeper reads candidates from here; the Lua scripts on commit/release/extend paths maintain it (removing entries when a reservation reaches a terminal state without expiring).

**A scheduled Spring poll, every 5 seconds.** `ReservationExpiryService.expireReservations()` runs on `@Scheduled(fixedDelayString = "${cycles.expiry.interval-ms:5000}")`. Each poll:

```java
long now = redisTime(jedis);   // Redis TIME, not System.currentTimeMillis
List<String> candidates = jedis.zrangeByScore(
    "reservation:ttl", 0, now, 0, SWEEP_BATCH_SIZE);  // SWEEP_BATCH_SIZE = 1000
```

Two things matter in those three lines. First, `now` comes from `jedis.time()` — the Redis server's clock — not the app server's. Second, `ZRANGEBYSCORE` is bounded at 1,000 per sweep. Anything more is intentionally left for the next tick. This is the OOM fix covered below.

**Per-candidate atomic Lua.** Each candidate id is passed to `expire.lua` via `EVALSHA`. The script is the only thing allowed to make the decision and perform the mutation, because the decision ("is this still ACTIVE? is it past grace?") and the mutation ("release the reserved budget, set state=EXPIRED") must be atomic. Doing them in two round-trips from Java would reopen the race.

That's the whole architecture. The rest is what happens inside the Lua script.

## What expire.lua actually enforces

`expire.lua` has four possible return states. Each one corresponds to a specific situation the sweeper can find itself in:

**NOT_FOUND.** The zset entry points to a reservation hash that no longer exists. This happens if the reservation was cleaned up by some other path and the zset entry was left behind, or if a bug removed the hash but not the index. The script `ZREM`s the orphan from `reservation:ttl` and returns. The sweeper does not get stuck in a loop on a dead reference.

**SKIP with state.** The reservation exists but is no longer ACTIVE — it was COMMITTED or RELEASED by a legitimate client call while the sweep was in flight. The script `ZREM`s the zset entry (whoever transitioned it should have removed it, but this is a belt-and-braces safety) and returns. Critically, no budget mutation occurs. The commit that happened already moved the ledger correctly; the sweeper must not touch it again.

**SKIP with `in_grace_period`.** The reservation is past `expires_at` but within `expires_at + grace_ms`. A late commit is still eligible. The script returns without mutating anything. The next sweep, 5 seconds later, will check again. Eventually either a commit lands (and the next sweep sees it as SKIP/COMMITTED) or the grace window closes (and the next sweep actually expires it).

**EXPIRED.** The real path. The reservation is ACTIVE and past `expires_at + grace_ms`. The script releases the reserved budget back to every budgeted scope via `HINCRBY`, sets `state=EXPIRED` and `expired_at=now`, removes the zset entry, and sets a 30-day `PEXPIRE` on the reservation hash. The 30-day TTL is the audit trail — the hash stays queryable for a month for post-hoc operator inspection, then Redis reclaims it automatically.

One detail that matters disproportionately: the script uses `redis.call('TIME')` for `now`, not the value Java passed in. The comment at the top of `expire.lua` explains why:

> Use Redis TIME for consistency with reserve/commit/release/extend scripts, which all use Redis TIME for expires_at comparisons. Using Java-provided time (ARGV[2]) could cause clock-skew issues between the app server and Redis.

Every decision point in the protocol uses the same clock. The sweeper cannot expire something early because its host drifted forward.

## Two bugs we shipped — and how we caught them

The design above is what we run today. It's not what we shipped first.

**Bug 1: unbounded `ZRANGEBYSCORE`.** The original sweep was `jedis.zrangeByScore("reservation:ttl", 0, now)` — no `LIMIT`. Under normal operation this was fine because the 5-second interval kept the candidate list short. Under abnormal operation — a two-hour outage of the sweep thread, a Redis failover that paused processing, a leaked ACTIVE from a prior bug — the candidate list could be arbitrarily large. A sufficiently bad day would load millions of reservation ids into the Java process heap at once and OOM it right before the sweep got to do any work. The fix is the three-character change that's now in the code:

```java
SWEEP_BATCH_SIZE = 1000;
candidates = jedis.zrangeByScore("reservation:ttl", 0, now, 0, SWEEP_BATCH_SIZE);
```

The backlog drains across successive sweeps. A 100,000-entry backlog clears in ~9 minutes at a 5-second interval. The sweeper never OOMs on its own input.

**Bug 2: the dormant `res_` prefix.** The newer code — the `emitExpiredEvent` path that produces the `reservation.expired` webhook event — called `jedis.hgetAll("reservation:" + reservationId)`. The correct key is `"reservation:res_" + reservationId`. (The zset stores bare ids; the hash key is prefixed.)

`HGETALL` on a missing key does not throw. It returns an empty map. So the method checked "is the map empty?" at the top, found yes, and returned. No event was emitted. The ledger was still correct — `expire.lua` ran fine, the budget was released, the state transitioned to EXPIRED — but the event emission silently no-op'd for every real expiry. A subscriber waiting for `reservation.expired` webhooks would never receive one.

This bug was dormant in production until v0.1.25.10. We caught it only when the new `cycles.reservations.expired` Micrometer counter test asserted the counter incremented on a real sweep and it didn't. The counter emission lives in the same method as the event emission; both were wrong in the same way; the test dragged both into the light.

The lesson generalized cleanly: **a silent no-op is the worst failure mode, and observability only catches it when an assertion forces the signal.** We now have a counter assertion on every mutation path that produces a user-visible effect. If the counter should go up and doesn't, the test fails. If there's no counter at all, the observability gap is the bug.

## How we test the sweeper

The service layer is covered by `ReservationExpiryServiceTest`. The interesting tests are one level deeper — `ExpireLuaConformanceTest` calls `expire.lua` directly via `EVAL`, bypassing the Java service entirely. Eight tests across six nested groups:

- Only `ACTIVE → EXPIRED` transitions occur. A COMMITTED reservation handed to `expire.lua` returns SKIP, not EXPIRED.
- Reserved budget is released at every budgeted scope (not just the leaf), and by exactly the reserved amount.
- The grace period is honoured — a reservation 1ms into grace returns `in_grace_period`; 1ms past grace returns `EXPIRED`.
- Idempotent re-invocation is a no-op. The script run on an already-EXPIRED reservation does not double-release the budget.
- `NOT_FOUND` cleans the TTL index. Calling `expire.lua` on a reservation id whose hash was deleted removes the orphan zset entry.

And the one that matters most:

> The script uses `redis.call('TIME')` exclusively.

Proved by passing a bogus client-supplied time as a second ARGV and confirming the script ignores it. This is the test that turns "we intended to be clock-skew resistant" into "we actually are." Clock-skew resistance that lives only in a code comment is not resistance.

## Bottom line

TTL sweepers are easy to get wrong in ways that are invisible until they're expensive. The seven properties — don't miss, don't double-act, don't OOM, respect grace, tolerate skew, clean orphans, leave an audit trail — aren't a style guide; each one is a failure mode that turns into a production incident when it goes wrong.

The design that enforces all seven isn't exotic: a sorted set for the index, a bounded scheduled poll, atomic Lua for the decision-and-mutation. The correctness lives inside that Lua. The tests worth writing are the conformance tests that call it directly and assert each property in isolation.

And the bugs worth writing down are the ones you shipped. If the post made you think the design was always right, the post is lying.

---

*More on the substrate these scripts run on: [Why Cycles runs budget authority on Redis Lua](/blog/why-cycles-runs-budget-authority-on-redis-lua). More on how we check the invariants the substrate promises: [Why we added property tests to Cycles' budget authority](/blog/why-we-added-property-tests-to-cycles-budget-authority).*
