#!/usr/bin/env node
/** Regenerates the README screenshots from the current build. */
import { mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from '@playwright/test'
import { createServer } from 'vite'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const outDir = join(root, 'docs/screenshots')
mkdirSync(outDir, { recursive: true })

const server = await createServer({ root, logLevel: 'error', server: { port: 5190, strictPort: true } })
await server.listen()
const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })

try {
  await page.goto('http://127.0.0.1:5190/', { waitUntil: 'domcontentloaded' })
  await page.getByRole('button', { name: 'Enter demo mode' }).waitFor()
  await page.waitForTimeout(800)
  await page.screenshot({ path: join(outDir, 'menu.png') })

  await page.getByRole('button', { name: 'Enter demo mode' }).click()
  await page.waitForFunction(() => window.__atrium?.getDebugState().agents === 50)
  await page.waitForTimeout(1200)
  await page.screenshot({ path: join(outDir, 'plaza.png') })

  await page.evaluate(() => window.__atrium.debugTeleport(-28, 1.75, 4))
  await page.waitForTimeout(1200)
  await page.screenshot({ path: join(outDir, 'lobby.png') })

  await page.evaluate(() => window.__atrium.debugTeleport(-35, 1.75, 4))
  await page.waitForTimeout(1200)
  await page.screenshot({ path: join(outDir, 'office.png') })

  await page.evaluate(() => window.__atrium.debugTeleport(-28, 5.75, 4))
  await page.waitForTimeout(1200)
  await page.screenshot({ path: join(outDir, 'floor-1.png') })

  await page.evaluate(() => {
    const session = window.__atrium
    const agents = session.sim.snapshot('fake')
    const agent = agents.find((item) => item.position)
    if (!agent) return
    agent.position = { x: 4, y: 0, z: 20 }
    session.sim.applyLiveAgents([agent])
    const view = session.avatars.views.get(agent.id)
    if (view) view.root.rotation.y = 0
    session.debugPause(true)
    session.debugTeleport(4, 1.65, 23)
    session.debugFace(Math.PI)
  })
  await page.waitForTimeout(1400)
  await page.screenshot({ path: join(outDir, 'avatars.png') })
  await page.evaluate(() => window.__atrium.debugPause(false))

  await page.evaluate(() => window.__atrium.debugTeleport(4, 1.8, 30))
  await page.keyboard.press('KeyL')
  await page.waitForTimeout(700)
  await page.screenshot({ path: join(outDir, 'agents.png') })
} finally {
  await browser.close()
  await server.close()
}
console.info('screenshots written to docs/screenshots')
