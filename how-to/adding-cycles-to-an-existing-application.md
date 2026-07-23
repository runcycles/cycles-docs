---
title: "Adding Cycles to an Existing Application"
description: "Incrementally adopt Cycles budget governance in an existing application using shadow mode, single-call wrapping, and staged enforcement."
---

# Adding Cycles to an Existing Application

This guide covers how to incrementally add budget governance to an application that already makes LLM or API calls. Rather than rewriting your integration layer, you can adopt Cycles in stages.

::: tip MCP-compatible agents
If your agent runs in Claude Desktop, Claude Code, Cursor, or Windsurf, the fastest path is the [Cycles MCP Server](/quickstart/getting-started-with-the-mcp-server) — zero code changes needed. The guide below covers SDK-based integration for application code.
:::

::: tip Spring Boot / Java
This guide shows Python and TypeScript. For Spring Boot, equivalent patterns use the `@Cycles` annotation — see the [Spring Boot Quickstart](/quickstart/getting-started-with-the-cycles-spring-boot-starter) for full setup and examples.
:::

## The incremental adoption path

```
1. Shadow mode     →  Observe what enforcement would do, without blocking anything
2. Wrap one call   →  Add budget governance to a single LLM call path
3. Expand coverage →  Wrap additional call paths
4. Enforce         →  Switch from shadow mode to live enforcement
```

## Stage 1: Deploy Cycles and observe with the decide endpoint

Start by deploying the Cycles stack and using the **decide endpoint** as a side-channel to observe what budget decisions would be made without blocking any calls.

::: warning Important
The `dry_run` flag on the `@cycles` decorator / `withCycles` HOF skips executing the wrapped function entirely (it returns a `DryRunResult` instead). For shadow observation where your existing code still runs, use the `decide` endpoint separately.
:::

::: code-group
```python [Python]
import logging
import uuid

from runcycles import CyclesClient, CyclesConfig

logger = logging.getLogger(__name__)

config = CyclesConfig.from_env()
client = CyclesClient(config)

def existing_chat_function(prompt: str) -> str:
    # Observe: check what Cycles would decide, but don't block
    try:
        decision = client.decide({
            "idempotency_key": str(uuid.uuid4()),
            "subject": {"tenant": config.tenant},
            "action": {"kind": "llm.completion", "name": "openai:gpt-4o"},
            "estimate": {"amount": 2000000, "unit": "USD_MICROCENTS"},
        })
        logger.info("Cycles decision: %s", decision.get_body_attribute("decision"))
    except Exception:
        pass  # Don't let observation failures affect production

    # Your existing code — completely unchanged
    return call_openai(prompt)
```
```typescript [TypeScript]
import { CyclesClient, CyclesConfig } from "runcycles";

const client = new CyclesClient(CyclesConfig.fromEnv());

async function existingChatFunction(prompt: string) {
  // Observe: check what Cycles would decide, but don't block
  try {
    // The client posts wire-format (snake_case) bodies verbatim
    const decision = await client.decide({
      idempotency_key: crypto.randomUUID(),
      subject: { tenant: client.config.tenant! },
      action: { kind: "llm.completion", name: "openai:gpt-4o" },
      estimate: { amount: 2000000, unit: "USD_MICROCENTS" },
    });
    console.log("Cycles decision:", decision.body?.decision);
  } catch {
    // Don't let observation failures affect production
  }

  // Your existing code — completely unchanged
  return await callOpenAI(prompt);
}
```
:::

This approach lets you observe decisions in production logs while your existing code continues to run unmodified. Use the data to tune budgets before moving to enforcement.

See [Shadow Mode Rollout](/how-to/shadow-mode-in-cycles-how-to-roll-out-budget-enforcement-without-breaking-production) for the full guide on dry-run evaluation at the protocol level.

## Stage 2: Wrap your first call

Pick the highest-value call path to wrap first. Good candidates:

- The call that costs the most per invocation (e.g., GPT-4o or Claude Opus)
- The call that runs most frequently
- The call most likely to loop or retry

### Wrapping an existing function

**Before:**

::: code-group
```python [Python]
def generate_summary(document: str) -> str:
    response = openai.chat.completions.create(
        model="gpt-4o",
        messages=[{"role": "user", "content": f"Summarize: {document}"}],
        max_tokens=2000,
    )
    return response.choices[0].message.content
```
```typescript [TypeScript]
async function generateSummary(document: string): Promise<string> {
  const response = await openai.chat.completions.create({
    model: "gpt-4o",
    messages: [{ role: "user", content: `Summarize: ${document}` }],
    max_tokens: 2000,
  });
  return response.choices[0].message.content!;
}
```
:::

**After:**

::: code-group
```python [Python]
from runcycles import cycles

@cycles(
    estimate=lambda document: int((len(document) / 4 * 250 + 2000 * 1000) * 1.2),
    action_kind="llm.completion",
    action_name="openai:gpt-4o",
)
def generate_summary(document: str) -> str:
    response = openai.chat.completions.create(
        model="gpt-4o",
        messages=[{"role": "user", "content": f"Summarize: {document}"}],
        max_tokens=2000,
    )
    return response.choices[0].message.content
```
```typescript [TypeScript]
import { withCycles } from "runcycles";

const generateSummary = withCycles(
  {
    estimate: (document: string) => Math.ceil((document.length / 4 * 250 + 2000 * 1000) * 1.2),
    actionKind: "llm.completion",
    actionName: "openai:gpt-4o",
  },
  async (document: string) => {
    const response = await openai.chat.completions.create({
      model: "gpt-4o",
      messages: [{ role: "user", content: `Summarize: ${document}` }],
      max_tokens: 2000,
    });
    return response.choices[0].message.content!;
  },
);
```
```java [Spring Boot]
import io.runcycles.client.java.spring.annotation.Cycles;

// The estimate is a raw SpEL expression — no #{...} template wrapper
@Cycles(value = "T(Math).ceil((#document.length() / 4 * 250 + 2000 * 1000) * 1.2)",
        actionKind = "llm.completion", actionName = "openai:gpt-4o")
public String generateSummary(String document) {
    // Same OpenAI call — business logic unchanged
    return openAiClient.chat(document);
}
```
:::

The only change is adding the `@cycles` decorator (Python), `withCycles` wrapper (TypeScript), or `@Cycles` annotation (Spring Boot). Your business logic stays exactly the same.

### Handling budget denial

Your existing error handling needs one new branch — what to do when budget is denied:

::: code-group
```python [Python]
from runcycles import BudgetExceededError

try:
    result = generate_summary(document)
except BudgetExceededError:
    # Option A: Return a graceful fallback
    result = "Summary unavailable — budget limit reached."
    # Option B: Use a cheaper model
    result = generate_summary_cheap(document)
    # Option C: Queue for later
    queue_for_retry(document)
```
```typescript [TypeScript]
import { BudgetExceededError } from "runcycles";

let result: string;

try {
  result = await generateSummary(document);
} catch (err) {
  if (!(err instanceof BudgetExceededError)) {
    throw err;
  }
  // Option A: Return a graceful fallback
  result = "Summary unavailable — budget limit reached.";
  // Option B: Use a cheaper model
  result = await generateSummaryCheap(document);
  // Option C: Queue for later
  queueForRetry(document);
}
```
```java [Spring Boot]
import io.runcycles.client.java.spring.model.CyclesProtocolException;

String result;

try {
    result = summaryService.generateSummary(document);
} catch (CyclesProtocolException e) {
    if (!e.isBudgetExceeded()) {
        throw e;
    }
    // Option A: Return a graceful fallback
    result = "Summary unavailable — budget limit reached.";
    // Option B: Use a cheaper model
    result = summaryService.generateSummaryCheap(document);
    // Option C: Queue for later
    queueForRetry(document);
}
```
:::

See [Degradation Paths](/how-to/how-to-think-about-degradation-paths-in-cycles-deny-downgrade-disable-or-defer) for a full treatment of fallback strategies.

## Stage 3: Expand coverage

Once the first call path is working, wrap additional calls. Use a consistent pattern:

::: code-group
```python [Python]
@cycles(estimate=500000, action_kind="llm.completion", action_name="openai:gpt-4o-mini")
def classify_intent(text: str) -> str:
    ...

@cycles(estimate=3000000, action_kind="llm.completion", action_name="openai:gpt-4o")
def generate_response(context: str, intent: str) -> str:
    ...

@cycles(estimate=100000, action_kind="tool.call", action_name="web-search")
def search_web(query: str) -> list:
    ...
```
```typescript [TypeScript]
const classifyIntent = withCycles(
  { estimate: 500000, actionKind: "llm.completion", actionName: "openai:gpt-4o-mini" },
  async (text: string) => { ... },
);

const generateResponse = withCycles(
  { estimate: 3000000, actionKind: "llm.completion", actionName: "openai:gpt-4o" },
  async (context: string, intent: string) => { ... },
);

const searchWeb = withCycles(
  { estimate: 100000, actionKind: "tool.call", actionName: "web-search" },
  async (query: string) => { ... },
);
```
:::

Each wrapped function reserves independently. If the agent calls all three in sequence, the total budget consumed is the sum of actual usage — and each call is individually authorized before it runs.

## Stage 4: Switch to live enforcement

Wrapped calls enforce immediately unless `dry_run` is set — so if you followed Stages 1–3 as written, your wrapped paths are already live, and Stage 4 simply means retiring the Stage 1 `decide` side-channel once you're confident in your budget allocations. If you did set `dry_run=True` on any wrapped call during testing (recall from Stage 1 that it skips executing the wrapped function, so it's unsuitable for shadow-observing production traffic), remove it now:

::: code-group
```python [Python]
# Remove dry_run to enable enforcement
@cycles(
    estimate=2000000,
    action_kind="llm.completion",
    action_name="openai:gpt-4o",
    # dry_run=True,  ← remove this line
)
def generate_summary(document: str) -> str:
    ...
```
```typescript [TypeScript]
// Remove dryRun to enable enforcement
const generateSummary = withCycles(
  {
    estimate: 2000000,
    actionKind: "llm.completion",
    actionName: "openai:gpt-4o",
    // dryRun: true,  ← remove this line
  },
  async (document: string) => { ... },
);
```
```java [Spring Boot]
// Remove dryRun to enable enforcement
@Cycles(value = "2000000",
        actionKind = "llm.completion", actionName = "openai:gpt-4o"
        // dryRun = true  ← remove this line
)
public String generateSummary(String document) { ... }
```
:::

## Tips for existing applications

### Keep your existing error handling

Don't replace your existing try/except or try/catch blocks. Add Cycles error handling alongside them:

```python
try:
    result = generate_summary(document)
except BudgetExceededError:
    result = "Budget limit reached."
except openai.APIError as e:
    # Your existing error handling stays
    result = handle_openai_error(e)
```

### Start with generous budgets

When first deploying, set budgets higher than you think you need. You can tighten them after collecting real usage data. Under-budgeting on day one creates unnecessary friction.

### Use scopes to separate environments

Use different workspace scopes for dev, staging, and production:

```python
@cycles(
    estimate=2000000,
    action_kind="llm.completion",
    action_name="openai:gpt-4o",
    workspace=os.environ.get("ENVIRONMENT", "dev"),  # dev, staging, prod
)
def generate_summary(document: str) -> str:
    ...
```

### Don't wrap everything at once

It's better to have 3 well-instrumented call paths than 30 poorly-estimated ones. Start with the calls that matter most.

## Next steps

- [Shadow Mode Rollout](/how-to/shadow-mode-in-cycles-how-to-roll-out-budget-enforcement-without-breaking-production) — full guide to safe rollout
- [Cost Estimation Cheat Sheet](/how-to/cost-estimation-cheat-sheet) — how much to reserve per model
- [Choosing the Right Integration Pattern](/how-to/choosing-the-right-integration-pattern) — decorator vs programmatic vs middleware
- [Integrations Overview](/how-to/integrations-overview) — all supported frameworks and providers
- [Degradation Paths](/how-to/how-to-think-about-degradation-paths-in-cycles-deny-downgrade-disable-or-defer) — what to do when budget is denied
