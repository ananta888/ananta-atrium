import { describe, expect, it } from 'vitest'
import { AnantaHubSource, mapTaskToAgent } from '../../collector/ananta-source.js'
import { campus } from '../../src/world/campus.js'

const now = 1_760_000_000_000

describe('task fallback', () => {
  it('maps a live task onto an agent state', () => {
    const agent = mapTaskToAgent(
      {
        id: 'task-1',
        title: 'Fix the collector',
        status: 'running',
        assigned_agent_url: 'http://ai-agent-beta:5000',
        updated_at: 1_760_000_000,
        task_kind: 'coding',
      },
      campus,
      now,
    )
    expect(agent.id).toBe('task:task-1')
    expect(agent.status).toBe('working')
    expect(agent.task.taskId).toBe('task-1')
    expect(agent.name).toBe('ai-agent-beta')
    expect(agent.role).toBe('coding')
    expect(agent.source).toBe('live')
  })

  it('uses tasks when the hub has no agent sessions', async () => {
    const fetcher = (async (url: string) => {
      const path = new URL(String(url)).pathname
      if (path === '/api/sessions') return new Response(JSON.stringify({ data: { items: [] } }), { status: 200 })
      if (path === '/tasks') {
        return new Response(
          JSON.stringify({
            data: [
              { id: 't1', title: 'Running task', status: 'running', assigned_agent_url: 'http://w1:5000', updated_at: 10 },
              { id: 't2', title: 'Old task', status: 'completed', updated_at: 1 },
            ],
          }),
          { status: 200 },
        )
      }
      return new Response('{}', { status: 404 })
    }) as typeof fetch
    const source = new AnantaHubSource({
      baseUrl: 'http://hub',
      token: 'token',
      campus,
      fetcher,
      traceEnabled: false,
    })
    const agents = await source.poll()
    expect(agents.map((agent) => agent.id)).toEqual(['task:t1'])
    expect(agents[0]?.task.title).toBe('Running task')
  })
})
