---
title: "AI Agent Approval Queues Need Runtime Authority"
date: 2026-05-11
author: Albert Mavashev
tags:
  - governance
  - runtime-authority
  - action-control
  - operations
  - audit
  - agents
  - production
description: "Human approval can pause risky agent actions, but it is not enforcement. Pair approval queues with runtime authority, scoped limits, and audit receipts."
blog: true
sidebar: false
featured: false
head:
  - - meta
    - name: keywords
      content: "AI agent approval queue, human in the loop agents, runtime authority, agent action approval, approval workflow, action authority, AI agent governance, audit receipts"
---

# AI Agent Approval Queues Need Runtime Authority

The agent did the responsible thing.

It drafted the customer email, marked the action as risky, and posted an approval card to Slack. The approver saw the recipient, subject, body, account name, and reason. They clicked approve.

Ten minutes later, the same run sent a second email to the same account from a retry path. Then a follow-up worker reused the approved payload against the wrong [tenant](/glossary#tenant). The approval record was real. The side effects were real too.

The problem was not that a human was missing. The problem was that the approval was treated as permission to execute, instead of one input into a runtime decision.

<!-- more -->

Human approval is a useful control. It is also easy to overestimate.

Approval queues help with judgment, accountability, exception handling, and escalation. They are often the right pattern for actions that require context a model should not own: refunds, external email, destructive infrastructure changes, permission grants, payments, public posts, and production deploys.

But approval is not the same thing as [runtime authority](/glossary#runtime-authority).

An approval says: "A person accepted this proposed action under these facts." Runtime authority asks a narrower question at the only moment that matters: "Is this exact action still allowed to execute now, in this scope, with this identity, against this remaining budget and risk envelope?"

That distinction is what keeps human-in-the-loop from becoming human-as-a-rubber-stamp.

## Approval is a workflow, not an enforcement layer

Modern agent frameworks are adding useful approval primitives.

LangChain's human-in-the-loop middleware can pause execution before selected tool calls, persist graph state, and resume after a decision such as approve, edit, reject, or respond. OpenAI's Agents SDK has a similar approval flow: sensitive tools can require approval, runs surface interruptions, and the run can resume from stored state after approve or reject decisions. OpenAI's hosted MCP support can also require approval on MCP tool calls.

Those are good building blocks. They create the pause point teams need.

They do not, by themselves, answer the production governance questions:

| Question | Approval queue | Runtime authority |
|---|---|---|
| Who reviewed the proposed action? | Yes | Uses as context |
| Is the agent still within its run budget? | Usually no | Yes |
| Is this the right tenant and scope? | Sometimes | Yes |
| Has this approval expired? | Sometimes | Yes |
| Did a retry already consume this action? | Usually no | Yes, with idempotency |
| Should this action spend [RISK_POINTS](/glossary#risk-points)? | Rarely | Yes |
| Can the action be narrowed instead of allowed broadly? | Sometimes | Yes, through caps |
| Will the final execution produce an audit receipt? | Sometimes | Yes |

The approval queue is a decision workflow. Runtime authority is the enforcement point.

Treating the queue as the enforcement layer leaves the dangerous part implicit: the handoff from "approved" to "executed."

## The failure modes are all in the handoff

Approval failures usually do not look like a missing button. They look like a button that approved too much.

| Failure mode | What happens | Runtime control that closes it |
|---|---|---|
| Stale approval | The agent changes arguments after review or resumes hours later | Short approval TTL and argument binding |
| Scope drift | Approval for one tenant, account, or run is reused elsewhere | Scope-bound approval envelope |
| Retry duplication | A timeout causes the approved action to execute twice | [Idempotency key](/glossary#idempotency-key) tied to the approval and [reservation](/glossary#reservation) |
| Broad approval | "Approve send_email" becomes permission for any email | Per-action action kind, target, recipient, and risk budget |
| Trust-boundary collapse | The agent can influence the approval mechanism it depends on | Out-of-band approval service with separate authority |
| Budget bypass | Human approval skips cost or risk accounting | Reserve before execute, commit after execute |
| Missing evidence | Logs show approval and execution separately, but not one linked chain | Approval-to-reservation-to-commit audit receipt |

This is why the safest pattern is not "approval or runtime authority."

It is approval feeding runtime authority.

The approval queue records human intent. Runtime authority turns that intent into a bounded, scoped, expiring execution allowance.

## The approval envelope

An approval should not be a boolean.

It should be an envelope with enough structure for the runtime to enforce exactly what was approved and reject everything else.

| Field | Why it matters |
|---|---|
| `approval_id` | Stable identity for audit and idempotency |
| `approver_id` | Who accepted accountability |
| `agent_identity` | Which agent is allowed to use the approval |
| `tenant` and `scope_path` | Where the approval is valid |
| `run_id` or `thread_id` | Which execution context may consume it |
| `action_kind` | What class of action was approved, such as `message.email.send` |
| `tool_name` | Which concrete tool may execute |
| `target` | Recipient, service, record, repo, environment, or account |
| `arguments_hash` | Whether the action changed after review |
| `risk_points` | How much [action authority](/glossary#action-authority) this consumes |
| `expires_at` | When the approval stops being valid |
| `max_uses` | Whether the approval is single-use or bounded multi-use |
| `rationale` | Why the action was approved |

That envelope becomes runtime input.

The agent can ask for approval. The human can approve. But execution still has to reserve authority at the moment the tool is about to run.

## The two-plane pattern

The clean architecture separates the approval plane from the execution plane.

```
agent proposes action
  -> approval plane records human decision
  -> runtime authority validates envelope
  -> reserve RISK_POINTS / budget / scope allowance
  -> execute tool only if ALLOW
  -> commit actual usage and action receipt
  -> emit audit event
```

The approval plane handles human workflow:

- present the proposed action
- collect approve, edit, reject, or defer
- capture approver identity and rationale
- store the approval envelope
- expire unused approvals

The execution plane handles authority:

- verify the agent identity
- verify the tenant and scope
- verify the action kind and arguments
- reserve budget or RISK_POINTS
- return ALLOW, ALLOW_WITH_CAPS, or DENY
- commit or release the reservation
- write the audit trail

This is the same distinction behind [agent registries](/blog/agent-registries-are-not-runtime-governance). A registry records what the agent is supposed to be. Runtime governance decides whether the next action should happen now.

Approval queues have the same boundary. They record what a person accepted. Runtime authority decides whether that acceptance still authorizes this execution.

## A concrete email example

In [our outreach agent dogfood report](/blog/we-put-cycles-in-front-of-our-own-outreach-agent), the agent could research prospects, write Gmail drafts, mirror them to Slack, update Attio, and watch for replies. External send stayed outside the autonomous path.

That was intentional. Draft creation is a lower-risk action. External send is a real side effect.

The runtime boundary looked like this:

| Action | Runtime behavior |
|---|---|
| Research and synthesis | ALLOW within the research budget |
| Gmail draft creation | ALLOW as a controlled write-local action |
| Slack review post | ALLOW as an internal review surface |
| Normal external send path | DENY by default |
| Explicit approved send path | ALLOW only through the approved toolset |

The useful lesson was not "put a human in Slack."

The useful lesson was that the default send route had zero authority. When the normal send path tried to run, the runtime gate returned `409 BUDGET_EXCEEDED`, the draft remained for review, and the external email did not leave the system.

That is the approval pattern in production shape:

1. The agent prepares the action.
2. The review queue lets a person judge the content.
3. The approved path is a separate action surface.
4. Runtime authority still reserves before the side effect.
5. The audit trail can prove what happened.

The human review was necessary. It was not sufficient.

## Approvals should narrow authority, not expand it

One common mistake is to treat approval as a temporary privilege escalation:

> The agent was blocked. A human approved. Now the agent can send email.

That is too broad.

A better model is authority narrowing:

> The agent was blocked from sending arbitrary email. A human approved this email, to this recipient, from this run, before this expiry, consuming this many RISK_POINTS.

The difference matters.

| Broad approval | Narrow approval |
|---|---|
| "Allow send_email" | "Allow message.email.send to alex@example.com for run `r_123`" |
| "Approve deploy" | "Approve deploy of service `billing-api` version `1.8.4` to staging" |
| "Allow refund" | "Allow one refund up to `$42.00` on account `acct_789`" |
| "Approve CRM write" | "Allow status update on contact `c_456`, no owner or email changes" |

The narrow version is enforceable.

The broad version depends on the agent staying well-behaved after approval, which is exactly the assumption the approval was supposed to avoid.

## ALLOW_WITH_CAPS belongs in the approval flow

Approvals do not have to be binary.

The same [three-way decision](/glossary#three-way-decision) model used for runtime authority maps cleanly to approval workflows:

| Decision | Approval queue behavior | Runtime behavior |
|---|---|---|
| ALLOW | Approver accepts as written | Reserve and execute within envelope |
| ALLOW_WITH_CAPS | Approver narrows amount, recipient, environment, model, tools, or expiry | Execute only with the returned caps |
| DENY | Approver rejects or policy blocks | Do not execute; return feedback to agent |

This matters because many agent actions are almost acceptable.

The email is fine, but the recipient is wrong. The refund is justified, but the amount is too high. The deploy can proceed to staging, not production. The database query can run with `LIMIT 100`, not as a full export.

If the only choices are approve or reject, operators either block too much or approve too broadly. ALLOW_WITH_CAPS gives them the middle path.

## Audit needs one chain, not three logs

Approval-heavy systems often produce fragmented evidence:

- the chat log says someone approved
- the agent trace says a tool was called
- the application log says an email was sent

Those are not the same as an audit chain.

For governance, incident response, and compliance review, the useful receipt ties the lifecycle together:

| Evidence | Example |
|---|---|
| Proposed action | `message.email.send` to `alex@example.com` |
| Approval | `approval_id=appr_42`, approver, rationale, expiry |
| Reservation | `reservation_id=res_99`, 20 RISK_POINTS, scope path |
| Execution | provider request ID or tool execution ID |
| Commit | actual consumption, final decision, timestamp |
| Outcome | sent, skipped, rejected, expired, or released |

That chain is the reason runtime authority produces a better audit trail than observability alone.

Observability can tell you the email was sent. Runtime authority can show the bounded path that allowed it to be sent, or the denial that stopped it before execution.

For agent platforms, that distinction is operational. During an incident, the question is not only "what happened?" It is "which approved envelope allowed it, which scope consumed authority, and can we freeze that exact path without stopping everything?"

That connects approval queues directly to [scoped kill switches](/blog/ai-agent-kill-switches-should-be-scoped). If approval is bound to scope and action kind, operators can freeze one toolset, tenant, workflow, or approved path instead of turning off the whole agent fleet.

## What to measure

Approval queues should have metrics that reflect both workflow health and enforcement health.

| Metric | What it tells you |
|---|---|
| Approval volume by action kind | Which action surfaces create review load |
| Approval-to-execution rate | How often approved actions actually run |
| Denied-after-approval count | Whether runtime policy caught stale or invalid approvals |
| Stale approval expirations | Whether queues are too slow or approvals live too long |
| Edit rate | Whether agents are proposing actions that need human correction |
| Override rate | Whether humans routinely loosen policy |
| Duplicate execution attempts | Whether retries are trying to reuse approvals |
| Approval-to-commit mismatch | Whether what executed differed from what was approved |
| RISK_POINTS consumed by approved actions | How much blast radius humans are authorizing |

These metrics are especially useful after a [policy drift](/blog/policy-drift-in-ai-agents) event.

If a new skill or prompt update increases approval volume, raises edit rate, or creates more denied-after-approval events, the agent is telling you its approved envelope no longer matches live behavior.

The approval queue becomes an early-warning system. Runtime authority keeps that warning from turning into damage.

## Where external guidance points

The direction of the ecosystem is clear.

Frameworks are adding pause-and-resume approval primitives. Enterprise platforms are building registries, lifecycle controls, audit, and access governance for agents. Risk frameworks increasingly emphasize oversight, traceability, intervention, and proportionate controls.

That is the right direction, but it can still be implemented weakly.

Human oversight is not just a person in the loop. For agents that can act autonomously, oversight has to be connected to an execution boundary that can interrupt, narrow, or deny the action before the side effect happens.

Otherwise the approval queue becomes another [dashboard](/glossary#dashboard): useful after the fact, but not an authority.

## The takeaway

Human approval is not obsolete. It is becoming more important.

But the job of approval is judgment, not enforcement. The job of runtime authority is enforcement.

The production pattern is:

1. Use approval queues for actions where humans should apply judgment.
2. Bind every approval to agent identity, tenant, scope, action kind, target, arguments, expiry, and risk.
3. Reserve authority immediately before execution.
4. Commit or release after execution.
5. Keep one audit chain from proposal to approval to commit.

Static approval says what a human accepted. Runtime authority decides what the agent is still allowed to do.

For production AI agents, you need both.

## Sources

- [OpenAI Agents SDK: Human-in-the-loop](https://openai.github.io/openai-agents-python/human_in_the_loop/) - approval interruptions, RunState, and pause/resume behavior for sensitive tool calls.
- [OpenAI Agents SDK: MCP approvals](https://openai.github.io/openai-agents-python/mcp/) - hosted MCP `require_approval` and programmatic approval callbacks.
- [LangChain human-in-the-loop middleware](https://docs.langchain.com/oss/python/langchain/human-in-the-loop) - interrupt-based tool approval with approve, edit, reject, and respond decisions.
- [Microsoft Learn: Overview of Microsoft Agent 365](https://learn.microsoft.com/en-us/microsoft-agent-365/overview) - enterprise agent registry, lifecycle management, access control, logging, and audit capabilities.
- [NIST AI RMF Playbook](https://www.nist.gov/itl/ai-risk-management-framework/nist-ai-rmf-playbook) - voluntary guidance for governing, mapping, measuring, and managing AI risks.
- [EU AI Act Article 14: Human oversight](https://ai-act-service-desk.ec.europa.eu/en/ai-act/article-14) - human oversight measures for high-risk AI systems, including intervention and interruption.
- [OWASP Top 10 for Agentic Applications](https://genai.owasp.org/2025/12/09/owasp-top-10-for-agentic-applications-the-benchmark-for-agentic-security-in-the-age-of-autonomous-ai/) - agentic security risks including tool misuse, identity abuse, cascading failures, and human-agent trust exploitation.

## Related reading

- [We Put Cycles in Front of Our Own Outreach Agent](/blog/we-put-cycles-in-front-of-our-own-outreach-agent)
- [Policy Drift in AI Agents](/blog/policy-drift-in-ai-agents)
- [AI Agent Action Authority: Blocking a Customer Email Before Execution](/blog/action-authority-demo-support-agent-walkthrough)
- [AI Agent Action Control: Hard Limits on Side Effects](/blog/ai-agent-action-control-hard-limits-side-effects)
- [Agent Registries Are Not Runtime Governance](/blog/agent-registries-are-not-runtime-governance)
- [AI Agent Kill Switches Should Be Scoped](/blog/ai-agent-kill-switches-should-be-scoped)
- [The AI Agent Audit Trail You're Already Building](/blog/runtime-authority-byproducts-audit-trail-and-attribution-by-default)
- [How Reserve-Commit Works in Cycles](/protocol/how-reserve-commit-works-in-cycles)
