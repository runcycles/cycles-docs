import fs from 'node:fs'
import path from 'node:path'

const blogDir = 'blog'

// Spokes for the LLM Cost Control pillar
const spokes = [
  'ai-agent-cost-management-guide.md',
  'ai-agent-budget-control-enforce-hard-spend-limits.md',
  'multi-tenant-ai-cost-control-per-tenant-budgets-quotas-isolation.md',
  'runaway-demo-agent-cost-blowup-walkthrough.md',
  'how-much-do-ai-agents-cost.md',
  'openai-api-budget-limits-per-user-per-run-per-tenant.md',
  'ai-agent-unit-economics-cost-per-conversation-per-user-margin.md',
  'where-did-my-tokens-go-debugging-agent-spend.md',
  'real-time-budget-alerts-for-ai-agents.md',
  'estimate-drift-silent-killer-of-enforcement.md',
  'tracking-tokens-in-a-streaming-llm-response.md',
  'true-cost-of-uncontrolled-agents.md',
  'ai-agent-cost-control-2026-litellm-helicone-openrouter-runtime-authority.md',
  'multi-agent-budget-control-crewai-autogen-openai-agents-sdk.md',
]

const pillarUrl = '/guides/llm-cost-control'
const callout = `> **Part of: [The LLM Cost Control Guide](${pillarUrl})** — the full pillar covering causes, enforcement patterns, multi-tenant boundaries, and unit economics.`

let modified = 0

for (const spoke of spokes) {
  const fullPath = path.join(blogDir, spoke)
  if (!fs.existsSync(fullPath)) {
    console.log(`! missing: ${spoke}`)
    continue
  }
  const content = fs.readFileSync(fullPath, 'utf-8')
  if (content.includes(pillarUrl)) {
    console.log(`= already linked: ${spoke}`)
    continue
  }
  // Insert callout after frontmatter and after the H1 line
  const eol = content.includes('\r\n') ? '\r\n' : '\n'
  const frontmatterMatch = content.match(/^---\r?\n[\s\S]*?\r?\n---\r?\n/)
  if (!frontmatterMatch) { console.log(`? no frontmatter: ${spoke}`); continue }
  const fm = frontmatterMatch[0]
  const rest = content.slice(fm.length)
  // Find first H1
  const h1Match = rest.match(/^#\s+.+$/m)
  if (!h1Match) { console.log(`? no H1: ${spoke}`); continue }
  const h1End = rest.indexOf(h1Match[0]) + h1Match[0].length
  const before = rest.slice(0, h1End)
  const after  = rest.slice(h1End)
  const newRest = before + eol + eol + callout + after
  fs.writeFileSync(fullPath, fm + newRest)
  console.log(`✓ ${spoke}`)
  modified++
}

console.log(`\nDone. ${modified} files modified.`)
