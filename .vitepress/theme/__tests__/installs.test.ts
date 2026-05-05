import { describe, it, expect } from 'vitest'

// Test the pure aggregation + accumulation logic from installs.data.ts.

function highWaterMark(fetched: number, cached: number): number {
  return Math.max(fetched, cached)
}

function shouldUpdateCache(total: number, cached: number): boolean {
  return total > cached
}

interface SourceCounts {
  npm: number
  pypi: number
  crates: number
  clones: number
  releases: number
  maven: number
}

interface InstallsCache extends SourceCounts {
  total: number
}

function computeTotal(fetched: SourceCounts, cached: InstallsCache): number {
  // Displayed total — excludes clones. Clones are tracked in the cache
  // for analytics but excluded from the home-page counter because total
  // clones include heavy CI/bot traffic that inflates beyond what is
  // defensible to a skeptical visitor.
  //
  // Per-source HWMs are already monotonic; the sum is monotonic by
  // construction.
  const npm      = Math.max(fetched.npm,      cached.npm)
  const pypi     = Math.max(fetched.pypi,     cached.pypi)
  const crates   = Math.max(fetched.crates,   cached.crates)
  const releases = Math.max(fetched.releases, cached.releases)
  const maven    = Math.max(fetched.maven,    cached.maven)
  return npm + pypi + crates + releases + maven
}

// Simulates the day-cursor accumulator logic for one repo.
interface ClonesPerRepo { count: number; lastSeenDay: string }
function accumulateClones(
  cached: ClonesPerRepo,
  fetchedDays: Array<{ day: string; count: number }>,
): ClonesPerRepo {
  let added = 0
  let newestDay = cached.lastSeenDay
  for (const { day, count } of fetchedDays) {
    if (day > cached.lastSeenDay) {
      added += count
      if (day > newestDay) newestDay = day
    }
  }
  return { count: cached.count + added, lastSeenDay: newestDay }
}

describe('installs high-water-mark logic', () => {
  it('returns fetched when fetched > cached',  () => expect(highWaterMark(1000, 500)).toBe(1000))
  it('returns cached when cached > fetched',  () => expect(highWaterMark(500, 1000)).toBe(1000))
  it('returns either when equal',             () => expect(highWaterMark(500, 500)).toBe(500))
  it('handles zero cached (first run)',       () => expect(highWaterMark(1000, 0)).toBe(1000))
  it('handles zero fetched (API down)',       () => expect(highWaterMark(0, 1000)).toBe(1000))
  it('handles both zero',                     () => expect(highWaterMark(0, 0)).toBe(0))
})

describe('cache update decision', () => {
  it('updates cache when total exceeds cached', () => expect(shouldUpdateCache(1000, 500)).toBe(true))
  it('does not update when total equals cached', () => expect(shouldUpdateCache(500, 500)).toBe(false))
  it('does not update when total < cached',      () => expect(shouldUpdateCache(300, 500)).toBe(false))
})

describe('per-source aggregation', () => {
  it('defensible sources contribute independently (clones excluded)', () => {
    const cached: InstallsCache = {
      npm: 100, pypi: 200, crates: 40, clones: 50, releases: 10, maven: 30, total: 380,
    }
    const fetched: SourceCounts = {
      npm: 150, pypi: 180, crates: 60, clones: 80, releases: 15, maven: 25,
    }
    // HWMs: npm=150, pypi=200, crates=60, releases=15, maven=30 = 455
    // Clones (80) tracked in cache but NOT in displayed total.
    expect(computeTotal(fetched, cached)).toBe(455)
  })

  it('handles all APIs down gracefully (per-source HWMs preserved)', () => {
    const cached: InstallsCache = {
      npm: 2506, pypi: 1090, crates: 50, clones: 1200, releases: 0, maven: 0, total: 3646,
    }
    const fetched: SourceCounts = {
      npm: 0, pypi: 0, crates: 0, clones: 0, releases: 0, maven: 0,
    }
    // 2506 + 1090 + 50 + 0 + 0 = 3646 (clones not summed)
    expect(computeTotal(fetched, cached)).toBe(3646)
  })

  it('cold start: total computed entirely from per-source HWMs', () => {
    const cached: InstallsCache = {
      npm: 0, pypi: 0, crates: 0, clones: 0, releases: 0, maven: 0, total: 0,
    }
    const fetched: SourceCounts = {
      npm: 4000, pypi: 1300, crates: 49, clones: 36057, releases: 0, maven: 0,
    }
    // 4000 + 1300 + 49 + 0 + 0 = 5349 (clones excluded even when high)
    expect(computeTotal(fetched, cached)).toBe(5349)
  })

  it('clones do NOT contribute to displayed total even when high', () => {
    const cached: InstallsCache = {
      npm: 4000, pypi: 1300, crates: 49, clones: 0, releases: 0, maven: 0, total: 5349,
    }
    const fetched: SourceCounts = {
      npm: 4000, pypi: 1300, crates: 49, clones: 3669, releases: 0, maven: 0,
    }
    // Total stays at 5349 — clones tracked but not summed
    expect(computeTotal(fetched, cached)).toBe(5349)
  })

  it('releases contribute when present', () => {
    const cached: InstallsCache = {
      npm: 4000, pypi: 1300, crates: 49, clones: 0, releases: 0, maven: 0, total: 5349,
    }
    const fetched: SourceCounts = {
      npm: 4000, pypi: 1300, crates: 49, clones: 0, releases: 250, maven: 0,
    }
    expect(computeTotal(fetched, cached)).toBe(5599)
  })
})

describe('clones day-cursor accumulator', () => {
  it('first run with no cursor counts every day', () => {
    const cached = { count: 0, lastSeenDay: '' }
    const fetched = [
      { day: '2026-04-15', count: 10 },
      { day: '2026-04-16', count: 20 },
      { day: '2026-04-17', count: 30 },
    ]
    const result = accumulateClones(cached, fetched)
    expect(result.count).toBe(60)
    expect(result.lastSeenDay).toBe('2026-04-17')
  })

  it('subsequent run only adds days strictly after cursor', () => {
    const cached = { count: 60, lastSeenDay: '2026-04-17' }
    const fetched = [
      // overlap with prior window — should be skipped
      { day: '2026-04-15', count: 999 },
      { day: '2026-04-16', count: 999 },
      { day: '2026-04-17', count: 999 },
      // new days — should be counted
      { day: '2026-04-18', count: 25 },
      { day: '2026-04-19', count: 35 },
    ]
    const result = accumulateClones(cached, fetched)
    expect(result.count).toBe(60 + 25 + 35) // 120
    expect(result.lastSeenDay).toBe('2026-04-19')
  })

  it('no new days returns same cursor + count', () => {
    const cached = { count: 60, lastSeenDay: '2026-04-17' }
    const fetched = [
      { day: '2026-04-15', count: 10 },
      { day: '2026-04-16', count: 20 },
      { day: '2026-04-17', count: 30 },
    ]
    const result = accumulateClones(cached, fetched)
    expect(result.count).toBe(60)
    expect(result.lastSeenDay).toBe('2026-04-17')
  })

  it('empty fetched array (auth failure) does not regress', () => {
    const cached = { count: 1234, lastSeenDay: '2026-04-17' }
    const result = accumulateClones(cached, [])
    expect(result.count).toBe(1234)
    expect(result.lastSeenDay).toBe('2026-04-17')
  })
})
