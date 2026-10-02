import * as THREE from 'three'

/**
 * Markings, painted from the creature's own geometry.
 *
 * Spore paints three layers — base coat, pattern, detail — by walking particles
 * over an auto-unwrapped surface. We have no textures and never will, so the
 * same idea lands differently: the pattern is decided per triangle, from where
 * that triangle sits, and written straight into the vertex colours.
 *
 * Per triangle rather than per vertex on purpose. A face is either marked or it
 * is not, which gives the hard-edged blocks of colour the era actually had, and
 * it reads at any resolution instead of needing vertices to interpolate across.
 */

export type Pattern = 'none' | 'stripes' | 'bands' | 'spots' | 'patches' | 'tips'

export const PATTERNS: readonly Pattern[] = ['none', 'stripes', 'bands', 'spots', 'patches', 'tips']

function noise(x: number, y: number, z: number): number {
  const value = Math.sin(x * 127.1 + y * 311.7 + z * 74.7) * 43758.5453
  return value - Math.floor(value)
}

/** Smooth low-frequency noise, for shapes larger than a single face. */
function blobby(x: number, y: number, z: number): number {
  return (
    0.6 * noise(Math.floor(x), Math.floor(y), Math.floor(z)) +
    0.3 * noise(Math.floor(x * 2.3), Math.floor(y * 2.3), Math.floor(z * 2.3)) +
    0.1 * noise(Math.floor(x * 5.1), Math.floor(y * 5.1), Math.floor(z * 5.1))
  )
}

export interface PaintPart {
  geometry: THREE.BufferGeometry
  node: THREE.Object3D
}

export interface PaintOptions {
  colour: THREE.Color
  /** How large the markings are, relative to the creature. */
  scale: number
  /** How completely a marked face takes the pattern colour. */
  strength: number
  /** The creature's rough size, so a pattern reads the same at any scale. */
  size: number
  ground: number
}

export function paint(parts: readonly PaintPart[], pattern: Pattern, options: PaintOptions): void {
  if (pattern === 'none' || options.strength <= 0) return

  const world = new THREE.Vector3()
  const local = new THREE.Vector3()
  const tint = new THREE.Color()
  const frequency = 2.2 / Math.max(1e-4, options.scale * options.size)

  for (const part of parts) {
    const position = part.geometry.getAttribute('position') as THREE.BufferAttribute
    const colour = part.geometry.getAttribute('color') as THREE.BufferAttribute
    const points = position.array as Float32Array
    const tints = colour.array as Float32Array

    part.geometry.computeBoundingBox()
    const extent = Math.max(1e-4, part.geometry.boundingBox!.getSize(new THREE.Vector3()).length())

    for (let triangle = 0; triangle + 8 < points.length; triangle += 9) {
      local.set(
        (points[triangle]! + points[triangle + 3]! + points[triangle + 6]!) / 3,
        (points[triangle + 1]! + points[triangle + 4]! + points[triangle + 7]!) / 3,
        (points[triangle + 2]! + points[triangle + 5]! + points[triangle + 8]!) / 3,
      )
      world.copy(local).applyMatrix4(part.node.matrixWorld)

      if (!marked(pattern, world, local, frequency, extent, options)) continue

      tint.setRGB(tints[triangle]!, tints[triangle + 1]!, tints[triangle + 2]!)
      tint.lerp(options.colour, options.strength)

      for (let vertex = 0; vertex < 9; vertex += 3) {
        tints[triangle + vertex] = tint.r
        tints[triangle + vertex + 1] = tint.g
        tints[triangle + vertex + 2] = tint.b
      }
    }

    colour.needsUpdate = true
  }
}

function marked(
  pattern: Pattern,
  world: THREE.Vector3,
  local: THREE.Vector3,
  frequency: number,
  extent: number,
  options: PaintOptions,
): boolean {
  switch (pattern) {
    // Across the body: bands that run round a standing creature like a tiger's.
    case 'stripes':
      return Math.sin((world.y - options.ground) * frequency * 3) > 0

    // Round each part instead: rings down a limb, segments down a tail.
    case 'bands':
      return Math.sin((local.y / extent) * Math.PI * 6) > 0

    case 'spots':
      return (
        noise(
          Math.floor(world.x * frequency),
          Math.floor(world.y * frequency),
          Math.floor(world.z * frequency),
        ) > 0.62
      )

    case 'patches':
      return blobby(world.x * frequency * 0.5, world.y * frequency * 0.5, world.z * frequency * 0.5) > 0.58

    // The far end of whatever this part is — a limb's foot, a tail's tip.
    case 'tips':
      return local.length() / extent > 0.46

    default:
      return false
  }
}
