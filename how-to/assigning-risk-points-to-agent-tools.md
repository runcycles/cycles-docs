---
title: "How to Assign RISK_POINTS to AI Agent Tools"
description: "Step-by-step risk scoring guide: classify your AI agent's tools into risk tiers, assign RISK_POINTS scores, and set per-run budgets. Includes 25+ tool reference table."
---

# How to Assign RISK_POINTS to AI Agent Tools

This guide walks you through an illustrative method for assigning [RISK_POINTS](/glossary#risk-points) to tool attempts. Cycles treats those caller-assigned points as a budget unit; the host still authenticates the principal, authorizes the tool and arguments, and makes the reservation boundary mandatory.

For the full risk assessment framework and regulatory context, see [AI Agent Risk Assessment](/blog/ai-agent-risk-assessment-score-classify-enforce-tool-risk). This page is the implementation-focused quick reference.

**Prerequisites:**
- You know what RISK_POINTS are ([protocol reference](/protocol/understanding-units-in-cycles-usd-microcents-tokens-credits-and-risk-points))
- You have a list of tools your agent can call

## Step 1: List your tools

Start by inventorying every tool the agent can invoke. For each tool, note:

- **Name** — the function or tool name your agent calls
- **What it does** — one-sentence description
- **What it modifies** — does it read, write locally, call external APIs, mutate records, or execute irreversible actions?

Example inventory for a customer support agent:

| Tool | What it does | What it modifies |
|---|---|---|
| `search_knowledge` | Searches the knowledge base | Nothing (read-only) |
| `get_customer` | Looks up customer by ID | Nothing (read-only) |
| `save_draft_note` | Saves internal draft note | Local, reversible |
| `call_crm_api` | Reads customer data from CRM | External API (read) |
| `send_customer_email` | Sends email to customer's inbox | External, hard to reverse |
| `update_crm_status` | Updates customer status in CRM | External, hard to reverse |
| `create_jira_ticket` | Creates a Jira ticket (triggers notifications) | External, customer-visible |
| `issue_refund` | Processes a financial refund | Irreversible |

## Step 2: Classify each tool into a risk tier

Use these three questions to classify:

```
Does this tool modify any state?
├── NO → Tier 0 (Read-only)
│
└── YES
    ├── Can a human undo this in under 5 minutes?
    │   └── YES → Tier 1 (Write-local)
    │
    ├── Does it leave your system boundary (external API)?
    │   └── YES, but reversible → Tier 2 (Write-external)
    │
    ├── Does it affect someone who did not request it?
    │   (customer, external party, end user)
    │   └── YES, hard to reverse → Tier 3 (Mutation)
    │
    └── Is the change irreversible? (deploy, payment, permission grant)
        └── YES → Tier 4 (Execution)
```

The third question — **"Does it affect someone who did not request it?"** — is the key differentiator between Tier 2 (external but contained) and Tier 3 (customer-facing impact). An API call to a third-party service you control is Tier 2. An email landing in a customer's inbox is Tier 3 — even though both are external.

This guide proposes the following **starting scores**. They are not built into the server and are not a compliance standard:

| Tier | Type | Base Points | Rationale |
|:---:|---|:---:|---|
| 0 | Read-only | 0 | No side effects — reads should be free |
| 1 | Write-local | 1 | Low impact, easily reversible |
| 2 | Write-external | 5 | External dependency, some coordination to reverse |
| 3 | Mutation | 20 | Customer-facing impact, difficult to reverse |
| 4 | Execution | 50 | Irreversible, financial or production impact |

::: tip Edge cases and rules of thumb
- **If a tool matches multiple tiers, assign the highest.** A generic API tool that can both read and write should be scored at the write tier.
- **If a tool's risk varies by parameter** (e.g., a generic `call_api` used for both reads and writes), score at the highest tier it can reach, or split it into separate tool definitions.
- **If unsure, score one tier higher and validate in shadow mode.** It's cheaper to loosen a tight score than to recover from an under-scored tool causing an incident.
- **When multiplied scores produce decimals** (e.g., 5 × 1.5 = 7.5), round up to the next integer.
- The same tool in different deployments can have different tiers based on what it connects to.
:::

## Step 3: Apply risk scoring multipliers

Base points assume a generic context. Four factors adjust them for your specific deployment. **Take the maximum** of all four — they don't stack multiplicatively.

**Formula:** `Final RISK_POINTS = Base × max(Audience, Sensitivity, Regulatory, Reputational)`

### Audience size

| Audience | Multiplier |
|---|:---:|
| Internal only | 1x |
| Single external party | 1.5x |
| Customer segment (<100) | 2x |
| Broad external (100+) | 3x |

### Data sensitivity

| Sensitivity | Multiplier |
|---|:---:|
| Public data | 1x |
| Internal business data | 1.5x |
| Customer PII | 2x |
| Financial / health / regulated | 3x |

### Regulatory context

| Regulatory | Multiplier |
|---|:---:|
| No specific regulation | 1x |
| General data protection (e.g., GDPR) | 1.5x |
| Industry-specific (e.g., HIPAA, PCI-DSS, SOX) | 2x |
| Multiple overlapping regulations | 3x |

### Reputational exposure

| Exposure | Multiplier |
|---|:---:|
| Internal only | 1x |
| Single external party | 1.5x |
| Customer-facing (visible to end users) | 2x |
| Press / social media / regulatory scrutiny | 3x |

### Applying the formula

For `send_customer_email`:
- Base: Tier 3 = 20 points
- Audience: customer segment (2x)
- Sensitivity: internal business data (1.5x)
- Regulatory: none (1x)
- Reputational: customer-facing (2x)
- Max multiplier: **2x** (audience or reputational)
- Final: 20 × 2 = **40 RISK_POINTS**

## Step 4: Set your per-run budget

Sum the expected tool calls for representative runs, then choose a buffer from the variation you are prepared to allow:

1. Count how many times each tool is called in a normal agent run
2. Multiply each by its RISK_POINTS score
3. Sum the results
4. Choose a buffer from observed percentiles and the maximum tolerated exposure

**Example: Customer support agent**

| Tool | Score | Typical calls per run | Points consumed |
|---|:---:|:---:|:---:|
| `search_knowledge` | 0 | 4-6 | 0 |
| `get_customer` | 0 | 1-2 | 0 |
| `save_draft_note` | 1 | 1 | 1 |
| `call_crm_api` | 5 | 1 | 5 |
| `send_customer_email` | 40 | 1 | 40 |
| `update_crm_status` | 40 | 1 | 40 |
| `create_jira_ticket` | 20 | 0-1 | 0-20 |
| `issue_refund` | 150 | 0 (rare) | 0 |
| **Normal run total** | | | **86-106** |

Set per-run budget to **250 RISK_POINTS**:
- Normal resolution: ~86-106 points (comfortable headroom)
- Complex resolution (email + ticket + CRM update): ~106 points
- Single refund + email: 150 + 40 = 190 points (fits)
- Two refunds: 300 points (does **not** fit — requires escalation)

At a mandatory boundary, this illustrative budget would reject an attempt whose submitted points no longer fit. It does not itself determine whether a refund or email is authorized.

To enforce this per run, create the ledger at a unique workflow scope such as `workflow:run-12345` and send that run ID as `subjects.workflow` on every protected tool attempt. `run` is not a native scope, and `dimensions.run_id` is attribution only.

## Step 5: Validate with shadow mode

Before enforcing, run with [`dry_run: true`](/protocol/dry-run-shadow-mode-evaluation-in-cycles) long enough to cover representative traffic:

1. Create the RISK_POINTS budget via admin API
2. Set reservations to dry-run mode
3. Have the application log every dry-run result and actual outcome, then review the hypothetical denial rate by workflow and action class. The current server emits `reservation.denied` for denied evaluations, but that is not a complete shadow dataset.
   - A high rate can indicate scores or budgets are too tight, incomplete scoping, or genuinely abnormal traffic.
   - A low rate does not prove that the policy is effective; exercise known denial cases separately.
4. Adjust individual tool scores or the run budget based on the data
5. When denial patterns are no longer surprising, enable enforcement

See the [shadow mode rollout guide](/how-to/shadow-mode-in-cycles-how-to-roll-out-budget-enforcement-without-breaking-production) for the full process.

## Common AI agent tool classifications

Reference table for 25+ common tools. **These are starting points** — adjust based on your deployment context using the multiplier framework above.

### Tier 0 — Read-only (0 base points)

| Tool | Description | Typical final score |
|---|---|:---:|
| `search` / `search_knowledge` | Search knowledge base, vector DB | 0 |
| `get_user` / `get_customer` | Look up user/customer record | 0 |
| `read_file` | Read a local file | 0 |
| `get_weather` | Weather API lookup | 0 |
| `web_search` | Web search (Google, Bing) | 0 |
| `list_records` | List/query database records | 0 |
| `get_balance` | Check account balance | 0 |

::: tip Reads in regulated environments
If your agent handles PII, financial, or health data, consider assigning 1-2 points to sensitive read tools or tracking them under a separate budget. An agent that reads 10,000 customer records hasn't changed state, but has created a data-exposure surface.
:::

### Tier 1 — Write-local (1 base point)

| Tool | Description | Typical final score |
|---|---|:---:|
| `save_draft` | Save draft document | 1 |
| `log_event` | Write to application log | 1 |
| `update_cache` | Update local cache | 1 |
| `save_note` / `add_internal_note` | Save internal note | 1-2 |

### Tier 2 — Write-external (5 base points)

| Tool | Description | Typical final score |
|---|---|:---:|
| `call_external_api` | Generic third-party API call | 5-10 |
| `webhook_post` | Fire a webhook | 5-10 |
| `post_to_internal_slack` | Post to an internal Slack channel | 5 |
| `generate_image` | Generate image via API (Stable Diffusion, DALL-E) | 5-10 |
| `generate_video` | Generate video via API | 10-15 |

### Tier 3 — Mutation (20 base points)

| Tool | Description | Typical final score |
|---|---|:---:|
| `send_email` / `send_customer_email` | Send email to customer | 40-60 |
| `create_jira_ticket` / `create_support_ticket` | Create ticket (triggers customer-visible notifications) | 20-40 |
| `send_external_slack` | Post to customer-shared Slack channel | 40-60 |
| `update_record` / `update_crm` | Update database/CRM record | 20-40 |
| `delete_record` | Delete a database record | 40-60 |
| `create_calendar_event` | Schedule meeting on someone's calendar | 20-40 |
| `update_subscription` | Modify a customer's subscription | 40-60 |

### Tier 4 — Execution (50 base points)

| Tool | Description | Typical final score |
|---|---|:---:|
| `deploy` / `trigger_deploy` | Deploy to production | 100-150 |
| `execute_payment` / `issue_refund` | Process financial transaction | 100-150 |
| `grant_permission` | Modify access control | 100-150 |
| `execute_code` | Run arbitrary code | 100 |
| `delete_database` | Drop a table or database | 150 |
| `modify_infrastructure` | Change cloud infrastructure (scaling, networking) | 100-150 |

## Worked example: Risk scoring an AI agent from scratch

A data analysis agent with these tools:

1. **`query_database`** — reads data → Tier 0, 0 points
2. **`web_search`** — external search → Tier 0, 0 points (read-only)
3. **`generate_chart`** — calls chart API → Tier 2, 5 points (external, reversible)
4. **`send_report_email`** — emails stakeholders → Tier 3, 20 × 2x (customer segment audience) = **40 points**
5. **`update_dashboard`** — writes to internal dashboard → Tier 1, 1 point (easily reversible)
6. **`export_to_s3`** — writes file to S3 bucket → Tier 2, 5 × 1.5x (internal business data) ≈ **8 points** (round up)

Typical run: 10 queries (0) + 3 searches (0) + 2 charts (10) + 1 email (40) + 1 dashboard update (1) + 1 export (8) = **59 points**

Set run budget: **100 RISK_POINTS** — at a mandatory boundary, the third 40-point report attempt would not fit after two such attempts, assuming no other point consumption.

## When to recalibrate risk scores

Review your scores when:

- **A new tool is added.** Classify and score it before deployment.
- **An incident occurs.** If a tool caused damage, re-evaluate its tier and multiplier.
- **Usage patterns shift.** If shadow mode shows agents consistently near the budget ceiling on normal runs, the budget is too tight — raise it or optimize the workflow.
- **The consequence model changes.** Revisit scores when a tool gains new destinations, broader permissions, more sensitive data, or a larger audience.

## Next steps

- [Budget Allocation and Management](/how-to/budget-allocation-and-management-in-cycles) — configure your scored tool list and budget via the admin API
- [Common Budget Patterns](/how-to/common-budget-patterns) — per-tenant, per-workflow, per-run budget structures
- [Shadow Mode Rollout](/how-to/shadow-mode-in-cycles-how-to-roll-out-budget-enforcement-without-breaking-production) — validating scores before enforcing
- [Degradation Paths](/how-to/how-to-think-about-degradation-paths-in-cycles-deny-downgrade-disable-or-defer) — what agents should do when risk budget runs low
- [AI Agent Risk Assessment](/blog/ai-agent-risk-assessment-score-classify-enforce-tool-risk) — the full framework deep-dive with regulatory context
- [Event Payloads Reference](/protocol/event-payloads-reference) — monitoring commit overage and denial events
