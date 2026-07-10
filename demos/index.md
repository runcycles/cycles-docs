---
title: "Demos"
description: "Self-contained demos showing Cycles budget enforcement and action authority in action. Run locally with Docker — no LLM API key required."
---

# Demos

Each demo runs locally with Docker. No LLM API keys required — all tools and models are mocked.

## Runaway Agent Demo

A support agent with a quality-loop bug burns ~$5.95 in ~30 seconds without Cycles (simulated calls at 50ms latency) — auto-terminated only because the demo enforces a safety timeout. In production, there would be no timeout. With Cycles, the agent stops cleanly at $1.00.

**What it shows:** Budget enforcement stops a cost runaway before damage accumulates.

**Mechanism:** `reserve → 409 BUDGET_EXCEEDED → no downstream call`

### Run it

Prerequisites: Docker Compose v2+, Python 3.10+, `curl`

```bash
git clone https://github.com/runcycles/cycles-runaway-demo.git
cd cycles-runaway-demo
python3 -m venv .venv && source .venv/bin/activate
pip install -r agent/requirements.txt
./demo.sh
```

The script starts the Cycles stack (Redis, Cycles Server, Admin Server), provisions a tenant and budget automatically, and runs both modes back to back. Watch the terminal output — you'll see the unguarded agent overspend, then the guarded agent stop at the $1.00 limit. (Don't run `docker compose up` directly — the agent runs on your host via the venv, and the script also resets the stack between runs.)

<video controls autoplay muted loop playsinline poster="/demo-runaway-poster.png" preload="metadata" style="width: 100%; max-width: 880px; display: block; border-radius: 8px;">
  <source src="/demo-runaway.mp4" type="video/mp4" />
  <source src="/demo-runaway.webm" type="video/webm" />
  <img src="/demo-runaway.gif" alt="Runaway agent demo: ~$10 burn without Cycles, $1 cap with Cycles" />
</video>

::: info About the recording
The recording above uses an accelerated call rate (~$10 in 12 seconds) for visual punch. Running `./demo.sh` yourself produces ~$5.95 over 30 seconds at the demo's 50ms simulated call latency — same enforcement behavior, more realistic pace.
:::

[View on GitHub](https://github.com/runcycles/cycles-runaway-demo) · [Blog walkthrough](/blog/runaway-demo-agent-cost-blowup-walkthrough)

## Action Authority Demo

A support agent handles a billing dispute in four steps. Cycles allows internal actions (notes, CRM updates) but blocks the customer email — before it executes.

**What it shows:** Toolset-scoped budgets give agents authority over safe actions while blocking risky ones.

**Mechanism:** `reserve → 409 BUDGET_EXCEEDED → no email send` (the terminal display renders the blocked reservation as a DENY)

### Run it

Prerequisites: Docker Compose v2+, Python 3.10+, `curl`

```bash
git clone https://github.com/runcycles/cycles-agent-action-authority-demo.git
cd cycles-agent-action-authority-demo
python3 -m venv .venv && source .venv/bin/activate
pip install -r agent/requirements.txt
./demo.sh
```

The script starts the full stack (Redis, Cycles Server, Admin Server), provisions a tenant with action-scoped budgets, and runs the agent in both unguarded and guarded modes. No API keys required — all LLM calls are mocked.

<video controls autoplay muted loop playsinline poster="/demo-action-authority-poster.png" preload="metadata" style="width: 100%; max-width: 880px; display: block; border-radius: 8px;">
  <source src="/demo-action-authority.mp4" type="video/mp4" />
  <source src="/demo-action-authority.webm" type="video/webm" />
  <img src="/demo-action-authority.gif" alt="Action authority demo: customer email blocked before it executes" />
</video>

[View on GitHub](https://github.com/runcycles/cycles-agent-action-authority-demo) · [Blog walkthrough](/blog/action-authority-demo-support-agent-walkthrough)

---

**Next:** wire Cycles into your app with the [End-to-End Tutorial](/quickstart/end-to-end-tutorial), [compare it to your current stack](/concepts/comparisons), or — if you're new to the category — read [What is Cycles?](/quickstart/what-is-cycles).
