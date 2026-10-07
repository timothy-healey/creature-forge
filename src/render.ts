import * as THREE from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import { applyPose, poseAt, type Gait, type Stance } from './animate'
import { withSmoothNormals } from './geometry'
import { createBlobShadow, fitBlobShadow } from './shade'
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

export const RENDER_MODES = ['lit', 'unlit', 'toon', 'xray'] as const
export type RenderMode = (typeof RENDER_MODES)[number]

export const BACKGROUNDS = ['void', 'dusk', 'grid', 'studio'] as const
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
  /**
   * A dark edge around every part. Without textures and at a couple of hundred
   * pixels, this is what separates a limb from the body behind it.
   */
  outline: number
  /** Which parts of the machinery are drawn over the creature. */
  lenses: Lens[]
  /** 0 is a handful of pixels tall, 1 is a modern crisp image. */
  pixels: number
  /** 0 is violently unstable, 1 is rock steady. */
  wobble: number
}

export function defaultView(): ViewSettings {
  return { render: 'lit', background: 'void', lenses: [], outline: 0.45, pixels: 0.52, wobble: 0.3 }
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

/**
 * How far back a box has to sit to fill the frame without leaving it.
 *
 * Fitting the bounding sphere instead is much simpler and much worse: a
 * sphere's radius comes from the box's diagonal, so a tall thin creature gets
 * framed as though it were as deep as it is tall and spends most of the frame
 * on empty air.
 */
export function frameBoxDistance(
  size: THREE.Vector3,
  basis: { right: THREE.Vector3; up: THREE.Vector3; forward: THREE.Vector3 },
  fov: number,
  aspect: number,
  margin = 1.08,
): number {
  const shape = Number.isFinite(aspect) && aspect > 0 ? aspect : 1
  const half = size.clone().multiplyScalar(0.5)
  const along = (axis: THREE.Vector3) =>
    Math.abs(half.x * axis.x) + Math.abs(half.y * axis.y) + Math.abs(half.z * axis.z)

  const vertical = (fov * Math.PI) / 180
  const verticalTan = Math.tan(vertical / 2)
  const horizontalTan = verticalTan * shape

  const needed = Math.max(along(basis.up) / verticalTan, along(basis.right) / horizontalTan)
  return needed * margin + along(basis.forward)
}

/**
 * Every surface vertex of a creature, in world space.
 *
 * The outline copies are skipped: they are the same shape pushed outward along
 * its normals, so including them would frame the creature as slightly larger
 * than it is, by however hard the outline dial is turned.
 */
function surfacePoints(root: THREE.Object3D): THREE.Vector3[] {
  const points: THREE.Vector3[] = []
  root.traverse((node) => {
    const mesh = node as THREE.Mesh
    if (!mesh.isMesh || !mesh.geometry || mesh.name === 'outline') return
    const position = mesh.geometry.getAttribute('position') as THREE.BufferAttribute | undefined
    if (!position) return
    for (let i = 0; i < position.count; i++) {
      points.push(new THREE.Vector3().fromBufferAttribute(position, i).applyMatrix4(mesh.matrixWorld))
    }
  })
  return points
}

/**
 * How much of the frame a shape really occupies, measured on the camera's own
 * axes rather than on the world's.
 *
 * An axis-aligned box is a poor stand-in for a creature. At a three-quarter
 * view a tail that sticks straight back lands near the edge of the box, so the
 * box is far larger than the silhouette and its centre is dragged toward the
 * tail — the creature ends up small and off to one side of a frame it never
 * fills. Projecting the points onto the view's own axes gives the rectangle the
 * lens actually has to cover, and the middle of that rectangle is where to look.
 */
export interface Extent {
  /** Half the width to cover, across the camera's right axis. */
  halfRight: number
  /** Half the height to cover, along the camera's up axis. */
  halfUp: number
  /** How far the shape runs along the view direction. */
  depth: number
  /** The middle of that rectangle, in world space. */
  centre: THREE.Vector3
}

export function projectedExtent(
  points: readonly THREE.Vector3[],
  basis: { right: THREE.Vector3; up: THREE.Vector3; forward: THREE.Vector3 },
): Extent {
  let leastRight = Infinity
  let mostRight = -Infinity
  let leastUp = Infinity
  let mostUp = -Infinity
  let leastForward = Infinity
  let mostForward = -Infinity

  for (const point of points) {
    const right = point.dot(basis.right)
    const up = point.dot(basis.up)
    const forward = point.dot(basis.forward)
    if (right < leastRight) leastRight = right
    if (right > mostRight) mostRight = right
    if (up < leastUp) leastUp = up
    if (up > mostUp) mostUp = up
    if (forward < leastForward) leastForward = forward
    if (forward > mostForward) mostForward = forward
  }

  if (!Number.isFinite(leastRight)) {
    return { halfRight: 0, halfUp: 0, depth: 0, centre: new THREE.Vector3() }
  }

  // The basis is orthonormal, so the three midpoints rebuild the world point.
  const centre = new THREE.Vector3()
    .addScaledVector(basis.right, (leastRight + mostRight) / 2)
    .addScaledVector(basis.up, (leastUp + mostUp) / 2)
    .addScaledVector(basis.forward, (leastForward + mostForward) / 2)

  return {
    halfRight: (mostRight - leastRight) / 2,
    halfUp: (mostUp - leastUp) / 2,
    depth: mostForward - leastForward,
    centre,
  }
}

/** How far back the camera sits for that rectangle to fill the frame. */
export function frameExtentDistance(extent: Extent, fov: number, aspect: number, margin = 1.06): number {
  const shape = Number.isFinite(aspect) && aspect > 0 ? aspect : 1
  const vertical = (fov * Math.PI) / 180
  const verticalTan = Math.tan(vertical / 2)
  const horizontalTan = verticalTan * shape

  const needed = Math.max(extent.halfUp / verticalTan, extent.halfRight / horizontalTan)
  return needed * margin + extent.depth / 2
}

/**
 * Where the camera stands when nobody has moved it: a three-quarter view from
 * a little above the creature's own eye level, looking down.
 */
export const HOUSE_VIEW = { azimuth: 0.62, elevation: 0.36 }

/** A point on a sphere around `centre`, by compass bearing and angle above it. */
export function orbitPoint(
  centre: THREE.Vector3,
  distance: number,
  azimuth: number,
  elevation: number,
): THREE.Vector3 {
  const flat = Math.cos(elevation) * distance
  return new THREE.Vector3(
    centre.x + Math.sin(azimuth) * flat,
    centre.y + Math.sin(elevation) * distance,
    centre.z + Math.cos(azimuth) * flat,
  )
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
  controls.addEventListener('start', () => {
    orbited = true
  })
  controls.enableDamping = true
  controls.dampingFactor = 0.12
  controls.minDistance = 0.6
  controls.maxDistance = 14
  controls.maxPolarAngle = Math.PI * 0.52
  controls.target.set(0, 0.8, 0)

  // Ambient carries no form at all, so it stays low: enough to keep a facet
  // turned away from the key from going black, and no more.
  const ambient = new THREE.AmbientLight(0xffffff, 0.5)
  scene.add(ambient)
  const key = new THREE.DirectionalLight(0xfff0dd, 2.9)
  key.position.set(2.5, 4, 3)
  scene.add(key)
  const rim = new THREE.DirectionalLight(0x6f7bd0, 1.0)
  rim.position.set(-3, 2, -2.5)
  scene.add(rim)

  let sky: THREE.Mesh | null = null
  let grid: THREE.GridHelper | null = null
  let standing: Background | null = null
  // Once someone orbits, the angle is theirs; until then it is the house view.
  let orbited = false
  let shownOutline = -1

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
    ambient.intensity = 0.5 * place.brightness
    key.intensity = 2.9 * place.brightness
    rim.intensity = 1.0 * place.brightness
  }

  const groundGeometry = new THREE.PlaneGeometry(26, 26)
  groundGeometry.rotateX(-Math.PI / 2)
  const groundMaterial = new THREE.MeshLambertMaterial({ color: '#2e2740' })
  const ground = new THREE.Mesh(groundGeometry, groundMaterial)
  scene.add(ground)

  // Stops the creature reading as floating, whatever shape it turned out.
  const blob = createBlobShadow()
  scene.add(blob)

  let creature: Creature | null = null
  let stance: Stance = { build: 'upright', frontLimb: 'arms', mesh: 'jointed', mutation: 'none' }
  let gait: Gait = 'idle'
  let view = defaultView()
  let skinMaterial: THREE.Material | null = null
  let outlines: THREE.Object3D[] = []
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
    drawOutlines()
    wardrobe.wore(view.render, flat)
    // A see-through or blacked-out creature reads better off the floor.
    ground.visible = SCENERY[view.background].ground !== null && view.render !== 'xray'
    blob.visible = ground.visible
  }

  /**
   * One inside-out copy per part, parented beside it so it follows every bone.
   * Rebuilt rather than tweaked, because its geometry carries its own normals.
   */
  function drawOutlines(): void {
    for (const copy of outlines) {
      const mesh = copy as THREE.Mesh
      mesh.geometry?.dispose()
      copy.removeFromParent()
    }
    if (outlines.length > 0) ((outlines[0] as THREE.Mesh).material as THREE.Material)?.dispose()
    outlines = []
    // An edge drawn round an x-ray is noise: there is no solid for it to bound.
    const wanted = view.outline > 0.01 && view.render !== 'xray'
    if (!creature || !wanted) return

    const material = outlineMaterial(view.outline)
    const parts: THREE.Mesh[] = []
    creature.root.traverse((node) => {
      const mesh = node as THREE.Mesh
      if (mesh.isMesh && mesh.geometry && mesh.name !== 'outline') parts.push(mesh)
    })

    for (const mesh of parts) {
      const skinned = mesh as THREE.SkinnedMesh
      const geometry = withSmoothNormals(mesh.geometry)
      const copy = skinned.isSkinnedMesh
        ? new THREE.SkinnedMesh(geometry, material)
        : new THREE.Mesh(geometry, material)

      copy.name = 'outline'
      copy.frustumCulled = false
      copy.renderOrder = -1
      copy.position.copy(mesh.position)
      copy.quaternion.copy(mesh.quaternion)
      copy.scale.copy(mesh.scale)
      // Beside the part, under the same joint, so it follows every pose.
      mesh.parent?.add(copy)
      if (skinned.isSkinnedMesh) (copy as THREE.SkinnedMesh).bind(skinned.skeleton, skinned.bindMatrix)
      outlines.push(copy)
    }
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

    next.root.updateMatrixWorld(true)
    fitBlobShadow(blob, new THREE.Box3().setFromObject(next.root))
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
    const points = surfacePoints(next.root)
    if (points.length === 0) return

    // A provisional aim, only to settle which way the camera will be looking.
    // The real target comes from the silhouette that direction produces.
    const rough = new THREE.Box3().setFromPoints(points).getCenter(new THREE.Vector3())
    const forward = orbited
      ? camera.position.clone().sub(rough).normalize()
      : orbitPoint(rough, 1, HOUSE_VIEW.azimuth, HOUSE_VIEW.elevation).sub(rough).normalize()
    if (forward.lengthSq() < 1e-8) forward.set(0.5, 0.35, 0.8).normalize()

    const right = new THREE.Vector3().crossVectors(new THREE.Vector3(0, 1, 0), forward).normalize()
    if (right.lengthSq() < 1e-8) right.set(1, 0, 0)
    const up = new THREE.Vector3().crossVectors(forward, right).normalize()

    const extent = projectedExtent(points, { right, up, forward })
    controls.target.copy(extent.centre)

    const needed = frameExtentDistance(extent, camera.fov, camera.aspect)
    const wanted = THREE.MathUtils.clamp(needed, controls.minDistance, controls.maxDistance)

    // Nobody has orbited: take the house angle outright rather than inheriting
    // whatever direction the camera happens to be pointing from its last frame.
    if (!orbited) {
      camera.position.copy(orbitPoint(controls.target, wanted, HOUSE_VIEW.azimuth, HOUSE_VIEW.elevation))
      controls.update()
      return
    }

    const now = camera.position.distanceTo(controls.target)
    if (now >= needed && now <= needed * 2.1) return

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
      const changedOutline = next.outline !== shownOutline
      dress()
      if (changedOutline) {
        shownOutline = next.outline
        drawOutlines()
      }
    },
    focus: (lens) => inspector.focus(lens),
    dispose() {
      running = false
      inspector.element.remove()
      controls.dispose()
      grid?.dispose()
      sky?.geometry.dispose()
      blob.geometry.dispose()
      ;(blob.material as THREE.Material).dispose()
      creature?.dispose()
      skinMaterial?.dispose()
      groundGeometry.dispose()
      groundMaterial.dispose()
      renderer.dispose()
    },
  }
}

/**
 * The outline: the model again, inside out, pushed out along its own smoothed
 * normals by a constant number of pixels whatever the distance.
 */
function outlineMaterial(width: number): THREE.Material {
  const material = new THREE.MeshBasicMaterial({ color: 0x0a0d12, side: THREE.BackSide })
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uWidth = { value: width }
    shader.uniforms.uSnap = { value: snapGrid }
    shader.vertexShader = `uniform float uWidth;\nuniform vec2 uSnap;\n${shader.vertexShader}`.replace(
      '#include <project_vertex>',
      `#include <project_vertex>
      vec3 outlineNormal = normalize(normalMatrix * objectNormal);
      gl_Position.xy += outlineNormal.xy * uWidth * gl_Position.w * 0.012;
      gl_Position.xy = floor(uSnap * gl_Position.xy / gl_Position.w + 0.5) / uSnap * gl_Position.w;`,
    )
  }
  return material
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
    case 'xray':
      return new THREE.MeshBasicMaterial({
        vertexColors: true,
        transparent: true,
        opacity: 0.26,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        side: THREE.DoubleSide,
      })
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
