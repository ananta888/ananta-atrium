import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import Ajv from 'ajv'
import { describe, expect, it } from 'vitest'
import { mapSessionToAgent, type HubSession } from '../../collector/ananta-source.js'
import { pick } from '../../src/sim/rng.js'
import { campus } from '../../src/world/campus.js'

const here = dirname(fileURLToPath(import.meta.url))
const schema = JSON.parse(
  readFileSync(join(here, '../../src/shared/agent-state.schema.json'), 'utf8'),
) as object
const validate = new Ajv({ strict: false, validateFormats: false }).compile(schema)

const base: HubSession = {
  id: 'session-1234567890',
  title: 'Wire the collector',
  status: 'running',
  worker_id: 'worker-alpha',
  updated_at: 1_760_000_000,
}

describe('Ananta hub mapping', () => {
  it('maps hub statuses onto the AgentState status scale', () => {
    const mapping: Array<[string, string]> = [
      ['running', 'working'],
      ['review', 'reviewing'],
      ['waiting_for_approval', 'waiting'],
      ['blocked', 'waiting'],
      ['done', 'idle'],
      ['failed', 'offline'],
      ['cancelled', 'offline'],
    ]
    for (const [hubStatus, expected] of mapping) {
      const agent = mapSessionToAgent({ ...base, status: hubStatus }, undefined, campus, 1_760_000_100_000)
      expect(agent.status).toBe(expected)
      expect(validate(agent)).toBe(true)
    }
  })

  it('prefers the joined task title and progress', () => {
    const agent = mapSessionToAgent(
      { ...base, task_id: 'task-1' },
      { id: 'task-1', title: 'Document the hub API', progress: 0.42 },
      campus,
      1_760_000_100_000,
    )
    expect(agent.task.title).toBe('Document the hub API')
    expect(agent.task.progress).toBeCloseTo(0.42)
    expect(agent.task.taskId).toBe('task-1')
    expect(validate(agent)).toBe(true)
  })

  it('assigns a stable desk for the same session id', () => {
    const a = mapSessionToAgent(base, undefined, campus, 1_760_000_100_000)
    const b = mapSessionToAgent(base, undefined, campus, 1_760_000_300_000)
    expect(a.deskId).toBe(b.deskId)
    expect(campus.desks.some((desk) => desk.id === a.deskId)).toBe(true)
  })

  it('flags old sessions as stale', () => {
    const agent = mapSessionToAgent(base, undefined, campus, 1_760_000_000_000 + 60_000, 15_000)
    expect(agent.stale).toBe(true)
  })

  it('keeps generated states schema-valid for every seeded session', () => {
    for (let i = 0; i < 40; i++) {
      const agent = mapSessionToAgent(
        { ...base, id: `session-${i}`, status: pick(() => i / 40, ['running', 'review', 'done', 'failed']) },
        undefined,
        campus,
        1_760_000_100_000,
      )
      expect(validate(agent)).toBe(true)
    }
  })
})
