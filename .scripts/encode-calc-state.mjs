// Generate base64url-encoded calculator state for use in:
//  - <CostCalculator initial-state="..." />     (page-author defaults)
//  - <BlastRadiusCalculator initial-state="..." />
//  - https://runcycles.io/calculators/X-standalone#s=...   (shareable URLs)
//
// Usage:
//   node .scripts/encode-calc-state.mjs cost   <inline JSON>
//   node .scripts/encode-calc-state.mjs risk   <inline JSON>
//   node .scripts/encode-calc-state.mjs file   path/to/state.json
//
// Or import { encode } and use programmatically.

function utf8ToBase64(str) {
  return Buffer.from(str, 'utf-8').toString('base64')
}
function toBase64Url(b64) {
  return b64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

export function encode(state) {
  return toBase64Url(utf8ToBase64(JSON.stringify(state)))
}

if (import.meta.url === `file://${process.argv[1]}` || import.meta.url.endsWith(process.argv[1].replace(/\\/g, '/'))) {
  const [,, mode, ...rest] = process.argv
  if (!mode) {
    console.error('Usage: node encode-calc-state.mjs <cost|risk|file> <json|path>')
    process.exit(1)
  }
  let raw
  if (mode === 'file') {
    const fs = await import('node:fs')
    raw = fs.readFileSync(rest[0], 'utf-8')
  } else {
    raw = rest.join(' ')
  }
  const state = JSON.parse(raw)
  const enc = encode(state)
  console.log(enc)
}
