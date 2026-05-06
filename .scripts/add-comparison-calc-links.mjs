// Add a "Run the numbers" callout to each /concepts/cycles-vs-* page.
// Inserted right before the first H2 — i.e., after the intro paragraphs.
// Skip files that already have it.
import fs from 'node:fs'
import path from 'node:path'

const dir = 'concepts'

// Per-file callout copy. The slug → callout map lets us tune which
// calculator(s) to highlight based on the comparison's argument.
const calloutBySlug = {
  'cycles-vs-rate-limiting':
    `> **Run the numbers for your workload:** [Cost Calculator →](/calculators/claude-vs-gpt-cost-standalone) — rate limits do not bound spend; the calculator shows what one un-budgeted runaway loop is worth at your token rate.`,
  'cycles-vs-provider-spending-caps':
    `> **Run the numbers for your workload:** [Cost Calculator →](/calculators/claude-vs-gpt-cost-standalone) — provider caps fire at the org level; the calculator shows per-tenant exposure when one tenant burns the shared headroom.`,
  'cycles-vs-helicone':
    `> **Run the numbers for your workload:** [Cost Calculator →](/calculators/claude-vs-gpt-cost-standalone) — Helicone observes spend; the calculator shows what is *in scope* before any enforcement layer fires.`,
  'cycles-vs-langsmith':
    `> **Run the numbers for your workload:** [Cost Calculator →](/calculators/claude-vs-gpt-cost-standalone) · [Blast Radius Risk Calculator →](/calculators/ai-agent-blast-radius-standalone) — observability records what happened; the calculators show what *will* happen at your token volume and action profile.`,
  'cycles-vs-litellm':
    `> **Run the numbers for your workload:** [Cost Calculator →](/calculators/claude-vs-gpt-cost-standalone) — LiteLLM proxies calls to providers; the calculator shows what total spend looks like when no per-call cap fires upstream.`,
  'cycles-vs-openrouter':
    `> **Run the numbers for your workload:** [Cost Calculator →](/calculators/claude-vs-gpt-cost-standalone) — OpenRouter routes; the calculator shows what *cheaper-model routing* alone saves vs hard per-tenant budget enforcement.`,
  'cycles-vs-guardrails-ai':
    `> **Run the numbers for your workload:** [Blast Radius Risk Calculator →](/calculators/ai-agent-blast-radius-standalone) — content guardrails filter input/output text; the calculator shows what *actions* the agent could still take that no content filter catches.`,
  'cycles-vs-custom-token-counters':
    `> **Run the numbers for your workload:** [Cost Calculator →](/calculators/claude-vs-gpt-cost-standalone) — token counters predict; the calculator separates the prediction (rates × volume) from the enforcement layer that bounds reality.`,
}

let modified = 0
for (const file of fs.readdirSync(dir)) {
  if (!file.startsWith('cycles-vs-') || !file.endsWith('.md')) continue
  const slug = file.replace(/\.md$/, '')
  const callout = calloutBySlug[slug]
  if (!callout) { console.log(`? no callout authored for ${slug}`); continue }

  const fullPath = path.join(dir, file)
  const content = fs.readFileSync(fullPath, 'utf-8')

  if (content.includes('Run the numbers for your workload')) {
    console.log(`= already has callout: ${slug}`)
    continue
  }

  const eol = content.includes('\r\n') ? '\r\n' : '\n'
  // Find the position of the first H2 (## )
  const h2Match = content.match(/^##\s+/m)
  if (!h2Match) { console.log(`? no H2 in ${slug}`); continue }
  const idx = content.indexOf(h2Match[0])
  // Walk back to the start of the H2 line
  const beforeH2 = content.slice(0, idx)
  const fromH2   = content.slice(idx)
  const newContent = beforeH2 + callout + eol + eol + fromH2
  fs.writeFileSync(fullPath, newContent)
  modified++
  console.log(`✓ ${slug}`)
}
console.log(`\nDone. ${modified} files modified.`)
