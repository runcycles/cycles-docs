---
title: "One Customer's Runaway Agent Shouldn't Affect Your Other 500"
description: "Use mandatory tenant-scoped Cycles budgets to contain covered agent spend per customer, with correct provisioning, routing, estimates, and settlement behavior."
---

# One Customer's Runaway Agent Shouldn't Affect Your Other 500

Consider an illustrative AI copilot serving 500 customers. Customer #47 triggers a research loop whose agent makes 3,000 LLM calls in an hour — 50 times the modeled average session.

Without per-tenant isolation, Customer #47's session burns through the shared API budget. Your provider's org-wide spending cap kicks in and blocks **every customer** — including the 499 who did nothing wrong. Your status page goes red. Support tickets flood in. The incident post-mortem reveals a $2,800 bill for one tenant's session.

This isn't a scaling problem. It's an isolation problem.

## Why shared controls fail for multi-tenant

**Provider identities may not match your tenants.** Project, workspace, and key controls can help, but a provider does not infer which of 500 application customers caused spend behind a shared identity. A hard provider stop at that shared scope can affect all of them.

**Rate limits are per-key, not per-tenant.** If all customers share an API key (common in SaaS), one customer's burst consumes the rate limit for everyone. If each customer has their own key, you're managing 500 API keys at the provider level — and still have no budget enforcement.

**Application-level counters break under concurrency.** Twenty agents reading "remaining: $500" simultaneously will all proceed. By the time they commit, you've spent $2,000. The counter was right when each agent checked. It was wrong by the time they all acted.

## How Cycles fixes it

An application can map each customer to a Cycles tenant, provision separate budgets and API keys, and submit the correct tenant subject on every protected call. The protocol atomically enforces applicable budget scopes; the application remains responsible for secure tenant derivation and complete routing.

```python
# Your onboarding logic (see Multi-Tenant SaaS Guide for full implementation)
onboard_customer("customer-47", plan="pro")  # creates tenant + API key + $50/month budget

# Every agent call is scoped to the requesting tenant — the callable
# is evaluated per call, at reservation time
@cycles(
    estimate=2_000_000,
    action_kind="llm.completion",
    action_name="gpt-4o",
    tenant=lambda request, prompt: request.headers["X-Tenant-ID"],
)
async def handle_chat(request: Request, prompt: str) -> str:
    ...
```

When Customer #47's submitted spend reaches $50, the next over-budget live reservation returns an error. If every protected path uses the correct tenant scope, Customer #48 through #500 retain their separate Cycles allocations. The upstream provider account may still be shared, so provider-wide limits remain a separate dependency.

## What happens now

- **Covered budget impact contained.** Correctly scoped mandatory paths cannot consume another tenant's Cycles allocation.
- **Per-customer limits map to plan tiers.** Free: $5/month. Pro: $50/month. Enterprise: $500/month. The budget authority enforces what the billing system promises.
- **Concurrency safe.** Atomic reservations prevent the classic race condition where 20 parallel agents all read "budget available" and all proceed. Cycles locks the budget before execution.
- **Graceful degradation per tenant.** When a live reservation fails, the host can downgrade the model, show an upgrade prompt, or queue work for later.

## The math

| | Shared budget | Per-tenant with Cycles |
|---|---|---|
| Customer #47's session | $2,800 from shared pool | $50 from their own budget |
| Impact on other customers | Shared provider identity can affect all tenants when its hard boundary binds | Separate Cycles allocations remain; provider-wide dependencies still apply |
| Time to detect | Depends on provider alert or cutoff semantics | At the first rejected over-budget live reservation |
| Recovery | Manually increase cap, apologize to 499 customers | Customer #47 sees upgrade prompt |
| Covered gross-margin exposure | Shared across tenants | Submitted estimates bounded per tenant on mandatory paths |

## Beyond budget: per-tenant action authority

The same scope isolation can apply to caller-assigned action exposure. If the host authorizes an email, assigns it a risk amount, and reserves against the correct tenant, one tenant cannot consume another tenant's risk-point budget. Tool permissions, recipient validation, and exact action counts remain application concerns.

```
Customer #47 (Pro plan)
├── Budget: $50/month (USD_MICROCENTS)
├── Action authority: 500 risk points/month (RISK_POINTS)
├── Workspace: prod
│   ├── Agent: support-bot (200 risk points)
│   └── Agent: researcher (300 risk points)
└── Workspace: staging (separate budget)

Customer #48 (Enterprise plan)
├── Budget: $500/month
├── Action authority: 5,000 risk points/month
└── ...completely independent
```

## Go deeper

- [Multi-Tenant SaaS Guide](/how-to/multi-tenant-saas-with-cycles) — end-to-end implementation with onboarding, plan tiers, and billing
- [Scope Derivation](/protocol/how-scope-derivation-works-in-cycles) — how hierarchical budget scopes work
- [Tenant Creation and Management](/how-to/tenant-creation-and-management-in-cycles) — Admin API for tenant lifecycle
- [Concurrent Agent Overspend](/incidents/concurrent-agent-overspend) — the incident pattern Cycles prevents
- [Multi-Tenant AI Cost Control](/blog/multi-tenant-ai-cost-control-per-tenant-budgets-quotas-isolation) — strategic analysis
