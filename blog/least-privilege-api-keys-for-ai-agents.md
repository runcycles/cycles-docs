---
title: "Least-Privilege API Keys for AI Agents"
date: 2026-04-29
author: Albert Mavashev
tags:
  - security
  - governance
  - multi-tenant
  - runtime-authority
  - agents
description: "How to scope AI agent API keys by tenant, environment, and permission so one leaked credential cannot become cross-tenant budget authority in production."
blog: true
sidebar: false
featured: false
head:
  - - meta
    - name: keywords
      content: AI agent API keys, least privilege, agent security, tenant isolation, API key rotation, runtime authority, Cycles permissions
---

# Least-Privilege API Keys for AI Agents

> **Part of: [Multi-Tenant AI Operations Reference](/guides/multi-tenant-operations)** — the full pillar covering scope hierarchy, per-tenant enforcement, multi-agent coordination, tenant lifecycle, and identity.

> **Part of: [AI Agent Risk & Blast Radius Reference](/guides/risk-and-blast-radius)** — the full pillar covering action authority, risk scoring, blast-radius containment, and degradation paths.

An agent worker gets deployed with one shared API key. It runs support workflows for every customer, reads budgets, creates [reservations](/glossary#reservation), commits spend, and has enough admin access to patch policy during an incident. Six weeks later, the key appears in a build log.

The immediate question is not "who leaked it?" It is "what could that key do before we revoked it?"

For many agent stacks, the answer is uncomfortable: the key can do whatever the application can do, across every [tenant](/glossary#tenant) the application serves. That is ordinary application-secret thinking applied to autonomous systems. It is too broad for agents, because agents do not just call an API in one predictable path. They branch, retry, delegate, call tools, and operate near production side effects.

Least privilege for AI agents starts with a narrower question: which tenant, which environment, and which operations should this specific agent worker be allowed to perform right now?

## The mistake: one key per application

The tempting setup is one key per service:

| Key pattern | Why it feels simple | What breaks |
|---|---|---|
| One key for all tenants | Easy deployment and rotation | A leak crosses tenant boundaries |
| One key for prod and staging | Fewer secrets to manage | Test traffic can mutate production authority |
| One key with read and write admin permissions | Convenient for runbooks | Runtime code can perform operator actions |
| One key shared by multiple agents | No per-agent provisioning | Spend and audit attribution collapse together |

That shape is manageable when the caller is a conventional backend route with bounded behavior. It is much harder to defend when the caller is an agent that may retry, call tools, or fan out into sub-agents.

The [runtime authority](/glossary#runtime-authority) pattern depends on every consequential action passing through the authority lifecycle: optionally `decide`, then reserve before execution, then commit or release afterward. If every agent shares one broad credential, the enforcement point still works, but the blast radius of a leaked key is much larger than it needs to be.

## The safer shape: one key per tenant, environment, and role

Cycles API keys are associated with exactly one tenant. On every runtime request, the server validates the key, derives the effective tenant, and rejects attempts to act for a different tenant. If `subject.tenant` is omitted, the server uses the tenant attached to the key.

That gives you a clean default:

| Boundary | Recommended key shape |
|---|---|
| Customer tenant | One key per tenant, not one shared SaaS key |
| Environment | Separate production, staging, and development keys |
| Agent role | Separate keys when roles have materially different authority |
| Operator plane | Separate admin credentials, not embedded runtime keys |

The security property is straightforward: a leaked staging key cannot mutate production budgets, and a leaked tenant key cannot create reservations for another tenant.

This is not only a security improvement. It also improves operations. When spend spikes, `actor.key_id` becomes useful evidence instead of a shared label. When a customer churns, tenant close can revoke that tenant's keys as part of the cascade. When a worker is compromised, revocation is scoped to the smallest useful boundary.

For the underlying auth contract, see [Authentication, Tenancy, and API Keys](/protocol/authentication-tenancy-and-api-keys-in-cycles). For the operational key workflow, see [API Key Management in Cycles](/how-to/api-key-management-in-cycles).

## Runtime keys should not be admin keys

Most agent workers need a small runtime permission set:

| Permission | Why the agent needs it |
|---|---|
| `reservations:create` | Ask for budget before an LLM call or tool action |
| `reservations:commit` | Commit actual usage after execution |
| `reservations:release` | Release unused reservation amount on cancellation or failure |
| `reservations:extend` | Keep long-running streams or workflows alive |
| `reservations:list` | Inspect active reservations for recovery paths |
| `balances:read` | Read remaining budget for degradation decisions |

That is enough for the common reserve-commit lifecycle. It lets the agent ask for authority, act only after ALLOW or ALLOW_WITH_CAPS, and reconcile the actual cost afterward.

Admin permissions are a different class of authority. Creating tenants, changing budgets, revoking API keys, replaying webhooks, and reading cross-tenant audit logs are operator actions. They belong in the admin plane, behind the [dashboard](/glossary#dashboard), runbooks, or tightly controlled automation.

The dangerous pattern is giving a runtime worker broad permissions because it might need them someday:

```json
{
  "tenant_id": "acme",
  "name": "production-support-agent",
  "permissions": [
    "reservations:create",
    "reservations:commit",
    "reservations:release",
    "balances:read",
    "admin:read",
    "admin:write"
  ]
}
```

That key can now satisfy broad admin operations. If the agent is compromised, the attacker is not just spending from a budget; they are holding a credential with management-plane reach.

A narrower runtime key is boring by design:

```json
{
  "tenant_id": "acme",
  "name": "production-support-agent",
  "description": "Runtime key for Acme support workflow",
  "permissions": [
    "reservations:create",
    "reservations:commit",
    "reservations:release",
    "reservations:extend",
    "reservations:list",
    "balances:read"
  ]
}
```

If tenants manage their own budgets or webhooks, add only the specific permissions they need: `budgets:read`, `budgets:write`, `webhooks:read`, or `webhooks:write`. Use `admin:read` and `admin:write` only for deliberate cross-tenant admin automation, and keep those credentials out of agent runtime processes.

## Rotation is a workflow, not a button

A safe rotation has five steps:

1. Create a new key for the same tenant and permission set.
2. Store the new secret in the environment or secret manager.
3. Deploy the configuration change.
4. Verify new traffic is arriving under the new `key_id`.
5. Revoke the old key.

Both keys are valid during the overlap window, so rotation does not require downtime. The important part is the verification step. If you revoke first and one worker group still holds the old secret, the next reservation call fails. If you verify by `key_id` first, revocation becomes a controlled cutover instead of a production surprise.

Revocation in Cycles is a status transition, not a hard delete. The key becomes `REVOKED`, requests using it fail authentication, and the record remains available so audit logs can still resolve the actor that made past calls.

That retained actor trail matters during incident response. A postmortem that says "unknown key" is weak evidence. A postmortem that says "key `production-support-agent`, tenant `acme`, revoked at 14:03 UTC after 17 denied reservations and two auth failures" is operationally useful.

## What to monitor

Least privilege is only half the control. The other half is knowing when a key behaves differently from its intended shape.

Useful signals:

| Signal | Why it matters |
|---|---|
| `api_key.auth_failed` | Invalid or revoked keys are still being used |
| `api_key.auth_failure_rate_spike` | Possible leak, stale deployment, or brute-force noise |
| `api_key.permissions_changed` | Runtime authority changed; review who changed it and why |
| Cross-tenant mismatch attempts | A key is trying to act outside its tenant boundary |
| Unexpected admin endpoint calls | Runtime workers may be carrying admin authority |

These events are more useful when each tenant and environment has its own key. A shared key turns every alert into a routing problem. A scoped key tells you which tenant, which workflow, and which deploy surface needs attention.

For on-call flows that start from runtime events and move into audit investigation, see [Operational Runbook: Using Cycles Runtime Events](/blog/operational-runbook-using-cycles-runtime-events) and [The AI Agent Audit Trail You're Already Building](/blog/runtime-authority-byproducts-audit-trail-and-attribution-by-default).

## A practical key matrix

Most teams can start with this matrix:

| Use case | Key type | Permissions |
|---|---|---|
| Production agent runtime | Tenant-scoped runtime key | Reservation lifecycle + balance read |
| Staging agent runtime | Tenant-scoped staging key | Same as production, separate secret |
| [Tenant self-service](/glossary#tenant-self-service) budget UI | Tenant-scoped key | Budget read/write, optional webhook read/write |
| Internal operator dashboard | Admin credential | Granular admin read/write as needed |
| Incident automation | Dedicated admin automation key | Only the specific admin permissions the runbook needs |

The goal is not to create hundreds of secrets for their own sake. The goal is to make the answer to "what could this key do?" narrow enough that revocation is a containment action, not a platform outage.

## The takeaway

Agent credentials should encode the authority the agent actually needs: tenant, environment, and operation. A runtime worker should be able to ask for [budget authority](/glossary#budget-authority) and commit actual usage. It should not be able to rewrite the governance plane because that was convenient during development.

Least-privilege API keys make runtime authority sharper. The server can already return ALLOW, ALLOW_WITH_CAPS, or DENY before execution. Scoped credentials make sure the caller asking for that decision is itself bounded before the request ever reaches the budget ledger.

## Related reading

- [API Key Management in Cycles](/how-to/api-key-management-in-cycles) — create, revoke, rotate, and scope keys
- [Authentication, Tenancy, and API Keys](/protocol/authentication-tenancy-and-api-keys-in-cycles) — the protocol-level auth model
- [Security Hardening](/how-to/security-hardening) — production hardening checklist
- [AI Agent Governance Dashboard](/blog/ai-agent-governance-admin-dashboard-monitor-control-budgets-risk) — operating keys, budgets, and risk limits from a governance UI
- [Zero Trust for AI Agents](/blog/zero-trust-for-ai-agents-why-every-tool-call-needs-a-policy-decision) — why every tool call needs a policy decision

## Related how-to guides

- [Multi-tenant SaaS guide](/how-to/multi-tenant-saas-with-cycles)
- [Webhook integrations](/how-to/webhook-integrations)
- [Using the Cycles dashboard](/how-to/using-the-cycles-dashboard)
