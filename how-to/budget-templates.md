---
title: "Budget Templates"
description: "Copy-paste budget setup scripts for the three most common Cycles deployment patterns: single-tenant, multi-tenant SaaS, and multi-agent with RISK_POINTS."
---

# Budget Templates

Ready-to-use setup scripts for common Cycles deployment patterns. Each template creates the tenant, budgets, and API key in one shot. Pick the pattern that matches your deployment, adjust the dollar amounts, and run.

**Prerequisites:**
- Cycles server running ([deployment guide](/quickstart/deploying-the-full-cycles-stack))
- `ADMIN_KEY` set to your admin API key
- `CYCLES_API_KEY` set to an API key with `budgets:write` permission

## Template 1: Single-Tenant (One Organization)

**Use when:** You have one organization, one set of agents, and need basic cost control. The simplest starting point.

**What it creates:**
- 1 tenant
- 1 API key (for your application)
- 1 USD budget at the tenant level ($100/month)
- 1 workspace budget for production ($80/month — leaves $20 for staging/dev)

```bash
#!/bin/bash
# Template 1: Single-Tenant Budget Setup
# Adjust: TENANT, MONTHLY_BUDGET_USD, PROD_BUDGET_USD

ADMIN_URL="http://localhost:7979"
TENANT="my-company"
MONTHLY_BUDGET_USD=100    # $100/month total
PROD_BUDGET_USD=80        # $80/month for production

# Convert to microcents (1 USD = 100,000,000 microcents)
TENANT_BUDGET=$((MONTHLY_BUDGET_USD * 100000000))
PROD_BUDGET=$((PROD_BUDGET_USD * 100000000))

echo "=== Creating tenant ==="
curl -s -X POST "$ADMIN_URL/v1/admin/tenants" \
  -H "X-Admin-API-Key: $ADMIN_KEY" \
  -H "Content-Type: application/json" \
  -d "{\"tenant_id\": \"$TENANT\", \"name\": \"My Company\"}"
echo

echo "=== Creating API key ==="
curl -s -X POST "$ADMIN_URL/v1/admin/api-keys" \
  -H "X-Admin-API-Key: $ADMIN_KEY" \
  -H "Content-Type: application/json" \
  -d "{
    \"tenant_id\": \"$TENANT\",
    \"name\": \"app-server\",
    \"permissions\": [\"reservations:create\", \"reservations:commit\", \"reservations:release\", \"reservations:extend\", \"reservations:list\", \"balances:read\"]
  }"
echo -e "\n>>> Save the key_secret value above — it won't be shown again\n"

echo "=== Creating tenant-level budget (\$${MONTHLY_BUDGET_USD}/month) ==="
curl -s -X POST "$ADMIN_URL/v1/admin/budgets" \
  -H "X-Cycles-API-Key: $CYCLES_API_KEY" \
  -H "Content-Type: application/json" \
  -d "{
    \"scope\": \"tenant:$TENANT\",
    \"unit\": \"USD_MICROCENTS\",
    \"allocated\": {\"amount\": $TENANT_BUDGET, \"unit\": \"USD_MICROCENTS\"}
  }"
echo

echo "=== Creating production workspace budget (\$${PROD_BUDGET_USD}/month) ==="
curl -s -X POST "$ADMIN_URL/v1/admin/budgets" \
  -H "X-Cycles-API-Key: $CYCLES_API_KEY" \
  -H "Content-Type: application/json" \
  -d "{
    \"scope\": \"tenant:$TENANT/workspace:production\",
    \"unit\": \"USD_MICROCENTS\",
    \"allocated\": {\"amount\": $PROD_BUDGET, \"unit\": \"USD_MICROCENTS\"}
  }"
echo

echo "=== Done ==="
echo "Tenant: $TENANT"
echo "Tenant budget: \$$MONTHLY_BUDGET_USD/month"
echo "Production budget: \$$PROD_BUDGET_USD/month"
echo "Remaining for staging/dev: \$$((MONTHLY_BUDGET_USD - PROD_BUDGET_USD))/month"
```

**Monthly reset (cron):**

```bash
# Add to crontab: 0 0 1 * * /path/to/reset-budget.sh
ADMIN_URL="http://localhost:7979"

curl -s -X POST "$ADMIN_URL/v1/admin/budgets/fund?scope=tenant:my-company&unit=USD_MICROCENTS" \
  -H "X-Cycles-API-Key: $CYCLES_API_KEY" \
  -H "Content-Type: application/json" \
  -d "{
    \"operation\": \"RESET_SPENT\",
    \"amount\": {\"amount\": 10000000000, \"unit\": \"USD_MICROCENTS\"},
    \"idempotency_key\": \"reset-$(date +%Y-%m)\",
    \"reason\": \"Monthly budget reset\"
  }"
```

---

## Template 2: Multi-Tenant SaaS (Customer Per Tenant)

**Use when:** You're building a SaaS product where each customer gets their own AI agent access with isolated budgets. The most common production pattern.

**What it creates per customer:**
- 1 tenant per customer
- 1 API key per customer
- 1 USD budget sized by plan tier
- Overdraft policy for Pro/Enterprise plans

```bash
#!/bin/bash
# Template 2: Multi-Tenant SaaS — Customer Onboarding
# Run once per new customer. Adjust: CUSTOMER_ID, PLAN

ADMIN_URL="http://localhost:7979"
CUSTOMER_ID="${1:?Usage: $0 <customer-id> <plan>}"
PLAN="${2:?Usage: $0 <customer-id> <plan>}"  # free | pro | enterprise

# Plan tier budgets (microcents)
case "$PLAN" in
  free)
    BUDGET=500000000        # $5
    OVERDRAFT=0
    OVERAGE_POLICY="REJECT"
    ;;
  pro)
    BUDGET=5000000000       # $50
    OVERDRAFT=500000000     # $5 overdraft
    OVERAGE_POLICY="ALLOW_WITH_OVERDRAFT"
    ;;
  enterprise)
    BUDGET=50000000000      # $500
    OVERDRAFT=5000000000    # $50 overdraft
    OVERAGE_POLICY="ALLOW_WITH_OVERDRAFT"
    ;;
  *)
    echo "Unknown plan: $PLAN (use: free, pro, enterprise)"
    exit 1
    ;;
esac

echo "=== Onboarding customer: $CUSTOMER_ID (plan: $PLAN) ==="

echo "--- Creating tenant ---"
curl -s -X POST "$ADMIN_URL/v1/admin/tenants" \
  -H "X-Admin-API-Key: $ADMIN_KEY" \
  -H "Content-Type: application/json" \
  -d "{\"tenant_id\": \"$CUSTOMER_ID\", \"name\": \"$CUSTOMER_ID\"}"
echo

echo "--- Creating API key ---"
curl -s -X POST "$ADMIN_URL/v1/admin/api-keys" \
  -H "X-Admin-API-Key: $ADMIN_KEY" \
  -H "Content-Type: application/json" \
  -d "{
    \"tenant_id\": \"$CUSTOMER_ID\",
    \"name\": \"$CUSTOMER_ID-app\",
    \"permissions\": [\"reservations:create\", \"reservations:commit\", \"reservations:release\", \"reservations:extend\", \"reservations:list\", \"balances:read\"]
  }"
echo -e "\n>>> Save the key_secret value above\n"

echo "--- Creating budget ledger ---"
curl -s -X POST "$ADMIN_URL/v1/admin/budgets" \
  -H "X-Cycles-API-Key: $CYCLES_API_KEY" \
  -H "Content-Type: application/json" \
  -d "{
    \"scope\": \"tenant:$CUSTOMER_ID\",
    \"unit\": \"USD_MICROCENTS\",
    \"allocated\": {\"amount\": $BUDGET, \"unit\": \"USD_MICROCENTS\"}
  }"
echo

if [ "$OVERDRAFT" -gt 0 ]; then
  echo "--- Setting overdraft policy ---"
  curl -s -X PATCH "$ADMIN_URL/v1/admin/budgets?scope=tenant:$CUSTOMER_ID&unit=USD_MICROCENTS" \
    -H "X-Admin-API-Key: $ADMIN_KEY" \
    -H "Content-Type: application/json" \
    -d "{
      \"overdraft_limit\": {\"amount\": $OVERDRAFT, \"unit\": \"USD_MICROCENTS\"},
      \"commit_overage_policy\": \"$OVERAGE_POLICY\"
    }"
  echo
fi

echo "=== Customer $CUSTOMER_ID onboarded (plan: $PLAN) ==="
```

**Usage:**
```bash
./onboard-customer.sh acme-corp pro
./onboard-customer.sh small-startup free
./onboard-customer.sh big-enterprise enterprise
```

**Plan tier reference:**

| Plan | Monthly budget | Overdraft | Overage policy |
|---|---|---|---|
| Free | $5 | $0 | REJECT |
| Pro | $50 | $5 | ALLOW_WITH_OVERDRAFT |
| Enterprise | $500 | $50 | ALLOW_WITH_OVERDRAFT |

---

## Template 3: Multi-Agent with RISK_POINTS

**Use when:** Your agents have tools with side effects (email, deploy, database mutations) and you need action-level control beyond cost. Adds a RISK_POINTS budget alongside USD.

**What it creates:**
- 1 tenant
- 1 API key
- 1 USD budget (cost control)
- 1 RISK_POINTS budget (action control — per-run)
- Per-run `RISK_POINTS` cap bounds caller-assigned exposure when every protected tool attempt uses a mandatory reservation boundary

```bash
#!/bin/bash
# Template 3: Multi-Agent with RISK_POINTS
# Adjust: TENANT, USD_BUDGET, RISK_BUDGET_PER_RUN

ADMIN_URL="http://localhost:7979"
TENANT="my-company"
USD_BUDGET=10000000000     # $100/month in microcents (1 USD = 100,000,000)
RISK_BUDGET_PER_RUN=250    # 250 RISK_POINTS per agent run

echo "=== Creating tenant ==="
curl -s -X POST "$ADMIN_URL/v1/admin/tenants" \
  -H "X-Admin-API-Key: $ADMIN_KEY" \
  -H "Content-Type: application/json" \
  -d "{\"tenant_id\": \"$TENANT\", \"name\": \"My Company\"}"
echo

echo "=== Creating API key ==="
curl -s -X POST "$ADMIN_URL/v1/admin/api-keys" \
  -H "X-Admin-API-Key: $ADMIN_KEY" \
  -H "Content-Type: application/json" \
  -d "{
    \"tenant_id\": \"$TENANT\",
    \"name\": \"app-server\",
    \"permissions\": [\"reservations:create\", \"reservations:commit\", \"reservations:release\", \"reservations:extend\", \"reservations:list\", \"balances:read\"]
  }"
echo -e "\n>>> Save the key_secret value above\n"

echo "=== Creating USD cost budget ($((USD_BUDGET / 100000000))/month) ==="
curl -s -X POST "$ADMIN_URL/v1/admin/budgets" \
  -H "X-Cycles-API-Key: $CYCLES_API_KEY" \
  -H "Content-Type: application/json" \
  -d "{
    \"scope\": \"tenant:$TENANT\",
    \"unit\": \"USD_MICROCENTS\",
    \"allocated\": {\"amount\": $USD_BUDGET, \"unit\": \"USD_MICROCENTS\"}
  }"
echo

echo "=== Creating per-run RISK_POINTS budget ($RISK_BUDGET_PER_RUN points) ==="
echo "    (Create this scope per agent run with the run ID in the scope path)"
echo "    Example: tenant:$TENANT/workflow:run-{uuid}"
echo
echo "    Use this curl as a template for your application code:"
cat << 'EXAMPLE'

# In your application, before each agent run:
RUN_ID="run-$(uuidgen)"
curl -s -X POST "$ADMIN_URL/v1/admin/budgets" \
  -H "X-Cycles-API-Key: $CYCLES_API_KEY" \
  -H "Content-Type: application/json" \
  -d "{
    \"scope\": \"tenant:my-company/workflow:$RUN_ID\",
    \"unit\": \"RISK_POINTS\",
    \"allocated\": {\"amount\": 250, \"unit\": \"RISK_POINTS\"}
  }"

EXAMPLE

echo "=== Tool scoring reference ==="
echo "    Assign these RISK_POINTS when reserving for each tool call:"
echo
echo "    search / read:           0 points (Tier 0)"
echo "    save_draft / log:        1 point  (Tier 1)"
echo "    external API / webhook:  5 points (Tier 2)"
echo "    send_email / update_db: 40 points (Tier 3, with 2x multiplier)"
echo "    deploy / payment:      150 points (Tier 4, with 3x multiplier)"
echo
echo "    Full scoring guide: https://runcycles.io/how-to/assigning-risk-points-to-agent-tools"
echo

echo "=== Done ==="
echo "USD budget: \$$(( USD_BUDGET / 100000000 ))/month (tenant-level)"
echo "RISK_POINTS budget: $RISK_BUDGET_PER_RUN points per run (create per run)"
```

**How the two budgets work together:**

| Budget | Scope | Resets | Controls |
|---|---|---|---|
| USD (cost) | `tenant:my-company` | Monthly via cron | Total API spend across all agents |
| RISK_POINTS (action) | `tenant:my-company/workflow:run-{uuid}` | Per run (new scope each time) | What tools the agent can use within one execution |

The USD budget bounds submitted spend. The `RISK_POINTS` budget separately bounds caller-assigned exposure. In this example, a mandatory handler could reserve 40 points per authorized email attempt, so six attempts consume 240 of 250 points and a seventh does not fit. Tool and argument authorization remains a host responsibility.

---

## Choosing a template

| Template | Best for | Adds | Complexity |
|---|---|---|---|
| **1. Single-Tenant** | Internal tools, solo teams, prototypes | Cost control | Low |
| **2. Multi-Tenant SaaS** | Customer-facing products with plan tiers | Cost control + tenant isolation | Medium |
| **3. Multi-Agent + RISK_POINTS** | Agents with side effects (email, deploy) | Cost + action control | Medium |

**Start with Template 1** to validate your integration. Upgrade to Template 2 when you add customers, or Template 3 when your agents need action-level governance.

## Next steps

- [Common Budget Patterns](/how-to/common-budget-patterns) — deeper patterns beyond these templates
- [Assigning RISK_POINTS to Tools](/how-to/assigning-risk-points-to-agent-tools) — scoring your tools for Template 3
- [Multi-Tenant SaaS Guide](/how-to/multi-tenant-saas-with-cycles) — full multi-tenant architecture
- [Budget Allocation and Management](/how-to/budget-allocation-and-management-in-cycles) — funding, resetting, overdraft policies
- [Shadow Mode Rollout](/how-to/shadow-mode-in-cycles-how-to-roll-out-budget-enforcement-without-breaking-production) — validate budgets before enforcing
