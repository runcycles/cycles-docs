import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import satori from 'satori'
import { Resvg } from '@resvg/resvg-js'
import {
  TOP_LEVEL_DOCS,
  classify,
  parseFrontmatter,
  extractToolPreview,
  validatePreview,
  formatDate,
} from './lib/og-helpers.mjs'
import { blogTree, docsTree, toolTree } from './lib/og-templates.mjs'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const repoRoot = path.resolve(__dirname, '..')
const ogRoot = path.join(repoRoot, 'public', 'og')

const force = process.argv.includes('--force')

const fontsBase = path.join(repoRoot, 'node_modules', '@fontsource')
const fontPaths = {
  inter400: path.join(fontsBase, 'inter/files/inter-latin-400-normal.woff'),
  inter700: path.join(fontsBase, 'inter/files/inter-latin-700-normal.woff'),
}
const logoPath = path.join(repoRoot, 'public', 'runcycles-logo.svg')

const fonts = [
  { name: 'Inter', weight: 400, style: 'normal', data: fs.readFileSync(fontPaths.inter400) },
  { name: 'Inter', weight: 700, style: 'normal', data: fs.readFileSync(fontPaths.inter700) },
]

const logoSvg = fs.readFileSync(logoPath, 'utf-8')
const logoDataUri =
  'data:image/svg+xml;base64,' + Buffer.from(logoSvg).toString('base64')

// Walk a directory recursively, returning .md file paths relative to repoRoot.
function walkMd(rel, out = []) {
  const abs = path.join(repoRoot, rel)
  if (!fs.existsSync(abs)) return out
  for (const entry of fs.readdirSync(abs, { withFileTypes: true })) {
    if (entry.name.startsWith('.')) continue
    const childRel = path.posix.join(rel, entry.name)
    if (entry.isDirectory()) {
      walkMd(childRel, out)
    } else if (entry.isFile() && entry.name.endsWith('.md')) {
      out.push(childRel)
    }
  }
  return out
}

async function main() {
  // Sources: top-level allowlisted files + recursive walks of section directories.
  // Sections excluded by classify() (api/operations, admin-api/operations) are still
  // walked but ignored at classification time — keeping the walk list flat avoids
  // the case where a new section directory ships and silently gets no OG images.
  const sources = []
  for (const f of TOP_LEVEL_DOCS) sources.push(f)
  for (const dir of [
    'blog',
    'how-to',
    'troubleshoot',
    'concepts',
    'quickstart',
    'calculators',
    'protocol',
    'configuration',
    'guides',
    'incidents',
    'why-cycles',
    'community',
    'demos',
    'docs',
    'admin-api',
    'api',
  ]) {
    walkMd(dir, sources)
  }

  // Cache-bust: regenerate when the generator OR any rendering input
  // (templates, helpers, logo SVG, fonts) changes. Without this, swapping
  // fonts or tweaking a template would leave existing PNGs stale until
  // someone ran --force.
  const templatesPath = path.join(__dirname, 'lib', 'og-templates.mjs')
  const helpersPath = path.join(__dirname, 'lib', 'og-helpers.mjs')
  const cacheBustMtime = Math.max(
    fs.statSync(fileURLToPath(import.meta.url)).mtimeMs,
    fs.statSync(templatesPath).mtimeMs,
    fs.statSync(helpersPath).mtimeMs,
    fs.statSync(logoPath).mtimeMs,
    fs.statSync(fontPaths.inter400).mtimeMs,
    fs.statSync(fontPaths.inter700).mtimeMs,
  )

  let generated = 0
  let skipped = 0
  let unclassified = 0
  const failures = []

  for (const rel of sources) {
    const cls = classify(rel)
    if (!cls) {
      unclassified++
      continue
    }

    const stem = rel.replace(/\.md$/, '')
    const srcPath = path.join(repoRoot, rel)
    const outPath = path.join(ogRoot, `${stem}.png`)

    const srcStat = fs.statSync(srcPath)
    if (!force && fs.existsSync(outPath)) {
      const outStat = fs.statSync(outPath)
      const newest = Math.max(srcStat.mtimeMs, cacheBustMtime)
      if (outStat.mtimeMs >= newest) {
        skipped++
        continue
      }
    }

    const raw = fs.readFileSync(srcPath, 'utf-8')
    let fm
    try {
      fm = parseFrontmatter(raw)
    } catch (e) {
      failures.push({ rel, message: `frontmatter parse: ${e.message}` })
      continue
    }
    if (!fm) continue

    // Skip the homepage (layout: home with hand-crafted og image)
    if (fm.layout === 'home') continue

    // Blog requires explicit blog: true frontmatter (matches posts.data.ts and rss.ts)
    if (cls.kind === 'blog' && fm.blog !== true) continue

    if (!fm.title) continue // can't render without a title

    const title = String(fm.title)

    let tree
    if (cls.kind === 'blog') {
      tree = blogTree({
        title,
        date: formatDate(fm.date),
        author: String(fm.author ?? 'Cycles Team'),
        tags: Array.isArray(fm.tags) ? fm.tags.map(String) : [],
        logoDataUri,
      })
    } else {
      // Tool template is opt-in via frontmatter `og.preview`. extractToolPreview
      // returns one of three shapes:
      //   null            → no opt-in (silent docs fallback; index pages, etc.)
      //   { ok: true }    → render tool template
      //   { ok: false }   → user opted in but malformed → fail the build,
      //                     instead of silently shipping a generic docs image.
      //                     Catches typos like `og.preveiw` that would
      //                     otherwise ship undetected.
      const result = extractToolPreview(fm)
      if (result === null) {
        tree = docsTree({
          title,
          description: typeof fm.description === 'string' ? fm.description : '',
          section: cls.section,
          logoDataUri,
        })
      } else if (result.ok) {
        const warnings = validatePreview(result.preview)
        for (const w of warnings) console.warn(`  ! ${rel}: ${w}`)
        tree = toolTree({
          title,
          section: cls.section,
          hook: result.preview.hook,
          preview: result.preview,
          logoDataUri,
        })
      } else {
        failures.push({ rel, message: `frontmatter og: ${result.reason}` })
        continue
      }
    }

    try {
      fs.mkdirSync(path.dirname(outPath), { recursive: true })
      const svg = await satori(tree, { width: 1200, height: 630, fonts })
      const png = new Resvg(svg).render().asPng()
      fs.writeFileSync(outPath, png)
      generated++
      console.log(`  + ${stem}.png`)
    } catch (e) {
      failures.push({ rel, message: e.message })
    }
  }

  console.log(
    `\nOG images: ${generated} generated, ${skipped} skipped, ${unclassified} ignored${
      failures.length ? `, ${failures.length} failed` : ''
    }.`,
  )
  if (failures.length) {
    for (const f of failures) console.error(`  ! ${f.rel}: ${f.message}`)
    process.exit(1)
  }
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
