import * as THREE from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import { applyPose, poseAt, type Gait } from './animate'
import type { Creature } from './generate'

/**
 * The viewport, and the four things that make it look like 1998.
 *
 * 1. The drawing buffer is ~240px tall and CSS-scaled up with nearest-neighbour,
 *    so there is no post-processing pass at all — the chunky pixels are simply
 *    what the GPU drew.
 * 2. Vertices snap to a coarse grid in clip space. This is the wobble, and it
 *    only shows up once something moves.
 * 3. Flat shading and vertex colours, set by the generator. Nothing is textured.
 * 4. No antialiasing, and fog to swallow the far edge of the ground.
 */

const INTERNAL_HEIGHT = 240
const SNAP_GRID = new THREE.Vector2(160, 120)
const BACKGROUND = new THREE.Color('#1b1726')

export interface Viewport {
  show(creature: Creature): void
  setGait(gait: Gait): void
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
  scene.add(new THREE.Mesh(groundGeometry, groundMaterial))

  let creature: Creature | null = null
  let gait: Gait = 'idle'
  let running = true
  const clock = new THREE.Clock()

  function show(next: Creature): void {
    if (creature) {
      scene.remove(creature.root)
      creature.dispose()
    }
    snapVertices(next.material)
    creature = next
    scene.add(next.root)

    const bounds = new THREE.Box3().setFromObject(next.root)
    controls.target.set(0, bounds.max.y * 0.5, 0)
  }

  function resize(): void {
    const width = canvas.clientWidth
    const height = canvas.clientHeight
    if (width === 0 || height === 0) return

    const bufferHeight = INTERNAL_HEIGHT
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
      applyPose(creature.joints, creature.rest, poseAt(clock.getElapsedTime(), gait))
    }
    renderer.render(scene, camera)
  }

  requestAnimationFrame(frame)

  return {
    show,
    setGait: (next) => {
      gait = next
    },
    dispose() {
      running = false
      controls.dispose()
      creature?.dispose()
      groundGeometry.dispose()
      groundMaterial.dispose()
      renderer.dispose()
    },
  }
}

/**
 * Quantises clip-space position to a coarse grid. PS1 hardware had no sub-pixel
 * precision in its rasteriser, so vertices visibly jumped between pixels as a
 * model moved — the single most recognisable tell of the era.
 */
function snapVertices(material: THREE.Material): void {
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uSnap = { value: SNAP_GRID }
    shader.vertexShader = `uniform vec2 uSnap;\n${shader.vertexShader}`.replace(
      '#include <project_vertex>',
      `#include <project_vertex>
      gl_Position.xy = floor(uSnap * gl_Position.xy / gl_Position.w + 0.5) / uSnap * gl_Position.w;`,
    )
  }
  material.needsUpdate = true
}
