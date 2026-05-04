// Update pillar link DISPLAY TEXT site-wide (not URLs — those were already
// updated separately). After H1 reframe to "Reference", link labels should
// match. Skip dist/ and node_modules.
import fs from 'node:fs'
import path from 'node:path'

const replacements = [
  // Cost pillar — most common form is "Part of: [The LLM Cost Control Guide]"
  [/\[The LLM Cost Control Guide\]/g, '[LLM Cost Runtime Control Reference]'],
  // Cross-link in risk pillar end-section
  [/\[The LLM Cost Control Guide\]/g, '[LLM Cost Runtime Control Reference]'],
  // Risk pillar — display labels
  [/\[The AI Agent Risk & Blast Radius Guide\]/g, '[AI Agent Risk & Blast Radius Reference]'],
]

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
  if (file.includes('.vitepress' + path.sep + 'dist')) continue
  let content = fs.readFileSync(file, 'utf-8')
  let changed = false
  for (const [from, to] of replacements) {
    if (from.test(content)) { content = content.replace(from, to); changed = true }
  }
  if (changed) {
    fs.writeFileSync(file, content)
    touched++
    console.log('✓', file)
  }
}
console.log(`\nDone. ${touched} files updated.`)
