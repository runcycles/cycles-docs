---
title: "SpEL Expression Reference for Cycles"
description: "Comprehensive reference for writing SpEL expressions in the @Cycles annotation to dynamically evaluate estimate and actual costs."
---

# SpEL Expression Reference for Cycles

The `@Cycles` annotation uses Spring Expression Language (SpEL) to evaluate `estimate` and `actual` cost values dynamically. This page is a comprehensive reference for writing SpEL expressions in Cycles.

## Where expressions are used

The `@Cycles` annotation accepts SpEL expressions in four places:

| Attribute | Evaluated when | Purpose |
|---|---|---|
| `value` / `estimate` | Before the method runs | Determines the reservation amount |
| `actual` | After the method returns | Determines the commit amount |
| `metadata` (since 0.2.5) | After the method returns | Produces the commit metadata map |
| Subject fields: `tenant`, `workspace`, `app`, `workflow`, `agent`, `toolset` (since 0.2.1) | Before the method runs | Resolves the subject field when the value starts with `#` |

### Subject-field expressions (since 0.2.1)

A subject attribute whose first non-whitespace character is `#` is evaluated as SpEL against the method invocation; any other value is treated as a literal:

```java
@Cycles(value = "1000", tenant = "#tenantId")
public String handle(String tenantId, String prompt) { ... }
```

Subject fields are evaluated before the guarded method runs, so `#result` is deliberately **not** available. Method parameters, `#args`, and `#target` are.

### Metadata expressions (since 0.2.5)

The `metadata` attribute is evaluated after the method returns and must yield a `Map<String, Object>`:

```java
@Cycles(value = "1000", metadata = "{'request_id': #requestId, 'model': #result.model}")
public LlmResponse call(String requestId, String prompt) { ... }
```

In addition to method parameters, `#args`, `#target`, and `#result`, metadata expressions expose `#method` and a root object with `target`, `args`, `result`, and `method` properties. The evaluated map is merged with programmatic `CyclesContextHolder` commit metadata; programmatic metadata wins on key conflicts.

## Available variables

### Method parameters

Parameters are available by index and by name:

```java
@Cycles("#p0 * 10")
public String generate(int tokens) { ... }
```

| Variable | Meaning |
|---|---|
| `#p0`, `#p1`, `#p2`, ... | Parameters by index (zero-based) |
| `#paramName` | Parameters by name (requires `-parameters` compiler flag) |

#### Parameter names

To use parameter names instead of indexes, compile with the `-parameters` flag:

```xml
<!-- Maven -->
<plugin>
  <groupId>org.apache.maven.plugins</groupId>
  <artifactId>maven-compiler-plugin</artifactId>
  <configuration>
    <parameters>true</parameters>
  </configuration>
</plugin>
```

```groovy
// Gradle
tasks.withType(JavaCompile) {
    options.compilerArgs << '-parameters'
}
```

With this flag:

```java
@Cycles("#tokens * 10")
public String generate(int tokens) { ... }
```

Without it, use `#p0`:

```java
@Cycles("#p0 * 10")
public String generate(int tokens) { ... }
```

### Return value

The `#result` variable is available in the `actual` and `metadata` expressions, evaluated after the method returns:

```java
@Cycles(estimate = "5000", actual = "#result.usage.totalTokens * 8")
public ChatResponse chat(String prompt) { ... }
```

If the method returns `null`, `#result` is `null`. Accessing a property on it throws a `SpelEvaluationException` (EL1007/EL1011 — property or method access on a null context object), and an expression that evaluates to `null` overall causes the starter to throw `IllegalArgumentException` (`"Expression evaluated to null: ..."`).

### Other variables

| Variable | Meaning |
|---|---|
| `#args` | All method arguments as an `Object[]` array |
| `#target` | The target object instance (the bean the method belongs to) |

## Expression examples

### Fixed values

```java
@Cycles("500")
public String summarize(String text) { ... }
```

A literal number is the simplest expression. It evaluates to that value every time.

### Arithmetic on parameters

```java
@Cycles("#p0 * 10")
public String generate(int maxTokens) { ... }
```

```java
@Cycles("#p0.length() / 4 * 8")
public String processText(String input) { ... }
```

### Using named parameters

```java
@Cycles("#maxTokens * 10")
public String generate(int maxTokens) { ... }
```

### Using the return value

```java
@Cycles(estimate = "5000", actual = "#result.length() * 5")
public String translate(String text) { ... }
```

```java
@Cycles(estimate = "#p1 * 10",
        actual = "#result.usage.totalTokens * 8")
public ChatResponse chat(String prompt, int estimatedTokens) { ... }
```

### Accessing nested properties

```java
@Cycles(estimate = "#request.estimatedTokens * 10",
        actual = "#result.metadata.totalCost")
public Response process(Request request) { ... }
```

### Conditional expressions

```java
@Cycles("#p0.length() > 1000 ? 10000 : 2000")
public String summarize(String text) { ... }
```

### Math functions

```java
@Cycles("T(Math).max(#p0 * 10, 1000)")
public String generate(int tokens) { ... }
```

```java
@Cycles("T(Math).min(#p0.length() / 4 * 8, 50000)")
public String process(String input) { ... }
```

### Accessing the args array

```java
@Cycles("#args[0].length() * #args[1]")
public String process(String text, int costPerChar) { ... }
```

### Accessing the target bean

```java
@Cycles("#target.getEstimateMultiplier() * #p0")
public String process(int tokens) {
    // ...
}

public int getEstimateMultiplier() {
    return 10;
}
```

## Evaluation rules

### Return type

The expression must evaluate to a `Number`. The result is converted to a `long` via `Number.longValue()`.

### Non-negative

The evaluated value must be >= 0. A negative value throws `IllegalArgumentException`.

### Null safety

If the expression evaluates to `null`, an `IllegalArgumentException` is thrown. Guard against null:

```java
// Safe: use a fallback
@Cycles(actual = "#result != null ? #result.cost : 0")
public Result process(String input) { ... }
```

### Estimate vs actual

| Attribute | `#result` available? | When evaluated |
|---|---|---|
| `value` / `estimate` | No | Before method execution |
| `actual` | Yes | After method returns |
| `metadata` | Yes | After method returns |
| Subject fields | No | Before method execution |

If `actual` is not specified and `useEstimateIfActualNotProvided` is `true` (the default), the estimate value is used as the actual at commit time.

## Common patterns

### Token-based estimation

```java
@Cycles(estimate = "#prompt.length() / 4 * 10",
        actual = "#result.usage.totalTokens * 10",
        unit = "USD_MICROCENTS")
public ChatResponse complete(String prompt) { ... }
```

### Fixed estimate with actual from response

```java
@Cycles(estimate = "10000",
        actual = "#result.cost",
        unit = "USD_MICROCENTS")
public ApiResponse callExternalApi(Request request) { ... }
```

### Multiple parameters

```java
@Cycles("#p0 * #p1 * 8")
public String batchProcess(int documents, int tokensPerDoc) { ... }
```

### Using enum or constant values via SpEL

```java
@Cycles("T(com.example.CostTable).estimateFor(#p0)")
public String process(String modelName) { ... }
```

## Troubleshooting

### "Expression evaluated to null"

The expression returned null. Common cause: accessing a property on a null object. Add a null check:

```java
actual = "#result?.cost != null ? #result.cost : 0"
```

### "Charge amount must not be negative"

The expression evaluated to a negative number. Ensure your math cannot produce negative values:

```java
estimate = "T(Math).max(#p0 * 10, 0)"
```

### "Parameter name not found"

You used `#paramName` but did not compile with `-parameters`. Use `#p0` index-based access or add the compiler flag.

### Expression parse errors

Check for typos in method names, property paths, or operator usage. SpEL follows Java-like syntax but uses `#` for variables.

## Next steps

- [Getting Started with the Spring Boot Starter](/quickstart/getting-started-with-the-cycles-spring-boot-starter) — annotation usage
- [Client Configuration Reference](/configuration/client-configuration-reference-for-cycles-spring-boot-starter) — all configuration properties
- [Error Handling Patterns](/how-to/error-handling-patterns-in-cycles-client-code) — handling evaluation failures
