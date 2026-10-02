import * as THREE from 'three'

/**
 * Binds a pile of parts into a single continuous mesh.
 *
 * Three things happen here, and all three are needed before a creature reads as
 * one animal rather than a stack of chunks:
 *
 * 1. Every part's vertices are baked into one geometry in bind pose, so there is
 *    one mesh and one draw call.
 * 2. Coincident vertices are welded, so normals average across the seam and the
 *    surface shades as a continuous skin instead of faceted slabs.
 * 3. Vertices near a joint are weighted partly to the parent bone, so the
 *    surface *bends* there instead of pivoting. This is the difference between
 *    an elbow and a hinge.
 */

export interface SkinPiece {
  geometry: THREE.BufferGeometry
  /** The node the part hangs from, which supplies its bind-pose transform. */
  node: THREE.Object3D
  /** The bone that owns it. */
  bone: THREE.Bone
}

export interface SkinOptions {
  root: THREE.Object3D
  bones: THREE.Bone[]
  pieces: readonly SkinPiece[]
  material: THREE.Material
  /**
   * How close two vertices must be to share a normal and a set of weights.
   * Parts interpenetrate rather than meeting exactly, so an exact weld never
   * joins one to another; this is what carries shading across a joint.
   */
  fuse: number
}

/** How much of a vertex's influence the parent bone can take, at the joint itself. */
const MAX_BLEND = 0.72
/** Positions are welded at this resolution — fine enough to never merge real detail. */
const WELD = 1e4
const MAX_INFLUENCES = 4

interface Welded {
  position: THREE.Vector3
  color: THREE.Color
  weights: Map<number, number>
  samples: number
}

export function buildSkin(options: SkinOptions): THREE.SkinnedMesh {
  options.root.updateMatrixWorld(true)

  const boneIndex = new Map<THREE.Bone, number>()
  options.bones.forEach((bone, index) => boneIndex.set(bone, index))

  const origin = new Map<THREE.Bone, THREE.Vector3>()
  const reach = new Map<THREE.Bone, number>()
  for (const bone of options.bones) {
    origin.set(bone, bone.getWorldPosition(new THREE.Vector3()))
    // A bone's blend reaches part of the way to the next joint down the chain.
    const child = bone.children.find((node) => (node as THREE.Bone).isBone) as THREE.Bone | undefined
    // The blend reaches most of the way to the next joint. Short of that, only
    // the single ring sitting on the joint ever bends, and a surface that bends
    // in one ring is indistinguishable from a hinge.
    reach.set(bone, Math.max(0.03, (child ? child.position.length() : 0.16) * 1.15))
  }

  const welded = new Map<string, number>()
  const vertices: Welded[] = []
  const indices: number[] = []
  const point = new THREE.Vector3()

  for (const piece of options.pieces) {
    const position = piece.geometry.getAttribute('position')
    const color = piece.geometry.getAttribute('color')
    const bone = piece.bone
    const parent = parentBone(bone)
    const self = boneIndex.get(bone) ?? 0
    const above = parent ? boneIndex.get(parent) ?? self : self
    const jointAt = origin.get(bone) ?? new THREE.Vector3()
    const span = reach.get(bone) ?? 0.12

    for (let i = 0; i < position.count; i++) {
      point.fromBufferAttribute(position, i).applyMatrix4(piece.node.matrixWorld)

      // Near the joint, hand some of this vertex over to the bone above it.
      // Smoothstep rather than a square: a square collapses to nothing a third
      // of the way along and leaves the bend looking like a crease.
      const closeness = Math.max(0, 1 - point.distanceTo(jointAt) / span)
      const eased = closeness * closeness * (3 - 2 * closeness)
      const shared = parent ? MAX_BLEND * eased : 0

      const tint = new THREE.Color(color.getX(i), color.getY(i), color.getZ(i))
      const key = [
        Math.round(point.x * WELD),
        Math.round(point.y * WELD),
        Math.round(point.z * WELD),
        Math.round(tint.r * 255),
        Math.round(tint.g * 255),
        Math.round(tint.b * 255),
      ].join(',')

      let at = welded.get(key)
      if (at === undefined) {
        at = vertices.length
        welded.set(key, at)
        vertices.push({ position: point.clone(), color: tint, weights: new Map(), samples: 0 })
      }

      const target = vertices[at]!
      target.samples++
      target.weights.set(self, (target.weights.get(self) ?? 0) + (1 - shared))
      if (shared > 0) target.weights.set(above, (target.weights.get(above) ?? 0) + shared)

      indices.push(at)
    }
  }

  const count = vertices.length
  const positions = new Float32Array(count * 3)
  const colors = new Float32Array(count * 3)
  const skinIndices = new Uint16Array(count * 4)
  const skinWeights = new Float32Array(count * 4)

  vertices.forEach((vertex, i) => {
    positions[i * 3] = vertex.position.x
    positions[i * 3 + 1] = vertex.position.y
    positions[i * 3 + 2] = vertex.position.z
    colors[i * 3] = vertex.color.r
    colors[i * 3 + 1] = vertex.color.g
    colors[i * 3 + 2] = vertex.color.b

    const strongest = [...vertex.weights.entries()].sort((a, b) => b[1] - a[1]).slice(0, MAX_INFLUENCES)
    const total = strongest.reduce((sum, [, weight]) => sum + weight, 0) || 1

    strongest.forEach(([bone, weight], slot) => {
      skinIndices[i * 4 + slot] = bone
      skinWeights[i * 4 + slot] = weight / total
    })
  })

  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3))
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3))
  geometry.setAttribute('skinIndex', new THREE.BufferAttribute(skinIndices, 4))
  geometry.setAttribute('skinWeight', new THREE.BufferAttribute(skinWeights, 4))
  geometry.setIndex(indices)
  geometry.computeVertexNormals()
  fuseNeighbours(geometry, vertices, options.fuse)

  const mesh = new THREE.SkinnedMesh(geometry, options.material)
  mesh.name = 'skin'
  // Bones move vertices the bounding sphere does not know about.
  mesh.frustumCulled = false
  options.root.add(mesh)
  options.root.updateMatrixWorld(true)
  mesh.bind(new THREE.Skeleton(options.bones))

  return mesh
}

/**
 * Averages normals and weights between vertices that are merely near each other
 * rather than identical.
 *
 * An exact weld only ever joins a part to itself, because parts overlap instead
 * of meeting vertex to vertex. Positions and colours stay exact — so the palette
 * keeps its hard edges — while shading and skinning flow across the junction,
 * which is what stops an elbow looking like two pipes that happen to touch.
 */
function fuseNeighbours(geometry: THREE.BufferGeometry, vertices: readonly Welded[], cell: number): void {
  if (cell <= 0) return

  const position = geometry.getAttribute('position')
  const normal = geometry.getAttribute('normal')
  const weights = geometry.getAttribute('skinWeight') as THREE.BufferAttribute
  const indices = geometry.getAttribute('skinIndex') as THREE.BufferAttribute

  const groups = new Map<string, number[]>()
  for (let i = 0; i < position.count; i++) {
    const key = [
      Math.round(position.getX(i) / cell),
      Math.round(position.getY(i) / cell),
      Math.round(position.getZ(i) / cell),
    ].join(',')
    const group = groups.get(key)
    if (group) group.push(i)
    else groups.set(key, [i])
  }

  const averaged = new THREE.Vector3()
  for (const group of groups.values()) {
    if (group.length < 2) continue

    averaged.set(0, 0, 0)
    const shared = new Map<number, number>()
    for (const i of group) {
      averaged.x += normal.getX(i)
      averaged.y += normal.getY(i)
      averaged.z += normal.getZ(i)
      for (const [bone, weight] of vertices[i]!.weights) {
        shared.set(bone, (shared.get(bone) ?? 0) + weight)
      }
    }
    if (averaged.lengthSq() > 1e-12) averaged.normalize()

    const strongest = [...shared.entries()].sort((a, b) => b[1] - a[1]).slice(0, MAX_INFLUENCES)
    const total = strongest.reduce((sum, [, weight]) => sum + weight, 0) || 1

    for (const i of group) {
      normal.setXYZ(i, averaged.x, averaged.y, averaged.z)
      for (let slot = 0; slot < MAX_INFLUENCES; slot++) {
        const entry = strongest[slot]
        indices.setComponent(i, slot, entry ? entry[0] : 0)
        weights.setComponent(i, slot, entry ? entry[1] / total : 0)
      }
    }
  }

  normal.needsUpdate = true
  weights.needsUpdate = true
  indices.needsUpdate = true
}

function parentBone(bone: THREE.Bone): THREE.Bone | null {
  let node = bone.parent
  while (node) {
    if ((node as THREE.Bone).isBone) return node as THREE.Bone
    node = node.parent
  }
  return null
}
