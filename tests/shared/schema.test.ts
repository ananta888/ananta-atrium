import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import Ajv from 'ajv'
import { describe, expect, it } from 'vitest'
import { Simulation } from '../../src/sim/simulation.js'
import { buildRoster } from '../../src/sim/roster.js'
import { campus } from '../../src/world/campus.js'

const here = dirname(fileURLToPath(import.meta.url))
const schema = JSON.parse(
  readFileSync(join(here, '../../src/shared/agent-state.schema.json'), 'utf8'),
) as object

const validate = new Ajv({ strict: false, validateFormats: false }).compile(schema)

describe('AgentState v1 contract', () => {
  it('validates every simulated agent against the published JSON schema', () => {
    const sim = new Simulation({ campus: campus, roster: buildRoster(30) })
    for (let i = 0; i < 300; i++) sim.step()
    const agents = sim.snapshot('fake')
    expect(agents.length).toBe(30)
    for (const agent of agents) {
      const valid = validate(agent)
      if (!valid) console.error(validate.errors)
      expect(valid).toBe(true)
    }
  })

  it('preserves unknown optional fields across the contract boundary', () => {
    const sim = new Simulation({ campus: campus, roster: buildRoster(1) })
    const [agent] = sim.snapshot('fake')
    expect(agent).toBeDefined()
    const extended = { ...agent, customField: { kept: true } }
    expect(validate(extended)).toBe(true)
    expect((extended as Record<string, unknown>).customField).toEqual({ kept: true })
  })

  it('rejects an invalid status', () => {
    const sim = new Simulation({ campus: campus, roster: buildRoster(1) })
    const [agent] = sim.snapshot('fake')
    expect(validate({ ...agent, status: 'sleeping' })).toBe(false)
  })
})
