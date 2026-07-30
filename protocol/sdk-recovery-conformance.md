---
title: "SDK Recovery Conformance Matrix"
description: "Per-SDK evidence for the 12 shared Cycles recovery scenarios: ambiguous settlement, expired reservations, durable replay, concurrent workers, heartbeat failure, and the known-actual boundary."
---

# SDK Recovery Conformance Matrix

Wire-format compatibility is not enough for an SDK. The failure choreography
must still preserve known spend when a response is lost, a reservation expires,
credentials rotate, or the process restarts.

This matrix publishes the current evidence snapshot for every official core
SDK against the shared [recovery profile
0.3](https://github.com/runcycles/cycles-protocol/blob/main/client-recovery/PROFILE.md).
Each cell links to the machine-readable report containing the exact native
tests executed for that scenario. The four implementations are Python,
TypeScript, Spring / Java, and Rust.

<RecoveryConformanceMatrix />

## What a pass proves

The shared runner invokes the SDK adapter once per scenario in a fresh process.
The adapter must execute named native behavior tests and return their exact
identifiers. A pass therefore proves that the SDK's claimed native tests ran
successfully at the pinned implementation commit.

The runner deliberately does not disclose the expected request choreography to
the adapter. Code review still verifies that each named native test asserts the
catalog's expected calls and outcomes. This is native-test-backed conformance,
not a claim that a second black-box client independently reproduced the SDK
internals.

## Status definitions

- **Pass** — the pinned report passed the scenario and names at least one native
  behavior test.
- **Fail** — the runner completed but the scenario or its native tests failed.
- **Not claimed** — an implementation does not claim that profile level.
- **Stale** — the displayed SDK or profile commit has moved beyond the report.
  The pinned result remains historical evidence, but current conformance must
  be re-established.

The SDK README badge follows the current `main` CI workflow. The snapshot above
is intentionally pinned to exact commits so later source changes cannot rewrite
what was tested.

## Guarantee boundary

Durable recovery begins only after the lifecycle helper knows the actual amount
and persists settlement. If a process dies before the provider returns actual
usage, the SDK cannot invent the missing amount. Applications requiring that
stronger guarantee must durably checkpoint the provider receipt or usage before
acknowledging the downstream operation.

See [SDK Settlement Recovery and
Durability](/protocol/sdk-settlement-recovery-and-durability) for the journal,
replay, expiry fallback, configuration, and operational contract.
