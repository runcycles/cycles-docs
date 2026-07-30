import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

export interface RecoveryScenarioResult {
  id: string
  level: 'core' | 'durable' | 'boundary'
  name: string
  passed: boolean
  native_tests: string[]
  diagnostic?: string
}

export interface RecoveryReport {
  schema_version: string
  generated_at: string
  profile: {
    name: string
    version: string
    commit: string
    catalog_sha256: string
  }
  claim: 'core' | 'durable'
  implementation: {
    id: string
    version?: string
    commit: string
  }
  evidence_url?: string
  summary: {
    total: number
    passed: number
    failed: number
  }
  scenarios: RecoveryScenarioResult[]
}

export interface RecoverySdk {
  slug: string
  name: string
  repository: string
  report: RecoveryReport
}

export interface RecoveryConformanceData {
  profileVersion: string
  catalogDigest: string
  scenarios: Array<Pick<RecoveryScenarioResult, 'id' | 'level' | 'name'>>
  sdks: RecoverySdk[]
}

export declare const data: RecoveryConformanceData

const SDK_FILES = [
  {
    slug: 'python',
    name: 'Python',
    repository: 'runcycles/cycles-client-python',
  },
  {
    slug: 'typescript',
    name: 'TypeScript',
    repository: 'runcycles/cycles-client-typescript',
  },
  {
    slug: 'spring',
    name: 'Spring / Java',
    repository: 'runcycles/cycles-spring-boot-starter',
  },
  {
    slug: 'rust',
    name: 'Rust',
    repository: 'runcycles/cycles-client-rust',
  },
] as const

function readReport(slug: string): RecoveryReport {
  const path = resolve(
    process.cwd(),
    'public',
    'conformance',
    'recovery',
    `${slug}.json`,
  )
  return JSON.parse(readFileSync(path, 'utf8')) as RecoveryReport
}

export function validateRecoveryReports(sdks: RecoverySdk[]): void {
  if (sdks.length !== SDK_FILES.length) {
    throw new Error(`Expected ${SDK_FILES.length} SDK reports, found ${sdks.length}`)
  }

  const first = sdks[0].report
  const expectedIds = first.scenarios.map(scenario => scenario.id)
  if (expectedIds.length !== 12 || new Set(expectedIds).size !== 12) {
    throw new Error('Recovery evidence must contain 12 unique scenarios')
  }

  for (const sdk of sdks) {
    const { report } = sdk
    if (report.schema_version !== '1.0') {
      throw new Error(`${sdk.name}: unsupported report schema ${report.schema_version}`)
    }
    if (report.profile.name !== 'cycles-sdk-recovery') {
      throw new Error(`${sdk.name}: unexpected recovery profile ${report.profile.name}`)
    }
    if (
      report.profile.version !== first.profile.version
      || report.profile.commit !== first.profile.commit
      || report.profile.catalog_sha256 !== first.profile.catalog_sha256
    ) {
      throw new Error(
        `${sdk.name}: profile commit, version, or catalog digest differs`,
      )
    }
    if (report.implementation.id !== sdk.repository) {
      throw new Error(
        `${sdk.name}: report implementation ${report.implementation.id} `
        + `does not match ${sdk.repository}`,
      )
    }
    if (report.claim !== 'durable') {
      throw new Error(`${sdk.name}: expected durable claim, found ${report.claim}`)
    }
    if (!/^[0-9a-f]{40}$/.test(report.profile.commit)) {
      throw new Error(`${sdk.name}: profile commit is not a full Git SHA`)
    }
    if (!/^[0-9a-f]{40}$/.test(report.implementation.commit)) {
      throw new Error(`${sdk.name}: implementation commit is not a full Git SHA`)
    }
    if (!report.implementation.version) {
      throw new Error(`${sdk.name}: published evidence must include an SDK version`)
    }
    if (!report.evidence_url) {
      throw new Error(`${sdk.name}: published evidence must link its CI run`)
    }
    const ids = report.scenarios.map(scenario => scenario.id)
    if (JSON.stringify(ids) !== JSON.stringify(expectedIds)) {
      throw new Error(`${sdk.name}: scenario IDs or order differ from the catalog`)
    }
    const passed = report.scenarios.filter(scenario => scenario.passed).length
    if (
      report.summary.total !== report.scenarios.length
      || report.summary.passed !== passed
      || report.summary.failed !== report.scenarios.length - passed
    ) {
      throw new Error(`${sdk.name}: report summary does not match scenario results`)
    }
    for (const scenario of report.scenarios) {
      if (scenario.passed && scenario.native_tests.length === 0) {
        throw new Error(`${sdk.name}: ${scenario.id} has no native-test evidence`)
      }
    }
  }
}

export default {
  load(): RecoveryConformanceData {
    const sdks = SDK_FILES.map(sdk => ({
      ...sdk,
      report: readReport(sdk.slug),
    }))
    validateRecoveryReports(sdks)
    const first = sdks[0].report
    return {
      profileVersion: first.profile.version,
      catalogDigest: first.profile.catalog_sha256,
      scenarios: first.scenarios.map(({ id, level, name }) => ({
        id,
        level,
        name,
      })),
      sdks,
    }
  },
}
