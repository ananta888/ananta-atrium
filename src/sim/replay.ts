import type { AgentState } from '../shared/agent-state.js'

export interface ReplayFrame {
  t: number
  agents: AgentState[]
}

export interface SerializedReplay {
  version: 1
  startedAt: number
  frames: ReplayFrame[]
}

const MAX_FRAMES = 1800

/**
 * Ring buffer of snapshots. Timestamps are supplied by the caller so replay
 * stays deterministic and testable without wall-clock reads.
 */
export class ReplayBuffer {
  private frames: ReplayFrame[] = []

  constructor(private readonly maxFrames = MAX_FRAMES) {}

  record(t: number, agents: readonly AgentState[]): void {
    if (!Number.isFinite(t)) return
    const last = this.frames[this.frames.length - 1]
    if (last && t <= last.t) return
    this.frames.push({ t, agents: agents.map((agent) => structuredClone(agent)) })
    if (this.frames.length > this.maxFrames) this.frames.shift()
  }

  get frameCount(): number {
    return this.frames.length
  }

  get duration(): number {
    if (this.frames.length === 0) return 0
    return (this.frames[this.frames.length - 1]?.t ?? 0) - (this.frames[0]?.t ?? 0)
  }

  get firstTime(): number {
    return this.frames[0]?.t ?? 0
  }

  /** Nearest frame at or before `t`; deterministic interpolation is not needed for state snapshots. */
  seek(t: number): AgentState[] {
    if (this.frames.length === 0) return []
    let candidate = this.frames[0]
    for (const frame of this.frames) {
      if (frame.t <= t) candidate = frame
      else break
    }
    return candidate ? candidate.agents.map((agent) => structuredClone(agent)) : []
  }

  serialize(): SerializedReplay {
    return { version: 1, startedAt: this.frames[0]?.t ?? 0, frames: structuredClone(this.frames) }
  }

  static fromSerialized(data: unknown): ReplayBuffer {
    const buffer = new ReplayBuffer()
    if (typeof data !== 'object' || data === null) return buffer
    const payload = data as Partial<SerializedReplay>
    if (payload.version !== 1 || !Array.isArray(payload.frames)) return buffer
    for (const frame of payload.frames) {
      if (typeof frame?.t === 'number' && Array.isArray(frame.agents)) {
        buffer.record(frame.t, frame.agents as AgentState[])
      }
    }
    return buffer
  }

  clear(): void {
    this.frames = []
  }
}
