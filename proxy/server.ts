import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import { RequestScheduler, type Priority } from './scheduler.js'

export interface ProxyConfig {
  host: string
  port: number
  interactivePort: number
  upstream: string
  maxConcurrent: number
  maxQueue: number
  timeoutMs: number
}

interface RunningProxy {
  ready: Promise<{ batch: string; interactive: string }>
  close: () => Promise<void>
  stats: () => ReturnType<RequestScheduler['stats']> & { upstreamErrors: number }
}

const HOP_BY_HOP = new Set([
  'host',
  'connection',
  'keep-alive',
  'proxy-authenticate',
  'proxy-authorization',
  'te',
  'trailer',
  'transfer-encoding',
  'upgrade',
  'content-length',
  'accept-encoding',
  'x-atrium-priority',
])

async function readBody(request: IncomingMessage, limitBytes = 32 * 1024 * 1024): Promise<Buffer> {
  const chunks: Buffer[] = []
  let size = 0
  for await (const chunk of request) {
    const buffer = Buffer.from(chunk)
    size += buffer.length
    if (size > limitBytes) throw new Error('request_body_too_large')
    chunks.push(buffer)
  }
  return Buffer.concat(chunks)
}

function sendJson(response: ServerResponse, status: number, payload: unknown): void {
  const body = JSON.stringify(payload)
  response.writeHead(status, {
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(body),
    'Access-Control-Allow-Origin': '*',
    'Cache-Control': 'no-store',
  })
  response.end(body)
}

export function createProxy(config: ProxyConfig): RunningProxy {
  const scheduler = new RequestScheduler({
    maxConcurrent: config.maxConcurrent,
    maxQueue: config.maxQueue,
  })
  let upstreamErrors = 0
  const servers: Server[] = []

  const handler = (priorityForPort: Priority) => {
    return (request: IncomingMessage, response: ServerResponse): void => {
      const url = new URL(request.url ?? '/', `http://${request.headers.host ?? 'localhost'}`)

      if (url.pathname === '/__proxy/health') {
        sendJson(response, 200, { status: 'ok', upstream: config.upstream })
        return
      }
      if (url.pathname === '/__proxy/stats') {
        sendJson(response, 200, { ...scheduler.stats(), upstreamErrors })
        return
      }

      const headerPriority = String(request.headers['x-atrium-priority'] ?? '').toLowerCase()
      const priority: Priority =
        priorityForPort === 'interactive' || headerPriority === 'interactive' ? 'interactive' : 'background'

      void (async () => {
        let body: Buffer
        try {
          body = await readBody(request)
        } catch (error) {
          sendJson(response, 413, { error: (error as Error).message })
          return
        }

        const abort = new AbortController()
        response.on('close', () => {
          if (!response.writableEnded) abort.abort()
        })
        const headers: Record<string, string> = {}
        for (const [key, value] of Object.entries(request.headers)) {
          if (HOP_BY_HOP.has(key.toLowerCase()) || value === undefined) continue
          headers[key] = Array.isArray(value) ? value.join(', ') : String(value)
        }
        headers['content-length'] = String(body.length)

        try {
          await scheduler.enqueue(
            priority,
            async () => {
              const timeout = AbortSignal.timeout(config.timeoutMs)
              const signal = AbortSignal.any([abort.signal, timeout])
              const upstream = await fetch(`${config.upstream}${url.pathname}${url.search}`, {
                method: request.method ?? 'GET',
                headers,
                ...(body.length > 0 ? { body: body as unknown as BodyInit } : {}),
                signal,
              })
              const responseHeaders: Record<string, string> = {}
              upstream.headers.forEach((value, key) => {
                if (['content-length', 'content-encoding', 'transfer-encoding', 'connection'].includes(key)) return
                responseHeaders[key] = value
              })
              response.writeHead(upstream.status, responseHeaders)
              if (upstream.body) {
                const reader = upstream.body.getReader()
                for (;;) {
                  const { value, done } = await reader.read()
                  if (done || abort.signal.aborted) break
                  if (value) response.write(Buffer.from(value))
                }
              }
              response.end()
            },
            abort.signal,
          )
        } catch (error) {
          upstreamErrors += 1
          if (!response.headersSent) {
            const message = (error as Error).message
            const status = message.includes('queue is full') ? 503 : message.includes('aborted') ? 499 : 502
            sendJson(response, status, { error: 'proxy_upstream_error', message })
          } else {
            response.end()
          }
        }
      })()
    }
  }

  const batchServer = createServer(handler('background'))
  const interactiveServer = createServer(handler('interactive'))
  servers.push(batchServer, interactiveServer)

  const ready = new Promise<{ batch: string; interactive: string }>((resolve) => {
    let listening = 0
    const onListening = (): void => {
      listening += 1
      if (listening < 2) return
      resolve({
        batch: `http://${config.host}:${config.port}`,
        interactive: `http://${config.host}:${config.interactivePort}`,
      })
    }
    batchServer.listen(config.port, config.host, onListening)
    interactiveServer.listen(config.interactivePort, config.host, onListening)
  })

  return {
    ready,
    stats: () => ({ ...scheduler.stats(), upstreamErrors }),
    close: async () => {
      await Promise.all(
        servers.map(
          (server) =>
            new Promise<void>((resolve, reject) => {
              server.close((error) => (error ? reject(error) : resolve()))
            }),
        ),
      )
    },
  }
}
