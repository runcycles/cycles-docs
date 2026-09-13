---
title: "Pace AI Agent Authority as Models Advance"
date: 2026-09-13
author: Albert Mavashev
tags: [runtime-authority, action-authority, governance, agents, engineering]
description: "Dario Amodei calls for pacing frontier AI. For production teams, runtime authority offers a practical way to bound agent spending, actions, and delegation."
blog: true
sidebar: false
featured: false
head:
  - - meta
    - name: keywords
      content: Dario Amodei, We Must Pace the Frontier, AI agent runtime authority, agent safety, action authority, agent budgets
---

# Pace AI Agent Authority as Models Advance

Imagine upgrading a support agent to a more capable model. It resolves harder tickets, investigates more cases in parallel, and delegates work to specialist agents. Its credentials, spending limits, and permission to send customer emails remain unchanged.

The upgrade improved what the agent can accomplish. It also changed how much it might do before an operator intervenes. A deployment review should examine both.

Dario Amodei's September 2026 essay, [*We Must Pace the Frontier*](https://darioamodei.com/post/we-must-pace-the-frontier), argues for slowing capability advancement so safety work can keep up. For teams operating agents, it raises a related engineering question: **how should an agent's authority change as its capabilities grow?**

Our answer is to expand authority only when the controls around the deployed system have been tested to support it.

<!-- more -->

## What Dario's AI pacing argument means for operators

Amodei proposes embedded external evaluators, coordination among frontier AI companies in democratic countries with government support, and efforts toward global coordination. He emphasizes using the additional time for operational rigor, alignment, interpretability, and evaluation. His subject is frontier development and its governance.

The connection to production agents is our application of that argument. Model developers decide what capabilities to build and release. Application operators decide which tools, resources, and permissions a deployed agent receives. Those are different decisions, and both deserve scrutiny.

That second decision is where [runtime authority](/blog/what-is-runtime-authority-for-ai-agents) becomes useful: checking whether the next action may proceed before the protected operation executes.

A model upgrade should trigger a review of that boundary. Better performance on support tickets does not, by itself, establish that the agent should issue larger refunds, contact more customers, or spawn more workers.

## Separate model capability from agent authority

Consider a hypothetical support workflow. The numbers below illustrate an operator's policy choices; they are not recommended defaults or measured outcomes.

| Dimension | Initial deployment | Evidence to seek before expansion |
|---|---|---|
| Model spending | A shared $10 workflow budget | Successful settlement and bounded provider requests under retries and concurrency |
| Customer contact | At most three outbound emails per run | Correct recipients, duplicate suppression, and tested denial of a fourth send |
| Refunds | Draft recommendations for human approval | Reliable eligibility checks and narrowly scoped execution credentials |
| Delegation | Two specialist workers with restricted tools | Children cannot gain broader permissions or escape the shared budget |
| Incident response | Stop new outbound actions for the affected workflow | Tests show the stop takes effect at the intended execution boundary |

This makes a model upgrade a reviewable operational change. Teams can adopt better reasoning while holding external permissions steady, then widen specific permissions as evidence accumulates.

These controls have different owners. The application authorizes recipients and refund amounts. The orchestrator limits worker creation. A budget service accounts for shared consumption. Infrastructure restricts credentials and network access.

Anthropic's [sandboxing engineering article](https://www.anthropic.com/engineering/claude-code-sandboxing) describes filesystem and network isolation as complementary boundaries. A spending limit belongs alongside those controls: it cannot make a forbidden destination unreachable or remove a privileged credential.

## Runtime authority needs a shared budget

Concurrency makes local checks misleading. Suppose five workers each read a remaining workflow budget of $10 and each decides that a $3 operation fits. If they proceed independently, they can initiate $15 of work against the same $10 allowance.

In Cycles, the [reserve-commit lifecycle](/protocol/how-reserve-commit-works-in-cycles) holds an estimate before an instrumented operation begins, then settles actual usage afterward. [Reservation](/glossary#reservation) admission is atomic across the applicable budget scopes. Outstanding reservations therefore consume capacity that another worker cannot reserve at the same time.

For the example above, if each operation reserves exactly $3 against the same ledger, no other consumption occurs, and those reservations remain active, three reservations fit; the remaining two cannot acquire another $3 each.

That is a bound on admitted estimates. To bound actual provider spending, the execution layer must also constrain requests to what was reserved, or obtain additional capacity before continuing. An underestimated call can cost more than its reservation, and accounting cannot undo consumption that already occurred.

The distinction matters when increasing concurrency: a shared budget constrains aggregate admitted work even when the number of workers changes.

## Action authority reaches beyond model spending

An inexpensive tool call can still send an unwanted message or modify the wrong record. Model spending alone does not express those consequences.

Cycles supports caller-assigned `RISK_POINTS` for [action exposure budgets](/concepts/action-authority-controlling-what-agents-do). These are policy accounting units. They are not a model-generated safety score or a probability that an action will cause harm.

For the hypothetical email limit, the application could assign one point per outbound email and explicitly provision three points for that run's email toolset. Every sender must debit that same ledger, even when different agents request the sends. Every send must pass recipient authorization and reserve one point through a mandatory tool boundary. Successful sends commit that point. Provided every send is metered, reservations stay valid through execution, and no capacity is added, the fourth send cannot acquire another point.

The run identifier must be encoded in a standard budget subject field, such as the workflow field. Arbitrary metadata does not create an enforceable per-run ledger. The application must also prevent agents from choosing another scope or understating the action's assigned cost.

The protocol uses `ALLOW`, `ALLOW_WITH_CAPS`, and `DENY` for its decision vocabulary. A live reservation succeeds with `ALLOW` or `ALLOW_WITH_CAPS`; unsuccessful admission returns an error. Returned caps require enforcement by the caller. A preflight decision alone does not reserve capacity. These distinctions are defined in the [Cycles API specification](/cycles-protocol-v0.yaml).

If sending is blocked, the host can let the agent continue drafting replies. That is an application-selected [degradation path](/how-to/how-to-think-about-degradation-paths-in-cycles-deny-downgrade-disable-or-defer), rather than an automatic change in the model's behavior.

## Delegation should narrow agent authority

Specialist agents should receive only the tools and resources their task requires. A research worker may need ticket access without permission to send email. A refund reviewer may need transaction history without credentials to issue payments.

This is [authority attenuation](/blog/agent-delegation-chains-authority-attenuation-not-trust-propagation): narrowing authority at delegation boundaries. For budget enforcement, explicitly provision the relevant child and shared workflow ledgers and submit the correct subjects on protected calls. Cycles does not automatically create a child budget when an agent delegates. The orchestrator remains responsible for tool permissions and delegation limits.

One useful adversarial test is to have a child request the parent's broader tools or submit work under a different budget identity. The enforcement boundary should reject that attempt regardless of how persuasively the agent explains its need.

## Evaluate the controls around the agent

Anthropic's [guide to agent evaluations](https://www.anthropic.com/engineering/demystifying-evals-for-ai-agents) distinguishes an agent's transcript from the actual outcome in the environment. It also describes evaluation as testing the model and its harness together. Both distinctions matter for authority: an agent saying it stopped is weaker evidence than a tool service recording that no additional action executed.

Before expanding permissions, test the failure paths as well as successful tasks:

- Concurrent workers compete for the last available capacity.
- A tool succeeds but its response is lost, testing duplicate prevention and reconciliation.
- The budget service becomes unavailable before a consequential action, testing the host's configured failure behavior.
- A child attempts to exceed its scope or delegation limit.
- An operator blocks new actions while some work is already in flight.

Keep the configured policy, submitted scope, reservation outcome, and tool result correlated so reviewers can reconstruct what happened. Include denied attempts in that evidence. A denial without an observed tool execution is a useful result to verify.

Stopping new reservations does not cancel every operation already authorized or reverse a completed side effect. Incident exercises should establish that boundary explicitly.

For Cycles, the relevant engineering principle is concrete: **expand agent authority at the pace at which you can demonstrate control over its use.** Runtime budgets and action boundaries support that practice within instrumented systems. They do not establish model alignment or resolve the broader questions of frontier development.

## Resources

- Read Dario Amodei's [*We Must Pace the Frontier*](https://darioamodei.com/post/we-must-pace-the-frontier) for the frontier governance argument.
- Use the [AI Agent Risk & Blast Radius Reference](/guides/risk-and-blast-radius) to plan application enforcement boundaries.
