import type { AgentState } from '../shared/agent-state.js'
import type { CampusDef } from '../shared/campus.js'
import type { AgentIdentity } from './roster.js'
import { Simulation } from './simulation.js'

export interface FakeSourceOptions {
  campus: CampusDef
  roster?: AgentIdentity[]
  seed?: string
  startTimeMs?: number
}

/**
 * Deterministic development source. Always labelled `source: fake` in the UI —
 * it must never be presented as live data.
 */
export class FakeAgentSource {
  readonly simulation: Simulation

  constructor(options: FakeSourceOptions) {
    this.simulation = new Simulation({
      campus: options.campus,
      seed: options.seed ?? 'atrium-fake',
      ...(options.roster !== undefined ? { roster: options.roster } : {}),
      ...(options.startTimeMs !== undefined ? { startTimeMs: options.startTimeMs } : {}),
    })
  }

  tick(): void {
    this.simulation.step()
  }

  snapshot(): AgentState[] {
    return this.simulation.snapshot('fake').map((agent) => ({ ...agent, source: 'fake' }))
  }
}
