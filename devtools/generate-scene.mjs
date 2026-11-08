#!/usr/bin/env node
/**
 * One-off authoring helper for src/world/scene.json.
 * The committed JSON is the source of truth; this script only makes the
 * initial hand-authored layout less error-prone. Re-run deliberately.
 */
import { writeFileSync, mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')

const TEMPLATE = {
  floorHeight: 4,
  floors: 2,
  width: 24,
  depth: 14,
  stairs: { x: 10.5, z: 0 },
  entrance: { x: 0, z: 7 },
}

/** Rooms use the central corridor (z in -1.5..1.5). */
function roomsFor(prefix) {
  return [
    // Ground floor
    { id: `${prefix}-lobby`, name: 'Lobby', floor: 0, kind: 'lobby', min: { x: -3, z: 1.5 }, max: { x: 3, z: 7 } },
    { id: `${prefix}-office-a`, name: 'Studio A', floor: 0, kind: 'office', min: { x: -12, z: 1.5 }, max: { x: -3, z: 7 } },
    { id: `${prefix}-office-b`, name: 'Studio B', floor: 0, kind: 'office', min: { x: 3, z: 1.5 }, max: { x: 12, z: 7 } },
    { id: `${prefix}-meeting-a`, name: 'Meeting Alpha', floor: 0, kind: 'meeting', min: { x: -12, z: -7 }, max: { x: -3, z: -1.5 } },
    { id: `${prefix}-print`, name: 'Print Room', floor: 0, kind: 'service', min: { x: -3, z: -7 }, max: { x: 3, z: -1.5 } },
    { id: `${prefix}-cafe`, name: 'Café', floor: 0, kind: 'social', min: { x: 3, z: -7 }, max: { x: 12, z: -1.5 } },
    // First floor
    { id: `${prefix}-office-c`, name: 'Studio C', floor: 1, kind: 'office', min: { x: -12, z: 1.5 }, max: { x: -2, z: 7 } },
    { id: `${prefix}-office-d`, name: 'Studio D', floor: 1, kind: 'office', min: { x: -2, z: 1.5 }, max: { x: 7, z: 7 } },
    { id: `${prefix}-meeting-b`, name: 'Meeting Beta', floor: 1, kind: 'meeting', min: { x: 7, z: 1.5 }, max: { x: 12, z: 7 } },
    { id: `${prefix}-office-e`, name: 'Studio E', floor: 1, kind: 'office', min: { x: -12, z: -7 }, max: { x: -2, z: -1.5 } },
    { id: `${prefix}-office-f`, name: 'Studio F', floor: 1, kind: 'office', min: { x: -2, z: -7 }, max: { x: 7, z: -1.5 } },
    { id: `${prefix}-lounge`, name: 'Lounge', floor: 1, kind: 'social', min: { x: 7, z: -7 }, max: { x: 12, z: -1.5 } },
  ]
}

const buildings = [
  { id: 'atrium-hq', name: 'Atrium HQ', origin: { x: -28, y: 0, z: 0 } },
  { id: 'forge', name: 'Forge', origin: { x: 4, y: 0, z: 0 } },
  { id: 'observatory', name: 'Observatory', origin: { x: 36, y: 0, z: 0 } },
  { id: 'library', name: 'Library', origin: { x: -14, y: 0, z: -40 } },
  { id: 'studio', name: 'Studio', origin: { x: 26, y: 0, z: -40 } },
].map((b) => ({
  ...b,
  ...TEMPLATE,
  rooms: roomsFor(b.id).map((room) => ({ ...room, buildingId: b.id })),
}))

const desks = []
for (const building of buildings) {
  for (const room of building.rooms) {
    if (room.kind !== 'office') continue
    const w = room.max.x - room.min.x
    const d = room.max.z - room.min.z
    const rows = 2
    const cols = 2
    for (let row = 0; row < rows; row++) {
      for (let col = 0; col < cols; col++) {
        const id = `${room.id}-desk-${row * cols + col + 1}`
        desks.push({
          id,
          roomId: room.id,
          buildingId: building.id,
          position: {
            x: Number((room.min.x + (w * (col + 0.5)) / cols).toFixed(2)),
            y: room.floor * building.floorHeight,
            z: Number((room.min.z + (d * (row + 0.5)) / rows).toFixed(2)),
          },
          facing: 0,
        })
      }
    }
  }
}

const outdoorNodes = [
  { id: 'plaza-west', position: { x: -16, y: 0, z: 20 } },
  { id: 'plaza-centre', position: { x: 4, y: 0, z: 20 } },
  { id: 'plaza-east', position: { x: 24, y: 0, z: 20 } },
  { id: 'plaza-north', position: { x: 4, y: 0, z: 32 } },
  { id: 'lane-west', position: { x: -14, y: 0, z: 0 } },
  { id: 'lane-west-south', position: { x: -14, y: 0, z: -28 } },
  { id: 'lane-east', position: { x: 20, y: 0, z: 0 } },
  { id: 'lane-east-south', position: { x: 20, y: 0, z: -28 } },
  ...buildings.map((b) => ({
    id: `gate:${b.id}`,
    position: { x: b.origin.x + b.entrance.x, y: 0, z: b.origin.z + b.entrance.z },
  })),
]

const outdoorEdges = [
  { from: 'gate:atrium-hq', to: 'plaza-west' },
  { from: 'plaza-west', to: 'plaza-centre' },
  { from: 'gate:forge', to: 'plaza-centre' },
  { from: 'gate:observatory', to: 'plaza-east' },
  { from: 'plaza-east', to: 'plaza-centre' },
  { from: 'plaza-centre', to: 'plaza-north' },
  // South buildings reach the plaza around the flanks of the central row.
  { from: 'gate:library', to: 'lane-west-south' },
  { from: 'lane-west-south', to: 'lane-west' },
  { from: 'lane-west', to: 'plaza-west' },
  { from: 'gate:studio', to: 'lane-east-south' },
  { from: 'lane-east-south', to: 'lane-east' },
  { from: 'lane-east', to: 'plaza-east' },
]

const campus = {
  version: 1,
  name: 'Ananta Campus',
  buildings,
  desks,
  outdoorNodes,
  outdoorEdges,
}

mkdirSync(join(root, 'src', 'world'), { recursive: true })
writeFileSync(join(root, 'src', 'world', 'scene.json'), JSON.stringify(campus, null, 2) + '\n')
console.info(`wrote scene.json: ${buildings.length} buildings, ${desks.length} desks`)
