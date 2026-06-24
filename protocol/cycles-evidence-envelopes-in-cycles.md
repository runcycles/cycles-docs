---
title: "CyclesEvidence Envelopes in Cycles"
description: "The wire shape, evidence_id content-hash recipe, Ed25519 signature derivation, the cycles_evidence response reference, the getEvidence endpoint, and how to verify a CyclesEvidence envelope."
---

# CyclesEvidence Envelopes in Cycles

This page is the protocol reference for CyclesEvidence — the signed, content-addressed audit envelope behind the [verifiable-audit concept](/concepts/cycles-evidence-verifiable-audit-for-agent-decisions). For *why* it exists, start there; this page is the *how*.

The consumer surface (`cycles_evidence` on responses, `GET /v1/evidence/{id}`, and `GET /v1/.well-known/cycles-jwks.json`) is defined in `cycles-protocol-v0.yaml`. The envelope and signer-authority rules are specified in [`cycles-evidence-v0.2.yaml`](https://github.com/runcycles/cycles-protocol/blob/main/cycles-evidence-v0.2.yaml). The wire `schema_version` remains `cycles-evidence/v0.1` for compatibility; v0.2 adds the normative JWK Set authority layer around that envelope shape.

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
2. **Resolve signer authority** by fetching `GET {server_id}/.well-known/cycles-jwks.json` and selecting the Ed25519 JWK whose `[cycles_nbf_ms, cycles_exp_ms)` window covers the envelope's `issued_at_ms`. The selected key's public bytes must match `signer_did`.
3. **Verify the Ed25519 `signature`** (with `evidence_id` populated, `signature` emptied) against that public key.
4. **Check the `artifact_type` ↔ `payload` pairing** (e.g. `artifact_type: commit` requires `payload.commit`).

Signature *validity* proves the envelope was signed by the key in `signer_did`. Signer *authority* proves that key was published by the issuing `server_id` for the envelope's issuance window. The JWK Set is the normative v0.2 authority layer. If a server does not publish JWKS, consumers can still run in a pinned-signer (`binding_only`) posture by comparing `signer_did` to an expected signer out of band. Why validity and authority are different questions: [A Valid Signature Doesn't Tell You Who Signed It](/blog/a-valid-signature-doesnt-tell-you-who-signed-it).

## Signer-key resolution and rotation

Step 2 needs the right public key. A server publishes its keys as a JWK Set:

```
GET {server_id}/.well-known/cycles-jwks.json     # operationId: getEvidenceJwks
```

Public and unauthenticated (it carries public keys only). Each entry is an Ed25519 OKP JWK with a validity window:

```json
{
  "kty": "OKP", "crv": "Ed25519", "alg": "EdDSA",
  "x": "<base64url of the 32 raw public-key bytes>",
  "kid": "2026-h2",
  "cycles_nbf_ms": 1781000000000,
  "cycles_exp_ms": 1796000000000,
  "status": "retired"
}
```

The **active** key omits `cycles_exp_ms` (open-ended) and has `status: active`. A server not doing signer-key resolution publishes nothing — the endpoint `404`s, and consumers stay on the pinned-signer (`binding_only`) path.

**Window-gated selection.** A verifier selects the key whose `[cycles_nbf_ms, cycles_exp_ms)` window covers the envelope's `issued_at_ms` — never "the current key." So an envelope signed two rotations ago still verifies against the key that was valid when it was signed; the set keeps **retired** keys for exactly this. `status` is advisory — selection is by window. (The forgery this prevents: [Rotating Keys Shouldn't Rewrite History](/blog/rotating-keys-shouldnt-rewrite-history).)

### Rotating the signing key (operator procedure)

The windows must tile without overlapping. On rotation:

1. Generate the new Ed25519 key pair and deploy the private key only to `cycles-server-events` as `EVIDENCE_SIGNING_PRIVATE_KEY_HEX`.
2. Make the new public key active on the runtime server — `EVIDENCE_SIGNING_SIGNER_DID` = the new raw-hex public key, `EVIDENCE_SIGNING_KID` = the active JWK `kid`, and `EVIDENCE_SIGNING_NBF_MS` = the rotation time (epoch ms).
3. Deploy the same public `EVIDENCE_SIGNING_SIGNER_DID` and `EVIDENCE_SERVER_ID` to `cycles-server-events` so the worker signs envelopes with the same identity the runtime publishes and used when computing `evidence_id`.
4. Append the old public key to the runtime server's `EVIDENCE_SIGNING_RETIRED_KEYS` — a JSON array of `{"signer_did","kid","nbf_ms","exp_ms"}` — with `exp_ms` = that same rotation time.

The retiring key's window then ends exactly where the new key's begins.

**Fail-safe, never fail-closed.** If `nbf-ms` is left below the latest retired `exp_ms`, the published active window is **clamped up** to that boundary (with a warning), so the current key is never published as authoritative for pre-rotation `issued_at_ms` by accident. A retired entry that can't be published (malformed hex, empty/inverted window, out-of-range bound, duplicate `kid`) is dropped, not fatal; if the whole `retired-keys` value is unusable, the server logs an error and keeps serving the active key — it never refuses to publish, which would break verification of *all* current evidence.

## Producer / signer split

- **`cycles-server`** computes `evidence_id` synchronously, returns `cycles_evidence`, serves `GET /v1/evidence/{id}` and `GET /v1/.well-known/cycles-jwks.json`, and holds only the **public** identity.
- **`cycles-server-events`** asynchronously builds, **Ed25519-signs** (the private key lives only here), and stores the envelope content-addressed. It recomputes the id and **dead-letters on drift**, so producer/signer config mismatch fails closed.

Because signing is async, a fetch immediately after the response may return a transient `404` — treat it as not-yet-available and retry.

## Enabling it

Evidence is **off until a shared signing identity is configured**:

- `EVIDENCE_SERVER_ID` on both services — the issuer base URL, including `/v1`, used in evidence URLs and envelopes.
- `EVIDENCE_SIGNING_SIGNER_DID` on both services — the raw-hex public Ed25519 key.
- `EVIDENCE_SIGNING_PRIVATE_KEY_HEX` only on `cycles-server-events` — the raw-hex private Ed25519 key.
- `EVIDENCE_SIGNING_KID`, `EVIDENCE_SIGNING_NBF_MS`, and `EVIDENCE_SIGNING_RETIRED_KEYS` only on `cycles-server` — public JWKS metadata and rotation history.

See the operator [identity enablement runbook](https://github.com/runcycles/cycles-server-events/blob/main/docs/evidence-identity-enablement.md).

## Related

- [CyclesEvidence: Verifiable Audit for Agent Decisions](/concepts/cycles-evidence-verifiable-audit-for-agent-decisions) — the why.
- [Error Codes and Error Handling](/protocol/error-codes-and-error-handling-in-cycles) — the denial codes that surface as `error` evidence.
- [Correlation and Tracing](/protocol/correlation-and-tracing-in-cycles) — the `trace_id` carried on every envelope.
