---
title: "MCP Gateways Are Not Runtime Authority"
date: 2026-05-03
author: Albert Mavashev
tags:
  - MCP
  - security
  - governance
  - runtime-authority
  - architecture
description: "MCP gateways help secure tool connectivity, but production agents still need runtime authority for budget, risk, scope, and per-action decisions at runtime."
blog: true
sidebar: false
featured: false
head:
  - - meta
    - name: keywords
      content: MCP gateway, MCP security, Model Context Protocol, runtime authority, AI agent governance, tool authorization, AI agent risk controls
---

# MCP Gateways Are Not Runtime Authority

The security team adds an MCP gateway. Tool access is centralized. OAuth is configured where the transport supports it. Unknown servers are blocked. The agent is expected to see only approved tools.

Then the approved support tool sends 400 emails because the agent got stuck in a retry loop.

Nothing about that incident means the MCP gateway failed. It did its job: mediate connectivity between the agent and tools. The missing layer was different. No system asked whether the next approved tool call still fit the [tenant](/glossary#tenant) budget, the run budget, the action-risk allocation, or the degradation policy.

MCP gateways are useful. They are not the same thing as [runtime authority](/glossary#runtime-authority).

## What an MCP Gateway Is Good At

An MCP gateway is a control point for the tool connectivity layer. Depending on the implementation, it may help with:

| Capability | Why it matters |
|---|---|
| Server inventory | Know which [MCP servers](/glossary#mcp-server) agents can reach |
| Authentication | Require credentials before tool access |
| OAuth flows | Connect agents to protected SaaS resources |
| Tool allowlists | Hide or block unapproved tools |
| Transport policy | Separate local STDIO and remote HTTP risk |
| Basic audit | Record which tools were requested |
| Scanner integration | Detect known risky descriptors or packages |

Those are real controls. The official MCP authorization specification defines an HTTP-oriented authorization flow and notes that authorization is optional for MCP implementations. It also distinguishes HTTP transports from STDIO transports, where credentials are typically retrieved from the environment. The MCP security best-practices guidance covers risks such as confused deputy behavior, token passthrough, SSRF, session hijacking, local server compromise, and scope minimization.

That is the layer MCP is designed to address: how clients and servers connect, authenticate, and exchange tool capabilities.

## What a Gateway Usually Does Not Know

A gateway can decide whether a tool is reachable. It does not automatically know whether this specific call should happen given everything else the agent has already done.

| Question | Gateway layer | Runtime authority layer |
|---|---|---|
| Is this MCP server allowed? | Yes | Usually no |
| Is this agent authenticated? | Yes | Usually inherited |
| Is this tool approved? | Yes | Can consume as action metadata |
| Has this tenant exhausted its budget? | Not by default | Yes |
| Has this run used its risky-action allowance? | Not by default | Yes |
| Should the agent receive ALLOW_WITH_CAPS? | Usually no | Yes |
| Is this [reservation](/glossary#reservation) atomic under concurrency? | Not by default | Yes |
| Should this child agent inherit less authority? | Usually no | Yes, when scoped that way |

The distinction is operational. It changes incident outcomes.

If an agent is authorized to call `send_email`, a gateway lets the call through. Runtime authority can still DENY the 201st email because the `toolset:email` [RISK_POINTS](/glossary#risk-points) budget is exhausted. If an agent is authorized to call an expensive model, a gateway lets the call through. Runtime authority can still return ALLOW_WITH_CAPS and force a cheaper model or lower token cap because the run is close to its budget.

Authorization answers whether access exists. Authority answers whether [exposure](/glossary#exposure) remains bounded.

## The Approved-Tool Failure Mode

Many agent incidents do not require a malicious tool. They start with a legitimate tool used too many times, in the wrong scope, with the wrong arguments, or after budget should have run out.

Examples:

| Approved tool | Failure |
|---|---|
| `send_email` | Sends too many messages before a human reviews |
| `create_ticket` | Floods Jira with duplicates |
| `web_search` | Runs a high-cost research loop |
| `refund.issue` | Performs a legitimate mutation too often |
| `deploy_service` | Triggers a real deployment from a bad plan |

An MCP gateway can block tools that should not be visible. It can help with authentication and central routing. But once a tool is approved, the gateway alone does not usually provide cumulative budget state, risk-point accounting, hierarchical tenant scopes, or reserve-commit semantics.

That is the gap [MCP Tool Poisoning Has an 84% Success Rate](/blog/mcp-tool-poisoning-why-agent-frameworks-cant-prevent-it) addresses from the attack side. This post is the architecture-side version: even clean tools need per-action authority.

## The Two-Layer Pattern

A safer architecture composes both layers:

```text
Agent proposes tool call
  -> MCP gateway: is this server/tool reachable and authenticated?
  -> Runtime authority: is this action still within budget, risk, and scope?
  -> Tool executes when both layers allow it
  -> Actual usage commits back to the ledger
```

That produces four useful outcomes:

| Gateway decision | Authority decision | Outcome |
|---|---|---|
| DENY | Not evaluated | Unknown or forbidden tool is blocked before runtime authority |
| ALLOW | DENY | Approved tool blocked because exposure is exhausted |
| ALLOW | ALLOW_WITH_CAPS | Tool executes with constraints |
| ALLOW | ALLOW | Tool executes and actual usage is committed |

The two layers should not be collapsed. A gateway without authority is a pass/fail access system. Runtime authority without tool connectivity control has to trust that the tool inventory is already sane. Together, they form a more complete control plane.

## Where Cycles Fits

Cycles sits after the agent has proposed an action and before the costly or risky thing happens. It is not an MCP registry, scanner, OAuth provider, or gateway. It is the bounded-exposure decision point.

For MCP-backed agents, a Cycles-style runtime authority call should include:

| Field | Example |
|---|---|
| Tenant | `acme` |
| Scope | `tenant:acme/workflow:support/run:4821` |
| Agent | `support-refund-agent` |
| Toolset | `email`, `refund`, `search`, `deploy` |
| Estimate | `$0.03`, `10 RISK_POINTS`, or token estimate |
| Action metadata | tool name, operation kind, argument class |
| [Idempotency key](/glossary#idempotency-key) | Stable key for retries |

The server responds with ALLOW, ALLOW_WITH_CAPS, or DENY. If execution proceeds, the caller commits actual usage. If the action is skipped or fails before execution, the caller releases unused budget.

That lifecycle gives operations something a gateway alone cannot: a ledger-backed answer to "how much exposure has this agent consumed, and why was the next action allowed?"

## How to Tell Which Layer You Need

Use this split:

| Need | Use |
|---|---|
| Discover and route MCP servers | MCP gateway |
| Authenticate tool access | MCP authorization / gateway |
| Hide unapproved tools | MCP gateway |
| Detect known malicious tool descriptors | Scanner / gateway integration |
| Cap per-run model spend | Runtime authority |
| Limit high-risk tool calls | Runtime authority with RISK_POINTS |
| Isolate tenant budgets | Runtime authority with scoped ledgers |
| Prevent double-spend under concurrency | Runtime authority with atomic reservations |
| Produce budget and risk audit evidence | Runtime authority event and ledger records |

The operational mistake is buying the first four and assuming they imply the last five.

They do not. They solve different layers.

## The Takeaway

MCP gateways reduce tool-access and connectivity risk and can be part of production agent infrastructure. But approved tools can still create runaway cost, action overuse, tenant bleed, and delegation cascades.

Runtime authority is the layer that meters and bounds each approved action. It asks the question the gateway is not designed to answer: should this specific next tool call happen right now, given the budget, risk, scope, and history already consumed?

If that answer matters in production, a gateway alone is incomplete.

## Sources

- [Model Context Protocol Authorization Specification](https://modelcontextprotocol.io/specification/2025-11-25/basic/authorization) - MCP HTTP authorization scope and requirements
- [Model Context Protocol Security Best Practices](https://modelcontextprotocol.io/docs/tutorials/security/security_best_practices) - MCP confused deputy, token passthrough, SSRF, session, local server, and scope guidance
- [OWASP MCP Security Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/MCP_Security_Cheat_Sheet.html) - MCP deployment guidance for least privilege, schema integrity, sandboxing, monitoring, and supply chain controls
- [OWASP Top 10 for Agentic Applications 2026](https://genai.owasp.org/resource/owasp-top-10-for-agentic-applications-for-2026/) - broader agentic risk framework
- [Runtime Authority vs Runtime Authorization](/concepts/runtime-authority-vs-runtime-authorization) - local layer distinction
- [MCP Tool Poisoning Has an 84% Success Rate](/blog/mcp-tool-poisoning-why-agent-frameworks-cant-prevent-it) - attack-side context for MCP security
- [Zero Trust for AI Agents](/blog/zero-trust-for-ai-agents-why-every-tool-call-needs-a-policy-decision) - why every tool call needs an external policy decision
- [Getting Started with the Cycles MCP Server](/quickstart/getting-started-with-the-mcp-server) - config-level integration path
