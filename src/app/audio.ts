export interface AudioVolumes {
  master: number
  ambience: number
  effects: number
}

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, Number.isFinite(value) ? value : 0))
}

/**
 * Procedural audio: no external assets, everything is synthesized with the
 * Web Audio API and only started after a user gesture.
 */
export class AudioDirector {
  private context: AudioContext | null = null
  private master: GainNode | null = null
  private ambienceGain: GainNode | null = null
  private effectsGain: GainNode | null = null
  private ambienceSource: AudioBufferSourceNode | null = null
  private volumes: AudioVolumes = { master: 0.8, ambience: 0.5, effects: 0.7 }
  private enabled = false
  private lastStepAt = 0

  get isEnabled(): boolean {
    return this.enabled
  }

  /** Must be called from a user gesture (click/keydown). */
  async enable(volumes: AudioVolumes): Promise<void> {
    this.volumes = { master: clamp01(volumes.master), ambience: clamp01(volumes.ambience), effects: clamp01(volumes.effects) }
    if (this.enabled) {
      this.applyVolumes()
      return
    }
    try {
      const Context = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
      if (!Context) return
      const context = new Context()
      await context.resume()
      this.context = context
      this.master = context.createGain()
      this.ambienceGain = context.createGain()
      this.effectsGain = context.createGain()
      this.ambienceGain.connect(this.master)
      this.effectsGain.connect(this.master)
      this.master.connect(context.destination)
      this.applyVolumes()
      this.startAmbience()
      this.enabled = true
    } catch (error) {
      console.warn('audio unavailable', error)
    }
  }

  setVolumes(volumes: AudioVolumes): void {
    this.volumes = { master: clamp01(volumes.master), ambience: clamp01(volumes.ambience), effects: clamp01(volumes.effects) }
    this.applyVolumes()
  }

  private applyVolumes(): void {
    if (!this.context) return
    const now = this.context.currentTime
    this.master?.gain.setTargetAtTime(this.volumes.master, now, 0.05)
    this.ambienceGain?.gain.setTargetAtTime(this.volumes.ambience * 0.06, now, 0.05)
    this.effectsGain?.gain.setTargetAtTime(this.volumes.effects * 0.35, now, 0.05)
  }

  private startAmbience(): void {
    if (!this.context || !this.ambienceGain) return
    const seconds = 2
    const buffer = this.context.createBuffer(1, this.context.sampleRate * seconds, this.context.sampleRate)
    const data = buffer.getChannelData(0)
    let brown = 0
    for (let i = 0; i < data.length; i++) {
      const white = Math.random() * 2 - 1
      brown = (brown + 0.02 * white) / 1.02
      data[i] = brown * 3.2
    }
    const source = this.context.createBufferSource()
    source.buffer = buffer
    source.loop = true
    const filter = this.context.createBiquadFilter()
    filter.type = 'lowpass'
    filter.frequency.value = 480
    source.connect(filter)
    filter.connect(this.ambienceGain)
    source.start()
    this.ambienceSource = source
  }

  /** Footstep cue, rate-limited; pan follows the walking direction. */
  footstep(pan = 0): void {
    if (!this.enabled || !this.context || !this.effectsGain) return
    const now = this.context.currentTime * 1000
    if (now - this.lastStepAt < 320) return
    this.lastStepAt = now
    const context = this.context
    const duration = 0.09
    const buffer = context.createBuffer(1, context.sampleRate * duration, context.sampleRate)
    const data = buffer.getChannelData(0)
    for (let i = 0; i < data.length; i++) {
      const envelope = Math.exp(-i / (data.length * 0.25))
      data[i] = (Math.random() * 2 - 1) * envelope
    }
    const source = context.createBufferSource()
    source.buffer = buffer
    const filter = context.createBiquadFilter()
    filter.type = 'lowpass'
    filter.frequency.value = 260
    const panner = context.createStereoPanner()
    panner.pan.value = Math.max(-1, Math.min(1, pan))
    source.connect(filter)
    filter.connect(panner)
    panner.connect(this.effectsGain)
    source.start()
  }

  /** Short status cue: source transitions and replay state. */
  cue(kind: 'live' | 'fake' | 'record' = 'fake'): void {
    if (!this.enabled || !this.context || !this.effectsGain) return
    const context = this.context
    const oscillator = context.createOscillator()
    const gain = context.createGain()
    oscillator.type = 'sine'
    oscillator.frequency.value = kind === 'live' ? 660 : kind === 'record' ? 440 : 330
    gain.gain.setValueAtTime(0.0001, context.currentTime)
    gain.gain.exponentialRampToValueAtTime(0.08, context.currentTime + 0.02)
    gain.gain.exponentialRampToValueAtTime(0.0001, context.currentTime + 0.22)
    oscillator.connect(gain)
    gain.connect(this.effectsGain)
    oscillator.start()
    oscillator.stop(context.currentTime + 0.24)
  }

  dispose(): void {
    this.ambienceSource?.stop()
    this.ambienceSource = null
    void this.context?.close()
    this.context = null
    this.enabled = false
  }
}
