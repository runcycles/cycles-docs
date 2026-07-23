---
title: "AP2 Open-Mandate Idempotency: Scope and Limits"
date: 2026-05-13
author: Albert Mavashev
tags: [engineering, runtime-authority, idempotency, payments, integrations, ap2]
description: "Cycles collapses AP2 budget accounting and rejects divergent retries by open_mandate_hash, but PSP idempotency is still required for consume-once payments."
blog: true
sidebar: false
featured: false
head:
  - - meta
    - name: keywords
      content: "AP2 open-mandate idempotency, AP2 mandate overuse, Agent Payments Protocol idempotency, AP2 spec section 6, PSP idempotency, runtime authority payments, open_mandate_hash, payment-mandate"
---

# AP2 Open-Mandate Idempotency: Scope and Limits

An autonomous shopping agent holds a signed open mandate. The first checkout succeeds. Then the orchestrator restarts mid-flow, the user clicks "try again," or a parallel worker re-runs the flow against the same mandate.

Both attempts can produce a fresh `transaction_id`. Both can carry a valid mandate. Both can reach the PSP as valid payment attempts.

The result is two pending authorizations against one user intent.

The signature does what it is supposed to do — proves the mandate is valid. It does not prove the mandate has not already been exercised. Consumption is runtime state, and runtime state needs a separate gate.

[Google's Agent Payments Protocol (AP2)](https://github.com/google-agentic-commerce/AP2) calls this out directly in [specification §6](https://ap2-protocol.org/ap2/specification/):

> *"A shopping agent must avoid presenting subsequent open mandates without a rejection receipt to prevent multiple checkouts using the same open mandate."*

To be clear about scope: I am not arguing this belongs inside AP2 verification itself. AP2 builders need runtime state *beside* verification. Cycles can deduplicate the budget operation and reject divergent reuse, but payment consume-once also needs a PSP idempotency key or a separate atomic claim that prevents the side effect from running twice.

<!-- more -->

## Why open-mandate overuse is a runtime problem

A signed open mandate is evidence that the user intended a payment. It is silent on whether the intent has already been exercised. The same retry-amplification dynamics that drive [retry storms in agent budget systems](/blog/retry-storms-and-idempotency-in-agent-budget-systems) apply unchanged here — SDK retries, framework retries, durable-execution replays, user-initiated retries — except the failure mode shifts from "agent burned $4 of [tokens](/glossary#tokens)" to "agent ran the customer's card twice."

The budget-accounting defense has the same shape as other [runtime authority](/glossary#runtime-authority) decisions: perform the Cycles reservation before the side effect, and key retries on the mandate boundary. This protects the budget ledger. It is not, by itself, an execution lock around the PSP call.

## Keying the lock on open_mandate_hash, not transaction_id

For this AP2 §6 risk, the wrong default is `transaction_id`. Two checkouts derived from one open mandate can naturally produce two distinct transaction IDs. That is the identity of a payment attempt, not the boundary of the mandate's use. Keying idempotency on `transaction_id` lets the §6 risk through unchanged.

The right Cycles idempotency scope is `open_mandate_hash` when one is present. Both attempts then collide on the same `(tenant, endpoint, idempotency_key)` tuple. The server's reserve dedup sees them as the same bucket:

- Same key, **identical payload** → server replays the original [reservation](/glossary#reservation).
- Same key, **divergent payload** (different `transaction_id`, different `checkout_hash`, different amount) → server rejects with `409 IDEMPOTENCY_MISMATCH`.

Neither outcome creates a second reservation or a second Cycles debit. There is an important limit: an identical replay returns the original allowed reservation, and `cycles_guard_payment()` enters the `with` body again. Two identical or concurrent callers can therefore both reach `psp.charge()`, even though Cycles settles the shared reservation only once.

The scope is embedded in the key so the two buckets never collide on a pathological input:

| Mandate carries | Key shape |
|---|---|
| `open_mandate_hash` (human-not-present) | `ap2:open_mandate:{sha256(open_mandate_hash)[:32]}:reserve` |
| only `transaction_id` (human-present / no open mandate) | `ap2:tx:{sha256(transaction_id)[:32]}:reserve` |

`runcycles-ap2` picks the scope automatically. The raw `transaction_id` and `open_mandate_hash` still ride on `Subject.dimensions` for audit; only the idempotency key uses the hash.

In code, the integration is one context manager:

```python
with cycles_guard_payment(
    client,
    mandate=mandate,
    run_id=run_id,
    tenant="acme",
    agent="checkout-bot",
) as guard:
    psp_receipt = psp.charge(mandate)
    guard.attach_receipt_fields(psp_ref=psp_receipt.id)
```

The reserve happens before the PSP call; clean exit commits; exceptions release; uncertain post-PSP commit outcomes raise for reconciliation. Use a stable PSP idempotency key derived from the same payment intent, or atomically claim the mandate in a durable consume-once store, before making the charge. Without one of those controls, the context manager protects Cycles accounting but does not guarantee a single PSP execution.

### A note on hash canonicalization

The current adapter treats `open_mandate_hash` as caller-supplied. The important property is *stability*: every checkout derived from the same open mandate must produce the same value, or the bucket fragments and the accounting protection fails. We have an [open question on the AP2 discussion](https://github.com/google-agentic-commerce/AP2/discussions/262) about whether the spec recommends a canonicalization — JSON Canonicalization Scheme ([JCS, RFC 8785](https://datatracker.ietf.org/doc/html/rfc8785)) over the open mandate, the same form the mandate signature is computed over, or something else. An AP2-native convention here would be cleaner than every implementer choosing a different hashing convention.

## Edge cases harder than the AP2 idempotency keying decision

Much of the guard's hardening was not the keying decision itself. It was the failure modes around it.

**Post-PSP commit uncertainty.** Once the PSP call inside the `with` block has run, any failure on the Cycles commit POST is a reconciliation event. Transport errors, 5xx responses, terminal reservation statuses (`RESERVATION_FINALIZED` / `RESERVATION_EXPIRED` / `IDEMPOTENCY_MISMATCH`), and uncaught exceptions all share one property: the commit may have reached the server and settled the budget before the failure was observed. Auto-releasing could undo a real charge. The guard raises `AP2GuardCommitUncertain` with no release; the caller has to reconcile. This is the same principle behind [silent-success failure modes in agent systems](/blog/ai-agent-silent-failures-why-200-ok-is-the-most-dangerous-response) — recovery logic that hides uncertainty is dangerous in payment paths.

**Amount conversion.** USD amounts arrive as decimal strings. Converting to int64 micro-cents through `Decimal` arithmetic uses the default 28-digit context and silently rounds large values. We compute exactly from `Decimal.as_tuple()` digits, reject NaN/±Infinity/sub-micro/over-int64, and bound the input digit count *before* any `10**shift` math — otherwise a string like `"1E+1000000000000"` survives validation and tries to allocate a trillion-digit scaling factor.

**Idempotency header safety.** Python's `str.isalnum()` is Unicode-aware (`"É".isalnum()` returns `True`), so a non-ASCII exception class name could have reached the `Idempotency-Key` HTTP header. [RFC 7230](https://datatracker.ietf.org/doc/html/rfc7230#section-3.2.6) restricts header tokens to ASCII. The suffix sanitizer is now `isascii() and isalnum()`.

## What the AP2 runtime guard does not do

[`runcycles-ap2`](https://pypi.org/project/runcycles-ap2/) does not verify AP2 signatures, create or sign mandates, replace credential-provider verification, or serialize execution of an identical replay. Those responsibilities stay with the AP2 SDK, merchant flow, PSP idempotency contract, and any consume-once state store. The guard runs before the PSP call and keys the Cycles reservation on the open-mandate boundary; its enforcement scope is budget authorization and settlement.

## Resource links

- [`runcycles-ap2` on PyPI](https://pypi.org/project/runcycles-ap2/) — `pip install runcycles-ap2`
- [`cycles-ap2-python` on GitHub](https://github.com/runcycles/cycles-ap2-python) — Apache-2.0 source
- [AP2 specification](https://ap2-protocol.org/ap2/specification/) — Google Agentic Commerce Group
- [AP2 GitHub Discussion #262](https://github.com/google-agentic-commerce/AP2/discussions/262) — context and a couple of spec-level questions
- [Retry Storms & Idempotency in Agent Budget Systems](/blog/retry-storms-and-idempotency-in-agent-budget-systems) — the idempotency primitive in detail
- [What Is Runtime Authority for AI Agents](/blog/what-is-runtime-authority-for-ai-agents) — the broader pattern this post is one application of
