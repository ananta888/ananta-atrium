import { describe, expect, it } from 'vitest'
import { allRooms, doorPortals } from '../../src/shared/campus.js'
import { campus } from '../../src/world/campus.js'
import { Simulation } from '../../src/sim/simulation.js'
import { buildRoster } from '../../src/sim/roster.js'
import { buildNavGraph, findPathDetailed } from '../../src/sim/nav-graph.js'
import { shouldEnableTouch } from '../../src/app/touch.js'

describe('rooms, doors and occupancy', () => {
  it('exposes stable room ids, names and kinds including corridors', () => {
    const rooms = allRooms(campus)
    expect(rooms.length).toBeGreaterThan(campus.buildings.length * 12)
    expect(rooms.some((room) => room.kind === 'corridor')).toBe(true)
    expect(new Set(rooms.map((room) => room.id)).size).toBe(rooms.length)
    for (const room of rooms) {
      expect(room.id.length).toBeGreaterThan(0)
      expect(room.name.length).toBeGreaterThan(0)
      expect(room.kind).toBeTruthy()
    }
  })

  it('defines one door portal per room on a corridor boundary', () => {
    const portals = doorPortals(campus)
    expect(portals).toHaveLength(campus.buildings.flatMap((b) => b.rooms).length)
    for (const portal of portals) {
      expect(portal.width).toBeGreaterThan(1)
      expect(Math.abs(portal.position.z)).toBeCloseTo(1.5, 1)
    }
  })

  it('reports which agents are in a room and which room contains a point', () => {
    const sim = new Simulation({ campus, roster: buildRoster(10) })
    const agents = sim.snapshot('fake')
    const room = agents[0]?.roomId as string
    expect(sim.agentsInRoom(room)).toContain(agents[0]?.id)
    expect(sim.occupancy().get(room)?.length).toBeGreaterThan(0)
    const position = agents[0]?.position
    expect(position).toBeDefined()
    if (position) expect(sim.roomAt(position)).toBe(room)
  })

  it('returns explicit path failure reasons', () => {
    const graph = buildNavGraph(campus)
    expect(findPathDetailed(graph, 'room:missing', 'room:atrium-hq-lobby').reason).toBe('unknown-start')
    expect(findPathDetailed(graph, 'room:atrium-hq-lobby', 'room:missing').reason).toBe('unknown-target')
    expect(findPathDetailed(graph, 'room:atrium-hq-lobby', 'room:atrium-hq-office-a').reason).toBe('ok')
  })

  it('routes between all five buildings', () => {
    const graph = buildNavGraph(campus)
    for (const building of campus.buildings) {
      const roomId = building.rooms[0]?.id as string
      expect(findPathDetailed(graph, 'room:atrium-hq-lobby', `room:${roomId}`).reason).toBe('ok')
    }
  })
})

describe('touch policy', () => {
  it('honours explicit modes and auto only on coarse pointers', () => {
    expect(shouldEnableTouch('off', true)).toBe(false)
    expect(shouldEnableTouch('on', false)).toBe(true)
    expect(shouldEnableTouch('auto', true)).toBe(true)
    expect(shouldEnableTouch('auto', false)).toBe(false)
  })
})
