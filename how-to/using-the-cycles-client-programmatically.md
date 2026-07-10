---
title: "Using the Cycles Client Programmatically"
description: "Use the Cycles programmatic client in Python, Java, and TypeScript for direct control over reservations, commits, and protocol endpoints."
---

# Using the Cycles Client Programmatically

The decorator / annotation handles most use cases automatically. But sometimes you need direct control — building requests manually, managing the lifecycle yourself, or calling endpoints that the decorator does not cover.

The Python `CyclesClient`, the Java `CyclesClient` interface, and the TypeScript `CyclesClient` class all provide programmatic access to every Cycles protocol endpoint.

## Getting the client

In Java (Spring Boot Starter), `CyclesClient` is auto-configured and available for injection.

::: code-group
```python [Python]
from runcycles import CyclesClient, CyclesConfig

config = CyclesConfig(
    base_url="http://localhost:7878",
    api_key="cyc_live_...",
    tenant="acme-corp",
)

client = CyclesClient(config)
```
```java [Java]
@Service
public class BudgetService {

    private final CyclesClient cyclesClient;

    public BudgetService(CyclesClient cyclesClient) {
        this.cyclesClient = cyclesClient;
    }
}
```
```typescript [TypeScript]
import { CyclesClient, CyclesConfig } from "runcycles";

const config = new CyclesConfig({
  baseUrl: "http://localhost:7878",
  apiKey: "cyc_live_...",
  tenant: "acme-corp",
});

const client = new CyclesClient(config);
```
:::

Or from environment variables (Python and TypeScript):

::: code-group
```python [Python]
config = CyclesConfig.from_env()  # reads CYCLES_BASE_URL, CYCLES_API_KEY, etc.
client = CyclesClient(config)
```
```typescript [TypeScript]
const config = CyclesConfig.fromEnv(); // reads CYCLES_BASE_URL, CYCLES_API_KEY, etc.
const client = new CyclesClient(config);
```
:::

::: tip TypeScript naming convention
`CyclesClient` methods accept and return wire-format (snake_case) JSON. For camelCase convenience, use the typed mapper functions (`reservationCreateRequestToWire`, `reservationCreateResponseFromWire`, etc.) documented in the [TypeScript Getting Started guide](/quickstart/getting-started-with-the-typescript-client#programmatic-client).
:::

## Creating a reservation

::: code-group
```python [Python]
from runcycles import (
    CyclesClient, ReservationCreateRequest,
    Subject, Action, Amount, Unit,
)

with CyclesClient(config) as client:
    response = client.create_reservation(ReservationCreateRequest(
        idempotency_key="req-abc-123",
        subject=Subject(tenant="acme", workspace="production", app="chatbot"),
        action=Action(kind="llm.completion", name="gpt-4o"),
        estimate=Amount(unit=Unit.USD_MICROCENTS, amount=5000),
        ttl_ms=60_000,
    ))

    if not response.is_success:
        raise RuntimeError(f"Reservation failed: {response.error_message}")

    reservation_id = response.get_body_attribute("reservation_id")
    decision = response.get_body_attribute("decision")

    # For non-dry-run reservations, insufficient budget returns 409 (not decision=DENY).
    # decision=DENY in a 2xx response only occurs when dry_run=true.

    # Proceed with work...
```
```java [Java]
ReservationCreateRequest request = ReservationCreateRequest.builder()
    .idempotencyKey(UUID.randomUUID().toString())
    .subject(Subject.builder()
        .tenant("acme")
        .workspace("production")
        .app("chatbot")
        .build())
    .action(new Action("llm.completion", "gpt-4o", null))
    .estimate(new Amount(Unit.USD_MICROCENTS, 5000L))
    .ttlMs(60000L)
    .build();

CyclesResponse<Map<String, Object>> response = cyclesClient.createReservation(request);

if (!response.is2xx()) {
    throw new RuntimeException("Reservation failed: " + response.getErrorMessage());
}

Map<String, Object> body = response.getBody();
String reservationId = (String) body.get("reservation_id");
String decision = (String) body.get("decision");

// For non-dry-run reservations, insufficient budget returns 409 (not decision=DENY).
// decision=DENY in a 2xx response only occurs when dry_run=true.

// Proceed with work...
```
```typescript [TypeScript]
import { CyclesClient, CyclesConfig, Unit } from "runcycles";

const response = await client.createReservation({
  idempotency_key: "req-abc-123",
  subject: { tenant: "acme", workspace: "production", app: "chatbot" },
  action: { kind: "llm.completion", name: "gpt-4o" },
  estimate: { unit: Unit.USD_MICROCENTS, amount: 5000 },
  ttl_ms: 60_000,
});

if (!response.isSuccess) {
  throw new Error(`Reservation failed: ${response.errorMessage}`);
}

const reservationId = response.getBodyAttribute("reservation_id") as string;
const decision = response.getBodyAttribute("decision") as string;

// For non-dry-run reservations, insufficient budget returns 409 (not decision=DENY).
// decision=DENY in a 2xx response only occurs when dry_run=true.

// Proceed with work...
```
:::

## Committing actual usage

::: code-group
```python [Python]
from runcycles import CommitRequest, CyclesMetrics

client.commit_reservation(reservation_id, CommitRequest(
    idempotency_key="commit-abc-123",
    actual=Amount(unit=Unit.USD_MICROCENTS, amount=3200),
    metrics=CyclesMetrics(
        tokens_input=150,
        tokens_output=80,
        latency_ms=320,
        model_version="gpt-4o-2024-08-06",
    ),
    metadata={"app_request_id": "req-abc-123"},
))
```
```java [Java]
CyclesMetrics metrics = new CyclesMetrics();
metrics.setTokensInput(150);
metrics.setTokensOutput(80);
metrics.setLatencyMs(320);
metrics.setModelVersion("gpt-4o-2024-08-06");

CommitRequest commitRequest = CommitRequest.builder()
    .idempotencyKey("commit-" + UUID.randomUUID())
    .actual(new Amount(Unit.USD_MICROCENTS, 3200L))
    .metrics(metrics)
    .metadata(Map.of("app_request_id", "req-abc-123"))
    .build();

CyclesResponse<Map<String, Object>> commitResponse =
    cyclesClient.commitReservation(reservationId, commitRequest);
```
```typescript [TypeScript]
await client.commitReservation(reservationId, {
  idempotency_key: "commit-abc-123",
  actual: { unit: Unit.USD_MICROCENTS, amount: 3200 },
  metrics: {
    tokens_input: 150,
    tokens_output: 80,
    latency_ms: 320,
    model_version: "gpt-4o-2024-08-06",
  },
  metadata: { app_request_id: "req-abc-123" },
});
```
:::

## Releasing a reservation

If work is cancelled or fails before producing any usage:

::: code-group
```python [Python]
from runcycles import ReleaseRequest

client.release_reservation(reservation_id, ReleaseRequest(
    idempotency_key="release-abc-123",
    reason="Task cancelled by user",
))
```
```java [Java]
ReleaseRequest releaseRequest = ReleaseRequest.builder()
    .idempotencyKey("release-" + UUID.randomUUID())
    .reason("Task cancelled by user")
    .build();

cyclesClient.releaseReservation(reservationId, releaseRequest);
```
```typescript [TypeScript]
await client.releaseReservation(reservationId, {
  idempotency_key: "release-abc-123",
  reason: "Task cancelled by user",
});
```
:::

## Full lifecycle example

::: code-group
```python [Python]
from runcycles import (
    CyclesClient, CyclesConfig, ReservationCreateRequest, CommitRequest,
    ReleaseRequest, Subject, Action, Amount, Unit, CyclesMetrics,
)

config = CyclesConfig(base_url="http://localhost:7878", api_key="cyc_live_...", tenant="acme")

def process_document(doc_id: str, content: str) -> str:
    idempotency_key = f"doc-{doc_id}"
    estimated_tokens = len(content) // 4

    with CyclesClient(config) as client:
        # 1. Reserve
        response = client.create_reservation(ReservationCreateRequest(
            idempotency_key=idempotency_key,
            subject=Subject(tenant="acme", workspace="production", app="doc-processor"),
            action=Action(kind="llm.completion", name="gpt-4o"),
            estimate=Amount(unit=Unit.USD_MICROCENTS, amount=estimated_tokens * 10),
            ttl_ms=120_000,
            overage_policy="ALLOW_IF_AVAILABLE",
        ))

        if not response.is_success:
            raise RuntimeError(f"Reservation failed: {response.error_message}")

        reservation_id = response.get_body_attribute("reservation_id")

        # 2. Execute
        try:
            result = call_llm(content)

            # 3. Commit
            actual_tokens = count_tokens(result)
            client.commit_reservation(reservation_id, CommitRequest(
                idempotency_key=f"commit-{idempotency_key}",
                actual=Amount(unit=Unit.USD_MICROCENTS, amount=actual_tokens * 10),
                metrics=CyclesMetrics(
                    tokens_input=estimated_tokens,
                    tokens_output=actual_tokens,
                ),
            ))
            return result

        except Exception:
            # 4. Release on failure
            client.release_reservation(reservation_id, ReleaseRequest(
                idempotency_key=f"release-{idempotency_key}",
                reason="Processing failed",
            ))
            raise
```
```java [Java]
@Service
public class DocumentProcessor {

    private final CyclesClient cyclesClient;

    public DocumentProcessor(CyclesClient cyclesClient) {
        this.cyclesClient = cyclesClient;
    }

    public String processDocument(String docId, String content) {
        String idempotencyKey = "doc-" + docId;
        int estimatedTokens = content.length() / 4;

        // 1. Reserve
        ReservationCreateRequest reservation = ReservationCreateRequest.builder()
            .idempotencyKey(idempotencyKey)
            .subject(Subject.builder()
                .tenant("acme")
                .workspace("production")
                .app("doc-processor")
                .build())
            .action(new Action("llm.completion", "gpt-4o", null))
            .estimate(new Amount(Unit.USD_MICROCENTS, (long) estimatedTokens * 10))
            .ttlMs(120000L)
            .overagePolicy(CommitOveragePolicy.ALLOW_IF_AVAILABLE)
            .build();

        CyclesResponse<Map<String, Object>> reserveResponse =
            cyclesClient.createReservation(reservation);

        if (!reserveResponse.is2xx()) {
            throw new CyclesProtocolException("Reservation failed: "
                + reserveResponse.getErrorMessage());
        }

        String reservationId = (String) reserveResponse.getBody().get("reservation_id");
        // For non-dry-run reservations, a 2xx response means decision is ALLOW or ALLOW_WITH_CAPS.
        // Insufficient budget returns 409 (handled above by !is2xx check).

        // 2. Execute
        try {
            String result = callLlm(content);

            // 3. Commit
            int actualTokens = countTokens(result);
            CyclesMetrics commitMetrics = new CyclesMetrics();
            commitMetrics.setTokensInput(estimatedTokens);
            commitMetrics.setTokensOutput(actualTokens);

            CommitRequest commit = CommitRequest.builder()
                .idempotencyKey("commit-" + idempotencyKey)
                .actual(new Amount(Unit.USD_MICROCENTS, (long) actualTokens * 10))
                .metrics(commitMetrics)
                .build();

            cyclesClient.commitReservation(reservationId, commit);
            return result;

        } catch (Exception e) {
            // 4. Release on failure
            cyclesClient.releaseReservation(reservationId,
                ReleaseRequest.builder()
                    .idempotencyKey("release-" + idempotencyKey)
                    .reason("Processing failed: " + e.getMessage())
                    .build());
            throw e;
        }
    }
}
```
```typescript [TypeScript]
import { CyclesClient, CyclesConfig, Unit } from "runcycles";

const config = new CyclesConfig({
  baseUrl: "http://localhost:7878",
  apiKey: "cyc_live_...",
  tenant: "acme",
});

async function processDocument(docId: string, content: string): Promise<string> {
  const idempotencyKey = `doc-${docId}`;
  const estimatedTokens = Math.ceil(content.length / 4);
  const client = new CyclesClient(config);

  // 1. Reserve
  const response = await client.createReservation({
    idempotency_key: idempotencyKey,
    subject: { tenant: "acme", workspace: "production", app: "doc-processor" },
    action: { kind: "llm.completion", name: "gpt-4o" },
    estimate: { unit: Unit.USD_MICROCENTS, amount: estimatedTokens * 10 },
    ttl_ms: 120_000,
    overage_policy: "ALLOW_IF_AVAILABLE",
  });

  if (!response.isSuccess) {
    throw new Error(`Reservation failed: ${response.errorMessage}`);
  }

  const reservationId = response.getBodyAttribute("reservation_id") as string;

  // 2. Execute
  try {
    const result = await callLlm(content);

    // 3. Commit
    const actualTokens = countTokens(result);
    await client.commitReservation(reservationId, {
      idempotency_key: `commit-${idempotencyKey}`,
      actual: { unit: Unit.USD_MICROCENTS, amount: actualTokens * 10 },
      metrics: {
        tokens_input: estimatedTokens,
        tokens_output: actualTokens,
      },
    });
    return result;
  } catch (err) {
    // 4. Release on failure
    await client.releaseReservation(reservationId, {
      idempotency_key: `release-${idempotencyKey}`,
      reason: "Processing failed",
    });
    throw err;
  }
}
```
:::

## Preflight decision check

Check budget availability without creating a reservation.

::: code-group
```python [Python]
from runcycles import DecisionRequest

response = client.decide(DecisionRequest(
    idempotency_key="decide-001",
    subject=Subject(tenant="acme", workspace="production"),
    action=Action(kind="llm.completion", name="gpt-4o"),
    estimate=Amount(unit=Unit.USD_MICROCENTS, amount=50_000),
))

decision = response.get_body_attribute("decision")  # "ALLOW", "ALLOW_WITH_CAPS", or "DENY"
if decision == "DENY":
    print("Budget low — show warning in UI")
```
```java [Java]
DecisionRequest decisionRequest = DecisionRequest.builder()
    .idempotencyKey("decide-" + UUID.randomUUID())
    .subject(Subject.builder()
        .tenant("acme")
        .workspace("production")
        .build())
    .action(new Action("llm.completion", "gpt-4o", null))
    .estimate(new Amount(Unit.USD_MICROCENTS, 50000L))
    .build();

CyclesResponse<Map<String, Object>> decisionResponse = cyclesClient.decide(decisionRequest);
String decision = (String) decisionResponse.getBody().get("decision");

if ("DENY".equals(decision)) {
    // Show "budget low" warning in UI
}
```
```typescript [TypeScript]
const decisionResponse = await client.decide({
  idempotency_key: "decide-001",
  subject: { tenant: "acme", workspace: "production" },
  action: { kind: "llm.completion", name: "gpt-4o" },
  estimate: { unit: Unit.USD_MICROCENTS, amount: 50_000 },
});

const decision = decisionResponse.getBodyAttribute("decision") as string;
if (decision === "DENY") {
  console.log("Budget low — show warning in UI");
}
```
:::

## Querying balances

::: code-group
```python [Python]
response = client.get_balances(tenant="acme", workspace="production")
if response.is_success:
    for balance in response.body.get("balances", []):
        # remaining is a SignedAmount object: {"unit": ..., "amount": ...}
        remaining = balance["remaining"]
        print(f"Scope: {balance['scope']}, remaining: {remaining['amount']} {remaining['unit']}")
```
```java [Java]
Map<String, String> params = Map.of(
    "tenant", "acme",
    "workspace", "production"
);

CyclesResponse<Map<String, Object>> balanceResponse = cyclesClient.getBalances(params);

// Balance amounts are objects ({unit, amount}), not raw numbers. Use the
// typed BalanceQueryResult / Balance accessors instead of casting to Number.
BalanceQueryResult result = BalanceQueryResult.fromMap(balanceResponse.getBody());

for (Balance balance : result.getBalances()) {
    SignedAmount remaining = balance.getRemaining();  // can be negative (overdraft)
    Amount spent = balance.getSpent();
    Amount reserved = balance.getReserved();
    System.out.printf("Scope: %s, remaining: %d %s, spent: %d, reserved: %d%n",
        balance.getScope(),
        remaining.getAmount(), remaining.getUnit(),
        spent.getAmount(), reserved.getAmount());
}
```
```typescript [TypeScript]
const balanceResponse = await client.getBalances({ tenant: "acme", workspace: "production" });
if (balanceResponse.isSuccess) {
  const balances = balanceResponse.getBodyAttribute("balances") as Array<Record<string, unknown>>;
  for (const balance of balances ?? []) {
    console.log(`Scope: ${balance.scope}, remaining: ${JSON.stringify(balance.remaining)}`);
  }
}
```
:::

## Listing reservations

::: code-group
```python [Python]
response = client.list_reservations(tenant="acme", status="ACTIVE", limit="20")
if response.is_success:
    for reservation in response.body.get("reservations", []):
        print(f"ID: {reservation['reservation_id']}, status: {reservation['status']}")
```
```java [Java]
Map<String, String> params = Map.of(
    "tenant", "acme",
    "status", "ACTIVE",
    "limit", "20"
);

CyclesResponse<Map<String, Object>> listResponse =
    cyclesClient.listReservations(params);
```
```typescript [TypeScript]
const listResponse = await client.listReservations({
  tenant: "acme",
  status: "ACTIVE",
  limit: "20",
});
if (listResponse.isSuccess) {
  const reservations = listResponse.getBodyAttribute("reservations") as Array<Record<string, unknown>>;
  for (const r of reservations ?? []) {
    console.log(`ID: ${r.reservation_id}, status: ${r.status}`);
  }
}
```
:::

## Recording events (direct debit)

For post-hoc accounting without a reservation.

::: code-group
```python [Python]
from runcycles import EventCreateRequest

response = client.create_event(EventCreateRequest(
    idempotency_key="evt-001",
    subject=Subject(tenant="acme", workspace="production"),
    action=Action(kind="search.api", name="google-search"),
    actual=Amount(unit=Unit.USD_MICROCENTS, amount=1200),
))
```
```java [Java]
EventCreateRequest event = EventCreateRequest.builder()
    .idempotencyKey("evt-" + UUID.randomUUID())
    .subject(Subject.builder()
        .tenant("acme")
        .workspace("production")
        .build())
    .action(new Action("search.api", "google-search", null))
    .actual(new Amount(Unit.USD_MICROCENTS, 1200L))
    .build();

cyclesClient.createEvent(event);
```
```typescript [TypeScript]
await client.createEvent({
  idempotency_key: "evt-001",
  subject: { tenant: "acme", workspace: "production" },
  action: { kind: "search.api", name: "google-search" },
  actual: { unit: Unit.USD_MICROCENTS, amount: 1200 },
});
```
:::

## CyclesResponse

All client methods return a `CyclesResponse` (in Java, `CyclesResponse<Map<String, Object>>`):

::: code-group
```python [Python]
response = client.create_reservation(request)

response.is_success          # True if HTTP 2xx
response.is_server_error     # True if HTTP 5xx
response.is_transport_error  # True if connection failed
response.status              # HTTP status code
response.body                # Parsed JSON body as dict
response.error_message       # Error message (if error)
response.request_id          # X-Request-Id header
response.rate_limit_remaining  # X-RateLimit-Remaining (int or None)
```
```java [Java]
CyclesResponse<Map<String, Object>> response = cyclesClient.createReservation(request);

response.is2xx();           // true if HTTP 2xx
response.is5xx();           // true if HTTP 5xx
response.isTransportError();// true if connection failed
response.getStatus();       // HTTP status code
response.getBody();         // parsed JSON body as Map
response.getErrorMessage(); // error message (if error)
```
```typescript [TypeScript]
const response = await client.createReservation(request);

response.isSuccess;          // true if HTTP 2xx
response.isServerError;      // true if HTTP 5xx
response.isTransportError;   // true if connection failed
response.status;             // HTTP status code
response.body;               // Parsed JSON body (wire format)
response.errorMessage;       // Error message (if error)
response.requestId;          // X-Request-Id header
response.rateLimitRemaining; // X-RateLimit-Remaining (number or undefined)
response.cyclesTenant;       // X-Cycles-Tenant header
```
:::

## Async support (Python)

The Python client provides `AsyncCyclesClient` for asyncio-based applications:

```python
from runcycles import AsyncCyclesClient

async with AsyncCyclesClient(config) as client:
    response = await client.create_reservation(request)
    if response.is_success:
        reservation_id = response.get_body_attribute("reservation_id")
        # ... do async work ...
        await client.commit_reservation(reservation_id, commit_request)
```

## When to use programmatic vs decorator/annotation

| Use case | Approach |
|---|---|
| Wrapping a single method call in a budget lifecycle | `@cycles` decorator / `@Cycles` annotation / `withCycles` HOF |
| Managing multiple reservations in a workflow | Programmatic `CyclesClient` |
| Querying balances or listing reservations | Programmatic `CyclesClient` |
| Preflight decisions for UI routing | Programmatic `CyclesClient` |
| Recording events without reservations | Programmatic `CyclesClient` |
| Fine-grained error handling per step | Programmatic `CyclesClient` |

## Next steps

- [Getting Started with the TypeScript Client](/quickstart/getting-started-with-the-typescript-client) — TypeScript HOF and streaming adapter setup
- [Getting Started with the Python Client](/quickstart/getting-started-with-the-python-client) — Python decorator and client setup
- [Getting Started with the Spring Boot Starter](/quickstart/getting-started-with-the-cycles-spring-boot-starter) — Java annotation-based approach
- [API Reference](/api/) — interactive endpoint documentation
- [Error Handling in TypeScript](/how-to/error-handling-patterns-in-typescript) — TypeScript exception hierarchy and patterns
- [Error Handling in Python](/how-to/error-handling-patterns-in-python) — Python exception hierarchy and patterns
- [Error Handling Patterns](/how-to/error-handling-patterns-in-cycles-client-code) — general error handling patterns
