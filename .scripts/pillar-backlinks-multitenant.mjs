import fs from 'node:fs'
import path from 'node:path'

const blogDir = 'blog'
const pillarUrl = '/guides/multi-tenant-operations'
const callout = `> **Part of: [Multi-Tenant AI Operations Reference](${pillarUrl})** — the full pillar covering scope hierarchy, per-tenant enforcement, multi-agent coordination, tenant lifecycle, and identity.`

const spokes = [
  'multi-tenant-ai-cost-control-per-tenant-budgets-quotas-isolation.md',
  'agents-are-cross-cutting-your-controls-arent.md',
  'cross-platform-ai-agent-governance-salesforce-servicenow.md',
  'multi-agent-budget-control-crewai-autogen-openai-agents-sdk.md',
  'multi-agent-coordination-failure-structural-prevention.md',
  'tenant-lifecycle-cascade-semantics-at-scale.md',
  'least-privilege-api-keys-for-ai-agents.md',
  'operating-budget-enforcement-in-production.md',
  'why-multi-agent-systems-fail-87-percent-cost-of-every-coordination-breakdown.md',
]

let modified = 0
for (const spoke of spokes) {
  const fullPath = path.join(blogDir, spoke)
  if (!fs.existsSync(fullPath)) { console.log(`! missing: ${spoke}`); continue }
  const content = fs.readFileSync(fullPath, 'utf-8')
  if (content.includes(pillarUrl)) { console.log(`= already linked: ${spoke}`); continue }
  const eol = content.includes('\r\n') ? '\r\n' : '\n'
  const fmMatch = content.match(/^---\r?\n[\s\S]*?\r?\n---\r?\n/)
  if (!fmMatch) { console.log(`? no frontmatter: ${spoke}`); continue }
  const fm = fmMatch[0]
  const rest = content.slice(fm.length)
  const h1Match = rest.match(/^#\s+.+$/m)
  if (!h1Match) { console.log(`? no H1: ${spoke}`); continue }
  const h1End = rest.indexOf(h1Match[0]) + h1Match[0].length
  const newRest = rest.slice(0, h1End) + eol + eol + callout + rest.slice(h1End)
  fs.writeFileSync(fullPath, fm + newRest)
  console.log(`✓ ${spoke}`)
  modified++
}
console.log(`\nDone. ${modified} files modified.`)
