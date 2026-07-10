---
title: "Getting Started with the Cycles Spring Boot Starter"
description: "Add runtime authority to Spring Boot AI apps with @Cycles: reserve, commit, release, caps-aware decisions, and structured audit records."
---

# Getting Started with the Cycles Spring Boot Starter

[![Maven Central](https://img.shields.io/maven-central/v/io.runcycles/cycles-client-java-spring?label=Maven%20Central&color=555&style=flat-square)](https://central.sonatype.com/artifact/io.runcycles/cycles-client-java-spring)

The Cycles Spring Boot Starter provides a declarative way to add budget enforcement to any Spring application.

Instead of manually calling the Cycles API for every reservation, commit, and release, the starter provides an `@Cycles` annotation that handles the full lifecycle automatically.

::: tip Using Python?
See the [Python Client quickstart](/quickstart/getting-started-with-the-python-client) instead.
:::

## What the starter does

The starter wraps any annotated method in a reserve → execute → commit lifecycle:

1. **Before the method runs:** evaluates the estimate, creates a reservation, and checks the decision
2. **While the method runs:** maintains the reservation with automatic heartbeat extensions
3. **After the method returns:** commits actual usage and releases any unused remainder
4. **If the method throws:** releases the reservation to return budget to the pool

::: tip Cycles provides three runtime-authority pillars
- **Spend** — reserve-commit budget enforcement before instrumented LLM calls and tool actions
- **Risky actions** — `ALLOW` / `ALLOW_WITH_CAPS` / `DENY` decisions with `RISK_POINTS` budgets and caps for tool allowlists/denylists, max tokens, max steps, and cooldowns
- **Audit** — reservations, commits, releases, and decisions create structured records for compliance, attribution, and incident review
:::

All of this happens transparently through Spring AOP.

## Try the demo app first

The fastest way to see the starter in action is to run the included demo application.

### Prerequisites

You need a running Cycles stack with a tenant, API key, and budget. If you don't have one yet, follow [Deploy the Full Stack](/quickstart/deploying-the-full-cycles-stack) first. The demo app expects the same `acme-corp` tenant used in that guide.

::: tip Where do I get my API key?
API keys are created through the **Cycles Admin Server** (port 7979) and always start with `cyc_live_`. If your stack is already running with a tenant, create one directly:

```bash
curl -s -X POST http://localhost:7979/v1/admin/api-keys \
  -H "Content-Type: application/json" \
  -H "X-Admin-API-Key: admin-bootstrap-key" \
  -d '{
    "tenant_id": "acme-corp",
    "name": "dev-key",
    "permissions": ["reservations:create","reservations:commit","reservations:release","reservations:extend","reservations:list","balances:read"]
  }' | jq -r '.key_secret'
```

The response returns the full key (e.g. `cyc_live_abc123...`). **Save it — the secret is only shown once.**

Need the full setup? See [Deploy the Full Stack — Create an API key](/quickstart/deploying-the-full-cycles-stack#step-3-create-an-api-key). For rotation and lifecycle details, see [API Key Management](/how-to/api-key-management-in-cycles).
:::

### Run the demo

```bash
git clone https://github.com/runcycles/cycles-spring-boot-starter.git
cd cycles-spring-boot-starter/cycles-demo-client-java-spring
```

Set your API key — the `cyc_live_...` value returned when you created the key via the Admin Server:

```bash
export CYCLES_API_KEY=cyc_live_...   # from Admin Server /v1/admin/api-keys response
mvn spring-boot:run
```

Or edit `application.yml` directly and paste the key in `cycles.api-key`.

The demo app starts on port 7955. Try the simplest example first:

```bash
curl -X POST http://localhost:7955/api/demo/annotation/minimal?input=hello
```

Hit `GET http://localhost:7955/api/demo/index` for a full listing of all endpoints with copy-paste curl commands.

### What the demo covers

The demo app includes working examples for every major feature area:

**Start here (`/api/demo/annotation/minimal`)**
- `@Cycles("1000")` — the simplest possible usage, fixed estimate with all defaults

**Annotation-based (`/api/llm/*`)**
- `@Cycles` with SpEL estimate/actual, `CyclesContextHolder` for reading reservation context, `CyclesMetrics` for reporting token counts and latency, and `commitMetadata` for audit data

**Annotation variations (`/api/demo/annotation/*`)**
- `ALLOW_WITH_CAPS` — reading and respecting server-imposed constraints — `POST /api/demo/annotation/caps`
- `unit=TOKENS` with `actionTags` — `POST /api/demo/annotation/tokens`
- `unit=CREDITS` with `workflow`, `agent`, and custom `dimensions` — `POST /api/demo/annotation/credits`
- Per-annotation budget scope targeting (`workspace`/`app` override) — `POST /api/demo/annotation/budget-targeting`
- `overagePolicy=ALLOW_WITH_OVERDRAFT` — `POST /api/demo/annotation/overdraft`
- Custom `ttlMs` and `gracePeriodMs` — `POST /api/demo/annotation/custom-ttl`
- `dryRun=true` (shadow-mode evaluation) — `POST /api/demo/annotation/dry-run`

**Programmatic CyclesClient (`/api/demo/client/*`)**
- Full reserve → commit lifecycle — `POST /api/demo/client/reserve-commit`
- Reserve → release (cancellation) — `POST /api/demo/client/reserve-release`
- Preflight decision check — `POST /api/demo/client/decide`
- Balance queries — `GET /api/demo/client/balances`
- Reservation listing — `GET /api/demo/client/reservations`

**Standalone events (`/api/demo/events/*`)**
- Direct debit without reservation — `POST /api/demo/events/record`

**Error handling**
- Global `@RestControllerAdvice` for `CyclesProtocolException` with structured JSON error responses

::: info Note
The deployment guide creates a `USD_MICROCENTS` budget. The `unit=TOKENS` and `unit=CREDITS` demo endpoints require separate budget ledgers for those units. If you only created the default budget, those endpoints will return `BUDGET_EXCEEDED`. Start with the `USD_MICROCENTS` endpoints (minimal, caps, overdraft, custom-ttl, dry-run) and create additional budgets via the admin API if you want to explore other units.
:::

### Suggested walkthrough

Follow this order to build understanding progressively. Each step introduces one new concept.

**1. Reserve and commit with a fixed estimate**

```bash
curl -X POST http://localhost:7955/api/demo/annotation/minimal?input=hello
```

This is `@Cycles("1000")` — the simplest annotation. The response shows the reservation lifecycle result.

**2. Check your balance**

```bash
curl http://localhost:7955/api/demo/client/balances
```

You should see `spent` increased by 1000 microcents from step 1.

**3. Try a dry run (no budget consumed)**

```bash
curl -X POST http://localhost:7955/api/demo/annotation/dry-run?amount=500
```

The server evaluates the reservation but doesn't persist it. Check balances again — they haven't changed.

**4. See how overdraft works**

```bash
curl -X POST http://localhost:7955/api/demo/annotation/overdraft?amount=1000
```

With `overagePolicy=ALLOW_WITH_OVERDRAFT`, the reservation succeeds even if it exceeds the budget.

**5. Use the programmatic client**

```bash
curl -X POST http://localhost:7955/api/demo/client/reserve-commit?estimate=5000
```

This does the same reserve → commit lifecycle as `@Cycles`, but using `CyclesClient` directly. Compare with step 1 to see the annotation vs programmatic approach.

**6. Cancel a reservation**

```bash
curl -X POST http://localhost:7955/api/demo/client/reserve-release?estimate=3000
```

The reservation is created then released — budget is returned to the pool. Check balances to confirm it was refunded.

**7. Preflight check without reserving**

```bash
curl -X POST http://localhost:7955/api/demo/client/decide?estimate=10000
```

The `decide` endpoint tells you whether a reservation *would* be allowed, without creating one.

**8. Record a standalone event**

```bash
curl -X POST 'http://localhost:7955/api/demo/events/record?amount=1500&description=API+call'
```

Direct debit — no reservation needed. Useful for post-hoc usage recording.

After this walkthrough, explore the remaining endpoints (`caps`, `custom-ttl`, `llm/generate`) and read the source files below to see how each feature is implemented.

### Demo app source files

| File | What it demonstrates |
|---|---|
| `service/LlmService.java` | `@Cycles` annotation, `CyclesContextHolder`, `CyclesMetrics`, `commitMetadata` |
| `service/AnnotationShowcaseService.java` | Annotation variations: minimal, caps-aware, units, TTL, overdraft, dry-run, dimensions, budget scope targeting |
| `service/ProgrammaticClientService.java` | Direct `CyclesClient` usage for the full reservation lifecycle |
| `service/EventService.java` | Standalone events via `CyclesClient.createEvent()` |
| `error/CyclesExceptionHandler.java` | Global error handling for `CyclesProtocolException` |
| `resolvers/CyclesTenantResolver.java` | Dynamic tenant resolution via `CyclesFieldResolver` |
| `controller/DemoController.java` | REST endpoints wiring all services at `/api/demo/*` |
| `controller/LlmController.java` | LLM endpoints with budget error handling |

All demo source files are under `cycles-demo-client-java-spring/src/main/java/io/runcycles/demo/client/spring/`.

## Installation

Add the starter to your project:

::: code-group
```xml [Maven]
<dependency>
    <groupId>io.runcycles</groupId>
    <artifactId>cycles-client-java-spring</artifactId>
    <version>0.2.5</version>
</dependency>
```
```groovy [Gradle]
implementation 'io.runcycles:cycles-client-java-spring:0.2.5'
```
:::

Check [Maven Central](https://central.sonatype.com/artifact/io.runcycles/cycles-client-java-spring) for the latest version.

## Configuration

Configure the connection in your project's `application.yml`:

```yaml
cycles:
  base-url: http://localhost:7878
  api-key: your-api-key
  tenant: acme
  workspace: production
  app: support-bot
```

These defaults apply to all `@Cycles`-annotated methods unless overridden per method.

### Optional configuration

```yaml
cycles:
  http:
    connect-timeout: 2s
    read-timeout: 5s
  retry:
    enabled: true
    max-attempts: 5
    initial-delay: 500ms
    multiplier: 2.0
    max-delay: 30s
```

## The @Cycles annotation

The `@Cycles` annotation is applied to methods:

```java
@Cycles("500")
public String summarize(String text) {
    return chatModel.call(text);
}
```

This reserves 500 units (default unit: USD_MICROCENTS) before `summarize()` runs, then commits actual usage afterward.

### SpEL expressions for dynamic estimates

The estimate can use Spring Expression Language to compute cost from method arguments:

```java
@Cycles("#tokens * 10")
public String generate(int tokens) {
    return chatModel.call(prompt, tokens);
}
```

The expression is evaluated before the method runs, using method parameters as variables.

::: warning Compiler flag required for named parameters
SpEL expressions that reference parameters by name (e.g., `#tokens`) require the `-parameters` javac compiler flag. Without it, you'll get a SpEL evaluation error at runtime. Add this to your `pom.xml`:

```xml
<plugin>
  <groupId>org.apache.maven.plugins</groupId>
  <artifactId>maven-compiler-plugin</artifactId>
  <configuration>
    <parameters>true</parameters>
  </configuration>
</plugin>
```

Alternatively, use positional references: `#p0`, `#p1`, etc. See the [SpEL Expression Reference](/configuration/spel-expression-reference-for-cycles) for details.
:::

### Specifying actual usage

By default, the estimate is used as the actual amount at commit time. To calculate actual usage from the return value:

```java
@Cycles(estimate = "5000", actual = "#result.usage.totalTokens * 8")
public ChatResponse chat(String prompt) {
    return chatModel.call(prompt);
}
```

The `actual` expression is evaluated after the method returns, with `#result` bound to the return value.

## Annotation attributes

### Subject fields

Override the defaults from configuration:

```java
@Cycles(value = "1000",
         tenant = "acme",
         workspace = "production",
         app = "support-bot",
         workflow = "refund-assistant",
         agent = "planner",
         toolset = "search-tools")
```

Subject fields determine which budget scope the reservation targets. In most cases, set `tenant`, `workspace`, and `app` in configuration and only override specific fields per-method:

```java
// Given config: tenant=acme, workspace=production, app=support-bot

// Uses config defaults → scope: tenant:acme/workspace:production/app:support-bot
@Cycles("500")
public String handleTicket(String text) { ... }

// Overrides workspace → scope: tenant:acme/workspace:staging/app:support-bot
@Cycles(value = "500", workspace = "staging")
public String handleTicketStaging(String text) { ... }
```

The second method targets the **staging** budget scope instead of production. All other fields (`tenant`, `app`) still come from config. Budget scopes are independent — each has its own allocated budget.

Since 0.2.1, subject fields also accept SpEL: a value whose first non-whitespace character is `#` is evaluated against the method invocation, so `tenant = "#tenantId"` resolves the tenant from a method argument. Literal values are passed through unchanged.

### Action identity

```java
@Cycles(value = "1000",
         actionKind = "llm.completion",
         actionName = "openai:gpt-4o-mini",
         actionTags = {"prod", "customer-facing"})
```

If not specified, `actionKind` defaults to the declaring class name and `actionName` defaults to the method name.

### Unit

```java
@Cycles(value = "2500", unit = "TOKENS")
```

Supported units: `USD_MICROCENTS` (default), `TOKENS`, `CREDITS`, `RISK_POINTS`.

### TTL and grace period

```java
@Cycles(value = "1000", ttlMs = 30000, gracePeriodMs = 10000)
```

Default TTL is 60 seconds. The starter automatically sends heartbeat extensions at `ttlMs / 2` intervals.

### Overage policy

```java
@Cycles(value = "1000", overagePolicy = "ALLOW_IF_AVAILABLE")
```

Options: `ALLOW_IF_AVAILABLE` (default), `REJECT`, `ALLOW_WITH_OVERDRAFT`.

### Dry run (shadow mode)

```java
@Cycles(value = "1000", dryRun = true)
```

Evaluates the reservation without actually holding budget. The guarded method does **not** execute — instead, the call returns a `DryRunResult` with the full evaluation data: decision, caps, affected scopes, scope path, reserved amount, balances, reason code, and retry hint. A dry-run `DENY` throws `CyclesProtocolException`, just like a real denial. Because the return value is a `DryRunResult` rather than the method's normal result, declare dry-run methods with an `Object` return type. Useful for shadow-mode rollouts where you want to measure budget impact without affecting production behavior.

### Custom dimensions

```java
@Cycles(value = "1000", dimensions = {"cost_center=engineering", "run=run-12345"})
```

### Commit metadata

```java
@Cycles(value = "1000", metadata = "{'app_request_id': #requestId, 'model': #result.model}")
```

Since 0.2.5. The `metadata` SpEL expression is evaluated after the method returns — `#result` is available — and must yield a `Map<String, Object>`. The result is merged with metadata set programmatically via `CyclesContextHolder`; programmatic metadata wins on key conflicts.

## Accessing reservation context at runtime

Inside an annotated method, the current reservation context is available via `CyclesContextHolder`:

```java
@Cycles("1000")
public String process(String input) {
    CyclesReservationContext ctx = CyclesContextHolder.get();

    // Check reservation details
    String reservationId = ctx.getReservationId();
    Decision decision = ctx.getDecision();

    // Check caps (if ALLOW_WITH_CAPS)
    if (ctx.hasCaps()) {
        Caps caps = ctx.getCaps();
        Integer maxTokens = caps.getMaxTokens();
        if (!caps.isToolAllowed("web.search")) {
            // skip web search
        }
    }

    // Check expiration
    if (ctx.isExpiringSoon(5000)) {
        // wrap up quickly
    }

    // Attach metrics for the commit
    CyclesMetrics metrics = new CyclesMetrics();
    metrics.setTokensInput(150);
    metrics.setTokensOutput(80);
    metrics.setLatencyMs(320);
    metrics.setModelVersion("gpt-4o-mini-2024-07-18");
    ctx.setMetrics(metrics);

    // Attach metadata for audit
    ctx.setCommitMetadata(Map.of("app_request_id", "req-abc-123"));

    return chatModel.call(input);
}
```

## Decision handling

When the reservation decision comes back, the starter handles each case:

### ALLOW

The method runs normally.

### ALLOW_WITH_CAPS

The method runs, and a warning is logged. Caps are available through `CyclesContextHolder` for the method to inspect and respect.

### DENY

The method does not run. A `CyclesProtocolException` is thrown with the reason code and optional `retryAfterMs` hint.

The caller can catch this to implement degradation:

```java
try {
    return service.summarize(text);
} catch (CyclesProtocolException e) {
    if (e.getRetryAfterMs() != null) {
        // retry after suggested delay
    }
    return fallbackResponse();
}
```

## Self-invocation (internal method calls)

Spring's proxy-based AOP **does not intercept internal method calls** within the same class. If a method calls another method in the same bean using `this.method()`, the call bypasses the proxy and the `@Cycles` aspect never fires.

```java
// BROKEN — @Cycles is silently ignored on internal calls
@Service
public class MyService {

    public String handleRequest(String input) {
        return guardedCall(input);  // calls this.guardedCall() — bypasses proxy
    }

    @Cycles("#input.length() * 10")
    public String guardedCall(String input) {
        return "Processed: " + input;  // @Cycles never activates
    }
}
```

### Workaround 1: Extract to a separate bean (recommended)

Move the `@Cycles`-annotated method into its own `@Service` and inject it:

```java
@Service
public class GuardedService {

    @Cycles("#input.length() * 10")
    public String guardedCall(String input) {
        return "Processed: " + input;  // @Cycles works — called through proxy
    }
}

@Service
public class MyService {

    @Autowired
    private GuardedService guardedService;

    public String handleRequest(String input) {
        return guardedService.guardedCall(input);
    }
}
```

### Workaround 2: Self-inject the proxy

If extracting a bean is impractical, inject the proxy of your own class using `@Lazy`:

```java
@Service
public class MyService {

    @Lazy
    @Autowired
    private MyService self;

    public String handleRequest(String input) {
        return self.guardedCall(input);  // calls through proxy — @Cycles works
    }

    @Cycles("#input.length() * 10")
    public String guardedCall(String input) {
        return "Processed: " + input;
    }
}
```

::: tip Startup warning
The starter logs a `WARN` at startup when it detects a bean where some methods have `@Cycles` and others do not, since this pattern is susceptible to self-invocation issues. The warning is informational — it does not block startup.
:::

## Nesting prevention

Calling a `@Cycles`-annotated method from inside another `@Cycles`-annotated method — even across different beans — throws an `IllegalStateException`. This is intentional:

- **Double-counting:** The outer reservation already reserves budget for the full operation. An inner reservation would deduct additional budget from the same pool.
- **Protocol design:** The Cycles Protocol v0 has no concept of parent/child reservations. Each reservation is independent and atomic.

```java
// BROKEN — throws IllegalStateException("Nested @Cycles not supported")
@Service
public class Orchestrator {

    @Autowired private LlmService llmService;

    @Cycles("#tokens * 10")
    public String orchestrate(int tokens) {
        return llmService.generate("hello", tokens);  // throws!
    }
}

@Service
public class LlmService {

    @Cycles("#tokens * 5")  // ← second @Cycles while outer is active
    public String generate(String prompt, int tokens) { ... }
}
```

**Correct pattern:** Place `@Cycles` at the outermost entry point only. Inner services should be plain methods:

```java
@Service
public class Orchestrator {

    @Autowired private LlmService llmService;

    @Cycles("#tokens * 10")
    public String orchestrate(int tokens) {
        return llmService.generate("hello", tokens);  // works
    }
}

@Service
public class LlmService {

    // No @Cycles here — called from within an already-guarded operation
    public String generate(String prompt, int tokens) { ... }
}
```

## Commit retry

If the commit fails due to a transient error (network issue, 5xx response), the starter can retry automatically.

The retry engine is configurable and extensible. The default implementation uses exponential backoff based on the retry configuration.

Custom retry strategies can be provided by implementing the `CommitRetryEngine` interface.

## Lifecycle summary

For each `@Cycles`-annotated method call:

1. Estimate is evaluated (SpEL expression or fixed value)
2. Reservation is created on the Cycles server
3. Decision is checked (ALLOW / ALLOW_WITH_CAPS / DENY)
4. If DENY: throw exception, method does not run
5. Heartbeat extension is scheduled (background thread)
6. Method executes
7. Actual usage is evaluated (SpEL expression or estimate)
8. Commit is sent with actual amount and optional metrics
9. Heartbeat is cancelled
10. If method threw: reservation is released instead of committed

## Summary

The Cycles Spring Boot Starter turns budget enforcement into a single annotation:

- `@Cycles("estimate")` wraps any method in a reserve → execute → commit lifecycle
- SpEL expressions provide dynamic cost estimation
- Heartbeat extensions keep reservations alive for long-running operations
- Caps, metrics, and metadata are accessible through `CyclesContextHolder`
- DENY decisions throw catchable exceptions for degradation handling
- Commit retry handles transient failures automatically

This gives Spring applications production-grade budget enforcement with minimal code changes.

## Next steps

To explore the Cycles stack:

- Read the [Cycles Protocol](https://github.com/runcycles/cycles-protocol)
- Run the [Cycles Server](https://github.com/runcycles/cycles-server)
- Manage budgets with [Cycles Admin](https://github.com/runcycles/cycles-server-admin)
- Integrate with Python using the [Python Client](/quickstart/getting-started-with-the-python-client)
- Integrate with TypeScript using the [TypeScript Client](/quickstart/getting-started-with-the-typescript-client)
- Integrate with Spring Boot or Spring AI using the [Spring Boot starter](https://github.com/runcycles/cycles-spring-boot-starter) or the [Spring AI starter](https://github.com/runcycles/cycles-spring-ai-starter)
