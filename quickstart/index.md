---
title: "Quickstart"
description: "Get started with Cycles — runtime budget authority for AI agents. Add Cycles to your Python, TypeScript, Rust, or Java app, integrate with MCP, or deploy the full self-hosted stack."
---

# Quickstart

Cycles is a runtime authority for autonomous agents — it enforces hard budget and action limits **before** an agent runs an LLM call, a tool, or any side-effecting operation. This section takes you from zero to a working integration.

## New to Cycles?

Start with **[What is Cycles?](/quickstart/what-is-cycles)** for a 5-minute orientation, then run through the **[end-to-end tutorial](/quickstart/end-to-end-tutorial)** to see reserve / commit / release in practice.

## Add Cycles to an existing application

| Stack | Guide |
|---|---|
| Python | [Python client](/quickstart/getting-started-with-the-python-client) |
| TypeScript | [TypeScript client](/quickstart/getting-started-with-the-typescript-client) |
| Rust | [Rust client](/quickstart/getting-started-with-the-rust-client) |
| Java / Spring Boot | [Spring Boot starter](/quickstart/getting-started-with-the-cycles-spring-boot-starter) |
| MCP host (Claude, Cursor, Windsurf) | [MCP server quickstart](/quickstart/getting-started-with-the-mcp-server) |

### Use an AI coding assistant to integrate

[Add Cycles with Claude or Codex](/how-to/add-cycles-with-claude-or-codex) — Claude Code, Cursor, GitHub Copilot, etc. can wire Cycles into an existing app from natural-language instructions.

## Deploy self-hosted Cycles

Cycles is Apache 2.0 and self-hosted — there is no managed cloud. Run it on your own infrastructure.

- [Architecture overview](/quickstart/architecture-overview-how-cycles-fits-together) — how the runtime server, admin API, dashboard, and events service fit together.
- [Deploy the full stack](/quickstart/deploying-the-full-cycles-stack) — server + admin + dashboard + events.
- [Self-host the runtime server](/quickstart/self-hosting-the-cycles-server) — the protocol-conforming server alone.
- [Deploy the events service](/quickstart/deploying-the-events-service) — webhook delivery and signed audit events.
- [Deploy the admin dashboard](/quickstart/deploying-the-cycles-dashboard) — UI for tenants, budgets, and audit.

## Connect AI tools via MCP

[Claude Desktop](/quickstart/mcp-claude-desktop) · [Claude Code](/quickstart/mcp-claude-code) · [Cursor](/quickstart/mcp-cursor) · [Windsurf](/quickstart/mcp-windsurf) · [MCP server over HTTP](/how-to/running-the-mcp-server-over-http)

## Plan your rollout

- [Add hard budget limits to Spring AI](/quickstart/how-to-add-hard-budget-limits-to-spring-ai-with-cycles) — the reservation pattern walked through end-to-end.
- [Choose a first rollout](/quickstart/how-to-choose-a-first-cycles-rollout-tenant-budgets-run-budgets-or-model-call-guardrails) — tenant budgets, run budgets, or model-call guardrails as a starting point.

## Next

- [**How-To Guides**](/how-to/) — recipes for integrations, budget patterns, operations, and troubleshooting.
- [**Cycles Protocol**](/protocol/) — the open specification for runtime budget authority.
- [**Why Cycles**](/why-cycles) — the case for runtime authority over autonomous systems.
