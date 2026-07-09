---
title: "Webhook Scope Filter Syntax"
description: "How to filter webhook events by scope using scope_filter on subscriptions — spec wildcard syntax, plus the reference implementation's prefix-match divergence."
---

# Webhook Scope Filter Syntax

Webhook subscriptions can filter events by scope path using the `scope_filter` field. When set, only events whose `scope` matches the filter are delivered to your endpoint.

::: danger Reference implementation divergence — cycles-server-admin 0.1.25.48 and earlier
**Scope of the divergence:** it applies only to **admin-plane-emitted events** (tenant, api_key, policy, webhook lifecycle, and admin-initiated budget events) plus **replay**. Runtime-emitted events (reservations, runtime budget events — the bulk of webhook volume) have always been matched by the runtime server's own matcher, which already implements the spec semantics below (exact match, trailing-`*` prefix, null scope excluded). In other words: on 0.1.25.48 and earlier, the *same filter* matched differently depending on which plane emitted the event.

**Update:** a spec-conformance fix is queued for the next cycles-server-admin release, after which both planes match identically per the spec (with one refinement on the admin side: a blank or null event scope is treated as unscoped, and the replay path applies the same filter).

The admin OpenAPI spec (normative, and described first below) defines exact-match semantics with an optional trailing `*` wildcard. The reference implementation's matcher (`WebhookRepository.matchesScope`) instead does **literal prefix matching**: a blank filter matches everything, a null event scope always matches, and otherwise the event scope must `startsWith(scope_filter)` — with a bare `"*"` filter special-cased to match everything. Three practical consequences when running against the reference server:

1. **Trailing-`/*` filters match no admin-plane events.** The admin matcher compares the `*` literally, and real scopes never contain a `*` — so a spec-form filter delivers runtime events but silently misses admin-plane events until the fix ships.
2. **A filter without `*` is a prefix, not an exact match.** `tenant:acme-corp/workspace:prod` also matches `tenant:acme-corp/workspace:prod/workflow:support` (and even `tenant:acme-corp/workspace:prod-eu`, since matching is character-wise). End the filter with `/` to bound it to child scopes.
3. **Events with a null scope ARE delivered** to scope-filtered subscriptions (a null scope matches every filter), rather than being excluded.

**Recommendation:** write filters in the spec's `/*` form. It matches runtime-emitted events (the bulk of webhook volume) today and becomes fully correct — both planes — once the conformance fix ships. There is no single filter form that matches child scopes on both planes on 0.1.25.48 and earlier: `/*` misses admin events, bare-prefix misses runtime events. If you must catch both before the fix, subscribe without a `scope_filter` and filter client-side on the envelope `scope`.
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

Under spec semantics this delivers events **only** when the event scope is exactly `tenant:acme-corp/workspace:prod`; events scoped to `tenant:acme-corp/workspace:prod/workflow:support` would **not** match. **Reference implementation:** this filter is treated as a prefix, so child scopes *do* match (consequence 2 above).

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

**Reference implementation (0.1.25.48 and earlier):** the runtime plane matches this correctly; the admin plane compares the `*` literally and delivers nothing (consequence 1 above).

### No filter (default)

If `scope_filter` is null, empty, or not provided, the subscription matches **all events** regardless of scope. Both semantics agree on this.

```json
{
  "scope_filter": null
}
```

## Syntax summary

| Filter | Spec semantics (normative; runtime plane today) | Admin plane, 0.1.25.48 and earlier (prefix match) |
|---|---|---|
| `null` / empty / blank | All events | All events |
| `tenant:acme-corp` | Only scope exactly `tenant:acme-corp` | Any scope starting with `tenant:acme-corp` (including `tenant:acme-corpX`) |
| `tenant:acme-corp/` | Only scope exactly `tenant:acme-corp/` (unlikely to exist) | Any scope starting with `tenant:acme-corp/` |
| `tenant:acme-corp/*` | Scopes starting with `tenant:acme-corp/` | Nothing (literal `*` never appears in real scopes) |
| `tenant:acme-corp/workspace:prod` | Only that exact scope | That scope and anything starting with it |
| `*` | Undefined by spec (a `*`-only wildcard is not exact match) | All events |
| *(any filter)* vs. null-scope event | Not delivered | Delivered |

## What's NOT supported

- **Mid-string wildcards** — `tenant:*/workspace:prod` does not work. In the spec, `*` is only meaningful at the end of the filter string; the reference implementation treats any `*` as a literal character.
- **Multiple wildcards** — `tenant:acme-corp/*/workflow:*` is not valid.
- **Regex** — no regular expression matching is supported.
- **Glob patterns** — `?`, `[a-z]`, and other glob characters are treated as literal characters.
- **Multiple scope filters per subscription** — each subscription has a single `scope_filter` string. Create multiple subscriptions if you need to watch multiple unrelated scopes.

Under spec semantics, a `*` anywhere other than the end of the filter string is treated as a **literal character** in an exact-match comparison (which almost certainly won't match any real scope). Under the reference implementation, every `*` is literal, including a trailing one.

## Examples

The examples below use the spec `/*` form — correct for runtime-emitted events today and for both planes once the admin conformance fix ships. (On 0.1.25.48 and earlier, admin-plane events will not match these filters; see the callout above.)

### Subscribe to all events for one tenant

```bash
curl -X POST http://localhost:7979/v1/admin/webhooks \
  -H "X-Admin-API-Key: $ADMIN_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "url": "https://ops.example.com/cycles-events",
    "event_types": [],
    "scope_filter": "tenant:acme-corp/*"
  }'
```

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
    "event_types": []
  }'
```

Both `event_types` and `scope_filter` omitted — this subscription receives all events from all scopes.

### Combining event type filter with scope filter

Both filters apply with AND logic. An event must match **both** the event type list and the scope filter to be delivered.

```bash
curl -X POST http://localhost:7979/v1/admin/webhooks \
  -H "X-Admin-API-Key: $ADMIN_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "url": "https://ops.example.com/cost-alerts",
    "event_types": ["budget.exhausted", "budget.over_limit_entered"],
    "scope_filter": "tenant:acme-corp/workspace:prod/"
  }'
```

This delivers only `budget.exhausted` **or** `budget.over_limit_entered` events **and** only when the scope starts with `tenant:acme-corp/workspace:prod/`.

## Events without scope

Some events may not have a `scope` field (null). The two semantics differ:

- **Spec semantics (normative):** when `scope_filter` is set and an event has a null scope, the event is **not delivered** to that subscription. Use a separate subscription without a scope filter to capture unscoped events.
- **Reference implementation:** a null event scope matches **every** filter, so unscoped events are delivered to scope-filtered subscriptions too.

::: tip Note on `reservation.commit_overage`
As of v0.1.25, the `reservation.commit_overage` event is emitted with a null envelope scope. Under spec semantics, scope-filtered subscriptions would not match it; the reference implementation **does** deliver it to scope-filtered subscriptions (null scope matches every filter). If you rely on strict spec behavior, also keep a subscription without a scope filter (or filtered by event type only) to capture commit overage events.
:::

## Edge cases

- **Whitespace-only filter** (e.g., `"   "`): Treated the same as null — matches all events (both semantics).
- **Filter `"*"` alone**: Under spec semantics this is undefined (arguably an exact match against a scope literally equal to `*`). The reference implementation special-cases it to match **all** events, including null-scope events. Prefer omitting `scope_filter` entirely to mean "everything".
- **Events with some scope fields emitted as null**: On 0.1.25.48 and earlier, only `null` scope is checked — an empty string scope (`""`) is not treated as missing. From the conformance fix onward, blank and null scopes are both treated as unscoped (excluded from scope-filtered subscriptions).

## Related

- [Managing Webhooks](/how-to/managing-webhooks) — creating, updating, and testing subscriptions
- [Webhook Event Delivery Protocol](/protocol/webhook-event-delivery-protocol) — delivery mechanics, retry schedule, signatures
- [Event Payloads Reference](/protocol/event-payloads-reference) — payload schemas for all event types
