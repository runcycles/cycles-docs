---
title: "Integrating Cycles with Ollama for Local LLM Budget Control"
description: "Guard Ollama local LLM calls with Cycles budget reservations to track GPU time, control compute costs, and manage shared inference infrastructure."
---

# Integrating Cycles with Ollama

This guide shows how to guard [Ollama](https://ollama.com/) local LLM calls with Cycles budget reservations.

Budget control matters for local LLMs even though there are no per-token API charges. GPU time is a finite resource — shared inference servers have capacity limits, local GPUs have electricity and opportunity costs, and teams running models on shared infrastructure need visibility into who is consuming what. Cycles gives you the same reserve-execute-commit lifecycle for local models as you get for cloud APIs.

## Prerequisites

```bash
pip install runcycles ollama
```

Set environment variables:

```bash
export CYCLES_BASE_URL="http://localhost:7878"
export CYCLES_API_KEY="your-api-key"   # create via Admin Server — see note below
export CYCLES_TENANT="acme"
```

Make sure Ollama is running (`ollama serve`) and you have pulled a model:

```bash
ollama pull llama3.1
```

> **Need an API key?** Create one via the Admin Server — see [Deploy the Full Stack](/quickstart/deploying-the-full-cycles-stack#step-3-create-an-api-key) or [API Key Management](/how-to/api-key-management-in-cycles).

::: tip 60-Second Quick Start
```python
import ollama
from runcycles import CyclesClient, CyclesConfig, cycles, set_default_client

set_default_client(CyclesClient(CyclesConfig.from_env()))

@cycles(estimate=500_000, action_kind="llm.completion", action_name="llama3.1")
def ask(prompt: str) -> str:
    response = ollama.chat(
        model="llama3.1",
        messages=[{"role": "user", "content": prompt}],
    )
    return response["message"]["content"]

print(ask("What is budget authority?"))
```
Every call is now budget-guarded. If the budget is exhausted, `BudgetExceededError` is raised _before_ Ollama is called. Read on for GPU-time cost estimation and multi-runner patterns.
:::

## Cost estimation for local models

Cloud APIs charge per token. Local models consume GPU time instead. A common approach is to assign a cost in microcents per GPU-second, then estimate based on expected inference duration:

```python
import time
import ollama
from runcycles import (
    CyclesClient, CyclesConfig, CyclesMetrics,
    cycles, get_cycles_context, set_default_client,
)

set_default_client(CyclesClient(CyclesConfig.from_env()))

# Cost in microcents per GPU-second (adjust for your hardware)
GPU_COST_PER_SECOND = 10_000  # e.g., $0.10/sec on an A100

@cycles(
    estimate=lambda prompt, **kw: GPU_COST_PER_SECOND * 30,  # assume 30s max
    actual=lambda result: result["cost"],
    action_kind="llm.completion",
    action_name="llama3.1",
    unit="USD_MICROCENTS",
    ttl_ms=120_000,
)
def chat(prompt: str) -> dict:
    start = time.monotonic()

    response = ollama.chat(
        model="llama3.1",
        messages=[{"role": "user", "content": prompt}],
    )

    elapsed = time.monotonic() - start
    cost = int(elapsed * GPU_COST_PER_SECOND)

    ctx = get_cycles_context()
    if ctx:
        ctx.metrics = CyclesMetrics(
            tokens_input=response.get("prompt_eval_count", 0),
            tokens_output=response.get("eval_count", 0),
            latency_ms=int(elapsed * 1000),
            model_version="llama3.1",
            custom={"gpu_seconds": round(elapsed, 2)},
        )

    return {
        "content": response["message"]["content"],
        "cost": cost,
    }
```

You can also budget purely by token count if you prefer — just assign a microcent value per token that reflects your infrastructure cost.

## Works with any Ollama-compatible runner

The `@cycles` pattern is not specific to the Ollama daemon. Any OpenAI-compatible local inference server works the same way. Simply swap the client:

```python
from openai import OpenAI
from runcycles import cycles

# vLLM, text-generation-inference, or any OpenAI-compatible server
local_client = OpenAI(base_url="http://localhost:8000/v1", api_key="unused")

@cycles(estimate=500_000, action_kind="llm.completion", action_name="llama3.1")
def ask_vllm(prompt: str) -> str:
    response = local_client.chat.completions.create(
        model="llama3.1",
        messages=[{"role": "user", "content": prompt}],
    )
    return response.choices[0].message.content
```

This works with [vLLM](https://docs.vllm.ai/), [text-generation-inference](https://huggingface.co/docs/text-generation-inference/), [LocalAI](https://localai.io/), or any server exposing an OpenAI-compatible endpoint.

## TypeScript example

Using the [ollama npm package](https://www.npmjs.com/package/ollama):

```typescript
import { Ollama } from "ollama";
import { CyclesClient, CyclesConfig, withCycles } from "runcycles";

const client = new CyclesClient(CyclesConfig.fromEnv());
const ollama = new Ollama();

const ask = withCycles(
  {
    client,
    estimate: 500_000,
    actionKind: "llm.completion",
    actionName: "llama3.1",
  },
  async (prompt: string): Promise<string> => {
    const response = await ollama.chat({
      model: "llama3.1",
      messages: [{ role: "user", content: prompt }],
    });
    return response.message.content;
  }
);

console.log(await ask("What is budget authority?"));
```

## Error handling

When the budget is insufficient, `BudgetExceededError` is raised **before** Ollama is called:

```python
from runcycles import BudgetExceededError

try:
    result = chat("Explain transformer architectures in detail")
except BudgetExceededError:
    result = {"content": "GPU budget exhausted — try again later.", "cost": 0}
```

For shared GPU infrastructure, a mandatory wrapper can stop a tenant's protected inference calls once its configured compute budget is unavailable. Scheduler fairness, GPU isolation, and calls that bypass the wrapper remain infrastructure concerns.

See [Degradation Paths](/how-to/how-to-think-about-degradation-paths-in-cycles-deny-downgrade-disable-or-defer) for patterns like queueing, model downgrade, and caching.

## Key points

- **Local does not mean free.** GPU time, electricity, and shared capacity all have real costs worth tracking.
- **GPU-time estimation.** Estimate cost by expected inference duration, then commit the actual GPU-seconds consumed.
- **Runner-agnostic.** The same `@cycles` pattern works with Ollama, vLLM, text-generation-inference, and any OpenAI-compatible server.
- **The model never runs on DENY.** If the budget is exhausted, no GPU time is consumed.

## Next steps

- [Error Handling Patterns in Python](/how-to/error-handling-patterns-in-python) — handling budget errors in Python
- [Testing with Cycles](/how-to/testing-with-cycles) — testing budget-guarded code
- [Production Operations Guide](/how-to/production-operations-guide) — running Cycles in production
- [Integrating with OpenAI](/how-to/integrating-cycles-with-openai) — for cloud OpenAI models
- [Integrating with Anthropic](/how-to/integrating-cycles-with-anthropic) — for Anthropic models
