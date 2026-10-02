import * as THREE from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import { applyPose, poseAt, type Gait, type Stance } from './animate'
import type { Creature } from './generate'

/**
 * The viewport, and the four things that make it look like 1998.
 *
 * 1. The drawing buffer is a couple of hundred pixels tall and CSS-scaled up
 *    with nearest-neighbour, so there is no post-processing pass at all — the
 *    chunky pixels are simply what the GPU drew.
 * 2. Vertices snap to a coarse grid in clip space. This is the wobble, and it
 *    only shows up once something moves.
 * 3. Flat shading and vertex colours. Nothing is textured, ever.
 * 4. No antialiasing, and fog to swallow the far edge of the ground.
 *
 * The first two are knobs rather than constants, because the whole point of the
 * era look is being able to take it too far.
 */

export const RENDER_MODES = ['lit', 'unlit', 'toon', 'normals', 'wireframe', 'xray', 'silhouette'] as const
export type RenderMode = (typeof RENDER_MODES)[number]

export interface ViewSettings {
  render: RenderMode
  /** 0 is a handful of pixels tall, 1 is a modern crisp image. */
  pixels: number
  /** 0 is violently unstable, 1 is rock steady. */
  wobble: number
}

export function defaultView(): ViewSettings {
  return { render: 'lit', pixels: 0.42, wobble: 0.3 }
}

const BACKGROUND = new THREE.Color('#1b1726')
const snapGrid = new THREE.Vector2(160, 120)

export interface Viewport {
  show(creature: Creature, stance: Stance): void
  setGait(gait: Gait): void
  setView(view: ViewSettings): void
  dispose(): void
}

export function createViewport(canvas: HTMLCanvasElement): Viewport {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'low-power' })
  renderer.setPixelRatio(1)

  const scene = new THREE.Scene()
  scene.background = BACKGROUND
  scene.fog = new THREE.Fog(BACKGROUND, 3.4, 9)

  const camera = new THREE.PerspectiveCamera(42, 4 / 3, 0.1, 50)
  camera.position.set(1.9, 1.5, 2.9)

  const controls = new OrbitControls(camera, canvas)
  controls.enableDamping = true
  controls.dampingFactor = 0.12
  controls.minDistance = 1.2
  controls.maxDistance = 7
  controls.maxPolarAngle = Math.PI * 0.52
  controls.target.set(0, 0.8, 0)

  scene.add(new THREE.AmbientLight(0xffffff, 1.5))
  const key = new THREE.DirectionalLight(0xfff0dd, 2.2)
  key.position.set(2.5, 4, 3)
  scene.add(key)
  const rim = new THREE.DirectionalLight(0x6f7bd0, 1.1)
  rim.position.set(-3, 2, -2.5)
  scene.add(rim)

  const groundGeometry = new THREE.PlaneGeometry(26, 26)
  groundGeometry.rotateX(-Math.PI / 2)
  const groundMaterial = new THREE.MeshLambertMaterial({ color: '#2e2740' })
  const ground = new THREE.Mesh(groundGeometry, groundMaterial)
  scene.add(ground)

  let creature: Creature | null = null
  let stance: Stance = { build: 'upright', frontLimb: 'arms', mesh: 'jointed', mutation: 'none' }
  let gait: Gait = 'idle'
  let view = defaultView()
  let skinMaterial: THREE.Material | null = null
  let running = true
  const clock = new THREE.Clock()

  /** Swaps every mesh over to the material the current render mode calls for. */
  function dress(): void {
    if (!creature) return
    const flat = stance.mesh !== 'skinned'
    const next = materialFor(view.render, flat)
    snapVertices(next)

    creature.root.traverse((node) => {
      const mesh = node as THREE.Mesh
      if (mesh.isMesh) mesh.material = next
    })

    skinMaterial?.dispose()
    skinMaterial = next
    ground.visible = view.render !== 'silhouette' && view.render !== 'xray'
  }

  function show(next: Creature, nextStance: Stance): void {
    stance = nextStance
    if (creature) {
      scene.remove(creature.root)
      creature.dispose()
    }
    creature = next
    scene.add(next.root)
    dress()

    const bounds = new THREE.Box3().setFromObject(next.root)
    controls.target.set(0, bounds.max.y * 0.5, 0)
  }

  function resize(): void {
    const width = canvas.clientWidth
    const height = canvas.clientHeight
    if (width === 0 || height === 0) return

    const bufferHeight = Math.round(48 + view.pixels ** 1.7 * 820)
    const bufferWidth = Math.max(1, Math.round((width / height) * bufferHeight))
    if (renderer.domElement.width !== bufferWidth || renderer.domElement.height !== bufferHeight) {
      renderer.setSize(bufferWidth, bufferHeight, false)
      camera.aspect = bufferWidth / bufferHeight
      camera.updateProjectionMatrix()
    }
  }

  function frame(): void {
    if (!running) return
    requestAnimationFrame(frame)

    resize()
    controls.update()

    if (creature) {
      applyPose(creature.joints, creature.rest, poseAt(clock.getElapsedTime(), gait, stance))
    }
    renderer.render(scene, camera)
  }

  requestAnimationFrame(frame)

  return {
    show,
    setGait: (next) => {
      gait = next
    },
    setView(next) {
      const changedMode = next.render !== view.render
      view = next
      // There is no "off" for the snap — a steady image is just a fine enough
      // grid that you stop noticing it, so the scale runs exponentially.
      const grid = 40 * 100 ** Math.min(1, Math.max(0, next.wobble))
      snapGrid.set(grid, grid * 0.75)
      if (changedMode) dress()
    },
    dispose() {
      running = false
      controls.dispose()
      creature?.dispose()
      skinMaterial?.dispose()
      groundGeometry.dispose()
      groundMaterial.dispose()
      renderer.dispose()
    },
  }
}

/** Banded rather than smooth, which is what makes a toon shader a toon shader. */
function toonSteps(): THREE.DataTexture {
  const steps = new Uint8Array([48, 120, 200, 255])
  const texture = new THREE.DataTexture(steps, steps.length, 1, THREE.RedFormat)
  texture.minFilter = THREE.NearestFilter
  texture.magFilter = THREE.NearestFilter
  texture.generateMipmaps = false
  texture.needsUpdate = true
  return texture
}

function materialFor(mode: RenderMode, flat: boolean): THREE.Material {
  switch (mode) {
    case 'unlit':
      // No lighting at all, just the vertex colours — what the hardware did.
      return new THREE.MeshBasicMaterial({ vertexColors: true })
    case 'toon':
      return new THREE.MeshToonMaterial({ vertexColors: true, gradientMap: toonSteps() })
    case 'normals':
      return new THREE.MeshNormalMaterial({ flatShading: flat })
    case 'wireframe':
      return new THREE.MeshBasicMaterial({ vertexColors: true, wireframe: true })
    case 'xray':
      return new THREE.MeshBasicMaterial({
        vertexColors: true,
        transparent: true,
        opacity: 0.26,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        side: THREE.DoubleSide,
      })
    case 'silhouette':
      return new THREE.MeshBasicMaterial({ color: 0x0d0a14 })
    default:
      return new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: flat })
  }
}

/**
 * Quantises clip-space position to a coarse grid. PS1 hardware had no sub-pixel
 * precision in its rasteriser, so vertices visibly jumped between pixels as a
 * model moved — the single most recognisable tell of the era.
 */
function snapVertices(material: THREE.Material): void {
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uSnap = { value: snapGrid }
    shader.vertexShader = `uniform vec2 uSnap;\n${shader.vertexShader}`.replace(
      '#include <project_vertex>',
      `#include <project_vertex>
      gl_Position.xy = floor(uSnap * gl_Position.xy / gl_Position.w + 0.5) / uSnap * gl_Position.w;`,
    )
  }
  material.needsUpdate = true
}
