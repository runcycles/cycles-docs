#!/usr/bin/env node
// Generate llms-full.txt from all documentation markdown files.
// Runs at build time to produce a single file optimized for LLM ingestion.
//
// Node port of generate-llms-full.sh. Output is byte-for-byte identical
// to the bash version under POSIX-style sort (LF line endings, lex sort
// of filenames, awk-style frontmatter strip).

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const DOCS_ROOT = path.resolve(__dirname, '..')
const OUTPUT = path.join(DOCS_ROOT, 'public', 'llms-full.txt')

const HEADER =
  '# Cycles — Complete Documentation\n' +
  '\n' +
  '> Runtime authority for autonomous agents. Keep agents within approved spend, risk, and action limits. Open protocol, multi-language SDKs, Apache 2.0.\n' +
  '\n' +
  'This file contains the full text of all Cycles documentation, optimized for LLM ingestion. For a lightweight navigation index, see llms.txt.\n' +
  '\n'

const SECTIONS = [
  { dir: 'quickstart', label: 'Quickstart' },
  { dir: 'concepts', label: 'Concepts' },
  { dir: 'protocol', label: 'Protocol Reference' },
  { dir: 'how-to', label: 'How-To Guides' },
  { dir: 'incidents', label: 'Incident Patterns' },
  { dir: 'configuration', label: 'Configuration' },
]

// Mirror the awk strip_frontmatter logic from the original bash:
//   BEGIN{fm=0} /^---$/{fm++; if(fm<=2) next} fm>=2||fm==0{print}
// Lines before any '---' (fm==0) are kept; the first two '---' lines and
// anything between them are dropped; subsequent lines and any later '---'
// (fm>=3, e.g. an HR after the body starts) are kept.
function stripFrontmatter(content) {
  // Normalize CRLF to LF before splitting. Source markdown is committed as
  // CRLF on Windows checkouts (git core.autocrlf), and the bash version
  // gets the same effect because gawk on git-bash strips \r on input. We
  // emit pure LF so the output is byte-identical across platforms.
  const lines = content.replace(/\r\n/g, '\n').split('\n')
  let fm = 0
  const out = []
  for (const line of lines) {
    if (line === '---') {
      fm++
      if (fm <= 2) continue
    }
    if (fm >= 2 || fm === 0) out.push(line)
  }
  return out.join('\n')
}

function findMarkdownFiles(dir) {
  const out = []
  const stack = [dir]
  while (stack.length > 0) {
    const cur = stack.pop()
    let entries
    try {
      entries = fs.readdirSync(cur, { withFileTypes: true })
    } catch {
      continue
    }
    for (const entry of entries) {
      const full = path.join(cur, entry.name)
      if (entry.isDirectory()) stack.push(full)
      else if (entry.isFile() && entry.name.endsWith('.md')) out.push(full)
    }
  }
  // Sort by POSIX-style relative path so output is identical across
  // platforms (the bash version uses `find ... | sort` which on git-bash
  // produces forward-slash paths).
  return out.sort((a, b) => {
    const ap = path.relative(DOCS_ROOT, a).split(path.sep).join('/')
    const bp = path.relative(DOCS_ROOT, b).split(path.sep).join('/')
    return ap < bp ? -1 : ap > bp ? 1 : 0
  })
}

let output = HEADER

for (const { dir, label } of SECTIONS) {
  const dirPath = path.join(DOCS_ROOT, dir)
  if (!fs.existsSync(dirPath) || !fs.statSync(dirPath).isDirectory()) continue

  output += '---\n'
  output += '\n'
  output += `# ${label}\n`
  output += '\n'

  for (const file of findMarkdownFiles(dirPath)) {
    output += '\n'
    output += stripFrontmatter(fs.readFileSync(file, 'utf8'))
    output += '\n'
  }
}

fs.writeFileSync(OUTPUT, output)

const bytes = Buffer.byteLength(output)
const newlines = (output.match(/\n/g) || []).length
console.log(
  `Generated llms-full.txt: ${newlines} lines, ${Math.floor(bytes / 1024)} KB`,
)
