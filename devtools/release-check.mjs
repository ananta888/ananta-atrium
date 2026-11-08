#!/usr/bin/env node
import { readFileSync } from 'node:fs'

const tag = process.argv[2]
if (!tag || !/^v\d+\.\d+\.\d+$/.test(tag)) {
  console.error('usage: node devtools/release-check.mjs v1.2.3')
  process.exit(1)
}
const version = tag.slice(1)
const pkg = JSON.parse(readFileSync('package.json', 'utf8'))
if (pkg.version !== version) {
  console.error(`package.json version ${pkg.version} does not match tag ${tag}`)
  process.exit(1)
}
const changelog = readFileSync('CHANGELOG.md', 'utf8')
if (!changelog.includes(`## [${version}]`)) {
  console.error(`CHANGELOG.md has no section for ${version}`)
  process.exit(1)
}
console.info(`release check: ${tag} ok`)
