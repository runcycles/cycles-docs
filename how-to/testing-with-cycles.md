---
title: "Testing with Cycles"
description: "How to unit test and integration test code that uses the Cycles decorator, annotation, or programmatic client in Python, Java, and TypeScript."
---

# Testing with Cycles

This guide covers how to test code that uses the `@cycles` decorator (Python), the `@Cycles` annotation (Java), or the `withCycles` HOF (TypeScript) and the `CyclesClient` interface.

::: tip Key principle
Test business logic separately from budget enforcement. Mock the Cycles client in unit tests and use a real Cycles server in integration tests.
:::

## Python

### Unit testing @cycles-decorated functions

The `@cycles` decorator requires a client to function. In a unit test, you can test business logic by calling the underlying function directly without the decorator, or by mocking the client.

For plain function logic (without budget enforcement), test the function directly:

```python
def test_business_logic():
    result = call_llm("some text")
    assert result == "expected output"
```

### Mocking CyclesClient with pytest

When testing code that uses `CyclesClient` programmatically, mock the client responses:

```python
from unittest.mock import MagicMock, ANY
from runcycles import CyclesClient, CyclesResponse
import pytest

def test_successful_processing():
    client = MagicMock(spec=CyclesClient)

    # Mock reservation response
    client.create_reservation.return_value = CyclesResponse.success(200, {
        "reservation_id": "res-123",
        "decision": "ALLOW",
        "expires_at_ms": 1709312345678,
    })

    # Mock commit response
    client.commit_reservation.return_value = CyclesResponse.success(200, {
        "status": "COMMITTED",
    })

    result = process_document(client, "doc-1", "content")

    assert result is not None
    client.create_reservation.assert_called_once()
    client.commit_reservation.assert_called_once()


def test_budget_denied():
    client = MagicMock(spec=CyclesClient)

    # Insufficient budget returns 409
    client.create_reservation.return_value = CyclesResponse.http_error(
        409, "Insufficient remaining balance",
        body={"error": "BUDGET_EXCEEDED", "message": "Insufficient remaining balance"},
    )

    result = process_document(client, "doc-1", "content")

    assert result == "Budget exhausted. Please try again later."
    client.commit_reservation.assert_not_called()


def test_release_on_failure():
    client = MagicMock(spec=CyclesClient)

    client.create_reservation.return_value = CyclesResponse.success(200, {
        "reservation_id": "res-123",
        "decision": "ALLOW",
    })

    with pytest.raises(RuntimeError):
        process_document_that_fails(client, "doc-1", "content")

    # Verify budget was released
    client.release_reservation.assert_called_once()
```

### Testing with pytest-httpx

For integration-style tests, use `pytest-httpx` to mock HTTP responses:

```python
from runcycles import CyclesClient, CyclesConfig

def test_full_lifecycle(httpx_mock):
    httpx_mock.add_response(
        method="POST",
        url="http://localhost:7878/v1/reservations",
        json={
            "reservation_id": "res-test-001",
            "decision": "ALLOW",
            "expires_at_ms": 1709312345678,
            "affected_scopes": ["tenant:test"],
        },
        status_code=200,
    )

    httpx_mock.add_response(
        method="POST",
        url="http://localhost:7878/v1/reservations/res-test-001/commit",
        json={"status": "COMMITTED"},
        status_code=200,
    )

    config = CyclesConfig(base_url="http://localhost:7878", api_key="test-key")
    request = {
        "idempotency_key": "test-001",
        "subject": {"tenant": "test"},
        "action": {"kind": "test", "name": "integration"},
        "estimate": {"unit": "USD_MICROCENTS", "amount": 100},
    }
    with CyclesClient(config) as client:
        response = client.create_reservation(request)
        assert response.is_success
        assert response.get_body_attribute("reservation_id") == "res-test-001"
```

### Testing error handling

```python
from runcycles import BudgetExceededError, CyclesProtocolError

def test_budget_exceeded_handling():
    ex = BudgetExceededError(
        "Budget exceeded",
        status=409,
        error_code="BUDGET_EXCEEDED",
    )
    assert ex.is_budget_exceeded()
    assert not ex.is_reservation_expired()
    assert ex.status == 409

def test_retry_after_handling():
    ex = CyclesProtocolError(
        "Try again later",
        status=409,
        error_code="BUDGET_EXCEEDED",
        retry_after_ms=5000,
    )
    assert ex.retry_after_ms == 5000
```

### Testing async code

```python
import pytest
from runcycles import AsyncCyclesClient, CyclesConfig

@pytest.mark.asyncio
async def test_async_reservation(httpx_mock):
    httpx_mock.add_response(
        method="POST",
        url="http://localhost:7878/v1/reservations",
        json={"reservation_id": "res-async-001", "decision": "ALLOW"},
        status_code=200,
    )

    config = CyclesConfig(base_url="http://localhost:7878", api_key="test-key")
    request = {
        "idempotency_key": "test-async-001",
        "subject": {"tenant": "test"},
        "action": {"kind": "test", "name": "integration"},
        "estimate": {"unit": "USD_MICROCENTS", "amount": 100},
    }
    async with AsyncCyclesClient(config) as client:
        response = await client.create_reservation(request)
        assert response.is_success
```

## Java (Spring)

### Unit testing @Cycles-annotated methods

The `@Cycles` annotation is driven by Spring AOP. In a plain unit test (without Spring context), the annotation has no effect — the method runs normally without any reservation lifecycle.

This means you can unit test the method's business logic without Cycles getting involved:

```java
@Test
void testBusinessLogic() {
    LlmService service = new LlmService(mockChatModel);
    String result = service.summarize("some text");
    assertEquals("expected output", result);
}
```

No mocking of Cycles is needed for pure unit tests.

### Mocking CyclesClient

When testing code that uses `CyclesClient` programmatically, mock the client:

```java
@ExtendWith(MockitoExtension.class)
class DocumentProcessorTest {

    @Mock
    private CyclesClient cyclesClient;

    @InjectMocks
    private DocumentProcessor processor;

    @Test
    void testSuccessfulProcessing() {
        Map<String, Object> reserveBody = Map.of(
            "reservation_id", "res-123",
            "decision", "ALLOW",
            "expires_at_ms", System.currentTimeMillis() + 60000
        );
        when(cyclesClient.createReservation(any()))
            .thenReturn(CyclesResponse.success(200, reserveBody));

        Map<String, Object> commitBody = Map.of("status", "COMMITTED");
        when(cyclesClient.commitReservation(eq("res-123"), any()))
            .thenReturn(CyclesResponse.success(200, commitBody));

        String result = processor.processDocument("doc-1", "content");

        assertNotNull(result);
        verify(cyclesClient).createReservation(any());
        verify(cyclesClient).commitReservation(eq("res-123"), any());
    }

    @Test
    void testBudgetDenied() {
        when(cyclesClient.createReservation(any()))
            .thenReturn(CyclesResponse.httpError(409, "Insufficient remaining balance",
                Map.of("error", "BUDGET_EXCEEDED",
                       "message", "Insufficient remaining balance")));

        String result = processor.processDocument("doc-1", "content");

        assertEquals("Budget exhausted. Please try again later.", result);
        verify(cyclesClient, never()).commitReservation(any(), any());
    }

    @Test
    void testReleaseOnFailure() {
        Map<String, Object> reserveBody = Map.of(
            "reservation_id", "res-123",
            "decision", "ALLOW"
        );
        when(cyclesClient.createReservation(any()))
            .thenReturn(CyclesResponse.success(200, reserveBody));

        doThrow(new RuntimeException("LLM error"))
            .when(mockLlm).call(any());

        assertThrows(RuntimeException.class,
            () -> processor.processDocument("doc-1", "content"));

        verify(cyclesClient).releaseReservation(eq("res-123"), any());
    }
}
```

### Integration testing with the @Cycles annotation

To test the full `@Cycles` lifecycle in a Spring context, mock the `CyclesClient` bean:

```java
@SpringBootTest
class CyclesIntegrationTest {

    @MockBean
    private CyclesClient cyclesClient;

    @Autowired
    private LlmService llmService;

    @Test
    void testAnnotatedMethodWithAllow() {
        Map<String, Object> reserveBody = Map.of(
            "reservation_id", "res-test-001",
            "decision", "ALLOW",
            "expires_at_ms", System.currentTimeMillis() + 60000,
            "affected_scopes", List.of("tenant:test"),
            "scope_path", "tenant:test",
            "reserved", Map.of("amount", 5000, "unit", "USD_MICROCENTS")
        );
        when(cyclesClient.createReservation(any()))
            .thenReturn(CyclesResponse.success(200, reserveBody));

        Map<String, Object> commitBody = Map.of(
            "status", "COMMITTED",
            "charged", Map.of("amount", 3200, "unit", "USD_MICROCENTS")
        );
        when(cyclesClient.commitReservation(any(), any()))
            .thenReturn(CyclesResponse.success(200, commitBody));

        String result = llmService.summarize("test input");

        assertNotNull(result);
        verify(cyclesClient).createReservation(any());
        verify(cyclesClient).commitReservation(eq("res-test-001"), any());
    }

    @Test
    void testAnnotatedMethodWithDeny() {
        // A live (non-dry-run) denial is a 409 BUDGET_EXCEEDED error body —
        // there is no "decision" field on 4xx responses
        Map<String, Object> denyBody = Map.of(
            "error", "BUDGET_EXCEEDED",
            "message", "Insufficient budget"
        );
        when(cyclesClient.createReservation(any()))
            .thenReturn(CyclesResponse.httpError(409, "Insufficient budget", denyBody));

        assertThrows(CyclesProtocolException.class,
            () -> llmService.summarize("test input"));
    }
}
```

### Integration testing with a real Cycles server

For end-to-end tests, use Testcontainers to spin up Redis and the Cycles server (`ghcr.io/runcycles/cycles-server`) on a shared network:

```java
@SpringBootTest
@Testcontainers
class FullIntegrationTest {

    static Network network = Network.newNetwork();

    @Container
    static GenericContainer<?> redis = new GenericContainer<>("redis:7-alpine")
        .withNetwork(network)
        .withNetworkAliases("redis")
        .withExposedPorts(6379);

    @Container
    static GenericContainer<?> cyclesServer =
        new GenericContainer<>("ghcr.io/runcycles/cycles-server:latest")
            .withNetwork(network)
            .withEnv("REDIS_HOST", "redis")
            .withEnv("REDIS_PORT", "6379")
            .withExposedPorts(7878)
            .dependsOn(redis);

    @DynamicPropertySource
    static void configureProperties(DynamicPropertyRegistry registry) {
        registry.add("cycles.base-url", () ->
            "http://" + cyclesServer.getHost() + ":" + cyclesServer.getMappedPort(7878));
        registry.add("cycles.api-key", () -> "test-key");
        registry.add("cycles.tenant", () -> "test-tenant");
    }

    @Autowired
    private CyclesClient cyclesClient;

    @Test
    void testFullLifecycle() {
        ReservationCreateRequest request = ReservationCreateRequest.builder()
            .idempotencyKey("integration-test-001")
            .subject(Subject.builder().tenant("test-tenant").build())
            .action(new Action("test", "integration", null))
            .estimate(new Amount(Unit.USD_MICROCENTS, 100L))
            .build();

        CyclesResponse<Map<String, Object>> response =
            cyclesClient.createReservation(request);

        assertTrue(response.is2xx());
    }
}
```

::: warning Provision test data first
The server authenticates `X-Cycles-API-Key` against keys stored in Redis and enforces budgets seeded there. Seed a test API key and a budget for `test-tenant` (for example via the Cycles Admin API, or the seeding scripts in the [cycles-server repo](https://github.com/runcycles/cycles-server)) before the reservation assertion above will pass.
:::

### Testing CyclesFieldResolver implementations

Test custom field resolvers directly:

```java
@Test
void testTenantResolver() {
    RepositoryAccessService repoService = mock(RepositoryAccessService.class);
    when(repoService.findTenant()).thenReturn(Optional.of("resolved-tenant"));

    CyclesTenantResolver resolver = new CyclesTenantResolver();
    ReflectionTestUtils.setField(resolver, "repositoryAccessService", repoService);

    assertEquals("resolved-tenant", resolver.resolve());
}
```

### Testing SpEL expressions

Test that your SpEL expressions evaluate correctly:

```java
@Test
void testEstimateExpression() throws NoSuchMethodException {
    CyclesExpressionEvaluator evaluator = new CyclesExpressionEvaluator();

    Method method = LlmService.class.getMethod("generate", int.class);
    Object[] args = { 500 };

    long result = evaluator.evaluate("#p0 * 10", method, args, null, null);
    assertEquals(5000, result);
}
```

## TypeScript

### Unit testing withCycles-wrapped functions

`withCycles` wraps a function with budget governance. In a unit test, you can test the inner function directly without the wrapper:

```typescript
// The inner function (no budget governance)
async function callLlm(prompt: string): Promise<string> {
  return `Response to: ${prompt}`;
}

// Test the business logic directly
import { describe, it, expect } from "vitest";

describe("callLlm", () => {
  it("returns a response", async () => {
    const result = await callLlm("Hello");
    expect(result).toBe("Response to: Hello");
  });
});
```

### Mocking CyclesClient with Vitest

When testing code that uses `CyclesClient` programmatically, mock the client methods:

```typescript
import { describe, it, expect, vi } from "vitest";
import { CyclesClient } from "runcycles";
import { CyclesResponse } from "runcycles";

describe("processDocument", () => {
  it("creates reservation and commits on success", async () => {
    const client = {
      config: { tenant: "acme" },
      createReservation: vi.fn().mockResolvedValue(
        CyclesResponse.success(200, {
          reservation_id: "res-123",
          decision: "ALLOW",
          affected_scopes: ["tenant:acme"],
          expires_at_ms: Date.now() + 60000,
        }),
      ),
      commitReservation: vi.fn().mockResolvedValue(
        CyclesResponse.success(200, { status: "COMMITTED" }),
      ),
      releaseReservation: vi.fn(),
      extendReservation: vi.fn(),
    };

    const result = await processDocument(client as any, "doc-1", "content");

    expect(result).toBeDefined();
    expect(client.createReservation).toHaveBeenCalledOnce();
    expect(client.commitReservation).toHaveBeenCalledOnce();
  });

  it("returns fallback on budget denied", async () => {
    const client = {
      config: { tenant: "acme" },
      createReservation: vi.fn().mockResolvedValue(
        CyclesResponse.httpError(
          409,
          "Insufficient remaining balance",
          { error: "BUDGET_EXCEEDED", message: "Insufficient remaining balance" },
        ),
      ),
      commitReservation: vi.fn(),
      releaseReservation: vi.fn(),
      extendReservation: vi.fn(),
    };

    const result = await processDocument(client as any, "doc-1", "content");

    expect(result).toBe("Budget exhausted. Please try again later.");
    expect(client.commitReservation).not.toHaveBeenCalled();
  });

  it("releases reservation on processing failure", async () => {
    const client = {
      config: { tenant: "acme" },
      createReservation: vi.fn().mockResolvedValue(
        CyclesResponse.success(200, {
          reservation_id: "res-123",
          decision: "ALLOW",
          affected_scopes: [],
        }),
      ),
      commitReservation: vi.fn(),
      releaseReservation: vi.fn().mockResolvedValue(
        CyclesResponse.success(200, { status: "RELEASED" }),
      ),
      extendReservation: vi.fn(),
    };

    await expect(
      processDocumentThatFails(client as any, "doc-1", "content"),
    ).rejects.toThrow();

    expect(client.releaseReservation).toHaveBeenCalledOnce();
  });
});
```

### Mocking fetch for integration tests

For integration-style tests, mock the global `fetch` to return Cycles API responses:

```typescript
import { describe, it, expect, vi, afterEach } from "vitest";
import { CyclesClient, CyclesConfig } from "runcycles";

function mockFetchSequence(
  responses: Array<{ status: number; body: Record<string, unknown> }>,
) {
  let callIndex = 0;
  vi.stubGlobal(
    "fetch",
    vi.fn().mockImplementation(() => {
      const resp = responses[callIndex] ?? responses[responses.length - 1];
      callIndex++;
      return Promise.resolve({
        status: resp.status,
        statusText: resp.status >= 400 ? "Error" : "OK",
        json: () => Promise.resolve(resp.body),
        headers: new Headers(),
      });
    }),
  );
}

describe("full lifecycle", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("reserves, executes, and commits", async () => {
    mockFetchSequence([
      {
        status: 200,
        body: {
          decision: "ALLOW",
          reservation_id: "res-test-001",
          affected_scopes: ["tenant:test"],
          expires_at_ms: Date.now() + 60000,
        },
      },
      { status: 200, body: { status: "COMMITTED" } },
    ]);

    const config = new CyclesConfig({
      baseUrl: "http://localhost:7878",
      apiKey: "test-key",
      tenant: "test",
    });
    const client = new CyclesClient(config);

    const response = await client.createReservation({
      idempotency_key: "test-001",
      subject: { tenant: "test" },
      action: { kind: "test", name: "integration" },
      estimate: { unit: "USD_MICROCENTS", amount: 100 },
    });

    expect(response.isSuccess).toBe(true);
    expect(response.getBodyAttribute("reservation_id")).toBe("res-test-001");
  });
});
```

### Testing error handling

```typescript
import { BudgetExceededError, CyclesProtocolError } from "runcycles";

describe("error handling", () => {
  it("creates BudgetExceededError with correct properties", () => {
    const err = new BudgetExceededError("Budget exceeded", {
      status: 409,
      errorCode: "BUDGET_EXCEEDED",
    });

    expect(err.isBudgetExceeded()).toBe(true);
    expect(err.isReservationExpired()).toBe(false);
    expect(err.status).toBe(409);
    expect(err).toBeInstanceOf(CyclesProtocolError);
  });

  it("handles retry-after", () => {
    const err = new CyclesProtocolError("Try again later", {
      status: 409,
      errorCode: "BUDGET_EXCEEDED",
      retryAfterMs: 5000,
    });

    expect(err.retryAfterMs).toBe(5000);
  });
});
```

### Testing withCycles with mocked fetch

Test the full `withCycles` lifecycle by mocking the underlying HTTP calls:

```typescript
import { withCycles, CyclesClient, CyclesConfig, BudgetExceededError } from "runcycles";

describe("withCycles integration", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("executes function within budget lifecycle", async () => {
    mockFetchSequence([
      {
        status: 200,
        body: {
          decision: "ALLOW",
          reservation_id: "r-1",
          affected_scopes: ["tenant:test"],
          expires_at_ms: Date.now() + 60000,
        },
      },
      { status: 200, body: { status: "COMMITTED" } },
    ]);

    const config = new CyclesConfig({ baseUrl: "http://localhost:7878", apiKey: "key", tenant: "test" });
    const client = new CyclesClient(config);

    const guarded = withCycles(
      { estimate: 1000, actionKind: "test", actionName: "unit", client },
      async (input: string) => `Processed: ${input}`,
    );

    const result = await guarded("hello");
    expect(result).toBe("Processed: hello");
  });

  it("throws BudgetExceededError on deny", async () => {
    mockFetchSequence([
      {
        status: 409,
        body: { error: "BUDGET_EXCEEDED", message: "Insufficient balance" },
      },
    ]);

    const config = new CyclesConfig({ baseUrl: "http://localhost:7878", apiKey: "key", tenant: "test" });
    const client = new CyclesClient(config);

    const guarded = withCycles(
      { estimate: 1000, actionKind: "test", actionName: "unit", client },
      async () => "should not run",
    );

    await expect(guarded()).rejects.toThrow(BudgetExceededError);
  });
});
```

### Testing reserveForStream

Mock the client directly to test streaming handle behavior:

```typescript
import { reserveForStream } from "runcycles";
import { CyclesResponse, CyclesConfig } from "runcycles";

describe("reserveForStream", () => {
  it("creates handle with caps", async () => {
    const client = {
      config: new CyclesConfig({ baseUrl: "http://localhost", apiKey: "key" }),
      createReservation: vi.fn().mockResolvedValue(
        CyclesResponse.success(200, {
          decision: "ALLOW",
          reservation_id: "r-stream-1",
          affected_scopes: ["tenant:test"],
          caps: { max_tokens: 4096 },
        }),
      ),
      commitReservation: vi.fn().mockResolvedValue(
        CyclesResponse.success(200, { status: "COMMITTED" }),
      ),
      releaseReservation: vi.fn(),
      extendReservation: vi.fn(),
    };

    const handle = await reserveForStream({
      client: client as any,
      estimate: 5000,
      unit: "USD_MICROCENTS",
      actionKind: "llm.completion",
      actionName: "gpt-4o",
      tenant: "test",
    });

    expect(handle.reservationId).toBe("r-stream-1");
    expect(handle.caps).toEqual({ maxTokens: 4096 });

    // Commit and verify
    await handle.commit(3000, { tokensInput: 100, tokensOutput: 200 });
    expect(client.commitReservation).toHaveBeenCalledOnce();
  });
});
```

## Tips

- **Unit tests**: test business logic without the decorator/annotation/HOF — it has no effect when bypassed
- **Mock CyclesClient**: use Python `MagicMock`, Java `@MockBean`, or TypeScript `vi.fn()` to avoid needing a real server
- **Test both ALLOW and DENY paths**: ensure your code handles budget denial gracefully
- **Test error paths**: verify release is called when functions/methods throw
- **Use HTTP mocking for integration tests**: `pytest-httpx` for Python, Testcontainers for Java, `vi.stubGlobal("fetch")` for TypeScript
- **Python-specific**: `pytest-httpx` mocks both the sync `CyclesClient` and the async `AsyncCyclesClient` (its `httpx_mock` fixture works with async httpx clients too); `respx` is an alternative if you prefer its API
- **TypeScript-specific**: mock `fetch` globally with Vitest's `vi.stubGlobal()` or use `msw` (Mock Service Worker) for more realistic HTTP mocking

## Next steps

- [Error Handling in TypeScript](/how-to/error-handling-patterns-in-typescript) — TypeScript exception handling patterns
- [Error Handling in Python](/how-to/error-handling-patterns-in-python) — Python exception handling patterns
- [Error Handling Patterns](/how-to/error-handling-patterns-in-cycles-client-code) — general error handling patterns
- [Using the Client Programmatically](/how-to/using-the-cycles-client-programmatically) — direct client usage
- [SpEL Expression Reference](/configuration/spel-expression-reference-for-cycles) — expression syntax (Java)
