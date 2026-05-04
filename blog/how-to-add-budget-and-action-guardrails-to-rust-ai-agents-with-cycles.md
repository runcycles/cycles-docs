---
title: "How to Add Budget and Action Guardrails to Rust AI Agents with Cycles"
date: 2026-03-31
author: Albert Mavashev
tags: [rust, agents, engineering, costs, governance, guide]
description: "Add budget and action authority to Rust AI agents — control spend, tool access, token limits, and step counts with compile-time safety."
blog: true
sidebar: false
featured: false
---

# How to Add Budget and Action Guardrails to Rust AI Agents with Cycles

A retry loop on a Rust agent service hit a transient 503 from the LLM provider. The exponential backoff reset. The loop retried — with a fresh prompt each time. Three minutes and 47 retries later, the team got a $200 invoice for a single user request. The function worked exactly as designed. The budget was the thing nobody designed.

<!-- more -->

This is the gap that Cycles fills. It's not just a billing meter — it's a **[runtime authority](/glossary#runtime-authority)** for both **budget** and **action control**. Before an agent calls an LLM, Cycles answers two questions:

1. **Budget:** Does this agent have enough budget for this operation?
2. **Action:** Is this agent *allowed* to take this action right now? (Which tools? How many [tokens](/glossary#tokens)? How many steps remaining? Is there a cooldown?)

The server returns either ALLOW, ALLOW_WITH_CAPS (proceed but with constraints), or DENY — and the client enforces it before the expensive call happens.

The `runcycles` crate brings this to Rust with an API designed around ownership semantics and compile-time safety. This post shows how to integrate it into existing Rust agent code at three levels of control.

## Why Rust for agent runtimes

Rust is increasingly the choice for production agent infrastructure: inference servers (vLLM alternatives), tool execution sandboxes, orchestration layers, and edge deployments via WASM. The reasons are familiar — zero-cost abstractions, memory safety without GC pauses, and `Send + Sync` guarantees for concurrent workloads.

But until now, Rust had no budget enforcement library for agent runtimes. Python had the `@cycles` decorator. TypeScript had `withCycles`. Java had the `@Cycles` Spring annotation. Rust agents ran unguarded.

The `runcycles` crate closes this gap with an API that leverages Rust's type system to provide guarantees the other languages can't:

- **`commit(self)` consumes the guard** — double-commit is a compile error, not a runtime check
- **`#[must_use]`** — the compiler warns if you forget to handle a [reservation](/glossary#reservation)
- **`Drop` safety** — an unfinalized guard auto-releases budget via `tokio::spawn`
- **Newtype IDs** — `ReservationId` and `IdempotencyKey` can't be mixed up

## Three integration levels

The crate provides three ways to add budget enforcement, depending on how much control you need:

| Level | API | When to use | Lifecycle |
|-------|-----|------------|-----------|
| **Automatic** | `with_cycles()` | Simple LLM calls, tool invocations | Reserve → execute closure → auto-commit or auto-release |
| **Manual** | `ReservationGuard` | Streaming, multi-step workflows, conditional commits | Reserve → your code → explicit commit or release |
| **Low-level** | `CyclesClient` methods | Cross-process reservations, custom lifecycles | You call each endpoint directly |

All three share the same underlying protocol: reserve budget before the operation, commit actual spend after, release on failure.

## Example 1: Automatic lifecycle with `with_cycles()`

Suppose you have an existing async function that calls an LLM:

```rust
async fn call_llm(prompt: &str, max_tokens: i64) -> Result<String, Box<dyn std::error::Error + Send + Sync>> {
    // Your existing LLM call — OpenAI, Anthropic, local model, etc.
    Ok("LLM response here".to_string())
}
```

Adding budget enforcement is one wrapper:

```rust
use runcycles::{CyclesClient, with_cycles, WithCyclesConfig, models::*};

let client = CyclesClient::builder("cyc_live_...", "http://localhost:7878")
    .tenant("acme-corp")
    .build();

let reply = with_cycles(
    &client,
    WithCyclesConfig::new(Amount::tokens(1000))
        .action("llm.completion", "gpt-4o")
        .subject(Subject { tenant: Some("acme-corp".into()), ..Default::default() }),
    |ctx| async move {
        let response = call_llm("Summarize this document", 1000).await?;
        Ok((response, Amount::tokens(420)))
    },
).await?;
```

What happens under the hood:

1. `with_cycles` reserves 1000 tokens on the [Cycles server](/glossary#cycles-server)
2. If the budget is exhausted, it returns `Err(Error::BudgetExceeded)` — the closure never runs
3. If allowed, the closure executes your LLM call
4. On success, it commits 420 tokens (the actual usage)
5. On error, it releases the reservation — budget is returned to the pool
6. A background heartbeat extends the reservation TTL while the closure runs

The closure receives a `GuardContext` with the budget decision and any caps:

```rust
|ctx| async move {
    if let Some(caps) = &ctx.caps {
        // Budget policy says: use at most this many tokens
        let safe_max = caps.max_tokens.unwrap_or(1000);
        let response = call_llm("Summarize", safe_max).await?;
        Ok((response, Amount::tokens(safe_max)))
    } else {
        let response = call_llm("Summarize", 1000).await?;
        Ok((response, Amount::tokens(420)))
    }
}
```

## Example 2: Streaming with the RAII guard

For LLM streaming — where actual token count is only known after the stream finishes — use the `ReservationGuard`:

```rust
use runcycles::{CyclesClient, models::*};

let guard = client.reserve(
    ReservationCreateRequest::builder()
        .subject(Subject { tenant: Some("acme-corp".into()), ..Default::default() })
        .action(Action::new("llm.completion", "gpt-4o"))
        .estimate(Amount::tokens(2000))
        .ttl_ms(30_000_u64)
        .build()
).await?;

// Start streaming — actual cost unknown until stream completes
let mut total_input = 0i64;
let mut total_output = 0i64;

let stream = start_llm_stream("Write a detailed analysis").await;
while let Some(chunk) = stream.next().await {
    total_output += chunk.token_count;
    print!("{}", chunk.text);
}
total_input = 150; // from prompt tokenization

// Stream complete — now commit the actual usage
guard.commit(
    CommitRequest::builder()
        .actual(Amount::tokens(total_input + total_output))
        .metrics(CyclesMetrics {
            tokens_input: Some(total_input),
            tokens_output: Some(total_output),
            model_version: Some("gpt-4o-2024-05".into()),
            ..Default::default()
        })
        .build()
).await?;
```

Key safety properties:

- The guard starts a background heartbeat that extends the reservation TTL at half the TTL interval — your stream won't expire mid-response
- `guard.commit(self)` takes ownership — you can't accidentally commit twice (it's a compile error)
- If a panic occurs and the guard is dropped, `Drop` spawns a best-effort release so budget isn't leaked

## Example 3: Multi-agent workflows

When a parent agent delegates to child agents, each can have its own budget scope using the `Subject` hierarchy:

```rust
// Parent agent reserves for the overall workflow
let parent_guard = client.reserve(
    ReservationCreateRequest::builder()
        .subject(Subject {
            tenant: Some("acme-corp".into()),
            workflow: Some("research-report".into()),
            agent: Some("orchestrator".into()),
            ..Default::default()
        })
        .action(Action::new("workflow.orchestrate", "research-v2"))
        .estimate(Amount::tokens(50_000))
        .build()
).await?;

// Child agent 1: search
let search_result = with_cycles(
    &client,
    WithCyclesConfig::new(Amount::tokens(5000))
        .action("tool.search", "web_search")
        .subject(Subject {
            tenant: Some("acme-corp".into()),
            workflow: Some("research-report".into()),
            agent: Some("searcher".into()),
            ..Default::default()
        }),
    |_ctx| async move {
        let results = web_search("AI agent cost management").await?;
        Ok((results, Amount::tokens(200)))
    },
).await?;

// Child agent 2: synthesize
let report = with_cycles(
    &client,
    WithCyclesConfig::new(Amount::tokens(20_000))
        .action("llm.completion", "gpt-4o")
        .subject(Subject {
            tenant: Some("acme-corp".into()),
            workflow: Some("research-report".into()),
            agent: Some("writer".into()),
            ..Default::default()
        }),
    |_ctx| async move {
        let report = call_llm(&format!("Write a report based on: {search_result}"), 4000).await?;
        Ok((report, Amount::tokens(4200)))
    },
).await?;

parent_guard.commit(
    CommitRequest::builder().actual(Amount::tokens(4400)).build()
).await?;
```

The Cycles server tracks budget at every level of the hierarchy — `tenant → workflow → agent` — so you get visibility into which agents consume the most budget.

## What happens when budget runs out

Rust's `match` makes budget denial handling explicit:

```rust
use runcycles::Error;

match with_cycles(&client, config, |ctx| async move {
    let result = call_llm("Hello", 500).await?;
    Ok((result, Amount::tokens(500)))
}).await {
    Ok(response) => {
        println!("Success: {response}");
    }
    Err(Error::BudgetExceeded { message, retry_after, .. }) => {
        // Budget exhausted — graceful degradation
        println!("Budget exceeded: {message}");
        if let Some(delay) = retry_after {
            // Server suggests when budget may be available
            tokio::time::sleep(delay).await;
        }
        // Fall back to cached response, smaller model, or user message
    }
    Err(Error::Transport(e)) => {
        // Network error — Cycles server unreachable
        // Decision: fail open (skip budget check) or fail closed (deny)?
        println!("Cycles server unavailable: {e}");
    }
    Err(e) => {
        println!("Other error: {e}");
    }
}
```

The error type is an enum, not an exception hierarchy — you get exhaustive matching for free.

## Action authority: caps, tool control, and step limits

Budget is only half the story. Cycles also governs **what an agent can do** through caps — runtime constraints returned alongside the budget decision. When the server returns `ALLOW_WITH_CAPS`, it's saying: "you have budget, but here are the rules."

Caps include:

| Cap | What it controls | Example |
|-----|-----------------|---------|
| `max_tokens` | Maximum tokens for this operation | Reduce from 4000 → 500 as budget runs low |
| `max_steps_remaining` | How many more agent steps are allowed | Prevent infinite tool-call loops |
| `tool_allowlist` | Only these tools may be used | `["web_search"]` — block code execution |
| `tool_denylist` | These tools are blocked | `["shell_exec", "file_write"]` — safety guardrails |
| `cooldown_ms` | Minimum wait before next action | Rate-limit an aggressive agent |

Here's how to build a caps-aware agent in Rust:

```rust
let reply = with_cycles(
    &client,
    WithCyclesConfig::new(Amount::tokens(4000))
        .action("llm.completion", "gpt-4o")
        .subject(Subject {
            tenant: Some("acme-corp".into()),
            agent: Some("research-bot".into()),
            ..Default::default()
        }),
    |ctx| async move {
        let mut max_tokens: i64 = 4000;
        let mut use_web_search = true;

        // Respect action authority constraints
        if let Some(caps) = &ctx.caps {
            // Token limit — reduce output length as budget gets low
            if let Some(cap) = caps.max_tokens {
                max_tokens = cap.min(max_tokens);
            }

            // Tool restrictions — policy blocks certain capabilities
            if !caps.is_tool_allowed("web_search") {
                use_web_search = false; // fall back to cached data
            }

            // Step limit — agent is near its operation count ceiling
            if let Some(steps) = caps.max_steps_remaining {
                if steps <= 1 {
                    // Last allowed step — skip optional work, just summarize
                    max_tokens = max_tokens.min(500);
                }
            }

            // Cooldown — wait before proceeding
            if let Some(cooldown) = caps.cooldown_ms {
                tokio::time::sleep(std::time::Duration::from_millis(cooldown as u64)).await;
            }
        }

        let context = if use_web_search {
            web_search("latest findings").await?
        } else {
            "Using cached context".to_string()
        };

        let response = call_llm(&context, max_tokens).await?;
        Ok((response, Amount::tokens(max_tokens)))
    },
).await?;
```

This is the difference between a budget meter and a runtime authority. A meter tells you what happened. Cycles tells the agent what it's *allowed to do* — before it acts.

## Shadow mode: deploy without risk

Before enforcing budget limits in production, deploy in shadow mode using `dry_run`:

```rust
let resp = client.create_reservation(
    &ReservationCreateRequest::builder()
        .subject(Subject { tenant: Some("acme-corp".into()), ..Default::default() })
        .action(Action::new("llm.completion", "gpt-4o"))
        .estimate(Amount::tokens(1000))
        .dry_run(true)  // evaluate but don't reserve
        .build()
).await?;

// Decision tells you what WOULD happen
match resp.decision {
    Decision::Allow => log::info!("Would allow"),
    Decision::AllowWithCaps => log::info!("Would allow with caps: {:?}", resp.caps),
    Decision::Deny => log::warn!("Would DENY — budget exceeded"),
    _ => {}
}
// No budget was actually consumed — your LLM call proceeds normally
```

**Recommended rollout:**

1. **Week 1:** Deploy with `dry_run: true`. Log decisions. Tune budget allocations.
2. **Week 2:** Enable enforcement with `overage_policy: AllowIfAvailable`. Charges proceed but tracks overages.
3. **Week 3:** Switch to `overage_policy: Reject` for hard limits on non-critical paths.
4. **Week 4:** Enable `Reject` on all paths. Monitor `BudgetExceeded` error rates.

## Rust vs Python vs TypeScript

| Feature | Rust (`runcycles`) | Python (`runcycles`) | TypeScript (`runcycles`) |
|---------|-------------------|---------------------|-------------------------|
| **Lifecycle wrapper** | `with_cycles()` | `@cycles` decorator | `withCycles()` HOF |
| **Manual control** | `ReservationGuard` (RAII) | `CyclesClient` methods | `reserveForStream()` handle |
| **Double-commit prevention** | Compile error (`self` consumed) | Runtime check | Runtime check (`finalized` flag) |
| **Forgotten reservation** | Compiler warning (`#[must_use]`) | Silent (GC cleans up) | Silent (GC cleans up) |
| **Drop cleanup** | Best-effort release via `tokio::spawn` | N/A | N/A |
| **Context access** | `GuardContext` (owned, no lifetimes) | `get_cycles_context()` (contextvars) | `getCyclesContext()` (AsyncLocalStorage) |
| **Async** | Native async/await | sync + async variants | async only |
| **Zero dependencies** | No (reqwest, serde, tokio) | No (httpx, pydantic) | Yes (built-in fetch) |
| **Wire format** | serde (zero mapper code) | Pydantic models | Manual mappers (380 lines) |

The Rust client's unique advantage is **compile-time lifecycle safety** — the type system prevents the most common integration bugs (double-commit, forgotten reservation, ID mixup) at build time rather than runtime.

## Get started

Add to your project:

```bash
cargo add runcycles
```

You'll need a running Cycles server with a [tenant](/glossary#tenant) and API key. The [End-to-End Tutorial](/quickstart/end-to-end-tutorial) sets up everything in under 5 minutes, or jump straight to the Rust-specific guide:

- [Getting Started with the Rust Client](/quickstart/getting-started-with-the-rust-client) — installation through advanced patterns
- [How Reserve/Commit Works](/protocol/how-reserve-commit-works-in-cycles) — the protocol lifecycle in detail
- [GitHub: runcycles/cycles-client-rust](https://github.com/runcycles/cycles-client-rust) — source, examples, AUDIT.md
- [Error Handling Patterns](/how-to/error-handling-patterns-in-cycles-client-code) — [graceful degradation](/glossary#graceful-degradation) strategies

## Related how-to guides

- [Shadow Mode rollout](/how-to/shadow-mode-in-cycles-how-to-roll-out-budget-enforcement-without-breaking-production)
- [Handling streaming responses](/how-to/handling-streaming-responses-with-cycles)
- [API key management](/how-to/api-key-management-in-cycles)
