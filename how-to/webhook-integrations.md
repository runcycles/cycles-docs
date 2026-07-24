---
title: Webhook Integrations
description: Connect Cycles webhook events to PagerDuty, Slack, ServiceNow, and custom receivers
---

# Webhook Integrations

Cycles emits webhook events from implemented budget, reservation, API-key, tenant, and other lifecycle hooks. The schema also registers planned event types that are not emitted yet; check the [Event Payloads Reference](/protocol/event-payloads-reference) for current status. This guide shows concrete payload examples and integrations with common services.

::: info How webhooks are delivered
Webhook subscriptions are **configured** via the Admin Server (port 7979). Events are **delivered** by the [Cycles Events Service](/quickstart/deploying-the-events-service) — a separate, optional outbound worker that consumes from Redis and posts to your endpoints with HMAC-SHA256 signatures. The Events Service must be deployed for webhook delivery to work.
:::

## Webhook Payload Examples

### reservation.denied

Emitted when a dry-run reservation or `/v1/decide` evaluation returns `DENY` (budget exceeded, overdraft limit, etc.). The current live reservation error path returns a 4xx response and does not emit this event; monitor the runtime denial counter or application errors for live failures.

```json
{
  "event_id": "evt_a1b2c3d4e5f67890",
  "event_type": "reservation.denied",
  "category": "reservation",
  "timestamp": "2026-04-01T14:32:01.456Z",
  "tenant_id": "acme-corp",
  "scope": "tenant:acme-corp/workspace:prod/agent:support-bot",
  "actor": {
    "type": "api_key",
    "key_id": "key_9f8e7d6c-5b4a-3210"
  },
  "source": "cycles-server",
  "data": {
    "scope": "tenant:acme-corp/workspace:prod/agent:support-bot",
    "reason_code": "BUDGET_EXCEEDED",
    "requested_amount": 5000000
  },
  "request_id": "req_abc123"
}
```

### budget.exhausted

Emitted once when remaining budget transitions from above zero to zero.

```json
{
  "event_id": "evt_f0e1d2c3b4a59687",
  "event_type": "budget.exhausted",
  "category": "budget",
  "timestamp": "2026-04-01T14:32:00.123Z",
  "tenant_id": "acme-corp",
  "scope": "tenant:acme-corp/workspace:prod",
  "actor": {
    "type": "api_key",
    "key_id": "key_9f8e7d6c-5b4a-3210"
  },
  "source": "cycles-server",
  "data": {
    "scope": "tenant:acme-corp/workspace:prod",
    "unit": "USD_MICROCENTS",
    "threshold": 1.0,
    "utilization": 1.0,
    "allocated": 10000000,
    "remaining": 0,
    "spent": 9000000,
    "reserved": 1000000,
    "direction": "rising"
  }
}
```

The payload is the balance snapshot that caused the transition; the envelope identifies the tenant, scope, and actor. Query the balance API before remediation because the ledger may have changed since emission.

### reservation.commit_overage

Emitted when a commit's actual amount exceeds its reservation estimate. The current v0.1.25.46+ runtime populates all eight data fields:

```json
{
  "event_id": "evt_1122334455667788",
  "event_type": "reservation.commit_overage",
  "category": "reservation",
  "timestamp": "2026-04-01T13:15:00.789Z",
  "tenant_id": "acme-corp",
  "scope": "tenant:acme-corp/workflow:support",
  "source": "cycles-server",
  "data": {
    "reservation_id": "res_a1b2c3d4",
    "scope": "tenant:acme-corp/workflow:support",
    "unit": "USD_MICROCENTS",
    "estimated_amount": 40000000,
    "actual_amount": 48000000,
    "overage": 8000000,
    "overage_policy": "ALLOW_IF_AVAILABLE",
    "debt_incurred": 0
  }
}
```

`budget.threshold_crossed` is registered in the governance schema but is not emitted by the current reference runtime. Build pre-exhaustion alerts from balance polling or application metrics.

### budget.over_limit_entered

Emitted when debt exceeds overdraft_limit.

```json
{
  "event_id": "evt_aabbccdd11223344",
  "event_type": "budget.over_limit_entered",
  "category": "budget",
  "timestamp": "2026-04-01T14:45:12.345Z",
  "tenant_id": "acme-corp",
  "scope": "tenant:acme-corp/workspace:prod",
  "source": "cycles-server",
  "data": {
    "scope": "tenant:acme-corp/workspace:prod",
    "unit": "USD_MICROCENTS",
    "debt": 15000000,
    "overdraft_limit": 10000000,
    "is_over_limit": true,
    "debt_utilization": 1.5
  }
}
```

### tenant.suspended

Emitted when a tenant is suspended.

```json
{
  "event_id": "evt_5566778899aabbcc",
  "event_type": "tenant.suspended",
  "category": "tenant",
  "timestamp": "2026-04-01T09:00:00.000Z",
  "tenant_id": "acme-corp",
  "source": "cycles-admin",
  "actor": {
    "type": "admin"
  },
  "data": {
    "tenant_id": "acme-corp",
    "new_status": "SUSPENDED",
    "changed_fields": ["status"]
  }
}
```

### api_key.auth_failed

Emitted when authentication fails (invalid or revoked key).

```json
{
  "event_id": "evt_ddee0011ff223344",
  "event_type": "api_key.auth_failed",
  "category": "api_key",
  "timestamp": "2026-04-01T11:22:33.456Z",
  "tenant_id": "acme-corp",
  "source": "cycles-admin",
  "data": {
    "key_id": "key_expired_abc",
    "failure_reason": "KEY_EXPIRED",
    "source_ip": "203.0.113.42"
  }
}
```

## Webhook Delivery Headers

Every webhook POST includes these headers:

```http
POST /your-webhook-endpoint HTTP/1.1
Content-Type: application/json
X-Cycles-Event-Id: evt_a1b2c3d4e5f67890
X-Cycles-Event-Type: reservation.denied
X-Cycles-Trace-Id: 4bf92f3577b34da6a3ce929d0e0e4736
traceparent: 00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01
X-Cycles-Signature: sha256=a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2
User-Agent: cycles-server-events/0.1.25.23
```

`X-Cycles-Trace-Id` and W3C `traceparent` are always present — use them to join the delivery back to the originating request across the audit log, events, and delivery records. Two headers are conditional: `X-Request-Id` is sent when the originating event carries a `request_id`, and `X-Cycles-Signature` is sent when the subscription has a signing secret. Any custom headers configured on the subscription are also included, except names that collide with the reserved set above (reserved names are ignored with a warning). The `User-Agent` version tracks the deployed events-service version.

## Signature Verification

Always verify the `X-Cycles-Signature` header before processing a webhook:

### Python

```python
import hmac
import hashlib

def verify_webhook(body: bytes, secret: str, signature: str) -> bool:
    expected = "sha256=" + hmac.new(
        secret.encode("utf-8"), body, hashlib.sha256
    ).hexdigest()
    return hmac.compare_digest(expected, signature)

# In your Flask/FastAPI handler:
@app.post("/webhook")
async def handle_webhook(request: Request):
    body = await request.body()
    sig = request.headers.get("X-Cycles-Signature", "")
    if not verify_webhook(body, SIGNING_SECRET, sig):
        return Response(status_code=401)

    event = json.loads(body)
    event_type = event["event_type"]
    # Route to handler...
```

### Node.js

```javascript
const crypto = require('crypto');

function verifyWebhook(body, secret, signature) {
  const expected = 'sha256=' + crypto
    .createHmac('sha256', secret)
    .update(body)
    .digest('hex');
  if (expected.length !== signature.length) return false;
  return crypto.timingSafeEqual(
    Buffer.from(expected),
    Buffer.from(signature)
  );
}

// In Express:
app.post('/webhook', express.raw({ type: 'application/json' }), (req, res) => {
  const sig = req.headers['x-cycles-signature'] || '';
  if (!verifyWebhook(req.body, SIGNING_SECRET, sig)) {
    return res.status(401).send('Invalid signature');
  }

  const event = JSON.parse(req.body.toString());
  console.log(`Event: ${event.event_type} for tenant ${event.tenant_id}`);
  res.status(200).json({ received: true });
});
```

### Go

```go
import (
    "crypto/hmac"
    "crypto/sha256"
    "encoding/hex"
)

func verifyWebhook(body []byte, secret, signature string) bool {
    mac := hmac.New(sha256.New, []byte(secret))
    mac.Write(body)
    expected := "sha256=" + hex.EncodeToString(mac.Sum(nil))
    return hmac.Equal([]byte(expected), []byte(signature))
}
```

### Java / Spring Boot

```java
import javax.crypto.Mac;
import javax.crypto.spec.SecretKeySpec;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;

@RestController
public class WebhookController {

    @Value("${cycles.webhook.signing-secret}")
    private String signingSecret;

    @PostMapping("/webhook")
    public ResponseEntity<Void> handleWebhook(
            @RequestBody byte[] body,
            @RequestHeader("X-Cycles-Signature") String signature) {

        if (!verifySignature(body, signingSecret, signature)) {
            return ResponseEntity.status(401).build();
        }

        String json = new String(body, StandardCharsets.UTF_8);
        // Parse and route event...
        return ResponseEntity.ok().build();
    }

    private boolean verifySignature(byte[] body, String secret, String signature) {
        try {
            Mac mac = Mac.getInstance("HmacSHA256");
            mac.init(new SecretKeySpec(
                secret.getBytes(StandardCharsets.UTF_8), "HmacSHA256"));
            byte[] hash = mac.doFinal(body);
            StringBuilder hex = new StringBuilder("sha256=");
            for (byte b : hash) hex.append(String.format("%02x", b));
            // Constant-time comparison to prevent timing attacks
            return MessageDigest.isEqual(
                hex.toString().getBytes(StandardCharsets.UTF_8),
                signature.getBytes(StandardCharsets.UTF_8));
        } catch (Exception e) {
            return false;
        }
    }
}
```

::: tip Raw body required
Spring Boot parses JSON by default. Use `byte[]` as the parameter type (or configure `HttpMessageConverter`) to get the raw bytes for HMAC verification. If you parse JSON first, whitespace differences will produce a different hash.
:::
## Integration: PagerDuty

Route budget alerts to PagerDuty for on-call incident response.

### Setup

```bash
# Create subscription for budget and security alert events
curl -X POST http://localhost:7979/v1/admin/webhooks \
  -H "X-Admin-API-Key: $ADMIN_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "url": "https://your-middleware.example.com/cycles-to-pagerduty",
    "event_types": [
      "budget.exhausted",
      "budget.over_limit_entered",
      "reservation.commit_overage",
      "reservation.denied",
      "api_key.auth_failed"
    ],
    "signing_secret": "pd-webhook-secret-abc123",
    "disable_after_failures": 20
  }'
```

### Middleware (Python)

Transform Cycles events into PagerDuty Events API v2 format:

```python
import json
import requests

PAGERDUTY_ROUTING_KEY = "your-pagerduty-integration-key"

SEVERITY_MAP = {
    "budget.exhausted": "critical",
    "budget.over_limit_entered": "critical",
    "reservation.commit_overage": "warning",
    "reservation.denied": "warning",
    "api_key.auth_failed": "info",
}

@app.post("/cycles-to-pagerduty")
async def forward_to_pagerduty(request: Request):
    body = await request.body()
    # Verify signature first (see above)

    event = json.loads(body)
    severity = SEVERITY_MAP.get(event["event_type"], "info")

    pd_payload = {
        "routing_key": PAGERDUTY_ROUTING_KEY,
        "event_action": "trigger",
        "dedup_key": event["event_id"],  # Correlates retries to the same PD alert
        "payload": {
            "summary": f"[Cycles] {event['event_type']} — tenant: {event['tenant_id']}",
            "severity": severity,
            "source": event.get("scope", event["tenant_id"]),
            "component": event["source"],
            "group": event["category"],
            "custom_details": event.get("data", {})
        }
    }

    requests.post(
        "https://events.pagerduty.com/v2/enqueue",
        json=pd_payload
    )
    return {"ok": True}
```

### What triggers PagerDuty alerts

| Cycles Event | PagerDuty Severity | When |
|---|---|---|
| `budget.exhausted` | Critical | Remaining reached zero; new positive reservations deriving this scope and unit may be denied |
| `budget.over_limit_entered` | Critical | Debt exceeded overdraft limit; new reservations blocked until debt repaid |
| `reservation.commit_overage` | Warning | Actual usage exceeded the reservation estimate |
| `reservation.denied` | Warning | A dry-run or decide evaluation would deny |

## Integration: Slack

Post budget notifications to a Slack channel.

### Setup

```bash
# Subscribe to specific budget and tenant alert events
curl -X POST http://localhost:7979/v1/admin/webhooks \
  -H "X-Admin-API-Key: $ADMIN_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "url": "https://your-middleware.example.com/cycles-to-slack",
    "event_types": [
      "reservation.commit_overage",
      "budget.exhausted",
      "budget.over_limit_entered",
      "budget.funded",
      "reservation.denied",
      "tenant.suspended",
      "tenant.closed"
    ],
    "signing_secret": "slack-webhook-secret-xyz"
  }'
```

> **Note:** `event_categories` is additive with `event_types`. If you specify `"event_categories": ["budget"]`, you receive **all** `budget.*` events (17 types including `budget.created`, `budget.debited`, `budget.closed_via_tenant_cascade`, etc.), not just the ones in `event_types`. Use `event_types` alone when you want precise control over which events trigger notifications.

### Middleware (Node.js)

```javascript
const SLACK_WEBHOOK_URL = 'https://hooks.slack.com/services/T.../B.../xxx';

const EMOJI = {
  'budget.exhausted': ':rotating_light:',
  'budget.over_limit_entered': ':no_entry:',
  'reservation.commit_overage': ':warning:',
  'budget.funded': ':money_with_wings:',
  'reservation.denied': ':no_entry:',
  'tenant.suspended': ':pause_button:',
  'tenant.closed': ':stop_sign:',
};

// Format amount based on unit type (protocol supports multiple units)
function formatAmount(amount, unit) {
  switch (unit) {
    case 'USD_MICROCENTS': return `$${(amount / 100000000).toFixed(2)}`;
    case 'TOKENS':         return `${amount.toLocaleString()} tokens`;
    case 'CREDITS':        return `${amount.toLocaleString()} credits`;
    case 'RISK_POINTS':    return `${amount.toLocaleString()} risk points`;
    default:               return `${amount.toLocaleString()} ${unit || 'units'}`;
  }
}

app.post('/cycles-to-slack', express.raw({ type: 'application/json' }), async (req, res) => {
  // Verify signature first (see Signature Verification above)

  const event = JSON.parse(req.body.toString());
  const emoji = EMOJI[event.event_type] || ':bell:';
  const data = event.data || {};

  let text = `${emoji} *${event.event_type}*\n`;
  text += `Tenant: \`${event.tenant_id}\`\n`;
  if (event.scope) text += `Scope: \`${event.scope}\`\n`;

  if (data.utilization !== undefined) {
    text += `Utilization: ${(data.utilization * 100).toFixed(1)}%\n`;
  }
  if (data.remaining !== undefined) {
    text += `Remaining: ${formatAmount(data.remaining, data.unit)}\n`;
  }
  if (data.reason_code) {
    text += `Reason: ${data.reason_code}\n`;
  }
  if (data.estimated_amount !== undefined) {
    text += `Estimated: ${formatAmount(data.estimated_amount, data.unit)}\n`;
  }
  if (data.actual_amount !== undefined) {
    text += `Actual: ${formatAmount(data.actual_amount, data.unit)}\n`;
  }
  if (data.overage !== undefined) {
    text += `Overage: ${formatAmount(data.overage, data.unit)}\n`;
  }

  await fetch(SLACK_WEBHOOK_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      text,
      unfurl_links: false,
    }),
  });

  res.status(200).json({ ok: true });
});
```

### Example Slack messages

```
:warning: reservation.commit_overage
Tenant: `acme-corp`
Scope: `tenant:acme-corp/workflow:support`
Estimated: $0.40
Actual: $0.48
Overage: $0.08

:rotating_light: budget.exhausted
Tenant: `acme-corp`
Scope: `tenant:acme-corp/workspace:prod`
Utilization: 100.0%
Remaining: $0.00

:no_entry: reservation.denied
Tenant: `acme-corp`
Scope: `tenant:acme-corp/workspace:prod/agent:support-bot`
Reason: BUDGET_EXCEEDED
```

## Integration: ServiceNow

Create incidents in ServiceNow for critical budget events.

### Setup

```bash
curl -X POST http://localhost:7979/v1/admin/webhooks \
  -H "X-Admin-API-Key: $ADMIN_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "url": "https://your-middleware.example.com/cycles-to-servicenow",
    "event_types": [
      "budget.over_limit_entered",
      "budget.exhausted",
      "api_key.auth_failed"
    ],
    "signing_secret": "snow-secret-123"
  }'
```

### Middleware (Python)

```python
import hmac
import hashlib
import json
import requests

SNOW_INSTANCE = "yourcompany.service-now.com"
SNOW_USER = "cycles-integration"
SNOW_PASS = "..."
SIGNING_SECRET = "snow-secret-123"

PRIORITY_MAP = {
    "budget.over_limit_entered": "2",   # High
    "budget.exhausted": "2",            # High
    "api_key.auth_failed": "2",           # High
}

@app.post("/cycles-to-servicenow")
async def forward_to_snow(request: Request):
    body = await request.body()
    sig = request.headers.get("X-Cycles-Signature", "")
    expected = "sha256=" + hmac.new(
        SIGNING_SECRET.encode("utf-8"), body, hashlib.sha256
    ).hexdigest()
    if not hmac.compare_digest(expected, sig):
        return Response(status_code=401)

    event = json.loads(body)

    # NOTE: caller_id and assignment_group are reference fields. The values
    # below use display values, which requires sysparm_input_display_value=true.
    # For production, use sys_id values instead (e.g., "caller_id": "6816f79cc0a8016401c5a33be04be441")
    # or configure the API call with the display_value parameter.
    incident = {
        "short_description": f"Cycles: {event['event_type']} — {event['tenant_id']}",
        "description": json.dumps(event, indent=2),
        "urgency": PRIORITY_MAP.get(event["event_type"], "3"),
        "category": "Software",
        "subcategory": "Budget Governance",
        "caller_id": "cycles-system",
        "assignment_group": "Platform Engineering",
        "work_notes": f"Cycles event_id: {event['event_id']}\nCategory: {event['category']}",
    }

    requests.post(
        f"https://{SNOW_INSTANCE}/api/now/table/incident",
        json=incident,
        auth=(SNOW_USER, SNOW_PASS),
        headers={"Content-Type": "application/json"},
        params={"sysparm_input_display_value": "true"}  # Allows display names for reference fields
    )
    return {"ok": True}
```

## Integration: Datadog

Post budget events as Datadog Events for correlation with infrastructure metrics.

### Setup

```bash
curl -X POST http://localhost:7979/v1/admin/webhooks \
  -H "X-Admin-API-Key: $ADMIN_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "url": "https://your-middleware.example.com/cycles-to-datadog",
    "event_types": [
      "budget.exhausted",
      "budget.over_limit_entered",
      "reservation.commit_overage",
      "reservation.denied"
    ],
    "signing_secret": "dd-webhook-secret"
  }'
```

### Middleware (Python)

```python
import hmac
import hashlib
import json
import requests

DD_API_KEY = "your-datadog-api-key"
SIGNING_SECRET = "dd-webhook-secret"

ALERT_TYPE_MAP = {
    "budget.exhausted": "error",
    "budget.over_limit_entered": "error",
    "reservation.commit_overage": "warning",
    "reservation.denied": "warning",
}

@app.post("/cycles-to-datadog")
async def forward_to_datadog(request: Request):
    body = await request.body()
    sig = request.headers.get("X-Cycles-Signature", "")
    expected = "sha256=" + hmac.new(
        SIGNING_SECRET.encode("utf-8"), body, hashlib.sha256
    ).hexdigest()
    if not hmac.compare_digest(expected, sig):
        return Response(status_code=401)

    event = json.loads(body)
    data = event.get("data", {})

    dd_event = {
        "title": f"Cycles: {event['event_type']}",
        "text": f"Tenant: {event['tenant_id']}\nScope: {event.get('scope', 'N/A')}\nSource: {event['source']}",
        "alert_type": ALERT_TYPE_MAP.get(event["event_type"], "info"),
        "source_type_name": "cycles",
        "tags": [
            f"tenant:{event['tenant_id']}",
            f"event_type:{event['event_type']}",
            f"category:{event['category']}",
            f"source:{event['source']}",
        ],
    }

    if data.get("utilization") is not None:
        dd_event["text"] += f"\nUtilization: {data['utilization'] * 100:.1f}%"
    if data.get("scope"):
        dd_event["tags"].append(f"scope:{data['scope']}")

    requests.post(
        "https://api.datadoghq.com/api/v1/events",
        json=dd_event,
        headers={
            "DD-API-KEY": DD_API_KEY,
            "Content-Type": "application/json",
        },
    )
    return {"ok": True}
```

### Event overlays in Datadog

Budget events posted via the Events API appear in Datadog's [Events Explorer](https://docs.datadoghq.com/events/explorer/) and can be overlaid on Datadog dashboards. Use `tags` for filtering — e.g., show only `budget.exhausted` events on your cost dashboard.

## Integration: Microsoft Teams

Post budget alerts to a Teams channel using incoming webhooks.

### Setup

```bash
curl -X POST http://localhost:7979/v1/admin/webhooks \
  -H "X-Admin-API-Key: $ADMIN_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "url": "https://your-middleware.example.com/cycles-to-teams",
    "event_types": [
      "budget.exhausted",
      "budget.over_limit_entered",
      "reservation.commit_overage",
      "reservation.denied",
      "tenant.suspended"
    ],
    "signing_secret": "teams-webhook-secret"
  }'
```

### Middleware (Python)

Transform Cycles events into [Adaptive Card](https://learn.microsoft.com/en-us/microsoftteams/platform/webhooks-and-connectors/how-to/connectors-using) format for Teams:

> **Note:** Microsoft says Microsoft 365 Connectors are [nearing deprecation](https://learn.microsoft.com/en-us/microsoftteams/platform/webhooks-and-connectors/how-to/connectors-using) and recommends the Workflows app going forward. Incoming Webhooks and Adaptive Card posting are still documented and functional, but new development should prefer [Power Automate Workflows](https://learn.microsoft.com/en-us/power-automate/teams/send-a-message-in-teams) where possible. The Adaptive Card payload format below works with both approaches.

```python
import hmac
import hashlib
import json
import requests

TEAMS_WEBHOOK_URL = "https://your-org.webhook.office.com/webhookb2/..."  # Legacy connector
# Or Power Automate Workflow HTTP trigger URL
SIGNING_SECRET = "teams-webhook-secret"

CARD_COLOR_MAP = {
    "budget.exhausted": "attention",       # Red
    "budget.over_limit_entered": "attention",
    "reservation.commit_overage": "warning", # Yellow
    "reservation.denied": "warning",
    "tenant.suspended": "accent",           # Blue
}

def format_amount(amount, unit):
    if unit == "USD_MICROCENTS":
        return f"${amount / 100_000_000:.2f}"
    return f"{amount:,} {unit.lower()}" if unit else f"{amount:,}"

@app.post("/cycles-to-teams")
async def forward_to_teams(request: Request):
    body = await request.body()
    sig = request.headers.get("X-Cycles-Signature", "")
    expected = "sha256=" + hmac.new(
        SIGNING_SECRET.encode("utf-8"), body, hashlib.sha256
    ).hexdigest()
    if not hmac.compare_digest(expected, sig):
        return Response(status_code=401)

    event = json.loads(body)
    data = event.get("data", {})
    color = CARD_COLOR_MAP.get(event["event_type"], "default")

    facts = [
        {"title": "Tenant", "value": event["tenant_id"]},
        {"title": "Event", "value": event["event_type"]},
        {"title": "Source", "value": event["source"]},
    ]
    if event.get("scope"):
        facts.append({"title": "Scope", "value": event["scope"]})
    if data.get("utilization") is not None:
        facts.append({"title": "Utilization", "value": f"{data['utilization'] * 100:.1f}%"})
    if data.get("remaining") is not None:
        facts.append({"title": "Remaining", "value": format_amount(data["remaining"], data.get("unit"))})
    if data.get("reason_code"):
        facts.append({"title": "Reason", "value": data["reason_code"]})
    if data.get("estimated_amount") is not None:
        facts.append({"title": "Estimated", "value": format_amount(data["estimated_amount"], data.get("unit"))})
    if data.get("actual_amount") is not None:
        facts.append({"title": "Actual", "value": format_amount(data["actual_amount"], data.get("unit"))})
    if data.get("overage") is not None:
        facts.append({"title": "Overage", "value": format_amount(data["overage"], data.get("unit"))})

    card = {
        "type": "message",
        "attachments": [{
            "contentType": "application/vnd.microsoft.card.adaptive",
            "content": {
                "$schema": "http://adaptivecards.io/schemas/adaptive-card.json",
                "type": "AdaptiveCard",
                "version": "1.5",
                "body": [
                    {
                        "type": "TextBlock",
                        "size": "medium",
                        "weight": "bolder",
                        "text": f"Cycles: {event['event_type']}",
                        "color": color,
                    },
                    {
                        "type": "FactSet",
                        "facts": facts,
                    },
                ],
            },
        }],
    }

    requests.post(TEAMS_WEBHOOK_URL, json=card)
    return {"ok": True}
```

### Example Teams card

The card renders as a structured fact table showing the event type, tenant, source service, scope path, and the event's populated data fields.

```
┌─────────────────────────────────────┐
│ ⚠ Cycles: reservation.commit_overage│
│                                     │
│ Tenant:      acme-corp              │
│ Event:       reservation.commit_overage│
│ Source:      cycles-server           │
│ Scope:       tenant:acme-corp/...   │
│ Estimated:   $0.40                  │
│ Actual:      $0.48                  │
│ Overage:     $0.08                  │
└─────────────────────────────────────┘
```

## Integration: Opsgenie

Route alerts to Opsgenie for on-call management (popular with Atlassian/Jira teams).

### Setup

```bash
curl -X POST http://localhost:7979/v1/admin/webhooks \
  -H "X-Admin-API-Key: $ADMIN_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "url": "https://your-middleware.example.com/cycles-to-opsgenie",
    "event_types": [
      "budget.exhausted",
      "budget.over_limit_entered",
      "reservation.denied",
      "api_key.auth_failed"
    ],
    "signing_secret": "og-webhook-secret"
  }'
```

### Middleware (Python)

```python
import hmac
import hashlib
import json
import requests

OPSGENIE_API_KEY = "your-opsgenie-api-key"
SIGNING_SECRET = "og-webhook-secret"

PRIORITY_MAP = {
    "budget.exhausted": "P2",
    "budget.over_limit_entered": "P1",
    "api_key.auth_failed": "P2",
    "reservation.denied": "P3",
}

@app.post("/cycles-to-opsgenie")
async def forward_to_opsgenie(request: Request):
    body = await request.body()
    sig = request.headers.get("X-Cycles-Signature", "")
    expected = "sha256=" + hmac.new(
        SIGNING_SECRET.encode("utf-8"), body, hashlib.sha256
    ).hexdigest()
    if not hmac.compare_digest(expected, sig):
        return Response(status_code=401)

    event = json.loads(body)

    alert = {
        "message": f"Cycles: {event['event_type']} — {event['tenant_id']}",
        "alias": event["event_id"],  # Dedup key — same event won't create duplicate alerts
        "description": json.dumps(event, indent=2),
        "priority": PRIORITY_MAP.get(event["event_type"], "P3"),
        "source": event["source"],
        "tags": [event["category"], event["tenant_id"]],
        "entity": event.get("scope", event["tenant_id"]),
        "details": event.get("data", {}),
    }

    requests.post(
        "https://api.opsgenie.com/v2/alerts",
        json=alert,
        headers={
            "Authorization": f"GenieKey {OPSGENIE_API_KEY}",
            "Content-Type": "application/json",
        },
    )
    return {"ok": True}
```

> **Note:** Opsgenie uses `alias` for deduplication — setting it to `event_id` ensures retried webhook deliveries don't create duplicate alerts.

## Integration: Custom Receiver (Direct)

For simple use cases, receive webhooks directly without middleware.

**Best practices for webhook receivers:**
- **Acknowledge quickly** — return `200 OK` as fast as possible. The events service treats non-2xx as failure and will retry with exponential backoff.
- **Queue internally** — if processing takes time, accept the event, enqueue it in your own job queue, and return 200 immediately.
- **Make handlers idempotent** — delivery is at-least-once, so you may receive the same event more than once. Use `event_id` (via `X-Cycles-Event-Id` header) for deduplication.
- **Verify signatures** — always check `X-Cycles-Signature` before processing. Never trust unverified payloads.

```python
from flask import Flask, request
import hmac, hashlib, json

app = Flask(__name__)
SIGNING_SECRET = "your-signing-secret"

@app.post("/webhook")
def handle():
    # 1. Verify signature
    body = request.get_data()
    sig = request.headers.get("X-Cycles-Signature", "")
    expected = "sha256=" + hmac.new(
        SIGNING_SECRET.encode("utf-8"), body, hashlib.sha256
    ).hexdigest()
    if not hmac.compare_digest(expected, sig):
        return "Unauthorized", 401

    # 2. Parse event
    event = json.loads(body)
    event_type = event["event_type"]
    event_id = request.headers.get("X-Cycles-Event-Id")

    # 3. Deduplicate (at-least-once delivery)
    if already_processed(event_id):
        return "OK", 200

    # 4. Route by event type
    if event_type == "budget.exhausted":
        handle_budget_exhausted(event)
    elif event_type == "reservation.denied":
        handle_denial(event)
    elif event_type == "reservation.commit_overage":
        handle_commit_overage(event)

    mark_processed(event_id)
    return "OK", 200
```

## Tenant Self-Service Webhooks

Tenants can manage their own webhooks (restricted to `budget.*`, `reservation.*`, `tenant.*` events — 29 of 51 registered types, including the `_via_tenant_cascade` fan-out events the admin server emits in those categories on tenant close — see [Tenant-Close Cascade Semantics](/protocol/tenant-close-cascade-semantics)). Admin-only events (`api_key.*`, `policy.*`, `webhook.*`, `system.*`) are not available to tenants — a tenant-owned subscription can neither carry them nor receive them from the event stream (governance WEBHOOK SUBSCRIPTION INVARIANT 2, enforced at write, dispatch, and last-mile delivery as of cycles-server-admin 0.1.25.51 + cycles-server-events 0.1.25.23; issue #209). The one exception is the owner-triggered `/test` probe (a synthetic `system.webhook_test` ping). This holds regardless of who created the subscription — a tenant-owned row created via the admin plane or admin-on-behalf-of is bound by the same rule. To monitor a specific tenant's admin-only events, use a `__system__`-owned subscription with client-side `tenant_id` filtering — see [Tenant-accessible events](/protocol/webhook-event-delivery-protocol#tenant-accessible-events).

**Required API key permissions:**
- `webhooks:write` — create, update, delete, and test subscriptions
- `webhooks:read` — list subscriptions and delivery history
- `events:read` — query tenant's event stream via `GET /v1/events`

If the API key lacks these permissions, the server returns `403 INSUFFICIENT_PERMISSIONS`.

```bash
# Tenant creates their own webhook using their API key
curl -X POST http://localhost:7979/v1/webhooks \
  -H "X-Cycles-API-Key: $TENANT_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "url": "https://acme-corp.example.com/budget-alerts",
    "event_types": [
      "reservation.commit_overage",
      "budget.exhausted",
      "reservation.denied"
    ]
  }'

# Response includes the signing_secret (returned ONCE — store it securely):
# {
#   "subscription": { "subscription_id": "whsub_abc123...", ... },
#   "signing_secret": "whsec_dGVzdC1zZWNyZXQ..."
# }
```

## Webhook URL Security

The events service applies a delivery-time SSRF baseline even when the admin-configured CIDR list is empty:

- **Blocked by default:** `0.0.0.0/8`, `10.0.0.0/8`, `100.64.0.0/10`, `127.0.0.0/8`, `169.254.0.0/16`, `172.16.0.0/12`, `192.168.0.0/16`, `::1/128`, `fe80::/10`, and `fc00::/7`. Any-local and unspecified addresses are also rejected.
- **HTTPS required** unless the admin webhook-security configuration explicitly sets `allow_http: true`.
- **Admin CIDR blocks are additive.** Clearing `blocked_cidr_ranges` does not remove the events-service baseline.

Local development requires both controls below. Restart the events service after setting its environment variable:

```bash
# Events service only — development/testing escape hatch
export WEBHOOK_URL_GUARD_ALLOW_PRIVATE_NETWORKS=true

# Admin service — allow an HTTP target
curl -X PUT http://localhost:7979/v1/admin/config/webhook-security \
  -H "X-Admin-API-Key: $ADMIN_KEY" \
  -H "Content-Type: application/json" \
  -d '{"allow_http": true, "blocked_cidr_ranges": []}'
```

Never set `WEBHOOK_URL_GUARD_ALLOW_PRIVATE_NETWORKS=true` in production. `allowed_url_patterns` can narrow delivery to approved public destinations, but it does not bypass private-address blocking:

```bash
curl -X PUT http://localhost:7979/v1/admin/config/webhook-security \
  -H "X-Admin-API-Key: $ADMIN_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "allowed_url_patterns": ["https://hooks.example.com/cycles/*"],
    "blocked_cidr_ranges": ["10.0.0.0/8", "172.16.0.0/12", "192.168.0.0/16"]
  }'
```

## Event Type Reference

| Event Type | Produced By | `source` Field | Use Case |
|---|---|---|---|
| `budget.exhausted` | Runtime server | `cycles-server` | Critical: remaining reached zero on the affected ledger |
| `budget.over_limit_entered` | Runtime server | `cycles-server` | Critical: debt exceeded overdraft limit; new reservations blocked |
| `budget.debt_incurred` | Runtime server | `cycles-server` | Info: a commit or direct debit created debt via ALLOW_WITH_OVERDRAFT |
| `reservation.denied` | Runtime server | `cycles-server` | Calibration: a dry-run or decide evaluation returned DENY |
| `reservation.commit_overage` | Runtime server | `cycles-server` | Info: actual spend exceeded estimated amount |
| `reservation.expired` | Runtime server (expiry sweep) | `cycles-server` | Info: reservation TTL expired without commit/release |
| `tenant.suspended` | Admin server | `cycles-admin` | Alert: tenant operations paused |
| `tenant.closed` | Admin server | `cycles-admin` | Alert: tenant permanently closed |
| `api_key.auth_failed` | Admin server | `cycles-admin` | Security: authentication failure |
| `api_key.revoked` | Admin server | `cycles-admin` | Security: key access removed |
| `webhook.disabled` | Admin/events services | `cycles-admin` or `cycles-events` | Alert: a webhook was disabled manually or after delivery failures |
| `system.webhook_delivery_failed` | Events service | `cycles-events` | Meta: webhook delivery permanently failed after all retries |

## Next steps

- [Managing Webhooks](/how-to/managing-webhooks) — create, test, replay, and monitor webhook subscriptions
- [Webhook Event Delivery Protocol](/protocol/webhook-event-delivery-protocol) — full 51-event-type catalog, delivery headers, retry policy, and status lifecycle
- [Deploying the Events Service](/quickstart/deploying-the-events-service) — deploy the async webhook delivery service
- [Security](/security#webhook-security) — SSRF protection, signing secret encryption, and deduplication
