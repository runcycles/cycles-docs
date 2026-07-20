---
title: "CrewAI Budget Control: Multi-Agent Cost Enforcement"
description: "Budget control for CrewAI multi-agent workflows in Python — per-task and per-agent cost enforcement with the @cycles decorator and reserve-commit lifecycle."
---

# CrewAI Budget Control: Multi-Agent Cost Enforcement

This guide shows how to add budget management to CrewAI multi-agent workflows so that every agent task is cost-controlled, observable, and automatically stopped when budgets run out.

## Prerequisites

```bash
pip install runcycles crewai
```

```bash
export CYCLES_BASE_URL="http://localhost:7878"
export CYCLES_API_KEY="your-api-key"   # create via Admin Server — see note below
export CYCLES_TENANT="acme"
export OPENAI_API_KEY="sk-..."
```

> **Need an API key?** Create one via the Admin Server — see [Deploy the Full Stack](/quickstart/deploying-the-full-cycles-stack#step-3-create-an-api-key) or [API Key Management](/how-to/api-key-management-in-cycles).

::: tip 60-Second Quick Start
```python
from crewai import Agent, Task, Crew
from runcycles import CyclesClient, CyclesConfig, cycles, set_default_client

set_default_client(CyclesClient(CyclesConfig.from_env()))

researcher = Agent(role="Researcher", goal="Find key facts", backstory="Expert researcher")

@cycles(estimate=3_000_000, action_kind="llm.completion", action_name="crew-research")
def run_research(topic: str) -> str:
    task = Task(description=f"Research {topic}", agent=researcher, expected_output="Summary")
    crew = Crew(agents=[researcher], tasks=[task])
    result = crew.kickoff()
    return str(result)

print(run_research("renewable energy trends"))
```
Every crew execution is now budget-guarded. If the budget is exhausted, `BudgetExceededError` is raised _before_ CrewAI runs. Read on for per-agent patterns.
:::

## Guarding individual agent tasks

Wrap each task function separately so you get per-task cost visibility:

```python
from crewai import Agent, Task, Crew
from runcycles import (
    CyclesClient, CyclesConfig, CyclesMetrics,
    cycles, get_cycles_context, set_default_client, BudgetExceededError,
)

config = CyclesConfig.from_env()
set_default_client(CyclesClient(config))

researcher = Agent(role="Researcher", goal="Find key facts", backstory="Expert researcher")
writer = Agent(role="Writer", goal="Write clear reports", backstory="Technical writer")

@cycles(estimate=2_000_000, action_kind="llm.completion", action_name="research-task")
def run_research(topic: str) -> str:
    task = Task(
        description=f"Research the latest developments in {topic}",
        agent=researcher,
        expected_output="Bullet-point summary of key findings",
    )
    crew = Crew(agents=[researcher], tasks=[task])
    return str(crew.kickoff())

@cycles(estimate=2_500_000, action_kind="llm.completion", action_name="writing-task")
def run_writing(research_results: str) -> str:
    task = Task(
        description=f"Write a report based on: {research_results}",
        agent=writer,
        expected_output="A well-structured report",
    )
    crew = Crew(agents=[writer], tasks=[task])
    return str(crew.kickoff())

# Pipeline: research then write, each independently budget-guarded
research = run_research("AI safety")
report = run_writing(research)
```

## Per-agent budget scoping

Use the `agent` parameter on the decorator to scope budgets per agent. This lets the budget authority set different limits for each agent role:

```python
@cycles(
    estimate=2_000_000,
    action_kind="llm.completion",
    action_name="research-task",
    agent="researcher",
)
def run_research(topic: str) -> str:
    task = Task(
        description=f"Research {topic}",
        agent=researcher,
        expected_output="Summary",
    )
    crew = Crew(agents=[researcher], tasks=[task])
    return str(crew.kickoff())

@cycles(
    estimate=2_500_000,
    action_kind="llm.completion",
    action_name="writing-task",
    agent="writer",
)
def run_writing(research_results: str) -> str:
    task = Task(
        description=f"Write a report based on: {research_results}",
        agent=writer,
        expected_output="Report",
    )
    crew = Crew(agents=[writer], tasks=[task])
    return str(crew.kickoff())
```

With this setup, the budget authority can allocate separate budgets for `researcher` and `writer` under the same tenant.

## Multi-crew budget hierarchies

For complex deployments, use the `tenant`, `workspace`, and `agent` parameters to create hierarchical budget scoping across multiple crews:

```python
# Crew 1: Content team
@cycles(
    estimate=2_000_000,
    action_kind="llm.completion",
    action_name="content-research",
    tenant="acme",
    workspace="content-team",
    agent="researcher",
)
def content_research(topic: str) -> str:
    task = Task(description=f"Research {topic}", agent=researcher, expected_output="Summary")
    crew = Crew(agents=[researcher], tasks=[task])
    return str(crew.kickoff())

# Crew 2: Engineering team
@cycles(
    estimate=3_000_000,
    action_kind="llm.completion",
    action_name="code-review",
    tenant="acme",
    workspace="engineering-team",
    agent="code-reviewer",
)
def code_review(code: str) -> str:
    reviewer = Agent(role="Code Reviewer", goal="Review code", backstory="Senior engineer")
    task = Task(description=f"Review this code:\n{code}", agent=reviewer, expected_output="Review")
    crew = Crew(agents=[reviewer], tasks=[task])
    return str(crew.kickoff())
```

This gives you a budget hierarchy: `tenant (acme)` > `workspace (content-team / engineering-team)` > `agent (researcher / code-reviewer)`. Each level can have its own budget limits set by the budget authority.

::: tip Callable subject and action fields (runcycles 0.4.0+)
The subject (`tenant`, `workspace`, `agent`, ...) and action (`action_kind`, `action_name`, ...) parameters on `@cycles` also accept callables that receive the decorated function's arguments at reservation time — so a single decorated function can route budgets per crew or per tenant:

```python
@cycles(
    estimate=2_000_000,
    action_kind="llm.completion",
    action_name=lambda topic, **kw: kw.get("crew_name", "default-crew"),
    tenant=lambda topic, **kw: kw.get("tenant", "acme"),
)
def run_crew_task(topic: str, tenant: str = "acme", crew_name: str = "default-crew") -> str:
    ...
```
:::

## Error handling

When a budget is insufficient, `BudgetExceededError` is raised **before** CrewAI executes:

```python
from runcycles import BudgetExceededError

try:
    research = run_research("quantum computing")
    report = run_writing(research)
except BudgetExceededError:
    report = "Budget limit reached. Deferring this task to the next billing cycle."
```

For multi-step pipelines, handle errors at each stage to allow partial completion:

```python
try:
    research = run_research("quantum computing")
except BudgetExceededError:
    research = cached_research.get("quantum computing", "No data available.")

try:
    report = run_writing(research)
except BudgetExceededError:
    report = f"Raw research (report generation skipped):\n{research}"
```

See [Degradation Paths](/how-to/how-to-think-about-degradation-paths-in-cycles-deny-downgrade-disable-or-defer) for patterns like queueing, model downgrade, and caching.

## Key points

- **Wrap task functions, not agents.** The `@cycles` decorator goes on your functions that invoke CrewAI, giving you budget control at the task level.
- **Use `agent` for per-agent scoping.** The `agent` parameter lets the budget authority allocate and track costs per agent role.
- **Budget hierarchies map to org structure.** Use `tenant`, `workspace`, and `agent` to mirror your team and crew topology.
- **The function never executes on DENY.** CrewAI agents never run if the budget is exhausted, saving both cost and compute.

## Next steps

- [Error Handling Patterns in Python](/how-to/error-handling-patterns-in-python) — handling budget errors in Python
- [Testing with Cycles](/how-to/testing-with-cycles) — testing budget-guarded code
- [Integrating with OpenAI](/how-to/integrating-cycles-with-openai) — budget governance for direct OpenAI calls
- [Integrating with LangChain](/how-to/integrating-cycles-with-langchain) — budget governance for LangChain apps
- [Production Operations Guide](/how-to/production-operations-guide) — running Cycles in production
