---
title: "LLM Troubleshooting Guides"
description: "Diagnostic guides for common LLM and AI agent production issues — rate limit errors, cost spikes, retry storms, and the runtime patterns that prevent them."
---

# LLM Troubleshooting Guides

Diagnostic guides for common production issues with LLM applications and AI agents. Each page covers what the error means, why it happens, how to fix it now, and how to prevent the class of problem from recurring.

These are tactical pages: start with the symptom, diagnose the failure mode, fix the incident, then add runtime controls so the same class does not recur.

## Provider rate limits

- [OpenAI 429 Too Many Requests](/troubleshoot/openai-rate-limit-429) — TPM and RPM limits, tier-based quotas, and how to handle them under load
- [Anthropic API rate limit errors](/troubleshoot/anthropic-rate-limit-error) — input/output token-per-minute limits, 529 overload, and graceful degradation

## Cost and budget incidents

- [Debugging sudden LLM cost spikes](/troubleshoot/llm-cost-spike-debugging) — agent loops, prompt regressions, model upgrades, retry storms, and tenant leakage

## Related

- [Cycles for Cost Control](/why-cycles/cost-control) — what runtime budget enforcement actually prevents
- [Incident Patterns](/incidents/runaway-agents-tool-loops-and-budget-overruns-the-incidents-cycles-is-designed-to-prevent) — full incident-pattern catalog for production AI systems
- [Cycles vs Rate Limiting](/concepts/cycles-vs-rate-limiting) — why provider rate limits do not prevent cost overruns
