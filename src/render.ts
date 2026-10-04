import * as THREE from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import { applyPose, poseAt, type Gait, type Stance } from './animate'
import type { Creature } from './generate'
import { createInspector, type Lens } from './inspect'

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

export const BACKGROUNDS = ['void', 'dusk', 'grid', 'snow', 'cave', 'studio'] as const
export type Background = (typeof BACKGROUNDS)[number]

/**
 * Somewhere to stand. Each one sets its own sky, fog, ground and lighting —
 * changing only the backdrop colour reads as a different swatch, not a
 * different place.
 */
export interface Scenery {
  /** Horizon and zenith; a flat sky uses the same colour twice. */
  sky: readonly [string, string]
  ground: string | null
  fog: readonly [number, number] | null
  key: string
  fill: string
  brightness: number
  grid: string | null
}

export const SCENERY: Record<Background, Scenery> = {
  void: {
    sky: ['#1b1726', '#1b1726'],
    ground: '#2e2740',
    fog: [3.4, 9],
    key: '#fff0dd',
    fill: '#6f7bd0',
    brightness: 1,
    grid: null,
  },
  dusk: {
    sky: ['#e8794a', '#1d1b3a'],
    ground: '#2a2135',
    fog: [2.6, 11],
    key: '#ffb070',
    fill: '#5a6bd0',
    brightness: 1.05,
    grid: null,
  },
  grid: {
    sky: ['#07090f', '#07090f'],
    ground: null,
    fog: [4, 16],
    key: '#9fe8ff',
    fill: '#3050a0',
    brightness: 0.85,
    grid: '#2f6d8a',
  },
  snow: {
    sky: ['#cfe4f2', '#7ca8d8'],
    ground: '#e8eef5',
    fog: [5, 18],
    key: '#ffffff',
    fill: '#b8d0ea',
    brightness: 1.3,
    grid: null,
  },
  cave: {
    sky: ['#0b0a0e', '#0b0a0e'],
    ground: '#2a211c',
    fog: [1.6, 6.5],
    key: '#ffa94a',
    fill: '#2a3550',
    brightness: 0.9,
    grid: null,
  },
  studio: {
    sky: ['#d8d6dd', '#d8d6dd'],
    ground: '#b9b6c2',
    fog: null,
    key: '#ffffff',
    fill: '#c8ccdd',
    brightness: 1.15,
    grid: null,
  },
}

export interface ViewSettings {
  render: RenderMode
  background: Background
  /** Which parts of the machinery are drawn over the creature. */
  lenses: Lens[]
  /** 0 is a handful of pixels tall, 1 is a modern crisp image. */
  pixels: number
  /** 0 is violently unstable, 1 is rock steady. */
  wobble: number
}

export function defaultView(): ViewSettings {
  return { render: 'lit', background: 'void', lenses: [], pixels: 0.42, wobble: 0.3 }
}

const snapGrid = new THREE.Vector2(160, 120)

/**
 * How far back the camera has to sit for a sphere of `radius` to fit.
 *
 * The limiting angle is the vertical field of view on a wide viewport and the
 * horizontal one on a tall viewport, so a near-square panel between two rails
 * frames a creature as reliably as a cinema-shaped one does.
 */
export function frameDistance(radius: number, fov: number, aspect: number, margin = 1.22): number {
  // Math.max(x, NaN) is NaN, so a clamp is not a guard: check the value.
  const shape = Number.isFinite(aspect) && aspect > 0 ? aspect : 1
  const span = Number.isFinite(radius) && radius > 0 ? radius : 1

  const vertical = (fov * Math.PI) / 180
  const horizontal = 2 * Math.atan(Math.tan(vertical / 2) * shape)
  const limiting = Math.min(vertical, horizontal)
  return (span * margin) / Math.max(0.0001, Math.sin(limiting / 2))
}

/** A low sky dome, coloured per vertex so a gradient costs no shader. */
function skyDome(horizon: THREE.Color, zenith: THREE.Color): THREE.Mesh {
  const geometry = new THREE.SphereGeometry(30, 14, 9)
  const position = geometry.getAttribute('position')
  const colours = new Float32Array(position.count * 3)
  const blend = new THREE.Color()

  for (let i = 0; i < position.count; i++) {
    const height = Math.min(1, Math.max(0, position.getY(i) / 30 + 0.12))
    blend.copy(horizon).lerp(zenith, height ** 0.6)
    colours[i * 3] = blend.r
    colours[i * 3 + 1] = blend.g
    colours[i * 3 + 2] = blend.b
  }

  geometry.setAttribute('color', new THREE.BufferAttribute(colours, 3))
  return new THREE.Mesh(
    geometry,
    new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.BackSide, fog: false }),
  )
}

/**
 * Remembers what the meshes are currently wearing.
 *
 * This exists because of a bug worth not repeating: the viewport used to decide
 * whether to re-dress by comparing the incoming settings against its own, and
 * callers pass the same object back after mutating it — so it was comparing a
 * value to itself, always found no change, and the render modes did nothing
 * until something else happened to rebuild the creature.
 */
export function createWardrobe() {
  let mode: RenderMode | null = null
  let flat: boolean | null = null

  return {
    needsChange(nextMode: RenderMode, nextFlat: boolean, force = false): boolean {
      return force || nextMode !== mode || nextFlat !== flat
    },
    wore(nextMode: RenderMode, nextFlat: boolean): void {
      mode = nextMode
      flat = nextFlat
    },
  }
}

export interface Viewport {
  show(creature: Creature, stance: Stance): void
  setGait(gait: Gait): void
  setView(view: ViewSettings): void
  /** Draw one lens for as long as a control is being touched, then let go. */
  focus(lens: Lens | null): void
  dispose(): void
}

export function createViewport(canvas: HTMLCanvasElement): Viewport {
  const inspector = createInspector()
  canvas.parentElement?.appendChild(inspector.element)

  const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'low-power' })
  renderer.setPixelRatio(1)

  const scene = new THREE.Scene()

  const camera = new THREE.PerspectiveCamera(42, 4 / 3, 0.1, 50)
  camera.position.set(1.9, 1.5, 2.9)

  const controls = new OrbitControls(camera, canvas)
  controls.enableDamping = true
  controls.dampingFactor = 0.12
  controls.minDistance = 0.6
  controls.maxDistance = 14
  controls.maxPolarAngle = Math.PI * 0.52
  controls.target.set(0, 0.8, 0)

  const ambient = new THREE.AmbientLight(0xffffff, 1.5)
  scene.add(ambient)
  const key = new THREE.DirectionalLight(0xfff0dd, 2.2)
  key.position.set(2.5, 4, 3)
  scene.add(key)
  const rim = new THREE.DirectionalLight(0x6f7bd0, 1.1)
  rim.position.set(-3, 2, -2.5)
  scene.add(rim)

  let sky: THREE.Mesh | null = null
  let grid: THREE.GridHelper | null = null
  let standing: Background | null = null

  /** Rebuilds the place the creature is standing in. */
  function setScenery(kind: Background): void {
    if (standing === kind) return
    standing = kind
    const place = SCENERY[kind]

    const horizon = new THREE.Color(place.sky[0])
    const zenith = new THREE.Color(place.sky[1])
    scene.background = horizon

    if (sky) {
      scene.remove(sky)
      sky.geometry.dispose()
      ;(sky.material as THREE.Material).dispose()
      sky = null
    }
    if (place.sky[0] !== place.sky[1]) {
      sky = skyDome(horizon, zenith)
      scene.add(sky)
    }

    scene.fog = place.fog ? new THREE.Fog(horizon, place.fog[0], place.fog[1]) : null

    groundMaterial.color.set(place.ground ?? '#000000')
    ground.visible = place.ground !== null

    if (grid) {
      scene.remove(grid)
      grid.dispose()
      grid = null
    }
    if (place.grid) {
      grid = new THREE.GridHelper(24, 24, place.grid, place.grid)
      grid.position.y = 0.002
      scene.add(grid)
    }

    key.color.set(place.key)
    rim.color.set(place.fill)
    ambient.intensity = 1.5 * place.brightness
    key.intensity = 2.2 * place.brightness
    rim.intensity = 1.1 * place.brightness
  }

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
  const wardrobe = createWardrobe()
  let running = true
  const clock = new THREE.Clock()

  /**
   * Swaps every mesh over to the material the current render mode calls for.
   * Cheap to call from anywhere: it does nothing unless the mode, the shading
   * or the creature itself has actually changed.
   */
  function dress(force = false): void {
    if (!creature) return
    const flat = stance.mesh !== 'skinned'
    if (!wardrobe.needsChange(view.render, flat, force)) return

    const next = materialFor(view.render, flat)
    snapVertices(next)

    creature.root.traverse((node) => {
      const mesh = node as THREE.Mesh
      if (mesh.isMesh) mesh.material = next
    })

    skinMaterial?.dispose()
    skinMaterial = next
    wardrobe.wore(view.render, flat)
    // A see-through or blacked-out creature reads better off the floor.
    ground.visible = SCENERY[view.background].ground !== null && view.render !== 'xray'
  }

  function show(next: Creature, nextStance: Stance): void {
    stance = nextStance
    if (creature) {
      scene.remove(creature.root)
      creature.dispose()
    }
    creature = next
    scene.add(next.root)
    inspector.show(next)
    dress(true)

    reframe(next)
  }

  /**
   * Keeps the creature in shot without stealing the camera.
   *
   * The target follows the creature's centre, which is cheap and never jumps,
   * but the distance only moves when the creature no longer fits or has shrunk
   * far inside the frame — so dragging a slider does not yank the view on every
   * rebuild, and a creature that doubles in size is still in it.
   */
  function reframe(next: Creature): void {
    next.root.updateMatrixWorld(true)
    const bounds = new THREE.Box3().setFromObject(next.root)
    if (bounds.isEmpty()) return

    const sphere = bounds.getBoundingSphere(new THREE.Sphere())
    controls.target.copy(sphere.center)

    const needed = frameDistance(sphere.radius, camera.fov, camera.aspect)
    const now = camera.position.distanceTo(controls.target)
    if (now >= needed && now <= needed * 2.1) return

    const wanted = THREE.MathUtils.clamp(needed, controls.minDistance, controls.maxDistance)
    const direction = camera.position.clone().sub(controls.target)
    if (direction.lengthSq() < 1e-8) direction.set(1, 0.7, 1.5)
    camera.position.copy(controls.target).add(direction.setLength(wanted))
    controls.update()
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
      if (creature) reframe(creature)
    }
  }

  function frame(): void {
    if (!running) return
    requestAnimationFrame(frame)

    resize()
    controls.update()

    if (creature) {
      applyPose(
        creature.joints,
        creature.rest,
        poseAt(clock.getElapsedTime(), gait, stance, creature.limbs),
      )
    }
    renderer.render(scene, camera)
    inspector.draw(camera, canvas.clientWidth, canvas.clientHeight, clock.getElapsedTime())
  }

  requestAnimationFrame(frame)

  return {
    show,
    setGait: (next) => {
      gait = next
    },
    setView(next) {
      view = next
      // There is no "off" for the snap — a steady image is just a fine enough
      // grid that you stop noticing it, so the scale runs exponentially.
      const gridSize = 40 * 100 ** Math.min(1, Math.max(0, next.wobble))
      snapGrid.set(gridSize, gridSize * 0.75)
      setScenery(next.background)
      inspector.setLenses(new Set(next.lenses))
      dress()
    },
    focus: (lens) => inspector.focus(lens),
    dispose() {
      running = false
      inspector.element.remove()
      controls.dispose()
      grid?.dispose()
      sky?.geometry.dispose()
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

export function materialFor(mode: RenderMode, flat: boolean): THREE.Material {
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
