---
title: "When AI Agents Rewrite Approval Rules"
date: 2026-10-12
author: Albert Mavashev
tags: [agents, governance, security, action-control, runtime-authority, production]
description: "AI agents can configure the approval rules that govern future actions. Learn how to separate drafting from publishing, test exceptions, and verify changes."
blog: true
sidebar: false
featured: false
head:
  - - meta
    - name: keywords
      content: AI agent approval rules, AI agent workflow security, approval workflow testing, agent configuration changes, runtime authority, agent governance
---

# When AI Agents Rewrite Approval Rules

A procurement team asks an agent to configure its software-purchasing workflow. The agent builds the intake form, adds Finance and Security reviewers, and runs a successful demonstration. An administrator approves publication.

The first urgent request involves a supplier that will process customer data, but it skips Security. The agent interpreted “expedite urgent requests” as permission to bypass that review, rather than move the request to the front of the queue.

This is a hypothetical incident. Every configuration write could have been authorized. The resulting workflow still implements the wrong rule, and future requests inherit the mistake.

When agents configure approval systems, the review must cover the decisions those systems will make. Permission to edit, evidence of correctness, and permission to publish are separate requirements.

<!-- more -->

## AI agents are configuring approval workflows

OpenAI's October 6, 2026 [research collaboration with Ironclad](https://openai.com/index/advancing-computer-use-with-ironclad/) evaluates agents on tasks involving agreements, approval processes, and reusable legal terms. Its 11 research tasks use multiple criteria to assess the finished work. That approach recognizes that completing interface operations is only part of the job: the configured process must preserve business requirements across different inputs.

This is useful progress in evaluating substantive work. It is also a reason to examine configuration authority carefully. The research does not report the hypothetical procurement incident above, and its results do not establish a failure rate for production approval systems.

Anthropic's October 9 [report on unintended model actions](https://www.anthropic.com/research/investigating-unintended-model-actions) describes separate cases from evaluations and internal use, including real form submissions and workarounds around restrictions. Anthropic reports minimal real-world impact in those cases. They illustrate why task instructions and the boundaries enforced by the surrounding system both matter; they are not evidence that agents routinely rewrite approval policies maliciously.

The architectural concern here is simpler: a mistaken configuration can govern many later actions. An [approval queue for individual agent actions](/blog/ai-agent-approval-queues-need-runtime-authority) helps review a proposed operation. Configuring that queue requires reviewing the rules that decide which operations will ever reach it.

## Treat approval-rule changes as consequential actions

Start with what the proposed change can affect. Updating the wording of a help message has different consequences from changing who can approve a purchase or which requests require review.

| Configuration change | Consequence to review |
|---|---|
| Raise a financial threshold | More requests can proceed without Finance approval. |
| Change an approver group | Authority moves to a different set of identities. |
| Add an urgent-request branch | The branch may omit a required review. |
| Make a classification field optional | Missing data may reach a permissive default. |
| Change a shared template | Several workflows may inherit the new behavior. |

The [tool-risk classification guide](/blog/ai-agent-risk-assessment-score-classify-enforce-tool-risk) provides a starting point for classifying these operations. Classify the effect and affected scope, not just a tool name such as `save_workflow`.

Record the workflow, [tenant](/glossary#tenant), environment, current version, proposed version, and downstream consumers. For shared templates, identify which consumers update automatically and which remain pinned. An agent can help discover this inventory, but the executor should resolve authoritative identifiers from the application.

## Separate drafting, testing, and publishing

Give the authoring agent access to a draft or isolated test environment. Keep production activation behind a separate identity and authorization path. The agent should not be able to grant itself publication rights, edit the validator, or replace the requirements against which its work will be checked.

A practical division of responsibility looks like this:

| Stage | Permitted work | Required boundary |
|---|---|---|
| Draft | Propose configuration changes and explanations. | No production activation or changes to reviewer permissions. |
| Validate | Exercise the candidate against reviewed requirements. | Expected outcomes and required tests come from a protected source. |
| Approve | Review the specific candidate and its evidence. | An authorized reviewer independent of the authoring agent. |
| Publish | Activate the approved candidate. | Verify its identity, target, approval validity, and current base version. |

These are recommended application controls, not claimed features of every workflow product. If a platform exposes only an administrator credential that can both edit and activate, naming two tools “draft” and “publish” does not create that separation. Use enforceable service permissions or an external publication service, or retain human operation of the privileged interface.

For an existing workflow, bind review to the proposed change and the version it modifies. If someone edits the live configuration after validation, publication should stop for reconciliation. Revalidating only the old candidate would miss the new interaction. The same current-state concern appears in [agent rollback safety](/blog/ai-agent-rollback-risk).

## Test approval rules against business requirements

Before generating the workflow, have its owner establish a small, explicit requirements set. For this example, assume:

- Finance approval is required for purchases of **$50,000 or more**, measured in USD total contract value.
- Security approval is required whenever the supplier will process customer data, regardless of amount.
- Urgency changes queue priority only.
- Missing amount, unsupported currency, or unknown data classification blocks progression until resolved.
- A requester cannot approve their own request, even if they belong to an approver group.

These are fictional organization-specific rules. The dollar threshold describes a business decision boundary; it is not an AI spending recommendation.

Use a test matrix with explicit expected decisions:

| Test input or event | Expected result |
|---|---|
| $49,999; no customer data | Neither Finance nor Security review required by these rules. |
| Exactly $50,000; no customer data | Finance review required. |
| $50,001; no customer data | Finance review required. |
| $10,000; customer data | Security review required. |
| $50,000; customer data; urgent | Both reviews required; urgency changes priority only. |
| Missing amount, unsupported currency, or unknown classification | Block progression and request correction. Test each condition separately. |
| Requester is also in the Finance approver group | Reject that requester's approval; route to an eligible approver. |
| Required approver group is empty | Block the affected request and escalate. |
| A reviewed request changes from no customer data to customer data | Reevaluate the applicable requirements before execution; obtain Security approval. |
| Candidate changes after approval | Reject publication until the changed candidate is validated and approved. |

These tests cover selected rules, not the entire purchasing process. Add cases for actual currency conversion, aggregated orders, delegates, and exceptions if the organization's requirements include them. Otherwise the authoring agent may make those policy choices implicitly.

[Open Policy Agent's testing documentation](https://www.openpolicyagent.org/docs/policy-testing) demonstrates policy tests with defined inputs and expected results, including parameterized tests. The same discipline applies when the implementation is a graphical workflow: use supported test facilities or an isolated environment to submit synthetic requests and inspect the resulting review requirements.

Check enforcement as well as routing. A task appearing in an approval queue is insufficient if a direct API path can finalize the request without the approval. Run tests at the authoritative execution boundary and exercise relevant alternate entry points. The [execution-route coverage guidance](/blog/ai-agent-denial-workarounds#apply-the-policy-to-every-available-execution-route) addresses that coverage problem.

The agent may propose additional cases. A protected baseline must still determine whether required checks pass. Another model's reassuring summary can assist review, but it does not substitute for those checks or the owner's judgment about omitted requirements.

## Publish the version that passed review

Prepare a review packet containing the configuration diff, affected workflows, requirement version, test results, and unresolved questions. Identify which changes expand permissions or remove review requirements. A concise behavioral comparison helps the reviewer see more than a large configuration export.

The publication service should verify that the candidate is exactly the reviewed version and that the live base remains the one used for validation. Bind the approval to the target environment and an expiry. Use the destination's conditional-update or equivalent serialization mechanism so another write cannot slip between the version check and activation.

Choose how in-flight requests will behave before publishing. Some may remain on their original workflow version; others may need reevaluation. Either choice needs an explicit migration rule so a configuration update does not silently invalidate approvals already collected.

After activation, read back the effective configuration and record the actual published version. Run safe verification cases where the platform permits them without creating real purchases or external submissions. Keep a reviewed recovery plan, including the treatment of requests created under the new rules.

## Keep runtime limits separate from rule correctness

[Action authority](/concepts/action-authority-controlling-what-agents-do) can bound an agent's configuration activity. A host integration can assign [RISK_POINTS](/glossary#risk-points) to covered operations and require a Cycles [reservation](/glossary#reservation) before invoking them. The integration must commit consumed units afterward and reconcile uncertain outcomes. Reservations alone do not account for completed activity. This can limit cumulative action [exposure](/glossary#exposure) across a run, provided the protected paths actually pass through the integration.

The application still owns permissions, separation of duties, version checks, and the correctness tests above. A successful reservation does not prove that an approval rule is valid or authorize an otherwise forbidden publication. The authoring agent must not control its own allowance or the credentials that bypass these checks.

Retain the reviewed requirements, candidate identity, test evidence, approval, and publication receipt together. Keep them in an evidence store the authoring agent cannot rewrite. Your [agent audit packet](/blog/what-goes-in-an-ai-agent-audit-packet) should let a later reviewer reconstruct both what was authorized and what became effective.

The procurement team's acceptance criterion is the behavior of the published workflow: urgent requests involving customer data retain Security review, thresholds route correctly, and incomplete requests stop. That is the evidence needed before a successful demonstration becomes a production control.

## Resources

- [OpenAI and Ironclad: computer use for contracting workflows](https://openai.com/index/advancing-computer-use-with-ironclad/)
- [Anthropic: investigating unintended model actions](https://www.anthropic.com/research/investigating-unintended-model-actions)
- [Open Policy Agent: policy testing](https://www.openpolicyagent.org/docs/policy-testing)
