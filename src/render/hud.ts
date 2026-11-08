import { AdvancedDynamicTexture, Control, Rectangle, StackPanel, TextBlock } from '@babylonjs/gui'
import type { AgentState } from '../shared/agent-state.js'
import { statusLabel, t } from '../app/i18n.js'

export interface HudState {
  source: 'live' | 'fake'
  connection: 'connecting' | 'live' | 'offline'
  backend: 'webgpu' | 'webgl'
  fps: number
  agentCount: number
  roomName: string
  buildingName: string
  tick: number
  pointerLocked: boolean
  drawCalls: number
  visibleRooms: number
  totalRooms: number
}

function text(
  value: string,
  options: { size?: number; color?: string; height?: string; bold?: boolean } = {},
): TextBlock {
  const block = new TextBlock()
  block.text = value
  block.color = options.color ?? '#e8edf4'
  block.fontSize = options.size ?? 14
  block.fontFamily = 'Inter, system-ui, sans-serif'
  block.height = options.height ?? '22px'
  block.textHorizontalAlignment = Control.HORIZONTAL_ALIGNMENT_LEFT
  block.paddingLeft = '10px'
  if (options.bold) block.fontWeight = '600'
  return block
}

function panel(width: string, height?: string): Rectangle {
  const rect = new Rectangle()
  rect.width = width
  if (height) rect.height = height
  rect.adaptHeightToChildren = true
  rect.thickness = 0
  rect.cornerRadius = 8
  rect.background = 'rgba(12, 16, 23, 0.72)'
  rect.paddingLeft = '12px'
  rect.paddingRight = '12px'
  rect.paddingTop = '8px'
  rect.paddingBottom = '8px'
  return rect
}

export class Hud {
  private readonly adt: AdvancedDynamicTexture
  private readonly sourceBadge: TextBlock
  private readonly stats: TextBlock
  private readonly room: TextBlock
  private readonly hint: TextBlock
  private readonly overlay: Rectangle
  private readonly inspectTitle: TextBlock
  private readonly inspectBody: TextBlock
  private readonly progressFill: Rectangle
  private readonly inspectPanel: Rectangle
  private readonly cullingText: TextBlock

  constructor() {
    this.adt = AdvancedDynamicTexture.CreateFullscreenUI('hud', true)

    const titleStack = new StackPanel()
    titleStack.width = '290px'
    titleStack.horizontalAlignment = Control.HORIZONTAL_ALIGNMENT_LEFT
    titleStack.verticalAlignment = Control.VERTICAL_ALIGNMENT_TOP
    titleStack.top = '16px'
    titleStack.left = '16px'
    titleStack.isVertical = true
    this.adt.addControl(titleStack)

    const titlePanel = panel('290px')
    const titleInner = new StackPanel()
    titleInner.isVertical = true
    titlePanel.addControl(titleInner)
    titleInner.addControl(text(t('app.title'), { size: 18, bold: true }))
    const accent = new Rectangle()
    accent.width = '42px'
    accent.height = '3px'
    accent.thickness = 0
    accent.background = '#4fd39a'
    accent.horizontalAlignment = Control.HORIZONTAL_ALIGNMENT_LEFT
    accent.paddingLeft = '10px'
    titleInner.addControl(accent)
    this.sourceBadge = text('', { size: 12, color: '#f0c674', bold: true })
    titleInner.addControl(this.sourceBadge)
    this.stats = text('', { size: 12, color: '#9fb0c3' })
    titleInner.addControl(this.stats)
    this.cullingText = text('', { size: 12, color: '#7f8fa3' })
    titleInner.addControl(this.cullingText)
    titleStack.addControl(titlePanel)

    const roomPanel = panel('290px')
    this.room = text('', { size: 13, color: '#cbd6e2' })
    roomPanel.addControl(this.room)
    titleStack.addControl(roomPanel)

    const crosshair = new Rectangle()
    crosshair.width = '6px'
    crosshair.height = '6px'
    crosshair.thickness = 0
    crosshair.background = 'rgba(235, 242, 250, 0.85)'
    crosshair.horizontalAlignment = Control.HORIZONTAL_ALIGNMENT_CENTER
    crosshair.verticalAlignment = Control.VERTICAL_ALIGNMENT_CENTER
    this.adt.addControl(crosshair)

    this.hint = text(t('hud.crosshair'), {
      size: 14,
      color: '#dfe7f0',
    })
    this.hint.textHorizontalAlignment = Control.HORIZONTAL_ALIGNMENT_CENTER
    this.hint.height = '30px'
    this.hint.verticalAlignment = Control.VERTICAL_ALIGNMENT_BOTTOM
    this.hint.top = '-64px'
    this.adt.addControl(this.hint)

    this.overlay = new Rectangle()
    this.overlay.width = 1
    this.overlay.height = 1
    this.overlay.thickness = 0
    this.overlay.background = 'rgba(6, 9, 13, 0.55)'
    this.adt.addControl(this.overlay)
    const overlayText = text(t('hud.enter'), { size: 22, bold: true })
    overlayText.name = 'enter-label'
    overlayText.textHorizontalAlignment = Control.HORIZONTAL_ALIGNMENT_CENTER
    overlayText.verticalAlignment = Control.VERTICAL_ALIGNMENT_CENTER
    this.overlay.addControl(overlayText)

    this.inspectPanel = panel('320px')
    this.inspectPanel.horizontalAlignment = Control.HORIZONTAL_ALIGNMENT_RIGHT
    this.inspectPanel.verticalAlignment = Control.VERTICAL_ALIGNMENT_TOP
    this.inspectPanel.top = '16px'
    this.inspectPanel.left = '-16px'
    this.inspectPanel.isVisible = false
    this.adt.addControl(this.inspectPanel)

    const inspectStack = new StackPanel()
    inspectStack.isVertical = true
    this.inspectPanel.addControl(inspectStack)
    this.inspectTitle = text('', { size: 16, bold: true })
    this.inspectBody = text('', { size: 12, color: '#b8c5d4' })
    this.inspectBody.height = '150px'
    this.inspectBody.textWrapping = true
    inspectStack.addControl(this.inspectTitle)
    inspectStack.addControl(this.inspectBody)

    const progressTrack = new Rectangle()
    progressTrack.width = '1'
    progressTrack.height = '8px'
    progressTrack.thickness = 0
    progressTrack.background = 'rgba(255, 255, 255, 0.12)'
    inspectStack.addControl(progressTrack)
    this.progressFill = new Rectangle()
    this.progressFill.width = 0.5
    this.progressFill.height = 1
    this.progressFill.thickness = 0
    this.progressFill.background = '#4fd39a'
    this.progressFill.horizontalAlignment = Control.HORIZONTAL_ALIGNMENT_LEFT
    progressTrack.addControl(this.progressFill)
  }

  update(state: HudState): void {
    const sourceColor = state.source === 'live' ? '#4fd39a' : '#f0c674'
    this.sourceBadge.text = t('hud.source', {
      source: t(state.source === 'live' ? 'hud.sourceLive' : 'hud.sourceFake'),
      connection: state.connection.toUpperCase(),
    })
    this.sourceBadge.color = sourceColor
    this.stats.text = t('hud.stats', {
      count: state.agentCount,
      fps: Math.round(state.fps),
      backend: state.backend,
      tick: state.tick,
    })
    this.cullingText.text = t('hud.culling', {
      visible: state.visibleRooms,
      total: state.totalRooms,
      draws: state.drawCalls,
    })
    this.room.text = t('hud.room', { building: state.buildingName, room: state.roomName })
    const enter = this.adt.getControlByName('enter-label') as TextBlock | null
    if (enter) enter.text = t('hud.enter')
    this.overlay.isVisible = !state.pointerLocked
    this.hint.isVisible = state.pointerLocked
  }

  inspect(agent: AgentState | null, buildingName?: string, roomName?: string): void {
    if (!agent) {
      this.inspectPanel.isVisible = false
      return
    }
    this.inspectPanel.isVisible = true
    this.inspectTitle.text = `${agent.name}${agent.stale ? ' (stale)' : ''}`
    this.inspectBody.text = [
      agent.role,
      t('hud.inspectStatus', { status: statusLabel(agent.status), activity: agent.activity.kind }),
      `${buildingName ?? agent.buildingId} / ${roomName ?? agent.roomId}`,
      t('hud.inspectTask', { title: agent.task.title }),
      t('hud.inspectProgress', { percent: Math.round(agent.task.progress * 100) }),
      agent.metrics?.tokensPerSecond !== undefined
        ? t('hud.inspectThroughput', { value: agent.metrics.tokensPerSecond.toFixed(1) })
        : t('hud.inspectNoThroughput'),
      t('hud.inspectSource', { source: agent.source }),
    ].join('\n')
    this.progressFill.width = Math.max(0.01, Math.min(1, agent.task.progress))
    this.progressFill.background = agent.source === 'live' ? '#4fd39a' : '#f0c674'
  }

  dispose(): void {
    this.adt.dispose()
  }
}
