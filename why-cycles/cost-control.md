---
title: "Stop Agents from Burning Your API Budget Overnight"
description: "An illustrative coding-agent loop runs 240 iterations and costs $52.80 at stated token rates. A $15 budget rejects a protected call around iteration 68."
---

# Stop Agents from Burning Your API Budget Overnight

In an [illustrative coding-agent scenario](/blog/ai-agent-failures-budget-controls-prevent), an ambiguous error leads to 240 iterations over three hours. At the stated flat averages and model rates, the loop costs $52.80.

The model pricing was exactly right. The call volume was not.

## Why existing controls didn't help

**Provider cost controls** vary across soft project budgets, prepaid credits, account limits, and throughput quotas. They can isolate traffic when you assign separate provider identities, but a shared project or key does not infer your production run, staging test, or application tenant.

**Rate limits** control how fast, not how much. The agent stayed within its requests-per-second limit. It was making perfectly well-formed API calls. Just 240 of them.

**Observability dashboards** showed the spike — the next morning. The cost graph was a vertical line at 2 AM. Useful for the post-mortem. Useless for prevention.

## How Cycles fixes it

```python
from runcycles import cycles

@cycles(estimate=2_000_000, action_kind="llm.completion", action_name="gpt-4o")
def call_llm(prompt: str) -> str:
    return openai.chat.completions.create(
        model="gpt-4o",
        messages=[{"role": "user", "content": prompt}],
    ).choices[0].message.content
```

For this decorated function, the wrapper reserves budget before invoking the model. If the live reservation fails for insufficient budget, it raises `BudgetExceededError` and does not call the wrapped model. Other call paths remain unprotected unless they use the same mandatory boundary.

Under the source scenario's flat-average assumptions, a $15 workflow ledger keyed to that run rejects a protected call around iteration 68. The host can surface: "Budget exhausted. This task needs human review."

## What happens now

- **Budget checked before every decorated call.** The wrapped model call does not execute when its live reservation fails; complete path coverage, estimate accuracy, settlement, and overage policy still matter.
- **Graceful degradation, not a crash.** The agent can catch `BudgetExceededError` and wind down: summarize progress, switch to a cheaper model, or queue the task for later.
- **Run-scope isolation.** If the application provisions distinct budget subjects for each run and routes every protected call correctly, a runaway in run #47 cannot consume run #48's allocation.
- **The configured bound surfaces sooner.** A $15 limit rejects a later protected call instead of allowing all 240 modeled iterations.

## The math

| | Without Cycles | With Cycles ($15/run cap) |
|---|---|---|
| Agent loops | 240 | About 68 under flat-average assumptions |
| Cost | $52.80 | Near $15, subject to estimates and settlement |
| Time to detect | Next morning | Immediately |
| Impact on other agents | Depends on the shared provider cap | Contained when scopes and routing are configured correctly |
| Recovery action | Post-mortem and budget reset | Fix the prompt |

## Now run the numbers for your workload

The calculator below is pre-seeded with a separate, larger-context retry-loop profile — 200K input tokens and 10K output tokens per call, 240 calls. It is not the source scenario's input. Adjust the tokens, call count, and model rates to match your workload. Click **Share** to send the configured view to a teammate, or **PNG** for an artifact you can paste into a deck.

<CostCalculator initial-state="eyJ3b3JrbG9hZE5hbWUiOiJDb2RpbmcgYWdlbnQgKHJldHJ5LWxvb3AgcnVuYXdheSkiLCJ3b3JrbG9hZERlc2NyaXB0aW9uIjoiSGl0IGFuIGFtYmlndW91cyBlcnJvciBhbmQgcmV0cmllZCB3aXRoIGV4cGFuZGluZyBjb250ZXh0LiBCeSB0aGUgdGltZSBzb21lb25lIGNhdWdodCBpdCwgZWFjaCBjYWxsIGNhcnJpZWQgfjIwMEsgaW5wdXQgdG9rZW5zLiIsImlucHV0VG9rZW5zIjoyMDAwMDAsIm91dHB1dFRva2VucyI6MTAwMDAsImNhbGxzUGVyRGF5IjoyNDB9" />

## Go deeper

- **[LLM Cost Runtime Control Reference](/guides/llm-cost-runtime-control)** — the full topic guide: incident taxonomy, runtime authority patterns, multi-tenant isolation, unit economics, and rollout
- [End-to-End Tutorial](/quickstart/end-to-end-tutorial) — zero to budget-guarded LLM call in 10 minutes
- [Cost Estimation Cheat Sheet](/how-to/cost-estimation-cheat-sheet) — how much to reserve per model
- [Degradation Paths](/how-to/how-to-think-about-degradation-paths-in-cycles-deny-downgrade-disable-or-defer) — what to do when budget runs out
- [5 Agent Cost Failures Runtime Budgets Can Bound](/blog/ai-agent-failures-budget-controls-prevent) — illustrative scenarios with checked dollar math
- [Why Rate Limits Are Not Enough](/concepts/why-rate-limits-are-not-enough-for-autonomous-systems) — the deeper argument
