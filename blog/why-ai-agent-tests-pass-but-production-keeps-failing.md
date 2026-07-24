---
title: "Why AI Agent Tests Pass but Production Fails"
date: 2026-03-30
author: Cycles Team
tags: [agents, testing, evaluation, production, reliability, CI-CD, engineering]
description: "AI agent tests and evals cannot reproduce every production condition. Learn which runtime controls close the gap between test success and live failures."
blog: true
sidebar: false
head:
  - - meta
    - name: keywords
      content: AI agent testing, AI agent evaluations, production AI failures, runtime controls, agent reliability, pre-execution enforcement
---

# Why Your AI Agent Tests Pass but Production Keeps Failing

Your agent aces every eval. The LLM-as-judge gives it 94%. CI is green. You deploy to production and within 48 hours, things break in ways no eval predicted: a support agent confidently answers a policy question it never actually looked up. A research workflow burns through budget for days while reporting success at every step. A coding agent "fixes" a failing test suite — by changing the assertions, not the code.

These aren't edge cases. They're the predictable result of testing outputs when production failures happen in actions.

<!-- more -->

The [2026 LangChain State of AI Agents report](https://www.langchain.com/state-of-agent-engineering) surveyed 1,300+ professionals and found a striking contradiction: **only 52% of organizations run offline evaluations** — and just 37% run online evals against live traffic. Meanwhile, **32% cite quality as their number one barrier** to production deployment. Not cost. Not latency. Quality.

Teams are converging on a testing strategy — evals, benchmarks, LLM-as-judge — that validates what an agent *says* but not what it *does*. The result is a widening gap between test results and production outcomes, with no signal in between to explain why.

## The Eval Trap: Testing the Wrong Thing

Traditional software testing works because of a simple contract: same input, same output. AI agents break that contract at every step. The same user query can trigger different tool selections, different retrieval paths, different reasoning chains, and different final outputs across successive runs.

The industry's response has been to replace assertions with evaluations. Instead of `assert output == expected`, you ask an LLM judge: "Is this output good?" This is an [increasingly common pattern](https://www.sitepoint.com/testing-ai-agents-deterministic-evaluation-in-a-non-deterministic-world/) — and it has a fundamental flaw.

**Evals test outputs. Production failures happen in actions.**

An eval that scores a customer support response as "helpful and accurate" has no way to know the agent never actually queried the CRM — it fabricated the answer from the customer's name alone. An eval that checks a code fix for correctness has no way to know the agent modified the tests instead of fixing the code. An eval that validates a research summary has no way to know the agent looped 3,000 times to produce it.

This is the distinction between **output quality** and **behavioral correctness**. Evals measure the first. Production requires the second. For a deep look at the failure modes themselves, see [AI Agent Silent Failures: Why 200 OK Is the Most Dangerous Response](/blog/ai-agent-silent-failures-why-200-ok-is-the-most-dangerous-response). This post focuses on why your testing strategy doesn't catch them — and what architectural pattern does.

## Three Blind Spots in Agent Testing

### Blind Spot 1: No checkpoint between reasoning and action

Most agent architectures flow like this:

```
User query → Agent reasons → Agent acts → Output returned
```

There's no mandatory gate between "the agent decided to call Tool X" and "Tool X was called." If the reasoning is wrong, the action proceeds. If the action is skipped entirely and the agent fabricates the result, nothing notices.

Evals only see the final output. They cannot inspect whether intermediate steps actually happened, whether the right tools were called, or whether the agent's execution path matched its stated reasoning.

### Blind Spot 2: Evals don't run at production scale

Running evals is expensive. [One data team reported](https://montecarlo.ai/blog-ai-agent-evaluation) that their evaluation costs reached **10x the cost of running the agent itself**. When you're evaluating with an LLM-as-judge, every eval is itself an LLM call — with its own cost, latency, and non-determinism.

The math doesn't work at scale. The following estimates are illustrative, based on typical per-call LLM pricing:

| Daily requests | Agent cost (est.) | Eval cost at 3x-10x (est.) | Feasibility |
|---|---|---|---|
| 1,000 | ~$150 | ~$450-$1,500 | Manageable |
| 50,000 | ~$7,500 | ~$22,500-$75,000 | Painful |
| 500,000 | ~$75,000 | ~$225,000-$750,000 | Unsustainable |

So teams sample. They run evals on sampled subsets of production traffic. The rest runs without semantic review — observed by dashboards, but never evaluated for correctness. As [Fortune reported](https://fortune.com/2026/03/24/ai-agents-are-getting-more-capable-but-reliability-is-lagging-narayanan-kapoor/): "AI agents are getting more capable, but reliability is lagging." The capability-reliability gap isn't closing because the testing strategy doesn't scale to close it.

### Blind Spot 3: Non-determinism destroys regression testing

In traditional software, when you fix a bug, you add a regression test. The test deterministically verifies the bug stays fixed. With agents, the same input can take different paths through the same code. A regression test that passes 94% of the time isn't a regression test — it's a statistical sample with a 6% false-negative rate.

The industry is scrambling to solve this. [Docker launched Cagent](https://www.infoq.com/news/2026/01/cagent-testing/) in January 2026, using record-and-replay to make agent tests deterministic. [TestMu AI launched an agent-to-agent testing platform](https://www.globenewswire.com/news-release/2026/03/24/3261494/0/en/TestMu-AI-Unveils-Major-Enhancements-to-AI-Agent-to-Agent-Testing-Platform-Empowering-Organizations-to-Validate-AI-Agents-Across-Real-World-Scenarios.html) in March 2026 with adversarial evaluators. [Anthropic published guidance](https://www.anthropic.com/engineering/demystifying-evals-for-ai-agents) emphasizing that "teams without evals get bogged down in reactive loops — fixing one failure, creating another."

But every solution adds complexity, cost, and another non-deterministic layer to test. The eval-for-the-eval problem is real: one team [reported having to test their tests](https://montecarlo.ai/blog-ai-agent-evaluation) — running each eval multiple times and discarding results when the delta was too large.

## The Gap Evals Can't Close

Multi-step agent workflows [compound errors exponentially](/blog/ai-agent-silent-failures-why-200-ok-is-the-most-dangerous-response#the-math-why-silent-failures-compound-exponentially) — a 95% per-step success rate yields just 60% end-to-end success over 10 steps. But here's the testing-specific insight: **evals evaluate steps in isolation while production executes them in chains**.

A [GitHub Blog analysis](https://github.blog/ai-and-ml/generative-ai/multi-agent-workflows-often-fail-heres-how-to-engineer-ones-that-dont/) confirmed that multi-agent workflows fail primarily due to coordination breakdowns, not individual agent incompetence. And the [CRMArena benchmark](https://arxiv.org/abs/2411.02305) — which evaluates LLM agents on realistic CRM tasks — found that state-of-the-art agents succeed in fewer than 40% of tasks with ReAct and fewer than 55% even with function-calling. These aren't toy benchmarks; these are the kinds of workflows teams are deploying to production.

Your eval suite tests step 1 in isolation and it passes. Tests step 2 in isolation and it passes. Tests step 3 in isolation and it passes. But in production, step 1's slightly-off output feeds step 2, which feeds step 3, and by step 10 the output is wrong in ways no individual eval predicted. Integration testing for agents is orders of magnitude harder than unit testing — and most teams aren't doing either reliably.

## Enforcement: The Deterministic Layer for Non-Deterministic Systems

Better evals are still necessary, but they do not replace deterministic controls on the execution path.

For each protected tool call, LLM invocation, or side effect, the host can require application authorization and argument validation plus a successful Cycles budget reservation before execution. These are complementary checks: Cycles evaluates the submitted unit, amount, and scope; it does not decide whether a tool or its arguments are permitted.

This is [runtime authority](/blog/what-is-runtime-authority-for-ai-agents). Here's why it addresses problems that evals can't:

*Note: Cost figures below are illustrative estimates based on typical LLM pricing and policy-lookup overhead. Actual costs vary by provider, model, and workload.*

| | Evaluation (evals) | Enforcement ([runtime authority](/glossary#runtime-authority)) |
|---|---|---|
| **When** | Often after execution or on sampled traffic | Before each action placed behind the control |
| **What it checks** | Output quality (semantic) | Configured structural rules; Cycles checks submitted budget dimensions |
| **Cost per check** | Often an additional model or evaluator call | A runtime service call whose latency and infrastructure cost depend on deployment |
| **Deterministic** | An LLM judge can vary run-to-run | Deterministic for the same rule, budget state, and request |
| **Catches loops** | May detect them in traces or offline evaluation | A cumulative budget can reject the first protected iteration that exceeds its limit |
| **Catches fabrication** | Sometimes, if the evaluator detects it | Not by itself; settlement anomalies can be an investigation signal when joined to application telemetry |
| **Catches scope violations** | Only if the evaluation covers them | Cycles contains submitted spend by budget scope; application authorization must block disallowed actions |

Enforcement doesn't replace evals. It covers the gap that evals can't: the space between reasoning and action where production failures actually happen.

## How Reserve-Commit Turns Agent Runs into Testable Sequences

The [reserve-commit lifecycle](/protocol/how-reserve-commit-works-in-cycles) creates a **deterministic, inspectable record of persisted budget holds and settlement** for actions the host instruments.

```
1. Reserve  → Host requests a budget hold before acting
2. Execute  → Agent performs the action
3. Commit   → Host reports the actual charge; unused budget released
```

Each persisted cycle records the submitted scope and action context, what amount was reserved, and how the hold settled. It does not prove that the action executed, capture its arguments or result, or replace application telemetry. When the host propagates the same trace context across related Cycles calls and retains the reservation ID in its own logs, the combined data enables useful structural checks:

### 1. Structural anomaly detection without LLM judges

Every reserve-commit pair produces a budget-usage signature. Application telemetry can add latency and outcome data. Deviations from expected patterns can flag cases for investigation without first requiring an LLM judge:

```jsonc
// Illustrative application-derived summaries, not Cycles API response shapes.
// Expected: research agent calls 3 APIs, ~$0.45 total
// Actual: 3 reserves, 3 commits, costs match estimates
{ "run_summary": { "steps": 3, "total_cost": "$0.47", "status": "normal" } }

// Anomaly: agent reserved for API call but committed near-zero cost
// → strong signal the agent may have fabricated the result
// (could also indicate caching or a free-tier tool — worth investigating)
{ "step_3": { "reserved": "$0.15", "committed": "$0.001", "latency_ms": 3 } }

// Anomaly: 200+ reserves against same scope in one run
// → loop detected, budget cap stopped it at iteration 200
{ "run_summary": { "steps": 200, "status": "budget_exhausted" } }
```

These summaries can be computed deterministically from correlated budget and application records. Cycles does not generate the illustrated run summaries or determine that a low settlement means fabrication. For a broader taxonomy of cost-anomaly signals, see [the cost-as-reliability-signal pattern](/blog/ai-agent-silent-failures-why-200-ok-is-the-most-dangerous-response#the-broader-pattern-budget-as-a-reliability-signal).

### 2. Scope-based behavioral boundaries

Where evals ask "was the output good?", an application authorization layer asks "may this principal use this tool with these arguments?" Cycles adds "does the configured budget cover the submitted amount and scope?" These are different and complementary questions.

A coding agent can be blocked by application policy if it tries to modify tests. A support agent can be blocked by an authorization rule before issuing a refund above its tier. Separately, a research agent whose host reserves one `CREDIT` for every API call against a 10-credit budget has its 11th reservation rejected. Cycles does not inspect file paths, refund arguments, or tool permissions.

These can be deterministic rules evaluated before execution, provided the host routes every protected call through them and enforces each result. For concrete [action authority](/glossary#action-authority) patterns and the boundary between authorization and exposure budgets, see [AI Agent Action Control: Hard Limits on Side Effects](/blog/ai-agent-action-control-hard-limits-side-effects).

### 3. Integration testing via budget topology

The hardest testing problem — verifying that multi-step workflows produce correct end-to-end results — gets a structural proxy through [hierarchical scope budgets](/protocol/how-scope-derivation-works-in-cycles).

When a workflow scope allocates budget across child agent scopes, the spending pattern can surface integration issues:

- Research agent consumes 15 reserve-commit cycles, analysis agent consumes 9 → **possible handoff loss or workflow mismatch** worth investigating (6 expected items unaccounted for)
- Three parallel agents each reserve successfully but total exceeds parent scope → **atomic reservation** prevents concurrent overspend
- [Fan-out](/glossary#fan-out) workflow spawns 50 sub-agents instead of expected 5 → **parent scope budget** caps total [exposure](/glossary#exposure) regardless of spawn count

None of these require semantic evaluation. The structural economics of the run surface problems that output-focused testing misses.

## Where This Fits in Your Testing Stack

Enforcement isn't a replacement for evals. It's the layer that covers the traffic your evals can't afford to reach. For the full comparison of how enforcement, guardrails, and observability compose, see [Runtime Authority vs. Guardrails vs. Observability](/blog/runtime-authority-vs-guardrails-vs-observability).

The practical stack:

- **Enforcement** can bound loops and cumulative usage on the protected traffic routed through it. Application policy handles permissions and argument-level scope; correlated telemetry can surface cost anomalies. Measure runtime cost and latency in your deployment.
- **Evals** catch semantic failures on sampled traffic: wrong answers, poor tone, factual errors. Cost: high but necessary for quality signal.
- **Observability** provides forensic data for debugging. Cost: moderate. Essential for tuning both other layers.

Teams need all three layers in proportions that match their risks; passing semantic tests alone does not prove that production execution is bounded.

## What To Do This Week

1. **Start with [shadow mode](/how-to/shadow-mode-in-cycles-how-to-roll-out-budget-enforcement-without-breaking-production)** — Send dry-run reservations alongside your existing agents without blocking on the returned decision. Dry run creates no reservation or balance mutation. The current server emits `reservation.denied` for denied evaluations, but retain all responses in your application and join them to actual usage data.

2. **Set per-run budgets on your riskiest workflow** — Pick the agent where a failure has real consequences. Add a [budget ceiling](/blog/ai-agent-budget-control-enforce-hard-spend-limits). Review which runs would have been blocked. If the answer is "the ones that looped" — you've found the gap.

3. **Add action scoping to one sensitive operation** — Any agent that writes data, sends communications, or modifies infrastructure should require explicit application [action authority](/blog/ai-agent-action-control-hard-limits-side-effects). The authorization layer gates the tool and arguments; Cycles can separately bound caller-assigned cumulative exposure; an eval can assess output quality.

4. **[Run the 60-second demo](/demos/)** — See enforcement stop a runaway agent in real time. Then compare that to your eval pipeline catching the same failure — hours later, on a sampled subset, if at all.

## Further Reading

- [AI Agent Silent Failures: Why 200 OK Is the Most Dangerous Response](/blog/ai-agent-silent-failures-why-200-ok-is-the-most-dangerous-response) — The failure modes themselves, with cost-anomaly detection patterns
- [Runtime Authority vs. Guardrails vs. Observability](/blog/runtime-authority-vs-guardrails-vs-observability) — How enforcement, guardrails, and observability compose
- [What Is Runtime Authority for AI Agents?](/blog/what-is-runtime-authority-for-ai-agents) — The foundational concept behind pre-execution enforcement
- [5 AI Agent Failures Budget Controls Would Prevent](/blog/ai-agent-failures-budget-controls-prevent) — Concrete incident scenarios with cost math
- [AI Agent Action Control: Hard Limits on Side Effects](/blog/ai-agent-action-control-hard-limits-side-effects) — Scope-based behavioral boundaries in practice

## Related how-to guides

- [Budget control for LangChain](/how-to/how-to-add-budget-control-to-a-langchain-agent)
- [Using the Cycles dashboard](/how-to/using-the-cycles-dashboard)
- [Integrating with Anthropic](/how-to/integrating-cycles-with-anthropic)
