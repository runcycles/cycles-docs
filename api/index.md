---
aside: false
outline: false
title: API Reference
description: Interactive API reference for the Cycles Protocol. Explore endpoints for reservations, commits, events, balances, and more.
---

# Cycles Protocol API

Interactive reference for the active Cycles Protocol runtime endpoints. Tenant-scoped runtime requests use the `X-Cycles-API-Key` header. The public CyclesEvidence read endpoints do not require authentication.

Since cycles-server 0.1.25.46 the public evidence and JWKS endpoints are rate-limited per client IP (default 300 requests/minute); exceeding the window returns `429` with `error=LIMIT_EXCEEDED` and a `Retry-After` header.

::: tip Getting started with the API?
1. [Deploy the Cycles server](/quickstart/deploying-the-full-cycles-stack) or use a running instance
2. [Create a tenant and API key](/how-to/api-key-management-in-cycles) via the Admin API
3. Make your first [Reserve](/protocol/how-reserve-commit-works-in-cycles) call below
:::

<OASpec />
