#!/usr/bin/env node
/**
 * Localisation gate: locale key parity + no hard-coded user-facing strings.
 * Run with tsx so the TypeScript dictionaries can be imported directly.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { dirname, join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import { localeKeys } from '../src/app/i18n.js'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const en = localeKeys('en')
const de = localeKeys('de')
const missing = en.filter((key) => !de.includes(key))
const extra = de.filter((key) => !en.includes(key))
let failures = 0

if (missing.length > 0) {
  console.error(`de is missing keys: ${missing.join(', ')}`)
  failures++
}
if (extra.length > 0) {
  console.error(`de has unknown keys: ${extra.join(', ')}`)
  failures++
}

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const full = join(dir, entry)
    return statSync(full).isDirectory() ? walk(full) : [full]
  })
}

const files = [...walk(join(root, 'src/app')), ...walk(join(root, 'src/render'))].filter(
  (file) => file.endsWith('.ts') && !file.endsWith('i18n.ts'),
)

const patterns: Array<{ name: string; regex: RegExp }> = [
  { name: 'textContent literal', regex: /\btextContent\s*=\s*(['"])([^'"]*)\1/g },
  { name: 'HUD text literal', regex: /\btext\(\s*(['"])([^'"]*)\1/g },
  { name: 'aria-label literal', regex: /setAttribute\(\s*['"]aria-label['"]\s*,\s*(['"])([^'"]*)\1/g },
]

for (const file of files) {
  const source = readFileSync(file, 'utf8')
  const lines = source.split('\n')
  for (const pattern of patterns) {
    for (const match of source.matchAll(pattern.regex)) {
      const value = match[2] ?? ''
      if (value.length === 0 || value === '×') continue
      const index = source.slice(0, match.index).split('\n').length
      console.error(`${relative(root, file)}:${index}: ${pattern.name}: "${value}"`)
      failures++
    }
  }
  void lines
}

if (failures > 0) process.exit(1)
console.info(`i18n check: ok (${en.length} keys, en/de in sync, no literal UI strings)`)
