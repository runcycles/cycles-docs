---
title: "What Goes in an AI Agent Audit Packet?"
date: 2026-06-24
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
description: "A practical audit packet checklist for AI agent controls: denial receipts, verifier output, signer keys, retention policy, trace IDs, and findings for reviews."
blog: true
sidebar: false
featured: false
head:
  - - meta
    - name: keywords
      content: "AI agent audit packet, agent audit evidence, CyclesEvidence verification, signed receipts, verifier output, signer authority, key retention, security review, runtime authority"
---

# What Goes in an AI Agent Audit Packet?

A customer security review asks a simple question: prove the agent could not spend or act outside its approved scope.

The team has [dashboards](/glossary#dashboard). It has logs. It has traces, tickets, screenshots, and a runbook that says the control exists. None of that is the same as a portable proof package.

The reviewer does not need your entire observability system. They need enough evidence to answer the operational question without trusting the live application: what did the agent try to do, what did the authority decide, can the receipt be verified, who signed it, and how long will that proof survive?

That is the job of an AI agent audit packet.

<!-- more -->

## A packet is not a log export

A log export is broad. An audit packet is narrow.

The packet should contain the minimum set of artifacts that lets a reviewer reconstruct one control outcome. For agent systems, the highest-signal packet is usually built around a denial: a budget reserve that returned `409 BUDGET_EXCEEDED`, an overdraft attempt that returned `409 OVERDRAFT_LIMIT_EXCEEDED`, or a commit against an expired [reservation](/glossary#reservation) that returned `410 RESERVATION_EXPIRED`.

Those denials matter because they prove the system did more than observe an agent. The [runtime authority](/glossary#runtime-authority) stopped an action before the side effect happened.

The packet is also different from a live demo. A live demo proves the current system can produce a good result. A packet proves a past event still verifies after ordinary production has happened to it: async signing, storage, key rotation, retention, incident handoff, and operator turnover.

That is why the companion practice is the [audit evidence drill](/blog/run-audit-evidence-drill-before-audit-day). The drill tests the path. The packet is what you keep.

## The packet answers six questions

Start with the reviewer questions, not with the systems that produced the records.

| Question | Packet evidence |
|---|---|
| What was attempted? | Agent, [tenant](/glossary#tenant) or workspace scope, action, reservation, commit, release, or tool operation |
| What did the authority decide? | Decision response, denial code, `ALLOW`, `ALLOW_WITH_CAPS`, or `DENY` summary |
| Can the bytes be verified? | `evidence_id` recomputation, canonical JSON check, Ed25519 signature result |
| Who signed it? | `server_id`, `signer_did`, key id, JWK Set reference, signer-authority disposition |
| Where do operational records join? | `trace_id`, `correlation_id`, event id, audit id, incident ticket, dashboard link |
| How long will it survive? | Evidence retention, audit-log retention, archive restore path, retired-key retention |

The first two questions explain the control outcome. The next two make it independently verifiable. The last two make it operationally useful after the people and systems around the event have changed.

If a packet cannot answer all six, it may still be useful for debugging, but it is not ready for an audit conversation.

## The minimum packet

For a Cycles-controlled agent action, the packet should be small enough to review and complete enough to rerun.

| Packet item | What it should contain | Why it belongs |
|---|---|---|
| Cover sheet | One-paragraph summary of the attempted action, subject scope, denial, and review purpose | Gives humans the claim being proved |
| Receipt reference | `evidence_id`, `cycles_evidence_url`, issuing `server_id`, event time | Gives reviewers the stable pointer |
| Envelope copy | Raw envelope bytes or immutable archive pointer | Preserves the exact object being verified |
| Verification output | Hash result, signature result, artifact-type check, verifier version or command | Shows the technical result, not just a conclusion |
| Signer authority note | `signer_did`, `kid`, JWK Set URL or snapshot, authority disposition | Separates "signed by a key" from "authorized for this server then" |
| Decision chain | Relevant `decide`, `reserve`, `commit`, `release`, or `error` artifacts | Explains where the control fired |
| Correlation bundle | `trace_id`, `correlation_id`, audit/event IDs, incident or change ticket links | Connects proof to operations without dumping every log |
| Retention statement | Hot store duration, archive path, restore procedure, retired-key retention | Shows the proof will survive the review window |
| Findings log | Gaps, owner, due date, follow-up drill date | Turns weak evidence into managed risk |

The [CyclesEvidence concept page](/concepts/cycles-evidence-verifiable-audit-for-agent-decisions) explains why the receipt exists. The [envelope protocol](/protocol/cycles-evidence-envelopes-in-cycles) defines the five artifact types: `decide`, `reserve`, `commit`, `release`, and `error`. The packet does not replace those documents. It packages their output for a specific review.

## What the receipt proves

The receipt is the center of the packet, but it needs careful language.

A Cycles response can carry a `cycles_evidence` reference with an `evidence_id` and a `cycles_evidence_url`. The `evidence_id` is the lowercase SHA-256 hash of the canonical envelope bytes with `evidence_id` and `signature` set to empty strings. The signature is then produced over a second canonical form, with `evidence_id` populated and `signature` emptied.

That gives the packet two checks:

| Check | Meaning |
|---|---|
| `evidence_id` recomputes | The named receipt matches the envelope bytes |
| Ed25519 signature verifies | The canonical bytes match the public key named by `signer_did` |

Those checks are strong, but they are not the whole claim.

A valid signature says the bytes match a key. It does not, by itself, say the key was authorized to sign for the issuing server. That is the signer-authority question covered in [A Valid Signature Doesn't Tell You Who Signed It](/blog/a-valid-signature-doesnt-tell-you-who-signed-it).

The packet should therefore avoid vague conclusions like "verified." Write the actual disposition.

| Disposition | Use this when |
|---|---|
| `authentic` | Signature is valid and the signer was authorized for `server_id` at `issued_at_ms` |
| `binding_only` | Signature is valid, but the verifier used a pinned signer or did not resolve server authority end to end |
| `signer_resolution_failed` | The key set could not be fetched, parsed, or trusted for this check |
| `signer_authority_failed` | The key set resolved, but the signer was not authorized for the issuance time |
| `signature_invalid` | Cryptographic verification failed |

Signer-key publication is available through:

```text
GET {server_id}/.well-known/cycles-jwks.json
```

Each key has a validity window. The verifier selects the key whose `[cycles_nbf_ms, cycles_exp_ms)` window covers the envelope's `issued_at_ms`; it does not select whatever key is active today. That distinction is why old receipts can still verify after rotation, and why [rotating keys should not rewrite history](/blog/rotating-keys-shouldnt-rewrite-history).

Be explicit about the current integration boundary. Signer-key publication is shipped. End-to-end consumer resolution is still additive. Until the verifier round-trips authority against the published set, record the result as `binding_only`, not `authentic`.

## What the decision summary should say

The cover sheet should be short and concrete.

```text
On 2026-03-18 at 14:22:11 UTC, agent support-refund-prod attempted a
reserve for tenant acme / workflow refund-review. The runtime authority
returned 409 BUDGET_EXCEEDED before execution. The packet includes the
CyclesEvidence envelope, recomputed evidence_id, Ed25519 signature result,
signer-authority disposition, trace_id, audit/event joins, and retention note.
```

That paragraph gives a reviewer the claim. The rest of the packet lets them verify it.

The summary should not include private keys, bearer [tokens](/glossary#tokens), admin API keys, webhook secrets, or broad prompt transcripts. If the raw envelope contains sensitive payload data, store the exact envelope in a controlled evidence archive and put a redacted explanation in the cover sheet. Redacting the signed bytes breaks the signature, so keep the raw evidence available under the right access control rather than pretending the redacted copy is the cryptographic artifact.

## Three audience views

The same packet can serve several review paths, but each audience looks for a different emphasis.

| Audience | They care most about | Packet emphasis |
|---|---|---|
| Customer security review | Whether agent controls are real in production | Denial receipt, verifier output, retention statement |
| Incident review | Whether the system behaved correctly during a specific event | Decision chain, trace joins, operator notes, findings |
| Compliance or internal audit | Whether evidence is durable and reproducible | Archive path, key history, retention, repeatable verification |

Do not make three separate evidence systems. Keep one packet shape and adjust the cover sheet. The cryptographic receipt, signer note, trace joins, and retention statement should be the same source of truth across all three.

That consistency matters. If the security team, incident commander, and compliance owner each keep their own disconnected version, the next review turns into reconciliation work.

## What belongs outside the packet

The packet is not a place to copy every record that mentions the agent.

Leave these out unless a reviewer explicitly needs them:

| Exclude by default | Reason |
|---|---|
| Private signing keys | Public verification never requires them |
| Admin API keys, bearer tokens, webhook secrets | They create new incident risk |
| Full prompt transcripts | They are often overbroad and may include sensitive content |
| Full log dumps | They hide the evidence path instead of clarifying it |
| Screenshots as primary evidence | They are useful context, not verifiable proof |
| Current-only dashboards | They may not preserve the historical state being reviewed |

The goal is not to starve the reviewer. The goal is to give them the evidence that answers the question and a clear path for escalation when they need more.

A good packet says: here is the receipt, here is how it was verified, here is where related records live, and here is who can authorize deeper access.

## Retention is part of the claim

A packet that verifies today can still fail the next review if retention is accidental.

Record the retention policy in plain terms:

| Record | Retention question |
|---|---|
| Signed envelope | How long does the exact envelope remain fetchable or restorable? |
| Retired signing keys | Are they retained at least as long as receipts that need them? |
| Runtime audit rows | Do they outlive the review window for authenticated control events? |
| Admin audit rows | Are successful and failed administrative changes retained by tier? |
| Event and delivery records | Are they retained long enough for correlation and incident review? |
| Restore procedure | Can a new operator retrieve old evidence without the original engineer? |

The [server configuration reference](/configuration/server-configuration-reference-for-cycles) documents audit-log and event-retention knobs. Those records are related, but they are not interchangeable. A signed envelope, an audit row, a [webhook delivery](/glossary#webhook-delivery) record, and a Prometheus counter answer different questions.

For audit packets, the key rule is simple: the evidence, the key history, and the operational join records must survive long enough to be reviewed together. If one expires early, the packet should record that as a finding.

## How to write findings

Findings should be boring and specific.

| Weak note | Better finding |
|---|---|
| "Evidence missing" | "`cycles_evidence` was absent on `POST /v1/reservations` denial for tenant acme on 2026-03-18; owner: runtime team; due: 2026-07-10." |
| "Verifier failed" | "`evidence_id` recomputed successfully, signature valid, signer authority unresolved because `cycles-jwks.json` returned 404; disposition recorded as `binding_only`." |
| "Retention unknown" | "Envelope fetch succeeded from hot store; no cold-archive restore procedure documented for receipts older than 400 days." |
| "Need key rotation test" | "Receipt issued before 2026-H2 rotation has not been verified against retired key window; run follow-up drill after next rotation." |

This is the difference between a packet and a folder of artifacts. A packet has a conclusion, evidence for the conclusion, and open risk stated in a way someone can close.

## A reusable packet outline

Keep the packet format simple enough that teams actually use it.

```markdown
# Agent audit packet: <control event>

## Summary
- Event:
- Agent / workflow:
- Tenant / scope:
- Authority decision:
- Review purpose:

## Receipt
- evidence_id:
- cycles_evidence_url:
- server_id:
- issued_at_ms:
- artifact_type:

## Verification
- evidence_id recomputed:
- signature result:
- signer authority disposition:
- verifier version / command:
- JWK Set URL or snapshot:

## Operational joins
- trace_id:
- correlation_id:
- audit rows:
- event / delivery records:
- incident or change ticket:

## Retention
- envelope retention:
- archive / restore path:
- retired-key retention:
- audit/event retention:

## Findings
- finding:
- owner:
- due date:
- follow-up drill:
```

The outline is intentionally plain. The value is not the template. The value is forcing each packet to carry the proof, the joins, the retention statement, and the unresolved gaps in one place.

## From drill to packet

The [audit evidence drill](/blog/run-audit-evidence-drill-before-audit-day) asks the team to pick one real denied action and prove it months later. This post answers the next question: what should you keep after the drill?

Keep the packet.

It should be small enough that a customer security reviewer can read it, specific enough that an incident reviewer can follow the event, and durable enough that a compliance reviewer can rerun the verification after key rotation and retention have done their work.

The operational standard is simple: a new reviewer should be able to open the packet, fetch or restore the envelope, recompute the `evidence_id`, verify the signature, understand the signer-authority disposition, follow the trace joins, and see the retention posture without asking the original engineer to reconstruct the story from memory.

That is what makes agent-control evidence portable. It does not ask the reviewer to believe the system. It gives them the receipt, the verification path, and the operating record around it.

## Resources

- [Run the Audit Evidence Drill Before Audit Day](/blog/run-audit-evidence-drill-before-audit-day)
- [Audit Evidence Has to Survive Production](/blog/audit-evidence-has-to-survive-production)
- [CyclesEvidence: Verifiable Audit for Agent Decisions](/concepts/cycles-evidence-verifiable-audit-for-agent-decisions)
- [CyclesEvidence Envelopes in Cycles](/protocol/cycles-evidence-envelopes-in-cycles)
- [A Valid Signature Doesn't Tell You Who Signed It](/blog/a-valid-signature-doesnt-tell-you-who-signed-it)
- [Rotating Keys Shouldn't Rewrite History](/blog/rotating-keys-shouldnt-rewrite-history)
- [Server Configuration Reference](/configuration/server-configuration-reference-for-cycles)
- [RFC 8785: JSON Canonicalization Scheme](https://www.rfc-editor.org/rfc/rfc8785.html)
- [RFC 8032: EdDSA: Ed25519 and Ed448](https://www.rfc-editor.org/rfc/rfc8032.html)
