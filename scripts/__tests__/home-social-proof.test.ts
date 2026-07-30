import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const source = readFileSync(
  new URL('../../.vitepress/theme/HomeSocialProof.vue', import.meta.url),
  'utf8',
)
const benchmarkSource = readFileSync(
  new URL('../../blog/cycles-server-performance-benchmarks.md', import.meta.url),
  'utf8',
)

describe('homepage technical proof', () => {
  it('links an unambiguous per-SDK recovery claim to the evidence matrix', () => {
    expect(source).toContain('href="/protocol/sdk-recovery-conformance"')
    expect(source).toContain('4 SDKs &#183; durable recovery &#183; 12/12 each')
  })

  it('shows low-concurrency latency and stable saturation evidence', () => {
    expect(source).toContain(
      'href="/blog/cycles-server-performance-benchmarks#reserve-fan-out-1-to-200-clients"',
    )
    expect(source).toContain(
      'Shared reserve: 34ms p99 (1 client) &#183; 891 reserves/s (200 clients, 0 errors)',
    )
    expect(source).not.toContain('532ms')
    expect(source).not.toContain('1.33s')
  })

  it('reconciles the historical and fan-out reserve p99 measurements', () => {
    expect(benchmarkSource).toContain(
      'Why 7.9ms above and 34.4ms below differ',
    )
    expect(benchmarkSource).toMatch(
      /different releases and sampling methods/,
    )
  })

  it('publishes the full saturation stability evidence behind the headline', () => {
    expect(benchmarkSource).toContain('### 200-client stability rerun')
    expect(benchmarkSource).toContain('831.1ms (467.7–2,558.0ms)')
    expect(benchmarkSource).toContain('890.8 reserves/s (879.6–979.2)')
    expect(benchmarkSource).toContain('45,842 measured reservations')
    expect(benchmarkSource).toMatch(
      /not\s+stable enough for a homepage headline/,
    )
  })

  it('gives proof links a persistent visual affordance and keyboard focus', () => {
    expect(source).toContain('text-decoration-line: underline')
    expect(source).toContain('.proof-link:focus-visible')
  })
})
