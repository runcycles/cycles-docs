---
title: "Agent Security Controls Map"
date: 2026-07-05
author: Albert Mavashev
tags:
  - security
  - agents
  - governance
  - runtime-authority
  - guardrails
  - observability
description: "Map AI agent security controls across prompt guardrails, tool guardrails, observability, identity, and runtime authority so each layer has a clear job."
blog: true
sidebar: false
featured: false
head:
  - - meta
    - name: keywords
      content: AI agent security controls, prompt guardrails, tool guardrails, runtime authority, agent identity, OWASP agentic AI, NIST AI RMF, agent governance
---

# Agent Security Controls Map

A team reviews its agent security posture and finds a familiar pile of controls.

There are prompt rules in the system message. Input and output guardrails screen unsafe content. Tool schemas validate arguments. The API gateway has rate limits. The observability stack captures traces. The identity team wants dedicated agent service accounts. The compliance team wants audit records.

Every control is useful. None of them explains the whole system.

That is the operational problem with agent security in 2026: teams are not short on controls. They are short on a map that says which control owns which risk, where it acts, and what gap remains when it passes.

This post is that map.

<!-- more -->

## The control map

| Control layer | Best at | Acts when | Does not cover |
|---|---|---|---|
| Prompt and policy instructions | Steering model behavior | Before and during reasoning | Deterministic enforcement |
| Input/output guardrails | Content safety and response validation | Before or after an agent response | Cumulative spend, delegated authority, tool side effects already executed |
| Tool guardrails | Per-tool argument and result validation | Around a tool invocation | Cross-run budget, [tenant isolation](/glossary#tenant-isolation), hosted or external surfaces outside the guardrail path |
| Agent identity | Attribution, credentials, ownership | At authentication and authorization boundaries | Whether the next action is still within budget or risk limits |
| [Runtime authority](/glossary#runtime-authority) | Pre-execution budget, risk, and action decisions | Before a model call, tool call, handoff, or side effect | Content quality, semantic safety, or user-facing explanation |
| Observability | Debugging, metrics, post-incident analysis | During and after execution | Preventing the next action by itself |
| Audit evidence | Proving what happened and what was decided | During and after enforcement | Real-time denial unless paired with enforcement |

The important point is not that one layer wins. The important point is that each layer has a different failure mode.

## Prompt controls steer, but do not enforce

Prompt instructions are the first layer most teams add:

- Do not reveal secrets.
- Ask for confirmation before destructive actions.
- Never send external email without approval.
- Stay within the customer's task.

Those instructions are useful. They reduce accidental misuse and shape the agent's reasoning.

But a prompt is not an enforcement boundary. The model may misunderstand, be manipulated by retrieved content, receive conflicting context, or produce a tool call that looks valid while violating operational policy.

Use prompts to steer behavior. Do not rely on prompts as the last line of defense for expensive or irreversible actions.

## Guardrails validate content and tools

Guardrails are stronger than prompt instructions because they run as code around inputs, outputs, or tools.

They are the right place for:

- Toxicity, PII, and policy checks.
- Structured-output validation.
- Tool argument validation.
- Tool result filtering.
- Per-tool local rules.

This is why content guardrails and tool guardrails belong in the stack. They catch classes of unsafe input, malformed output, and bad tool calls that a budget system should not try to understand.

Their boundary is scope. A guardrail around one tool call does not automatically know how much the [tenant](/glossary#tenant) has spent this month, whether a sibling agent already consumed the run budget, or whether a delegated agent inherited only read-only authority.

For the broader layer comparison, see [Runtime Authority vs Guardrails vs Observability](/blog/runtime-authority-vs-guardrails-vs-observability). For the OpenAI Agents SDK version of the same distinction, see [OpenAI Agents SDK: Content Guardrails, No Action Control](/blog/openai-agents-sdk-has-guardrails-for-content-but-nothing-for-actions).

## Identity answers who acted

Agent identity is becoming its own control plane.

Production systems need to know:

- Which agent performed the action?
- Which user or tenant initiated the work?
- Which service account or API key was used?
- Who owns the agent's lifecycle?
- Which permissions were granted for this run?

Those questions matter for security and audit. An agent borrowing a user's session creates weak attribution. A shared service account hides which autonomous actor actually performed the step.

But identity alone is not enough. A valid agent identity may still attempt an action that is too expensive, too risky, or outside the delegated task. Authentication answers "who is this?" Authorization answers "does this principal have permission?" Runtime authority adds the live question: "should this next action still run, given the current budget, scope, and accumulated risk?"

The identity side is covered in [Agent Identity Is Not User Identity](/blog/agent-identity-is-not-user-identity).

## Runtime authority decides before action

Runtime authority is the pre-execution layer.

It evaluates the proposed action against:

- Tenant, workspace, workflow, agent, and toolset scope.
- Remaining budget.
- Risk score or action class.
- Delegated authority.
- Current run state.
- Caps that can reduce cost or blast radius.

Then it returns an operational decision:

- `ALLOW`
- `ALLOW_WITH_CAPS`
- `DENY`

This is where budget and action security meet. A tool call that sends one email may be low cost but high risk. A long model call may be low risk but high cost. A delegated agent may have enough identity permission to call a tool but not enough delegated budget to use it.

Runtime authority does not replace guardrails or identity. It gives them a live enforcement point before the next action happens.

The zero-trust framing is covered in [Zero Trust for AI Agents](/blog/zero-trust-for-ai-agents-why-every-tool-call-needs-a-policy-decision).

## Observability explains, but does not stop

Observability is necessary.

Teams need traces, logs, metrics, [dashboards](/glossary#dashboard), and alerts to answer:

- Which agent spent the money?
- Which tool failed?
- Which input triggered the path?
- How often are denials happening?
- Which budget should be tuned?

But observability reads from execution. It is strongest after something has started or finished. That makes it a poor replacement for a pre-execution decision.

The practical stance is simple:

- Use observability to debug and tune controls.
- Use runtime authority to decide before execution.
- Use audit evidence to prove decisions later.

This avoids the common trap of treating a dashboard as a control.

## Audit evidence proves the decision trail

Security reviews and customer audits eventually ask for proof.

Not just:

- Did the agent produce a safe answer?
- Did the trace show a tool call?
- Did the dashboard alert?

But:

- Which action was proposed?
- Which identity proposed it?
- Which policy or budget applied?
- Was it allowed, capped, or denied?
- What usage was committed afterward?

That record has to survive the incident. It should not depend on screenshots, mutable logs, or reconstruction from scattered traces.

The audit-evidence side is covered in [A 200 OK Is Not an Audit Trail](/blog/a-200-ok-is-not-an-audit-trail) and [Audit Evidence Has to Survive Production](/blog/audit-evidence-has-to-survive-production).

## How to use the map

When reviewing an agent system, walk each high-risk workflow across the map.

For each step, ask:

1. What prompt instruction steers the behavior?
2. What guardrail validates input, output, or tool arguments?
3. What identity performs the action?
4. What runtime authority decision happens before execution?
5. What observability record explains the result?
6. What audit evidence proves the decision later?

If a step has only prompt guidance, it is weakly controlled. If it has observability but no pre-execution decision, it is monitored but not governed. If it has identity but no budget or risk check, it can still act too much. If it has runtime authority but no observability, operators can enforce but not tune.

The goal is not maximum control everywhere. The goal is the right control at the right layer.

## Resource links

- [Runtime Authority vs Guardrails vs Observability](/blog/runtime-authority-vs-guardrails-vs-observability) — the core layer comparison.
- [Zero Trust for AI Agents](/blog/zero-trust-for-ai-agents-why-every-tool-call-needs-a-policy-decision) — why tool calls need policy decisions before execution.
- [Agent Identity Is Not User Identity](/blog/agent-identity-is-not-user-identity) — dedicated identities, ownership, and auditability for autonomous actors.
- [OpenAI Agents SDK: Content Guardrails, No Action Control](/blog/openai-agents-sdk-has-guardrails-for-content-but-nothing-for-actions) — guardrails versus [action authority](/glossary#action-authority) in one SDK.
- [A 200 OK Is Not an Audit Trail](/blog/a-200-ok-is-not-an-audit-trail) — why enforcement decisions need durable evidence.
- [OWASP Agentic AI threats and mitigations](https://genai.owasp.org/resource/agentic-ai-threats-and-mitigations/) — threat-model-based reference for agentic AI risks.
- [NIST AI Risk Management Framework](https://www.nist.gov/itl/ai-risk-management-framework) — governance, mapping, measurement, and management framing for AI risk.
