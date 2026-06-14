---
title: "CyclesEvidence: Verifiable Audit for Agent Decisions"
description: "CyclesEvidence turns every budget decision into a tamper-evident, signed, content-addressed envelope that any third party can verify offline — without trusting or reaching the Cycles server."
---

# CyclesEvidence: Verifiable Audit for Agent Decisions

Cycles enforces budget and action authority in real time. CyclesEvidence is the other half: it makes each decision **provable after the fact** — a signed, content-addressed record that an auditor, a counterparty, or a regulator can verify on their own, without trusting your word or querying your live ledger.

## The problem: a 200 OK is not proof

A normal Cycles response — `decision: ALLOW`, a reservation, a `409 BUDGET_EXCEEDED` — is enough for the **caller** who made the request and holds a live connection. It is useless to anyone else, later:

- An auditor reviewing what an agent was allowed to do three months ago.
- A counterparty (e.g. a payment or agent-passport system) that needs to confirm an action ran within an authorized budget, but doesn't trust the agent's self-report.
- A compliance process that must retain verifiable records for years, long after the reservation has expired from the ledger.

For all of them, "the server said ALLOW" is hearsay. CyclesEvidence replaces hearsay with a verifiable artifact.

## What it is

For each authorization lifecycle event, Cycles can emit a **CyclesEvidence envelope**: the request and response, wrapped in a JSON object that is

- **canonicalized** with [RFC 8785 JCS](https://www.rfc-editor.org/rfc/rfc8785) (a deterministic byte form),
- **content-addressed** by `evidence_id` = the SHA-256 of those bytes — so the id *is* the integrity check, and
- **Ed25519-signed** by the Cycles server's key — so the origin is provable.

Five artifact types cover the whole lifecycle: `decide`, `reserve`, `commit`, `release`, and `error`.

Every relevant response carries an optional `cycles_evidence` reference:

```json
"cycles_evidence": {
  "evidence_id": "8403bed43e13ef7d56a8ab402a9d29ee7dd2f405e24c0cacb51068341a5e7030",
  "cycles_evidence_url": "https://cycles.example.com/v1/evidence/8403bed4…7030"
}
```

A consumer records the `evidence_id`, then fetches the signed envelope at `cycles_evidence_url` and verifies it — whenever it wants, offline. See [CyclesEvidence Envelopes](/protocol/cycles-evidence-envelopes-in-cycles) for the wire shape and verification recipe.

## Why it matters

**Tamper-evident and self-authenticating.** Change one byte of a budget decision and the `evidence_id` no longer matches; forge the contents and the Ed25519 signature no longer verifies. You cannot quietly rewrite history.

**Cross-system binding.** A receipt or agent-passport system can record a Cycles `evidence_id` and bind its own signed receipt to it — proving *"this agent's action ran within authorized budget scope X"* by composing two independent systems, without either trusting the other's live state. This is the integration that drove the feature (with [APS, the agent-passport-system](https://github.com/aeoess/agent-passport-system)).

**Denials are first-class evidence.** The highest-signal governance event is often *"the budget said no."* A non-dry `reserve` over budget surfaces as a `409 BUDGET_EXCEEDED` `error` envelope; committing an expired reservation as a `410`. Proving an action was **blocked** is frequently more valuable than proving one was allowed — and Cycles signs both.

**The full chain is reconstructable.** `decide → reserve → commit / release`, plus the error paths, each produce evidence, with the `reservation_id` carried into commit/release so the authorization → settlement chain can be rebuilt from the artifacts alone.

**Long-horizon retention.** Content-addressed, signed records are well-suited to long-horizon record-keeping — for example EU AI Act Article 12 retention — verifiable years later, independent of whether the original server is still running.

**Zero friction to produce.** The `evidence_id` is computed *synchronously* and returned in-band on the response; the expensive signing and storage happen asynchronously. Producing the proof costs the caller nothing extra — there is no separate "generate evidence" call.

## What it is not

CyclesEvidence is the **receipt, not the gate.** Enforcement is the reserve/commit ledger itself; evidence does not change a real-time decision or make budgets "safer" in the moment. Its entire value is *after* the decision: audit, dispute resolution, cross-system trust, and compliance.

It is also **off until configured.** A deployment must set a shared signing identity before any verifiable evidence is produced — see the operator [identity enablement runbook](https://github.com/runcycles/cycles-server-events/blob/main/docs/evidence-identity-enablement.md). Until then, Cycles enforces budgets exactly as before; it just doesn't emit signed receipts.

## In one line

CyclesEvidence makes a budget decision **portable, verifiable proof** — so an agent's spending and action authority can be audited and trusted by systems that never talk to your Cycles server.

## Related

- [CyclesEvidence Envelopes](/protocol/cycles-evidence-envelopes-in-cycles) — the envelope shape, `evidence_id` recipe, and how to verify.
- [Correlation and Tracing](/protocol/correlation-and-tracing-in-cycles) — `trace_id` ties evidence, events, and audit entries to the originating request.
- [Error Codes and Error Handling](/protocol/error-codes-and-error-handling-in-cycles) — the denial codes that surface as `error` evidence.
