import type { AgentSource, AgentStatus } from '../shared/agent-state.js'

export interface AgentIdentity {
  id: string
  name: string
  role: string
}

const FIRST = [
  'Ada', 'Bjarne', 'Corin', 'Dara', 'Elio', 'Fenna', 'Galen', 'Hedi', 'Ivo', 'Juna',
  'Kai', 'Lior', 'Mira', 'Nils', 'Oona', 'Piet', 'Quinn', 'Rhea', 'Sami', 'Tove',
  'Ulf', 'Vera', 'Wim', 'Xenia', 'Yara', 'Zeno', 'Anouk', 'Bram', 'Cato', 'Diede',
  'Esmé', 'Faro', 'Greta', 'Hugo', 'Ines', 'Joris', 'Kira', 'Lars', 'Maja', 'Noor',
  'Otto', 'Pia', 'Roan', 'Sanne', 'Teun', 'Ulla', 'Vik', 'Wen', 'Yuki', 'Zora',
]

const LAST = [
  'Achterberg', 'Brandt', 'Costa', 'Dijkstra', 'Ehlers', 'Fontaine', 'Groot', 'Hansen',
  'Ibarra', 'Jansen', 'Kowalski', 'Lindqvist', 'Moreau', 'Novak', 'Okafor', 'Pereira',
  'Quast', 'Rossi', 'Sanchez', 'Takahashi', 'Ueda', 'Visser', 'Weber', 'Xu', 'Yilmaz',
  'Zimmer', 'Bakker', 'Chen', 'Dubois', 'Eriksen', 'Fischer', 'Garcia', 'Hoffmann',
  'Ivanova', 'Jung', 'Keller', 'Lopez', 'Meyer', 'Nielsen', 'Olsen', 'Park', 'Rahman',
  'Schmidt', 'Tanaka', 'Ulrich', 'Varga', 'Walsh', 'Young', 'Zhao', 'Bauer',
]

const ROLES = [
  'Backend Engineer',
  'Frontend Engineer',
  'Platform Engineer',
  'Researcher',
  'Reviewer',
  'Planner',
  'Data Engineer',
  'QA Engineer',
  'Security Engineer',
  'Technical Writer',
]

export function buildRoster(count: number): AgentIdentity[] {
  const roster: AgentIdentity[] = []
  for (let i = 0; i < count; i++) {
    const first = FIRST[i % FIRST.length] ?? 'Agent'
    const last = LAST[i % LAST.length] ?? String(i)
    roster.push({
      id: `agent-${String(i + 1).padStart(2, '0')}`,
      name: `${first} ${last}`,
      role: ROLES[i % ROLES.length] ?? 'Engineer',
    })
  }
  return roster
}

export const TASK_TITLES = [
  'Wire the state stream',
  'Review the collector adapter',
  'Fix the navmesh seam',
  'Profile the avatar crowd',
  'Draft the AgentState contract',
  'Bake interior lighting',
  'Tune the first-person controller',
  'Investigate stale session events',
  'Add LOD for office props',
  'Document the hub API',
  'Harden the WebSocket reconnect',
  'Measure draw calls in the atrium',
  'Write the release checklist',
  'Review room occupancy queries',
  'Instrument token throughput',
  'Refactor the desk assignment',
]

export interface LiveOverride {
  name?: string
  role?: string
  status: AgentStatus
  taskTitle: string
  taskProgress: number
  activityKind: 'typing' | 'reading' | 'thinking' | 'meeting' | 'walking' | 'reviewing' | 'idle'
  activityDetail?: string
  tokensPerSecond?: number
  source: AgentSource
  stale: boolean
}
