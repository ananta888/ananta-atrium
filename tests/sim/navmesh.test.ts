import { describe, expect, it } from 'vitest'
import { buildFloorNavMesh, cellAt, reachableCells } from '../../src/sim/nav-mesh.js'
import { campus } from '../../src/world/campus.js'

describe('floor navmesh', () => {
  it('generates a walkable grid for every floor of every building', () => {
    for (const building of campus.buildings) {
      for (let floor = 0; floor < building.floors; floor++) {
        const mesh = buildFloorNavMesh(building, floor)
        const cells = mesh.walkable.flat().filter(Boolean).length
        expect(cells).toBeGreaterThan(200)
      }
    }
  })

  it('keeps rooms reachable through their doors', () => {
    for (const building of campus.buildings) {
      for (let floor = 0; floor < building.floors; floor++) {
        const mesh = buildFloorNavMesh(building, floor)
        const rooms = building.rooms.filter((room) => room.floor === floor)
        const startRoom = rooms[0]
        expect(startRoom).toBeDefined()
        if (!startRoom) continue
        const start = cellAt(
          mesh,
          (startRoom.min.x + startRoom.max.x) / 2,
          (startRoom.min.z + startRoom.max.z) / 2,
        )
        expect(start).not.toBeNull()
        if (!start) continue
        const reachable = reachableCells(mesh, start)
        for (const room of rooms) {
          const cell = cellAt(mesh, (room.min.x + room.max.x) / 2, (room.min.z + room.max.z) / 2)
          if (!cell) continue
          expect(reachable.has(`${cell.gx},${cell.gz}`)).toBe(true)
        }
      }
    }
  })

  it('blocks the corridor wall outside door openings', () => {
    const building = campus.buildings[0]
    expect(building).toBeDefined()
    if (!building) return
    const mesh = buildFloorNavMesh(building, 0)
    // z = +1.5 is the north corridor wall; far from any door x = 11.5.
    const blocked = cellAt(mesh, 11.5, 1.5)
    expect(blocked).not.toBeNull()
    if (blocked) expect(mesh.walkable[blocked.gz]?.[blocked.gx]).toBe(false)
  })
})
