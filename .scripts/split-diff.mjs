// Split unstaged blog/ diff into Phase 4 (Related how-to guides) and
// Phase 5 (Part of: pillar) patch files.
import { execSync } from 'node:child_process'
import fs from 'node:fs'

const diff = execSync('git diff blog/', { encoding: 'utf-8' })

// Parse diff into per-file blocks, then per-hunk within each file
const fileBlocks = diff.split(/(?=^diff --git )/m).filter(Boolean)

const phase4Out = []
const phase5Out = []

for (const block of fileBlocks) {
  // Header lines: everything up to (and including) the first "@@" hunk header
  const firstHunkIdx = block.search(/^@@/m)
  if (firstHunkIdx === -1) continue
  const header = block.slice(0, firstHunkIdx)
  const hunksRaw = block.slice(firstHunkIdx)

  // Split into hunks (each starts with @@)
  const hunks = hunksRaw.split(/(?=^@@)/m).filter(h => h.startsWith('@@'))

  const phase4Hunks = []
  const phase5Hunks = []

  for (const h of hunks) {
    if (h.includes('## Related how-to guides')) phase4Hunks.push(h)
    else if (h.includes('Part of: [The')) phase5Hunks.push(h)
    else {
      // Unexpected hunk — log and skip
      console.error('UNCLASSIFIED hunk in', header.split('\n')[0])
      console.error(h.slice(0, 200))
    }
  }

  if (phase4Hunks.length) phase4Out.push(header + phase4Hunks.join(''))
  if (phase5Hunks.length) phase5Out.push(header + phase5Hunks.join(''))
}

fs.writeFileSync('D:/temp/phase4.patch', phase4Out.join(''))
fs.writeFileSync('D:/temp/phase5.patch', phase5Out.join(''))

console.log(`Phase 4 patch: ${phase4Out.length} files`)
console.log(`Phase 5 patch: ${phase5Out.length} files`)
