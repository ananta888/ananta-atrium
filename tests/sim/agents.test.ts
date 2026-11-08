import { performance } from 'node:perf_hooks'
import { describe, expect, it } from 'vitest'
import { Simulation } from '../../src/sim/simulation.js'
import { buildRoster } from '../../src/sim/roster.js'
import { buildNavGraph, findPath } from '../../src/sim/nav-graph.js'
import { roomCenterWorld } from '../../src/sim/nav-graph.js'
import { campus } from '../../src/world/campus.js'

function distance(a: { x: number; y: number; z: number }, b: { x: number; y: number; z: number }): number {
  return Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z)
}

describe('agent locomotion acceptance', () => {
  it('walks desk → stairs → first-floor meeting room without getting stuck', () => {
    const roster = buildRoster(1)
    const sim = new Simulation({ campus, roster })
    const agentId = roster[0]?.id as string
    const targetRoom = campus.buildings[0]?.rooms.find((room) => room.id === 'atrium-hq-meeting-b')
    expect(targetRoom).toBeDefined()
    expect(sim.sendAgentTo(agentId, 'atrium-hq-meeting-b')).toBe(true)

    let ticks = 0
    while (sim.isAgentWalking(agentId) && ticks < 12000) {
      sim.step()
      ticks++
    }
    expect(ticks).toBeLessThan(12000)
    expect(sim.isAgentWalking(agentId)).toBe(false)

    const agent = sim.snapshot('fake').find((item) => item.id === agentId)
    expect(agent?.roomId).toBe('atrium-hq-meeting-b')
    const building = campus.buildings[0]
    expect(building).toBeDefined()
    if (building && targetRoom && agent?.position) {
      const centre = roomCenterWorld(building.origin, targetRoom, building.floorHeight)
      expect(distance(agent.position, centre)).toBeLessThan(3)
      expect(agent.position.y).toBeCloseTo(building.floorHeight, 1)
    }
  })

  it('fails explicitly for an unknown agent or room', () => {
    const sim = new Simulation({ campus, roster: buildRoster(2) })
    expect(sim.sendAgentTo('nobody', 'atrium-hq-lobby')).toBe(false)
    expect(sim.sendAgentTo('agent-01', 'no-such-room')).toBe(false)
  })

  it('computes 50 paths within the documented budget', () => {
    const graph = buildNavGraph(campus)
    const rooms = campus.buildings.flatMap((b) => b.rooms.map((r) => `room:${r.id}`))
    const started = performance.now()
    let ok = 0
    for (let i = 0; i < 50; i++) {
      const from = rooms[(i * 7) % rooms.length] as string
      const to = rooms[(i * 13 + 5) % rooms.length] as string
      if (findPath(graph, from, to).length > 1) ok++
    }
    const elapsed = performance.now() - started
    expect(ok).toBeGreaterThanOrEqual(45)
    expect(elapsed).toBeLessThan(1000)
  })

  it('keeps the 50-agent sim tick within budget', () => {
    const sim = new Simulation({ campus, roster: buildRoster(50) })
    const started = performance.now()
    for (let i = 0; i < 300; i++) sim.step()
    const elapsed = performance.now() - started
    // 300 ticks = 10 simulated seconds; 16 ms per tick is the hard ceiling.
    expect(elapsed / 300).toBeLessThan(16)
  })
})
