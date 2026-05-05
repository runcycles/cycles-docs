---
title: "Add Cycles with Claude, Codex, Cursor, or Windsurf"
description: "One canonical recipe for AI coding assistants to wire Cycles budget enforcement into an existing agent codebase. Copy-paste prompt, do/don't contract, definition of done, wrong/right examples, success test."
---

# Add Cycles with Claude, Codex, Cursor, or Windsurf

This page is for engineers who want their AI coding assistant to integrate Cycles into an existing codebase. Open Claude Code (or Codex, Cursor, Windsurf) in your repo, paste the prompt below, and let it wire one budget-enforced boundary, with a test that proves enforcement, in a single session.

::: tip If you only need MCP host setup
For Claude Desktop / Claude Code / Cursor / Windsurf MCP server config, see the per-host quickstarts: [Claude Desktop](/quickstart/mcp-claude-desktop) · [Claude Code](/quickstart/mcp-claude-code) · [Cursor](/quickstart/mcp-cursor) · [Windsurf](/quickstart/mcp-windsurf). MCP gives the assistant access to Cycles tools — it does not by itself enforce budgets in your application's execution path. See [MCP vs enforcement](#mcp-availability-is-not-enforcement) below.
:::

## The integration contract

Hand this contract to the assistant. It is the do/don't list that turns "integrate Cycles" from an open-ended task into a bounded one.

```md
You are integrating Cycles into an existing agent codebase.

Goal:
Add pre-execution budget/action enforcement around one LLM call or tool call.
Prove enforcement with a test, then expand.

Do:
1. Identify model calls and external side-effect tool calls in this repo.
2. Pick ONE boundary to wrap first. Highest cost or highest frequency wins.
3. Use the language-specific client:
   - Python:        `runcycles` package, `@cycles` decorator
   - TypeScript:    `runcycles` package, `withCycles` HOF
   - Java/Spring:   `cycles-client-java-spring`, `@Cycles` annotation
   - Rust:          `runcycles` crate, `with_cycles()` (auto) or
                    `ReservationGuard` (manual / streaming)
4. Read configuration from environment:
   - CYCLES_BASE_URL   (e.g. http://localhost:7878)
   - CYCLES_API_KEY    (cyc_live_... — issued by the Cycles Admin Server)
   - CYCLES_TENANT     (e.g. acme-corp)
5. Add a graceful denial fallback: when budget is denied, do NOT execute the
   downstream call. Return a fallback, downgrade to a cheaper model, or queue.
6. Add ONE test that proves the downstream call is not invoked when Cycles
   denies. Mock the model client; assert it received zero calls on DENY.

Do not:
- Rely on prompts as enforcement.
- Add only logging without a deny path.
- Place the Cycles check after the downstream call.
- Treat MCP tool availability as hard enforcement. The MCP server exposes
  Cycles tools to the assistant; it does not gate the application's own
  execution path. Production enforcement belongs in the SDK wrapper or
  gateway, not in the host's tool list.
- Invent new patterns. Use the decorator / HOF / annotation as documented.
- Wrap more than one boundary in the first pass. Ship one, test it, then
  expand.

Success test:
- One LLM (or external tool) call wrapped with the language-appropriate
  Cycles primitive.
- Env vars read via `CyclesConfig.from_env()` / `CyclesConfig.fromEnv()` /
  Spring properties.
- One test asserting the downstream client is not called on budget denial.
- The change is a small diff: <50 lines of production code plus the test.
```

## Definition of done

The integration is complete when **all** of these are true. This is the checklist Claude/Codex should optimize toward — and that you should grade the diff against before merging.

- [ ] At least one LLM or external tool call is wrapped with the Cycles primitive.
- [ ] The Cycles `reserve` (or decorator/HOF/annotation entry) runs **before** the downstream call.
- [ ] On `DENY`, the downstream call is **skipped** entirely. No model API request fires.
- [ ] On success, **actual usage is committed** (not just the original estimate).
- [ ] On thrown exception, the reservation is **released** so budget returns to the pool.
- [ ] One test mocks the downstream client and asserts it received zero calls on DENY.
- [ ] `CYCLES_BASE_URL`, `CYCLES_API_KEY`, `CYCLES_TENANT` are read from env, not hardcoded.

If any item is unchecked, the integration is not done — even if the happy path runs.

## Copy this prompt into your assistant

Paste this verbatim into Claude Code, Codex, Cursor, or Windsurf at the root of your repo:

```md
Integrate Cycles into this repo.

First inspect the codebase and identify:
- all LLM calls (OpenAI, Anthropic, Bedrock, Gemini, Groq, Ollama, etc.)
- all tool calls with external cost or real-world side effects
- tenant / user / run identifiers already available in request context

Then implement the smallest safe integration:
- wrap ONE LLM call with Cycles
- reserve budget before execution
- commit actual usage after execution
- release on failure
- deny BEFORE the downstream call when the budget is exhausted
- read CYCLES_BASE_URL, CYCLES_API_KEY, CYCLES_TENANT from environment
- add ONE test proving the downstream call is not made on DENY

Follow the integration contract and constraints from:
https://runcycles.io/how-to/add-cycles-with-claude-or-codex

Use the official docs:
- Quickstart:                https://runcycles.io/quickstart/end-to-end-tutorial
- Existing-app integration:  https://runcycles.io/how-to/adding-cycles-to-an-existing-application
- Python client:             https://runcycles.io/quickstart/getting-started-with-the-python-client
- TypeScript client:         https://runcycles.io/quickstart/getting-started-with-the-typescript-client
- Spring Boot starter:       https://runcycles.io/quickstart/getting-started-with-the-cycles-spring-boot-starter
- Rust client:               https://runcycles.io/quickstart/getting-started-with-the-rust-client
- Error handling (Python):   https://runcycles.io/how-to/error-handling-patterns-in-python
- Error handling (TS):       https://runcycles.io/how-to/error-handling-patterns-in-typescript
- Error handling (Rust):     https://runcycles.io/how-to/error-handling-patterns-in-rust

Pick the language guide that matches this repo. Do NOT wrap more than one
boundary in this pass. Stop and report when the test passes.
```

The full machine-readable index is at [`/llms.txt`](/llms.txt) — most assistants can fetch it to discover the rest of the documentation.

## Drop-in AGENTS.md / CLAUDE.md / .cursorrules snippet

To make the integration recipe survive across sessions, drop this into your repo's `AGENTS.md`, `CLAUDE.md`, or `.cursorrules` file. Future AI sessions inherit the rules without you re-pasting the prompt.

The snippet is published as a static file you can curl:

```bash
curl -O https://runcycles.io/agents/cycles-integration.md
# then append or include in your repo's AGENTS.md / CLAUDE.md / .cursorrules
```

The same content is mirrored at <a href="/agents/cycles-integration.md"><code>/agents/cycles-integration.md</code></a>.

## Minimum viable integration by language

The assistant should produce a diff that looks like one of the four blocks below. These are lifted directly from the language quickstarts — there is no new pattern here.

::: code-group

```python [Python]
# pip install runcycles
# env: CYCLES_BASE_URL, CYCLES_API_KEY, CYCLES_TENANT
from runcycles import (
    CyclesClient, CyclesConfig, BudgetExceededError, cycles, set_default_client,
)

set_default_client(CyclesClient(CyclesConfig.from_env()))

def estimate_actual(summary: str) -> int:
    return max(1, len(summary) * 5)              # USD_MICROCENTS — replace with usage stats

@cycles(
    estimate=2_000_000,                          # USD_MICROCENTS — tune from logs
    actual=estimate_actual,
    action_kind="llm.completion",
    action_name="openai:gpt-4o",
)
def generate_summary(document: str) -> str:
    return openai.chat.completions.create(
        model="gpt-4o",
        messages=[{"role": "user", "content": f"Summarize: {document}"}],
        max_tokens=2000,
    ).choices[0].message.content

def summarize_or_fallback(document: str) -> str:
    try:
        return generate_summary(document)
    except BudgetExceededError:
        return "Summary unavailable — budget limit reached."
```

```typescript [TypeScript]
// npm install runcycles
// env: CYCLES_BASE_URL, CYCLES_API_KEY, CYCLES_TENANT
import {
  CyclesClient, CyclesConfig, BudgetExceededError,
  withCycles, setDefaultClient,
} from "runcycles";

setDefaultClient(new CyclesClient(CyclesConfig.fromEnv()));

const generateSummary = withCycles(
  {
    estimate: 2_000_000,                         // USD_MICROCENTS — tune from logs
    actual: (summary: string) => Math.max(1, summary.length * 5),
    actionKind: "llm.completion",
    actionName: "openai:gpt-4o",
  },
  async (document: string) => {
    const r = await openai.chat.completions.create({
      model: "gpt-4o",
      messages: [{ role: "user", content: `Summarize: ${document}` }],
      max_tokens: 2000,
    });
    return r.choices[0].message.content!;
  },
);

export async function summarizeOrFallback(document: string) {
  try {
    return await generateSummary(document);
  } catch (err) {
    if (err instanceof BudgetExceededError) {
      return "Summary unavailable — budget limit reached.";
    }
    throw err;
  }
}
```

```java [Java / Spring]
// pom.xml: io.runcycles:cycles-client-java-spring
// application.yml: cycles.base-url, cycles.api-key, cycles.tenant
import io.runcycles.client.java.spring.annotation.Cycles;
import io.runcycles.client.java.spring.model.CyclesProtocolException;

@Service
public class SummaryService {

    @Cycles(value = "2000000",
            actual = "#result.usage.totalTokens * 8",
            actionKind = "llm.completion",
            actionName = "openai:gpt-4o")
    public ChatResponse generateSummary(String document) {
        return openAiClient.chat(document);
    }

    public String summarizeOrFallback(String document) {
        try {
            return generateSummary(document).text();
        } catch (CyclesProtocolException e) {
            if (e.isBudgetExceeded()) {
                return "Summary unavailable — budget limit reached.";
            }
            throw e;
        }
    }
}
```

```rust [Rust]
// Cargo.toml: runcycles = "0.2"
// env: CYCLES_BASE_URL, CYCLES_API_KEY, CYCLES_TENANT
use runcycles::{
    with_cycles, CyclesClient, CyclesConfig, Error, WithCyclesConfig,
    models::{Amount, Subject},
};

pub async fn summarize_or_fallback(
    client: &CyclesClient,
    document: &str,
) -> String {
    let result = with_cycles(
        client,
        WithCyclesConfig::new(Amount::usd_microcents(2_000_000))
            .action("llm.completion", "openai:gpt-4o")
            .subject(Subject { tenant: Some("acme-corp".into()), ..Default::default() }),
        |_ctx| async move {
            let summary = call_openai(document).await?;
            let actual = Amount::usd_microcents(estimate_actual(&summary));
            Ok((summary, actual))
        },
    ).await;

    match result {
        Ok(summary) => summary,
        Err(Error::BudgetExceeded { .. }) => {
            "Summary unavailable — budget limit reached.".into()
        }
        Err(e) => panic!("unexpected Cycles error: {e}"),
    }
}
```

:::

## The most common wrong integration

AI coding assistants frequently produce a plausible-but-wrong integration that *looks* like it's using Cycles, but enforces nothing. It records spend after the fact instead of authorizing it before the fact.

```typescript
// WRONG — calls OpenAI first, then reports usage to Cycles.
// This is observability, not enforcement. The model call has already
// happened and the money is already spent. DENY is meaningless here.
const result = await openai.chat.completions.create({ ... });
await cycles.commit({ actual: { amount: 35000, unit: "USD_MICROCENTS" } });
```

```typescript
// RIGHT — reserve first, execute only on ALLOW, commit actuals after.
// On DENY the OpenAI call never fires.
const reservation = await cycles.reserve({
  estimate: { amount: 50000, unit: "USD_MICROCENTS" },
  action: { kind: "llm.completion", name: "openai:gpt-4o" },
});
if (reservation.decision !== "ALLOW") {
  return fallback();
}
const result = await openai.chat.completions.create({ ... });
await cycles.commit({ reservationId: reservation.id, actual: { ... } });
```

The decorator / HOF / annotation in the language picker above does the reserve → check → execute → commit flow for you. If a generated diff has the model call running before the Cycles primitive, it is wrong — reject it.

## Where to place Cycles in your architecture

The right insertion point depends on how the agent is structured. Hand the assistant this table along with the rest of the contract.

| Situation                       | Put Cycles here                                            |
| ------------------------------- | ---------------------------------------------------------- |
| Direct OpenAI / Anthropic call  | SDK wrapper around the model call                          |
| Tool-calling agent              | Tool execution wrapper, before the tool runs               |
| Multi-tenant SaaS agent         | Tenant / workflow boundary before each costly action       |
| MCP-based local assistant       | MCP for local discovery; runtime wrapper for production    |
| Gateway / proxy architecture    | Gateway, before the downstream model or tool call          |
| Batch / scheduled job           | Job entry point, around the per-item action                |

The constant: **the Cycles check is on the same code path as the costly action, and runs before it.** Anywhere else is logging, not enforcement.

## Success test: prove the downstream call is not made on DENY

This is the test the assistant must produce. It is the only thing that proves the integration is doing its job.

Mock Cycles so the guard returns DENY; do **not** mock the wrapped function itself. Replacing `generate_summary` / `generateSummary` bypasses the Cycles guard and only tests fallback handling.

::: code-group

```python [Python — pytest]
import importlib
from unittest.mock import MagicMock

def test_openai_not_called_when_budget_denied(monkeypatch, httpx_mock):
    monkeypatch.setenv("CYCLES_BASE_URL", "http://cycles.test")
    monkeypatch.setenv("CYCLES_API_KEY", "test-key")
    monkeypatch.setenv("CYCLES_TENANT", "acme-corp")
    httpx_mock.add_response(
        method="POST",
        url="http://cycles.test/v1/reservations",
        status_code=409,
        json={"error": "BUDGET_EXCEEDED", "message": "budget exhausted"},
    )

    import myapp.summary as summary
    summary = importlib.reload(summary)  # rebuild CyclesConfig.from_env() with test env
    fake_openai = MagicMock()
    monkeypatch.setattr(summary, "openai", fake_openai)

    result = summary.summarize_or_fallback("a document")

    assert "budget limit reached" in result
    fake_openai.chat.completions.create.assert_not_called()
```

```typescript [TypeScript — vitest]
import { afterEach, describe, it, expect, vi } from "vitest";

function mockCyclesDeny() {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue({
      status: 409,
      statusText: "Conflict",
      json: () => Promise.resolve({ error: "BUDGET_EXCEEDED", message: "budget exhausted" }),
      headers: new Headers(),
    }),
  );
}

describe("summarizeOrFallback", () => {
  afterEach(() => {
    vi.resetModules();
    vi.unstubAllGlobals();
  });

  it("does not call OpenAI when budget is denied", async () => {
    process.env.CYCLES_BASE_URL = "http://cycles.test";
    process.env.CYCLES_API_KEY = "test-key";
    process.env.CYCLES_TENANT = "acme-corp";
    mockCyclesDeny();

    const create = vi.fn();
    vi.doMock("./openai-client", () => ({ openai: { chat: { completions: { create } } } }));

    const { summarizeOrFallback } = await import("./summary");
    const result = await summarizeOrFallback("a document");

    expect(result).toMatch(/budget limit reached/);
    expect(create).not.toHaveBeenCalled();
  });
});
```

```rust [Rust — tokio test]
// Use a mock CyclesClient that returns DENY (e.g. wiremock or a hand-rolled
// fake server). Inject a fake `call_openai` that increments a counter, and
// assert the counter is still zero after summarize_or_fallback returns the
// fallback string.
#[tokio::test]
async fn openai_not_called_when_budget_denied() {
    let calls = std::sync::Arc::new(std::sync::atomic::AtomicUsize::new(0));
    let client = mock_cycles_client_returning_deny().await;

    let result = summarize_or_fallback_with_injected_caller(
        &client,
        "a document",
        {
            let calls = calls.clone();
            move |_doc| { calls.fetch_add(1, std::sync::atomic::Ordering::SeqCst); async { unreachable!() } }
        },
    ).await;

    assert!(result.contains("budget limit reached"));
    assert_eq!(calls.load(std::sync::atomic::Ordering::SeqCst), 0);
}
```

:::

If the assistant cannot make this test pass, the integration is wrong — the Cycles check is in the wrong place, or there is no deny path. Iterate until it passes.

## MCP availability is not enforcement

If your repo runs inside [Claude Desktop](/quickstart/mcp-claude-desktop), [Claude Code](/quickstart/mcp-claude-code), [Cursor](/quickstart/mcp-cursor), or [Windsurf](/quickstart/mcp-windsurf), registering the Cycles MCP server gives the host access to `cycles_reserve`, `cycles_commit`, `cycles_release`, and balance tools.

**MCP is useful for local assistant workflows and discovery. It is not, by itself, a hard runtime control unless the host or tool harness is required to call Cycles before executing the real action.** For production, the Cycles check must sit in the execution path — the SDK wrapper, gateway, or framework adapter — where the costly action cannot run without it. See [Integrating Cycles with MCP](/how-to/integrating-cycles-with-mcp) for the patterns that combine MCP discovery with hard enforcement.

## After the first wrap

Once the test passes:

1. Move to [shadow mode](/how-to/shadow-mode-in-cycles-how-to-roll-out-budget-enforcement-without-breaking-production) to observe decisions in production without blocking.
2. [Expand coverage](/how-to/adding-cycles-to-an-existing-application#stage-3-expand-coverage) to additional call paths.
3. Switch from shadow to live enforcement.
4. Wire the broader [reserve / commit / release lifecycle](/protocol/how-reserve-commit-works-in-cycles) — dynamic estimates, tenant scoping, run budgets.

The assistant has the contract; you have the test. Ship one boundary, prove it, expand.

## Protocol references (only if you need them)

Most integrations never touch the protocol directly — the decorator, HOF, and annotation hide it. Reach for these only when you need an exact field name, are debugging an error code, or are wrapping an HTTP call by hand because no SDK exists for your language. Linking these here so an AI coder can resolve the rare leak without guessing field names.

- [Reserve / commit lifecycle](/protocol/how-reserve-commit-works-in-cycles) — request/response shape for `reserve`, `commit`, `release`, plus `idempotencyKey`, `ttlMs`, and what each call returns.
- [Decide endpoint](/protocol/how-decide-works-in-cycles-preflight-budget-checks-without-reservation) — preflight check without holding budget. The right endpoint for shadow mode and "would this be allowed?" reads.
- [Error codes](/protocol/error-codes-and-error-handling-in-cycles) — canonical list (`BUDGET_EXCEEDED`, `RESERVATION_NOT_FOUND`, `INVALID_IDEMPOTENCY_KEY`, etc.). Map directly to `BudgetExceededError` / `CyclesProtocolException` in the SDKs.
- [Units (USD_MICROCENTS, TOKENS, CREDITS, RISK_POINTS)](/protocol/understanding-units-in-cycles-usd-microcents-tokens-credits-and-risk-points) — what `unit` and `amount` mean. The SDK examples on this page use `USD_MICROCENTS`; pick the right unit per ledger.
- [Caps and the three-way decision model](/protocol/caps-and-the-three-way-decision-model-in-cycles) — `ALLOW`, `ALLOW_WITH_CAPS`, `DENY`. If your wrapper handles only ALLOW/DENY, check this before assuming caps are safe to ignore.
- [Interactive OpenAPI reference](/api/) — full schema browser. The full spec is at `/cycles-protocol-v0.yaml`.

If you are an AI coding assistant: prefer the SDK-level integration on this page. Drop to protocol level only when the SDK genuinely doesn't expose what you need.
