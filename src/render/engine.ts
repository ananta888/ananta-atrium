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
  gradient.addColorStop(0, '#5aa7f2')
  gradient.addColorStop(0.55, '#9ccdff')
  gradient.addColorStop(0.82, '#d7ecff')
  gradient.addColorStop(1, '#f6fbff')
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
  processing.exposure = 1.0
  processing.contrast = 1.0
  processing.vignetteEnabled = false
  processing.vignetteWeight = 1.1
  processing.vignetteStretch = 1.6
  processing.vignetteColor = new Color4(0, 0, 0, 1)
  processing.vignetteBlendMode = ImageProcessingConfiguration.VIGNETTEMODE_MULTIPLY
}

function addSunDisc(scene: Scene): void {
  const material = new StandardMaterial('sun-disc-material', scene)
  material.emissiveColor = new Color3(1, 0.96, 0.75)
  material.diffuseColor = new Color3(0, 0, 0)
  material.disableLighting = true
  material.alpha = 0.9
  const disc = MeshBuilder.CreateSphere('sun-disc', { diameter: 22, segments: 12 }, scene)
  disc.material = material
  disc.position = new Vector3(-80, 120, 140)
  disc.scaling = new Vector3(1.4, 1.4, 1.4)
  disc.infiniteDistance = true
  disc.isPickable = false
}

function addClouds(scene: Scene): void {
  const material = new StandardMaterial('cloud-material', scene)
  material.diffuseColor = new Color3(1, 1, 1)
  material.emissiveColor = new Color3(0.95, 0.97, 1)
  material.disableLighting = true
  material.alpha = 0.92
  const positions: Array<[number, number, number, number]> = [
    [-120, 70, -60, 1.4],
    [-60, 82, 90, 1.1],
    [30, 68, -110, 1.6],
    [110, 76, 40, 1.2],
    [150, 88, -40, 1],
    [-20, 92, 150, 1.3],
  ]
  for (const [x, y, z, scale] of positions) {
    const cloud = MeshBuilder.CreateSphere('cloud', { diameter: 1, segments: 10 }, scene)
    cloud.position = new Vector3(x, y, z)
    cloud.scaling = new Vector3(18 * scale, 5 * scale, 10 * scale)
    cloud.material = material
    cloud.isPickable = false
    const puff = MeshBuilder.CreateSphere('cloud-puff', { diameter: 1, segments: 10 }, scene)
    puff.position = new Vector3(x + 9 * scale, y + 1.5, z + 2)
    puff.scaling = new Vector3(10 * scale, 4.5 * scale, 8 * scale)
    puff.material = material
    puff.isPickable = false
  }
}

export async function createRenderContext(canvas: HTMLCanvasElement): Promise<RenderContext> {
  const gpuEngine = await tryWebGpu(canvas)
  const engine = gpuEngine ?? new Engine(canvas, true, { preserveDrawingBuffer: true, stencil: true, alpha: false, premultipliedAlpha: false })
  const backend: 'webgpu' | 'webgl' = gpuEngine ? 'webgpu' : 'webgl'

  const scene = new Scene(engine)
  scene.clearColor = new Color4(0.62, 0.78, 0.94, 1)
  scene.ambientColor = new Color3(0.38, 0.4, 0.44)
  scene.collisionsEnabled = true
  scene.fogMode = Scene.FOGMODE_EXP2
  scene.fogDensity = 0.0012
  scene.fogColor = new Color3(0.78, 0.88, 0.97)

  const sky = new HemisphericLight('sky', new Vector3(0.2, 1, 0.1), scene)
  sky.intensity = 0.65
  sky.diffuse = new Color3(0.95, 0.97, 1)
  sky.groundColor = new Color3(0.55, 0.62, 0.55)

  const sun = new DirectionalLight('sun', new Vector3(-0.45, -1, 0.35), scene)
  sun.position = new Vector3(30, 60, -40)
  sun.diffuse = new Color3(1, 0.98, 0.92)
  sun.intensity = 1.25
  const fill = new DirectionalLight('fill', new Vector3(-0.2, -0.7, -1), scene)
  fill.intensity = 0.55
  fill.diffuse = new Color3(0.75, 0.85, 1)

  addSkyDome(scene)
  addSunDisc(scene)
  addClouds(scene)
  configureImageProcessing(scene)

  return { engine, scene, backend }
}
