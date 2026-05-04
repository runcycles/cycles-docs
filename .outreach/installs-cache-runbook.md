# `installs-cache.json` runbook

The home-page social-proof counter (`<n>+ package installs · <n> repo clones`)
reads from `.vitepress/theme/installs-cache.json`. This file is **committed
to the repo on purpose** and needs careful handling.

## Why it's committed

Several of the underlying APIs are rolling-window only, not all-time:

- **PyPI's `pypistats`** returns last-30-days downloads only
- **GitHub's `traffic/clones`** returns last-14-days only
- Both will report SMALLER numbers than the historical peak

To prevent the displayed counter from sliding backward as old activity
falls off the rolling window, the cache stores per-source high-water
marks (for PyPI) and per-repo day-cursor accumulators (for clones). The
cache is read at build time; new activity is added; the new cache is
written back.

If the cache file isn't committed, every fresh CI build starts from
zero and the displayed counter regresses to whatever the rolling
windows currently show — typically a fraction of the true cumulative
total.

## Required env at build time

```
GITHUB_TOKEN  (or GH_TOKEN)  — needs `repo` scope minimum
```

Without a token, `fetchGithubClones()` returns immediately (line ~213
of `installs.data.ts`) because the GitHub `traffic/clones` API requires
push access on each repo. Builds without a token still succeed, but
they don't UPDATE the clones data — they just propagate whatever was
in the committed cache.

This means: **if CI runs without a token AND the committed cache is
empty/stale, the homepage shows zero clones.**

## Symptom: "the clones counter disappeared"

Cause: the homepage component reads `data.clones` and shows the stat
only when `clones > 0`. If the cache is missing the `clones` field
(old schema) or has `clones: 0` (no token), the stat hides entirely.

Fix:

```bash
# Locally, with gh CLI authenticated:
export GITHUB_TOKEN=$(gh auth token)
npm run build
git add .vitepress/theme/installs-cache.json
git commit -m "ops: re-seed installs cache"
```

Push, merge. The committed cache now has the latest data; subsequent
CI builds without a token will at least preserve it.

## Cache schema (current)

```ts
{
  npm: number,             // all-time, monotonic
  pypi: number,            // HWM of monthly rolling window
  crates: number,          // all-time, monotonic
  clones: number,          // accumulated clones (sum of clonesByRepo[*].count)
  clonesByRepo: {          // per-repo day-cursor accumulator
    [repo: string]: { count: number, lastSeenDay: 'YYYY-MM-DD' }
  },
  releases: number,        // sum of release-asset download_counts
  releasesByRepo: { [repo: string]: number },  // per-repo HWM
  ghPackages: number,      // sum from manual-package-counts.json
  maven: number,           // 0 — no public API
  total: number,           // displayed total (excludes clones)
  fetchedAt: string,       // ISO timestamp of last build that touched this file
}
```

## Schema regression detector

If the cache file shows `ghcr: 0` or is missing `clones` / `clonesByRepo`,
it's the pre-PR-#515 schema and needs re-seeding. Quick check:

```bash
jq 'has("clones")' .vitepress/theme/installs-cache.json
# expected: true
# if false: re-seed (see "Symptom" above)
```

## Manual GHCR counts

`.vitepress/theme/manual-package-counts.json` is also committed and
hand-maintained. GitHub's API does not expose container pull counts;
the maintainer copies them from
https://github.com/orgs/runcycles/packages monthly. Update cadence
listed in that file's `_note` field.

## CI checklist (add to deploy pipeline)

- [ ] `GITHUB_TOKEN` env var with `repo` scope is present
- [ ] Build runs with `process.env.GITHUB_TOKEN` reachable to Node
- [ ] `installs-cache.json` is committed BEFORE running build (so HWMs persist)
- [ ] Build's `[installs]` log line shows `clones+<n>(cache:<n>,...)` with non-zero values

If any of these is missing, the homepage clones counter will drift
toward zero across builds.
