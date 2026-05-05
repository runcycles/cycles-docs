---
title: "Your AI Agent Just Burned $6 in 30 Seconds — Here's the Three-Line Fix"
date: 2026-03-26
author: Albert Mavashev
tags: [runaway-agents, demo, agents, runtime-authority, walkthrough, budget-enforcement, cost-control]
description: "A support bot with a quality-loop bug burns ~$6 in 30 seconds. Cycles stops it at exactly $1.00. Three decorators, one exception — zero code change to the agent logic."
blog: true
sidebar: false
---

# Your AI Agent Just Burned $6 in 30 Seconds — Here's the Three-Line Fix

> **Part of: [LLM Cost Runtime Control Reference](/guides/llm-cost-runtime-control)** — the full pillar covering causes, enforcement patterns, multi-tenant boundaries, and unit economics.

A customer support bot drafts a response, evaluates its quality, and refines it in a loop until the score exceeds 8.0. The bug: the quality evaluator never returns above 6.9. Without a budget boundary, the agent loops for 30 seconds — ~595 calls, ~$5.95 — before a safety timeout kills it. In production, there would be no timeout. With Cycles, the same agent stops cleanly at exactly $1.00 after ~100 calls. The [Cycles server](/glossary#cycles-server) returns `409 BUDGET_EXCEEDED`, the decorator raises an exception, and the agent exits gracefully. No call is wasted past the limit.

The LLM calls in this demo are simulated. No API key is required. The budget enforcement is real. This post walks through the [runaway demo](https://github.com/runcycles/cycles-runaway-demo) step by step: what the agent does, how the unguarded and guarded runs differ, and what the code change looks like.

> **Open the quality-loop scenario in the calculator:** [Open with these numbers pre-loaded →](/calculators/claude-vs-gpt-cost-standalone#s=eyJ3b3JrbG9hZE5hbWUiOiJTdXBwb3J0IGFnZW50IHdpdGggcXVhbGl0eS1sb29wIGJ1ZyIsIndvcmtsb2FkRGVzY3JpcHRpb24iOiJEcmFmdHMgYSByZXNwb25zZSwgZXZhbHVhdGVzIHF1YWxpdHksIHJlZmluZXMgdW50aWwgc2NvcmUgPjguIEJ1ZzogZXZhbHVhdG9yIG5ldmVyIHJldHVybnMgYWJvdmUgNi45LiB-MTAwIGNhbGxzIHBlciByZWZpbmVtZW50IGxvb3AuIiwiaW5wdXRUb2tlbnMiOjMwMDAsIm91dHB1dFRva2VucyI6ODAwLCJjYWxsc1BlckRheSI6NTAwfQ)

<!-- more -->

## The scenario

Customer case #4782: Acme Corp's invoice shows $847, but their contract says $720. A support bot (`support-bot`) picks up the case and enters a three-step refinement loop:

| Step | Function | What it does | Cost |
|:----:|----------|--------------|------|
| 1 | `draft_response` | Generates an initial reply from the ticket text | $0.01 |
| 2 | `evaluate_quality` | Scores the draft (0–10 scale) | $0.01 |
| 3 | `refine_response` | Rewrites the draft based on the score | $0.01 |

Steps 2 and 3 repeat until the quality score meets the 8.0 threshold. The bug is in the evaluator: it returns a random score between 5.5 and 6.9 — never above the threshold. The loop never terminates on its own. This is the [runaway agent loop pattern](/incidents/runaway-agents-tool-loops-and-budget-overruns-the-incidents-cycles-is-designed-to-prevent) — individually valid steps that accumulate into an unbounded cost incident.

Each simulated call takes 50ms and costs $0.01. With a real LLM at 500ms per call and $0.03–$0.12 per call, the same bug would burn through budget at ~$3.60/hour per stuck ticket — silently, continuously, and with no natural stopping point.

## Without Cycles: the agent loops until something external kills it

When the agent runs without Cycles, every call succeeds. The loop continues until the demo's 30-second safety timeout fires:

```
╭──────────── Live Counter ─────────────────────╮
│   Mode:  UNGUARDED                            │
│ Ticket:  #4782 — My invoice for March is...   │
│  Calls:  595                                  │
│  Spend:  $5.9500                              │
│Elapsed:  30.0s                                │
│   Last:  refine_response (score was 6.4)      │
╰───────────────────────────────────────────────╯

╭──────────── Budget Thresholds ────────────────╮
│   $0.10  ✓ passed at call 10 (29.5s ago)      │
│   $0.50  ✓ passed at call 50 (27.5s ago)      │
│   $1.00  ✓ passed at call 100 (25.0s ago)     │
│                                               │
│          $∞ No hard stop.                     │
╰───────────────────────────────────────────────╯

╭──────────── Final — UNGUARDED ────────────────╮
│ Result:   auto-stop after 30s                 │
│ Calls:    595                                 │
│ Spend:    $5.9500                             │
│ Duration: 30.0s                               │
│                                               │
│ In production: no hard stop existed.          │
│ Alert fires AFTER spend.                      │
╰───────────────────────────────────────────────╯
```

The agent did nothing wrong in any individual step. It drafted, evaluated, refined, and tried again — exactly as designed. The problem is that the loop never converged, and nothing in the runtime enforced a stopping point. The 30-second timeout is a demo safety net. In production, the agent would keep running until a rate limit, a process restart, or a human noticed the bill.

## With Cycles: the agent stops at $1.00

Same agent, same bug, same loop. The only difference is that each LLM call now passes through the Cycles server before execution:

```
╭──────────── Live Counter ─────────────────────╮
│   Mode:  GUARDED                              │
│ Ticket:  #4782 — My invoice for March is...   │
│  Calls:  100                                  │
│  Spend:  $1.0000  (100.0% of $1.00 budget)   │
│Elapsed:  5.1s                                 │
│   Last:  POST /v1/reservations → 409          │
│          BUDGET_EXCEEDED                      │
│          BudgetExceededError raised — agent    │
│          stopped cleanly                      │
╰───────────────────────────────────────────────╯

╭──────────── Budget Thresholds ────────────────╮
│   $0.10  ✓ passed at call 10 (4.6s ago)       │
│   $0.50  ✓ passed at call 50 (2.6s ago)       │
│   $1.00  Hard stop — BUDGET_EXCEEDED raised   │
│          at this limit                        │
╰───────────────────────────────────────────────╯

╭──────────── Final — GUARDED ──────────────────╮
│ Result:   BUDGET_EXCEEDED — Cycles server     │
│           returned 409                        │
│ Calls:    100                                 │
│ Spend:    $1.0000                             │
│ Duration: 5.1s                                │
│                                               │
│ Cycles stopped the agent BEFORE call 101      │
│ could proceed.                                │
╰───────────────────────────────────────────────╯
```

Call 101 never executed. Not "rolled back." Not "logged and alerted." The function body never ran. The `@cycles` decorator attempted to reserve $0.01 from the budget, the server found the balance exhausted, returned `409 BUDGET_EXCEEDED`, and the decorator raised `BudgetExceededError`. The agent caught the exception and stopped. Total spend: exactly $1.00.

## The three-line code change

The diff between `unguarded.py` and `guarded.py` is:

```python
# --- Import the SDK ---
from runcycles import (
    BudgetExceededError, CyclesClient, CyclesConfig,
    cycles, set_default_client,
)

# --- Initialize the client ---
config = CyclesConfig(
    base_url=os.environ["CYCLES_BASE_URL"],
    api_key=os.environ["CYCLES_API_KEY"],
    tenant=os.environ["CYCLES_TENANT"],
    workspace="default",
    app="default",
    workflow="default",
    agent="support-bot",
)
set_default_client(CyclesClient(config))

# --- Three decorators ---
@cycles(estimate=COST_PER_CALL_MICROCENTS, action_kind="llm.completion",
        action_name="draft-response")
def draft_response(ticket_text: str) -> str:
    return _draft(ticket_text)

@cycles(estimate=COST_PER_CALL_MICROCENTS, action_kind="llm.completion",
        action_name="evaluate-quality")
def evaluate_quality(draft: str) -> float:
    return _eval(draft)

@cycles(estimate=COST_PER_CALL_MICROCENTS, action_kind="llm.completion",
        action_name="refine-response")
def refine_response(draft: str, score: float) -> str:
    return _refine(draft, score)

# --- Catch the budget exception ---
try:
    # ... same loop as unguarded ...
except BudgetExceededError:
    # agent stopped — budget exhausted
```

Three decorators. One except. The loop logic, the simulation functions, the display rendering — all unchanged. The `@cycles` decorator wraps each function with a pre-execution budget check. If the check fails, the function never runs.

## How the budget hierarchy works

The Cycles scope hierarchy for this demo is a straight line from [tenant](/glossary#tenant) to agent:

```
tenant:demo-tenant                                    [$1.00]
└─ workspace:default                                  [$1.00]
   └─ app:default                                     [$1.00]
      └─ workflow:default                             [$1.00]
         └─ agent:support-bot                         [$1.00]
```

The provisioning script creates a $1.00 budget at every level:

```bash
for SCOPE in \
  "tenant:$TENANT_ID" \
  "tenant:$TENANT_ID/workspace:default" \
  "tenant:$TENANT_ID/workspace:default/app:default" \
  "tenant:$TENANT_ID/workspace:default/app:default/workflow:default" \
  "tenant:$TENANT_ID/workspace:default/app:default/workflow:default/agent:support-bot"; do

  curl -X POST "$ADMIN_URL/budgets" \
    -H "Content-Type: application/json" \
    -H "X-Cycles-API-Key: $API_KEY" \
    -d "{\"scope\": \"$SCOPE\", \"unit\": \"USD_MICROCENTS\",
         \"allocated\": {\"amount\": 100000000, \"unit\": \"USD_MICROCENTS\"}}"
done
```

When the `@cycles` decorator calls `POST /v1/reservations`, the server walks from the agent scope up to the tenant root, checking each ancestor's budget. If any scope is exhausted, the server returns `409 BUDGET_EXCEEDED` and the [reservation](/glossary#reservation) is denied. No partial execution. No overrun.

In this demo every scope has the same $1.00 limit, so the agent-level budget is the binding constraint. In production, you would set different limits at different levels — a $1.00 per-run budget at the agent level, a $50/day budget at the workspace level, and a $500/month budget at the tenant level. The server enforces whichever limit is hit first.

## Why not just use a rate limit?

A rate limit of 100 requests per minute would not have stopped this runaway. The agent was making 20 calls per second — well within typical API rate limits — and the cost grew linearly with every call. Rate limits cap throughput. They do not cap cost.

The gap between throughput control and cost control is where runaways live. Here is how common alternatives compare:

**Rate limits** cap requests per second or per minute. They do not distinguish between a $0.001 embedding call and a $0.12 GPT-4 call. An agent running at 100 RPM with $0.06/call burns $6/minute — within the rate limit, past any reasonable budget.

**Provider monthly caps** operate at the billing-cycle level. A $1,000/month cap does not stop a single 30-second runaway that burns $6. The cap is too coarse and the feedback loop is too slow — you find out next month.

**Hardcoded loop counters** (`max_iterations = 100`) are fragile and single-process. They break under concurrency, do not account for variable cost per call, and require a code change and redeployment to adjust. When five agents hit the same bug simultaneously, each one independently runs to its own counter limit.

**Dashboard alerts** react after the spend has occurred. An hourly refresh means the $5.95 is already gone by the time anyone sees it. Even real-time dashboards can only notify — they cannot prevent the next call from executing.

The missing layer is pre-execution budget enforcement: a system that checks before each call whether the budget allows it, atomically decrements the balance, and denies the call if the budget is exhausted. This is what [runtime authority](/blog/what-is-runtime-authority-for-ai-agents) means in practice — not a static configuration or a post-hoc alert, but a live enforcement point evaluated on every action. For a deeper look at how teams evolve from dashboards to hard enforcement, see [From Observability to Enforcement](/concepts/from-observability-to-enforcement-how-teams-evolve-from-dashboards-to-budget-authority).

## Run the runaway agent demo

Prerequisites: Docker Compose v2+, Python 3.10+, `curl`.

```bash
git clone https://github.com/runcycles/cycles-runaway-demo
cd cycles-runaway-demo
python3 -m venv .venv && source .venv/bin/activate
pip install -r agent/requirements.txt
./demo.sh both
```

The `both` mode runs the unguarded agent first, then the guarded agent, back to back. You can also run `./demo.sh unguarded` or `./demo.sh guarded` individually. The script starts the Cycles stack (Redis + server + admin), provisions the tenant and budgets, and runs the agent. First run pulls ~200MB in Docker images; subsequent runs start in seconds. Stop with `./teardown.sh`.

## Next steps

This demo shows budget enforcement for a single agent in a refinement loop. The same mechanism works for [fan-out](/glossary#fan-out) patterns, multi-agent pipelines, [retry storms](/glossary#retry-storm), and any other scenario where cost accumulates faster than a human can react.

For the cost math and failure modes behind this demo:
- [The True Cost of Uncontrolled AI Agents](/blog/true-cost-of-uncontrolled-agents) — real-world costs when agents run without budget limits
- [5 AI Agent Failures Budget Controls Would Prevent](/blog/ai-agent-failures-budget-controls-prevent) — the infinite [tool loop](/glossary#tool-loop) scenario this demo reproduces
- [AI Agent Budget Control: Enforce Hard Spend Limits](/blog/ai-agent-budget-control-enforce-hard-spend-limits) — the reserve-commit pattern under the hood
- [Runaway Agents: Tool Loops and Budget Overruns](/incidents/runaway-agents-tool-loops-and-budget-overruns-the-incidents-cycles-is-designed-to-prevent) — detailed incident patterns for the six failure modes Cycles prevents

For the sibling demo that shows action-level control instead of cost control:
- [AI Agent Action Authority: Blocking a Customer Email Before Execution](/blog/action-authority-demo-support-agent-walkthrough) — same integration pattern, different enforcement surface

To add Cycles to your own application:
- [End-to-End Tutorial](/quickstart/end-to-end-tutorial) — zero to a working budget-guarded app in 10 minutes
- [Adding Cycles to an Existing App](/how-to/adding-cycles-to-an-existing-application) — incremental adoption guide

Explore more scenarios on the [Demos](/demos/) page.
