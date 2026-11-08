import { readFileSync } from 'node:fs'

export type CollectorSource = 'fake' | 'live'

export interface CollectorConfig {
  host: string
  port: number
  source: CollectorSource
  hubUrl: string
  hubToken: string | null
  adminToken: string | null
  llamaUrls: string[]
  stateHz: number
  fakeAgents: number
  pollMs: number
  staleAfterMs: number
  traceEnabled: boolean
  chatStateFile: string
}

export class ConfigError extends Error {}

function int(raw: string | undefined, fallback: number, name: string, min: number, max: number): number {
  if (raw === undefined || raw.trim() === '') return fallback
  const value = Number(raw)
  if (!Number.isInteger(value) || value < min || value > max) {
    throw new ConfigError(`${name} must be an integer between ${min} and ${max}`)
  }
  return value
}

function readToken(env: NodeJS.ProcessEnv): string | null {
  const direct = env.ATRIUM_HUB_TOKEN?.trim()
  if (direct) return direct
  const file = env.ATRIUM_HUB_TOKEN_FILE?.trim()
  if (file) {
    try {
      return readFileSync(file, 'utf8').trim()
    } catch (error) {
      throw new ConfigError(`cannot read ATRIUM_HUB_TOKEN_FILE: ${(error as Error).message}`)
    }
  }
  return null
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): CollectorConfig {
  const source = (env.ATRIUM_SOURCE ?? 'fake').trim().toLowerCase()
  if (source !== 'fake' && source !== 'live') {
    throw new ConfigError('ATRIUM_SOURCE must be "fake" or "live"')
  }
  const llamaUrls = (env.ATRIUM_LLAMA_URLS ?? 'http://127.0.0.1:18150')
    .split(',')
    .map((value) => value.trim())
    .filter((value) => value.length > 0)

  return {
    host: env.ATRIUM_COLLECTOR_HOST?.trim() || '127.0.0.1',
    port: int(env.ATRIUM_COLLECTOR_PORT, 8787, 'ATRIUM_COLLECTOR_PORT', 1, 65535),
    source,
    hubUrl: (env.ATRIUM_HUB_URL ?? 'http://127.0.0.1:5000').replace(/\/+$/, ''),
    hubToken: readToken(env),
    adminToken: env.ATRIUM_ADMIN_TOKEN?.trim() || null,
    llamaUrls,
    stateHz: int(env.ATRIUM_STATE_HZ, 8, 'ATRIUM_STATE_HZ', 1, 30),
    fakeAgents: int(env.ATRIUM_FAKE_AGENTS, 50, 'ATRIUM_FAKE_AGENTS', 1, 200),
    pollMs: int(env.ATRIUM_POLL_MS, 1000, 'ATRIUM_POLL_MS', 200, 60_000),
    staleAfterMs: int(env.ATRIUM_STALE_AFTER_MS, 15_000, 'ATRIUM_STALE_AFTER_MS', 1000, 600_000),
    traceEnabled: (env.ATRIUM_TRACE ?? '1') !== '0',
    chatStateFile: env.ATRIUM_CHAT_STATE_FILE?.trim() || '.atrium-chat-state.json',
  }
}
