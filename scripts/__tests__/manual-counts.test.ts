import { describe, expect, it } from 'vitest'
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { spawnSync } from 'node:child_process'
import { reconcileManualCounts } from '../lib/manual-counts.mjs'

const cache = {
  npm: 11519, pypi: 7948, crates: 167, releases: 1,
  ghPackages: 2959, maven: 1477, total: 24071,
  clones: 168299, clonesByRepo: { example: { count: 168299, lastSeenDay: '2026-11-14' } },
  releasesByRepo: { example: 1 },
}
const manual = {
  lastVerifiedAt: '2026-05-19',
  ghPackages: { admin: 1300, server: 1040, dashboard: 669, events: 430 },
  maven: { 'io.runcycles': 1901 },
}

describe('manual install counts', () => {
  it('repairs the weekly refresh total without counting clones as installs', () => {
    const result = reconcileManualCounts(cache, manual)
    expect(result.cache).toEqual({ ...cache, ghPackages: 3439, maven: 1901, total: 24975 })
    expect(cache.total).toBe(24071)
    expect(manual.ghPackages.admin).toBe(1300)
  })

  it('preserves recorded highs when manual values or a partial API response are lower', () => {
    const higher = { ...cache, ghPackages: 5000, maven: 2200, total: 28000 }
    const result = reconcileManualCounts(higher, manual, { admin: 1, newPackage: 100 })
    expect(result.cache).toEqual(higher)
    expect(result.manual.ghPackages).toEqual({ ...manual.ghPackages, newPackage: 100 })
    expect(result.manual.lastVerifiedAt).toBe(manual.lastVerifiedAt)
  })

  it('includes packages omitted by a successful partial API response', () => {
    const result = reconcileManualCounts(cache, manual, { admin: 1500 })
    expect(result.cache.ghPackages).toBe(3639)
    expect(result.cache.total).toBe(25175)
    expect(result.manual.ghPackages.server).toBe(1040)
  })

  it('retains the cache when the manual file is absent', () => {
    expect(reconcileManualCounts(cache).cache).toEqual(cache)
    expect(reconcileManualCounts({}).cache).toEqual({ ghPackages: 0, maven: 0, total: 0 })
  })

  it('ignores invalid counts instead of corrupting the total', () => {
    const result = reconcileManualCounts({}, {
      ghPackages: { good: 5, negative: -1, text: '12', infinite: Infinity, nan: NaN, empty: null },
      maven: { good: 3 },
    }, { bad: -10 })
    expect(result.cache).toEqual({ ghPackages: 5, maven: 3, total: 8 })
  })
})

describe('scheduled updater integration', () => {
  it.each([
    { name: 'null GHCR counters', status: 200, packages: [{ name: 'admin', download_count: null }], expected: 24975 },
    { name: 'missing package permission', status: 403, packages: [], expected: 24975 },
    { name: 'partial GHCR results', status: 200, packages: [{ name: 'admin', download_count: 1500 }], expected: 25175 },
    { name: 'missing manual file', status: 200, packages: [], expected: 24071, noManual: true },
  ])('reconciles persisted totals with $name', ({ status, packages, expected, noManual }) => {
    const directory = mkdtempSync(join(tmpdir(), 'cycles-counts-test-'))
    try {
      const theme = join(directory, '.vitepress', 'theme')
      mkdirSync(theme, { recursive: true })
      const cachePath = join(theme, 'installs-cache.json')
      const manualPath = join(theme, 'manual-package-counts.json')
      writeFileSync(cachePath, JSON.stringify(cache))
      if (!noManual) writeFileSync(manualPath, JSON.stringify(manual))
      const bootstrap = join(directory, 'mock-fetch.mjs')
      writeFileSync(bootstrap, `
        globalThis.fetch = async url => {
          const path = new URL(url).pathname;
          if (path === '/orgs/runcycles/repos') return new Response('[]');
          if (path === '/orgs/runcycles/packages') {
            return new Response(${JSON.stringify(JSON.stringify(packages))}, { status: ${status} });
          }
          throw new Error('Unexpected request: ' + url);
        };
      `)
      const script = fileURLToPath(new URL('../update-github-counts.mjs', import.meta.url))
      const result = spawnSync(process.execPath, ['--import', pathToFileURL(bootstrap).href, script], {
        cwd: directory, encoding: 'utf8', timeout: 15000,
        env: { ...process.env, GH_TOKEN: 'fixture-token' },
      })
      expect(result.status, result.stdout + result.stderr).toBe(0)
      const saved = JSON.parse(readFileSync(cachePath, 'utf8'))
      expect(saved.total).toBe(expected)
      expect(saved.clones).toBe(cache.clones)
      expect(saved.clonesByRepo).toEqual(cache.clonesByRepo)
      if (!noManual) {
        const savedManual = JSON.parse(readFileSync(manualPath, 'utf8'))
        expect(savedManual.maven).toEqual(manual.maven)
        expect(savedManual.ghPackages.server).toBe(1040)
        if (expected === 24975) expect(savedManual).toEqual(manual)
        else expect(savedManual.ghPackages.admin).toBe(1500)
      }
    } finally {
      // Remove only the fixture directory created directly under the temp root.
      expect(dirname(resolve(directory))).toBe(resolve(tmpdir()))
      rmSync(directory, { recursive: true, force: true })
    }
  })
})
