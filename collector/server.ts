import { createServer, type Server } from 'node:http'
import { WebSocket, WebSocketServer } from 'ws'
import type { AgentSnapshot, AgentState } from '../src/shared/agent-state.js'
import { AGENT_STATE_SCHEMA_VERSION } from '../src/shared/agent-state.js'
import type { CollectorConfig } from './config.js'
import { log } from './logger.js'

export interface HealthReport {
  status: 'ok' | 'degraded'
  version: string
  source: CollectorConfig['source']
  agents: number
  uptimeSeconds: number
  lastSuccessfulPoll: string | null
  upstreams: {
    hub: { url: string; reachable: boolean; lastError: string | null; lastSuccessAt: string | null }
    llama: Array<{ url: string; reachable: boolean; lastError: string | null; tokensPerSecond: number }>
  }
}

export interface CollectorServerOptions {
  config: CollectorConfig
  getAgents: () => AgentState[]
  getHealth: () => HealthReport
}

export interface RunningCollector {
  /** Resolves with the WebSocket URL once the HTTP server is listening. */
  ready: Promise<string>
  close: () => Promise<void>
}

export function startCollectorServer(options: CollectorServerOptions): RunningCollector {
  const { config, getAgents, getHealth } = options
  let clients = 0

  const server: Server = createServer((request, response) => {
    if (request.method === 'OPTIONS') {
      response.writeHead(204, {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
        'Access-Control-Allow-Headers': 'content-type, x-atrium-admin-token',
        'Access-Control-Max-Age': '600',
      })
      response.end()
      return
    }
    const url = new URL(request.url ?? '/', `http://${request.headers.host ?? 'localhost'}`)
    const send = (status: number, payload: unknown): void => {
      const body = JSON.stringify(payload, null, 2)
      response.writeHead(status, {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body),
        'Access-Control-Allow-Origin': '*',
        'Cache-Control': 'no-store',
      })
      response.end(body)
    }

    if (url.pathname === '/health') {
      const health = getHealth()
      send(health.status === 'ok' ? 200 : 503, { ...health, clients, spectators: spectators.size })
      return
    }
    if (url.pathname === '/spectate/revoke' && request.method === 'POST') {
      if (!config.adminToken) {
        send(403, { error: 'admin_token_not_configured' })
        return
      }
      if (request.headers['x-atrium-admin-token'] !== config.adminToken) {
        send(401, { error: 'unauthorized' })
        return
      }
      spectatorsBlocked = true
      let revoked = 0
      for (const socket of spectators) {
        socket.close(4001, 'spectator revoked')
        spectators.delete(socket)
        revoked += 1
      }
      send(200, { revoked, blocked: true })
      return
    }
    if (url.pathname === '/spectate/allow' && request.method === 'POST') {
      if (!config.adminToken) {
        send(403, { error: 'admin_token_not_configured' })
        return
      }
      if (request.headers['x-atrium-admin-token'] !== config.adminToken) {
        send(401, { error: 'unauthorized' })
        return
      }
      spectatorsBlocked = false
      send(200, { allowed: true })
      return
    }
    if (url.pathname === '/spectate/status') {
      send(200, { spectators: spectators.size, blocked: spectatorsBlocked })
      return
    }
    if (url.pathname === '/') {
      send(200, {
        name: 'ananta-atrium-collector',
        version: '0.1.0',
        stream: `ws://${config.host}:${config.port}/stream`,
        health: `http://${config.host}:${config.port}/health`,
      })
      return
    }
    send(404, { error: 'not_found' })
  })

  const wss = new WebSocketServer({ server, path: '/stream' })
  const spectators = new Set<WebSocket>()
  let spectatorsBlocked = false

  const snapshot = (): AgentSnapshot => ({
    schemaVersion: AGENT_STATE_SCHEMA_VERSION,
    generatedAt: new Date().toISOString(),
    source: config.source,
    agents: getAgents(),
  })

  wss.on('connection', (socket: WebSocket, request) => {
    clients += 1
    const url = new URL(request.url ?? '/', 'http://localhost')
    if (url.searchParams.get('spectator') === '1') {
      if (spectatorsBlocked) {
        socket.close(4001, 'spectator access revoked')
        clients = Math.max(0, clients - 1)
        return
      }
      spectators.add(socket)
    }
    socket.send(JSON.stringify({ type: 'snapshot', snapshot: snapshot() }))
    socket.on('close', () => {
      clients = Math.max(0, clients - 1)
      spectators.delete(socket)
    })
    socket.on('error', () => {
      socket.terminate()
    })
  })

  let lastSent = new Map<string, string>()
  const broadcast = (): void => {
    const agents = getAgents()
    if (wss.clients.size === 0) {
      lastSent = new Map(agents.map((agent) => [agent.id, JSON.stringify(agent)]))
      return
    }
    const nextSent = new Map<string, string>()
    const upserts: AgentState[] = []
    for (const agent of agents) {
      const encoded = JSON.stringify(agent)
      nextSent.set(agent.id, encoded)
      if (lastSent.get(agent.id) !== encoded) upserts.push(agent)
    }
    const removed = [...lastSent.keys()].filter((id) => !nextSent.has(id))
    lastSent = nextSent

    const messages: string[] = []
    if (upserts.length > 0) messages.push(JSON.stringify({ type: 'upsert', agents: upserts }))
    if (removed.length > 0) messages.push(JSON.stringify({ type: 'remove', ids: removed }))
    for (const message of messages) {
      for (const socket of wss.clients) {
        if (socket.readyState !== WebSocket.OPEN) continue
        // Backpressure: never queue unbounded data for a slow client.
        if (socket.bufferedAmount > 1_000_000) continue
        socket.send(message)
      }
    }
  }

  const broadcastTimer = setInterval(broadcast, Math.round(1000 / config.stateHz))
  const heartbeatTimer = setInterval(() => {
    const message = JSON.stringify({ type: 'heartbeat', at: new Date().toISOString() })
    for (const socket of wss.clients) {
      if (socket.readyState === WebSocket.OPEN) socket.send(message)
    }
  }, 10_000)

  const ready = new Promise<string>((resolve) => {
    server.listen(config.port, config.host, () => {
      const address = server.address()
      const port = typeof address === 'object' && address ? address.port : config.port
      log('info', 'collector listening', { host: config.host, port, source: config.source })
      resolve(`ws://${config.host}:${port}/stream`)
    })
  })

  return {
    ready,
    close: async () => {
      clearInterval(broadcastTimer)
      clearInterval(heartbeatTimer)
      for (const socket of wss.clients) socket.close()
      await new Promise<void>((resolve) => wss.close(() => resolve()))
      await new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()))
      })
    },
  }
}
