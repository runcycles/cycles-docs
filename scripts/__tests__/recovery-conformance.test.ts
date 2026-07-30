import { describe, expect, it } from 'vitest'
import loader, {
  validateRecoveryReports,
  type RecoverySdk,
} from '../../.vitepress/theme/recovery-conformance.data'

describe('SDK recovery conformance evidence', () => {
  it('publishes four durable 12/12 reports against one catalog', () => {
    const data = loader.load()

    expect(data.sdks.map(sdk => sdk.name)).toEqual([
      'Python',
      'TypeScript',
      'Spring / Java',
      'Rust',
    ])
    expect(data.profileVersion).toBe('0.3')
    expect(data.scenarios).toHaveLength(12)
    expect(new Set(data.scenarios.map(scenario => scenario.level))).toEqual(
      new Set(['core', 'durable', 'boundary']),
    )
    for (const sdk of data.sdks) {
      expect(sdk.report.claim).toBe('durable')
      expect(sdk.report.summary).toEqual({
        total: 12,
        passed: 12,
        failed: 0,
      })
    }
  })

  it('rejects a report whose summary no longer matches its scenarios', () => {
    const data = loader.load()
    const sdks = structuredClone(data.sdks) as RecoverySdk[]
    sdks[0].report.summary.passed = 11

    expect(() => validateRecoveryReports(sdks))
      .toThrow('report summary does not match scenario results')
  })

  it('rejects catalog drift between SDK reports', () => {
    const data = loader.load()
    const sdks = structuredClone(data.sdks) as RecoverySdk[]
    sdks[1].report.profile.catalog_sha256 = '0'.repeat(64)

    expect(() => validateRecoveryReports(sdks))
      .toThrow('profile version or catalog digest differs')
  })
})
