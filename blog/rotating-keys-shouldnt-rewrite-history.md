---
title: "Rotating Keys Shouldn't Rewrite History"
date: 2026-06-19
author: Albert Mavashev
tags:
  - governance
  - runtime-authority
  - audit
  - compliance
  - agents
  - evidence
  - cryptography
description: "Retired signing keys with validity windows keep old receipts verifiable after rotation — but bound the active key, or it can forge backdated evidence."
blog: true
sidebar: false
featured: false
head:
  - - meta
    - name: keywords
      content: "key rotation, signing key validity window, JWK set, retired keys, backdated evidence forgery, signer authority, issued_at_ms, Ed25519 verification, content-addressed receipt, long-horizon audit, EU AI Act record-keeping, did:cycles, key resolution"
---

# Rotating Keys Shouldn't Rewrite History

[Last time](/blog/a-valid-signature-doesnt-tell-you-who-signed-it) we drew the line between two questions a signed receipt has to answer — *do these bytes match this key* (validity) and *is this key allowed to speak for that server* (authority) — and we flagged a trap at the end: keys rotate, and a verifier that resolves "the current key" silently destroys every receipt signed before the rotation. We said the fix was to keep retired keys with validity windows and select by issuance time, and that the publication side of that was the next step.

That step is built now. And building it surfaced the part the first post didn't: the same windows that protect *old* keys, if you're not careful, hand the *current* key a forgery — the ability to backdate evidence into a retired key's era.

<!-- more -->

## The rule, restated

A [CyclesEvidence](/concepts/cycles-evidence-verifiable-audit-for-agent-decisions) receipt is content-addressed and signed once, then expected to verify for years — long after the key that signed it has been rotated out. So the verifier never asks "is this the current key?" It asks "which key was authoritative at this receipt's `issued_at_ms`?" and checks the signature against *that* one.

For that to work, the server's published key set has to carry its retired keys, not just its active one. Each key gets a validity window — `cycles_nbf_ms` (valid-from, inclusive) and `cycles_exp_ms` (valid-until, exclusive) — and a `status`. A receipt from two rotations ago resolves against the key whose window covers when it was signed, and verifies. Rotation stops being an outage for old evidence. That much the previous post promised.

## The forgery the windows create

Here is the part that is easy to get catastrophically wrong, and it is not the one you would guess.

Walk a rotation through. Key A signed everything up to time *T*; at *T* you rotate to key B and publish B as the active key. The naive way to publish an active key is "valid from now on" — but the laziest implementation publishes it with no real lower bound at all: valid since epoch, `cycles_nbf_ms = 0`. After all, it's the current key; why would it need a floor?

Because the window is not decoration — it is the *authority claim*. A window says "this key was authorized to speak for the server during exactly this interval." An active key published as valid since epoch is claiming it was authoritative for all of time, including the entire period when key A was the real signer.

Now whoever holds key B — the operator, or an attacker who compromised the *current* key — writes a fresh receipt, stamps it with an `issued_at_ms` from last quarter, and signs it with B. The verifier resolves: the signing key is B's material, B's window covers last quarter (it covers everything), the signature is valid. Verdict: **authentic**. The current key just manufactured a receipt that claims to be eight months old, and the audit trail accepted it.

Note what this is *not*. It is not the embedded-key forgery from the [first post](/blog/a-valid-signature-doesnt-tell-you-who-signed-it) — B is a genuinely authorized server key. It is not a tampered signature — the bytes verify. It is a backdating forgery that lives entirely *inside* the authority model, and a verifier that only checks "valid signature, key in the published set, window covers the timestamp" walks right into it. The rotation history that saves your old evidence is the exact mechanism that enables it, because you taught the verifier to trust whichever key's window covers the claimed time — and you left one key's window unbounded.

## Bound the active key

The fix is symmetric with the thing it protects. If a retired key is trusted *only* within its closed window, the active key has to be bounded *below* too: it can be authoritative going forward, but not for any time a previous key already owns.

Concretely, the active key's published `cycles_nbf_ms` must sit at or after the latest retired key's `cycles_exp_ms` — the rotation boundary. Set it that way and the windows tile cleanly: `[…, T)` for the retiring key, `[T, ∞)` for the new one. A receipt claiming an `issued_at_ms` before *T* but signed by B now falls *outside* B's window. It does not resolve as authentic. The backdating door is shut, and old receipts signed by A still verify against A — both properties hold at once, because they are the same property applied to both ends of the timeline.

The documented rotation procedure says exactly this: when you rotate, set the new key's valid-from to the rotation time and retire the old key with its valid-until at that same time. But "the docs say so" is not a security control — operators leave defaults in place. So the publisher enforces it: if the active key's configured floor is below the newest retired key's expiry, the published window is **clamped up** to that boundary before anything is served. A misconfiguration that would have opened the backdating window instead produces a correct, bounded active window and a warning, not a quiet hole.

Clamp rather than refuse, deliberately. Failing closed here — refusing to publish the key set at all on a questionable config — would take down resolution for *every* receipt, turning one operator's typo into a fleet-wide verification outage. That trade is wrong for an audit feature: the safe failure is to publish a *more* restrictive active window, never a more permissive one, and keep serving.

## The unglamorous edges

The rest of the hardening is the kind of thing that only shows up once real rotation history flows through the publisher, and it follows the same fail-safe rule — drop the bad entry, never the whole set:

- **Degenerate windows** — an empty or inverted window (`cycles_exp_ms <= cycles_nbf_ms`), or a bound that isn't a real timestamp (missing, non-integral, or beyond the range a 64-bit epoch-millis value can hold) — is dropped, not published. A window that can't mean anything shouldn't be allowed to mean *something* by accident.
- **Overlapping key material** — the same key republished with two overlapping windows would make selection ambiguous; the overlapping entry is skipped. Reusing one key across genuinely *disjoint* periods is fine and preserved, because disjoint windows are unambiguous.
- **Duplicate identifiers** — a key id that collides with one already in the set is dropped; a published set must never carry two keys under the same `kid`.

None of these is exciting. All of them are the difference between a key set a verifier can trust mechanically and one that quietly resolves to the wrong answer under a bad config.

## The honest boundary

Two limits, stated plainly, because over-claiming an audit feature is its own failure mode:

- **This is the publication and resolution mechanism, not key custody.** Bounding the active window stops a *published* key set from authorizing backdated signatures. It does not protect a private key that has been stolen and used *within* its legitimate window — that is key management, and it is a different problem.
- **It is opt-in and still settling.** A server publishes retired-key history only when its operator configures it, and the `did:cycles` producer-side identity that makes the whole set self-describing is still landing. Until then, the [pinned-signer path](/blog/a-valid-signature-doesnt-tell-you-who-signed-it) — `binding_only` — remains the honest posture for consumers that haven't wired resolution.

## Close the loop

Key rotation is hygiene; an audit trail is supposed to outlive it. Getting that right means two symmetric guarantees, not one: a retired key keeps verifying its old receipts *inside* its window, and the active key cannot reach *back* past the rotation boundary to forge new ones. Drop either half and rotation either erases your history or lets the current key rewrite it — and for [runtime authority](/blog/what-is-runtime-authority-for-ai-agents) records meant to satisfy a regulator long after the decision, both failures are the asset evaporating.

The windows are the whole mechanism. The discipline is remembering they bound *both* ends of time.

- Previously: [A Valid Signature Doesn't Tell You Who Signed It](/blog/a-valid-signature-doesnt-tell-you-who-signed-it)
- Concept: [CyclesEvidence — Verifiable Audit for Agent Decisions](/concepts/cycles-evidence-verifiable-audit-for-agent-decisions)
- Reference: [CyclesEvidence Envelopes](/protocol/cycles-evidence-envelopes-in-cycles)
- Related: [A 200 OK Is Not an Audit Trail](/blog/a-200-ok-is-not-an-audit-trail) · [What Is Runtime Authority for AI Agents?](/blog/what-is-runtime-authority-for-ai-agents)
