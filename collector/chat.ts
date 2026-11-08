import { readFileSync, writeFileSync } from 'node:fs'
import { randomUUID } from 'node:crypto'

export type SteerMode = 'next_iteration_instruction' | 'pause_then_apply' | 'context_note_only'
export type InstructionClass = 'correction' | 'constraint' | 'preference' | 'branch_hint' | 'stop_condition'

export interface ChatMessage {
  id?: string
  sender: string
  text: string
  at: string
}

export interface ChatBridgeOptions {
  baseUrl: string
  token: string
  stateFile: string
  fetcher?: typeof fetch
  replyTimeoutMs?: number
  replyPollMs?: number
}

interface SnakeRecord {
  snakeId: string
  token: string
  sessionId?: string
  name: string
}

interface ChatState {
  version: 1
  agents: Record<string, SnakeRecord>
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : null
}

/**
 * Two distinct chat modes:
 * - ask(): AI-Snake side conversation, never touches the task session.
 * - steer(): run-control inject_instruction, deliberately affects the task.
 *
 * Snake tokens and session mappings live in a local state file; they are never
 * committed and never sent to the browser.
 */
export class ChatBridge {
  private readonly baseUrl: string
  private readonly token: string
  private readonly stateFile: string
  private readonly fetcher: typeof fetch
  private readonly replyTimeoutMs: number
  private readonly replyPollMs: number
  private state: ChatState

  constructor(options: ChatBridgeOptions) {
    this.baseUrl = options.baseUrl
    this.token = options.token
    this.stateFile = options.stateFile
    this.fetcher = options.fetcher ?? fetch
    this.replyTimeoutMs = options.replyTimeoutMs ?? 8000
    this.replyPollMs = options.replyPollMs ?? 400
    this.state = this.loadState()
  }

  private loadState(): ChatState {
    try {
      const parsed = JSON.parse(readFileSync(this.stateFile, 'utf8')) as unknown
      const root = asRecord(parsed)
      const agents = asRecord(root?.agents)
      if (root?.version === 1 && agents) return { version: 1, agents: agents as Record<string, SnakeRecord> }
    } catch {
      // Missing or invalid state is fine; it is rebuilt on demand.
    }
    return { version: 1, agents: {} }
  }

  private saveState(): void {
    try {
      writeFileSync(this.stateFile, `${JSON.stringify(this.state, null, 2)}\n`, { mode: 0o600 })
    } catch (error) {
      console.warn('could not persist chat state:', (error as Error).message)
    }
  }

  private userHeaders(): Record<string, string> {
    return { Authorization: `Bearer ${this.token}`, Accept: 'application/json' }
  }

  private snakeHeaders(snakeToken: string): Record<string, string> {
    return {
      Authorization: `Bearer ${snakeToken}`,
      'X-Ananta-User-Authorization': `Bearer ${this.token}`,
      Accept: 'application/json',
    }
  }

  private async request(
    path: string,
    init: { method?: string; headers: Record<string, string>; body?: unknown },
  ): Promise<unknown> {
    const response = await this.fetcher(`${this.baseUrl}${path}`, {
      method: init.method ?? 'GET',
      headers: { 'Content-Type': 'application/json', ...init.headers },
      ...(init.body !== undefined ? { body: JSON.stringify(init.body) } : {}),
      signal: AbortSignal.timeout(10_000),
    })
    const text = await response.text()
    let parsed: unknown = null
    try {
      parsed = text.length > 0 ? JSON.parse(text) : null
    } catch {
      parsed = text
    }
    if (!response.ok) {
      const payload = asRecord(parsed)
      const message =
        (typeof payload?.error === 'string' && payload.error) ||
        (typeof payload?.message === 'string' && payload.message) ||
        `HTTP ${response.status}`
      throw new Error(`${path}: ${message}`)
    }
    return parsed
  }

  private async ensureSnake(key: string, label: string, role: string): Promise<SnakeRecord> {
    const existing = this.state.agents[key]
    if (existing) {
      try {
        const listing = await this.request('/snakes', { headers: this.userHeaders() })
        const snakes = Array.isArray(asRecord(listing)?.snakes) ? (asRecord(listing)?.snakes as unknown[]) : []
        if (snakes.some((item) => asRecord(item)?.id === existing.snakeId && asRecord(item)?.active === true)) {
          return existing
        }
      } catch {
        // Fall through and recreate.
      }
    }

    const displayName = `atrium:${key}`.slice(0, 60)
    const created = await this.request('/snakes', {
      method: 'POST',
      headers: this.userHeaders(),
      body: { name: displayName, role },
    })
    const record = asRecord(created)
    const snakeId = typeof record?.id === 'string' ? record.id : null
    const token = typeof record?.token === 'string' ? record.token : null
    if (!snakeId || !token) throw new Error('snake registration did not return id/token')
    const recordValue: SnakeRecord = { snakeId, token, name: label }
    this.state.agents[key] = recordValue
    this.saveState()
    return recordValue
  }

  private async ensureSession(snake: SnakeRecord, label: string): Promise<string> {
    if (snake.sessionId) return snake.sessionId
    const sessionName = `Atrium · ${label}`.slice(0, 80)
    const listing = await this.request('/api/chat/sessions', { headers: this.userHeaders() })
    const sessions = Array.isArray(listing)
      ? listing
      : Array.isArray(asRecord(listing)?.sessions)
        ? (asRecord(listing)?.sessions as unknown[])
        : []
    const existing = sessions
      .map((item) => asRecord(item))
      .find((item) => item && item.name === sessionName && typeof item.id === 'string')
    if (existing && typeof existing.id === 'string') {
      snake.sessionId = existing.id
      this.saveState()
      return existing.id
    }
    const created = await this.request('/api/chat/sessions', {
      method: 'POST',
      headers: this.userHeaders(),
      body: { id: `atrium-${randomUUID()}`, name: sessionName, profile_id: 'general' },
    })
    const id = typeof asRecord(created)?.id === 'string' ? (asRecord(created)?.id as string) : null
    if (!id) throw new Error('chat session creation returned no id')
    snake.sessionId = id
    this.saveState()
    return id
  }

  async ask(input: { key: string; label: string; role: string; text: string }): Promise<{
    status: 'replied' | 'pending'
    messages: ChatMessage[]
    greeting?: string
  }> {
    const text = input.text.trim().slice(0, 500)
    if (!text) throw new Error('message text is required')
    const snake = await this.ensureSnake(input.key, input.label, input.role)
    const sessionId = await this.ensureSession(snake, input.label)
    const since = Date.now() / 1000
    await this.request(`/snakes/${snake.snakeId}/chat/messages`, {
      method: 'POST',
      headers: this.snakeHeaders(snake.token),
      body: { channel_type: 'room', visibility: 'room', session_id: sessionId, text },
    })

    const deadline = Date.now() + this.replyTimeoutMs
    const messages: ChatMessage[] = []
    while (Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, this.replyPollMs))
      const listing = await this.request(
        `/snakes/${snake.snakeId}/chat/messages?session_id=${encodeURIComponent(sessionId)}&since=${since}`,
        { headers: this.snakeHeaders(snake.token) },
      )
      const items = Array.isArray(asRecord(listing)?.messages) ? (asRecord(listing)?.messages as unknown[]) : []
      for (const item of items) {
        const message = asRecord(item)
        if (!message) continue
        const messageText = typeof message.text === 'string' ? message.text : ''
        if (!messageText) continue
        messages.push({
          ...(typeof message.id === 'string' ? { id: message.id } : {}),
          sender: typeof message.from_id === 'string' ? message.from_id : 'agent',
          text: messageText.slice(0, 2000),
          at: new Date((typeof message.created_at === 'number' ? message.created_at : Date.now() / 1000) * 1000).toISOString(),
        })
      }
      if (messages.length > 0) break
    }
    return { status: messages.length > 0 ? 'replied' : 'pending', messages }
  }

  async steer(input: {
    taskId: string
    text: string
    mode: SteerMode
    instructionClass: InstructionClass
  }): Promise<{ status: string; command: unknown }> {
    const text = input.text.trim().slice(0, 4000)
    if (!text) throw new Error('instruction text is required')
    const result = await this.request(`/api/tasks/${encodeURIComponent(input.taskId)}/commands`, {
      method: 'POST',
      headers: this.userHeaders(),
      body: {
        type: 'inject_instruction',
        payload: {
          instruction: text,
          mode: input.mode,
          instruction_class: input.instructionClass,
        },
      },
    })
    const payload = asRecord(result)
    return {
      status: typeof payload?.status === 'string' ? payload.status : 'accepted',
      command: payload?.command ?? null,
    }
  }
}
