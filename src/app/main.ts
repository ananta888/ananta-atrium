import { AtriumSession } from './session.js'
import { t } from './i18n.js'
import './ui.css'

function showFatal(error: unknown): void {
  const target = document.getElementById('boot-error')
  const message = error instanceof Error ? `${error.message}\n\n${error.stack ?? ''}` : String(error)
  if (target) {
    target.style.display = 'grid'
    target.textContent = `${t('error.boot')}\n\n${message}`
  }
  console.error(error)
}

async function main(): Promise<void> {
  const root = document.getElementById('app')
  if (!root) throw new Error('#app element missing')

  const canvas = document.createElement('canvas')
  canvas.id = 'atrium-canvas'
  canvas.tabIndex = 0
  root.appendChild(canvas)

  const session = new AtriumSession(canvas)
  await session.start()

  window.addEventListener('beforeunload', () => session.stop())
  // Debug handle for the inspector console; not used by gameplay code.
  ;(window as unknown as Record<string, unknown>).__atrium = session
}

main().catch(showFatal)
