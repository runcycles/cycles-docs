import fs from 'node:fs'
import path from 'node:path'

const blogDir = 'blog'
const pillarUrl = '/guides/risk-and-blast-radius'
const callout = `> **Part of: [The AI Agent Risk & Blast Radius Guide](${pillarUrl})** — the full pillar covering action authority, risk scoring, blast-radius containment, and degradation paths.`

const spokes = [
  'ai-agent-action-control-hard-limits-side-effects.md',
  'ai-agent-action-failures-runtime-authority-prevents.md',
  'ai-agent-failures-budget-controls-prevent.md',
  'ai-agent-runtime-permissions-control-actions-before-execution.md',
  'ai-agent-risk-assessment-score-classify-enforce-tool-risk.md',
  'beyond-budget-how-cycles-controls-agent-actions.md',
  'ai-agent-deleted-prod-database-9-seconds.md',
  'ai-agent-silent-failures-why-200-ok-is-the-most-dangerous-response.md',
  'agent-delegation-chains-authority-attenuation-not-trust-propagation.md',
  'agents-are-cross-cutting-your-controls-arent.md',
  'mcp-tool-poisoning-why-agent-frameworks-cant-prevent-it.md',
  'openai-agents-sdk-has-guardrails-for-content-but-nothing-for-actions.md',
  'zero-trust-for-ai-agents-why-every-tool-call-needs-a-policy-decision.md',
  'least-privilege-api-keys-for-ai-agents.md',
  'when-budget-runs-out-graceful-degradation-patterns-for-ai-agents.md',
  'runtime-authority-vs-guardrails-vs-observability.md',
  'action-authority-demo-support-agent-walkthrough.md',
  'ai-agent-governance-framework-nist-eu-ai-act-iso-42001-owasp-runtime-enforcement.md',
  'ai-agent-governance-runtime-enforcement-security-cost-compliance.md',
  'ai-agent-governance-admin-dashboard-monitor-control-budgets-risk.md',
  'cross-platform-ai-agent-governance-salesforce-servicenow.md',
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
