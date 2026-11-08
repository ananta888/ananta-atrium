/** Campus layout contract: the shape of `src/world/scene.json`. */

export interface Vec2 {
  x: number
  z: number
}

export interface Vec3 {
  x: number
  y: number
  z: number
}

export type RoomKind = 'office' | 'meeting' | 'social' | 'service' | 'lobby' | 'corridor'

export interface RoomDef {
  id: string
  name: string
  buildingId: string
  floor: number
  kind: RoomKind
  /** Building-local rectangle on the XZ plane. */
  min: Vec2
  max: Vec2
}

export interface DeskDef {
  id: string
  roomId: string
  buildingId: string
  /** Building-local floor position, y is the floor height. */
  position: Vec3
  facing: number
}

export interface BuildingDef {
  id: string
  name: string
  origin: Vec3
  width: number
  depth: number
  floorHeight: number
  floors: number
  /** Building-local entrance on the ground floor. */
  entrance: Vec2
  /** Building-local stair core, shared by all floors. */
  stairs: Vec2
  rooms: RoomDef[]
}

export interface CampusDef {
  version: 1
  name: string
  buildings: BuildingDef[]
  desks: DeskDef[]
  /** Outdoor walk nodes in world space (plaza, paths). */
  outdoorNodes: Array<{ id: string; position: Vec3 }>
  outdoorEdges: Array<{ from: string; to: string }>
}

export function buildingById(campus: CampusDef, id: string): BuildingDef | undefined {
  return campus.buildings.find((b) => b.id === id)
}

export function roomById(campus: CampusDef, id: string): RoomDef | undefined {
  for (const building of campus.buildings) {
    const room = building.rooms.find((r) => r.id === id)
    if (room) return room
  }
  return undefined
}

export function deskById(campus: CampusDef, id: string): DeskDef | undefined {
  return campus.desks.find((d) => d.id === id)
}

export function desksInRoom(campus: CampusDef, roomId: string): DeskDef[] {
  return campus.desks.filter((d) => d.roomId === roomId)
}

export interface DoorPortal {
  id: string
  roomId: string
  buildingId: string
  floor: number
  /** Building-local door centre on the corridor wall. */
  position: Vec2
  width: number
}

/** Every room opens onto the central corridor through one door. */
export function doorPortals(campus: CampusDef): DoorPortal[] {
  const portals: DoorPortal[] = []
  for (const building of campus.buildings) {
    for (const room of building.rooms) {
      const north = room.min.z >= 0
      portals.push({
        id: `door:${room.id}`,
        roomId: room.id,
        buildingId: building.id,
        floor: room.floor,
        position: { x: (room.min.x + room.max.x) / 2, z: north ? room.min.z : room.max.z },
        width: 1.8,
      })
    }
  }
  return portals
}

/** Synthesized corridor room for each building floor; corridors are walkable rooms too. */
export function corridorRooms(campus: CampusDef): RoomDef[] {
  const corridors: RoomDef[] = []
  for (const building of campus.buildings) {
    for (let floor = 0; floor < building.floors; floor++) {
      corridors.push({
        id: `${building.id}-corridor-${floor}`,
        name: 'Corridor',
        buildingId: building.id,
        floor,
        kind: 'corridor',
        min: { x: -building.width / 2, z: -1.4 },
        max: { x: building.width / 2, z: 1.4 },
      })
    }
  }
  return corridors
}

/** All rooms including synthesized corridors. */
export function allRooms(campus: CampusDef): RoomDef[] {
  return [...campus.buildings.flatMap((b) => b.rooms), ...corridorRooms(campus)]
}
