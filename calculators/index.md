---
title: "Cycles Tools — Free Calculators for AI Agent Cost & Risk"
description: "Free interactive tools that quantify AI agent cost and blast-radius risk. Shareable URLs, CSV/PNG/Markdown export, and embeddable iframes for blog posts and articles."
---

# Cycles Tools

Two interactive tools, one runtime-authority thesis. Cost calculators answer "how much will this workload spend?" Blast-radius calculators answer "if this workload's actions go wrong, how much damage is in scope?" Both questions matter in production. Both are bounded by Cycles at the same runtime gate.

Every configuration produces a unique URL. Share it, embed it, export it.

## Available tools

### Cost Calculator (Claude vs GPT)
Per-call, per-day, per-month, and per-year cost across current Claude and OpenAI models. Editable rates so you can plug in contracted pricing, add or remove rows for the models you actually use.

- **[Open the Cost Calculator →](/calculators/claude-vs-gpt-cost-standalone)** — full-screen, branded view, share/export toolbar
- [Same calculator in the docs flow](/calculators/claude-vs-gpt-cost-comparison)

### Blast Radius Risk Calculator
Monthly blast radius across agent action classes, modeled by reversibility (×1 / ×3 / ×10) and visibility (+0 / +1 / +4), with an editable runtime-authority containment factor. Highlights the catastrophic *irreversible + public* class with a red row outline. Name your agent so the artifact is self-attributed.

- **[Open the Blast Radius Risk Calculator →](/calculators/ai-agent-blast-radius-standalone)** — full-screen, branded view, share/export toolbar
- [Same calculator in the docs flow](/calculators/ai-agent-blast-radius-risk)

## Try a pre-configured scenario

Each link below opens the calculator with realistic numbers from a specific incident or workload pattern, ready to tune to your own:

- **[The "$800 estimated, $4,200 actual" support bot](/calculators/claude-vs-gpt-cost-standalone#s=eyJ3b3JrbG9hZE5hbWUiOiJDdXN0b21lciBzdXBwb3J0IGJvdCIsIndvcmtsb2FkRGVzY3JpcHRpb24iOiIxMSBMTE0gY2FsbHMgcGVyIGNvbnZlcnNhdGlvbi4gQ29udGV4dCB3aW5kb3dzIGdyb3cgd2l0aCBlYWNoIHR1cm4uIEVzdGltYXRlZCAkODAwL21vLCBhY3R1YWwgJDQsMjAwLiIsImlucHV0VG9rZW5zIjo1MDAwLCJvdXRwdXRUb2tlbnMiOjEyMDAsImNhbGxzUGVyRGF5IjozMzAwfQ)** — 11 calls per conversation, growing context windows
- **[Quality-loop bug](/calculators/claude-vs-gpt-cost-standalone#s=eyJ3b3JrbG9hZE5hbWUiOiJTdXBwb3J0IGFnZW50IHdpdGggcXVhbGl0eS1sb29wIGJ1ZyIsIndvcmtsb2FkRGVzY3JpcHRpb24iOiJEcmFmdHMgYSByZXNwb25zZSwgZXZhbHVhdGVzIHF1YWxpdHksIHJlZmluZXMgdW50aWwgc2NvcmUgPjguIEJ1ZzogZXZhbHVhdG9yIG5ldmVyIHJldHVybnMgYWJvdmUgNi45LiB-MTAwIGNhbGxzIHBlciByZWZpbmVtZW50IGxvb3AuIiwiaW5wdXRUb2tlbnMiOjMwMDAsIm91dHB1dFRva2VucyI6ODAwLCJjYWxsc1BlckRheSI6NTAwfQ)** — agent refines until a score that never reaches threshold
- **[Multi-tenant noisy neighbor](/calculators/claude-vs-gpt-cost-standalone#s=eyJ3b3JrbG9hZE5hbWUiOiJNdWx0aS10ZW5hbnQgU2FhUyDigJQgbm9pc3kgdGVuYW50Iiwid29ya2xvYWREZXNjcmlwdGlvbiI6Ik9uZSB0ZW5hbnQgcnVucyBhdCA1MHggdGhlIGF2ZXJhZ2UgbG9hZC4gU2hhcmVkIGJ1ZGdldDsgdGhlaXIgYnVybiBkcmFpbnMgZXZlcnlvbmUncyBoZWFkcm9vbS4iLCJpbnB1dFRva2VucyI6NDAwMCwib3V0cHV0VG9rZW5zIjoxMDAwLCJjYWxsc1BlckRheSI6NTAwMDB9)** — one tenant runs 50× the average load on a shared budget
- **[Coding agent with database access](/calculators/ai-agent-blast-radius-standalone#s=eyJhZ2VudE5hbWUiOiJDb2RpbmcgYWdlbnQgKGRhdGFiYXNlIGFjY2VzcykiLCJhZ2VudERlc2NyaXB0aW9uIjoiQUkgY29kaW5nIGFnZW50IHdpdGggcHJvZHVjdGlvbiBkYXRhYmFzZSBjcmVkZW50aWFscyDigJQgcmVhZCBzY2hlbWEsIHJ1biBtaWdyYXRpb25zLCBwdXNoIGNvZGUuIiwiY29udGFpbm1lbnRQY3QiOjAsInJvd3MiOlt7Im5hbWUiOiJEUk9QIFRBQkxFIC8gREVMRVRFIG1pZ3JhdGlvbiIsInJldmVyc2liaWxpdHkiOiJpcnJldmVyc2libGUiLCJ2aXNpYmlsaXR5IjoiY3VzdG9tZXItZmFjaW5nIiwiY29zdFBlckFjdGlvbiI6MCwiYWZmZWN0ZWRVc2VycyI6MTAwMDAwLCJjb3N0UGVyVXNlciI6NTAsImNhbGxzUGVyRGF5Ijo1MCwiZXJyb3JSYXRlIjowLjA1fSx7Im5hbWUiOiJTY2hlbWEgbWlncmF0aW9uIHRvIHByb2R1Y3Rpb24iLCJyZXZlcnNpYmlsaXR5IjoiaGFyZC10by1yZXZlcnNlIiwidmlzaWJpbGl0eSI6ImN1c3RvbWVyLWZhY2luZyIsImNvc3RQZXJBY3Rpb24iOjAsImFmZmVjdGVkVXNlcnMiOjEwMDAwMCwiY29zdFBlclVzZXIiOjIwLCJjYWxsc1BlckRheSI6NSwiZXJyb3JSYXRlIjowLjF9LHsibmFtZSI6IkNvZGUgZGVwbG95IHRvIHB1YmxpYyBzaXRlIiwicmV2ZXJzaWJpbGl0eSI6ImhhcmQtdG8tcmV2ZXJzZSIsInZpc2liaWxpdHkiOiJwdWJsaWMiLCJjb3N0UGVyQWN0aW9uIjowLCJhZmZlY3RlZFVzZXJzIjoxMDAwMDAsImNvc3RQZXJVc2VyIjoxMCwiY2FsbHNQZXJEYXkiOjIwLCJlcnJvclJhdGUiOjAuM30seyJuYW1lIjoiUmVhZCBzY2hlbWEgLyBTRUxFQ1QiLCJyZXZlcnNpYmlsaXR5IjoicmV2ZXJzaWJsZSIsInZpc2liaWxpdHkiOiJpbnRlcm5hbCIsImNvc3RQZXJBY3Rpb24iOjAsImFmZmVjdGVkVXNlcnMiOjEsImNvc3RQZXJVc2VyIjowLCJjYWxsc1BlckRheSI6NTAwMCwiZXJyb3JSYXRlIjoxfV19)** — DROP TABLE, migration, deploy, read-only rows pre-loaded with realistic severity
- **[Customer support bot — mixed action classes](/calculators/ai-agent-blast-radius-standalone#s=eyJhZ2VudE5hbWUiOiJDdXN0b21lciBTdXBwb3J0IEJvdCIsImFnZW50RGVzY3JpcHRpb24iOiJUaWVyLTIgc3VwcG9ydCBhZ2VudCB0aGF0IGRyYWZ0cyBjdXN0b21lciBlbWFpbHMsIGlzc3VlcyByZWZ1bmRzLCBhbmQgcmVhZHMgb3JkZXIgaGlzdG9yeS4gVG90YWwgTExNIHNwZW5kIHBlciBtb250aDogfiQxLjQwLiIsImNvbnRhaW5tZW50UGN0IjowLCJyb3dzIjpbeyJuYW1lIjoiU2VuZCB3cm9uZy10ZW1wbGF0ZSBlbWFpbCIsInJldmVyc2liaWxpdHkiOiJpcnJldmVyc2libGUiLCJ2aXNpYmlsaXR5IjoiY3VzdG9tZXItZmFjaW5nIiwiY29zdFBlckFjdGlvbiI6MCwiYWZmZWN0ZWRVc2VycyI6MjAwLCJjb3N0UGVyVXNlciI6MjUwLCJjYWxsc1BlckRheSI6MTAwMCwiZXJyb3JSYXRlIjowLjJ9LHsibmFtZSI6Iklzc3VlIGN1c3RvbWVyIHJlZnVuZCIsInJldmVyc2liaWxpdHkiOiJpcnJldmVyc2libGUiLCJ2aXNpYmlsaXR5IjoiY3VzdG9tZXItZmFjaW5nIiwiY29zdFBlckFjdGlvbiI6NTAsImFmZmVjdGVkVXNlcnMiOjEsImNvc3RQZXJVc2VyIjoyMDAsImNhbGxzUGVyRGF5IjoyMDAsImVycm9yUmF0ZSI6MC41fSx7Im5hbWUiOiJQdWJsaWMgcmVwbHkgb24gQGJyYW5kIGFjY291bnQiLCJyZXZlcnNpYmlsaXR5IjoiaXJyZXZlcnNpYmxlIiwidmlzaWJpbGl0eSI6InB1YmxpYyIsImNvc3RQZXJBY3Rpb24iOjAsImFmZmVjdGVkVXNlcnMiOjUwMDAwLCJjb3N0UGVyVXNlciI6NSwiY2FsbHNQZXJEYXkiOjUsImVycm9yUmF0ZSI6MC4xfSx7Im5hbWUiOiJSZWFkIGN1c3RvbWVyIHJlY29yZCIsInJldmVyc2liaWxpdHkiOiJyZXZlcnNpYmxlIiwidmlzaWJpbGl0eSI6ImludGVybmFsIiwiY29zdFBlckFjdGlvbiI6MCwiYWZmZWN0ZWRVc2VycyI6MSwiY29zdFBlclVzZXIiOjAsImNhbGxzUGVyRGF5Ijo1MDAwLCJlcnJvclJhdGUiOjF9XX0)** — emails, refunds, public posts, internal reads — exposes the cost-vs-damage gap

Each link encodes its scenario in the URL hash; you get the same view in any browser without a backend.

## Share, embed, export

Each calculator's full state is encoded in the URL. Configure the calculator, click **Share** to copy a link with your numbers preserved, and the recipient sees exactly the same view.

The toolbar (visible in both the in-docs and full-screen views) offers:

- **Share** — copies the standalone URL with current state
- **Copy** — generates a Markdown table for Slack, GitHub PRs, email, or anywhere that renders Markdown
- **CSV** — downloads a comma-separated file with attribution comment header
- **PNG** — captures a branded screenshot of the table — runcycles logo, agent/workload name, source URL, and date are burned into the image
- **Embed** — generates an `<iframe>` snippet to drop the calculator into a blog post, article, or vendor-comparison page. The embedded version preserves the URL state, so you publish a *pre-configured* calculator showing the numbers your post argues for.

Embed snippets look like this:

```html
<iframe
  src="https://runcycles.io/calculators/claude-vs-gpt-cost-embed#s=..."
  width="100%" height="820" frameborder="0" loading="lazy"
  title="Cycles cost calculator"></iframe>
```

The embed view strips the docs chrome, shows only the calculator, and includes a small **"Built with Cycles runtime authority — runcycles.io"** credit linking back.

## Why estimates do not equal runtime authority

These calculators help with capacity planning. They do not stop spend at runtime, and they say nothing about *what* an agent is permitted to do.

Estimating that a workload will cost $4,200/month is the start of the conversation. The rest is enforcing that it actually costs no more than $4,200/month — even when an agent loops, a tenant misuses your API, or a deploy regresses to a more expensive model — *and* that no single action (a refund, a deploy, a deletion) can cause damage that dwarfs your entire monthly LLM bill in one call.

If your projection includes the words "should not exceed" or "we expect," you are still relying on hope. See [Why Cycles](/why-cycles) for the full runtime authority model — cost, action authority, blast radius, multi-tenant isolation — and [Debugging sudden LLM cost spikes](/troubleshoot/llm-cost-spike-debugging) for the diagnostic playbook when reality exceeds the estimate.

## Posts that use these calculators

- [How Much Do AI Agents Actually Cost?](/blog/how-much-do-ai-agents-cost) — the canonical "estimated $800, actual $4,200" walkthrough
- [Cursor AI Agent Reportedly Deleted a Production Database in 9 Seconds](/blog/ai-agent-deleted-prod-database-9-seconds) — uses the blast-radius calculator inline
- [Multi-Tenant AI Cost Control](/blog/multi-tenant-ai-cost-control-per-tenant-budgets-quotas-isolation) — the noisy-neighbor scenario, configured
- [The True Cost of Uncontrolled AI Agents](/blog/true-cost-of-uncontrolled-agents) — both calculators, mid-post
- [Your AI Agent Just Burned $6 in 30 Seconds](/blog/runaway-demo-agent-cost-blowup-walkthrough) — the runaway-loop pattern
