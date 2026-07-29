---
title: "Upgrading Cycles Safely"
description: "Upgrade the Cycles service fleet and integrations safely with compatibility checks, rolling order, migration actions, verification, and rollback boundaries."
---

# Upgrading Cycles Safely

Cycles components release independently but share a protocol and Redis state. Treat an upgrade as a fleet change: identify behavior changes, protect Redis, upgrade consumers before producers, and validate one instance before broad rollout.

The [changelog](/changelog) is the current version and release-history authority. The YAML API specifications remain authoritative for wire behavior.

## Current target fleet

| Component | Current version | Compatibility target |
|---|---:|---|
| Runtime specification | `0.1.25.16` document revision | Protocol `v0.1.25` |
| Governance specification | `0.1.25.42` | Governance `v0.1.25` |
| Runtime server | `0.1.25.59` | Runtime specification `0.1.25.16` |
| Admin server | `0.1.25.55` | Governance specification `0.1.25.42` |
| Events service | `0.1.25.25` | Shared v0.1.25 Redis event, delivery, and evidence records |
| Dashboard | `0.1.25.85` | Current admin, runtime, and evidence views |

Client SDK and integration versions are listed in the [current version matrix](/changelog#current-versions). They can be upgraded independently unless their release notes require a newer server feature.

## Before the change window

1. Read every component's release notes between the deployed and target versions.
2. Search for `SECURITY`, `BEHAVIOR CHANGE`, `Migration`, new required environment variables, changed ports, and changed defaults.
3. Confirm the target versions in the [version compatibility table](/changelog#version-compatibility).
4. Run the target fleet against a copy of production-shaped Redis data.
5. Create and validate a complete Redis backup using the [backup and recovery runbook](/how-to/redis-backup-restore-disaster-recovery).
6. Record current image digests, configuration, secrets, Redis version, and queue depths.
7. Confirm rollback images are still available.

Do not use mutable `latest` tags. Pin a version or immutable digest for every service.

## Operator-action matrix

The table below consolidates current v0.1.25 changes that require deployment or client action. Purely additive/internal patches are omitted.

| When crossing | Required action |
|---|---|
| Events service `<0.1.25.9` → `>=0.1.25.9` | Move liveness, readiness, and Prometheus checks from application port `7980` to management port `9980`. Keep both ports internal. |
| Admin server `<0.1.25.24` → `>=0.1.25.24` | Callers that depend on list ordering must pass a supported `sort_by` and `sort_dir`; budget and webhook default ordering changed. |
| Admin server `<0.1.25.28` → `>=0.1.25.28` | Replace new audit queries for `<unauthenticated>` with `__unauth__` or `__admin__`. Historical rows remain queryable until retention expires. |
| Runtime `<0.1.25.45` or admin `<0.1.25.45` → current | Add `X-Admin-API-Key` to aggregate actuator, Prometheus, OpenAPI, and Swagger requests. Liveness/readiness probes remain public. |
| Runtime `<0.1.25.46` → current | Account for default rate limiting on public evidence/JWKS endpoints and handle `429 LIMIT_EXCEEDED` plus `Retry-After`. |
| Runtime `<0.1.25.47` or admin `<0.1.25.35` → current | Expect closed-tenant mutation guards and cascade behavior. Fresh dry-run/decide evaluations deny with `TENANT_CLOSED`; persisting runtime mutations can return `409 TENANT_CLOSED`. |
| Admin `<0.1.25.49` → current | Rewrite webhook bare-prefix `scope_filter` values to the exact or trailing-`*` syntax. “Base plus descendants” needs two subscriptions. |
| Admin `<0.1.25.51` or events `<0.1.25.23` → current | Upgrade all events workers and admin instances to enforce the tenant/admin webhook category boundary across write, dispatch, retry, replay, and last-mile delivery. |
| Admin `<0.1.25.54` or events `<0.1.25.25` → current | Provide the same 32-byte `WEBHOOK_SECRET_ENCRYPTION_KEY`. Missing keys fail startup; plaintext requires the explicit development-only `WEBHOOK_SECRET_ALLOW_PLAINTEXT=true` escape hatch. |
| Events `<0.1.25.25` → current | Review webhook targets against the always-on SSRF baseline. Private, local, metadata, CGNAT, and IPv6 unique-local destinations are denied unless an explicit development policy permits them. |
| Dashboard `<0.1.25.64` → current production stack | Supply the required Redis password and webhook-secret encryption configuration used by the hardened Compose stack; update health checks to readiness endpoints. |

When release notes and this summary disagree, follow the release notes and YAML specifications.

## Rolling order

For additive v0.1.25 patches, upgrade components in this order:

1. **Events service** — it consumes event, delivery, and evidence records produced by the other services.
2. **Runtime and admin servers** — upgrade one instance at a time; either service can precede the other unless a release note names a paired security rollout.
3. **Dashboard** — upgrade after the APIs it calls.
4. **Client SDKs and integrations** — roll out after the server features they consume are available.

Consumer-before-producer reduces the chance that an older worker sees a record introduced by a newer producer. A release-specific order overrides this general sequence.

For paired security fixes, do not declare the rollout complete until every named component and replica is upgraded. For example, the tenant webhook category boundary requires admin `0.1.25.51+` and every events worker at `0.1.25.23+`.

## Upgrade each service

For each component:

1. Remove one instance from traffic or stop one worker.
2. Start the target image with the production configuration.
3. Wait for its readiness endpoint:

   | Service | Readiness |
   |---|---|
   | Runtime | `http://host:7878/actuator/health/readiness` |
   | Admin | `http://host:7979/actuator/health/readiness` |
   | Events | `http://host:9980/actuator/health/readiness` |

4. Inspect startup logs for configuration fallback, encryption, Redis, lease, queue, or schema warnings.
5. Run the component checks below.
6. Keep the instance under observation before replacing the next replica.

Do not run old and new events workers together longer than necessary when a release note says enforcement is per-worker. An old worker can continue processing shared queue items with its old behavior.

## Verification

### Runtime

- Read a representative balance.
- Create and release a small test reservation with a stable idempotency key.
- Repeat the request and verify idempotent replay.
- Verify expected `DENY` behavior against a constrained test scope.
- Check error and latency metrics.

### Admin

- List tenants, budgets, policies, API keys, webhooks, events, and audit records.
- Verify filters, sort order, and cursors used by operator automation.
- Use a test tenant for any mutation probe.
- Confirm operational endpoints require the expected admin header.

### Events

- Verify `dispatch:pending`, `dispatch:processing`, and `dispatch:retry` do not grow unexpectedly.
- Send a webhook test to an approved target.
- Confirm retry, ownership-boundary, SSRF, and auto-disable metrics remain healthy.
- If evidence is enabled, verify pending records become signed envelopes and the public JWKS resolves the signer.

### Dashboard

- Log in through the production reverse proxy.
- Load overview, tenants, budgets, reservations, webhooks, events, audit, and evidence views.
- Confirm the login/sidebar shows the target dashboard version and no backend API-shape errors appear.

## Rollback

Before rolling back:

1. stop the rollout and block new writes if state compatibility is uncertain;
2. read the release notes for storage migrations or one-way behavior changes;
3. preserve logs and the current Redis state;
4. roll back one instance in isolation and validate it against a copy of the current Redis dataset.

Current v0.1.x wire changes are designed to be additive, and the service processes are stateless. That does not make every behavior rollback invisible: a newer service may already have written records, changed webhook subscriptions, closed tenants, emitted events, or consumed queue items that an older service will not undo.

Do not restore Redis merely to roll back application binaries. A Redis restore is a data-loss operation relative to every write after the restore point and requires the full [disaster-recovery procedure](/how-to/redis-backup-restore-disaster-recovery).

## Post-upgrade record

Record:

- deployed versions and immutable image digests;
- start/end time and operator;
- migration actions completed;
- readiness and smoke-test results;
- queue-depth and error-rate comparison;
- rollback point and backup checksum;
- any deferred client or integration upgrades.

## Related

- [Changelog and Current Versions](/changelog)
- [Deploying the Full Cycles Stack](/quickstart/deploying-the-full-cycles-stack)
- [Production Operations](/how-to/production-operations-guide)
- [Redis Backup, Restore, and Disaster Recovery](/how-to/redis-backup-restore-disaster-recovery)
- [Server Configuration Reference](/configuration/server-configuration-reference-for-cycles)
