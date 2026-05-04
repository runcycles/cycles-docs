// Insert a pre-configured "recreate this scenario" callout into 5 blog posts.
// The callout goes right after the H1, or if a "Part of: [pillar]" callout
// already exists there, immediately after that.
import fs from 'node:fs'
import path from 'node:path'

const blogDir = 'blog'

// Pre-encoded state values from /d/temp/seeds.env. Hardcoded so this script
// is reproducible in isolation.
const SEEDS = {
  'cost-conversation':  'eyJ3b3JrbG9hZE5hbWUiOiJDdXN0b21lciBzdXBwb3J0IGJvdCIsIndvcmtsb2FkRGVzY3JpcHRpb24iOiIxMSBMTE0gY2FsbHMgcGVyIGNvbnZlcnNhdGlvbi4gQ29udGV4dCB3aW5kb3dzIGdyb3cgd2l0aCBlYWNoIHR1cm4uIEVzdGltYXRlZCAkODAwL21vLCBhY3R1YWwgJDQsMjAwLiIsImlucHV0VG9rZW5zIjo1MDAwLCJvdXRwdXRUb2tlbnMiOjEyMDAsImNhbGxzUGVyRGF5IjozMzAwfQ',
  'cost-quality-loop':  'eyJ3b3JrbG9hZE5hbWUiOiJTdXBwb3J0IGFnZW50IHdpdGggcXVhbGl0eS1sb29wIGJ1ZyIsIndvcmtsb2FkRGVzY3JpcHRpb24iOiJEcmFmdHMgYSByZXNwb25zZSwgZXZhbHVhdGVzIHF1YWxpdHksIHJlZmluZXMgdW50aWwgc2NvcmUgPjguIEJ1ZzogZXZhbHVhdG9yIG5ldmVyIHJldHVybnMgYWJvdmUgNi45LiB-MTAwIGNhbGxzIHBlciByZWZpbmVtZW50IGxvb3AuIiwiaW5wdXRUb2tlbnMiOjMwMDAsIm91dHB1dFRva2VucyI6ODAwLCJjYWxsc1BlckRheSI6NTAwfQ',
  'cost-multitenant':   'eyJ3b3JrbG9hZE5hbWUiOiJNdWx0aS10ZW5hbnQgU2FhUyDigJQgbm9pc3kgdGVuYW50Iiwid29ya2xvYWREZXNjcmlwdGlvbiI6Ik9uZSB0ZW5hbnQgcnVucyBhdCA1MHggdGhlIGF2ZXJhZ2UgbG9hZC4gU2hhcmVkIGJ1ZGdldDsgdGhlaXIgYnVybiBkcmFpbnMgZXZlcnlvbmUncyBoZWFkcm9vbS4iLCJpbnB1dFRva2VucyI6NDAwMCwib3V0cHV0VG9rZW5zIjoxMDAwLCJjYWxsc1BlckRheSI6NTAwMDB9',
  'cost-uncontrolled':  'eyJ3b3JrbG9hZE5hbWUiOiJVbmNvbnRyb2xsZWQgcHJvZHVjdGlvbiBhZ2VudCIsIndvcmtsb2FkRGVzY3JpcHRpb24iOiJBZ2VudCBpbiBwcm9kdWN0aW9uIHdpdGggbm8gcGVyLWNhbGwsIHBlci10ZW5hbnQsIG9yIHBlci1ydW4gYnVkZ2V0LiBDb3N0cyBzY2FsZSB3aXRoIHdoYXRldmVyIHRoZSBtb2RlbCBlbWl0cy4iLCJpbnB1dFRva2VucyI6ODAwMCwib3V0cHV0VG9rZW5zIjoxNTAwLCJjYWxsc1BlckRheSI6NTAwMH0',
  'risk-coding-agent':  'eyJhZ2VudE5hbWUiOiJDb2RpbmcgYWdlbnQgKGRhdGFiYXNlIGFjY2VzcykiLCJhZ2VudERlc2NyaXB0aW9uIjoiQUkgY29kaW5nIGFnZW50IHdpdGggcHJvZHVjdGlvbiBkYXRhYmFzZSBjcmVkZW50aWFscyDigJQgcmVhZCBzY2hlbWEsIHJ1biBtaWdyYXRpb25zLCBwdXNoIGNvZGUuIiwiY29udGFpbm1lbnRQY3QiOjAsInJvd3MiOlt7Im5hbWUiOiJEUk9QIFRBQkxFIC8gREVMRVRFIG1pZ3JhdGlvbiIsInJldmVyc2liaWxpdHkiOiJpcnJldmVyc2libGUiLCJ2aXNpYmlsaXR5IjoiY3VzdG9tZXItZmFjaW5nIiwiY29zdFBlckFjdGlvbiI6MCwiYWZmZWN0ZWRVc2VycyI6MTAwMDAwLCJjb3N0UGVyVXNlciI6NTAsImNhbGxzUGVyRGF5Ijo1MCwiZXJyb3JSYXRlIjowLjA1fSx7Im5hbWUiOiJTY2hlbWEgbWlncmF0aW9uIHRvIHByb2R1Y3Rpb24iLCJyZXZlcnNpYmlsaXR5IjoiaGFyZC10by1yZXZlcnNlIiwidmlzaWJpbGl0eSI6ImN1c3RvbWVyLWZhY2luZyIsImNvc3RQZXJBY3Rpb24iOjAsImFmZmVjdGVkVXNlcnMiOjEwMDAwMCwiY29zdFBlclVzZXIiOjIwLCJjYWxsc1BlckRheSI6NSwiZXJyb3JSYXRlIjowLjF9LHsibmFtZSI6IkNvZGUgZGVwbG95IHRvIHB1YmxpYyBzaXRlIiwicmV2ZXJzaWJpbGl0eSI6ImhhcmQtdG8tcmV2ZXJzZSIsInZpc2liaWxpdHkiOiJwdWJsaWMiLCJjb3N0UGVyQWN0aW9uIjowLCJhZmZlY3RlZFVzZXJzIjoxMDAwMDAsImNvc3RQZXJVc2VyIjoxMCwiY2FsbHNQZXJEYXkiOjIwLCJlcnJvclJhdGUiOjAuM30seyJuYW1lIjoiUmVhZCBzY2hlbWEgLyBTRUxFQ1QiLCJyZXZlcnNpYmlsaXR5IjoicmV2ZXJzaWJsZSIsInZpc2liaWxpdHkiOiJpbnRlcm5hbCIsImNvc3RQZXJBY3Rpb24iOjAsImFmZmVjdGVkVXNlcnMiOjEsImNvc3RQZXJVc2VyIjowLCJjYWxsc1BlckRheSI6NTAwMCwiZXJyb3JSYXRlIjoxfV19',
}

const PLACEMENTS = [
  {
    file:  'how-much-do-ai-agents-cost.md',
    state: 'cost-conversation',
    type:  'cost',
    label: 'Recreate the "estimated $800, actual $4,200" scenario in the calculator',
  },
  {
    file:  'runaway-demo-agent-cost-blowup-walkthrough.md',
    state: 'cost-quality-loop',
    type:  'cost',
    label: 'Open the quality-loop scenario in the calculator',
  },
  {
    file:  'ai-agent-deleted-prod-database-9-seconds.md',
    state: 'risk-coding-agent',
    type:  'risk',
    label: 'Open the database-coding-agent blast-radius scenario',
  },
  {
    file:  'multi-tenant-ai-cost-control-per-tenant-budgets-quotas-isolation.md',
    state: 'cost-multitenant',
    type:  'cost',
    label: 'Open the noisy-tenant scenario in the calculator',
  },
  {
    file:  'true-cost-of-uncontrolled-agents.md',
    state: 'cost-uncontrolled',
    type:  'cost',
    label: 'Open the uncontrolled-agent scenario in the calculator',
  },
]

const ROUTE = {
  cost: '/calculators/claude-vs-gpt-cost-standalone',
  risk: '/calculators/ai-agent-blast-radius-standalone',
}

let modified = 0

for (const p of PLACEMENTS) {
  const fullPath = path.join(blogDir, p.file)
  if (!fs.existsSync(fullPath)) { console.log(`! missing: ${p.file}`); continue }
  const content = fs.readFileSync(fullPath, 'utf-8')

  if (content.includes('Recreate this scenario') ||
      content.includes(SEEDS[p.state].slice(0, 40))) {
    console.log(`= already linked: ${p.file}`)
    continue
  }

  const url = `${ROUTE[p.type]}#s=${SEEDS[p.state]}`
  const callout = `> **${p.label}:** [Open with these numbers pre-loaded →](${url})`

  const eol = content.includes('\r\n') ? '\r\n' : '\n'
  const fmMatch = content.match(/^---\r?\n[\s\S]*?\r?\n---\r?\n/)
  if (!fmMatch) { console.log(`? no frontmatter: ${p.file}`); continue }
  const fm = fmMatch[0]
  const rest = content.slice(fm.length)

  // Insert just before the first <!-- more --> marker if present, else after H1
  const moreIdx = rest.indexOf('<!-- more -->')
  let before, after
  if (moreIdx !== -1) {
    // Place callout right above the more marker (before "Read more" cutoff)
    before = rest.slice(0, moreIdx)
    after  = rest.slice(moreIdx)
  } else {
    const h1Match = rest.match(/^#\s+.+$/m)
    if (!h1Match) { console.log(`? no H1: ${p.file}`); continue }
    const h1End = rest.indexOf(h1Match[0]) + h1Match[0].length
    before = rest.slice(0, h1End) + eol + eol
    after  = rest.slice(h1End)
  }
  // Trim trailing blank lines from "before" so the callout sits cleanly
  before = before.replace(/\s+$/, eol + eol)
  const newRest = before + callout + eol + eol + after

  fs.writeFileSync(fullPath, fm + newRest)
  modified++
  console.log(`✓ ${p.file}`)
}
console.log(`\nDone. ${modified} files modified.`)
