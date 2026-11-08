import { Color3, MeshBuilder, Vector3 } from '@babylonjs/core'
import type { Scene } from '@babylonjs/core'
import type { NavGraph } from '../sim/nav-graph.js'
import { allRooms, type CampusDef } from '../shared/campus.js'
import type { Vec3 } from '../shared/campus.js'

/** Debug overlay: nav graph edges plus live agent paths. Toggle with F3. */
export class NavDebugLayer {
  private readonly scene: Scene
  private staticMesh: ReturnType<typeof MeshBuilder.CreateLineSystem> | null = null
  private pathMeshes: Array<ReturnType<typeof MeshBuilder.CreateLines>> = []
  private roomMesh: ReturnType<typeof MeshBuilder.CreateLineSystem> | null = null
  private visible = false

  constructor(scene: Scene) {
    this.scene = scene
  }

  build(graph: NavGraph, campus?: CampusDef): void {
    const lines: Vector3[][] = []
    for (const [fromId, edges] of graph.edges) {
      const from = graph.nodes.get(fromId)
      if (!from) continue
      for (const edge of edges) {
        if (fromId > edge.to) continue
        const to = graph.nodes.get(edge.to)
        if (!to) continue
        lines.push([
          new Vector3(from.position.x, from.position.y + 0.08, from.position.z),
          new Vector3(to.position.x, to.position.y + 0.08, to.position.z),
        ])
      }
    }
    this.staticMesh = MeshBuilder.CreateLineSystem('nav-graph', { lines }, this.scene)
    this.staticMesh.color = new Color3(0.3, 0.75, 0.95)
    this.staticMesh.isPickable = false
    this.staticMesh.setEnabled(this.visible)

    if (campus) {
      const outlines: Vector3[][] = []
      for (const building of campus.buildings) {
        for (const room of allRooms(campus).filter((r) => r.buildingId === building.id)) {
          const y = building.origin.y + room.floor * building.floorHeight + 0.05
          const corners = [
            new Vector3(building.origin.x + room.min.x, y, building.origin.z + room.min.z),
            new Vector3(building.origin.x + room.max.x, y, building.origin.z + room.min.z),
            new Vector3(building.origin.x + room.max.x, y, building.origin.z + room.max.z),
            new Vector3(building.origin.x + room.min.x, y, building.origin.z + room.max.z),
            new Vector3(building.origin.x + room.min.x, y, building.origin.z + room.min.z),
          ]
          outlines.push(corners)
        }
      }
      const rooms = MeshBuilder.CreateLineSystem('nav-mesh-outlines', { lines: outlines }, this.scene)
      rooms.color = new Color3(0.25, 0.55, 0.7)
      rooms.isPickable = false
      rooms.alpha = 0.65
      rooms.setEnabled(this.visible)
      this.roomMesh = rooms
    }
  }

  setVisible(visible: boolean): void {
    this.visible = visible
    this.staticMesh?.setEnabled(visible)
    this.roomMesh?.setEnabled(visible)
    for (const mesh of this.pathMeshes) mesh.setEnabled(visible)
  }

  get isVisible(): boolean {
    return this.visible
  }

  update(paths: Array<{ id: string; points: Vec3[] }>): void {
    for (const mesh of this.pathMeshes) mesh.dispose()
    this.pathMeshes = []
    if (!this.visible) return
    for (const path of paths) {
      if (path.points.length < 2) continue
      const points = path.points.map((p) => new Vector3(p.x, p.y + 0.2, p.z))
      const mesh = MeshBuilder.CreateLines(`nav-path-${path.id}`, { points }, this.scene)
      mesh.color = new Color3(1, 0.72, 0.3)
      mesh.isPickable = false
      this.pathMeshes.push(mesh)
    }
  }
}
