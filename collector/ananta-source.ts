import type { AgentState, AgentStatus } from '../src/shared/agent-state.js'
import { AGENT_STATE_SCHEMA_VERSION } from '../src/shared/agent-state.js'
import type { CampusDef } from '../src/shared/campus.js'
import { hashString } from '../src/sim/rng.js'
import { log } from './logger.js'

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

export interface UpstreamStatus {
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

  constructor(options: { baseUrl: string; token: string | null; campus: CampusDef; fetcher?: typeof fetch }) {
    this.baseUrl = options.baseUrl
    this.token = options.token
    this.campus = options.campus
    this.fetcher = options.fetcher ?? fetch
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
      return sessions.map((session) =>
        mapSessionToAgent(session, session.task_id ? taskById.get(session.task_id) : undefined, this.campus, now),
      )
    } catch (error) {
      this.status.reachable = false
      this.status.lastError = (error as Error).message
      throw error
    }
  }
}
