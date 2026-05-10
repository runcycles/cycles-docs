/**
 * Build-time data loader that aggregates total package activity across:
 *   - npm registry (downloads since 2020-01-01)
 *   - PyPI (cumulative non-mirror downloads — preserved via per-source high-water mark)
 *   - crates.io (all-time downloads)
 *   - GitHub repo clones (per-repo cumulative via day-cursor accumulation)
 *   - GitHub release-asset downloads (per-repo HWM; counts are monotonic)
 *   - Maven Central (no public API — placeholder for future)
 *
 * Per-source high-water marks ensure the displayed number never decreases
 * even when an API is down or returns partial data. GitHub clones use a
 * day-cursor accumulator instead of a HWM because the underlying API
 * returns a 14-day rolling window, not an all-time counter.
 */

import { readFileSync, writeFileSync } from 'fs'
import { resolve } from 'path'

export interface InstallsData {
  /** Defensible installs: npm + pypi + crates + releases + ghPackages + maven. */
  total: number
  /** Accumulated clone count across tracked repos (cumulative via day-cursor). */
  clones: number
  fetchedAt: string
}

export declare const data: InstallsData

interface ClonesPerRepo {
  count: number       // accumulated clones across the lifetime of the cache
  lastSeenDay: string // ISO date YYYY-MM-DD; only add days strictly after this
}

interface InstallsCache {
  npm: number
  pypi: number
  crates: number
  // Per-package HWMs. Aggregate fields above are derived from these
  // (with the aggregate value floored by its previous high during the
  // cold-start migration window). Per-package storage means a transient
  // failure on one package can't mask legitimate growth in another.
  npmByPackage: Record<string, number>
  pypiByPackage: Record<string, number>
  cratesByPackage: Record<string, number>
  clones: number
  clonesByRepo: Record<string, ClonesPerRepo>
  releases: number
  releasesByRepo: Record<string, number>
  ghPackages: number
  maven: number
  total: number
  fetchedAt: string
}

const CACHE_PATH = resolve(process.cwd(), '.vitepress/theme/installs-cache.json')
const MANUAL_PATH = resolve(process.cwd(), '.vitepress/theme/manual-package-counts.json')
const PUBLIC_PATH = resolve(process.cwd(), 'public/installs.json')

const GITHUB_ORG = 'runcycles'
const GITHUB_TOKEN = process.env.GITHUB_TOKEN || process.env.GH_TOKEN || ''

function readCache(): InstallsCache {
  let raw: any
  try {
    raw = JSON.parse(readFileSync(CACHE_PATH, 'utf-8'))
  } catch {
    // File missing or unparseable — cold start, allowed.
    return {
      npm: 0, pypi: 0, crates: 0,
      npmByPackage: {}, pypiByPackage: {}, cratesByPackage: {},
      clones: 0, clonesByRepo: {},
      releases: 0, releasesByRepo: {},
      ghPackages: 0,
      maven: 0, total: 0, fetchedAt: '',
    }
  }

  // Schema-regression detector: a cache file with the pre-PR-#515 shape
  // (presence of `ghcr` field, no `clones`/`clonesByRepo`) means the
  // accumulator state has been wiped — likely from a stale-checkout
  // commit or a hand-edit. Refusing to use such a file as the baseline
  // protects against silently propagating the regression on the next
  // write. Build fails loudly so the operator sees the runbook pointer
  // instead of the homepage clones counter quietly resetting.
  const hasOldSchema = 'ghcr' in raw
  const hasNewSchema = 'clones' in raw && 'clonesByRepo' in raw
  if (hasOldSchema && !hasNewSchema) {
    throw new Error(
      `[installs] cache schema regression detected at ${CACHE_PATH}: ` +
      `file has pre-PR-#515 shape ('ghcr' field, no 'clones'/'clonesByRepo'). ` +
      `Refusing to start build. ` +
      `Re-seed per .outreach/installs-cache-runbook.md.`
    )
  }

  return {
    npm:             raw.npm ?? 0,
    pypi:            raw.pypi ?? 0,
    crates:          raw.crates ?? 0,
    npmByPackage:    raw.npmByPackage    ?? {},
    pypiByPackage:   raw.pypiByPackage   ?? {},
    cratesByPackage: raw.cratesByPackage ?? {},
    clones:          raw.clones ?? 0,
    clonesByRepo:    raw.clonesByRepo ?? {},
    releases:        raw.releases ?? 0,
    releasesByRepo:  raw.releasesByRepo ?? {},
    ghPackages:      raw.ghPackages ?? 0,
    maven:           raw.maven ?? 0,
    total:           raw.total ?? 0,
    fetchedAt:       raw.fetchedAt ?? '',
  }
}

// ── GitHub Packages (manual config) ──────────────────────────────────
// GHCR pull counts are NOT exposed via the GitHub REST API. The
// `download_count` field appears in the response schema for both
// /orgs/{org}/packages?package_type=container and the per-version
// endpoint, but is always null for container packages even with
// `read:packages` scope (verified 2026-05-07). The field is only
// populated for some other registry types, not GHCR.
//
// The only source for GHCR counts is the public web UI at
// https://github.com/orgs/{org}/packages (rounded for high-traffic
// packages) and the per-package pages (exact integer for some).
// This manual file is the permanent source of truth for ghPackages;
// maintainers refresh it by peeking at the pages.
function fetchManualPackageCounts(): number {
  try {
    const raw = JSON.parse(readFileSync(MANUAL_PATH, 'utf-8'))
    const map = raw.ghPackages ?? {}
    return Object.values(map).reduce<number>((a, b) => a + (typeof b === 'number' ? b : 0), 0)
  } catch {
    return 0
  }
}

/**
 * Per-source HWM-monotonic field set checked at write time. If the on-disk
 * cache has a higher value for any of these than what we are about to
 * write, the write would regress the accumulator and is refused. This
 * protects against the failure mode where the loader read an empty/
 * malformed cache (defaults zero) and a build without GITHUB_TOKEN
 * computed degraded values that would otherwise overwrite a good file.
 */
const MONOTONIC_FIELDS = [
  'npm', 'pypi', 'crates', 'clones', 'releases', 'ghPackages', 'maven', 'total',
] as const

function writeCache(data: InstallsCache): void {
  // Re-read the file at write time to compare against. If it disappeared
  // between read and write (rare), allow the write to proceed.
  let existing: any = null
  try {
    existing = JSON.parse(readFileSync(CACHE_PATH, 'utf-8'))
  } catch { /* fresh checkout / missing file — write is fine */ }

  if (existing) {
    for (const field of MONOTONIC_FIELDS) {
      const onDisk = typeof existing[field] === 'number' ? existing[field] : 0
      const inMem  = typeof (data as any)[field] === 'number' ? (data as any)[field] : 0
      if (onDisk > inMem) {
        console.warn(
          `[installs] refusing cache write: would regress ${field} ` +
          `${onDisk} -> ${inMem}. Likely cause: build ran without ` +
          `GITHUB_TOKEN or hit an upstream API failure. ` +
          `See .outreach/installs-cache-runbook.md.`
        )
        return
      }
    }
  }

  try {
    writeFileSync(CACHE_PATH, JSON.stringify(data) + '\n')
  } catch { /* non-critical — CI environments may have read-only source dirs */ }
}

function ghHeaders(): Record<string, string> {
  const h: Record<string, string> = {
    'Accept': 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
    'User-Agent': 'runcycles-docs (https://github.com/runcycles/docs)',
  }
  if (GITHUB_TOKEN) h['Authorization'] = `Bearer ${GITHUB_TOKEN}`
  return h
}

// Per-package count fetchers. Return a map keyed by package name; the
// value is the fetched count, or `null` if the API call failed. The
// `null` distinction matters for HWM: a successful 0 (brand-new
// package) is treated as a real value, but a failure preserves the
// cached value instead of comparing against 0.
//
// Package lists are duplicated in scripts/update-registry-counts.mjs
// (the daily refresh workflow). Keep them in sync by convention.

// ── npm ──────────────────────────────────────────────────────────────
const NPM_PACKAGES = [
  'runcycles',
  '@runcycles/mcp-server',
  '@runcycles/openclaw-budget-guard',
] as const

async function fetchNpmDownloads(): Promise<Record<string, number | null>> {
  const today = new Date().toISOString().slice(0, 10)
  const entries = await Promise.all(
    NPM_PACKAGES.map(async (pkg): Promise<[string, number | null]> => {
      try {
        const res = await fetch(
          `https://api.npmjs.org/downloads/point/2020-01-01:${today}/${pkg}`
        )
        if (!res.ok) return [pkg, null]
        const json = await res.json() as { downloads?: number }
        return [pkg, typeof json.downloads === 'number' ? json.downloads : null]
      } catch {
        return [pkg, null]
      }
    })
  )
  return Object.fromEntries(entries)
}

// ── PyPI ─────────────────────────────────────────────────────────────
const PYPI_PACKAGES = [
  'runcycles',
  'runcycles-openai-agents',
  'langchain-runcycles',
] as const

// /overall returns a daily series of non-mirror downloads; summing it
// yields a cumulative total compatible with the per-source HWM used
// downstream. /recent .last_month was rolling and broke HWM semantics.
async function fetchPypiDownloads(): Promise<Record<string, number | null>> {
  const entries = await Promise.all(
    PYPI_PACKAGES.map(async (pkg): Promise<[string, number | null]> => {
      try {
        const res = await fetch(`https://pypistats.org/api/packages/${pkg}/overall?mirrors=false`)
        if (!res.ok) return [pkg, null]
        const json = await res.json() as { data?: Array<{ downloads?: number }> }
        if (!Array.isArray(json.data)) return [pkg, null]
        return [pkg, json.data.reduce((sum, row) => sum + (row.downloads ?? 0), 0)]
      } catch {
        return [pkg, null]
      }
    })
  )
  return Object.fromEntries(entries)
}

// ── crates.io ────────────────────────────────────────────────────────
const CRATES_PACKAGES = ['runcycles'] as const

async function fetchCratesDownloads(): Promise<Record<string, number | null>> {
  const entries = await Promise.all(
    CRATES_PACKAGES.map(async (pkg): Promise<[string, number | null]> => {
      try {
        const res = await fetch(
          `https://crates.io/api/v1/crates/${pkg}`,
          { headers: { 'User-Agent': 'runcycles-docs (https://github.com/runcycles/docs)' } }
        )
        if (!res.ok) return [pkg, null]
        const json = await res.json() as { crate?: { downloads?: number } }
        return [pkg, typeof json.crate?.downloads === 'number' ? json.crate.downloads : null]
      } catch {
        return [pkg, null]
      }
    })
  )
  return Object.fromEntries(entries)
}

/**
 * Apply per-package HWM and return both the updated map and the aggregate.
 *
 * For each declared package:
 *   - if the API call succeeded: HWM = max(fresh, cached_for_this_package)
 *   - if it failed (fresh is null): preserve the cached value
 *
 * Packages NOT in the declared list but present in the cached map are
 * preserved (e.g., a package was removed from the source list — its
 * prior count stays in the aggregate so removal doesn't regress the
 * displayed total). The aggregate is sum of the resulting per-package
 * map.
 */
function hwmPerPackage(
  packages: readonly string[],
  fetched: Record<string, number | null>,
  cachedByPackage: Record<string, number>,
): { byPackage: Record<string, number>; aggregate: number } {
  const updated: Record<string, number> = { ...cachedByPackage }
  for (const pkg of packages) {
    const fresh = fetched[pkg]
    const cached = updated[pkg] ?? 0
    updated[pkg] = fresh != null ? Math.max(fresh, cached) : cached
  }
  const aggregate = Object.values(updated).reduce(
    (sum, v) => sum + (typeof v === 'number' ? v : 0),
    0,
  )
  return { byPackage: updated, aggregate }
}

// ── GitHub: list org repos ───────────────────────────────────────────
async function listOrgRepos(): Promise<string[]> {
  // Public endpoint — works without auth, but auth raises rate limits.
  // Filter out forks/archived to count only first-party Cycles repos.
  const repos: string[] = []
  let page = 1
  while (page < 10 /* hard cap to avoid runaway loops */) {
    try {
      const res = await fetch(
        `https://api.github.com/orgs/${GITHUB_ORG}/repos?per_page=100&page=${page}`,
        { headers: ghHeaders() }
      )
      if (!res.ok) break
      const list = await res.json() as Array<{ name: string; fork: boolean; archived: boolean }>
      if (list.length === 0) break
      for (const r of list) {
        if (!r.fork && !r.archived) repos.push(r.name)
      }
      if (list.length < 100) break
      page++
    } catch {
      break
    }
  }
  return repos
}

// ── GitHub clones ────────────────────────────────────────────────────
// API returns a 14-day rolling window with per-day counts. We accumulate
// by tracking the lastSeenDay cursor per repo and only adding strictly
// newer days. This makes the counter monotonic and accurate over time.
async function fetchClonesForRepo(repo: string): Promise<Array<{ day: string; count: number }>> {
  if (!GITHUB_TOKEN) return [] // traffic API requires push access; without a token we get 403
  try {
    const res = await fetch(
      `https://api.github.com/repos/${GITHUB_ORG}/${repo}/traffic/clones`,
      { headers: ghHeaders() }
    )
    if (!res.ok) return []
    const json = await res.json() as {
      clones?: Array<{ timestamp: string; count: number }>
    }
    return (json.clones ?? []).map(c => ({
      day: c.timestamp.slice(0, 10),
      count: c.count,
    }))
  } catch {
    return []
  }
}

async function fetchGithubClones(
  cachedByRepo: Record<string, ClonesPerRepo>
): Promise<{ totalAdded: number; updatedByRepo: Record<string, ClonesPerRepo> }> {
  const repos = await listOrgRepos()
  const updated = { ...cachedByRepo }
  let totalAdded = 0

  await Promise.all(
    repos.map(async (repo) => {
      const days = await fetchClonesForRepo(repo)
      if (days.length === 0) return
      const cached = cachedByRepo[repo] ?? { count: 0, lastSeenDay: '' }
      let added = 0
      let newestDay = cached.lastSeenDay
      for (const { day, count } of days) {
        if (day > cached.lastSeenDay) {
          added += count
          if (day > newestDay) newestDay = day
        }
      }
      if (added > 0 || newestDay !== cached.lastSeenDay) {
        updated[repo] = {
          count: cached.count + added,
          lastSeenDay: newestDay,
        }
        totalAdded += added
      }
    })
  )

  return { totalAdded, updatedByRepo: updated }
}

// ── GitHub release-asset downloads ───────────────────────────────────
// `download_count` is monotonic per asset, so simple HWM per repo.
async function fetchReleaseDownloadsForRepo(repo: string): Promise<number> {
  try {
    const res = await fetch(
      `https://api.github.com/repos/${GITHUB_ORG}/${repo}/releases?per_page=100`,
      { headers: ghHeaders() }
    )
    if (!res.ok) return 0
    const releases = await res.json() as Array<{
      assets?: Array<{ download_count?: number }>
    }>
    let total = 0
    for (const rel of releases) {
      for (const asset of rel.assets ?? []) {
        total += asset.download_count ?? 0
      }
    }
    return total
  } catch {
    return 0
  }
}

async function fetchGithubReleaseDownloads(
  cachedByRepo: Record<string, number>
): Promise<{ total: number; updatedByRepo: Record<string, number> }> {
  const repos = await listOrgRepos()
  const updated = { ...cachedByRepo }

  await Promise.all(
    repos.map(async (repo) => {
      const fetched = await fetchReleaseDownloadsForRepo(repo)
      const cached = cachedByRepo[repo] ?? 0
      updated[repo] = Math.max(fetched, cached)
    })
  )

  const total = Object.values(updated).reduce((a, b) => a + b, 0)
  return { total, updatedByRepo: updated }
}

// ── Maven Central ────────────────────────────────────────────────────
// Maven Central has no public downloads API. The search API only
// exposes versionCount, not download stats. Sonatype Central exposes
// downloads to publishers via an authenticated CSV export, but that's
// not available at build time.
//
// Until publisher-credential access lands, we use the same manual-file
// pattern as ghPackages: maintainers paste current download counts from
// the Sonatype Central publisher portal into manual-package-counts.json
// under `maven` (keyed by `groupId:artifactId`). HWM still applies, so
// values only grow.
//
// TODO: replace with an authenticated Sonatype Central API call once a
// service-account credential is available — search the portal for
// "download statistics export" or use the s01.oss.sonatype.org REST API
// if the artifact is hosted there.
function fetchMavenDownloads(): number {
  try {
    const raw = JSON.parse(readFileSync(MANUAL_PATH, 'utf-8'))
    const map = raw.maven ?? {}
    return Object.values(map).reduce<number>((a, b) => a + (typeof b === 'number' ? b : 0), 0)
  } catch {
    return 0
  }
}

// ── Loader ───────────────────────────────────────────────────────────
export default {
  async load(): Promise<InstallsData> {
    const cached = readCache()

    const [
      npmFetched,
      pypiFetched,
      cratesFetched,
      clonesResult,
      releasesResult,
      mavenFetched,
    ] = await Promise.all([
      fetchNpmDownloads(),
      fetchPypiDownloads(),
      fetchCratesDownloads(),
      fetchGithubClones(cached.clonesByRepo),
      fetchGithubReleaseDownloads(cached.releasesByRepo),
      Promise.resolve(fetchMavenDownloads()),
    ])

    // Per-package HWM: each package's count never decreases independently.
    // Aggregate is the sum of the per-package map, floored by the previous
    // aggregate (cold-start migration safety net — once the per-package
    // map is fully populated, this floor becomes redundant).
    const npmHwm    = hwmPerPackage(NPM_PACKAGES,    npmFetched,    cached.npmByPackage)
    const pypiHwm   = hwmPerPackage(PYPI_PACKAGES,   pypiFetched,   cached.pypiByPackage)
    const cratesHwm = hwmPerPackage(CRATES_PACKAGES, cratesFetched, cached.cratesByPackage)
    const npm    = Math.max(npmHwm.aggregate,    cached.npm)
    const pypi   = Math.max(pypiHwm.aggregate,   cached.pypi)
    const crates = Math.max(cratesHwm.aggregate, cached.crates)
    const maven  = Math.max(mavenFetched,        cached.maven)

    // Clones: cumulative via day-cursor; sum of per-repo counts.
    const clones = Object.values(clonesResult.updatedByRepo).reduce((a, b) => a + b.count, 0)

    // Releases: per-repo HWM, summed.
    const releases = releasesResult.total

    // GitHub Packages: manual JSON config (no API support; HWM in case
    // the maintainer accidentally lowers a number while editing).
    const ghPackagesFetched = fetchManualPackageCounts()
    const ghPackages = Math.max(ghPackagesFetched, cached.ghPackages)

    // Displayed total — excludes `clones`. Clones are still tracked in
    // the cache for analytics, but the home-page counter is limited to
    // "deliberately pulled the package" sources because total clones
    // include heavy CI/bot traffic that inflates beyond what is
    // defensible to a skeptical visitor. Per-repo clone data remains in
    // clonesByRepo for future use.
    //
    // Per-source HWMs are already monotonic, so the sum is monotonic by
    // construction; no need for a separate cached.total floor (which
    // would also incorrectly hold the displayed total at a previously-
    // inflated value across this schema change).
    const total = npm + pypi + crates + releases + ghPackages + maven

    console.log(
      `[installs] npm=${npmHwm.aggregate}(hwm:${npm}) pypi=${pypiHwm.aggregate}(hwm:${pypi})` +
      ` crates=${cratesHwm.aggregate}(hwm:${crates})` +
      ` clones+${clonesResult.totalAdded}(cache:${clones}, NOT in displayed total)` +
      ` releases=${releases}` +
      ` ghPackages=${ghPackages}` +
      ` maven=${mavenFetched} total=${total} cached=${cached.total}`
    )

    const now = new Date().toISOString()
    const newCache: InstallsCache = {
      npm, pypi, crates,
      npmByPackage:    npmHwm.byPackage,
      pypiByPackage:   pypiHwm.byPackage,
      cratesByPackage: cratesHwm.byPackage,
      clones, clonesByRepo: clonesResult.updatedByRepo,
      releases, releasesByRepo: releasesResult.updatedByRepo,
      ghPackages,
      maven, total, fetchedAt: now,
    }

    if (
      total > cached.total
      || npm > cached.npm
      || pypi > cached.pypi
      || crates > cached.crates
      || clones > cached.clones
      || releases > cached.releases
      || ghPackages > cached.ghPackages
      || maven > cached.maven
    ) {
      writeCache(newCache)
    }

    // Write public/installs.json for runtime refresh in HomeSocialProof.vue
    try {
      writeFileSync(
        PUBLIC_PATH,
        JSON.stringify({ total, clones, fetchedAt: now }) + '\n',
      )
    } catch { /* non-critical */ }

    return { total, clones, fetchedAt: now }
  },
}
