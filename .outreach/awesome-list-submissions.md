# Awesome-list submissions

Four target repos. Each one is a single PR adding one line to a
README. Copy the entry text, choose the right section, open the PR
with the title/body below.

---

## 1. tensorchord/Awesome-LLMOps

**Repo:** https://github.com/tensorchord/Awesome-LLMOps
**Section to add to:** `## Cost` (if absent, add to `## Observability`)
**Verify section name** in the current README before submitting — section
headings drift between curators.

**Entry:**

```markdown
- [Cycles](https://runcycles.io) - Runtime authority for autonomous agents. Open protocol that enforces hard cost and action budgets *before* LLM calls and tool invocations execute. Apache 2.0, self-hosted, multi-language SDKs.
```

**PR title:**

```
Add Cycles — runtime cost / action authority for AI agents
```

**PR body:**

```markdown
Adding [Cycles](https://runcycles.io), an Apache-2.0 runtime authority layer for AI agents that pre-execution gates LLM calls and tool invocations against cost and risk budgets.

Different from observability tools (Helicone, Langfuse, LangSmith) — those record what happened. Cycles decides whether the call should happen at all, before any tokens are consumed. Different from rate-limiters and provider caps — Cycles enforces *your* per-tenant and per-agent budgets, not the provider's org-wide limits.

- Open protocol with multi-language SDKs (Python, TypeScript, Rust, Spring/Java)
- Integrations with OpenAI, Anthropic, Bedrock, Gemini, LangChain, LangGraph, Vercel AI SDK, Spring AI, OpenAI Agents SDK, MCP (Claude/Cursor/Windsurf), and more
- Two interactive calculators on the site for cost and blast-radius modeling — runcycles.io/calculators
- Documented at https://runcycles.io/docs

Happy to adjust placement or wording if a different section fits better.
```

---

## 2. e2b-dev/awesome-ai-agents

**Repo:** https://github.com/e2b-dev/awesome-ai-agents
**Section to add to:** `## Frameworks` or `## Tools` — verify in the
current README.

**Entry:**

```markdown
- [Cycles](https://runcycles.io) - Runtime authority that gates AI agent actions and spend before they execute. Open protocol, Apache 2.0, integrations with LangChain, LangGraph, CrewAI, AutoGen, OpenAI Agents SDK, MCP, and 20+ more.
```

**PR title:**

```
Add Cycles — runtime authority for AI agent actions and spend
```

**PR body:**

```markdown
Adding [Cycles](https://runcycles.io) to the list. It's an open-protocol runtime layer that decides — *before* execution — whether an agent action should be allowed: dollar budget, risk budget (RISK_POINTS), or per-tool authority caps.

The thesis in one line: agent frameworks provide orchestration and content guardrails, but no cross-agent cross-tenant ledger-backed runtime authority for *actions* — that gap is what Cycles fills.

- Apache 2.0, self-hosted
- Python / TypeScript / Rust / Spring SDKs
- Integrates with the major frameworks already in this list (LangChain, LangGraph, CrewAI, AutoGen, OpenAI Agents SDK)
- Docs: https://runcycles.io/docs
- Risk calculator: https://runcycles.io/calculators/ai-agent-blast-radius-standalone

Happy to adjust placement or wording.
```

---

## 3. punkpeye/awesome-mcp-servers

**Repo:** https://github.com/punkpeye/awesome-mcp-servers
**Section to add to:** Check current README — likely `## Servers` or a
finance / governance subsection.

**Entry:**

```markdown
- [Cycles MCP Server](https://github.com/runcycles/cycles-mcp-server) - Adds runtime budget and action authority to any MCP-compatible client (Claude Desktop, Claude Code, Cursor, Windsurf). Caps spend per session, gates dangerous tools (deploy, delete, send) before execution. Apache 2.0.
```

**PR title:**

```
Add Cycles MCP Server — runtime budget + action gates for MCP clients
```

**PR body:**

```markdown
Adding the [Cycles MCP server](https://github.com/runcycles/cycles-mcp-server). It exposes Cycles' runtime authority layer through MCP, so any compatible client (Claude Desktop, Claude Code, Cursor, Windsurf) can pre-execution gate its tool calls against:

- A dollar budget (no more $4,200 overnight retry-loops)
- A risk budget — `RISK_POINTS` denominated in *consequence*, not cost — for actions like deploy / delete / send
- Per-session and per-tenant scopes

The classic case is a coding agent with database credentials: cost monitoring won't catch a `DROP TABLE`; an MCP-level action gate will. (Real incident, [The Register](https://www.theregister.com/2026/04/27/cursoropus_agent_snuffs_out_pocketos/).)

- Apache 2.0
- Quickstart: https://runcycles.io/quickstart/getting-started-with-the-mcp-server
- Underlying protocol: https://runcycles.io/protocol

Happy to adjust placement or wording.
```

---

## 4. shaobo-y/awesome-llm-apps  (or another well-maintained `awesome-llm-*` repo — verify which is most active)

Several `awesome-llm-apps` repos exist. Before submitting, run this
locally and pick the one with the most stars + recent commits:

```bash
gh search repos 'awesome llm apps in:name' --limit 5 --json name,owner,stargazerCount,updatedAt --jq 'sort_by(.stargazerCount) | reverse | .[]'
```

**Entry (use this for whichever repo wins the comparison):**

```markdown
- [Cycles](https://runcycles.io) - Open-source runtime authority that bounds LLM cost and AI-agent action damage *before* execution. Self-hosted, Apache 2.0, integrates with OpenAI / Anthropic / Bedrock / LangChain / LangGraph / MCP and more.
```

**PR title:**

```
Add Cycles — runtime cost / action authority for LLM apps
```

**PR body:**

```markdown
Adding [Cycles](https://runcycles.io) to the list — an open-source runtime authority that bounds *both* LLM cost and AI-agent action damage at the same gate, before execution.

Two interactive calculators on the site (cost + blast radius), shareable URLs encode the configuration so anyone can recreate a scenario.

- Apache 2.0
- Multi-language SDKs (Python / TypeScript / Rust / Spring)
- Integrates with the major frameworks
- https://runcycles.io/docs
```

---

## Submission etiquette notes

1. **Always check the contributing guidelines** in each repo's README before opening a PR. Some require alphabetical ordering inside a section, some require specific punctuation, some have a contributors thread to comment on first.

2. **Don't submit to all four on the same day.** Spread over 1-2 weeks so it doesn't read as a coordinated promo blitz. Sequence: LLMOps → AI-Agents → MCP → LLM-Apps.

3. **Pin a friendly comment to each PR** — the maintainer is doing free curation work. A "thanks for keeping this list up; happy to revise placement" goes a long way to acceptance rate.

4. **If a maintainer rejects the PR**, do not open a second one with cosmetic changes — note the rejection reason in `tracker.md` and move on. Awesome-list maintainers talk to each other; pushiness damages downstream submissions.

5. **No fake stars or bot follows on the repos** — these are detected and will get the entry pulled later.
