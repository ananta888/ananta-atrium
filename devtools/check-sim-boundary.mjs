#!/usr/bin/env node
/**
 * Import-boundary gate (AGENTS.md rule 1).
 * src/sim must stay renderer-agnostic so it can run headless in Node.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join, relative } from 'node:path'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const simDir = join(root, 'src', 'sim')
const forbidden = /(?:from|import)\s*\(?\s*['"]@babylonjs\/|require\(\s*['"]@babylonjs\//

function walk(dir) {
  return readdirSync(dir).flatMap((entry) => {
    const full = join(dir, entry)
    return statSync(full).isDirectory() ? walk(full) : [full]
  })
}

const offenders = []
for (const file of walk(simDir)) {
  if (!/\.(ts|tsx|js|mjs)$/.test(file)) continue
  const lines = readFileSync(file, 'utf8').split('\n')
  lines.forEach((line, index) => {
    if (forbidden.test(line)) {
      offenders.push(`${relative(root, file)}:${index + 1}: ${line.trim()}`)
    }
  })
}

if (offenders.length > 0) {
  console.error('Renderer import found under src/sim — this breaks headless simulation:')
  for (const line of offenders) console.error(`  ${line}`)
  process.exit(1)
}
console.info('sim boundary check: ok (no @babylonjs imports under src/sim)')
