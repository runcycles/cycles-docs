---
title: "Stop Agents from Burning Your API Budget Overnight"
description: "A coding agent hit an ambiguous error, retried with expanding context windows, and looped 240 times. Total cost: $4,200. With Cycles, the same agent stops at $15."
---

# Stop Agents from Burning Your API Budget Overnight

A coding agent hit an ambiguous error. It retried with an expanding context window. Each retry cost more than the last. By the time someone checked the dashboard the next morning, the agent had looped [240 times and spent $4,200](/blog/ai-agent-failures-budget-controls-prevent).

The model pricing was exactly right. The call volume was not.

## Why existing controls didn't help

**Provider spending caps** are typically monthly and org-wide. They don't distinguish between your production agent and your staging test. By the time the monthly cap kicks in, the damage is done — and it blocks every other agent on the account too.

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

That's it. Before every LLM call, the `@cycles` decorator reserves budget. If the budget is exhausted, `BudgetExceededError` is raised and the model is never called. No tokens consumed. No cost incurred.

The same agent with a $15 per-run budget stops after 8 iterations and surfaces the problem immediately: "Budget exhausted. This task needs human review."

## What happens now

- **Budget checked before every call.** The agent can't overspend — the reservation is denied before the API call executes.
- **Graceful degradation, not a crash.** The agent can catch `BudgetExceededError` and wind down: summarize progress, switch to a cheaper model, or queue the task for later.
- **Per-run isolation.** Each agent run has its own budget. A runaway in run #47 can't affect run #48 or another customer's allocation.
- **You find out at $15, not $4,200.** The budget limit surfaces the problem immediately instead of letting it compound overnight.

## The math

| | Without Cycles | With Cycles ($15/run cap) |
|---|---|---|
| Agent loops | 240 | 8 |
| Cost | $4,200 | $15 |
| Time to detect | Next morning | Immediately |
| Impact on other agents | All blocked by provider cap | None — per-run isolation |
| Recovery action | Post-mortem and budget reset | Fix the prompt |

## Now run the numbers for your workload

The calculator below is pre-seeded with a *similar* retry-loop profile — 200K input tokens per call by the time someone notices, 240 calls. The exact $4,200 in the story above depends on context-window growth across retries that no static calculator captures perfectly; the **shape** of the cost curve is what the budget gate actually bounds. Adjust the input/output tokens, calls/day, and model rates to match your own incident. Click **Share** to send the configured view to a teammate, or **PNG** for an artifact you can paste into a deck.

<CostCalculator initial-state="eyJ3b3JrbG9hZE5hbWUiOiJDb2RpbmcgYWdlbnQgKHJldHJ5LWxvb3AgcnVuYXdheSkiLCJ3b3JrbG9hZERlc2NyaXB0aW9uIjoiSGl0IGFuIGFtYmlndW91cyBlcnJvciBhbmQgcmV0cmllZCB3aXRoIGV4cGFuZGluZyBjb250ZXh0LiBCeSB0aGUgdGltZSBzb21lb25lIGNhdWdodCBpdCwgZWFjaCBjYWxsIGNhcnJpZWQgfjIwMEsgaW5wdXQgdG9rZW5zLiIsImlucHV0VG9rZW5zIjoyMDAwMDAsIm91dHB1dFRva2VucyI6MTAwMDAsImNhbGxzUGVyRGF5IjoyNDB9" />

## Go deeper

- **[LLM Cost Runtime Control Reference](/guides/llm-cost-runtime-control)** — the full topic guide: incident taxonomy, runtime authority patterns, multi-tenant isolation, unit economics, and rollout
- [End-to-End Tutorial](/quickstart/end-to-end-tutorial) — zero to budget-guarded LLM call in 10 minutes
- [Cost Estimation Cheat Sheet](/how-to/cost-estimation-cheat-sheet) — how much to reserve per model
- [Degradation Paths](/how-to/how-to-think-about-degradation-paths-in-cycles-deny-downgrade-disable-or-defer) — what to do when budget runs out
- [5 Failures Budget Controls Would Prevent](/blog/ai-agent-failures-budget-controls-prevent) — more incidents with dollar math
- [Why Rate Limits Are Not Enough](/concepts/why-rate-limits-are-not-enough-for-autonomous-systems) — the deeper argument
