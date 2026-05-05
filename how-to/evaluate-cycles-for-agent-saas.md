---
title: "Evaluate Cycles for a multi-tenant agent SaaS"
description: "Evaluate whether Cycles fits your multi-tenant agent stack. Includes a fit checklist, non-fit cases, a 15-minute local test, and the first agent actions to gate."
---

# Evaluate Cycles for a multi-tenant agent SaaS

This page is for engineering and product leads building multi-tenant agents that call models, tools, APIs, or external systems. It is **not** an implementation guide — for that, see [Building a Multi-Tenant AI SaaS with Cycles](/how-to/multi-tenant-saas-with-cycles) and [Choosing the Right Integration Pattern](/how-to/choosing-the-right-integration-pattern).

The goal here is to answer one question: **does Cycles solve a problem you are about to have?**

## When Cycles is a fit

Cycles is built for agent systems where the *next* tool call, model call, or external action might be the one that costs you money, breaks a tenant boundary, or commits an irreversible side effect. You probably want it if any of these describe your stack:

- Agents call **paid APIs** (LLMs, search, browser automation, third-party data) where cost compounds with retries.
- Agents call **tools with side effects** — sending email, writing to databases, triggering deployments, executing shell commands, mutating customer state.
- You serve **multiple tenants** and need each one capped independently. One customer's runaway agent must not eat another customer's budget or quota.
- Workflows **retry, fan out, or run unattended**. The first call is fine; the 12th call is the problem.
- Your existing controls are **observation, not enforcement** — alerts, dashboards, traces. By the time the alert fires, the action already happened.
- You need **per-run** or **per-tool** caps that traditional rate limits cannot express. Rate limits control velocity; they do not control cumulative cost or blast radius.

If three or more of these describe you today, the rest of this page is worth your time.

## When Cycles is not a fit

Skip Cycles if:

- You are running a **single-user script** or a **toy agent** with no production exposure.
- Agents make **no paid calls** and trigger **no irreversible actions**.
- There is **no multi-tenant boundary** and no need for per-tenant isolation.
- You only need **logging or analytics** of what already happened — Cycles is a *gate* before execution, not an after-the-fact ledger.
- You want a **managed cloud SaaS**. Cycles is self-hosted today (Apache 2.0), so it fits teams comfortable running the control plane inside their own infrastructure.

## 15-minute local test

The fastest way to know whether Cycles fits is to run the full stack and watch a denial happen.

1. **Start the stack** with the published Docker images. See [Deploying the Full Cycles Stack](/quickstart/deploying-the-full-cycles-stack). You'll have the runtime server, admin server, and dashboard running locally on three ports.
2. **Create a tenant** via the admin server. See [Tenant Creation and Management](/how-to/tenant-creation-and-management-in-cycles).
3. **Create a budget** scoped to that tenant — a small one, e.g., a few cents.
4. **Run one allowed check.** A `decide` call returns `ALLOW` without creating a reservation, or a `reserve` call returns `ALLOW` and records an active reservation.
5. **Run one denied check.** Exhaust the tenant budget with a request larger than the remaining balance. A `decide` call returns `DENY`, or a `reserve` call is rejected before the underlying action executes. (If you're evaluating the v0.1.26 action-governance preview, you can also test per-action quotas and allow/deny lists.)
6. **Open the dashboard.** Watch the reservation, commit, and denial show up under the tenant's budget view. If you used `decide`, expect a decision result but no active reservation.

You should see three things:

- an **allowed reservation** that reduces available budget
- a **committed reservation** that records actual usage
- a **denied reservation** that prevents the next action from running

If you can map those three states to your own agent workflow, Cycles is probably worth a deeper integration test. If they don't match what you'd expect for your worst case — runaway agent, tool loop, multi-tenant overspend — you've spent 15 minutes and learned something specific about why.

## What to test in your own stack

Once the local test passes, try Cycles against the actions in your product that actually scare you. The list usually looks something like:

- **LLM call** — the most expensive class of action; reservations should align with token budgets.
- **Email / message send** — irreversible side effect; needs a per-run cap regardless of cost.
- **Browser action** — fan-out and retry storms are common; cap per session.
- **Database write** — usually cheap to issue, expensive to undo; gate by risk, not just cost.
- **Deployment / infra command** — high blast radius; should require an explicit allowlist, not just a budget.
- **Coding-agent shell command** — agents that write code will retry shell commands aggressively; cap per run.

For each, decide:

- What action kind does it map to? (`llm.completion`, `web.search`, `message.email.send`, `code.exec.shell`, etc.)
- What should be enforced — spend budget, token budget, risk budget, action-count quota, or some combination?
- What scope does the cap belong on — tenant, workflow, run, agent, tool?

That mapping is the design exercise. See [Assigning Risk Points to Agent Tools](/how-to/assigning-risk-points-to-agent-tools) for the framework, and [Choosing the Right Integration Pattern](/how-to/choosing-the-right-integration-pattern) for where to put the gate (SDK in-process, MCP, gateway, framework plugin).

## The architecture in one sentence

Cycles becomes the **runtime authority layer** between agent intent and external execution: every consequential action passes through `reserve → execute → commit` (or `release` on failure), scoped by tenant / workflow / run / tool.

That is the core idea. Multi-tenant isolation, per-tier quotas, OTLP metrics, MCP integration, and dashboard workflows all build on that one reserve-before-execute boundary.

## What a good first integration looks like

Do not start by gating every action.

Start with one high-signal boundary:

- one tenant
- one workflow
- one risky action kind
- one small budget, or one quota if you're evaluating the v0.1.26 preview
- one visible denial in the dashboard

Good first candidates are email sends, browser actions, coding-agent shell commands, paid search/API calls, or expensive LLM completions. Once that path works, expand to more tools and scopes.

## Send us your flow

If you want a sanity check before you start, paste the rough shape of your agent's tool-call flow:

```
agent → tool → API → side effect
```

Send it via [Contact Us](/contact) with the subject "agent flow review." We'll mark where `reserve`, `commit`, and `release` belong — or tell you if Cycles is not the right fit. Honest answers, not sales calls.

## Next steps

If Cycles is a fit:

- [Building a Multi-Tenant AI SaaS with Cycles](/how-to/multi-tenant-saas-with-cycles) — the full implementation guide.
- [Deploying the Full Cycles Stack](/quickstart/deploying-the-full-cycles-stack) — the local stack you'll evaluate against.
- [Choosing the Right Integration Pattern](/how-to/choosing-the-right-integration-pattern) — SDK vs MCP vs gateway vs plugin.
- [Add Cycles with Claude or Codex](/how-to/add-cycles-with-claude-or-codex) — fastest path if you're using a coding agent.

If you want to read more before deciding:

- [What is Cycles?](/quickstart/what-is-cycles) — overview with a code sample.
- [Why rate limits are not enough for autonomous systems](/concepts/why-rate-limits-are-not-enough-for-autonomous-systems) — the conceptual case.
- [Runaway agents and the incidents Cycles prevents](/incidents/runaway-agents-tool-loops-and-budget-overruns-the-incidents-cycles-is-designed-to-prevent) — real failure modes.
