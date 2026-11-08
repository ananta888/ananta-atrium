import { describe, expect, it } from 'vitest'
import { loadCampus, SceneDataError } from '../../src/world/campus-loader.js'
import sceneData from '../../src/world/scene.json'

describe('campus loader', () => {
  it('accepts the committed scene', () => {
    const campus = loadCampus(sceneData)
    expect(campus.buildings).toHaveLength(5)
    expect(campus.desks.length).toBeGreaterThan(50)
  })

  it('rejects duplicate room ids', () => {
    const broken = structuredClone(sceneData) as typeof sceneData
    const building = broken.buildings[0] as {
      rooms: Array<Record<string, unknown>>
    }
    const room = building.rooms[0] as Record<string, unknown>
    building.rooms[1] = { ...(building.rooms[1] as Record<string, unknown>), id: room.id }
    expect(() => loadCampus(broken)).toThrow(SceneDataError)
  })

  it('rejects a desk that references a missing room', () => {
    const broken = structuredClone(sceneData) as typeof sceneData
    ;(broken.desks[0] as Record<string, unknown>).roomId = 'no-such-room'
    expect(() => loadCampus(broken)).toThrow(/unknown room/)
  })
})
