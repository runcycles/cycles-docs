---
title: "Portable Agent Skills Need Runtime Budget Tests"
date: 2026-10-23
author: Albert Mavashev
tags: [agents, budgets, governance, runtime-authority, testing, production]
description: "Test agent skill budgets across CLI and cloud runtimes. Use a shared task ledger, concurrent admission checks, and a runnable Cycles budget portability drill."
blog: true
sidebar: false
featured: false
head:
  - - meta
    - name: keywords
      content: agent skills, agent skill portability, AI agent budget tests, runtime budget enforcement, shared task budget, SKILL.md, Cycles
---

# Portable Agent Skills Need Runtime Budget Tests

A support team approves a triage skill for a customer batch with a ten-cent allowance. A developer starts it in a CLI. Later, a scheduled cloud worker continues the same task. The migration copies the skill but creates a fresh budget under the worker's session ID.

Each environment respects its own limit. Together, they can spend more than the allowance the team approved.

This is a hypothetical deployment error, not a reported vulnerability in a particular agent platform. It is also testable: charge some work in the first environment, move the task, and check whether the next operation sees the reduced balance.

A skill-portability test should verify that the intended budget survives a change of executor. It should also show that concurrent workers cannot each claim the same remaining capacity. This post provides an acceptance checklist and a small drill against a real Cycles ledger.

<!-- more -->

## Why agent skill portability needs budget tests

On October 22, 2026, Anthropic [donated Agent Skills to the Agentic AI Foundation](https://www.anthropic.com/news/donating-agent-skills-to-the-agentic-ai-foundation), reporting integration across more than 70 agent platforms. A reusable skill can now reach several execution environments within one organization.

The [Agent Skills specification](https://agentskills.io/specification) defines a directory containing `SKILL.md`, with optional scripts, references, and other resources. Its `allowed-tools` field is experimental, and support can vary between implementations. Loading the package therefore does not establish how a particular host will mediate every operation it can perform.

Host controls deserve their own evaluation. Google's [October 8 Gemini agent announcement](https://cloud.google.com/blog/products/ai-machine-learning/welcome-to-gemini-at-work-2026), for example, describes identity and permission controls alongside real-time spend caps. Use platform-native controls where they cover the intended workload. Verify their scope, concurrency behavior, and treatment of external operations before adding another enforcement layer.

The earlier [skill supply-chain discussion](/blog/agent-skills-are-the-new-supply-chain) covers provenance and installation trust. Here the question is operational: does the reviewed skill retain its intended allowance after deployment, migration, or delegation?

## Define the task budget outside the skill

Start with the business task. A support batch, research request, or migration job can outlive a model session and move between workers. Give that task a stable identity in trusted orchestration state.

For this drill, the host maps that identity to a Cycles `workflow` subject and provisions a budget at `tenant:<tenant>/workflow:<task>`. Both execution adapters submit the same [tenant](/glossary#tenant) and workflow. Their runtime names belong in logs; changing a runtime name must not create another allowance. The [budget patterns guide](/how-to/common-budget-patterns) explains the available scope choices.

Write down the deployment contract:

| Property | What the host must establish |
|---|---|
| Task identity | Which business task owns the operation, including after handoff. |
| Budget scope | The provisioned ledger and relevant ancestor budgets. |
| Metered work | Which model, tool, or external-service operations consume the allowance. |
| Estimate and actual usage | How admission is sized and how settlement obtains authoritative usage. |
| Permissions | Which resources, destinations, and operations the executor may use. |
| Failure behavior | What happens on refusal, unavailable authority, or an uncertain downstream outcome. |

These are application requirements, not new Agent Skills frontmatter fields. A skill description saying “spend at most ten cents” is useful instruction, but the executor must bind calls to the appropriate ledger. Do not let model-supplied arguments choose an unfunded scope, switch tenants, or request another allocation.

Keep budget-writing credentials out of the execution process. A worker that can replenish its own allowance defeats the intended restriction. The host must also enforce resource and tool authorization separately. A financial [reservation](/glossary#reservation) does not authorize sending customer data to a new recipient.

## Five acceptance tests for a runtime migration

Use a fixed skill revision and record the runtime version, tool configuration, credential scope, and policy version for each test. Run them at the actual dispatch boundary, where you can count whether the protected operation executed.

| Test | Exercise | Acceptance evidence |
|---|---|---|
| Handoff | Spend $0.06 from a $0.10 task, then request another $0.06 from the new runtime. | The second operation is refused before dispatch; both adapters identify the same task ledger. |
| Concurrent workers | Have two workers reserve $0.06 each from a fresh $0.10 task before either settles. | Only one receives admission; the other handler never runs. |
| Restart after dispatch | Stop a worker after downstream execution but before it records successful settlement, then resume the task. | Recovery preserves the task and operation identities, reconciles the receipt, and does not blindly repeat the side effect. |
| Alternate execution path | Try the protected operation through an available shell, browser, script, or child worker. | That route is denied or has equivalent authorization and accounting; enumerate any uncovered paths. |
| Authority unavailable | Make the budget endpoint unreachable or return an error before admission. | The protected handler does not run. The application reports an unavailable control, rather than treating it as an empty or unlimited budget. |

The dollar values are synthetic fixtures. The restart test also requires application-level operation records and downstream replay protection. Cycles idempotency protects budget mutations within its retention rules; it cannot make an external email or payment execute exactly once. The [settlement recovery guide](/protocol/sdk-settlement-recovery-and-durability) describes the distinction between retrying known settlement and recovering missing usage evidence.

For alternate paths, a prompt-level instruction to use the wrapper is insufficient evidence. Credentials and network access must make the mediated route unavoidable for the claimed operations. The [denial-workaround guide](/blog/ai-agent-denial-workarounds) covers how to check another route after a tool refuses an action.

## Run the shared-task budget drill

The <a href="/examples/skill-budget-portability-drill.py" download>downloadable Python drill</a> exercises **handoff, concurrent admission, and an intentionally broken scope mapping**. It uses real Cycles reservations and balances, with synthetic tool calls. Two HTTP client fixtures stand in for CLI and cloud adapters; it does not load a skill into vendor runtimes or certify cross-platform compatibility.

The remaining acceptance tests require your application's persistence, credentials, and execution paths. Passing this ledger drill is preparation for those deployment tests.

The drill was verified against Cycles runtime `0.1.25.59` and Admin `0.1.25.55`. It requires a runtime that returns `remaining_ttl_ms`. Use Python 3.10 or later; the script uses only the standard library. Provision a disposable tenant using the [end-to-end tutorial](/quickstart/end-to-end-tutorial), then create separate setup and runtime keys. Give the tenant at least **$0.30 of available capacity**, with no competing traffic or caps. The complete drill commits $0.24 and leaves its four workflow budgets in place. Every new invocation needs fresh workflow budgets and additional tenant capacity.

| Variable | Used by | Value |
|---|---|---|
| `CYCLES_ADMIN_URL` | Setup | Admin API URL, such as `http://localhost:7979`. |
| `CYCLES_BUDGET_API_KEY` | Setup | Tenant key with `budgets:write`. |
| `CYCLES_TENANT` | Setup | Disposable tenant ID. |
| `CYCLES_BASE_URL` | Run | Runtime URL, such as `http://localhost:7878`. |
| `CYCLES_API_KEY` | Run | Separate tenant key with `reservations:create`, `reservations:commit`, and `balances:read`. |

In the setup environment, download the script and create the manifest:

```bash
python skill-budget-portability-drill.py setup skill-task.json
```

The manifest contains the tenant and generated workflow IDs, without credentials. Treat it as trusted deployment configuration. Pass it to a separate execution environment containing only the runtime URL and runtime key:

```bash
python skill-budget-portability-drill.py run skill-task.json
```

Do not grant the execution identity permission to rewrite its trusted task mapping or provision budgets. The sample's local JSON file is a convenient fixture, not a security boundary. Before dispatch, the script checks that the reservation's `affected_scopes` includes the workflow it submitted. Your deployment must additionally verify that the submitted workflow was the correct one for the authenticated task.

### Expected results

The two passing cases use the same task identity across adapters. The negative control deliberately assigns different workflow IDs to what should have been one business task.

| Case | Synthetic tool calls | Ledger result |
|---|---|---|
| Handoff | First adapter: 1; second: 0 | Shared ledger: $0.06 spent, $0.04 remaining. |
| Concurrent workers | One total; winner is nondeterministic | Shared ledger: $0.06 spent, $0.04 remaining. |
| Incorrect scope mapping | First adapter: 1; second: 1 | Two ledgers each spend $0.06, exceeding the intended shared $0.10 allowance in aggregate. |

All four workflow ledgers finish with zero reserved capacity. The negative control prints `DETECTED scope reset`; a successful drill means the test observed this deliberately introduced mapping error. It does not mean the broken mapping is safe. The ledger correctly enforced the two budgets it was given; the host supplied the wrong accounting boundary.

Inspect both the final balances and the dispatch counters. A system that performs an operation and then discards its result has not passed a pre-execution admission test.

### What the drill does not prove

This is a short, single-process exercise using 60-second leases, with no transport retries, durable journal, or heartbeat. It prints operation and reservation IDs for investigation. An unexpected response stops the drill; it does not automatically release uncertain holds or redispatch work. Do not rerun against the same spent ledgers. After an interruption, inspect the recorded IDs and dispose of the test tenant when finished.

The fixture requires `remaining_ttl_ms`, checks the lease before dispatch, and stops on `ALLOW_WITH_CAPS` because it has no implementation for applying returned constraints. Live budget exhaustion is HTTP `409 BUDGET_EXCEEDED`; it is not a successful reservation with `decision: DENY`.

The fixture estimate equals actual usage. Real model calls require bounded requests and defensible estimates; a `REJECT` commit policy cannot undo provider work that already exceeded its reservation. Likewise, expiry restores held capacity without canceling an external job. See the [background-jobs article](/blog/stopping-ai-agents-background-jobs) for that lifecycle boundary.

## Keep a portability acceptance record

For each target runtime, record the skill revision, trusted task mapping, enforcement boundary, observed dispatch count, ledger changes, and unresolved operations. Include the intentionally wrong mapping as a negative control: a test that cannot detect a second allowance offers weak evidence about budget portability.

Repeat the acceptance tests when the runtime, skill scripts, tools, credentials, or dispatch adapter change. Reusing the same Markdown does not establish that those other parts stayed equivalent.

A successful migration preserves a useful workflow and the limits under which the organization approved it. The evidence is the behavior of the deployed execution paths: what they admit, what they refuse, and what they record when an outcome remains uncertain.

## Resources

- [Agent Skills specification](https://agentskills.io/specification), checked October 23, 2026.
- [Cycles protocol YAML](https://github.com/runcycles/cycles-protocol/blob/a54b10778a97f9ae9478e363bf85fe166e5d2087/cycles-protocol-v0.yaml), the authority for reservation and balance semantics.
- <a href="/examples/skill-budget-portability-drill.py" download>Budget portability drill</a>, for a disposable test tenant.
