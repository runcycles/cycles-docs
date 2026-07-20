---
title: "Action Governance Preview in Cycles"
description: "Preview the v0.1.26 action-kind registry, action quotas, allow/deny action lists, observe mode, and action-quota counter APIs in Cycles."
---

# Action Governance Preview in Cycles

::: warning Preview status
The v0.1.26 action-governance specs are upcoming extension specs. The active v0.1.25 conformance target is still the required implementation surface, and the current reference servers do not enforce v0.1.26 action quotas or action-kind allow/deny lists at runtime.

Some v0.1.25.x admin endpoints accept forward-compatible query parameters described below, but those parameters are compatibility hooks until a server implements the v0.1.26 extension semantics.
:::

Action governance adds a second authority layer alongside spend budgets: a server can meter and block by **what kind of action** an agent is about to execute, not only by how much budget the action consumes.

Budgets still answer "can this tenant spend more?" Action governance answers questions such as:

- Can this agent send email at all?
- Has this run already used its five `message.email.send` calls?
- Are high-risk actions limited more tightly than read-only actions?
- Can this policy be observed in shadow mode before it starts blocking production traffic?

## Spec Files

The preview is split across three YAML specs in [`runcycles/cycles-protocol`](https://github.com/runcycles/cycles-protocol):

| Spec | Owns |
|---|---|
| [`cycles-action-kinds-v0.1.26.yaml`](https://github.com/runcycles/cycles-protocol/blob/main/cycles-action-kinds-v0.1.26.yaml) | Canonical action-kind registry, risk classes, quota windows, action quota schemas, `GET /v1/action-kinds`, `GET /v1/action-kinds/{kind}`, `GET /v1/admin/action-quota-counters`, and `POST /v1/admin/action-quota-counters/reset` |
| [`cycles-protocol-extensions-v0.1.26.yaml`](https://github.com/runcycles/cycles-protocol/blob/main/cycles-protocol-extensions-v0.1.26.yaml) | Runtime behavior: `DenyDetail`, `ObserveModeEnum`, action-governance reason codes, observed events, quota events, and full reservation evaluation order |
| [`cycles-governance-extensions-v0.1.26.yaml`](https://github.com/runcycles/cycles-protocol/blob/main/cycles-governance-extensions-v0.1.26.yaml) | Admin-plane extensions: `Policy.action_quotas`, `Policy.risk_class_quotas`, `Policy.allowed_action_kinds`, `Policy.denied_action_kinds`, `Tenant.observe_mode`, overview aggregates, and preview list filters |

The YAML files remain the authority. This page is the human-readable map.

## Action Kinds

An action kind is a stable string for the operation an agent is about to perform, such as `llm.completion`, `web.search`, `message.email.send`, or `code.exec`.

Each kind belongs to an `ActionRiskClass`:

| Risk class | Meaning |
|---|---|
| `read_only` | Reads state without mutation |
| `local_mutation` | Mutates local or reversible state |
| `side_effect` | Produces effects that can drive downstream work |
| `external_side_effect` | Mutates an external system |
| `high_risk` | High-blast-radius action that should usually be explicitly allowed |

Servers implementing the action-kind registry expose:

```bash
curl -G "http://localhost:7878/v1/action-kinds" \
  --data-urlencode "risk_class=external_side_effect" \
  --data-urlencode "deprecated=false" \
  --data-urlencode "limit=50"
```

`GET /v1/action-kinds` is public in the preview spec and supports `risk_class`, `deprecated`, `cursor`, and `limit`. `GET /v1/action-kinds/{kind}` performs an exact lookup:

```bash
curl "http://localhost:7878/v1/action-kinds/message.email.send"
```

## Policy Fields

The governance extension adds four policy fields:

| Field | Purpose |
|---|---|
| `action_quotas` | Per-action count quota rules, such as five email sends per run |
| `risk_class_quotas` | Aggregate count quota rules by risk class, such as two `high_risk` actions per day |
| `allowed_action_kinds` | Allowlist; when non-empty, only listed kinds may pass |
| `denied_action_kinds` | Denylist; listed kinds are blocked before quota and budget checks |

`allowed_action_kinds` and `denied_action_kinds` are mutually exclusive when both are non-empty. A server implementing v0.1.26 must reject that policy shape instead of guessing precedence.

Tenant records also gain `observe_mode` with values `ENFORCE`, `OBSERVE`, and `DISABLED`. `ENFORCE` is normal behavior. `OBSERVE` evaluates the rules and emits observed events without mutating balances or quota counters. `DISABLED` is a synonym for `ENFORCE` in the extension spec.

## Evaluation Order

For a reservation request, v0.1.26 servers evaluate action governance before budget reservation:

1. Action-kind access control from `denied_action_kinds` and `allowed_action_kinds`.
2. Risk-class quotas from `risk_class_quotas`.
3. Per-kind quotas from `action_quotas`.
4. Budget checks and caps from the existing Cycles reserve/decide model.
5. Atomic reservation and counter mutation when the request is allowed and not in observe/dry-run mode.

That order matters. A denied action kind never consumes quota and never reaches the budget check. In `OBSERVE` mode, the server performs the same evaluation but does not mutate balances or quota counters.

## Quota Windows

Action quotas use `ActionQuotaWindow`:

| Window | Use |
|---|---|
| `per_run` | Tied to `Subject.dimensions.run_id`; requires a run id |
| `per_minute_tumbling` | UTC-minute bucket for burst control |
| `per_hour_tumbling` | UTC-hour bucket |
| `per_day_tumbling` | UTC-day bucket |
| `per_tenant_per_day` | Tenant-root daily bucket, independent of nested subject scope |

Per-kind quotas and risk-class quotas use the same window model. A single allowed reservation may increment both a per-kind counter and a risk-class counter when both rules match.

## Counter APIs

Servers implementing the preview expose an operator view of live counters:

```bash
curl -G "http://localhost:7979/v1/admin/action-quota-counters" \
  -H "X-Admin-API-Key: $ADMIN_KEY" \
  --data-urlencode "tenant_id=acme-corp" \
  --data-urlencode "scope=tenant:acme-corp" \
  --data-urlencode "action_kind=message.email.send" \
  --data-urlencode "window=per_run" \
  --data-urlencode "run_id=run_123" \
  --data-urlencode "include_zero=false"
```

`GET /v1/admin/action-quota-counters` is a debug/read endpoint for current counter state. The preview adds an `action_quotas:read` permission; v0.1.26 also allows `balances:read` as a deprecated fallback, with the fallback removed in v0.1.27.

Counter reset is intentionally narrow:

```bash
curl -X POST "http://localhost:7979/v1/admin/action-quota-counters/reset" \
  -H "Content-Type: application/json" \
  -H "X-Admin-API-Key: $ADMIN_KEY" \
  -d '{
    "tenant_id": "acme-corp",
    "scope": "tenant:acme-corp/workspace:prod/agent:support-bot",
    "action_kind": "message.email.send",
    "window": "per_run",
    "window_key": "run_123",
    "reason": "incident response: undo double-counted email send"
  }'
```

`POST /v1/admin/action-quota-counters/reset` is AdminKeyAuth-only in v0.1.26. It resets exactly one counter identified by `tenant_id`, `scope`, `action_kind`, `window`, and `window_key`; bulk reset is not part of the preview. Risk-class counters use `action_kind="__risk__"` and include `risk_class`. Every successful reset emits a `quota.counter_reset` event.

## Deny And Event Surface

The runtime extension adds `DenyDetail` to denied decisions and conflict errors. For action governance, known reason codes include:

| Reason code | Meaning |
|---|---|
| `ACTION_KIND_DENIED` | The matching policy's denylist blocked the kind |
| `ACTION_KIND_NOT_ALLOWED` | The matching policy's allowlist did not include the kind |
| `ACTION_QUOTA_EXCEEDED` | A per-kind or risk-class quota was exhausted |

When `reason_code=ACTION_QUOTA_EXCEEDED`, `deny_detail.quota_violation` carries structured quota context such as action kind, window, used count, limit, scope, and policy id.

The preview also defines:

- `reservation.observed_denied` for `OBSERVE` evaluations that would deny.
- `reservation.observed_allowed` for `OBSERVE` evaluations that would allow.
- `quota.threshold_approaching` when a quota counter crosses a configured threshold.
- `quota.counter_reset` when an admin resets a counter through the reset API.

## Admin Compatibility Fields

The governance extension reserves several dashboard and list fields. Their semantics are:

| Surface | Field or filter | v0.1.26 meaning |
|---|---|---|
| `GET /v1/admin/overview` | `recent_denials_by_reason` | Count recent denials by reason code, including action-governance reason codes when implemented |
| `GET /v1/admin/overview` | `quota_health` | Summarize action quota counters near or at their limit |
| `GET /v1/admin/overview` | `access_control_stats` | Count policies using allow/deny action-kind lists and related denial activity |
| `GET /v1/admin/overview` | `tenant_counts.in_observe_mode` | Count tenants with `observe_mode != ENFORCE` |
| `GET /v1/admin/tenants` | `observe_mode` | Filter tenants by `DISABLED`, `OBSERVE`, or `ENFORCE` |
| `GET /v1/admin/policies` | `has_action_quotas` | Filter policies with non-empty `action_quotas` or `risk_class_quotas` |
| `GET /v1/admin/policies` | `references_action_kind` | Filter policies whose `action_quotas`, `allowed_action_kinds`, or `denied_action_kinds` mention the given kind; `risk_class_quotas` entries do not match, since they name risk classes rather than kinds |

On v0.1.25.x reference admin servers, `observe_mode`, `has_action_quotas`, and `references_action_kind` are accepted as forward-compatible query parameters but do not narrow results until the v0.1.26 action-governance extension is implemented.

## Implementation Checklist

- Keep the v0.1.25 conformance target green before adding preview behavior.
- Publish `GET /v1/action-kinds` and `GET /v1/action-kinds/{kind}` before allowing policies to reference custom kinds.
- Reject unknown `custom.*` kinds unless the server has an explicit declaration for them.
- Evaluate access control before quotas, and quotas before budget checks.
- Emit observed events in `OBSERVE` mode without mutating balances or quota counters.
- Treat reason-code strings as open values in dashboards and SDKs so future extensions do not break clients.

## Next Steps

- [Protocol Overview](/protocol/) - current conformance target and spec file map.
- [Dry Run and Shadow Mode](/protocol/dry-run-shadow-mode-evaluation-in-cycles) - existing dry-run behavior that observe mode builds on.
- [Error Codes and Error Handling](/protocol/error-codes-and-error-handling-in-cycles) - base and extension denial semantics.
- [Using the Cycles Dashboard](/how-to/using-the-cycles-dashboard) - how overview fields surface in operator workflows.
