import type { AgentStatus } from '../shared/agent-state.js'
import type { Language } from './settings.js'

type Dictionary = Record<string, string>

const en: Dictionary = {
  'app.title': 'ANANTA ATRIUM',
  'app.subtitle': 'Live agents, walkable campus',
  'menu.badge': 'v{version} · visual blockout',
  'menu.feature1': 'Live Ananta state or labelled fake crowd',
  'menu.feature2': 'Five buildings, 120 desks, walkable campus',
  'menu.feature3': 'Replay, spectator, touch and German/English UI',
  'menu.pitch':
    'Walk through a campus where AI agents work. Demo mode runs a deterministic fake crowd locally; Connect streams live state from your Ananta collector.',
  'menu.demo': 'Enter demo mode',
  'menu.connect': 'Connect to Ananta',
  'menu.settings': 'Settings',
  'menu.help': 'WASD to walk · Shift to run · Esc releases the mouse · L opens the agent list · F3 nav debug',
  'connect.title': 'Connect to Ananta',
  'connect.explain':
    'The collector runs on this machine and talks to the Ananta hub. The browser only connects to the collector — never paste a hub token here.',
  'connect.url': 'Collector WebSocket URL',
  'connect.button': 'Connect',
  'connect.demo': 'Back to demo',
  'connect.checking': 'Connecting…',
  'connect.failed': 'No stream yet. Check that the collector is running and the URL matches its /stream endpoint.',
  'connect.live': 'Connected. Waiting for the first snapshot…',
  'settings.title': 'Settings',
  'settings.language': 'Language',
  'settings.quality': 'Graphics quality',
  'settings.uiScale': 'UI scale',
  'settings.reducedMotion': 'Reduced motion',
  'settings.colorBlind': 'Colour-blind-safe status colours',
  'settings.mouse': 'Mouse look',
  'settings.mouseSensitivity': 'Look sensitivity',
  'settings.invertMouseX': 'Invert horizontal axis',
  'settings.invertMouseY': 'Invert vertical axis',
  'settings.audioMaster': 'Master volume',
  'settings.audioAmbience': 'Ambience',
  'settings.audioEffects': 'Effects',
  'settings.touch': 'Touch controls',
  'settings.touchAuto': 'Auto (touch devices only)',
  'settings.touchOn': 'Always on',
  'settings.touchOff': 'Off',
  'settings.keys': 'Key bindings',
  'settings.keyForward': 'Forward',
  'settings.keyBack': 'Back',
  'settings.keyLeft': 'Left',
  'settings.keyRight': 'Right',
  'settings.keyRun': 'Run',
  'settings.reset': 'Reset to defaults',
  'settings.apply': 'Close',
  'settings.saved': 'Saved locally.',
  'agentList.title': 'Agents',
  'agentList.filterStatus': 'Status',
  'agentList.filterRoom': 'Room',
  'agentList.all': 'All',
  'agentList.empty': 'No agents match this filter.',
  'agentList.count': '{count} agents',
  'agentList.minimap': 'Campus minimap',
  'common.close': 'Close',
  'replay.title': 'Replay',
  'replay.start': 'Recorded buffer',
  'replay.play': 'Play',
  'replay.pause': 'Pause',
  'replay.live': 'Live',
  'replay.scrub': 'Scrub recorded session',
  'replay.empty': 'No recorded frames yet.',
  'hud.source': 'SOURCE: {source} · {connection}',
  'hud.stats': '{count} agents · {fps} fps · {backend} · t{tick}',
  'hud.room': '{building} — {room}',
  'hud.crosshair': 'Click to enter · WASD to walk · Shift to run · Esc to release',
  'hud.enter': 'CLICK TO ENTER THE ATRIUM',
  'hud.inspectTask': 'Task: {title}',
  'hud.inspectProgress': 'Progress: {percent}%',
  'hud.inspectThroughput': 'Throughput: {value} tok/s',
  'hud.inspectNoThroughput': 'Throughput: —',
  'hud.inspectSource': 'Source: {source}',
  'hud.inspectStatus': 'Status: {status} · {activity}',
  'hud.sourceLive': 'LIVE',
  'hud.sourceFake': 'FAKE',
  'hud.culling': 'Visible rooms: {visible}/{total} · draw calls: {draws}',
  'status.idle': 'Idle',
  'status.working': 'Working',
  'status.waiting': 'Waiting',
  'status.reviewing': 'Reviewing',
  'status.offline': 'Offline',
  'error.boot': 'Ananta Atrium failed to start',
  'touch.move': 'Move',
  'touch.look': 'Look',
}

const de: Dictionary = {
  'app.title': 'ANANTA ATRIUM',
  'app.subtitle': 'Live-Agenten, begehbarer Campus',
  'menu.badge': 'v{version} · visueller Blockout',
  'menu.feature1': 'Live-Ananta-Zustand oder klar gelabelte Fake-Crowd',
  'menu.feature2': 'Fünf Gebäude, 120 Schreibtische, begehbarer Campus',
  'menu.feature3': 'Replay, Spectator, Touch und deutsche/englische UI',
  'menu.pitch':
    'Geh durch einen Campus, auf dem KI-Agenten arbeiten. Der Demo-Modus betreibt eine deterministische Fake-Crowd lokal; „Verbinden“ streamt Live-Zustand aus deinem Ananta-Collector.',
  'menu.demo': 'Demo-Modus starten',
  'menu.connect': 'Mit Ananta verbinden',
  'menu.settings': 'Einstellungen',
  'menu.help': 'WASD zum Gehen · Shift zum Rennen · Esc gibt die Maus frei · L öffnet die Agentenliste · F3 Nav-Debug',
  'connect.title': 'Mit Ananta verbinden',
  'connect.explain':
    'Der Collector läuft auf diesem Rechner und spricht mit dem Ananta-Hub. Der Browser verbindet sich nur mit dem Collector — hier niemals ein Hub-Token einfügen.',
  'connect.url': 'Collector-WebSocket-URL',
  'connect.button': 'Verbinden',
  'connect.demo': 'Zurück zur Demo',
  'connect.checking': 'Verbinde…',
  'connect.failed': 'Noch kein Stream. Prüfe, ob der Collector läuft und die URL zu seinem /stream-Endpunkt passt.',
  'connect.live': 'Verbunden. Warte auf den ersten Snapshot…',
  'settings.title': 'Einstellungen',
  'settings.language': 'Sprache',
  'settings.quality': 'Grafikqualität',
  'settings.uiScale': 'UI-Skalierung',
  'settings.reducedMotion': 'Bewegung reduzieren',
  'settings.colorBlind': 'Farbenblind-sichere Statusfarben',
  'settings.mouse': 'Maussteuerung',
  'settings.mouseSensitivity': 'Empfindlichkeit',
  'settings.invertMouseX': 'Horizontale Achse umkehren',
  'settings.invertMouseY': 'Vertikale Achse umkehren',
  'settings.audioMaster': 'Gesamtlautstärke',
  'settings.audioAmbience': 'Ambiente',
  'settings.audioEffects': 'Effekte',
  'settings.touch': 'Touch-Steuerung',
  'settings.touchAuto': 'Automatisch (nur Touch-Geräte)',
  'settings.touchOn': 'Immer an',
  'settings.touchOff': 'Aus',
  'settings.keys': 'Tastenbelegung',
  'settings.keyForward': 'Vorwärts',
  'settings.keyBack': 'Rückwärts',
  'settings.keyLeft': 'Links',
  'settings.keyRight': 'Rechts',
  'settings.keyRun': 'Rennen',
  'settings.reset': 'Auf Standard zurücksetzen',
  'settings.apply': 'Schließen',
  'settings.saved': 'Lokal gespeichert.',
  'agentList.title': 'Agenten',
  'agentList.filterStatus': 'Status',
  'agentList.filterRoom': 'Raum',
  'agentList.all': 'Alle',
  'agentList.empty': 'Keine Agenten für diesen Filter.',
  'agentList.count': '{count} Agenten',
  'agentList.minimap': 'Campus-Minimap',
  'common.close': 'Schließen',
  'replay.title': 'Replay',
  'replay.start': 'Aufgezeichneter Puffer',
  'replay.play': 'Abspielen',
  'replay.pause': 'Pause',
  'replay.live': 'Live',
  'replay.scrub': 'Aufgezeichnete Sitzung scrubben',
  'replay.empty': 'Noch keine Frames aufgezeichnet.',
  'hud.source': 'QUELLE: {source} · {connection}',
  'hud.stats': '{count} Agenten · {fps} fps · {backend} · t{tick}',
  'hud.room': '{building} — {room}',
  'hud.crosshair': 'Klicken zum Eintreten · WASD zum Gehen · Shift zum Rennen · Esc zum Freigeben',
  'hud.enter': 'KLICKEN, UM DAS ATRIUM ZU BETRETEN',
  'hud.inspectTask': 'Aufgabe: {title}',
  'hud.inspectProgress': 'Fortschritt: {percent}%',
  'hud.inspectThroughput': 'Durchsatz: {value} tok/s',
  'hud.inspectNoThroughput': 'Durchsatz: —',
  'hud.inspectSource': 'Quelle: {source}',
  'hud.inspectStatus': 'Status: {status} · {activity}',
  'hud.sourceLive': 'LIVE',
  'hud.sourceFake': 'FAKE',
  'hud.culling': 'Sichtbare Räume: {visible}/{total} · Draw Calls: {draws}',
  'status.idle': 'Inaktiv',
  'status.working': 'Arbeitet',
  'status.waiting': 'Wartet',
  'status.reviewing': 'Prüft',
  'status.offline': 'Offline',
  'error.boot': 'Ananta Atrium konnte nicht starten',
  'touch.move': 'Bewegen',
  'touch.look': 'Umsehen',
}

const dictionaries: Record<Language, Dictionary> = { en, de }
let current: Language = 'en'

export function setLanguage(language: Language): void {
  current = language
}

export function getLanguage(): Language {
  return current
}

export function t(key: string, params?: Record<string, string | number>): string {
  const template = dictionaries[current][key] ?? dictionaries.en[key] ?? key
  if (!params) return template
  return template.replace(/\{(\w+)\}/g, (_, name: string) => String(params[name] ?? `{${name}}`))
}

export function statusLabel(status: AgentStatus): string {
  return t(`status.${status}`)
}

export function localeKeys(language: Language): string[] {
  return Object.keys(dictionaries[language]).sort()
}

export function hasKey(language: Language, key: string): boolean {
  return key in dictionaries[language]
}
