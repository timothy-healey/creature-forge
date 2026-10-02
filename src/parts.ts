import * as THREE from 'three'
import {
  fan,
  hangDown,
  pointBackward,
  pointForward,
  prism,
  sample,
  type CrossSection,
  type Profile,
  type Resolution,
} from './geometry'
import type { CreatureSpec } from './spec'

/**
 * Every body part, as a profile rather than a fixed mesh.
 *
 * A builder here says what shape a part is — how wide it is at each point along
 * its length, and what its cross-section looks like — and the resolution decides
 * how many vertices describe it. Nothing in this file knows how many sides it
 * will end up with.
 *
 * Anything that should read as a sheet rather than a tube — a wing membrane, a
 * back plate, a frill, a tail fan — is built with `fan` instead of `prism`. A
 * swept cross-section is always a tube, however it is tapered.
 */

export interface Dims {
  torsoW: number
  torsoD: number
  spineLength: number
  neckLen: number
  headW: number
  headH: number
  headD: number
  headLen: number
  legThick: number
  armThick: number
}

export interface Palette {
  body: THREE.Color
  belly: THREE.Color
  accent: THREE.Color
  eye: THREE.Color
}

/** The three genes, resolved into numbers the builders use directly. */
export interface Shape {
  /** Cross-section exponent: low is faceted, high is slabby. */
  power: number
  /** Width multiplier. */
  wide: number
  /** Depth multiplier. */
  deep: number
  /** Where mass sits along a part: 0 at the base, 1 at the far end. */
  bulk: number
}

export interface Forge {
  dims: Dims
  palette: Palette
  res: Resolution
  shape: Shape
  /**
   * How far a limb pushes up past its joint, as a fraction of its own width.
   * Zero leaves parts abutting, which is right when they stay rigid; a bound
   * skin wants them overlapping so the two surfaces weld into one.
   */
  embed: number
}

/** A geometry with somewhere to sit. The generator parents these to joints. */
export interface Placed {
  name: string
  geometry: THREE.BufferGeometry
  position?: THREE.Vector3Like
  rotation?: THREE.Vector3Like
}

type Point = readonly [number, number]

/** A bulge that peaks wherever the `bulk` gene puts it, zero at both ends. */
function hump(t: number, peak: number): number {
  const at = Math.min(0.9, Math.max(0.1, peak))
  return Math.sin(Math.PI * (t <= at ? t / (2 * at) : 0.5 + (t - at) / (2 * (1 - at))))
}

const taper = (from: number, to: number) => (t: number) => from + (to - from) * t

function section(shape: Shape, frontBias = 1): CrossSection {
  return { power: shape.power, frontBias }
}

// ─── body ───────────────────────────────────────────────────────────────────

export function torsoProfile({ dims, shape }: Forge, segments: number): Profile {
  const peak = 0.28 + shape.bulk * 0.44
  const ripple = (t: number) => 1 + 0.09 * Math.sin(t * Math.PI * segments * 2)
  const swell = (t: number) => (0.68 + 0.36 * hump(t, peak)) * ripple(t)

  return {
    rx: (t) => dims.torsoW * 0.5 * shape.wide * swell(t),
    rz: (t) => dims.torsoD * 0.5 * shape.deep * swell(t),
    yaw: (t) => Math.sin(t * Math.PI * 2) * 0.07,
  }
}

/**
 * One bead of a segmented body: a slice of the torso profile pinched to a waist
 * at both ends, so the chain reads as discrete units rather than a single tube.
 */
export function segment(forge: Forge, segments: number, index: number, count: number, length: number): Placed {
  const { palette, res, shape } = forge
  const whole = torsoProfile(forge, segments)
  const pinch = (t: number) => 0.74 + 0.4 * Math.sin(Math.PI * t)
  const along = (t: number) => (index + t) / count

  return {
    name: `segment${index}`,
    geometry: prism({
      sides: res.sides(6),
      sections: sample(
        {
          rx: (t) => whole.rx(along(t)) * pinch(t),
          rz: (t) => whole.rz(along(t)) * pinch(t),
          yaw: (t) => t * 0.2,
        },
        length,
        res.bands(2),
      ),
      shape: section(shape, 0.88 + shape.bulk * 0.62),
      colors: { side: palette.body, belly: palette.belly, cap: palette.belly },
      bellyWidth: 0.95,
    }),
  }
}

export function torso(forge: Forge, segments: number): Placed {
  const { palette, res, shape } = forge

  return {
    name: 'torso',
    geometry: prism({
      sides: res.sides(6),
      sections: sample(torsoProfile(forge, segments), forge.dims.spineLength, res.bands(Math.max(3, segments * 1.4))),
      shape: section(shape, 0.88 + shape.bulk * 0.62),
      colors: { side: palette.body, belly: palette.belly, cap: palette.belly },
      bellyWidth: 0.95,
    }),
  }
}

export function neck({ dims, palette, res, shape }: Forge): Placed {
  const profile: Profile = {
    rx: taper(dims.torsoW * 0.22 * shape.wide, dims.torsoW * 0.16 * shape.wide),
    rz: taper(dims.torsoD * 0.24 * shape.deep, dims.torsoD * 0.18 * shape.deep),
    dz: (t) => dims.neckLen * 0.2 * Math.sin(t * Math.PI),
  }

  return {
    name: 'neck',
    geometry: prism({
      sides: res.sides(5),
      sections: sample(profile, dims.neckLen, res.bands(2)),
      shape: section(shape, 1.05),
      colors: { side: palette.body, belly: palette.belly },
    }),
  }
}

// ─── head ───────────────────────────────────────────────────────────────────

export function skull({ dims, palette, res, shape }: Forge): Placed {
  const peak = 0.3 + shape.bulk * 0.35
  const profile: Profile = {
    rx: (t) => dims.headW * 0.5 * shape.wide * (0.62 + 0.42 * hump(t, peak)),
    rz: (t) => dims.headD * 0.5 * shape.deep * (0.62 + 0.42 * hump(t, peak)),
    dz: (t) => dims.headD * 0.08 * Math.sin(Math.PI * t) - dims.headD * 0.04 * t,
  }

  return {
    name: 'skull',
    geometry: prism({
      sides: res.sides(6),
      sections: sample(profile, dims.headH, res.bands(2)),
      shape: section(shape, 0.95 + shape.bulk * 0.45),
      colors: { side: palette.body, belly: palette.belly, cap: palette.body },
      bellyWidth: 0.6,
    }),
  }
}

export function face(forge: Forge, type: CreatureSpec['head']['type']): Placed[] {
  const { dims, palette, res, shape } = forge
  const front = dims.headD * 0.3

  if (type === 'snout') {
    return [
      {
        name: 'snout',
        geometry: pointForward(
          prism({
            sides: res.sides(5),
            sections: sample(
              {
                rx: (t) => dims.headW * shape.wide * (0.32 - 0.14 * t),
                rz: (t) => dims.headH * shape.deep * (0.3 - 0.15 * t),
                dz: (t) => dims.headH * 0.09 * t * t,
              },
              dims.headLen,
              res.bands(2),
            ),
            shape: section(shape, 0.8),
            colors: { side: palette.body, belly: palette.belly, cap: palette.belly },
          }),
        ),
        position: { x: 0, y: dims.headH * 0.38, z: front },
      },
    ]
  }

  if (type === 'beak') {
    return [
      {
        name: 'beak',
        geometry: pointForward(
          prism({
            sides: res.sides(4),
            sections: sample(
              {
                rx: (t) => dims.headW * 0.26 * shape.wide * (1 - t) ** 1.3,
                rz: (t) => dims.headH * 0.24 * shape.deep * (1 - t) ** 1.2,
                dz: (t) => dims.headH * 0.17 * t ** 1.4,
              },
              dims.headLen * 1.3,
              res.bands(2),
            ),
            shape: section(shape, 0.7),
            colors: { side: palette.accent },
            tip: 'top',
          }),
        ),
        position: { x: 0, y: dims.headH * 0.46, z: front },
      },
    ]
  }

  const muzzle: Placed = {
    name: 'muzzle',
    geometry: pointForward(
      prism({
        sides: res.sides(6),
        sections: sample(
          {
            rx: (t) => dims.headW * shape.wide * (0.4 - 0.06 * t),
            rz: (t) => dims.headH * shape.deep * (0.33 - 0.07 * t),
            dz: (t) => dims.headH * 0.05 * t,
          },
          dims.headLen * 0.55,
          res.bands(2),
        ),
        shape: section(shape, 1.1),
        colors: { side: palette.body, belly: palette.belly, cap: palette.belly },
      }),
    ),
    position: { x: 0, y: dims.headH * 0.32, z: front },
  }

  if (type === 'blunt') return [muzzle]

  // 'crest' — a blunt face under a swept plate, built as a sheet, not a tube.
  const length = dims.headLen * 1.25
  const height = dims.headH * 0.75
  return [
    muzzle,
    {
      name: 'crest',
      geometry: sagittal(
        fan({
          origin: [0, 0],
          rim: scalloped(
            [
              [0, -length * 0.18],
              [height * 0.72, -length * 0.35],
              [height, -length * 0.02],
              [height * 0.66, length * 0.42],
              [0, length * 0.6],
            ],
            [0, 0],
            0.82,
          ),
          color: palette.accent,
        }),
      ),
      position: { x: 0, y: dims.headH * 0.86, z: -dims.headD * 0.12 },
      rotation: { x: 0.35, y: 0, z: 0 },
    },
  ]
}

export function eyes({ dims, palette, res, shape }: Forge): Placed[] {
  const size = Math.max(0.03, dims.headW * 0.11)

  return [-1, 1].map((side) => ({
    name: side < 0 ? 'eyeL' : 'eyeR',
    geometry: pointForward(
      prism({
        sides: res.sides(4),
        sections: sample({ rx: taper(size, size * 0.66), rz: taper(size * 0.7, size * 0.44) }, size * 0.95, 1),
        shape: section(shape),
        colors: { side: palette.eye },
      }),
    ),
    position: { x: side * dims.headW * 0.26, y: dims.headH * 0.58, z: dims.headD * 0.34 },
  }))
}

export function horns({ dims, palette, res, shape }: Forge, count: number): Placed[] {
  if (count === 0) return []
  const length = 0.12 + dims.headW * 0.45
  const thickness = dims.headW * 0.1
  const offsets = count === 1 ? [0] : [-dims.headW * 0.26, dims.headW * 0.26]

  return offsets.map((x, index) => ({
    name: `horn${index}`,
    geometry: prism({
      sides: res.sides(5),
      sections: sample(
        {
          rx: (t) => thickness * (1 - t) ** 0.8,
          rz: (t) => thickness * (1 - t) ** 0.8,
          yaw: (t) => t * 0.5,
        },
        length,
        res.bands(2),
      ),
      shape: section(shape, 0.9),
      colors: { side: palette.accent },
      tip: 'top',
    }),
    position: { x, y: dims.headH * 0.86, z: -dims.headD * 0.06 },
    rotation: { x: -0.45, y: 0, z: -x * 1.6 },
  }))
}

/** Ear geometry, built pointing up — the generator swings it into place. */
export function ear({ dims, palette, res, shape }: Forge, type: CreatureSpec['head']['ears']): Placed | null {
  if (type === 'none') return null
  const width = dims.headW * 0.16

  if (type === 'pointed') {
    return {
      name: 'ear',
      geometry: prism({
        sides: res.sides(4),
        sections: sample(
          { rx: (t) => width * (1 - t) ** 0.7, rz: (t) => width * 0.42 * (1 - t) ** 0.7 },
          dims.headW * 0.6,
          res.bands(2),
        ),
        shape: section(shape, 0.8),
        colors: { side: palette.body, cap: palette.belly },
        tip: 'top',
      }),
    }
  }

  if (type === 'long') {
    return {
      name: 'ear',
      geometry: prism({
        sides: res.sides(5),
        sections: sample(
          {
            rx: (t) => width * (0.9 - 0.55 * t),
            rz: (t) => width * 0.4 * (1 - 0.4 * t),
            dz: (t) => dims.headW * 0.32 * t * t,
          },
          dims.headW * 1.5,
          res.bands(3),
        ),
        shape: section(shape, 0.85),
        colors: { side: palette.body, belly: palette.belly, cap: palette.belly },
      }),
    }
  }

  // 'frill' — a sheet standing off the skull, not a flattened tube.
  const reach = dims.headW * 0.95
  return {
    name: 'ear',
    geometry: fan({
      origin: [0, 0],
      rim: scalloped(
        [
          [0, -reach * 0.28],
          [reach * 0.78, -reach * 0.34],
          [reach, reach * 0.18],
          [reach * 0.52, reach * 0.62],
          [0, reach * 0.66],
        ],
        [0, 0],
        0.8,
      ),
      color: palette.accent,
    }),
  }
}

// ─── limbs ──────────────────────────────────────────────────────────────────

/** A limb segment: thin at the far end, bulging where `bulk` puts the muscle. */
export function limb(
  { palette, res, shape, embed }: Forge,
  length: number,
  near: number,
  bulge: number,
  far: number,
): THREE.BufferGeometry {
  const peak = 0.3 + shape.bulk * 0.4
  const swell = bulge - Math.max(near, far)
  const profile: Profile = {
    rx: (t) => (far + (near - far) * t + swell * hump(t, peak)) * shape.wide,
    rz: (t) => (far + (near - far) * t + swell * hump(t, peak)) * shape.deep,
    yaw: (t) => hump(t, peak) * 0.22,
  }

  return hangDown(
    prism({
      sides: res.sides(5),
      sections: sample(profile, length, res.bands(2)),
      shape: section(shape, 1.12),
      colors: { side: palette.body },
    }),
    near * embed,
  )
}

export function foot({ dims, palette, res, shape }: Forge, height: number): THREE.BufferGeometry {
  const length = dims.legThick * 2.2

  return pointForward(
    prism({
      sides: res.sides(5),
      sections: sample(
        {
          rx: (t) => dims.legThick * shape.wide * (0.52 - 0.18 * t ** 1.6),
          rz: (t) => height * (0.5 - 0.24 * t ** 1.4),
          dz: (t) => -height * 0.2 * t,
        },
        length,
        res.bands(2),
      ),
      shape: section(shape, 0.8),
      colors: { side: palette.body, cap: palette.accent },
    }),
  )
}

export function hand({ palette, res, shape }: Forge, thickness: number): THREE.BufferGeometry {
  return hangDown(
    prism({
      sides: res.sides(5),
      sections: sample(
        { rx: taper(thickness * 0.5, thickness * 0.42), rz: taper(thickness * 0.58, thickness * 0.46) },
        thickness * 0.85,
        res.bands(1),
      ),
      shape: section(shape, 1.2),
      colors: { side: palette.accent },
    }),
  )
}

// ─── decoration ─────────────────────────────────────────────────────────────

/**
 * One element of a back ridge. Spines stay as cones, because a spine is a cone;
 * plates and sails are sheets standing in the creature's midline, because a
 * plate built as a prism is a slab and reads as one.
 */
export function ridgeElement(
  { dims, palette, res, shape }: Forge,
  type: CreatureSpec['back']['ridge'],
  along: number,
): THREE.BufferGeometry | null {
  if (type === 'none') return null
  const swell = Math.sin(Math.PI * along ** 0.85)

  if (type === 'spines') {
    const height = dims.torsoW * (0.22 + 0.44 * swell)
    return pointBackward(
      prism({
        sides: res.sides(4),
        sections: sample(
          { rx: (t) => dims.torsoW * 0.05 * (1 - t) ** 0.8, rz: (t) => dims.torsoW * 0.05 * (1 - t) ** 0.8 },
          height,
          res.bands(1),
        ),
        shape: section(shape, 1),
        colors: { side: palette.accent },
        tip: 'top',
      }),
    )
  }

  const tall = type === 'sail'
  const height = dims.torsoW * (tall ? 0.4 + 1.2 * swell : 0.24 + 0.58 * swell)
  const half = dims.spineLength * (tall ? 0.085 : 0.11)

  return sagittal(
    fan({
      origin: [0, 0],
      rim: scalloped(
        [
          [0, -half],
          [height * 0.62, -half * 0.72],
          [height, 0],
          [height * 0.62, half * 0.72],
          [0, half],
        ],
        [0, 0],
        0.86,
      ),
      color: palette.accent,
    }),
  )
}

/**
 * A folded wing: a leading-edge spar, a strut, and a scalloped membrane fanned
 * between them.
 *
 * Everything is built in local +X and mirrored by turning the whole wing around
 * rather than by negating a coordinate, so nothing ever reaches back across the
 * midline into the torso.
 */
export function wing({ dims, palette, res, shape }: Forge, type: CreatureSpec['wings']['type']): Placed[] {
  if (type === 'none') return []
  const span = dims.spineLength * (type === 'large' ? 1.15 : 0.74)

  const tip: Point = [span * 0.96, span * 0.5]
  const knuckles: Point[] = [
    tip,
    [span * 0.82, span * 0.02],
    [span * 0.54, -span * 0.3],
    [span * 0.26, -span * 0.44],
    [span * 0.03, -span * 0.14],
  ]
  const origin: Point = [span * 0.05, span * 0.24]

  const bone = (to: Point, thickness: number, name: string): Placed => {
    const length = Math.hypot(to[0], to[1])
    return {
      name,
      geometry: prism({
        sides: res.sides(4),
        sections: sample(
          { rx: (t) => thickness * (1 - 0.6 * t), rz: (t) => thickness * (1 - 0.6 * t) },
          length,
          res.bands(1),
        ),
        shape: section(shape, 1),
        colors: { side: palette.accent },
        tip: 'top',
      }),
      rotation: { x: 0, y: 0, z: Math.atan2(-to[0], to[1]) },
    }
  }

  return [
    {
      name: 'membrane',
      geometry: fan({ origin, rim: scalloped(knuckles, origin, 0.78), color: palette.belly }),
    },
    bone(tip, dims.torsoW * 0.05, 'wingSpar'),
    bone(knuckles[2]!, dims.torsoW * 0.035, 'wingStrut'),
  ]
}

// ─── tail ───────────────────────────────────────────────────────────────────

export function tailSegment(
  { palette, res, shape }: Forge,
  length: number,
  from: number,
  to: number,
  tip: boolean,
): THREE.BufferGeometry {
  return pointBackward(
    prism({
      sides: res.sides(5),
      sections: sample(
        {
          rx: taper(from * shape.wide, tip ? 0 : to * shape.wide),
          rz: taper(from * shape.deep, tip ? 0 : to * shape.deep),
          yaw: (t) => t * 0.25,
        },
        length,
        res.bands(2),
      ),
      shape: section(shape, 1.1),
      colors: { side: palette.body, belly: palette.belly, cap: palette.body },
      ...(tip ? { tip: 'top' as const } : {}),
    }),
  )
}

/** The business end of a club or fan tail. */
export function tailTip(
  { palette, res, shape }: Forge,
  type: CreatureSpec['tail']['type'],
  radius: number,
): THREE.BufferGeometry | null {
  if (type === 'club') {
    return pointBackward(
      prism({
        sides: res.sides(6),
        sections: sample(
          {
            rx: (t) => radius * (0.8 + 1.6 * Math.sin(Math.PI * t)) * shape.wide,
            rz: (t) => radius * (0.8 + 1.6 * Math.sin(Math.PI * t)) * shape.deep,
          },
          radius * 3.4,
          res.bands(3),
        ),
        shape: section(shape, 1),
        colors: { side: palette.accent, cap: palette.accent },
      }),
    )
  }

  if (type === 'fan') {
    const reach = radius * 5
    return horizontal(
      fan({
        origin: [0, 0],
        rim: scalloped(
          [
            [-reach * 0.7, 0],
            [-reach * 0.78, reach * 0.62],
            [0, reach * 0.95],
            [reach * 0.78, reach * 0.62],
            [reach * 0.7, 0],
          ],
          [0, 0],
          0.84,
        ),
        color: palette.accent,
      }),
    )
  }

  return null
}

// ─── sheet helpers ──────────────────────────────────────────────────────────

/** Pulls a midpoint between each pair of rim points inward, scalloping the edge. */
function scalloped(points: readonly Point[], origin: Point, pull: number): Point[] {
  const out: Point[] = []
  for (let i = 0; i < points.length; i++) {
    const current = points[i]!
    out.push(current)
    const next = points[i + 1]
    if (!next) continue
    const midX = (current[0] + next[0]) / 2
    const midY = (current[1] + next[1]) / 2
    out.push([origin[0] + (midX - origin[0]) * pull, origin[1] + (midY - origin[1]) * pull])
  }
  return out
}

/** Stands a sheet in the creature's midline: its width becomes height above the back. */
function sagittal(geometry: THREE.BufferGeometry): THREE.BufferGeometry {
  geometry.rotateY(Math.PI / 2)
  return geometry
}

/** Lays a sheet flat and trailing backward: a tail fan. */
function horizontal(geometry: THREE.BufferGeometry): THREE.BufferGeometry {
  geometry.rotateX(-Math.PI / 2)
  return geometry
}

// ─── armature ───────────────────────────────────────────────────────────────

/** A strut running from one joint to the next. Built along +Y, swung into place. */
export function strut({ palette, res, shape }: Forge, length: number, thickness: number): THREE.BufferGeometry {
  return prism({
    sides: res.sides(4),
    sections: sample(
      { rx: (t) => thickness * (1 - 0.25 * Math.sin(Math.PI * t)), rz: (t) => thickness * (1 - 0.25 * Math.sin(Math.PI * t)) },
      length,
      res.bands(1),
    ),
    shape: section(shape, 1),
    colors: { side: palette.body, cap: palette.body },
  })
}

/** The knuckle at a joint, centred on it. */
export function knuckle({ palette, res, shape }: Forge, radius: number, accent = false): THREE.BufferGeometry {
  const geometry = prism({
    sides: res.sides(5),
    sections: sample(
      { rx: (t) => radius * (0.35 + 0.95 * Math.sin(Math.PI * t)), rz: (t) => radius * (0.35 + 0.95 * Math.sin(Math.PI * t)) },
      radius * 2,
      res.bands(2),
    ),
    shape: section(shape, 1),
    colors: { side: accent ? palette.accent : palette.belly, cap: accent ? palette.accent : palette.belly },
  })
  geometry.translate(0, -radius, 0)
  return geometry
}
