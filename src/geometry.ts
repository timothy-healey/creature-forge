import * as THREE from 'three'

/**
 * One primitive builds every body part: a box whose top face can differ in size
 * from its bottom. Torso, limb, snout, horn and tail segment are all the same
 * shape with different numbers.
 *
 * Geometry is non-indexed on purpose. Flat shading wants unshared vertices, and
 * unshared vertices let each face carry its own colour — which is the whole
 * palette system, with no texture anywhere.
 *
 * The box sits on the origin and grows up: y runs 0..height.
 */

type V3 = readonly [number, number, number]

/** Face order used by the `colors` array. */
export const FACES = ['front', 'back', 'right', 'left', 'top', 'bottom'] as const
export type Face = (typeof FACES)[number]

export interface BoxOptions {
  /** Width and depth of the bottom face. */
  bottom: readonly [number, number]
  /** Width and depth of the top face. */
  top: readonly [number, number]
  height: number
  /** One colour for the whole box, or one per face in `FACES` order. */
  colors: THREE.Color | readonly THREE.Color[]
}

const MIN_EXTENT = 0.004

/** Keeps a slider at zero from collapsing a part into a degenerate sliver. */
function floor(value: number): number {
  return Math.max(MIN_EXTENT, value)
}

export function taperedBox(options: BoxOptions): THREE.BufferGeometry {
  const bw = floor(options.bottom[0])
  const bd = floor(options.bottom[1])
  const tw = floor(options.top[0])
  const td = floor(options.top[1])
  const h = floor(options.height)

  const b0: V3 = [-bw / 2, 0, -bd / 2]
  const b1: V3 = [bw / 2, 0, -bd / 2]
  const b2: V3 = [bw / 2, 0, bd / 2]
  const b3: V3 = [-bw / 2, 0, bd / 2]
  const t0: V3 = [-tw / 2, h, -td / 2]
  const t1: V3 = [tw / 2, h, -td / 2]
  const t2: V3 = [tw / 2, h, td / 2]
  const t3: V3 = [-tw / 2, h, td / 2]

  // Wound counter-clockwise seen from outside, so backface culling behaves.
  const faces: readonly (readonly V3[])[] = [
    [b3, b2, t2, b3, t2, t3], // front  +Z
    [b1, b0, t0, b1, t0, t1], // back   -Z
    [b2, b1, t1, b2, t1, t2], // right  +X
    [b0, b3, t3, b0, t3, t0], // left   -X
    [t3, t2, t1, t3, t1, t0], // top    +Y
    [b0, b1, b2, b0, b2, b3], // bottom -Y
  ]

  const positions = new Float32Array(faces.length * 6 * 3)
  const colors = new Float32Array(faces.length * 6 * 3)
  let cursor = 0

  faces.forEach((face, faceIndex) => {
    const color = faceColor(options.colors, faceIndex)
    for (const vertex of face) {
      positions[cursor] = vertex[0]
      positions[cursor + 1] = vertex[1]
      positions[cursor + 2] = vertex[2]
      colors[cursor] = color.r
      colors[cursor + 1] = color.g
      colors[cursor + 2] = color.b
      cursor += 3
    }
  })

  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3))
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3))
  geometry.computeVertexNormals()
  return geometry
}

function faceColor(colors: BoxOptions['colors'], index: number): THREE.Color {
  if (colors instanceof THREE.Color) return colors
  return colors[index] ?? colors[0] ?? new THREE.Color(0xffffff)
}

/** A limb segment hanging downward from its origin: `near` sits at the joint. */
export function limbBox(options: {
  near: readonly [number, number]
  far: readonly [number, number]
  length: number
  colors: BoxOptions['colors']
}): THREE.BufferGeometry {
  const geometry = taperedBox({
    bottom: options.far,
    top: options.near,
    height: options.length,
    colors: options.colors,
  })
  geometry.translate(0, -options.length, 0)
  return geometry
}

/** A box pointing forward (+Z) from its origin: snouts, beaks, feet. */
export function forwardBox(options: {
  base: readonly [number, number]
  tip: readonly [number, number]
  length: number
  colors: BoxOptions['colors']
}): THREE.BufferGeometry {
  const geometry = taperedBox({
    bottom: options.base,
    top: options.tip,
    height: options.length,
    colors: options.colors,
  })
  geometry.rotateX(Math.PI / 2)
  return geometry
}

/** A box pointing backward (-Z) from its origin: tail segments. */
export function backwardBox(options: {
  base: readonly [number, number]
  tip: readonly [number, number]
  length: number
  colors: BoxOptions['colors']
}): THREE.BufferGeometry {
  const geometry = taperedBox({
    bottom: options.base,
    top: options.tip,
    height: options.length,
    colors: options.colors,
  })
  geometry.rotateX(-Math.PI / 2)
  return geometry
}
