import { expect, test } from '@playwright/test'
import type { Page } from '@playwright/test'

interface DebugState {
  source: string
  connection: string
  agents: number
  tick: number
  menuVisible: boolean
  touchEnabled: boolean
  replay: { frames: number; duration: number; active: boolean; recording: boolean }
  settings: { language: string; uiScale: number; colorBlindSafe: boolean; reducedMotion: boolean; quality: string }
}

async function debug(page: Page): Promise<DebugState> {
  return page.evaluate(
    () => (window as unknown as { __atrium: { getDebugState: () => DebugState } }).__atrium.getDebugState(),
  )
}

test('menu, agent list, replay and settings work through the UI', async ({ page }) => {
  await page.goto('/')
  await expect(page.getByRole('button', { name: 'Enter demo mode' })).toBeVisible()
  expect((await debug(page)).menuVisible).toBe(true)

  await page.getByRole('button', { name: 'Enter demo mode' }).click()
  expect((await debug(page)).menuVisible).toBe(false)

  // Agent list with filters (L).
  await page.keyboard.press('KeyL')
  await expect(page.locator('.ui-panel')).toBeVisible()
  const countBefore = await page.locator('.ui-agent').count()
  expect(countBefore).toBeGreaterThan(10)
  await page.getByLabel('Status').selectOption('working')
  const filtered = await page.locator('.ui-agent').count()
  expect(filtered).toBeLessThanOrEqual(countBefore)
  await page.keyboard.press('KeyL')

  // Replay: record ~1.5 s, then scrub.
  await page.keyboard.press('KeyR')
  await page.getByLabel('Recorded buffer').check()
  await page.waitForTimeout(1600)
  await page.getByLabel('Recorded buffer').uncheck()
  const recorded = await debug(page)
  expect(recorded.replay.frames).toBeGreaterThan(1)
  expect(recorded.replay.duration).toBeGreaterThan(0.4)
  await page.locator('.ui-replay input[type="range"]').fill('0.2')
  expect((await debug(page)).replay.active).toBe(true)
  await page.getByRole('button', { name: 'Live' }).click()
  expect((await debug(page)).replay.active).toBe(false)

  // Settings: language, scale, reduced motion, reset.
  await page.getByRole('button', { name: 'Settings' }).first().click()
  const settingsCard = page.locator('.ui-settings-card')
  await expect(settingsCard.getByLabel('Language')).toBeVisible()
  await settingsCard.getByLabel('Language').selectOption('de')
  expect((await debug(page)).settings.language).toBe('de')
  await expect(page.getByRole('heading', { name: 'Einstellungen' })).toBeVisible()
  await page.locator('.ui-settings-card').getByLabel('UI-Skalierung').fill('1.3')
  expect((await debug(page)).settings.uiScale).toBeCloseTo(1.3)
  await page.locator('.ui-settings-card').getByLabel('Bewegung reduzieren').check()
  expect((await debug(page)).settings.reducedMotion).toBe(true)
  await page.locator('.ui-settings-card').getByRole('button', { name: 'Auf Standard zurücksetzen' }).click()
  expect((await debug(page)).settings.language).toBe('en')
  await page.locator('.ui-settings-card').getByRole('button', { name: 'Close' }).click()
})

test('settings persist across a reload', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('button', { name: 'Enter demo mode' }).click()
  await page.getByRole('button', { name: 'Settings' }).click()
  await page.locator('.ui-settings-card').getByLabel('Graphics quality').selectOption('low')
  await page.locator('.ui-settings-card').getByRole('button', { name: 'Close' }).click()
  await page.reload()
  const stored = await page.evaluate(() => localStorage.getItem('ananta-atrium.settings.v1'))
  expect(stored).toContain('"quality":"low"')
  expect((await debug(page)).settings.quality).toBe('low')
})

test('menu is keyboard operable', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('button', { name: 'Enter demo mode' }).focus()
  await page.keyboard.press('Enter')
  expect((await debug(page)).menuVisible).toBe(false)
  // The walkable scene is reachable with the keyboard only.
  await page.keyboard.down('KeyW')
  await page.waitForTimeout(600)
  await page.keyboard.up('KeyW')
  const state = await debug(page)
  expect(state.tick).toBeGreaterThan(0)
})

test.describe('touch', () => {
  test.use({ hasTouch: true, isMobile: true, viewport: { width: 390, height: 844 } })

  test('shows touch controls on coarse pointers and resets on hide', async ({ page }) => {
    await page.goto('/')
    await page.getByRole('button', { name: 'Enter demo mode' }).click()
    expect((await debug(page)).touchEnabled).toBe(true)
    await expect(page.locator('.touch-controls')).toBeVisible()
    const stick = page.locator('[data-touch-stick]')
    const box = await stick.boundingBox()
    expect(box).not.toBeNull()
    if (box) {
      await page.touchscreen.tap(box.x + box.width / 2, box.y + box.height / 2)
    }
    await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')))
    expect((await debug(page)).touchEnabled).toBe(true)
  })
})
