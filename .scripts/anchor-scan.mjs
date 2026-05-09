// One-shot anchor scanner: parse rendered HTML for all id="..." attrs,
// then walk source .md files and report any internal #anchor link whose
// target page does not contain that id. Used for the broken-anchors fix
// pass — not part of the build.
import fs from 'node:fs'
import path from 'node:path'

function walk(dir, ext) {
  const out = []
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.name.startsWith('.') && e.name !== '.') continue
    if (e.name === 'node_modules' || e.name === 'cycles-protocol') continue
    const p = path.join(dir, e.name)
    if (e.isDirectory()) out.push(...walk(p, ext))
    else if (e.isFile() && e.name.endsWith(ext)) out.push(p)
  }
  return out
}

function urlFromHtml(htmlPath) {
  let u = htmlPath.replace(/^\.vitepress[\\/]dist/, '').replace(/\\/g, '/')
  u = u.replace(/index\.html$/, '').replace(/\.html$/, '')
  if (u.length > 1 && u.endsWith('/')) u = u.slice(0, -1)
  return u
}

const htmlFiles = walk('.vitepress/dist', '.html')
const anchors = new Map()
for (const f of htmlFiles) {
  const html = fs.readFileSync(f, 'utf8')
  const ids = new Set()
  for (const m of html.matchAll(/\sid="([^"]+)"/g)) ids.add(m[1])
  anchors.set(urlFromHtml(f), ids)
}

const mdFiles = walk('.', '.md').filter(f => !f.includes('node_modules') && !f.startsWith('.vitepress') && !f.startsWith('cycles-protocol'))

const broken = []
for (const f of mdFiles) {
  const c = fs.readFileSync(f, 'utf8').replace(/\r\n/g, '\n')
  const linkRe = /\]\(([^)]+#[^)]+)\)/g
  for (const m of c.matchAll(linkRe)) {
    const target = m[1]
    if (/^https?:/.test(target)) continue
    if (target.includes('?')) continue // calculator state fragments
    let [pathPart, anchor] = target.split('#')
    if (!anchor) continue
    pathPart = pathPart.replace(/\.md$/, '')
    if (!pathPart) {
      // intra-page link
      let self = '/' + f.replace(/\\/g, '/')
      self = self.replace(/^\/\.\//, '/').replace(/\.md$/, '').replace(/\/index$/, '')
      pathPart = self
    }
    if (!pathPart.startsWith('/')) pathPart = '/' + pathPart
    if (pathPart.length > 1 && pathPart.endsWith('/')) pathPart = pathPart.slice(0, -1)
    const ok = anchors.has(pathPart) && anchors.get(pathPart).has(anchor)
    if (!ok) broken.push({ file: f.replace(/\\/g, '/'), target })
  }
}

console.log(`Broken anchors: ${broken.length}`)
const grouped = new Map()
for (const b of broken) {
  const list = grouped.get(b.target) ?? []
  list.push(b.file)
  grouped.set(b.target, list)
}
const sorted = [...grouped.entries()].sort((a, b) => b[1].length - a[1].length)
for (const [target, files] of sorted) {
  console.log(`  ${target} (${files.length}×)`)
  for (const f of files.slice(0, 3)) console.log(`    - ${f}`)
  if (files.length > 3) console.log(`    - ... and ${files.length - 3} more`)
}
