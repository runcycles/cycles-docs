---
title: "Handling Streaming Responses with Cycles"
description: "The reserve, stream, and commit pattern for managing budget reservations with streaming LLM responses. Includes TTL extension for long-running streams."
---

# Handling Streaming Responses with Cycles

Streaming LLM responses require special handling because the actual cost is only known after the stream completes. This guide shows the reserve → stream → commit pattern.

## The challenge

With non-streaming calls, the `@cycles` decorator handles the full lifecycle automatically. Streaming needs different handling because:

1. The reservation must stay alive for the duration of the stream
2. Token counts accumulate incrementally
3. If the stream fails mid-way, you should release the reservation

## The pattern

### Python

Use `client.stream_reservation()`, a context manager that reserves budget on enter, auto-commits the actual cost on successful exit, and auto-releases on exception:

```python
from openai import OpenAI
from runcycles import Action, Amount, CyclesClient, CyclesConfig, Unit

client = CyclesClient(CyclesConfig.from_env())
openai_client = OpenAI()

PRICE_PER_INPUT_TOKEN = 250
PRICE_PER_OUTPUT_TOKEN = 1_000

def stream_with_budget(prompt: str, max_tokens: int = 1024) -> str:
    estimated_cost = max_tokens * PRICE_PER_OUTPUT_TOKEN  # worst case

    with client.stream_reservation(
        action=Action(kind="llm.completion", name="gpt-4o"),
        estimate=Amount(unit=Unit.USD_MICROCENTS, amount=estimated_cost),
        cost_fn=lambda u: u.tokens_input * PRICE_PER_INPUT_TOKEN
                          + u.tokens_output * PRICE_PER_OUTPUT_TOKEN,
    ) as reservation:
        # Respect budget caps
        if reservation.caps and reservation.caps.max_tokens:
            max_tokens = min(max_tokens, reservation.caps.max_tokens)

        stream = openai_client.chat.completions.create(
            model="gpt-4o",
            messages=[{"role": "user", "content": prompt}],
            max_tokens=max_tokens,
            stream=True,
            stream_options={"include_usage": True},
        )

        chunks = []
        for chunk in stream:
            if chunk.choices and chunk.choices[0].delta.content:
                chunks.append(chunk.choices[0].delta.content)
            if chunk.usage:  # the final chunk includes usage stats
                reservation.usage.tokens_input = chunk.usage.prompt_tokens
                reservation.usage.tokens_output = chunk.usage.completion_tokens

    # Auto-committed on exit with the actual cost computed by cost_fn
    return "".join(chunks)
```

The context manager handles the full lifecycle:

- **On enter** — creates the reservation (default `ttl_ms=120_000`). A DENY or protocol error raises `CyclesProtocolError` (or a subclass such as `BudgetExceededError`), so the stream never starts without budget.
- **During the stream** — a background heartbeat extends the TTL at half-TTL intervals automatically (background thread; asyncio task in the async variant). Update `reservation.usage` (`tokens_input`, `tokens_output`, or `set_actual_cost()`) as chunks arrive.
- **On exit** — commits the actual cost: an explicit `set_actual_cost()` value wins, then `cost_fn(usage)`, then the estimate as fallback. If the body raised, the reservation is released instead.

The subject defaults to the `CyclesConfig` subject fields; pass `subject=Subject(...)` to override. With `AsyncCyclesClient`, the same call returns an async context manager: `async with client.stream_reservation(...) as reservation:`.

### Python: manual control

Under the hood, `stream_reservation` drives the raw reserve → stream → commit/release calls. Use them directly only when you need control the context manager doesn't offer:

```python
import uuid
from openai import OpenAI
from runcycles import (
    CyclesClient, CyclesConfig, ReservationCreateRequest,
    CommitRequest, ReleaseRequest, Subject, Action, Amount,
    Unit, CyclesMetrics,
)

client = CyclesClient(CyclesConfig.from_env())
openai_client = OpenAI()

def stream_with_budget(prompt: str, max_tokens: int = 1024) -> str:
    key = str(uuid.uuid4())

    # 1. Reserve worst-case budget
    res = client.create_reservation(ReservationCreateRequest(
        idempotency_key=key,
        subject=Subject(tenant="acme", agent="streaming-agent"),
        action=Action(kind="llm.completion", name="gpt-4o"),
        estimate=Amount(unit=Unit.USD_MICROCENTS,
                        amount=max_tokens * 1_000),  # worst case
        ttl_ms=120_000,  # longer TTL for streaming
    ))

    if not res.is_success:
        raise RuntimeError(f"Reservation failed: {res.error_message}")

    # A 200 response can still carry decision=DENY with no reservation_id
    if res.get_body_attribute("decision") == "DENY":
        raise RuntimeError(
            f"Reservation denied: {res.get_body_attribute('reason_code')}"
        )

    reservation_id = res.get_body_attribute("reservation_id")

    # 2. Stream, with release on failure
    chunks = []
    try:
        stream = openai_client.chat.completions.create(
            model="gpt-4o",
            messages=[{"role": "user", "content": prompt}],
            max_tokens=max_tokens,
            stream=True,
            stream_options={"include_usage": True},
        )

        input_tokens = 0
        output_tokens = 0

        for chunk in stream:
            if chunk.choices and chunk.choices[0].delta.content:
                chunks.append(chunk.choices[0].delta.content)
            if chunk.usage:
                input_tokens = chunk.usage.prompt_tokens
                output_tokens = chunk.usage.completion_tokens

    except Exception:
        # Release budget on failure
        client.release_reservation(
            reservation_id,
            ReleaseRequest(idempotency_key=f"release-{key}"),
        )
        raise

    # 3. Commit actual cost
    actual_cost = input_tokens * 250 + output_tokens * 1_000
    client.commit_reservation(reservation_id, CommitRequest(
        idempotency_key=f"commit-{key}",
        actual=Amount(unit=Unit.USD_MICROCENTS, amount=actual_cost),
        metrics=CyclesMetrics(
            tokens_input=input_tokens,
            tokens_output=output_tokens,
            custom={"streamed": True},
        ),
    ))

    return "".join(chunks)
```

### TypeScript

The TypeScript client provides `reserveForStream`, which handles reservation creation and automatic heartbeat (TTL extension) in one call:

```typescript
import OpenAI from "openai";
import {
  CyclesClient,
  CyclesConfig,
  reserveForStream,
  BudgetExceededError,
} from "runcycles";

const cyclesClient = new CyclesClient(CyclesConfig.fromEnv());
const openai = new OpenAI();

async function streamWithBudget(
  prompt: string,
  maxTokens = 1024,
): Promise<string> {
  // 1. Reserve budget (starts automatic heartbeat)
  const handle = await reserveForStream({
    client: cyclesClient,
    estimate: maxTokens * 1000, // worst-case output cost
    unit: "USD_MICROCENTS",
    actionKind: "llm.completion",
    actionName: "gpt-4o",
  });

  try {
    // Respect budget caps
    let effectiveMaxTokens = maxTokens;
    if (handle.caps?.maxTokens) {
      effectiveMaxTokens = Math.min(maxTokens, handle.caps.maxTokens);
    }

    // 2. Stream the response
    const stream = await openai.chat.completions.create({
      model: "gpt-4o",
      messages: [{ role: "user", content: prompt }],
      max_tokens: effectiveMaxTokens,
      stream: true,
      stream_options: { include_usage: true },
    });

    const chunks: string[] = [];
    let inputTokens = 0;
    let outputTokens = 0;

    for await (const chunk of stream) {
      const content = chunk.choices[0]?.delta?.content;
      if (content) chunks.push(content);
      if (chunk.usage) {
        inputTokens = chunk.usage.prompt_tokens ?? 0;
        outputTokens = chunk.usage.completion_tokens ?? 0;
      }
    }

    // 3. Commit actual cost (stops heartbeat automatically)
    const actualCost = Math.ceil(inputTokens * 250 + outputTokens * 1000);
    await handle.commit(actualCost, {
      tokensInput: inputTokens,
      tokensOutput: outputTokens,
    });

    return chunks.join("");
  } catch (err) {
    // Release budget on failure (stops heartbeat automatically)
    await handle.release("stream_error");
    throw err;
  }
}
```

`reserveForStream` handles TTL extension automatically via a background heartbeat, so you don't need to call `extend` manually. The heartbeat stops when you call `commit` or `release`.

## TTL considerations

Streaming responses can take significantly longer than non-streaming calls. Set `ttl_ms` high enough to cover the full stream duration:

| Response size | Suggested TTL |
|--------------|---------------|
| Short (< 500 tokens) | 30,000 ms |
| Medium (500–2000 tokens) | 60,000 ms |
| Long (> 2000 tokens) | 120,000 ms |

`stream_reservation` extends the TTL automatically via a half-TTL heartbeat, the same way the decorator does. Manual extension is only needed when you drive raw `create_reservation` calls yourself — call `client.extend_reservation()` periodically during long streams:

```python
from runcycles import ReservationExtendRequest

# Extend by another 60 seconds
client.extend_reservation(
    reservation_id,
    ReservationExtendRequest(
        idempotency_key=f"extend-{key}",
        extend_by_ms=60_000,
    ),
)
```

## Release on failure

Always release the reservation if streaming fails. This frees held budget immediately rather than waiting for TTL expiry. `stream_reservation` does this automatically when the body raises; in the manual pattern:

```python
try:
    # stream...
except Exception:
    client.release_reservation(
        reservation_id,
        ReleaseRequest(idempotency_key=f"release-{key}"),
    )
    raise
```

## Respecting caps

With `stream_reservation`, caps are available as `reservation.caps` immediately after entering the context (see the primary example above). In the manual pattern, check the raw response:

```python
caps = res.get_body_attribute("caps")
if caps and caps.get("max_tokens"):
    max_tokens = min(max_tokens, caps["max_tokens"])
```

## Estimating accurately

The estimate determines how much budget is held. Over-estimating wastes budget capacity; under-estimating risks commit-time overage errors.

For streaming, a good estimate is `max_tokens × output_price`, since output tokens dominate cost and `max_tokens` is the upper bound.

## Key points

- **Use `stream_reservation`**, not the decorator, for streaming in Python — it handles reserve, heartbeat, commit, and release for you.
- **Set a longer TTL** to cover the full stream duration.
- **Always release on failure** to free held budget (automatic with `stream_reservation`).
- **Commit the actual cost** after the stream completes using usage data from the final chunk.
- **The estimate holds budget** — the difference between estimate and actual is freed at commit time.

## Full example

See [`examples/streaming_usage.py`](https://github.com/runcycles/cycles-client-python/blob/main/examples/streaming_usage.py) for a complete, runnable script.

## Java / Spring Boot

The Spring Boot starter's `@Cycles` annotation does not support streaming responses. For streaming in Java, use the programmatic `CyclesClient` directly with the reserve → stream → commit pattern shown in the Python manual-control section above. See the [Spring Boot starter overview](/quickstart/getting-started-with-the-cycles-spring-boot-starter) for the broader integration model.

## Next steps

- [Error Handling Patterns in Python](/how-to/error-handling-patterns-in-python) — handling failures during streaming
- [Reservation TTL, Grace Period, and Extend](/protocol/reservation-ttl-grace-period-and-extend-in-cycles) — configuring timeouts for long-running streams
- [Cost Estimation Cheat Sheet](/how-to/cost-estimation-cheat-sheet) — estimating token costs for budget reservations
- [Integrating Cycles with Express](/how-to/integrating-cycles-with-express) — Express.js streaming with `reserveForStream`
- [Integrating Cycles with FastAPI](/how-to/integrating-cycles-with-fastapi) — FastAPI streaming with the programmatic client
