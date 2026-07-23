---
title: "Running the Cycles MCP Server over HTTP"
description: "When to use Streamable HTTP instead of STDIO for the Cycles MCP server, and how to deploy it as a shared remote MCP gateway."
---

# Running the Cycles MCP Server over Streamable HTTP

The Cycles MCP server supports two transports:

- **STDIO** (default) — the AI client launches the server as a subprocess via `npx`. One server per developer, per machine.
- **Streamable HTTP** — the server runs as a long-lived process and clients connect remotely. One server, many clients. This is the current MCP remote transport; the older standalone HTTP+SSE transport is not implemented.

This page covers the Streamable HTTP transport. For STDIO setup with each AI client, see the per-client quickstarts: [Claude Desktop](/quickstart/mcp-claude-desktop), [Claude Code](/quickstart/mcp-claude-code), [Cursor](/quickstart/mcp-cursor), [Windsurf](/quickstart/mcp-windsurf).

## When to use HTTP instead of STDIO

| Situation | Transport |
|---|---|
| Single developer, local machine, one Cycles server | **STDIO** — simpler, zero process management |
| Team-wide MCP gateway shared across N developers | **HTTP** — one place to update, central auth |
| Remote / cloud deploy where the MCP server lives next to `cycles-server` | **HTTP** — co-located deploy |
| Agent runs in CI/CD or a Kubernetes pod | **HTTP** — sidecar pattern |
| You want to put auth, rate limiting, or audit logging in front of MCP | **HTTP** — terminate at a reverse proxy |

If you are not in one of the HTTP rows above, use STDIO. STDIO is simpler and avoids needing to think about network exposure, auth, or process supervision.

## Start the server with HTTP transport

```bash
npx @runcycles/mcp-server --transport http
```

The server starts on port `3000` and exposes:

| Endpoint | Method | Purpose |
|---|---|---|
| `/health` | GET | Liveness probe — returns `{"status": "ok", "version": "..."}` |
| `/mcp` | POST | MCP Streamable HTTP endpoint (preferred for new clients) |
| `/mcp` | GET | Streamable HTTP SSE stream (server-to-client notifications) |
| `/mcp` | DELETE | Part of the Streamable HTTP surface; effectively a no-op — the server is stateless |

### Configuration

| Variable | Default | Purpose |
|---|---|---|
| `PORT` | `3000` | HTTP port |
| `HOST` | all interfaces | HTTP bind address. Set `127.0.0.1` for loopback-only access. |
| `MCP_HTTP_AUTH_TOKEN` | — | Optional shared bearer token. When set, every `GET`, `POST`, and `DELETE` request to `/mcp` must send `Authorization: Bearer <token>`. `/health` remains public. |
| `CYCLES_API_KEY` | *(required in real mode)* | Cycles API key the server uses to talk to `cycles-server`. **Note:** in HTTP mode, this is the gateway's own key, not per-user. |
| `CYCLES_BASE_URL` | *(required in real mode)* | URL of `cycles-server` (e.g. `http://cycles-server:7878` if co-deployed) |
| `CYCLES_MOCK` | — | `"true"` to skip the backend and return mock responses (useful for client-integration tests) |
| `CYCLES_ALLOW_MOCK_IN_PRODUCTION` | `false` | Must be `"true"` to run mock mode with `NODE_ENV=production`; mock mode disables enforcement. |
| `CYCLES_DEFAULT_TENANT`, `CYCLES_DEFAULT_WORKSPACE`, `CYCLES_DEFAULT_APP`, `CYCLES_DEFAULT_WORKFLOW`, `CYCLES_DEFAULT_AGENT`, `CYCLES_DEFAULT_TOOLSET` | — | Fill omitted standard subject fields for subject-bearing tools. Explicit fields win; custom dimensions are never defaulted. |

If `MCP_HTTP_AUTH_TOKEN` is blank or whitespace-only, startup fails. If no token is configured while the server binds beyond loopback, startup prints a prominent warning. Built-in bearer auth is useful for a gateway with one shared credential; use an identity-aware proxy or API gateway when you need separate users, token rotation, rate limiting, or per-user policy.

## Worked example: docker-compose

The Cycles MCP server has no first-party container image yet, so the cleanest path today is a tiny Dockerfile that pins a server version, then run that image alongside your existing Cycles server. The example below assumes you already have a `cycles-server` running and reachable at some URL — see [Self-Hosting the Server](/quickstart/self-hosting-the-cycles-server) if you don't.

```dockerfile
# Dockerfile
FROM node:22-alpine
WORKDIR /app
RUN npm install --omit=dev @runcycles/mcp-server@latest
EXPOSE 3000
CMD ["npx", "@runcycles/mcp-server", "--transport", "http"]
```

```yaml
# docker-compose.yml
services:
  cycles-mcp:
    build: .
    # Local/dev only. Bind the published port to host loopback. In production,
    # drop `ports:` and use `expose: ["3000"]` behind your gateway/proxy.
    ports:
      - "127.0.0.1:3000:3000"
    environment:
      CYCLES_API_KEY: ${CYCLES_API_KEY}
      CYCLES_BASE_URL: ${CYCLES_BASE_URL}
      MCP_HTTP_AUTH_TOKEN: ${MCP_HTTP_AUTH_TOKEN}
      PORT: "3000"
```

Run it:

```bash
export CYCLES_API_KEY=cyc_live_...
export CYCLES_BASE_URL=http://host.docker.internal:7878   # or wherever your Cycles server is
export MCP_HTTP_AUTH_TOKEN=replace-with-a-long-random-token
docker compose up -d --build
curl http://localhost:3000/health
# => {"status":"ok","version":"..."}
```

You can now point any HTTP-capable MCP client at `http://localhost:3000/mcp` and configure it to send the same bearer header. For production, pin a specific version of `@runcycles/mcp-server` in the Dockerfile (replace `@latest`). Keep the built-in token or put the service behind a reverse proxy/API gateway; use the latter when you need per-user identity or stronger network controls.

## Verify with MCP Inspector

Before debugging client-side wiring, prove the server itself works using the MCP reference client:

```bash
npx @modelcontextprotocol/inspector
```

In the Inspector UI, select **Streamable HTTP** as the transport and enter:

```
http://localhost:3000/mcp
```

If `MCP_HTTP_AUTH_TOKEN` is configured, add an `Authorization` header with the value `Bearer <token>` in the Inspector connection settings.

List tools (you should see `cycles_reserve`, `cycles_commit`, `cycles_check_balance`, etc.) and call `cycles_check_balance` with a tenant you know exists. If that works, any subsequent connection failures are client-config issues, not server issues.

## Connecting an MCP client to a remote server

### Claude Code

Claude Code has first-party CLI support for remote HTTP MCP servers:

```bash
claude mcp add --transport http cycles https://mcp.example.com/mcp
```

For local testing against the docker-compose above:

```bash
claude mcp add --transport http \
  --header "Authorization: Bearer $MCP_HTTP_AUTH_TOKEN" \
  cycles http://localhost:3000/mcp
```

The local command uses the built-in bearer token configured in the docker-compose example. For another remote server, send the authentication headers required by that server; omit `--header` only when the endpoint is intentionally unauthenticated. Claude Code stores this local-scope server configuration outside the project, so the expanded token is not committed to the repository.

### Other clients (config shape varies)

For clients that take JSON config rather than a CLI, the shape replaces the STDIO `command`/`args` launch with a remote URL. The exact keys differ across clients and are still evolving — some use just `"url"`, others require an explicit `"type": "http"` discriminator. Two examples seen in the wild:

```json
{
  "mcpServers": {
    "cycles": {
      "url": "https://mcp.example.com/mcp"
    }
  }
}
```

```json
{
  "mcpServers": {
    "cycles": {
      "type": "http",
      "url": "https://mcp.example.com/mcp"
    }
  }
}
```

Windsurf documents stdio, HTTP, and SSE transports. Claude Code supports remote HTTP via the CLI above. Other clients may vary by release channel — check the client docs before assuming a JSON shape. STDIO is universally supported and is the right fallback while remote support stabilizes.

## Auth, scope derivation, and security

- **The MCP server's `CYCLES_API_KEY` is the gateway's identity, not the end user's.** Every request to Cycles authenticates as that one key. `MCP_HTTP_AUTH_TOKEN` protects the MCP endpoint with one shared credential; it does not create per-user Cycles identities.
- **End-user attribution is not injected automatically.** The MCP schemas do not accept a reservation `actor` field. A client or identity-aware tool harness can attach audit context through `action.tags` or `metadata` on subject-bearing operations; `metrics.custom` is available only on commit and create-event calls. These fields add observability but do not determine the budget scope. If you need per-user or per-tenant enforcement, map the authenticated identity to an explicit subject policy before the Cycles call, or use separate gateway/API-key identities per boundary. See [Custom Field Resolvers](/how-to/custom-field-resolvers-in-cycles).
- **Scope derivation behaves identically over HTTP.** `cycles_reserve`, `cycles_decide`, and `cycles_create_event` accept the subject hierarchy ([tenant → workspace → app → workflow → agent → toolset](/concepts/exposure-why-rate-limits-leave-agents-unbounded)); `cycles_check_balance` accepts the corresponding filters. Commit, release, and extend operate on an existing `reservationId` and do not accept a new subject.
- **Protect every reachable `/mcp` endpoint.** Use `MCP_HTTP_AUTH_TOKEN` for shared-token access, or put the service behind nginx/caddy/Traefik, mTLS, an API gateway, or a private network. Prefer an identity-aware gateway when users need distinct credentials or policies.
- **Health check is intentionally unauthenticated.** `/health` returns version information for load balancers. Built-in bearer auth, when configured, applies to every `/mcp` method.

## Known limitations

- **No built-in per-user auth.** The built-in bearer token is shared. If the goal is per-developer attribution, use an identity-aware gateway or STDIO with a separate Cycles API key per developer.
- **No first-party container image.** A pinned GHCR image will land once HTTP demand is validated. Until then, the Dockerfile above is the recommended pattern — pin the package version in production rather than `@latest`.
- **The server is stateless.** It issues no session IDs, so any replica can serve any request — no sticky sessions needed. Restarts are safe from a transport perspective; retry an interrupted mutating tool call with the same caller-supplied `idempotencyKey`. A new key represents a new operation and can create a duplicate hold, charge, extension, event, or evidence artifact.

## Next steps

- [Integrating Cycles with MCP](/how-to/integrating-cycles-with-mcp) — advanced patterns: preflight, degradation, long-running ops, fire-and-forget events
- [Per-client STDIO quickstarts](/quickstart/getting-started-with-the-mcp-server) — when STDIO is the right call
- [API Key Management](/how-to/api-key-management-in-cycles) — rotation and lifecycle for the gateway's key
- [Multi-Tenant Operations](/guides/multi-tenant-operations) — how scope hierarchy works end-to-end
