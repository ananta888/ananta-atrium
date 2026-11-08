import { SceneInstrumentation, Texture, Vector3 } from '@babylonjs/core'
import { FixedStepDriver } from '../sim/clock.js'
import { buildRoster } from '../sim/roster.js'
import { Simulation } from '../sim/simulation.js'
import { ReplayBuffer } from '../sim/replay.js'
import type { AgentState, OpsStatus } from '../shared/agent-state.js'
import { campus } from '../world/campus.js'
import { loadAsset, loadManifest } from '../world/assets.js'
import { AvatarLayer } from '../render/avatar-layer.js'
import { createRenderContext, type RenderContext } from '../render/engine.js'
import { Hud } from '../render/hud.js'
import { NavDebugLayer } from '../render/nav-debug.js'
import { FocusedMonitor } from '../render/monitors.js'
import { CampusWorld } from '../render/world-builder.js'
import { StateClient, type ConnectionStatus } from '../net/state-client.js'
import { FirstPersonController, type StairZone } from './controller.js'
import { AudioDirector } from './audio.js'
import { setLanguage, t } from './i18n.js'
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
  private monitor!: FocusedMonitor
  private ops: OpsStatus | null = null
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
  private displayNames: Record<string, string> = {}
  private readonly spectator = new URLSearchParams(window.location.search).get('spectator') === '1'
  private orbitAngle = 0

  private source: 'live' | 'fake' = 'fake'
  private connection: ConnectionStatus = 'connecting'
  private remoteActive = false
  private lastHudUpdate = 0
  private debugHideAvatars = false
  private debugPaused = false
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
    this.displayNames = this.loadDisplayNames()
    await this.applyAssets()

    this.sim = new Simulation({ campus, roster: buildRoster(FAKE_AGENT_COUNT) })
    this.navDebug = new NavDebugLayer(this.render.scene)
    this.navDebug.build(this.sim.graph, campus)
    this.monitor = new FocusedMonitor(this.render.scene, campus)

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
      onOps: (ops) => {
        this.ops = ops
      },
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
        if (id) this.overlay.showAgentList()
      },
      onChat: (request) => this.sendChat(request),
      onRenameAgent: (id, name) => this.renameAgent(id, name),
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
    const manifest = await loadManifest('./', fetcher)
    const entry = manifest.assets.find((asset) => asset.id === 'plaza-grid')
    if (!entry) return
    const texture = (await loadAsset(entry, {
      fetch: fetcher,
      supportsKtx2: false,
      baseUrl: './',
      load: async (url) =>
        new Texture(url, this.render.scene, false, false, Texture.TRILINEAR_SAMPLINGMODE),
    })) as Texture
    texture.gammaSpace = false
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

  private loadDisplayNames(): Record<string, string> {
    try {
      const parsed = JSON.parse(window.localStorage.getItem('ananta-atrium.agent-names.v1') ?? '{}') as unknown
      if (typeof parsed === 'object' && parsed !== null) {
        return Object.fromEntries(
          Object.entries(parsed as Record<string, unknown>).filter((entry): entry is [string, string] => typeof entry[1] === 'string'),
        )
      }
    } catch {
      // Ignore invalid local names.
    }
    return {}
  }

  private renameAgent(id: string, name: string): void {
    if (name) this.displayNames[id] = name.slice(0, 40)
    else delete this.displayNames[id]
    try {
      window.localStorage.setItem('ananta-atrium.agent-names.v1', JSON.stringify(this.displayNames))
    } catch {
      // Local storage may be unavailable; the name still applies this session.
    }
  }

  private withDisplayNames(agents: AgentState[]): AgentState[] {
    return agents.map((agent) => {
      const name = this.displayNames[agent.id]
      return name ? { ...agent, name } : agent
    })
  }

  private httpBase(): string {
    try {
      const url = new URL(this.settings.collectorUrl)
      return `${url.protocol === 'wss:' ? 'https:' : 'http:'}//${url.host}`
    } catch {
      return 'http://127.0.0.1:8787'
    }
  }

  private async sendChat(request: {
    agentId: string
    taskId?: string
    text: string
    mode: 'ask' | 'steer'
    steerMode: 'next_iteration_instruction' | 'pause_then_apply' | 'context_note_only'
    instructionClass: 'correction' | 'constraint' | 'preference' | 'branch_hint' | 'stop_condition'
  }): Promise<{ ok: boolean; message: string; replies?: Array<{ sender: string; text: string }> }> {
    const base = this.httpBase()
    try {
      if (request.mode === 'steer') {
        if (!request.taskId) return { ok: false, message: 'task id unknown' }
        const response = await fetch(`${base}/steer`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            taskId: request.taskId,
            text: request.text,
            mode: request.steerMode,
            instructionClass: request.instructionClass,
          }),
        })
        const payload = (await response.json()) as { status?: string; error?: string; message?: string }
        if (!response.ok) return { ok: false, message: payload.message ?? payload.error ?? `HTTP ${response.status}` }
        return { ok: true, message: t('chat.steerAccepted', { status: payload.status ?? 'accepted' }) }
      }
      const response = await fetch(`${base}/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ agentId: request.agentId, text: request.text }),
      })
      const payload = (await response.json()) as {
        status?: 'replied' | 'pending'
        messages?: Array<{ sender: string; text: string }>
        error?: string
        message?: string
      }
      if (!response.ok) return { ok: false, message: payload.message ?? payload.error ?? `HTTP ${response.status}` }
      const replies = payload.messages ?? []
      if (replies.length === 0) return { ok: true, message: t('chat.pending') }
      return {
        ok: true,
        message: payload.status === 'pending' ? t('chat.pending') : t('chat.emptyReply'),
        replies,
      }
    } catch (error) {
      return { ok: false, message: (error as Error).message || t('chat.noCollector') }
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

    if (this.debugPaused) {
      // QA/screenshot hook: freeze simulation and player input.
    } else if (this.replayPlaying) {
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
      if (!this.debugPaused) this.controller.update(deltaSeconds)
    }

    const simulated = this.sim.snapshot(this.source)
    const agents = this.replayActive ? this.replay.seek(this.replayTime) : simulated
    const shown = this.withDisplayNames(agents.length > 0 ? agents : simulated)
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
      this.overlay.updateOps(this.ops ?? { active: [], queued: [] })
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
    this.monitor.setFocus(nearest)
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
    queue: { active: number; queued: number }
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
      queue: { active: this.ops?.active.length ?? 0, queued: this.ops?.queued.length ?? 0 },
    }
  }

  /** QA hook used by the e2e/perf suites; no gameplay path calls this. */
  debugTeleport(x: number, y: number, z: number): void {
    this.controller.camera.position.set(x, y, z)
  }

  debugFace(yaw: number): void {
    this.controller.setYaw(yaw)
  }

  debugPause(paused: boolean): void {
    this.debugPaused = paused
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
