---
title: "A 200 OK Is Not an Audit Trail"
date: 2026-06-14
author: Albert Mavashev
tags:
  - governance
  - runtime-authority
  - audit
  - compliance
  - agents
  - production
  - evidence
description: "Enforcing an agent's budget is only half of runtime authority. The other half is proving what you decided — to an auditor, a counterparty, or a regulator who wasn't on the call. When configured, CyclesEvidence turns eligible budget decisions into signed, portable receipts."
blog: true
sidebar: false
featured: false
head:
  - - meta
    - name: keywords
      content: "agent audit trail, signed budget decision, tamper-evident receipt, cross-system audit, runtime authority, agent governance evidence, content-addressed receipt, Ed25519 signed audit, EU AI Act record-keeping, agent-passport binding, verifiable agent spending"
---

# A 200 OK Is Not an Audit Trail

Your agent tried to spend $4.20 on a tool call. Cycles said no. The agent moved on. Three weeks later the incident review happens, and someone asks the only question that matters: **can you prove it said no?**

A `200 OK` — or in this case a `409` — is enough for the process that received it, live, over a trusted connection. It is worth nothing to the auditor, the counterparty, or the regulator who shows up afterward. "Our server returned a denial" is hearsay. The reservation has long since expired out of the ledger; the logs are mutable; the screenshot proves nothing. Enforcement is only half of [runtime authority](/blog/what-is-runtime-authority-for-ai-agents). The other half is being able to *prove what you decided* — to someone who wasn't there and doesn't trust you.

<!-- more -->

## Three people the live response can't help

A Cycles response — `decision: ALLOW`, a reservation, a `409 BUDGET_EXCEEDED` — is built for the immediate caller: an agent runtime or gateway holding a live connection to the server. The moment you step outside that, it stops being evidence:

- **The after-the-fact auditor.** "What was this agent allowed to spend, on what, three months ago?" The ledger has moved on. You can show them a log line, but a log line is something you typed, not something the authority signed.
- **The untrusting counterparty.** Another system — a payments rail, an agent-passport issuer — needs to confirm an action ran *within an authorized budget* before it honors a downstream commitment. It cannot take the agent's word for it, and it can't query your private ledger.
- **The long-horizon record.** Compliance regimes increasingly expect durable, verifiable records of automated decisions, retained for years — long after the originating server may be reachable.

For all three, "the server said so" is not proof. It's a claim.

## Receipts, not just gates

Cycles already does the hard part: it decides, atomically, before the agent acts. Reserve up front, commit on success, release on failure — the gate. But a gate that leaves no verifiable trace is a gate you have to be *trusted* about.

**CyclesEvidence** is the receipt. For each authorization lifecycle event — `decide`, `reserve`, `commit`, `release`, and crucially `error` — Cycles can emit a signed, content-addressed envelope: the request and response, wrapped so that anyone can verify *what was decided*, offline, without trusting or even reaching the Cycles server.

It is the difference between "trust me, the budget said no" and handing someone a receipt they can verify themselves.

## What a receipt actually is

Three properties, each doing a specific job:

- **Content-addressed.** The `evidence_id` is the SHA-256 of the envelope's [RFC 8785](https://www.rfc-editor.org/rfc/rfc8785) (JCS) canonical bytes — computed with the `evidence_id` and `signature` fields themselves left blank. The id *is* the integrity check: change one byte of a decision and it no longer matches.
- **Signed.** An Ed25519 signature then covers a second canonical pass — the same envelope with the `evidence_id` now filled in and `signature` still blank — proving origin. Forge the contents and the signature fails.
- **In-band, then fetchable.** Cycles computes the `evidence_id` *synchronously* and returns it on the response (`cycles_evidence: { evidence_id, cycles_evidence_url }`); the expensive signing and storage happen asynchronously, off the request path. A consumer records the id and later fetches the signed envelope from the public `GET /v1/evidence/{id}` capability URL — and verifies it on its own. (Because signing is async, a fetch immediately after the response can return a transient `404` until the envelope lands — retry.)

Producing the proof costs the caller nothing extra — there's no separate "generate evidence" call. The mechanics are in the [envelope reference](/protocol/cycles-evidence-envelopes-in-cycles); the why is in [the concept page](/concepts/cycles-evidence-verifiable-audit-for-agent-decisions).

## Denials are the receipts that matter most

Here's the part most audit stories miss. The highest-signal governance event is not "the agent ran." It's **"the budget said no."**

In Cycles, a non-dry reservation that would exceed budget is *not* a `200` with `decision: DENY` — it's an HTTP `409 BUDGET_EXCEEDED`, captured as a signed `error` envelope. Settling a reservation that already expired is a `410`; settling an already-finalized hold is a `409`. The other post-evaluation budget denials get signed `error` envelopes too — frozen and closed budgets, overdraft-limit breaches, outstanding debt, unit mismatches. (Pre-evaluation failures — bad auth, malformed input — get no receipt: nothing was decided, so there's nothing to attest.)

Proving an action was **blocked** — and exactly why, and against which scope — is frequently more valuable than proving one ran. It's the evidence that says *the control worked*. The reservation id is carried into the commit and release receipts too, so the whole authorization → settlement chain reconstructs from the artifacts alone — no live ledger required.

## Composing trust across systems

Because a receipt is portable and self-verifying, it composes. A receipt or agent-passport system — like [APS](https://github.com/aeoess/agent-passport-system) — can record a Cycles `evidence_id` and bind its own signed receipt to it, proving *"this agent's action ran within authorized budget scope X"* by stitching together two independent systems **without either trusting the other's live state**. That's the property you want when an agent's actions cross organizational boundaries: each side keeps its own ledger private and exchanges only verifiable receipts.

## The honest boundary

Two things this is *not*, because over-claiming an audit feature is its own kind of risk:

- **It's the receipt, not the gate.** Evidence doesn't change a real-time decision or make a budget "safer" in the moment — enforcement is still the reserve/commit ledger. Its entire value is *after* the decision: audit, dispute resolution, cross-system trust, retention.
- **It's opt-in, and still maturing.** Evidence is off until you configure a signing identity; until then Cycles enforces budgets exactly as before and simply emits no receipts. Today the envelope's *signature validity* is fully specified; *signer authority* — proving the signing key genuinely belongs to that server, with key rotation and long-horizon resolution — is the v0.2 work currently in design ([cycles-protocol#103](https://github.com/runcycles/cycles-protocol/issues/103)). Until it lands, pin the expected signer for issuer trust.

## Close the loop

If your agents touch money, tools, or anything with a blast radius, you will eventually be asked to prove what they were *allowed* to do — by an auditor, a partner, or a regulator who wasn't on the call. A `200 OK` won't answer them. A signed, content-addressed receipt will.

- Concept: [CyclesEvidence — Verifiable Audit for Agent Decisions](/concepts/cycles-evidence-verifiable-audit-for-agent-decisions)
- Reference: [CyclesEvidence Envelopes](/protocol/cycles-evidence-envelopes-in-cycles)
- Related: [AI Agent Approval Queues Need Runtime Authority](/blog/ai-agent-approval-queues-need-runtime-authority) · [What Is Runtime Authority for AI Agents?](/blog/what-is-runtime-authority-for-ai-agents)
