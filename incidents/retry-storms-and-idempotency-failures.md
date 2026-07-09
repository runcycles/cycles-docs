---
title: "Retry Storms and Idempotency Failures"
description: "How retry loops without idempotency create unbounded spend, and how Cycles budget enforcement prevents this failure mode."
---

# Retry Storms and Idempotency Failures

A common failure mode in autonomous systems where retry logic multiplies cost without bound.

## The incident

An application retries failed LLM calls with exponential backoff. Each retry creates a new reservation and makes a new LLM call. When the underlying issue is transient (network blip, rate limit), retries work as intended. But when the issue is persistent (bad prompt causing errors, model returning incomplete responses that trigger re-processing), the retry loop creates unbounded spend.

### Example

An agent processes documents. When the model returns a response that fails validation, the agent retries with a modified prompt:

```python
def process_document(doc):
    for attempt in range(10):
        response = call_llm(f"Process this document: {doc}")
        if validate(response):
            return response
        # Retry with more context
        doc = doc + f"\n\nPrevious attempt failed validation. Try again."
```

Each retry calls the LLM again. With 10 retries at $0.05 per call, a single document costs $0.50 instead of $0.05. Across 1,000 documents, this turns a $50 batch into $500.

### Without Cycles

The retry loop runs all 10 attempts for every document. There's no mechanism to stop retrying when the total cost exceeds a threshold. Rate limiters don't help — each retry is a valid individual request.

### With Cycles

Each LLM call reserves budget before executing:

```python
@cycles(estimate=5000000, action_kind="llm.completion", action_name="gpt-4o")
def call_llm_guarded(prompt: str) -> str:
    return call_llm(prompt)

def process_document(doc):
    for attempt in range(10):
        try:
            response = call_llm_guarded(f"Process this document: {doc}")
            if validate(response):
                return response
        except BudgetExceededError:
            return "Document processing stopped: budget limit reached."
```

When total spend across all retries hits the budget limit, further attempts are denied immediately — no LLM call is made.

### TypeScript equivalent

Using the `runcycles` SDK, the same pattern works with `withCycles`:

```typescript
import { withCycles, BudgetExceededError } from "runcycles";

const callLlmGuarded = withCycles(
  {
    estimate: 5_000_000,
    actionKind: "llm.completion",
    actionName: "gpt-4o",
  },
  async (prompt: string): Promise<string> => {
    return await callLlm(prompt);
  }
);

async function processDocument(doc: string): Promise<string> {
  let currentDoc = doc;
  for (let attempt = 0; attempt < 10; attempt++) {
    try {
      const response = await callLlmGuarded(
        `Process this document: ${currentDoc}`
      );
      if (validate(response)) {
        return response;
      }
      currentDoc = currentDoc + "\n\nPrevious attempt failed validation. Try again.";
    } catch (err) {
      if (err instanceof BudgetExceededError) {
        return "Document processing stopped: budget limit reached.";
      }
      throw err;
    }
  }
  return "Document processing stopped: max retries reached.";
}
```

## Severity and impact

Retry storms are deceptive because each individual retry is cheap. The damage comes from multiplication across a fleet.

**Single-document cost explosion:**

| Retries per doc | Cost per call | Docs in batch | Total cost |
|-----------------|---------------|---------------|------------|
| 1 (no retries)  | $0.05         | 1,000         | $50        |
| 5               | $0.05         | 1,000         | $250       |
| 10              | $0.05         | 1,000         | $500       |
| 10              | $0.05         | 10,000        | $5,000     |

**Prompt growth makes it worse.** Each retry in the example above appends context to the prompt. By attempt #10, the prompt is significantly longer than the original. With token-based pricing, later retries cost more than earlier ones:

| Attempt | Prompt tokens | Cost per call |
|---------|--------------|---------------|
| 1       | 500          | $0.05         |
| 5       | 2,500        | $0.12         |
| 10      | 5,000        | $0.22         |

A 10-retry loop with growing prompts costs roughly $1.00 per document, not $0.50. Across 10,000 documents, that is $10,000 instead of $500.

**Fleet multiplication.** If you run 20 parallel workers processing the same batch, a retry storm in the shared batch job can multiply these figures by the worker count before any human notices the spend rate.

## Detection

### Querying for retry storm indicators

Check the ratio of active reservations to recent commits. A healthy system commits most reservations quickly. A retry storm shows many reservations being created and released (or expiring) without successful commits.

```bash
# Count active reservations for a scope
curl -s "http://localhost:7878/v1/reservations?tenant=acme-corp&status=ACTIVE" \
  -H "X-Cycles-API-Key: $API_KEY" | jq '.reservations | length'

# Check balance to see reserved vs spent
curl -s "http://localhost:7878/v1/balances?tenant=acme-corp" \
  -H "X-Cycles-API-Key: $API_KEY" | jq '.balances[] | {scope, allocated: .allocated.amount, spent: .spent.amount, reserved: .reserved.amount, remaining: .remaining.amount}'
```

If `reserved` is growing much faster than `spent`, many reservations are being created without committing — a hallmark of retry loops.

### Checking for repeated idempotency key prefixes

If you use the pattern `doc-{id}-attempt-{n}`, you can look for documents with high attempt numbers:

```bash
# List reservations and look for high attempt numbers
curl -s "http://localhost:7878/v1/reservations?tenant=acme-corp&workflow=doc-processing" \
  -H "X-Cycles-API-Key: $API_KEY" \
  | jq '[.reservations[].idempotency_key | select(test("attempt-[5-9]|attempt-[0-9]{2,}"))]'
```

Any result means at least one document hit 5+ retries.

## Monitoring

### Alerting rules

Use these Prometheus-style rules to detect retry storms before they drain budgets.

::: tip Built on the server's `cycles_*` counters
Current server builds (runtime 0.1.25.46) register operation counters under the `cycles.*` namespace — `cycles_reservations_reserve_total`, `cycles_reservations_commit_total`, `cycles_reservations_release_total`, `cycles_reservations_extend_total`, `cycles_reservations_expired_total`, `cycles_events_total`, and `cycles_overdraft_incurred_total` — tagged with `decision`, `reason`, `overage_policy`, and (toggleable) `tenant`. Spring Boot's default `http_server_requests_seconds*` histogram is also available; denied reservations return HTTP `409`, so denial spikes show up there under `status="409"`. Ratio-style rules tagged "requires sidecar" still depend on gauges pushed by a balance-polling sidecar (see [Monitoring and Alerting](/how-to/monitoring-and-alerting#balance-polling-alerts-for-signals-without-a-counter)).
:::

```yaml
# Alert when reservation rate spikes relative to commit rate.
# A ratio above 3 means most reservations are not committing — likely retries.
- alert: CyclesRetryStormDetected
  expr: |
    sum(rate(cycles_reservations_reserve_total[5m]))
      / sum(rate(cycles_reservations_commit_total[5m]))
      > 3
  for: 2m
  labels:
    severity: warning
  annotations:
    summary: "Possible retry storm: reservation/commit ratio is {{ $value }}"

# Alert when reserved amount exceeds a threshold relative to allocated.
# Requires a balance-polling sidecar to push cycles_budget_reserved / cycles_budget_allocated gauges.
- alert: CyclesHighReservedRatio
  expr: |
    cycles_budget_reserved / cycles_budget_allocated > 0.5
  for: 5m
  labels:
    severity: critical
  annotations:
    summary: "Over 50% of budget is in active reservations — retries may be stacking"

# Alert when reservation denials spike (retries hitting the wall).
# A live denial is an HTTP 409 with the reason in the error code; the server also
# increments cycles_reservations_reserve_total{decision="DENY", reason=...} for it.
# Equivalent HTTP-layer form: http_server_requests_seconds_count{uri="/v1/reservations", status="409"}.
- alert: CyclesBudgetDenialSpike
  expr: |
    sum(rate(cycles_reservations_reserve_total{decision="DENY",reason=~"BUDGET_EXCEEDED|OVERDRAFT_LIMIT_EXCEEDED|BUDGET_FROZEN|BUDGET_CLOSED|DEBT_OUTSTANDING"}[5m])) > 10
  for: 1m
  labels:
    severity: warning
  annotations:
    summary: "Spike in reservation denials — retry storm may have hit budget limit"
```

### Key metrics to track

- **Reservation-to-commit ratio** per scope and per workflow. Healthy value is 1.0–1.2. Values above 2.0 indicate retries or abandoned work.
- **Mean and p99 reservation lifetime.** Retry storms produce short-lived reservations that are released (not committed) quickly.
- **Denied reservation rate.** A sudden spike in denials often means a retry storm just hit the budget ceiling.

For detailed monitoring setup, see [Monitoring and Alerting](/how-to/monitoring-and-alerting).

## Key points

- **Retries are individually valid requests.** Rate limiters can't distinguish retry #1 from retry #10.
- **Idempotency prevents double-counting.** If you use the same idempotency key for retries of the same operation, Cycles returns the original response without re-reserving. Use unique keys only for genuinely different operations.
- **Budget is the aggregate control.** Individual retries may be cheap, but their sum can be expensive. Cycles tracks the cumulative total.

## Idempotency gotcha

If your retry uses the **same idempotency key** with a **different payload** (because the prompt changed), you'll get `IDEMPOTENCY_MISMATCH`. This is correct — Cycles is telling you that this is a new operation, not a retry of the same one. Use a new idempotency key:

```python
idempotency_key = f"doc-{doc_id}-attempt-{attempt}"
```

## Prevention strategies

### 1. Per-document or per-task budget

Create a workflow-scoped budget for each document or task. All retries for that document share the same budget pool, so a single stuck document can't drain the entire batch budget:

```bash
# Create a per-document budget under the workflow scope
curl -s -X POST "http://localhost:7979/v1/admin/budgets" \
  -H "Content-Type: application/json" \
  -H "X-Cycles-API-Key: $CYCLES_API_KEY" \
  -d '{
    "scope": "tenant:acme-corp/workspace:prod/workflow:doc-processing",
    "unit": "USD_MICROCENTS",
    "allocated": {"amount": 10000000, "unit": "USD_MICROCENTS"}
  }'
```

This limits total retry spend per document to the workflow budget, regardless of how many attempts the agent makes.

### 2. Cap retries with budget checks

Before each retry, use `decide` to check if budget is available without creating a reservation. This avoids creating reservations you'll immediately release:

```python
import os
import uuid

from runcycles import (
    Action, Amount, CyclesClient, CyclesConfig, DecisionRequest, Subject, Unit,
)

client = CyclesClient(CyclesConfig(
    base_url=os.environ["CYCLES_BASE_URL"],
    api_key=os.environ["CYCLES_API_KEY"],
))

def process_document(doc, doc_id):
    for attempt in range(10):
        resp = client.decide(DecisionRequest(
            idempotency_key=f"doc-{doc_id}-decide-{uuid.uuid4()}",
            subject=Subject(tenant="acme-corp", workflow=f"doc-{doc_id}"),
            action=Action(kind="llm.completion", name="gpt-4o"),
            estimate=Amount(amount=5_000_000, unit=Unit.USD_MICROCENTS),
        ))
        if resp.body["decision"] == "DENY":
            return f"Document {doc_id}: budget exhausted after {attempt} attempts."
        response = call_llm_guarded(f"Process this document: {doc}")
        if validate(response):
            return response
```

### 3. Track retry cost separately

Use the `metrics` field on commit to tag retries. Inside a `@cycles`-guarded function, `get_cycles_context()` exposes the live reservation context; setting `ctx.metrics` attaches custom metrics to the commit. This lets you build dashboards that show what fraction of your spend goes to retries versus first attempts:

```python
from runcycles import CyclesMetrics, cycles, get_cycles_context

@cycles(
    estimate=5_000_000,
    action_kind="llm.completion",
    action_name="gpt-4o",
)
def call_llm_guarded(prompt: str, attempt: int = 0) -> str:
    result = call_llm(prompt)
    ctx = get_cycles_context()
    ctx.metrics = CyclesMetrics(
        custom={"retry_attempt": attempt, "is_retry": attempt > 0},
    )
    return result
```

### 4. Set a maximum retry budget as a fraction of first-attempt cost

A useful heuristic: retries should never cost more than 2x the original call. If your first attempt costs $0.05, cap total retry spend at $0.10. This prevents the long tail of expensive retries:

```python
MAX_RETRY_MULTIPLIER = 2
first_attempt_cost = 5_000_000  # microcents

def process_with_capped_retries(doc, doc_id):
    total_spent = 0
    max_retry_budget = first_attempt_cost * MAX_RETRY_MULTIPLIER
    for attempt in range(10):
        if attempt > 0 and total_spent >= max_retry_budget:
            return f"Document {doc_id}: retry budget exhausted."
        response = call_llm_guarded(f"Process this document: {doc}")
        # @cycles commits the estimate unless an actual-cost expression is
        # configured, so the same constant tracks spend here. For the live
        # reservation details (reservation_id, caps, balances), call
        # get_cycles_context() inside the guarded function.
        total_spent += first_attempt_cost
        if validate(response):
            return response
```

### 5. Use circuit breakers for persistent failures

If multiple documents in a batch hit max retries, the issue is likely systemic (model degradation, bad prompt template). A circuit breaker stops the entire batch early:

```python
class RetryCircuitBreaker:
    def __init__(self, threshold=5):
        self.failure_count = 0
        self.threshold = threshold

    def record_exhausted_retries(self):
        self.failure_count += 1
        if self.failure_count >= self.threshold:
            raise SystemError(
                f"{self.failure_count} documents exhausted retries. "
                "Halting batch — likely systemic issue."
            )
```

## Next steps

- [Idempotency, Retries and Concurrency](/concepts/idempotency-retries-and-concurrency-why-cycles-is-built-for-real-failure-modes) — how Cycles handles retries safely
- [Error Codes and Error Handling](/protocol/error-codes-and-error-handling-in-cycles) — understanding IDEMPOTENCY_MISMATCH
- [Runaway Agents and Tool Loops](/incidents/runaway-agents-tool-loops-and-budget-overruns-the-incidents-cycles-is-designed-to-prevent) — the broader runaway agent problem
- [AI Agent Cost Management: The Complete Guide](/blog/ai-agent-cost-management-guide) — how monitoring and alerting tiers handle retry storms before enforcement
