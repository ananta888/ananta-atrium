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

async function openDemo(page: Page): Promise<void> {
  await page.goto('/')
  await page.getByRole('button', { name: 'Enter demo mode' }).click()
  await page.waitForFunction(() => window.__atrium?.getDebugState().agents === 50)
}

test('menu opens the demo scene and the agent list filters by status', async ({ page }) => {
  await page.goto('/')
  await expect(page.getByRole('button', { name: 'Enter demo mode' })).toBeVisible()
  expect((await debug(page)).menuVisible).toBe(true)

  await page.getByRole('button', { name: 'Enter demo mode' }).click()
  expect((await debug(page)).menuVisible).toBe(false)

  await page.keyboard.press('KeyL')
  await expect(page.locator('.ui-panel')).toBeVisible()
  const countBefore = await page.locator('.ui-agent').count()
  expect(countBefore).toBeGreaterThan(10)
  await page.getByLabel('Status').selectOption('working')
  const filtered = await page.locator('.ui-agent').count()
  expect(filtered).toBeLessThanOrEqual(countBefore)
  await page.keyboard.press('KeyL')
})

test('agent detail shows trace, budget, diff and a desk monitor', async ({ page }) => {
  await openDemo(page)
  await page.keyboard.press('KeyL')
  await page.locator('.ui-agent').first().evaluate((node) => (node as HTMLButtonElement).click())
  await expect(page.locator('.ui-detail')).toBeVisible()
  await expect(page.getByText(/Time budget|Zeitbudget/)).toBeVisible()
  await expect(page.getByText(/Attempts|Versuche/)).toBeVisible()
  expect(await page.locator('.ui-meter').count()).toBeGreaterThanOrEqual(2)
  expect((await page.locator('.ui-pre').innerText()).length).toBeGreaterThan(20)
  await expect(page.getByPlaceholder('Message…')).toBeVisible()
  await page.waitForTimeout(600)
  const monitor = await page.evaluate(() => {
    const session = window.__atrium as unknown as {
      render: { scene: { getMeshByName: (name: string) => { isEnabled: () => boolean } | null } }
    }
    return session.render.scene.getMeshByName('focused-monitor-plane')?.isEnabled() ?? false
  })
  expect(monitor).toBe(true)
})

test('replay records frames, scrubs and returns live', async ({ page }) => {
  await openDemo(page)
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
})

test('settings apply, translate and reset', async ({ page }) => {
  await openDemo(page)
  await page.getByRole('button', { name: 'Settings' }).click()
  const card = page.locator('.ui-settings-card')
  await expect(card.getByLabel('Language')).toBeVisible()

  await card.getByLabel('Language').selectOption('de')
  expect((await debug(page)).settings.language).toBe('de')
  await expect(page.getByRole('heading', { name: 'Einstellungen' })).toBeVisible()

  await page.locator('.ui-settings-card').getByLabel('UI-Skalierung').fill('1.3')
  expect((await debug(page)).settings.uiScale).toBeCloseTo(1.3)
  await page.locator('.ui-settings-card').getByLabel('Bewegung reduzieren').check()
  expect((await debug(page)).settings.reducedMotion).toBe(true)

  await page
    .locator('.ui-settings-card')
    .getByRole('button', { name: 'Auf Standard zurücksetzen' })
    .evaluate((node) => (node as HTMLButtonElement).click())
  expect((await debug(page)).settings.language).toBe('en')
  await page
    .locator('.ui-settings-card')
    .getByRole('button', { name: 'Close' })
    .evaluate((node) => (node as HTMLButtonElement).click())
})

test('settings persist across a reload', async ({ page }) => {
  await openDemo(page)
  await page.getByRole('button', { name: 'Settings' }).click()
  await page.locator('.ui-settings-card').getByLabel('Graphics quality').selectOption('low')
  await page
    .locator('.ui-settings-card')
    .getByRole('button', { name: 'Close' })
    .evaluate((node) => (node as HTMLButtonElement).click())
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
  await page.keyboard.down('KeyW')
  await page.waitForTimeout(600)
  await page.keyboard.up('KeyW')
  expect((await debug(page)).tick).toBeGreaterThan(0)
})

test.describe('touch', () => {
  test.use({ hasTouch: true, isMobile: true, viewport: { width: 390, height: 844 } })

  test('shows touch controls on coarse pointers and resets on hide', async ({ page }) => {
    await openDemo(page)
    expect((await debug(page)).touchEnabled).toBe(true)
    await expect(page.locator('.touch-controls')).toBeVisible()
    const stick = page.locator('[data-touch-stick]')
    const box = await stick.boundingBox()
    expect(box).not.toBeNull()
    if (box) await page.touchscreen.tap(box.x + box.width / 2, box.y + box.height / 2)
    await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')))
    expect((await debug(page)).touchEnabled).toBe(true)
  })
})
