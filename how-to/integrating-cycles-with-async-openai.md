---
title: "Integrate Cycles with async-openai (Rust)"
description: "Wrap async-openai chat completions with Cycles reserve-commit: budget gates before the request, real token usage on commit, streaming, error mapping."
head:
  - - meta
    - name: keywords
      content: "async-openai cycles, rust openai budget control, runcycles openai, rust llm reserve commit, async-openai streaming budget, openai rust cost tracking, anthropic-sdk-rs cycles"
---

# Integrate Cycles with async-openai (Rust)

The [Rust quickstart](/quickstart/getting-started-with-the-rust-client) and [Rust integration guide](/how-to/integrating-cycles-with-rust) both use a `call_llm()` placeholder where a real OpenAI call should go. This page fills that gap: it shows how `runcycles` composes with [`async-openai`](https://crates.io/crates/async-openai) (a widely used Rust client for the OpenAI API) for chat completions, streaming, and token-accurate commits.

The same lifecycle composes against other Rust LLM clients (Anthropic, Bedrock, local LLMs via Ollama) — the reserve-commit shape doesn't change. See the brief [Other Rust LLM clients](#other-rust-llm-clients) note at the bottom.

## What you get

- `with_cycles()` wrapping a real OpenAI call, with `prompt_tokens + completion_tokens` flowing through to the commit
- A `ReservationGuard` pattern for streaming chat completions where token counts are only known at the end of the stream
- Error-aware patterns using `ReservationGuard` that preserve typed `OpenAIError` for the caller (`with_cycles()` wraps closure errors as `Error::Validation` and loses the original type)
- Token-to-USD conversion at commit time for spend-denominated budgets

## Cargo.toml

```toml
[dependencies]
runcycles = "0.2"
async-openai = "0.30"          # check crates.io for the current version
tokio = { version = "1", features = ["full"] }
futures = "0.3"                # for stream consumption
```

`async-openai` major versions change occasionally. The shape of the API (chat completions, usage, streaming) has been stable for several minor releases; the type paths in this guide are accurate to the 0.30.x line at publication. If you pin a different version, the names below may need a small adjustment.

## The basic pattern: with_cycles + chat completions

```rust
use async_openai::{
    Client,
    types::{CreateChatCompletionRequestArgs, ChatCompletionRequestUserMessageArgs, Role},
};
use runcycles::{
    CyclesClient, with_cycles, WithCyclesConfig,
    models::{Amount, Subject, CyclesMetrics},
};

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    let cycles = CyclesClient::builder("cyc_live_...", "http://localhost:7878")
        .tenant("acme-corp")
        .build();
    let openai = Client::new();

    let prompt = "Summarize the runcycles crate in one sentence.";

    let reply = with_cycles(
        &cycles,
        WithCyclesConfig::new(Amount::tokens(1_500))
            .action("llm.completion", "gpt-4o-mini")
            .subject(Subject {
                tenant: Some("acme-corp".into()),
                ..Default::default()
            }),
        |_ctx| async move {
            let request = CreateChatCompletionRequestArgs::default()
                .model("gpt-4o-mini")
                .max_tokens(800u32)
                .messages([ChatCompletionRequestUserMessageArgs::default()
                    .content(prompt)
                    .build()?
                    .into()])
                .build()?;

            let response = openai.chat().create(request).await?;

            let text = response
                .choices
                .first()
                .and_then(|c| c.message.content.clone())
                .unwrap_or_default();

            // usage is `Option<CompletionUsage>`; treat missing as zero
            let actual = response
                .usage
                .map(|u| u.total_tokens as i64)
                .unwrap_or(0);

            Ok((text, Amount::tokens(actual)))
        },
    )
    .await?;

    println!("{reply}");
    Ok(())
}
```

### What's happening

| Step | What runs | What is recorded |
|---|---|---|
| Before the closure | Cycles reserves `1_500` [tokens](/glossary#token) against the request subject | Reservation created, decision evaluated |
| Inside the closure | `openai.chat().create(request)` issues the actual API call | OpenAI bills your account for the real usage |
| Return value | `(text, Amount::tokens(actual_total))` | The actual `total_tokens` becomes the commit amount |
| After the closure | Cycles commits `actual` tokens, releases the unused reservation | Final spend recorded; the reservation lifecycle closes |

If `openai.chat().create()` returns `Err`, the closure returns `Err` and the reservation is released — no commit, no false spend record.

## Capping max_tokens from `ALLOW_WITH_CAPS`

When Cycles returns `ALLOW_WITH_CAPS`, the `GuardContext` carries the server's cap suggestions. Apply them to the OpenAI request before issuing it:

```rust
let reply = with_cycles(
    &cycles,
    WithCyclesConfig::new(Amount::tokens(1_500))
        .action("llm.completion", "gpt-4o-mini")
        .subject(Subject { tenant: Some("acme-corp".into()), ..Default::default() }),
    |ctx| async move {
        // Default ceiling; override if Cycles capped lower
        let mut max_tokens: u32 = 800;
        if let Some(caps) = &ctx.caps {
            if let Some(cap) = caps.max_tokens {
                max_tokens = (cap as u32).min(max_tokens);
            }
        }

        let request = CreateChatCompletionRequestArgs::default()
            .model("gpt-4o-mini")
            .max_tokens(max_tokens)
            .messages([ChatCompletionRequestUserMessageArgs::default()
                .content(prompt)
                .build()?
                .into()])
            .build()?;

        let response = openai.chat().create(request).await?;
        let actual = response.usage.map(|u| u.total_tokens as i64).unwrap_or(0);
        let text = response.choices.first().and_then(|c| c.message.content.clone()).unwrap_or_default();
        Ok((text, Amount::tokens(actual)))
    },
).await?;
```

`caps.tool_allowlist` and `caps.tool_denylist` follow the same shape — if you wire OpenAI's function-calling tools, use those caps to filter your tool list before passing it to the request builder. See [Caps and the Three-Way Decision Model](/protocol/caps-and-the-three-way-decision-model-in-cycles) for the full cap surface.

## Streaming: ReservationGuard with stream consumption

Streaming chat completions return tokens one chunk at a time. The total token count is only known after the stream ends, which means `with_cycles()` (which expects the closure to return both the value and the actual cost in one go) is not the right primitive. Use a `ReservationGuard` instead.

OpenAI's streaming endpoint emits a final `usage` chunk only when `stream_options.include_usage` is set on the request. Set it explicitly:

```rust
use async_openai::{
    Client,
    types::{
        CreateChatCompletionRequestArgs,
        ChatCompletionRequestUserMessageArgs,
        ChatCompletionStreamOptions,
    },
};
use futures::StreamExt;
use runcycles::{
    CyclesClient,
    models::{
        Amount, Subject, Action, ReservationCreateRequest, CommitRequest, CyclesMetrics,
    },
};

let openai = Client::new();

let guard = cycles.reserve(
    ReservationCreateRequest::builder()
        .subject(Subject { tenant: Some("acme-corp".into()), ..Default::default() })
        .action(Action::new("llm.completion", "gpt-4o-mini"))
        .estimate(Amount::tokens(2_000))
        .ttl_ms(60_000_u64)
        .build()
).await?;

// Apply caps before building the request
let mut max_tokens: u32 = 1_500;
if let Some(caps) = guard.caps() {
    if let Some(cap) = caps.max_tokens {
        max_tokens = (cap as u32).min(max_tokens);
    }
}

let request = CreateChatCompletionRequestArgs::default()
    .model("gpt-4o-mini")
    .max_tokens(max_tokens)
    .messages([ChatCompletionRequestUserMessageArgs::default()
        .content(prompt)
        .build()?
        .into()])
    .stream(true)
    // Required for the stream to emit a final usage chunk.
    .stream_options(ChatCompletionStreamOptions { include_usage: true })
    .build()?;

let mut stream = openai.chat().create_stream(request).await?;

let mut full_text = String::new();
let mut final_usage_tokens: i64 = 0;

while let Some(chunk_result) = stream.next().await {
    let chunk = chunk_result?;
    for choice in chunk.choices {
        if let Some(content) = choice.delta.content {
            full_text.push_str(&content);
        }
    }
    // The final chunk carries usage when include_usage was set.
    if let Some(usage) = chunk.usage {
        final_usage_tokens = usage.total_tokens as i64;
    }
}

// Defensive fallback: if usage didn't arrive (some OpenAI-compatible
// providers don't honor include_usage), estimate locally.
if final_usage_tokens == 0 {
    final_usage_tokens = estimate_tokens_with_tiktoken(&prompt, &full_text);
}

guard.commit(
    CommitRequest::builder()
        .actual(Amount::tokens(final_usage_tokens))
        .metrics(CyclesMetrics {
            tokens_output: Some(final_usage_tokens),
            ..Default::default()
        })
        .build()
).await?;
```

### Why the guard, not `with_cycles`

`with_cycles()` evaluates the closure to a `(value, actual_cost)` tuple in one synchronous return. Streaming requires you to drive the stream to completion (which can take seconds), then commit the total. The guard exposes that lifecycle as two explicit steps — reserve before the stream begins, commit after it ends.

If the stream errors midway (network failure, rate limit, content policy violation), call `guard.release(...).await?` — the reservation is returned to the pool with a reason code. The guard's `Drop` implementation provides best-effort release on panic / early `?` return, but explicit release with a reason code is preferred for clean audit records.

## Error handling: preserving the OpenAI error type

`async-openai` returns `OpenAIError`; Cycles returns `runcycles::Error`. Callers usually want to act on these differently:

- **OpenAI errors** — rate-limit retries with backoff, model fallback (gpt-4o → gpt-4o-mini), prompt resubmission.
- **Cycles errors** — [graceful degradation](/glossary#graceful-degradation) to a smaller model, deferred response, "budget exhausted" UX.

`with_cycles()` is *not* the right primitive for error-aware flows. Its closure must return `Result<(T, Amount), Box<dyn std::error::Error + Send + Sync>>`, and any closure error is wrapped as `runcycles::Error::Validation(format!("guarded function failed: {e}"))`. The original typed error is stringified into the message and lost — the caller cannot recover it.

For flows that need to act on the typed `OpenAIError`, use `ReservationGuard` and keep the error visible to the caller:

```rust
use async_openai::{
    Client,
    error::OpenAIError,
    types::{CreateChatCompletionRequestArgs, ChatCompletionRequestUserMessageArgs},
};
use runcycles::{
    CyclesClient, Error as CyclesError,
    models::{
        Amount, Subject, Action, ReservationCreateRequest, CommitRequest, ReleaseRequest,
    },
};

#[derive(Debug, thiserror::Error)]
enum CompletionError {
    #[error(transparent)] OpenAi(#[from] OpenAIError),
    #[error(transparent)] Cycles(#[from] CyclesError),
}

async fn run_completion(
    cycles: &CyclesClient,
    openai: &Client<async_openai::config::OpenAIConfig>,
    prompt: &str,
) -> Result<String, CompletionError> {
    let guard = cycles.reserve(
        ReservationCreateRequest::builder()
            .subject(Subject { tenant: Some("acme-corp".into()), ..Default::default() })
            .action(Action::new("llm.completion", "gpt-4o-mini"))
            .estimate(Amount::tokens(1_500))
            .build()
    ).await?;

    let request = CreateChatCompletionRequestArgs::default()
        .model("gpt-4o-mini")
        .max_tokens(800u32)
        .messages([ChatCompletionRequestUserMessageArgs::default()
            .content(prompt)
            .build()?
            .into()])
        .build()?;

    let response = match openai.chat().create(request).await {
        Ok(r) => r,
        Err(e) => {
            // Release the reservation with a reason; preserve the typed OpenAI error
            let _ = guard.release(
                ReleaseRequest::new(Some(format!("openai_error: {e}")))
            ).await;
            return Err(e.into()); // OpenAIError flows to the caller
        }
    };

    let text = response.choices.first()
        .and_then(|c| c.message.content.clone())
        .unwrap_or_default();
    let actual = response.usage.map(|u| u.total_tokens as i64).unwrap_or(0);

    guard.commit(
        CommitRequest::builder()
            .actual(Amount::tokens(actual))
            .build()
    ).await?;

    Ok(text)
}
```

At the call site, the typed branches are now available:

```rust
match run_completion(&cycles, &openai, prompt).await {
    Ok(text) => println!("{text}"),
    Err(CompletionError::OpenAi(_e)) => {
        // backoff / retry / fallback model
    }
    Err(CompletionError::Cycles(CyclesError::BudgetExceeded { retry_after, .. })) => {
        // graceful degradation — defer, downsize model, return cached response
        let _ = retry_after;
    }
    Err(CompletionError::Cycles(other)) => {
        // log and surface
        eprintln!("cycles error: {other}");
    }
}
```

Use `with_cycles()` when the caller doesn't need to distinguish the underlying error type — for fire-and-forget background tasks, scripts, or higher-level orchestrators that uniformly retry on any failure. Switch to `ReservationGuard` whenever the caller needs to branch on the actual error.

The Cycles error types and their convenience methods (`is_retryable`, `is_budget_exceeded`, `retry_after`) are covered in [Error Handling in Rust](/how-to/error-handling-patterns-in-rust).

## Token-to-USD: when your budget is denominated in dollars, not tokens

If the budget unit is `USD_MICROCENTS` rather than `TOKENS`, convert from the response usage at commit time:

```rust
fn tokens_to_microcents(prompt_tokens: u32, completion_tokens: u32, model: &str) -> u64 {
    // Rates expressed as microcents per million tokens (1 cent = 10_000 microcents).
    // The numbers below illustrate; pin yours to the provider's current pricing
    // page and bump them as a release task — model rates change.
    let (input_per_million_microcents, output_per_million_microcents) = match model {
        "gpt-4o-mini" => (1_500_000, 6_000_000),   // illustrative
        "gpt-4o"      => (2_500_000, 10_000_000),  // illustrative
        _             => (1_500_000, 6_000_000),
    };
    let input  = (prompt_tokens as u64)     * input_per_million_microcents  / 1_000_000;
    let output = (completion_tokens as u64) * output_per_million_microcents / 1_000_000;
    input + output
}

// Inside the with_cycles closure:
let usage = response.usage.unwrap_or_default();
let microcents = tokens_to_microcents(usage.prompt_tokens, usage.completion_tokens, "gpt-4o-mini");
Ok((text, Amount::usd_microcents(microcents as i64)))
```

Keeping the rate table in one helper makes provider rate changes a single-edit fix. For multi-provider deployments, hoist it to your shared `costs` module.

For the canonical breakdown of provider rates and the cost-estimation patterns used elsewhere in the corpus, see [Cost Estimation Cheat Sheet](/how-to/cost-estimation-cheat-sheet).

## Other Rust LLM clients

The reserve-commit shape is the same for any Rust LLM client. The four things you need to adapt to a new provider:

1. **The request builder type** — `CreateChatCompletionRequestArgs` for async-openai, `MessageCreateBuilder` / `MessageCreateParams` for Anthropic's `anthropic-sdk-rust`, the provider-specific equivalent elsewhere.
2. **The call method** — `client.chat().create(req)` for async-openai; consult the provider crate's docs for the equivalent.
3. **The response usage extraction** — `response.usage.map(|u| u.total_tokens as i64)` for async-openai; Anthropic returns `input_tokens` + `output_tokens` separately on its response usage object; check the crate.
4. **The model name in the action label** — `.action("llm.completion", "claude-3-5-sonnet-20241022")` rather than `"gpt-4o-mini"`.

Pin to the specific crate version you're using and verify each of those four points against its current docs before copy-pasting. The Rust Anthropic ecosystem in particular has churn across crate names and major versions; the reserve-commit lifecycle is unchanged, but the provider-side type paths are not portable.

The [`Error Handling in Rust`](/how-to/error-handling-patterns-in-rust) patterns apply to all providers — the typed `OpenAIError` branch above becomes a typed `AnthropicError` (or equivalent) branch for the other crate.

## Common gotchas

1. **Streaming without `include_usage` reports zero tokens.** OpenAI's official streaming endpoint emits usage only when `stream_options.include_usage = true` is set on the request. Without it, you'll commit zero tokens and the budget will not reflect actual spend. Set the option, or fall back to a tokenizer estimate.

2. **`response.usage` is `Option`.** Some compatible servers (Ollama, vLLM, certain LiteLLM configs) don't return usage. Treat `None` as "estimate it locally" rather than "no spend."

3. **`response.choices[0].message.content` can be `None`** when the model returns a tool-call or refusal. Handle the `None` case (commit zero or commit the prompt-token cost only) rather than unwrapping.

4. **Don't include the OpenAI API key in the Cycles reservation metadata.** Cycles records actions, not credentials. If you're tagging the reservation with provider info, use the action name (`gpt-4o-mini`) — never the key.

5. **Mismatched async runtimes.** `async-openai` uses `tokio`; the blocking `runcycles` variant requires not being inside a Tokio runtime. Pick one — for most LLM workloads, the async client is correct.

## Next steps

- [Rust Client Quickstart](/quickstart/getting-started-with-the-rust-client) — the lifecycle this page composes against
- [Integrating Cycles with Rust](/how-to/integrating-cycles-with-rust) — broader integration patterns (multi-step, framework middleware)
- [Error Handling in Rust](/how-to/error-handling-patterns-in-rust) — retry, backoff, graceful degradation
- [Rust Client Configuration Reference](/configuration/rust-client-configuration-reference) — full config surface
- [Cost Estimation Cheat Sheet](/how-to/cost-estimation-cheat-sheet) — token-to-dollar mapping across providers
- [How Reserve-Commit Works](/protocol/how-reserve-commit-works-in-cycles) — the underlying lifecycle
