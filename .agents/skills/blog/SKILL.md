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

## Review goal (applies to Phases 4, 5, 6, 9a, 9b)

Every review pass — Claude internal cycles AND codex AND human reviewer — must check the post comprehensively across **all eight quality dimensions**:

1. **Factual accuracy** — every claim verifiable against a source-of-truth.
2. **Credibility** — no overclaims, no hype, hedge appropriately on uncertain things.
3. **Cross-links** — every internal link resolves; placement is contextual, not dumped in lists; 5–8 internal links for pillar posts.
4. **SEO** — frontmatter title ≤ 51 chars, description 150–160 chars, keywords present in H2s naturally, tag alignment with the corpus.
5. **Code accuracy** — pseudocode and snippets match the actual source (operator order, types, fields, error paths); see Phase 4 source-code audit step.
6. **Structure & flow** — logical section order, transitions, no dead-ends, no buried lede.
7. **Terminology** — canonical Cycles terms used consistently (ALLOW/ALLOW_WITH_CAPS/DENY, reserve-commit, runtime authority, action authority, RISK_POINTS, etc.); see `reference_blog_terminology` memory.
8. **Tone & style** — technical, authoritative, conversational but not casual; no emoji, no marketing, no hype; competitor frameworks acknowledged before critique.

Each phase below applies these eight dimensions; no dimension is "owned" by a single phase. A review pass that returns "looks fine" without explicitly checking every dimension is incomplete.

## Phase 4: Review Cycle 1 (parallel agents)

Spawn agents in parallel — each covers a subset of the eight dimensions, jointly covering all of them:

11. **Link verification (dim 3):** Check every internal link resolves to an existing .md file; flag any link in a list rather than contextual prose; check link count is in the 5–8 range for pillar posts.
12. **Fact-check on prose (dims 1, 2):** Verify all prose claims, dollar figures, version numbers, and named features against source posts, upstream READMEs, and release notes; flag overclaims, hype phrases, unverifiable absolutes.
13. **Source-code audit (dims 1, 5) — when the post contains code or makes code-level claims:** Fetch the actual source files from the referenced upstream repo and verify, per claim. Discover the repo layout first (`gh api repos/<org>/<repo>/git/trees/main?recursive=1 --jq '.tree[] | select(.path | endswith(\".java\") or endswith(\".py\") or ...) | .path'`) before assuming any path — example paths in this skill or in prior prompts may be stale against the current package layout (e.g., `langchain_runcycles/...` vs `src/langchain_runcycles/...`). Then fetch and verify, per claim:
    - **Operator order in reactive/async code** — e.g. `doOnError` attached before vs. after `concatWith` changes whether commit-Mono failures trigger upstream cleanup. Reactor / RxJava / Project Reactor claims are particularly easy to get wrong from prose alone.
    - **Method signatures and return types** — does `chatClient.prompt().stream()` actually return `Flux<ChatResponse>`, or a stream-spec on which `.chatResponse()` yields it?
    - **Field names, action labels, header names** — anything quoted in backticks should be searchable in source.
    - **Behavior of fluent builders** — what fields are required, what defaults exist, what throws on missing input.
    - **Error / failure paths** — does the source actually release on the path the prose describes, or rely on TTL expiry, or do nothing?
    - **Annotation behavior** — `@ConditionalOnMissingBean`, `@Order`, advisor precedence values — verify against source, not memory.
    Do NOT trust the post's own pseudocode as ground truth: pseudocode that ships in a draft is the very thing being audited.
14. **SEO audit (dim 4):** Title length ≤ 51 chars, description length 150–160 chars (no mid-sentence truncation), keyword coverage natural in H2s, tag alignment with the established corpus tags, frontmatter `keywords` block populated.
15. **Style / tone / terminology audit (dims 6, 7, 8):** Re-read flagging: hype language, marketing register, casual asides that weaken authority, emoji, inconsistent capitalization of framework names (LangGraph, CrewAI, OpenAI Agents SDK), terminology drift (e.g. "reserve/commit" vs "reserve-commit"), competitor framing that critiques without first acknowledging strengths, buried lede in any section.
16. Apply all fixes from cycle 1.

## Phase 5: Review Cycle 2

Full re-read by Claude itself, not delegated — checking all eight dimensions in pass, plus the integration-level concerns the parallel agents can miss:

17. **Flow & integration:** Section ordering coherent? Transitions between sections work? Did any cycle-1 edit break flow elsewhere? Any section that no longer earns its place?
18. **Consistency:** Same terminology end-to-end? Same level of detail across sections? Repetition between sections?
19. **Softening:** Any absolute claims ("always", "never", "all") that should be hedged? Any speculation framed as fact? Any version-pinned statement missing a "current at publication" qualifier?
20. **Filler:** Any sentence whose deletion would not change the post's meaning? Any paragraph that exists to extend length, not deliver substance?

## Phase 6: Review Cycle 3
21. Final pass with scorecard rating each criterion 1-10 (these are the eight dimensions above, scored explicitly):
    - Factual accuracy, Credibility, Cross-links, SEO, Code accuracy, Structure, Terminology, Tone
22. Overall must be **9+ out of 10**. If not, fix and re-rate.

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
  "<reviewer-role prompt — must include all of:
   1. Point at the file.
   2. State that this is a comprehensive review across ALL eight quality
      dimensions: factual accuracy, credibility/overclaim, cross-links,
      SEO (title <= 51 chars, description 150-160 chars), code accuracy,
      structure/flow, terminology consistency, tone/style (technical, no
      hype, no marketing, no emoji, competitor frameworks acknowledged
      before critique). No dimension is skippable.
   3. Explicitly say NOT to edit files (read-only sandbox enforces this anyway).
   4. NAME THE UPSTREAM SOURCE REPOS and tell codex to fetch and read the
      relevant source files before judging code-level claims. **Do not pin
      file paths in the prompt** — codex's read-only sandbox typically
      blocks shell `gh` calls, so codex will route through its GitHub
      connector, and example paths in this template (or in your prompt) may
      be stale against the current package layout. Instruct codex to
      **discover the repo layout first** (list the tree), then locate
      relevant files by name pattern. Tell codex explicitly to verify
      operator order in any reactive/async pseudocode, method signatures of
      framework abstractions cited, error/release paths, fluent-builder
      requirements, type aliases against their actual source definitions,
      and any quoted identifier (field, action label, header) against the
      actual source. Do not trust the post's own pseudocode as ground truth.
   5. Ask for output bucketed by FACTUAL / OVERCLAIM / CROSS-LINKS / SEO /
      CODE / STRUCTURE / TERMINOLOGY / TONE / OPEN QUESTIONS — one bucket
      per dimension, so codex is forced to address each. Each bucket gets
      'NONE' if clean. Plus an OVERALL: SHIP / REVISE-MINOR / REVISE-MAJOR
      verdict.>"
```

**Why the comprehensive-coverage and source-verification clauses are mandatory:** without explicit per-dimension bucketing, codex tends to focus on whatever it spots first and skip the rest — a clean factual review can ship past a tone issue or a buried SEO problem. Without source-fetching, codex audits prose against the README and misses bugs where the prose matches the README's surface description but contradicts the actual source code. A real example from PR #642: a sibling codex session with a broader prompt caught a Reactor `doOnError`/`concatWith` operator-order bug that this session's narrower codex prompt missed.

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

## Phase 10: Final Scoring & Summary

After all review cycles (Claude internal 1–3, external research, glossary, codex 9a, human 9b) have settled and no more changes are pending, produce a **final scoring + summary** before publishing. This is a stop-and-report step — do not push the final commit or open the PR until the summary is in front of the user.

29. **Score the final post** on the same eight dimensions as Cycle 3, scored 1–10 each, with one short line of justification per dimension citing what was checked:
    - Factual accuracy, Credibility, Cross-links, SEO, Code accuracy, Structure & flow, Terminology, Tone & style
    Overall = average rounded to one decimal. Must still be **≥ 9.0**; if not, loop back to the relevant phase rather than ship.
30. **Present the final summary** as a single response to the user, including:
    - Title, slug, file path, branch
    - Word count and frontmatter status (title chars / 51, description chars / 160)
    - Per-dimension scorecard with one-line justifications
    - Overall score
    - Reviews performed (which cycles ran, codex round count, human reviewer round count)
    - Notable changes applied / push-backs taken across all rounds, summarized
    - Any open caveats the user should know before merge (e.g. "left v0.3.1 version pin with 'current at publication' qualifier")
    - Explicit ask: "Ready to merge, or any final changes?"
31. Wait for user confirmation before merge / final push.

## Phase 11: Publish
32. Commit with message: `blog: add <descriptive summary>` (if not already committed during review phases)
33. Push branch and create PR with summary + test plan (if not already opened during review phases)
34. Return PR URL

## Key Rules
- **Never overclaim.** Posts go through external fact-checking. Precision > boldness.
- **Acknowledge competitors.** Say what frameworks do well before critiquing gaps.
- **No product pitches.** Present Cycles concepts as best practices, not features.
- **Verify everything.** Every link, every dollar figure, every framework behavior claim.
- **Terminology must match.** Check reference_blog_terminology.md in memory.
