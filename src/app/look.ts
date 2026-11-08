export interface LookState {
  yaw: number
  pitch: number
}

export interface LookOptions {
  sensitivity: number
  invertX: boolean
  invertY: boolean
}

export const DEFAULT_LOOK: LookOptions = {
  sensitivity: 0.0022,
  invertX: false,
  invertY: false,
}

/**
 * Left-handed Babylon convention:
 * - mouse right (+dx) turns right (yaw increases)
 * - mouse up (-dy) looks up (pitch decreases)
 * Invert flags flip the respective axis independently.
 */
export function applyLook(state: LookState, dx: number, dy: number, options: LookOptions): LookState {
  const sensitivity = Math.max(0.0005, Math.min(0.006, options.sensitivity))
  const x = dx * (options.invertX ? -1 : 1) * sensitivity
  const y = dy * (options.invertY ? -1 : 1) * sensitivity
  return {
    yaw: state.yaw + x,
    pitch: Math.max(-1.35, Math.min(1.35, state.pitch + y)),
  }
}
