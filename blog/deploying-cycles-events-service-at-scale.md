---
title: "Deploying the Cycles Events Service at Scale"
date: 2026-04-25
author: Albert Mavashev
tags:
  - operations
  - engineering
  - production
  - monitoring
  - webhooks
  - deployment
description: "How to run the Cycles events service in production: the 7980/9980 port split, Prometheus scraping, Kubernetes probes, and alert rules that actually page the right people."
blog: true
sidebar: false
featured: false
head:
  - - meta
    - name: keywords
      content: Cycles events service, Prometheus scraping, Kubernetes liveness readiness, Spring Boot Actuator, webhook monitoring, management port
---

# Deploying the Cycles Events Service at Scale

A dashboard compose file. A scheduled upgrade of `cycles-server-events` from `0.1.25.8` to `0.1.25.10`. The container pulls cleanly and starts, but ninety seconds later it's marked unhealthy and Docker is already cycling the restart. Nothing in the application log looks wrong. The webhook deliveries that were pending keep getting deferred until the container stops thrashing.

What changed between `.8` and `.10` isn't a bug — it's a deliberate architectural split. In `v0.1.25.9`, the events service moved its Spring Boot Actuator endpoints off the traffic-plane port `7980` and onto a separate management port `9980`. A compose healthcheck probing `http://localhost:7980/actuator/health` that worked on `.8` now 404s on `.10`. The fix is one line in the compose file — `7980` → `9980` — and the container goes healthy. But the reason behind the split is worth understanding, because it's the same architectural decision that Envoy, most Kubernetes workloads, and every mature Spring Boot deployment have converged on, for the same reason.

This post is about running the events service in production. The port split is the entry point; the longer story covers what Prometheus actually scrapes, how liveness and readiness probes should be configured under Kubernetes, and which metric alerts catch the classes of failure an events service can have before an operator notices downstream silence.

## Why the management port lives somewhere else

An events service has two distinct surfaces:

- **Traffic-plane surface** (port 7980): dispatches outbound webhook deliveries to tenant-configured URLs. Consumes events from Redis. Applies HMAC signing, trace-context propagation, retry scheduling, and dead-letter handling. This is the part the rest of your stack talks to; on a secure deployment, it never accepts inbound HTTP from the internet — the events service's network posture is outbound-only.
- **Management-plane surface** (port 9980): Spring Boot Actuator endpoints — `/actuator/health` for liveness and readiness, `/actuator/prometheus` for metrics scraping, `/actuator/info` for build and version info.

Collapsing these onto one port is convenient and wrong for three reasons:

1. **Threat model divergence.** Metrics endpoints reveal internal state (per-tenant delivery counts, queue depths, error rates) that should not be reachable from anything that reaches the public webhook surface. A port split lets the network policy block public reachability to management without affecting delivery.
2. **Lifecycle divergence.** A container might be "alive" (management responding) while being "not ready" (still priming connection pools, draining an old queue). Kubernetes probes model this as liveness vs. readiness, which requires the endpoints to be independently observable.
3. **Observability cardinality.** Prometheus scrapes metrics hundreds of times per day. A scraper hitting the same port as delivery dispatch introduces noise into delivery latency histograms and forces operators to carefully exclude their own monitoring traffic. Separating ports makes the metric surface cleaner.

The pattern isn't unique to Cycles. Envoy exposes its [admin interface](https://www.envoyproxy.io/docs/envoy/latest/operations/admin) on a separate port (default 9901) with the same threat-model rationale. Spring Boot's own documentation [recommends a separate management port](https://docs.spring.io/spring-boot/reference/actuator/endpoints.html) for non-trivial deployments. Kubernetes' [liveness vs. readiness probe guidance](https://kubernetes.io/docs/tasks/configure-pod-container/configure-liveness-readiness-startup-probes/) assumes you can probe them independently. Cycles' `v0.1.25.9` adopted the same shape.

## Compose: the minimal correct config

The docker-compose block for an events service that works on `v0.1.25.9+` looks like this:

```yaml
cycles-events:
  image: ghcr.io/runcycles/cycles-server-events:0.1.25.10
  restart: unless-stopped
  # No `ports:` stanza — the service has no public inbound surface.
  # Traffic-plane dispatch is outbound-only; only the management-plane
  # port (9980) needs to be reachable inside the Docker network, where
  # a co-located Prometheus scrapes it. Publish to the host only when
  # an operator needs local inspection.
  expose:
    - "9980"
  environment:
    REDIS_HOST: redis
    REDIS_PORT: 6379
    REDIS_PASSWORD: ${REDIS_PASSWORD}
    # In the current reference implementation, the AES-256-GCM key
    # used to encrypt webhook signing secrets at rest in Redis. An
    # empty value is accepted (plaintext fallback) for backward
    # compatibility with older dev deployments; production should set
    # a 32-byte base64-encoded key.
    WEBHOOK_SECRET_ENCRYPTION_KEY: ${WEBHOOK_SECRET_ENCRYPTION_KEY}
  healthcheck:
    test: ["CMD", "wget", "--spider", "-q", "http://localhost:9980/actuator/health"]
    interval: 10s
    timeout: 5s
    retries: 3
    start_period: 30s
  depends_on:
    redis:
      condition: service_healthy
```

Three things to note:

- **No published ports.** The events service doesn't accept inbound HTTP, so there's no reason to publish `7980`. `9980` stays reachable only inside the Docker network, where a co-located Prometheus scrapes it. Publish `9980` to the host only when an operator needs local inspection.
- **`start_period: 30s`.** The events service needs time to connect to Redis, warm connection pools, and load signing secrets before health should matter. Set this too short and a slow Redis round-trip during startup will trigger a premature restart loop.
- **`WEBHOOK_SECRET_ENCRYPTION_KEY`** (implementation detail). The plaintext-fallback behavior described above is specific to the current reference implementation — if you're on a different build or a forked image, confirm against that image's release notes before relying on it in production.

For stacks using the dashboard's reference compose, the `7980 → 9980` healthcheck edit was the fix that unblocked yesterday's upgrade incident; worth a branch-blame check if your stack's compose file dates from before mid-April 2026.

## Kubernetes: probing an outbound-only worker

The Cycles events service is an outbound-only worker — it reads from Redis, posts to tenant-configured URLs, and never accepts inbound application HTTP. That shape matters for probe design, because Spring Boot's documentation explicitly warns that [probing an actuator endpoint on a separate management context/port can succeed even when the main application can't accept new connections](https://docs.spring.io/spring-boot/reference/actuator/endpoints.html). For a typical inbound HTTP service, that warning is the reason to probe the traffic port rather than the management port.

For an outbound worker like the events service, the same warning doesn't bite the same way — there is no "main server" accepting connections, only a dispatcher loop consuming from Redis. Probing `9980/actuator/health` reflects whether the Spring context booted, its Redis connection is live, and the dispatcher is healthy. That's sufficient for this specific service shape. Still worth acknowledging the tradeoff rather than presenting it as a universal pattern.

A minimal probe config:

```yaml
spec:
  containers:
    - name: cycles-events
      image: ghcr.io/runcycles/cycles-server-events:0.1.25.10
      ports:
        - name: traffic
          containerPort: 7980
        - name: management
          containerPort: 9980
      # Startup probe gates liveness + readiness until bootstrap is done.
      # Kubernetes recommends this pattern for slow-starting containers
      # that need to initialize external connections (Spring, Redis,
      # dispatcher state) before health should count:
      # https://kubernetes.io/docs/tasks/configure-pod-container/configure-liveness-readiness-startup-probes/
      startupProbe:
        httpGet:
          path: /actuator/health/readiness
          port: management
        periodSeconds: 5
        failureThreshold: 24   # ~2 min headroom for first start
      livenessProbe:
        httpGet:
          path: /actuator/health/liveness
          port: management
        periodSeconds: 10
        failureThreshold: 3
      readinessProbe:
        httpGet:
          path: /actuator/health/readiness
          port: management
        periodSeconds: 5
        failureThreshold: 2
      env:
        - name: REDIS_HOST
          value: redis
        - name: WEBHOOK_SECRET_ENCRYPTION_KEY
          valueFrom:
            secretKeyRef:
              name: cycles-events-secrets
              key: webhook-encryption-key
```

Three things worth calling out:

- **`startupProbe` handles the bootstrap window** rather than large `initialDelaySeconds` on liveness. Kubernetes' [probe documentation](https://kubernetes.io/docs/tasks/configure-pod-container/configure-liveness-readiness-startup-probes/) recommends this specifically for slow-starting containers — liveness and readiness don't run until the startup probe succeeds, which is a cleaner fit for a worker that has to bootstrap Spring, Redis, and dispatcher state before health should count. A 24-try `failureThreshold` on a 5-second period gives roughly two minutes of startup headroom before Kubernetes decides the container is broken.
- **Use Spring Boot's `liveness` / `readiness` health groups** rather than the plain `/actuator/health` endpoint. Spring Boot's [built-in probe groups](https://docs.spring.io/spring-boot/docs/2.4.1/reference/html/production-ready-features.html) separate "is this instance alive" from "is this instance ready to do work," with their own `HealthIndicator` registration points. If you care about Redis specifically, the readiness group is where the `RedisHealthIndicator` output lands; liveness stays true as long as the JVM is responsive. If you don't need the separation, aliasing both probes to plain `/actuator/health` is a reasonable default.
- **Post-startup timing** on liveness and readiness can stay tight. Readiness on a 5-second period gets the pod back into and out of the service endpoint list quickly if Redis blips; liveness on a 10-second period with three failures catches a genuinely wedged JVM without being twitchy.

A NetworkPolicy that restricts port 9980 to the monitoring namespace (or equivalent) is the other half of the story — the management surface should not be reachable from anywhere a tenant-visible API surface can be reached.

## What Prometheus actually scrapes

The `/actuator/prometheus` endpoint returns standard Micrometer output. The metric families in the current reference implementation (exact names and tag lists are subject to change between releases — confirm against your build's emitted output):

| Metric family | Meaning |
|---|---|
| `cycles_webhook_delivery_attempts_total` | Every HTTP attempt. Tags: `tenant`, `event_type`. |
| `cycles_webhook_delivery_success_total` | Attempts that returned 2xx. Tags: `tenant`, `event_type`, `status_code_family`. |
| `cycles_webhook_delivery_failed_total` | Attempts that failed. Tags: `tenant`, `event_type`, `reason`. |
| `cycles_webhook_delivery_retried_total` | Retries scheduled. Tags: `tenant`, `event_type`. |
| `cycles_webhook_delivery_stale_total` | Deliveries marked failed without another HTTP attempt (exceeded the delivery-age ceiling). Tags: `tenant`. |
| `cycles_webhook_subscription_auto_disabled_total` | Subscriptions that hit the consecutive-failure threshold and were paused. Tags: `tenant`, `reason`. |
| `cycles_webhook_delivery_latency_seconds` | HTTP round-trip timer. Tags: `tenant`, `event_type`, `outcome`. |
| `cycles_webhook_events_payload_invalid_total` | Schema-validation discrepancies on emitted events. Tags: `type`, `rule`. |

A scrape config via `kube-prometheus-stack`'s `ServiceMonitor` CRD is the cleanest path on Kubernetes:

```yaml
apiVersion: monitoring.coreos.com/v1
kind: ServiceMonitor
metadata:
  name: cycles-events
  labels:
    release: kube-prometheus-stack
spec:
  selector:
    matchLabels:
      app: cycles-events
  endpoints:
    - port: management
      path: /actuator/prometheus
      interval: 30s
```

For non-operator Prometheus installs, a static scrape_config works equally well:

```yaml
- job_name: "cycles-events"
  metrics_path: "/actuator/prometheus"
  static_configs:
    - targets: ["cycles-events:9980"]
      labels:
        service: "cycles-events"
```

Thirty-second scrape interval is a reasonable default. Faster isn't free — a 5-second interval against a large tenant population produces a lot of label-cardinality pressure on the Prometheus side, and most of the signals you care about are slow enough (delivery failure rate, auto-disable count) to be visible at 30s resolution.

### A note on tenant cardinality

Every metric above is tagged with `tenant`. For deployments with a few dozen tenants, that's fine. For SaaS environments with thousands of tenants, the label-cardinality explosion will hurt Prometheus before anything else notices.

The current reference implementation exposes a `cycles.metrics.tenant-tag.enabled` config flag (default `true`) that strips the `tenant` label when set to `false`, keeping the metrics aggregable across all tenants. Per-tenant visibility then lives in the admin API's delivery history or a dedicated log-based observability path, not Prometheus. If you're north of a few hundred tenants this is usually worth flipping; confirm the exact flag name against your build before relying on it.

## Alerts that actually page the right person

A healthy events service is one you don't think about. The alerts worth paging on are the ones that indicate *silent* degradation — the class of problem where deliveries are still happening but with meaningful loss, because downstream consumers will notice that kind of drift long after an alert could have prevented the incident.

Three rules that cover most of the real failure modes:

```yaml
groups:
  - name: cycles-events
    rules:
      - alert: CyclesWebhookFailureRateHigh
        # Guard against divide-by-zero on windows with no attempts —
        # the AND clause only evaluates the ratio when there's at least
        # one attempt/sec in the window.
        expr: |
          (
            sum by (tenant) (rate(cycles_webhook_delivery_failed_total[5m]))
            / sum by (tenant) (rate(cycles_webhook_delivery_attempts_total[5m]))
          ) > 0.05
          and sum by (tenant) (rate(cycles_webhook_delivery_attempts_total[5m])) > 0
        for: 10m
        labels:
          severity: warning
        annotations:
          summary: ">5% webhook delivery failure rate for tenant {{ $labels.tenant }}"
          description: "Sustained failure rate. Check the subscription's target URL health."

      - alert: CyclesWebhookAutoDisabled
        expr: increase(cycles_webhook_subscription_auto_disabled_total[5m]) > 0
        labels:
          severity: critical
        annotations:
          summary: "Webhook subscription auto-disabled (tenant {{ $labels.tenant }})"
          description: "Subscription hit consecutive-failure threshold. Manual re-enable required."

      - alert: CyclesWebhookStaleDeliveries
        expr: rate(cycles_webhook_delivery_stale_total[15m]) > 0.1
        for: 15m
        labels:
          severity: warning
        annotations:
          summary: "Deliveries exceeding 24h timeout for tenant {{ $labels.tenant }}"
          description: "Backlog or outage preventing delivery attempts within the SLA window."
```

A note on the auto-disable alert: it's `critical` because the subscription is *paused* after the threshold hit — every subsequent event for that tenant accumulates in Redis without being attempted. This is the specific failure mode that turns "webhook receiver had a bad afternoon" into "we lost a day of event deliveries before noticing." Detect it fast.

The [Monitoring and Alerting how-to](/how-to/monitoring-and-alerting) has additional rules on Redis latency, overdraft events, and reservation denial-rate spikes — all from the same `/actuator/prometheus` endpoint, just on different services.

## Operational checks from the shell

Three curl commands worth bookmarking for the incident console:

```bash
# Health — expect 200 with {"status":"UP"}
curl -f http://localhost:9980/actuator/health

# Build and version — confirm which release is running
curl -s http://localhost:9980/actuator/info | jq

# Current webhook metrics — drop-in signal during a live incident
curl -s http://localhost:9980/actuator/prometheus \
  | grep -E 'cycles_webhook_(delivery_failed|subscription_auto_disabled)'
```

For a concrete replay loop — taking a failed delivery and re-sending it through a fixed receiver — see the [webhook idempotency post](/blog/webhook-idempotency-patterns-for-ai-agent-budget-events), which covers the receiver-side dedup patterns that let replay be safe.

## Migrating deployments that pre-date v0.1.25.9

If your compose or Helm chart was written before `v0.1.25.9`, the healthcheck is the one thing most likely to break silently on upgrade. The safe sequencing — verified against your own image's release notes for the specifics of any given build — is:

1. **Before upgrading the image**, update your healthchecks and probes to use `9980/actuator/health` rather than `7980/actuator/health`. On builds where the health endpoint was dual-homed in the transition period, this is a no-op; on builds that hard-moved it, this is the fix.
2. **Upgrade the image to v0.1.25.9+**.

If the compose change is skipped, the symptom is exactly what opened this post: image pulls, container starts, healthcheck 404s, orchestrator cycles the container. Easy to diagnose once you look at the manifest, easy to fix, but better to avoid by sequencing the config change ahead of the image bump.

## The takeaway

The management-port split isn't a Cycles quirk. It's the same pattern Envoy, mature Spring Boot deployments, and the Kubernetes probe model have all converged on, because the operational surfaces of a running service and the monitoring-and-control surfaces of that same service have different threat models, different lifecycles, and different observability characteristics. Running the Cycles events service at scale is mostly a matter of pointing Prometheus at `9980`, wiring up two or three alerts on the metric family that actually indicates silent degradation, and keeping `7980` strictly outbound.

## Related reading

- [Webhook Idempotency Patterns for AI Agent Budget Events](/blog/webhook-idempotency-patterns-for-ai-agent-budget-events) — receiver-side dedup patterns that complement the sender-side reliability described here
- [Operational Runbook: Using Cycles Runtime Events](/blog/operational-runbook-using-cycles-runtime-events) — severity tiers and on-call triage patterns for the events this service delivers
- [Real-Time Budget Alerts for AI Agents](/blog/real-time-budget-alerts-for-ai-agents) — the event-system architecture motivation and the 45 event types flowing through it
- [Monitoring and Alerting](/how-to/monitoring-and-alerting) — additional Prometheus alert rules across Cycles services (Redis, reservation denial-rate, overdraft)
- [Production Operations Guide](/how-to/production-operations-guide) — Redis HA, multi-instance Cycles server, capacity planning
- [Security — Webhook security](/security#webhook-security) — HMAC signing, signing-secret encryption at rest, SSRF protection
- [Spring Boot Actuator reference](https://docs.spring.io/spring-boot/reference/actuator/endpoints.html) — the pattern Cycles embeds, documented upstream
- [Envoy admin interface](https://www.envoyproxy.io/docs/envoy/latest/operations/admin) — the equivalent separation in a different service
- [Kubernetes liveness and readiness probes](https://kubernetes.io/docs/tasks/configure-pod-container/configure-liveness-readiness-startup-probes/) — the upstream probe-design guidance the probe config in this post follows

## Related how-to guides

- [Prometheus metrics reference](/how-to/prometheus-metrics-reference)
- [Webhook integrations](/how-to/webhook-integrations)
- [Using the Cycles dashboard](/how-to/using-the-cycles-dashboard)
