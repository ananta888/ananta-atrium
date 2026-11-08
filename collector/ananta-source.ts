import type { AgentState, AgentStatus } from '../src/shared/agent-state.js'
import { AGENT_STATE_SCHEMA_VERSION } from '../src/shared/agent-state.js'
import type { CampusDef } from '../src/shared/campus.js'
import { hashString } from '../src/sim/rng.js'
import { log } from './logger.js'
import { buildTrace, parseUnifiedDiff, pickWorkspaceDiffArtifact } from './trace.js'
import type { TraceEvent } from '../src/shared/agent-state.js'

export interface HubSession {
  id: string
  task_id?: string | null
  title?: string
  status?: string
  worker_id?: string | null
  worker_type?: string | null
  model?: string | null
  runtime?: string | null
  updated_at?: number
  created_at?: number
}

export interface HubTask {
  id: string
  title?: string
  status?: string
  progress?: number
  priority?: string
}

export interface TaskDetailCacheEntry {
  at: number
  value: unknown
}

interface UpstreamStatus {
  reachable: boolean
  lastError: string | null
  lastSuccessAt: number | null
}

const STATUS_MAP: Record<string, AgentStatus> = {
  idle: 'idle',
  proposed: 'waiting',
  running: 'working',
  waiting_for_approval: 'waiting',
  blocked: 'waiting',
  review: 'reviewing',
  verified: 'reviewing',
  done: 'idle',
  failed: 'offline',
  cancelled: 'offline',
}

const ACTIVITY_MAP: Record<AgentStatus, AgentState['activity']['kind']> = {
  idle: 'idle',
  working: 'typing',
  waiting: 'thinking',
  reviewing: 'reviewing',
  offline: 'idle',
}

function taskProgress(task: HubTask | undefined, status: AgentStatus): number {
  if (typeof task?.progress === 'number') return Math.max(0, Math.min(1, task.progress))
  switch (status) {
    case 'working':
      return 0.5
    case 'reviewing':
      return 0.9
    case 'waiting':
      return 0.3
    case 'idle':
      return 0.1
    case 'offline':
      return 0
  }
}

function seatFor(sessionId: string, desks: CampusDef['desks']): CampusDef['desks'][number] | undefined {
  if (desks.length === 0) return undefined
  const sorted = [...desks].sort((a, b) => a.id.localeCompare(b.id))
  return sorted[hashString(sessionId) % sorted.length]
}

/** Pure mapping used by the adapter and by tests. */
export function mapSessionToAgent(
  session: HubSession,
  task: HubTask | undefined,
  campus: CampusDef,
  nowMs: number,
  staleAfterMs = 15_000,
): AgentState {
  const rawStatus = String(session.status ?? 'idle').toLowerCase()
  const status = STATUS_MAP[rawStatus] ?? 'idle'
  const seat = seatFor(session.id, campus.desks)
  const updatedSeconds = Number(session.updated_at ?? 0)
  const updatedAt = updatedSeconds > 0 ? new Date(updatedSeconds * 1000).toISOString() : new Date(nowMs).toISOString()
  const name = session.worker_id?.trim() || `Session ${session.id.slice(0, 8)}`
  const role = session.worker_type?.trim() || session.runtime?.trim() || session.model?.trim() || 'Ananta agent'

  return {
    schemaVersion: AGENT_STATE_SCHEMA_VERSION,
    id: session.id,
    name: name.slice(0, 64),
    role: role.slice(0, 64),
    status,
    buildingId: seat?.buildingId ?? campus.buildings[0]?.id ?? 'campus',
    roomId: seat?.roomId ?? 'lobby',
    deskId: seat?.id ?? 'unassigned',
    task: {
      title: (task?.title ?? session.title ?? 'Agent session').slice(0, 200),
      progress: taskProgress(task, status),
      ...(session.task_id ? { taskId: session.task_id } : {}),
    },
    activity: {
      kind: ACTIVITY_MAP[status],
      ...(status === 'working' ? { detail: 'Executing task' } : {}),
    },
    updatedAt,
    source: 'live',
    stale: nowMs - (updatedSeconds > 0 ? updatedSeconds * 1000 : nowMs) > staleAfterMs,
  }
}

function envelopeItems<T>(payload: unknown): T[] {
  if (Array.isArray(payload)) return payload as T[]
  if (typeof payload !== 'object' || payload === null) return []
  const data = (payload as Record<string, unknown>).data
  if (Array.isArray(data)) return data as T[]
  if (typeof data === 'object' && data !== null) {
    const items = (data as Record<string, unknown>).items
    if (Array.isArray(items)) return items as T[]
  }
  const items = (payload as Record<string, unknown>).items
  return Array.isArray(items) ? (items as T[]) : []
}

export class AnantaHubSource {
  readonly status: UpstreamStatus = { reachable: false, lastError: null, lastSuccessAt: null }
  private readonly baseUrl: string
  private readonly token: string | null
  private readonly campus: CampusDef
  private readonly fetcher: typeof fetch
  private readonly traceEnabled: boolean
  private readonly leaseProvider: ((taskId: string) => { acquired_at: number; deadline_at: number } | null) | undefined
  private readonly eventProvider: ((taskId?: string, sessionId?: string) => TraceEvent[]) | undefined
  private readonly detailCache = new Map<string, TaskDetailCacheEntry>()
  private readonly diffCache = new Map<string, { at: number; text: string }>()
  private readonly toolCallCache = new Map<string, { at: number; value: unknown }>()

  constructor(options: {
    baseUrl: string
    token: string | null
    campus: CampusDef
    fetcher?: typeof fetch
    traceEnabled?: boolean
    leaseProvider?: (taskId: string) => { acquired_at: number; deadline_at: number } | null
    eventProvider?: (taskId?: string, sessionId?: string) => TraceEvent[]
  }) {
    this.baseUrl = options.baseUrl
    this.token = options.token
    this.campus = options.campus
    this.fetcher = options.fetcher ?? fetch
    this.traceEnabled = options.traceEnabled ?? true
    this.leaseProvider = options.leaseProvider
    this.eventProvider = options.eventProvider
  }

  private async getJson(path: string): Promise<unknown> {
    if (!this.token) throw new Error('ATRIUM_HUB_TOKEN is not configured')
    const response = await this.fetcher(`${this.baseUrl}${path}`, {
      headers: { Authorization: `Bearer ${this.token}`, Accept: 'application/json' },
      signal: AbortSignal.timeout(4000),
    })
    if (!response.ok) throw new Error(`${path} returned ${response.status}`)
    return response.json()
  }

  private unwrapData(payload: unknown): unknown {
    if (typeof payload !== 'object' || payload === null) return payload
    const data = (payload as Record<string, unknown>).data
    return data ?? payload
  }

  private async getText(path: string): Promise<string> {
    if (!this.token) throw new Error('ATRIUM_HUB_TOKEN is not configured')
    const response = await this.fetcher(`${this.baseUrl}${path}`, {
      headers: { Authorization: `Bearer ${this.token}`, Accept: 'text/plain' },
      signal: AbortSignal.timeout(4000),
    })
    if (!response.ok) throw new Error(`${path} returned ${response.status}`)
    const text = await response.text()
    return text.slice(0, 200_000)
  }

  private async taskDetail(taskId: string): Promise<unknown> {
    const cached = this.detailCache.get(taskId)
    if (cached && Date.now() - cached.at < 5000) return cached.value
    const value = this.unwrapData(await this.getJson(`/api/tasks/${encodeURIComponent(taskId)}`))
    this.detailCache.set(taskId, { at: Date.now(), value })
    return value
  }

  private async toolCalls(sessionId: string): Promise<unknown> {
    const cached = this.toolCallCache.get(sessionId)
    if (cached && Date.now() - cached.at < 4000) return cached.value
    const value = this.unwrapData(await this.getJson(`/api/sessions/${encodeURIComponent(sessionId)}/tool-calls`))
    this.toolCallCache.set(sessionId, { at: Date.now(), value })
    return value
  }

  private async diffText(artifactId: string): Promise<string> {
    const cached = this.diffCache.get(artifactId)
    if (cached && Date.now() - cached.at < 10_000) return cached.text
    const text = await this.getText(`/api/artifacts/${encodeURIComponent(artifactId)}/content`)
    this.diffCache.set(artifactId, { at: Date.now(), text })
    return text
  }

  private async enrich(agents: AgentState[]): Promise<AgentState[]> {
    if (!this.traceEnabled) return agents
    const now = Date.now()
    const taskIds = [...new Set(agents.map((agent) => agent.task.taskId).filter((id): id is string => Boolean(id)))]
    const details = new Map<string, unknown>()
    const chunks: string[][] = []
    for (let index = 0; index < taskIds.length; index += 4) chunks.push(taskIds.slice(index, index + 4))
    for (const chunk of chunks) {
      await Promise.all(
        chunk.map(async (taskId) => {
          try {
            details.set(taskId, await this.taskDetail(taskId))
          } catch (error) {
            log('warn', 'task detail unavailable', { taskId, error: (error as Error).message })
          }
        }),
      )
    }

    const enriched: AgentState[] = []
    let toolCallBudget = 20
    for (const agent of agents) {
      const taskId = agent.task.taskId
      if (!taskId) {
        enriched.push(agent)
        continue
      }
      const detail = details.get(taskId)
      let diff
      const artifact = pickWorkspaceDiffArtifact(
        typeof detail === 'object' && detail !== null
          ? (detail as Record<string, unknown>).artifacts
          : undefined,
      )
      if (artifact) {
        try {
          const parsed = parseUnifiedDiff(await this.diffText(artifact.id))
          diff = { ...parsed, artifactId: artifact.id }
        } catch (error) {
          log('warn', 'workspace diff unavailable', { taskId, error: (error as Error).message })
        }
      }
      let toolCalls: unknown
      if (toolCallBudget > 0) {
        try {
          toolCalls = await this.toolCalls(agent.id)
          toolCallBudget -= 1
        } catch (error) {
          log('warn', 'tool calls unavailable', { sessionId: agent.id, error: (error as Error).message })
        }
      }
      const trace = buildTrace({
        taskDetail: detail,
        ...(diff ? { diff } : {}),
        lease: this.leaseProvider?.(taskId) ?? null,
        ...(toolCalls !== undefined ? { toolCalls } : {}),
        ...(this.eventProvider ? { extraEvents: this.eventProvider(taskId, agent.id) } : {}),
        taskId,
        sessionId: agent.id,
        nowMs: now,
      })
      enriched.push(trace ? { ...agent, trace } : agent)
    }
    return enriched
  }

  async poll(): Promise<AgentState[]> {
    const now = Date.now()
    try {
      const sessionsRaw = await this.getJson('/api/sessions')
      const sessions = envelopeItems<HubSession>(sessionsRaw)

      // Tasks are optional decoration: a missing endpoint must not hide agents.
      let tasks: HubTask[] = []
      try {
        tasks = envelopeItems<HubTask>(await this.getJson('/api/tasks?limit=200'))
      } catch (error) {
        log('warn', 'hub tasks unavailable, using session titles', { error: (error as Error).message })
      }
      const taskById = new Map(tasks.map((task) => [task.id, task]))

      this.status.reachable = true
      this.status.lastError = null
      this.status.lastSuccessAt = now
      const mapped = sessions.map((session) =>
        mapSessionToAgent(session, session.task_id ? taskById.get(session.task_id) : undefined, this.campus, now),
      )
      return this.enrich(mapped)
    } catch (error) {
      this.status.reachable = false
      this.status.lastError = (error as Error).message
      throw error
    }
  }
}
