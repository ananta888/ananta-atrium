import { Color3, DynamicTexture, MeshBuilder, StandardMaterial, Vector3 } from '@babylonjs/core'
import type { Mesh, Scene } from '@babylonjs/core'
import type { AgentState } from '../shared/agent-state.js'
import type { CampusDef } from '../shared/campus.js'

function formatDuration(ms: number | null | undefined): string {
  if (ms === null || ms === undefined || !Number.isFinite(ms)) return '—'
  const seconds = Math.max(0, Math.round(ms / 1000))
  const minutes = Math.floor(seconds / 60)
  return minutes > 0 ? `${minutes}m ${seconds % 60}s` : `${seconds}s`
}

function wrap(context: CanvasRenderingContext2D, text: string, maxWidth: number, maxLines: number): string[] {
  const words = text.split(/\s+/)
  const lines: string[] = []
  let line = ''
  for (const word of words) {
    const candidate = line ? `${line} ${word}` : word
    if (context.measureText(candidate).width > maxWidth && line) {
      lines.push(line)
      line = word
      if (lines.length >= maxLines) return lines
    } else {
      line = candidate
    }
  }
  if (line && lines.length < maxLines) lines.push(line)
  return lines
}

/** Renders the focused agent's live work onto the monitor at their desk. */
export class FocusedMonitor {
  private readonly scene: Scene
  private readonly campus: CampusDef
  private readonly texture: DynamicTexture
  private readonly material: StandardMaterial
  private readonly plane: Mesh
  private focus: AgentState | null = null

  constructor(scene: Scene, campus: CampusDef) {
    this.scene = scene
    this.campus = campus
    this.texture = new DynamicTexture('focused-monitor', { width: 512, height: 320 }, scene, false)
    this.texture.hasAlpha = false
    this.material = new StandardMaterial('focused-monitor-material', scene)
    this.material.emissiveTexture = this.texture
    this.material.diffuseColor = new Color3(0, 0, 0)
    this.material.specularColor = new Color3(0, 0, 0)
    this.material.disableLighting = true
    this.material.backFaceCulling = false
    this.plane = MeshBuilder.CreatePlane('focused-monitor-plane', { width: 0.62, height: 0.4 }, scene)
    this.plane.material = this.material
    this.plane.isPickable = false
    this.plane.setEnabled(false)
    this.draw(null)
  }

  private draw(agent: AgentState | null): void {
    const context = this.texture.getContext() as unknown as CanvasRenderingContext2D
    const width = 512
    const height = 320
    context.fillStyle = '#0a1218'
    context.fillRect(0, 0, width, height)
    context.strokeStyle = '#4fd39a'
    context.lineWidth = 4
    context.strokeRect(2, 2, width - 4, height - 4)

    if (!agent) {
      context.fillStyle = '#7f93a8'
      context.font = '600 22px Inter, system-ui, sans-serif'
      context.textAlign = 'center'
      context.fillText('Select an agent', width / 2, height / 2)
      this.texture.update()
      return
    }

    const trace = agent.trace
    context.textAlign = 'left'
    context.fillStyle = '#e9eff6'
    context.font = '700 24px Inter, system-ui, sans-serif'
    context.fillText(agent.name.slice(0, 28), 20, 38)
    context.font = '500 16px Inter, system-ui, sans-serif'
    context.fillStyle = '#8fb2c9'
    context.fillText(`${agent.role} · ${agent.status}`, 20, 62)

    context.fillStyle = '#cfe4f2'
    context.font = '600 20px Inter, system-ui, sans-serif'
    const lines = wrap(context, agent.task.title, width - 40, 2)
    lines.forEach((line, index) => context.fillText(line, 20, 92 + index * 24))

    const progress = Math.max(0, Math.min(1, agent.task.progress))
    context.fillStyle = 'rgba(255,255,255,0.12)'
    context.fillRect(20, 146, width - 40, 12)
    context.fillStyle = '#4fd39a'
    context.fillRect(20, 146, (width - 40) * progress, 12)
    context.fillStyle = '#9fb1c6'
    context.font = '500 14px Inter, system-ui, sans-serif'
    context.fillText(`Progress ${Math.round(progress * 100)}%`, 20, 176)

    const time = trace?.budget?.time
    if (time) {
      const ratio = time.limit && time.limit > 0 ? Math.min(1, (time.used ?? 0) / time.limit) : 0
      context.fillStyle = 'rgba(255,255,255,0.1)'
      context.fillRect(20, 188, width - 40, 10)
      context.fillStyle = ratio > 0.85 ? '#ef6f5a' : '#f2b544'
      context.fillRect(20, 188, (width - 40) * ratio, 10)
      context.fillStyle = '#9fb1c6'
      context.fillText(`Time ${formatDuration(time.used)} / ${formatDuration(time.limit)}`, 20, 214)
    }
    const tokens = trace?.budget?.tokens
    if (tokens) {
      context.fillStyle = '#9fb1c6'
      context.fillText(
        `Tokens ${tokens.used ?? '—'} / ${tokens.limit ?? '—'} · attempts ${trace?.attempts ?? '—'}${trace?.maxAttempts ? ` / ${trace.maxAttempts}` : ''}`,
        20,
        236,
      )
    } else if (trace) {
      context.fillStyle = '#9fb1c6'
      context.fillText(`Attempts ${trace.attempts ?? '—'}${trace.maxAttempts ? ` / ${trace.maxAttempts}` : ''}`, 20, 236)
    }

    context.fillStyle = '#7f93a8'
    context.font = '500 13px ui-monospace, monospace'
    const diff = trace?.diff
    if (diff) {
      context.fillStyle = '#cfe4f2'
      context.fillText(`${diff.files.length} files  +${diff.additions}  -${diff.deletions}`, 20, 262)
      diff.preview.slice(-4).forEach((line, index) => {
        context.fillStyle = line.startsWith('+') ? '#4fd39a' : line.startsWith('-') ? '#ef6f5a' : '#7f93a8'
        context.fillText(line.slice(0, 72), 20, 282 + index * 10)
      })
    } else {
      context.fillText('No workspace diff yet', 20, 262)
    }

    this.texture.update()
  }

  setFocus(agent: AgentState | null): void {
    this.focus = agent
    if (!agent) {
      this.plane.setEnabled(false)
      return
    }
    const desk = this.campus.desks.find((item) => item.id === agent.deskId)
    const building = this.campus.buildings.find((item) => item.id === agent.buildingId)
    if (!desk || !building) {
      this.plane.setEnabled(false)
      return
    }
    this.plane.position = new Vector3(
      building.origin.x + desk.position.x,
      building.origin.y + desk.position.y + 1.08,
      building.origin.z + desk.position.z - 0.16,
    )
    this.plane.rotation.y = Math.PI
    this.plane.setEnabled(true)
    this.draw(agent)
  }

  get focused(): AgentState | null {
    return this.focus
  }

  dispose(): void {
    this.plane.dispose()
    this.material.dispose()
    this.texture.dispose()
    void this.scene
  }
}
