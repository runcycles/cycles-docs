---
title: "Why a Delete-Delay Isn't the PocketOS Fix"
date: 2026-05-15
author: Albert Mavashev
tags: [incidents, runtime-authority, governance, security, agents, production]
description: "Railway slowed destructive deletes after the 9-second wipe. The legacy account-token model is unchanged. The structural fix is scoped tokens + runtime gates."
blog: true
sidebar: false
featured: false
head:
  - - meta
    - name: keywords
      content: "PocketOS aftermath, Railway delete delay, volumeDelete token scope, infra provider token RBAC, agent runtime authority, scoped tokens AI agents, two-layer agent authority, action authority, runtime gate"
---

# Why a Delete-Delay Isn't the PocketOS Fix

Late last month, an IDE-hosted agent — Cursor running Claude Opus 4.6 — deleted a PocketOS production database and its volume-level backups in nine seconds through a single Railway API call. The data came back; the structural problem stayed. We covered the immediate runtime-authority gap in [Cursor Agent Deleted a Prod Database in 9 Seconds](/blog/ai-agent-deleted-prod-database-9-seconds) and the framing debate that followed in [AI Agent Kill Switches Should Be Scoped](/blog/ai-agent-kill-switches-should-be-scoped).

What landed since then is worth a separate post, because it splits cleanly into two threads: what Railway actually shipped to its API, and what the rest of the security industry argued the fix should be. The two threads disagree about which layer of the stack to fix.

This post is about that disagreement and where each layer of fix actually sits.

<!-- more -->

## What Railway patched: a delete-delay window, not token scope

Per follow-up reporting, [Railway told The Register](https://www.theregister.com/2026/04/27/cursoropus_agent_snuffs_out_pocketos/) that it patched the legacy endpoint the agent had hit so that destructive deletes are now delayed instead of instant — a window during which an operator can intervene before the data is gone.

That is a real change, and a useful one. It buys time. It also, by itself, does not address the chain of events that caused the incident:

- The token type involved in the incident carried `volumeDelete` authority across the entire Railway GraphQL API. [Zenity's analysis](https://zenity.io/blog/current-events/ai-agent-database-deletion-pocketos) of the publicly reported token configuration describes it as "blanket authority across Railway's entire GraphQL API, including destructive operations like volumeDelete," with no per-environment, per-resource, or per-operation scoping. Zenity's summary: *"Every token is effectively root."* Railway does ship more granular token types — project tokens scoped to a specific environment, OAuth tokens with scopes — but the account-token model that produced this incident is still in use, and any team handing an agent a legacy account token inherits the same root-equivalent surface area.
- The token was [reportedly](https://zenity.io/blog/current-events/ai-agent-database-deletion-pocketos) created for managing custom domains through the Railway CLI — a task that does not need volume-deletion permissions. The agent inherited the full token scope, not the narrower scope that its task actually required.
- A delete-delay does not change which tokens are allowed to *request* destructive operations. It changes how fast the request becomes irreversible.

This is a control-plane mitigation, not a structural fix. An account token of the type involved in the incident, used the same way, can still issue the same destructive call. The window between request and effect has grown — but the request itself is still authorized, and the human-pressing-a-button assumption that the delay relies on is exactly the assumption that broke at nine seconds.

## Why "more time" is not the same as "less authority"

Delete-delays buy intervention windows. That is valuable for incidents where a human operator is watching the [dashboard](/glossary#dashboard). It is much less valuable in agent runtimes, for three reasons that compound.

**Agents run unattended.** The PocketOS chain happened in a coding session, but the same chain in a scheduled or autonomous deployment has no human in the loop at the destructive moment. The delay window expires without intervention because there is no one to intervene.

**Nine seconds was already past the human-reaction threshold.** Even with a delay window, the operator has to (a) observe the destructive call in flight, (b) recognize it as wrong, (c) reach the abort affordance, and (d) confirm. That sequence is measured in seconds, not milliseconds, when it works at all. Most delete-delay windows are tuned for routine human ops, not for agents producing API calls at the cadence of an unattended loop.

**The token, not the timing, is the leverage.** Anything authorized by a `volumeDelete`-bearing token can be issued. A delay shifts the consequence; it doesn't shift the authority. The next destructive mutation Railway adds — or any existing mutation the token's scope permits — sits behind the same credential.

The control plane has shifted slightly. The trust boundary has not.

## What scoped tokens would look like, and who is asking

The community response from the security side has split along a useful seam. [Zenity](https://zenity.io/blog/current-events/ai-agent-database-deletion-pocketos) makes the provider-layer argument: API tokens should be scoped by environment, by resource class, and by operation. A token created for CLI domain management should not be able to call `volumeDelete` against a production volume. The mechanism is mundane — it is the same RBAC pattern infrastructure providers have applied to cloud IAM for a decade. Zenity puts the timeline plainly: the community has been asking for scoped tokens "for years."

[Apono](https://www.apono.io/blog/nine-seconds-to-delete-a-database-what-the-pocketos-incident-teaches-us-about-ai-agent-privilege-management/) and [TrojAI](https://troj.ai/blog/pocketos-9-second-database-deletion-wasnt-permissions-failure) come at the same incident from the other side. Apono argues for just-in-time access at the agent layer — permissions granted for the duration of a specific task and revoked when it ends. TrojAI is more pointed: *"Permissions limit access. They do not define correctness."* That is an argument for an agent-side behavioral layer that decides whether a particular call, at a particular moment, against a particular resource, is actually the right action — independent of whether the token allows it. Both readings are correct. They name two different layers of the same stack.

Scoped tokens look like:

| Boundary | What the token can do |
|---|---|
| Environment | This token operates against `staging`, not `production` |
| Resource class | This token manages `domains`, not `volumes` |
| Operation | This token can `read` and `update`, not `delete` |
| Lifetime | This token expires after the task; no standing authority |

A token shaped that way removes the PocketOS chain at the provider layer. The agent can still issue any call it likes; the API rejects the call before any side effect. The destructive mutation is not slowed down — it is denied at the door.

The same applies on the consumer side. [Least-Privilege API Keys for AI Agents](/blog/least-privilege-api-keys-for-ai-agents) covers the parallel argument for Cycles' own keys: one key per [tenant](/glossary#tenant), per environment, per agent role, with runtime permissions separate from operator-plane permissions. The [Cycles server](/glossary#cycles-server) enforces tenant boundaries on every request and rejects attempts to act for a different tenant. That is the same shape every infra-provider API should ship for tokens used by agents.

## Why scoped tokens alone aren't enough

A scoped token is a necessary fix at the provider layer. It is not a sufficient fix for the agent itself.

Consider an agent that legitimately needs `volumeDelete` for a narrow purpose — cleaning up ephemeral test volumes after a CI run, say. A scoped token can be narrow enough to allow that and nothing else. Inside that scope, the agent still has the authority to delete the wrong volume, retry on a transient error, or fan out a single deletion into a loop. The provider sees each call as legitimate against the token's scope; the provider does not know whether *this particular call*, at *this point in the agent's session*, against *this particular volume*, is the one the operator actually wanted.

That is the gap the agent-side runtime gate covers. [Runtime authority](/glossary#runtime-authority) classifies the proposed call before it leaves the agent harness, and returns one of three decisions — `ALLOW`, `ALLOW_WITH_CAPS`, or `DENY` — carrying caps on `ALLOW_WITH_CAPS` and a `reason_code` on `DENY`:

- [Action authority](/glossary#action-authority) declares which tool invocations are allowed for this session. `tool_allowlist` and `tool_denylist` are the basic shape of the constraint; enforcement depends on the agent harness honoring the decision before the API call leaves the process. In the PocketOS pattern, a coding-agent session's allowlist would not have included a destructive Railway mutation at all.
- [RISK_POINTS](/glossary#risk-points) score each tool invocation by reversibility, blast radius, and audience. A destructive volume-deletion mutation would typically be scored as Tier 4 (50 base points); the session's authority budget can be capped well below that. The call is denied before the API client fires, regardless of what the provider token allows.
- The [reserve-commit](/glossary#reservation) lifecycle records the proposed call, the policy decision, and any execution outcome through the reservation, event, and audit trail. The auditor's question — "was this authorized?" — has a pre-execution answer, not a post-hoc reconstruction.

This is the layer the [State of AI Agent Incidents (2026)](/blog/state-of-ai-agent-incidents-2026) catalog argues for repeatedly: every consequential action passes through a runtime gate the model cannot reason around. The model can be wrong about whether to call `volumeDelete`. The gate is right or wrong about whether the call is allowed, based on policy that does not live inside the model.

## The two layers — scoped tokens and runtime authority, neither optional

The post-PocketOS fix has two layers, not one:

1. **Provider-layer scoped tokens.** API tokens issued by Railway, AWS, Cloudflare, and every other infrastructure provider should be scoped by environment, resource, operation, and lifetime. This is RBAC for machine credentials, applied to a population of callers (agents) that is much more diverse and unpredictable than the human operators these APIs were designed for.

2. **Agent-side runtime authority.** Before the API call leaves the agent harness, a pre-execution decision asks: is this specific call, in this specific session, against this specific resource, within this agent's authority? The decision lives outside the model's context window and produces an audit record either way.

Treating these as alternatives is the framing trap. Scoped tokens without a runtime gate leave the agent with full authority inside the scope — and "inside the scope" is exactly where PocketOS happened. A runtime gate without scoped tokens can still rely on the provider not having a destructive call the gate fails to classify — and a gate that classifies by tool-name allowlist can miss future destructive endpoints unless unknown operations default to deny. Both layers together make each other tractable: the token narrows the surface, the gate narrows the call.

Delete-delays sit at neither layer. They sit downstream of both — useful for the human-operator case, much less suited to the unattended-agent case that produced the original incident.

There is one more practical point worth being honest about: the provider-layer fix and the agent-layer fix have very different timelines. Provider-side RBAC rollouts move on vendor roadmaps, not on incident cycles — Zenity's "for years" framing captures it. Teams running agents against production today cannot wait for every infrastructure provider to ship scoped tokens. The agent-side runtime gate is the layer they can deploy this quarter, against the token scopes they already have. It is also the layer that survives the next time a provider adds a new destructive endpoint that nobody has scoped yet.

## What to do this quarter

If you are running agents against production infrastructure:

- **Audit every infra-provider token your agents hold.** What environments can it act in? What resource classes? What operations? It is common to discover at least one token that was created for a narrow CLI task and inherited blanket scope. Treat that finding as the PocketOS-shaped [exposure](/glossary#exposure).
- **Pressure your providers for scoped tokens.** This is a slow lever, but the only one that closes the provider-layer gap. Make scoped-token support a deployment criterion; cite PocketOS by name in vendor conversations.
- **Add a pre-execution authority gate at the agent layer.** Either build one or adopt one. The contract is the same regardless of vendor: every consequential tool call passes through a separate decision producer that the model cannot override. [How decide() works](/protocol/how-decide-works-in-cycles-preflight-budget-checks-without-reservation) and [how reserve-commit works](/protocol/how-reserve-commit-works-in-cycles) are the Cycles versions; other patterns exist.
- **Treat delete-delays as a mitigation, not the structural fix.** They have a role for human-driven ops. They are not the fix for the agent-runtime case.

## Closing

In the weeks after the 9-second wipe, PocketOS recovered its data. The pattern that produced the incident has not been restructured. An account token of the type the agent held can still issue `volumeDelete` against the environments in its scope. The patch slows the consequence; it does not narrow the authority. The "kill switch" framing some vendors adopted in the following weeks is the wrong layer of the stack to argue about — that debate is covered in [AI Agent Kill Switches Should Be Scoped](/blog/ai-agent-kill-switches-should-be-scoped). The argument worth having is one layer down: token scopes on the provider side, runtime gates on the agent side, both shipping, neither sufficient alone.

The post-mortem you do not want to write a year from now is the one where the token was technically narrower than PocketOS's but still wide enough to delete the wrong thing — because there was no second layer to catch it.

## Further reading

- [Cursor Agent Deleted a Prod Database in 9 Seconds](/blog/ai-agent-deleted-prod-database-9-seconds) — the immediate post-incident analysis
- [AI Agent Kill Switches Should Be Scoped](/blog/ai-agent-kill-switches-should-be-scoped) — why the kill-switch framing is the wrong layer
- [Least-Privilege API Keys for AI Agents](/blog/least-privilege-api-keys-for-ai-agents) — the parallel argument for the agent's own credentials
- [The State of AI Agent Incidents (2026)](/blog/state-of-ai-agent-incidents-2026) — the broader incident catalog
- [AI Agent Risk Assessment: Score, Classify, Enforce](/blog/ai-agent-risk-assessment-score-classify-enforce-tool-risk) — the [RISK_POINTS](/glossary#risk-points) framework
- [AI Agent Action Control: Hard Limits on Side Effects](/blog/ai-agent-action-control-hard-limits-side-effects) — the action-authority enforcement layer

## External references

- [Zenity — AI Agent Destroys Production Database in 9 Seconds](https://zenity.io/blog/current-events/ai-agent-database-deletion-pocketos) — the token-scope analysis cited above
- [Apono — Nine seconds to delete a database](https://www.apono.io/blog/nine-seconds-to-delete-a-database-what-the-pocketos-incident-teaches-us-about-ai-agent-privilege-management/) — the just-in-time-access argument
- [TrojAI — Why PocketOS wasn't a permissions failure](https://troj.ai/blog/pocketos-9-second-database-deletion-wasnt-permissions-failure) — the external-layer counter-argument
- [The Register — Cursor-Opus agent](https://www.theregister.com/2026/04/27/cursoropus_agent_snuffs_out_pocketos/) — the original reporting that captured Railway's delete-delay patch
