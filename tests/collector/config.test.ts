import { describe, expect, it } from 'vitest'
import { ConfigError, loadConfig } from '../../collector/config.js'

describe('collector config', () => {
  it('uses documented defaults', () => {
    const config = loadConfig({})
    expect(config.port).toBe(8787)
    expect(config.source).toBe('fake')
    expect(config.stateHz).toBe(8)
    expect(config.fakeAgents).toBe(50)
    expect(config.llamaUrls).toEqual(['http://127.0.0.1:18150'])
    expect(config.adminToken).toBeNull()
  })

  it('parses multiple llama runtimes and strips trailing slashes from the hub', () => {
    const config = loadConfig({
      ATRIUM_LLAMA_URLS: 'http://127.0.0.1:18150, http://127.0.0.1:18151/',
      ATRIUM_HUB_URL: 'http://127.0.0.1:5000/',
      ATRIUM_SOURCE: 'live',
    })
    expect(config.llamaUrls).toHaveLength(2)
    expect(config.hubUrl).toBe('http://127.0.0.1:5000')
    expect(config.source).toBe('live')
  })

  it('rejects an unknown source instead of silently falling back', () => {
    expect(() => loadConfig({ ATRIUM_SOURCE: 'maybe' })).toThrow(ConfigError)
  })

  it('rejects out-of-range ports and rates', () => {
    expect(() => loadConfig({ ATRIUM_COLLECTOR_PORT: '0' })).toThrow(/port/i)
    expect(() => loadConfig({ ATRIUM_STATE_HZ: '99' })).toThrow(/STATE_HZ/)
  })
})
