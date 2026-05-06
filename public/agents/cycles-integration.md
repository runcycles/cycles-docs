# Cycles integration rules (drop-in for AGENTS.md / CLAUDE.md / .cursorrules)

Append this file to your repo's `AGENTS.md`, `CLAUDE.md`, or `.cursorrules`
so every AI coding session inherits the Cycles integration contract without
re-pasting it.

Source: https://runcycles.io/how-to/add-cycles-with-claude-or-codex
Mirror: https://runcycles.io/agents/cycles-integration.md

## Cycles — runtime budget authority

This repo uses (or is integrating) Cycles for pre-execution budget and
action enforcement around LLM calls and external tool calls. The contract
below applies whenever you add, modify, or refactor code that calls a
model or makes a paid / side-effecting external call.

**The invariant: Cycles must run before the costly action on the same
execution path.** Every rule below exists to prove or enforce that.

### Do

1. Wrap LLM calls and external side-effect tool calls with the
   language-appropriate Cycles primitive:
   - Python:      `runcycles` package, `@cycles` decorator
   - TypeScript:  `runcycles` package, `withCycles` HOF
   - Java/Spring: `cycles-client-java-spring`, `@Cycles` annotation
   - Rust:        `runcycles` crate, `with_cycles()` (auto) or
                  `ReservationGuard` (manual / streaming)
2. Read configuration from environment variables only:
   - `CYCLES_BASE_URL`
   - `CYCLES_API_KEY`  (`cyc_live_...`, never hardcoded)
   - `CYCLES_TENANT`
3. Use `CyclesConfig.from_env()` / `CyclesConfig.fromEnv()` /
   Spring Boot auto-config — do not roll a custom config layer.
4. Commit actual usage after execution; use estimate-as-actual only when
   that is an explicit, reviewed choice.
5. On budget denial (`BudgetExceededError` / `CyclesProtocolException`
   with `isBudgetExceeded()`), take ONE of: graceful fallback, downgraded
   model, queue-for-later. Never silently retry the original call.
6. For each new wrapped boundary, add a test that mocks the downstream
   client and asserts it received zero calls when Cycles denies. This
   test is the proof of correctness.
7. When choosing the first boundary, prioritize highest cost, highest
   frequency, or highest blast radius. Cycles is not just cost control —
   blast radius (deletes, sends, payments, irreversible side effects) is
   a first-class reason to wrap a call.
8. Ship one wrapped boundary per PR. Tune estimates from logs before
   wrapping the next.

### Do not

- Rely on prompts, system messages, or model instructions as enforcement.
  The model is not the enforcement authority.
- Add only logging without a deny path that prevents the downstream call.
- Place the Cycles check after the downstream call. Reserve must precede
  execution.
- Treat MCP tool availability as enforcement. Treat MCP as discovery
  and local-workflow support unless the host or tool harness is
  *required* to call Cycles before executing the real action.
  Production enforcement belongs in the SDK wrapper or gateway on this
  repo's execution path.
- Invent a new Cycles abstraction unless the repo already has a gateway
  or middleware layer where tool/model calls are centralized. Prefer
  the documented decorator / HOF / annotation first; integrate at the
  gateway only when it is the natural seam.
- Hardcode estimates that don't reflect typical call cost — read recent
  log data or use a callable estimate that derives from request size.
- Wrap multiple boundaries in one change. One boundary, one test, ship,
  expand.

### Pattern (Python)

```python
from runcycles import (
    CyclesClient, CyclesConfig, BudgetExceededError, cycles, set_default_client,
)

set_default_client(CyclesClient(CyclesConfig.from_env()))

@cycles(
    estimate=2_000_000,
    # Prefer provider usage/cost metadata (e.g. response.usage.total_tokens)
    # when available. This length-based placeholder keeps the example short.
    actual=lambda summary: max(1, len(summary) * 5),
    action_kind="llm.completion",
    action_name="openai:gpt-4o",
)
def generate_summary(document: str) -> str:
    return openai.chat.completions.create(...).choices[0].message.content

def summarize_or_fallback(document: str) -> str:
    try:
        return generate_summary(document)
    except BudgetExceededError:
        return "Summary unavailable — budget limit reached."
```

### Pattern (TypeScript)

```typescript
import {
  CyclesClient, CyclesConfig, BudgetExceededError,
  withCycles, setDefaultClient,
} from "runcycles";

setDefaultClient(new CyclesClient(CyclesConfig.fromEnv()));

const generateSummary = withCycles(
  {
    estimate: 2_000_000,
    // Prefer provider usage/cost metadata (e.g. response.usage.total_tokens)
    // when available. This length-based placeholder keeps the example short.
    actual: (summary: string) => Math.max(1, summary.length * 5),
    actionKind: "llm.completion",
    actionName: "openai:gpt-4o",
  },
  async (document: string) => (await openai.chat.completions.create({ ... })).choices[0].message.content!,
);
```

### Pattern (Java / Spring)

```java
@Cycles(value = "2000000",
        // Adapt #result.usage.totalTokens to your client's response shape.
        actual = "#result.usage.totalTokens * 8",
        actionKind = "llm.completion",
        actionName = "openai:gpt-4o")
public ChatResponse generateSummary(String document) {
    return openAiClient.chat(document);
}
```

### Pattern (Rust)

```rust
use runcycles::{with_cycles, CyclesClient, Error, WithCyclesConfig, models::*};

let result = with_cycles(
    &client,
    WithCyclesConfig::new(Amount::usd_microcents(2_000_000))
        .action("llm.completion", "openai:gpt-4o"),
    |_ctx| async move {
        let summary = call_openai(document).await?;
        Ok((summary, Amount::usd_microcents(actual_cost)))
    },
).await;

match result {
    Ok(s) => s,
    Err(Error::BudgetExceeded { .. }) => "Summary unavailable — budget limit reached.".into(),
    Err(e) => return Err(e.into()),
}
```

### Required test (sketch)

```python
# pytest — mock Cycles DENY, then assert OpenAI is not called
import importlib
from unittest.mock import MagicMock

def test_openai_not_called_on_deny(monkeypatch, httpx_mock):
    monkeypatch.setenv("CYCLES_BASE_URL", "http://cycles.test")
    monkeypatch.setenv("CYCLES_API_KEY", "test-key")
    monkeypatch.setenv("CYCLES_TENANT", "acme-corp")
    httpx_mock.add_response(
        method="POST",
        url="http://cycles.test/v1/reservations",
        status_code=409,
        json={
            "error": "BUDGET_EXCEEDED",
            "message": "budget exhausted",
            "request_id": "req_test_123",
        },
    )

    import myapp.summary as summary
    summary = importlib.reload(summary)  # rebuild CyclesConfig.from_env() with test env
    fake_openai = MagicMock()
    monkeypatch.setattr(summary, "openai", fake_openai)

    result = summary.summarize_or_fallback("doc")

    assert "budget limit reached" in result
    fake_openai.chat.completions.create.assert_not_called()
```

### Reference docs

- Canonical recipe:  https://runcycles.io/how-to/add-cycles-with-claude-or-codex
- Existing-app path: https://runcycles.io/how-to/adding-cycles-to-an-existing-application
- Python:            https://runcycles.io/quickstart/getting-started-with-the-python-client
- TypeScript:        https://runcycles.io/quickstart/getting-started-with-the-typescript-client
- Spring Boot:       https://runcycles.io/quickstart/getting-started-with-the-cycles-spring-boot-starter
- Rust:              https://runcycles.io/quickstart/getting-started-with-the-rust-client
- MCP enforcement:   https://runcycles.io/how-to/integrating-cycles-with-mcp
- Machine index:     https://runcycles.io/llms.txt

### Protocol references (only if the SDK doesn't expose what you need)

- Reserve/commit lifecycle:  https://runcycles.io/protocol/how-reserve-commit-works-in-cycles
- Decide (preflight):        https://runcycles.io/protocol/how-decide-works-in-cycles-preflight-budget-checks-without-reservation
- Error codes:               https://runcycles.io/protocol/error-codes-and-error-handling-in-cycles
- Units:                     https://runcycles.io/protocol/understanding-units-in-cycles-usd-microcents-tokens-credits-and-risk-points
- Caps / three-way decision: https://runcycles.io/protocol/caps-and-the-three-way-decision-model-in-cycles
- Interactive OpenAPI:       https://runcycles.io/api/
