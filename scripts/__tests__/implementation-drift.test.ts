import { describe, expect, it } from 'vitest'
import {
  extractManifestVersion,
  extractSpringPropertyNames,
  parseCurrentVersionTable,
} from '../check-implementation-drift.mjs'

describe('implementation drift helpers', () => {
  it('reads both current version tables and preserves document revisions', () => {
    const versions = parseCurrentVersionTable(`
# Changelog

### Current versions

| Component | Version | Release date |
|---|---|---|
| Protocol spec (runtime) | v0.1.25 (document revision v0.1.25.15) | 2026-07-21 |
| \`cycles-server\` (runtime) | v0.1.25.58 | 2026-07-14 |

**Client SDKs and plugins.**

| SDK / plugin | Version | Runtime |
|---|---|---|
| \`cycles-client-rust\` | 0.2.7 | Rust |

### Next section
`)

    expect(versions.get('Protocol spec (runtime)')?.values)
      .toEqual(['0.1.25', '0.1.25.15'])
    expect(versions.get('cycles-server (runtime)')?.values).toEqual(['0.1.25.58'])
    expect(versions.get('cycles-client-rust')?.values).toEqual(['0.2.7'])
  })

  it('extracts versions from every supported manifest shape', () => {
    expect(extractManifestVersion('{"version":"1.2.3"}', 'json')).toBe('1.2.3')
    expect(extractManifestVersion(
      '<properties><revision>0.1.25.58</revision></properties>',
      'maven-revision',
    )).toBe('0.1.25.58')
    expect(extractManifestVersion(
      '[project]\nname = "client"\nversion = "0.4.3"\n',
      'toml-project',
    )).toBe('0.4.3')
    expect(extractManifestVersion(
      '[package]\nname = "client"\nversion = "0.2.7"\n',
      'toml-package',
    )).toBe('0.2.7')
    expect(extractManifestVersion(
      'openapi: 3.1.0\ninfo:\n  title: API\n  version: 0.1.25.15\npaths: {}\n',
      'yaml-info',
    )).toBe('0.1.25.15')
  })

  it('turns Spring property fields into their relaxed-binding keys', () => {
    const source = `
      private boolean enabled = true;
      private long defaultEstimate = 1000L;
      private String tokenEstimatorEncoding = null;
    `
    expect(extractSpringPropertyNames(source, 'cycles.spring-ai.')).toEqual([
      'cycles.spring-ai.enabled',
      'cycles.spring-ai.default-estimate',
      'cycles.spring-ai.token-estimator-encoding',
    ])
  })
})
