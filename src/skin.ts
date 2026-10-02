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
   * How close two vertices must be to share a normal. Parts interpenetrate
   * rather than meeting exactly, so an exact weld never joins one to another;
   * this is what carries shading across a joint.
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
  fuseNormals(geometry, options.fuse)

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
 * Averages normals between vertices that are merely near each other rather than
 * identical, so shading flows across a joint where two parts overlap instead of
 * meeting vertex to vertex.
 *
 * Normals only. Fusing *weights* this way was a mistake: a cell at the shoulder
 * holds both torso and limb vertices, and merging their weights handed the torso
 * a share of the arm — so the arm swung and dragged a spike of torso with it.
 * Weights follow the bone hierarchy, never proximity.
 *
 * Even for normals, a vertex only joins the average if it already faces roughly
 * the same way as the group. Two surfaces back to back in one cell would
 * otherwise flatten each other into a crease.
 */
function fuseNormals(geometry: THREE.BufferGeometry, cell: number): void {
  if (cell <= 0) return

  const position = geometry.getAttribute('position')
  const normal = geometry.getAttribute('normal')

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

  const mean = new THREE.Vector3()
  const facing = new THREE.Vector3()
  const agreed = new THREE.Vector3()

  for (const group of groups.values()) {
    if (group.length < 2) continue

    mean.set(0, 0, 0)
    for (const i of group) mean.set(mean.x + normal.getX(i), mean.y + normal.getY(i), mean.z + normal.getZ(i))
    if (mean.lengthSq() < 1e-12) continue
    mean.normalize()

    const facingSameWay = group.filter((i) => {
      facing.set(normal.getX(i), normal.getY(i), normal.getZ(i))
      return facing.dot(mean) > 0.2
    })
    if (facingSameWay.length < 2) continue

    agreed.set(0, 0, 0)
    for (const i of facingSameWay) {
      agreed.set(agreed.x + normal.getX(i), agreed.y + normal.getY(i), agreed.z + normal.getZ(i))
    }
    if (agreed.lengthSq() < 1e-12) continue
    agreed.normalize()

    for (const i of facingSameWay) normal.setXYZ(i, agreed.x, agreed.y, agreed.z)
  }

  normal.needsUpdate = true
}

function parentBone(bone: THREE.Bone): THREE.Bone | null {
  let node = bone.parent
  while (node) {
    if ((node as THREE.Bone).isBone) return node as THREE.Bone
    node = node.parent
  }
  return null
}
