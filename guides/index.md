---
title: "Cycles Guides"
description: "In-depth guides on the enforcement dimensions of runtime authority for AI agents: cost (what they spend), action (what they do), and multi-tenant ops (who owns which budget). Each guide is a map across blog posts, how-tos, and protocol reference."
---

# Cycles Guides

Long-form guides covering the enforcement dimensions of runtime authority for AI agents. Each guide is a map — a short orientation per subtopic that links into the deep coverage. Read top to bottom for a structured view, or jump to whichever section matches what you are working on.

## The enforcement dimensions of runtime authority

Cost, action, and tenancy are different enforcement problems. Cost controls *how much* an agent can spend. Action authority controls *what* it is allowed to do. Multi-tenant operations control *who* owns which budget and how isolation holds up under shared infrastructure. Most real production incidents touch at least two of the three.

- **[LLM Cost Runtime Control Reference](/guides/llm-cost-runtime-control)** — bounding what AI agents *spend*. Causes of cost blowups, why dashboards are not enough, the runtime patterns that work, unit economics, and provider-specific patterns.
- **[AI Agent Risk & Blast Radius Reference](/guides/risk-and-blast-radius)** — bounding what AI agents *do*. Risk scoring, action authority, blast-radius containment, degradation paths, delegation chains, governance frameworks, and incident patterns.
- **[Multi-Tenant AI Operations Reference](/guides/multi-tenant-operations)** — bounding *who* owns which budget. Scope hierarchy, per-tenant enforcement, multi-agent coordination, tenant lifecycle, identity and keys, cross-platform tenancy, and the failure modes specific to shared infrastructure.

A guide on audit / evidence — the byproduct dimension that compliance and post-incident review build on — is in development.
