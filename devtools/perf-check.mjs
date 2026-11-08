#!/usr/bin/env node
/**
 * Reproducible performance check.
 * - Same scene, same camera path, production-ish build served by Vite.
 * - Median of N samples; baseline in perf/baseline.json.
 * - Fails when fps drops below the budget, draw calls exceed it, or a metric
 *   regresses by more than the documented percentage.
 *
 * Usage: node devtools/perf-check.mjs [--update]
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from '@playwright/test'
import { createServer } from 'vite'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const update = process.argv.includes('--update')
const PORT = 5199
const RUNS = 2
const SAMPLES = 12

const cullingWaypoints = new Set(['plaza', 'lobby', 'office'])
const waypoints = [
  { id: 'plaza', x: 4, y: 1.8, z: 30 },
  { id: 'lobby', x: -28, y: 1.75, z: 4 },
  { id: 'office', x: -35, y: 1.75, z: 4 },
  { id: 'stairs', x: -20, y: 1.75, z: 0 },
  { id: 'floor-1', x: -28, y: 5.75, z: 4 },
  { id: 'forge', x: 4, y: 1.75, z: 4 },
  { id: 'observatory', x: 36, y: 1.75, z: 4 },
  { id: 'library', x: -14, y: 1.75, z: -36 },
  { id: 'studio', x: 26, y: 1.75, z: -36 },
]

const budget = JSON.parse(readFileSync(join(root, 'perf/budget.json'), 'utf8'))

function median(values) {
  if (values.length === 0) return 0
  const sorted = [...values].sort((a, b) => a - b)
  return sorted[Math.floor(sorted.length / 2)]
}

const server = await createServer({
  root,
  logLevel: 'error',
  server: { port: PORT, strictPort: true },
})
await server.listen()

const browser = await chromium.launch()
const runs = []

try {
  for (let run = 0; run < RUNS; run++) {
    const page = await browser.newPage({ viewport: { width: 1280, height: 720 } })
    await page.goto(`http://127.0.0.1:${PORT}/`, { waitUntil: 'domcontentloaded' })
    await page.getByRole('button', { name: 'Enter demo mode' }).click()
    await page.waitForFunction(
      () => window.__atrium && window.__atrium.getDebugState().agents === 50,
      null,
      { timeout: 30_000 },
    )
    const runData = {}
    for (const waypoint of waypoints) {
      await page.evaluate(({ x, y, z }) => window.__atrium.debugTeleport(x, y, z), waypoint)
      await page.waitForTimeout(900)
      const samples = []
      for (let i = 0; i < SAMPLES; i++) {
        await page.waitForTimeout(100)
        samples.push(
          await page.evaluate(() => {
            const state = window.__atrium.getDebugState()
            return {
              fps: state.fps,
              drawCalls: state.drawCalls,
              meshes: state.meshes,
              visibleRooms: state.visibleRooms,
            }
          }),
        )
      }
      runData[waypoint.id] = {
        fps: median(samples.map((s) => s.fps)),
        drawCalls: median(samples.map((s) => s.drawCalls)),
        meshes: median(samples.map((s) => s.meshes)),
        visibleRooms: median(samples.map((s) => s.visibleRooms)),
      }
      if (cullingWaypoints.has(waypoint.id)) {
        await page.evaluate(() => window.__atrium.debugSetNaiveRendering(true))
        await page.waitForTimeout(500)
        const naiveSamples = []
        for (let i = 0; i < 6; i++) {
          await page.waitForTimeout(100)
          naiveSamples.push(
            await page.evaluate(() => window.__atrium.getDebugState().drawCalls),
          )
        }
        await page.evaluate(() => window.__atrium.debugSetNaiveRendering(false))
        runData[waypoint.id].naiveDrawCalls = median(naiveSamples)
      }
    }
    runs.push(runData)
    await page.close()
  }
} finally {
  await browser.close()
  await server.close()
}

const result = {}
const failures = []
for (const waypoint of waypoints) {
  result[waypoint.id] = {
    fps: median(runs.map((run) => run[waypoint.id].fps)),
    drawCalls: median(runs.map((run) => run[waypoint.id].drawCalls)),
    meshes: median(runs.map((run) => run[waypoint.id].meshes)),
    visibleRooms: median(runs.map((run) => run[waypoint.id].visibleRooms)),
    ...(resultNaive(waypoint.id, runs) !== null ? { naiveDrawCalls: resultNaive(waypoint.id, runs) } : {}),
  }
  const naive = result[waypoint.id].naiveDrawCalls
  if (typeof naive === 'number' && naive > 0) {
    result[waypoint.id].cullingDropPercent = Number(
      (((naive - result[waypoint.id].drawCalls) / naive) * 100).toFixed(1),
    )
  }
}

function resultNaive(id, runs) {
  const values = runs.map((run) => run[id]?.naiveDrawCalls).filter((value) => typeof value === 'number')
  return values.length > 0 ? median(values) : null
}

for (const id of cullingWaypoints) {
  const drop = result[id]?.cullingDropPercent
  if (typeof drop === 'number' && drop < budget.minCullingDropPercent) {
    failures.push(`${id}: culling drop ${drop}% < ${budget.minCullingDropPercent}%`)
  }
}

const summary = {
  capturedAt: new Date().toISOString(),
  runs: RUNS,
  samplesPerPoint: SAMPLES,
  environment: { backend: 'webgl', note: 'Chromium headless, software rasterizer (SwiftShader)' },
  waypoints: result,
}

mkdirSync(join(root, 'perf'), { recursive: true })
writeFileSync(join(root, 'perf/results.json'), JSON.stringify(summary, null, 2) + '\n')

const baselinePath = join(root, 'perf/baseline.json')
for (const [id, metrics] of Object.entries(result)) {
  if (metrics.fps < budget.minFps) failures.push(`${id}: fps ${metrics.fps} < ${budget.minFps}`)
  if (metrics.drawCalls > budget.maxDrawCalls) failures.push(`${id}: drawCalls ${metrics.drawCalls} > ${budget.maxDrawCalls}`)
  if (!update && existsSync(baselinePath)) {
    const baseline = JSON.parse(readFileSync(baselinePath, 'utf8')).waypoints[id]
    if (baseline?.fps) {
      const drop = ((baseline.fps - metrics.fps) / baseline.fps) * 100
      if (drop > budget.regressionPercent) {
        failures.push(`${id}: fps regressed ${drop.toFixed(1)}% > ${budget.regressionPercent}%`)
      }
    }
    if (baseline?.drawCalls) {
      const growth = ((metrics.drawCalls - baseline.drawCalls) / baseline.drawCalls) * 100
      if (growth > budget.regressionPercent) {
        failures.push(`${id}: drawCalls grew ${growth.toFixed(1)}% > ${budget.regressionPercent}%`)
      }
    }
  }
}

if (update) {
  writeFileSync(baselinePath, JSON.stringify(summary, null, 2) + '\n')
  console.info(`perf baseline written for ${Object.keys(result).length} waypoints`)
} else if (!existsSync(baselinePath)) {
  console.warn('no perf baseline yet; run npm run perf:update')
}

if (failures.length > 0) {
  console.error('performance check failed:')
  for (const failure of failures) console.error(`  ${failure}`)
  process.exit(1)
}
console.info('performance check: ok')
