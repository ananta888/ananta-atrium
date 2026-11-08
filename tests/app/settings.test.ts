import { describe, expect, it, vi } from 'vitest'
import {
  DEFAULT_SETTINGS,
  SETTINGS_KEY,
  loadSettings,
  resetSettings,
  sanitizeSettings,
  saveSettings,
  type StorageLike,
} from '../../src/app/settings.js'

class MemoryStorage implements StorageLike {
  data = new Map<string, string>()
  getItem(key: string): string | null {
    return this.data.get(key) ?? null
  }
  setItem(key: string, value: string): void {
    this.data.set(key, value)
  }
  removeItem(key: string): void {
    this.data.delete(key)
  }
}

describe('settings', () => {
  it('returns defaults without storage', () => {
    expect(loadSettings(null)).toEqual(DEFAULT_SETTINGS)
  })

  it('round-trips through storage', () => {
    const storage = new MemoryStorage()
    const custom = { ...DEFAULT_SETTINGS, language: 'de' as const, uiScale: 1.4, quality: 'low' as const }
    saveSettings(storage, custom)
    expect(loadSettings(storage)).toEqual(custom)
  })

  it('falls back safely on invalid JSON and logs', () => {
    const storage = new MemoryStorage()
    storage.setItem(SETTINGS_KEY, '{nope')
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    expect(loadSettings(storage)).toEqual(DEFAULT_SETTINGS)
    expect(warn).toHaveBeenCalled()
    warn.mockRestore()
  })

  it('clamps numeric fields and rejects bad enum values', () => {
    const settings = sanitizeSettings({
      language: 'fr',
      quality: 'ultra',
      uiScale: 99,
      audio: { master: -4, ambience: 5, effects: 'x' },
      collectorUrl: 'http://not-a-websocket',
      keymap: { forward: 'invalid key!', back: 'ArrowDown' },
      mouseSensitivity: 99,
      invertMouseX: true,
      invertMouseY: 'yes',
    })
    expect(settings.language).toBe('en')
    expect(settings.quality).toBe('high')
    expect(settings.uiScale).toBe(1.6)
    expect(settings.audio.master).toBe(0)
    expect(settings.audio.ambience).toBe(1)
    expect(settings.audio.effects).toBe(0.7)
    expect(settings.collectorUrl).toBe(DEFAULT_SETTINGS.collectorUrl)
    expect(settings.keymap.forward).toBe('KeyW')
    expect(settings.keymap.back).toBe('ArrowDown')
    expect(settings.mouseSensitivity).toBe(0.006)
    expect(settings.invertMouseX).toBe(true)
    expect(settings.invertMouseY).toBe(false)
  })

  it('reset restores defaults and clears storage', () => {
    const storage = new MemoryStorage()
    saveSettings(storage, { ...DEFAULT_SETTINGS, uiScale: 1.2 })
    expect(resetSettings(storage)).toEqual(DEFAULT_SETTINGS)
    expect(storage.getItem(SETTINGS_KEY)).toBeNull()
  })
})
