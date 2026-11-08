import { SceneInstrumentation, Texture, Vector3 } from '@babylonjs/core'
import { FixedStepDriver } from '../sim/clock.js'
import { buildRoster } from '../sim/roster.js'
import { Simulation } from '../sim/simulation.js'
import { ReplayBuffer } from '../sim/replay.js'
import type { AgentState } from '../shared/agent-state.js'
import { campus } from '../world/campus.js'
import { loadAsset, loadManifest } from '../world/assets.js'
import { AvatarLayer } from '../render/avatar-layer.js'
import { createRenderContext, type RenderContext } from '../render/engine.js'
import { Hud } from '../render/hud.js'
import { NavDebugLayer } from '../render/nav-debug.js'
import { CampusWorld } from '../render/world-builder.js'
import { StateClient, type ConnectionStatus } from '../net/state-client.js'
import { FirstPersonController, type StairZone } from './controller.js'
import { AudioDirector } from './audio.js'
import { setLanguage } from './i18n.js'
import { Overlay, type PlayerPose, type ReplayInfo } from './overlay.js'
import {
  DEFAULT_SETTINGS,
  loadSettings,
  saveSettings,
  type Quality,
  type Settings,
} from './settings.js'
import { TouchControls, shouldEnableTouch } from './touch.js'

const FAKE_AGENT_COUNT = 50
const HUD_INTERVAL_MS = 200
const RECORD_INTERVAL_MS = 500

const QUALITY_SCALING: Record<Quality, number> = { low: 1.5, medium: 1.25, high: 1 }

export class AtriumSession {
  private readonly canvas: HTMLCanvasElement
  private render!: RenderContext
  private world!: CampusWorld
  private controller!: FirstPersonController
  private avatars!: AvatarLayer
  private hud!: Hud
  private overlay!: Overlay
  private navDebug!: NavDebugLayer
  private audio = new AudioDirector()
  private touch!: TouchControls
  private instrumentation!: SceneInstrumentation
  private lastNavUpdate = 0
  private sim!: Simulation
  private stateClient!: StateClient
  private clock!: FixedStepDriver
  private settings: Settings = structuredClone(DEFAULT_SETTINGS)
  private replay = new ReplayBuffer()
  private replayRecording = false
  private replayPlaying = false
  private replayActive = false
  private replayTime = 0
  private lastRecordAt = 0
  private focusedAgent: string | null = null
  private readonly spectator = new URLSearchParams(window.location.search).get('spectator') === '1'
  private orbitAngle = 0

  private source: 'live' | 'fake' = 'fake'
  private connection: ConnectionStatus = 'connecting'
  private remoteActive = false
  private lastHudUpdate = 0
  private debugHideAvatars = false
  private previousPosition = new Vector3(4, 1.7, 30)
  private cullStats = { visibleRooms: 0, totalRooms: 0 }

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas
  }

  async start(): Promise<void> {
    this.render = await createRenderContext(this.canvas)
    this.world = new CampusWorld(this.render.scene, campus)
    this.controller = new FirstPersonController(this.render.scene, this.canvas, this.world.spawn)
    this.controller.setStairZones(this.buildStairZones())
    this.avatars = new AvatarLayer(this.render.scene)
    this.hud = new Hud()
    this.clock = new FixedStepDriver({ tickSeconds: 1 / 30, maxStepsPerFrame: 6 })
    this.instrumentation = new SceneInstrumentation(this.render.scene)
    this.settings = loadSettings(window.localStorage)
    await this.applyAssets()

    this.sim = new Simulation({ campus, roster: buildRoster(FAKE_AGENT_COUNT) })
    this.navDebug = new NavDebugLayer(this.render.scene)
    this.navDebug.build(this.sim.graph, campus)

    const collectorParam = new URLSearchParams(window.location.search).get('collector') ?? this.settings.collectorUrl
    const initialUrl = this.spectator
      ? `${collectorParam}${collectorParam.includes('?') ? '&' : '?'}spectator=1`
      : collectorParam
    this.stateClient = new StateClient({
      url: initialUrl,
      onSnapshot: (snapshot) => this.onSnapshot(snapshot.agents, snapshot.source),
      onUpsert: (agents) => this.sim.applyLiveAgents(agents),
      onRemove: (ids) => {
        for (const id of ids) this.sim.removeAgent(id)
      },
      onStatus: (status) => this.onConnectionStatus(status),
    })

    this.overlay = new Overlay(document.body, campus, this.settings, {
      onEnterDemo: () => this.enterDemo(),
      onConnect: (url) => this.connect(url),
      onSettingsChange: (settings) => this.applySettings(settings),
      onReplayRecord: (recording) => {
        this.replayRecording = recording
        if (recording) {
          this.replayActive = false
          this.replayPlaying = false
        }
      },
      onReplayPlay: (playing) => {
        this.replayPlaying = playing
        this.replayActive = playing || this.replayActive
        if (playing) {
          this.replayTime = this.replay.frameCount > 0 ? this.replay.firstTime : 0
        }
      },
      onReplaySeek: (time) => {
        if (time < 0) {
          this.replayActive = false
          this.replayPlaying = false
          return
        }
        this.replayPlaying = false
        this.replayActive = true
        this.replayTime = time
        this.overlay.setReplay(this.replayInfo())
      },
      onFocusAgent: (id) => {
        this.focusedAgent = id
        if (id) this.overlay.toggleAgentList()
      },
    })
    this.controller.setEnabled(!this.spectator)
    if (this.spectator) this.overlay.hideMenu()
    else this.overlay.showMenu()

    this.touch = new TouchControls(this.overlay.touchContainer, {
      onMove: (x, forward) => this.controller.setTouchMove(x, forward),
      onLook: (dx, dy) => this.controller.addLook(dx, dy),
      onReset: () => this.controller.resetTouchInput(),
    })

    this.applySettings(this.settings)
    this.stateClient.start()
    saveSettings(window.localStorage, this.settings)

    window.addEventListener('resize', this.onResize)
    window.addEventListener('keydown', this.onKeyDown)
    this.canvas.addEventListener('click', this.onCanvasClick)
    this.render.engine.runRenderLoop(() => this.frame())

    console.info(
      `Ananta Atrium ready — backend ${this.render.backend}, ${campus.buildings.length} buildings, ${campus.desks.length} desks`,
    )
  }

  private async applyAssets(): Promise<void> {
    const fetcher: typeof fetch = (input, init) => fetch(input, init)
    const manifest = await loadManifest('.', fetcher)
    const entry = manifest.assets.find((asset) => asset.id === 'plaza-grid')
    if (!entry) return
    const texture = (await loadAsset(entry, {
      fetch: fetcher,
      supportsKtx2: false,
      baseUrl: './',
      load: async (url) =>
        new Texture(url, this.render.scene, false, false, Texture.TRILINEAR_SAMPLINGMODE),
    })) as Texture
    texture.uScale = 24
    texture.vScale = 24
    this.world.setPlazaTexture(texture)
  }

  private buildStairZones(): StairZone[] {
    const zones: StairZone[] = []
    for (const building of campus.buildings) {
      const startX = building.origin.x + building.stairs.x - 5.2
      const run = 5
      for (let floor = 0; floor < building.floors - 1; floor++) {
        zones.push({
          minX: startX - 0.6,
          maxX: startX + run + 0.6,
          minZ: building.origin.z + building.stairs.z - 1.25,
          maxZ: building.origin.z + building.stairs.z + 1.25,
          startX,
          run,
          baseY: building.origin.y + floor * building.floorHeight,
          rise: building.floorHeight,
        })
      }
    }
    return zones
  }

  private readonly onResize = (): void => {
    this.render.engine.resize()
  }

  private readonly onCanvasClick = (): void => {
    void this.audio.enable(this.settings.audio)
  }

  private readonly onKeyDown = (event: KeyboardEvent): void => {
    const target = event.target as HTMLElement | null
    if (target && ['INPUT', 'SELECT', 'TEXTAREA'].includes(target.tagName)) return
    if (target?.isContentEditable) return

    if (event.code === 'F2') {
      this.debugHideAvatars = !this.debugHideAvatars
      for (const mesh of this.render.scene.meshes) {
        if (mesh.name.startsWith('avatar-')) mesh.setEnabled(!this.debugHideAvatars)
      }
    } else if (event.code === 'F3') {
      this.navDebug.setVisible(!this.navDebug.isVisible)
    } else if (event.code === 'KeyL') {
      this.overlay.toggleAgentList()
    } else if (event.code === 'KeyR') {
      this.overlay.toggleReplay()
    } else if (event.code === 'F1') {
      this.controller.setEnabled(!this.spectator)
    if (this.spectator) this.overlay.hideMenu()
    else this.overlay.showMenu()
    }
  }

  private enterDemo(): void {
    void this.audio.enable(this.settings.audio)
    this.audio.cue('fake')
    this.stateClient.stop()
    this.remoteActive = false
    this.source = 'fake'
    this.sim = new Simulation({ campus, roster: buildRoster(FAKE_AGENT_COUNT) })
  }

  private connect(url: string): void {
    void this.audio.enable(this.settings.audio)
    const next = { ...this.settings, collectorUrl: url }
    this.applySettings(next)
    this.stateClient.restart(url)
  }

  private onSnapshot(agents: AgentState[], source: 'live' | 'fake'): void {
    this.source = source
    if (!this.remoteActive) {
      // The collector owns the agent set; replace the local fake roster.
      this.sim = new Simulation({
        campus,
        roster: agents.map((agent) => ({ id: agent.id, name: agent.name, role: agent.role })),
      })
      this.remoteActive = true
      this.audio.cue(source === 'live' ? 'live' : 'fake')
    }
    this.sim.reconcile(agents)
  }

  private onConnectionStatus(status: ConnectionStatus): void {
    const wasOffline = this.connection === 'offline'
    this.connection = status
    this.overlay?.setConnection(status)
    if (status === 'offline' && this.remoteActive && !wasOffline) {
      // No silent live-looking freeze: fall back to the labelled fake source.
      this.remoteActive = false
      this.source = 'fake'
      this.sim = new Simulation({ campus, roster: buildRoster(FAKE_AGENT_COUNT) })
    }
  }

  private applySettings(settings: Settings): void {
    this.settings = settings
    setLanguage(settings.language)
    saveSettings(window.localStorage, settings)
    this.overlay?.applySettings(settings)
    this.render.engine.setHardwareScalingLevel(QUALITY_SCALING[settings.quality])
    this.controller.setKeymap(settings.keymap)
    this.controller.setMouseOptions({
      sensitivity: settings.mouseSensitivity,
      invertX: settings.invertMouseX,
      invertY: settings.invertMouseY,
    })
    this.avatars.setColorBlindSafe(settings.colorBlindSafe)
    this.avatars.setReducedMotion(settings.reducedMotion)
    this.audio.setVolumes(settings.audio)
    const coarse = window.matchMedia?.('(pointer: coarse)').matches ?? false
    this.touch?.setEnabled(shouldEnableTouch(settings.touchControls, coarse))
  }

  private frame(): void {
    const deltaSeconds = Math.min(this.render.engine.getDeltaTime() / 1000, 0.1)
    const now = performance.now()

    if (this.replayPlaying) {
      this.replayTime += deltaSeconds
      const end = this.replay.firstTime + this.replay.duration
      if (this.replayTime >= end) {
        this.replayTime = end
        this.replayPlaying = false
      }
    } else {
      this.clock.advance(deltaSeconds, () => this.sim.step())
    }
    if (this.spectator) {
      this.orbitAngle += deltaSeconds * 0.12
      this.controller.camera.position.set(
        4 + Math.cos(this.orbitAngle) * 46,
        26,
        20 + Math.sin(this.orbitAngle) * 46,
      )
      this.controller.camera.setTarget(new Vector3(4, 2, 8))
    } else {
      this.controller.update(deltaSeconds)
    }

    const simulated = this.sim.snapshot(this.source)
    const agents = this.replayActive ? this.replay.seek(this.replayTime) : simulated
    const shown = agents.length > 0 ? agents : simulated
    this.avatars.sync(shown, deltaSeconds, this.controller.camera.position)

    if (this.replayRecording && now - this.lastRecordAt >= RECORD_INTERVAL_MS) {
      this.lastRecordAt = now
      this.replay.record(now / 1000, simulated)
    }

    const forward = this.controller.camera.getDirection(new Vector3(0, 0, 1))
    this.cullStats = this.world.updateCulling(this.controller.camera.position, forward, this.settings.quality)
    this.world.streamBuildings(this.controller.camera.position)

    const moved = Vector3.Distance(this.controller.camera.position, this.previousPosition)
    if (moved > 0.08 && moved < 2) this.audio.footstep()
    this.previousPosition.copyFrom(this.controller.camera.position)

    if (this.navDebug.isVisible && now - this.lastNavUpdate >= 250) {
      this.lastNavUpdate = now
      this.navDebug.update(this.sim.debugPaths())
    }
    if (now - this.lastHudUpdate >= HUD_INTERVAL_MS) {
      this.lastHudUpdate = now
      this.updateHud(shown)
      this.overlay.updateAgents(shown, this.playerPose())
      this.overlay.setReplay(this.replayInfo())
    }

    this.render.scene.render()
  }

  private replayInfo(): ReplayInfo {
    return {
      frameCount: this.replay.frameCount,
      duration: this.replay.duration,
      current: Math.max(0, this.replayTime - this.replay.firstTime),
      recording: this.replayRecording,
      playing: this.replayPlaying,
    }
  }

  private playerPose(): PlayerPose {
    return {
      x: this.controller.camera.position.x,
      z: this.controller.camera.position.z,
      yaw: this.controller.camera.rotation.y,
    }
  }

  private updateHud(agents: AgentState[]): void {
    const position = this.controller.camera.position
    const lookup = this.world.roomAt(position)
    this.hud.update({
      source: this.source,
      connection: this.connection,
      backend: this.render.backend,
      fps: this.render.engine.getFps(),
      agentCount: agents.length,
      roomName: lookup?.room.name ?? 'Plaza',
      buildingName: lookup?.buildingName ?? 'Campus',
      tick: this.sim.tick,
      pointerLocked: this.controller.pointerLocked,
      drawCalls: this.instrumentation.drawCallsCounter.current,
      visibleRooms: this.cullStats.visibleRooms,
      totalRooms: this.cullStats.totalRooms,
    })

    const focused = this.focusedAgent ? agents.find((agent) => agent.id === this.focusedAgent) : undefined
    let nearest = focused ?? null
    if (!nearest) {
      let nearestDistance = 6
      for (const agent of agents) {
        if (!agent.position) continue
        const dx = agent.position.x - position.x
        const dy = agent.position.y - position.y
        const dz = agent.position.z - position.z
        if (Math.abs(dy) > 2.1) continue
        const distance = Math.hypot(dx, dy, dz)
        if (distance < nearestDistance) {
          nearest = agent
          nearestDistance = distance
        }
      }
    }
    if (nearest) {
      const building = this.world.campus.buildings.find((b) => b.id === nearest?.buildingId)
      const room = building?.rooms.find((r) => r.id === nearest?.roomId)
      this.hud.inspect(nearest, building?.name, room?.name)
    } else {
      this.hud.inspect(null)
    }
  }

  getDebugState(): {
    source: 'live' | 'fake'
    connection: ConnectionStatus
    agents: number
    tick: number
    backend: 'webgpu' | 'webgl'
    pointerLocked: boolean
    position: { x: number; y: number; z: number }
    fps: number
    drawCalls: number
    meshes: number
    visibleRooms: number
    totalRooms: number
    loadedBuildings: number
    menuVisible: boolean
    touchEnabled: boolean
    spectator: boolean
    replay: { frames: number; duration: number; active: boolean; recording: boolean }
    settings: Settings
  } {
    return {
      source: this.source,
      connection: this.connection,
      agents: this.sim.agentCount,
      tick: this.sim.tick,
      backend: this.render.backend,
      pointerLocked: this.controller.pointerLocked,
      position: {
        x: this.controller.camera.position.x,
        y: this.controller.camera.position.y,
        z: this.controller.camera.position.z,
      },
      fps: this.render.engine.getFps(),
      drawCalls: this.instrumentation.drawCallsCounter.current,
      meshes: this.render.scene.meshes.length,
      visibleRooms: this.cullStats.visibleRooms,
      totalRooms: this.cullStats.totalRooms,
      loadedBuildings: this.world.loadedBuildingCount,
      menuVisible: document.querySelector('.ui-menu:not([hidden])') !== null,
    spectator: this.spectator,
      touchEnabled: this.touch?.isEnabled ?? false,
      replay: {
        frames: this.replay.frameCount,
        duration: this.replay.duration,
        active: this.replayActive,
        recording: this.replayRecording,
      },
      settings: this.settings,
    }
  }

  /** QA hook used by the e2e/perf suites; no gameplay path calls this. */
  debugTeleport(x: number, y: number, z: number): void {
    this.controller.camera.position.set(x, y, z)
  }

  debugFace(yaw: number): void {
    this.controller.setYaw(yaw)
  }

  debugShowMenu(visible: boolean): void {
    if (visible) this.overlay.showMenu()
    else this.overlay.hideMenu()
  }

  debugSetCulling(enabled: boolean): void {
    this.world.setCullingEnabled(enabled)
  }

  /** Naive mode: no room culling and no frustum culling — used as the perf baseline. */
  debugSetNaiveRendering(enabled: boolean): void {
    this.world.setCullingEnabled(!enabled)
    for (const mesh of this.render.scene.meshes) mesh.alwaysSelectAsActiveMesh = enabled
  }

  debugSetReplay(active: boolean): void {
    this.replayActive = active
    this.replayPlaying = false
  }

  stop(): void {
    this.stateClient?.stop()
    this.controller?.dispose()
    this.hud?.dispose()
    this.overlay?.dispose()
    this.touch?.dispose()
    this.audio.dispose()
    this.instrumentation?.dispose()
    this.render?.engine.stopRenderLoop()
    this.render?.engine.dispose()
    window.removeEventListener('resize', this.onResize)
    window.removeEventListener('keydown', this.onKeyDown)
    this.canvas.removeEventListener('click', this.onCanvasClick)
  }
}
