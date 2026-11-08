#!/usr/bin/env node
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { validateManifest } from '../src/world/assets.ts'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const manifest = validateManifest(JSON.parse(readFileSync(join(root, 'assets/manifest.json'), 'utf8')))

let failures = 0
for (const asset of manifest.assets) {
  if (!asset.licence || !asset.source) {
    console.error(`${asset.id}: missing licence/source`)
    failures++
  }
  for (const [kind, path] of Object.entries(asset.variants)) {
    if (!path) continue
    try {
      const bytes = readFileSync(join(root, path))
      if (asset.sha256) {
        const digest = createHash('sha256').update(bytes).digest('hex')
        if (digest !== asset.sha256) {
          console.error(`${asset.id}: ${kind} hash mismatch`)
          failures++
        }
      }
      console.info(`${asset.id}: ${kind} ok (${bytes.length} bytes)`)
    } catch {
      console.error(`${asset.id}: ${kind} missing at ${path}`)
      failures++
    }
  }
}
if (failures > 0) process.exit(1)
console.info('asset manifest check: ok')
