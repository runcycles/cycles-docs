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

## Phase 9: User Review Loop
26. Present the post to the user for review
27. User will send external reviewer feedback — apply it precisely
28. Repeat until feedback says "publishable"

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
