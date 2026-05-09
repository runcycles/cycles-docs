// Summarize link-audit candidates by keyword frequency.
// Helps decide which keyword groups to prioritize.
import fs from 'node:fs'
import path from 'node:path'

const keywordMap = [
  { kw: 'shadow mode', slug: 'shadow-mode-in-cycles-how-to-roll-out-budget-enforcement-without-breaking-production' },
  { kw: 'overage policy', slug: 'choosing-the-right-overage-policy' },
  { kw: 'RISK_POINTS', slug: 'assigning-risk-points-to-agent-tools' },
  { kw: 'multi-tenant', slug: 'multi-tenant-saas-with-cycles' },
  { kw: 'budget templates', slug: 'budget-templates' },
  { kw: 'cost estimation', slug: 'cost-estimation-cheat-sheet' },
  { kw: 'degradation path', slug: 'how-to-think-about-degradation-paths-in-cycles-deny-downgrade-disable-or-defer' },
  { kw: 'LangChain', slug: 'how-to-add-budget-control-to-a-langchain-agent' },
  { kw: 'API key', slug: 'api-key-management-in-cycles' },
  { kw: 'Prometheus', slug: 'prometheus-metrics-reference' },
  { kw: 'production operations', slug: 'production-operations-guide' },
  { kw: 'dashboard', slug: 'using-the-cycles-dashboard' },
  { kw: 'stuck reservations', slug: 'force-releasing-stuck-reservations-as-an-operator' },
  { kw: 'client performance', slug: 'client-performance-tuning' },
  { kw: 'OpenAI', slug: 'integrating-cycles-with-openai' },
  { kw: 'Anthropic', slug: 'integrating-cycles-with-anthropic' },
  { kw: 'AWS Bedrock', slug: 'integrating-cycles-with-aws-bedrock' },
  { kw: 'LangGraph', slug: 'integrating-cycles-with-langgraph' },
  { kw: 'Vercel AI SDK', slug: 'integrating-cycles-with-vercel-ai-sdk' },
  { kw: 'Spring AI', slug: 'integrating-cycles-with-spring-ai' },
  { kw: 'MCP server', slug: 'integrating-cycles-with-mcp' },
  { kw: 'RESET_SPENT', slug: 'rolling-over-billing-periods-with-reset-spent' },
  { kw: 'monitoring and alert', slug: 'monitoring-and-alerting' },
  { kw: 'observability setup', slug: 'observability-setup' },
  { kw: 'webhook', slug: 'webhook-integrations' },
  { kw: 'shared budget', slug: 'multi-agent-shared-workspace-budget-patterns' },
  { kw: 'streaming', slug: 'handling-streaming-responses-with-cycles' },
]

const escape = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

const blogs = fs.readdirSync('blog').filter((f) => f.endsWith('.md') && f !== 'index.md')

const byKw = new Map()
const candidates = []
for (const blog of blogs) {
  const content = fs.readFileSync(path.join('blog', blog), 'utf-8')
  const body = content.replace(/^---[\s\S]*?\n---\n/, '')
  for (const { kw, slug } of keywordMap) {
    const url = '/how-to/' + slug
    const re = new RegExp(`\\b${escape(kw)}`, 'i')
    if (re.test(body) && !body.includes(url)) {
      byKw.set(kw, (byKw.get(kw) ?? 0) + 1)
      candidates.push({ blog, kw, slug })
    }
  }
}

const sorted = [...byKw.entries()].sort((a, b) => b[1] - a[1])
console.log('Candidates by keyword (frequency):')
let total = 0
for (const [kw, n] of sorted) {
  total += n
  console.log(`  ${n.toString().padStart(3)}  ${kw}`)
}
console.log(`  ---  ${total} total candidates across ${blogs.length} blog posts`)
