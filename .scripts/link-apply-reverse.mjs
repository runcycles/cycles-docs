// Reverse cross-linking: appends "Related concepts" links from how-to pages
// to canonical blog posts that explain the why/concept behind operational
// keywords. Symmetric to link-apply.mjs but in the opposite direction.
//
// How-to pages tend to be operational reference. When they mention a concept
// that has a canonical blog explainer, link there so readers can dig into
// the why-this-matters context.
//
// Conservative defaults match link-apply.mjs:
//   - Skip pages that already have a "Related concepts" section.
//   - Require at least 3 keyword matches to add a section (signals topical
//     density; avoids attaching weak links to operational quick-references).
//   - Pick the top 3 keywords by weight per page.
//   - Cap at 30 pages per run; re-run idempotently for further batches.

import fs from 'node:fs'
import path from 'node:path'

const howToDir = 'how-to'

// Curated keyword (found in how-to pages) → blog post slug.
// Each entry should map a phrase that signals "the reader is now in the
// operational weeds and would benefit from the concept explainer."
const keywordMap = [
  { kw: 'runtime authority',     slug: 'what-is-runtime-authority-for-ai-agents', label: 'What is runtime authority?' },
  { kw: 'rate limiter',          slug: 'we-built-a-custom-agent-rate-limiter-heres-why-we-stopped', label: 'Why custom rate limiters fall short' },
  { kw: 'policy drift',          slug: 'policy-drift-in-ai-agents', label: 'Policy drift in AI agents' },
  { kw: 'kill switch',           slug: 'ai-agent-kill-switches-should-be-scoped', label: 'AI agent kill switches should be scoped' },
  { kw: 'action authority',      slug: 'ai-agent-action-control-hard-limits-side-effects', label: 'AI agent action control: hard limits on side effects' },
  { kw: 'action control',        slug: 'ai-agent-action-control-hard-limits-side-effects', label: 'AI agent action control: hard limits on side effects' },
  { kw: 'audit trail',           slug: 'runtime-authority-byproducts-audit-trail-and-attribution-by-default', label: 'Audit trail as a runtime-authority byproduct' },
  { kw: 'trace context',         slug: 'w3c-trace-context-ai-agent-debugging', label: 'W3C Trace Context for AI agent debugging' },
  { kw: 'delegation',            slug: 'agent-delegation-chains-authority-attenuation-not-trust-propagation', label: 'Agent delegation chains and authority attenuation' },
  { kw: 'performance benchmark', slug: 'cycles-server-performance-benchmarks', label: 'Cycles server performance benchmarks' },
  { kw: 'Redis Lua',             slug: 'why-cycles-runs-budget-authority-on-redis-lua', label: 'Why Cycles runs budget authority on Redis Lua' },
  { kw: 'MCP gateway',           slug: 'mcp-gateways-are-not-runtime-authority', label: 'MCP gateways are not runtime authority' },
  { kw: 'tool poisoning',        slug: 'mcp-tool-poisoning-why-agent-frameworks-cant-prevent-it', label: 'MCP tool poisoning' },
  { kw: 'agent registry',        slug: 'agent-registries-are-not-runtime-governance', label: 'Agent registries are not runtime governance' },
  { kw: 'agent identity',        slug: 'agent-identity-is-not-user-identity', label: 'Agent identity is not user identity' },
  { kw: 'EU AI Act',             slug: 'ai-agent-governance-framework-nist-eu-ai-act-iso-42001-owasp-runtime-enforcement', label: 'AI agent governance: NIST, EU AI Act, ISO 42001, OWASP' },
  { kw: 'NIST AI',               slug: 'ai-agent-governance-framework-nist-eu-ai-act-iso-42001-owasp-runtime-enforcement', label: 'AI agent governance: NIST, EU AI Act, ISO 42001, OWASP' },
  { kw: 'estimate drift',        slug: 'estimate-drift-silent-killer-of-enforcement', label: 'Estimate drift: the silent killer of enforcement' },
  { kw: 'retry storm',           slug: 'retry-storms-and-idempotency-in-agent-budget-systems', label: 'Retry storms and idempotency in agent budgets' },
  { kw: 'TTL sweeper',           slug: 'designing-a-redis-ttl-sweeper-that-doesnt-lie', label: 'Designing a Redis TTL sweeper that doesn\'t lie' },
  { kw: 'cutover',               slug: 'shadow-to-enforcement-cutover-decision-tree', label: 'Shadow-to-enforcement cutover decision tree' },
  { kw: 'least privilege',       slug: 'least-privilege-api-keys-for-ai-agents', label: 'Least-privilege API keys for AI agents' },
  { kw: 'zero trust',            slug: 'zero-trust-for-ai-agents-why-every-tool-call-needs-a-policy-decision', label: 'Zero trust for AI agents' },
  { kw: 'wrapper vs',            slug: 'vibe-coding-budget-wrapper-vs-budget-authority', label: 'Wrapper vs budget authority' },
  { kw: 'manifest',              slug: 'manifest-vs-cycles-routing-vs-runtime-authority', label: 'Manifest routing vs runtime authority' },
  { kw: 'cost per conversation', slug: 'ai-agent-unit-economics-cost-per-conversation-per-user-margin', label: 'AI agent unit economics' },
  { kw: 'graceful degradation',  slug: 'when-budget-runs-out-graceful-degradation-patterns-for-ai-agents', label: 'Graceful degradation patterns' },
  { kw: 'reasoning token',       slug: 'budgeting-reasoning-tokens-governing-extended-thinking-before-it-bills', label: 'Budgeting reasoning tokens' },
  { kw: 'cascade',               slug: 'tenant-lifecycle-cascade-semantics-at-scale', label: 'Tenant lifecycle cascade semantics' },
  { kw: 'webhook idempotency',   slug: 'webhook-idempotency-patterns-for-ai-agent-budget-events', label: 'Webhook idempotency patterns' },
  { kw: 'streaming response',    slug: 'tracking-tokens-in-a-streaming-llm-response', label: 'Tracking tokens in a streaming LLM response' },
  { kw: 'multi-agent',           slug: 'multi-agent-coordination-failure-structural-prevention', label: 'Multi-agent coordination failure: structural prevention' },
]

// Ranking weight per keyword. Concrete primitives outrank generic ones so
// each page links to its strongest topical neighbor when there are ties.
const weight = kw => {
  if (/(Redis Lua|TTL sweeper|estimate drift|retry storm|reasoning token|cascade|webhook idempotency|streaming response|trace context)/i.test(kw)) return 5
  if (/(runtime authority|action authority|action control|policy drift|kill switch|audit trail|tool poisoning|agent registry|agent identity|MCP gateway)/i.test(kw)) return 4
  if (/(rate limiter|wrapper vs|manifest|delegation|graceful degradation|performance benchmark|cutover|zero trust|least privilege)/i.test(kw)) return 3
  if (/(EU AI Act|NIST AI|cost per conversation|multi-agent)/i.test(kw)) return 2
  return 1
}

const escape = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

const howTos = fs.readdirSync(howToDir).filter(f => f.endsWith('.md') && f !== 'index.md')

const perPage = []
for (const ht of howTos) {
  const fullPath = path.join(howToDir, ht)
  const content = fs.readFileSync(fullPath, 'utf-8')
  const body = content.replace(/^---[\s\S]*?\n---\n/, '')
  // Skip if a Related concepts section already exists (or a Related how-to
  // section, in case content was already cross-linked another way).
  if (/^##\s+Related concepts\b/m.test(body)) continue
  const matches = []
  for (const m of keywordMap) {
    const url = '/blog/' + m.slug
    const re = new RegExp(`\\b${escape(m.kw)}`, 'i')
    if (re.test(body) && !body.includes(url)) {
      matches.push({ ...m, url, w: weight(m.kw) })
    }
  }
  if (matches.length === 0) continue
  // Dedupe by slug — one keyword can occur multiple times but a how-to should
  // link to a given blog at most once.
  const bySlug = new Map()
  for (const m of matches) {
    const existing = bySlug.get(m.slug)
    if (!existing || m.w > existing.w) bySlug.set(m.slug, m)
  }
  const deduped = [...bySlug.values()].sort((a, b) => b.w - a.w)
  if (deduped.length < 3) continue // require topical density
  perPage.push({ ht, fullPath, matches: deduped.slice(0, 3), content })
}

// Cap at 30 per run; re-run is idempotent.
const targets = perPage.slice(0, 30)

console.log(`Applying "Related concepts" to ${targets.length} how-to pages...\n`)

for (const t of targets) {
  const linkLines = t.matches.map(m => `- [${m.label}](${m.url})`).join('\n')
  const block = `\n## Related concepts\n\n${linkLines}\n`
  const newContent = t.content.replace(/\s*$/, '') + '\n' + block
  fs.writeFileSync(t.fullPath, newContent)
  console.log(`✓ ${t.ht}`)
  for (const m of t.matches) console.log(`    - ${m.label}`)
}

console.log(`\nDone. Modified ${targets.length} files.`)
