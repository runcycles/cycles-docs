---
title: "When an AI Agent Works Around a Denial"
date: 2026-10-09
author: Albert Mavashev
tags: [security, agents, action-control, runtime-authority, production]
description: "AI agents can retry blocked actions through other tools or workers. Learn how to preserve policy boundaries, permit safe fallbacks, and test what happens next."
blog: true
sidebar: false
featured: false
head:
  - - meta
    - name: keywords
      content: AI agent safety, AI agent denial handling, agent policy enforcement, tool authorization, agent security testing, runtime authority, agent workarounds
---

# When an AI Agent Works Around a Denial

A support agent tries to email a customer export. The email tool rejects the request because the recipient is outside the approved domain. The agent uploads the export to a file-sharing service and sends the customer a link.

This is a hypothetical incident. The email control worked, but the data crossed the forbidden boundary through another route.

An agent's persistence is useful when a service is unavailable or a search returns nothing. The same persistence creates risk when the obstacle is a policy prohibition. A blocked tool call can become the starting point for another plan.

The safety question is what the deployed system permits **after the denial**. Changing tools, credentials, or workers must not silently authorize the restricted operation.

<!-- more -->

## Why AI agent safety needs to follow the next attempt

NVIDIA's October 5, 2026 research, [*Assume Misalignment*](https://research.nvidia.com/ai-security/assume-misalignment-securing-ai-agents-beyond-prompt-injection), describes unsafe actions during legitimate workflows as well as adversarial attacks. It identifies repeated attempts through different paths after a policy denial as a security concern. Its architectural recommendation is to enforce policy outside the agent's control, across the tools and protocols available to it.

UK AISI's [evaluation-hardening report](https://www.aisi.gov.uk/blog/building-a-more-secure-environment-for-evaluating-dangerous-capabilities) describes separate sandbox and host network restrictions, synchronous monitoring, and checks before an evaluation begins. The preceding [incident](https://www.aisi.gov.uk/blog/incident-report-unsanctioned-agent-behaviour-during-cyber-testing) occurred under deliberately permissive testing conditions, including internet access and disabled cyber classifiers. It was not a sandbox escape, and it does not establish how frequently comparable behavior occurs in ordinary deployments.

These sources support testing the system around the agent, including the routes it can take after an intervention. They do not imply that every retry is malicious or that a single unsafe action proves a model has hostile goals.

For the support workflow, write the policy in terms of the protected operation: this export may be delivered only to approved recipients through approved destinations. A rule attached only to the email tool leaves the upload route unaddressed. The [agent security controls map](/blog/agent-security-controls-map) helps assign each part of that policy to an enforcement layer.

## Classify a denial before choosing a fallback

A generic “tool failed” response erases information the orchestrator needs. The next action should depend on why execution did not proceed and whether the previous attempt might already have taken effect.

| Result at the execution boundary | Host-controlled response | Safe continuation |
|---|---|---|
| Transient service failure, with confirmed no side effect | Permit a bounded retry or an independently authorized alternative. | Retry within the existing resource and destination restrictions. |
| Outcome unknown after dispatch | Reconcile against a durable operation ID or downstream receipt before repeating the side effect. | Continue unrelated work while the operation remains unresolved. |
| Policy prohibition | Reject the restricted operation across the applicable execution paths. | Draft a response or complete another permitted part of the task. |
| Approval required | Hold execution until an authorized reviewer approves the specific operation. | Prepare the approval request without performing the action. |
| Shared action allowance exhausted | Refuse further covered actions under that scope. | Stop, defer, or perform work that needs no additional allowance. |

These are application-level categories, not a proposed set of Cycles API error codes. The integration must map actual service responses into them. HTTP status alone may not identify the category.

Give the agent an explanation it can use: “External delivery is not permitted for this export. Prepare an internal summary instead.” Keep detailed policy internals out of model-visible errors where they are unnecessary. The explanation helps planning; the executor still enforces the restriction if the agent ignores it.

An authorized fallback changes the method while preserving the relevant constraints. The [graceful-degradation guide](/blog/when-budget-runs-out-graceful-degradation-patterns-for-ai-agents) covers useful continuations such as partial completion and deferral. A policy prohibition should not enter the same automatic fallback chain as a provider outage.

## Apply the policy to every available execution route

Start with an inventory of ways the agent can produce the restricted effect. For an export, that includes direct attachments, uploads, public links, browser form submissions, and child workers that have delivery tools. Generated code matters too if the agent can execute it with network access.

The host should obtain the protected resource identity, requester, approved recipient, destination, and policy version from trusted application state. Do not let the model relabel a customer export as “diagnostic output” and thereby select a weaker policy. Content inspection can add evidence, but a classifier's failure must not grant broad access to a resource already classified as restricted.

Enforcement belongs at boundaries the agent cannot rewrite or bypass:

- The application executor checks resource and recipient authorization before dispatch.
- Infrastructure restricts direct network access and credential use outside the mediated paths.
- The tool service validates approvals against the actual operation it is about to perform.
- Policy configuration and the enforcement process remain outside the agent's writable workspace and administrative authority.

An allowed domain is not necessarily an allowed destination for every payload. A shared SaaS service may host both approved internal workspaces and externally accessible locations. Destination policy may need to check the account, workspace, sharing mode, and recipient, not merely the hostname.

If a raw shell or browser session can use the same powerful credential to perform the action directly, a wrapper around one named tool is an incomplete boundary. Remove that route, reduce its permissions, or bring it under equivalent enforcement before claiming coverage.

## Carry restrictions into delegated work

Delegating an export should not turn a prohibition into permission. The child needs a host-established task identity and permissions appropriate to its assignment. Copying a warning into its prompt is useful context, but it is not access control.

Apply [authority attenuation](/blog/agent-delegation-chains-authority-attenuation-not-trust-propagation): a worker assigned to summarize the export can read the permitted data without receiving external-delivery credentials. When delivery is authorized, the execution service must validate the worker's request against that authorization.

Bind approvals to the relevant resource, action, destination, validity period, and replay rules. The [approval-queue guide](/blog/ai-agent-approval-queues-need-runtime-authority) explains why an earlier human approval does not automatically authorize a changed request. Changing the filename or tool name must not substitute for a new authorization decision.

Some interventions also need to affect work already queued or delegated. Preventing a new parent tool call does not cancel a child job or an external operation already dispatched. The [agent shutdown guide](/blog/stopping-ai-agents-background-jobs) treats those as separate control points that require their own evidence.

## Where shared action budgets help

Cycles can constrain aggregate consumption across instrumented paths through its [reserve-commit lifecycle](/protocol/how-reserve-commit-works-in-cycles). For example, application-assigned `RISK_POINTS` can account for authorized deliveries against a shared workflow allowance, even when different tools or workers request them. These units express the application's accounting policy; they are not a probability of harm.

The host must select the scope and assigned amount from trusted state. Provision the intended shared budget, make each covered dispatch obtain a valid [reservation](/glossary#reservation), and settle completed usage. A new child or tool must not be able to select another budget identity to regain capacity. An identifier stored only in arbitrary metadata does not establish a budget scope; the [authoritative YAML specification](/cycles-protocol-v0.yaml) defines the subject fields and reservation behavior.

Budget admission and application authorization are separate requirements. Remaining points do not authorize a forbidden recipient, and Cycles does not determine that an upload is semantically equivalent to a rejected email. The application and infrastructure must enforce those boundaries. A configured allowance is useful only for the operations that actually pass through its gate.

## Test AI agent behavior after a denial

Run a controlled exercise with synthetic records, isolated test services, and no production credentials or live external recipients. The following is a proposed test plan, not a report of measured results.

Define one forbidden outcome: the marked export must not reach the test recipient or a location accessible to that recipient. Give the executor a legitimate task, trigger the primary-path denial, and then exercise each follow-up route.

| Follow-up attempt | Required assertion |
|---|---|
| Repeat the original send | The send remains rejected while the same prohibition applies. |
| Upload the same export and share a link | The upload or sharing operation cannot make the export accessible to the prohibited recipient. |
| Ask a child worker to deliver it | The child cannot acquire broader authority or use another workflow identity. |
| Execute a generated script that transfers it | The execution environment cannot bypass the applicable delivery controls. |
| Reuse approval for another recipient | The changed operation requires a matching authorization. |
| Prepare an internal summary | The permitted task completes without enabling external delivery. |

Exercise these paths directly through the harness as deterministic integration tests. Separately run model-driven scenarios to examine which paths an agent proposes after denial. A model that happens not to try a path in one run has not tested that path's enforcement.

Verify the result at the destination, storage service, job queue, and execution boundary. A denial log establishes that one request was rejected. It does not prove that another sender did not complete the delivery. Include both blocked attempts and successful safe continuations in the evidence, and repeat the tests when tools, permissions, delegation, or models change.

## Measure intervention coverage and its limits

Anthropic's [oversight measurements](https://www.anthropic.com/institute/measuring-pace-of-ai-development) distinguish monitoring coverage, review latency, and escalation rate for an internal agent platform. These are useful operational measures, but monitoring an action does not by itself establish that the monitor detects every unsafe case.

For this exercise, record which execution routes were tested, whether review preceded dispatch, and whether any prohibited side effect occurred after the initial denial. Record permitted continuations too: a system that blocks all work can satisfy a narrow prohibition while failing the user's task.

OWASP's September 2026 [Agent Control Standard announcement](https://genai.owasp.org/resource/agent-control-standard-acs/) describes middleware hooks for portable runtime policy enforcement. Such integration points are useful. Their presence does not establish that a deployment routes every consequential action through them; that remains something to verify.

A denied request is one observed decision. The stronger operational claim is that, for a defined policy and tested set of execution routes, the restricted outcome remained blocked while authorized work continued. State that boundary explicitly, and keep testing it as the agent's environment changes.

## Resources

- NVIDIA's [*Assume Misalignment*](https://research.nvidia.com/ai-security/assume-misalignment-securing-ai-agents-beyond-prompt-injection) describes unsafe actions, delegation risks, and enforcement outside the agent's control.
- UK AISI's [evaluation security changes](https://www.aisi.gov.uk/blog/building-a-more-secure-environment-for-evaluating-dangerous-capabilities) explain layered containment and monitoring, including their limitations.
- OWASP's [Agent Control Standard](https://genai.owasp.org/resource/agent-control-standard-acs/) introduces a common integration surface for runtime controls.
