---
title: "Proving a Critical-Path Agent Safety Gate"
date: 2026-07-31
author: Albert Mavashev
tags: [engineering, benchmarks, reliability, SDKs, conformance, runtime-authority]
description: "How Cycles tested a critical-path agent gate for latency, saturation, fail-closed behavior, ledger correctness, and durable recovery across four SDKs."
blog: true
sidebar: false
featured: false
head:
  - - meta
    - name: keywords
      content: "AI agent safety gate, runtime authority latency, agent budget benchmark, fail closed AI agents, SDK recovery conformance, durable settlement, agent infrastructure reliability"
---

# We Put an Agent Safety Gate in the Critical Path. Here's What We Had to Prove

Put a synchronous authority check in front of an agent action and every platform team asks the same two questions:

1. **How much latency does it add?**
2. **What happens when it is unavailable?**

Those questions are coupled. A fast authorization call that loses known spend after a timeout is not reliable. A recovery system that eventually converges but adds unpredictable delay before every action is not operationally useful. And one attractive p99 number says very little about either property.

We recently worked through both questions across the Cycles protocol, server, four official SDKs, and the documentation an evaluator sees first. The result was not one new benchmark claim. It was a stricter standard for what we are willing to claim at all.

<!-- more -->

## The number that looked publishable

Cycles uses a [reserve-commit lifecycle](/protocol/how-reserve-commit-works-in-cycles). Before a protected action runs, the client reserves authority against one or more ledgers. After the action, it commits actual usage. Reserve is therefore a synchronous hop on the execution path.

Our first homepage proof included a 200-client shared-reserve p99 of approximately 532ms. The benchmark had completed successfully, but later review found a methodology problem: the run inherited warm state from preceding suite tests, and its sequential warmup did not control connection state across a 200-client fan-out.

The number was measured. It was also not a defensible standalone reference.

We changed the harness so every client level and ledger shape started in a fresh Maven, Spring, and Testcontainers process. Warmup reached every logical client with bounded concurrency, the Redis ledger was reset before measurement, and 1, 10, 50, and 200 clients received the same treatment.

That cleaner campaign produced a shared-reserve median p99 of **1,325.9ms at 200 clients**. It was almost 2.5 times the number it replaced.

Publishing the higher result was the right call because the method was better. But it raised another question: was 1.326 seconds a repeatable saturation result, or had p99 captured a few environmental pauses?

## We reran the exact merged commit

We ran seven additional fresh-process shared-ledger trials at 200 clients, then added three isolated-ledger 200-client trials and three shared-ledger one-client trials. The server code did not change between the published result and the rerun.

The rerun completed **45,842 measured reservations** with:

- zero request errors; and
- zero mismatches between successful responses and Redis `reserved` totals.

The result was better, but not in the way a new marketing number would suggest:

| Signal | Median | Trial range | What it supports |
|---|---:|---:|---|
| Shared reserve p99, 1 client | 34.4ms | 32.7–35.4ms | Low-concurrency latency reference |
| Shared reserve p95, 200 clients | 376.5ms | 364.5–404.0ms | Saturation latency distribution |
| Shared reserve p99, 200 clients | 831.1ms | 467.7–2,558.0ms | Too volatile for one headline number |
| Shared throughput, 200 clients | 890.8 reserves/s | 879.6–979.2 | Stable saturation summary |

The new 200-client p99 median was **37.3% lower** than the first controlled campaign. But the seven individual p99 results spanned **5.47×**. Over the same trials, p95 and throughput each spanned only about **1.11×**.

So we did not replace 1.326 seconds with 831 milliseconds on the homepage. We removed wide-fan-out p99 from the headline entirely.

The compact proof now says:

> **Shared reserve: 34ms p99 at 1 client · 891 reserves/s at 200 clients, 0 errors**

The [benchmark article](/blog/cycles-server-performance-benchmarks#reserve-fan-out-1-to-200-clients) retains the complete distributions. The homepage carries the signals that stayed comparatively stable.

These remain localhost reference measurements on one server instance and standalone Redis—not a latency SLO or a universal capacity limit. Deployment topology, server sizing, Redis placement, client pools, and the protected workload all matter.

## A green HTTP result is not a correctness result

Latency and throughput alone cannot validate a budget authority. A fast run could still grant more authority than the ledger recorded. A retry could apply a reservation twice. A successful response could disappear while the server-side mutation remained.

That is why the fan-out benchmark reconciles the number and amount of successful reservations against Redis after every measured window. A ledger mismatch fails the test even if every request returned `200` and the latency histogram looked excellent.

Other test layers cover different failure classes:

- unit and integration tests check request behavior and protocol contracts;
- [property tests](/blog/why-we-added-property-tests-to-cycles-budget-authority) explore concurrent interleavings and assert no overdraw or leaked reservations;
- the benchmark measures the full HTTP → Spring → Redis Lua path while checking ledger reconciliation; and
- recovery conformance checks what clients do when the clean request-response sequence breaks.

No one layer substitutes for the others. Performance without invariants is a fast accounting bug. Correct server mutations without client recovery can still lose spend at the process boundary.

## Availability is a three-phase policy

“Does it fail open or fail closed?” sounds binary. For an action lifecycle, the safe answer depends on which phase failed.

### Before authorization: fail closed

Official high-level SDK helpers do not execute a protected action unless reserve produces a schema-valid `ALLOW` or `ALLOW_WITH_CAPS` response after bounded same-key recovery. A timeout, malformed response, authentication failure, or explicit denial is not converted into permission to proceed.

This is the homepage's **reserve-time outage: fail closed** claim. It applies to the lifecycle helpers that own the gate. Low-level protocol clients expose primitives and leave application control flow to their caller.

### After authorization: surface heartbeat failure

Long-running work may extend a reservation lease while it runs. Heartbeat failure does not retroactively make an already-authorized side effect safe to cancel, so the official baseline policy logs and surfaces the failure while allowing the guarded work to continue.

The protocol now returns server-authoritative `remaining_ttl_ms`. Clients use that value, measured round-trip time, their enforced request-timeout budget, and a safety margin to decide when another extension or same-key recovery attempt is still provably inside the lease window.

This replaced guesswork that could not reliably distinguish two legal server behaviors: adding time to the previous expiry and clamping expiry to a maximum lead from “now.” Without authoritative remaining lifetime, a client cannot infer which regime it is in from timestamps alone.

### After actual usage is known: preserve settlement

Once a provider or tool returns actual usage, losing settlement would undercount work that already happened. The official lifecycle helpers persist unresolved settlement before the first commit attempt, retain the original idempotency key across ambiguous outcomes, and replay after restart.

If the reservation expired before commit, retrying the dead hold cannot record the spend. Recovery therefore switches the durable record to a direct event, preserving the subject, action, actual amount, metrics, metadata, and recovery linkage.

The durability boundary is deliberately narrow and explicit: the SDK can preserve actual usage only after it knows that usage. If the process dies before the provider returns it, the SDK cannot invent the missing amount. Applications that need coverage across that boundary must durably checkpoint the provider receipt themselves.

The complete operational contract is documented in [SDK Settlement Recovery and Durability](/protocol/sdk-settlement-recovery-and-durability).

## Four SDKs need one failure choreography

Python, TypeScript, Java, and Rust can all serialize the same request and still behave differently when:

- a commit succeeds but its response is lost;
- the process dies with known actual usage pending;
- a reservation expires before settlement;
- two workers replay the same journal;
- credentials fail after the protected action has run; or
- a heartbeat runs out of provably safe retry time.

That is not wire-format conformance. It is behavioral conformance.

Cycles now publishes a shared 12-scenario recovery profile and a pinned [per-SDK conformance matrix](/protocol/sdk-recovery-conformance). All four official SDKs pass all 12 claimed scenarios: 48 visible scenario results backed by named native tests.

There is an important limitation. The runner starts each adapter in a fresh process and verifies that the pinned native behavior tests ran, but it is not a second black-box implementation reproducing every request from outside the SDK. Code review still verifies that the named tests assert the profile's expected calls and outcomes. We publish that distinction because evidence is most useful when its boundary is visible.

## What we think critical-path infrastructure should publish

If a service must approve an agent action before execution, ask for more than one latency percentile:

1. **Low-contention latency.** What does the synchronous hop cost before saturation?
2. **Saturation throughput.** At what load does queueing dominate, and were there errors?
3. **Multi-trial tail distributions.** Are p95 and p99 repeatable, or is one run doing all the storytelling?
4. **State reconciliation.** Did successful requests converge to the authoritative ledger?
5. **Explicit outage behavior.** Does failure before authorization stop execution?
6. **Ambiguous-response handling.** Are retries idempotent and bounded by a safe window?
7. **Process-crash recovery.** Does known usage survive restart on durable storage?
8. **Cross-SDK evidence.** Do all supported languages implement the same failure choreography?
9. **Guarantee boundaries.** What important state is still outside the system's knowledge?

The standard is not “never show an ugly number.” The standard is to show enough method and distribution that a reader can tell which number is meaningful.

## The claim we are willing to make

The original question was whether a synchronous authority service can sit in front of protected agent actions without becoming an unexamined source of latency or lost accounting.

Our answer is measurable and deliberately bounded:

- on the documented reference setup, the one-client fan-out harness measured a 34.4ms median p99;
- at 200-client saturation, the server sustained a median 890.8 reserves per second across seven shared-ledger trials with zero errors and zero ledger mismatches;
- before execution, official lifecycle helpers fail closed without a proven allow; and
- after actual usage is known, four SDKs implement the same tested durable-recovery profile.

That is a longer answer than one p99. It is also the answer we would want when evaluating someone else's critical-path infrastructure.

---

*Explore the underlying evidence: [server benchmark methodology and distributions](/blog/cycles-server-performance-benchmarks#reserve-fan-out-1-to-200-clients), [SDK recovery conformance](/protocol/sdk-recovery-conformance), [settlement durability](/protocol/sdk-settlement-recovery-and-durability), and [why Cycles uses Redis Lua for atomic authority](/blog/why-cycles-runs-budget-authority-on-redis-lua).*
