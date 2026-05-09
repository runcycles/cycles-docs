// Print every (blog, keyword) candidate with the surrounding sentence
// so each can be evaluated in context. Filtered to the high-signal
// keyword set (specific Cycles terms — passing mentions of the generic
// keywords are too noisy to evaluate this way).
import fs from 'node:fs'
import path from 'node:path'

const HIGH_SIGNAL = new Set([
  'shadow mode',
  'overage policy',
  'RISK_POINTS',
  'degradation path',
  'stuck reservations',
  'RESET_SPENT',
  'webhook',
  'MCP server',
  'shared budget',
  'streaming',
  'observability setup',
])

const keywordMap = [
  { kw: 'shadow mode', slug: 'shadow-mode-in-cycles-how-to-roll-out-budget-enforcement-without-breaking-production' },
  { kw: 'overage policy', slug: 'choosing-the-right-overage-policy' },
  { kw: 'RISK_POINTS', slug: 'assigning-risk-points-to-agent-tools' },
  { kw: 'degradation path', slug: 'how-to-think-about-degradation-paths-in-cycles-deny-downgrade-disable-or-defer' },
  { kw: 'stuck reservations', slug: 'force-releasing-stuck-reservations-as-an-operator' },
  { kw: 'RESET_SPENT', slug: 'rolling-over-billing-periods-with-reset-spent' },
  { kw: 'webhook', slug: 'webhook-integrations' },
  { kw: 'MCP server', slug: 'integrating-cycles-with-mcp' },
  { kw: 'shared budget', slug: 'multi-agent-shared-workspace-budget-patterns' },
  { kw: 'streaming', slug: 'handling-streaming-responses-with-cycles' },
  { kw: 'observability setup', slug: 'observability-setup' },
]

const escape = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

const blogs = fs.readdirSync('blog').filter((f) => f.endsWith('.md') && f !== 'index.md')

let n = 0
for (const blog of blogs) {
  const content = fs.readFileSync(path.join('blog', blog), 'utf-8').replace(/\r\n/g, '\n')
  const body = content.replace(/^---[\s\S]*?\n---\n/, '')
  for (const { kw, slug } of keywordMap) {
    if (!HIGH_SIGNAL.has(kw)) continue
    const url = '/how-to/' + slug
    const re = new RegExp(`\\b${escape(kw)}`, 'i')
    const m = body.match(re)
    if (!m || body.includes(url)) continue

    // Find the line and surrounding context for evaluation.
    const idx = body.search(re)
    const start = Math.max(0, body.lastIndexOf('\n', idx) + 1)
    const end = body.indexOf('\n', idx)
    const line = body.slice(start, end === -1 ? body.length : end).trim()

    n++
    console.log(`${n}. blog/${blog}`)
    console.log(`   kw: "${kw}" -> ${url}`)
    console.log(`   match: ${m[0]}`)
    console.log(`   line: ${line.slice(0, 200)}${line.length > 200 ? '...' : ''}`)
    console.log()
  }
}
console.log(`Total high-signal candidates: ${n}`)
