import type { CampusDef, RoomDef, Vec3 } from '../shared/campus.js'

export interface NavNode {
  id: string
  position: Vec3
  buildingId?: string
  floor?: number
  roomId?: string
}

export interface NavEdge {
  to: string
  cost: number
}

export interface NavGraph {
  nodes: Map<string, NavNode>
  edges: Map<string, NavEdge[]>
  roomNode: Map<string, string>
  gateNode: Map<string, string>
}

export function roomCenterWorld(buildingOrigin: Vec3, room: RoomDef, floorHeight: number): Vec3 {
  return {
    x: buildingOrigin.x + (room.min.x + room.max.x) / 2,
    y: buildingOrigin.y + room.floor * floorHeight,
    z: buildingOrigin.z + (room.min.z + room.max.z) / 2,
  }
}

export function localToWorld(origin: Vec3, local: Vec3): Vec3 {
  return { x: origin.x + local.x, y: origin.y + local.y, z: origin.z + local.z }
}

export function roomCenterLocal(room: RoomDef): Vec3 {
  return { x: (room.min.x + room.max.x) / 2, y: room.floor, z: (room.min.z + room.max.z) / 2 }
}

function addNode(graph: NavGraph, node: NavNode): void {
  graph.nodes.set(node.id, node)
  if (!graph.edges.has(node.id)) graph.edges.set(node.id, [])
}

function connect(graph: NavGraph, a: string, b: string): void {
  const na = graph.nodes.get(a)
  const nb = graph.nodes.get(b)
  if (!na || !nb) return
  const dx = na.position.x - nb.position.x
  const dy = na.position.y - nb.position.y
  const dz = na.position.z - nb.position.z
  const cost = Math.hypot(dx, dy, dz)

  const aEdges = graph.edges.get(a) ?? []
  if (!aEdges.some((e) => e.to === b)) aEdges.push({ to: b, cost })
  graph.edges.set(a, aEdges)

  const bEdges = graph.edges.get(b) ?? []
  if (!bEdges.some((e) => e.to === a)) bEdges.push({ to: a, cost })
  graph.edges.set(b, bEdges)
}

/**
 * Derives a walk graph from the campus data:
 * room centre -> corridor point -> floor hub (stairs) -> other floors / outdoors.
 * Rooms open onto the central corridor, so the straight segments stay walkable.
 */
export function buildNavGraph(campus: CampusDef): NavGraph {
  const graph: NavGraph = {
    nodes: new Map(),
    edges: new Map(),
    roomNode: new Map(),
    gateNode: new Map(),
  }

  const gateConnections: Array<{ hub: string; gate: string }> = []

  for (const building of campus.buildings) {
    for (let floor = 0; floor < building.floors; floor++) {
      const hubId = `hub:${building.id}:${floor}`
      addNode(graph, {
        id: hubId,
        position: localToWorld(building.origin, {
          x: building.stairs.x,
          y: floor * building.floorHeight,
          z: building.stairs.z,
        }),
        buildingId: building.id,
        floor,
      })
      if (floor > 0) connect(graph, hubId, `hub:${building.id}:${floor - 1}`)
    }

    for (const room of building.rooms) {
      const roomId = `room:${room.id}`
      const centre = roomCenterWorld(building.origin, room, building.floorHeight)
      addNode(graph, {
        id: roomId,
        position: centre,
        buildingId: building.id,
        floor: room.floor,
        roomId: room.id,
      })
      graph.roomNode.set(room.id, roomId)

      const corridorLocal = {
        x: (room.min.x + room.max.x) / 2,
        y: room.floor * building.floorHeight,
        z: building.stairs.z,
      }
      const corridorId = `corr:${room.id}`
      addNode(graph, {
        id: corridorId,
        position: localToWorld(building.origin, corridorLocal),
        buildingId: building.id,
        floor: room.floor,
      })
      connect(graph, roomId, corridorId)
      connect(graph, corridorId, `hub:${building.id}:${room.floor}`)
    }

    const gateId = `gate:${building.id}`
    graph.gateNode.set(building.id, gateId)
    gateConnections.push({ hub: `hub:${building.id}:0`, gate: gateId })
  }

  for (const node of campus.outdoorNodes) {
    addNode(graph, { id: node.id, position: node.position })
  }
  for (const edge of campus.outdoorEdges) {
    connect(graph, edge.from, edge.to)
  }
  for (const connection of gateConnections) {
    connect(graph, connection.hub, connection.gate)
  }

  return graph
}

export type PathFailureReason = 'unknown-start' | 'unknown-target' | 'unreachable'

export interface PathResult {
  path: string[]
  reason: 'ok' | PathFailureReason
}

/** Dijkstra with deterministic tie-breaking on node id. */
export function findPath(graph: NavGraph, startId: string, targetId: string): string[] {
  return findPathDetailed(graph, startId, targetId).path
}

export function findPathDetailed(graph: NavGraph, startId: string, targetId: string): PathResult {
  if (!graph.nodes.has(startId)) return { path: [], reason: 'unknown-start' }
  if (!graph.nodes.has(targetId)) return { path: [], reason: 'unknown-target' }

  if (startId === targetId) return { path: [startId], reason: 'ok' }

  const dist = new Map<string, number>()
  const previous = new Map<string, string>()
  const visited = new Set<string>()
  const queue: Array<{ id: string; d: number }> = [{ id: startId, d: 0 }]
  dist.set(startId, 0)

  while (queue.length > 0) {
    queue.sort((a, b) => a.d - b.d || a.id.localeCompare(b.id))
    const current = queue.shift()
    if (!current) break
    if (visited.has(current.id)) continue
    visited.add(current.id)
    if (current.id === targetId) break

    for (const edge of graph.edges.get(current.id) ?? []) {
      const next = current.d + edge.cost
      const known = dist.get(edge.to)
      if (known === undefined || next < known) {
        dist.set(edge.to, next)
        previous.set(edge.to, current.id)
        queue.push({ id: edge.to, d: next })
      }
    }
  }

  if (!previous.has(targetId)) return { path: [], reason: 'unreachable' }
  const path: string[] = [targetId]
  let cursor = targetId
  while (cursor !== startId) {
    const prev = previous.get(cursor)
    if (!prev) return { path: [], reason: 'unreachable' }
    path.push(prev)
    cursor = prev
  }
  return { path: path.reverse(), reason: 'ok' }
}
