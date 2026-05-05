---
title: "Debugging Sudden LLM Cost Spikes: A Diagnostic Guide"
description: "How to find the root cause of an unexpected LLM bill — agent loops, prompt regressions, model upgrades, retry storms, and tenant leakage — and how to prevent the next one."
---

# Debugging Sudden LLM Cost Spikes: A Diagnostic Guide

A diagnostic playbook for the moment a finance email arrives or a billing dashboard alarm fires saying your LLM spend has 5×'d overnight.

> **Quantify your potential spike before it happens:** [Cost Calculator →](/calculators/claude-vs-gpt-cost-standalone) — model your worst-case input/output × call rate against current Claude and GPT pricing. The number it surfaces is what an unbounded retry-loop or tenant-leak workload would actually cost you per month.

## TL;DR

Most sudden LLM cost spikes fall into six buckets: a runaway agent loop, a prompt regression that ballooned token counts, an unintended model upgrade, a retry storm amplifying transient errors, a single noisy tenant on a shared budget, or a leaked API key. Other causes show up too — pricing changes, duplicated logging or evaluation runs, failed caching, vector-ingestion jobs, or new traffic sources — but the diagnostic flow is the same. Bucket spend by tenant, by model, by endpoint, by hour. Fix the immediate cause, then put a hard pre-execution budget cap in place so the next spike cannot happen at all.

## What this looks like

You see one or more of the following:

- An OpenAI / Anthropic / Bedrock dashboard chart that climbs near-vertically over a few hours
- A daily-spend alert from your finance system threshold-fired
- A budget alert from your monitoring stack
- A user-reported degradation that turns out to be rate-limit-induced backpressure from over-spend

The financial damage compounds while you investigate, so the diagnostic loop has to be fast.

## Common causes

- **Runaway agent loop.** An agent calls a tool, gets a response, decides it needs to call again, and never converges. Common with tool-use agents, ReAct loops, and code-writing agents that hit a transient compile error and retry forever.
- **Prompt regression.** Someone edited a system prompt or template, and now every request includes a 5K-token preamble it did not include before. Token volume per call doubles silently.
- **Unintended model upgrade.** A code change moved from a small/mini model to a flagship model, or from Claude Sonnet to Claude Opus. Per-token cost jumps materially; bill follows.
- **Retry storm.** A transient provider error caused application-level retries that did not back off, or that retried inside an outer retry loop. Each failed call still bills for the input tokens that were sent.
- **Noisy tenant on shared budget.** Multi-tenant SaaS without per-tenant caps: one customer kicks off a workload that consumes the entire shared quota, and your bill scales with their usage.
- **Leaked API key.** A key committed to a public repo, found by a credential scanner, and used by an attacker to burn quota, proxy traffic, or run unauthorized workloads on your account. Rare but devastating; usually presents as 24/7 sustained max-throughput usage.

## How to diagnose it

1. **Pull the per-hour spend curve and identify the inflection point.** When did the spike start? Is it ongoing, or has it plateaued / decayed? A cliff edge usually means a deploy or config change at that timestamp.

2. **Bucket spend by model.** A jump in `gpt-4o` or `claude-opus` calls when you do not expect those models is the model-upgrade signal. Cross-check with recent deploys.

3. **Bucket spend by endpoint or workflow.** If your application reports `endpoint` or `workflow_id` to the LLM provider as metadata, group by that. The single workflow contributing 90% of the spike is your culprit.

4. **Bucket spend by tenant or user, if you have multi-tenancy.** A single tenant accounting for 80%+ of new spend is a tenant-isolation failure or a runaway agent for one customer.

5. **Look at average tokens per call before and after the spike.** A 5× jump in average prompt size is a prompt regression. A 5× jump in output tokens with the same prompt size is a model that decided to write more (often after a model version change).

6. **Check retry rates and 4xx/5xx counts.** A spike in 429s, 500s, or 529s correlated with the cost spike is a retry storm. Look at retry budgets in your client.

7. **Inspect agent traces for loops.** If you have observability on tool calls, look for the same tool being invoked >10 times in a single run with similar arguments. That is the agent-loop signature.

8. **Check API key audit logs.** Unusual geographic source IPs, 24/7 sustained traffic, or calls outside business hours from a key tied to interactive workloads is a credential leak.

## How to fix it (in the moment)

1. **If you cannot rule out credential leakage quickly, revoke and rotate the affected keys.** If the spike is clearly tied to a specific workflow, tenant, or recent deploy, contain that narrower scope first — blanket key rotation can cause a wider outage than the incident itself.
2. **If you found a runaway agent: kill the workflow.** Most platforms expose a kill-by-workflow-id or kill-by-user mechanism — use it.
3. **If you found a prompt regression: revert the deploy.** A revert is faster than a forward fix when money is hemorrhaging.
4. **If you found a noisy tenant: throttle that tenant immediately.** A temporary block at the application layer is fine; you can do it more cleanly later.
5. **If you found a model upgrade: revert the model selection** and verify the regression on a small sample before redeploying.
6. **If you found a retry storm: deploy backoff fixes and a circuit breaker** before reverting. Just stopping retries restores the baseline.

## How to prevent it permanently

Diagnosis after the fact is reactive. The class of problem is "the application emitted spend that the operator did not authorize." That class has one structural fix: **do not let calls happen unless they are pre-authorized against a budget**. Every other layer (alerts, dashboards, post-hoc cost attribution) sits downstream of money already spent.

- **Pre-execution gating.** Before any LLM call leaves the application, check whether the caller (agent, workflow, tenant) has remaining budget. If not, deny the call. The runaway-agent scenario goes from a five-figure incident to "the agent got `BUDGET_EXCEEDED` on its 41st loop and stopped." See [Why Cycles for Cost Control](/why-cycles/cost-control).
- **Per-tenant budgets.** A noisy tenant cannot consume cross-tenant headroom because their own ledger is exhausted. Other tenants are unaffected. See [Multi-tenant SaaS guide](/how-to/multi-tenant-saas-with-cycles).
- **Per-action authority.** Cap not just total spend but per-call cost (e.g., max input tokens, max output tokens, allowed models). Prevents the model-upgrade regression by *policy* — code that asks for a model not on the allow-list is denied. See [Action authority](/concepts/action-authority-controlling-what-agents-do).
- **Atomic reservations.** Solves the concurrent-agent case where ten parallel runs all believe there is enough budget. See [Concurrent agent overspend](/incidents/concurrent-agent-overspend).
- **Run-level budgets.** Each agent run gets a fixed per-run budget. Loops self-terminate when the budget is exhausted, even if the per-tenant budget is fine. See [How to model tenant, workflow, and run budgets](/how-to/how-to-model-tenant-workflow-and-run-budgets-in-cycles).

A reactive cost-spike playbook is necessary. A reactive *only* posture is not — the fix is structurally eliminating the class.

## Related

- [Runaway agents and tool loops](/incidents/runaway-agents-tool-loops-and-budget-overruns-the-incidents-cycles-is-designed-to-prevent) — the canonical incident pattern
- [Retry storms and idempotency failures](/incidents/retry-storms-and-idempotency-failures) — when retries amplify the bill
- [From observability to enforcement](/concepts/from-observability-to-enforcement-how-teams-evolve-from-dashboards-to-budget-authority) — why dashboards alone are not enough
- [Cycles vs Helicone](/concepts/cycles-vs-helicone) — observability vs enforcement, by the numbers
- [Real-time budget alerts for AI agents](/blog/real-time-budget-alerts-for-ai-agents) — why alerts ride downstream of the structural fix
