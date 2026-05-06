// Rewrite /guides/llm-cost-control → /guides/llm-cost-runtime-control across
// all tracked .md and .ts files (excluding node_modules and dist).
import fs from 'node:fs'
import path from 'node:path'

const FROM = '/guides/llm-cost-control'
const TO   = '/guides/llm-cost-runtime-control'

function* walk(dir) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.name === 'node_modules' || e.name === '.git' || e.name === 'dist') continue
    const p = path.join(dir, e.name)
    if (e.isDirectory()) yield* walk(p)
    else if (/\.(md|ts)$/.test(e.name)) yield p
  }
}

let touched = 0
for (const file of walk('.')) {
  const content = fs.readFileSync(file, 'utf-8')
  if (!content.includes(FROM)) continue
  // Don't touch dist/ build output if it sneaks in
  if (file.includes('.vitepress' + path.sep + 'dist')) continue
  // Be careful: avoid replacing the substring inside the new URL itself
  // (the new URL is a superset of the old). Use a regex with a negative
  // lookahead so we only match the OLD URL, not the new one if it's already
  // been written.
  const re = /\/guides\/llm-cost-control(?!-runtime-control)/g
  const next = content.replace(re, TO)
  if (next !== content) {
    fs.writeFileSync(file, next)
    touched++
    console.log('✓', file)
  }
}
console.log(`\nDone. ${touched} files updated.`)
