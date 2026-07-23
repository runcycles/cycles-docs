---
title: "Design Partners"
description: "Design-partner mode: a small set of teams running real multi-tenant agent workloads, with founder access, roadmap influence, and free self-hosted OSS."
---

# Design Partners

Cycles is in design-partner mode. We partner with a small, focused set of teams running **real agent workloads** — multi-tenant, concurrent, with real cost and real consequences when something goes wrong — who want hard runtime limits on spend, risk, and agent actions, and who are willing to push us hard on what's missing.

This is not a generic beta. The goal is to put Cycles under real workload pressure, find what breaks, and shape the next two protocol releases around production use.

Built by [Albert Mavashev](/about) (ex-CTO Nastel, ex-meshIQ) and a small team with nearly three decades building mission-critical transaction infrastructure for banks, airlines, and telecoms. Cycles applies that same discipline to AI agent execution.

## What design partners get

- **Direct line to the founder.** Monthly 30-minute office hours. Email or Slack any time in between.
- **Roadmap influence.** What ships in the next two minor versions is shaped by the workloads design partners run. Your incident becomes our next runbook.
- **Free self-hosted forever.** Because Cycles is Apache 2.0, your self-hosted deployment remains free to run. You run it in your VPC; nothing leaves.
- **Priority support during your 60-day integration window.** Private Slack/email channel and fast response for production-blocking issues.
- **Optional public co-marketing.** Joint blog post, case study, or conference talk — opt-in, not required. You can be a named partner *or* stay anonymous; your choice.

## What we're asking for

- **One real workload running on Cycles within 60 days.** Not a sandbox, not a Hello World — something with real traffic, real concurrency, and an operational consequence if it fails. Internal tools and dev pipelines count; tutorials and synthetic load tests do not.
- **Monthly 30-minute sync.** Office hours go both ways — we need to hear what you're hitting.
- **Honest feedback.** We want pushback, not validation. If the protocol is wrong, the comparison page is misleading, or the SDK is awkward — we need to know.
- **Permission to use anonymized learnings unless otherwise agreed.** Named case studies and public co-marketing are opt-in.

## Who this is for

- Teams running **multi-tenant or concurrent agents with real workloads** — internal tools, dev/research pipelines, customer-facing systems, coding agents, ops automation. Anything where real cost is being burned and operational risk is no longer theoretical. Already running, or shipping within 60 days.
- Teams running **Python, TypeScript, Spring Boot, or MCP-host stacks** (Cursor, Continue, Windsurf, etc.). Rust support is welcome if you're willing to help shape it.
- Teams that can **move fast**. No 6-month procurement cycles. We need to ship, learn, ship again.
- Teams whose engineering leadership is **comfortable with self-hosted Apache 2.0 OSS**. There is no managed cloud yet.

## Who this is NOT for

We'd rather be honest now than waste both of our time later. Cycles is probably not the right fit if:

- You're running a single-tenant prototype with no concurrency. You don't need atomic reservations yet — a local counter is fine.
- You're still in exploration mode and don't expect to put Cycles in front of a real workload within 60 days.
- You need a fully managed cloud / SaaS. We're self-hosted-only today; managed cloud is on the roadmap, not live.
- You can't commit to running one workload on Cycles within 60 days. We're not in a position to help with multi-quarter evaluations.
- Your blocker is whether agents need governance at all. The design-partner conversation assumes that's already settled for you.

Not sure if your workload qualifies? Send us the failure mode anyway. If Cycles isn't the right fit, we'll tell you.

## Apply to become a design partner

The fastest path is to grab 30 minutes:

<a href="https://calendly.com/amavashev/cycles-partnership" target="_blank" rel="noopener"><strong>Book a 30-minute call →</strong></a>

Or email [founder@runcycles.io](mailto:founder@runcycles.io) with one paragraph on:

1. What workload you'd run on Cycles
2. What stack you're on (language, framework, agent host)
3. What's currently broken or worrying you about agent budgeting / actions

I read every email; expect a reply within 48 hours.

## What happens after the first call

1. **Mutual fit conversation.** No commitment yet. We talk through the workload, the stack, and whether Cycles actually solves your problem.
2. **One-page MOU.** If fit looks right, we draft a one-page commitment doc covering scope, timeline, and what each side delivers.
3. **60-day integration window.** Hands-on support, weekly check-ins as needed.
4. **Public artifact at 90 days.** If both parties want it: case study, joint blog post, or conference talk. Opt-in.

## Why we run this program

Runtime authority for AI agents is a category that did not exist 18 months ago. We can write about it, comparison-page it, and demo it — but the product gets built right only if real teams put it under real load and tell us where it breaks. A small, focused cohort is enough to drive every meaningful product decision for the next two quarters. We'd rather get those right than pursue scale prematurely.

## Related

- [Why Cycles](/why-cycles) — the problems Cycles solves, by role
- [Demos](/demos/) — see runtime authority in action, no API keys
- [End-to-End Tutorial](/quickstart/end-to-end-tutorial) — production-quality integration in about 10 minutes
- [Security](/security) — self-hosted, no prompt storage, what we log and what we don't
- [Runtime Authority vs Runtime Authorization](/concepts/runtime-authority-vs-runtime-authorization) — how Cycles fits alongside identity-based agent governance
