import type { CampusDef, RoomDef } from '../shared/campus.js'
export class SceneDataError extends Error {}

function fail(message: string): never {
  throw new SceneDataError(message)
}

function assertVec(value: unknown, where: string): asserts value is { x: number; y: number; z: number } {
  if (typeof value !== 'object' || value === null) fail(`${where} must be an object`)
  const v = value as Record<string, unknown>
  for (const axis of ['x', 'y', 'z'] as const) {
    if (typeof v[axis] !== 'number' || !Number.isFinite(v[axis])) fail(`${where}.${axis} must be a number`)
  }
}

function assertRoom(room: unknown, buildingId: string, index: number): asserts room is RoomDef {
  const where = `buildings[${buildingId}].rooms[${index}]`
  if (typeof room !== 'object' || room === null) fail(`${where} must be an object`)
  const r = room as Record<string, unknown>
  if (typeof r.id !== 'string' || r.id.length === 0) fail(`${where}.id missing`)
  if (typeof r.name !== 'string') fail(`${where}.name missing`)
  if (typeof r.floor !== 'number' || !Number.isInteger(r.floor) || r.floor < 0) fail(`${where}.floor invalid`)
  if (!['office', 'meeting', 'social', 'service', 'lobby'].includes(String(r.kind))) fail(`${where}.kind invalid`)
  for (const bound of ['min', 'max'] as const) {
    const value = r[bound]
    if (typeof value !== 'object' || value === null) fail(`${where}.${bound} missing`)
    const v = value as Record<string, unknown>
    if (typeof v.x !== 'number' || typeof v.z !== 'number') fail(`${where}.${bound} needs x/z`)
  }
  if (r.buildingId !== buildingId) fail(`${where}.buildingId must be ${buildingId}`)
}

/** Validates the committed scene data at the boundary, then returns it typed. */
export function loadCampus(raw: unknown): CampusDef {
  if (typeof raw !== 'object' || raw === null) fail('scene must be an object')
  const data = raw as Record<string, unknown>
  if (data.version !== 1) fail('unsupported scene version')
  if (typeof data.name !== 'string') fail('scene.name missing')
  if (!Array.isArray(data.buildings) || data.buildings.length === 0) fail('scene.buildings missing')
  if (!Array.isArray(data.desks)) fail('scene.desks missing')

  const buildingIds = new Set<string>()
  const roomIds = new Set<string>()
  for (const [bi, building] of data.buildings.entries()) {
    if (typeof building !== 'object' || building === null) fail(`buildings[${bi}] must be an object`)
    const b = building as Record<string, unknown>
    if (typeof b.id !== 'string' || b.id.length === 0) fail(`buildings[${bi}].id missing`)
    if (buildingIds.has(b.id)) fail(`duplicate building id ${b.id}`)
    buildingIds.add(b.id)
    if (typeof b.name !== 'string') fail(`buildings[${b.id}].name missing`)
    assertVec(b.origin, `buildings[${b.id}].origin`)
    for (const key of ['width', 'depth', 'floorHeight'] as const) {
      if (typeof b[key] !== 'number' || b[key] <= 0) fail(`buildings[${b.id}].${key} invalid`)
    }
    if (typeof b.floors !== 'number' || !Number.isInteger(b.floors) || b.floors < 1) fail(`buildings[${b.id}].floors invalid`)
    for (const key of ['entrance', 'stairs'] as const) {
      const point = b[key]
      if (typeof point !== 'object' || point === null) fail(`buildings[${b.id}].${key} missing`)
      const p = point as Record<string, unknown>
      if (typeof p.x !== 'number' || typeof p.z !== 'number') fail(`buildings[${b.id}].${key} needs x/z`)
    }
    if (!Array.isArray(b.rooms) || b.rooms.length === 0) fail(`buildings[${b.id}].rooms missing`)
    for (const [ri, room] of b.rooms.entries()) {
      assertRoom(room, b.id, ri)
      if (roomIds.has(room.id)) fail(`duplicate room id ${room.id}`)
      roomIds.add(room.id)
      if (room.floor >= (b.floors as number)) fail(`room ${room.id} on non-existent floor`)
    }
  }

  const deskIds = new Set<string>()
  for (const [di, desk] of data.desks.entries()) {
    if (typeof desk !== 'object' || desk === null) fail(`desks[${di}] must be an object`)
    const d = desk as Record<string, unknown>
    if (typeof d.id !== 'string' || d.id.length === 0) fail(`desks[${di}].id missing`)
    if (deskIds.has(d.id)) fail(`duplicate desk id ${d.id}`)
    deskIds.add(d.id)
    if (typeof d.roomId !== 'string' || !roomIds.has(d.roomId)) fail(`desk ${d.id} references unknown room`)
    if (typeof d.buildingId !== 'string' || !buildingIds.has(d.buildingId)) fail(`desk ${d.id} references unknown building`)
    assertVec(d.position, `desk ${d.id}.position`)
    if (typeof d.facing !== 'number') fail(`desk ${d.id}.facing invalid`)
  }

  if (!Array.isArray(data.outdoorNodes)) fail('scene.outdoorNodes missing')
  if (!Array.isArray(data.outdoorEdges)) fail('scene.outdoorEdges missing')
  const nodeIds = new Set<string>()
  for (const [ni, node] of data.outdoorNodes.entries()) {
    if (typeof node !== 'object' || node === null) fail(`outdoorNodes[${ni}] invalid`)
    const n = node as Record<string, unknown>
    if (typeof n.id !== 'string') fail(`outdoorNodes[${ni}].id missing`)
    assertVec(n.position, `outdoorNodes[${n.id}].position`)
    nodeIds.add(n.id)
  }
  for (const edge of data.outdoorEdges) {
    if (typeof edge !== 'object' || edge === null) fail('outdoorEdges entry invalid')
    const e = edge as Record<string, unknown>
    if (typeof e.from !== 'string' || typeof e.to !== 'string') fail('outdoorEdges entry needs from/to')
    if (!nodeIds.has(e.from) || !nodeIds.has(e.to)) fail(`outdoor edge references unknown node ${e.from}->${e.to}`)
  }

  return raw as CampusDef
}
