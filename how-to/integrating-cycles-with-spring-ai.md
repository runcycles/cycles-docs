---
title: "Integrating Cycles with Spring AI for Budget Control"
description: "Guard Spring AI ChatClient invocations with Cycles budget reservations. v0.3.0 adds pluggable subject routing and jtokkit-based BPE token estimation. Choose between auto-wired advisor (cycles-spring-ai-starter) or @Cycles annotation (cycles-client-java-spring)."
---

# Integrating Cycles with Spring AI

This guide shows how to guard Spring AI chat completions and tool calls with Cycles budget reservations so that every LLM interaction is cost-controlled, caps-aware, and observable.

For strategic guidance on where to integrate, see [Budget Limits with Spring AI](/quickstart/how-to-add-hard-budget-limits-to-spring-ai-with-cycles).

## Two integration paths

Cycles ships two complementary Java starters. Pick based on your call surface:

| Aspect | [`cycles-spring-ai-starter`](https://github.com/runcycles/cycles-spring-ai-starter) | [`cycles-spring-boot-starter`](https://github.com/runcycles/cycles-spring-boot-starter) |
|---|---|---|
| Maven artifact | `io.runcycles:cycles-spring-ai-starter` | `io.runcycles:cycles-client-java-spring` |
| Mechanism | Spring AI `CallAdvisor` + `StreamAdvisor` + `ChatClientCustomizer` (auto-wired); `CyclesToolGate` for per-tool gating | Spring AOP via `@Cycles` annotation |
| Where it intercepts | Every `chatClient.prompt(...).call()` and `.stream()` invocation; per-tool when wrapped via `cyclesToolGate.wrap(...)` | Any Java method you annotate |
| Call-site changes | **No** — transparent wiring for chat (tool wrapping is opt-in) | Yes — add `@Cycles` annotation |
| Estimate computation | Pluggable `PromptTokenEstimator`: chars/4 heuristic by default, real BPE via jtokkit (opt-in) or custom bean | SpEL expression: `@Cycles("#tokens * 250")` |
| Subject routing | Pluggable `SubjectResolver`: property defaults, or per-call (e.g. tenant from `SecurityContextHolder`) via custom bean | SpEL: can pull tenant from method args |
| Knows about LLMs? | Yes — Spring AI ChatClient specific | No — generic for any cost-incurring code |

**Use [`cycles-spring-ai-starter`](#path-1-auto-wired-advisor-cycles-spring-ai-starter)** if your LLM calls go through Spring AI's `ChatClient`.

**Use [`cycles-spring-boot-starter`](#path-2-cycles-annotation-cycles-client-java-spring)** for non-Spring-AI code paths (custom HTTP clients, LangChain4j, vector store queries, etc.) — or when you need SpEL-driven per-method estimates.

::: warning Don't double-charge
Wrapping a Spring AI chat call inside an `@Cycles`-annotated method produces **two reservations** for one operation — once from the AOP wrapper, once from the Spring AI advisor. Pick one strategy per call path. See the "Double-charge gotcha" section in the [`cycles-spring-ai-starter` README](https://github.com/runcycles/cycles-spring-ai-starter).
:::

---

## Path 1: Auto-wired advisor (`cycles-spring-ai-starter`)

The simplest path for Spring AI apps — add the dependency, configure a few `cycles.*` properties, and every `ChatClient.call()` and `.stream()` invocation is auto-gated.

### 1. Add the dependency

::: code-group
```xml [Maven]
<dependency>
    <groupId>io.runcycles</groupId>
    <artifactId>cycles-spring-ai-starter</artifactId>
    <version>0.3.1</version>
</dependency>
```
```groovy [Gradle]
implementation 'io.runcycles:cycles-spring-ai-starter:0.3.1'
```
:::

This transitively pulls in `cycles-client-java-spring` for the HTTP client to the Cycles server.

### 2. Configure

```yaml
cycles:
  base-url: http://localhost:7878
  api-key:  ${CYCLES_API_KEY}
  tenant:   acme
  app:      my-spring-ai-app
  spring-ai:
    enabled: true
    default-estimate: 1000          # micro-cents per call; set estimate-from-prompt=true to derive from prompt size
    estimate-unit: USD_MICROCENTS
    action-kind: llm.chat
    action-name: spring-ai-chat
    fail-open: false                # true = log + proceed on Cycles errors
```

### 3. Use ChatClient normally

```java
@Service
public class OrderAgent {
    private final ChatClient chatClient;

    public OrderAgent(ChatClient.Builder builder) {
        this.chatClient = builder.build();
    }

    public String summarize(String order) {
        // Cycles reserves budget BEFORE this call hits the LLM.
        // If the budget is exhausted, CyclesBudgetDeniedException is thrown
        // and the LLM call never happens.
        return chatClient.prompt()
                .user("Summarize: " + order)
                .call()
                .content();
    }
}
```

No annotations. No `@Cycles`. The advisor is auto-attached to every `ChatClient` built from the auto-configured `ChatClient.Builder` via a `ChatClientCustomizer`.

### What v0.3.0 covers

Everything v0.2.0 shipped is still here — drop-in compatible — plus three new extension points and a trace-correlation tag.

✅ **Non-streaming `.call()`** — full reserve → call → commit (on success) / release (on exception) lifecycle. Deny throws `CyclesBudgetDeniedException` before the LLM is contacted.

✅ **Streaming `.stream()`** — `CyclesBudgetStreamAdvisor` mirrors the lifecycle for `chatClient.prompt(...).stream()` invocations. Per-subscription reservation (wrapped in `Flux.defer`); commits on successful completion using usage from the last chunk; releases on stream error or subscriber cancellation. Reserve and commit failures surface as `onError` to the subscriber, matching reactive-idiomatic shape and the fail-fast contract of the non-streaming advisor.

✅ **Real `ChatResponse.Usage` extraction on commit** — when the LLM provider returns usage:
- `cycles.spring-ai.estimate-unit=TOKENS`: commits `Usage.getTotalTokens()` directly.
- `input-cost-per-token` and/or `output-cost-per-token` set: commits `(promptTokens × inputRate) + (completionTokens × outputRate)`.
- Otherwise (no rates, no TOKENS unit): commits the estimate as actual (v0.1.0-compatible fallback).

When both token breakdowns are null (provider returned a placeholder `Usage` with no breakdown), falls back to the estimate rather than under-billing with a zero commit.

✅ **Prompt-based per-call estimate** — `cycles.spring-ai.estimate-from-prompt=true` with at least one cost-per-token rate set derives the pre-call reservation amount from the configured `PromptTokenEstimator`. Default is a `chars / 4` heuristic; set `cycles.spring-ai.token-estimator-encoding=cl100k_base` (or `o200k_base`) + add the jtokkit dep to opt into real BPE encoding (see below). Falls back to `default-estimate` when the prompt is empty or rates are zero. Applies to both the call and stream advisors.

✅ **Tool-level gating via `CyclesToolGate`** — auto-configured factory bean. Wrap any Spring AI `ToolCallback` with `cyclesToolGate.wrap(myTool)` to gate per-tool invocations through Cycles. Tool reservations report distinct action labels (`tool.call` / `spring-ai-tool:<tool-name>` by default — configurable) so they're separable from chat reservations in audit history. Opt-in: Spring AI doesn't provide a hook to auto-decorate every registered tool.

✅ **`CyclesChatClientObservationConvention`** — extends Spring AI's `DefaultChatClientObservationConvention` and appends low-cardinality Cycles attribution tags to every chat-client trace: `cycles.tenant`, `cycles.workspace`, `cycles.app`, `cycles.action_kind`, `cycles.action_name`. **New in 0.3.0:** also emits `cycles.reservation_id` as a high-cardinality `KeyValue` for trace ↔ reservation correlation in your tracing backend. Auto-configured as a bean but not auto-attached — apply explicitly via `builder.observationConvention(cyclesConvention)`. Disable the high-cardinality tag with `cycles.spring-ai.emit-reservation-id-on-trace=false` if your tracing backend charges by unique tag-value combinations.

#### New extension points in v0.3.0

**Pluggable `SubjectResolver`** — multi-tenant agents need per-request attribution. By default the starter reads tenant/workspace/app from `CyclesProperties` on every call (every reservation is attributed to the same subject). Register a `SubjectResolver` bean for per-call routing:

```java
@Bean
public SubjectResolver tenantAwareSubjectResolver(CyclesProperties defaults) {
    return request -> {
        var auth = SecurityContextHolder.getContext().getAuthentication();
        String tenant = (auth != null && auth.isAuthenticated()) ? auth.getName() : defaults.getTenant();
        return Subject.builder()
                .tenant(tenant)
                .workspace(defaults.getWorkspace())
                .app(defaults.getApp())
                .build();
    };
}
```

`@ConditionalOnMissingBean` ensures your bean wins over the property-derived default. The `request` parameter is `null` on the tool-gating path (tool callbacks don't carry a `ChatClientRequest`); implementations should handle `null` defensively.

**Pluggable `PromptTokenEstimator` with jtokkit** — v0.2.0 hard-coded prompt-token estimation as `chars / 4`. v0.3.0 makes it pluggable and ships a real BPE impl via [jtokkit](https://github.com/knuddelsgmbh/jtokkit). Opt in:

```yaml
cycles:
  spring-ai:
    estimate-from-prompt: true
    input-cost-per-token: 250                  # 1 USD = 100,000,000 USD_MICROCENTS, so $2.50/1M tokens = 250 microcents/token
    output-cost-per-token: 1000                # $10.00/1M tokens = 1000 microcents/token
    token-estimator-encoding: o200k_base   # gpt-4o family; cl100k_base for gpt-4 / gpt-3.5-turbo
```

```xml
<dependency>
    <groupId>com.knuddels</groupId>
    <artifactId>jtokkit</artifactId>
    <version>1.1.0</version>
</dependency>
```

The jtokkit dep is `optional=true` on the starter — only opt-in users pay the size cost. Setting the property without the dep on the classpath logs a WARN at app startup and falls back to chars/4. For provider-specific tokenizers, register your own `PromptTokenEstimator` bean.

See the [Spring AI Starter Configuration Reference](/configuration/spring-ai-starter-configuration-reference) for every property, auto-configuration condition, extension point, and failure-mode boundary.

---

## Path 2: `@Cycles` annotation (`cycles-client-java-spring`)

Use this path when:
- Your LLM calls go through code that is **not** Spring AI's `ChatClient` (custom HTTP, LangChain4j, in-house wrappers).
- You need **dynamic per-call estimates** via SpEL expressions.
- You want **explicit control** over which methods are gated.

## Prerequisites

Add the Cycles Spring Boot Starter to your project:

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

Configure the connection in `application.yml`:

```yaml
cycles:
  base-url: http://localhost:7878
  api-key: ${CYCLES_API_KEY}
  tenant: acme
  app: my-spring-ai-app
```

> **Need an API key?** Create one via the Admin Server — see [Deploy the Full Stack](/quickstart/deploying-the-full-cycles-stack#step-3-create-an-api-key) or [API Key Management](/how-to/api-key-management-in-cycles).

::: tip 60-Second Quick Start
```java
import io.runcycles.client.java.spring.annotation.Cycles;
import org.springframework.ai.chat.client.ChatClient;
import org.springframework.stereotype.Service;

@Service
public class ChatService {

    private final ChatClient chatClient;

    public ChatService(ChatClient.Builder builder) {
        this.chatClient = builder.build();
    }

    // GPT-4o: ~$2.50/1M input tokens = 250 microcents/token
    @Cycles(value = "#maxTokens * 250",
            actionKind = "llm.completion",
            actionName = "gpt-4o")
    public String chat(String prompt, int maxTokens) {
        return chatClient.prompt(prompt)
            .call()
            .content();
    }
}
```

That's it. Every call to `chat()` is now budget-guarded: Cycles reserves the estimated cost before execution, commits actual usage after, and throws `CyclesProtocolException` if the budget is exceeded.
:::

## Dynamic cost estimation with Spring AI

Use SpEL expressions to estimate cost from method parameters. The `value` (or `estimate`) attribute is evaluated before the method runs:

```java
// Estimate based on max tokens × price per token (in USD_MICROCENTS)
// GPT-4o: ~$2.50/1M input tokens = 250 microcents/token
@Cycles(value = "#maxTokens * 250",
        actionKind = "llm.completion",
        actionName = "gpt-4o")
public String generate(String prompt, int maxTokens) {
    return chatClient.prompt(prompt)
        .call()
        .content();
}

// Estimate from prompt length (rough token approximation: ~4 chars per token)
@Cycles(value = "#prompt.length() / 4 * 250",
        actionKind = "llm.completion",
        actionName = "gpt-4o")
public String summarize(String prompt) {
    return chatClient.prompt(prompt)
        .call()
        .content();
}
```

See [SpEL Expression Reference](/configuration/spel-expression-reference-for-cycles) for all available expressions.

## Reporting actual usage

The `actual` attribute is evaluated after the method returns, using `#result` to reference the return value. This lets Cycles commit the real cost instead of the estimate:

```java
@Cycles(value = "#maxTokens * 250",
        actual = "#result.length() / 4 * 250",
        actionKind = "llm.completion",
        actionName = "gpt-4o")
public String generate(String prompt, int maxTokens) {
    return chatClient.prompt(prompt)
        .call()
        .content();
}
```

For precise token counts, access the `ChatResponse` metadata and report via `CyclesMetrics`:

```java
import io.runcycles.client.java.spring.annotation.Cycles;
import io.runcycles.client.java.spring.context.CyclesContextHolder;
import io.runcycles.client.java.spring.context.CyclesReservationContext;
import io.runcycles.client.java.spring.model.CyclesMetrics;

@Cycles(value = "#maxTokens * 250",
        actionKind = "llm.completion",
        actionName = "gpt-4o")
public String generateWithMetrics(String prompt, int maxTokens) {
    long start = System.currentTimeMillis();

    ChatResponse response = chatClient.prompt(prompt)
        .call()
        .chatResponse();

    String content = response.getResult().getOutput().getText();

    // Report exact token usage via the reservation context
    CyclesReservationContext ctx = CyclesContextHolder.get();
    if (ctx != null) {
        Usage usage = response.getMetadata().getUsage();
        CyclesMetrics metrics = new CyclesMetrics();
        metrics.setTokensInput((int) usage.getPromptTokens());
        metrics.setTokensOutput((int) usage.getCompletionTokens());
        metrics.setLatencyMs((int) (System.currentTimeMillis() - start));
        metrics.setModelVersion("gpt-4o-2024-08-06");
        ctx.setMetrics(metrics);
    }

    return content;
}
```

The `actual` SpEL attribute on `@Cycles` handles cost calculation. Use `CyclesMetrics` for observability data (token counts, latency, model version) that is attached to the commit for reporting.

## Respecting budget caps in Spring AI

When the deepest matching budget has caps configured, Cycles can return `ALLOW_WITH_CAPS` instead of a flat `ALLOW`. This is configuration-driven, not an automatic low-balance transition. Read the caps from the reservation context and apply them — for example, by reducing max tokens:

```java
@Cycles(value = "#maxTokens * 250",
        actionKind = "llm.completion",
        actionName = "gpt-4o")
public String capsAwareChat(String prompt, int maxTokens) {
    CyclesReservationContext ctx = CyclesContextHolder.get();

    // Respect token cap from budget authority
    int effectiveMaxTokens = maxTokens;
    if (ctx != null && ctx.hasCaps() && ctx.getCaps().getMaxTokens() != null) {
        effectiveMaxTokens = Math.min(maxTokens, ctx.getCaps().getMaxTokens());
    }

    return chatClient.prompt(prompt)
        .options(ChatOptions.builder()
            .maxTokens(effectiveMaxTokens)
            .build())
        .call()
        .content();
}
```

## Error handling

Catch `CyclesProtocolException` to degrade gracefully when budget is exceeded. This should be part of your service layer from the start:

```java
import io.runcycles.client.java.spring.model.CyclesProtocolException;

@Service
public class ResilientChatService {

    private final GuardedLlmService premiumLlm;
    private final GuardedLlmService budgetLlm;

    public String chat(String prompt) {
        try {
            return premiumLlm.generate(prompt, 4096);     // GPT-4o
        } catch (CyclesProtocolException e) {
            if (e.isBudgetExceeded()) {
                return budgetLlm.generate(prompt, 1024);   // GPT-4o-mini fallback
            }
            if (e.getRetryAfterMs() != null) {
                scheduleRetry(prompt, e.getRetryAfterMs());
                return "Request queued. Retrying shortly.";
            }
            throw e;
        }
    }
}
```

`GuardedLlmService` is a separate `@Service` bean whose methods are annotated with `@Cycles`. This is needed because Spring AOP proxies only intercept calls from outside the bean — see [Self-invocation workaround](#self-invocation-workaround) below.

For global exception handling in a REST API:

```java
@ControllerAdvice
public class CyclesExceptionHandler {

    @ExceptionHandler(CyclesProtocolException.class)
    public ResponseEntity<Map<String, Object>> handleBudgetError(CyclesProtocolException e) {
        if (e.isBudgetExceeded()) {
            return ResponseEntity.status(429)
                .header("Retry-After", String.valueOf(
                    e.getRetryAfterMs() != null ? e.getRetryAfterMs() / 1000 : 60))
                .body(Map.of("error", "budget_exceeded", "message", "Budget limit reached."));
        }
        return ResponseEntity.status(503)
            .body(Map.of("error", e.getReasonCode(), "message", e.getMessage()));
    }
}
```

## Guarding Spring AI tool calls

For Spring AI function callbacks, wrap the tool execution with `@Cycles` on a separate service bean:

```java
@Service
public class GuardedToolService {

    @Cycles(value = "500000",  // $0.005 per tool call
            actionKind = "tool.search",
            actionName = "web-search",
            toolset = "search-tools")
    public String webSearch(String query) {
        return searchApi.search(query);
    }

    @Cycles(value = "100000",  // $0.001 per DB query
            actionKind = "tool.database",
            actionName = "sql-query",
            toolset = "data-tools")
    public String queryDatabase(String sql) {
        return jdbcTemplate.queryForList(sql).toString();
    }
}
```

Then register these as Spring AI tool callbacks:

```java
import org.springframework.ai.tool.ToolCallback;
import org.springframework.ai.tool.function.FunctionToolCallback;

@Configuration
public class ToolConfig {

    @Bean
    public ToolCallback webSearchTool(GuardedToolService tools) {
        return FunctionToolCallback.builder("web_search", (String query) -> tools.webSearch(query))
            .description("Search the web")
            .inputType(String.class)
            .build();
    }
}
```

The `toolset` attribute scopes budget per tool category, so you can set different budgets for search tools vs. database tools via the Admin API.

## Spring AI streaming with budget control

For streaming, use the programmatic `CyclesClient` instead of the annotation, since the stream needs to commit after all chunks arrive:

```java
import io.runcycles.client.java.spring.client.CyclesClient;
import io.runcycles.client.java.spring.model.*;

@Service
public class StreamingChatService {

    private final ChatClient chatClient;
    private final CyclesClient cyclesClient;

    public Flux<String> streamChat(String prompt, int maxTokens) {
        // Reserve budget before streaming
        Map<String, Object> body = Map.of(
            "idempotency_key", UUID.randomUUID().toString(),
            "subject", Map.of("tenant", "acme"),
            "action", Map.of("kind", "llm.completion", "name", "gpt-4o"),
            "estimate", Map.of("unit", "USD_MICROCENTS", "amount", maxTokens * 250L),
            "ttl_ms", 120000
        );

        var response = cyclesClient.createReservation(body);
        String reservationId = response.getBodyAttributeAsString("reservation_id");
        String decision = response.getBodyAttributeAsString("decision");

        if (!"ALLOW".equals(decision) && !"ALLOW_WITH_CAPS".equals(decision)) {
            throw new CyclesProtocolException("Budget denied: " + decision);
        }

        AtomicInteger tokenCount = new AtomicInteger();

        return chatClient.prompt(prompt)
            .stream()
            .content()
            .doOnNext(chunk -> tokenCount.addAndGet(chunk.length() / 4))
            .doOnComplete(() -> {
                cyclesClient.commitReservation(reservationId, Map.of(
                    "idempotency_key", UUID.randomUUID().toString(),
                    "actual", Map.of("unit", "USD_MICROCENTS",
                                     "amount", tokenCount.get() * 250L)
                ));
            })
            .doOnError(err -> {
                cyclesClient.releaseReservation(reservationId, Map.of(
                    "idempotency_key", UUID.randomUUID().toString(),
                    "reason", "stream_error: " + err.getMessage()
                ));
            });
    }
}
```

## Agent loop budget control

For multi-step agent workflows, guard each iteration. Each call gets its own reservation, so Cycles can deny mid-workflow when budget runs out:

```java
@Service
public class AgentService {

    private final GuardedLlmService llm;

    public String runAgent(String task, int maxIterations) {
        String context = task;

        for (int i = 0; i < maxIterations; i++) {
            try {
                String response = llm.generate(context, 2048);
                if (isComplete(response)) {
                    return response;
                }
                context = response;
            } catch (CyclesProtocolException e) {
                if (e.isBudgetExceeded()) {
                    return "Agent stopped: budget exhausted after " + i + " iterations.";
                }
                throw e;
            }
        }

        return "Agent reached max iterations.";
    }
}
```

## Production patterns

### Dry-run rollout

Start in shadow mode to measure budget impact before enforcing:

```java
@Cycles(value = "#maxTokens * 250",
        actionKind = "llm.completion",
        actionName = "gpt-4o",
        dryRun = true)
public Object shadowChat(String prompt, int maxTokens) {  // returns DryRunResult, not the chat content
    return chatClient.prompt(prompt).call().content();
}
```

::: warning
When `dryRun = true`, the guarded method does **not** execute. The annotation evaluates the reservation against the budget but skips method execution and returns a framework result object. Use this to measure what budget impact would be, not for serving production traffic.
:::

### Multi-tenant via SpEL

Resolve tenant from the method parameters:

```java
@Cycles(value = "#maxTokens * 250",
        tenant = "#tenantId",
        actionKind = "llm.completion",
        actionName = "gpt-4o")
public String tenantChat(String tenantId, String prompt, int maxTokens) {
    return chatClient.prompt(prompt).call().content();
}
```

### Self-invocation workaround

Spring AOP proxies do not intercept self-calls within the same bean. If you call an `@Cycles` method from another method in the same class, the annotation is bypassed. Use a separate service bean:

```java
// This bean's @Cycles annotations ARE intercepted by the proxy
@Service
public class GuardedLlmService {
    private final ChatClient chatClient;

    public GuardedLlmService(ChatClient.Builder builder) {
        this.chatClient = builder.build();
    }

    @Cycles(value = "#maxTokens * 250", actionKind = "llm.completion", actionName = "gpt-4o")
    public String generate(String prompt, int maxTokens) {
        return chatClient.prompt(prompt).call().content();
    }
}

// This bean calls the guarded bean — proxy intercepts correctly
@Service
public class AgentOrchestrator {
    @Autowired private GuardedLlmService llm;

    public String orchestrate(String task) {
        return llm.generate(task, 2048);  // @Cycles is applied
    }
}
```

## Key points

- `@Cycles` works with any Spring AI `ChatClient` or `ChatModel` call — no adapter needed
- Use `value` (SpEL) to estimate cost before execution, `actual` to commit real cost after
- `CyclesContextHolder.get()` provides reservation context inside the guarded method — use it for caps and metrics
- Guard tool calls with `@Cycles` on a separate `@Service` bean, scoped with `toolset`
- For streaming, use the programmatic `CyclesClient` instead of the annotation
- Catch `CyclesProtocolException` to degrade to a cheaper model or queue for retry
- Start with `dryRun = true` for shadow-mode rollouts before enforcing

## Next steps

For **Path 1 (`cycles-spring-ai-starter`):**

- [Spring AI Starter Configuration Reference](/configuration/spring-ai-starter-configuration-reference) — every property, extension point, auto-configuration condition, and the double-charge boundary
- [`cycles-spring-ai-starter` README](https://github.com/runcycles/cycles-spring-ai-starter) — source-repository quickstart and examples
- [`cycles-spring-ai-starter` on Maven Central](https://central.sonatype.com/artifact/io.runcycles/cycles-spring-ai-starter)
- [Budget Limits with Spring AI](/quickstart/how-to-add-hard-budget-limits-to-spring-ai-with-cycles) — strategic guidance on where to put the gates

For **Path 2 (`@Cycles` annotation / `cycles-client-java-spring`):**

- [Spring Boot Starter Quickstart](/quickstart/getting-started-with-the-cycles-spring-boot-starter) — demo app, annotation reference, full walkthrough
- [Spring Client Configuration](/configuration/client-configuration-reference-for-cycles-spring-boot-starter) — all `cycles.*` properties
- [SpEL Expression Reference](/configuration/spel-expression-reference-for-cycles) — estimate and actual expressions
- [Choosing the Right Overage Policy](/how-to/choosing-the-right-overage-policy) — REJECT vs ALLOW_IF_AVAILABLE vs ALLOW_WITH_OVERDRAFT
