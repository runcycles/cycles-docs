# `.outreach/` — Backlink & distribution working drafts

Internal directory. **Not published** — `srcExclude` in `.vitepress/config.ts`
keeps it out of the VitePress build.

## What's here

| File | Purpose |
|---|---|
| `awesome-list-submissions.md` | Per-repo PR drafts for awesome-* lists (4 targets) |
| `hn-launch-post.md` | HN submission title + URL + first-author comment hook |
| `guest-post-pitches.md` | Pitch emails + post outlines for 2 outlets |
| `directory-listings.md` | Copy-pasteable text for AlternativeTo / Slant / TAAFT / Product Hunt |
| `tracker.md` | Submission tracker — date, status, link, response |

## How to use

Each file is action-ready: text + URL + target. The flow is:

1. Open the file
2. Copy the section for the target you're submitting to
3. Submit on the external surface
4. Update `tracker.md` with date / status / response link

The drafts are written to be **submitted as-is**. Don't over-edit — the
calibrated wording matters (length, framing, signal-to-noise) and the
goal is volume of inbound links from authoritative surfaces, not
perfection.

## Why these targets

The four channels in this batch are chosen for distinct backlink shapes:

- **Awesome-* lists** — permanent, evergreen links from popular GitHub repos. Each one's a one-shot PR with high cumulative discoverability.
- **HN** — burst traffic + permanent post URL. Pick one shot per quarter.
- **Guest posts** — high-DA editorial backlink + audience reach. 2-week turnaround typical.
- **Directories** — listing-grade SEO weight (modest), but they appear in "alternatives to X" search results which catches comparison-stage buyers.

## Tracking

Submissions are logged in `tracker.md` so we don't double-submit and
can measure conversion (link → traffic) post-hoc when GA / Plausible
data lands.
