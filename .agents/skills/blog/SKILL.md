---
name: blog
description: Draft, review, and publish a blog post for runcycles.io with full review cycles, SEO, fact-checking, and external research
user-invocable: true
---

# Blog Post Workflow

When the user invokes `/blog "topic"` or asks to write a blog post, follow this complete workflow:

## Phase 1: Setup
1. Create a new branch from main: `blog/<kebab-case-slug>`
2. Read 2-3 existing blog posts in `blog/` to calibrate tone and format
3. Search existing posts for related content, cross-link opportunities, and terminology to reuse
4. Check memory files for content strategy (what's been published, what gaps exist)

## Phase 2: Research
5. Search the existing blog library for any content that overlaps with the topic
6. Identify cross-linking targets (aim for 5-8 internal links for pillar posts)
7. Research external sources: framework docs, industry papers, developer community discussions
8. Note any claims that will need external verification

## Phase 3: Draft
9. Write the post following these standards:
   - Frontmatter: title (<60 chars), date, author (Albert Mavashev), tags (use established corpus tags), description (150-160 chars with keywords), blog: true, sidebar: false, featured: false
   - Filename: lowercase kebab-case, under 60 chars
   - Open with a concrete problem or scenario, not theory
   - Use tables and comparisons for complex topics
   - Link to related posts contextually in prose
   - Use canonical terminology: ALLOW/ALLOW_WITH_CAPS/DENY, reserve-commit, RISK_POINTS, runtime authority, action authority, authority attenuation
   - End with resource links section
10. Save to `blog/<slug>.md`

## Phase 4: Review Cycle 1 (parallel agents)
11. **Link verification:** Check every internal link resolves to an existing .md file
12. **Fact-check:** Verify all claims, dollar figures, and terminology against source posts
13. **SEO audit:** Title length, description length, keyword coverage (guardrails, production, security, risk, graceful degradation as relevant), heading structure, tag alignment
14. Apply all fixes from cycle 1

## Phase 5: Review Cycle 2
15. Full re-read for flow, consistency, and anything edits may have broken
16. Check for: absolute claims that should be softened, repetition between sections, filler

## Phase 6: Review Cycle 3
17. Final pass with scorecard rating each criterion 1-10:
    - Factual accuracy, Credibility, Cross-links, SEO, Code accuracy, Structure, Terminology, Tone
18. Overall must be **9+ out of 10**. If not, fix and re-rate.

## Phase 7: External Research
19. Cross-check key claims against external sources (framework docs, published guidance, academic papers)
20. Verify all external URLs are live
21. Add external references where they strengthen credibility
22. Soften any claims that can't be externally verified

## Phase 8: Glossary Linking
23. Run `node scripts/link-glossary-terms.js --file=blog/<slug>.md` on the new post
24. This auto-links first-use glossary terms to `/glossary#anchor` canonical definitions
25. Review the diff — the script is conservative but may need manual adjustment for edge cases

## Phase 9: External Reviewer Loop

External reviewer feedback is **input, not directive**. For every point: evaluate against source-of-truth (existing posts, upstream READMEs, spec files, framework docs), then decide **apply / modify / skip** with a one-line reason BEFORE touching the file. Push back when warranted — reviewers sometimes soften spec-backed claims, miss cross-links already present in the post, or contradict prior reviewer rounds. Both the conversation reply and the commit message should carry the apply/modify/skip table so the reasoning trail is preserved.

### Phase 9a: codex external review (when `codex` is on PATH)

If `codex --version` works, run codex-cli as the first external reviewer pass. Round 1 starts a fresh session:

```bash
codex exec --sandbox read-only --cd <repo-root> --skip-git-repo-check \
  -o /tmp/codex-review/round1.txt \
  "<reviewer-role prompt: point at the file, give blog tone rules, explicitly say
   NOT to edit files (read-only sandbox enforces this anyway), ask for output
   bucketed by FACTUAL / OVERCLAIM / CLARITY / STRUCTURE / CODE / TONE / OPEN QUESTIONS
   plus an OVERALL: SHIP / REVISE-MINOR / REVISE-MAJOR verdict>"
```

For round 2+, resume the same session — codex picks up the prior context from `~/.codex/sessions/`. **In 0.130.0, `codex exec resume` does NOT accept `--sandbox` or `--cd`** — those inherit from the original session and passing them errors out:

```bash
codex exec resume --last --skip-git-repo-check \
  -o /tmp/codex-review/round<N>.txt \
  "<apply/modify/skip report on round N-1 + answers to open questions
   + ask for next pass. Tell codex to return SHIP if nothing substantive remains.>"
```

Loop until codex returns `SHIP` or until findings are stylistic-only. Typical convergence is 2-3 rounds; cap at 4. Codex generally accepts well-reasoned push-back without re-litigation, so be explicit when skipping a finding ("upstream README uses this shorthand, staying consistent with source-of-truth"; "out of scope, covered by other-post.md"; "verified against framework docs, claim stands").

Commit each applied round with `blog: apply codex round-<N> review to <slug>` and include the apply/modify/skip tally + notable changes in the body.

### Phase 9b: human external reviewer

When the user sends external reviewer feedback (typically from a human reader they relayed through), apply the same evaluate-on-merit rule. Repeat until the user says "publishable."

## Phase 10: Publish
29. Commit with message: `blog: add <descriptive summary>`
30. Push branch and create PR with summary + test plan
31. Return PR URL

## Key Rules
- **Never overclaim.** Posts go through external fact-checking. Precision > boldness.
- **Acknowledge competitors.** Say what frameworks do well before critiquing gaps.
- **No product pitches.** Present Cycles concepts as best practices, not features.
- **Verify everything.** Every link, every dollar figure, every framework behavior claim.
- **Terminology must match.** Check reference_blog_terminology.md in memory.
