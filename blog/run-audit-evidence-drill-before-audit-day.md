---
title: "Run the Audit Evidence Drill Before Audit Day"
date: 2026-06-23
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
description: "A practical drill for proving an AI agent denial months later: fetch the receipt, resolve signer authority, test key rotation, and document retention gaps."
blog: true
sidebar: false
featured: false
head:
  - - meta
    - name: keywords
      content: "AI agent audit evidence drill, CyclesEvidence verification, signed receipts, signer authority, key rotation, evidence retention, agent governance audit, runtime authority operations"
---

# Run the Audit Evidence Drill Before Audit Day

Pick one denied agent action from last quarter.

Not the happy path from staging. Not the sample receipt from the docs. A real production denial: an agent tried to reserve too much budget, or a risky action crossed its [RISK_POINTS](/glossary#risk-points) cap, and the [runtime authority](/glossary#runtime-authority) said no.

Now prove it.

Fetch the signed receipt. Recompute the `evidence_id`. Verify the Ed25519 signature. Resolve the signer that was authoritative at the envelope's `issued_at_ms`. Confirm the key rotation history still covers that moment. Show the retention policy that kept the envelope available. Hand the packet to someone who was not on the original incident and ask whether they can verify the control fired.

That is the audit evidence drill.

If the first time you run it is during a customer review, an incident retrospective, or a compliance audit, you are testing the evidence system at the most expensive possible moment.

<!-- more -->

## Why a drill is different from a checklist

The recent [CyclesEvidence](/glossary#cyclesevidence) series covered the design from several angles:

- [A 200 OK is not an audit trail](/blog/a-200-ok-is-not-an-audit-trail): a live response is not proof for a later reviewer.
- [A valid signature does not tell you who signed it](/blog/a-valid-signature-doesnt-tell-you-who-signed-it): byte integrity and signer authority are different questions.
- [Rotating keys should not rewrite history](/blog/rotating-keys-shouldnt-rewrite-history): verifiers must select the key that was authoritative at issuance time, not whatever key is current today.
- [Audit evidence has to survive production](/blog/audit-evidence-has-to-survive-production): receipts need an operating path, not just a cryptographic shape.

Those posts describe what has to be true. A drill checks whether it is true in your deployment.

A checklist can say "retired keys are retained." A drill discovers that the retired-key JSON was malformed after the last rotation. A checklist can say "evidence is stored by content address." A drill discovers that the hot store expired the envelope before the cold export job picked it up. A checklist can say "verification distinguishes resolution failure from invalid signature." A drill forces an operator to explain which one happened.

The goal is not theater. The goal is to find the gaps while the team still controls the calendar.

## What to drill

Use a real denied action, because denials are the control evidence auditors usually care about most. A production `DENY` says the system did more than observe an agent. It stopped one.

Good drill candidates:

| Candidate | Why it is useful |
|---|---|
| `409 BUDGET_EXCEEDED` from a non-dry reserve | Proves budget enforcement blocked spend before execution |
| `409 OVERDRAFT_LIMIT_EXCEEDED` | Exercises over-limit policy and denial evidence |
| `410 RESERVATION_EXPIRED` on commit | Proves terminal lifecycle errors are attestable |
| [RISK_POINTS](/glossary#risk-points) reserve denial before a high-risk tool | Proves action policy blocked a side effect through the budget ledger |
| A denial from before the latest signing-key rotation | Exercises retired-key resolution |

The best first drill is the uncomfortable one: a denial older than the most recent key rotation, old enough that hot operational records may have aged out, but recent enough that the team still remembers the context. That receipt tests the parts most likely to fail silently: retention, signer resolution, and runbook handoff.

Do not start with an `ALLOW`. Allowed actions matter, but a blocked action is the cleaner proof of control. If you can prove the no, proving the yes is usually easier.

## The five questions the drill must answer

The drill should end with a small packet that answers five questions without depending on trust in the live application:

| Question | Evidence in the packet |
|---|---|
| What did the agent try to do? | Envelope `payload`, subject scope, action or [reservation](/glossary#reservation) request, response, reason code |
| Was the receipt changed? | Recomputed `evidence_id` matches the envelope |
| Was it signed by the claimed key? | Ed25519 signature verifies over the canonical bytes |
| Was that key authorized then? | Published JWK window covers `issued_at_ms` and matches the signer |
| Can a reviewer reproduce the result? | Verifier command, key-set snapshot or URL, retention/export note, operator observations |

The [CyclesEvidence concept page](/concepts/cycles-evidence-verifiable-audit-for-agent-decisions) covers why this receipt exists. The [envelope reference](/protocol/cycles-evidence-envelopes-in-cycles) covers the wire shape: `decide`, `reserve`, `commit`, `release`, and `error` artifacts; the `evidence_id` recipe; the signature recipe; and signer-key publication at the Cycles JWK Set endpoint.

The drill is the bridge between those documents and an audit conversation.

## Step 1: Find the denial and its receipt

Start from the operational record you would naturally use during an investigation: an event, an audit row, an application trace, an incident ticket, or a [dashboard](/glossary#dashboard) row. The target record should carry either the `cycles_evidence.evidence_id` or the `cycles_evidence_url` returned on the original response.

Capture these fields in the drill notes:

| Field | Why it matters |
|---|---|
| `evidence_id` | Content address to verify and fetch |
| `cycles_evidence_url` | Retrieval path used by the reviewer |
| `trace_id` / `correlation_id` | Join point across events, application logs, and audit records |
| Denial code | The policy outcome being proven |
| Subject scope | [Tenant](/glossary#tenant), workspace, app, workflow, agent, or toolset boundary |
| Timestamp | Human-readable incident time, separate from envelope `issued_at_ms` |

If the receipt reference is missing, stop the drill and record that as a finding. Maybe evidence was disabled for that environment. Maybe the denial happened before evidence was configured. Maybe the caller dropped the field. Any of those can be acceptable for an old rollout window, but they are not acceptable as hidden assumptions.

The point of the drill is to turn "I think evidence is on" into a record that says exactly where evidence is on, where it is not, and which denial classes produce receipts.

## Step 2: Fetch the envelope

Fetch the envelope from the receipt URL, or from `GET /v1/evidence/{evidence_id}` on the issuing server.

Record the result:

| Result | Interpretation |
|---|---|
| `200` with envelope | Continue verification |
| Short-lived `404` on a fresh receipt | Async signer may not have landed yet; retry according to the runbook |
| Persistent `404` on an old receipt | Storage, retention, export, or signer pipeline gap |
| `5xx` | Retrieval path is not audit-ready until the outage is explained |
| Envelope id differs from requested id | Treat as a severe integrity or routing bug |

For a receipt from last quarter, a `404` is not "probably still signing." It is an evidence-retention failure until proven otherwise. The production evidence post made the core point: signing asynchronously is fine only if the source record is durable and the signer acknowledges after storage. A receipt id that cannot be fetched later is a promise the system did not keep.

If the envelope lives in cold storage, document the restore path. A reviewer does not need hot storage, but they do need a reproducible way to retrieve the exact envelope bytes.

## Step 3: Recompute the content address

The first cryptographic check is the `evidence_id`.

The [protocol reference](/protocol/cycles-evidence-envelopes-in-cycles) defines the recipe:

1. Build the envelope with `evidence_id` and `signature` set to `""`.
2. Canonicalize the JSON bytes with RFC 8785 JCS.
3. SHA-256 those bytes and compare the lowercase hex digest to `evidence_id`.

This catches accidental mutation before signature verification even enters the picture. It also catches verifier drift: if two implementations canonicalize the same envelope differently, one of them is wrong for this protocol.

The drill notes should include:

| Check | Expected result |
|---|---|
| `schema_version` recognized | `cycles-evidence/v0.1` for current envelopes |
| `artifact_type` matches payload branch | `error` has `payload.error`, `reserve` has `payload.reserve`, etc. |
| Recomputed hash matches | `evidence_id` equals SHA-256 over the canonical envelope-with-empty-id-and-signature |
| Payload response excludes `cycles_evidence` | No self-referential hash loop |

Do not skip this because the signature verifies. The content address is the receipt's stable name. If the name does not match the bytes, the rest of the packet is already suspect.

## Step 4: Verify the signature

The second cryptographic check is the Ed25519 signature.

The protocol signs a second canonical form: `evidence_id` populated, `signature` set to `""`, canonicalized with JCS, then signed with the server's signing key. Verification proves that those canonical bytes match the public key named by the envelope's signer.

That answers one narrow question: do these bytes match this key?

It does not answer whether the key was allowed to speak for the server. That is the signer-authority step. Keep the two results separate in the drill packet:

| Result | Meaning |
|---|---|
| Signature valid | The envelope bytes match the public key |
| Signature invalid | The bytes, signature, key, or canonicalization path do not line up |
| Signer not yet resolved | You have byte validity, not server authority |

This distinction is where many audit trails overclaim. "Signed" is not the same as "authentic." The drill should force the reviewer to write down which claim has been established.

## Step 5: Resolve signer authority at `issued_at_ms`

Now resolve the server's published key set:

```text
GET {server_id}/.well-known/cycles-jwks.json
```

Select the key whose `[cycles_nbf_ms, cycles_exp_ms)` window covers the envelope's `issued_at_ms`. Do not select by "current active key." Do not accept a key just because the envelope carried it. Do not treat a network error as a forgery.

Be precise about the state of the integration. The publication half is documented: a Cycles server can publish the active and retired public keys with validity windows. End-to-end consumer resolution is still an additive path. If your verifier only supports a pinned signer today, record the result as `binding_only` and drill the key-publication path separately instead of calling the receipt `authentic`.

The drill packet should record the authority disposition:

| Disposition | What it means operationally |
|---|---|
| `authentic` | Signature valid and signer was authorized for `server_id` at `issued_at_ms` |
| `binding_only` | Signature valid, but authority was pinned or not resolved end to end |
| `signer_resolution_failed` | Key set could not be fetched or parsed |
| `signer_authority_failed` | Key set resolved, but the signing key was not authorized for that time |
| `signature_invalid` | Cryptographic verification failed |

The key detail is the time comparison. If the receipt was issued before the most recent rotation, the active key today should usually not be the key that verifies it. The retired key should. That is how the drill catches both failures from the key-rotation post: old receipts rotting after rotation, and current keys being published with authority reaching back before their real rotation boundary.

If the result is only `binding_only`, that may still be acceptable for a known counterparty that pinned the signer ahead of time. It is not the same as third-party signer resolution. The packet should say so plainly.

## Step 6: Reconstruct the decision chain

Cryptography proves integrity and origin. The reviewer still needs to understand the control outcome.

For a denial, reconstruct the minimum decision chain:

| Artifact field | Question it answers |
|---|---|
| `artifact_type` | Was this a `reserve`, `commit`, `release`, `decide`, or `error`? |
| `payload.error.endpoint` | Which operation reached a denial or lifecycle error? |
| `payload.error.http_status` | How did the caller observe the denial? |
| Error code / reason | Which policy or lifecycle rule fired? |
| `payload.*.request.subject` | Which tenant or scope owned the attempted action? |
| `trace_id` | Which operational records join to this receipt? |

This is where evidence becomes useful to humans. A valid receipt that nobody can interpret is still a weak audit artifact. The packet should say, in one or two sentences:

```text
On 2026-03-18 at 14:22:11 UTC, agent support-refund-prod attempted a
reserve against tenant acme / workflow refund-review. The runtime returned
409 BUDGET_EXCEEDED before execution. The authority-resolving verifier
returned authentic for the issuing Cycles server at the envelope issuance time.
```

That paragraph is not a replacement for the receipt. It is the cover sheet that lets a reviewer know what the receipt proves.

## Step 7: Test retention, not just verification

A receipt that verifies today can still fail the next review if retention is accidental.

Record the retention path for the chosen receipt:

| Surface | Drill question |
|---|---|
| Hot evidence store | How long should this envelope stay fetchable without restore? |
| Cold archive | Where does it go after hot retention? |
| Key history | Are retired keys retained for at least as long as evidence that needs them? |
| Audit logs | Do admin/runtime audit rows outlive the review window? |
| Events | Are event and delivery records long-lived enough for correlation? |
| Export process | Can a new operator retrieve and verify without asking the original engineer? |

The [server configuration reference](/configuration/server-configuration-reference-for-cycles) documents retention knobs for runtime audit rows, admin audit rows, and event delivery records. Those records are related to evidence, but they are not all the same thing. A signed envelope may need a longer retention policy than hot events. Admin audit rows may need a different retention tier than unauthenticated failures. [Webhook delivery](/glossary#webhook-delivery) records may expire before the audit conversation begins.

The drill should expose those differences. "Redis still had it" is not a retention policy. "Signed evidence is retained for 400 days hot, exported daily to S3 with a restore drill every quarter, and retired signing keys are retained at least as long as evidence" is a policy someone can review.

## Common drill failures

Most failures are not cryptographic. They are operational.

| Failure | What it usually means | Fix before audit day |
|---|---|---|
| No `cycles_evidence` on the denial | Evidence disabled, not configured on that path, or caller dropped the field | Document enabled paths; add response-field capture to clients |
| Persistent `404` for an old `evidence_id` | Envelope was never stored, expired early, or archive restore is missing | Fix signer ack/storage path; define hot/cold retention |
| Hash mismatch | Envelope mutated, canonicalization drifted, or verifier is wrong | Compare against golden fixtures and protocol recipe |
| Signature invalid | Wrong key, wrong canonical bytes, corrupted envelope, or verifier bug | Separate key selection from canonicalization debugging |
| `signer_resolution_failed` | JWK Set unreachable, malformed, or not published | Fix well-known publication and monitoring |
| `signer_authority_failed` | Signing key not authorized for `issued_at_ms` | Repair key history; check rotation boundary |
| Only `binding_only` when authentic was expected | Consumer pinned signer but did not resolve authority | Decide whether pinned trust is enough for this review |
| Retired key missing | Rotation preserved current service but broke old evidence | Publish retired key with correct validity window |
| Active key valid since epoch after rotation | Current key can appear authoritative for old receipts | Bound active `cycles_nbf_ms` at rotation time |
| Operator cannot explain the packet | Runbook is incomplete | Add a drill transcript and ownership record |

The important habit is to write failures down as findings, not as excuses. A drill that uncovers a missing retired key succeeded. An audit that uncovers it first did not.

## The packet to keep

At the end of the drill, keep a short packet in the incident-review or compliance folder.

Minimum contents:

| Packet item | Example |
|---|---|
| Receipt reference | `evidence_id`, `cycles_evidence_url`, issuing `server_id` |
| Envelope copy | Raw JSON bytes or immutable archive pointer |
| Verification output | Hash match, signature result, authority disposition |
| Key material reference | JWK Set URL or archived key-set snapshot used for verification |
| Rotation note | Which `kid` covered `issued_at_ms`; active/retired status |
| Decision summary | Human-readable statement of what was denied and why |
| Correlation links | `trace_id`, `correlation_id`, incident ticket, relevant audit/event IDs |
| Retention statement | Hot retention, cold archive, restore procedure, key-history retention |
| Gaps found | Findings, owners, due dates, and follow-up drill date |

This packet should be boring. It should not depend on a tribal-memory explanation from the engineer who built the feature. A new operator should be able to read it, rerun the verifier, and reach the same disposition.

That is the practical standard for audit-ready evidence.

## When to run it

Run the drill on a cadence tied to changes that can break evidence:

| Trigger | Why |
|---|---|
| First evidence enablement in production | Proves configuration and signer split work outside staging |
| After every signing-key rotation | Proves old evidence still verifies and active key is bounded |
| After retention-policy changes | Proves envelopes and key history outlive the review window |
| After signer or storage incidents | Proves source records, dead letters, and recovery did their job |
| Before customer security reviews | Produces a current packet instead of a live demo |
| Quarterly for regulated workloads | Keeps the path fresh enough that operator turnover does not erase it |

A quarterly drill is usually enough for stable deployments. Rotation-heavy environments should run one immediately after each rotation. The drill does not need a large sample. One old denial that crosses the latest rotation boundary teaches more than a dozen fresh `ALLOW` receipts from yesterday.

## What this changes

The first evidence milestone is being able to sign a receipt. The production milestone is being able to retrieve and verify it after ordinary production has happened to it.

The drill makes that milestone concrete. It ties together the pieces that otherwise live in separate mental drawers: [runtime authority](/glossary#runtime-authority), content-addressed envelopes, canonical JSON, Ed25519 signatures, signer authority, JWK validity windows, retention, archive restore, events, and operator runbooks.

It also changes the audit conversation. Without the drill, the team says "Cycles would have denied that." With the drill packet, the team says "Here is the denial receipt; here are the bytes; here is the signer that was authoritative then; here is the verifier output; here is how we know it survived rotation and retention."

That is a different posture. It is not more dramatic. It is just less dependent on trust.

Evidence should prove that the control fired. The audit evidence drill proves that the proof still works.

## Resources

- [CyclesEvidence: Verifiable Audit for Agent Decisions](/concepts/cycles-evidence-verifiable-audit-for-agent-decisions)
- [CyclesEvidence Envelopes in Cycles](/protocol/cycles-evidence-envelopes-in-cycles)
- [A 200 OK Is Not an Audit Trail](/blog/a-200-ok-is-not-an-audit-trail)
- [A Valid Signature Doesn't Tell You Who Signed It](/blog/a-valid-signature-doesnt-tell-you-who-signed-it)
- [Rotating Keys Shouldn't Rewrite History](/blog/rotating-keys-shouldnt-rewrite-history)
- [Audit Evidence Has to Survive Production](/blog/audit-evidence-has-to-survive-production)
- [Server Configuration Reference](/configuration/server-configuration-reference-for-cycles)
- [RFC 8785: JSON Canonicalization Scheme](https://www.rfc-editor.org/rfc/rfc8785.html)
- [RFC 8032: EdDSA: Ed25519 and Ed448](https://www.rfc-editor.org/rfc/rfc8032.html)
