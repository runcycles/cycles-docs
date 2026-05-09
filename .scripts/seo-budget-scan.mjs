// One-shot SEO-budget scanner: report frontmatter title/description
// fields that exceed Google's typical SERP truncation thresholds
// (60ch for full <title> after VitePress's titleTemplate, 160ch for
// description). Used to plan truncation-sweep PRs.
import fs from 'node:fs'
import path from 'node:path'

const SUFFIX_LEN = ' — Cycles'.length // titleTemplate suffix
const TITLE_BUDGET = 60
const DESC_BUDGET = 160

function walk(dir) {
  const out = []
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.name.startsWith('.') || e.name === 'node_modules' || e.name === 'cycles-protocol') continue
    const p = path.join(dir, e.name)
    if (e.isDirectory()) out.push(...walk(p))
    else if (e.isFile() && e.name.endsWith('.md')) out.push(p)
  }
  return out
}

const issues = []
for (const f of walk('.')) {
  const c = fs.readFileSync(f, 'utf8').replace(/\r\n/g, '\n')
  const fm = c.match(/^---\n([\s\S]*?)\n---/)
  if (!fm) continue
  const t = fm[1].match(/^title:\s*"?([^\n"]+)"?/m)
  const d = fm[1].match(/^description:\s*"([^"]+)"/m)
  const titleStr = t ? t[1] : ''
  const descStr = d ? d[1] : ''
  const titleLen = titleStr.length + SUFFIX_LEN
  if (titleLen > TITLE_BUDGET || descStr.length > DESC_BUDGET) {
    issues.push({
      file: f.replace(/\\/g, '/'),
      titleLen,
      descLen: descStr.length,
      title: titleStr,
      desc: descStr,
    })
  }
}

console.log(`Total over-budget files: ${issues.length}`)
console.log(`  Titles >${TITLE_BUDGET}ch: ${issues.filter(i => i.titleLen > TITLE_BUDGET).length}`)
console.log(`  Descriptions >${DESC_BUDGET}ch: ${issues.filter(i => i.descLen > DESC_BUDGET).length}`)
console.log()

const buckets = {}
for (const i of issues) {
  const dir = i.file.split('/')[0]
  buckets[dir] = (buckets[dir] ?? 0) + 1
}
console.log('By top-level dir:')
for (const [k, v] of Object.entries(buckets).sort((a, b) => b[1] - a[1])) {
  console.log(`  ${k.padEnd(20)} ${v}`)
}
console.log()

console.log('--- Worst offenders by descLen ---')
issues.sort((a, b) => b.descLen - a.descLen).slice(0, 20).forEach(i => {
  console.log(`  ${i.file.padEnd(70)} t=${i.titleLen} d=${i.descLen}`)
})
console.log()
console.log('--- Worst offenders by titleLen ---')
issues.sort((a, b) => b.titleLen - a.titleLen).slice(0, 20).forEach(i => {
  console.log(`  ${i.file.padEnd(70)} t=${i.titleLen} d=${i.descLen}`)
})
