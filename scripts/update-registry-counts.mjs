#!/usr/bin/env node
/**
 * Refresh per-package and aggregate registry counts (npm / PyPI / crates.io)
 * in installs-cache.json. Runs as step 1 of refresh-counts.yml, replacing
 * the previous inline bash + curl + jq.
 *
 * Per-package HWMs solve a real failure mode of the aggregate-only
 * approach: when one package's API call fails (pypistats.org has known
 * intermittent CDN issues), the surviving packages' growth would be
 * masked by the aggregate HWM that "looks like a regression". Per-
 * package HWMs preserve each package's high-water independently, so
 * one transient failure cannot mask another package's legitimate growth.
 *
 * Aggregate HWMs (npm/pypi/crates as scalars) are kept as a defensive
 * backstop: during cold-start migration when the per-package maps are
 * empty, the aggregate HWM still protects against regression.
 *
 * Mirrors the per-source logic in installs.data.ts (the build-time
 * loader). The workflow and the build converge on the same cache state.
 *
 * Does NOT write `total` or `fetchedAt` — those are written by
 * scripts/update-github-counts.mjs (step 2), which is the single
 * canonical writer for the displayed total.
 */

import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { resolve } from 'node:path'

const ROOT = process.cwd()
const CACHE_PATH = resolve(ROOT, '.vitepress/theme/installs-cache.json')

// Package lists are duplicated in installs.data.ts (the build-time
// loader). Keep them in sync by convention; both files reference the
// other in their per-source comments.
const NPM_PACKAGES = [
  'runcycles',
  '@runcycles/mcp-server',
  '@runcycles/openclaw-budget-guard',
]
const PYPI_PACKAGES = [
  'runcycles',
  'runcycles-ap2',
  'runcycles-openai-agents',
  'langchain-runcycles',
]
const CRATES_PACKAGES = [
  'runcycles',
]

function readCache() {
  if (!existsSync(CACHE_PATH)) {
    // Cold start with the current schema — empty everything.
    return {
      npm: 0, pypi: 0, crates: 0,
      npmByPackage: {}, pypiByPackage: {}, cratesByPackage: {},
      clones: 0, clonesByRepo: {},
      releases: 0, releasesByRepo: {},
      ghPackages: 0, maven: 0,
      total: 0, fetchedAt: '',
    }
  }
  const raw = JSON.parse(readFileSync(CACHE_PATH, 'utf-8'))
  // Schema-regression guard (mirrors installs.data.ts and the prior
  // bash version). A cache with the legacy `ghcr` field and no
  // `clones`/`clonesByRepo` is a wiped accumulator — refuse to operate.
  if ('ghcr' in raw && !('clones' in raw && 'clonesByRepo' in raw)) {
    console.error(`::error::cache schema regression at ${CACHE_PATH}: pre-PR-#515 shape detected.`)
    console.error(`Re-seed via 'GITHUB_TOKEN=... npm run build' locally and commit. See .outreach/installs-cache-runbook.md.`)
    process.exit(1)
  }
  return raw
}

// `null` return signals "API call failed, do not lower the cached value
// for this package". A successful `0` (e.g., a brand-new package) is
// distinct: it is a real, low number and HWM will treat it as such.
async function fetchNpm(pkg) {
  const today = new Date().toISOString().slice(0, 10)
  try {
    const res = await fetch(`https://api.npmjs.org/downloads/point/2020-01-01:${today}/${pkg}`)
    if (!res.ok) return null
    const j = await res.json()
    return typeof j.downloads === 'number' ? j.downloads : null
  } catch {
    return null
  }
}

async function fetchPypi(pkg) {
  try {
    const res = await fetch(`https://pypistats.org/api/packages/${pkg}/overall?mirrors=false`)
    if (!res.ok) return null
    const j = await res.json()
    if (!j || !Array.isArray(j.data)) return null
    return j.data.reduce((s, r) => s + (r.downloads ?? 0), 0)
  } catch {
    return null
  }
}

async function fetchCrates(pkg) {
  try {
    const res = await fetch(`https://crates.io/api/v1/crates/${pkg}`, {
      headers: { 'User-Agent': 'runcycles-docs (https://github.com/runcycles/cycles-docs)' },
    })
    if (!res.ok) return null
    const j = await res.json()
    return typeof j?.crate?.downloads === 'number' ? j.crate.downloads : null
  } catch {
    return null
  }
}

/**
 * Apply per-package HWM and return both the updated map and the aggregate.
 *
 * For each declared package:
 *   - if the API call succeeded: HWM = max(fresh, cached_for_this_package)
 *   - if it failed (fresh is null): preserve the cached value
 *
 * Packages NOT in the declared list but present in the cached map are
 * preserved as-is (e.g., a package was removed from the source list but
 * its prior count stays in the cache so the aggregate doesn't regress).
 */
function hwmPerPackage(packages, fetched, cachedByPackage) {
  const updated = { ...cachedByPackage }
  for (const pkg of packages) {
    const fresh = fetched[pkg]
    const cached = updated[pkg] ?? 0
    updated[pkg] = fresh != null ? Math.max(fresh, cached) : cached
  }
  const aggregate = Object.values(updated).reduce((sum, v) => sum + (typeof v === 'number' ? v : 0), 0)
  return { byPackage: updated, aggregate }
}

async function main() {
  const cache = readCache()

  // Fetch fresh per-package counts (parallel within each registry).
  const [npmEntries, pypiEntries, cratesEntries] = await Promise.all([
    Promise.all(NPM_PACKAGES.map(async (pkg) => [pkg, await fetchNpm(pkg)])),
    Promise.all(PYPI_PACKAGES.map(async (pkg) => [pkg, await fetchPypi(pkg)])),
    Promise.all(CRATES_PACKAGES.map(async (pkg) => [pkg, await fetchCrates(pkg)])),
  ])
  const npmFetched    = Object.fromEntries(npmEntries)
  const pypiFetched   = Object.fromEntries(pypiEntries)
  const cratesFetched = Object.fromEntries(cratesEntries)

  console.log('npm fresh:   ', JSON.stringify(npmFetched))
  console.log('pypi fresh:  ', JSON.stringify(pypiFetched))
  console.log('crates fresh:', JSON.stringify(cratesFetched))

  // Per-package HWM, then derive aggregate from the per-package map.
  const npmRes    = hwmPerPackage(NPM_PACKAGES,    npmFetched,    cache.npmByPackage    ?? {})
  const pypiRes   = hwmPerPackage(PYPI_PACKAGES,   pypiFetched,   cache.pypiByPackage   ?? {})
  const cratesRes = hwmPerPackage(CRATES_PACKAGES, cratesFetched, cache.cratesByPackage ?? {})

  cache.npmByPackage    = npmRes.byPackage
  cache.pypiByPackage   = pypiRes.byPackage
  cache.cratesByPackage = cratesRes.byPackage

  // Aggregate HWM safety net: during cold-start migration the per-package
  // map is empty and the aggregate from per-package would be lower than
  // the legacy aggregate. max() preserves the legacy floor until per-
  // package data catches up.
  cache.npm    = Math.max(npmRes.aggregate,    typeof cache.npm    === 'number' ? cache.npm    : 0)
  cache.pypi   = Math.max(pypiRes.aggregate,   typeof cache.pypi   === 'number' ? cache.pypi   : 0)
  cache.crates = Math.max(cratesRes.aggregate, typeof cache.crates === 'number' ? cache.crates : 0)

  console.log(
    `hwm: npm=${cache.npm} (per-pkg sum=${npmRes.aggregate})` +
    ` pypi=${cache.pypi} (per-pkg sum=${pypiRes.aggregate})` +
    ` crates=${cache.crates} (per-pkg sum=${cratesRes.aggregate})`
  )

  // Don't write `total` or `fetchedAt` — step 2 (update-github-counts.mjs)
  // owns those fields, so there is a single canonical writer for the
  // displayed total (matching the installs.data.ts loader formula).
  writeFileSync(CACHE_PATH, JSON.stringify(cache, null, 2) + '\n')
  console.log(`wrote ${CACHE_PATH}`)
}

main().catch((err) => {
  console.error('::error::update-registry-counts failed:', err.message ?? err)
  process.exit(1)
})
