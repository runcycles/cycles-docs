# Hacker News submission

One shot per quarter, max. Don't burn this on a low-conviction submission.

## Recommended target post

**`/blog/ai-agent-deleted-prod-database-9-seconds`** — Cursor AI Agent Reportedly Deleted a Production Database in 9 Seconds.

### Why this post

- Real incident (covered by The Register and The Verge — independent corroboration helps the submission survive scrutiny)
- Strong narrative tension (9 seconds, production database, recovery was lucky)
- Novel technical thesis ("prompts aren't permissions; agents need pre-execution gates") that HN comment threads can argue about
- The argument doesn't depend on Cycles — it's a structural critique of the broader pattern, with Cycles as the implementation answer in the second half. HN tolerates this framing; pure product launches get downvoted.

### Why NOT the obvious alternatives

- **`runaway-demo-agent-cost-blowup-walkthrough`** — too "demo / our product saves the day." HN smells this.
- **`cycles-vs-llm-proxies-and-observability-tools`** — comparison posts read as marketing on HN. Pass.
- **`mcp-tool-poisoning-why-agent-frameworks-cant-prevent-it`** — strong post but the 84% number is contested in some circles. Risk of the comment thread eating you alive on methodology.
- **`state-of-ai-agent-incidents-2026`** — survey-style, no narrative arc, harder to defend in comments.

---

## Submission

### Title (keep under 80 chars; current draft is 71)

```
Cursor AI Agent Deleted a Production Database in 9 Seconds (April 2026)
```

Alternative title if you want to lead with the structural lesson:

```
Prompts Aren't Permissions: Why AI Agents Keep Deleting Production
```

I'd test the **first** version. The incident-with-date framing reads as journalism / case study, which HN ranks higher than thesis posts.

### URL

```
https://runcycles.io/blog/ai-agent-deleted-prod-database-9-seconds
```

### Submit-as-link, not Show HN

**Don't** mark this as "Show HN" — the post isn't a product launch, and Show HN posts get demoted if they're too pitchy. Submit as a regular link.

---

## First comment (post immediately after submitting)

HN convention: if you're the author, drop one self-identifying comment so people know who to direct questions at. Keep it short, no marketing.

```
Author here. The piece focuses on the structural pattern rather than naming-and-shaming Cursor — the same chain (credentialed agent + destructive infra call + no pre-execution gate + large blast radius) is what every team deploying coding agents with production credentials is one missing layer away from.

Three things I tried hard not to overclaim:

1. The forensic record is JER's account + agent self-explanation. I lean on the corroboration from The Register and The Verge but flag where the public record stops.

2. The "missing gate" framing isn't unique to my company's product. Plenty of approaches close the same gap (least-privilege keys, per-tool approval flows, read-only mirrors). The argument is that *something* in this category has to exist; not that the answer is one specific implementation.

3. The post has a calculator at the end where you can plug in your own action profile. It's seeded with the database-coding-agent scenario from the post — I'd be curious if anyone disagrees with the severity multipliers I used (×11 for irreversible+customer-facing, ×14 for irreversible+public).

Happy to answer questions about the technical details or the policy design space.
```

### What this comment does

- Self-identifies as author (HN expects this)
- Pre-empts the two main attack vectors (over-claiming on facts, vendor pitch in disguise)
- Invites methodological pushback on the calculator multipliers — engaging *that* thread is how you win HN engagement, because methodology debate IS the audience
- Doesn't beg for upvotes or link-drop other content

---

## Timing & operations

- **Best windows**: Tuesday–Thursday, 8–10am Pacific. Avoid Mondays (weekend backlog) and Fridays (low traffic).
- **Don't submit twice.** If the first attempt doesn't get traction in 90 minutes, let it sink. Resubmissions are visible in the data and tank your account.
- **Don't ask anyone to upvote.** HN will detect coordinated voting and penalize the submission.
- **Watch the comment thread for 6 hours after submitting.** Respond to substantive comments quickly; ignore trolls. Author replies are weighted in the ranking algorithm.

---

## Backup plan

If the database post is rejected by mods (sometimes happens for reposts or tone), the next-strongest submission is:

**Title:** `Why Multi-Agent Systems Fail Up to 87% of the Time`
**URL:** `https://runcycles.io/blog/why-multi-agent-systems-fail-87-percent-cost-of-every-coordination-breakdown`

But run that through a sanity check first — the 87% figure should be backed by the post's own citations to a Berkeley study or similar. If you can't immediately point at the source, don't submit it; HN will eat that for breakfast.
