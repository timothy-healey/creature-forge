import * as THREE from 'three'

/**
 * Light baked into the vertex colours, before any real light reaches it.
 *
 * Models of this era were legible because their lighting was painted in, not
 * computed: a flat-shaded limb lit by one lamp gives about three tones, and
 * every part of a creature here carries the same body colour, so a limb and the
 * torso behind it have nothing to tell them apart.
 *
 * Two cues do almost all the work, and both are free because the geometry is
 * generated rather than loaded. A face pointing up is lighter than one pointing
 * down, which is what makes a form read as a form. And a face close to a joint
 * is darker, because that is where two parts meet and where a crease belongs.
 */

export interface ShadePart {
  geometry: THREE.BufferGeometry
  node: THREE.Object3D
}

export interface ShadeOptions {
  /** How hard to bake. Zero leaves the palette exactly as it was rolled. */
  amount: number
  /** Where parts meet, in world space. */
  joints: readonly THREE.Vector3[]
  /** The creature's rough size, so a crease is the same width at any scale. */
  scale: number
}

export function bakeShading(parts: readonly ShadePart[], options: ShadeOptions): void {
  const strength = Math.min(1, Math.max(0, options.amount))
  if (strength <= 0.001) return

  // Local to the junction. Wider than this and a short limb, which has a joint
  // at each end, is creased along its whole length and goes black.
  const reach = Math.max(1e-4, options.scale * 0.17)
  const a = new THREE.Vector3()
  const b = new THREE.Vector3()
  const c = new THREE.Vector3()
  const centre = new THREE.Vector3()
  const normal = new THREE.Vector3()
  const edge = new THREE.Vector3()

  for (const part of parts) {
    const position = part.geometry.getAttribute('position') as THREE.BufferAttribute
    const colour = part.geometry.getAttribute('color') as THREE.BufferAttribute
    if (!position || !colour) continue
    const points = position.array as Float32Array
    const tints = colour.array as Float32Array

    for (let triangle = 0; triangle + 8 < points.length; triangle += 9) {
      a.set(points[triangle]!, points[triangle + 1]!, points[triangle + 2]!)
      b.set(points[triangle + 3]!, points[triangle + 4]!, points[triangle + 5]!)
      c.set(points[triangle + 6]!, points[triangle + 7]!, points[triangle + 8]!)

      normal.subVectors(b, a).cross(edge.subVectors(c, a))
      if (normal.lengthSq() < 1e-12) continue
      normal.normalize().transformDirection(part.node.matrixWorld)

      centre.addVectors(a, b).add(c).divideScalar(3).applyMatrix4(part.node.matrixWorld)

      // Up is lighter, down is darker, centred on one so a face pointing up is
      // genuinely brightened rather than merely darkened less. Baking that only
      // ever subtracts makes a dark creature darker, which is the opposite of
      // what it is for.
      const sky = 0.68 + 0.6 * (normal.y * 0.5 + 0.5)

      // And a crease wherever two parts meet.
      let nearest = Infinity
      for (const joint of options.joints) {
        const distance = centre.distanceToSquared(joint)
        if (distance < nearest) nearest = distance
      }
      const crease = 1 - 0.3 * Math.max(0, 1 - Math.sqrt(nearest) / reach) ** 1.4

      const shade = 1 + strength * (sky * crease - 1)
      for (let vertex = 0; vertex < 9; vertex += 3) {
        for (let channel = 0; channel < 3; channel++) {
          const at = triangle + vertex + channel
          tints[at] = Math.min(1, tints[at]! * shade)
        }
      }
    }

    colour.needsUpdate = true
  }
}

/**
 * A soft dark patch on the floor beneath the creature.
 *
 * A blob rather than a cast shadow on purpose: it is what the hardware of the
 * era actually did, it costs one textureless quad, and at a couple of hundred
 * pixels a real shadow map is mostly noise. Its job is to stop the creature
 * reading as floating, which it does whatever shape the creature turned out.
 */
export function createBlobShadow(): THREE.Mesh {
  const size = 64
  const data = new Uint8Array(size * size * 4)

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const dx = (x / (size - 1)) * 2 - 1
      const dy = (y / (size - 1)) * 2 - 1
      const falloff = Math.max(0, 1 - Math.hypot(dx, dy))
      const i = (y * size + x) * 4
      data[i + 3] = Math.round(255 * falloff ** 1.9)
    }
  }

  const texture = new THREE.DataTexture(data, size, size, THREE.RGBAFormat)
  texture.needsUpdate = true

  const geometry = new THREE.PlaneGeometry(1, 1)
  geometry.rotateX(-Math.PI / 2)
  const mesh = new THREE.Mesh(
    geometry,
    new THREE.MeshBasicMaterial({
      map: texture,
      transparent: true,
      opacity: 0.55,
      depthWrite: false,
      color: 0x000000,
      fog: false,
    }),
  )
  mesh.renderOrder = -2
  return mesh
}

/** Lays the blob under a creature, sized to what it actually stands on. */
export function fitBlobShadow(blob: THREE.Mesh, bounds: THREE.Box3): void {
  const size = bounds.getSize(new THREE.Vector3())
  const centre = bounds.getCenter(new THREE.Vector3())
  const spread = Math.max(0.2, Math.max(size.x, size.z) * 1.25)

  blob.scale.set(spread, 1, spread)
  blob.position.set(centre.x, bounds.min.y + 0.004, centre.z)
}
