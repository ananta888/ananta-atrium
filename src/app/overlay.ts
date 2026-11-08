import type { AgentState, AgentStatus } from '../shared/agent-state.js'
import { allRooms, type CampusDef } from '../shared/campus.js'
import { setLanguage, statusLabel, t } from './i18n.js'
declare const __APP_VERSION__: string

import {
  DEFAULT_SETTINGS,
  type Language,
  type Quality,
  type Settings,
  type TouchMode,
} from './settings.js'

export interface ChatRequest {
  agentId: string
  taskId?: string
  text: string
  mode: 'ask' | 'steer'
  steerMode: 'next_iteration_instruction' | 'pause_then_apply' | 'context_note_only'
  instructionClass: 'correction' | 'constraint' | 'preference' | 'branch_hint' | 'stop_condition'
}

export interface ChatResult {
  ok: boolean
  message: string
  replies?: Array<{ sender: string; text: string }>
}

export interface OverlayCallbacks {
  onEnterDemo: () => void
  onConnect: (url: string) => void
  onSettingsChange: (settings: Settings) => void
  onReplayRecord: (recording: boolean) => void
  onReplayPlay: (playing: boolean) => void
  onReplaySeek: (t: number) => void
  onFocusAgent: (id: string | null) => void
  onChat: (request: ChatRequest) => Promise<ChatResult>
}

export interface PlayerPose {
  x: number
  z: number
  yaw: number
}

export interface ReplayInfo {
  frameCount: number
  duration: number
  current: number
  recording: boolean
  playing: boolean
}

const STATUS_ICONS: Record<AgentStatus, string> = {
  idle: '○',
  working: '●',
  waiting: '◐',
  reviewing: '◉',
  offline: '⊘',
}

const STATUS_COLORS: Record<AgentStatus, string> = {
  idle: '#8a9aad',
  working: '#4fd39a',
  waiting: '#f0c674',
  reviewing: '#7cc4ff',
  offline: '#6b7280',
}

const STATUS_COLORS_CB: Record<AgentStatus, string> = {
  idle: '#9ca3af',
  working: '#0072b2',
  waiting: '#e69f00',
  reviewing: '#56b4e9',
  offline: '#666666',
}

const ALL_STATUSES: AgentStatus[] = ['working', 'reviewing', 'waiting', 'idle', 'offline']

function element<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className?: string,
  textValue?: string,
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag)
  if (className) node.className = className
  if (textValue !== undefined) node.textContent = textValue
  return node
}

function button(label: string, className = 'ui-button'): HTMLButtonElement {
  const node = element('button', className)
  node.type = 'button'
  node.textContent = label
  return node
}

export class Overlay {
  private readonly root: HTMLDivElement
  private readonly campus: CampusDef
  private readonly callbacks: OverlayCallbacks
  private settings: Settings

  private readonly menu: HTMLDivElement
  private readonly startCard: HTMLDivElement
  private readonly connectCard: HTMLDivElement
  private readonly settingsLayer: HTMLDivElement
  private readonly agentPanel: HTMLDivElement
  private readonly replayBar: HTMLDivElement
  private readonly toolbar: HTMLDivElement
  private readonly minimap: HTMLCanvasElement
  private readonly agentList: HTMLUListElement
  private readonly agentCount: HTMLSpanElement
  private readonly statusFilter: HTMLSelectElement
  private readonly roomFilter: HTMLSelectElement
  private connectStatus!: HTMLDivElement
  private connectWarning!: HTMLDivElement
  private connectUrl!: HTMLInputElement
  private readonly replayRange: HTMLInputElement
  private readonly replayLabel: HTMLSpanElement
  private readonly replayPlay: HTMLButtonElement
  private readonly replayRecord: HTMLInputElement

  private agents: AgentState[] = []
  private player: PlayerPose = { x: 0, z: 0, yaw: 0 }
  private roomNames = new Map<string, string>()
  private selectedAgent: string | null = null
  private readonly detailRoot: HTMLDivElement
  private readonly detailTitle: HTMLDivElement
  private readonly detailBody: HTMLDivElement
  private readonly detailBudgets: HTMLDivElement
  private readonly detailAttempts: HTMLDivElement
  private readonly detailDiff: HTMLPreElement
  private readonly detailEvents: HTMLUListElement
  private readonly chatMode: HTMLSelectElement
  private readonly chatSteerMode: HTMLSelectElement
  private readonly chatClass: HTMLSelectElement
  private readonly chatText: HTMLTextAreaElement
  private readonly chatSend: HTMLButtonElement
  private readonly chatStatus: HTMLDivElement
  private readonly chatReplies: HTMLUListElement
  private readonly queueChip: HTMLSpanElement
  private queueCounts = { active: 0, queued: 0 }
  private agentListSignature = ''
  private connection: 'connecting' | 'live' | 'offline' = 'offline'
  private connectVisible = false
  private replay: ReplayInfo = {
    frameCount: 0,
    duration: 0,
    current: 0,
    recording: false,
    playing: false,
  }

  constructor(root: HTMLElement, campus: CampusDef, settings: Settings, callbacks: OverlayCallbacks) {
    this.root = element('div', 'ui-root')
    this.campus = campus
    this.callbacks = callbacks
    this.settings = settings
    for (const room of allRooms(campus)) this.roomNames.set(room.id, room.name)
    root.appendChild(this.root)

    this.menu = element('div', 'ui-layer ui-menu')
    this.startCard = this.buildStartCard()
    this.connectCard = this.buildConnectCard()
    this.menu.append(this.startCard, this.connectCard)

    this.settingsLayer = element('div', 'ui-layer ui-menu')
    this.settingsLayer.hidden = true

    this.toolbar = element('div', 'ui-toolbar')
    this.queueChip = element('span', 'ui-chip', t('queue.label', { active: 0, queued: 0 }))
    this.queueChip.style.pointerEvents = 'none'
    this.toolbar.append(this.queueChip)
    const agentsButton = button(t('agentList.title'), 'ui-chip')
    agentsButton.addEventListener('click', () => this.toggleAgentList())
    const replayButton = button(t('replay.title'), 'ui-chip')
    replayButton.addEventListener('click', () => this.toggleReplay())
    const settingsButton = button(t('menu.settings'), 'ui-chip')
    settingsButton.addEventListener('click', () => this.openSettings())
    this.toolbar.append(agentsButton, replayButton, settingsButton)

    this.agentPanel = element('div', 'ui-panel')
    this.agentPanel.hidden = true
    this.agentPanel.setAttribute('aria-label', t('agentList.title'))
    const header = element('div', 'ui-panel-header')
    header.append(element('strong', undefined, t('agentList.title')))
    const closeAgents = button('×', 'ui-chip')
    closeAgents.setAttribute('aria-label', t('common.close'))
    closeAgents.addEventListener('click', () => {
      this.agentPanel.hidden = true
    })
    header.append(closeAgents)
    this.agentCount = element('span', 'ui-note', '')

    const filters = element('div', 'ui-row')
    this.statusFilter = element('select')
    this.statusFilter.setAttribute('aria-label', t('agentList.filterStatus'))
    this.statusFilter.append(this.option(t('agentList.all'), 'all'))
    for (const status of ALL_STATUSES) this.statusFilter.append(this.option(statusLabel(status), status))
    this.roomFilter = element('select')
    this.roomFilter.setAttribute('aria-label', t('agentList.filterRoom'))
    this.roomFilter.append(this.option(t('agentList.all'), 'all'))
    const roomIds = [...new Set(this.agents.map((a) => a.roomId))].sort()
    for (const id of roomIds) this.roomFilter.append(this.option(this.roomNames.get(id) ?? id, id))
    filters.append(this.statusFilter, this.roomFilter)
    this.statusFilter.addEventListener('change', () => this.renderAgentList())
    this.roomFilter.addEventListener('change', () => this.renderAgentList())

    this.agentList = element('ul', 'ui-list')
    this.minimap = element('canvas', 'ui-minimap')
    this.minimap.width = 340
    this.minimap.height = 220
    this.minimap.setAttribute('aria-label', t('agentList.minimap'))
    this.detailRoot = element('div', 'ui-detail')
    this.detailRoot.hidden = true
    this.detailTitle = element('div', 'ui-detail-title')
    this.detailBody = element('div', 'ui-note')
    this.detailBudgets = element('div', 'ui-budgets')
    this.detailAttempts = element('div', 'ui-note')
    this.detailDiff = element('pre', 'ui-pre')
    this.detailEvents = element('ul', 'ui-events')
    const chatBox = element('div', 'ui-chat')
    chatBox.append(element('div', 'ui-detail-title', t('chat.title')))
    this.chatMode = element('select')
    this.chatMode.setAttribute('aria-label', t('chat.title'))
    this.chatMode.append(this.option(t('chat.modeAsk'), 'ask'), this.option(t('chat.modeSteer'), 'steer'))
    this.chatSteerMode = element('select')
    this.chatSteerMode.setAttribute('aria-label', t('chat.steerMode'))
    this.chatSteerMode.append(
      this.option(t('chat.modeNext'), 'next_iteration_instruction'),
      this.option(t('chat.modePause'), 'pause_then_apply'),
      this.option(t('chat.modeContext'), 'context_note_only'),
    )
    this.chatClass = element('select')
    this.chatClass.setAttribute('aria-label', t('chat.class'))
    this.chatClass.append(
      this.option('correction', 'correction'),
      this.option('constraint', 'constraint'),
      this.option('preference', 'preference'),
      this.option('branch_hint', 'branch_hint'),
      this.option('stop_condition', 'stop_condition'),
    )
    this.chatText = element('textarea', 'ui-textarea')
    this.chatText.placeholder = t('chat.placeholder')
    this.chatText.rows = 2
    this.chatSend = button(t('chat.send'), 'ui-button primary')
    this.chatStatus = element('div', 'ui-status')
    this.chatReplies = element('ul', 'ui-events')
    const chatControls = element('div', 'ui-chat-controls')
    chatControls.append(this.chatMode, this.chatSteerMode, this.chatClass, this.chatSend)
    chatBox.append(chatControls, this.chatText, this.chatStatus, this.chatReplies)
    this.detailRoot.append(
      this.detailTitle,
      this.detailBody,
      this.detailBudgets,
      this.detailAttempts,
      element('div', 'ui-note', t('detail.diff')),
      this.detailDiff,
      element('div', 'ui-note', t('detail.events')),
      this.detailEvents,
      chatBox,
    )
    this.agentPanel.append(header, this.agentCount, filters, this.detailRoot, this.agentList, this.minimap)

    this.chatMode.addEventListener('change', () => this.syncChatMode())
    this.chatSend.addEventListener('click', () => void this.sendChat())
    this.syncChatMode()

    this.replayBar = element('div', 'ui-replay')
    this.replayBar.hidden = true
    const replayRow = element('div', 'ui-replay-row')
    this.replayRecord = element('input')
    this.replayRecord.type = 'checkbox'
    this.replayRecord.addEventListener('change', () => {
      this.replay.recording = this.replayRecord.checked
      this.callbacks.onReplayRecord(this.replay.recording)
      this.renderReplay()
    })
    const recordLabel = element('label', 'ui-check')
    recordLabel.append(this.replayRecord, element('span', undefined, t('replay.start')))
    const liveButton = button(t('replay.live'), 'ui-chip')
    liveButton.addEventListener('click', () => {
      this.replay.playing = false
      this.replay.recording = false
      this.callbacks.onReplayRecord(false)
      this.callbacks.onReplayPlay(false)
      this.callbacks.onReplaySeek(-1)
      this.renderReplay()
    })
    this.replayPlay = button(t('replay.play'), 'ui-chip')
    this.replayPlay.addEventListener('click', () => {
      this.replay.playing = !this.replay.playing
      if (this.replay.playing) this.replay.recording = false
      this.callbacks.onReplayRecord(this.replay.recording)
      this.renderReplay()
    })
    this.replayRange = element('input')
    this.replayRange.type = 'range'
    this.replayRange.min = '0'
    this.replayRange.max = '0'
    this.replayRange.step = '0.1'
    this.replayRange.setAttribute('aria-label', t('replay.scrub'))
    this.replayRange.addEventListener('input', () => {
      this.callbacks.onReplaySeek(Number(this.replayRange.value))
    })
    this.replayLabel = element('span', 'ui-note', '')
    replayRow.append(recordLabel, this.replayPlay, liveButton, this.replayRange, this.replayLabel)
    this.replayBar.append(replayRow)

    this.root.append(this.toolbar, this.agentPanel, this.replayBar, this.menu, this.settingsLayer, this.touchMount())
    this.applySettings(settings)
    this.renderMenuTexts()
    this.renderReplay()
    this.renderMinimap()
  }

  private option(label: string, value: string): HTMLOptionElement {
    const option = element('option', undefined, label)
    option.value = value
    return option
  }

  private touchMount(): HTMLDivElement {
    const mount = element('div')
    mount.dataset.touchMount = 'true'
    return mount
  }

  get touchContainer(): HTMLElement {
    return this.root.querySelector('[data-touch-mount]') as HTMLElement
  }

  private buildStartCard(): HTMLDivElement {
    const card = element('div', 'ui-card')
    const badge = element('div', 'ui-badge')
    badge.append(element('span', 'ui-badge-dot'), element('span', undefined, t('menu.badge', { version: __APP_VERSION__ })))
    const features = element('div', 'ui-features')
    for (const key of ['menu.feature1', 'menu.feature2', 'menu.feature3']) {
      features.append(element('span', 'ui-feature', t(key)))
    }
    card.append(
      element('h1', undefined, t('app.title')),
      element('p', 'ui-subtitle', t('app.subtitle')),
      badge,
      element('p', 'ui-pitch', t('menu.pitch')),
      features,
    )
    const actions = element('div', 'ui-actions')
    const demo = button(t('menu.demo'), 'ui-button primary')
    demo.addEventListener('click', () => {
      this.hideMenu()
      this.callbacks.onEnterDemo()
    })
    const connect = button(t('menu.connect'))
    connect.addEventListener('click', () => this.showConnect(true))
    const settings = button(t('menu.settings'))
    settings.addEventListener('click', () => this.openSettings())
    actions.append(demo, connect, settings)

    const language = element('div', 'ui-field')
    const languageLabel = element('label', undefined, t('settings.language'))
    const languageSelect = element('select')
    languageSelect.setAttribute('aria-label', t('settings.language'))
    languageSelect.append(this.option('English', 'en'), this.option('Deutsch', 'de'))
    languageSelect.value = this.settings.language
    languageSelect.addEventListener('change', () => {
      this.callbacks.onSettingsChange({ ...this.settings, language: languageSelect.value as Language })
    })
    language.append(languageLabel, languageSelect)

    card.append(actions, language, element('p', 'ui-help', t('menu.help')))
    return card
  }

  private buildConnectCard(): HTMLDivElement {
    const card = element('div', 'ui-card')
    card.hidden = true
    card.append(element('h2', undefined, t('connect.title')), element('p', 'ui-pitch', t('connect.explain')))

    const field = element('div', 'ui-field')
    const label = element('label', undefined, t('connect.url'))
    this.connectUrl = element('input')
    this.connectUrl.type = 'text'
    this.connectUrl.value = this.settings.collectorUrl
    this.connectUrl.setAttribute('aria-label', t('connect.url'))
    field.append(label, this.connectUrl)

    this.connectStatus = element('div', 'ui-status', '')
    this.connectWarning = element('div', 'ui-warning', '')
    this.connectWarning.hidden = true
    const actions = element('div', 'ui-actions')
    const connect = button(t('connect.button'), 'ui-button primary')
    connect.addEventListener('click', () => {
      this.syncConnectWarning()
      this.connectStatus.textContent = t('connect.checking')
      this.callbacks.onConnect(this.connectUrl.value.trim())
    })
    const demo = button(t('connect.demo'))
    demo.addEventListener('click', () => {
      this.hideMenu()
      this.callbacks.onEnterDemo()
    })
    const settings = button(t('menu.settings'))
    settings.addEventListener('click', () => this.openSettings())
    actions.append(connect, demo, settings)
    card.append(field, actions, this.connectWarning, this.connectStatus)
    return card
  }

  private renderMenuTexts(): void {
    // Start card texts are created once; rebuild is only needed after language change.
    const start = this.startCard
    const h1 = start.querySelector('h1')
    const subtitle = start.querySelector('.ui-subtitle')
    const pitch = start.querySelector('.ui-pitch')
    const buttons = start.querySelectorAll('button')
    if (h1) h1.textContent = t('app.title')
    if (subtitle) subtitle.textContent = t('app.subtitle')
    if (pitch) pitch.textContent = t('menu.pitch')
    if (buttons[0]) buttons[0].textContent = t('menu.demo')
    if (buttons[1]) buttons[1].textContent = t('menu.connect')
    if (buttons[2]) buttons[2].textContent = t('menu.settings')
    const help = start.querySelector('.ui-help')
    if (help) help.textContent = t('menu.help')
    const badge = start.querySelector('.ui-badge span:last-child')
    if (badge) badge.textContent = t('menu.badge', { version: __APP_VERSION__ })
    const features = start.querySelectorAll('.ui-feature')
    const featureKeys = ['menu.feature1', 'menu.feature2', 'menu.feature3']
    features.forEach((node, index) => {
      const key = featureKeys[index]
      if (key) node.textContent = t(key)
    })

    const connectCard = this.connectCard
    const connectTitle = connectCard.querySelector('h2')
    const connectPitch = connectCard.querySelector('.ui-pitch')
    const connectButtons = connectCard.querySelectorAll('button')
    const connectLabel = connectCard.querySelector('.ui-field label')
    if (connectTitle) connectTitle.textContent = t('connect.title')
    if (connectPitch) connectPitch.textContent = t('connect.explain')
    if (connectLabel) connectLabel.textContent = t('connect.url')
    if (connectButtons[0]) connectButtons[0].textContent = t('connect.button')
    if (connectButtons[1]) connectButtons[1].textContent = t('connect.demo')
    if (connectButtons[2]) connectButtons[2].textContent = t('menu.settings')

    this.toolbar.querySelectorAll('button')[0]!.textContent = t('agentList.title')
    this.toolbar.querySelectorAll('button')[1]!.textContent = t('replay.title')
    this.toolbar.querySelectorAll('button')[2]!.textContent = t('menu.settings')
    this.statusFilter.options[0]!.textContent = t('agentList.all')
    this.roomFilter.options[0]!.textContent = t('agentList.all')
    for (let i = 0; i < ALL_STATUSES.length; i++) {
      this.statusFilter.options[i + 1]!.textContent = statusLabel(ALL_STATUSES[i] as AgentStatus)
    }
    this.renderReplay()
    this.queueChip.textContent = t('queue.label', this.queueCounts)
  }

  applySettings(settings: Settings): void {
    this.settings = settings
    setLanguage(settings.language)
    if (this.connectUrl) this.syncConnectWarning()
    this.root.style.fontSize = `${16 * settings.uiScale}px`
    this.root.classList.toggle('is-reduced-motion', settings.reducedMotion)
    this.connectUrl.value = settings.collectorUrl
    this.renderMenuTexts()
    this.renderAgentList()
    this.renderReplay()
    this.renderMinimap()
    if (!this.settingsLayer.hidden) {
      this.settingsLayer.replaceChildren(this.buildSettingsCard())
    }
  }

  showMenu(): void {
    this.menu.hidden = false
    this.showConnect(false)
  }

  hideMenu(): void {
    this.menu.hidden = true
  }

  private isLocalUrl(url: string): boolean {
    try {
      const host = new URL(url).hostname
      return host === 'localhost' || host === '127.0.0.1' || host === '::1'
    } catch {
      return false
    }
  }

  private syncConnectWarning(): void {
    const blocked = window.location.protocol === 'https:' && this.isLocalUrl(this.connectUrl.value)
    this.connectWarning.hidden = !blocked
    this.connectWarning.textContent = blocked ? t('connect.localBlocked') : ''
  }

  showConnect(visible: boolean): void {
    this.connectVisible = visible
    this.syncConnectWarning()
    this.startCard.hidden = visible
    this.connectCard.hidden = !visible
    if (visible) {
      this.connectStatus.textContent =
        this.connection === 'live' ? t('connect.live') : this.connection === 'connecting' ? t('connect.checking') : ''
    }
  }

  setConnection(status: 'connecting' | 'live' | 'offline'): void {
    this.connection = status
    if (!this.connectVisible) return
    if (status === 'live') {
      this.hideMenu()
    } else if (status === 'offline') {
      this.connectStatus.textContent = t('connect.failed')
    } else {
      this.connectStatus.textContent = t('connect.checking')
    }
  }

  openSettings(): void {
    if (!this.settingsLayer.hidden) return
    const card = this.buildSettingsCard()
    this.settingsLayer.replaceChildren(card)
    this.settingsLayer.hidden = false
    ;(card.querySelector('button') as HTMLButtonElement | null)?.focus()
  }

  closeSettings(): void {
    this.settingsLayer.hidden = true
  }

  private buildSettingsCard(): HTMLDivElement {
    const card = element('div', 'ui-card ui-settings-card')
    const title = element('h2', undefined, t('settings.title'))
    card.append(title)

    const languageField = element('div', 'ui-field')
    languageField.append(element('label', undefined, t('settings.language')))
    const language = element('select')
    language.setAttribute('aria-label', t('settings.language'))
    language.append(this.option('English', 'en'), this.option('Deutsch', 'de'))
    language.value = this.settings.language
    language.addEventListener('change', () => this.change({ language: language.value as Language }))
    languageField.append(language)

    const qualityField = element('div', 'ui-field')
    qualityField.append(element('label', undefined, t('settings.quality')))
    const quality = element('select')
    quality.setAttribute('aria-label', t('settings.quality'))
    for (const value of ['low', 'medium', 'high'] as Quality[]) quality.append(this.option(value, value))
    quality.value = this.settings.quality
    quality.addEventListener('change', () => this.change({ quality: quality.value as Quality }))
    qualityField.append(quality)

    const scaleField = element('div', 'ui-field')
    scaleField.append(element('label', undefined, t('settings.uiScale')))
    const scale = element('input')
    scale.type = 'range'
    scale.setAttribute('aria-label', t('settings.uiScale'))
    scale.min = '0.8'
    scale.max = '1.6'
    scale.step = '0.1'
    scale.value = String(this.settings.uiScale)
    scale.addEventListener('input', () => this.change({ uiScale: Number(scale.value) }))
    scaleField.append(scale)

    const checks = element('div')
    checks.append(
      this.checkbox(t('settings.reducedMotion'), this.settings.reducedMotion, (value) =>
        this.change({ reducedMotion: value }),
      ),
      this.checkbox(t('settings.colorBlind'), this.settings.colorBlindSafe, (value) =>
        this.change({ colorBlindSafe: value }),
      ),
    )

    const mouseField = element('div', 'ui-field')
    mouseField.append(element('label', undefined, t('settings.mouseSensitivity')))
    const sensitivity = element('input')
    sensitivity.type = 'range'
    sensitivity.min = '0.0005'
    sensitivity.max = '0.006'
    sensitivity.step = '0.0001'
    sensitivity.value = String(this.settings.mouseSensitivity)
    sensitivity.setAttribute('aria-label', t('settings.mouseSensitivity'))
    sensitivity.addEventListener('input', () => this.change({ mouseSensitivity: Number(sensitivity.value) }))
    mouseField.append(sensitivity)
    const mouseChecks = element('div')
    mouseChecks.append(
      this.checkbox(t('settings.invertMouseX'), this.settings.invertMouseX, (value) =>
        this.change({ invertMouseX: value }),
      ),
      this.checkbox(t('settings.invertMouseY'), this.settings.invertMouseY, (value) =>
        this.change({ invertMouseY: value }),
      ),
    )
    mouseChecks.setAttribute('aria-label', t('settings.mouse'))

    const audio = element('div', 'ui-row')
    audio.append(
      this.rangeField(t('settings.audioMaster'), this.settings.audio.master, (value) =>
        this.change({ audio: { ...this.settings.audio, master: value } }),
      ),
      this.rangeField(t('settings.audioAmbience'), this.settings.audio.ambience, (value) =>
        this.change({ audio: { ...this.settings.audio, ambience: value } }),
      ),
      this.rangeField(t('settings.audioEffects'), this.settings.audio.effects, (value) =>
        this.change({ audio: { ...this.settings.audio, effects: value } }),
      ),
    )

    const touchField = element('div', 'ui-field')
    touchField.append(element('label', undefined, t('settings.touch')))
    const touch = element('select')
    touch.setAttribute('aria-label', t('settings.touch'))
    touch.append(
      this.option(t('settings.touchAuto'), 'auto'),
      this.option(t('settings.touchOn'), 'on'),
      this.option(t('settings.touchOff'), 'off'),
    )
    touch.value = this.settings.touchControls
    touch.addEventListener('change', () => this.change({ touchControls: touch.value as TouchMode }))
    touchField.append(touch)

    const keys = element('fieldset', 'ui-field')
    keys.append(element('label', undefined, t('settings.keys')))
    const keyLabels: Array<[keyof Settings['keymap'], string]> = [
      ['forward', t('settings.keyForward')],
      ['back', t('settings.keyBack')],
      ['left', t('settings.keyLeft')],
      ['right', t('settings.keyRight')],
      ['run', t('settings.keyRun')],
    ]
    for (const [action, label] of keyLabels) {
      const field = element('div', 'ui-field')
      field.append(element('label', undefined, label))
      const input = element('input')
      input.type = 'text'
      input.readOnly = true
      input.value = this.settings.keymap[action]
      input.setAttribute('aria-label', label)
      input.addEventListener('focus', () => {
        input.dataset.capturing = 'true'
      })
      input.addEventListener('blur', () => {
        delete input.dataset.capturing
      })
      input.addEventListener('keydown', (event) => {
        if (!input.dataset.capturing) return
        event.preventDefault()
        input.value = event.code
        this.change({ keymap: { ...this.settings.keymap, [action]: event.code } })
      })
      field.append(input)
      keys.append(field)
    }

    const actions = element('div', 'ui-actions')
    const reset = button(t('settings.reset'))
    reset.addEventListener('click', () => {
      this.callbacks.onSettingsChange(structuredClone(DEFAULT_SETTINGS))
    })
    const close = button(t('settings.apply'), 'ui-button primary')
    close.addEventListener('click', () => this.closeSettings())
    actions.append(close, reset)

    card.append(languageField, qualityField, scaleField, checks, mouseField, mouseChecks, audio, touchField, keys, actions)
    return card
  }

  private checkbox(
    label: string,
    checked: boolean,
    onChange: (value: boolean) => void,
  ): HTMLLabelElement {
    const wrapper = element('label', 'ui-check')
    const input = element('input')
    input.type = 'checkbox'
    input.checked = checked
    input.addEventListener('change', () => onChange(input.checked))
    wrapper.append(input, element('span', undefined, label))
    return wrapper
  }

  private rangeField(
    label: string,
    value: number,
    onChange: (value: number) => void,
  ): HTMLDivElement {
    const field = element('div', 'ui-field')
    field.append(element('label', undefined, label))
    const input = element('input')
    input.type = 'range'
    input.min = '0'
    input.max = '1'
    input.step = '0.05'
    input.value = String(value)
    input.setAttribute('aria-label', label)
    input.addEventListener('input', () => onChange(Number(input.value)))
    field.append(input)
    return field
  }

  private change(patch: Partial<Settings>): void {
    this.callbacks.onSettingsChange({ ...this.settings, ...patch })
  }

  updateAgents(agents: AgentState[], player: PlayerPose): void {
    this.agents = agents
    this.player = player
    const known = new Set(this.roomFilter.options.length > 0 ? [...this.roomFilter.options].map((o) => o.value) : [])
    for (const agent of agents) {
      if (!known.has(agent.roomId)) {
        this.roomFilter.append(this.option(this.roomNames.get(agent.roomId) ?? agent.roomId, agent.roomId))
        known.add(agent.roomId)
      }
    }
    const counts = new Map<string, number>()
    for (const agent of agents) counts.set(agent.roomId, (counts.get(agent.roomId) ?? 0) + 1)
    for (const option of Array.from(this.roomFilter.options)) {
      if (option.value === 'all') continue
      const name = this.roomNames.get(option.value) ?? option.value
      option.textContent = `${name} (${counts.get(option.value) ?? 0})`
    }
    this.renderAgentList()
    this.renderDetail()
    this.renderMinimap()
  }

  private renderAgentList(): void {
    const status = this.statusFilter.value || 'all'
    const room = this.roomFilter.value || 'all'
    const filtered = this.agents.filter(
      (agent) => (status === 'all' || agent.status === status) && (room === 'all' || agent.roomId === room),
    )
    const signature = `${this.selectedAgent}|${status}|${room}|${this.settings.colorBlindSafe}|` +
      filtered.map((a) => `${a.id}:${a.status}:${a.roomId}:${a.task.title}`).join('|')
    if (signature === this.agentListSignature) return
    this.agentListSignature = signature
    this.agentCount.textContent = t('agentList.count', { count: filtered.length })
    this.agentList.replaceChildren()
    if (filtered.length === 0) {
      const empty = element('li', 'ui-note', t('agentList.empty'))
      this.agentList.append(empty)
      return
    }
    const palette = this.settings.colorBlindSafe ? STATUS_COLORS_CB : STATUS_COLORS
    for (const agent of filtered.sort((a, b) => a.name.localeCompare(b.name))) {
      const item = element('li')
      const row = element('button', 'ui-agent')
      row.type = 'button'
      row.setAttribute('aria-label', `${agent.name}, ${statusLabel(agent.status)}, ${this.roomNames.get(agent.roomId) ?? agent.roomId}`)
      row.title = agent.task.title
      if (this.selectedAgent === agent.id) row.classList.add('is-selected')
      row.addEventListener('click', () => {
        this.selectedAgent = this.selectedAgent === agent.id ? null : agent.id
        this.callbacks.onFocusAgent(this.selectedAgent)
        this.renderAgentList()
        this.renderDetail()
      })
      const dot = element('span', 'ui-dot')
      dot.style.background = palette[agent.status]
      dot.textContent = STATUS_ICONS[agent.status]
      dot.setAttribute('aria-hidden', 'true')
      const body = element('span')
      body.append(
        element('span', undefined, agent.name),
        element('br'),
        element('small', undefined, `${statusLabel(agent.status)} · ${this.roomNames.get(agent.roomId) ?? agent.roomId}`),
      )
      const progress = element('small', undefined, `${Math.round(agent.task.progress * 100)}%`)
      row.append(dot, body, progress)
      item.append(row)
      this.agentList.append(item)
    }
  }

  updateOps(ops: { active: unknown[]; queued: unknown[] }): void {
    this.queueCounts = { active: ops.active.length, queued: ops.queued.length }
    this.queueChip.textContent = t('queue.label', this.queueCounts)
  }

  private syncChatMode(): void {
    const steer = this.chatMode.value === 'steer'
    this.chatSteerMode.hidden = !steer
    this.chatClass.hidden = !steer
    this.chatStatus.textContent = t(steer ? 'chat.steerHint' : 'chat.askHint')
  }

  private meter(label: string, bucket: { unit: string; limit: number | null; used: number | null }): HTMLDivElement {
    const wrapper = element('div', 'ui-meter')
    const ratio =
      bucket.limit !== null && bucket.limit > 0 ? Math.max(0, Math.min(1, (bucket.used ?? 0) / bucket.limit)) : 0
    const format = (value: number): string => {
      if (bucket.unit !== 'ms') return `${Math.round(value)}`
      const seconds = Math.round(value / 1000)
      return seconds >= 60 ? `${Math.floor(seconds / 60)}m ${seconds % 60}s` : `${seconds}s`
    }
    const used = bucket.used === null ? t('detail.unknown') : format(bucket.used)
    const limit = bucket.limit === null ? t('detail.unknown') : format(bucket.limit)
    const track = element('div', 'ui-meter-track')
    const fill = element('div', 'ui-meter-fill')
    fill.style.width = `${Math.round(ratio * 100)}%`
    if (ratio > 0.85) fill.style.background = '#ef6f5a'
    track.append(fill)
    wrapper.append(element('div', 'ui-note', `${label}: ${used} / ${limit}`), track)
    return wrapper
  }

  private renderDetail(): void {
    const agent = this.agents.find((item) => item.id === this.selectedAgent)
    this.detailRoot.hidden = !agent
    if (!agent) return
    this.detailTitle.textContent = `${agent.name} · ${statusLabel(agent.status)}`
    this.detailBody.textContent = [
      agent.role,
      t('detail.task') + ': ' + agent.task.title,
      t('detail.progress') + ': ' + `${Math.round(agent.task.progress * 100)}%`,
    ].join('\n')

    this.detailBudgets.replaceChildren()
    const trace = agent.trace
    if (trace?.budget?.time) this.detailBudgets.append(this.meter(t('detail.time'), trace.budget.time))
    if (trace?.budget?.tokens) this.detailBudgets.append(this.meter(t('detail.tokens'), trace.budget.tokens))
    if (trace?.budget?.cost) this.detailBudgets.append(this.meter('Cost', trace.budget.cost))

    const attempts =
      trace?.attempts !== undefined
        ? `${trace.attempts}${trace.maxAttempts !== undefined ? ` / ${trace.maxAttempts}` : ''}`
        : t('detail.unknown')
    this.detailAttempts.textContent = `${t('detail.attempts')}: ${attempts}`

    if (trace?.diff) {
      const files = trace.diff.files.map((file) => `${file.path}  +${file.additions} -${file.deletions}`).join('\n')
      this.detailDiff.textContent = `${files}\n\n${trace.diff.preview.join('\n')}${trace.diff.truncated ? '\n… truncated' : ''}`
      this.detailDiff.hidden = false
    } else {
      this.detailDiff.textContent = t('detail.unknown')
    }

    this.detailEvents.replaceChildren()
    for (const event of (trace?.events ?? []).slice(-6)) {
      const item = element('li')
      const time = new Date(event.at).toLocaleTimeString()
      item.textContent = `${time} · ${event.kind} · ${event.summary}`
      this.detailEvents.append(item)
    }
    if ((trace?.events ?? []).length === 0) {
      this.detailEvents.append(element('li', 'ui-note', t('detail.unknown')))
    }
  }

  private async sendChat(): Promise<void> {
    const agent = this.agents.find((item) => item.id === this.selectedAgent)
    if (!agent) return
    const text = this.chatText.value.trim()
    if (!text) return
    const mode = this.chatMode.value === 'steer' ? 'steer' : 'ask'
    const taskId = agent.trace?.taskId ?? agent.task.taskId
    if (mode === 'steer' && !taskId) {
      this.chatStatus.textContent = t('chat.error', { message: 'task id unknown' })
      return
    }
    this.chatSend.disabled = true
    this.chatStatus.textContent = t('chat.sending')
    try {
      const result = await this.callbacks.onChat({
        agentId: agent.id,
        ...(taskId ? { taskId } : {}),
        text,
        mode,
        steerMode: this.chatSteerMode.value as ChatRequest['steerMode'],
        instructionClass: this.chatClass.value as ChatRequest['instructionClass'],
      })
      this.chatStatus.textContent = result.ok ? result.message : t('chat.error', { message: result.message })
      this.chatReplies.replaceChildren()
      for (const reply of result.replies ?? []) {
        const item = element('li')
        item.textContent = `${reply.sender}: ${reply.text}`
        this.chatReplies.append(item)
      }
      if (result.ok) this.chatText.value = ''
    } catch (error) {
      this.chatStatus.textContent = t('chat.error', { message: (error as Error).message })
    } finally {
      this.chatSend.disabled = false
    }
  }

  private renderMinimap(): void {
    const context = this.minimap.getContext('2d')
    if (!context) return
    const width = this.minimap.width
    const height = this.minimap.height
    context.clearRect(0, 0, width, height)
    const bounds = { minX: -60, maxX: 70, minZ: -60, maxZ: 50 }
    const sx = (x: number): number => ((x - bounds.minX) / (bounds.maxX - bounds.minX)) * width
    const sz = (z: number): number => ((z - bounds.minZ) / (bounds.maxZ - bounds.minZ)) * height

    context.fillStyle = 'rgba(40, 70, 60, 0.35)'
    context.fillRect(0, 0, width, height)
    for (const building of this.campus.buildings) {
      context.fillStyle = 'rgba(180, 200, 220, 0.35)'
      context.strokeStyle = 'rgba(200, 220, 240, 0.7)'
      context.lineWidth = 1
      const x = sx(building.origin.x - building.width / 2)
      const z = sz(building.origin.z - building.depth / 2)
      const w = (building.width / (bounds.maxX - bounds.minX)) * width
      const d = (building.depth / (bounds.maxZ - bounds.minZ)) * height
      context.fillRect(x, z, w, d)
      context.strokeRect(x, z, w, d)
    }

    const palette = this.settings.colorBlindSafe ? STATUS_COLORS_CB : STATUS_COLORS
    for (const agent of this.agents) {
      if (!agent.position) continue
      context.fillStyle = palette[agent.status]
      context.beginPath()
      context.arc(sx(agent.position.x), sz(agent.position.z), 2.2, 0, Math.PI * 2)
      context.fill()
    }

    context.save()
    context.translate(sx(this.player.x), sz(this.player.z))
    context.rotate(-this.player.yaw)
    context.fillStyle = '#ffffff'
    context.beginPath()
    context.moveTo(0, -6)
    context.lineTo(4, 5)
    context.lineTo(-4, 5)
    context.closePath()
    context.fill()
    context.restore()
  }

  setReplay(info: ReplayInfo): void {
    this.replay = info
    this.renderReplay()
  }

  private renderReplay(): void {
    this.replayRange.max = String(Math.max(0, this.replay.duration))
    this.replayRange.value = String(Math.min(this.replay.current, Math.max(0, this.replay.duration)))
    this.replayRange.disabled = this.replay.duration <= 0
    this.replayPlay.textContent = this.replay.playing ? t('replay.pause') : t('replay.play')
    this.replayRecord.checked = this.replay.recording
    this.replayLabel.textContent = this.replay.recording
      ? t('replay.start')
      : this.replay.duration > 0
        ? `${this.replay.current.toFixed(1)}s / ${this.replay.duration.toFixed(1)}s`
        : t('replay.empty')
  }

  toggleAgentList(): void {
    this.agentPanel.hidden = !this.agentPanel.hidden
    if (!this.agentPanel.hidden) this.renderAgentList()
  }

  showAgentList(): void {
    this.agentPanel.hidden = false
    this.renderAgentList()
    this.renderDetail()
  }

  toggleReplay(): void {
    this.replayBar.hidden = !this.replayBar.hidden
  }

  get agentListVisible(): boolean {
    return !this.agentPanel.hidden
  }

  get settingsVisible(): boolean {
    return !this.settingsLayer.hidden
  }

  dispose(): void {
    this.root.remove()
  }
}
