import {
  Color3,
  MeshBuilder,
  StandardMaterial,
  TransformNode,
  Vector3,
} from '@babylonjs/core'
import type { Mesh, Scene } from '@babylonjs/core'
import type { AgentState, AgentStatus } from '../shared/agent-state.js'
import { hashString } from '../sim/rng.js'

interface AvatarView {
  root: TransformNode
  body: Mesh
  head: Mesh
  hair: Mesh
  eyes: Mesh[]
  mouth: Mesh
  ring: Mesh
  beacon: Mesh
  shadow: Mesh
  legs: Mesh[]
  arms: Mesh[]
  feet: Mesh[]
  phase: number
  swing: number
  bodyMaterial: StandardMaterial
  beaconMaterial: StandardMaterial
  ringMaterial: StandardMaterial
  pantsMaterial: StandardMaterial
  skinMaterial: StandardMaterial
  hairMaterial: StandardMaterial
  eyeMaterial: StandardMaterial
  lastPosition: Vector3
  initialized: boolean
}

const STATUS_COLORS: Record<AgentStatus, Color3> = {
  idle: new Color3(0.55, 0.6, 0.65),
  working: new Color3(0.38, 0.85, 0.62),
  waiting: new Color3(0.95, 0.75, 0.3),
  reviewing: new Color3(0.45, 0.7, 1),
  offline: new Color3(0.4, 0.4, 0.45),
}

const STATUS_COLORS_CB: Record<AgentStatus, Color3> = {
  idle: new Color3(0.61, 0.64, 0.69),
  working: new Color3(0.0, 0.45, 0.7),
  waiting: new Color3(0.9, 0.62, 0.0),
  reviewing: new Color3(0.34, 0.71, 0.91),
  offline: new Color3(0.4, 0.4, 0.4),
}

const SKIN_TONES = [
  new Color3(0.96, 0.8, 0.68),
  new Color3(0.87, 0.68, 0.53),
  new Color3(0.72, 0.52, 0.38),
  new Color3(0.55, 0.38, 0.28),
  new Color3(0.4, 0.27, 0.2),
]

const HAIR_COLORS = [
  new Color3(0.12, 0.1, 0.09),
  new Color3(0.28, 0.18, 0.1),
  new Color3(0.55, 0.4, 0.2),
  new Color3(0.65, 0.62, 0.58),
]

const SHIRT_COLORS = [
  new Color3(0.95, 0.46, 0.4),
  new Color3(0.25, 0.67, 0.63),
  new Color3(0.36, 0.6, 0.93),
  new Color3(0.96, 0.75, 0.35),
  new Color3(0.97, 0.6, 0.42),
  new Color3(0.6, 0.49, 0.83),
  new Color3(0.55, 0.8, 0.55),
  new Color3(0.9, 0.55, 0.68),
]

const PANTS_COLORS = [
  new Color3(0.25, 0.33, 0.46),
  new Color3(0.18, 0.22, 0.3),
  new Color3(0.45, 0.4, 0.34),
  new Color3(0.3, 0.42, 0.36),
]

function colorForAgent(id: string): Color3 {
  return pickByHash(SHIRT_COLORS, hashString(id))
}

function pickByHash<T>(items: readonly T[], seed: number): T {
  const item = items[(seed >>> 0) % items.length]
  if (item === undefined) throw new Error('empty palette')
  return item
}

export class AvatarLayer {
  private readonly scene: Scene
  private readonly views = new Map<string, AvatarView>()
  private readonly ringMaterials = new Map<AgentStatus, StandardMaterial>()
  private colorBlindSafe = false
  private reducedMotion = false

  constructor(scene: Scene) {
    this.scene = scene
    for (const [status, color] of Object.entries(STATUS_COLORS) as Array<[AgentStatus, Color3]>) {
      const material = new StandardMaterial(`ring-${status}`, scene)
      material.diffuseColor = color
      material.emissiveColor = color.scale(0.7)
      material.disableLighting = true
      this.ringMaterials.set(status, material)
    }
  }

  get count(): number {
    return this.views.size
  }

  setColorBlindSafe(enabled: boolean): void {
    this.colorBlindSafe = enabled
    const palette = enabled ? STATUS_COLORS_CB : STATUS_COLORS
    for (const [status, material] of this.ringMaterials) {
      const color = palette[status]
      material.diffuseColor = color
      material.emissiveColor = color.scale(0.7)
    }
  }

  setReducedMotion(enabled: boolean): void {
    this.reducedMotion = enabled
  }

  private createView(agent: AgentState): AvatarView {
    const root = new TransformNode(`avatar-${agent.id}`, this.scene)
    const seed = hashString(agent.id)
    const shirtColor = colorForAgent(agent.id)
    const skinColor = pickByHash(SKIN_TONES, seed >>> 3)
    const hairColor = pickByHash(HAIR_COLORS, seed >>> 7)
    const pantsColor = pickByHash(PANTS_COLORS, seed >>> 5)

    const material = (name: string, color: Color3, specular = 0.05): StandardMaterial => {
      const created = new StandardMaterial(`avatar-${name}-${agent.id}`, this.scene)
      created.diffuseColor = color
      created.specularColor = new Color3(specular, specular, specular)
      return created
    }
    const bodyMaterial = material('shirt', shirtColor)
    const pantsMaterial = material('pants', pantsColor, 0.03)
    const skinMaterial = material('skin', skinColor, 0.08)
    const hairMaterial = material('hair', hairColor, 0.02)

    const body = MeshBuilder.CreateCapsule(
      `avatar-body-${agent.id}`,
      { height: 0.58, radius: 0.28, tessellation: 12 },
      this.scene,
    )
    body.material = bodyMaterial
    body.parent = root
    body.position.y = 0.83

    const head = MeshBuilder.CreateSphere(`avatar-head-${agent.id}`, { diameter: 0.52, segments: 14 }, this.scene)
    head.material = skinMaterial
    head.parent = root
    head.position.y = 1.36

    const hair = MeshBuilder.CreateSphere(`avatar-hair-${agent.id}`, { diameter: 0.55, segments: 14 }, this.scene)
    hair.material = hairMaterial
    hair.parent = root
    hair.position.y = 1.45
    hair.scaling = new Vector3(1, 0.52, 1)

    const eyeMaterial = material('eyes', new Color3(0.12, 0.13, 0.16), 0.01)
    const eyes: Mesh[] = []
    for (const x of [-0.1, 0.1]) {
      const eye = MeshBuilder.CreateSphere(`avatar-eye-${agent.id}`, { diameter: 0.075, segments: 8 }, this.scene)
      eye.material = eyeMaterial
      eye.position.set(x, 1.38, 0.245)
      eye.parent = root
      eyes.push(eye)
    }
    const mouth = MeshBuilder.CreateBox(`avatar-mouth-${agent.id}`, { width: 0.11, height: 0.025, depth: 0.02 }, this.scene)
    mouth.material = eyeMaterial
    mouth.position.set(0, 1.27, 0.252)
    mouth.parent = root

    const legs: Mesh[] = []
    for (const x of [-0.12, 0.12]) {
      const leg = MeshBuilder.CreateCapsule(
        `avatar-leg-${agent.id}`,
        { height: 0.44, radius: 0.1, tessellation: 8 },
        this.scene,
      )
      leg.material = pantsMaterial
      leg.position.set(x, 0.28, 0)
      leg.parent = root
      legs.push(leg)
    }

    const feet: Mesh[] = []
    for (const x of [-0.12, 0.12]) {
      const foot = MeshBuilder.CreateBox(`avatar-foot-${agent.id}`, { width: 0.18, height: 0.09, depth: 0.28 }, this.scene)
      foot.material = pantsMaterial
      foot.position.set(x, 0.04, 0.06)
      foot.parent = root
      feet.push(foot)
    }

    const arms: Mesh[] = []
    for (const x of [-0.3, 0.3]) {
      const arm = MeshBuilder.CreateCapsule(
        `avatar-arm-${agent.id}`,
        { height: 0.52, radius: 0.08, tessellation: 8 },
        this.scene,
      )
      arm.material = bodyMaterial
      arm.position.set(x, 0.85, 0)
      arm.parent = root
      arms.push(arm)
    }

    const ringMaterial = this.ringMaterials.get(agent.status) ?? this.ringMaterials.get('idle')
    const ring = MeshBuilder.CreateDisc(`avatar-ring-${agent.id}`, { radius: 0.5, tessellation: 20 }, this.scene)
    ring.rotation.x = Math.PI / 2
    ring.position.y = 0.02
    ring.material = ringMaterial ?? null
    ring.isPickable = false
    ring.parent = root

    const shadowMaterial = new StandardMaterial(`avatar-shadow-${agent.id}`, this.scene)
    shadowMaterial.diffuseColor = new Color3(0, 0, 0)
    shadowMaterial.emissiveColor = new Color3(0, 0, 0)
    shadowMaterial.disableLighting = true
    shadowMaterial.alpha = 0.22
    const shadow = MeshBuilder.CreateDisc(`avatar-shadow-${agent.id}`, { radius: 0.42, tessellation: 16 }, this.scene)
    shadow.rotation.x = Math.PI / 2
    shadow.position.y = 0.012
    shadow.material = shadowMaterial
    shadow.isPickable = false
    shadow.parent = root

    const beaconMaterial = new StandardMaterial(`avatar-beacon-${agent.id}`, this.scene)
    beaconMaterial.emissiveColor = STATUS_COLORS[agent.status]
    beaconMaterial.disableLighting = true
    const beacon = MeshBuilder.CreateSphere(`avatar-beacon-${agent.id}`, { diameter: 0.12, segments: 8 }, this.scene)
    beacon.material = beaconMaterial
    beacon.position.y = 1.95
    beacon.isPickable = false
    beacon.parent = root

    // Slight height variety, deterministic per id.
    const scale = 0.92 + ((seed >>> 0) % 15) / 100

    root.scaling = new Vector3(scale, scale, scale)
    return {
      root,
      body,
      head,
      hair,
      eyes,
      mouth,
      ring,
      beacon,
      shadow,
      legs,
      arms,
      feet,
      phase: (seed % 100) / 100,
      swing: 0,
      bodyMaterial,
      beaconMaterial,
      ringMaterial: ringMaterial ?? beaconMaterial,
      pantsMaterial,
      skinMaterial,
      hairMaterial,
      eyeMaterial,
      lastPosition: new Vector3(),
      initialized: false,
    }
  }

  sync(agents: readonly AgentState[], deltaSeconds: number, cameraPosition: Vector3): void {
    const seen = new Set<string>()
    const lerp = 1 - Math.exp(-deltaSeconds * 12)

    for (const agent of agents) {
      seen.add(agent.id)
      let view = this.views.get(agent.id)
      if (!view) {
        view = this.createView(agent)
        this.views.set(agent.id, view)
      }

      const target = agent.position
        ? new Vector3(agent.position.x, agent.position.y, agent.position.z)
        : view.root.position.clone()

      if (!view.initialized) {
        view.root.position.copyFrom(target)
        view.lastPosition.copyFrom(target)
        view.initialized = true
      } else {
        view.root.position.copyFrom(Vector3.Lerp(view.root.position, target, lerp))
      }

      const moved = view.root.position.subtract(view.lastPosition)
      const speed = deltaSeconds > 0 ? moved.length() / deltaSeconds : 0
      const walking = speed > 0.2
      if (moved.lengthSquared() > 0.0004) {
        const yaw = Math.atan2(moved.x, moved.z)
        view.root.rotation.y = yaw
      }
      view.lastPosition.copyFrom(view.root.position)

      const ringMaterial = this.ringMaterials.get(agent.status)
      if (ringMaterial && view.ring.material !== ringMaterial) view.ring.material = ringMaterial
      const statusColor = (this.colorBlindSafe ? STATUS_COLORS_CB : STATUS_COLORS)[agent.status]
      view.beaconMaterial.emissiveColor = statusColor
      view.beacon.position.y = this.reducedMotion
        ? 1.95
        : 1.95 + Math.sin(performance.now() / 420 + hashString(agent.id)) * 0.03

      // Procedural gait: swing frequency follows real speed, so feet do not slide.
      const targetSwing = walking && !this.reducedMotion ? Math.min(1, speed / 1.6) : 0
      view.swing += (targetSwing - view.swing) * Math.min(1, deltaSeconds * 8)
      if (view.swing > 0.01) view.phase += deltaSeconds * (4 + speed * 2.4)
      const legAngle = Math.sin(view.phase * Math.PI * 2) * 0.6 * view.swing
      const armAngle = -legAngle * 0.8
      const typing = agent.activity.kind === 'typing' && !this.reducedMotion
      for (let i = 0; i < view.legs.length; i++) {
        const leg = view.legs[i]
        if (leg) leg.rotation.x = legAngle * (i === 0 ? 1 : -1)
      }
      for (let i = 0; i < view.arms.length; i++) {
        const arm = view.arms[i]
        if (!arm) continue
        arm.rotation.x = typing ? -0.55 + Math.sin(view.phase * 12 + i) * 0.08 : armAngle * (i === 0 ? 1 : -1)
      }
      view.body.scaling.y = this.reducedMotion ? 1 : 1 + Math.sin(view.phase * 2.2) * 0.012

      const offline = agent.status === 'offline'
      const parts = [view.body, view.head, view.hair, view.mouth, ...view.eyes, view.shadow, ...view.legs, ...view.arms, ...view.feet]
      for (const part of parts) part.visibility = offline ? 0.35 : 1
      view.bodyMaterial.alpha = offline ? 0.35 : 1
      view.pantsMaterial.alpha = offline ? 0.35 : 1
      view.skinMaterial.alpha = offline ? 0.35 : 1
      view.hairMaterial.alpha = offline ? 0.35 : 1

      const distance = Vector3.Distance(view.root.position, cameraPosition)
      view.root.setEnabled(distance < 90)
      view.head.setEnabled(distance < 40)
      view.hair.setEnabled(distance < 40)
      view.mouth.setEnabled(distance < 40)
      for (const eye of view.eyes) eye.setEnabled(distance < 40)
      view.beacon.setEnabled(distance < 55)
      view.ring.setEnabled(distance < 55)
      view.shadow.setEnabled(distance < 55)
    }

    for (const [id, view] of this.views) {
      if (seen.has(id)) continue
      view.root.dispose()
      view.bodyMaterial.dispose()
      view.beaconMaterial.dispose()
      view.pantsMaterial.dispose()
      view.skinMaterial.dispose()
      view.hairMaterial.dispose()
      view.eyeMaterial.dispose()
      this.views.delete(id)
    }
  }
}
