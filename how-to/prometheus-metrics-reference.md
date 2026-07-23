---
title: "Prometheus Metrics Reference"
description: "Reference for every Prometheus counter and timer in cycles-server, events, and admin — tag definitions, cardinality, scrape config."
---

# Prometheus Metrics Reference

This page enumerates every custom metric that Cycles' reference servers expose on their Prometheus endpoints, along with tag definitions, cardinality guidance, and a sample scrape config. For the higher-level observability playbook (alert recipes, SLOs) see [Monitoring and Alerting](/how-to/monitoring-and-alerting).

Cycles' Micrometer instrumentation uses dotted source names (`cycles.*`) which Prometheus rewrites to underscores with a `_total` suffix on scrape. Source names below are the raw Micrometer identifier; the **Prometheus** column is what you actually query and alert on.

::: info Tenant-tag cardinality flag
Every counter tagged with `tenant` respects a per-service toggle, `cycles.metrics.tenant-tag.enabled` (env `CYCLES_METRICS_TENANT_TAG_ENABLED`) — but the **defaults differ by service**: `cycles-server` (runtime) defaults to `true`, while `cycles-server-events` defaults to `false`. The admin server's `cycles_admin_*` counters carry no `tenant` tag at all, so the flag doesn't apply there. Deployments with many thousands of tenants can flip the runtime flag to `false` to drop the per-tenant series and keep Prometheus cardinality bounded; deployments that want per-tenant webhook drill-downs must explicitly enable it on the events service. Set the flag consistently across the two services so dashboards can share the same tag schema.

For the operation counters below, null or blank tag values are normalised to the sentinel `UNKNOWN` (exception: `cycles.evidence.emit_failed` uses lowercase `unknown` for a null `artifact_type` and does not normalise blanks). Missing tags would otherwise collapse series — making it look like traffic moved when the upstream data actually just got sparse.
:::

## Scrape targets

| Service | Scrape port | Prometheus path |
|---|---|---|
| `cycles-server` (runtime) | `7878` (same as API) | `/actuator/prometheus` |
| `cycles-server-events` (dispatcher) | **`9980`** (dedicated management port, split from app port `7980` in v0.1.25.9, env `MANAGEMENT_PORT`) | `/actuator/prometheus` |
| `cycles-server-admin` | `7979` (same as API) | `/actuator/prometheus` |

**Events-service port split.** Starting with `cycles-server-events` v0.1.25.9, the `health`, `info`, and `prometheus` actuator endpoints moved from the application port `7980` to a dedicated management port (default `9980`, env `MANAGEMENT_PORT`). Scrape configs, kubelet probes, and Docker `HEALTHCHECK` commands must target `:9980` — the published Docker image's `HEALTHCHECK` is already updated. Do not publish `7980` for webhook delivery; keep both events-service ports internal-only.

## Runtime server (`cycles-server`)

Introduced in v0.1.25.10. All counters live under the `cycles.*` namespace.

| Source | Prometheus | Type | Tags | Description |
|---|---|---|---|---|
| `cycles.reservations.reserve` | `cycles_reservations_reserve_total` | Counter | `tenant`, `decision`, `reason`, `overage_policy` | Every `POST /v1/reservations` outcome. |
| `cycles.reservations.commit` | `cycles_reservations_commit_total` | Counter | `tenant`, `decision`, `reason`, `overage_policy` | Every `POST /v1/reservations/{id}/commit` outcome. |
| `cycles.reservations.release` | `cycles_reservations_release_total` | Counter | `tenant`, `actor_type`, `decision`, `reason` | Every release outcome (`decision` is `RELEASED` or `DENY`). `actor_type` distinguishes tenant-driven releases from v0.1.25.8 admin-on-behalf-of releases. |
| `cycles.reservations.extend` | `cycles_reservations_extend_total` | Counter | `tenant`, `decision`, `reason` | Every `POST /v1/reservations/{id}/extend` outcome. |
| `cycles.reservations.expired` | `cycles_reservations_expired_total` | Counter | `tenant` | Each reservation the expiry sweep actually marks EXPIRED. Skipped reservations (still in grace, already finalised) do not increment. |
| `cycles.events` | `cycles_events_total` | Counter | `tenant`, `decision`, `reason`, `overage_policy` | Every `POST /v1/events` outcome. |
| `cycles.overdraft.incurred` | `cycles_overdraft_incurred_total` | Counter | `tenant` | Any commit or event that actually accrued non-zero debt. Unit-free signal — debt amount is tracked by the balance store, not here, to avoid leaking user-value distributions into metrics. |
| `cycles.evidence.emit_failed` | `cycles_evidence_emit_failed_total` | Counter | `artifact_type` | Evidence-source enqueue failures (fail-open path) — a lifecycle op committed but its evidence record could not be queued (e.g. Redis died just after the ledger write). No `tenant` tag. |

### Tag value reference (runtime)

| Tag | Values |
|---|---|
| `decision` | Per-operation success/deny outcome. Reserve: `ALLOW`, `ALLOW_WITH_CAPS`, `DENY`. Commit: `COMMITTED`, `DENY`. Release: `RELEASED`, `DENY`. Extend: `ACTIVE`, `DENY`. Events: `APPLIED`, `DENY`. |
| `reason` | `OK` on success, `IDEMPOTENT_REPLAY` on idempotent replays, an `ErrorCode` name on denials (`BUDGET_EXCEEDED`, `BUDGET_FROZEN`, `BUDGET_CLOSED`, `RESERVATION_EXPIRED`, `RESERVATION_FINALIZED`, `IDEMPOTENCY_MISMATCH`, `UNIT_MISMATCH`, `OVERDRAFT_LIMIT_EXCEEDED`, `DEBT_OUTSTANDING`, `MAX_EXTENSIONS_EXCEEDED`, `NOT_FOUND`, …), or `INTERNAL_ERROR` on unexpected failures. `UNKNOWN` when the code path doesn't produce one. |
| `overage_policy` | `REJECT`, `ALLOW_IF_AVAILABLE`, `ALLOW_WITH_OVERDRAFT` — which commit overage policy was in effect for the scope. `UNKNOWN` when not resolved. |
| `actor_type` | `tenant` (tenant-driven) or `admin_on_behalf_of` (admin-driven, v0.1.25.8+). |

### Not instrumented (by design)

- **HTTP-layer latency histograms** — Spring Boot auto-emits `http.server.requests` with `uri` / `method` / `status` labels already. Use those for per-endpoint latency.
- **Lua-script execution time** — `EVALSHA` timings would largely duplicate the HTTP timer for request-synchronous scripts. The expiry-sweep counter (`cycles.reservations.expired`) covers the one non-request-driven path.

## Events service (`cycles-server-events`)

Introduced in v0.1.25.6. Mirrors the runtime's conventions: `cycles.webhook.*` rewrites to `cycles_webhook_*_total` (counters) or `cycles_webhook_*_seconds` (timer). Unlike the runtime, this service emits an explicit latency timer because it's the HTTP *client* — Spring's auto `http.server.requests` doesn't cover its primary I/O surface.

| Source | Prometheus | Type | Tags | Description |
|---|---|---|---|---|
| `cycles.webhook.delivery.attempts` | `cycles_webhook_delivery_attempts_total` | Counter | `tenant`, `event_type` | Every outbound delivery attempt (first attempt + every retry). |
| `cycles.webhook.delivery.success` | `cycles_webhook_delivery_success_total` | Counter | `tenant`, `event_type`, `status_code_family` | Successful deliveries. `status_code_family`: `2xx`. |
| `cycles.webhook.delivery.failed` | `cycles_webhook_delivery_failed_total` | Counter | `tenant`, `event_type`, `reason` | Failed deliveries. `reason` is one of `event_not_found`, `subscription_not_found`, `subscription_inactive`, `http_4xx`, `http_5xx`, `transport_error`, `ssrf_blocked`. |
| `cycles.webhook.delivery.retried` | `cycles_webhook_delivery_retried_total` | Counter | `tenant`, `event_type` | Deliveries that re-entered the retry queue. |
| `cycles.webhook.delivery.stale` | `cycles_webhook_delivery_stale_total` | Counter | `tenant` | Deliveries auto-failed on pickup for exceeding `dispatch.max-delivery-age-ms` (default 24h). |
| `cycles.webhook.subscription.auto_disabled` | `cycles_webhook_subscription_auto_disabled_total` | Counter | `tenant`, `reason` | Subscriptions auto-disabled after consecutive failures crossed the threshold. `reason` is `consecutive_failures` (the accompanying `webhook.disabled` Event's payload uses the longer `disable_reason=consecutive_failures_exceeded_threshold`). Always emitted together with a `webhook.disabled` Event (v0.1.25.11). |
| `cycles.webhook.delivery.latency` | `cycles_webhook_delivery_latency_seconds` | Timer | `tenant`, `event_type`, `outcome` | Round-trip time on deliveries that actually produced a transport response. `outcome`: `success` or `failure`. Upstream failures (event_not_found, etc.) have no meaningful latency and do not record to this timer. |
| `cycles.webhook.events.payload.invalid` | `cycles_webhook_events_payload_invalid_total` | Counter | `type`, `rule` | Non-fatal shape discrepancy found by `EventPayloadValidator` on an ingested event. No tenant dimension — the discrepancy is about payload shape, not tenant traffic. `rule` values: `missing_required`, `unknown_event_type`, `unknown_category`, `category_mismatch`, `budget_data_shape`, `reset_spent_shape`, `trace_id_shape`. |

### Tag value reference (events)

| Tag | Values |
|---|---|
| `event_type` | Event kind from the [Event Payloads Reference](/protocol/event-payloads-reference) (e.g. `reservation.denied`, `budget.exhausted`, `webhook.disabled`). Up to 51 registered values, plus additive implementation events over time. |
| `status_code_family` | `2xx` (success bucket). Non-2xx responses land on `cycles_webhook_delivery_failed_total` with `reason` instead. |
| `reason` (on `_failed_total`) | `event_not_found`, `subscription_not_found`, `subscription_inactive`, `http_4xx`, `http_5xx`, `transport_error` (timeouts, connection resets, DNS/SSL failures — status code 0), `ssrf_blocked`. |

## Admin server (`cycles-server-admin`)

Exposed since admin observability rollout (v0.1.25.9+). Metric names use the `cycles_admin_*` prefix.

| Prometheus | Type | Tags | Description |
|---|---|---|---|
| `cycles_admin_audit_writes_total` | Counter | `path_class`, `outcome` | Audit-trail write accounting. `outcome` values: `written`, `error` (Redis write failed — alert on nonzero), `sampled-out` (pre-auth sampling dropped the entry per `audit.sample.unauthenticated`). `path_class` groups endpoints for coarse-grained triage. Shipped v0.1.25.20 alongside the audit-on-failure coverage. |
| `cycles_admin_events_emitted_total` | Counter | `type`, `result` | Admin-emitted Event accounting. `result`: `success` or `failure`. |
| `cycles_admin_events_payload_invalid_total` | Counter | `type`, `expected_class` | Jackson round-trip found an Event payload that didn't match its declared schema. Non-fatal — admin continues to accept the event. Shipped v0.1.25.12. |
| `cycles_admin_webhook_dispatched_total` | Counter | `result` | Enqueue-to-dispatcher accounting. The end-to-end delivery metric is `cycles_webhook_delivery_*` on the events service. |

## Sample scrape config

Since `cycles-server` 0.1.25.45, the runtime and admin `/actuator/prometheus` endpoints require the `X-Admin-API-Key` header (liveness/readiness probe paths stay public). Prometheus v3.0+ can send it via `http_headers`; on older versions, front the endpoint with a header-injecting proxy. The events service's management port has no auth filter — keep it internal-only.

```yaml
scrape_configs:
  - job_name: cycles-runtime
    metrics_path: /actuator/prometheus
    http_headers:
      X-Admin-API-Key:
        secrets: ['${ADMIN_API_KEY}']
    static_configs:
      - targets: ['cycles-server:7878']

  - job_name: cycles-events
    metrics_path: /actuator/prometheus   # no admin key needed — network-restrict instead
    static_configs:
      - targets: ['cycles-server-events:9980']  # management port, NOT the app port (7980)

  - job_name: cycles-admin
    metrics_path: /actuator/prometheus
    http_headers:
      X-Admin-API-Key:
        secrets: ['${ADMIN_API_KEY}']
    static_configs:
      - targets: ['cycles-server-admin:7979']
```

## Cardinality guidance

The `tenant` tag is the dominant cardinality driver. A deployment with 10,000 tenants and all seven runtime counters produces ~70,000 time series just from the tenant dimension. If Prometheus memory / scrape duration becomes a concern:

1. **Flip `cycles.metrics.tenant-tag.enabled` to `false`** on the runtime server (the events service already defaults to `false`). Counters drop the `tenant` tag; you lose per-tenant drill-downs but keep decision / reason / outcome signals.
2. **Aggregate at scrape time** with `metric_relabel_configs` to drop the tag selectively on high-cardinality metrics while keeping it on the ones you still want tenant-sliced.
3. **Keep per-tenant on Timer, drop on Counters** if delivery-latency-per-tenant is the signal you care about most.

`event_type` is bounded by the spec (51 registered values today, additive over time). `reason` and `decision` are enum-bounded and safe.

## Quick alert recipes

| Signal | Query | Typical threshold |
|---|---|---|
| Audit-write error | `sum(rate(cycles_admin_audit_writes_total{outcome="error"}[5m])) > 0` | Any nonzero — audit trail has a gap. |
| Webhook auto-disable rate | `sum(rate(cycles_webhook_subscription_auto_disabled_total[15m])) > 0` | Any nonzero — a subscription was just auto-disabled. |
| Overdraft rate spike | `sum(rate(cycles_overdraft_incurred_total[5m])) / sum(rate(cycles_reservations_commit_total[5m])) > 0.05` | Over 5% of commits are going into overdraft. |
| Dispatch worst-case latency | `max_over_time(cycles_webhook_delivery_latency_seconds_max{outcome="success"}[5m])` | Over 10s — something downstream is struggling. (For a true p95 via `histogram_quantile` over `_bucket` series, first enable Micrometer percentile histograms for this timer — no service publishes `_bucket` series by default.) |
| Stale-delivery rate | `sum(rate(cycles_webhook_delivery_stale_total[1h])) > 0` | Any nonzero — deliveries are sitting in-queue past `dispatch.max-delivery-age-ms`. |

For the full set of alerts and SLOs see [Monitoring and Alerting](/how-to/monitoring-and-alerting) and [Production Operations](/how-to/production-operations-guide).
