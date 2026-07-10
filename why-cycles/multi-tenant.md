---
title: "One Customer's Runaway Agent Shouldn't Affect Your Other 500"
description: "In a multi-tenant AI SaaS, one customer's agent loop can exhaust shared API budgets, starve other tenants, and blow through your gross margin. Cycles isolates every customer."
---

# One Customer's Runaway Agent Shouldn't Affect Your Other 500

You ship an AI copilot to 500 customers. Customer #47 discovers a prompt that triggers a research loop. Their agent makes 3,000 LLM calls in an hour — well within the prompt's intent, but 50x the average session.

Without per-tenant isolation, Customer #47's session burns through the shared API budget. Your provider's org-wide spending cap kicks in and blocks **every customer** — including the 499 who did nothing wrong. Your status page goes red. Support tickets flood in. The incident post-mortem reveals a $2,800 bill for one tenant's session.

This isn't a scaling problem. It's an isolation problem.

## Why shared controls fail for multi-tenant

**Provider spending caps are org-wide.** Your provider's monthly limit doesn't know which of your 500 customers triggered the spend. When it fires, it blocks all of them.

**Rate limits are per-key, not per-tenant.** If all customers share an API key (common in SaaS), one customer's burst consumes the rate limit for everyone. If each customer has their own key, you're managing 500 API keys at the provider level — and still have no budget enforcement.

**Application-level counters break under concurrency.** Twenty agents reading "remaining: $500" simultaneously will all proceed. By the time they commit, you've spent $2,000. The counter was right when each agent checked. It was wrong by the time they all acted.

## How Cycles fixes it

Each customer maps to a Cycles tenant. Each tenant has its own budget, its own API key, and its own scope hierarchy — enforced atomically by the protocol.

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

When Customer #47's agent hits $50, their next reservation is denied. Customer #48 through #500 are unaffected — their budgets are independent. No shared caps. No cross-tenant interference.

## What happens now

- **Blast radius contained.** One customer's runaway agent can only burn their own budget. Other tenants continue operating normally.
- **Per-customer limits map to plan tiers.** Free: $5/month. Pro: $50/month. Enterprise: $500/month. The budget authority enforces what the billing system promises.
- **Concurrency safe.** Atomic reservations prevent the classic race condition where 20 parallel agents all read "budget available" and all proceed. Cycles locks the budget before execution.
- **Graceful degradation per tenant.** When Customer #47 hits their limit, their agent can downgrade to a cheaper model, show an upgrade prompt, or queue work for later — while every other tenant continues at full quality.

## The math

| | Shared budget | Per-tenant with Cycles |
|---|---|---|
| Customer #47's session | $2,800 from shared pool | $50 from their own budget |
| Impact on other customers | All blocked by provider cap | None |
| Time to detect | When provider cap fires | Immediately (reservation denied) |
| Recovery | Manually increase cap, apologize to 499 customers | Customer #47 sees upgrade prompt |
| Gross margin | Unpredictable — one tenant can destroy it | Bounded per tenant |

## Beyond budget: per-tenant action authority

The same isolation applies to actions. Customer #47's agent can send 10 emails. Customer #48's agent can send 10 emails. They can't share, borrow, or exhaust each other's action authority — even if both agents run on the same infrastructure.

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
