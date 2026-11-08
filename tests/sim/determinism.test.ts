import { describe, expect, it } from 'vitest'
import { Simulation } from '../../src/sim/simulation.js'
import { buildRoster } from '../../src/sim/roster.js'
import { campus } from '../../src/world/campus.js'

const fixedStart = Date.parse('2026-01-01T09:00:00.000Z')

function makeSim(): Simulation {
  return new Simulation({ campus, roster: buildRoster(20), startTimeMs: fixedStart })
}

describe('simulation determinism', () => {
  it('produces identical state for the same seed and tick count', () => {
    const a = makeSim()
    const b = makeSim()
    for (let i = 0; i < 900; i++) {
      a.step()
      b.step()
    }
    expect(a.snapshot('fake')).toEqual(b.snapshot('fake'))
  })

  it('never uses wall-clock time for updatedAt', () => {
    const sim = makeSim()
    for (let i = 0; i < 30; i++) sim.step()
    const [first] = sim.snapshot('fake')
    expect(first?.updatedAt).toBe('2026-01-01T09:00:01.000Z')
  })

  it('assigns every agent a unique desk', () => {
    const sim = makeSim()
    const desks = sim.snapshot('fake').map((agent) => agent.deskId)
    expect(new Set(desks).size).toBe(desks.length)
  })

  it('keeps walking agents inside the campus bounds', () => {
    const sim = makeSim()
    for (let i = 0; i < 3000; i++) {
      sim.step()
      for (const agent of sim.snapshot('fake')) {
        if (!agent.position) continue
        expect(agent.position.x).toBeGreaterThan(-60)
        expect(agent.position.x).toBeLessThan(70)
        expect(agent.position.z).toBeGreaterThan(-60)
        expect(agent.position.z).toBeLessThan(50)
      }
    }
  })
})
