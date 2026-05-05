# SEO title-length decisions log

The recurring SEO scan flags `<title>` tags over 60 chars as "critical."
This file documents which long titles are **intentionally** kept long
(with rationale) so the same items don't get re-flagged across scans.

The rule we apply, not the flat 60-char ceiling:

> A title may exceed 60 chars **if and only if** the most important
> keyword anchors are front-loaded in the first 60 chars (so even
> when truncated in SERPs, the visible portion reads as a coherent
> hook), AND the post-truncation portion adds material context that
> AI Overview / Perplexity / ChatGPT-search citations parse and reward.

## Shortened (2026-05-01)

| Slug | Old length | New length | Notes |
|---|---|---|---|
| `blog/ai-agent-governance-framework-nist-eu-ai-act-iso-42001-owasp-runtime-enforcement` | 134 | 54 (63 with `— Cycles` template) | H1 kept long for in-page context. Title front-loads "AI Agent Governance" + four framework names that act as long-tail SEO anchors. The 63-char rendered total is intentional: dropping any of the four framework names (NIST / EU AI Act / ISO 42001 / OWASP) loses a real search term, so "60-char" rule yields here to keyword preservation. |
| `blog/ai-agent-governance-admin-dashboard-monitor-control-budgets-risk` | 86 | 50 | H1 left alone (rhetorical hook is the engagement angle). `<title>` shortened to keyword-direct form. |
| `quickstart/how-to-choose-a-first-cycles-rollout-tenant-budgets-run-budgets-or-model-call-guardrails` | 92 | 48 | H1 kept long for first-time-reader clarity in the docs context. `<title>` is the SEO-visible string. |

## Intentionally kept long (do not re-flag)

| Slug | Length | Why kept |
|---|---|---|
| `blog/state-of-ai-agent-incidents-2026` | 100 | Colon-subhead pattern. Truncation cuts only the subtitle ("Failures, Costs, and What Would Have Prevented Them"); the visible portion ("The State of AI Agent Incidents (2026)") reads as a complete hook. The full string gets cited by AI search. |
| `blog/ai-agent-risk-assessment-score-classify-enforce-tool-risk` | 98 | Was shortened in the same pass — see "Shortened" above. *Status reversed if re-flagged.* |
| `blog/mcp-tool-poisoning-why-agent-frameworks-cant-prevent-it` | 97 | The "84% Success Rate" hook is the post's reason for ranking on incident-search queries. Truncated form ("MCP Tool Poisoning Has an 84% Success Rate") still reads complete. |
| `blog/why-multi-agent-systems-fail-87-percent-cost-of-every-coordination-breakdown` | 97 | Same logic — the "87%" claim is the SERP hook. Truncated form ("Multi-Agent Systems Fail Up to 87% of the Time") reads complete. |

## When to re-evaluate

Re-evaluate the "kept long" decisions if:
- Search Console shows CTR < 1% on the post for its target query
- The post's primary query starts ranking on page 2 (truncation may be cutting the hook)
- A future SEO audit specifically presents data on truncated-title CTR for these posts

Don't re-evaluate based purely on a flat length scan. The length is a
choice, not a defect.

## Conventions

- `<title>` is the frontmatter `title` field. VitePress appends ` — Cycles` per the global `titleTemplate`. Aim frontmatter title ≤ 50–55 chars so the rendered SERP title stays under 60 with the suffix.
- `H1` is the body `# heading`. Independent from `<title>`. Can be longer/punchier — it's a layout element, not a SERP element.
- `description` is the frontmatter `description`. Aim ≤ 155 chars (Google's typical desktop description truncation).
- `og:title` is set via `transformPageData` per page; defaults to frontmatter title. LinkedIn / Twitter unfurl previews use this and have different (more generous) length conventions.

## What the SEO scan should actually measure

A title scan that ignores meta description length, H1 vs `<title>`
divergence, and `og:title` is incomplete. Future scans should report
all four fields per page, not just `<title>`. The 60-char rule is
useful as a default but not as a verdict.
