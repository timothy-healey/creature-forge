import * as THREE from 'three'

/**
 * One primitive builds every body part: a prism defined by cross-sections
 * stacked along Y, with any number of sides, and an end that can collapse to a
 * point.
 *
 * Why not boxes. A box is six flat quads, and under flat shading each one reads
 * as a slab — which is not what models of this era looked like. They were
 * faceted: five- and six-sided limbs, wedge-shaped skulls, horns and tails
 * ending in actual points. Just as important, every quad here is split into two
 * triangles, and as soon as a section is tapered or twisted that quad stops
 * being planar — so the diagonal seam shows. That visible diagonal is most of
 * the look.
 *
 * Geometry is non-indexed on purpose: flat shading wants unshared vertices, and
 * unshared vertices let each face carry its own colour, which is the whole
 * palette system with no texture anywhere.
 */

/** One cross-section. `rx` and `rz` are half-width and half-depth, not radii. */
export interface Section {
  y: number
  rx: number
  rz: number
  /** Shifts this section off the axis — a chest that leans, a snout that droops. */
  dx?: number
  dz?: number
  /** Twists this section, which stops its quads being planar. */
  yaw?: number
}

export interface PrismColors {
  side: THREE.Color
  /** The flat ends. Defaults to `side`. */
  cap?: THREE.Color
  /** Painted on the faces that point forward — a belly stripe without a texture. */
  belly?: THREE.Color
}

export interface PrismOptions {
  sides: number
  sections: readonly Section[]
  colors: PrismColors
  /** Collapses one end into a single point: a horn, a beak, the end of a tail. */
  tip?: 'top' | 'bottom'
  /** How far round from front the belly colour reaches, in radians. */
  bellyWidth?: number
}

const TAU = Math.PI * 2
const MIN_EXTENT = 0.003
const DEFAULT_BELLY_WIDTH = 0.8

export function prism(options: PrismOptions): THREE.BufferGeometry {
  const sides = Math.max(3, Math.min(12, Math.round(options.sides)))
  const sections = options.sections
  if (sections.length < 2) throw new Error('a prism needs at least two sections')

  const unit = unitRing(sides)
  const sideColor = options.colors.side
  const capColor = options.colors.cap ?? sideColor
  const bellyColor = options.colors.belly
  const bellyWidth = options.bellyWidth ?? DEFAULT_BELLY_WIDTH

  const positions: number[] = []
  const colors: number[] = []

  function triangle(a: THREE.Vector3, b: THREE.Vector3, c: THREE.Vector3, color: THREE.Color): void {
    for (const vertex of [a, b, c]) {
      positions.push(vertex.x, vertex.y, vertex.z)
      colors.push(color.r, color.g, color.b)
    }
  }

  function vertexAt(section: Section, index: number): THREE.Vector3 {
    const point = unit[index % sides]!
    const yaw = section.yaw ?? 0
    const cos = Math.cos(yaw)
    const sin = Math.sin(yaw)
    return new THREE.Vector3(
      (section.dx ?? 0) + (point.x * cos - point.z * sin) * Math.max(MIN_EXTENT, section.rx),
      section.y,
      (section.dz ?? 0) + (point.x * sin + point.z * cos) * Math.max(MIN_EXTENT, section.rz),
    )
  }

  function centreOf(section: Section): THREE.Vector3 {
    return new THREE.Vector3(section.dx ?? 0, section.y, section.dz ?? 0)
  }

  /** Faces pointing within `bellyWidth` of straight ahead get the belly colour. */
  function colorForFace(index: number): THREE.Color {
    if (!bellyColor) return sideColor
    const facing = (TAU * (index + 1)) / sides
    const offset = Math.abs(Math.atan2(Math.sin(facing - Math.PI / 2), Math.cos(facing - Math.PI / 2)))
    return offset <= bellyWidth ? bellyColor : sideColor
  }

  const first = sections[0]!
  const last = sections[sections.length - 1]!
  const tipTop = options.tip === 'top'
  const tipBottom = options.tip === 'bottom'

  for (let ring = 0; ring < sections.length - 1; ring++) {
    const lower = sections[ring]!
    const upper = sections[ring + 1]!
    const lowerIsTip = tipBottom && ring === 0
    const upperIsTip = tipTop && ring === sections.length - 2

    for (let i = 0; i < sides; i++) {
      const color = colorForFace(i)

      if (upperIsTip) {
        triangle(vertexAt(lower, i), centreOf(upper), vertexAt(lower, i + 1), color)
        continue
      }
      if (lowerIsTip) {
        triangle(centreOf(lower), vertexAt(upper, i), vertexAt(upper, i + 1), color)
        continue
      }

      const a = vertexAt(lower, i)
      const b = vertexAt(lower, i + 1)
      const c = vertexAt(upper, i + 1)
      const d = vertexAt(upper, i)
      triangle(a, d, c, color)
      triangle(a, c, b, color)
    }
  }

  if (!tipBottom) {
    const centre = centreOf(first)
    for (let i = 0; i < sides; i++) {
      triangle(centre, vertexAt(first, i), vertexAt(first, i + 1), capColor)
    }
  }
  if (!tipTop) {
    const centre = centreOf(last)
    for (let i = 0; i < sides; i++) {
      triangle(centre, vertexAt(last, i + 1), vertexAt(last, i), capColor)
    }
  }

  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(positions), 3))
  geometry.setAttribute('color', new THREE.BufferAttribute(new Float32Array(colors), 3))
  geometry.computeVertexNormals()
  return geometry
}

/**
 * The cross-section's corners, normalised so that `rx` and `rz` mean half-width
 * and half-depth whatever the side count — a five-sided limb and a six-sided one
 * asked for the same thickness come out the same thickness.
 */
function unitRing(sides: number): { x: number; z: number }[] {
  const angles = Array.from({ length: sides }, (_, i) => (TAU * (i + 0.5)) / sides)
  const cosines = angles.map(Math.cos)
  const sines = angles.map(Math.sin)

  const spanX = Math.max(...cosines) - Math.min(...cosines)
  const spanZ = Math.max(...sines) - Math.min(...sines)
  const midX = (Math.max(...cosines) + Math.min(...cosines)) / 2
  const midZ = (Math.max(...sines) + Math.min(...sines)) / 2

  return angles.map((_, i) => ({
    x: ((cosines[i]! - midX) * 2) / spanX,
    z: ((sines[i]! - midZ) * 2) / spanZ,
  }))
}

/** Swings a part so it points forward (+Z): snouts, beaks, feet. */
export function pointForward(geometry: THREE.BufferGeometry): THREE.BufferGeometry {
  geometry.rotateX(Math.PI / 2)
  return geometry
}

/** Swings a part so it points backward (-Z): tail segments. */
export function pointBackward(geometry: THREE.BufferGeometry): THREE.BufferGeometry {
  geometry.rotateX(-Math.PI / 2)
  return geometry
}

/** Hangs a part below its origin, so a limb swings from its top end. */
export function hangDown(geometry: THREE.BufferGeometry): THREE.BufferGeometry {
  geometry.computeBoundingBox()
  geometry.translate(0, -geometry.boundingBox!.max.y, 0)
  return geometry
}

/**
 * A part's shape as a continuous function rather than a fixed list of rings.
 *
 * `t` runs 0 at the base to 1 at the far end. Because the shape is continuous,
 * it can be sampled at any density: three rings or nine describe the same
 * silhouette, which is what lets one slider move a creature between a 300- and a
 * 3000-triangle version of itself without redesigning it.
 */
export interface Profile {
  /** Half-width across the body. */
  rx(t: number): number
  /** Half-depth front to back. */
  rz(t: number): number
  /** Offset front to back — a drooping snout, a brow, a curved tail. */
  dz?(t: number): number
  /** Offset across the body. */
  dx?(t: number): number
  /** Twist, which stops a band's quads being planar. */
  yaw?(t: number): number
}

/** Samples a profile into the sections a prism is built from. */
export function sample(profile: Profile, length: number, bands: number): Section[] {
  const steps = Math.max(1, Math.round(bands))
  return Array.from({ length: steps + 1 }, (_, i) => {
    const t = i / steps
    return {
      y: t * length,
      rx: profile.rx(t),
      rz: profile.rz(t),
      dx: profile.dx?.(t) ?? 0,
      dz: profile.dz?.(t) ?? 0,
      yaw: profile.yaw?.(t) ?? 0,
    }
  })
}

/**
 * How finely a creature is described. One slider drives both numbers: the
 * corners around a cross-section, and the bands along a part's length.
 */
export interface Resolution {
  /** Corners around a part, scaled from the count that part looks right at. */
  sides(base: number): number
  /** Bands along a part, from a minimum that part cannot look right below. */
  bands(base: number): number
  /** How many elements to repeat along a run — ridge plates, tail segments. */
  repeats(base: number): number
}

export function resolutionFor(detail: number): Resolution {
  const level = Math.min(1, Math.max(0, Number.isFinite(detail) ? detail : 0.5))
  const sideScale = 0.6 + level * 1.4
  const bandScale = 0.5 + level * 2.5

  return {
    sides: (base) => Math.max(3, Math.min(14, Math.round(base * sideScale))),
    bands: (base) => Math.max(1, Math.min(12, Math.round(base * bandScale))),
    repeats: (base) => Math.max(1, Math.min(16, Math.round(base * (0.6 + level * 1.2)))),
  }
}
