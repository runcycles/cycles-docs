import { describe, it, expect } from 'vitest'
// @ts-expect-error - .mjs has no .d.ts; we test runtime behavior, not types.
import {
  TOP_LEVEL_DOCS,
  classify,
  parseFrontmatter,
  extractToolPreview,
  validatePreview,
  pickTitleSize,
  pickToolTitleSize,
  pickPreviewValueSize,
  truncate,
  formatDate,
} from '../lib/og-helpers.mjs'

describe('classify', () => {
  it('returns null for embed pages', () => {
    expect(classify('calculators/foo-embed.md')).toBeNull()
  })

  it('returns null for OpenAPI operation pages', () => {
    expect(classify('api/operations/list-cycles.md')).toBeNull()
    expect(classify('admin-api/operations/get-tenant.md')).toBeNull()
  })

  it('returns null for unknown paths', () => {
    expect(classify('random/file.md')).toBeNull()
    expect(classify('index.md')).toBeNull()
  })

  it('classifies blog paths', () => {
    expect(classify('blog/some-post.md')).toEqual({ kind: 'blog' })
  })

  it('classifies how-to paths', () => {
    expect(classify('how-to/foo.md')).toEqual({ kind: 'docs', section: 'How-to Guide' })
  })

  it('classifies troubleshoot paths', () => {
    expect(classify('troubleshoot/bar.md')).toEqual({ kind: 'docs', section: 'Troubleshooting' })
  })

  it('distinguishes concept comparison pages from regular concepts', () => {
    expect(classify('concepts/cycles-vs-litellm.md')).toEqual({
      kind: 'docs',
      section: 'Comparison',
    })
    expect(classify('concepts/budgets.md')).toEqual({ kind: 'docs', section: 'Concepts' })
  })

  it('classifies calculator pages with the Calculator section', () => {
    expect(classify('calculators/ai-agent-blast-radius-risk.md')).toEqual({
      kind: 'docs',
      section: 'Calculator',
    })
  })

  it('classifies demo pages', () => {
    expect(classify('demos/index.md')).toEqual({ kind: 'docs', section: 'Demo' })
  })

  it('classifies the remaining docs sections', () => {
    expect(classify('quickstart/foo.md')).toEqual({ kind: 'docs', section: 'Quickstart' })
    expect(classify('protocol/foo.md')).toEqual({ kind: 'docs', section: 'Protocol' })
    expect(classify('configuration/foo.md')).toEqual({
      kind: 'docs',
      section: 'Configuration',
    })
    expect(classify('guides/foo.md')).toEqual({ kind: 'docs', section: 'Guide' })
    expect(classify('incidents/foo.md')).toEqual({
      kind: 'docs',
      section: 'Incident Pattern',
    })
    expect(classify('why-cycles/foo.md')).toEqual({ kind: 'docs', section: 'Why Cycles' })
    expect(classify('community/foo.md')).toEqual({ kind: 'docs', section: 'Community' })
    expect(classify('docs/foo.md')).toEqual({ kind: 'docs', section: null })
  })

  it('classifies admin-api index/guide explicitly', () => {
    expect(classify('admin-api/index.md')).toEqual({ kind: 'docs', section: 'Admin API' })
    expect(classify('admin-api/guide.md')).toEqual({ kind: 'docs', section: 'Admin API' })
  })

  it('classifies api index', () => {
    expect(classify('api/index.md')).toEqual({ kind: 'docs', section: 'API' })
  })

  it('classifies all top-level allowlisted docs with null section', () => {
    for (const f of TOP_LEVEL_DOCS) {
      expect(classify(f)).toEqual({ kind: 'docs', section: null })
    }
  })
})

describe('parseFrontmatter', () => {
  it('returns null when no frontmatter is present', () => {
    expect(parseFrontmatter('# Just a heading')).toBeNull()
  })

  it('parses YAML frontmatter', () => {
    const raw = `---\ntitle: Hello\ndescription: World\n---\n\n# Body`
    expect(parseFrontmatter(raw)).toEqual({ title: 'Hello', description: 'World' })
  })

  it('parses nested frontmatter (e.g. og.preview)', () => {
    const raw = `---\ntitle: T\nog:\n  preview:\n    value: "$10"\n    label: "x"\n---\n`
    expect(parseFrontmatter(raw)).toEqual({
      title: 'T',
      og: { preview: { value: '$10', label: 'x' } },
    })
  })
})

describe('extractToolPreview', () => {
  it('returns null when there is no opt-in og block at all', () => {
    // null/missing/non-object means "page never opted in" — falls back silently.
    expect(extractToolPreview(null)).toBeNull()
    expect(extractToolPreview(undefined)).toBeNull()
    expect(extractToolPreview('not an object')).toBeNull()
    expect(extractToolPreview({})).toBeNull()
    expect(extractToolPreview({ og: undefined })).toBeNull()
    // og present but only with unrelated fields (e.g. fields used by other tools)
    // is still treated as no-opt-in — only og.preview / og.hook flag intent.
    expect(extractToolPreview({ og: { type: 'article' } })).toBeNull()
  })

  it('returns ok:false when og is non-object (truthy but malformed)', () => {
    expect(extractToolPreview({ og: 'string' })).toEqual({
      ok: false,
      reason: 'og is not an object',
    })
    expect(extractToolPreview({ og: 42 })).toEqual({
      ok: false,
      reason: 'og is not an object',
    })
  })

  it('returns ok:false for `og: null` (the bare-key YAML typo case)', () => {
    // `og:` with no children parses to null in YAML — the user clearly meant
    // to add a block but forgot to indent. Failing here surfaces the typo
    // instead of silently rendering the docs template.
    expect(extractToolPreview({ og: null })).toEqual({
      ok: false,
      reason: 'og is not an object',
    })
  })

  it('returns ok:false when og.preview is malformed (intent visible, shape wrong)', () => {
    // og.hook set but preview missing → user clearly meant to opt in.
    expect(extractToolPreview({ og: { hook: 'h' } })).toEqual({
      ok: false,
      reason: 'og.preview is missing or not an object',
    })
    expect(extractToolPreview({ og: { preview: null, hook: 'h' } })).toEqual({
      ok: false,
      reason: 'og.preview is missing or not an object',
    })
    expect(extractToolPreview({ og: { preview: 'string' } })).toEqual({
      ok: false,
      reason: 'og.preview is missing or not an object',
    })
  })

  it('returns ok:false when value or label is missing/non-string', () => {
    expect(extractToolPreview({ og: { preview: { label: 'x' } } })).toEqual({
      ok: false,
      reason: 'og.preview.value is missing or not a string',
    })
    expect(extractToolPreview({ og: { preview: { value: 42, label: 'x' } } })).toEqual({
      ok: false,
      reason: 'og.preview.value is missing or not a string',
    })
    expect(extractToolPreview({ og: { preview: { value: '$1' } } })).toEqual({
      ok: false,
      reason: 'og.preview.label is missing or not a string',
    })
  })

  it('extracts a minimal preview', () => {
    const fm = { og: { preview: { value: '$342K', label: 'monthly blast radius' } } }
    expect(extractToolPreview(fm)).toEqual({
      ok: true,
      preview: {
        value: '$342K',
        label: 'monthly blast radius',
        pill: null,
        pillCaption: null,
        hook: null,
      },
    })
  })

  it('extracts pill, pillCaption, and hook when present', () => {
    const fm = {
      og: {
        preview: {
          value: '$342K',
          label: 'monthly blast radius',
          pill: '×14',
          pillCaption: 'catastrophic',
        },
        hook: 'Model your agent.',
      },
    }
    expect(extractToolPreview(fm)).toEqual({
      ok: true,
      preview: {
        value: '$342K',
        label: 'monthly blast radius',
        pill: '×14',
        pillCaption: 'catastrophic',
        hook: 'Model your agent.',
      },
    })
  })

  it('drops non-string pill, pillCaption, and hook fields', () => {
    const fm = {
      og: {
        preview: { value: '$1', label: 'x', pill: 42, pillCaption: false },
        hook: { not: 'a string' },
      },
    }
    expect(extractToolPreview(fm)).toEqual({
      ok: true,
      preview: {
        value: '$1',
        label: 'x',
        pill: null,
        pillCaption: null,
        hook: null,
      },
    })
  })

  it('truncates pillCaption past 18 chars (long captions wrap and break the stack)', () => {
    const fm = {
      og: {
        preview: {
          value: '$1',
          label: 'x',
          pill: '×14',
          pillCaption: 'this is a very long caption that should be truncated',
        },
      },
    }
    const result = extractToolPreview(fm)
    expect(result.ok).toBe(true)
    expect(result.preview.pillCaption.length).toBeLessThanOrEqual(18)
    expect(result.preview.pillCaption.endsWith('…')).toBe(true)
  })
})

describe('validatePreview', () => {
  it('returns no warnings for short value', () => {
    expect(validatePreview({ value: '$342K', label: 'x' })).toEqual([])
  })

  it('treats 13 chars as the boundary (no warning at exactly 13)', () => {
    // "$1,234,567/mo" is 13 chars — right at the picker's bottom step.
    expect(validatePreview({ value: '$1,234,567/mo', label: 'x' })).toEqual([])
    expect(validatePreview({ value: '1234567890123', label: 'x' })).toEqual([])
  })

  it('warns when value exceeds 13 chars (clips the 360px card)', () => {
    const warnings = validatePreview({ value: '$12,345,678,901/mo', label: 'x' })
    expect(warnings).toHaveLength(1)
    expect(warnings[0]).toMatch(/og.preview.value is 18 chars/)
  })
})

describe('pickTitleSize', () => {
  it('uses larger sizes when no description is shown', () => {
    expect(pickTitleSize('Short', false)).toBe(72)
    expect(pickTitleSize('a'.repeat(50), false)).toBe(56)
    expect(pickTitleSize('a'.repeat(100), false)).toBe(44)
    expect(pickTitleSize('a'.repeat(150), false)).toBe(36)
  })

  it('steps down when a description is shown', () => {
    expect(pickTitleSize('Short', true)).toBe(60)
    expect(pickTitleSize('a'.repeat(50), true)).toBe(48)
    expect(pickTitleSize('a'.repeat(100), true)).toBe(40)
    expect(pickTitleSize('a'.repeat(150), true)).toBe(34)
  })
})

describe('pickToolTitleSize', () => {
  it('scales down across length buckets', () => {
    expect(pickToolTitleSize('Short')).toBe(56)
    expect(pickToolTitleSize('a'.repeat(45))).toBe(44)
    expect(pickToolTitleSize('a'.repeat(75))).toBe(36)
    expect(pickToolTitleSize('a'.repeat(100))).toBe(30)
  })
})

describe('pickPreviewValueSize', () => {
  it('uses display size for short values', () => {
    expect(pickPreviewValueSize('$10')).toBe(124)
    expect(pickPreviewValueSize('$342K')).toBe(124)
  })

  it('steps down as the value grows', () => {
    expect(pickPreviewValueSize('$10K/mo')).toBe(92)
    expect(pickPreviewValueSize('$1,234/mo')).toBe(72)
    expect(pickPreviewValueSize('$1,234,567/mo')).toBe(56)
  })
})

describe('truncate', () => {
  it('returns empty string for empty input', () => {
    expect(truncate('', 10)).toBe('')
    expect(truncate(null as unknown as string, 10)).toBe('')
  })

  it('passes through strings within limit', () => {
    expect(truncate('hello', 10)).toBe('hello')
  })

  it('truncates with ellipsis past limit', () => {
    expect(truncate('hello world', 8)).toBe('hello w…')
  })

  it('trims trailing whitespace before the ellipsis', () => {
    expect(truncate('hello   world', 7)).toBe('hello…')
  })
})

describe('formatDate', () => {
  it('returns Draft for missing or invalid input', () => {
    expect(formatDate(null)).toBe('Draft')
    expect(formatDate(undefined)).toBe('Draft')
    expect(formatDate('')).toBe('Draft')
    expect(formatDate('not a date')).toBe('Draft')
  })

  it('formats ISO strings as YYYY-MM-DD', () => {
    expect(formatDate('2026-04-15T12:00:00Z')).toBe('2026-04-15')
  })

  it('formats Date objects', () => {
    expect(formatDate(new Date('2026-04-15T00:00:00Z'))).toBe('2026-04-15')
  })
})
