import { createServer, type Server } from 'node:http'
import { afterEach, describe, expect, it } from 'vitest'
import { loadProxyConfig } from '../../proxy/config.js'
import { createProxy } from '../../proxy/server.js'

const ORDER: string[] = []
let upstream: Server | null = null
let proxy: ReturnType<typeof createProxy> | null = null

function startUpstream(port: number): Promise<void> {
  return new Promise((resolve) => {
    upstream = createServer((request, response) => {
      const chunks: Buffer[] = []
      request.on('data', (chunk) => chunks.push(Buffer.from(chunk)))
      request.on('end', () => {
        const body = Buffer.concat(chunks).toString('utf8')
        ORDER.push(body)
        setTimeout(() => {
          response.writeHead(200, { 'Content-Type': 'application/json' })
          response.end(JSON.stringify({ echo: body }))
        }, 120)
      })
    })
    upstream.listen(port, '127.0.0.1', () => resolve())
  })
}

function post(url: string, prompt: string): Promise<string> {
  return fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: prompt,
  }).then(async (response) => {
    const payload = (await response.json()) as { echo: string }
    return payload.echo
  })
}

afterEach(async () => {
  await proxy?.close()
  proxy = null
  await new Promise<void>((resolve) => {
    if (upstream) upstream.close(() => resolve())
    else resolve()
  })
  upstream = null
  ORDER.length = 0
})

describe('llm proxy', () => {
  it('sends queued interactive requests ahead of background requests', async () => {
    await startUpstream(11590)
    proxy = createProxy({
      host: '127.0.0.1',
      port: 11591,
      interactivePort: 11592,
      upstream: 'http://127.0.0.1:11590',
      maxConcurrent: 1,
      maxQueue: 10,
      timeoutMs: 5000,
    })
    const urls = await proxy.ready

    const first = post(`${urls.batch}/v1/chat/completions`, 'bg1')
    await new Promise((resolve) => setTimeout(resolve, 20))
    const second = post(`${urls.batch}/v1/chat/completions`, 'bg2')
    const interactive = post(`${urls.interactive}/v1/chat/completions`, 'int')

    await Promise.all([first, second, interactive])
    expect(ORDER).toEqual(['bg1', 'int', 'bg2'])
  })

  it('exposes health and stats endpoints', async () => {
    await startUpstream(11593)
    proxy = createProxy({
      host: '127.0.0.1',
      port: 11594,
      interactivePort: 11595,
      upstream: 'http://127.0.0.1:11593',
      maxConcurrent: 1,
      maxQueue: 10,
      timeoutMs: 5000,
    })
    const urls = await proxy.ready
    await post(`${urls.batch}/health`, 'x')
    const health = await fetch(`${urls.batch}/__proxy/health`)
    expect(health.status).toBe(200)
    const stats = (await (await fetch(`${urls.batch}/__proxy/stats`)).json()) as { servedBackground: number }
    expect(stats.servedBackground).toBe(1)
  })
})

describe('proxy config', () => {
  it('uses defaults and rejects identical ports', () => {
    const config = loadProxyConfig({})
    expect(config.maxConcurrent).toBe(1)
    expect(config.upstream).toBe('http://127.0.0.1:11434')
    expect(() =>
      loadProxyConfig({ ATRIUM_PROXY_PORT: '11500', ATRIUM_PROXY_INTERACTIVE_PORT: '11500' }),
    ).toThrow(/differ/)
  })
})
