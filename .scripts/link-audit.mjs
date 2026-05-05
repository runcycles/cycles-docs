import fs from 'node:fs'
import path from 'node:path'

const howToDir = 'how-to'
const blogDir = 'blog'

// Curated keyword → how-to slug map. Each key picks ONE strong, search-worthy
// phrase that, if a blog post mentions it without linking to the canonical
// how-to, indicates a likely gap worth filling.
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

const escape = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

const blogs = fs.readdirSync(blogDir).filter(f => f.endsWith('.md') && f !== 'index.md')
const candidates = []

for (const blog of blogs) {
  const content = fs.readFileSync(path.join(blogDir, blog), 'utf-8')
  // Skip frontmatter for keyword detection
  const body = content.replace(/^---[\s\S]*?\n---\n/, '')
  for (const { kw, slug, label } of keywordMap) {
    const url = '/how-to/' + slug
    const re = new RegExp(`\\b${escape(kw)}`, 'i')
    if (re.test(body) && !body.includes(url)) {
      candidates.push({ blog, kw, slug, url, label })
    }
  }
}

const byBlog = {}
for (const c of candidates) (byBlog[c.blog] ||= []).push(c)

const sorted = Object.entries(byBlog).sort((a, b) => b[1].length - a[1].length)
console.log('Total candidate (blog, how-to) pairs:', candidates.length)
console.log('Blogs with at least one gap:', sorted.length)
console.log('\nTop 25 blogs by # of missing how-to links:\n')
for (const [blog, cs] of sorted.slice(0, 25)) {
  console.log(`${blog}  (${cs.length})`)
  for (const c of cs) console.log(`    "${c.kw}" -> ${c.url}`)
}
