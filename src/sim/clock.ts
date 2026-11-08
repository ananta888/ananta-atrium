/**
 * Fixed-step driver. Rendering may run at any refresh rate; the simulation
 * always advances in whole ticks so results are reproducible.
 */
export interface FixedStepOptions {
  tickSeconds: number
  maxStepsPerFrame?: number
}

export class FixedStepDriver {
  readonly tickSeconds: number
  private readonly maxStepsPerFrame: number
  private accumulator = 0
  private ticks = 0

  constructor(options: FixedStepOptions) {
    if (!(options.tickSeconds > 0)) throw new Error('tickSeconds must be positive')
    this.tickSeconds = options.tickSeconds
    this.maxStepsPerFrame = options.maxStepsPerFrame ?? 8
  }

  get tick(): number {
    return this.ticks
  }

  get interpolate(): number {
    return this.accumulator / this.tickSeconds
  }

  /** Feed real elapsed seconds, run the callback per fixed tick, return ticks run. */
  advance(elapsedSeconds: number, step: (tickIndex: number) => void): number {
    if (!Number.isFinite(elapsedSeconds) || elapsedSeconds < 0) return 0
    // Clamp huge frame gaps (tab switch, breakpoint) so we do not spiral.
    this.accumulator += Math.min(elapsedSeconds, this.tickSeconds * this.maxStepsPerFrame)
    let steps = 0
    while (this.accumulator >= this.tickSeconds && steps < this.maxStepsPerFrame) {
      step(this.ticks)
      this.ticks += 1
      this.accumulator -= this.tickSeconds
      steps += 1
    }
    return steps
  }
}
