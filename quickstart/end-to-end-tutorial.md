---
title: "End-to-End Tutorial: Zero to Budget-Guarded LLM Call"
description: "Go from zero to a working budget-guarded OpenAI call in 10 minutes by deploying Cycles, creating a tenant, funding a budget, and making your first LLM call."
---

# End-to-End Tutorial: Zero to Budget-Guarded LLM Call

This tutorial takes you from nothing to a working budget-guarded OpenAI call in about 10 minutes. You will deploy the Cycles stack, create a tenant, fund a budget, and make your first budget-enforced LLM call.

::: tip Want to see Cycles in action before building?
Check out the [Demos](/demos/) — self-contained scenarios you can run in 60 seconds, no LLM key required.
:::

## Prerequisites

- **Docker** and **Docker Compose v2+**
- **Python 3.10+** or **Node.js 20+** (for the application step)
- An **OpenAI API key** (for the final step — or use the mock tabs below if you don't have one)

## Quick code preview

Want to see what Cycles integration looks like before setting up the stack? Here is the complete pattern:

::: code-group
```python [Python]
from runcycles import CyclesClient, CyclesConfig, cycles, set_default_client

client = CyclesClient(CyclesConfig(
    base_url="http://localhost:7878",  # Cycles server
    api_key="cyc_live_...",            # from the admin API
    tenant="my-app",
))
set_default_client(client)

@cycles(estimate=2000000, action_kind="llm.completion", action_name="openai:gpt-4o-mini")
def ask(prompt: str) -> str:
    return call_your_llm(prompt)  # any LLM provider

result = ask("Hello")  # Budget reserved → LLM called → cost committed
```
```typescript [TypeScript]
import { CyclesClient, CyclesConfig, withCycles, setDefaultClient } from "runcycles";

const client = new CyclesClient(new CyclesConfig({
  baseUrl: "http://localhost:7878",
  apiKey: "cyc_live_...",
  tenant: "my-app",
}));
setDefaultClient(client);

const ask = withCycles(
  { estimate: 2000000, actionKind: "llm.completion", actionName: "openai:gpt-4o-mini" },
  async (prompt: string) => callYourLlm(prompt),
);

const result = await ask("Hello");  // Budget reserved → LLM called → cost committed
```
:::

::: info
This code requires a running Cycles server. The tutorial below walks you through setting one up with Docker in about 2 minutes. If you just want to see a demo without any setup, check the [Demos](/demos/) page instead.
:::

## Step 1: Start the Cycles stack

Create a `docker-compose.yml` and start the infrastructure:

```bash
cat > docker-compose.yml <<'COMPOSE'
services:
  redis:
    image: redis:7-alpine
    ports: ["6379:6379"]
    command: redis-server --appendonly yes
    healthcheck:
      test: ["CMD", "redis-cli", "ping"]
      interval: 5s
      timeout: 3s
      retries: 5
  cycles-admin:
    image: ghcr.io/runcycles/cycles-server-admin:0.1.25.41
    ports: ["7979:7979"]
    environment:
      REDIS_HOST: redis
      REDIS_PORT: 6379
      REDIS_PASSWORD: ""
      ADMIN_API_KEY: admin-bootstrap-key
    depends_on:
      redis: { condition: service_healthy }
  cycles-server:
    image: ghcr.io/runcycles/cycles-server:0.1.25.39
    ports: ["7878:7878"]
    environment:
      REDIS_HOST: redis
      REDIS_PORT: 6379
      REDIS_PASSWORD: ""
    depends_on:
      redis: { condition: service_healthy }
COMPOSE

docker compose up -d
```

Wait for services to be healthy:

```bash
until curl -sf http://localhost:7878/actuator/health > /dev/null 2>&1; do sleep 1; done
until curl -sf http://localhost:7979/actuator/health > /dev/null 2>&1; do sleep 1; done
echo "Cycles is running."
```

## Step 2: Create a tenant

::: info Two authentication headers
Steps 2-3 use `X-Admin-API-Key` — the static bootstrap secret set in docker-compose (`ADMIN_API_KEY`). Steps 4-5 switch to `X-Cycles-API-Key` — the tenant-scoped key created in Step 3. See [Authentication](/quickstart/architecture-overview-how-cycles-fits-together#authentication) for why.
:::

```bash
curl -s -X POST http://localhost:7979/v1/admin/tenants \
  -H "Content-Type: application/json" \
  -H "X-Admin-API-Key: admin-bootstrap-key" \
  -d '{"tenant_id": "my-app", "name": "My Application"}' | jq .
```

## Step 3: Create an API key

```bash
API_KEY=$(curl -s -X POST http://localhost:7979/v1/admin/api-keys \
  -H "Content-Type: application/json" \
  -H "X-Admin-API-Key: admin-bootstrap-key" \
  -d '{
    "tenant_id": "my-app",
    "name": "tutorial-key",
    "permissions": ["reservations:create","reservations:commit","reservations:release","reservations:extend","reservations:list","balances:read","admin:write"]
  }' | jq -r '.key_secret')

echo "Your API key: $API_KEY"
```

Save this key — the secret is only shown once.

## Step 4: Create a budget

Give the tenant $1.00 (100,000,000 microcents) to spend:

```bash
curl -s -X POST http://localhost:7979/v1/admin/budgets \
  -H "Content-Type: application/json" \
  -H "X-Cycles-API-Key: $API_KEY" \
  -d '{
    "scope": "tenant:my-app",
    "unit": "USD_MICROCENTS",
    "allocated": { "amount": 100000000, "unit": "USD_MICROCENTS" }
  }' | jq .
```

## Step 5: Verify with a raw HTTP test

Before adding an SDK, confirm the lifecycle works with curl:

```bash
# Reserve
RESERVATION_ID=$(curl -s -X POST http://localhost:7878/v1/reservations \
  -H "Content-Type: application/json" \
  -H "X-Cycles-API-Key: $API_KEY" \
  -d '{
    "idempotency_key": "tutorial-001",
    "subject": {"tenant": "my-app"},
    "action": {"kind": "llm.completion", "name": "test"},
    "estimate": {"amount": 500000, "unit": "USD_MICROCENTS"},
    "ttl_ms": 30000
  }' | jq -r '.reservation_id')
echo "Reserved: $RESERVATION_ID"

# Commit
curl -s -X POST "http://localhost:7878/v1/reservations/$RESERVATION_ID/commit" \
  -H "Content-Type: application/json" \
  -H "X-Cycles-API-Key: $API_KEY" \
  -d '{"idempotency_key": "tutorial-commit-001", "actual": {"amount": 350000, "unit": "USD_MICROCENTS"}}' | jq .

# Check balance
curl -s "http://localhost:7878/v1/balances?tenant=my-app" \
  -H "X-Cycles-API-Key: $API_KEY" | jq .
```

You should see `"decision": "ALLOW"`, then `"status": "COMMITTED"`, then a balance with `spent` of 350,000 and the remaining budget reduced accordingly.

## Step 6: Build a budget-guarded application

Choose your language:

::: code-group
```python [Python]
# Install: pip install runcycles openai
# Save as app.py

import os
from openai import OpenAI
from runcycles import CyclesClient, CyclesConfig, cycles, set_default_client

# Configure Cycles
cycles_client = CyclesClient(CyclesConfig(
    base_url="http://localhost:7878",
    api_key=os.environ["CYCLES_API_KEY"],
    tenant="my-app",
))
set_default_client(cycles_client)

# Configure OpenAI
openai_client = OpenAI()

@cycles(
    estimate=2000000,  # Reserve $0.02 per call
    action_kind="llm.completion",
    action_name="openai:gpt-4o-mini",
)
def ask(prompt: str) -> str:
    response = openai_client.chat.completions.create(
        model="gpt-4o-mini",
        messages=[{"role": "user", "content": prompt}],
        max_tokens=500,
    )
    return response.choices[0].message.content

# Run it
try:
    result = ask("What is budget governance for AI agents? Reply in one sentence.")
    print(f"Response: {result}")
except Exception as e:
    print(f"Error: {e}")
```
```typescript [TypeScript]
// Install: npm init -y && npm install runcycles openai
// Save as app.ts

import OpenAI from "openai";
import { CyclesClient, CyclesConfig, withCycles, setDefaultClient } from "runcycles";

const cyclesClient = new CyclesClient(new CyclesConfig({
  baseUrl: "http://localhost:7878",
  apiKey: process.env.CYCLES_API_KEY!,
  tenant: "my-app",
}));
setDefaultClient(cyclesClient);

const openai = new OpenAI();

const ask = withCycles(
  {
    estimate: 2000000,
    actionKind: "llm.completion",
    actionName: "openai:gpt-4o-mini",
  },
  async (prompt: string) => {
    const response = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [{ role: "user", content: prompt }],
      max_tokens: 500,
    });
    return response.choices[0].message.content;
  },
);

const result = await ask("What is budget governance for AI agents? Reply in one sentence.");
console.log("Response:", result);
```
```python [Python (mock)]
# Install: pip install runcycles
# Save as app_mock.py — no OpenAI key needed

import os
from runcycles import CyclesClient, CyclesConfig, cycles, set_default_client

# Configure Cycles
cycles_client = CyclesClient(CyclesConfig(
    base_url="http://localhost:7878",
    api_key=os.environ["CYCLES_API_KEY"],
    tenant="my-app",
))
set_default_client(cycles_client)

@cycles(
    estimate=2000000,  # Reserve $0.02 per call
    action_kind="llm.completion",
    action_name="mock:gpt-4o-mini",
)
def ask(prompt: str) -> str:
    # Simulated LLM response — no API key required
    return f"[Mock response to: {prompt[:50]}]"

# Run it
try:
    result = ask("What is budget governance for AI agents? Reply in one sentence.")
    print(f"Response: {result}")
except Exception as e:
    print(f"Error: {e}")
```
```typescript [TypeScript (mock)]
// Install: npm init -y && npm install runcycles
// Save as app_mock.ts — no OpenAI key needed

import { CyclesClient, CyclesConfig, withCycles, setDefaultClient } from "runcycles";

const cyclesClient = new CyclesClient(new CyclesConfig({
  baseUrl: "http://localhost:7878",
  apiKey: process.env.CYCLES_API_KEY!,
  tenant: "my-app",
}));
setDefaultClient(cyclesClient);

const ask = withCycles(
  {
    estimate: 2000000,
    actionKind: "llm.completion",
    actionName: "mock:gpt-4o-mini",
  },
  async (prompt: string) => {
    // Simulated LLM response — no API key required
    return `[Mock response to: ${prompt.slice(0, 50)}]`;
  },
);

const result = await ask("What is budget governance for AI agents? Reply in one sentence.");
console.log("Response:", result);
```
:::

::: tip No OpenAI key?
The **mock tabs** replace the OpenAI call with a stub that returns a fixed string. The Cycles budget lifecycle (reserve → commit → balance deduction) works exactly the same — you just skip the LLM cost.
:::

Run it:

```bash
export CYCLES_API_KEY="cyc_live_..."   # your key from Step 3

# With OpenAI:
export OPENAI_API_KEY="sk-..."
python app.py                           # or: npx tsx app.ts

# Without OpenAI (mock):
python app_mock.py                      # or: npx tsx app_mock.ts
```

## Step 7: Watch the budget decrease

After running your app, check the balance again:

```bash
curl -s "http://localhost:7878/v1/balances?tenant=my-app" \
  -H "X-Cycles-API-Key: $API_KEY" | jq '.balances[] | {scope, remaining, spent, reserved}'
```

You'll see `spent` has increased by the actual usage from your LLM call, and `remaining` has decreased.

## Step 8: See what happens when budget runs out

Try exhausting the budget to see enforcement in action. Set a tiny budget on a new scope:

```bash
curl -s -X POST http://localhost:7979/v1/admin/budgets \
  -H "Content-Type: application/json" \
  -H "X-Cycles-API-Key: $API_KEY" \
  -d '{
    "scope": "tenant:my-app/workspace:demo",
    "unit": "USD_MICROCENTS",
    "allocated": { "amount": 100, "unit": "USD_MICROCENTS" }
  }' | jq .
```

Now try to reserve more than the budget:

```bash
curl -s -X POST http://localhost:7878/v1/reservations \
  -H "Content-Type: application/json" \
  -H "X-Cycles-API-Key: $API_KEY" \
  -d '{
    "idempotency_key": "exceed-001",
    "subject": {"tenant": "my-app", "workspace": "demo"},
    "action": {"kind": "llm.completion", "name": "test"},
    "estimate": {"amount": 500000, "unit": "USD_MICROCENTS"},
    "ttl_ms": 30000
  }' | jq .
```

You'll see `"error": "BUDGET_EXCEEDED"` — the call was blocked *before* any money was spent.

## Cleanup

```bash
docker compose down -v
```

## Common issues

- **`Cannot connect to the Docker daemon`** — Docker Desktop isn't running. Start it and re-run `docker compose up -d`.
- **`bind: address already in use` on port 7878 or 7979** — another service is using these ports. Either stop it, or remap the ports in `docker-compose.yml` (e.g. `"17878:7878"`) and update the curl URLs accordingly.
- **`401 Unauthorized` on Step 2 or 3** — you're using `X-Cycles-API-Key` instead of `X-Admin-API-Key`. Bootstrap calls (creating tenants and API keys) require the admin header. Tenant calls (Steps 4–8) use the Cycles header.
- **`jq: command not found`** — install jq (`brew install jq` on macOS, `apt install jq` on Debian/Ubuntu, `winget install jqlang.jq` on Windows). Or pipe to `python -m json.tool` instead.
- **`tenant_id mismatch` or `tenant not found`** — every step uses `my-app` as the tenant ID. If you changed it in Step 2, update it everywhere else too (including the `subject.tenant` field in reservations).
- **Healthcheck loop never returns** — the `until curl -sf ...` loop is waiting for `/actuator/health` to return 200. Check `docker compose logs cycles-server` for startup errors (most often a Redis connection issue).

## Next steps

::: tip Want real-time budget alerts?
The tutorial above deploys the core budget enforcement stack. To receive webhook notifications when budgets run out, thresholds are crossed, or reservations are denied, add the optional events service. It takes 2 minutes.
:::

- [Deploy the Events Service](/quickstart/deploying-the-events-service) — get Slack, PagerDuty, or custom webhook alerts for budget events
- [Python Client Quickstart](/quickstart/getting-started-with-the-python-client) — `@cycles` decorator deep dive
- [TypeScript Client Quickstart](/quickstart/getting-started-with-the-typescript-client) — `withCycles` wrapper deep dive
- [Spring Boot Quickstart](/quickstart/getting-started-with-the-cycles-spring-boot-starter) — `@Cycles` annotation deep dive
- [Demos](/demos/) — see Cycles in action with the runaway agent and action authority scenarios
- [Choose a First Rollout](/quickstart/how-to-choose-a-first-cycles-rollout-tenant-budgets-run-budgets-or-model-call-guardrails) — decide your adoption strategy
- [Adding Cycles to an Existing Application](/how-to/adding-cycles-to-an-existing-application) — integrate incrementally
- [Cost Estimation Cheat Sheet](/how-to/cost-estimation-cheat-sheet) — how much to reserve per model call
