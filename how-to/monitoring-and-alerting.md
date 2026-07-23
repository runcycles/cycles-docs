---
title: "Monitoring and Alerting"
description: "Key metrics, alerting thresholds, and observability patterns for monitoring a production Cycles deployment. Covers balances, reservations, budget exhaustion, and webhook delivery."
---

# Monitoring and Alerting

This guide covers key metrics to monitor, alerting thresholds, and observability patterns for a production Cycles deployment.

## Key metrics

### Budget utilization

The most important metric. Track the ratio of spent to allocated for each scope:

```
utilization = (spent + reserved) / allocated × 100%
```

**Alert thresholds:**

| Level | Threshold | Action |
|---|---|---|
| Warning | 80% | Notify team. Budget is running low — consider funding or reducing usage. |
| Critical | 95% | Page on-call. Imminent budget exhaustion will start denying requests. |
| Exhausted | 100% | All reservations denied. Fund immediately or accept denial. |

### Query balances for monitoring

```bash
# Get all balances for a tenant
curl -s "http://localhost:7878/v1/balances?tenant=acme-corp" \
  -H "X-Cycles-API-Key: $API_KEY" | jq '.balances[] | {scope, allocated, remaining, spent, reserved, debt}'
```

Build a polling monitor that queries balances and pushes to your metrics system:

```python
import time
import requests

def poll_budgets():
    response = requests.get(
        "http://localhost:7878/v1/balances",
        params={"tenant": "acme-corp"},
        headers={"X-Cycles-API-Key": API_KEY},
    )
    for balance in response.json()["balances"]:
        allocated = balance["allocated"]["amount"]
        if allocated > 0:
            utilization = (balance["spent"]["amount"] + balance["reserved"]["amount"]) / allocated
            push_metric(
                name="cycles.budget.utilization",
                value=utilization,
                tags={"scope": balance["scope"], "unit": balance["allocated"]["unit"]},
            )
            push_metric(
                name="cycles.budget.remaining",
                value=balance["remaining"]["amount"],
                tags={"scope": balance["scope"]},
            )

while True:
    poll_budgets()
    time.sleep(60)  # Poll every minute
```

For the full list of fields available on every reservation and event, see [Standard Metrics and Metadata](/protocol/standard-metrics-and-metadata-in-cycles).

### Reservation metrics

Track reservation lifecycle events:

| Metric | What to watch |
|---|---|
| **Reservations created/sec** | Throughput baseline. Sudden spikes may indicate loops. |
| **Reservation denial rate** | Percentage of reservations denied (`BUDGET_EXCEEDED`). High rates mean budgets are too tight or traffic is too high. |
| **Reservation TTL expiry rate** | Reservations expiring before commit. Indicates operations are taking too long or heartbeat is not working. |
| **Average reservation duration** | Time from reserve to commit. Growing duration may indicate slow downstream services. |
| **Active reservation count** | Current in-flight reservations. Sustained growth suggests commit/release failures. |

### Server health metrics

All three Cycles services expose Spring Boot Actuator. The exposed endpoints are `health`, `info`, and `prometheus`. On the runtime and admin servers (since `cycles-server` 0.1.25.45 and the matching admin release), the aggregate `/actuator/health` and `/actuator/prometheus` endpoints require the `X-Admin-API-Key` header; only the liveness/readiness probe sub-paths stay public for orchestrators:

```bash
# Cycles Server (runtime) — aggregate health + prometheus need the admin key
curl -H "X-Admin-API-Key: $ADMIN_KEY" http://localhost:7878/actuator/health
curl -H "X-Admin-API-Key: $ADMIN_KEY" http://localhost:7878/actuator/prometheus
curl http://localhost:7878/actuator/health/liveness    # public
curl http://localhost:7878/actuator/health/readiness   # public

# Admin Server — same auth model
curl -H "X-Admin-API-Key: $ADMIN_KEY" http://localhost:7979/actuator/health
curl http://localhost:7979/actuator/health/liveness    # public
curl http://localhost:7979/actuator/health/readiness   # public
curl -H "X-Admin-API-Key: $ADMIN_KEY" http://localhost:7979/actuator/prometheus

# Events Service — management port 9980, no auth filter in the reference
# deployment; restrict it at the network layer
curl http://localhost:9980/actuator/health
curl http://localhost:9980/actuator/prometheus
```

::: tip Liveness/readiness probes
All three services enable Spring's liveness/readiness probes (`management.endpoint.health.probes.enabled=true`), exposing `/actuator/health/liveness` and `/actuator/health/readiness`. The readiness group includes the Redis health indicator. These probe paths are deliberately exempt from the admin-key requirement so Kubernetes can call them.
:::

Key server metrics (all derived from Spring Boot's default Micrometer registrations — see [Observability Setup](/how-to/observability-setup) for the full metric list):

| Metric | Component | Threshold |
|---|---|---|
| Response latency — `http_server_requests_seconds_max` (or p99 from `_bucket` if you enable percentile histograms) | Cycles Server | Alert if > 50ms |
| Error rate (5xx) — `http_server_requests_seconds_count{status=~"5.."}` | Cycles Server, Admin Server | Alert if > 1% |
| JVM heap usage — `jvm_memory_used_bytes{area="heap"}` / `jvm_memory_max_bytes{area="heap"}` | All services | Alert if > 80% |
| Redis connection pool usage | All services | No server-side metric exposed today — monitor via Redis `CLIENT LIST` or a Redis exporter. |

### Events Service metrics

The Events Service delivers webhooks asynchronously. Its management port is 9980 by default; the app port 7980 has no operator-facing API in the current reference service. Monitor separately:

| Metric | What to watch |
|---|---|
| **Queue depth** (`redis-cli LLEN dispatch:pending`) | Sustained growth means delivery is falling behind. Should be near zero. |
| **Delivery success rate** | Percentage of deliveries receiving HTTP 2xx. Drops indicate endpoint issues. |
| **Retry rate** | High retry rates signal unreliable webhook endpoints or network issues. |
| **Auto-disabled subscriptions** | Any auto-disabled subscription needs investigation — the endpoint failed repeatedly. |
| **Delivery latency** | Time from event creation to successful delivery. Growing latency signals backlog. |

## Alerting rules

::: info Custom `cycles_*` metrics ship with the server
Runtime `cycles-server` ≥ `0.1.25.10` emits the reservation-lifecycle counters (`cycles_reservations_*_total`, `cycles_events_total`, `cycles_overdraft_incurred_total`). Admin `cycles-server-admin` ≥ `0.1.25.9` emits `cycles_admin_events_emitted_total` and `cycles_admin_webhook_dispatched_total`; `cycles_admin_events_payload_invalid_total` arrived in `0.1.25.12` and `cycles_admin_audit_writes_total` in `0.1.25.20`. All are exposed at `/actuator/prometheus`. See [Custom Cycles metrics](/how-to/observability-setup#custom-cycles-metrics) for the full catalogue (reservation lifecycle, events, overdraft, admin webhooks/events).

The alert rules below use these counters directly where they exist. For signals without a first-class counter (budget utilization, active-reservation count, dispatch-queue depth), derive from balance polling or Redis directly — shown where relevant.
:::

### Prometheus example (using default metrics)

::: warning Percentile histograms are off by default
None of the three services enable Micrometer percentile histograms out of the box, so `http_server_requests_seconds_bucket` series do not exist and `histogram_quantile()` returns nothing. Either enable them (`management.metrics.distribution.percentiles-histogram.http.server.requests=true`) to use the p99 rule below, or alert on `http_server_requests_seconds_max` instead. Also note the `application` tag values: runtime is `cycles-protocol-service`, admin is `cycles-admin-service`, and the events service sets **no** `application` tag — `application=~"cycles-.*"` selectors will not match its series.
:::

```yaml
groups:
  - name: cycles
    rules:
      # Latency — requires percentile histograms enabled (see note above);
      # otherwise use: max_over_time(http_server_requests_seconds_max{...}[5m]) > 0.05
      - alert: CyclesServerLatency
        expr: histogram_quantile(0.99, sum by (le) (rate(http_server_requests_seconds_bucket{application="cycles-protocol-service",uri=~"/v1/reservations.*|/v1/decide"}[5m]))) > 0.05
        for: 5m
        labels:
          severity: warning
        annotations:
          summary: "Cycles Server p99 latency above 50ms on reservation/decide path"

      # 5xx error rate
      - alert: CyclesServerErrors
        expr: |
          sum(rate(http_server_requests_seconds_count{application=~"cycles-.*",status=~"5.."}[5m]))
            / sum(rate(http_server_requests_seconds_count{application=~"cycles-.*"}[5m]))
            > 0.01
        for: 5m
        labels:
          severity: critical
        annotations:
          summary: "Cycles 5xx error rate above 1%"

      # JVM heap pressure
      - alert: CyclesJvmHeapHigh
        expr: |
          jvm_memory_used_bytes{application=~"cycles-.*",area="heap"}
            / jvm_memory_max_bytes{application=~"cycles-.*",area="heap"}
            > 0.8
        for: 10m
        labels:
          severity: warning
        annotations:
          summary: "JVM heap usage above 80% for {{ $labels.application }}"
```

### Denial-rate and overdraft alerts (from `cycles_*` counters)

::: tip Why denial rate can't come from `http_server_requests_seconds*`
A live `POST /v1/reservations` denial returns **HTTP 409** with `error: BUDGET_EXCEEDED` — but 409 also covers idempotency mismatches, frozen budgets, and other conflicts, so HTTP status alone can't isolate budget denials. (Only `/v1/decide` and dry-run reserve surface denials as HTTP 200 with `"decision": "DENY"` in the body, which the HTTP histogram can't see at all.) Use the `cycles_reservations_reserve_total` counter instead: its `decision` tag carries `ALLOW`, `ALLOW_WITH_CAPS`, or `DENY`, and `reason` carries the deny code (`BUDGET_EXCEEDED`, `BUDGET_FROZEN`, …). (`ALLOW_WITH_OVERDRAFT` is a value on the separate `overage_policy` tag — the budget's commit-overage policy — not a reservation decision.)
:::

```yaml
- alert: CyclesHighDenialRate
  expr: |
    sum by (tenant) (rate(cycles_reservations_reserve_total{decision="DENY"}[5m]))
    / sum by (tenant) (rate(cycles_reservations_reserve_total[5m]))
    > 0.1
  for: 5m
  labels:
    severity: warning
  annotations:
    summary: "Over 10% of reservations being denied for {{ $labels.tenant }}"
    # Note: the `reason` label is aggregated away by `sum by (tenant)` and is
    # not available in annotations here. To see top deny reasons, run
    # `topk(5, sum by (reason) (rate(cycles_reservations_reserve_total{decision="DENY"}[5m])))`
    # in the Prometheus UI, or alert per-reason with `sum by (tenant, reason)`.

- alert: CyclesOverdraftSpike
  expr: |
    sum by (tenant) (rate(cycles_overdraft_incurred_total[5m])) > 0
  for: 10m
  labels:
    severity: warning
  annotations:
    summary: "Tenant {{ $labels.tenant }} incurring overdraft debt for 10m+"

- alert: CyclesReservationExpirySpike
  expr: |
    sum by (tenant) (rate(cycles_reservations_expired_total[5m])) > 1
  for: 10m
  labels:
    severity: warning
  annotations:
    summary: "Reservation expiry rate elevated for {{ $labels.tenant }} — callers likely failing to commit"
```

### Balance-polling alerts (for signals without a counter)

Some operational questions don't have a direct counter — point-in-time utilization (`spent / allocated`), total debt, and active-reservation counts are all derivable from the ledger but not emitted as gauges. For those, a lightweight sidecar that calls `GET /v1/balances` or `GET /v1/admin/budgets` on a schedule and pushes the sampled values (e.g. `cycles_budget_utilization`, `cycles_budget_debt`) via pushgateway or statsd is the standard pattern. See [Query balances for monitoring](#query-balances-for-monitoring).

### Webhook delivery queue depth

The events service has no `cycles_dispatch_pending_length` gauge yet. Scrape Redis directly with `redis_exporter` — when configured with `--check-single-keys=dispatch:pending`, the exporter exposes the list length as `redis_key_size{key="dispatch:pending"}`:

```yaml
- alert: CyclesWebhookQueueBacklog
  expr: redis_key_size{key="dispatch:pending"} > 100
  for: 5m
  labels:
    severity: warning
  annotations:
    summary: "Webhook delivery queue depth above 100 — Events Service may be falling behind"
```

For delivery success / failure rates and auto-disabled subscriptions, query the admin API (`GET /v1/admin/webhooks/{id}/deliveries?status=FAILED`) on a schedule and push the sampled counts to your metrics pipeline.

## Dashboard suggestions

::: tip Ready-made operations dashboard
Before building a custom Grafana dashboard, consider the [Cycles Admin Dashboard](/quickstart/deploying-the-cycles-dashboard) — a Vue 3 SPA that ships with an Overview page covering entity counts, top offenders, failing webhooks, and over-limit scopes, plus drill-downs for budgets, events, webhooks, audit, and reservations. It's not a Prometheus dashboard (no time-series charts), but it covers the operator workflows below without any setup. Use it for day-two ops; build the Grafana dashboards described here for time-series alerting and trend analysis.
:::

### Budget overview dashboard

Display for each tenant/scope:

- **Allocated** — total budget
- **Spent** — cumulative spend
- **Reserved** — currently locked by active reservations
- **Remaining** — available for new reservations
- **Debt** — outstanding debt from overdraft commits
- **Utilization %** — gauge showing spent/allocated ratio

### Reservation activity dashboard

- **Reservations/minute** — time series chart showing throughput
- **Decision distribution** — pie chart: ALLOW vs ALLOW_WITH_CAPS vs DENY
- **Avg reservation duration** — time from reserve to commit
- **Expiry rate** — percentage of reservations that expire without commit
- **Top spenders** — table showing which scopes are consuming the most

### Operational health dashboard

- **Server response latency** — p50, p95, p99 time series (Cycles Server + Admin Server)
- **Error rate** — 4xx and 5xx rate across all services
- **Redis connection pool** — active vs available connections
- **Active reservations** — current count (should be bounded)

### Webhook delivery dashboard

- **Queue depth** — `dispatch:pending` length over time (should trend toward zero)
- **Delivery rate** — successful deliveries/minute
- **Retry rate** — retries/minute (indicates endpoint reliability)
- **Failed deliveries** — failed after max retries
- **Auto-disabled subscriptions** — count of subscriptions disabled due to consecutive failures
- **Delivery latency** — time from event to successful delivery (p50, p95)

## Log-based monitoring

If you don't have a metrics pipeline, monitor from server logs:

```bash
# Watch for budget-denied requests (409s are logged as
# "Cycles protocol exception handled: ... error=BUDGET_EXCEEDED ...")
docker compose logs -f cycles-server | grep "error=BUDGET_EXCEEDED"

# Watch for clients hitting already-expired reservations (410s).
# Note: the expiry sweep itself logs successful expirations at DEBUG only —
# use the cycles_reservations_expired_total counter or reservation.expired
# events for expiry-rate monitoring rather than logs.
docker compose logs -f cycles-server | grep "error=RESERVATION_EXPIRED"

# Watch for webhook delivery failures (terminal and transport-level)
docker compose logs -f cycles-events | grep "Webhook delivery permanently failed"
docker compose logs -f cycles-events | grep "Webhook delivery transport failed"

# Watch for auto-disabled subscriptions
docker compose logs -f cycles-events | grep "Webhook subscription auto-disabled"

# Watch for errors across all services
docker compose logs -f cycles-server cycles-admin cycles-events | grep "ERROR"
```

For structured logging, pipe to your log aggregation system (ELK, Datadog, CloudWatch) and create alerts on log patterns.

## Next steps

- [Observability Setup](/how-to/observability-setup) — Prometheus, Grafana, and Datadog integration
- [Production Operations Guide](/how-to/production-operations-guide) — deployment and infrastructure
- [Security Hardening](/how-to/security-hardening) — securing the deployment
- [Server Configuration Reference](/configuration/server-configuration-reference-for-cycles) — all server settings
