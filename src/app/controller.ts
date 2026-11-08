import { Ray, UniversalCamera, Vector3 } from '@babylonjs/core'
import type { Scene } from '@babylonjs/core'
import { applyLook } from './look.js'

const EYE_HEIGHT = 1.65
const WALK_SPEED = 3.4
const RUN_SPEED = 6.2
const GRAVITY = 18

export interface StairZone {
  minX: number
  maxX: number
  minZ: number
  maxZ: number
  startX: number
  run: number
  baseY: number
  rise: number
}

/** Pointer-lock first-person controller with gravity, collisions and stairs. */
export class FirstPersonController {
  readonly camera: UniversalCamera
  private readonly scene: Scene
  private readonly canvas: HTMLCanvasElement
  private readonly keys = new Set<string>()
  private yaw = Math.PI
  private pitch = 0
  private verticalVelocity = 0
  private locked = false
  private enabled = true
  private mouseSensitivity = 0.0022
  private invertMouseX = false
  private invertMouseY = false
  private touchMove = { x: 0, forward: 0 }
  private stairZones: StairZone[] = []
  private keymap: Record<'forward' | 'back' | 'left' | 'right' | 'run', string> = {
    forward: 'KeyW',
    back: 'KeyS',
    left: 'KeyA',
    right: 'KeyD',
    run: 'ShiftLeft',
  }

  private readonly onKeyDown = (event: KeyboardEvent): void => {
    this.keys.add(event.code)
  }

  private readonly onKeyUp = (event: KeyboardEvent): void => {
    this.keys.delete(event.code)
  }

  private readonly onMouseMove = (event: MouseEvent): void => {
    if (!this.enabled || !this.locked) return
    this.look(event.movementX, event.movementY)
  }

  private readonly onPointerLockChange = (): void => {
    this.locked = document.pointerLockElement === this.canvas
  }

  private readonly onClick = (): void => {
    if (!this.locked) void this.canvas.requestPointerLock()
  }

  constructor(scene: Scene, canvas: HTMLCanvasElement, spawn: Vector3) {
    this.scene = scene
    this.canvas = canvas
    this.camera = new UniversalCamera('player', spawn.clone(), scene)
    this.camera.minZ = 0.05
    this.camera.fov = 0.98
    this.camera.rotation = new Vector3(0, this.yaw, 0)
    this.camera.checkCollisions = true
    this.camera.ellipsoid = new Vector3(0.34, 1.55, 0.34)
    this.camera.inputs.clear()
    scene.activeCamera = this.camera

    window.addEventListener('keydown', this.onKeyDown)
    window.addEventListener('keyup', this.onKeyUp)
    document.addEventListener('mousemove', this.onMouseMove)
    document.addEventListener('pointerlockchange', this.onPointerLockChange)
    canvas.addEventListener('click', this.onClick)
  }

  setKeymap(keymap: Record<'forward' | 'back' | 'left' | 'right' | 'run', string>): void {
    this.keymap = { ...keymap }
  }

  setStairZones(zones: StairZone[]): void {
    this.stairZones = zones
  }

  setYaw(yaw: number): void {
    this.yaw = yaw
  }

  setTouchMove(x: number, forward: number): void {
    this.touchMove.x = Math.max(-1, Math.min(1, x))
    this.touchMove.forward = Math.max(-1, Math.min(1, forward))
  }

  addLook(deltaX: number, deltaY: number): void {
    this.look(deltaX, deltaY)
  }

  private look(dx: number, dy: number): void {
    const next = applyLook(
      { yaw: this.yaw, pitch: this.pitch },
      dx,
      dy,
      { sensitivity: this.mouseSensitivity, invertX: this.invertMouseX, invertY: this.invertMouseY },
    )
    this.yaw = next.yaw
    this.pitch = next.pitch
  }

  setMouseOptions(options: { sensitivity: number; invertX: boolean; invertY: boolean }): void {
    this.mouseSensitivity = Math.max(0.0005, Math.min(0.006, options.sensitivity))
    this.invertMouseX = options.invertX
    this.invertMouseY = options.invertY
  }

  resetTouchInput(): void {
    this.touchMove.x = 0
    this.touchMove.forward = 0
  }

  get pointerLocked(): boolean {
    return this.locked
  }

  setEnabled(enabled: boolean): void {
    this.enabled = enabled
    if (!enabled) {
      this.keys.clear()
      this.resetTouchInput()
      if (document.pointerLockElement === this.canvas) document.exitPointerLock()
    }
  }

  get isEnabled(): boolean {
    return this.enabled
  }

  update(deltaSeconds: number): void {
    if (!this.enabled) return
    const forward = new Vector3(Math.sin(this.yaw), 0, Math.cos(this.yaw))
    const right = new Vector3(Math.cos(this.yaw), 0, -Math.sin(this.yaw))
    const wish = Vector3.Zero()

    if (this.keys.has(this.keymap.forward) || this.keys.has('ArrowUp')) wish.addInPlace(forward)
    if (this.keys.has(this.keymap.back) || this.keys.has('ArrowDown')) wish.subtractInPlace(forward)
    if (this.keys.has(this.keymap.right) || this.keys.has('ArrowRight')) wish.addInPlace(right)
    if (this.keys.has(this.keymap.left) || this.keys.has('ArrowLeft')) wish.subtractInPlace(right)

    wish.addInPlace(forward.scale(this.touchMove.forward))
    wish.addInPlace(right.scale(this.touchMove.x))

    if (wish.lengthSquared() > 0) {
      wish.normalize()
      const speed = this.keys.has(this.keymap.run) || this.keys.has('ShiftRight') ? RUN_SPEED : WALK_SPEED
      wish.scaleInPlace(speed * deltaSeconds)
    }

    const grounded = this.isGrounded()
    if (grounded) {
      this.verticalVelocity = Math.min(0, this.verticalVelocity)
    } else {
      this.verticalVelocity -= GRAVITY * deltaSeconds
    }

    const displacement = new Vector3(wish.x, this.verticalVelocity * deltaSeconds, wish.z)
    this.camera._collideWithWorld(displacement)

    const floor = this.floorBelow()
    if (floor !== null) {
      const targetY = floor + EYE_HEIGHT
      if (this.camera.position.y <= targetY + 0.35) {
        this.camera.position.y = targetY
        this.verticalVelocity = 0
      }
    }
    this.applyStairs()
    if (this.camera.position.y < -4) {
      this.camera.position.set(4, EYE_HEIGHT + 0.1, 40)
      this.verticalVelocity = 0
    }

    this.camera.rotation.x = this.pitch
    this.camera.rotation.y = this.yaw
  }

  /** Analytic stair walking avoids ellipsoid snags on ramp lips. */
  private applyStairs(): void {
    const x = this.camera.position.x
    const z = this.camera.position.z
    for (const zone of this.stairZones) {
      if (x < zone.minX || x > zone.maxX || z < zone.minZ || z > zone.maxZ) continue
      const progress = Math.max(0, Math.min(1, (x - zone.startX) / zone.run))
      this.camera.position.y = zone.baseY + progress * zone.rise + EYE_HEIGHT
      this.verticalVelocity = 0
      return
    }
  }

  private isGrounded(): boolean {
    return this.floorBelow() !== null
  }

  private floorBelow(): number | null {
    const origin = this.camera.position.add(new Vector3(0, 0.25, 0))
    const ray = new Ray(origin, new Vector3(0, -1, 0), EYE_HEIGHT + 0.55)
    const pick = this.scene.pickWithRay(
      ray,
      (mesh) => mesh.isPickable && (mesh.checkCollisions || (mesh.metadata as { walkable?: boolean } | null)?.walkable === true),
    )
    if (!pick?.hit || !pick.pickedPoint) return null
    if (pick.distance > EYE_HEIGHT + 0.4) return null
    return pick.pickedPoint.y
  }

  dispose(): void {
    window.removeEventListener('keydown', this.onKeyDown)
    window.removeEventListener('keyup', this.onKeyUp)
    document.removeEventListener('mousemove', this.onMouseMove)
    document.removeEventListener('pointerlockchange', this.onPointerLockChange)
    this.canvas.removeEventListener('click', this.onClick)
  }
}
