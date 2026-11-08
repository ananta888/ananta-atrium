import sceneData from './scene.json'
import { loadCampus } from './campus-loader.js'

/** The committed scene, validated once at module load. */
export const campus = loadCampus(sceneData)
