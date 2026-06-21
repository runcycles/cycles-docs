---
title: "Audit Evidence Has to Survive Production"
date: 2026-06-21
author: Albert Mavashev
tags:
  - governance
  - runtime-authority
  - audit
  - compliance
  - agents
  - evidence
  - operations
  - production
description: "Signed receipts only matter if the pipeline survives crashes, key rotation, retention, and operator mistakes. A production checklist for AI agent evidence."
blog: true
sidebar: false
featured: false
head:
  - - meta
    - name: keywords
      content: "AI agent audit evidence, CyclesEvidence production, signed receipts, signer authority, key rotation, evidence retention, agent governance audit, runtime authority compliance"
---

# Audit Evidence Has to Survive Production

Your support agent tried to spend $4.20 on a tool call. The budget gate denied it. The agent degraded cleanly. The incident never happened.

Ninety days later, the auditor asks for the proof.

Since then, the events worker restarted twice, Redis was restored from backup once, the signing key rotated, the active key changed, a retention job moved older records into cold storage, and one operator temporarily misconfigured the retired-key history before fixing it. The question is no longer whether the live request returned `409 BUDGET_EXCEEDED`. The question is whether the evidence still verifies after production happened to it.

That is the part most audit-trail designs skip. A signed receipt is necessary, but it is not sufficient. Audit evidence has an operating path: creation, signing, storage, retrieval, signer resolution, rotation, retention, export, and later verification by someone who was not on the original request.

If any one of those steps quietly collapses, the receipt becomes another assertion that still depends on trust in your systems.

<!-- more -->

## A receipt is not the whole control

The previous evidence posts drew the core distinction:

- [A 200 OK is not an audit trail](/blog/a-200-ok-is-not-an-audit-trail). A live response proves nothing to a later reviewer who does not trust your server.
- [A valid signature does not tell you who signed it](/blog/a-valid-signature-doesnt-tell-you-who-signed-it). Signature validity and signer authority are different questions.
- [Rotating keys should not rewrite history](/blog/rotating-keys-shouldnt-rewrite-history). Old evidence must keep verifying after the key that signed it is retired, without letting the current key forge backdated receipts.

This post is the production counterpart. It assumes the reader already buys the receipt model. The question is what has to be true for that receipt to survive a real deployment.

A production evidence record has to answer five questions:

| Question | What has to survive |
|---|---|
| What was decided? | The original request, response, decision, reason, scope, amount, and artifact type |
| Did these bytes change? | The content address and canonicalization recipe |
| Who signed it? | The signer identity, public key, and authority binding |
| Was that signer authorized then? | The key set and validity window at the receipt's `issued_at_ms` |
| Can a third party verify it later? | Retrieval, retention, export, and verifier documentation |

The [CyclesEvidence concept page](/concepts/cycles-evidence-verifiable-audit-for-agent-decisions) covers the shape: a content-addressed, Ed25519-signed envelope over the authorization lifecycle. The [protocol reference](/protocol/cycles-evidence-envelopes-in-cycles) covers the wire details: `evidence_id`, `cycles_evidence_url`, five artifact types, non-self-referential stamping, and verification.

Production adds the uncomfortable part: every box above has a failure mode.

## The failures are mostly operational

Cryptography is the clean part. Given canonical bytes, a public key, and a signature, verification is mechanical. The messy part is the system around it.

| Failure mode | What breaks | Control that prevents it |
|---|---|---|
| Worker crashes after claiming a source record | The decision happened, but no signed envelope lands | At-least-once processing with claim / ack after durable store |
| Producer and signer compute different canonical bytes | The returned `evidence_id` does not match the signed envelope | Golden fixtures across all artifact types; dead-letter on drift |
| Envelope is signed but not durably stored | The caller has an id that cannot be fetched later | Content-addressed store with explicit retention policy |
| Current key is published as valid for all time | A current key can sign a backdated receipt into an old period | Active key bounded below by the latest retired-key expiry |
| Retired-key config is malformed | Old receipts stop resolving, or the active key loses its rotation boundary | Loud operator error; fail-safe publication, not silent collapse |
| Evidence TTL is shorter than audit need | Verification fails during review even though the original control worked | Cold export and retention policy set before enforcement |
| Verification cannot distinguish network failure from forgery | A key-server outage looks like tampering | Distinct dispositions: `signer_resolution_failed`, `signer_authority_failed`, `signature_invalid` |

None of these failures is exotic. They are normal production failures: restarts, retries, bad config, TTLs, partial outages, and migration drift. The evidence system has to treat them as expected conditions, not as exceptional paths the architecture diagram forgot.

## Build the pipeline around crash windows

The evidence pipeline has two jobs that pull in opposite directions.

The caller needs an answer now. The budget gate cannot block on slow signing, object storage, or downstream export. [Runtime authority](/glossary#runtime-authority) has to decide before the agent acts and return quickly. That is why Cycles computes the `evidence_id` synchronously and returns the `cycles_evidence` reference in-band, while signing and storage happen asynchronously.

The auditor needs a durable receipt later. Async work cannot mean best-effort work. If the process dies between "we accepted the evidence source record" and "we stored the signed envelope," the system must be able to recover or retry.

The production rule is simple: **acknowledge only after durable storage**.

A healthy shape looks like this:

1. Runtime server reaches an authorization outcome: `ALLOW`, `ALLOW_WITH_CAPS`, `DENY`, or a lifecycle error worth attesting.
2. Runtime server computes the `evidence_id` from the canonical envelope shape and returns the reference on the response where evidence is enabled.
3. Runtime server records the source facts for the signer tier.
4. Signer tier claims the source record into a processing state.
5. Signer tier builds, signs, and stores the envelope by content address.
6. Signer tier acknowledges the source record only after the store succeeds.
7. On restart, any processing records that were claimed but not acknowledged are recovered.

That sequence is ordinary infrastructure work, but it is the difference between "usually emits evidence" and "does not lose the denial receipt when the worker dies at the worst possible moment."

It also explains why `evidence_id` is more than a lookup key. It is the handshake between producer and signer. The runtime server and signer must agree on the same canonical bytes for `decide`, `reserve`, `commit`, `release`, and `error` envelopes. If they disagree, the correct behavior is to dead-letter and page an operator, not publish a receipt whose id and signature are talking about different bytes.

This is where fixture work matters. The fixture set should cover all five artifact types, including denial-shaped `error` envelopes. Denials are the receipts auditors care about most because they prove the control fired.

## Key rotation is part of the evidence model

Signer authority is where a lot of systems accidentally turn long-lived evidence into short-lived evidence.

The naive verifier asks, "does this signature verify against the current key?" That works until the first rotation. After rotation, the current key is not the key that signed last quarter's receipt. If the verifier always uses the current key, old evidence rots the moment you do routine key hygiene.

The right verifier asks a different question: **which key was authoritative at this envelope's `issued_at_ms`?**

That requires a published key set, not just one public key. A server that supports signer-key resolution publishes its JWK Set at:

```text
GET {server_id}/.well-known/cycles-jwks.json
```

The set includes the active key and, when configured, retired keys. Each key carries a validity window: `cycles_nbf_ms` inclusive and `cycles_exp_ms` exclusive. A verifier selects by the envelope's issuance time, not by which key is active now.

The active key needs a lower bound too. If key A retired at time `T` and key B became active at time `T`, B should be valid from `T` forward, not from the beginning of time. Otherwise, whoever controls B can sign a fresh envelope today, stamp it with an old `issued_at_ms`, and have a naive resolver accept it as historical evidence.

This is why the rotation procedure is not just "publish new key." It is:

| Step | Production requirement |
|---|---|
| Retire old key | Keep it published with `[nbf, exp)` covering its real signing period |
| Activate new key | Publish it with `cycles_nbf_ms` at the rotation boundary |
| Resolve old evidence | Select the retired key whose window covers `issued_at_ms` |
| Reject backdating | Do not let the active key cover pre-rotation time |
| Alert on bad history | If retired-key config is unusable, make that loud |

The honest boundary: this solves publication and resolution. It does not solve private-key custody. A stolen private key can still sign inside its legitimate authority window. That is a key-management incident, not a signer-resolution bug.

## Retention is not a default

Evidence retention is a product and compliance decision. It should not be an accident of Redis TTLs.

Cycles has multiple record surfaces:

- hot runtime data used for live operations,
- queryable reservations, events, and audit rows used by operators,
- signed CyclesEvidence envelopes used for later proof,
- optional cold exports used for long-horizon retention.

Those surfaces do not need the same retention policy. Hot operational data can age out sooner. Signed evidence may need to survive much longer, especially when it supports customer disputes, incident reviews, regulated workflows, or third-party verification.

The mistake is treating the evidence store as "wherever the worker writes today." A production deployment needs an explicit answer:

| Question | Bad answer | Better answer |
|---|---|---|
| How long does signed evidence stay fetchable? | "Whatever Redis keeps" | Named retention period by workload class |
| Where does evidence go after hot storage? | "We will export later" | Scheduled cold export with restore drill |
| What happens on legal hold? | "Turn off cleanup manually" | Retention override documented and tested |
| How do auditors verify exported records? | "Ask engineering" | Standalone verifier instructions and key history |
| Who owns key rotation history? | "Unassigned" | Named operator runbook with review step |

This is not legal advice. It is the engineering checklist that lets counsel, compliance, and auditors evaluate a real control instead of a diagram.

## What to monitor

An evidence pipeline should have its own operational signals. Do not wait until an audit request discovers the gap.

The minimum runbook should watch:

| Signal | Why it matters |
|---|---|
| Evidence emission disabled unexpectedly | The system is enforcing but no longer producing receipts |
| Signer worker backlog | Receipts are delayed; immediate fetches may return transient `404` longer than expected |
| Dead-lettered evidence records | Producer and signer may disagree, or malformed source records are arriving |
| Evidence store write failures | `evidence_id` references may become unfetchable |
| Retrieval `404` beyond expected signing delay | The receipt may never have landed or may have expired early |
| JWK Set `404` on a deployment expected to publish signer keys | Consumers fall back to `binding_only`, not `authentic` |
| Retired-key config warnings/errors | Old evidence may fail authority resolution |
| Admin audit-write errors | Operators may lose the record of management actions around evidence setup |

The existing [Prometheus metrics reference](/how-to/prometheus-metrics-reference) already calls out one related principle: audit-write failures are not request-fatal, but they are operationally serious. The same posture belongs on evidence. A request can succeed while the proof path is degraded. That is exactly why evidence needs its own alerts.

## A production checklist

Before a team calls AI-agent evidence audit-ready, it should be able to walk this checklist without exceptions:

| Area | Check |
|---|---|
| Identity | `EVIDENCE_SERVER_ID` is stable and matches the public base used by verifiers |
| Signing | Private signing key exists only in the signer tier, not the runtime server |
| Key publication | `GET {server_id}/.well-known/cycles-jwks.json` returns the expected public key set when signer-key resolution is enabled |
| Rotation | Retired keys are retained with non-overlapping `[cycles_nbf_ms, cycles_exp_ms)` windows |
| Active-key bound | Active key `cycles_nbf_ms` starts at or after the latest retired-key expiry |
| Crash recovery | Claimed-but-unacknowledged source records are recovered on restart |
| Canonicalization | Golden fixtures cover `decide`, `reserve`, `commit`, `release`, and `error` |
| Storage | Envelopes are stored by `evidence_id`, with a documented hot and cold retention policy |
| Verification | A fresh verifier can re-derive `evidence_id`, verify Ed25519 signature, and resolve signer authority |
| Dispositions | Verification output distinguishes `binding_only`, `authentic`, `signer_resolution_failed`, `signer_authority_failed`, and `signature_invalid` |
| Runbook | Operators know how to rotate keys, restore evidence, inspect dead letters, and explain transient `404` |
| Drill | The team can retrieve and verify a denied action from a prior rotation window |

The last item is the one that matters most. A control that has never been drilled is a belief. The first audit request should not be the first full-path verification test.

## What evidence changes operationally

Without signed evidence, the audit conversation depends on trust in the operator's live system. "Our server denied it" is a claim. "Here is the signed, content-addressed receipt; here is the key that was authoritative at the time; here is the verifier output" is a different conversation.

That difference matters for budget controls, but it matters even more as runtime authority expands to action surfaces: memory writes, merge buttons, computer-use clicks, voice frames, and every other place an agent can cause durable change. A `DENY` against USD spend and a `DENY` against RISK_POINTS are both policy decisions. Both should be provable later when the question is not "what did the system log?" but "what was the agent authorized to do?"

The enforcement layer is the gate. Evidence is the receipt. Operations is what keeps the receipt believable after the gate has done its job.

That is the bar for production AI-agent evidence: not that a demo can sign JSON, but that a deployment can survive ordinary production failure modes and still prove what happened.

## Resources

- [CyclesEvidence: Verifiable Audit for Agent Decisions](/concepts/cycles-evidence-verifiable-audit-for-agent-decisions)
- [CyclesEvidence Envelopes in Cycles](/protocol/cycles-evidence-envelopes-in-cycles)
- [A 200 OK Is Not an Audit Trail](/blog/a-200-ok-is-not-an-audit-trail)
- [A Valid Signature Doesn't Tell You Who Signed It](/blog/a-valid-signature-doesnt-tell-you-who-signed-it)
- [Rotating Keys Shouldn't Rewrite History](/blog/rotating-keys-shouldnt-rewrite-history)
- [Server Configuration Reference](/configuration/server-configuration-reference-for-cycles)
- [RFC 8785: JSON Canonicalization Scheme](https://www.rfc-editor.org/rfc/rfc8785.html)
- [RFC 8032: Edwards-Curve Digital Signature Algorithm](https://www.rfc-editor.org/rfc/rfc8032.html)
- [EU AI Act, Regulation (EU) 2024/1689](https://eur-lex.europa.eu/legal-content/EN/TXT/?uri=CELEX:32024R1689)
