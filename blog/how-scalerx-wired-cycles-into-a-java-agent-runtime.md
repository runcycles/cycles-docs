---
title: "How scalerX.ai Wired Cycles Into a Java Agent Runtime"
date: 2026-05-05
author: Cycles Team
tags:
  - case-study
  - integration
  - java
  - spring-boot
  - agents
  - budgets
description: "How scalerX.ai added budget reservations to a Java Spring Boot agent runtime — the @Cycles annotation, scope hierarchies, and reserve/commit on OpenAI calls."
blog: true
sidebar: false
featured: false
head:
  - - meta
    - name: keywords
      content: scalerX.ai integration, Cycles Java SDK, Spring Boot LLM budget, agent platform cost control, @Cycles annotation, OpenAI Responses API budget, AI agent governance Java
---

# How scalerX.ai Wired Cycles Into a Java Agent Runtime

scalerX.ai is a multi-[tenant](/glossary#tenant) agent platform built on Spring Boot. Before Cycles, every user request flowed through two cost-control systems: a subscription tier with per-feature monthly request limits, and an optional [credits](/glossary#credits) ledger that debited a pre-priced amount per call. The team described the result as multiple checks per request — two sources of truth for what a user could afford, evaluated independently on the way to each LLM call.

After Cycles, the request-time cost-control logic for LLM calls lives in one annotation. This post walks through what the integration looks like in their codebase — what they kept, what they removed, and a few opinionated choices worth flagging for any team about to do the same thing in Java.

This is not a polished production case study. It's a field report from a first-stab integration into a real Java/Spring agent runtime: what became simpler, what stayed explicit, and what's still ahead — tool-call gating in particular.

<!-- more -->

## What scalerX replaced

The previous setup did its job, but it carried two costs that compounded over time.

The first was implementation overhead. Every new feature had to teach itself two things: which subscription tier the caller was on, and whether they had enough credits. Both checks lived in application code. Both had to be updated when pricing or tiers changed. When the two systems disagreed — a user with credits but on a tier that excluded the feature, or vice versa — the application code had to reconcile.

The second was cognitive overhead. Cost control was spread across the service tree. There was no single place to look at and say "this is what governs spend on the platform." Engineers stepping into a request path had to know about both systems and remember which one applied where.

Cycles let scalerX collapse the request-time LLM cost check into a single declarative wrapper around the one expensive thing this path does: call OpenAI.

## One annotation, one hot path

The full LLM-side integration is a 22-line Spring service:

```java
package ai.persona.responses.services;

import ai.persona.services.openai.OpenAIClientProvider;
import io.github.sashirestela.openai.SimpleOpenAI;
import io.github.sashirestela.openai.domain.response.Response;
import io.github.sashirestela.openai.domain.response.ResponseRequest;
import io.runcycles.client.java.spring.annotation.Cycles;
import org.springframework.stereotype.Service;

@Service
public class CyclesOpenAIService {

    private final SimpleOpenAI openAI;

    public CyclesOpenAIService(OpenAIClientProvider clientProvider) {
        this.openAI = clientProvider.getOpenAI();
    }

    @Cycles(estimate = "1", workspace = "#workspaceId", unit = "CREDITS")
    public Response runOpenAIRequestCycles(ResponseRequest request, String workspaceId) {
        return this.openAI.responses().create(request).join();
    }
}
```

That `@Cycles` annotation is doing all of the budget work. It comes from `io.runcycles:cycles-client-java-spring`, the Spring Boot starter for the Cycles Java client. At runtime, the starter intercepts every call to `runOpenAIRequestCycles`, derives a scope from the `#workspaceId` SpEL expression, places a [reservation](/glossary#reservation) against that workspace's budget, and only invokes the underlying OpenAI request if the reservation is allowed. On return, it settles the reservation — committing one credit (the reserved estimate) on success, releasing the reservation on exception. That reserve-then-commit shape is the [runtime authority](/blog/what-is-runtime-authority-for-ai-agents) pattern — pre-execution enforcement, not post-hoc reporting.

The estimate is hardcoded to `1` credit per call, and the unit is `CREDITS`. scalerX runs a fixed-price model where each LLM request maps to one credit, so the reserved estimate and the committed amount are effectively the same unit of product accounting — there's no token-metering or USD-conversion happening on commit. The Cycles unit system supports `USD_MICROCENTS`, `TOKENS`, and `RISK_POINTS` if a different pricing model is needed later, but credits are the right primitive for what scalerX is doing today.

A few things to call out about this shape:

- **Only OpenAI Responses calls are protected.** Tool calls, database writes, and other side effects flow through unwrapped. scalerX's reasoning is that any tool invocation is preceded by an LLM call that decides to use the tool, so wrapping the LLM step budget-throttles the reasoning that triggers tool use. That's cost throttling, not action authority — a single allowed LLM call can still produce a destructive tool call. It's a reasonable v1 simplification, with the gap explicitly tracked in [the roadmap section](#whats-not-in-yet).
- **The annotation reads workspace from a method argument.** `workspace = "#workspaceId"` evaluates a SpEL expression against the call's parameters. That keeps the LLM service stateless — it doesn't need a `RequestContext` thread-local or a Spring Security principal. Whoever calls `runOpenAIRequestCycles` passes the workspace explicitly.
- **There is no reservation lifecycle in this method.** No `try`/`catch` around the OpenAI call, no manual commit, no manual release. The starter handles all three transitions (reserve → commit / reserve → release-on-throw) via the Spring AOP interceptor.

For the hot path, that's the entire integration.

## Why there's also an explicit service

The LLM path is one annotation. The wallet-management path is a 542-line service called `CyclesBudgetManagementService`. Most of those lines aren't runtime enforcement — they're management-plane glue: wallet creation when a user signs up, funding when they buy credits, balance lookups for the [dashboard](/glossary#dashboard), event-history queries for receipts, and result parsing. Those operations don't fit the reserve/commit shape. They're CRUD against a budget admin API.

The annotation handled the request-time budget question — *can this user afford this LLM call right now* — with almost no code. The line count goes to the rest of the lifecycle, which is the kind of code most integrators end up writing themselves today.

scalerX wrote the HTTP wrapper for these admin calls themselves — direct POSTs to the Cycles admin endpoints (`/v1/admin/budgets`, `/v1/admin/budgets/fund`, `/v1/admin/budgets/lookup`, `/v1/admin/events`) using their existing `HttpClientService`. Each operation accepts an [idempotency key](/glossary#idempotency-key) (auto-generated via `UUID.randomUUID()` if the caller doesn't pass one), parses the response, and returns an `OperationResult` with success/failure and any payload the caller needs.

The team's own takeaway from this split: implementing the Spring annotation was easier than expected; managing budgets and tenants via API calls was harder than expected. That contrast is a useful signal for where the SDK has room to grow — pushing more of the admin surface into the starter would shorten the integration path. For now, the dual-layer pattern works, and it has a natural seam: declarative for the hot path, explicit for the management plane.

## Scope mapping today, and where it can grow

scalerX represents scopes internally as hierarchical strings. A local helper parses strings like `tenant:scalerx/workspace:abc-123` into the structured subject fields the Cycles protocol expects — the slash-delimited form is scalerX's addressing convention, not the wire format.

Here's the parser in scalerX's code:

```java
// CyclesBudgetManagementService.java
private void appendScopeSubjectParams(StringBuilder url, String scope) {
    for (String part : scope.split("/")) {
        if      (part.startsWith("tenant:"))    url.append("&tenant=").append(part.substring(7));
        else if (part.startsWith("workspace:")) url.append("&workspace=").append(part.substring(10));
        else if (part.startsWith("app:"))       url.append("&app=").append(part.substring(4));
        else if (part.startsWith("workflow:"))  url.append("&workflow=").append(part.substring(9));
        else if (part.startsWith("agent:"))     url.append("&agent=").append(part.substring(6));
        else if (part.startsWith("toolset:"))   url.append("&toolset=").append(part.substring(8));
    }
}
```

In production today, scalerX uses two of those six levels: `tenant` and `workspace`. There's one tenant — `scalerx` — and the tenant-level budget represents the platform's total spend cap. Each user gets a workspace, and the workspace-level budget is the user's personal allowance. When an LLM call lands, the reservation is placed against the user's workspace; that's the only enforcement boundary the platform currently uses.

The other four levels — `app`, `workflow`, `agent`, `toolset` — are scaffolding for later. The parser already handles them. The Cycles admin API already lets you fund and cap budgets at any level. What's missing is product surface area: scalerX hasn't yet shipped the kind of workflow-builder or agent-template feature that would benefit from per-workflow or per-agent caps. When they do, the integration shape doesn't have to change. The scope string gains a segment, the annotation reads a different SpEL expression, and the budget tree grows another level. No new SDK calls.

This is the part of the integration that paid off most relative to its effort. Choosing scope strings as the primary identifier — rather than, say, a flat budget ID — meant scalerX got a future-proof addressing scheme on day one.

## What the runtime flow actually looks like

scalerX described their flow in five steps: user makes a request, Cycles tries to make a reservation, the LLM call is executed, the reservation is committed, the user gets a response. That's the happy path.

Two reservation paths exist in their codebase. The hot LLM path runs through the `@Cycles` annotation, where the starter's interceptor builds the workspace-scoped subject from the SpEL expression and handles the reserve/commit/release transitions internally. A second path lives in `CyclesBudgetManagementService` for admin operations that don't fit a method-annotation shape — for example, programmatic reservations from background jobs, or wallet-side bookkeeping.

The decision-handling logic is the same in both paths. Here's the relevant block from the manual path, since it makes the response shape concrete:

```java
// CyclesBudgetManagementService.java — decision parsing inside createReservation
Map<String, Object> responseBody = Messages.parseJsonIntoMap(response);
String decision = (String) responseBody.get("decision");
String reservationId = (String) responseBody.get("reservation_id");

if ("ALLOW".equals(decision) || "ALLOW_WITH_CAPS".equals(decision)) {
    return new OperationResult(true, reservationId);
}

String denyReason = extractDenyReason(responseBody);
return new OperationResult(false, "Reservation denied: " + denyReason);
```

Three things in this path are worth pointing out:

**`synchronized` is a local guard, not the correctness boundary.** Both `createReservation` and `commitReservation` carry the `synchronized` modifier. That serializes calls within one JVM and reduces accidental same-process overlap, but the actual correctness boundary is the [Cycles server](/glossary#cycles-server)'s atomic reservation logic — multiple JVMs, pods, or threads across machines all rely on the server, not on Java synchronization. Worth knowing because `synchronized` on a Spring singleton can also serialize more than intended across tenants and workspaces; treat it as a conservative belt-and-braces in scalerX's wrapper, not a load-bearing primitive.

**`ALLOW` and `ALLOW_WITH_CAPS` are not the same green light.** Both can proceed, but `_WITH_CAPS` means *the reservation was approved under constraints* — e.g., a lower token cap, fewer steps, a cheaper model, or a restricted toolset compared to what was requested. The application has to apply the returned constraints; ignoring them weakens the control. scalerX's current usage doesn't generate caps in practice (the estimate is a flat 1 credit), but any platform that requests larger or variable estimates will see this branch and needs to honor what comes back.

**Deny reason comes from a structured field.** When the decision is anything else, the helper `extractDenyReason` pulls a `reason_code` out of `deny_detail`. The codes — `INSUFFICIENT_BALANCE`, `EXPIRED`, `RATE_LIMITED`, etc. — are stable strings the application can branch on. scalerX surfaces them to the user as friendly errors without round-tripping to a separate metadata service.

scalerX reports no meaningful latency overhead from the reserve/commit pair. That tracks with the architecture — the Cycles server runs in-cluster (or on the same Docker network locally), and the OpenAI Responses call dominates the request path by orders of magnitude.

## A deliberate choice: commit on failure

The annotation path follows the standard lifecycle: reserve before the call, commit on success, release if the protected method throws before the LLM has done billable work. That's the SDK default, and scalerX uses it as-is for the LLM step itself.

Where scalerX diverges is at the agent-run level — a settlement policy decision they made on top of the SDK lifecycle. When the LLM call has already executed and a downstream tool then fails, the agent run still consumes a credit. The platform commits the reservation rather than treating the run as cancelled.

The reasoning: every tool call in their agent runtime is preceded by an LLM call that decides which tool to use. That LLM call has happened, the model produced output, and the reasoning step incurred real cost — whether the eventual tool succeeds or fails. If scalerX rolled back the credit on tool failure, an attacker could craft requests that intentionally fail downstream — exhausting tools, returning malformed responses, looping until the model hallucinates an unsafe action — and run unlimited LLM reasoning calls for free.

Many platforms can default to release-on-failure. If you're calling a stateless LLM and the call returns an error before any [tokens](/glossary#tokens) are billed, letting the user retry without burning their budget is the right thing. scalerX's choice is correct *for their threat model* — a user-facing platform where the LLM reasoning step is the cost center and the abuse vector is intentional downstream failure. It's not the SDK default. We're flagging it because settlement policy is a product decision, not just an SDK toggle: who pays when a step in the middle of an agent run fails — the user, the platform, or no one?

There's no single right answer. But the question only becomes visible when you have something like Cycles in the path. Before this integration, "release on failure" wasn't even an option in scalerX's stack; the credits just got debited and the user got an error.

## What's not in yet

This is an early-stage integration. A few things are deliberately out of scope for v1, and they're worth naming so the post doesn't read as a finished product report.

**App-side idempotency keys are not used.** The Cycles SDK auto-generates a `UUID.randomUUID()` per call when no key is supplied. That's enough to make individual calls idempotent at the server, but it doesn't dedupe retries triggered by the calling application — if scalerX's request handler retries a failed HTTP request to its own service, two reservations get created with two different keys. The fix is to thread a stable request ID from the user-facing API into the Cycles call. It's a one-line change once scalerX decides what their stable request ID looks like.

**Tool-call gating is the next stab.** The annotation only sits on the OpenAI Responses entrypoint today. Tool-call protection is what scalerX is wiring in next — once tool integrations carry their own meaningful cost or risk (calling an enterprise CRM, sending email, hitting a paid third-party API), each will get either its own `@Cycles` annotation or a manual reservation around the tool dispatcher. The pattern is identical to the LLM case; only the placement changes.

**No exhaustion or concurrency tests yet.** The team has wired the integration but not yet load-tested budget exhaustion under concurrent users sharing a tenant cap. The Cycles server is designed for it (atomic reservations, deterministic deny reasons), and the synchronized client methods help on the Java side, but production-scale validation is still ahead. Same for failure-injection tests against the Cycles control plane.

**Granularity stops at workspace.** Per-workflow and per-agent caps would let scalerX answer questions like "how much did agent X cost this user this month?" — useful for usage analytics and for catching agents that misbehave on a single user's budget. The scope parser already supports it; product hasn't asked for it yet.

None of these block shipping. They're the next four levers, in roughly the order they'll matter.

## Takeaways for other Java teams

Three things from this integration that are worth carrying forward:

The Spring starter is the easy part. If your hot path is a small number of well-defined methods, `@Cycles` on each one is enough. scalerX's whole LLM-side integration is one file, twenty-two lines, one annotation. There's not a lot of design left to do at that layer — pick the SpEL expression for your scope, pick a unit, ship.

The admin API is the harder part — and it's where the integration shape is least settled. scalerX's `CyclesBudgetManagementService` is the kind of code multiple integrators have ended up writing: an HTTP wrapper around budget create/fund/lookup with each team's own conventions. That's a signal the SDK has room to absorb more of it.

Run the Cycles stack on Docker locally. scalerX's other "easier than expected" item, and the one most worth repeating: the full Cycles control plane runs on `docker compose up` for development. You don't need a hosted instance to start integrating, and your local stack matches production's API surface. Most of the questions an integrator has — *what does a deny response actually look like, what fields are in the commit response, does the dashboard show what I think it shows* — are best answered by hitting a real Cycles instance, not by reading docs.

For the platform team's day-to-day, the dashboard handles the parts of budget management that don't belong in code at all: creating tenants, seeding budgets, inspecting reservations, finding the last denial. That's what the team flagged as the easiest part to live with after the integration shipped.

## Related reading

- [26 integrations, every AI framework, one budget protocol](/blog/26-integrations-every-ai-framework-one-budget-protocol) — the breadth view across agent frameworks
- [Five lessons from building a production OpenClaw plugin](/blog/openclaw-plugin-lessons-learned) — the equivalent field report from a TypeScript plugin integration
- [LangGraph budget control for durable execution, retries, and fan-out](/blog/langgraph-budget-control-durable-execution-retries-fan-out) — what budget enforcement looks like in a graph runtime
- [Cycles Java Spring starter on Maven Central](https://central.sonatype.com/artifact/io.runcycles/cycles-client-java-spring) — the dependency used in this post
