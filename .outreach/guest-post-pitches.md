# Guest post pitches

Two outlets. Both reach AI-engineering practitioners — exactly the
buyer for runtime authority. Both have predictable editorial standards
(deep technical content, no vendor pitch).

The pitch emails are written to be **sent as-is**. Sign with the
founder's name + title — "Albert Mavashev, founder of runcycles.io"
reads better than the company speaking.

---

## Pitch 1 — Latent Space (swyx)

**Why Latent Space:** AI engineering audience, taste for systems-level posts, swyx specifically writes about the gap between "demos" and "production AI." Cycles' thesis — that runtime authority is the missing layer between agent frameworks and production — fits Latent Space's editorial line cleanly.

**Pitch target:**
- Pitch through the Latent Space contact form, OR
- Twitter/X DM to swyx with a one-liner pointing at the pitch
- Newsletter author email if listed (changes — verify on the site)

### Pitch email

**Subject:** `Guest pitch: "The Layer Between Agent Frameworks and Production That Nobody's Building"`

**Body:**

```
Hi swyx,

Big fan — your "AI Engineer" framing is the cleanest articulation I've
seen of why this generation of tooling is different. Your last piece on
production AI infrastructure gaps is what I want to write underneath of.

I've been building Cycles (runcycles.io) — an open-source runtime
authority layer for AI agents. The premise: agent frameworks
(LangChain, LangGraph, CrewAI, OpenAI Agents SDK) provide
orchestration and content guardrails, but no cross-agent cross-tenant
ledger-backed gate for *actions* — budget limits, action authority,
multi-tenant isolation, blast-radius containment. That gap is where
production AI keeps breaking (Cursor + Railway, the OpenAI agent
content-vs-action distinction, the multi-tenant noisy-neighbor
pattern, etc.).

I'd like to write a guest post for Latent Space on:

**The Layer Between Agent Frameworks and Production That Nobody's
Building**

The thesis: there's a missing tier in the AI engineering stack,
visible most clearly in incident postmortems. Frameworks aren't going
to solve it (they have no authority layer), observability tools won't
solve it (they record after the fact), and provider-side rate limits
can't solve it (org-scope, not tenant-scope). The post would walk
through 4 incident patterns from public reporting and propose what
the missing layer should look like — drawing on concrete primitives
(reservation-commit, action authority, RISK_POINTS, three-way
decisions).

Not a product post. Cycles is the implementation we've shipped, but
the post argues at the architecture level — readers should leave with
a framework for evaluating whether their stack has the gap, not a
sales pitch for ours.

~2,500 words, three outbound links to original sources max.
Camera-ready draft inside two weeks if the angle works for you.
Happy to share recent posts I've written so you can sanity-check the
voice — runcycles.io/blog has the catalog.

Best,
Albert Mavashev
Founder, runcycles.io
```

### Outline (attach to follow-up if they bite)

```markdown
# The Layer Between Agent Frameworks and Production That Nobody's Building

## 1. The pattern: 4 incidents, 1 missing layer
- Cursor + Railway DROP TABLE (April 2026)
- OpenAI Agents SDK content-guardrails-but-no-action-control
- The multi-tenant noisy-neighbor (anonymized SaaS team incident)
- The retry-storm cost spike

## 2. Why each existing tier doesn't close the gap
- Frameworks: orchestration + content; not authority
- Observability: post-hoc; not preventive
- Provider rate limits / caps: org-wide, not per-tenant
- Least-privilege keys: necessary; not sufficient

## 3. What the missing layer looks like
- Pre-execution gating (the decide/reserve/commit lifecycle)
- Multi-unit budgets (USD / tokens / RISK_POINTS)
- Action authority denominated in *consequence*, not cost
- Atomic reservations under concurrency (the TOCTOU pattern)

## 4. Why it has to be its own tier
- Cross-cutting concern (cuts across every framework)
- Cross-tenant boundary (the framework doesn't know your customers)
- Auditable record by side effect (the layer creates evidence)

## 5. What the AI engineer can do this quarter
- Audit your tool surface for irreversible+public actions
- Add a per-action `RISK_POINTS` cap (or equivalent)
- Run the workload through a blast-radius calculator
- (Cycles linked once, in the implementation-options paragraph,
  alongside the alternatives — least-privilege, approval flows,
  read-only mirrors)
```

---

## Pitch 2 — LangChain Blog

**Why LangChain Blog:** Direct platform fit (Cycles ships first-class LangChain + LangGraph integrations), the audience is exactly the buyer, and LangChain's blog tolerates technical guest posts that elevate the ecosystem rather than competing with the platform.

**Pitch target:**
- LangChain marketing / DevRel email (find current contact via langchain.com/contact or LinkedIn)
- DM @hwchase17 only if you have a warm intro path

### Pitch email

**Subject:** `Guest post pitch: Production-grade budget control for LangChain and LangGraph agents`

**Body:**

```
Hi LangChain team,

I run runcycles.io — an Apache-2.0 runtime authority layer for AI
agents that pre-execution gates LLM calls and tool invocations against
budgets and action limits. We ship native integrations for LangChain
(both Python and JS) and LangGraph, and over the past few months I've
been writing about the production patterns we see teams hit.

I'd like to write a guest post on the LangChain blog covering:

**Production-Grade Budget Control for LangChain and LangGraph Agents**

The post would walk through, with code:

- Why per-tenant budget control is the dominant cost-failure pattern
  in multi-tenant SaaS using LangChain
- How the LangChain `Callbacks` + `Runnable` interfaces compose with
  a runtime authority layer (specifically: where the gate sits in
  `RunnableSequence.invoke`)
- The same pattern in LangGraph — where the gate sits in node-level
  execution, and how it interacts with `interrupt()` / human review
- Three failure modes the integration prevents: runaway loops,
  retry storms, and noisy-tenant headroom drain

Not a sales post. Cycles is the implementation, but the patterns
generalize — the integration points are what matter for LangChain
users. ~1,800 words, runnable code, minimal product mentions
(linked at the bottom, not woven through).

I've shipped 76 blog posts on these patterns at runcycles.io/blog —
happy to share whatever you'd like to vet voice / depth.

Best,
Albert Mavashev
Founder, runcycles.io
```

### Outline (attach to follow-up if they bite)

```markdown
# Production-Grade Budget Control for LangChain and LangGraph Agents

## 1. The cost-failure shape
- Per-tenant noisy-neighbor (real example, anonymized)
- Retry storms within a `Runnable` chain
- Runaway loops in stateful LangGraph workflows

## 2. Where the gate sits in LangChain
- The `Callbacks` injection point (BaseCallbackHandler.on_llm_start)
- Pre-execution decision: ALLOW / DENY / ALLOW_WITH_CAPS
- Post-execution commit (with the actual token counts)
- Code: 30-line wrapping pattern

## 3. Where the gate sits in LangGraph
- Node-level pre-execution gate
- Interaction with `interrupt()` for human escalation on DENY
- The state machine's view: gate decision becomes a first-class
  state transition
- Code: 40-line example

## 4. Three failure modes prevented
- Per-run budget caps prevent runaway loops
- Atomic reservations prevent concurrent overspend
- Per-tenant scopes prevent noisy-neighbor

## 5. When this layer is overkill
- Single-tenant / single-user demos: skip it
- Workflows with deterministic call counts: skip it
- Anything in production with autonomous tool use: install it
```

---

## Pitch follow-up cadence

- Send the pitch.
- If no reply in **7 days**, send a one-paragraph nudge ("circling back — happy to share the draft outline; if the angle doesn't fit I'll find a different home").
- If no reply in **14 days**, drop it. Move on. Don't pester.

## What we won't do

- **No sponsored posts** in this batch. Sponsored posts mark the link as `rel=sponsored` (or worse, `nofollow`), which kills the SEO benefit. Editorial guest posts only.
- **No "run my draft" requests to high-DA sites we haven't earned attention with.** Pragmatic Engineer, a16z `future`, Stratechery — those are correctly out of scope until we have organic traction worth pitching with.
- **No paid placements on AI newsletters that read as content marketing.** They look like ads to readers and search engines.
