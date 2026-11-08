import { describe, expect, it } from 'vitest'
import { getLanguage, hasKey, localeKeys, setLanguage, statusLabel, t } from '../../src/app/i18n.js'

describe('i18n', () => {
  it('has identical key sets for English and German', () => {
    expect(localeKeys('de')).toEqual(localeKeys('en'))
    for (const key of localeKeys('en')) expect(hasKey('de', key)).toBe(true)
  })

  it('interpolates parameters', () => {
    setLanguage('en')
    expect(t('hud.stats', { count: 50, fps: 60, backend: 'webgl', tick: 12 })).toContain('50 agents')
    setLanguage('de')
    expect(t('hud.stats', { count: 50, fps: 60, backend: 'webgl', tick: 12 })).toContain('50 Agenten')
  })

  it('translates status labels and switches language', () => {
    setLanguage('en')
    expect(statusLabel('working')).toBe('Working')
    setLanguage('de')
    expect(statusLabel('working')).toBe('Arbeitet')
    expect(getLanguage()).toBe('de')
    setLanguage('en')
  })

  it('falls back to the key for unknown entries', () => {
    expect(t('does.not.exist')).toBe('does.not.exist')
  })
})
