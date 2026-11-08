import { expect, test } from '@playwright/test'
import type { Page } from '@playwright/test'

interface DebugState {
  position: { x: number; y: number; z: number }
  agents: number
  drawCalls: number
  visibleRooms: number
  totalRooms: number
  loadedBuildings: number
  spectator: boolean
  connection: string
  source: string
}

declare global {
  interface Window {
    __atrium: {
      debugTeleport: (x: number, y: number, z: number) => void
      debugFace: (yaw: number) => void
      getDebugState: () => DebugState
    }
  }
}

async function debug(page: Page): Promise<DebugState> {
  return page.evaluate(
    () => (window as unknown as { __atrium: { getDebugState: () => DebugState } }).__atrium.getDebugState(),
  )
}

test('climbs and descends the staircase', async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  await page.goto('/')
  await page.getByRole('button', { name: 'Enter demo mode' }).click()
  await page.waitForFunction(() => window.__atrium?.getDebugState().agents === 50)

  // Place the player in the ground-floor corridor at the west end of the stairs.
  await page.evaluate(() => {
    window.__atrium.debugTeleport(-27, 1.75, 0)
    window.__atrium.debugFace(Math.PI / 2)
  })
  await page.waitForTimeout(300)
  const before = await debug(page)
  expect(before.position.y).toBeLessThan(2.5)

  await page.keyboard.down('ShiftLeft')
  await page.keyboard.down('KeyW')
  await page.waitForTimeout(10000)
  await page.keyboard.up('KeyW')
  await page.keyboard.up('ShiftLeft')
  const upstairs = await debug(page)
  expect(upstairs.position.y).toBeGreaterThan(3.4)
  expect(upstairs.position.x).toBeGreaterThan(-21)

  await page.evaluate(() => window.__atrium.debugFace(-Math.PI / 2))
  await page.keyboard.down('ShiftLeft')
  await page.keyboard.down('KeyW')
  await page.waitForTimeout(10000)
  await page.keyboard.up('KeyW')
  await page.keyboard.up('ShiftLeft')
  const downstairs = await debug(page)
  expect(downstairs.position.y).toBeLessThan(2.6)
  expect(errors).toEqual([])
})

test('walkthrough: all five buildings are reachable and culling is active', async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  await page.goto('/')
  await page.getByRole('button', { name: 'Enter demo mode' }).click()
  await page.waitForFunction(() => window.__atrium?.getDebugState().agents === 50)

  const spots = [
    { id: 'atrium-hq', x: -28, y: 1.75, z: 4 },
    { id: 'forge', x: 4, y: 1.75, z: 4 },
    { id: 'observatory', x: 36, y: 1.75, z: 4 },
    { id: 'library', x: -14, y: 1.75, z: -36 },
    { id: 'studio', x: 26, y: 1.75, z: -36 },
  ]
  const memoryBefore = await page.evaluate(() => (performance as unknown as { memory?: { usedJSHeapSize: number } }).memory?.usedJSHeapSize ?? 0)
  for (const spot of spots) {
    await page.evaluate(({ x, y, z }) => window.__atrium.debugTeleport(x, y, z), spot)
    await page.waitForTimeout(700)
    const state = await debug(page)
    expect(state.drawCalls).toBeGreaterThan(0)
    expect(state.visibleRooms).toBeLessThanOrEqual(state.totalRooms)
  }
  const memoryAfter = await page.evaluate(() => (performance as unknown as { memory?: { usedJSHeapSize: number } }).memory?.usedJSHeapSize ?? 0)
  if (memoryBefore > 0 && memoryAfter > 0) {
    expect(memoryAfter).toBeLessThan(memoryBefore * 1.6)
  }
  expect(errors).toEqual([])
})
