/**
 * AgentState v1 — the one contract shared by collector, client and tests.
 * Keep this file free of any dependency: both Node and the browser import it.
 */

export const AGENT_STATE_SCHEMA_VERSION = 1 as const

export type AgentStatus = 'idle' | 'working' | 'waiting' | 'reviewing' | 'offline'

export type AgentActivityKind =
  | 'typing'
  | 'reading'
  | 'thinking'
  | 'meeting'
  | 'walking'
  | 'reviewing'
  | 'idle'

export type AgentSource = 'live' | 'fake'

export interface AgentActivity {
  kind: AgentActivityKind
  detail?: string
}

export interface AgentTask {
  title: string
  progress: number
  taskId?: string
}

export interface AgentMetrics {
  tokensPerSecond?: number
  contextUsed?: number
}

export interface Vec3 {
  x: number
  y: number
  z: number
}

export interface BudgetBucket {
  unit: 'ms' | 'tokens' | 'cost'
  limit: number | null
  used: number | null
}

export interface AgentBudget {
  time?: BudgetBucket
  tokens?: BudgetBucket
  cost?: BudgetBucket
}

export interface TraceEvent {
  at: string
  kind: string
  summary: string
}

export interface DiffFile {
  path: string
  additions: number
  deletions: number
}

export interface AgentDiff {
  files: DiffFile[]
  additions: number
  deletions: number
  preview: string[]
  truncated: boolean
  artifactId?: string
}

export interface AgentTrace {
  taskId?: string
  sessionId?: string
  attempts?: number
  maxAttempts?: number
  budget?: AgentBudget
  diff?: AgentDiff
  events?: TraceEvent[]
}

export interface PlannedTask {
  id: string
  title: string
  status: string
  priority?: string
}

export interface AgentAssignment {
  workerUrl?: string
  teamMemberId?: string
  runtime?: string
  health?: string
  planned?: PlannedTask
  path?: {
    teamName?: string
    teamId?: string
    projectId?: string
    organizationId?: string
    goalId?: string
    planNodeId?: string
  }
}

export interface AgentState {
  schemaVersion: typeof AGENT_STATE_SCHEMA_VERSION
  id: string
  name: string
  role: string
  status: AgentStatus
  buildingId: string
  roomId: string
  deskId: string
  task: AgentTask
  activity: AgentActivity
  metrics?: AgentMetrics
  updatedAt: string
  source: AgentSource
  stale: boolean
  position?: Vec3
  trace?: AgentTrace
  assignment?: AgentAssignment
}

export interface AgentSnapshot {
  schemaVersion: typeof AGENT_STATE_SCHEMA_VERSION
  generatedAt: string
  source: AgentSource
  agents: AgentState[]
}

export interface OpsEntry {
  id: string
  taskId?: string
  workerId?: string
  model?: string
  status: string
  queuePosition?: number
  acquiredAt?: string
  deadlineAt?: string
}

export interface OpsStatus {
  generatedAt: string
  active: OpsEntry[]
  queued: OpsEntry[]
  interactiveReserved?: boolean
}

export type StateMessage =
  | { type: 'snapshot'; snapshot: AgentSnapshot }
  | { type: 'ops'; ops: OpsStatus }
  | { type: 'upsert'; agents: AgentState[] }
  | { type: 'remove'; ids: string[] }
  | { type: 'heartbeat'; at: string }

export const STATUS_LABELS: Record<AgentStatus, string> = {
  idle: 'Idle',
  working: 'Working',
  waiting: 'Waiting',
  reviewing: 'Reviewing',
  offline: 'Offline',
}

export function isAgentStatus(value: unknown): value is AgentStatus {
  return value === 'idle' || value === 'working' || value === 'waiting' || value === 'reviewing' || value === 'offline'
}

export function isAgentSource(value: unknown): value is AgentSource {
  return value === 'live' || value === 'fake'
}

/** Defensive narrowing for data crossing the network boundary. */
export function isAgentState(value: unknown): value is AgentState {
  if (typeof value !== 'object' || value === null) return false
  const v = value as Record<string, unknown>
  return (
    v.schemaVersion === AGENT_STATE_SCHEMA_VERSION &&
    typeof v.id === 'string' &&
    typeof v.name === 'string' &&
    typeof v.role === 'string' &&
    isAgentStatus(v.status) &&
    typeof v.buildingId === 'string' &&
    typeof v.roomId === 'string' &&
    typeof v.deskId === 'string' &&
    typeof v.updatedAt === 'string' &&
    isAgentSource(v.source) &&
    typeof v.stale === 'boolean' &&
    typeof v.task === 'object' &&
    v.task !== null &&
    typeof v.activity === 'object' &&
    v.activity !== null
  )
}

export function isStateMessage(value: unknown): value is StateMessage {
  if (typeof value !== 'object' || value === null) return false
  const v = value as Record<string, unknown>
  switch (v.type) {
    case 'snapshot':
      return (
        typeof v.snapshot === 'object' &&
        v.snapshot !== null &&
        Array.isArray((v.snapshot as AgentSnapshot).agents) &&
        (v.snapshot as AgentSnapshot).agents.every(isAgentState)
      )
    case 'upsert':
      return Array.isArray(v.agents) && v.agents.every(isAgentState)
    case 'remove':
      return Array.isArray(v.ids) && v.ids.every((id) => typeof id === 'string')
    case 'heartbeat':
      return typeof v.at === 'string'
    case 'ops':
      return typeof v.ops === 'object' && v.ops !== null && Array.isArray((v.ops as OpsStatus).active)
    default:
      return false
  }
}
