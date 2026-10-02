import * as THREE from 'three'

/**
 * Deformations that rewrite a part's vertices after it is built.
 *
 * These differ from the plan mutations in `generate`: nothing here changes what
 * parts a creature has or where they attach. They change what the surface *is* —
 * whether it is continuous, whether it hangs where it was put, whether it is a
 * surface at all. Because they run on each part before anything is welded, they
 * compose with both mesh modes.
 */

/** Deterministic hash, so a creature deforms the same way on every rebuild. */
function noise(x: number, y: number, z: number): number {
  const value = Math.sin(x * 127.1 + y * 311.7 + z * 74.7) * 43758.5453
  return value - Math.floor(value)
}

const EPSILON = 1e-9

/**
 * Three caches a geometry's bounds, and anything that reads them afterwards —
 * `Box3.setFromObject`, frustum culling, the settle onto the ground — trusts the
 * cache over the vertices. Rewriting positions without clearing it means the
 * deformation happens and nothing downstream can see it.
 */
function invalidateBounds(geometry: THREE.BufferGeometry): void {
  geometry.boundingBox = null
  geometry.boundingSphere = null
}

/**
 * Detaches every triangle and lets it drift: pushed out along its own normal,
 * spun about its centre, and shrunk so a gap opens between it and its
 * neighbours. The creature keeps its silhouette and stops being solid.
 */
export function shatter(geometry: THREE.BufferGeometry, amount: number): void {
  const position = geometry.getAttribute('position') as THREE.BufferAttribute
  const points = position.array as Float32Array

  const a = new THREE.Vector3()
  const b = new THREE.Vector3()
  const c = new THREE.Vector3()
  const centre = new THREE.Vector3()
  const normal = new THREE.Vector3()
  const edge = new THREE.Vector3()

  for (let triangle = 0; triangle + 8 < points.length; triangle += 9) {
    a.set(points[triangle]!, points[triangle + 1]!, points[triangle + 2]!)
    b.set(points[triangle + 3]!, points[triangle + 4]!, points[triangle + 5]!)
    c.set(points[triangle + 6]!, points[triangle + 7]!, points[triangle + 8]!)

    normal.subVectors(b, a).cross(edge.subVectors(c, a))
    if (normal.lengthSq() < EPSILON) continue
    normal.normalize()

    centre.addVectors(a, b).add(c).divideScalar(3)
    const drift = amount * (0.3 + noise(centre.x, centre.y, centre.z))
    const spin = (noise(centre.y, centre.z, centre.x) - 0.5) * 1.1

    let slot = triangle
    for (const vertex of [a, b, c]) {
      vertex
        .sub(centre)
        .applyAxisAngle(normal, spin)
        .multiplyScalar(0.78)
        .add(centre)
        .addScaledVector(normal, drift)
      points[slot] = vertex.x
      points[slot + 1] = vertex.y
      points[slot + 2] = vertex.z
      slot += 3
    }
  }

  position.needsUpdate = true
  geometry.computeVertexNormals()
  invalidateBounds(geometry)
}

/**
 * Lets the creature collapse.
 *
 * Height is what melts: a vertex slides down by how far above the floor it
 * started, so the whole body sinks into itself rather than each part drooping
 * only within its own length. What has sunk spreads where it lands, so the
 * creature narrows at the top and pools at the base — and the feet, already at
 * the floor, do not move at all.
 */
export function melt(
  geometry: THREE.BufferGeometry,
  toWorld: THREE.Matrix4,
  toLocal: THREE.Matrix4,
  options: { amount: number; scale: number; ground: number },
): void {
  const position = geometry.getAttribute('position') as THREE.BufferAttribute
  const point = new THREE.Vector3()

  for (let i = 0; i < position.count; i++) {
    point.fromBufferAttribute(position, i).applyMatrix4(toWorld)

    const above = Math.max(0, point.y - options.ground) / Math.max(1e-6, options.scale)
    const sink = options.amount * above ** 1.6
    const spread = 1 + 0.85 * Math.exp(-above * 1.1)

    point.y -= sink * options.scale
    point.x *= spread
    point.z *= spread

    if (point.y < options.ground) {
      point.y = options.ground + (point.y - options.ground) * 0.05
    }

    point.applyMatrix4(toLocal)
    position.setXYZ(i, point.x, point.y, point.z)
  }

  position.needsUpdate = true
  geometry.computeVertexNormals()
  invalidateBounds(geometry)
}

export interface DeformPart {
  geometry: THREE.BufferGeometry
  node: THREE.Object3D
}

export interface DeformContext {
  /** The creature's rough size, so a deformation reads the same at any scale. */
  scale: number
  /** Where the floor is, in the same space the parts are measured in. */
  ground: number
}

/**
 * Runs a deformation over every part of a built creature. Called once the whole
 * tree exists and its world matrices are current, so a deformation can reason
 * about where a vertex actually is rather than only where it is in its own part.
 */
export type Deformation = 'shattered' | 'melted' | 'voxel' | 'twisted' | 'inverted'

export const DEFORMATIONS: readonly Deformation[] = [
  'shattered',
  'melted',
  'voxel',
  'twisted',
  'inverted',
]

export function deform(
  mutation: Deformation,
  parts: readonly DeformPart[],
  context: DeformContext,
): void {
  const toLocal = new THREE.Matrix4()

  for (const part of parts) {
    if (mutation === 'shattered') {
      shatter(part.geometry, context.scale * 0.1)
      continue
    }
    if (mutation === 'voxel') {
      voxelise(part.geometry, context.scale * 0.21)
      continue
    }
    if (mutation === 'inverted') {
      invert(part.geometry)
      continue
    }

    toLocal.copy(part.node.matrixWorld).invert()
    if (mutation === 'twisted') {
      twist(part.geometry, part.node.matrixWorld, toLocal, {
        turns: 0.52,
        scale: context.scale,
        ground: context.ground,
      })
      continue
    }

    melt(part.geometry, part.node.matrixWorld, toLocal, {
      amount: 0.16,
      scale: context.scale,
      ground: context.ground,
    })
  }
}

/**
 * Re-quantises the surface onto a grid. Each triangle surrenders its shape and
 * leaves behind a cube in whatever cell its centre fell in, so the creature is
 * rebuilt out of blocks at whatever size the grid is — a different surface
 * describing the same volume.
 */
export function voxelise(geometry: THREE.BufferGeometry, cell: number): void {
  const position = geometry.getAttribute('position') as THREE.BufferAttribute
  const color = geometry.getAttribute('color') as THREE.BufferAttribute
  const points = position.array as Float32Array
  const tints = color.array as Float32Array
  const size = Math.max(1e-4, cell)

  const cells = new Map<string, { x: number; y: number; z: number; r: number; g: number; b: number }>()

  for (let triangle = 0; triangle + 8 < points.length; triangle += 9) {
    const cx = (points[triangle]! + points[triangle + 3]! + points[triangle + 6]!) / 3
    const cy = (points[triangle + 1]! + points[triangle + 4]! + points[triangle + 7]!) / 3
    const cz = (points[triangle + 2]! + points[triangle + 5]! + points[triangle + 8]!) / 3

    const ix = Math.round(cx / size)
    const iy = Math.round(cy / size)
    const iz = Math.round(cz / size)
    const key = `${ix},${iy},${iz}`
    if (cells.has(key)) continue

    cells.set(key, {
      x: ix * size,
      y: iy * size,
      z: iz * size,
      r: tints[triangle]!,
      g: tints[triangle + 1]!,
      b: tints[triangle + 2]!,
    })
  }

  const half = size * 0.5
  const positions: number[] = []
  const colors: number[] = []

  for (const cube of cells.values()) {
    for (const face of CUBE_FACES) {
      for (const corner of face) {
        positions.push(cube.x + corner[0]! * half, cube.y + corner[1]! * half, cube.z + corner[2]! * half)
        colors.push(cube.r, cube.g, cube.b)
      }
    }
  }

  geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(positions), 3))
  geometry.setAttribute('color', new THREE.BufferAttribute(new Float32Array(colors), 3))
  geometry.setIndex(null)
  geometry.computeVertexNormals()
  invalidateBounds(geometry)
}

type Corner = readonly [number, number, number]

/** Twelve triangles, wound outward. */
const CUBE_FACES: readonly (readonly Corner[])[] = [
  [[-1, -1, 1], [1, -1, 1], [1, 1, 1], [-1, -1, 1], [1, 1, 1], [-1, 1, 1]],
  [[1, -1, -1], [-1, -1, -1], [-1, 1, -1], [1, -1, -1], [-1, 1, -1], [1, 1, -1]],
  [[1, -1, 1], [1, -1, -1], [1, 1, -1], [1, -1, 1], [1, 1, -1], [1, 1, 1]],
  [[-1, -1, -1], [-1, -1, 1], [-1, 1, 1], [-1, -1, -1], [-1, 1, 1], [-1, 1, -1]],
  [[-1, 1, 1], [1, 1, 1], [1, 1, -1], [-1, 1, 1], [1, 1, -1], [-1, 1, -1]],
  [[-1, -1, -1], [1, -1, -1], [1, -1, 1], [-1, -1, -1], [1, -1, 1], [-1, -1, 1]],
]

/**
 * Winds the creature around its own vertical axis: the higher a vertex sits, the
 * further round it is carried. Nothing moves relative to the floor, and nothing
 * is added or removed — the whole body is sheared into a helix.
 */
export function twist(
  geometry: THREE.BufferGeometry,
  toWorld: THREE.Matrix4,
  toLocal: THREE.Matrix4,
  options: { turns: number; scale: number; ground: number },
): void {
  const position = geometry.getAttribute('position') as THREE.BufferAttribute
  const point = new THREE.Vector3()
  const up = new THREE.Vector3(0, 1, 0)

  for (let i = 0; i < position.count; i++) {
    point.fromBufferAttribute(position, i).applyMatrix4(toWorld)

    const above = (point.y - options.ground) / Math.max(1e-6, options.scale)
    point.applyAxisAngle(up, options.turns * above)

    point.applyMatrix4(toLocal)
    position.setXYZ(i, point.x, point.y, point.z)
  }

  position.needsUpdate = true
  geometry.computeVertexNormals()
  invalidateBounds(geometry)
}

/**
 * Pushes every part away from the body's centre along the line it already sits
 * on, so the creature hangs apart in mid-air without losing its arrangement.
 *
 * This one moves nodes rather than vertices. The parts stay parented to their
 * joints, so an exploded creature still walks — the gait drives the pieces, and
 * what you see is the assembly rather than the animal.
 */
export function explode(parts: readonly DeformPart[], centre: THREE.Vector3, amount: number): void {
  const here = new THREE.Vector3()
  const turn = new THREE.Quaternion()
  const push = new THREE.Vector3()

  for (const part of parts) {
    const parent = part.node.parent
    if (!parent) continue

    part.node.getWorldPosition(here)
    push.subVectors(here, centre)
    if (push.lengthSq() < 1e-8) push.set(0, 1, 0)
    push.normalize().multiplyScalar(amount * (0.35 + push.length()))

    parent.getWorldQuaternion(turn).invert()
    part.node.position.add(push.applyQuaternion(turn))
  }
}

/**
 * Breaks the mirror. Every part is scaled and canted by a hash of where it sits,
 * and because a part and its opposite number sit at opposite x, no two matching
 * parts ever draw the same number. The creature stops having a left and a right
 * that agree.
 */
export function skew(parts: readonly DeformPart[], strength: number): void {
  const here = new THREE.Vector3()

  for (const part of parts) {
    part.node.getWorldPosition(here)
    const a = noise(here.x, here.y, here.z)
    const b = noise(here.z, here.x, here.y)
    const c = noise(here.y, here.z, here.x)

    part.node.scale.set(
      1 + (a - 0.5) * strength * 1.6,
      1 + (b - 0.5) * strength,
      1 + (c - 0.5) * strength * 1.3,
    )
    part.node.rotation.x += (b - 0.5) * strength * 0.9
    part.node.rotation.z += (c - 0.5) * strength * 0.9
  }
}

/**
 * Turns the surface inside out by reversing every triangle's winding. With
 * back faces culled, the side facing you disappears and you see the far inside
 * of the creature instead — the same shape, read from within.
 */
export function invert(geometry: THREE.BufferGeometry): void {
  const position = geometry.getAttribute('position') as THREE.BufferAttribute
  const color = geometry.getAttribute('color') as THREE.BufferAttribute
  const points = position.array as Float32Array
  const tints = color.array as Float32Array

  for (let triangle = 0; triangle + 8 < points.length; triangle += 9) {
    for (let axis = 0; axis < 3; axis++) {
      const b = triangle + 3 + axis
      const c = triangle + 6 + axis
      const point = points[b]!
      points[b] = points[c]!
      points[c] = point
      const tint = tints[b]!
      tints[b] = tints[c]!
      tints[c] = tint
    }
  }

  position.needsUpdate = true
  color.needsUpdate = true
  geometry.computeVertexNormals()
  invalidateBounds(geometry)
}
