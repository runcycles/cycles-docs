---
title: "Client Configuration Reference for the Cycles Spring Boot Starter"
description: "Complete reference for all configuration properties in the Cycles Spring Boot Starter client library, including environment-specific profiles."
---

# Client Configuration Reference for the Cycles Spring Boot Starter

::: tip Using Python?
See the [Python Client Configuration Reference](/configuration/python-client-configuration-reference) instead.
:::

This is the complete reference for all configuration properties available in the Cycles Spring Boot Starter.

::: tip Using Spring AI advisors?
This page covers the underlying `cycles.*` client properties. See the [Spring AI Starter Configuration Reference](/configuration/spring-ai-starter-configuration-reference) for the separate `cycles.spring-ai.*` advisor, token-estimation, tool-gating, and tracing properties.
:::

All properties are under the `cycles` prefix in your project's `application.yml` (or `application.properties`).

## Required properties

| Property | Type | Description |
|---|---|---|
| `cycles.base-url` | String | Base URL of the Cycles server (e.g., `http://localhost:7878`) |
| `cycles.api-key` | String | API key for authentication |

If either is missing or blank, the application will fail to start with a configuration error.

## Subject defaults

These properties set default values for the Subject fields used in `@Cycles` annotations. They apply to all annotated methods unless overridden at the annotation level or by a `CyclesFieldResolver`.

| Property | Type | Default | Description |
|---|---|---|---|
| `cycles.tenant` | String | (none) | Default tenant |
| `cycles.workspace` | String | (none) | Default workspace |
| `cycles.app` | String | (none) | Default application name |
| `cycles.workflow` | String | (none) | Default workflow |
| `cycles.agent` | String | (none) | Default agent |
| `cycles.toolset` | String | (none) | Default toolset |

### Resolution order

For each Subject field, the starter resolves the value using this priority:

1. **Annotation attribute** — if set on the `@Cycles` annotation, it wins
2. **Configuration property** — if set in `application.yml`
3. **CyclesFieldResolver bean** — if a bean named after the field exists (e.g., a bean named `"tenant"` implementing `CyclesFieldResolver`)

If none of these provide a value, the field is omitted from the request.

### Per-annotation overrides and budget scope targeting

When you override a subject field on `@Cycles`, the resolved subject changes, which targets a different budget scope on the server.

**Example:** Given this configuration:

```yaml
cycles:
  tenant: acme
  workspace: production
  app: support-bot
```

A method with `@Cycles(value = "1000", workspace = "staging")` resolves to:

| Field | Source | Resolved value |
|---|---|---|
| `tenant` | config | `acme` |
| `workspace` | **annotation** | `staging` |
| `app` | config | `support-bot` |

The reservation targets scope `tenant:acme/workspace:staging/app:support-bot` instead of `tenant:acme/workspace:production/app:support-bot`.

**Budget scope implications:** Each level in the scope hierarchy has an independent budget. If you have:
- `tenant:acme/workspace:production` → $10,000 budget
- `tenant:acme/workspace:staging` → $1,000 budget

Using `workspace = "staging"` on an annotation targets the $1,000 staging budget. Without the override, the same method targets the $10,000 production budget.

::: warning
A reservation must pass budget checks at **all** affected scope levels. If you set `tenant` and `workspace`, the server checks remaining budget at both `tenant:acme` and `tenant:acme/workspace:staging`. If either scope is exhausted, the reservation is denied.
:::

## `@Cycles` annotation attributes

The `@Cycles` annotation controls reservation behavior per-method. These are separate from the `application.yml` configuration above. For full documentation and examples, see [Getting Started with the Spring Boot Starter — Annotation attributes](/quickstart/getting-started-with-the-cycles-spring-boot-starter#annotation-attributes).

| Attribute | Type | Default | Description |
|---|---|---|---|
| `value` | `String` | `""` | SpEL expression for estimated cost. Shorthand: `@Cycles("1000")`. Synonym for `estimate`. |
| `estimate` | `String` | `""` | SpEL expression for estimated cost. Synonym for `value`. |
| `actual` | `String` | `""` | SpEL expression for actual cost, evaluated after method returns. `#result` is bound to the return value. |
| `metadata` | `String` | `""` | SpEL expression for commit metadata, evaluated after method returns (`#result` available). Must yield `Map<String, Object>`. Merged with programmatic `CyclesContextHolder` metadata; programmatic wins on key conflicts. Since 0.2.5. |
| `actionKind` | `String` | `""` | Action category (e.g. `"llm.completion"`). Defaults to declaring class simple name if blank. |
| `actionName` | `String` | `""` | Action identifier (e.g. `"gpt-4"`). Defaults to method name if blank. |
| `actionTags` | `String[]` | `{}` | Tags for filtering and reporting (e.g. `{"prod", "customer-facing"}`). |
| `unit` | `String` | `"USD_MICROCENTS"` | Budget unit: `USD_MICROCENTS`, `TOKENS`, `CREDITS`, `RISK_POINTS`. |
| `ttlMs` | `long` | `60000` | Reservation TTL in milliseconds (1,000–86,400,000). |
| `gracePeriodMs` | `long` | `-1` | Grace period after TTL expiry in milliseconds. When `-1`, the server applies its default (5000ms). Valid range: 0–60,000. |
| `overagePolicy` | `String` | `"ALLOW_IF_AVAILABLE"` | `"REJECT"`, `"ALLOW_IF_AVAILABLE"`, or `"ALLOW_WITH_OVERDRAFT"`. |
| `dryRun` | `boolean` | `false` | Shadow-mode evaluation. If `true`, server evaluates without persisting; guarded method does NOT execute. |
| `useEstimateIfActualNotProvided` | `boolean` | `true` | When `true` and `actual` is blank, use the estimate as actual at commit time. |
| `tenant` | `String` | `""` | Subject tenant override (takes precedence over config and resolver). |
| `workspace` | `String` | `""` | Subject workspace override. |
| `app` | `String` | `""` | Subject app override. |
| `workflow` | `String` | `""` | Subject workflow override. |
| `agent` | `String` | `""` | Subject agent override. |
| `toolset` | `String` | `""` | Subject toolset override. |
| `dimensions` | `String[]` | `{}` | Custom dimensions as `"key=value"` pairs (e.g. `{"cost_center=engineering"}`). |

::: tip SpEL on subject attributes (since 0.2.1)
Subject attributes (`tenant`, `workspace`, `app`, `workflow`, `agent`, `toolset`) whose value starts with `#` are evaluated as SpEL against the method invocation, e.g. `tenant = "#tenantId"`. Literal values are passed through unchanged. Parse or evaluation failures surface as `ParseException`/`SpelEvaluationException` when the aspect runs, before the reservation is created.
:::

## HTTP configuration

| Property | Type | Default | Description |
|---|---|---|---|
| `cycles.http.connect-timeout` | Duration | `2s` | TCP connection timeout to the Cycles server |
| `cycles.http.read-timeout` | Duration | `5s` | Read timeout for responses from the Cycles server |

Duration values use Spring Boot duration syntax: `2s`, `500ms`, `1m`, etc.

### Example

```yaml
cycles:
  http:
    connect-timeout: 3s
    read-timeout: 10s
```

For long-running operations where the server may take longer to respond (e.g., under heavy load), increase the read timeout.

For automatic heartbeat safety, keep the combined connect and read timeout well below half the smallest expected reservation lease. The heartbeat reserves two complete attempt budgets plus a safety margin; a 30-second attempt budget cannot establish a positive cadence inside the default 60-second TTL.

## Retry configuration

Controls the durable settlement retry engine.

| Property | Type | Default | Description |
|---|---|---|---|
| `cycles.retry.enabled` | boolean | `true` | Enable automatic commit retries |
| `cycles.retry.max-attempts` | int | `5` | Maximum number of retry attempts |
| `cycles.retry.initial-delay` | Duration | `500ms` | Delay before the first retry |
| `cycles.retry.multiplier` | double | `2.0` | Backoff multiplier between retries |
| `cycles.retry.max-delay` | Duration | `30s` | Maximum delay between retries |
| `cycles.retry.flush-timeout` | Duration | `10s` | Bounded wait for in-flight retries during Spring context shutdown |

### Journal configuration

| Property | Type | Default | Description |
|---|---|---|---|
| `cycles.journal.enabled` | boolean | `true` | Persist unresolved known-actual settlement across JVM restarts |
| `cycles.journal.dir` | String | (none) | Journal base directory; unset uses `~/.runcycles/commit-journal` |

### How retry works

Known actual usage is journaled before the first commit request. When settlement fails transiently, the engine schedules a same-key retry using exponential backoff:

```
Attempt 1: wait 500ms
Attempt 2: wait 1000ms
Attempt 3: wait 2000ms
Attempt 4: wait 4000ms
Attempt 5: wait 8000ms (capped at max-delay)
```

HTTP 429 honors a valid `Retry-After` floor and persists it across restart. Authentication failures and unclassifiable 4xx responses stop the current run but retain the record. A genuine, understood rejection removes it.

Only a schema-valid HTTP `200` commit or schema-valid HTTP `201` event proves success. If commit returns HTTP 410 or `RESERVATION_EXPIRED`, the journal switches to event mode before the starter calls `POST /v1/events` with the original idempotency key.

The journal is partitioned by server and principal. Configure `cycles.tenant` so pending records remain discoverable after API-key rotation. Records do not store API keys, but they contain settlement bodies and metadata; protect the directory as sensitive application state.

### Disabling retry

```yaml
cycles:
  retry:
    enabled: false
```

This disables active retries, not journaling. Failed known-actual settlement remains on disk while `cycles.journal.enabled=true`. Disable both only when the application supplies equivalent durable recovery.

### Aggressive retry for critical commits

```yaml
cycles:
  retry:
    max-attempts: 10
    initial-delay: 200ms
    multiplier: 1.5
    max-delay: 60s
```

## Full configuration example

Add the following to your project's `application.yml`:

```yaml
cycles:
  # Required
  base-url: ${CYCLES_BASE_URL:http://localhost:7878}
  api-key: ${CYCLES_API_KEY}

  # Subject defaults
  tenant: acme
  workspace: production
  app: support-bot

  # HTTP settings
  http:
    connect-timeout: 2s
    read-timeout: 5s

  # Commit retry
  retry:
    enabled: true
    max-attempts: 5
    initial-delay: 500ms
    multiplier: 2.0
    max-delay: 30s
    flush-timeout: 10s

  # Durable settlement journal
  journal:
    enabled: true
    # dir: /var/lib/my-app/cycles-commit-journal
```

## Equivalent application.properties

Alternatively, add to your project's `application.properties`:

```properties
cycles.base-url=${CYCLES_BASE_URL:http://localhost:7878}
cycles.api-key=${CYCLES_API_KEY}
cycles.tenant=acme
cycles.workspace=production
cycles.app=support-bot
cycles.http.connect-timeout=2s
cycles.http.read-timeout=5s
cycles.retry.enabled=true
cycles.retry.max-attempts=5
cycles.retry.initial-delay=500ms
cycles.retry.multiplier=2.0
cycles.retry.max-delay=30s
cycles.retry.flush-timeout=10s
cycles.journal.enabled=true
# cycles.journal.dir=/var/lib/my-app/cycles-commit-journal
```

## Auto-configured beans

The starter auto-configures the following beans, all with `@ConditionalOnMissingBean` so you can override any of them:

| Bean | Type | Purpose |
|---|---|---|
| `cyclesWebClient` | `WebClient` | HTTP client with configured timeouts |
| `cyclesClient` | `CyclesClient` | Protocol client (`DefaultCyclesClient`) |
| `evaluator` | `CyclesExpressionEvaluator` | SpEL evaluator |
| `cyclesRequestBuilderService` | `CyclesRequestBuilderService` | Builds protocol request bodies |
| `cyclesValueResolutionService` | `CyclesValueResolutionService` | Resolves Subject field values |
| `retryEngine` | `CommitRetryEngine` | Handles durable settlement replay (`JournaledCommitRetryEngine`) |
| `cyclesLifecycleService` | `CyclesLifecycleService` | Orchestrates the full lifecycle |
| `aspect` | `CyclesAspect` | AOP aspect for `@Cycles` annotation |
| `cyclesSelfInvocationDetector` | `CyclesSelfInvocationDetector` | Bean post-processor (declared as a `static` `@Bean`) that warns at startup about beans susceptible to the self-invocation pitfall |

### Overriding a bean

To replace any auto-configured bean, define your own:

```java
@Configuration
public class CustomCyclesConfig {

    @Bean
    public CyclesClient cyclesClient() {
        // Your custom implementation
        return new MyCustomCyclesClient();
    }
}
```

The auto-configuration will skip creating its default `CyclesClient` when it detects yours.

## Environment-specific configuration

### Using Spring profiles

Create profile-specific files in `src/main/resources/`:

```yaml
# application.yml (shared)
cycles:
  tenant: acme
  retry:
    enabled: true

---
# application-dev.yml
cycles:
  base-url: http://localhost:7878
  api-key: dev-key

---
# application-prod.yml
cycles:
  base-url: https://cycles.internal.example.com
  api-key: ${CYCLES_API_KEY}
  http:
    read-timeout: 10s
```

### Using environment variables

Every property can be set via environment variables using Spring Boot's relaxed binding:

| Property | Environment variable |
|---|---|
| `cycles.base-url` | `CYCLES_BASE_URL` |
| `cycles.api-key` | `CYCLES_API_KEY` |
| `cycles.tenant` | `CYCLES_TENANT` |
| `cycles.http.connect-timeout` | `CYCLES_HTTP_CONNECT_TIMEOUT` |
| `cycles.retry.max-attempts` | `CYCLES_RETRY_MAX_ATTEMPTS` |
| `cycles.retry.flush-timeout` | `CYCLES_RETRY_FLUSH_TIMEOUT` |
| `cycles.journal.enabled` | `CYCLES_JOURNAL_ENABLED` |
| `cycles.journal.dir` | `CYCLES_JOURNAL_DIR` |

## Next steps

- [Getting Started with the Spring Boot Starter](/quickstart/getting-started-with-the-cycles-spring-boot-starter) — quick start guide
- [SpEL Expression Reference](/configuration/spel-expression-reference-for-cycles) — expression syntax
- [Custom Field Resolvers](/how-to/custom-field-resolvers-in-cycles) — dynamic Subject field resolution
- [SDK Settlement Recovery and Durability](/protocol/sdk-settlement-recovery-and-durability) — journal, replay, expiry fallback, and guarantee boundary
- [Server Configuration Reference](/configuration/server-configuration-reference-for-cycles) — server-side properties
