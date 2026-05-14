---
title: "Pre-Call Budget Reservation as a Spring AI Advisor"
date: 2026-05-14
author: Albert Mavashev
tags: [spring-ai, java, integration, runtime-authority, agents, engineering]
description: "How cycles-spring-ai-starter inserts reserve-commit-release into Spring AI's advisor chain — call advisor, Flux streaming, SubjectResolver, tool gating."
blog: true
sidebar: false
featured: false
head:
  - - meta
    - name: keywords
      content: "Spring AI budget control, Spring AI advisor, ChatClient budget enforcement, CyclesBudgetCallAdvisor, CyclesBudgetStreamAdvisor, Spring AI multi-tenant agents, jtokkit Spring AI, Spring AI tool gating, SubjectResolver Spring AI, Cycles Spring AI starter"
---

# Pre-Call Budget Reservation as a Spring AI Advisor

A Spring AI agent calling `chatClient.prompt(...).call()` looks like one line of code. Underneath, that one line might decide a tool call, generate a long response, and bill an upstream provider whose pricing can change with little notice. The runtime-authority question is whether the call gets to happen at all, and the answer needs to be decided before the request leaves the JVM.

For a plain Spring Boot service wrapping a raw OpenAI client, we covered that integration shape in [How scalerX.ai Wired Cycles Into a Java Agent Runtime](/blog/how-scalerx-wired-cycles-into-a-java-agent-runtime) — a `@Cycles` annotation on the method that calls the provider. Spring AI changes the shape: there is no single provider call to annotate, because Spring AI already abstracts the call. The right insertion point is Spring AI's own advisor chain.

This post walks through how `cycles-spring-ai-starter` (currently 0.3.1) inserts the [reserve-commit-release lifecycle](/glossary#reservation) into that chain — for non-streaming chat, for streaming `Flux`, for tools, and for the trace correlation that ties it all together.

<!-- more -->

## Why an advisor, not an annotation

Spring AI's `ChatClient` already runs every prompt through an ordered chain of `CallAdvisor` (non-streaming) and `StreamAdvisor` (streaming) participants. Each advisor sees the `ChatClientRequest`, can short-circuit, can mutate, or can delegate to `chain.nextCall(request)` / `chain.nextStream(request)`. That chain is where Spring AI itself implements logging, memory, and tool resolution.

For [runtime authority](/glossary#runtime-authority) over agent spend, an advisor is the natural shape: it runs *before* the provider call and gets to surface a denial as a thrown exception that the rest of the chain already knows how to handle. (Spring AI's own `spring.ai.retry.*` retries wrap the underlying `ChatModel`, below the advisor, so the advisor sees one logical call per `ChatClient` invocation regardless of whether the model retries internally.) Annotations sit one level too high — they bind to the calling method, not to the abstraction the framework is built around.

There is one wiring detail that matters in Spring AI 1.0+: simply exposing a `CallAdvisor` as a bean is not enough. The auto-configured `ChatClient.Builder` only picks up advisors via a `ChatClientCustomizer` bean. The starter ships that customizer and attaches both advisors at `HIGHEST_PRECEDENCE + 100` — early enough that a denial short-circuits before any other advisor does meaningful work, late enough that any earlier advisor a user adds gets to inspect the request first.

## The non-streaming advisor: reserve, call, commit, release

The whole `CyclesBudgetCallAdvisor` lifecycle is three wire calls (reserve, commit *or* release) and one delegation:

| Step | Cycles wire call | Spring AI hook |
|---|---|---|
| Pre-call | `POST /v1/reservations` (subject + action + estimate) | `CallAdvisor.adviseCall(...)` |
| Call | (delegate) | `chain.nextCall(request)` |
| Commit on success | `POST /v1/reservations/{id}/commit` with actual | After `nextCall` returns |
| Release on error | `POST /v1/reservations/{id}/release` | Catch block, re-throw original |

The flow that matters is what "actual" means on commit. v0.2.0 made this real: when the response carries `ChatResponse.Usage` and either `input-cost-per-token` / `output-cost-per-token` are configured, or `estimate-unit=TOKENS`, the advisor commits the token-derived cost rather than the pre-call estimate. When `Usage` is `null`, or non-null but with `null` breakdown fields the provider didn't populate, the advisor falls back to committing the estimate as actual — under-billing with a zero commit when the provider is silent would be worse than admitting we are estimating. Literal zero breakdowns are different: those commit zero, because a real "no work done" response should not be inflated to the estimate.

The denial path is the more interesting one. When the Cycles server returns DENY, the advisor throws `CyclesBudgetDeniedException` and `chain.nextCall` is never called. The LLM call never happens, the provider is never hit, and the agent's caller gets a typed exception that says *why* (insufficient budget, over cap, scope expired). That is the property an annotation-on-a-method can't give you cleanly when the call is several layers down the framework.

```java
@Service
public class OrderAgent {
    private final ChatClient chatClient;

    public OrderAgent(ChatClient.Builder builder) {
        this.chatClient = builder.build();   // advisor auto-attached
    }

    public String summarize(String order) {
        // CyclesBudgetCallAdvisor reserves before this hits the provider.
        // On denial, throws — the provider call never happens.
        return chatClient.prompt()
                .user("Summarize: " + order)
                .call()
                .content();
    }
}
```

That is the entire integration for the simple case. No annotations, no proxies, no manual wrapper.

## The streaming advisor: per-subscription reservation, fail-closed commit

Streaming changes the shape because the lifecycle is no longer scoped to a method return. `chatClient.prompt(...).stream()` returns a stream-spec on which `.chatResponse()` yields a `Flux<ChatResponse>` (or `.chatClientResponse()` yields a `Flux<ChatClientResponse>`). The reservation has to start when something subscribes, the commit has to fire when the upstream completes, and the release has to fire on cancellation, error, or assembly failure. There are several places where naive code leaks reservations:

- **Assembled but not subscribed.** Code that builds a `Flux` and then never subscribes — common in conditional pipelines — would otherwise create an orphan reservation.
- **Resubscribed.** A `Flux` that gets retried with `.retry(...)` would otherwise re-use the original reservation against a new attempt.
- **Commit failure.** If the commit call fails after the stream emits `onComplete`, the subscriber has already seen completion — but the budget side is in an inconsistent state.

`CyclesBudgetStreamAdvisor` handles each. The pseudocode below mirrors the operator order in the production source — `doOnError` and `doOnCancel` attach to the upstream *before* the commit `Mono` is concatenated, and that ordering matters for the failure semantics described below:

```text
// Illustrative — element-type adaptation around concatWith elided.
Flux.defer(() -> {
    var reservationId = reserveSync(request);                        // per-subscription
    return chain.nextStream(request)
        .doOnNext(lastResponse::set)
        .doOnError(e -> release(reservationId, "stream_error"))      // upstream errors only
        .doOnCancel(()  -> release(reservationId, "cancelled"))
        .concatWith(commitThenEmptyOrError(reservationId));          // commit, or propagate commit failure as onError
});
```

`Flux.defer` is the per-subscription gate: nothing reserves until something subscribes, and a resubscribe produces a fresh reservation. The commit step composed via `concatWith` runs after the upstream emits `onComplete` but *before* the subscriber sees the terminal signal — that is the fail-closed property. If the commit fails, the subscriber gets `onError` instead of `onComplete`, matching the non-streaming advisor's contract on the caller-facing signal. The commit failure does *not* fire the upstream `doOnError` handler — that handler is attached before the commit `Mono` is concatenated, so it observes only upstream errors. Commit-failure cleanup therefore relies on server-side reservation TTL expiry rather than an explicit `release` call. The tradeoff is deliberate: the subscriber sees the failure correctly, the reservation is left to expire, and the alternative — wiring an extra `doOnError` *after* `concatWith` to release on commit failure — would couple the release path to a signal the production advisor has chosen not to handle. If `chain.nextStream` itself throws during assembly after the reservation succeeded, the advisor releases and re-throws.

Reservation failures (denial, transport) surface as `onError` to the subscriber rather than synchronous throws. That is the reactive-idiomatic shape; callers handle it with `.onErrorResume(...)` like any other reactive failure.

## SubjectResolver: routing the tenant per request

v0.2.0 read the Cycles `Subject` ([tenant](/glossary#tenant)/workspace/app) from properties on every reservation. Every chat call from a given application got the same subject. For a single-tenant deployment that's fine; for a multi-tenant SaaS agent it is the wrong default — every tenant's spend would attribute to the same scope.

v0.3.0 added `SubjectResolver`, a functional interface invoked per request:

```java
@Bean
public SubjectResolver tenantAwareSubjectResolver(CyclesProperties defaults) {
    return request -> {
        var auth = SecurityContextHolder.getContext().getAuthentication();
        return Subject.builder()
                .tenant(auth != null ? auth.getName() : defaults.getTenant())
                .workspace(defaults.getWorkspace())
                .app(defaults.getApp())
                .build();
    };
}
```

The advisor calls the resolver for each call. The default `PropertiesSubjectResolver` is registered via `@ConditionalOnMissingBean`, so registering your own bean is the only thing you need to do — the auto-configured default backs off. The same resolver fires on both chat advisors. One caveat the starter is explicit about: on the tool-gating path the `request` parameter is `null` (the tool callback doesn't carry a `ChatClientRequest`), so implementations should fall back to a default when `request == null`.

This is the [per-tenant isolation](/blog/multi-tenant-ai-cost-control-per-tenant-budgets-quotas-isolation) story expressed at the Spring AI layer. Each call's reservation books against the calling tenant's scope, and tenant boundaries in the Cycles server enforce the rest.

## PromptTokenEstimator: real BPE, not chars/4

The cleanest case for a pre-call estimate is `prompt-chars / 4`. It is roughly correct for English text on OpenAI BPE tokenizers, and it costs nothing. It is also wrong in several common situations:

- **CJK content.** A character is often one token, not a quarter — the estimate can run several times low.
- **Code and JSON.** Token density differs from natural text. Estimate drifts in either direction.
- **Non-BPE tokenizers.** Anthropic and Gemini use different tokenizers; `chars / 4` is a guess about OpenAI applied to a different model.

v0.3.0 makes the estimator pluggable. The starter ships a [jtokkit](https://github.com/knuddelsgmbh/jtokkit)-based implementation; opt in by setting the encoding and adding jtokkit as an explicit dep:

```yaml
cycles:
  spring-ai:
    estimate-from-prompt: true
    input-cost-per-token: 250        # $2.50/1M tokens × 100M microcents/USD
    output-cost-per-token: 1000      # $10.00/1M tokens × 100M microcents/USD
    token-estimator-encoding: o200k_base    # gpt-4o family
```

```xml
<dependency>
    <groupId>com.knuddels</groupId>
    <artifactId>jtokkit</artifactId>
    <version>1.1.0</version>
</dependency>
```

Two failure modes worth calling out: setting `token-estimator-encoding` without jtokkit on the classpath logs a WARN at startup and falls back to chars/4 — the misconfig is visible at boot, not at first call. An unknown encoding name fails bean initialization at startup. Both behaviors choose explicit startup signal over the kind of silent under-billing that creates [estimate drift](/blog/estimate-drift-silent-killer-of-enforcement) you can't audit out later.

For Anthropic, Gemini, or anything else that doesn't speak OpenAI BPE, register your own `PromptTokenEstimator` bean and the jtokkit default backs off.

A note on the math: `Unit.java` defines `1 USD = 100,000,000 USD_MICROCENTS`. So $2.50 per 1M tokens is `2.50 × 100,000,000 / 1,000,000 = 250` microcents per token, not 25. The starter's v0.3.0 README example was off by 10x and was corrected in v0.3.1 (a documentation-only patch release); the formula above is the canonical conversion.

## Tool gating: opt-in, separable in audit

Chat reservations cover prompt cost, but agents that call tools incur cost *and* exposure on each tool call too. Spring AI's `ToolCallback` is the unit to gate, but Spring AI does not expose a hook to auto-decorate every registered tool — so tool gating is opt-in by design.

```java
@Configuration
class ToolWiring {
    @Bean
    ToolCallback getWeatherTool(CyclesToolGate cyclesToolGate,
                                Method reflectedMethod,            // your real Method
                                WeatherService weatherTarget) {     // your tool target
        // Illustrative — the real builder also needs schema bits
        // and any other ToolDefinition fields your tool requires.
        ToolCallback raw = MethodToolCallback.builder()
                .toolDefinition(ToolDefinition.builder().name("get_weather").build())
                .toolMethod(reflectedMethod)
                .toolObject(weatherTarget)
                .build();
        return cyclesToolGate.wrap(raw);
    }
}
```

`CyclesToolGate.wrap(...)` returns a `CyclesToolCallback` that runs the reserve/commit/release lifecycle around the wrapped tool's `call`. Tool reservations report `tool.call` as `action.kind` and `spring-ai-tool:<tool-name>` as `action.name` — distinct from chat's `llm.chat` / `spring-ai-chat`, so they're separable in audit history. A platform operator looking at a tenant's reservation log can answer "how much of this tenant's spend was tool calls vs. chat" without parsing free-text.

One honest limitation: tool callbacks don't expose token usage to the gate, so the current commit uses `default-estimate` as actual. For tools whose cost is fixed-price or close enough to be approximated with one number, that is fine. For tools that wrap a variable-cost downstream API, the commit is a placeholder and the per-call accuracy needs to come from elsewhere (a dedicated metering call, or a future starter extension point). If a tool internally calls an LLM via the auto-configured `ChatClient`, that call goes through the chat advisor and the LLM cost lands on the right scope through a different path — but only via the auto-configured `ChatClient`. Tools that bypass it (raw provider SDKs, hand-built `ChatClient.Builder` instances that omit the starter's `ChatClientCustomizer`) get neither the tool-gate commit nor the chat-advisor reservation, and their LLM cost is invisible to Cycles.

## Trace correlation: reservation IDs on chat-client observations

Spring AI emits Micrometer observations on every `ChatClient` call. The starter ships `CyclesChatClientObservationConvention`, which extends Spring AI's default convention and appends low-cardinality Cycles attribution tags — `cycles.tenant`, `cycles.workspace`, `cycles.app`, `cycles.action_kind`, `cycles.action_name` — on every chat-client observation. v0.3.0 added one more: `cycles.reservation_id`, as a high-cardinality `KeyValue` on each observation.

That single tag is what closes the [trace ↔ reservation](/blog/w3c-trace-context-ai-agent-debugging) correlation loop. The trace tells you what your agent did and how long it took. The Cycles reservation log tells you what it cost and which scope booked it. With `cycles.reservation_id` on the span, you can pivot from a slow trace to the matching reservation, or from an over-budget tenant's reservations to the traces that produced them.

The convention is auto-configured as a bean but **not** auto-attached. Applying an observation convention has cross-cutting trace-visibility implications, and the starter treats that as a deliberate user choice:

```java
@Service
class TracedAgent {
    private final ChatClient chatClient;

    TracedAgent(ChatClient.Builder builder, CyclesChatClientObservationConvention cyclesConvention) {
        this.chatClient = builder
                .observationConvention(cyclesConvention)
                .build();
    }
}
```

If your tracing backend bills by unique tag-value combinations, set `cycles.spring-ai.emit-reservation-id-on-trace=false` to keep the low-cardinality tags but drop the per-call reservation id.

## What you get, end to end

Connecting the pieces: a `ChatClient` autowired from the Spring-AI-configured builder gets the call and stream advisors automatically. Per-request `Subject` routing comes from a `SubjectResolver` bean. Pre-call estimates come from jtokkit (or your own estimator). Tool calls are gated when you wrap the `ToolCallback`. Reservation IDs appear on chat-client observations once the `CyclesChatClientObservationConvention` is applied and `emit-reservation-id-on-trace` is left enabled.

Chat call sites need no code changes — building from the auto-configured `ChatClient.Builder` is enough. Tool gating and trace-convention attachment are deliberate opt-ins that touch the wiring layer but not the call sites themselves. The same pattern the [scalerX integration](/blog/how-scalerx-wired-cycles-into-a-java-agent-runtime) applied to raw OpenAI calls in plain Spring Boot, now sitting one layer higher in the Spring AI advisor chain — at the framework's own advisor extension point.

For the broader picture of where this fits — why pre-execution authority differs from observability layers, and why [governance lives at the runtime](/blog/what-is-runtime-authority-for-ai-agents) rather than the framework — the runtime-authority pillar covers it.

## Resources

- [`cycles-spring-ai-starter` on GitHub](https://github.com/runcycles/cycles-spring-ai-starter) — source, releases, integration tests.
- [`cycles-spring-ai-starter` on Maven Central](https://central.sonatype.com/artifact/io.runcycles/cycles-spring-ai-starter) — `0.3.1` current at publication.
- [Spring AI advisor reference](https://docs.spring.io/spring-ai/reference/api/advisors.html) — the framework abstraction the starter plugs into.
- [Cycles Protocol](https://github.com/runcycles/cycles-protocol) — the open spec for runtime budget and action authority.
- [How scalerX.ai Wired Cycles Into a Java Agent Runtime](/blog/how-scalerx-wired-cycles-into-a-java-agent-runtime) — the same lifecycle, applied at the plain Spring Boot / raw provider layer.
- [What is Runtime Authority for AI Agents?](/blog/what-is-runtime-authority-for-ai-agents) — the conceptual baseline.
