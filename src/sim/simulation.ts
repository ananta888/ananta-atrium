import type { AgentActivityKind, AgentState, AgentStatus } from '../shared/agent-state.js'
import {
  AGENT_STATE_SCHEMA_VERSION,
  type AgentSource,
} from '../shared/agent-state.js'
import type { CampusDef, DeskDef, Vec3 } from '../shared/campus.js'
import { allRooms } from '../shared/campus.js'
import { buildNavGraph, findPath, type NavGraph } from './nav-graph.js'
import { createRng, hashString, pick } from './rng.js'
import { buildRoster, TASK_TITLES, type AgentIdentity, type LiveOverride } from './roster.js'

export interface SimulationOptions {
  campus: CampusDef
  tickSeconds?: number
  seed?: string
  roster?: AgentIdentity[]
  /** Wall-clock anchor for `updatedAt`; tests pass a fixed value. */
  startTimeMs?: number
}

type Mode = 'seated' | 'walking' | 'dwelling'

interface RuntimeAgent {
  identity: AgentIdentity
  desk: DeskDef
  seat: Vec3
  position: Vec3
  mode: Mode
  path: Vec3[]
  currentNodeId: string
  roomId: string
  dwellTicks: number
  taskTitle: string
  taskProgress: number
  activityKind: AgentActivityKind
  status: AgentStatus
  source: AgentSource
  stale: boolean
  live: LiveOverride | null
  rng: () => number
}

const WALK_SPEED = 1.6 // m/s
const EPSILON = 0.001

function clone(v: Vec3): Vec3 {
  return { x: v.x, y: v.y, z: v.z }
}

function seatWorld(desk: DeskDef, origin: Vec3): Vec3 {
  return { x: origin.x + desk.position.x, y: origin.y + desk.position.y, z: origin.z + desk.position.z }
}

export class Simulation {
  readonly campus: CampusDef
  readonly tickSeconds: number
  readonly graph: NavGraph
  private readonly agents = new Map<string, RuntimeAgent>()
  private readonly deskOwners = new Map<string, string>()
  private readonly startTimeMs: number
  private currentTick = 0

  constructor(options: SimulationOptions) {
    this.campus = options.campus
    this.tickSeconds = options.tickSeconds ?? 1 / 30
    this.startTimeMs = options.startTimeMs ?? Date.parse('2026-01-01T09:00:00.000Z')
    this.graph = buildNavGraph(options.campus)

    const roster = options.roster ?? buildRoster(12)
    for (const identity of roster) this.addAgent(identity)
  }

  get tick(): number {
    return this.currentTick
  }

  get agentCount(): number {
    return this.agents.size
  }

  hasAgent(id: string): boolean {
    return this.agents.has(id)
  }

  isAgentWalking(id: string): boolean {
    return this.agents.get(id)?.mode === 'walking'
  }

  addAgent(identity: AgentIdentity): void {
    if (this.agents.has(identity.id)) return
    const desk = this.assignDesk(identity.id)
    const building = this.campus.buildings.find((b) => b.id === desk.buildingId)
    if (!building) throw new Error(`desk ${desk.id} references unknown building ${desk.buildingId}`)
    const seat = seatWorld(desk, building.origin)
    const rngSeed = hashString(`${identity.id}:${desk.id}`)
    const agent: RuntimeAgent = {
      identity,
      desk,
      seat,
      position: clone(seat),
      mode: 'seated',
      path: [],
      currentNodeId: `room:${desk.roomId}`,
      roomId: desk.roomId,
      dwellTicks: 240 + (rngSeed % 480),
      taskTitle: pick(createRng(rngSeed), TASK_TITLES),
      taskProgress: (rngSeed % 100) / 100,
      activityKind: 'typing',
      status: 'working',
      source: 'fake',
      stale: false,
      live: null,
      rng: createRng(`${identity.id}:behaviour`),
    }
    this.agents.set(identity.id, agent)
    this.deskOwners.set(desk.id, identity.id)
  }

  removeAgent(id: string): void {
    const agent = this.agents.get(id)
    if (!agent) return
    this.deskOwners.delete(agent.desk.id)
    this.agents.delete(id)
  }

  private assignDesk(agentId: string): DeskDef {
    const desks = [...this.campus.desks].sort((a, b) => a.id.localeCompare(b.id))
    if (desks.length === 0) throw new Error('campus has no desks')
    const start = hashString(agentId) % desks.length
    for (let probe = 0; probe < desks.length; probe++) {
      const candidate = desks[(start + probe) % desks.length]
      if (!candidate) continue
      if (!this.deskOwners.has(candidate.id)) return candidate
    }
    const fallback = desks[start % desks.length]
    if (!fallback) throw new Error('campus has no desks')
    return fallback
  }

  /** Apply live states from the collector. Unknown agents are added. */
  applyLiveAgents(states: readonly AgentState[]): void {
    const seen = new Set<string>()
    for (const state of states) {
      seen.add(state.id)
      if (!this.agents.has(state.id)) {
        this.addAgent({ id: state.id, name: state.name, role: state.role })
      }
      const agent = this.agents.get(state.id)
      if (!agent) continue
      agent.identity.name = state.name
      agent.identity.role = state.role
      agent.source = state.source
      agent.stale = state.stale
      agent.live = {
        status: state.status,
        taskTitle: state.task.title,
        taskProgress: state.task.progress,
        activityKind: state.activity.kind,
        source: state.source,
        stale: state.stale,
        ...(state.activity.detail !== undefined ? { activityDetail: state.activity.detail } : {}),
        ...(state.metrics?.tokensPerSecond !== undefined
          ? { tokensPerSecond: state.metrics.tokensPerSecond }
          : {}),
      }
      if (state.position) agent.position = clone(state.position)
      if (state.status === 'offline') {
        agent.activityKind = 'idle'
        agent.status = 'offline'
      }
    }
    for (const [id, agent] of this.agents) {
      if (agent.live && !seen.has(id)) {
        agent.stale = true
        agent.status = 'offline'
        agent.activityKind = 'idle'
        if (agent.live) agent.live.stale = true
      }
    }
  }

  /** Agents currently inside a room (including synthesized corridors). */
  agentsInRoom(roomId: string): string[] {
    return [...this.agents.values()]
      .filter((agent) => agent.roomId === roomId)
      .map((agent) => agent.identity.id)
      .sort()
  }

  occupancy(): Map<string, string[]> {
    const result = new Map<string, string[]>()
    for (const agent of this.agents.values()) {
      const list = result.get(agent.roomId) ?? []
      list.push(agent.identity.id)
      result.set(agent.roomId, list)
    }
    for (const list of result.values()) list.sort()
    return result
  }

  /** Which room contains a world point, or null when outdoors. */
  roomAt(point: Vec3): string | null {
    for (const building of this.campus.buildings) {
      const localX = point.x - building.origin.x
      const localZ = point.z - building.origin.z
      if (Math.abs(localX) > building.width / 2 || Math.abs(localZ) > building.depth / 2) continue
      const floor = Math.floor((point.y - building.origin.y) / building.floorHeight)
      if (floor < 0 || floor >= building.floors) continue
      const rooms = allRooms(this.campus).filter((r) => r.buildingId === building.id && r.floor === floor)
      const room = rooms.find((r) => localX >= r.min.x && localX <= r.max.x && localZ >= r.min.z && localZ <= r.max.z)
      if (room) return room.id
    }
    return null
  }

  /** Send one agent to a room (used by acceptance tests and future inspection tools). */
  sendAgentTo(agentId: string, roomId: string): boolean {
    const agent = this.agents.get(agentId)
    if (!agent) return false
    const target = `room:${roomId}`
    if (!this.graph.nodes.has(target)) return false
    this.walkTo(agent, target)
    return true
  }

  /** Walking paths for the debug nav overlay. */
  debugPaths(): Array<{ id: string; points: Vec3[] }> {
    return [...this.agents.values()]
      .filter((agent) => agent.mode === 'walking')
      .map((agent) => ({ id: agent.identity.id, points: [clone(agent.position), ...agent.path.map(clone)] }))
  }

  /** Snapshot semantics: add/update agents and drop ones the source no longer reports. */
  reconcile(states: readonly AgentState[]): void {
    const ids = new Set(states.map((state) => state.id))
    for (const id of [...this.agents.keys()]) {
      if (!ids.has(id)) this.removeAgent(id)
    }
    this.applyLiveAgents(states)
  }

  step(): void {
    this.currentTick += 1
    const ids = [...this.agents.keys()].sort()
    for (const id of ids) {
      const agent = this.agents.get(id)
      if (!agent) continue
      if (agent.live) {
        this.tickLive(agent)
      } else {
        this.tickFake(agent)
      }
    }
  }

  private tickLive(agent: RuntimeAgent): void {
    const override = agent.live
    if (!override) return
    if (override.status === 'offline') {
      agent.status = 'offline'
      agent.activityKind = 'idle'
      return
    }
    agent.status = override.status
    agent.taskTitle = override.taskTitle
    agent.taskProgress = override.taskProgress
    agent.activityKind = override.activityKind
  }

  private tickFake(agent: RuntimeAgent): void {
    if (agent.mode === 'walking') {
      this.advanceWalk(agent)
      return
    }

    agent.dwellTicks -= 1
    if (agent.mode === 'seated') {
      agent.taskProgress = Math.min(1, agent.taskProgress + 0.0016)
      if (agent.taskProgress >= 1) {
        agent.taskProgress = 0
        agent.taskTitle = pick(agent.rng, TASK_TITLES)
      }
      agent.status = 'working'
      agent.activityKind = 'typing'
    } else {
      agent.status = agent.roomId.startsWith('meeting') ? 'reviewing' : 'idle'
      agent.activityKind = agent.roomId.startsWith('meeting') ? 'meeting' : 'idle'
    }

    if (agent.dwellTicks > 0) return

    if (agent.mode === 'dwelling') {
      this.walkTo(agent, `room:${agent.desk.roomId}`)
      return
    }

    // Stay at the desk sometimes: pick a new task instead of walking.
    if (agent.rng() < 0.35) {
      agent.taskTitle = pick(agent.rng, TASK_TITLES)
      agent.taskProgress = 0
      agent.dwellTicks = 300 + Math.floor(agent.rng() * 600)
      return
    }

    const destination = this.pickDestination(agent)
    if (destination) {
      this.walkTo(agent, destination)
    } else {
      agent.dwellTicks = 240
    }
  }

  private pickDestination(agent: RuntimeAgent): string | null {
    const rooms = this.campus.buildings.flatMap((b) => b.rooms)
    const candidates = rooms.filter(
      (r) => r.kind === 'meeting' || r.kind === 'social' || (r.kind === 'office' && r.id !== agent.desk.roomId),
    )
    if (candidates.length === 0) return null
    for (let attempt = 0; attempt < 6; attempt++) {
      const room = pick(agent.rng, candidates)
      const nodeId = `room:${room.id}`
      if (nodeId === agent.currentNodeId) continue
      const path = findPath(this.graph, agent.currentNodeId, nodeId)
      if (path.length > 1) return nodeId
    }
    return null
  }

  private walkTo(agent: RuntimeAgent, targetNodeId: string): void {
    const pathIds = findPath(this.graph, agent.currentNodeId, targetNodeId)
    if (pathIds.length < 2) {
      agent.dwellTicks = 240
      return
    }
    const points: Vec3[] = []
    for (const id of pathIds.slice(1)) {
      const node = this.graph.nodes.get(id)
      if (node) points.push(clone(node.position))
    }
    if (points.length === 0) {
      agent.dwellTicks = 240
      return
    }
    agent.path = points
    agent.mode = 'walking'
    agent.activityKind = 'walking'
    agent.status = 'working'
    agent.currentNodeId = targetNodeId

    const building = this.campus.buildings.find((b) => `room:${agent.desk.roomId}` === targetNodeId || b.rooms.some((r) => `room:${r.id}` === targetNodeId))
    const targetRoom = building?.rooms.find((r) => `room:${r.id}` === targetNodeId)
    if (targetRoom) agent.roomId = targetRoom.id
  }

  private advanceWalk(agent: RuntimeAgent): void {
    let remaining = WALK_SPEED * this.tickSeconds
    while (remaining > 0 && agent.path.length > 0) {
      const target = agent.path[0]
      if (!target) break
      const dx = target.x - agent.position.x
      const dy = target.y - agent.position.y
      const dz = target.z - agent.position.z
      const distance = Math.hypot(dx, dy, dz)
      if (distance <= EPSILON || distance <= remaining) {
        agent.position = clone(target)
        agent.path.shift()
        remaining -= distance
      } else {
        const ratio = remaining / distance
        agent.position = {
          x: agent.position.x + dx * ratio,
          y: agent.position.y + dy * ratio,
          z: agent.position.z + dz * ratio,
        }
        remaining = 0
      }
    }

    if (agent.path.length === 0) {
      agent.mode = agent.roomId === agent.desk.roomId ? 'seated' : 'dwelling'
      agent.dwellTicks =
        agent.mode === 'dwelling' ? 90 + Math.floor(agent.rng() * 240) : 300 + Math.floor(agent.rng() * 600)
      if (agent.mode === 'seated') agent.position = clone(agent.seat)
    }
  }

  private fakeTrace(agentId: string): AgentState['trace'] {
    const seed = hashString(agentId)
    const usedMs = (seed % 900) * 1000
    const tokensUsed = seed % 24000
    const attempts = seed % 3
    const withDiff = true
    return {
      attempts,
      maxAttempts: 4,
      budget: {
        time: { unit: 'ms', limit: 30 * 60 * 1000, used: usedMs },
        tokens: { unit: 'tokens', limit: 64000, used: tokensUsed },
      },
      events: [
        {
          at: new Date(this.startTimeMs + this.currentTick * this.tickSeconds * 1000 - 60_000).toISOString(),
          kind: 'task',
          summary: 'Working on the current step',
        },
        {
          at: new Date(this.startTimeMs + this.currentTick * this.tickSeconds * 1000).toISOString(),
          kind: 'budget',
          summary: 'Budget sampled',
        },
      ],
      ...(withDiff
        ? {
            diff: {
              files: [
                { path: 'src/app/session.ts', additions: 12, deletions: 4 },
                { path: 'docs/architecture.md', additions: 3, deletions: 1 },
              ],
              additions: 15,
              deletions: 5,
              preview: [
                '@@ -10,4 +10,6 @@',
                '+  const trace = await loadTrace(agent)',
                '-  const trace = null',
                '+  renderMonitor(trace)',
              ],
              truncated: false,
            },
          }
        : {}),
    }
  }

  snapshot(source: AgentSource = 'fake'): AgentState[] {
    const updatedAt = new Date(this.startTimeMs + this.currentTick * this.tickSeconds * 1000).toISOString()
    return [...this.agents.values()]
      .sort((a, b) => a.identity.id.localeCompare(b.identity.id))
      .map((agent) => {
        const live = agent.live
        const state: AgentState = {
          schemaVersion: AGENT_STATE_SCHEMA_VERSION,
          id: agent.identity.id,
          name: agent.identity.name,
          role: agent.identity.role,
          status: live ? live.status : agent.status,
          buildingId: agent.desk.buildingId,
          roomId: agent.roomId,
          deskId: agent.desk.id,
          task: {
            title: live ? live.taskTitle : agent.taskTitle,
            progress: live ? live.taskProgress : agent.taskProgress,
          },
          activity: {
            kind: live ? live.activityKind : agent.activityKind,
            ...(live?.activityDetail !== undefined ? { detail: live.activityDetail } : {}),
          },
          updatedAt,
          source: live ? live.source : source,
          stale: live ? live.stale : agent.stale,
          position: clone(agent.position),
        }
        if (!live && source === 'fake') {
          const trace = this.fakeTrace(agent.identity.id)
          if (trace) state.trace = trace
        }
        if (live?.tokensPerSecond !== undefined) {
          state.metrics = { tokensPerSecond: live.tokensPerSecond }
        }
        return state
      })
  }
}
