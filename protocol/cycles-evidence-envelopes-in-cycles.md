---
title: "CyclesEvidence Envelopes in Cycles"
description: "The wire shape, evidence_id content-hash recipe, Ed25519 signature derivation, the cycles_evidence response reference, the getEvidence endpoint, and how to verify a CyclesEvidence envelope."
---

# CyclesEvidence Envelopes in Cycles

This page is the protocol reference for CyclesEvidence — the signed, content-addressed audit envelope behind the [verifiable-audit concept](/concepts/cycles-evidence-verifiable-audit-for-agent-decisions). For *why* it exists, start there; this page is the *how*.

The consumer surface (`cycles_evidence` on responses, `GET /v1/evidence/{id}`) is defined in `cycles-protocol-v0.yaml`. The envelope itself is specified in the draft companion [`cycles-evidence-v0.1.yaml`](https://github.com/runcycles/cycles-protocol/blob/main/drafts/cycles-evidence-v0.1.yaml) (pre-normative).

## The `cycles_evidence` reference

Every decide / reserve / commit / release response — and budget/lifecycle **denial** responses — may carry an optional `cycles_evidence`:

```json
"cycles_evidence": {
  "evidence_id": "8403bed4…7030",
  "cycles_evidence_url": "https://cycles.example.com/v1/evidence/8403bed4…7030"
}
```

- `evidence_id` — lowercase 64-hex SHA-256, the content address of the signed envelope.
- `cycles_evidence_url` — `{server_id}/evidence/{evidence_id}`. `server_id` already includes the `/v1` base, so the join adds only `/evidence/{id}`.

It is **transport metadata, not attested** — present for the caller's convenience and computed over the response *without* this field (see [Non-self-referential](#non-self-referential) below). It is absent when evidence emission is disabled, or for errors raised before a decision was reached (validation/auth failures). Additive and `@JsonInclude(NON_NULL)`: a client that ignores it is unaffected.

## The envelope and its five artifact types

`GET /v1/evidence/{id}` returns the signed envelope verbatim:

```json
{
  "schema_version": "cycles-evidence/v0.1",
  "artifact_type": "reserve",
  "server_id": "https://cycles.example.com/v1",
  "signer_did": "b10554…c522",
  "issued_at_ms": 1781436904050,
  "trace_id": "b2a0ab88…dc02",
  "payload": { "reserve": { "request": { … }, "response": { … } } },
  "evidence_id": "8403bed4…7030",
  "signature": "4bc8cb9a…8c08"
}
```

| `artifact_type` | Endpoint | Payload |
|---|---|---|
| `decide` | `POST /v1/decide` | `{ request, response }` |
| `reserve` | `POST /v1/reservations` | `{ request, response }` |
| `commit` | `POST /v1/reservations/{id}/commit` | `{ reservation_id, request, response }` |
| `release` | `POST /v1/reservations/{id}/release` | `{ reservation_id, request, response }` |
| `error` | any of the above (4xx/5xx) | `{ endpoint, http_status, [reservation_id], [request], response }` |

`commit` / `release` (and commit/release `error`s) **hoist `reservation_id`** into the payload so an evidence-only reader can reconstruct the authorization → settlement chain without the URL.

### Denials → the `error` artifact

A non-dry `reserve` over budget is **not** a `200` with `decision: DENY` — it is an `HTTP 409` with `error: BUDGET_EXCEEDED`, captured as an `error` envelope (`endpoint: "POST /v1/reservations"`, `http_status: 409`). The other budget/lifecycle denials behave the same — `BUDGET_FROZEN`, `BUDGET_CLOSED`, `OVERDRAFT_LIMIT_EXCEEDED`, `DEBT_OUTSTANDING`, `UNIT_MISMATCH`, and the commit/release terminal-state denials `RESERVATION_FINALIZED` (409) and `RESERVATION_EXPIRED` (410). Pre-evaluation failures (validation, auth, malformed body) carry **no** `cycles_evidence` — no decision was reached, so there is nothing to attest. (A dry-run preflight denial, by contrast, is a `200` captured as `reserve` evidence — it is the canonical "would this be allowed?" attestation.)

## `evidence_id` — the content-hash recipe (normative)

1. Build the envelope with every field populated **except** `evidence_id` and `signature`, both set to the empty string `""`.
2. Canonicalize per RFC 8785 (JCS); UTF-8 encode.
3. `evidence_id` = lowercase hex SHA-256 of those bytes.

Because the id is a pure function of the contents (no private key), **Cycles computes it synchronously and returns it on the response**, even though signing happens later.

## Signature derivation (normative)

1. Take the envelope with `evidence_id` now populated and `signature` still `""`.
2. Canonicalize again (JCS), UTF-8 encode.
3. `signature` = lowercase hex of the Ed25519 signature over those bytes, using the server's signing key (named by `signer_did`).

This is the same id-then-signature ordering used elsewhere in the agent-trust ecosystem, so a consumer that can verify one of those receipts can verify a CyclesEvidence envelope with the same primitives.

## Non-self-referential

The `cycles_evidence` ref is stamped onto the response **after** `evidence_id` is computed. So the `payload.<artifact>.response` inside the envelope never contains `cycles_evidence` — the content hash is never self-referential. The response mirrors in the draft keep `additionalProperties: false` and omit the ref to make this explicit.

## How to verify

Given an envelope:

1. **Re-derive `evidence_id`** per the recipe above and compare byte-for-byte. Mismatch ⇒ tampered or canonicalization error.
2. **Verify the Ed25519 `signature`** (with `evidence_id` populated, `signature` emptied) against the key in `signer_did`.
3. **Check the `artifact_type` ↔ `payload` pairing** (e.g. `artifact_type: commit` requires `payload.commit`).

Signature *validity* against `signer_did` is fully specified today. Signer *authority* — proving `signer_did` is genuinely the legitimate Cycles signer for `server_id` at `issued_at_ms` (did:cycles / JWKS / key rotation) — is the v0.2 work tracked in [cycles-protocol#103](https://github.com/runcycles/cycles-protocol/issues/103). Until then, pin the expected signer (`expected_signer`) for issuer trust.

## Producer / signer split

- **`cycles-server`** computes `evidence_id` synchronously, returns `cycles_evidence`, and serves `GET /v1/evidence/{id}`. It holds only the **public** identity.
- **`cycles-server-events`** asynchronously builds, **Ed25519-signs** (the private key lives only here), and stores the envelope content-addressed. It recomputes the id and **dead-letters on drift**, so producer/signer config mismatch fails closed.

Because signing is async, a fetch immediately after the response may return a transient `404` — treat it as not-yet-available and retry.

## Enabling it

Evidence is **off until a shared signing identity is configured** (`EVIDENCE_SERVER_ID` + `EVIDENCE_SIGNING_SIGNER_DID` on both services; the private `EVIDENCE_SIGNING_PRIVATE_KEY_HEX` only on `cycles-server-events`). See the operator [identity enablement runbook](https://github.com/runcycles/cycles-server-events/blob/main/docs/evidence-identity-enablement.md).

## Related

- [CyclesEvidence: Verifiable Audit for Agent Decisions](/concepts/cycles-evidence-verifiable-audit-for-agent-decisions) — the why.
- [Error Codes and Error Handling](/protocol/error-codes-and-error-handling-in-cycles) — the denial codes that surface as `error` evidence.
- [Correlation and Tracing](/protocol/correlation-and-tracing-in-cycles) — the `trace_id` carried on every envelope.
