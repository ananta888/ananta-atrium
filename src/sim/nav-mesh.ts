import type { BuildingDef } from '../shared/campus.js'

/**
 * Walkable-grid navmesh per floor. It is the geometric truth used to validate
 * room/door connectivity; the navigation graph in `nav-graph.ts` is a sparse
 * skeleton over the same data for cheap path queries and debug rendering.
 */
export interface FloorNavMesh {
  buildingId: string
  floor: number
  cellSize: number
  minX: number
  minZ: number
  width: number
  height: number
  walkable: boolean[][]
}

const CORRIDOR_HALF = 1.5

export function buildFloorNavMesh(building: BuildingDef, floor: number, cellSize = 0.5): FloorNavMesh {
  const width = Math.ceil(building.width / cellSize)
  const height = Math.ceil(building.depth / cellSize)
  const minX = -building.width / 2
  const minZ = -building.depth / 2
  const walkable: boolean[][] = []

  const doors = building.rooms
    .filter((room) => room.floor === floor)
    .map((room) => ({ x: (room.min.x + room.max.x) / 2, half: 0.9 }))

  for (let gz = 0; gz < height; gz++) {
    const row: boolean[] = []
    for (let gx = 0; gx < width; gx++) {
      const x = minX + (gx + 0.5) * cellSize
      const z = minZ + (gz + 0.5) * cellSize
      let open = Math.abs(x) < building.width / 2 - cellSize && Math.abs(z) < building.depth / 2 - cellSize
      // The corridor walls block movement except through a room door.
      const onWall = Math.abs(Math.abs(z) - CORRIDOR_HALF) < cellSize / 2
      if (open && onWall) {
        open = doors.some((door) => Math.abs(x - door.x) < door.half)
      }
      row.push(open)
    }
    walkable.push(row)
  }

  return { buildingId: building.id, floor, cellSize, minX, minZ, width, height, walkable }
}

export function cellAt(mesh: FloorNavMesh, x: number, z: number): { gx: number; gz: number } | null {
  const gx = Math.floor((x - mesh.minX) / mesh.cellSize)
  const gz = Math.floor((z - mesh.minZ) / mesh.cellSize)
  if (gx < 0 || gz < 0 || gx >= mesh.width || gz >= mesh.height) return null
  return { gx, gz }
}

/** Flood fill used by tests to prove every room on a floor is reachable. */
export function reachableCells(mesh: FloorNavMesh, start: { gx: number; gz: number }): Set<string> {
  const seen = new Set<string>()
  const startOpen = mesh.walkable[start.gz]?.[start.gx]
  if (!startOpen) return seen
  const queue = [start]
  seen.add(`${start.gx},${start.gz}`)
  while (queue.length > 0) {
    const current = queue.pop()
    if (!current) break
    for (const [dx, dz] of [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
    ] as const) {
      const gx = current.gx + dx
      const gz = current.gz + dz
      const key = `${gx},${gz}`
      if (gx < 0 || gz < 0 || gx >= mesh.width || gz >= mesh.height) continue
      if (!mesh.walkable[gz]?.[gx] || seen.has(key)) continue
      seen.add(key)
      queue.push({ gx, gz })
    }
  }
  return seen
}
