#!/usr/bin/env node
/**
 * Refreshes the GitHub-side fields of installs-cache.json + manual-package-counts.json
 * outside of build time, so the homepage clone counter doesn't go stale during
 * low-deploy weeks.
 *
 * Updates:
 *   - clones / clonesByRepo  (day-cursor accumulator on /traffic/clones, 14d API window)
 *   - releases / releasesByRepo  (HWM on release-asset download counts)
 *   - ghPackages  (attempted via API, but see note below)
 *
 * GHCR counts: the GitHub REST API does not actually populate `download_count`
 * for container packages, even with `read:packages` scope (verified 2026-05-07).
 * The field exists in the response schema but is always null. Until GitHub
 * exposes container pull counts programmatically, manual-package-counts.json is
 * the permanent source of truth and this script only logs a warning rather than
 * clobbering it. Maintainers refresh that file by peeking at
 * https://github.com/orgs/runcycles/packages.
 *
 * Mirrors the logic in .vitepress/theme/installs.data.ts so the build-time loader
 * and this scheduled job converge on the same cache state. HWM/cursor semantics
 * mean repeated runs are idempotent and safe to interleave with the build.
 *
 * Auth:
 *   - GH_TOKEN with `repo` scope on every public org repo (for /traffic/clones)
 *
 * Run locally:
 *   GH_TOKEN=$(gh auth token) node scripts/update-github-counts.mjs
 */

import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { resolve } from 'node:path'

const ORG = 'runcycles'
const TOKEN = process.env.GH_TOKEN || process.env.GITHUB_TOKEN || ''
const ROOT = process.cwd()
const CACHE_PATH = resolve(ROOT, '.vitepress/theme/installs-cache.json')
const MANUAL_PATH = resolve(ROOT, '.vitepress/theme/manual-package-counts.json')

if (!TOKEN) {
  console.error('::error::GH_TOKEN / GITHUB_TOKEN required')
  process.exit(1)
}

const headers = {
  Authorization: `Bearer ${TOKEN}`,
  Accept: 'application/vnd.github+json',
  'X-GitHub-Api-Version': '2022-11-28',
  'User-Agent': `${ORG}-docs-counts-updater`,
}

async function gh(path) {
  const url = path.startsWith('http') ? path : `https://api.github.com${path}`
  const res = await fetch(url, { headers })
  if (!res.ok) {
    const body = await res.text().catch(() => '')
    const err = new Error(`GitHub API ${res.status} ${res.statusText} on ${path}: ${body.slice(0, 200)}`)
    err.status = res.status
    throw err
  }
  return res.json()
}

// ── Read cache ───────────────────────────────────────────────────────
function readCache() {
  if (!existsSync(CACHE_PATH)) {
    return {
      npm: 0, pypi: 0, crates: 0,
      clones: 0, clonesByRepo: {},
      releases: 0, releasesByRepo: {},
      ghPackages: 0, maven: 0,
      total: 0, fetchedAt: '',
    }
  }
  const raw = JSON.parse(readFileSync(CACHE_PATH, 'utf-8'))
  // Guard against pre-PR-#515 schema (matches installs.data.ts and the schema-check workflow).
  if ('ghcr' in raw && !('clones' in raw)) {
    throw new Error(`Cache schema regression at ${CACHE_PATH}: missing clones, has legacy ghcr.`)
  }
  return raw
}

// ── List org repos (public, non-archived) ────────────────────────────
async function listRepos() {
  const repos = []
  let page = 1
  while (true) {
    const batch = await gh(`/orgs/${ORG}/repos?per_page=100&type=public&page=${page}`)
    if (!batch.length) break
    for (const r of batch) {
      if (!r.archived && !r.disabled) repos.push(r.name)
    }
    if (batch.length < 100) break
    page++
  }
  return repos
}

// ── Clones: day-cursor accumulator ───────────────────────────────────
// /traffic/clones returns 14d rolling. We add only days strictly after
// lastSeenDay to avoid double-counting on overlapping windows.
async function updateClones(repos, byRepo) {
  const updated = { ...byRepo }
  let added = 0
  let permsErrors = 0
  await Promise.all(repos.map(async (repo) => {
    try {
      const data = await gh(`/repos/${ORG}/${repo}/traffic/clones`)
      const cur = updated[repo] ?? { count: 0, lastSeenDay: '1970-01-01' }
      let newCount = cur.count
      let newLastSeen = cur.lastSeenDay
      for (const day of data.clones ?? []) {
        const dayKey = day.timestamp.slice(0, 10) // YYYY-MM-DD
        if (dayKey > cur.lastSeenDay) {
          newCount += day.count ?? 0
          if (dayKey > newLastSeen) newLastSeen = dayKey
        }
      }
      added += newCount - cur.count
      updated[repo] = { count: newCount, lastSeenDay: newLastSeen }
    } catch (e) {
      if (e.status === 403) permsErrors++
      else console.error(`  ! clones fetch ${repo}: ${e.message}`)
    }
  }))
  if (permsErrors > 0) {
    console.warn(`  ! ${permsErrors} repos returned 403 on /traffic/clones — token needs 'repo' scope`)
  }
  const total = Object.values(updated).reduce((s, r) => s + r.count, 0)
  console.log(`clones: +${added} new days, total=${total}`)
  return { byRepo: updated, total }
}

// ── Stale-cursor guard ───────────────────────────────────────────────
// /traffic/clones is a 14-day rolling window. If this script doesn't run
// for >14 days, days fall off the end of the API window and are lost
// permanently. Warn loudly when any repo's cursor slips beyond a safety
// threshold (default 7 days) so the issue is visible before data loss.
const STALE_DAYS_THRESHOLD = 7
function checkStaleClones(byRepo) {
  const today = new Date().toISOString().slice(0, 10)
  const todayMs = Date.parse(today + 'T00:00:00Z')
  const stale = []
  for (const [repo, info] of Object.entries(byRepo)) {
    if (!info?.lastSeenDay || info.lastSeenDay === '1970-01-01') continue
    const lastMs = Date.parse(info.lastSeenDay + 'T00:00:00Z')
    const daysBehind = Math.floor((todayMs - lastMs) / 86_400_000)
    if (daysBehind > STALE_DAYS_THRESHOLD) {
      stale.push({ repo, lastSeenDay: info.lastSeenDay, daysBehind })
    }
  }
  if (stale.length === 0) {
    console.log(`stale-cursor check: all ${Object.keys(byRepo).length} repos within ${STALE_DAYS_THRESHOLD}d of today (${today})`)
    return
  }
  for (const { repo, lastSeenDay, daysBehind } of stale) {
    console.warn(`::warning::stale clones cursor: ${repo} lastSeenDay=${lastSeenDay} (${daysBehind}d behind today=${today})`)
  }
  console.warn(`::warning::${stale.length}/${Object.keys(byRepo).length} repo(s) have stale clones cursors. /traffic/clones is a 14d rolling window — fix the scheduled workflow before days fall off.`)
}

// ── Releases: HWM on asset download_count per repo ───────────────────
// For runcycles, every release exists as a tag-only release with no
// attached assets (Java services publish to GHCR; SDKs publish to PyPI/
// npm/Maven Central). So this returns 0 for all repos in practice.
// Kept for parity with installs.data.ts and to surface counts if asset
// uploads are ever added.
async function updateReleases(repos, byRepo) {
  const updated = { ...byRepo }
  await Promise.all(repos.map(async (repo) => {
    try {
      const releases = await gh(`/repos/${ORG}/${repo}/releases?per_page=100`)
      let total = 0
      for (const rel of releases) {
        for (const asset of rel.assets ?? []) {
          total += asset.download_count ?? 0
        }
      }
      const cached = byRepo[repo] ?? 0
      updated[repo] = Math.max(total, cached)
    } catch (e) {
      console.error(`  ! releases fetch ${repo}: ${e.message}`)
    }
  }))
  const total = Object.values(updated).reduce((a, b) => a + b, 0)
  console.log(`releases: total=${total} (currently always 0 — no release assets across the org)`)
  return { byRepo: updated, total }
}

// ── GHCR: org packages container download counts ─────────────────────
// The REST API does not actually populate `download_count` for container
// packages — the field is always null even with `read:packages` scope
// (verified 2026-05-07). We still hit the endpoint to detect the day
// GitHub starts populating it, but skip writing whenever every package
// returns null so the manual file isn't clobbered with zeros. Manual
// file remains the permanent source of truth until the API works.
async function updateGhPackages() {
  let packages
  try {
    packages = await gh(`/orgs/${ORG}/packages?package_type=container&per_page=100`)
  } catch (e) {
    if (e.status === 403) {
      console.warn('  ! GHCR step skipped: token lacks `read:packages` scope.')
      console.warn('  ! Add the scope to ORG_TRAFFIC_TOKEN to enable the API probe.')
      return null
    }
    throw e
  }
  if (!Array.isArray(packages) || packages.length === 0) {
    console.warn('  ! GHCR step skipped: API returned no packages.')
    return null
  }
  const byPackage = {}
  for (const pkg of packages) {
    if (typeof pkg.download_count === 'number') {
      byPackage[pkg.name] = pkg.download_count
    }
  }
  if (Object.keys(byPackage).length === 0) {
    console.warn(`  ! GHCR step skipped: API returned ${packages.length} packages but every download_count was null (known limitation — GHCR counts are not exposed via REST). Manual file is the source of truth.`)
    return null
  }
  const total = Object.values(byPackage).reduce((a, b) => a + b, 0)
  console.log(`ghPackages: ${Object.keys(byPackage).length} containers, total=${total}`)
  return { byPackage, total }
}

// ── Main ─────────────────────────────────────────────────────────────
async function main() {
  console.log(`updating GitHub-side counts for ${ORG}...`)
  const cache = readCache()
  const repos = await listRepos()
  console.log(`  repos: ${repos.length}`)

  const clonesResult = await updateClones(repos, cache.clonesByRepo)
  checkStaleClones(clonesResult.byRepo)
  const releasesResult = await updateReleases(repos, cache.releasesByRepo)
  const ghpkgResult = await updateGhPackages()

  // Write installs-cache.json (clones + releases always; ghPackages only
  // if the GHCR step succeeded — otherwise preserve the manual file).
  cache.clones = clonesResult.total
  cache.clonesByRepo = clonesResult.byRepo
  cache.releases = releasesResult.total
  cache.releasesByRepo = releasesResult.byRepo
  if (ghpkgResult) {
    cache.ghPackages = ghpkgResult.total
  }
  // Recompute displayed total (matches installs.data.ts formula —
  // excludes clones, includes registry + GitHub-side fields).
  const newTotal = (cache.npm ?? 0) + (cache.pypi ?? 0) + (cache.crates ?? 0)
                 + cache.releases + (cache.ghPackages ?? 0) + (cache.maven ?? 0)
  cache.total = Math.max(newTotal, cache.total ?? 0)
  cache.fetchedAt = new Date().toISOString()
  writeFileSync(CACHE_PATH, JSON.stringify(cache, null, 2) + '\n')
  console.log(`wrote ${CACHE_PATH}`)

  // Also refresh manual-package-counts.json from the GHCR API so the
  // build-time loader (which reads the manual file as ghPackages source)
  // stays in sync. Fall through silently if GHCR step was skipped.
  if (ghpkgResult && existsSync(MANUAL_PATH)) {
    const manual = JSON.parse(readFileSync(MANUAL_PATH, 'utf-8'))
    manual.lastVerifiedAt = new Date().toISOString().slice(0, 10)
    manual.ghPackages = { ...(manual.ghPackages ?? {}), ...ghpkgResult.byPackage }
    writeFileSync(MANUAL_PATH, JSON.stringify(manual, null, 2) + '\n')
    console.log(`wrote ${MANUAL_PATH}`)
  }
}

main().catch((e) => {
  console.error(`::error::${e.message}`)
  process.exit(1)
})
