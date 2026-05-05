# Directory listings

Modest individual SEO weight; meaningful aggregate effect because each
appears in "alternatives to X" comparison-stage searches. Submit
sequentially over a week, not all at once.

Five canonical assets to have ready before you start:

1. **One-line tagline (under 80 chars):**
   `Runtime authority for AI agents — bound spend and risky actions before they execute.`

2. **Short description (200–300 chars):**
   `Open-source runtime authority for autonomous AI agents. Cycles enforces hard cost and action budgets before LLM calls and tool invocations execute. Apache 2.0, self-hosted, with SDKs for Python, TypeScript, Rust, Spring Boot, and an MCP server for Claude / Cursor / Windsurf.`

3. **Long description (~600 chars):**
   `Cycles is an open-source (Apache 2.0) runtime authority layer for autonomous AI agents. Where observability tools record what happened and rate limits cap throughput, Cycles decides — before each call — whether the action should be allowed at all. It enforces hard dollar budgets, action authority (RISK_POINTS denominated in consequence), and per-tenant scopes through an atomic reserve→commit→release lifecycle. Self-hosted, with native integrations for LangChain, LangGraph, OpenAI Agents SDK, MCP (Claude Code/Cursor/Windsurf), and 20+ other frameworks. Two interactive calculators model cost and blast-radius risk against your own workload.`

4. **Logo:** `/runcycles-logo.svg` and `/runcycles-logo-192.png` from the docs site.

5. **Screenshot:** the standalone calculator at `/calculators/ai-agent-blast-radius-standalone` is the most visually distinctive single screen.

---

## 1. AlternativeTo

**URL:** https://alternativeto.net/software/new

**Listing path:** `Categories: Developer Tools → AI / Machine Learning`. Mark as `Open Source` and `Free`.

**Name:** `Cycles`
**Tagline:** `Runtime authority for AI agents — bound spend and risky actions before they execute.`
**Description:** Use the long description from the canonical assets above.
**License:** Apache 2.0
**Platforms:** Linux, macOS, Windows (self-hosted), Docker
**Website:** https://runcycles.io
**GitHub:** https://github.com/runcycles
**Pricing:** Free, Open Source

**"Alternatives to" tags to claim** (so Cycles shows up in those competitive searches):
- LangSmith (observability — different but adjacent)
- Helicone (observability)
- Langfuse (observability)
- LiteLLM (proxy — different but adjacent)
- Portkey (gateway)
- Helicone

Be honest: those are *complements*, not direct alternatives. AlternativeTo allows the claim and lets users vote on whether the alternative-of relation holds. Strong upvote on Cycles ↔ LangSmith would be expected; lower on Cycles ↔ LiteLLM.

---

## 2. Slant

**URL:** https://www.slant.co/

**Approach:** Slant works on "best X for Y" ranked lists. Find or create:

- "What are the best open-source observability tools for LLM applications?" — add Cycles as an entry, but **frame it as enforcement**, not observability. The point is to appear in the comparison set when buyers are evaluating.
- "What are the best AI agent governance tools?" — primary listing.
- "What are the best cost-control tools for OpenAI / Anthropic API usage?" — listing.

**Pros to vote up** (these are the bullets that defend Cycles in the ranking):
- Open source (Apache 2.0)
- Self-hosted, no prompt storage
- Pre-execution gating, not after-the-fact alerting
- Multi-language SDKs
- Per-tenant budget isolation built-in
- Native integrations with the major frameworks

**Cons to vote up** (Slant's algorithm rewards listings with honest cons; it builds trust):
- Newer project, smaller community than dashboards-only alternatives
- Requires self-hosting (no SaaS tier yet)
- The mental model takes 30 minutes to internalize

---

## 3. There's An AI For That (TAAFT)

**URL:** https://theresanaiforthat.com/submit/

**Categories:** `Developer Tools` and `AI Agents` and `Cost Optimization`

**Name:** `Cycles`
**Tagline:** `Runtime authority for AI agents — bound spend and risky actions before they execute.`
**Description:** Use the short description from the canonical assets.
**Pricing:** Free / Open Source
**Use cases:**
- Bound LLM spend per agent run
- Cap risk per agent action
- Multi-tenant SaaS LLM cost isolation
- Pre-execution gates for tool calls (deploy / send / delete)
- MCP-level budget control for Claude Code / Cursor / Windsurf

TAAFT requires a screenshot — use the **standalone Blast Radius Risk Calculator** at full window size.

---

## 4. Product Hunt — relaunch

**URL:** https://www.producthunt.com/

A Product Hunt v2 launch is reasonable now that the calculators ship.
Frame it as a **launch of the calculators**, not a relaunch of Cycles
itself — PH is allergic to relaunches but receptive to "we shipped a
new thing" framing.

**Title:** `Cycles Calculators — Free tools that quantify AI agent cost and blast-radius risk`

**Tagline (60 chars max):** `Free, shareable, embeddable AI agent risk calculators`

**Description:**

```
Two free interactive tools for AI engineers:

1. Cost Calculator — compare per-call, per-day, per-month, per-year
   spend across current Claude and GPT models. Editable rates so you
   can plug in your contracted pricing.

2. Blast Radius Risk Calculator — quantifies the *damage envelope*
   of AI agent action classes by reversibility (×1 / ×3 / ×10) and
   visibility (+0 / +1 / +4), with a runtime-containment slider that
   shows what action authority is worth for your specific workload.

Both calculators encode their state in the URL hash, so any
configuration is a shareable link. Export to CSV, Markdown, or
branded PNG. Embeddable in any blog post or vendor-comparison
article via iframe.

Built on top of Cycles — the open-source (Apache 2.0) runtime
authority layer behind both calculators.
```

**Maker comment (post immediately after going live):**

```
Hey PH — Albert from Cycles here.

Quick context on why these calculators exist as standalone tools:
when we ship runtime authority for AI agents, the conversation
inevitably starts with "how much would this actually save / prevent
for *my* workload?" and we got tired of doing the math on whiteboards.

Both calculators encode the full state in the URL hash. So if you
configure the blast-radius calc with your agent's actions and
realistic error rates, you get a permanent shareable URL that
reproduces the exact view in any browser. We use this internally;
sharing it externally because it solves the same conversation for
anyone evaluating runtime authority.

Honest caveats on the page:
- Severity multipliers are illustrative defaults, not actuarial data
  (replace with your incident history if you have it)
- Pricing rates are dated 2026-04 and editable
- The calculator does not predict — it scopes the envelope

Would love feedback on the multipliers especially. The catastrophic
class (irreversible + public = ×14) is the most contested.
```

**Hunter (if you don't want to self-launch):** identify a hunter who
has launched in the AI / dev-tools space recently and reach out. Don't
pay for hunters — the usual rate ($500-$2k) doesn't move the
needle and PH is increasingly hostile to paid hunting.

---

## Submission cadence (one week)

| Day | Submit |
|---|---|
| Mon | AlternativeTo |
| Tue | Slant (add to 3 lists) |
| Wed | TAAFT |
| Thu | (rest) |
| Fri | Product Hunt launch (best day for PH is Tue/Wed but our cadence is what we have) |
| (next Mon) | Hacker News (separate from this directory batch — don't combine) |

## What's NOT in this batch (and why)

- **G2 / Capterra / Software Advice / TrustRadius** — review-driven directories, require purchased reviews to rank, B2B-SaaS-shaped (we're open source). Skip.
- **Crunchbase / PitchBook listings** — investor-facing, not buyer-facing. Skip until you raise.
- **DEV.to / Hashnode / Medium publications** — not directories; those are content-platform plays. Different motion.
- **GitHub topics** — not a "submission" surface, just topic tags on the repo. Already done; not in this batch.
