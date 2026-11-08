export interface ProxyConfig {
  host: string
  port: number
  interactivePort: number
  upstream: string
  maxConcurrent: number
  maxQueue: number
  timeoutMs: number
}

function int(raw: string | undefined, fallback: number, name: string, min: number, max: number): number {
  if (raw === undefined || raw.trim() === '') return fallback
  const value = Number(raw)
  if (!Number.isInteger(value) || value < min || value > max) {
    throw new Error(`${name} must be an integer between ${min} and ${max}`)
  }
  return value
}

export function loadProxyConfig(env: NodeJS.ProcessEnv = process.env): ProxyConfig {
  const config: ProxyConfig = {
    host: env.ATRIUM_PROXY_HOST?.trim() || '127.0.0.1',
    port: int(env.ATRIUM_PROXY_PORT, 11500, 'ATRIUM_PROXY_PORT', 1, 65535),
    interactivePort: int(env.ATRIUM_PROXY_INTERACTIVE_PORT, 11501, 'ATRIUM_PROXY_INTERACTIVE_PORT', 1, 65535),
    upstream: (env.ATRIUM_PROXY_UPSTREAM || 'http://127.0.0.1:11434').replace(/\/+$/, ''),
    maxConcurrent: int(env.ATRIUM_PROXY_SLOTS, 1, 'ATRIUM_PROXY_SLOTS', 1, 64),
    maxQueue: int(env.ATRIUM_PROXY_QUEUE, 200, 'ATRIUM_PROXY_QUEUE', 1, 10_000),
    timeoutMs: int(env.ATRIUM_PROXY_TIMEOUT_MS, 120_000, 'ATRIUM_PROXY_TIMEOUT_MS', 1000, 600_000),
  }
  if (config.port === config.interactivePort) {
    throw new Error('ATRIUM_PROXY_PORT and ATRIUM_PROXY_INTERACTIVE_PORT must differ')
  }
  return config
}
