import { expect, test } from '@playwright/test'

interface DebugState {
  source: string
  connection: string
  agents: number
  tick: number
  backend: string
  pointerLocked: boolean
  position: { x: number; y: number; z: number }
}

test('boots into a walkable, labelled fake source', async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))

  await page.goto('/')
  await expect(page.locator('#atrium-canvas')).toBeVisible()

  const read = async (): Promise<DebugState> =>
    page.evaluate(
      () => (window as unknown as { __atrium: { getDebugState: () => DebugState } }).__atrium.getDebugState(),
    )

  await expect
    .poll(async () => (await read()).agents, { timeout: 30_000 })
    .toBe(50)
  const first = await read()
  expect(first.source).toBe('fake')
  expect(['webgpu', 'webgl']).toContain(first.backend)

  await page.waitForTimeout(800)
  const second = await read()
  expect(second.tick).toBeGreaterThan(first.tick)
  expect(second.position.y).toBeGreaterThan(0)

  // Walk forward: the camera must move and stay finite.
  await page.keyboard.down('KeyW')
  await page.waitForTimeout(900)
  await page.keyboard.up('KeyW')
  const afterWalk = await read()
  expect(afterWalk.position.z).toBeLessThan(second.position.z)
  expect(Number.isFinite(afterWalk.position.y)).toBe(true)
  expect(afterWalk.position.y).toBeGreaterThan(0)

  await page.screenshot({ path: 'test-results/atrium.png', animations: 'disabled' })
  expect(errors).toEqual([])
})
