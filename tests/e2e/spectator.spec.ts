import { expect, test } from '@playwright/test'

test('spectator mode is read-only and can be revoked by the collector host', async ({ page }) => {
  await page.goto('/?spectator=1')
  await page.waitForFunction(
    () => Boolean((window as unknown as { __atrium?: unknown }).__atrium),
    null,
    { timeout: 45_000 },
  )
  await expect.poll(async () => {
    const state = await page.evaluate(
      () => (window as unknown as { __atrium: { getDebugState: () => { connection: string } } }).__atrium.getDebugState(),
    )
    return state.connection
  }, { timeout: 20_000 }).toBe('live')

  const spectator = await page.evaluate(
    () => (window as unknown as { __atrium: { getDebugState: () => { spectator: boolean; pointerLocked: boolean } } }).__atrium.getDebugState(),
  )
  expect(spectator.spectator).toBe(true)
  expect(spectator.pointerLocked).toBe(false)

  // Host revokes spectators; the client must lose the live stream.
  const response = await page.evaluate(async () => {
    const res = await fetch('http://127.0.0.1:8787/spectate/revoke', {
      method: 'POST',
      headers: { 'x-atrium-admin-token': 'test-admin' },
    })
    return { status: res.status, body: await res.json() }
  })
  expect(response.status).toBe(200)
  expect(response.body.revoked).toBeGreaterThanOrEqual(1)

  await expect.poll(async () => {
    const state = await page.evaluate(
      () => (window as unknown as { __atrium: { getDebugState: () => { connection: string } } }).__atrium.getDebugState(),
    )
    return state.connection
  }, { timeout: 15_000 }).toBe('offline')
})
