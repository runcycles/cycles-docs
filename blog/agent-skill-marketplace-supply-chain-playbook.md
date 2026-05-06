---
title: "A Supply-Chain Playbook for Agent Skill Marketplaces"
date: 2026-05-08
author: Albert Mavashev
tags: [security, supply-chain, marketplace, governance, agents, runtime-authority, action-control, production]
description: "npm and PyPI took a decade to converge on signing, OIDC publishing, and provenance. Agent skill marketplaces can skip the detour — but also need runtime limits."
blog: true
sidebar: false
featured: false
head:
  - - meta
    - name: keywords
      content: "agent skill marketplace, supply chain security, ClawHub, MCP server registry, Sigstore provenance, Trusted Publishers OIDC, runtime authority, capability manifest, package registry security"
---

# A Supply-Chain Playbook for Agent Skill Marketplaces

A platform team is evaluating an agent skill marketplace ahead of a company-wide rollout. The marketplace has thousands of skills, a star rating, a search box, and a publisher field that's an unverified email. The team's security review starts with the question they ask of every other dependency source: *what's the trust model?* The answer comes back as a shrug. There's no signing requirement. There's no Trusted-Publisher-style OIDC path. There's no consumer-pinning enforcement, no capability manifest standard, no publish-time malware scanning that the team can point to. The "trust model" is the marketplace operator's reputation, applied uniformly to every skill regardless of what it does.

This is exactly where npm was around 2014 and where PyPI was around 2016. We know what happens next — the [event-stream incident on npm in 2018](https://blog.npmjs.org/post/180565383195/details-about-the-event-stream-incident), the `ctx` package takeover on PyPI in 2022, the typosquatting waves on every registry, the slow grind of getting 2FA mandated, then provenance attestations, then OIDC trusted publishing. Each predecessor took roughly a decade of incidents-then-controls to converge on a working playbook. [Our earlier analysis](/blog/mcp-tool-poisoning-why-agent-frameworks-cant-prevent-it) cited a report of 1,184 malicious skills on OpenClaw's ClawHub in early 2026 — the exact number matters less than the pattern: agent skill marketplaces are already seeing package-registry-style abuse.

The question this post addresses isn't *whether* agent skill marketplaces will face the same supply-chain risks as the package registries. They will. The question is whether the response cycle has to take another decade, given that the controls that work — Sigstore provenance, OIDC-based trusted publishing, capability manifests, runtime blast-radius limits — already exist in deployable form. This is the playbook for not replaying the detour.

<!-- more -->

## What the predecessors learned, in roughly the order they learned it

The package-registry security playbook was written incrementally, usually after a high-profile incident. Each control closes a class of attack the previous controls didn't see.

| Year(s) | Ecosystem | Incident or shift | Control adopted |
|---|---|---|---|
| 2018 | npm | [event-stream](https://blog.npmjs.org/post/180565383195/details-about-the-event-stream-incident) — maintainer trust transferred to a malicious actor; Bitcoin-wallet-stealing payload shipped through the popular `event-stream` package with broad downstream reach | Maintainer trust models tightened; eventual move toward 2FA |
| 2017–2022 | PyPI / npm | Typosquatting waves: `colourama`, AWS-named exfiltrators, `@colors` variants | Registry-side typosquat detection at publish |
| 2021 | npm | [ua-parser-js compromise](https://snyk.io/blog/typosquatting-attacks/) — popular library hijacked via maintainer-account takeover | Account hardening; password+2FA pressure |
| 2021 | Industry | [Sigstore](https://www.sigstore.dev/) launched (Google + Linux Foundation): short-lived certs, transparency log | Foundation for ecosystem-wide signing |
| 2022 | PyPI | `ctx` package takeover — maintainer's expired domain enabled email-based account reset | Email-domain controls; 2FA push for top maintainers |
| 2023 | npm | [Provenance attestations via Sigstore](https://github.blog/security/supply-chain-security/introducing-npm-package-provenance/) — packages signed and logged with their build context | Cryptographic provenance for every published package |
| 2023 | PyPI | [Trusted Publishers (OIDC)](https://blog.pypi.org/posts/2023-04-20-introducing-trusted-publishers/) — packages publish from CI without long-lived API tokens | OIDC-based publishing replaces classic API tokens |
| 2024 | XZ Utils | [Multi-year social-engineering attack](https://thebrightbyte.com/playbook/insights/supply-chain-attacks-xz-npm-pypi) on a single maintainer | Recognition that maintainer trust is a long-horizon attack surface |
| 2025 | npm | Mandatory 2FA for local publishing; classic tokens phased out | Identity becomes a hard requirement, not an optional control |

Two patterns repeat. First, every control was a response to a class of incident, not an a-priori design — registries adopted them because users got hurt. Second, the controls converge: by 2026, the leading registries are ending up at roughly the same playbook (identity hardening + provenance attestations + OIDC publishing + automated scanning + ecosystem trust signals), even though they got there by different paths. That convergence is the cheat sheet.

## The control set leading package ecosystems are converging on

Stripped down to what each control *does*, independent of the registry:

**1. Verified publisher identity with mandatory 2FA.** Email-only signup with a single password is where most attacks start. The fix is identity verification, mandatory 2FA on accounts that can publish, and shrinking the lifetime of any published-from-machine credentials.

**2. Provenance attestations cryptographically tying artifact to source.** Sigstore-style: the published artifact carries a signed statement saying "this binary came from this commit on this repo, built by this CI workflow." The signature is logged in a public transparency log. Consumers can verify without trusting the registry itself. npm and PyPI both adopted this between 2023 and 2026.

**3. Trusted Publishers / OIDC-based publishing.** Long-lived API tokens are credential-theft amplifiers. OIDC-based publishing — where a CI workflow proves its identity to the registry per-publish, no static token — closes that vector. PyPI [introduced Trusted Publishers in 2023](https://blog.pypi.org/posts/2023-04-20-introducing-trusted-publishers/), [npm supports the same pattern](https://docs.npmjs.com/trusted-publishers/), and [OpenSSF describes the cross-repository model](https://repos.openssf.org/trusted-publishers-for-all-package-repositories.html).

**4. Typosquat detection at publish time.** Registry-side checks block obvious lookalikes before publication. Catch isn't perfect, but it's much better than nothing — npm explicitly [blocks typosquat publishes today](https://docs.npmjs.com/threats-and-mitigations/).

**5. Automated malware scanning at publish and update time where possible.** Leading registries increasingly use registry-side detection for known malicious patterns, typosquatting, and suspicious behavior. Not a complete defense — novel attacks slip through — but it raises the cost of obvious approaches and gives operators something to alert on.

**6. Versioned, immutable releases with consumer-side pinning.** Once published, a version doesn't change. If a maintainer wants to update, they cut a new version. Consumers control their own update cadence via lockfiles or pin files. This is the property that makes "rollback to a known-good version" tractable when something goes wrong.

These six are not uniformly implemented everywhere, and they are not a complete answer to supply-chain security. The XZ attack survived all of them because it compromised the maintainer over years before any malicious commit appeared. But they are the direction leading registries are converging toward — and they are the floor against the most common attack classes.

## Where agent skill marketplaces sit today

In aggregate — and necessarily generalizing — the agent skill marketplace category in mid-2026 looks roughly like this on each control:

| Control | Typical state in agent skill marketplaces (mid-2026) |
|---|---|
| Verified publisher identity + 2FA | Inconsistent — some marketplaces require it, others accept email-only signup |
| Provenance attestations (Sigstore-style) | Mostly absent; no ecosystem-wide standard |
| OIDC trusted publishing | Not yet adopted at scale |
| Typosquat detection at publish | Inconsistent; varies by marketplace operator |
| Automated malware/behavior scanning | Some marketplaces scan; coverage and depth vary |
| Versioned immutable releases + consumer pinning | Patchy — many marketplaces auto-update by default with no pinning story |

This isn't a criticism of any specific marketplace — every package registry started here, and the leading ones took years to mature. It's a description of the category position. The agent skill ecosystem is in roughly the same place as npm circa 2015: rapidly growing user base, expanding plugin surface, ad-hoc moderation, no cryptographic provenance, and the first significant supply-chain incidents already starting to land.

The good news is that none of this requires waiting for the next attack to motivate the controls. All six are off-the-shelf:

- **Sigstore is already production-deployed** at npm and PyPI. The [`cosign` toolchain](https://www.sigstore.dev/) signs anything; an agent skill marketplace can adopt the same primitive without building cryptography.
- **Trusted Publishers / OIDC** has a published spec via OpenSSF and reference implementations from npm and PyPI. Agent marketplaces can follow the same pattern.
- **Typosquat detection** is a well-understood pattern — Snyk, npm, and others have published their heuristics.
- **Versioned immutable releases** is a registry-design choice, not a research problem.

The cost of adopting these now is much smaller than adopting them after a trust-breaking incident. The cost of waiting is paid in user trust, after.

## What's specific to agent skills (and not yet in the predecessor playbook)

Even if every agent skill marketplace shipped all six package-registry controls tomorrow, the playbook wouldn't be complete — because skills aren't packages.

A traditional package is mostly code. A skill is code *plus prompts plus context plus tool-orchestration logic*, and that combination opens attack surface that signing-and-scanning doesn't cover. Three concerns the package playbook never had to handle:

**1. Instructions are executable in a softer way than code.** A signed skill can still contain a Markdown file that, when parsed by a model, redirects the agent to a malicious tool. The signature is valid; the artifact is unmodified; the behavior is hostile. Static scanning of code doesn't see prompt-injection paths because they aren't code paths.

**2. Tool composition multiplies the API surface.** A skill that declares `read_file` and `send_email` separately may be benign in isolation but harmful when composed — read sensitive file, send to attacker-controlled address. Reviewing each tool independently misses the chain.

**3. The capability declaration matters more than the inventory.** It's not enough for a skill to declare *which* tools it uses. Operators need declarations of *what data classes the skill touches, what egress destinations it may use, what risk tier its actions sit in.* The [skill manifest as contract](/blog/agent-skills-are-the-new-supply-chain) covers this from the consumer side; for it to scale across a marketplace, the manifest format has to be a marketplace requirement, not a per-skill courtesy.

Two additional controls follow that aren't in the package-registry playbook:

**7. Mandatory capability manifests.** Every skill in the marketplace declares — in a machine-readable, signed-as-part-of-the-attestation, format — what tools it requests, what data classes it accesses, what network destinations it may reach, what filesystem scope it needs, and what risk tier its actions sit at. Without this, capability review at install time is guesswork. The [agent skills supply-chain post](/blog/agent-skills-are-the-new-supply-chain) sketches the manifest fields; the marketplace's job is to require them.

**8. Per-consumer runtime blast-radius hooks.** A signed manifest tells the consumer what a skill *says* it does. Runtime enforcement bounds what it *actually* does in this consumer's environment. The two are complementary: marketplace-side controls keep most attacks out; [runtime authority](/glossary#runtime-authority) bounds the damage of the ones that get through.

## What runtime authority adds at execution time

Marketplace-side controls — identity, signing, scanning, OIDC, manifests — are the gate. They reduce the rate of compromised skills reaching consumers, and they make incident response possible (you know what was published, by whom, with what capabilities). They don't bound execution.

[Runtime authority](/glossary#runtime-authority) does. The same primitives the [local-first runtime post](/blog/every-local-first-agent-runtime-needs-budget-authority) calls out for cross-runtime governance apply at the per-skill level inside any one runtime:

- **Capability declarations become enforceable contracts.** A skill that declares `tool:send_email` and the runtime caps `send_email` at 10 invocations per session will never send the 11th, regardless of what the skill's prompts try to talk the model into doing.
- **[Risk-tier classification](/blog/ai-agent-risk-assessment-score-classify-enforce-tool-risk) assigns budget independent of cost.** A skill's declared `tier:write-external` actions don't share a pool with `tier:read-only` actions. A compromised skill that escalates from reads to writes hits the write budget separately, even if the read budget had room.
- **The [three-way decision](/glossary#three-way-decision) survives prompt injection.** Whatever a malicious instruction in a Markdown file convinces the model to *try*, the runtime's [reservation](/glossary#reservation) for that action either ALLOWs, ALLOWs with caps, or DENYs. The decision is computed outside the model's context.
- **Per-runtime, per-skill blast-radius is observable.** An authority layer that decides each action also produces a record of every decision. That record is what a security team needs when they ask "what did skill X actually do across our fleet last week?"

The pattern that makes this work is the same one that makes the package-registry playbook work: enforce at the layer where the consequence happens, not at the layer where the artifact happens. Provenance proves the artifact wasn't tampered with. Runtime authority proves the action wasn't allowed beyond declared scope. They're complementary; neither replaces the other.

## Minimum viable marketplace policy

Before approving an agent skill marketplace for company-wide use, security review can ask for at least these:

- Verified publisher identity
- Mandatory 2FA for accounts that can publish
- Immutable, versioned releases
- Consumer-side pinning (lockfile or equivalent)
- Provenance / attestation support, ideally Sigstore-based
- Registry-side malware and typosquat scanning
- Machine-readable capability manifests
- Runtime hooks for per-skill caps and denials in the consumer's environment

A marketplace that has shipped most of these is taking the supply-chain risk seriously. A marketplace with none of them is asking each consumer to manage that risk individually — which is exactly where every other ecosystem started.

## A compressed timeline for the agent ecosystem

The package registries took roughly a decade because each control was reactive — a new incident motivated each new measure, and the path from incident to widespread adoption was slow. The agent skill marketplace ecosystem doesn't have to repeat that. The shape of a compressed adoption path:

1. **Now:** Marketplaces require verified publisher identity and 2FA on accounts that can publish. This is the cheapest control with the largest immediate effect.
2. **Next:** Adopt Sigstore-based provenance attestations as the default for new publications. Don't reinvent — npm and PyPI's implementations are reference material.
3. **Soon:** OIDC-based Trusted Publishing for CI workflows. Eliminates the long-lived-token attack class entirely.
4. **In parallel:** Typosquat detection and automated malware scanning at publish. These are well-understood; the cost of adoption is integration, not research.
5. **As the manifest standard matures:** Mandatory capability declarations as part of the published artifact, signed alongside the code.
6. **At runtime, by every consumer:** Runtime authority hooks that turn declared capabilities into enforced caps. This isn't a marketplace control — it's the layer the consumer adds underneath any marketplace.

None of these steps are speculative. Each one has a working reference implementation in the package registry world. The question for any agent skill marketplace evaluating this list is *which controls to ship first*, not *whether the controls work*.

## The takeaway

Every executable supply chain — packages, containers, CI actions, OS images — has converged on roughly the same set of controls, after roughly the same set of incidents. The convergence isn't coincidence; it's the residue of the actual attacks that hit each ecosystem. Agent skill marketplaces are an executable supply chain. The arguments that took npm a decade to settle — yes you need signing, yes 2FA has to be mandatory, yes you can't trust long-lived tokens, yes consumers need to pin versions — don't need to be re-litigated for the agent ecosystem. The work has been done.

The asymmetric thing about the agent layer is that signed-and-scanned isn't enough. A skill is more than its code; the prompts, examples, and context it ships with can change agent behavior in ways static review doesn't catch. Marketplace-side controls reduce the rate of bad skills reaching consumers. Runtime authority bounds the damage when one does anyway. Both layers are necessary, neither is sufficient.

The cheapest move for any agent skill marketplace right now is to look at where npm and PyPI are in 2026 and adopt that destination directly. The longer move is to extend the playbook with capability manifests and runtime-authority assumptions, because skills introduce risks the package registries never had to govern. The expensive move is to wait for the equivalent of event-stream to make the case.

## Sources

- [npm: Details about the event-stream incident](https://blog.npmjs.org/post/180565383195/details-about-the-event-stream-incident) — primary post-mortem from npm's security team
- [Supply Chain Attacks 2024–2026: XZ, npm, and PyPI Lessons](https://thebrightbyte.com/playbook/insights/supply-chain-attacks-xz-npm-pypi) — recent incident analysis across registries
- [Introducing npm package provenance — GitHub Blog](https://github.blog/security/supply-chain-security/introducing-npm-package-provenance/) — Sigstore-based attestations on npm
- [Trusted publishing for npm packages](https://docs.npmjs.com/trusted-publishers/) — OIDC-based publishing reference
- [PyPI digital attestation support — deps.dev](https://blog.deps.dev/pypi-attestations/) — PyPI's parallel adoption of Sigstore attestations
- [npm: Threats and Mitigations](https://docs.npmjs.com/threats-and-mitigations/) — current registry-side controls including typosquat detection
- [GitHub Changelog: npm classic tokens revoked](https://github.blog/changelog/2025-12-09-npm-classic-tokens-revoked-session-based-auth-and-cli-token-management-now-available/) — npm classic token phaseout (Dec 2025) and session-based auth
- [Sigstore](https://www.sigstore.dev/) — the signing/transparency-log primitive both registries adopted

## Related reading

- [Agent Skills Are the New Supply Chain](/blog/agent-skills-are-the-new-supply-chain) — the consumer/operator-side companion to this post; manifest fields, [RISK_POINTS](/glossary#risk-points), sandboxing, the 8-step adoption model.
- [MCP Tool Poisoning](/blog/mcp-tool-poisoning-why-agent-frameworks-cant-prevent-it) — the ClawHub incident referenced in the opening, plus the broader tool-metadata attack surface.
- [Why Local-First Agent Runtimes Need Runtime Authority](/blog/every-local-first-agent-runtime-needs-budget-authority) — the category-level argument this post extends to the marketplace layer.
- [AI Agent Risk Assessment](/blog/ai-agent-risk-assessment-score-classify-enforce-tool-risk) — the risk-tier framework the runtime-authority section invokes.
- [AI Agent Action Control: Hard Limits and Side-Effects](/blog/ai-agent-action-control-hard-limits-side-effects) — what bounded [action authority](/glossary#action-authority) looks like at runtime.
- [Agent Registries Are Not Runtime Governance](/blog/agent-registries-are-not-runtime-governance) — the inverse argument: why a registry alone doesn't replace the runtime layer.
