import yaml from 'yaml'

// Top-level docs eligible for OG generation. Centralized so the generator and
// classify() share one allowlist.
export const TOP_LEVEL_DOCS = new Set([
  'why-cycles.md',
  'about.md',
  'glossary.md',
  'design-partners.md',
  'security.md',
  'contact.md',
  'changelog.md',
])

// Returns null for pages that should NOT get a generated OG image.
// Otherwise: { kind: 'blog' | 'docs', section?: string }.
//
// Section is the eyebrow label shown in docs/tool templates (e.g.
// "How-to Guide"). The blog template ignores section.
//
// Tool template selection is driven by frontmatter `og.preview`, not by
// classify(): a page opts in by setting preview values. classify() only
// decides blog vs docs.
export function classify(rel) {
  if (rel.endsWith('-embed.md')) return null
  if (rel.startsWith('api/operations/')) return null
  if (rel.startsWith('admin-api/operations/')) return null

  if (rel.startsWith('blog/')) return { kind: 'blog' }

  if (rel.startsWith('how-to/')) return { kind: 'docs', section: 'How-to Guide' }
  if (rel.startsWith('troubleshoot/')) return { kind: 'docs', section: 'Troubleshooting' }
  if (rel.startsWith('concepts/cycles-vs-')) return { kind: 'docs', section: 'Comparison' }
  if (rel.startsWith('concepts/')) return { kind: 'docs', section: 'Concepts' }
  if (rel.startsWith('quickstart/')) return { kind: 'docs', section: 'Quickstart' }
  if (rel.startsWith('calculators/')) return { kind: 'docs', section: 'Calculator' }
  if (rel.startsWith('protocol/')) return { kind: 'docs', section: 'Protocol' }
  if (rel.startsWith('configuration/')) return { kind: 'docs', section: 'Configuration' }
  if (rel.startsWith('guides/')) return { kind: 'docs', section: 'Guide' }
  if (rel.startsWith('incidents/')) return { kind: 'docs', section: 'Incident Pattern' }
  if (rel.startsWith('why-cycles/')) return { kind: 'docs', section: 'Why Cycles' }
  if (rel.startsWith('community/')) return { kind: 'docs', section: 'Community' }
  if (rel.startsWith('demos/')) return { kind: 'docs', section: 'Demo' }
  if (rel.startsWith('docs/')) return { kind: 'docs', section: null }
  if (rel === 'admin-api/index.md' || rel === 'admin-api/guide.md') {
    return { kind: 'docs', section: 'Admin API' }
  }
  if (rel === 'api/index.md') return { kind: 'docs', section: 'API' }

  if (TOP_LEVEL_DOCS.has(rel)) return { kind: 'docs', section: null }
  return null
}

export function parseFrontmatter(raw) {
  const m = raw.match(/^---\r?\n([\s\S]*?)\r?\n---/)
  if (!m) return null
  return yaml.parse(m[1])
}

// Validate `og.preview` and return either a usable preview object or a
// structured error. Two shapes:
//   { ok: true, preview: { value, label, pill?, pillCaption?, hook? } }
//   { ok: false, reason: '...' }
// Returns null only when there's no `og` block at all (the page hasn't opted
// in). A present-but-malformed `og.preview` returns ok:false so the generator
// can warn — silent fallback to docs template hides typos like `og.preveiw`.
//
// Caps: pillCaption truncates to 18 chars at extraction (longer captions wrap
// the small-caps stack and break right-alignment). Long values warn separately
// in validatePreview because the size picker bottoms out at 56px / 360px.
export function extractToolPreview(fm) {
  if (!fm || typeof fm !== 'object') return null
  const og = fm.og
  if (og === undefined) return null
  if (!og || typeof og !== 'object') return { ok: false, reason: 'og is not an object' }
  if (og.preview === undefined && og.hook === undefined) return null
  const preview = og.preview
  if (!preview || typeof preview !== 'object') {
    return { ok: false, reason: 'og.preview is missing or not an object' }
  }
  if (typeof preview.value !== 'string') {
    return { ok: false, reason: 'og.preview.value is missing or not a string' }
  }
  if (typeof preview.label !== 'string') {
    return { ok: false, reason: 'og.preview.label is missing or not a string' }
  }
  return {
    ok: true,
    preview: {
      value: preview.value,
      label: preview.label,
      pill: typeof preview.pill === 'string' ? preview.pill : null,
      pillCaption:
        typeof preview.pillCaption === 'string' ? truncate(preview.pillCaption, 18) : null,
      hook: typeof og.hook === 'string' ? og.hook : null,
    },
  }
}

// Soft-validation: returns warnings (string[]) for fields that will render but
// look bad. Currently only `value` length, since the picker bottoms out at
// 56px / 360px card width — strings past ~13 chars start to clip.
export function validatePreview(preview) {
  const warnings = []
  if (preview.value.length > 13) {
    warnings.push(
      `og.preview.value is ${preview.value.length} chars (>13); may clip the 360px card`,
    )
  }
  return warnings
}

export function pickTitleSize(title, hasDescription) {
  const len = title.length
  if (hasDescription) {
    if (len <= 40) return 60
    if (len <= 80) return 48
    if (len <= 120) return 40
    return 34
  }
  if (len <= 40) return 72
  if (len <= 80) return 56
  if (len <= 120) return 44
  return 36
}

// Tool template title size. Left column is narrower than docs (no full-width
// description below) so titles need to step down sooner.
export function pickToolTitleSize(title) {
  const len = title.length
  if (len <= 30) return 56
  if (len <= 60) return 44
  if (len <= 90) return 36
  return 30
}

// Preview value sizing. Big numbers (e.g. "$342K") get a display-scale font;
// longer strings step down so they don't overflow the 360px card content
// width at font-weight 700.
export function pickPreviewValueSize(value) {
  const len = value.length
  if (len <= 5) return 124
  if (len <= 7) return 92
  if (len <= 10) return 72
  return 56
}

export function truncate(s, max) {
  if (!s) return ''
  if (s.length <= max) return s
  return s.slice(0, max - 1).trimEnd() + '…'
}

export function formatDate(input) {
  if (!input) return 'Draft'
  const d = input instanceof Date ? input : new Date(input)
  if (isNaN(d.getTime())) return 'Draft'
  return d.toISOString().slice(0, 10)
}
