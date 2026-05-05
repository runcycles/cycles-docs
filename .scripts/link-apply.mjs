import fs from 'node:fs'
import path from 'node:path'

const blogDir = 'blog'

const keywordMap = [
  { kw: 'shadow mode',           slug: 'shadow-mode-in-cycles-how-to-roll-out-budget-enforcement-without-breaking-production', label: 'Shadow Mode rollout' },
  { kw: 'overage policy',        slug: 'choosing-the-right-overage-policy', label: 'Choosing the right overage policy' },
  { kw: 'RISK_POINTS',           slug: 'assigning-risk-points-to-agent-tools', label: 'Assigning RISK_POINTS to agent tools' },
  { kw: 'multi-tenant',          slug: 'multi-tenant-saas-with-cycles', label: 'Multi-tenant SaaS guide' },
  { kw: 'budget templates',      slug: 'budget-templates', label: 'Budget templates' },
  { kw: 'cost estimation',       slug: 'cost-estimation-cheat-sheet', label: 'Cost estimation cheat sheet' },
  { kw: 'degradation path',      slug: 'how-to-think-about-degradation-paths-in-cycles-deny-downgrade-disable-or-defer', label: 'Degradation paths' },
  { kw: 'LangChain',             slug: 'how-to-add-budget-control-to-a-langchain-agent', label: 'Budget control for LangChain' },
  { kw: 'API key',               slug: 'api-key-management-in-cycles', label: 'API key management' },
  { kw: 'Prometheus',            slug: 'prometheus-metrics-reference', label: 'Prometheus metrics reference' },
  { kw: 'production operations', slug: 'production-operations-guide', label: 'Production operations guide' },
  { kw: 'dashboard',             slug: 'using-the-cycles-dashboard', label: 'Using the Cycles dashboard' },
  { kw: 'stuck reservations',    slug: 'force-releasing-stuck-reservations-as-an-operator', label: 'Force-releasing stuck reservations' },
  { kw: 'client performance',    slug: 'client-performance-tuning', label: 'Client performance tuning' },
  { kw: 'OpenAI',                slug: 'integrating-cycles-with-openai', label: 'Integrating with OpenAI' },
  { kw: 'Anthropic',             slug: 'integrating-cycles-with-anthropic', label: 'Integrating with Anthropic' },
  { kw: 'AWS Bedrock',           slug: 'integrating-cycles-with-aws-bedrock', label: 'Integrating with AWS Bedrock' },
  { kw: 'LangGraph',             slug: 'integrating-cycles-with-langgraph', label: 'Integrating with LangGraph' },
  { kw: 'Vercel AI SDK',         slug: 'integrating-cycles-with-vercel-ai-sdk', label: 'Integrating with Vercel AI SDK' },
  { kw: 'Spring AI',             slug: 'integrating-cycles-with-spring-ai', label: 'Integrating with Spring AI' },
  { kw: 'MCP server',            slug: 'integrating-cycles-with-mcp', label: 'Integrating with MCP' },
  { kw: 'RESET_SPENT',           slug: 'rolling-over-billing-periods-with-reset-spent', label: 'Rolling over billing periods' },
  { kw: 'monitoring and alert',  slug: 'monitoring-and-alerting', label: 'Monitoring and alerting' },
  { kw: 'observability setup',   slug: 'observability-setup', label: 'Observability setup' },
  { kw: 'webhook',               slug: 'webhook-integrations', label: 'Webhook integrations' },
  { kw: 'shared budget',         slug: 'multi-agent-shared-workspace-budget-patterns', label: 'Multi-agent shared budgets' },
  { kw: 'streaming',             slug: 'handling-streaming-responses-with-cycles', label: 'Handling streaming responses' },
]

// Ranking weight per keyword — concrete features rank above generic terms.
// Higher = picked first when multiple match.
const weight = kw => {
  if (/^(RISK_POINTS|RESET_SPENT)$/.test(kw)) return 5
  if (/(shadow mode|overage policy|degradation path|cost estimation|stuck reservations|shared budget)/i.test(kw)) return 4
  if (/(LangGraph|LangChain|MCP server|Vercel AI SDK|Spring AI|AWS Bedrock|Prometheus)/i.test(kw)) return 3
  if (/(multi-tenant|budget templates|streaming|webhook|monitoring and alert|observability setup|production operations|client performance)/i.test(kw)) return 2
  return 1 // OpenAI / Anthropic / API key / dashboard — generic
}

const escape = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

const blogs = fs.readdirSync(blogDir).filter(f => f.endsWith('.md') && f !== 'index.md')

const perBlog = []
for (const blog of blogs) {
  const fullPath = path.join(blogDir, blog)
  const content = fs.readFileSync(fullPath, 'utf-8')
  const body = content.replace(/^---[\s\S]*?\n---\n/, '')
  // Skip if a Related how-to section already exists
  if (/^##\s+Related how-to guides\b/m.test(body)) continue
  const matches = []
  for (const m of keywordMap) {
    const url = '/how-to/' + m.slug
    const re = new RegExp(`\\b${escape(m.kw)}`, 'i')
    if (re.test(body) && !body.includes(url)) {
      matches.push({ ...m, url, w: weight(m.kw) })
    }
  }
  if (matches.length === 0) continue
  matches.sort((a, b) => b.w - a.w)
  perBlog.push({ blog, fullPath, matches: matches.slice(0, 3), content })
}

// Apply only to blogs with at least 3 candidates (signal of topical density)
const targets = perBlog.filter(p => p.matches.length >= 3).slice(0, 30)

console.log(`Applying "Related how-to guides" to ${targets.length} blog posts...\n`)

for (const t of targets) {
  const linkLines = t.matches.map(m => `- [${m.label}](${m.url})`).join('\n')
  const block = `\n## Related how-to guides\n\n${linkLines}\n`
  // Append at very end (after a single trailing newline)
  const newContent = t.content.replace(/\s*$/, '') + '\n' + block
  fs.writeFileSync(t.fullPath, newContent)
  console.log(`✓ ${t.blog}`)
  for (const m of t.matches) console.log(`    - ${m.label}`)
}

console.log(`\nDone. Modified ${targets.length} files.`)
