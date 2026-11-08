import { describe, expect, it } from 'vitest'
import { ReplayBuffer } from '../../src/sim/replay.js'
import type { AgentState } from '../../src/shared/agent-state.js'

function agent(id: string, progress: number): AgentState {
  return {
    schemaVersion: 1,
    id,
    name: id,
    role: 'Engineer',
    status: 'working',
    buildingId: 'b',
    roomId: 'r',
    deskId: 'd',
    task: { title: 'work', progress },
    activity: { kind: 'typing' },
    updatedAt: '2026-01-01T09:00:00.000Z',
    source: 'fake',
    stale: false,
    position: { x: 0, y: 0, z: 0 },
  }
}

describe('ReplayBuffer', () => {
  it('records increasing timestamps and seeks deterministically', () => {
    const replay = new ReplayBuffer()
    replay.record(1, [agent('a', 0.1)])
    replay.record(2, [agent('a', 0.5)])
    replay.record(3, [agent('a', 0.9)])
    expect(replay.frameCount).toBe(3)
    expect(replay.duration).toBe(2)
    expect(replay.seek(0.5)[0]?.task.progress).toBe(0.1)
    expect(replay.seek(2.4)[0]?.task.progress).toBe(0.5)
    expect(replay.seek(99)[0]?.task.progress).toBe(0.9)
  })

  it('ignores duplicate or backwards timestamps', () => {
    const replay = new ReplayBuffer()
    replay.record(2, [agent('a', 0.2)])
    replay.record(2, [agent('a', 0.3)])
    replay.record(1, [agent('a', 0.4)])
    expect(replay.frameCount).toBe(1)
    expect(replay.seek(2)[0]?.task.progress).toBe(0.2)
  })

  it('caps the ring buffer', () => {
    const replay = new ReplayBuffer(3)
    for (let i = 0; i < 10; i++) replay.record(i, [agent('a', i / 10)])
    expect(replay.frameCount).toBe(3)
    expect(replay.seek(0)[0]?.task.progress).toBeCloseTo(0.7)
  })

  it('round-trips through serialized JSON', () => {
    const replay = new ReplayBuffer()
    replay.record(5, [agent('a', 0.5)])
    const restored = ReplayBuffer.fromSerialized(JSON.parse(JSON.stringify(replay.serialize())))
    expect(restored.frameCount).toBe(1)
    expect(restored.seek(5)[0]?.task.progress).toBe(0.5)
  })

  it('rejects malformed serialized data without throwing', () => {
    expect(ReplayBuffer.fromSerialized(null).frameCount).toBe(0)
    expect(ReplayBuffer.fromSerialized({ version: 2, frames: [] }).frameCount).toBe(0)
    expect(ReplayBuffer.fromSerialized({ version: 1, frames: [{ t: 'x' }] }).frameCount).toBe(0)
  })
})
