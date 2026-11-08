import { readFileSync } from 'node:fs'
import type { AgentState } from '../src/shared/agent-state.js'
import { buildRoster } from '../src/sim/roster.js'
import { Simulation } from '../src/sim/simulation.js'
import { loadCampus } from '../src/world/campus-loader.js'
import { AnantaHubSource } from './ananta-source.js'
import { ChatBridge } from './chat.js'
import { WorkerPoolSource } from './worker-pool.js'
import type { OpsStatus } from '../src/shared/agent-state.js'
import { loadConfig } from './config.js'
import { LlamaMetricsSource } from './llama-source.js'
import { startCollectorServer, type HealthReport } from './server.js'
import { log } from './logger.js'

const VERSION = '0.1.0'
const startedAt = Date.now()

function loadCommittedCampus() {
  const raw = JSON.parse(readFileSync(new URL('../src/world/scene.json', import.meta.url), 'utf8')) as unknown
  return loadCampus(raw)
}

const config = loadConfig()
const campus = loadCommittedCampus()

let agents: AgentState[] = []
let lastSuccessfulPoll: number | null = null
let fakeSimulation: Simulation | null = null
let fakeTimer: ReturnType<typeof setInterval> | null = null
let livePollTimer: ReturnType<typeof setInterval> | null = null

const workerPool =
  config.source === 'live' && config.hubToken
    ? new WorkerPoolSource({ baseUrl: config.hubUrl, token: config.hubToken })
    : null
const hub = config.source === 'live'
  ? new AnantaHubSource({
      baseUrl: config.hubUrl,
      token: config.hubToken,
      campus,
      traceEnabled: config.traceEnabled,
      ...(workerPool ? { leaseProvider: (taskId: string) => workerPool.leaseForTask(taskId) } : {}),
    })
  : null
const llama = new LlamaMetricsSource(config.llamaUrls)
const chat = config.hubToken
  ? new ChatBridge({ baseUrl: config.hubUrl, token: config.hubToken, stateFile: config.chatStateFile })
  : null
let ops: OpsStatus | null = null

function distributeThroughput(tokensPerSecond: number): void {
  if (tokensPerSecond <= 0) return
  const active = agents.filter((agent) => agent.status === 'working')
  if (active.length === 0) return
  const share = tokensPerSecond / active.length
  for (const agent of active) {
    agent.metrics = { ...(agent.metrics ?? {}), tokensPerSecond: Number(share.toFixed(2)) }
  }
}

if (config.source === 'fake') {
  fakeSimulation = new Simulation({ campus, roster: buildRoster(config.fakeAgents) })
  fakeTimer = setInterval(() => {
    fakeSimulation?.step()
    agents = fakeSimulation?.snapshot('fake') ?? []
    lastSuccessfulPoll = Date.now()
  }, 1000 / 30)
} else {
  const poll = async (): Promise<void> => {
    const now = Date.now()
    try {
      const fresh = await hub?.poll()
      if (fresh) {
        agents = fresh.map((agent) => ({
          ...agent,
          stale: now - Date.parse(agent.updatedAt) > config.staleAfterMs,
        }))
        lastSuccessfulPoll = now
      }
      const tokensPerSecond = await llama.poll()
      distributeThroughput(tokensPerSecond)
      if (workerPool) {
        try {
          ops = await workerPool.poll()
        } catch (error) {
          log('warn', 'worker pool unavailable', { error: (error as Error).message })
        }
      }
    } catch (error) {
      log('warn', 'hub poll failed', { error: (error as Error).message })
      agents = agents.map((agent) => ({ ...agent, stale: true }))
    }
  }
  void poll()
  livePollTimer = setInterval(() => void poll(), config.pollMs)
}

function health(): HealthReport {
  const hubStatus = hub?.status
  const degraded =
    config.source === 'live' &&
    (hubStatus?.reachable === false || agents.length === 0)
  return {
    status: degraded ? 'degraded' : 'ok',
    version: VERSION,
    source: config.source,
    agents: agents.length,
    uptimeSeconds: Math.round((Date.now() - startedAt) / 1000),
    lastSuccessfulPoll: lastSuccessfulPoll ? new Date(lastSuccessfulPoll).toISOString() : null,
    upstreams: {
      hub: {
        url: config.hubUrl,
        reachable: hubStatus?.reachable ?? false,
        lastError: hubStatus?.lastError ?? null,
        lastSuccessAt: hubStatus?.lastSuccessAt ? new Date(hubStatus.lastSuccessAt).toISOString() : null,
      },
      llama: llama.statuses.map((status) => ({
        url: status.url,
        reachable: status.reachable,
        lastError: status.lastError,
        tokensPerSecond: Number(status.tokensPerSecond.toFixed(2)),
      })),
      ...(workerPool
        ? {
            workerPool: {
              reachable: workerPool.status.reachable,
              lastError: workerPool.status.lastError,
              lastSuccessAt: workerPool.status.lastSuccessAt
                ? new Date(workerPool.status.lastSuccessAt).toISOString()
                : null,
            },
          }
        : {}),
    },
  }
}

const server = startCollectorServer({
  config,
  getAgents: () => agents,
  getHealth: health,
  getOps: () => ops,
  ...(chat ? { chat } : {}),
})

const shutdown = async (signal: string): Promise<void> => {
  log('info', 'collector shutting down', { signal })
  if (fakeTimer) clearInterval(fakeTimer)
  if (livePollTimer) clearInterval(livePollTimer)
  await server.close()
  process.exit(0)
}

process.on('SIGINT', () => void shutdown('SIGINT'))
process.on('SIGTERM', () => void shutdown('SIGTERM'))
