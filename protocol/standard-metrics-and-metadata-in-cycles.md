---
title: "Standard Metrics and Metadata in Cycles"
description: "Attach execution metrics and custom metadata to commits and events in Cycles for debugging, analytics, and cost attribution across scopes."
---

# Standard Metrics and Metadata in Cycles

Budget enforcement tells you whether work is allowed and how much it costs.

But production systems need more than cost numbers. They need to know what happened during execution — how many tokens were consumed, how long it took, which model version was used, and any custom data relevant for debugging or analytics.

That is what standard metrics and metadata provide.

## Where metrics and metadata appear

Metrics and metadata can be attached to two operations:

- **Commits** (`POST /v1/reservations/{id}/commit`) — when finalizing a reservation
- **Events** (`POST /v1/events`) — when recording direct debit usage

Both accept an optional `metrics` field and an optional `metadata` field.

Neither field is echoed back in the response. Commit responses carry `status`, `charged`, `released`, `balances`, and `cycles_evidence`; event responses carry `status`, `event_id`, `charged`, and `balances`. To read metadata back after the fact, retrieve the reservation (see below).

## Standard metrics

The protocol defines a `StandardMetrics` schema with four named fields and an extensible custom map:

### tokens_input

```json
"tokens_input": 1250
```

The number of input tokens consumed by the operation. Integer, minimum 0.

Useful for tracking prompt size and correlating with model pricing.

### tokens_output

```json
"tokens_output": 430
```

The number of output tokens generated. Integer, minimum 0.

Useful for tracking generation length and correlating with output pricing (which is typically higher than input pricing).

### latency_ms

```json
"latency_ms": 1840
```

The total operation latency in milliseconds. Integer, minimum 0.

Useful for SLA monitoring, performance analysis, and identifying slow operations that may need different TTL or timeout handling.

### model_version

```json
"model_version": "gpt-4o-mini-2024-07-18"
```

The actual model or tool version used. String, maximum 128 characters.

This is important because the model requested and the model used are not always the same. Providers may route to different versions, and this field captures what actually ran.

### custom

```json
"custom": {
  "cache_hit": "true",
  "region": "us-east-1",
  "retry_count": "2"
}
```

An open map for arbitrary additional metrics. Values can be any JSON type (strings, numbers, booleans, objects).

Use custom metrics for anything not covered by the standard fields — cache behavior, retry counts, routing decisions, feature flags, or domain-specific measurements.

## A complete metrics example

```json
{
  "idempotency_key": "commit-run-42-step-7",
  "actual": { "unit": "USD_MICROCENTS", "amount": 285000 },
  "metrics": {
    "tokens_input": 1250,
    "tokens_output": 430,
    "latency_ms": 1840,
    "model_version": "gpt-4o-mini-2024-07-18",
    "custom": {
      "cache_hit": "false",
      "prompt_template": "summarize-v3"
    }
  }
}
```

## Metadata

Metadata is a separate field from metrics. It is an open map for arbitrary key-value pairs:

```json
{
  "idempotency_key": "commit-run-42-step-7",
  "actual": { "unit": "USD_MICROCENTS", "amount": 285000 },
  "metadata": {
    "user_id": "user-456",
    "session_id": "session-001",
    "feature_flag_bucket": "variant-b",
    "external_trace_id": "otel-abc-xyz-789"
  }
}
```

Metadata is intended for application-level audit, debugging, and correlation to systems outside Cycles — not for operational metrics, and not for the server-managed `trace_id` and `request_id` (those flow through first-class response headers and response-body fields; see the next section).

::: tip Don't put the server trace_id in metadata
As of v0.1.25 the server manages its own 32-hex W3C Trace Context `trace_id` and per-request `request_id`. Both flow on response headers (`X-Cycles-Trace-Id`) and in response bodies — you don't need to (and shouldn't) shove them into `metadata`. Use `metadata` for application-level values like your own OpenTelemetry / Datadog trace id, user id, or session id. See [Correlation and Tracing](/protocol/correlation-and-tracing-in-cycles).
:::

### Metrics vs metadata vs server correlation identifiers

- **Metrics** are about what happened during execution (tokens, latency, model version).
- **Metadata** is about application-level context (user IDs, session IDs, feature flags, external trace ids).
- **Server correlation identifiers** — `request_id`, `trace_id`, `correlation_id` — are managed natively by the Cycles server. You do not need to pack them into `metadata`.

All three are optional. All three are stored with the commit or event record. But they serve different analytical purposes. See [Correlation and Tracing](/protocol/correlation-and-tracing-in-cycles) for the server's three-tier identifier model.

## Where metadata also appears

Metadata is accepted on several other operations beyond commits and events:

- **Reservation creation** (`POST /v1/reservations`) — attach context to the reservation itself
- **Reservation extend** (`POST /v1/reservations/{id}/extend`) — attach debugging metadata to extend operations
- **Decide** (`POST /v1/decide`) — attach context to preflight budget checks

This means a full reservation lifecycle can carry metadata from creation through commit:

1. Create reservation with `metadata: { "external_trace_id": "..." }`
2. Extend with `metadata: { "heartbeat_seq": "3" }`
3. Commit with `metadata: { "app_request_id": "..." }` and `metrics: { ... }`

Commit metadata is preserved on the reservation and returned by `GET /v1/reservations/{id}` as `committed_metadata` — distinct from the reserve-time `metadata` field, which is returned on the same response — so the metadata attached at reserve and commit time is auditable after the fact, not just sent and forgotten.

## Metrics in client code

Attach metrics and metadata through the context object inside a decorated function or annotated method. The SDK automatically includes these in the commit request when the function returns.

::: code-group
```python [Python]
from runcycles import cycles, get_cycles_context, CyclesMetrics

@cycles(estimate=1000)
def chat(prompt: str) -> str:
    response = call_llm(prompt)

    ctx = get_cycles_context()
    ctx.metrics = CyclesMetrics(
        tokens_input=response.usage.prompt_tokens,
        tokens_output=response.usage.completion_tokens,
        latency_ms=elapsed,
        model_version=response.model,
    )
    ctx.commit_metadata = {
        "app_request_id": app_request_id,
        "external_trace_id": otel_trace_id,
    }

    return response.text
```
```java [Java (Spring Boot)]
@Cycles("1000")
public ChatResponse chat(String prompt) {
    ChatResponse response = chatModel.call(prompt);

    CyclesReservationContext ctx = CyclesContextHolder.get();

    CyclesMetrics metrics = new CyclesMetrics();
    metrics.setTokensInput(response.getUsage().getPromptTokens());
    metrics.setTokensOutput(response.getUsage().getCompletionTokens());
    metrics.setLatencyMs(elapsed);
    metrics.setModelVersion(response.getMetadata().getModel());
    ctx.setMetrics(metrics);

    ctx.setCommitMetadata(Map.of(
        "app_request_id", appRequestId,
        "external_trace_id", otelTraceId
    ));

    return response;
}
```
:::

## Why standard metrics matter

### Cost attribution

Tokens input and output, combined with model version, enable precise cost attribution:

- which model was used
- how many tokens it consumed
- what the actual cost was

This connects budget accounting to provider-level billing.

### Performance monitoring

Latency metrics across commits reveal:

- which actions are slow
- whether latency correlates with budget consumption
- where timeout or TTL adjustments are needed

### Audit trail

Metadata creates a traceable path from budget operations back to the originating request, user, or workflow run.

When investigating a budget incident, metadata helps answer: who triggered this, from which session, as part of which trace?

### Analytics

Over time, standard metrics enable aggregate analysis:

- average tokens per model call by action type
- latency distributions by model version
- cache hit rates across workflows
- cost efficiency trends

Note that the protocol defines how metrics are *submitted*, not how they are retrieved or aggregated. v0 defines no endpoint that returns stored metrics, so retrieval and aggregation are implementation-defined — via server-side export, a log pipeline, or direct store access.

## Best practices

### Always include tokens and model version on LLM calls

These are the minimum metrics that make budget data actionable. Without them, cost numbers exist without context.

### Use metadata for correlation IDs

Attach your own correlation keys — e.g. `app_request_id`, `external_trace_id`, or `session_id` — to every commit. This makes it possible to join budget data with application logs and distributed traces. (Use distinct names rather than `request_id`/`trace_id`, which are server-managed and should not be duplicated into metadata — see the trace-context note above.)

### Keep custom metrics stable

Treat custom metric keys like a schema. Changing keys breaks downstream analytics. Add new keys freely, but avoid renaming or removing existing ones without coordination.

### Do not put sensitive data in metrics or metadata

Metrics and metadata are stored and may be visible through admin interfaces or log aggregation. Do not include PII, secrets, or authentication tokens.

## Summary

Standard metrics and metadata enrich budget operations with execution context:

- **tokens_input** and **tokens_output** — token consumption
- **latency_ms** — operation duration
- **model_version** — actual model used
- **custom** — extensible metrics map
- **metadata** — correlation IDs, audit context, and debugging data

These fields are optional but recommended. They turn budget accounting from raw cost numbers into actionable operational data.

## Server-side operational metrics

The metrics above describe the **execution-context fields** a client attaches to each commit or event. They are stored with the protocol record and surface in admin audit trails — they are not echoed on commit or event responses.

Cycles also exposes **Prometheus metrics** on each service's `/actuator/prometheus` endpoint for operational monitoring. These are aggregate counters and histograms — they do not replace per-request metrics, they complement them.

The runtime server (`cycles-server` v0.1.25.10+) publishes seven domain counters under the `cycles_*` namespace:

- `cycles_reservations_reserve_total{tenant, decision, reason, overage_policy}`
- `cycles_reservations_commit_total{tenant, decision, reason, overage_policy}`
- `cycles_reservations_release_total{tenant, actor_type, decision, reason}`
- `cycles_reservations_extend_total{tenant, decision, reason}`
- `cycles_reservations_expired_total{tenant}`
- `cycles_events_total{tenant, decision, reason, overage_policy}`
- `cycles_overdraft_incurred_total{tenant}`

The admin server (`cycles-server-admin` v0.1.25.20+) adds `cycles_admin_audit_writes_total{path_class, outcome}` — **alert on `outcome=error` nonzero** to catch silent audit-coverage loss.

The events service (`cycles-server-events` v0.1.25.6+) publishes webhook delivery, evidence-worker, and dispatcher metrics under `cycles_webhook_*` and `cycles_evidence_*` — see [Server Configuration Reference → Events service metrics](/configuration/server-configuration-reference-for-cycles#events-service-metrics) for the current inventory.

The runtime and events services gate their optional `tenant` label with `cycles.metrics.tenant-tag.enabled`. The runtime defaults it to `true`; the events service defaults it to `false`. Admin `cycles_admin_*` counters do not carry a tenant label, so this toggle does not apply there.

## Next steps

To explore the Cycles stack:

- Read the [Cycles Protocol](https://github.com/runcycles/cycles-protocol)
- Run the [Cycles Server](https://github.com/runcycles/cycles-server)
- Manage budgets with [Cycles Admin](https://github.com/runcycles/cycles-server-admin)
- Integrate with Python using the [Python Client](/quickstart/getting-started-with-the-python-client)
- Integrate with TypeScript using the [TypeScript Client](/quickstart/getting-started-with-the-typescript-client)
- Integrate with Spring Boot or Spring AI using the [Spring Boot starter](https://github.com/runcycles/cycles-spring-boot-starter) or the [Spring AI starter](https://github.com/runcycles/cycles-spring-ai-starter)
