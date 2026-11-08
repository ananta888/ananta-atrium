export interface TouchCallbacks {
  onMove: (x: number, forward: number) => void
  onLook: (deltaX: number, deltaY: number) => void
  onReset: () => void
}

/**
 * Virtual joystick (left) and look area (right). Rendered as DOM so it works
 * with the same accessibility/focus model as the rest of the UI.
 */
export class TouchControls {
  private readonly root: HTMLDivElement
  private readonly knob: HTMLDivElement
  private activePointer: number | null = null
  private lookPointer: number | null = null
  private readonly callbacks: TouchCallbacks
  private enabled = false
  private lastLook = { x: 0, y: 0 }

  private readonly onVisibility = (): void => {
    if (document.visibilityState === 'hidden') this.reset()
  }

  constructor(container: HTMLElement, callbacks: TouchCallbacks) {
    this.callbacks = callbacks
    this.root = document.createElement('div')
    this.root.className = 'touch-controls'
    this.root.setAttribute('aria-hidden', 'true')
    this.root.innerHTML = `
      <div class="touch-stick" data-touch-stick>
        <div class="touch-knob" data-touch-knob></div>
      </div>
      <div class="touch-look" data-touch-look></div>
    `
    container.appendChild(this.root)
    this.knob = this.root.querySelector('[data-touch-knob]') as HTMLDivElement

    const stick = this.root.querySelector('[data-touch-stick]') as HTMLDivElement
    stick.addEventListener('pointerdown', this.onStickDown)
    stick.addEventListener('pointermove', this.onStickMove)
    stick.addEventListener('pointerup', this.onStickUp)
    stick.addEventListener('pointercancel', this.onStickUp)

    const look = this.root.querySelector('[data-touch-look]') as HTMLDivElement
    look.addEventListener('pointerdown', this.onLookDown)
    look.addEventListener('pointermove', this.onLookMove)
    look.addEventListener('pointerup', this.onLookUp)
    look.addEventListener('pointercancel', this.onLookUp)

    window.addEventListener('blur', this.reset)
    document.addEventListener('visibilitychange', this.onVisibility)
    this.setEnabled(false)
  }

  private readonly onStickDown = (event: PointerEvent): void => {
    if (!this.enabled) return
    this.activePointer = event.pointerId
    ;(event.target as HTMLElement).setPointerCapture(event.pointerId)
    this.updateStick(event)
  }

  private readonly onStickMove = (event: PointerEvent): void => {
    if (event.pointerId !== this.activePointer) return
    this.updateStick(event)
  }

  private readonly onStickUp = (event: PointerEvent): void => {
    if (event.pointerId !== this.activePointer) return
    this.activePointer = null
    this.knob.style.transform = 'translate(0px, 0px)'
    this.callbacks.onMove(0, 0)
  }

  private updateStick(event: PointerEvent): void {
    const stick = this.root.querySelector('[data-touch-stick]') as HTMLDivElement
    const rect = stick.getBoundingClientRect()
    const radius = rect.width / 2
    const dx = event.clientX - (rect.left + radius)
    const dy = event.clientY - (rect.top + radius)
    const length = Math.hypot(dx, dy)
    const limit = radius * 0.7
    const scale = length > limit ? limit / length : 1
    const x = (dx * scale) / limit
    const y = (dy * scale) / limit
    this.knob.style.transform = `translate(${dx * scale}px, ${dy * scale}px)`
    this.callbacks.onMove(x, -y)
  }

  private readonly onLookDown = (event: PointerEvent): void => {
    if (!this.enabled) return
    this.lookPointer = event.pointerId
    this.lastLook = { x: event.clientX, y: event.clientY }
    ;(event.target as HTMLElement).setPointerCapture(event.pointerId)
  }

  private readonly onLookMove = (event: PointerEvent): void => {
    if (event.pointerId !== this.lookPointer) return
    const dx = event.clientX - this.lastLook.x
    const dy = event.clientY - this.lastLook.y
    this.lastLook = { x: event.clientX, y: event.clientY }
    this.callbacks.onLook(dx * 1.4, dy * 1.4)
  }

  private readonly onLookUp = (event: PointerEvent): void => {
    if (event.pointerId !== this.lookPointer) return
    this.lookPointer = null
  }

  reset = (): void => {
    this.activePointer = null
    this.lookPointer = null
    this.knob.style.transform = 'translate(0px, 0px)'
    this.callbacks.onReset()
  }

  setEnabled(enabled: boolean): void {
    this.enabled = enabled
    this.root.classList.toggle('is-visible', enabled)
    if (!enabled) this.reset()
  }

  get isEnabled(): boolean {
    return this.enabled
  }

  dispose(): void {
    window.removeEventListener('blur', this.reset)
    document.removeEventListener('visibilitychange', this.onVisibility)
    this.root.remove()
  }
}

export function shouldEnableTouch(mode: 'auto' | 'on' | 'off', coarsePointer: boolean): boolean {
  if (mode === 'off') return false
  if (mode === 'on') return true
  return coarsePointer
}
