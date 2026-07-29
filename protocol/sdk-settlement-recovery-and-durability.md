---
title: "SDK Settlement Recovery and Durability"
description: "How official Cycles SDK lifecycle helpers preserve known actual usage across ambiguous commits, reservation expiry, rate limits, credential failures, and process restarts."
---

# SDK Settlement Recovery and Durability

A reservation protects budget before work starts. Settlement records what the work actually consumed after it runs. Once actual usage is known, losing that settlement would undercount spend even though the provider or tool already performed the work.

The official Python 0.5.2+, TypeScript 0.4.2+, Java/Spring 0.3.2+, and Rust 0.3.2+ SDK lifecycle helpers implement the Cycles [durable recovery profile](https://github.com/runcycles/cycles-protocol/blob/main/client-recovery/PROFILE.md). They persist unresolved known-actual settlement before the first request and replay it with the original idempotency key until the outcome is proven.

## Where the guarantee starts

The durability guarantee starts only after the lifecycle helper knows the actual amount and begins commit or direct-event settlement.

If the process dies before the provider returns usage, the SDK does not know what amount to settle. Applications that need convergence across that boundary must durably checkpoint the provider receipt or actual usage before acknowledging the downstream operation.

::: warning Lifecycle helpers and low-level clients differ
The automatic guarantee belongs to helpers that own the reserve → execute → settle flow: Python `@cycles` and streaming contexts, TypeScript `withCycles` and stream handles, Spring `@Cycles`, and Rust `ReservationGuard`.

Low-level `commit` and `createEvent` methods expose the idempotent protocol primitives but do not persist application-owned requests automatically. Direct callers must supply equivalent durable retry storage.
:::

## Recovery choreography

Once actual usage is known, a conforming lifecycle helper follows this sequence:

1. Build the commit request and its same-key `/v1/events` fallback.
2. Atomically persist the unresolved settlement before the first request leaves the process.
3. Send the commit.
4. Remove the record only after a proven settlement success or a genuine, understood terminal rejection.
5. Retain and replay the record after an ambiguous outcome, authentication failure, unclassifiable 4xx response, retry exhaustion, or restart.

Only an exact, schema-valid HTTP `200` commit response proves commit success. Only an exact, schema-valid HTTP `201` event response proves fallback success. A malformed body or another 2xx status remains ambiguous and is retried with the original idempotency key.

The SDK never releases a reservation merely because settlement is ambiguous or credentials failed after the action ran. Releasing at that point would return budget for spend that may already have occurred.

## Expired commits become direct events

If commit returns HTTP `410` or `RESERVATION_EXPIRED`, the reservation hold has already been reclaimed. Retrying that reservation cannot record the spend.

The lifecycle helper therefore switches the durable record to event mode before calling `POST /v1/events`. The event preserves the original subject, action, actual amount, metrics, metadata, and idempotency key, and adds recovery metadata such as `recovered_reservation_id`.

Commit and direct-event idempotency are scoped to their respective endpoints. Reusing the stored key makes repeated recovery safe, including concurrent replay by multiple processes.

## Journal behavior

Durable recovery is enabled by default and uses `~/.runcycles/commit-journal` unless configured otherwise.

- Records are written atomically and use `v2-<sha256-of-exact-UTF-8-reservation-id>.json` filenames.
- Malformed or unsupported-version records are quarantined without preventing other valid records from replaying.
- A persisted HTTP 429 `Retry-After` becomes an absolute not-before time, so restart does not retry early.
- Records are partitioned by server and principal. Configure the tenant identity so the partition remains stable across API-key rotation.
- API keys are not stored in journal records.
- Journal files contain settlement data, including subject, action, actual usage, and metadata. Protect the directory as sensitive application state and avoid putting secrets in metadata.

If journal I/O fails, the SDK reports the durability failure and may still attempt synchronous settlement. It cannot promise restart recovery for a record that was never written.

## Configuration and shutdown

| SDK | Journal settings | Bounded drain |
|---|---|---|
| Python | `journal_enabled`, `journal_dir`, `retry_flush_timeout` | Automatic process-exit flush; unresolved records remain for next startup |
| TypeScript | `journalEnabled`, `journalDir`, `retryFlushTimeout` | `flushPendingCommits(timeoutMs?)` |
| Java/Spring | `cycles.journal.enabled`, `cycles.journal.dir`, `cycles.retry.flush-timeout` | Spring context shutdown |
| Rust | `journal_enabled`, `journal_dir` | `flush_pending_commits_with_timeout(...)`; also available on the blocking client |

Disabling inline/background retry does not disable persistence. To opt out of recovery durability, the journal must also be disabled. Do that only when the application supplies an equivalent durable settlement mechanism.

## Heartbeat failures do not erase settlement

Heartbeat extension protects the lease while work runs; it is not settlement. Under the official SDKs' warning policy:

- transport and terminal extend failures are logged with the reservation ID and whether the heartbeat will retry or stop;
- recoverable failures reuse the same idempotency key and follow the protocol's safe retry window;
- the guarded action continues; and
- final settlement is still attempted when actual usage becomes known.

A stopped heartbeat can cause commit to arrive after expiry. The durable event fallback above is what preserves that known spend.

## Operational checklist

- Keep journaling enabled on every process that uses high-level lifecycle helpers.
- Configure `tenant` when possible so pending records survive API-key rotation.
- Put the journal on persistent local storage, not an ephemeral container layer.
- Invoke the bounded drain during graceful shutdown where the SDK exposes one.
- Alert on journal I/O failures, quarantined records, retained authentication failures, retry exhaustion, and heartbeat stop messages.
- Do not delete pending records manually unless the settlement outcome has been independently proven.

## Next steps

- [How Reserve → Commit Works](/protocol/how-reserve-commit-works-in-cycles)
- [Reservation TTL, Grace Period, and Extend](/protocol/reservation-ttl-grace-period-and-extend-in-cycles)
- [Error Handling Patterns](/how-to/error-handling-patterns-in-cycles-client-code)
- [SDK Recovery Conformance Profile](https://github.com/runcycles/cycles-protocol/blob/main/client-recovery/PROFILE.md)
