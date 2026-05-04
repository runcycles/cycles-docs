/**
 * Build-time data loader that aggregates total package activity across:
 *   - npm registry (downloads since 2020-01-01)
 *   - PyPI (last_month rolling — preserved via per-source high-water mark)
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
    npm:           raw.npm ?? 0,
    pypi:          raw.pypi ?? 0,
    crates:        raw.crates ?? 0,
    clones:        raw.clones ?? 0,
    clonesByRepo:  raw.clonesByRepo ?? {},
    releases:      raw.releases ?? 0,
    releasesByRepo: raw.releasesByRepo ?? {},
    ghPackages:    raw.ghPackages ?? 0,
    maven:         raw.maven ?? 0,
    total:         raw.total ?? 0,
    fetchedAt:     raw.fetchedAt ?? '',
  }
}

// ── GitHub Packages (manual config) ──────────────────────────────────
// GHCR pull counts are visible in the org packages UI but NOT exposed
// via any API endpoint (verified 2026-04). The maintainer updates
// .vitepress/theme/manual-package-counts.json periodically by peeking
// at https://github.com/orgs/runcycles/packages and copying the numbers.
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

// ── npm ──────────────────────────────────────────────────────────────
const NPM_PACKAGES = [
  'runcycles',
  '@runcycles/mcp-server',
  '@runcycles/openclaw-budget-guard',
]

async function fetchNpmDownloads(): Promise<number> {
  const today = new Date().toISOString().slice(0, 10)
  const totals = await Promise.all(
    NPM_PACKAGES.map(async (pkg) => {
      try {
        const res = await fetch(
          `https://api.npmjs.org/downloads/point/2020-01-01:${today}/${pkg}`
        )
        if (!res.ok) return 0
        const json = await res.json() as { downloads?: number }
        return json.downloads ?? 0
      } catch {
        return 0
      }
    })
  )
  return totals.reduce((a, b) => a + b, 0)
}

// ── PyPI ─────────────────────────────────────────────────────────────
const PYPI_PACKAGES = [
  'runcycles',
  'runcycles-openai-agents',
]

async function fetchPypiDownloads(): Promise<number> {
  const totals = await Promise.all(
    PYPI_PACKAGES.map(async (pkg) => {
      try {
        const res = await fetch(`https://pypistats.org/api/packages/${pkg}/recent`)
        if (!res.ok) return 0
        const json = await res.json() as { data?: { last_month?: number } }
        return json.data?.last_month ?? 0
      } catch {
        return 0
      }
    })
  )
  return totals.reduce((a, b) => a + b, 0)
}

// ── crates.io ────────────────────────────────────────────────────────
const CRATES_PACKAGES = ['runcycles']

async function fetchCratesDownloads(): Promise<number> {
  const totals = await Promise.all(
    CRATES_PACKAGES.map(async (pkg) => {
      try {
        const res = await fetch(
          `https://crates.io/api/v1/crates/${pkg}`,
          { headers: { 'User-Agent': 'runcycles-docs (https://github.com/runcycles/docs)' } }
        )
        if (!res.ok) return 0
        const json = await res.json() as { crate?: { downloads?: number } }
        return json.crate?.downloads ?? 0
      } catch {
        return 0
      }
    })
  )
  return totals.reduce((a, b) => a + b, 0)
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
async function fetchMavenDownloads(): Promise<number> {
  // Maven Central has no public downloads API. The search API only
  // exposes versionCount, not download stats.
  return 0
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
      fetchMavenDownloads(),
    ])

    // Per-source high-water marks: each source never decreases independently.
    const npm    = Math.max(npmFetched,    cached.npm)
    const pypi   = Math.max(pypiFetched,   cached.pypi)
    const crates = Math.max(cratesFetched, cached.crates)
    const maven  = Math.max(mavenFetched,  cached.maven)

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
      `[installs] npm=${npmFetched}(hwm:${npm}) pypi=${pypiFetched}(hwm:${pypi})` +
      ` crates=${cratesFetched}(hwm:${crates})` +
      ` clones+${clonesResult.totalAdded}(cache:${clones}, NOT in displayed total)` +
      ` releases=${releases}` +
      ` ghPackages=${ghPackages}` +
      ` maven=${mavenFetched} total=${total} cached=${cached.total}`
    )

    const now = new Date().toISOString()
    const newCache: InstallsCache = {
      npm, pypi, crates,
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
