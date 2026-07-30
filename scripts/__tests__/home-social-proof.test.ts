import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const source = readFileSync(
  new URL('../../.vitepress/theme/HomeSocialProof.vue', import.meta.url),
  'utf8',
)

describe('homepage technical proof', () => {
  it('links an unambiguous per-SDK recovery claim to the evidence matrix', () => {
    expect(source).toContain('href="/protocol/sdk-recovery-conformance"')
    expect(source).toContain('4 SDKs &#183; durable recovery &#183; 12/12 each')
  })

  it('shows both the low-concurrency denominator and saturation result', () => {
    expect(source).toContain(
      'Shared reserve p99: 32ms (1 client) &#183; 1.33s (200-client saturation)',
    )
    expect(source).not.toContain('532ms')
  })

  it('gives proof links a persistent visual affordance and keyboard focus', () => {
    expect(source).toContain('text-decoration-line: underline')
    expect(source).toContain('.proof-link:focus-visible')
  })
})
