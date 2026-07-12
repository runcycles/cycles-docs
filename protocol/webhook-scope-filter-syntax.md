---
title: "Webhook Scope Filter Syntax"
description: "How to filter webhook events by scope using scope_filter on subscriptions — spec wildcard syntax, plus the admin plane's pre-fix prefix-match divergence."
---

# Webhook Scope Filter Syntax

Webhook subscriptions can filter events by scope path using the `scope_filter` field. When set, only events whose `scope` matches the filter are delivered to your endpoint.

::: warning Historical implementation divergence — cycles-server-admin 0.1.25.48 and earlier
**Resolved in current releases:** cycles-server-admin **0.1.25.49** (2026-07-10) ships the spec-conformant admin matcher (and applies the same filter on the replay path), and cycles-server **0.1.25.47** refined the runtime matcher's two edge cases to the same semantics (blank/whitespace-only event scopes are treated as unscoped and excluded from filtered subscriptions; trailing-`/*` filters require a non-empty child segment). The two matchers are pinned to the same table of (filter, scope, expected) test cases, so on admin 0.1.25.49+ / runtime 0.1.25.47+ both planes match identically per the spec and cannot drift. The rest of this callout is history for deployments on older versions.

**Scope of the divergence (admin 0.1.25.48 and earlier):** it applies only to **admin-plane-emitted events** (tenant, api_key, policy, webhook lifecycle, and admin-initiated budget events) plus **replay**. Runtime-emitted events (reservations, runtime budget events — the bulk of webhook volume) have always been matched by the runtime server's own matcher, which already implemented the spec semantics below (exact match, trailing-`*` prefix, null scope excluded; the two edge cases refined in 0.1.25.47 — see [Edge cases](#edge-cases)). In other words: on admin 0.1.25.48 and earlier, the *same filter* matched differently depending on which plane emitted the event.

The admin OpenAPI spec (normative, and described first below) defines exact-match semantics with an optional trailing `*` wildcard. The **admin server's** matcher (`WebhookRepository.matchesScope`, 0.1.25.48 and earlier) instead did **literal prefix matching**: a blank filter matches everything, a null event scope always matches, and otherwise the event scope must `startsWith(scope_filter)` — with a bare `"*"` filter special-cased to match everything. Three practical consequences for admin-plane events on those versions:

1. **Trailing-`/*` filters match no admin-plane events.** The admin matcher compares the `*` literally, and real scopes never contain a `*` — so a spec-form filter delivers runtime events but silently misses admin-plane events until 0.1.25.49.
2. **A filter without `*` is a prefix, not an exact match.** `tenant:acme-corp/workspace:prod` also matches `tenant:acme-corp/workspace:prod/workflow:support` (and even `tenant:acme-corp/workspace:prod-eu`, since matching is character-wise). End the filter with `/` to bound it to child scopes.
3. **Events with a null scope ARE delivered** to scope-filtered subscriptions (a null scope matches every filter), rather than being excluded.

**Recommendation:** write filters in the spec's `/*` form. It matches runtime-emitted events on every version and both planes on admin 0.1.25.49+ / runtime 0.1.25.47+. There is no single filter form that matches child scopes on both planes on admin 0.1.25.48 and earlier: `/*` misses admin events, bare-prefix misses runtime events. If you must catch both on those older versions, subscribe without a `scope_filter` and filter client-side on the envelope `scope`. Upgrading to 0.1.25.49 is a **behavior change** for existing prefix-style filters — see the [release's migration notes](https://github.com/runcycles/cycles-server-admin/releases/tag/v0.1.25.49) (bare-prefix filters must be rewritten as `…/*`; "base + descendants" coverage now needs two subscriptions).
:::

## Matching rules (spec semantics — normative)

Per the admin OpenAPI spec, the scope filter supports two modes:

### Exact match (no wildcard)

The event scope must exactly equal the filter string.

```json
{
  "scope_filter": "tenant:acme-corp/workspace:prod"
}
```

Under spec semantics this delivers events **only** when the event scope is exactly `tenant:acme-corp/workspace:prod`; events scoped to `tenant:acme-corp/workspace:prod/workflow:support` would **not** match. **Admin plane, 0.1.25.48 and earlier:** this filter is treated as a prefix, so child-scope admin events *do* match (consequence 2 above). The runtime matcher applies the exact-match spec semantics.

### Prefix match (trailing wildcard)

A filter ending with `*` matches any event scope that starts with the prefix before the `*`.

```json
{
  "scope_filter": "tenant:acme-corp/*"
}
```

Under spec semantics this delivers events for any scope under `tenant:acme-corp/`, including:
- `tenant:acme-corp/workspace:prod`
- `tenant:acme-corp/workspace:prod/workflow:support`
- `tenant:acme-corp/workspace:staging/agent:bot-1`

**Per plane (0.1.25.48 and earlier):** the runtime matcher handles this correctly; the admin matcher compares the `*` literally and delivers nothing (consequence 1 above).

### No filter (default)

If `scope_filter` is null, empty, or not provided, the subscription matches **all events** regardless of scope. Both semantics agree on this.

```json
{
  "scope_filter": null
}
```

## Syntax summary

| Filter | Spec semantics (normative; both planes on admin 0.1.25.49+ / runtime 0.1.25.47+) | Admin plane, 0.1.25.48 and earlier (prefix match) |
|---|---|---|
| `null` / empty / blank | All events | All events |
| `tenant:acme-corp` | Only scope exactly `tenant:acme-corp` | Any scope starting with `tenant:acme-corp` (including `tenant:acme-corpX`) |
| `tenant:acme-corp/` | Only scope exactly `tenant:acme-corp/` (unlikely to exist) | Any scope starting with `tenant:acme-corp/` |
| `tenant:acme-corp/*` | Scopes **under** `tenant:acme-corp/` — a non-empty child segment is required from cycles-server 0.1.25.47 onward (the degenerate empty-child scope `tenant:acme-corp/` matched on 0.1.25.46 and earlier) | Nothing (literal `*` never appears in real scopes) |
| `tenant:acme-corp/workspace:prod` | Only that exact scope | That scope and anything starting with it |
| `*` | Undefined by spec; the runtime matcher treats it as an empty-prefix trailing wildcard — any non-blank scope matches from cycles-server 0.1.25.47 onward (on 0.1.25.46 and earlier a blank `""` scope also matched, via the empty-prefix comparison) | All events (including null-scope) |
| *(any filter)* vs. null-scope event | Not delivered | Delivered |

## What's NOT supported

- **Mid-string wildcards** — `tenant:*/workspace:prod` does not work. In the spec, `*` is only meaningful at the end of the filter string; a mid-string `*` is treated as a literal character on both planes (and the pre-fix admin matcher treats even a trailing `*` as literal).
- **Multiple wildcards** — `tenant:acme-corp/*/workflow:*` is not valid.
- **Regex** — no regular expression matching is supported.
- **Glob patterns** — `?`, `[a-z]`, and other glob characters are treated as literal characters.
- **Multiple scope filters per subscription** — each subscription has a single `scope_filter` string. Create multiple subscriptions if you need to watch multiple unrelated scopes.

Under spec semantics — and the runtime matcher — a `*` anywhere other than the end of the filter string is treated as a **literal character** in an exact-match comparison (which almost certainly won't match any real scope). The pre-fix admin matcher (0.1.25.48 and earlier) treats every `*` as literal, including a trailing one.

## Examples

The examples below use the spec `/*` form — correct for runtime-emitted events on every version, and for both planes on cycles-server-admin 0.1.25.49+ / cycles-server 0.1.25.47+. (On admin 0.1.25.48 and earlier, admin-plane events will not match these filters; see the callout above.)

### Subscribe to all events for one tenant

A subscription must match on at least one selector, so at least one of `event_types` / `event_categories` must be non-empty — the server rejects the empty-both state with `400 INVALID_REQUEST` (governance revision v0.1.25.39; enforced since cycles-server-admin 0.1.25.50). The two arrays are additive (union) in delivery matching. Note the create/update asymmetry: `POST /v1/admin/webhooks` (and `/v1/webhooks`) requires a non-empty `event_types` specifically, while `PATCH` may clear `event_types` to empty as long as `event_categories` is non-empty — a **category-only** subscription is valid on update. To cover whole categories on create, pair a representative type with the category list. See [Category-based subscriptions](/how-to/managing-webhooks#category-based-subscriptions).

```bash
curl -X POST http://localhost:7979/v1/admin/webhooks \
  -H "X-Admin-API-Key: $ADMIN_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "url": "https://ops.example.com/cycles-events",
    "event_types": ["budget.exhausted"],
    "event_categories": ["budget", "reservation", "tenant"],
    "scope_filter": "tenant:acme-corp/*"
  }'
```

This covers the scope-filterable classes for one tenant. It intentionally omits the admin-only categories (`api_key`, `policy`, `webhook`, `system`): most admin events are **null-scoped**, so a `scope_filter` excludes them — you can't narrow admin events to one tenant with `scope_filter`. For per-tenant admin monitoring, filter client-side on the envelope `tenant_id` instead (see [Tenant-accessible events](/protocol/webhook-event-delivery-protocol#tenant-accessible-events)). Note this is a `__system__`-owned subscription (admin key, no `tenant_id`); a **tenant-owned** subscription can't carry admin-only categories at all.

### Subscribe to one specific workspace

```bash
curl -X POST http://localhost:7979/v1/admin/webhooks \
  -H "X-Admin-API-Key: $ADMIN_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "url": "https://ops.example.com/prod-alerts",
    "event_types": ["budget.exhausted", "reservation.denied"],
    "scope_filter": "tenant:acme-corp/workspace:prod/*"
  }'
```

This delivers only `budget.exhausted` and `reservation.denied` events (runtime-emitted) where the scope starts with `tenant:acme-corp/workspace:prod/`.

### No scope filter — receive everything

```bash
curl -X POST http://localhost:7979/v1/admin/webhooks \
  -H "X-Admin-API-Key: $ADMIN_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "url": "https://ops.example.com/all-events",
    "event_types": ["budget.exhausted"],
    "event_categories": ["budget", "reservation", "tenant", "api_key", "policy", "webhook", "system"]
  }'
```

`scope_filter` omitted — this subscription receives matching events from all scopes (including unscoped events). All-categories `event_categories` plus a representative `event_types` entry is the "everything" form on **create**, where `event_types` must be non-empty; on a later `PATCH` the type could be cleared, leaving the all-categories subscription category-only. The two arrays are a union in delivery matching. This is a `__system__`-owned subscription (admin key, no `tenant_id`), so the admin-only categories are permitted; a **tenant-owned** subscription (`/v1/webhooks`, or `/v1/admin/webhooks?tenant_id=X`) may carry only `budget` / `reservation` / `tenant` (governance INVARIANT 2 — see [Tenant-accessible events](/protocol/webhook-event-delivery-protocol#tenant-accessible-events)).

### Combining event type filter with scope filter

Both filters apply with AND logic. An event must match **both** the event type list and the scope filter to be delivered.

```bash
curl -X POST http://localhost:7979/v1/admin/webhooks \
  -H "X-Admin-API-Key: $ADMIN_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "url": "https://ops.example.com/cost-alerts",
    "event_types": ["budget.exhausted", "budget.over_limit_entered"],
    "scope_filter": "tenant:acme-corp/workspace:prod/*"
  }'
```

This delivers only `budget.exhausted` **or** `budget.over_limit_entered` events (runtime-emitted) **and** only when the scope starts with `tenant:acme-corp/workspace:prod/`.

## Events without scope

Some events may not have a `scope` field (null). The two semantics differ:

- **Spec semantics (normative):** when `scope_filter` is set and an event has a null scope, the event is **not delivered** to that subscription. Use a separate subscription without a scope filter to capture unscoped events.
- **Per plane:** the runtime matcher follows the spec (null scope excluded from filtered subscriptions — `EventEmitterRepository.matchesScope`); the admin plane on 0.1.25.48 and earlier delivers null-scope events to every filter (fixed in cycles-server-admin 0.1.25.49).

::: tip Note on `reservation.commit_overage`
As of cycles-server v0.1.25.46, `reservation.commit_overage` is emitted **with** the reservation's scope path on the envelope, so it participates in scope filtering like any other scoped event. (Earlier releases emitted it with a null envelope scope, in which case the null-scope rules above applied.)
:::

## Edge cases

- **Whitespace-only filter** (e.g., `"   "`): Treated the same as null — matches all events (both semantics).
- **Filter `"*"` alone**: Under spec semantics this is undefined (arguably an exact match against a scope literally equal to `*`). The runtime matcher treats it as "match any scoped event": from cycles-server 0.1.25.47 onward, blank/whitespace-only scopes are treated as unscoped and excluded — the same semantics as the admin matcher since cycles-server-admin 0.1.25.49; on runtime 0.1.25.46 and earlier, a blank `""` scope still matched via the empty-prefix comparison. Only the admin plane on 0.1.25.48 and earlier matches **all** events including null-scope ones. Prefer omitting `scope_filter` entirely to mean "everything".
- **Blank event scopes** (`""` or whitespace-only): From cycles-server 0.1.25.47 (runtime) and cycles-server-admin 0.1.25.49 onward, blank and null scopes are both treated as unscoped — excluded from every scope-filtered subscription. On runtime 0.1.25.46 and earlier, only `null` was checked (a blank scope could match the bare `*` filter); on admin 0.1.25.48 and earlier, null-scope events match every filter.
- **Empty-child scopes against trailing `/*`** (e.g., event scope `tenant:acme-corp/` against filter `tenant:acme-corp/*`): From cycles-server 0.1.25.47 onward, the runtime matcher requires a non-empty remainder after the prefix — `tenant:acme-corp/` no longer matches (the spec says "all scopes **under** acme-corp"). On 0.1.25.46 and earlier it matched via plain `startsWith`. Unchanged on both: the bare base scope `tenant:acme-corp` (no trailing slash) never matches a `…/*` filter on the runtime plane.

## Related

- [Managing Webhooks](/how-to/managing-webhooks) — creating, updating, and testing subscriptions
- [Webhook Event Delivery Protocol](/protocol/webhook-event-delivery-protocol) — delivery mechanics, retry schedule, signatures
- [Event Payloads Reference](/protocol/event-payloads-reference) — payload schemas for all event types
