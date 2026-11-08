import { afterEach, describe, expect, it } from 'vitest'
import WebSocket from 'ws'
import type { AgentState } from '../../src/shared/agent-state.js'
import type { CollectorConfig } from '../../collector/config.js'
import { startCollectorServer, type RunningCollector } from '../../collector/server.js'

const config: CollectorConfig = {
  host: '127.0.0.1',
  port: 0,
  source: 'fake',
  hubUrl: 'http://127.0.0.1:5000',
  hubToken: null,
  adminToken: null,
  llamaUrls: [],
  stateHz: 20,
  fakeAgents: 1,
  pollMs: 1000,
  staleAfterMs: 15000,
  traceEnabled: true,
  chatStateFile: '.atrium-chat-state.test.json',
}

function agent(id: string): AgentState {
  return {
    schemaVersion: 1,
    id,
    name: 'Ada',
    role: 'Engineer',
    status: 'working',
    buildingId: 'atrium-hq',
    roomId: 'atrium-hq-office-a',
    deskId: 'desk-1',
    task: { title: 'Test', progress: 0.5 },
    activity: { kind: 'typing' },
    updatedAt: new Date().toISOString(),
    source: 'fake',
    stale: false,
    position: { x: 0, y: 0, z: 0 },
  }
}

let running: RunningCollector | null = null

afterEach(async () => {
  await running?.close()
  running = null
})

describe('collector server', () => {
  it('serves health and a WebSocket snapshot', async () => {
    const agents = [agent('a1')]
    running = startCollectorServer({
      config,
      getAgents: () => agents,
      getHealth: () => ({
        status: 'ok',
        version: '0.1.0',
        source: 'fake',
        agents: agents.length,
        uptimeSeconds: 1,
        lastSuccessfulPoll: new Date().toISOString(),
        upstreams: { hub: { url: config.hubUrl, reachable: false, lastError: null, lastSuccessAt: null }, llama: [] },
      }),
    })
    const wsUrl = await running.ready
    const httpUrl = wsUrl.replace('ws://', 'http://').replace('/stream', '/health')

    const response = await fetch(httpUrl)
    expect(response.status).toBe(200)
    const health = (await response.json()) as { agents: number }
    expect(health.agents).toBe(1)

    const message = await new Promise<string>((resolve, reject) => {
      const socket = new WebSocket(wsUrl)
      const timer = setTimeout(() => reject(new Error('no message')), 2000)
      socket.on('message', (data) => {
        clearTimeout(timer)
        socket.close()
        resolve(String(data))
      })
      socket.on('error', reject)
    })
    const parsed = JSON.parse(message) as { type: string; snapshot: { agents: AgentState[] } }
    expect(parsed.type).toBe('snapshot')
    expect(parsed.snapshot.agents[0]?.id).toBe('a1')
  })

  it('broadcasts deltas to 50 concurrent clients within the CPU budget', async () => {
    const agents = [agent('a1')]
    running = startCollectorServer({
      config,
      getAgents: () => agents,
      getHealth: () => ({
        status: 'ok',
        version: '0.1.0',
        source: 'fake',
        agents: agents.length,
        uptimeSeconds: 1,
        lastSuccessfulPoll: null,
        upstreams: { hub: { url: config.hubUrl, reachable: false, lastError: null, lastSuccessAt: null }, llama: [] },
      }),
    })
    const wsUrl = await running.ready
    const sockets = await Promise.all(
      Array.from({ length: 50 }, () =>
        new Promise<WebSocket>((resolve, reject) => {
          const socket = new WebSocket(wsUrl)
          socket.once('open', () => resolve(socket))
          socket.once('error', reject)
        }),
      ),
    )
    await Promise.all(sockets.map((socket) => new Promise((resolve) => socket.once('message', resolve))))

    const cpuBefore = process.cpuUsage()
    const nextMessages = Promise.all(
      sockets.map(
        (socket) =>
          new Promise<string>((resolve) => {
            socket.once('message', (data) => resolve(String(data)))
          }),
      ),
    )
    agents.push(agent('a2'))
    const messages = await nextMessages
    const cpu = process.cpuUsage(cpuBefore)
    const cpuPerClientMs = (cpu.user + cpu.system) / 1000 / sockets.length

    for (const message of messages) {
      const parsed = JSON.parse(message) as { type: string; agents?: AgentState[] }
      expect(parsed.type).toBe('upsert')
      expect(parsed.agents?.some((item) => item.id === 'a2')).toBe(true)
    }
    expect(cpuPerClientMs).toBeLessThan(5)

    for (const socket of sockets) socket.close()
  }, 20_000)

  it('revokes spectator clients with an admin token', async () => {
    running = startCollectorServer({
      config: { ...config, adminToken: 'secret' },
      getAgents: () => [],
      getHealth: () => ({
        status: 'ok',
        version: '0.1.0',
        source: 'fake',
        agents: 0,
        uptimeSeconds: 1,
        lastSuccessfulPoll: null,
        upstreams: { hub: { url: config.hubUrl, reachable: false, lastError: null, lastSuccessAt: null }, llama: [] },
      }),
    })
    const wsUrl = await running.ready
    const spectator = new WebSocket(`${wsUrl}?spectator=1`)
    const normal = new WebSocket(wsUrl)
    await Promise.all([
      new Promise((resolve) => spectator.once('open', resolve)),
      new Promise((resolve) => normal.once('open', resolve)),
    ])
    const closed = new Promise<number>((resolve) => spectator.once('close', (code) => resolve(code)))
    const base = wsUrl.replace('ws://', 'http://').replace('/stream', '')
    const denied = await fetch(`${base}/spectate/revoke`, { method: 'POST' })
    expect(denied.status).toBe(401)
    const response = await fetch(`${base}/spectate/revoke`, {
      method: 'POST',
      headers: { 'x-atrium-admin-token': 'secret' },
    })
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ revoked: 1, blocked: true })
    expect(await closed).toBe(4001)
    expect(normal.readyState).toBe(WebSocket.OPEN)
    spectator.close()
    normal.close()
  })

  it('proxies side chat and work steering', async () => {
    const agents = [agent('a1')]
    const calls: unknown[] = []
    running = startCollectorServer({
      config,
      getAgents: () => agents,
      getHealth: () => ({
        status: 'ok',
        version: '0.1.0',
        source: 'fake',
        agents: agents.length,
        uptimeSeconds: 1,
        lastSuccessfulPoll: null,
        upstreams: { hub: { url: config.hubUrl, reachable: false, lastError: null, lastSuccessAt: null }, llama: [] },
      }),
      getOps: () => ({ generatedAt: new Date().toISOString(), active: [], queued: [] }),
      chat: {
        ask: async (input: unknown) => {
          calls.push(input)
          return { status: 'replied' as const, messages: [{ sender: 'agent', text: 'hello', at: new Date().toISOString() }] }
        },
        steer: async (input: unknown) => {
          calls.push(input)
          return { status: 'accepted', command: { status: 'accepted' } }
        },
      } as never,
    })
    const wsUrl = await running.ready
    const base = wsUrl.replace('ws://', 'http://').replace('/stream', '')

    const chatResponse = await fetch(`${base}/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ agentId: 'a1', text: 'status?' }),
    })
    expect(chatResponse.status).toBe(200)
    expect((await chatResponse.json()) as { messages: unknown[] }).toMatchObject({ messages: [{ text: 'hello' }] })

    const steerResponse = await fetch(`${base}/steer`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ taskId: 'task-1', text: 'fix it', mode: 'pause_then_apply' }),
    })
    expect(steerResponse.status).toBe(200)
    expect((await steerResponse.json()) as { status: string }).toMatchObject({ status: 'accepted' })
    expect(calls).toHaveLength(2)

    const opsResponse = await fetch(`${base}/ops`)
    expect((await opsResponse.json()) as { active: unknown[] }).toMatchObject({ active: [] })
  })

  it('reports degraded health with 503 when upstreams are down', async () => {
    running = startCollectorServer({
      config: { ...config, source: 'live' },
      getAgents: () => [],
      getHealth: () => ({
        status: 'degraded',
        version: '0.1.0',
        source: 'live',
        agents: 0,
        uptimeSeconds: 1,
        lastSuccessfulPoll: null,
        upstreams: { hub: { url: config.hubUrl, reachable: false, lastError: '401', lastSuccessAt: null }, llama: [] },
      }),
    })
    const wsUrl = await running.ready
    const response = await fetch(wsUrl.replace('ws://', 'http://').replace('/stream', '/health'))
    expect(response.status).toBe(503)
  })
})
