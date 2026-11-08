export type Language = 'en' | 'de'
export type Quality = 'low' | 'medium' | 'high'
export type TouchMode = 'auto' | 'on' | 'off'
export type KeyAction = 'forward' | 'back' | 'left' | 'right' | 'run'

export interface Settings {
  version: 1
  language: Language
  quality: Quality
  uiScale: number
  reducedMotion: boolean
  colorBlindSafe: boolean
  mouseSensitivity: number
  invertMouseX: boolean
  invertMouseY: boolean
  audio: { master: number; ambience: number; effects: number }
  collectorUrl: string
  touchControls: TouchMode
  keymap: Record<KeyAction, string>
}

export const DEFAULT_SETTINGS: Settings = {
  version: 1,
  language: 'en',
  quality: 'high',
  uiScale: 1,
  reducedMotion: false,
  colorBlindSafe: false,
  mouseSensitivity: 0.0022,
  invertMouseX: false,
  invertMouseY: false,
  audio: { master: 0.8, ambience: 0.5, effects: 0.7 },
  collectorUrl: 'ws://127.0.0.1:8787/stream',
  touchControls: 'auto',
  keymap: {
    forward: 'KeyW',
    back: 'KeyS',
    left: 'KeyA',
    right: 'KeyD',
    run: 'ShiftLeft',
  },
}

export const SETTINGS_KEY = 'ananta-atrium.settings.v1'

export interface StorageLike {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
  removeItem(key: string): void
}

function clamp(value: number, min: number, max: number, fallback: number): number {
  if (!Number.isFinite(value)) return fallback
  return Math.min(max, Math.max(min, value))
}

function asLanguage(value: unknown): Language {
  return value === 'de' ? 'de' : 'en'
}

function asQuality(value: unknown): Quality {
  return value === 'low' || value === 'medium' || value === 'high' ? value : 'high'
}

function asTouch(value: unknown): TouchMode {
  return value === 'on' || value === 'off' || value === 'auto' ? value : 'auto'
}

/** Invalid persisted values fall back per field; never throws. */
export function sanitizeSettings(raw: unknown): Settings {
  if (typeof raw !== 'object' || raw === null) return structuredClone(DEFAULT_SETTINGS)
  const value = raw as Record<string, unknown>
  const audio = (typeof value.audio === 'object' && value.audio !== null ? value.audio : {}) as Record<string, unknown>
  const keymapRaw = (
    typeof value.keymap === 'object' && value.keymap !== null ? value.keymap : {}
  ) as Record<string, unknown>
  const keymap = { ...DEFAULT_SETTINGS.keymap }
  for (const action of Object.keys(keymap) as KeyAction[]) {
    const candidate = keymapRaw[action]
    if (typeof candidate === 'string' && /^[A-Za-z0-9]{2,24}$/.test(candidate)) keymap[action] = candidate
  }
  return {
    version: 1,
    language: asLanguage(value.language),
    quality: asQuality(value.quality),
    uiScale: clamp(Number(value.uiScale ?? 1), 0.8, 1.6, 1),
    reducedMotion: value.reducedMotion === true,
    colorBlindSafe: value.colorBlindSafe === true,
    mouseSensitivity: clamp(Number(value.mouseSensitivity ?? DEFAULT_SETTINGS.mouseSensitivity), 0.0005, 0.006, DEFAULT_SETTINGS.mouseSensitivity),
    invertMouseX: value.invertMouseX === true,
    invertMouseY: value.invertMouseY === true,
    audio: {
      master: clamp(Number(audio.master ?? 0.8), 0, 1, 0.8),
      ambience: clamp(Number(audio.ambience ?? 0.5), 0, 1, 0.5),
      effects: clamp(Number(audio.effects ?? 0.7), 0, 1, 0.7),
    },
    collectorUrl:
      typeof value.collectorUrl === 'string' && /^wss?:\/\//.test(value.collectorUrl)
        ? value.collectorUrl
        : DEFAULT_SETTINGS.collectorUrl,
    touchControls: asTouch(value.touchControls),
    keymap,
  }
}

export function loadSettings(storage: StorageLike | null): Settings {
  if (!storage) return structuredClone(DEFAULT_SETTINGS)
  try {
    const raw = storage.getItem(SETTINGS_KEY)
    if (!raw) return structuredClone(DEFAULT_SETTINGS)
    return sanitizeSettings(JSON.parse(raw))
  } catch (error) {
    console.warn('invalid stored settings, using defaults', error)
    return structuredClone(DEFAULT_SETTINGS)
  }
}

export function saveSettings(storage: StorageLike | null, settings: Settings): void {
  if (!storage) return
  try {
    storage.setItem(SETTINGS_KEY, JSON.stringify(settings))
  } catch (error) {
    console.warn('could not persist settings', error)
  }
}

export function resetSettings(storage: StorageLike | null): Settings {
  storage?.removeItem(SETTINGS_KEY)
  return structuredClone(DEFAULT_SETTINGS)
}
