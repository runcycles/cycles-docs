---
title: "Observability Setup"
description: "Set up Prometheus metrics, Grafana dashboards, and Datadog integration for monitoring a Cycles deployment. Includes PromQL queries and importable dashboard JSON."
---

# Observability Setup

This guide covers how to expose metrics from the Cycles Server and visualize them in Prometheus, Grafana, and Datadog. For alerting rules and budget-level monitoring patterns, see [Monitoring and Alerting](/how-to/monitoring-and-alerting).

## Exposing Prometheus metrics

The Cycles Server is a Spring Boot application. To expose Prometheus-format metrics, enable the Actuator Prometheus endpoint.

### Step 1: Enable the Prometheus endpoint

Set the following property via environment variable or `application.properties`:

```properties
management.endpoints.web.exposure.include=health,info,prometheus
```

In Docker Compose:

```yaml
cycles-server:
  image: ghcr.io/runcycles/cycles-server:0.1.25.39
  environment:
    REDIS_HOST: redis
    REDIS_PORT: 6379
    REDIS_PASSWORD: ${REDIS_PASSWORD}
    MANAGEMENT_ENDPOINTS_WEB_EXPOSURE_INCLUDE: health,info,prometheus
  ports:
    - "7878:7878"
```

### Step 2: Verify

Since `cycles-server` 0.1.25.45, `/actuator/prometheus` (and the aggregate `/actuator/health`) require the `X-Admin-API-Key` header on the runtime and admin servers; only `/actuator/health/liveness` and `/actuator/health/readiness` remain public. The events service's management port (9980) has no auth filter in the reference deployment — restrict it at the network layer.

```bash
curl -s -H "X-Admin-API-Key: $ADMIN_KEY" http://localhost:7878/actuator/prometheus | head -20
```

You should see Micrometer metrics in Prometheus exposition format:

```
# HELP http_server_requests_seconds Duration of HTTP server request handling
# TYPE http_server_requests_seconds summary
http_server_requests_seconds_count{method="POST",uri="/v1/reservations",status="200"} 142.0
...
```

(A successful reserve returns HTTP **200**. `_bucket` histogram series only appear if you enable percentile histograms — see the latency note below.)

### Step 3: Configure Prometheus scrape

Add the Cycles Server as a target in your `prometheus.yml`. Because the runtime and admin scrape endpoints require `X-Admin-API-Key` (0.1.25.45+), the scrape config must send that header — Prometheus supports custom headers via `http_headers` (Prometheus v3.0+; on older versions, front the endpoint with a proxy that injects the header):

```yaml
scrape_configs:
  - job_name: "cycles-server"
    metrics_path: "/actuator/prometheus"
    scrape_interval: 15s
    http_headers:
      X-Admin-API-Key:
        secrets: ["${ADMIN_API_KEY}"]
    static_configs:
      - targets: ["cycles-server:7878"]
        labels:
          service: "cycles"

  # Optional: scrape the Admin Server too
  - job_name: "cycles-admin"
    metrics_path: "/actuator/prometheus"
    scrape_interval: 30s
    http_headers:
      X-Admin-API-Key:
        secrets: ["${ADMIN_API_KEY}"]
    static_configs:
      - targets: ["cycles-admin:7979"]
        labels:
          service: "cycles-admin"

  # Events service — management port 9980, no admin-key requirement
  - job_name: "cycles-events"
    metrics_path: "/actuator/prometheus"
    scrape_interval: 30s
    static_configs:
      - targets: ["cycles-events:9980"]
        labels:
          service: "cycles-events"
```

## Key metrics reference

The Cycles Server exposes standard Spring Boot Actuator / Micrometer metrics. These are the most relevant for Cycles:

### HTTP endpoint metrics

| Metric | Type | Description |
|---|---|---|
| `http_server_requests_seconds` | histogram | Request duration by `method`, `uri`, `status` |
| `http_server_requests_seconds_count` | counter | Total request count by `method`, `uri`, `status` |

Key `uri` labels for Cycles endpoints:

| URI pattern | Operation |
|---|---|
| `/v1/reservations` | Create reservation |
| `/v1/reservations/{id}/commit` | Commit |
| `/v1/reservations/{id}/release` | Release |
| `/v1/reservations/{id}/extend` | Heartbeat extend |
| `/v1/decide` | Preflight decision |
| `/v1/events` | Direct debit event |
| `/v1/balances` | Balance query |

### JVM metrics

| Metric | Description |
|---|---|
| `jvm_memory_used_bytes{area="heap"}` | Current heap usage |
| `jvm_memory_max_bytes{area="heap"}` | Maximum heap size |
| `jvm_gc_pause_seconds` | GC pause duration |
| `jvm_threads_live_threads` | Active thread count |

### System metrics

| Metric | Description |
|---|---|
| `system_cpu_usage` | System CPU utilization (0.0–1.0) |
| `process_cpu_usage` | Process CPU utilization (0.0–1.0) |

### Custom Cycles metrics

The runtime server (`cycles-server` ≥ `0.1.25.10`) emits custom Micrometer counters under the `cycles.*` namespace, exposed in Prometheus format as `cycles_*`:

| Metric | Tags | Description |
|---|---|---|
| `cycles_reservations_reserve_total` | `tenant`, `decision`, `reason`, `overage_policy` | Outcome of every `POST /v1/reservations` call. `decision=ALLOW\|ALLOW_WITH_CAPS\|DENY`; `reason` carries the deny/caps code; `overage_policy` carries the budget's commit-overage policy (`REJECT`, `ALLOW_IF_AVAILABLE`, `ALLOW_WITH_OVERDRAFT`). |
| `cycles_reservations_commit_total` | `tenant`, `decision`, `reason`, `overage_policy` | Outcome of every commit. `decision=COMMITTED\|DENY`. |
| `cycles_reservations_release_total` | `tenant`, `actor_type`, `decision`, `reason` | Every successful release. `actor_type` distinguishes tenant-driven from admin-on-behalf-of releases. |
| `cycles_reservations_extend_total` | `tenant`, `decision`, `reason` | Every extend attempt. |
| `cycles_reservations_expired_total` | `tenant` | Per reservation actually marked EXPIRED by the sweep (not per candidate). |
| `cycles_events_total` | `tenant`, `decision`, `reason`, `overage_policy` | Outcome of every `POST /v1/events` one-shot debit. |
| `cycles_overdraft_incurred_total` | `tenant` | Count of commits/events that actually accrued non-zero debt (unit-free — amount is in the balance store, not leaked to metrics). |
| `cycles_evidence_emit_failed_total` | `artifact_type` | Evidence-source enqueue failures (fail-open) — the rare loss window where a lifecycle op committed but its evidence record could not be queued. |

The admin server additionally exposes (`cycles_admin_events_emitted_total` and `cycles_admin_webhook_dispatched_total` since `0.1.25.9`; `cycles_admin_events_payload_invalid_total` since `0.1.25.12`; `cycles_admin_audit_writes_total` since `0.1.25.20`):

| Metric | Description |
|---|---|
| `cycles_admin_webhook_dispatched_total` | Webhook-delivery enqueue attempts (`result=queued`/`failure`). |
| `cycles_admin_events_emitted_total` | Events produced by admin controllers (budget/tenant/policy/api_key/system). |
| `cycles_admin_events_payload_invalid_total` | Payload contract violations caught at emit time. |
| `cycles_admin_audit_writes_total` | Audit-write attempts by `path_class` and `outcome` (`written`/`error`/`sampled-out`). Alert on any `outcome="error"`. |

The high-cardinality `tenant` tag is controlled per service by `cycles.metrics.tenant-tag.enabled`: the runtime server defaults it to **`true`**, the events service defaults it to **`false`**, and the admin `cycles_admin_*` counters carry no tenant tag at all. Disable it on the runtime server in deployments with many thousands of tenants. Empty/null tag values are normalised to the sentinel `UNKNOWN` so series names stay stable.

For denial-rate, overdraft-rate, and tenant-level alerts, prefer these `cycles_*` counters over `http_server_requests_seconds_count` — a live reserve denial is an HTTP 409, but 409 also covers idempotency mismatches and frozen budgets, and `/v1/decide`/dry-run denials are HTTP 200 with `decision: DENY` in the body, which HTTP metrics can't see. Status codes alone would miscount.

## PromQL query cookbook

### Reservation throughput (requests/second)

```promql
rate(http_server_requests_seconds_count{uri="/v1/reservations",method="POST"}[5m])
```

### Commit throughput

```promql
rate(http_server_requests_seconds_count{uri=~"/v1/reservations/.+/commit",method="POST"}[5m])
```

### Reservation latency (p50, p95, p99)

::: warning Requires percentile histograms
The quantile queries below (and the latency panels in the Grafana dashboard) rely on `http_server_requests_seconds_bucket` series, which none of the Cycles services publish by default. Enable them with `management.metrics.distribution.percentiles-histogram.http.server.requests=true` (env var `MANAGEMENT_METRICS_DISTRIBUTION_PERCENTILES_HISTOGRAM_HTTP_SERVER_REQUESTS=true`). Without that, use `http_server_requests_seconds_max` and the `_sum`/`_count` average.
:::

```promql
# p50
histogram_quantile(0.5, rate(http_server_requests_seconds_bucket{uri="/v1/reservations",method="POST"}[5m]))

# p95
histogram_quantile(0.95, rate(http_server_requests_seconds_bucket{uri="/v1/reservations",method="POST"}[5m]))

# p99
histogram_quantile(0.99, rate(http_server_requests_seconds_bucket{uri="/v1/reservations",method="POST"}[5m]))
```

### Denial rate (409 responses on reservation create)

```promql
rate(http_server_requests_seconds_count{uri="/v1/reservations",method="POST",status="409"}[5m])
/
rate(http_server_requests_seconds_count{uri="/v1/reservations",method="POST"}[5m])
```

This is an approximation: 409 also covers idempotency mismatches and frozen budgets, and it misses `/v1/decide`/dry-run denials (HTTP 200 with `decision: DENY`). For an exact denial rate, use `cycles_reservations_reserve_total{decision="DENY"}` — see [Custom Cycles metrics](#custom-cycles-metrics).

### Server error rate (5xx)

```promql
sum(rate(http_server_requests_seconds_count{status=~"5.."}[5m]))
/
sum(rate(http_server_requests_seconds_count[5m]))
```

### JVM heap utilization

```promql
jvm_memory_used_bytes{area="heap"} / jvm_memory_max_bytes{area="heap"}
```

## Grafana dashboard

Import the following JSON into Grafana (**Dashboards > Import > Paste JSON**). It creates a "Cycles Overview" dashboard with three rows: throughput, latency, and infrastructure. The two latency panels use `histogram_quantile` over `_bucket` series, so they require percentile histograms to be enabled (see the warning above); the other panels work with the default metric set.

::: details Click to expand dashboard JSON
```json
{
  "dashboard": {
    "title": "Cycles Overview",
    "tags": ["cycles"],
    "timezone": "browser",
    "refresh": "30s",
    "panels": [
      {
        "title": "Reservation Throughput",
        "type": "timeseries",
        "gridPos": { "h": 8, "w": 8, "x": 0, "y": 0 },
        "targets": [{
          "expr": "rate(http_server_requests_seconds_count{uri=\"/v1/reservations\",method=\"POST\"}[5m])",
          "legendFormat": "reservations/sec"
        }]
      },
      {
        "title": "Commit Throughput",
        "type": "timeseries",
        "gridPos": { "h": 8, "w": 8, "x": 8, "y": 0 },
        "targets": [{
          "expr": "rate(http_server_requests_seconds_count{uri=~\"/v1/reservations/.+/commit\",method=\"POST\"}[5m])",
          "legendFormat": "commits/sec"
        }]
      },
      {
        "title": "Denial Rate",
        "type": "gauge",
        "gridPos": { "h": 8, "w": 8, "x": 16, "y": 0 },
        "targets": [{
          "expr": "rate(http_server_requests_seconds_count{uri=\"/v1/reservations\",method=\"POST\",status=\"409\"}[5m]) / rate(http_server_requests_seconds_count{uri=\"/v1/reservations\",method=\"POST\"}[5m])",
          "legendFormat": "denial rate"
        }],
        "fieldConfig": {
          "defaults": {
            "unit": "percentunit",
            "thresholds": {
              "steps": [
                { "color": "green", "value": 0 },
                { "color": "yellow", "value": 0.05 },
                { "color": "red", "value": 0.1 }
              ]
            }
          }
        }
      },
      {
        "title": "Reservation Latency",
        "type": "timeseries",
        "gridPos": { "h": 8, "w": 12, "x": 0, "y": 8 },
        "targets": [
          {
            "expr": "histogram_quantile(0.5, rate(http_server_requests_seconds_bucket{uri=\"/v1/reservations\",method=\"POST\"}[5m]))",
            "legendFormat": "p50"
          },
          {
            "expr": "histogram_quantile(0.95, rate(http_server_requests_seconds_bucket{uri=\"/v1/reservations\",method=\"POST\"}[5m]))",
            "legendFormat": "p95"
          },
          {
            "expr": "histogram_quantile(0.99, rate(http_server_requests_seconds_bucket{uri=\"/v1/reservations\",method=\"POST\"}[5m]))",
            "legendFormat": "p99"
          }
        ],
        "fieldConfig": { "defaults": { "unit": "s" } }
      },
      {
        "title": "Commit Latency",
        "type": "timeseries",
        "gridPos": { "h": 8, "w": 12, "x": 12, "y": 8 },
        "targets": [
          {
            "expr": "histogram_quantile(0.5, rate(http_server_requests_seconds_bucket{uri=~\"/v1/reservations/.+/commit\",method=\"POST\"}[5m]))",
            "legendFormat": "p50"
          },
          {
            "expr": "histogram_quantile(0.95, rate(http_server_requests_seconds_bucket{uri=~\"/v1/reservations/.+/commit\",method=\"POST\"}[5m]))",
            "legendFormat": "p95"
          },
          {
            "expr": "histogram_quantile(0.99, rate(http_server_requests_seconds_bucket{uri=~\"/v1/reservations/.+/commit\",method=\"POST\"}[5m]))",
            "legendFormat": "p99"
          }
        ],
        "fieldConfig": { "defaults": { "unit": "s" } }
      },
      {
        "title": "Error Rate (5xx)",
        "type": "timeseries",
        "gridPos": { "h": 8, "w": 8, "x": 0, "y": 16 },
        "targets": [{
          "expr": "sum(rate(http_server_requests_seconds_count{status=~\"5..\"}[5m])) / sum(rate(http_server_requests_seconds_count[5m]))",
          "legendFormat": "5xx rate"
        }],
        "fieldConfig": { "defaults": { "unit": "percentunit" } }
      },
      {
        "title": "JVM Heap Usage",
        "type": "timeseries",
        "gridPos": { "h": 8, "w": 8, "x": 8, "y": 16 },
        "targets": [
          {
            "expr": "jvm_memory_used_bytes{area=\"heap\"}",
            "legendFormat": "used"
          },
          {
            "expr": "jvm_memory_max_bytes{area=\"heap\"}",
            "legendFormat": "max"
          }
        ],
        "fieldConfig": { "defaults": { "unit": "bytes" } }
      },
      {
        "title": "CPU Usage",
        "type": "timeseries",
        "gridPos": { "h": 8, "w": 8, "x": 16, "y": 16 },
        "targets": [
          {
            "expr": "process_cpu_usage",
            "legendFormat": "process"
          },
          {
            "expr": "system_cpu_usage",
            "legendFormat": "system"
          }
        ],
        "fieldConfig": { "defaults": { "unit": "percentunit" } }
      }
    ],
    "schemaVersion": 39
  },
  "overwrite": true
}
```
:::

After importing, set the **Prometheus** data source if prompted.

## Datadog integration

### Option A: Datadog Agent with Spring Boot integration

If you run the Datadog Agent alongside the Cycles Server, enable the Spring Boot Actuator check:

```yaml
# datadog-agent/conf.d/openmetrics.d/conf.yaml
instances:
  - openmetrics_endpoint: http://cycles-server:7878/actuator/prometheus
    namespace: cycles
    metrics:
      - http_server_requests_seconds
      - jvm_memory_used_bytes
      - jvm_gc_pause_seconds
      - system_cpu_usage
      - process_cpu_usage
```

### Option B: Micrometer Datadog registry

Add the `micrometer-registry-datadog` dependency to the Cycles Server and configure:

```properties
management.datadog.metrics.export.api-key=${DD_API_KEY}
management.datadog.metrics.export.step=30s
management.datadog.metrics.export.uri=https://api.datadoghq.com
```

### Key Datadog monitors

| Monitor | Query | Threshold |
|---|---|---|
| Reservation latency | `avg:cycles.http_server_requests_seconds.p99{uri:/v1/reservations}` | > 0.05 (50ms) |
| Error rate | `sum:cycles.http_server_requests_seconds_count{status:5*}.as_rate() / sum:cycles.http_server_requests_seconds_count{*}.as_rate()` | > 0.01 (1%) |
| JVM heap | `avg:cycles.jvm_memory_used_bytes{area:heap} / avg:cycles.jvm_memory_max_bytes{area:heap}` | > 0.8 (80%) |

## Client-side observability

### Logging

All three clients log the reservation lifecycle at DEBUG level:

- **Python**: Set `logging.getLogger("runcycles").setLevel(logging.DEBUG)`
- **TypeScript**: The client logs transport errors via `console.error`
- **Spring Boot**: Set `logging.level.io.runcycles=DEBUG` in `application.yml`

### Custom instrumentation with OpenTelemetry

Wrap the decorator or HOF with your own spans to trace reservation lifecycles in your distributed tracing system:

```python
from opentelemetry import trace
from runcycles import cycles

tracer = trace.get_tracer("my-app")

@cycles(estimate=1000, action_kind="llm.completion", action_name="gpt-4o")
def call_llm(prompt: str) -> str:
    with tracer.start_as_current_span("cycles.call_llm") as span:
        span.set_attribute("cycles.estimate", 1000)
        result = openai.chat.completions.create(model="gpt-4o", messages=[{"role": "user", "content": prompt}])
        span.set_attribute("cycles.actual_tokens", result.usage.total_tokens)
        return result.choices[0].message.content
```

For structured error logging patterns, see [Error Handling Patterns](/how-to/error-handling-patterns-in-cycles-client-code).

## Next steps

- [Monitoring and Alerting](/how-to/monitoring-and-alerting) — alerting rules and budget monitoring patterns
- [Client Performance Tuning](/how-to/client-performance-tuning) — timeout and retry optimization
- [Production Operations Guide](/how-to/production-operations-guide) — server infrastructure
- [Server Configuration Reference](/configuration/server-configuration-reference-for-cycles) — all server properties
