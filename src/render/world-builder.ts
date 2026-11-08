import {
  Color3,
  DynamicTexture,
  Material,
  Mesh,
  MeshBuilder,
  PointLight,
  StandardMaterial,
  TransformNode,
  Vector3,
} from '@babylonjs/core'
import type { AbstractMesh, BaseTexture, Scene } from '@babylonjs/core'
import type { BuildingDef, CampusDef, RoomDef, Vec3 } from '../shared/campus.js'

export interface RoomLookup {
  room: RoomDef
  buildingName: string
}

export interface CullingStats {
  visibleRooms: number
  totalRooms: number
}

export type Quality = 'low' | 'medium' | 'high'

const ROOM_ACCENTS: Record<RoomDef['kind'], Color3> = {
  office: new Color3(0.35, 0.5, 0.7),
  meeting: new Color3(0.75, 0.58, 0.3),
  social: new Color3(0.55, 0.72, 0.45),
  service: new Color3(0.55, 0.55, 0.6),
  lobby: new Color3(0.7, 0.68, 0.62),
  corridor: new Color3(0.6, 0.6, 0.62),
}

function localToWorld(origin: Vec3, x: number, y: number, z: number): Vector3 {
  return new Vector3(origin.x + x, origin.y + y, origin.z + z)
}

function box(
  scene: Scene,
  name: string,
  width: number,
  height: number,
  depth: number,
  position: Vector3,
  material: Material,
  checkCollisions = true,
): Mesh {
  const mesh = MeshBuilder.CreateBox(name, { width, height, depth }, scene)
  mesh.position = position
  mesh.material = material
  mesh.checkCollisions = checkCollisions
  return mesh
}

export class CampusWorld {
  readonly campus: CampusDef
  readonly spawn: Vector3
  private readonly scene: Scene
  private readonly root: TransformNode
  private roomMeshes = new Map<string, AbstractMesh[]>()
  private buildingMeshes = new Map<string, AbstractMesh[]>()
  private roomBuilding = new Map<string, string>()
  private activeRooms = new Set<string>()
  private loadedBuildings = new Set<string>()
  readonly roomProbes = new Map<string, { floor: number; window: number; level: number }>()
  private lastCullAt = 0
  private cullingEnabled = true

  constructor(scene: Scene, campus: CampusDef) {
    this.scene = scene
    this.campus = campus
    this.root = new TransformNode('campus', scene)
    this.buildMaterials()
    this.buildGround()
    this.buildPlaza()
    for (const building of campus.buildings) {
      this.buildBuilding(building)
      this.buildLobbyFurniture(building)
      this.buildFacadeDetails(building)
    }
    this.buildDesks()
    this.buildTrees()
    this.indexBuildingMeshes()
    this.spawn = new Vector3(4, 1.7, 40)
  }

  private indexBuildingMeshes(): void {
    for (const building of this.campus.buildings) {
      const meshes: AbstractMesh[] = []
      for (const mesh of this.scene.meshes) {
        const meta = (mesh.metadata ?? {}) as { roomId?: string; buildingId?: string }
        const belongsByName = mesh.name.startsWith(building.id)
        const belongsByMeta = meta.buildingId === building.id
        if (!belongsByName && !belongsByMeta) continue
        meshes.push(mesh)
        this.buildingMeshes.set(building.id, meshes)
        for (const room of building.rooms) {
          const byName = mesh.name.startsWith(room.id)
          const byMeta = meta.roomId === room.id
          if (!byName && !byMeta) continue
          const roomList = this.roomMeshes.get(room.id) ?? []
          if (!roomList.includes(mesh)) roomList.push(mesh)
          this.roomMeshes.set(room.id, roomList)
          this.roomBuilding.set(room.id, building.id)
        }
      }
      this.loadedBuildings.add(building.id)
    }
  }

  /** Distance streaming with hysteresis; shells are pre-built so no load hitch occurs. */
  streamBuildings(cameraPosition: Vector3, near = 70, far = 95): number {
    for (const building of this.campus.buildings) {
      const centreX = building.origin.x
      const centreZ = building.origin.z
      const distance = Math.hypot(cameraPosition.x - centreX, cameraPosition.z - centreZ)
      const loaded = this.loadedBuildings.has(building.id)
      const shouldLoad = loaded ? distance <= far : distance <= near
      if (shouldLoad === loaded) continue
      if (shouldLoad) this.loadedBuildings.add(building.id)
      else this.loadedBuildings.delete(building.id)
      for (const mesh of this.buildingMeshes.get(building.id) ?? []) mesh.setEnabled(shouldLoad)
    }
    return this.loadedBuildings.size
  }

  /**
   * Room-portal culling: the current room and rooms whose door is ahead and
   * within range stay visible. Outer shells stay for orientation.
   */
  setCullingEnabled(enabled: boolean): void {
    this.cullingEnabled = enabled
    if (!enabled) {
      for (const meshes of this.roomMeshes.values()) {
        for (const mesh of meshes) mesh.setEnabled(true)
      }
      this.activeRooms = new Set(this.roomMeshes.keys())
    }
  }

  updateCulling(cameraPosition: Vector3, forward: Vector3, quality: Quality): CullingStats {
    if (!this.cullingEnabled) {
      return { visibleRooms: this.roomMeshes.size, totalRooms: this.roomMeshes.size }
    }
    const now = performance.now()
    if (now - this.lastCullAt < 200) {
      return { visibleRooms: this.activeRooms.size, totalRooms: this.roomMeshes.size }
    }
    this.lastCullAt = now
    const radius = quality === 'low' ? 16 : quality === 'medium' ? 22 : 30
    const current = this.roomAt(cameraPosition)
    const visible = new Set<string>()
    for (const [roomId, meshes] of this.roomMeshes) {
      const buildingId = this.roomBuilding.get(roomId)
      if (!buildingId || !this.loadedBuildings.has(buildingId)) {
        for (const mesh of meshes) mesh.setEnabled(false)
        continue
      }
      const building = this.campus.buildings.find((b) => b.id === buildingId)
      const room = building?.rooms.find((r) => r.id === roomId)
      if (!building || !room) continue

      let show = roomId === current?.room.id
      if (!show) {
        const local = {
          x: (room.min.x + room.max.x) / 2,
          z: room.min.z >= 0 ? room.min.z : room.max.z,
        }
        const door = new Vector3(
          building.origin.x + local.x,
          building.origin.y + room.floor * building.floorHeight + 1,
          building.origin.z + local.z,
        )
        const toDoor = door.subtract(cameraPosition)
        const distance = toDoor.length()
        const ahead = toDoor.normalize().dot(forward) > -0.15
        show = distance < radius && ahead
      }
      visible.add(roomId)
      for (const mesh of meshes) mesh.setEnabled(show)
      if (!show) visible.delete(roomId)
    }
    this.activeRooms = visible
    return { visibleRooms: visible.size, totalRooms: this.roomMeshes.size }
  }

  get loadedBuildingCount(): number {
    return this.loadedBuildings.size
  }

  private wallMaterial!: StandardMaterial
  private floorMaterial!: StandardMaterial
  private roofMaterial!: StandardMaterial
  private groundMaterial!: StandardMaterial
  private stoneMaterial!: StandardMaterial
  private woodMaterial!: StandardMaterial
  private glassMaterial!: StandardMaterial
  private plazaMaterial!: StandardMaterial

  private makeSurfaceTexture(name: string, size: number, draw: (ctx: CanvasRenderingContext2D, size: number) => void): DynamicTexture {
    const texture = new DynamicTexture(name, { width: size, height: size }, this.scene, false)
    const context = texture.getContext() as unknown as CanvasRenderingContext2D
    draw(context, size)
    texture.update()
    return texture
  }

  private rng(seed: number): () => number {
    let state = seed >>> 0
    return () => {
      state = (Math.imul(state, 1664525) + 1013904223) >>> 0
      return state / 4294967296
    }
  }

  private buildMaterials(): void {
    const solid = (name: string, color: Color3, specular = 0.04): StandardMaterial => {
      const material = new StandardMaterial(name, this.scene)
      material.diffuseColor = color
      material.ambientColor = color.scale(0.6)
      material.specularColor = new Color3(specular, specular, specular)
      material.maxSimultaneousLights = 8
      return material
    }
    this.wallMaterial = solid('wall', new Color3(0.84, 0.83, 0.79))
    this.floorMaterial = solid('floor', new Color3(0.42, 0.34, 0.27))
    this.roofMaterial = solid('roof', new Color3(0.24, 0.25, 0.28))
    this.groundMaterial = solid('ground', new Color3(0.22, 0.31, 0.21))
    this.stoneMaterial = solid('stone', new Color3(0.55, 0.52, 0.47))
    this.woodMaterial = solid('wood', new Color3(0.32, 0.23, 0.16))
    this.plazaMaterial = solid('plaza', new Color3(0.62, 0.6, 0.56))

    const wallTexture = this.makeSurfaceTexture('wall-texture', 256, (context, size) => {
      const random = this.rng(7)
      context.fillStyle = '#d3d1ca'
      context.fillRect(0, 0, size, size)
      for (let i = 0; i < 2600; i++) {
        const shade = 190 + Math.floor(random() * 40)
        context.fillStyle = `rgba(${shade}, ${shade - 2}, ${shade - 6}, 0.25)`
        context.fillRect(random() * size, random() * size, 1, 1)
      }
      context.strokeStyle = 'rgba(150, 148, 142, 0.5)'
      context.lineWidth = 1
      for (let x = 0; x <= size; x += 64) {
        context.beginPath()
        context.moveTo(x, 0)
        context.lineTo(x, size)
        context.stroke()
      }
    })
    wallTexture.uScale = 2
    wallTexture.vScale = 2
    this.wallMaterial.diffuseTexture = wallTexture
    this.wallMaterial.diffuseColor = new Color3(1, 1, 1)

    const floorTexture = this.makeSurfaceTexture('floor-texture', 512, (context, size) => {
      const random = this.rng(11)
      context.fillStyle = '#9a6f47'
      context.fillRect(0, 0, size, size)
      const plank = 64
      for (let y = 0; y < size; y += plank) {
        const tint = 0.85 + random() * 0.25
        context.fillStyle = `rgb(${Math.floor(122 * tint)}, ${Math.floor(87 * tint)}, ${Math.floor(56 * tint)})`
        context.fillRect(0, y, size, plank - 2)
        context.strokeStyle = 'rgba(45, 30, 18, 0.55)'
        context.beginPath()
        context.moveTo(0, y + plank - 1)
        context.lineTo(size, y + plank - 1)
        context.stroke()
        for (let i = 0; i < 60; i++) {
          context.strokeStyle = `rgba(60, 40, 24, ${0.08 + random() * 0.12})`
          const offset = random() * size
          context.beginPath()
          context.moveTo(offset, y + random() * plank)
          context.bezierCurveTo(offset + 40, y + random() * plank, offset + 80, y + random() * plank, offset + 130, y + random() * plank)
          context.stroke()
        }
      }
    })
    floorTexture.uScale = 3
    floorTexture.vScale = 3
    this.floorMaterial.diffuseTexture = floorTexture
    this.floorMaterial.diffuseColor = new Color3(1, 1, 1)

    const groundTexture = this.makeSurfaceTexture('ground-texture', 512, (context, size) => {
      const random = this.rng(23)
      context.fillStyle = '#6f9a58'
      context.fillRect(0, 0, size, size)
      for (let i = 0; i < 9000; i++) {
        const green = 70 + Math.floor(random() * 70)
        context.fillStyle = `rgba(${Math.floor(green * 0.65)}, ${green}, ${Math.floor(green * 0.55)}, 0.25)`
        const radius = 0.7 + random() * 2.2
        context.beginPath()
        context.arc(random() * size, random() * size, radius, 0, Math.PI * 2)
        context.fill()
      }
    })
    groundTexture.uScale = 28
    groundTexture.vScale = 28
    this.groundMaterial.diffuseTexture = groundTexture
    this.groundMaterial.diffuseColor = new Color3(1, 1, 1)

    const woodTexture = this.makeSurfaceTexture('wood-texture', 256, (context, size) => {
      const random = this.rng(31)
      context.fillStyle = '#865c39'
      context.fillRect(0, 0, size, size)
      for (let i = 0; i < 90; i++) {
        context.strokeStyle = `rgba(${40 + random() * 40}, ${25 + random() * 30}, ${15 + random() * 20}, ${0.15 + random() * 0.25})`
        context.lineWidth = 0.6 + random() * 1.6
        context.beginPath()
        const y = random() * size
        context.moveTo(0, y)
        context.bezierCurveTo(size * 0.3, y + random() * 8, size * 0.6, y - random() * 8, size, y + random() * 6)
        context.stroke()
      }
    })
    this.woodMaterial.diffuseTexture = woodTexture
    this.woodMaterial.diffuseColor = new Color3(1, 1, 1)

    const plazaTexture = this.makeSurfaceTexture('plaza-texture', 512, (context, size) => {
      const random = this.rng(43)
      context.fillStyle = '#c2bdb4'
      context.fillRect(0, 0, size, size)
      const tile = 64
      for (let y = 0; y < size; y += tile) {
        for (let x = 0; x < size; x += tile) {
          const shade = 170 + Math.floor(random() * 30)
          context.fillStyle = `rgb(${shade}, ${shade - 3}, ${shade - 8})`
          context.fillRect(x + 2, y + 2, tile - 4, tile - 4)
        }
      }
      context.strokeStyle = 'rgba(60, 58, 54, 0.5)'
      context.lineWidth = 2
      for (let i = 0; i <= size; i += tile) {
        context.beginPath()
        context.moveTo(i, 0)
        context.lineTo(i, size)
        context.stroke()
        context.beginPath()
        context.moveTo(0, i)
        context.lineTo(size, i)
        context.stroke()
      }
    })
    plazaTexture.uScale = 6
    plazaTexture.vScale = 6
    this.plazaMaterial.diffuseTexture = plazaTexture
    this.plazaMaterial.diffuseColor = new Color3(1, 1, 1)

    const glass = new StandardMaterial('glass', this.scene)
    glass.diffuseColor = new Color3(0.2, 0.32, 0.4)
    glass.emissiveColor = new Color3(0.55, 0.72, 0.92)
    glass.disableLighting = true
    glass.specularColor = new Color3(0.6, 0.7, 0.8)
    glass.alpha = 0.4
    glass.transparencyMode = Material.MATERIAL_ALPHABLEND
    glass.maxSimultaneousLights = 8
    this.glassMaterial = glass
  }

  setPlazaTexture(texture: BaseTexture): void {
    this.plazaMaterial.diffuseTexture = texture
  }

  private buildGround(): void {
    const ground = MeshBuilder.CreateGround('ground', { width: 240, height: 240 }, this.scene)
    ground.material = this.groundMaterial
    ground.metadata = { walkable: true }
    ground.receiveShadows = true
    ground.parent = this.root
  }

  private buildPlaza(): void {
    const plaza = MeshBuilder.CreateCylinder(
      'plaza',
      { diameter: 30, height: 0.16, tessellation: 48 },
      this.scene,
    )
    plaza.position = new Vector3(4, 0.08, 20)
    plaza.material = this.plazaMaterial
    plaza.metadata = { walkable: true }
    plaza.parent = this.root

    const ring = MeshBuilder.CreateTorus('plaza-ring', { diameter: 31, thickness: 0.3, tessellation: 64 }, this.scene)
    ring.position = new Vector3(4, 0.14, 20)
    ring.material = this.woodMaterial
    ring.parent = this.root

    for (let i = 0; i < 8; i++) {
      const angle = (i / 8) * Math.PI * 2
      const px = 4 + Math.cos(angle) * 11
      const pz = 20 + Math.sin(angle) * 11
      const pot = MeshBuilder.CreateCylinder(`planter-${i}`, { height: 0.7, diameterTop: 1.1, diameterBottom: 0.85 }, this.scene)
      pot.position = new Vector3(px, 0.35, pz)
      pot.material = this.stoneMaterial
      pot.parent = this.root
      const bush = MeshBuilder.CreateSphere(`planter-bush-${i}`, { diameter: 1.4, segments: 8 }, this.scene)
      bush.position = new Vector3(px, 1.15, pz)
      const bushMaterial = new StandardMaterial(`planter-green-${i}`, this.scene)
      bushMaterial.diffuseColor = new Color3(0.2, 0.42, 0.24)
      bushMaterial.specularColor = new Color3(0.02, 0.02, 0.02)
      bush.material = bushMaterial
      bush.parent = this.root
    }
    for (let i = 0; i < 3; i++) {
      const angle = 0.5 + (i / 3) * Math.PI * 2
      const bench = MeshBuilder.CreateBox(`bench-${i}`, { width: 3.2, height: 0.42, depth: 0.7 }, this.scene)
      bench.position = new Vector3(4 + Math.cos(angle) * 12.5, 0.24, 20 + Math.sin(angle) * 12.5)
      bench.rotation.y = -angle
      bench.material = this.woodMaterial
      bench.checkCollisions = true
      bench.parent = this.root
    }
    for (const [index, angle] of [0.4, 2.6].entries()) {
      const light = new PointLight(`plaza-light-${index}`, new Vector3(4 + Math.cos(angle) * 9, 3.4, 20 + Math.sin(angle) * 9), this.scene)
      light.diffuse = new Color3(1, 0.85, 0.62)
      light.intensity = 0.7
      light.range = 18
    }
    for (let i = 0; i < 6; i++) {
      const angle = (i / 6) * Math.PI * 2
      const lamp = MeshBuilder.CreateCylinder('lamp-post', { height: 3.2, diameter: 0.12 }, this.scene)
      lamp.position = new Vector3(4 + Math.cos(angle) * 13, 1.6, 20 + Math.sin(angle) * 13)
      lamp.material = this.roofMaterial
      lamp.parent = this.root
      const bulb = MeshBuilder.CreateSphere('lamp-bulb', { diameter: 0.35 }, this.scene)
      bulb.position = lamp.position.add(new Vector3(0, 1.7, 0))
      const bulbMaterial = new StandardMaterial('lamp-glow', this.scene)
      bulbMaterial.emissiveColor = new Color3(1, 0.82, 0.55)
      bulbMaterial.disableLighting = true
      bulb.material = bulbMaterial
      bulb.parent = this.root
    }
  }

  private buildBuilding(building: BuildingDef): void {
    const { origin, width, depth, floorHeight, floors } = building
    const halfW = width / 2
    const halfD = depth / 2

    for (let floor = 0; floor < floors; floor++) {
      const baseY = floor * floorHeight
      // Floor slab, with a stairwell opening on upper floors.
      if (floor === 0) {
        this.slab(building, -halfW, halfW, -halfD, halfD, baseY - 0.1, 'slab')
      } else {
        const holeMinX = building.stairs.x - 5.4
        const holeMaxX = building.stairs.x - 0.2
        this.slab(building, -halfW, holeMinX, -halfD, halfD, baseY - 0.1, 'slab-a')
        this.slab(building, holeMinX, holeMaxX, -halfD, -1.4, baseY - 0.1, 'slab-b')
        this.slab(building, holeMinX, holeMaxX, 1.4, halfD, baseY - 0.1, 'slab-c')
        this.slab(building, holeMaxX, halfW, -halfD, halfD, baseY - 0.1, 'slab-landing')
      }

      this.outerWalls(building, floor)
      this.windows(building, floor)
      this.corridor(building, floor)
      this.roomAccents(building, floor)
      if (floor < floors - 1) this.staircase(building, floor)
    }

    const sign = this.makeSign(building)
    sign.position = localToWorld(origin, building.entrance.x, 3.55, halfD + 0.14)
    sign.parent = this.root

    const interior = new PointLight(
      `${building.id}-interior`,
      localToWorld(origin, 0, Math.min(3.2, floors * floorHeight - 0.8), 0),
      this.scene,
    )
    interior.intensity = 1.6
    interior.radius = 0.5
    interior.range = Math.max(width, depth) * 1.3
    interior.diffuse = new Color3(1, 0.86, 0.66)

    const roofY = floors * floorHeight
    this.slab(building, -halfW, halfW, -halfD, halfD, roofY + 0.1, 'roof', this.roofMaterial)
    const parapetHeight = 0.6
    for (const [name, x, z, w, d] of [
      ['parapet-n', 0, halfD, width, 0.25],
      ['parapet-s', 0, -halfD, width, 0.25],
      ['parapet-e', halfW, 0, 0.25, depth],
      ['parapet-w', -halfW, 0, 0.25, depth],
    ] as const) {
      box(
        this.scene,
        `${building.id}-${name}`,
        w,
        parapetHeight,
        d,
        localToWorld(origin, x, roofY + parapetHeight / 2, z),
        this.roofMaterial,
        false,
      ).parent = this.root
    }
  }

  private makeSign(building: BuildingDef): Mesh {
    const texture = new DynamicTexture(`sign-texture-${building.id}`, { width: 512, height: 128 }, this.scene, false)
    const context = texture.getContext() as unknown as CanvasRenderingContext2D
    context.clearRect(0, 0, 512, 128)
    context.fillStyle = 'rgba(12, 16, 23, 0.0)'
    context.fillRect(0, 0, 512, 128)
    context.fillStyle = '#f2f5f9'
    context.font = '600 54px Inter, system-ui, sans-serif'
    context.textAlign = 'center'
    context.textBaseline = 'middle'
    context.fillText(building.name.toUpperCase(), 256, 66)
    texture.update()

    const material = new StandardMaterial(`sign-material-${building.id}`, this.scene)
    material.diffuseTexture = texture
    material.emissiveColor = new Color3(1, 1, 1)
    material.opacityTexture = texture
    material.disableLighting = true
    material.backFaceCulling = false
    material.useAlphaFromDiffuseTexture = true

    const plane = MeshBuilder.CreatePlane(`sign-${building.id}`, { width: 7, height: 1.75 }, this.scene)
    plane.material = material
    plane.isPickable = false
    plane.rotation.y = Math.PI
    return plane
  }

  private slab(
    building: BuildingDef,
    minX: number,
    maxX: number,
    minZ: number,
    maxZ: number,
    y: number,
    suffix: string,
    material: Material = this.floorMaterial,
  ): void {
    const width = maxX - minX
    const depth = maxZ - minZ
    if (width <= 0 || depth <= 0) return
    const mesh = box(
      this.scene,
      `${building.id}-${suffix}`,
      width,
      0.2,
      depth,
      localToWorld(building.origin, (minX + maxX) / 2, y, (minZ + maxZ) / 2),
      material,
      false,
    )
    mesh.metadata = { walkable: true }
    mesh.parent = this.root
  }

  private outerWalls(building: BuildingDef, floor: number): void {
    const { origin, width, depth, floorHeight } = building
    const halfW = width / 2
    const halfD = depth / 2
    const height = 3.2
    const y = floor * floorHeight + height / 2
    const t = 0.24

    const wall = (name: string, w: number, d: number, x: number, z: number): void => {
      const mesh = box(this.scene, `${building.id}-${floor}-${name}`, w, height, d, localToWorld(origin, x, y, z), this.wallMaterial)
      mesh.parent = this.root
    }

    wall('wall-w', t, depth, -halfW, 0)
    wall('wall-e', t, depth, halfW, 0)
    wall('wall-s', width, t, 0, -halfD)

    if (floor === 0) {
      // Entrance gap in the north wall, centred on the lobby door.
      const gap = 3
      const segment = (width - gap) / 2
      const entranceX = building.entrance.x
      wall('wall-n-a', segment, t, -halfW + segment / 2, halfD)
      wall('wall-n-b', segment, t, halfW - segment / 2, halfD)
      if (entranceX !== 0) {
        // Non-centred entrances still get a full wall; they are rare in the data.
        wall('wall-n-fill', gap, t, 0, halfD)
      }
    } else {
      wall('wall-n', width, t, 0, halfD)
    }
  }

  private windows(building: BuildingDef, floor: number): void {
    const { origin, width, depth, floorHeight } = building
    const halfW = width / 2
    const halfD = depth / 2
    const y = floor * floorHeight + 2.1
    const height = 1.1

    const strip = (name: string, w: number, d: number, x: number, z: number): void => {
      const mesh = box(this.scene, name, w, height, d, localToWorld(origin, x, y, z), this.glassMaterial, false)
      mesh.parent = this.root
    }
    strip(`${building.id}-${floor}-win-n`, width - 1.6, 0.06, 0, halfD + 0.16)
    strip(`${building.id}-${floor}-win-s`, width - 1.6, 0.06, 0, -halfD - 0.16)
    strip(`${building.id}-${floor}-win-w`, 0.06, depth - 1.6, -halfW - 0.16, 0)
    strip(`${building.id}-${floor}-win-e`, 0.06, depth - 1.6, halfW + 0.16, 0)
  }

  private corridor(building: BuildingDef, floor: number): void {
    const { origin, width, floorHeight } = building
    const y = floor * floorHeight + 0.02
    const corridor = box(
      this.scene,
      `${building.id}-${floor}-corridor`,
      width - 0.4,
      0.04,
      2.8,
      localToWorld(origin, 0, y, 0),
      this.stoneMaterial,
      false,
    )
    corridor.parent = this.root

    for (const room of building.rooms.filter((r) => r.floor === floor)) {
      const north = room.min.z >= 0
      const wallZ = north ? room.min.z : room.max.z
      const centreX = (room.min.x + room.max.x) / 2
      const doorWidth = 1.8
      const wallHeight = 3.2
      const wallY = floor * floorHeight + wallHeight / 2
      const leftWidth = centreX - doorWidth / 2 - room.min.x
      const rightWidth = room.max.x - (centreX + doorWidth / 2)

      const wallTint = new StandardMaterial(`wall-tint-${room.id}`, this.scene)
      wallTint.diffuseColor = Color3.Lerp(new Color3(0.82, 0.82, 0.79), ROOM_ACCENTS[room.kind], 0.16)
      wallTint.ambientColor = wallTint.diffuseColor.scale(0.5)
      wallTint.specularColor = new Color3(0.04, 0.04, 0.04)
      const add = (suffix: string, w: number, x: number): void => {
        if (w <= 0.05) return
        const mesh = box(
          this.scene,
          `${room.id}-${suffix}`,
          w,
          wallHeight,
          0.16,
          localToWorld(origin, x, wallY, wallZ),
          wallTint,
        )
        mesh.parent = this.root
      }
      add('corridor-wall-l', leftWidth, room.min.x + leftWidth / 2)
      add('corridor-wall-r', rightWidth, centreX + doorWidth / 2 + rightWidth / 2)
    }
  }

  private roomAccents(building: BuildingDef, floor: number): void {
    for (const room of building.rooms.filter((r) => r.floor === floor)) {
      const w = room.max.x - room.min.x - 0.6
      const d = room.max.z - room.min.z - 0.6
      if (w <= 0 || d <= 0) continue
      // Baked light-probe approximation: rooms near windows and lower floors
      // receive more light. No realtime shadow maps are used indoors.
      const windowFactor = room.min.z >= 0 || room.max.z <= 0 ? 1 : 0.55
      const level = Math.max(0.25, (0.55 + windowFactor * 0.45) * (1 - room.floor * 0.08))
      this.roomProbes.set(room.id, { floor: room.floor, window: windowFactor, level })

      const lightMaterial = new StandardMaterial(`ceiling-light-${room.id}`, this.scene)
      lightMaterial.emissiveColor = new Color3(1, 0.92, 0.76).scale(level)
      lightMaterial.diffuseColor = new Color3(1, 0.95, 0.85)
      lightMaterial.disableLighting = true

      const accentMaterial = new StandardMaterial(`accent-${room.id}`, this.scene)
      accentMaterial.diffuseColor = ROOM_ACCENTS[room.kind]
      accentMaterial.emissiveColor = ROOM_ACCENTS[room.kind].scale(0.18 + level * 0.12)
      accentMaterial.alpha = 0.55
      accentMaterial.transparencyMode = Material.MATERIAL_ALPHABLEND
      const ceiling = box(
        this.scene,
        `${room.id}-ceiling`,
        w + 0.2,
        0.06,
        d + 0.2,
        localToWorld(
          building.origin,
          (room.min.x + room.max.x) / 2,
          floor * building.floorHeight + 3.16,
          (room.min.z + room.max.z) / 2,
        ),
        this.wallMaterial,
        false,
      )
      ceiling.parent = this.root

      const strip = box(
        this.scene,
        `${room.id}-accent`,
        w,
        0.03,
        d,
        localToWorld(building.origin, (room.min.x + room.max.x) / 2, floor * building.floorHeight + 0.05, (room.min.z + room.max.z) / 2),
        accentMaterial,
        false,
      )
      strip.parent = this.root

      const panel = box(
        this.scene,
        `${room.id}-ceiling-light`,
        Math.min(2.4, w * 0.5),
        0.04,
        Math.min(1.2, d * 0.4),
        localToWorld(
          building.origin,
          (room.min.x + room.max.x) / 2,
          floor * building.floorHeight + 3.05,
          (room.min.z + room.max.z) / 2,
        ),
        lightMaterial,
        false,
      )
      panel.parent = this.root

      this.buildDoorDetails(building, room)
      this.buildRoomFurniture(building, room, w)
    }
  }

  private buildDoorDetails(building: BuildingDef, room: RoomDef): void {
    const north = room.min.z >= 0
    const wallZ = north ? room.min.z : room.max.z
    const centreX = (room.min.x + room.max.x) / 2
    const doorHalf = 0.9
    const frameMaterial = this.woodMaterial
    const jambHeight = 2.55

    for (const x of [centreX - doorHalf - 0.07, centreX + doorHalf + 0.07]) {
      const jamb = box(
        this.scene,
        `${room.id}-door-jamb`,
        0.14,
        jambHeight,
        0.22,
        localToWorld(building.origin, x, room.floor * building.floorHeight + jambHeight / 2, wallZ),
        frameMaterial,
        false,
      )
      jamb.parent = this.root
    }
    const lintel = box(
      this.scene,
      `${room.id}-door-lintel`,
      doorHalf * 2 + 0.28,
      0.18,
      0.22,
      localToWorld(building.origin, centreX, room.floor * building.floorHeight + 2.66, wallZ),
      frameMaterial,
      false,
    )
    lintel.parent = this.root

    const baseboard = box(
      this.scene,
      `${room.id}-baseboard`,
      room.max.x - room.min.x,
      0.18,
      0.26,
      localToWorld(building.origin, centreX, room.floor * building.floorHeight + 0.1, wallZ),
      frameMaterial,
      false,
    )
    baseboard.parent = this.root

    const texture = new DynamicTexture(`room-sign-${room.id}`, { width: 256, height: 64 }, this.scene, false)
    const context = texture.getContext() as unknown as CanvasRenderingContext2D
    context.fillStyle = 'rgba(10, 14, 20, 0.92)'
    context.fillRect(0, 0, 256, 64)
    context.strokeStyle = 'rgba(180, 200, 220, 0.35)'
    context.lineWidth = 3
    context.strokeRect(2, 2, 252, 60)
    context.fillStyle = '#e9eef5'
    context.font = '600 28px Inter, system-ui, sans-serif'
    context.textAlign = 'center'
    context.textBaseline = 'middle'
    context.fillText(room.name, 128, 33)
    texture.update()

    const signMaterial = new StandardMaterial(`room-sign-material-${room.id}`, this.scene)
    signMaterial.emissiveTexture = texture
    signMaterial.opacityTexture = texture
    signMaterial.diffuseColor = new Color3(0, 0, 0)
    signMaterial.disableLighting = true
    signMaterial.backFaceCulling = true
    signMaterial.useAlphaFromDiffuseTexture = true

    const sign = MeshBuilder.CreatePlane(`room-sign-${room.id}`, { width: 1.55, height: 0.38 }, this.scene)
    sign.material = signMaterial
    sign.isPickable = false
    sign.rotation.y = north ? 0 : Math.PI
    sign.position = localToWorld(
      building.origin,
      centreX,
      room.floor * building.floorHeight + 2.98,
      wallZ + (north ? -0.16 : 0.16),
    )
    sign.parent = this.root
  }

  private buildRoomFurniture(building: BuildingDef, room: RoomDef, w: number): void {
    const baseY = room.floor * building.floorHeight
    const cx = (room.min.x + room.max.x) / 2
    const cz = (room.min.z + room.max.z) / 2

    if (room.kind === 'meeting') {
      const parts: Mesh[] = []
      const table = MeshBuilder.CreateBox(`${room.id}-table`, { width: Math.min(3.4, w - 1), height: 0.08, depth: 1.3 }, this.scene)
      table.position = localToWorld(building.origin, cx, baseY + 0.76, cz)
      table.material = this.woodMaterial
      parts.push(table)
      for (const [dx, dz] of [
        [-1.1, -0.85],
        [0, -0.85],
        [1.1, -0.85],
        [-1.1, 0.85],
        [0, 0.85],
        [1.1, 0.85],
      ] as const) {
        const chair = MeshBuilder.CreateBox(`${room.id}-chair`, { width: 0.42, height: 0.46, depth: 0.42 }, this.scene)
        chair.position = localToWorld(building.origin, cx + dx, baseY + 0.24, cz + dz)
        chair.material = this.stoneMaterial
        parts.push(chair)
      }
      const merged = Mesh.MergeMeshes(parts, true, true, undefined, false, false)
      if (merged) {
        merged.name = `${room.id}-meeting-furniture`
        merged.parent = this.root
      }
    } else if (room.kind === 'office') {
      const outerZ = room.min.z >= 0 ? room.max.z : room.min.z
      const cabinet = box(
        this.scene,
        `${room.id}-cabinet`,
        Math.min(2.4, w - 1),
        1.75,
        0.45,
        localToWorld(building.origin, cx, baseY + 0.9, outerZ + (room.min.z >= 0 ? -0.35 : 0.35)),
        this.woodMaterial,
        true,
      )
      cabinet.parent = this.root
    } else if (room.kind === 'social') {
      const counter = box(
        this.scene,
        `${room.id}-counter`,
        Math.min(3, w - 1),
        1.05,
        0.7,
        localToWorld(building.origin, cx, baseY + 0.55, cz),
        this.woodMaterial,
        true,
      )
      counter.parent = this.root
      const plant = this.makePlant(`${room.id}-plant`, building, cx + 1.1, baseY, cz + 0.9)
      plant.parent = this.root
    } else if (room.kind === 'lobby' || room.kind === 'service') {
      const plant = this.makePlant(`${room.id}-plant`, building, room.min.x + 0.9, baseY, room.min.z + 0.9)
      plant.parent = this.root
    }
  }

  private makePlant(name: string, building: BuildingDef, x: number, baseY: number, z: number): Mesh {
    const pot = MeshBuilder.CreateCylinder(`${name}-pot`, { height: 0.5, diameterTop: 0.45, diameterBottom: 0.35 }, this.scene)
    pot.position = localToWorld(building.origin, x, baseY + 0.25, z)
    pot.material = this.stoneMaterial
    const leaves = MeshBuilder.CreateSphere(`${name}-leaves`, { diameter: 0.9, segments: 8 }, this.scene)
    leaves.position = localToWorld(building.origin, x, baseY + 0.95, z)
    const green = new StandardMaterial(`${name}-green`, this.scene)
    green.diffuseColor = new Color3(0.18, 0.4, 0.22)
    green.specularColor = new Color3(0.02, 0.02, 0.02)
    leaves.material = green
    const merged = Mesh.MergeMeshes([pot, leaves], true, true, undefined, false, false)
    if (merged) {
      merged.name = `${name}-plant`
      return merged
    }
    return pot
  }

  private buildFacadeDetails(building: BuildingDef): void {
    const { origin, width, depth, floorHeight, floors } = building
    const halfW = width / 2
    const halfD = depth / 2
    const dark = new StandardMaterial(`mullion-${building.id}`, this.scene)
    dark.diffuseColor = new Color3(0.16, 0.17, 0.2)
    dark.specularColor = new Color3(0.05, 0.05, 0.05)

    const mullions: Mesh[] = []
    for (let floor = 0; floor < floors; floor++) {
      const y = floor * floorHeight + 1.6
      for (let i = -3; i <= 3; i++) {
        const x = (i / 3) * (halfW - 1.2)
        for (const z of [halfD + 0.2, -halfD - 0.2]) {
          const bar = MeshBuilder.CreateBox(`${building.id}-mullion`, { width: 0.14, height: 3.2, depth: 0.14 }, this.scene)
          bar.position = localToWorld(origin, x, y, z)
          bar.material = dark
          mullions.push(bar)
        }
      }
    }
    const merged = Mesh.MergeMeshes(mullions, true, true, undefined, false, false)
    if (merged) {
      merged.name = `${building.id}-mullions`
      merged.isPickable = false
      merged.parent = this.root
    }

    const bands = MeshBuilder.CreateBox(`${building.id}-floor-band`, { width: width + 0.5, height: 0.22, depth: 0.16 }, this.scene)
    bands.position = localToWorld(origin, 0, floorHeight, halfD + 0.18)
    bands.material = dark
    bands.isPickable = false
    bands.parent = this.root
    const bandsSouth = bands.clone(`${building.id}-floor-band-s`)
    bandsSouth.position.z = origin.z - halfD - 0.18
    bandsSouth.parent = this.root

    const canopy = box(
      this.scene,
      `${building.id}-canopy`,
      6,
      0.2,
      3,
      localToWorld(origin, building.entrance.x, 3.3, halfD + 1.5),
      dark,
      false,
    )
    canopy.parent = this.root
    for (const x of [-2.6, 2.6]) {
      const post = box(
        this.scene,
        `${building.id}-canopy-post`,
        0.18,
        3.2,
        0.18,
        localToWorld(origin, building.entrance.x + x, 1.6, halfD + 2.8),
        dark,
        false,
      )
      post.parent = this.root
    }
    const doorGlass = box(
      this.scene,
      `${building.id}-entrance-door`,
      2.6,
      2.5,
      0.08,
      localToWorld(origin, building.entrance.x, 1.25, halfD),
      this.glassMaterial,
      false,
    )
    doorGlass.parent = this.root

    for (const [index, x] of [-5, 5].entries()) {
      const unit = box(
        this.scene,
        `${building.id}-roof-unit-${index}`,
        2.4,
        0.8,
        1.8,
        localToWorld(origin, x, floors * floorHeight + 0.5, 0),
        this.roofMaterial,
        false,
      )
      unit.parent = this.root
    }
  }

  private buildLobbyFurniture(building: BuildingDef): void {
    const counter = box(
      this.scene,
      `${building.id}-reception`,
      4.2,
      1.05,
      0.8,
      localToWorld(building.origin, -2.8, 0.55, 2.4),
      this.woodMaterial,
      true,
    )
    counter.parent = this.root

    for (const [x, z] of [
      [8.2, -3.2],
      [9.6, -4.2],
    ] as const) {
      const sofa = box(
        this.scene,
        `${building.id}-sofa`,
        1.6,
        0.55,
        0.8,
        localToWorld(building.origin, x, 0.3, z),
        this.stoneMaterial,
        true,
      )
      sofa.parent = this.root
    }
  }

  private staircase(building: BuildingDef, floor: number): void {
    const { origin, floorHeight } = building
    const startX = building.stairs.x - 5.2
    const run = 5
    const steps = 14
    const stepDepth = run / steps
    const rise = floorHeight / steps
    const baseY = floor * floorHeight

    for (let i = 0; i < steps; i++) {
      const step = box(
        this.scene,
        `${building.id}-${floor}-step-${i}`,
        stepDepth + 0.02,
        rise,
        2.5,
        localToWorld(origin, startX + (i + 0.5) * stepDepth, baseY + (i + 0.5) * rise, building.stairs.z),
        this.stoneMaterial,
        false,
      )
      step.parent = this.root
    }

    const ramp = MeshBuilder.CreateBox(`${building.id}-${floor}-ramp`, { width: Math.hypot(run, floorHeight), height: 0.25, depth: 2.5 }, this.scene)
    ramp.position = localToWorld(origin, startX + run / 2, baseY + floorHeight / 2, building.stairs.z)
    ramp.rotation.z = Math.atan2(floorHeight, run)
    ramp.visibility = 0
    ramp.isVisible = false
    ramp.checkCollisions = false
    ramp.material = this.stoneMaterial
    ramp.parent = this.root
  }

  private buildDesks(): void {
    const template = this.mergeDeskTemplate()
    template.isVisible = false
    template.checkCollisions = true
    template.parent = this.root

    for (const desk of this.campus.desks) {
      const building = this.campus.buildings.find((b) => b.id === desk.buildingId)
      if (!building) continue
      const instance = template.createInstance(`desk-${desk.id}`)
      instance.position = localToWorld(building.origin, desk.position.x, desk.position.y, desk.position.z)
      instance.rotation.y = desk.facing
      instance.checkCollisions = true
      instance.metadata = { roomId: desk.roomId, buildingId: desk.buildingId }
      instance.parent = this.root
    }
  }

  private mergeDeskTemplate(): Mesh {
    const parts: Mesh[] = []
    const top = MeshBuilder.CreateBox('desk-top', { width: 1.5, height: 0.06, depth: 0.75 }, this.scene)
    top.position.y = 0.74
    parts.push(top)
    for (const [x, z] of [
      [-0.68, -0.31],
      [0.68, -0.31],
      [-0.68, 0.31],
      [0.68, 0.31],
    ] as const) {
      const leg = MeshBuilder.CreateBox('desk-leg', { width: 0.06, height: 0.72, depth: 0.06 }, this.scene)
      leg.position.set(x, 0.36, z)
      parts.push(leg)
    }
    for (const part of parts) part.material = this.woodMaterial
    const merged = Mesh.MergeMeshes(parts, true, true, undefined, false, false)
    if (!merged) throw new Error('failed to merge desk template')
    merged.name = 'desk-template'
    return merged
  }

  private buildTrees(): void {
    const positions: Array<[number, number]> = []
    for (let i = 0; i < 16; i++) {
      const angle = (i / 16) * Math.PI * 2
      positions.push([4 + Math.cos(angle) * 26, 20 + Math.sin(angle) * 22])
    }
    positions.push([-46, 14], [52, 14], [4, 44], [-30, 38], [34, 38])

    const trunkTemplate = MeshBuilder.CreateCylinder('tree-trunk', { height: 2.6, diameter: 0.24 }, this.scene)
    trunkTemplate.material = this.woodMaterial
    trunkTemplate.isVisible = false
    trunkTemplate.parent = this.root

    const foliageTemplate = MeshBuilder.CreateSphere('tree-foliage', { diameter: 2.6, segments: 8 }, this.scene)
    const foliageMaterial = new StandardMaterial('foliage', this.scene)
    foliageMaterial.diffuseColor = new Color3(0.16, 0.32, 0.2)
    foliageMaterial.specularColor = new Color3(0.02, 0.02, 0.02)
    foliageTemplate.material = foliageMaterial
    foliageTemplate.isVisible = false
    foliageTemplate.parent = this.root

    for (const [x, z] of positions) {
      const trunk = trunkTemplate.createInstance(`tree-trunk-${x}-${z}`)
      trunk.position = new Vector3(x, 1.3, z)
      trunk.parent = this.root
      const foliage = foliageTemplate.createInstance(`tree-foliage-${x}-${z}`)
      foliage.position = new Vector3(x, 3.2, z)
      foliage.parent = this.root
    }
  }

  /** Which room contains a world position (used by the HUD). */
  roomAt(position: Vector3): RoomLookup | null {
    for (const building of this.campus.buildings) {
      const localX = position.x - building.origin.x
      const localZ = position.z - building.origin.z
      if (Math.abs(localX) > building.width / 2 || Math.abs(localZ) > building.depth / 2) continue
      const localY = position.y - building.origin.y
      const floor = Math.max(0, Math.min(building.floors - 1, Math.floor(localY / building.floorHeight)))
      const room = building.rooms.find(
        (r) => r.floor === floor && localX >= r.min.x && localX <= r.max.x && localZ >= r.min.z && localZ <= r.max.z,
      )
      if (room) return { room, buildingName: building.name }
      const corridor = building.rooms.find((r) => r.floor === floor)
      if (corridor) return { room: { ...corridor, id: `${building.id}-corridor`, name: 'Corridor' }, buildingName: building.name }
    }
    return null
  }
}
