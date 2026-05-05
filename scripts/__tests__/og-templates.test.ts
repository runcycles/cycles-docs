import { describe, it, expect } from 'vitest'
// @ts-expect-error - .mjs has no .d.ts; we test runtime behavior, not types.
import { blogTree, docsTree, toolTree, BRAND } from '../lib/og-templates.mjs'

// Snapshots target the satori input tree, not the rendered SVG.
// The tree is deterministic given fixed inputs; layout regressions show up as
// tree diffs without needing to load fonts or run satori in tests.
//
// Use a stub logoDataUri so snapshots stay readable across runs (the real one
// is a ~3KB base64 blob).
const LOGO = 'logo://stub'

describe('blogTree', () => {
  it('renders with date, author, and a few tags', () => {
    expect(
      blogTree({
        title: 'A reasonably long blog post title that exercises sizing',
        date: '2026-05-02',
        author: 'Albert Mavashev',
        tags: ['agents', 'governance'],
        logoDataUri: LOGO,
      }),
    ).toMatchSnapshot()
  })

  it('renders with no tags', () => {
    expect(
      blogTree({
        title: 'Short',
        date: '2026-05-02',
        author: 'Cycles Team',
        tags: [],
        logoDataUri: LOGO,
      }),
    ).toMatchSnapshot()
  })

  it('caps the tag list at 4', () => {
    const tree = blogTree({
      title: 'T',
      date: '2026-05-02',
      author: 'A',
      tags: ['a', 'b', 'c', 'd', 'e', 'f'],
      logoDataUri: LOGO,
    })
    // Walk the tree to count rendered tag chips. Children of the tag-row div
    // contain one chip per tag.
    const json = JSON.stringify(tree)
    const chipMatches = json.match(/borderRadius":"18px"/g) ?? []
    expect(chipMatches).toHaveLength(4)
  })
})

describe('docsTree', () => {
  it('renders with section eyebrow and description', () => {
    expect(
      docsTree({
        title: 'How to wire a tenant policy',
        description: 'Step-by-step guide for configuring tenant-scoped policies with the admin API.',
        section: 'How-to Guide',
        logoDataUri: LOGO,
      }),
    ).toMatchSnapshot()
  })

  it('renders without a section (top-level docs)', () => {
    expect(
      docsTree({
        title: 'Why Cycles',
        description: '',
        section: null,
        logoDataUri: LOGO,
      }),
    ).toMatchSnapshot()
  })

  it('truncates a long description with ellipsis', () => {
    const tree = docsTree({
      title: 'T',
      description: 'a'.repeat(300),
      section: 'Concepts',
      logoDataUri: LOGO,
    })
    const json = JSON.stringify(tree)
    expect(json).toContain('…')
  })
})

describe('toolTree', () => {
  it('renders the full tool template with pill, pillCaption, and hook', () => {
    expect(
      toolTree({
        title: 'AI Agent Blast Radius Risk Calculator',
        section: 'Calculator',
        hook: 'Model your agent. See the monthly blast radius. Share the URL.',
        preview: {
          value: '$342K',
          label: 'monthly blast radius — default workload',
          pill: '×14',
          pillCaption: 'catastrophic',
        },
        logoDataUri: LOGO,
      }),
    ).toMatchSnapshot()
  })

  it('renders without pill (no pill = no caption either)', () => {
    expect(
      toolTree({
        title: 'Some Tool',
        section: 'Calculator',
        hook: null,
        preview: {
          value: '$10K',
          label: 'monthly cost',
          pill: null,
          pillCaption: null,
        },
        logoDataUri: LOGO,
      }),
    ).toMatchSnapshot()
  })

  it('renders pill without caption', () => {
    expect(
      toolTree({
        title: 'T',
        section: 'Calculator',
        hook: null,
        preview: { value: '$1', label: 'x', pill: '×2', pillCaption: null },
        logoDataUri: LOGO,
      }),
    ).toMatchSnapshot()
  })

  it('uses amber for pill and teal for value (palette regression guard)', () => {
    const tree = toolTree({
      title: 'T',
      section: 'Calculator',
      hook: null,
      preview: { value: '$1', label: 'x', pill: '×2', pillCaption: 'CAT' },
      logoDataUri: LOGO,
    })
    const json = JSON.stringify(tree)
    expect(json).toContain(BRAND.amber) // pill color
    expect(json).toContain(BRAND.teal) // value color
    expect(json).toContain(BRAND.cardBorder) // solid card border (not rgba)
  })
})
