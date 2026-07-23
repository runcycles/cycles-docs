---
title: "A Valid Signature Doesn't Tell You Who Signed It"
date: 2026-06-17
author: Albert Mavashev
tags:
  - governance
  - runtime-authority
  - audit
  - compliance
  - agents
  - evidence
  - cryptography
description: "A valid signature proves bytes came from a key, not that the key is authoritative. Learn how signer resolution and key rotation establish durable trust."
blog: true
sidebar: false
featured: false
head:
  - - meta
    - name: keywords
      content: "signer authority, signature validity, verification key resolution, key rotation, JWK set, did:cycles, long-horizon audit, tamper-evident receipt, Ed25519 verification, EU AI Act record-keeping, agent governance evidence, who signed the receipt"
---

# A Valid Signature Doesn't Tell You Who Signed It

[Last time](/blog/a-200-ok-is-not-an-audit-trail) we said a `200 OK` is not an audit trail, and that [CyclesEvidence](/concepts/cycles-evidence-verifiable-audit-for-agent-decisions) closes the gap by turning eligible budget decisions into signed, content-addressed receipts. We also left an honest boundary open at the end: the signature proves the bytes, but *signer authority* — proving the signing key genuinely belongs to that server — was still to come.

This is that part. Because the moment you hand someone a signed receipt, they ask the second question, and it's sharper than the first: **signed by whom — and how do you know?**

<!-- more -->

## The forgery a valid signature doesn't catch

A signature check is mechanical: it takes some bytes, a signature, and a public key, and tells you the three are consistent. That's real and useful — change one byte of the receipt and the check fails.

But look at what it *doesn't* say. If the public key it checks against is simply the one carried inside the receipt, then a forger writes their own receipt, embeds *their own* key, and signs it with the matching private key. Every field is internally consistent. The signature verifies. But all it proves is that whoever controlled the embedded key signed those bytes — it does *not* prove the claimed server ever authorized that key.

"The signature is valid" answers *do these bytes match this key*. It does not answer *is this key allowed to speak for that server*. Those are two different questions, and only the second one is trust.

And the second one is the one your auditor, regulator, counterparty, or incident reviewer actually cares about. Without signer authority, a "signed" receipt is awkward to hand to any of them: the verifier still has to either trust whatever key the receipt carried or have manually pinned the signer in advance. That's not evidence that stands on its own — it's evidence with a footnote.

## Validity and authority are different axes

- **Signature validity** — do the bytes verify against the key named in the envelope? Self-contained, cheap, no network. This is what shipped first.
- **Signer authority** — is that key actually the legitimate signer for the server the envelope claims to come from? This needs an anchor *outside* the receipt.

Validity without authority is still worth something — we call it **binding-only**: the signature is cryptographically sound, and you may have pinned ahead of time which signer you expect, so a match means "the key I already decided to trust signed this." That's shippable and honest for a known counterparty. But notice the trust came from *you* pinning a key, not from the system *proving* the key is the server's. Authority is what removes that homework — and it's what an auditor or an untrusting third party, who never pinned anything, actually needs.

## Resolving the signer

Closing the gap means anchoring the key to the server's own published identity rather than to the receipt. The server publishes its verification keys — public keys only, never the private signing key — at a well-known location derived from its identity. A consumer takes the signer reference on the envelope, resolves it to that published key set, and confirms the signing key is actually in it.

Now the trust anchor is the server identity and its published key set, not a key the receipt handed you. A forger can still embed a key and self-sign, but that key will not resolve as authorized for the claimed server and issuance window. CyclesEvidence v0.2 defines the `did:cycles` identifier, server-relative JWK Set path, key-window rules, and distinct verification dispositions; the mechanics live in the [envelope reference](/protocol/cycles-evidence-envelopes-in-cycles).

> **Status.** Signer-authority resolution is normative in CyclesEvidence v0.2. The current server publishes its configured JWK Set, including retired-key history, and the v0.2 promotion was gated on an end-to-end consumer integration. A consumer that chooses not to resolve the set still reports `binding_only`; an expected-signer pin can provide a separate trust anchor for that posture.

## The rotation trap — the part that's easy to get catastrophically wrong

Keys rotate. They should: a signing key has a lifetime, and rotating it is hygiene. Here's where a naive resolver quietly destroys your audit trail.

The tempting implementation fetches the key set and uses **the current key**. It passes every test you write today, because today's receipts were signed by today's key. Then you rotate — and every receipt signed before the rotation stops verifying, all at once, because it's being checked against a key that didn't exist when it was signed. For a live system that's an outage. For an audit trail meant to last *years*, it's the whole asset evaporating on a routine key change.

The published key set therefore keeps retired keys, each stamped with the window in which it was valid, and the verifier selects the unique key whose window covers the receipt's *issuance time*—never merely "the latest." The current server supports this through `EVIDENCE_SIGNING_RETIRED_KEYS`; operators must preserve correct, non-overlapping history and set the active key's validity start when rotating. A receipt from before a rotation can then verify against the key that was valid when it was signed.

## Honesty is a disposition, not a boolean

Once resolution involves fetching something, a new failure mode appears: *you couldn't reach the key directory*. The dangerous move is to fold that into the signature result. "I couldn't fetch the keys" is **not** "this is forged" — collapsing them turns a network blip into a false fraud alarm, or, worse, lets a real tamper hide behind an ambiguous "couldn't check."

So the outcome of verification isn't `valid: true/false`. It's a small set of *distinct* dispositions (the protocol's identifier is in parentheses):

- **authentic** (`authentic`) — signature valid **and** the key resolved to the server's published set for the time it was signed. Both axes pass.
- **binding-only** (`binding_only`) — signature valid, but authority wasn't established (no resolution, or a pinned-issuer posture). Honest about what it does and doesn't prove.
- **authority-not-established** (`signer_authority_failed`) — the key set resolved fine, but the signing key isn't in it (or isn't valid for this server at that time). This is exactly where the embedded-key forgery lands — and it is neither a network failure nor a proof of tamper.
- **could-not-resolve** (`signer_resolution_failed`) — the key directory was unreachable or unparseable. Establishes *nothing* about the bytes. Must never read as "invalid."
- **invalid** (`signature_invalid`) — the bytes don't verify against the resolved key. Failed cryptographic integrity: it may be tampering, but it can equally be corruption, an encoding or canonicalization mismatch, or a verifier/envelope version skew. Serious, but not automatically "someone forged this."

Three of those five are "valid signature, but not authentic" for three genuinely different reasons — and the failures (couldn't-resolve, authority-not-established, invalid) stay rigidly separate: a network blip, an unauthorized key, and a failed-integrity check are not the same event. Collapsing them is how verifiers lie. That's why the result is a taxonomy, not a checkbox.

## The honest boundary (again, on purpose)

Two things this still isn't, because over-claiming an audit feature is its own risk:

- **It's about *who signed*, not *whether the decision was right*.** Authority resolution tells you the receipt genuinely came from that server. It says nothing about whether the budget call was correct—enforcement is still the reserve-commit ledger.
- **It's opt-in and requires verifier policy.** A server can publish its key set, but each consumer must resolve and validate it—or intentionally use the `binding_only` path with an independent signer pin. Server identity trust, key-history retention, and archival availability remain operator responsibilities.

## Close the loop

CyclesEvidence is built to keep these two claims separate and explicit: `binding_only` when the bytes verify, `authentic` when the signer also resolves to an authorized server key, and distinct failure states when authority can't be established — never a single green checkmark papering over the difference.

If your agents touch money, tools, or anything with a blast radius, "it's signed" is not the end of the auditor's question. The real question is: *signed by whom, under what authority, and will it still verify after the keys have rotated?* A signature gives you byte integrity. Signer authority gives you trust — and the job is to keep that trust separate, explicit, and durable over time.

- Previously: [A 200 OK Is Not an Audit Trail](/blog/a-200-ok-is-not-an-audit-trail)
- Concept: [CyclesEvidence — Verifiable Audit for Agent Decisions](/concepts/cycles-evidence-verifiable-audit-for-agent-decisions)
- Reference: [CyclesEvidence Envelopes](/protocol/cycles-evidence-envelopes-in-cycles)
- Related: [What Is Runtime Authority for AI Agents?](/blog/what-is-runtime-authority-for-ai-agents) · [AI Agent Approval Queues Need Runtime Authority](/blog/ai-agent-approval-queues-need-runtime-authority)
