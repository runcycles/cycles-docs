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
description: "A signed receipt proves the bytes came from a key — not that the key is the server's. That gap is signer authority, and closing it for the long haul means resolving keys and respecting rotation, not trusting whatever key the receipt handed you."
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

But look at what it *doesn't* say. If the public key it checks against is simply the one carried inside the receipt, then a forger writes their own receipt, embeds *their own* key, and signs it with the matching private key. Every field is internally consistent. The signature verifies. And it attests to nothing, because the attacker chose the key it verifies against.

"The signature is valid" answers *do these bytes match this key*. It does not answer *is this key allowed to speak for that server*. Those are two different questions, and only the second one is trust.

## Validity and authority are different axes

- **Signature validity** — do the bytes verify against the key named in the envelope? Self-contained, cheap, no network. This is what shipped first.
- **Signer authority** — is that key actually the legitimate signer for the server the envelope claims to come from? This needs an anchor *outside* the receipt.

Validity without authority is still worth something — we call it **binding-only**: the signature is cryptographically sound, and you may have pinned ahead of time which signer you expect, so a match means "the key I already decided to trust signed this." That's shippable and honest for a known counterparty. But notice the trust came from *you* pinning a key, not from the system *proving* the key is the server's. Authority is what removes that homework — and it's what an auditor or an untrusting third party, who never pinned anything, actually needs.

## Resolving the signer

Closing the gap means anchoring the key to the server's own published identity rather than to the receipt. The server publishes its verification keys — public keys only, never the private signing key — at a well-known location derived from its identity. A consumer takes the signer reference on the envelope, resolves it to that published key set, and confirms the signing key is actually in it.

Now the trust anchor is the server's identity, not a key the receipt handed you. A forger can still embed their own key and self-sign — but it won't be in the real server's published set, so it resolves to *not authorized*, not *authentic*. (The exact identifier and key-set format are being nailed down with our first cross-system consumer; the mechanics live in the [envelope reference](/protocol/cycles-evidence-envelopes-in-cycles) and the protocol issue it tracks.)

## The rotation trap — the part that's easy to get catastrophically wrong

Keys rotate. They should: a signing key has a lifetime, and rotating it is hygiene. Here's where a naive resolver quietly destroys your audit trail.

The tempting implementation fetches the key set and uses **the current key**. It passes every test you write today, because today's receipts were signed by today's key. Then you rotate — and every receipt signed before the rotation stops verifying, all at once, because it's being checked against a key that didn't exist when it was signed. For a live system that's an outage. For an audit trail meant to last *years*, it's the whole asset evaporating on a routine key change.

So the design has the published key set **keep retired keys**, each stamped with the window of time it was valid, and the verifier selects the key whose window covers the receipt's *issuance time* — never "the latest." A receipt from eight months and two rotations ago still verifies, against the key that was genuinely valid when it was signed. This is the unglamorous mechanism that lets evidence survive long-horizon retention — the [EU AI Act Article 12](/blog/a-200-ok-is-not-an-audit-trail) kind of horizon — instead of silently rotting on the next key change. (Today a server publishes a single active key; the retired-key history and validity windows are the next step on the publication side — but the verifier rule is built for them from the start, because retrofitting "pick the key for the signing time" *after* you've rotated is exactly the outage you're trying to avoid.)

## Honesty is a disposition, not a boolean

Once resolution involves fetching something, a new failure mode appears: *you couldn't reach the key directory*. The dangerous move is to fold that into the signature result. "I couldn't fetch the keys" is **not** "this is forged" — collapsing them turns a network blip into a false fraud alarm, or, worse, lets a real tamper hide behind an ambiguous "couldn't check."

So the outcome of verification isn't `valid: true/false`. It's a small set of *distinct* dispositions (the protocol's identifier is in parentheses):

- **authentic** (`authentic`) — signature valid **and** the key resolved to the server's published set for the time it was signed. Both axes pass.
- **binding-only** (`binding_only`) — signature valid, but authority wasn't established (no resolution, or a pinned-issuer posture). Honest about what it does and doesn't prove.
- **authority-not-established** (`signer_authority_failed`) — the key set resolved fine, but the signing key isn't in it (or isn't valid for this server at that time). This is exactly where the embedded-key forgery lands — and it is neither a network failure nor a proof of tamper.
- **could-not-resolve** (`signer_resolution_failed`) — the key directory was unreachable or unparseable. Establishes *nothing* about the bytes. Must never read as "invalid."
- **invalid** (`signature_invalid`) — the bytes don't verify. This, and only this, is tamper.

Three of those five are "valid signature, but not authentic" for three genuinely different reasons — and the failures (couldn't-resolve, authority-not-established, invalid) stay rigidly separate: a network blip, an unauthorized key, and a forgery are not the same event. Collapsing them is how verifiers lie. That's why the result is a taxonomy, not a checkbox.

## The honest boundary (again, on purpose)

Two things this still isn't, because over-claiming an audit feature is its own risk:

- **It's about *who signed*, not *whether the decision was right*.** Authority resolution tells you the receipt genuinely came from that server. It says nothing about whether the budget call was correct — enforcement is still the reserve/commit ledger.
- **It's opt-in and still settling.** A server can publish its key set today; resolving it end-to-end is landing with our first cross-system consumer, and the identifier shape is being finalized with them. Until that round-trips, pin the expected signer for issuer trust — the binding-only path is exactly enough for the pinned case right now.

## Close the loop

If your agents touch money, tools, or anything with a blast radius, "it's signed" is not the end of the auditor's question. "Signed by whom — provably, and still provably after the keys have rotated" is. The first half of that is a signature. The second half is signer authority, and it's the half that has to survive time.

- Previously: [A 200 OK Is Not an Audit Trail](/blog/a-200-ok-is-not-an-audit-trail)
- Concept: [CyclesEvidence — Verifiable Audit for Agent Decisions](/concepts/cycles-evidence-verifiable-audit-for-agent-decisions)
- Reference: [CyclesEvidence Envelopes](/protocol/cycles-evidence-envelopes-in-cycles)
- Related: [What Is Runtime Authority for AI Agents?](/blog/what-is-runtime-authority-for-ai-agents) · [AI Agent Approval Queues Need Runtime Authority](/blog/ai-agent-approval-queues-need-runtime-authority)
