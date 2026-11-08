import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { ChatBridge } from '../../collector/chat.js'

function bridgeWith(fetcher: typeof fetch) {
  const dir = mkdtempSync(join(tmpdir(), 'atrium-chat-'))
  const stateFile = join(dir, 'state.json')
  const bridge = new ChatBridge({
    baseUrl: 'http://hub',
    token: 'user-token',
    stateFile,
    fetcher,
    replyTimeoutMs: 200,
    replyPollMs: 5,
  })
  return { bridge, stateFile, dir }
}

describe('chat bridge', () => {
  it('creates a snake and chat session, sends a side message and polls the reply', async () => {
    let snakeCreated = false
    let sessionCreated = false
    const calls: Array<{ url: string; init?: RequestInit }> = []
    const fetcher = (async (url: string, init?: RequestInit) => {
      calls.push({ url: String(url), ...(init ? { init } : {}) })
      const path = new URL(String(url)).pathname
      if (path === '/snakes' && init?.method === 'POST') {
        snakeCreated = true
        return new Response(JSON.stringify({ id: 's-1', token: 'snake-token' }), { status: 201 })
      }
      if (path === '/snakes') {
        return new Response(JSON.stringify({ snakes: snakeCreated ? [{ id: 's-1', active: true }] : [] }), { status: 200 })
      }
      if (path === '/api/chat/sessions' && init?.method === 'POST') {
        sessionCreated = true
        const body = JSON.parse(String(init.body)) as { id: string }
        return new Response(JSON.stringify({ id: body.id, name: 'Atrium' }), { status: 201 })
      }
      if (path === '/api/chat/sessions') {
        return new Response(JSON.stringify([]), { status: 200 })
      }
      if (path === '/snakes/s-1/chat/messages' && init?.method === 'POST') {
        return new Response(JSON.stringify({ ok: true }), { status: 202 })
      }
      if (path === '/snakes/s-1/chat/messages') {
        return new Response(
          JSON.stringify({
            messages: [{ id: 'm1', text: 'Here is my answer', from_id: 's-1', created_at: Date.now() / 1000 }],
          }),
          { status: 200 },
        )
      }
      return new Response('{}', { status: 404 })
    }) as typeof fetch

    const { bridge, stateFile } = bridgeWith(fetcher)
    const result = await bridge.ask({ key: 'agent-1', label: 'Ada', role: 'Engineer', text: 'How is it going?' })
    expect(result.status).toBe('replied')
    expect(result.messages[0]?.text).toBe('Here is my answer')
    expect(snakeCreated).toBe(true)
    expect(sessionCreated).toBe(true)

    const sendCall = calls.find((call) => call.url.endsWith('/chat/messages') && call.init?.method === 'POST')
    const headers = sendCall?.init?.headers as Record<string, string>
    expect(headers.Authorization).toBe('Bearer snake-token')
    expect(headers['X-Ananta-User-Authorization']).toBe('Bearer user-token')

    const state = JSON.parse(readFileSync(stateFile, 'utf8')) as {
      agents: Record<string, { snakeId: string; token: string; sessionId: string }>
    }
    expect(state.agents['agent-1']?.snakeId).toBe('s-1')
    expect(state.agents['agent-1']?.token).toBe('snake-token')
  })

  it('reuses the persisted snake and session on the next ask', async () => {
    let snakeCreates = 0
    const fetcher = (async (url: string, init?: RequestInit) => {
      const path = new URL(String(url)).pathname
      if (path === '/snakes' && init?.method === 'POST') {
        snakeCreates += 1
        return new Response(JSON.stringify({ id: 's-1', token: 'snake-token' }), { status: 201 })
      }
      if (path === '/snakes') {
        return new Response(JSON.stringify({ snakes: [{ id: 's-1', active: true }] }), { status: 200 })
      }
      if (path === '/api/chat/sessions' && init?.method === 'POST') {
        const body = JSON.parse(String(init.body)) as { id: string }
        return new Response(JSON.stringify({ id: body.id }), { status: 201 })
      }
      if (path === '/api/chat/sessions') return new Response('[]', { status: 200 })
      if (path.endsWith('/chat/messages') && init?.method === 'POST') return new Response('{}', { status: 202 })
      if (path.endsWith('/chat/messages')) {
        return new Response(JSON.stringify({ messages: [{ text: 'ok', from_id: 's-1', created_at: Date.now() / 1000 }] }), {
          status: 200,
        })
      }
      return new Response('{}', { status: 404 })
    }) as typeof fetch

    const { bridge } = bridgeWith(fetcher)
    await bridge.ask({ key: 'agent-1', label: 'Ada', role: 'Engineer', text: 'one' })
    await bridge.ask({ key: 'agent-1', label: 'Ada', role: 'Engineer', text: 'two' })
    expect(snakeCreates).toBe(1)
  })

  it('sends work steering as inject_instruction', async () => {
    const captured: { body?: Record<string, unknown> } = {}
    const fetcher = (async (_url: string, init?: RequestInit) => {
      captured.body = JSON.parse(String(init?.body)) as Record<string, unknown>
      return new Response(JSON.stringify({ status: 'ok', command: { status: 'accepted' } }), { status: 200 })
    }) as typeof fetch
    const { bridge } = bridgeWith(fetcher)
    const result = await bridge.steer({
      taskId: 'task-1',
      text: 'Please fix the failing test first',
      mode: 'pause_then_apply',
      instructionClass: 'correction',
    })
    expect(result.status).toBe('ok')
    const body = captured.body as Record<string, unknown>
    expect(body.type).toBe('inject_instruction')
    expect((body.payload as Record<string, unknown>).mode).toBe('pause_then_apply')
    expect((body.payload as Record<string, unknown>).instruction).toContain('failing test')
  })
})
