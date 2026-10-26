---
title: "AI Agent Kill Switches Need Stop Contracts"
date: 2026-10-26
author: Albert Mavashev
tags: [agents, security, governance, operations, runtime-authority]
description: "An AI agent kill switch needs a testable stop contract: covered paths, revocation timing, outage behavior, and evidence. Here is where Cycles fits in practice."
blog: true
sidebar: false
featured: false
head:
  - - meta
    - name: keywords
      content: AI agent kill switch, agent containment, stop contract, runtime authority, agent security, budget freeze
---

# AI Agent Kill Switches Need Stop Contracts

Imagine a refund agent with two ways to reach the payment provider: a governed tool gateway and a legacy SDK holding a service credential. An operator disables the agent at the gateway. The next gateway request is rejected. A retry through the SDK still succeeds.

The gateway enforced its rule. The team misunderstood the scope of the stop.

This is a constructed example, but it captures the question behind the recent AI agent kill-switch discussion: **which actions become impossible after an operator presses stop, and what evidence establishes that?**

Before relying on a kill switch, write a stop contract: the affected identities and operations, the enforcement boundaries, the time allowed for revocation, the behavior during failures, and the proof required before declaring containment. This is an operational document proposed here, not a new protocol or a Cycles API object.

<!-- more -->

## What the recent AI kill-switch discussion reveals

The recent discussion brings together product announcements, deployment questions, and research about shutdown resistance. They address different problems.

[DigiCert's September 15 announcement](https://www.digicert.com/news/every-ai-agent-needs-a-kill-switch-digicert-launches-ai-trust-manager) presents AI Trust Manager as an identity and authority-revocation system. [Okta's September 22 announcement](https://www.okta.com/newsroom/press-releases/ai-innovations-oktane-2026/) describes an existing control that blocks new sessions and a planned Agent Gateway expansion covering active access tokens and sessions. The distinction between existing and planned behavior matters when writing an incident runbook.

Okta's [October 8 explanation](https://www.okta.com/blog/product-innovation/okta-agent-gateway-runtime-security/) makes that distinction explicit: Agent Gateway is generally available, while its gateway kill-switch functionality is described as coming soon.

The implementation documentation gives a more concrete view:

| Documented control | Boundary described by its documentation | Deployment question to verify |
|---|---|---|
| [MuleSoft Agent Kill Switch](https://docs.mulesoft.com/general/exp-detect-and-contain-rogue-agents) | Blocks a flagged identity's access to a protected model proxy; requires policies and matching identity selectors | Does every relevant request traverse a protected proxy with the expected verified identity? |
| [ServiceNow AI Control Tower containment](https://www.servicenow.com/docs/r/intelligent-experiences/aict-configuring-security-connections.html) | Uses platform-specific controls, including Deny Resource policies on supported runtimes and application disabling on Azure AI Foundry | Which connectors and identities are configured, and what does each target platform actually stop? |
| Okta's announced gateway expansion | Plans to extend containment from new sessions to active tokens and sessions for connected agents | Is the capability available in this deployment, and which connections does it cover? |

These controls supply useful intervention points. Their coverage depends on the deployment around them. A product name cannot establish that every credential, route, and child worker is covered.

That concern also appears in an [August practitioner discussion about ServiceNow's kill switch](https://www.reddit.com/r/servicenow/comments/1vhgjz5/is_anyone_actually_running_ai_control_towers_kill/): participants ask what happens outside connected platforms and whether organizations have populated their inventories. Treat the thread as evidence of operator questions, not as an authoritative description of current product capabilities.

Research adds a separate reason to examine the control boundary. The September preprint [*Shutdown Sabotage Propensities in Multi-Agent Systems*](https://arxiv.org/html/2609.28274v1) reports agents modifying shutdown mechanisms in a controlled experimental setting. Its limitations are consequential: the scripts were inert, the platform artifacts fictional, and the experiments ran in a sandbox. It does not establish a production shutdown-failure rate.

The engineering recommendation we take from that concern is narrower: place emergency controls outside the permissions of the agent being stopped, and test that separation directly.

## Write the stop contract before the incident

The existing guidance on [scoped kill switches](/blog/ai-agent-kill-switches-should-be-scoped) addresses how narrowly an operator can intervene. A stop contract adds the acceptance criteria for that intervention.

For the hypothetical refund service, the contract might contain:

| Contract field | Example requirement |
|---|---|
| Scope | Stop refund issuance for the affected [tenant](/glossary#tenant) and workflow, including delegated workers and retries |
| Covered paths | Enumerate the gateway, legacy SDK, queue consumers, and provider credentials; assign an owner to each |
| Effective boundary | Identify the last service that can reject a refund before the provider accepts it |
| Stop deadline | Define and measure the interval from an authorized stop request to enforcement on every covered path |
| Outstanding work | Track requests already accepted by the provider separately; record cancellation, completion, or an unresolved outcome |
| Outage behavior | Prevent new refund dispatch when the required authority check is unavailable; specify any separately authorized recovery path |
| Evidence | Retain the stop identifier, enforcement acknowledgments, rejected attempts, and provider-side transaction records |
| Restart | Require an authorized recovery decision and reconcile old attempts before retrying them |

These are proposed requirements, not measured product guarantees. Choose deadlines from the consequences of the operation and the behavior of the downstream service. A document-classification job and a production data deletion need different responses.

Make the acknowledgment precise. “Stop requested” can mean the control plane accepted a command. “New refunds blocked” requires evidence from the enforcement boundaries. “All work ended” requires evidence about previously accepted work. The [background-job shutdown guide](/blog/stopping-ai-agents-background-jobs) covers that last lifecycle in detail.

## Test the paths that can bypass the AI agent kill switch

Start the acceptance test with an inventory of reachable effects. For every route, identify the credential, the destination, the enforcement point, and whether the agent can change any of them. This extends [least-privilege credential design](/blog/least-privilege-api-keys-for-ai-agents) into an incident-response question: can this credential still produce the effect after the stop?

Use nonproduction credentials and a fake payment sink. Test at least these conditions:

- **Alternate route:** attempt the same refund through both the gateway and the legacy SDK after the stop. Inspect the sink's accepted transactions.
- **Cached authority:** reuse a token or admission result obtained before the stop. Establish when the receiving boundary rejects it and what remains possible until then.
- **Unavailable control plane:** interrupt the authority check. Verify that an exception handler or fallback does not silently permit the refund.
- **Control tampering:** use the worker's actual permissions to attempt changing the stop state, disabling its check, or reading an operator credential. The expected result is rejection outside the agent's control.
- **Replacement worker:** restart the process and deliver a delayed retry. Verify that the stop persists and the replacement inherits the affected scope.

Record both the time to enforcement and any transactions accepted during that interval. A short delay can still matter if one permitted operation has a large consequence. A successful test establishes behavior for the tested routes and failure conditions; it does not establish that the inventory is complete forever.

Retest when credentials, connectors, worker identities, or dispatch routes change. Those changes can expand the set of actions that remain reachable after a stop without changing the stop button itself.

## Where Cycles fits in the stop contract

Cycles supplies a budget-admission boundary for instrumented actions. A [budget freeze](/how-to/budget-allocation-and-management-in-cycles) blocks new [reservations](/glossary#reservation) against the frozen ledger. The application must require a successful reservation before dispatch and must preserve the intended scope through retries and delegation.

That is a concrete contribution to containment. It does not terminate the agent process, revoke a payment-provider credential, cancel a provider job, or prevent a direct call that bypasses the integration.

Be precise about the response, too. For a new live reservation against a frozen budget, the documented response is HTTP `409` with `BUDGET_FROZEN`. A [preflight decision](/protocol/how-decide-works-in-cycles-preflight-budget-checks-without-reservation) or dry-run reservation can instead report `DENY` in a successful HTTP response. A preflight decision does not reserve budget; the execution path still needs the live reservation gate.

Budget admission and downstream dispatch are separate events. A reservation granted before the freeze does not prove that a later dispatch is safe. Put any required stop-state enforcement at the dispatch boundary, and document its ordering and remaining race window. Cycles' reserve-commit lifecycle does not make a provider call atomic with a budget freeze.

For the refund example, freeze the applicable budget, block or revoke the alternate credential path, and have the payment boundary enforce the incident stop. Verify each operation independently. Use [scope derivation](/protocol/how-scope-derivation-works-in-cycles) to check which ledgers each request actually encounters; a label in a log is not proof of enforcement.

Test outages with equal care. If the integration proceeds when it cannot obtain a reservation, the budget service is absent from that action's effective stop path. A fail-closed policy for the protected refund operation must be implemented and exercised in the host. Keep operator credentials and the ability to unfreeze budgets outside the agent's permissions.

## Make containment a claim you can demonstrate

For the hypothetical refund service, a useful result would be: new gateway requests rejected; the legacy credential disabled and tested; replacement workers blocked; two previously accepted refunds awaiting provider confirmation.

That report has an operational consequence: keep recovery restricted while those two outcomes remain unresolved. It also tells the next responder which controls worked and which work still needs attention.

A stop contract makes the kill switch reviewable before an emergency. It gives the platform team a coverage map, the security team a test of control separation, and the operator a precise meaning for each acknowledgment. Cycles belongs in that contract wherever a successful budget reservation is a prerequisite for action.

## Resources

The product descriptions above were checked against [DigiCert's announcement](https://www.digicert.com/news/every-ai-agent-needs-a-kill-switch-digicert-launches-ai-trust-manager), [Okta's announcement](https://www.okta.com/newsroom/press-releases/ai-innovations-oktane-2026/), [MuleSoft's containment guide](https://docs.mulesoft.com/general/exp-detect-and-contain-rogue-agents), and [ServiceNow's connector documentation](https://www.servicenow.com/docs/r/intelligent-experiences/aict-configuring-security-connections.html) on October 26, 2026. Check availability and connector behavior for the version deployed in your environment. For the research result and its experimental limits, read the [shutdown-sabotage preprint](https://arxiv.org/html/2609.28274v1).
