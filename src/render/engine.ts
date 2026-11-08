import {
  Color3,
  Color4,
  DirectionalLight,
  DynamicTexture,
  Engine,
  HemisphericLight,
  ImageProcessingConfiguration,
  MeshBuilder,
  Scene,
  StandardMaterial,
  Vector3,
} from '@babylonjs/core'

export interface RenderContext {
  engine: Engine
  scene: Scene
  backend: 'webgpu' | 'webgl'
}

async function tryWebGpu(canvas: HTMLCanvasElement): Promise<Engine | null> {
  if (!('gpu' in navigator) || !navigator.gpu) return null
  try {
    const { WebGPUEngine } = await import('@babylonjs/core/Engines/webgpuEngine')
    const engine = new WebGPUEngine(canvas, { antialias: true, adaptToDeviceRatio: true })
    await engine.initAsync()
    return engine as unknown as Engine
  } catch (error) {
    console.warn('WebGPU unavailable, falling back to WebGL2', error)
    return null
  }
}

function addSkyDome(scene: Scene): void {
  const texture = new DynamicTexture('sky-gradient', { width: 16, height: 256 }, scene, false)
  const context = texture.getContext() as unknown as CanvasRenderingContext2D
  const gradient = context.createLinearGradient(0, 0, 0, 256)
  gradient.addColorStop(0, '#122036')
  gradient.addColorStop(0.55, '#2a3f5c')
  gradient.addColorStop(0.82, '#7d8da2')
  gradient.addColorStop(1, '#e3bd8d')
  context.fillStyle = gradient
  context.fillRect(0, 0, 16, 256)
  texture.update()

  const material = new StandardMaterial('sky-material', scene)
  material.emissiveTexture = texture
  material.diffuseColor = new Color3(0, 0, 0)
  material.disableLighting = true
  material.backFaceCulling = false

  const dome = MeshBuilder.CreateSphere('sky-dome', { diameter: 420, segments: 16 }, scene)
  dome.material = material
  dome.infiniteDistance = true
  dome.isPickable = false
}

function configureImageProcessing(scene: Scene): void {
  const processing = scene.imageProcessingConfiguration
  processing.toneMappingEnabled = false
  processing.toneMappingType = ImageProcessingConfiguration.TONEMAPPING_ACES
  processing.exposure = 1.45
  processing.contrast = 1.04
  processing.vignetteEnabled = false
  processing.vignetteWeight = 1.1
  processing.vignetteStretch = 1.6
  processing.vignetteColor = new Color4(0, 0, 0, 1)
  processing.vignetteBlendMode = ImageProcessingConfiguration.VIGNETTEMODE_MULTIPLY
}

function addSunDisc(scene: Scene): void {
  const material = new StandardMaterial('sun-disc-material', scene)
  material.emissiveColor = new Color3(1, 0.86, 0.62)
  material.diffuseColor = new Color3(0, 0, 0)
  material.disableLighting = true
  material.alpha = 0.9
  const disc = MeshBuilder.CreateSphere('sun-disc', { diameter: 22, segments: 12 }, scene)
  disc.material = material
  disc.position = new Vector3(-95, 130, 110)
  disc.infiniteDistance = true
  disc.isPickable = false
}

export async function createRenderContext(canvas: HTMLCanvasElement): Promise<RenderContext> {
  const gpuEngine = await tryWebGpu(canvas)
  const engine = gpuEngine ?? new Engine(canvas, true, { preserveDrawingBuffer: true, stencil: true })
  const backend: 'webgpu' | 'webgl' = gpuEngine ? 'webgpu' : 'webgl'

  const scene = new Scene(engine)
  scene.clearColor = new Color4(0.075, 0.1, 0.15, 1)
  scene.ambientColor = new Color3(0.75, 0.78, 0.86)
  scene.collisionsEnabled = true
  scene.fogMode = Scene.FOGMODE_EXP2
  scene.fogDensity = 0.0022
  scene.fogColor = new Color3(0.13, 0.16, 0.22)

  const sky = new HemisphericLight('sky', new Vector3(0.2, 1, 0.1), scene)
  sky.intensity = 2.3
  sky.diffuse = new Color3(0.72, 0.8, 0.95)
  sky.groundColor = new Color3(0.18, 0.2, 0.24)

  const sun = new DirectionalLight('sun', new Vector3(-0.45, -1, 0.35), scene)
  sun.position = new Vector3(30, 60, -40)
  sun.diffuse = new Color3(1, 0.93, 0.8)
  sun.intensity = 3.1
  const fill = new DirectionalLight('fill', new Vector3(0.6, -0.7, -0.4), scene)
  fill.intensity = 0.75
  fill.diffuse = new Color3(0.55, 0.65, 0.85)

  addSkyDome(scene)
  addSunDisc(scene)
  configureImageProcessing(scene)

  return { engine, scene, backend }
}
