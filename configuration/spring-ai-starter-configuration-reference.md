---
title: "Spring AI Starter Configuration Reference"
description: "Configure Cycles Spring AI chat and tool gates, token estimates, failure behavior, subject routing, and trace-to-reservation correlation."
---

# Spring AI Starter Configuration Reference

This page is the complete configuration reference for `io.runcycles:cycles-spring-ai-starter` 0.4.0. The authoritative implementation is [`CyclesSpringAiProperties`](https://github.com/runcycles/cycles-spring-ai-starter/blob/main/cycles-spring-ai-starter/src/main/java/io/runcycles/client/java/springai/autoconfigure/CyclesSpringAiProperties.java).

The integration uses two property namespaces:

- `cycles.*` configures the underlying `cycles-client-java-spring` client, including the server URL, API key, subject defaults, HTTP timeouts, and retries.
- `cycles.spring-ai.*` configures the Spring AI advisors, token accounting, tool labels, failure behavior, and tracing.

See [Spring Client Configuration](/configuration/client-configuration-reference-for-cycles-spring-boot-starter) for the underlying `cycles.*` namespace.

## Minimal configuration

```yaml
cycles:
  base-url: http://localhost:7878
  api-key: ${CYCLES_API_KEY}
  tenant: acme
  workspace: production
  app: support-agent

  spring-ai:
    enabled: true
    default-estimate: 1000
    estimate-unit: TOKENS
```

The starter auto-attaches both its non-streaming and streaming advisors to every `ChatClient` built from Spring Boot's auto-configured `ChatClient.Builder`.

It does not automatically gate:

- a manually constructed `ChatClient.Builder` that did not receive Spring Boot's customizers;
- raw provider SDK calls;
- tool callbacks, unless you explicitly wrap them with `CyclesToolGate`;
- a `ChatClient` whose call path is already wrapped by the `@Cycles` Spring Boot starter.

Wrapping the same call with both the Spring AI advisor and `@Cycles` creates two reservations. Choose one gate for each call path.

## Property reference

| Property | Type | Default | Behavior |
|---|---|---|---|
| `cycles.spring-ai.enabled` | Boolean | `true` | Master switch. When `false`, the Spring AI auto-configuration does not register its beans. |
| `cycles.spring-ai.default-estimate` | Long | `1000` | Pre-call reservation amount when prompt-derived estimation is disabled or unavailable. Must be non-negative; invalid values fail property binding at startup. |
| `cycles.spring-ai.estimate-unit` | String | `USD_MICROCENTS` | Unit for estimates and commits: `USD_MICROCENTS`, `TOKENS`, `CREDITS`, or `RISK_POINTS`. It must match the target budget ledger's unit. |
| `cycles.spring-ai.action-kind` | String | `llm.chat` | `action.kind` recorded on chat reservations. |
| `cycles.spring-ai.action-name` | String | `spring-ai-chat` | `action.name` recorded on chat reservations. |
| `cycles.spring-ai.tool-action-kind` | String | `tool.call` | `action.kind` used by `CyclesToolCallback`-wrapped tools. |
| `cycles.spring-ai.tool-action-name-prefix` | String | `spring-ai-tool:` | Prefix joined with the wrapped tool name, such as `spring-ai-tool:get_weather`. |
| `cycles.spring-ai.fail-open` | Boolean | `false` | When `true`, reservation or commit transport/HTTP failures are logged and the model call proceeds. Explicit Cycles budget denials are always surfaced. |
| `cycles.spring-ai.input-cost-per-token` | Long | `0` | Cost per prompt token in `estimate-unit`. Must be non-negative. Used for actual-cost commits when the provider returns token breakdowns. |
| `cycles.spring-ai.output-cost-per-token` | Long | `0` | Cost per completion token in `estimate-unit`. Must be non-negative. Used for actual-cost commits when the provider returns token breakdowns. |
| `cycles.spring-ai.estimate-from-prompt` | Boolean | `false` | Derives the reservation from estimated prompt tokens when at least one token rate is positive. Falls back to `default-estimate` when derivation is unavailable or returns zero. |
| `cycles.spring-ai.token-estimator-encoding` | String | unset | Selects a jtokkit BPE encoding when jtokkit is present. Supported names: `cl100k_base`, `o200k_base`, `p50k_base`, `p50k_edit`, and `r50k_base`. |
| `cycles.spring-ai.emit-reservation-id-on-trace` | Boolean | `true` | Adds `cycles.reservation_id` as a high-cardinality trace value when the Cycles observation convention is explicitly attached. |

Spring Boot relaxed binding also accepts uppercase environment-variable forms, for example:

```bash
CYCLES_SPRING_AI_ENABLED=true
CYCLES_SPRING_AI_DEFAULT_ESTIMATE=1000
CYCLES_SPRING_AI_ESTIMATE_UNIT=TOKENS
CYCLES_SPRING_AI_FAIL_OPEN=false
```

## Actual usage calculation

The advisor chooses the committed amount in this order:

1. With `estimate-unit=TOKENS`, it commits `Usage.getTotalTokens()` when the provider supplies it.
2. With either token rate configured, it commits `promptTokens × inputRate + completionTokens × outputRate`.
3. Otherwise, it commits `default-estimate`.

If both prompt and completion token counts are missing, the advisor commits the estimate instead of treating missing usage as zero. If only one breakdown is present, it charges the available side and treats the missing side as zero.

### USD microcents example

`USD_MICROCENTS` uses 100,000,000 units per US dollar. A model priced at $2.50 per million input tokens and $10.00 per million output tokens therefore uses rates of 250 and 1,000:

```yaml
cycles:
  spring-ai:
    estimate-unit: USD_MICROCENTS
    default-estimate: 125000
    input-cost-per-token: 250
    output-cost-per-token: 1000
```

Keep model prices in application configuration and update them when the provider's pricing changes. The starter does not fetch provider pricing.

## Prompt-derived reservation sizing

Enable prompt sizing only when at least one token rate is positive:

```yaml
cycles:
  spring-ai:
    estimate-from-prompt: true
    input-cost-per-token: 250
    output-cost-per-token: 1000
```

The default `CharsPerTokenEstimator` approximates prompt tokens as characters divided by four. It then multiplies the estimated input-token count by the sum of the input and output rates, assuming output length is comparable to input length.

For OpenAI-family BPE estimation, add jtokkit:

```xml
<dependency>
  <groupId>com.knuddels</groupId>
  <artifactId>jtokkit</artifactId>
  <version>1.1.0</version>
</dependency>
```

Then select an encoding:

```yaml
cycles:
  spring-ai:
    estimate-from-prompt: true
    token-estimator-encoding: o200k_base
```

The jtokkit dependency is optional and is not pulled transitively. If an encoding is configured without jtokkit on the classpath, startup logs a warning and the starter uses the characters-per-four estimator.

## Failure behavior

The default is fail closed:

```yaml
cycles:
  spring-ai:
    fail-open: false
```

| Failure | `fail-open=false` | `fail-open=true` |
|---|---|---|
| Explicit `DENY` from Cycles | Throws `CyclesBudgetDeniedException` | Throws `CyclesBudgetDeniedException` |
| Reservation transport or non-2xx failure | Fails the call | Logs and calls the model without a reservation |
| Malformed successful reservation response | Fails the call | Logs and calls the model without a reservation |
| Commit transport or non-2xx failure | Fails after model execution | Logs and returns the model result |
| Model call failure | Releases the reservation best-effort, then propagates the model error | Same |
| Stream error or cancellation | Releases the reservation best-effort | Same |

Release failures are logged and left for reservation TTL recovery. `fail-open` is an availability tradeoff, not an observe-only mode: when it allows a call after a Cycles failure, that call is not protected by a live reservation.

## Per-call subject routing

The default `PropertiesSubjectResolver` uses the underlying `cycles.tenant`, `cycles.workspace`, `cycles.app`, `cycles.workflow`, `cycles.agent`, and `cycles.toolset` values.

For multi-tenant applications, provide a `SubjectResolver` bean:

```java
@Bean
SubjectResolver authenticatedSubjectResolver(CyclesProperties defaults) {
    return request -> {
        Authentication auth = SecurityContextHolder.getContext().getAuthentication();
        String tenant = auth != null && auth.isAuthenticated()
                ? auth.getName()
                : defaults.getTenant();

        return Subject.builder()
                .tenant(tenant)
                .workspace(defaults.getWorkspace())
                .app(defaults.getApp())
                .build();
    };
}
```

The resolver receives the current `ChatClientRequest` for chat calls. Tool-gating calls pass `null`, because Spring AI tool callbacks do not carry that request; custom resolvers must handle that path.

## Custom token estimator

A custom `PromptTokenEstimator` bean replaces both the characters-per-four and jtokkit defaults:

```java
@Bean
PromptTokenEstimator providerTokenEstimator(ProviderTokenizer tokenizer) {
    return request -> request.prompt().getInstructions().stream()
            .map(Message::getText)
            .filter(Objects::nonNull)
            .mapToLong(tokenizer::countTokens)
            .sum();
}
```

The custom estimator affects pre-call reservation sizing only. Actual commits still use the provider's `ChatResponse.Usage` when available.

## Tool gating

Tool gating is explicit:

```java
@Bean
ToolCallback getWeatherTool(CyclesToolGate gate, WeatherTool weatherTool) {
    ToolCallback raw = ToolCallbacks.from(weatherTool)[0];
    return gate.wrap(raw);
}
```

Only wrapped callbacks reserve and settle through Cycles. The tool gate uses `tool-action-kind` and `tool-action-name-prefix`, and commits the configured default estimate because Spring AI tool callbacks do not expose a standard actual-usage result to the gate.

If the tool internally calls an auto-configured `ChatClient`, that nested model call is separately gated by the chat advisor. A raw provider SDK or a hand-built `ChatClient` that bypasses the auto-configured builder is not.

## Trace correlation

`CyclesChatClientObservationConvention` adds these low-cardinality tags:

- `cycles.tenant`
- `cycles.workspace`
- `cycles.app`
- `cycles.action_kind`
- `cycles.action_name`

It also adds `cycles.reservation_id` as a high-cardinality value by default. The convention is registered as a bean but is not attached automatically:

```java
@Bean
ChatClient governedChatClient(
        ChatClient.Builder builder,
        CyclesChatClientObservationConvention cyclesConvention) {
    return builder
            .observationConvention(cyclesConvention)
            .build();
}
```

Disable only the reservation ID when high-cardinality trace values are too expensive:

```yaml
cycles:
  spring-ai:
    emit-reservation-id-on-trace: false
```

## Auto-configuration conditions and overrides

The integration activates when all of these conditions hold:

- Spring AI `ChatClient` and `ChatClientCustomizer` are on the classpath;
- the underlying starter has created a `CyclesClient` bean;
- `cycles.spring-ai.enabled` is `true` or absent.

User-provided beans replace the defaults for:

- `SubjectResolver`
- `PromptTokenEstimator`
- `CyclesBudgetAdvisor`
- `CyclesBudgetStreamAdvisor`
- `CyclesToolGate`
- `CyclesChatClientObservationConvention`

To replace only advisor attachment while keeping other `ChatClientCustomizer` beans, provide a bean named `cyclesChatClientCustomizer`.

## Related

- [Integrating Cycles with Spring AI](/how-to/integrating-cycles-with-spring-ai) — installation and complete examples
- [Spring Client Configuration](/configuration/client-configuration-reference-for-cycles-spring-boot-starter) — underlying HTTP client, subject, timeout, and retry properties
- [Spring AI starter source](https://github.com/runcycles/cycles-spring-ai-starter)
