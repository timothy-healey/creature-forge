import * as THREE from 'three'
import {
  hangDown,
  pointBackward,
  pointForward,
  prism,
  sample,
  type Profile,
  type Resolution,
} from './geometry'
import type { CreatureSpec } from './spec'

/**
 * Every body part, as a profile rather than a fixed mesh.
 *
 * A builder here says what shape a part is — how wide it is at each point along
 * its length — and the resolution decides how many vertices describe that shape.
 * Nothing in this file knows how many sides it will end up with.
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

/** A geometry with somewhere to sit. The generator parents these to joints. */
export interface Placed {
  name: string
  geometry: THREE.BufferGeometry
  position?: THREE.Vector3Like
  rotation?: THREE.Vector3Like
}

const taper = (from: number, to: number) => (t: number) => from + (to - from) * t

// ─── body ───────────────────────────────────────────────────────────────────

/**
 * The torso. `segments` ripples the profile rather than adding rings, so a
 * five-segment creature reads as segmented at any resolution.
 */
export function torsoProfile(dims: Dims, segments: number): Profile {
  const ripple = (t: number) => 1 + 0.09 * Math.sin(t * Math.PI * segments * 2)
  const bulge = (t: number) => (0.74 + 0.26 * Math.sin(Math.PI * t ** 0.85)) * ripple(t)

  return {
    rx: (t) => dims.torsoW * 0.5 * bulge(t),
    rz: (t) => dims.torsoD * 0.5 * bulge(t),
    yaw: (t) => Math.sin(t * Math.PI * 2) * 0.07,
  }
}

export function torso(dims: Dims, palette: Palette, res: Resolution, segments: number): Placed {
  const profile = torsoProfile(dims, segments)

  return {
    name: 'torso',
    geometry: prism({
      sides: res.sides(6),
      sections: sample(profile, dims.spineLength, res.bands(Math.max(3, segments * 1.4))),
      colors: { side: palette.body, belly: palette.belly, cap: palette.belly },
      bellyWidth: 0.95,
    }),
  }
}

/** The neck, with a gentle S-curve that only shows on a long one. */
export function neck(dims: Dims, palette: Palette, res: Resolution): Placed {
  const profile: Profile = {
    rx: taper(dims.torsoW * 0.22, dims.torsoW * 0.17),
    rz: taper(dims.torsoD * 0.23, dims.torsoD * 0.19),
    dz: (t) => dims.neckLen * 0.18 * Math.sin(t * Math.PI),
  }

  return {
    name: 'neck',
    geometry: prism({
      sides: res.sides(5),
      sections: sample(profile, dims.neckLen, res.bands(2)),
      colors: { side: palette.body, belly: palette.belly },
    }),
  }
}

// ─── head ───────────────────────────────────────────────────────────────────

export function skull(dims: Dims, palette: Palette, res: Resolution): Placed {
  const bulge = (t: number) => 0.74 + 0.26 * Math.sin(Math.PI * t ** 0.9)

  const profile: Profile = {
    rx: (t) => dims.headW * 0.5 * bulge(t),
    rz: (t) => dims.headD * 0.5 * bulge(t),
    dz: (t) => dims.headD * 0.06 * Math.sin(Math.PI * t) - dims.headD * 0.03 * t,
  }

  return {
    name: 'skull',
    geometry: prism({
      sides: res.sides(6),
      sections: sample(profile, dims.headH, res.bands(2)),
      colors: { side: palette.body, belly: palette.belly, cap: palette.body },
      bellyWidth: 0.6,
    }),
  }
}

export function face(dims: Dims, palette: Palette, res: Resolution, type: CreatureSpec['head']['type']): Placed[] {
  const front = dims.headD * 0.34

  if (type === 'snout') {
    const profile: Profile = {
      rx: (t) => dims.headW * (0.34 - 0.14 * t),
      rz: (t) => dims.headH * (0.28 - 0.13 * t),
      dz: (t) => dims.headH * 0.08 * t * t,
    }
    return [
      {
        name: 'snout',
        geometry: pointForward(
          prism({
            sides: res.sides(5),
            sections: sample(profile, dims.headLen, res.bands(2)),
            colors: { side: palette.body, belly: palette.belly, cap: palette.belly },
          }),
        ),
        position: { x: 0, y: dims.headH * 0.38, z: front },
      },
    ]
  }

  if (type === 'beak') {
    const profile: Profile = {
      rx: (t) => dims.headW * 0.27 * (1 - t) ** 1.3,
      rz: (t) => dims.headH * 0.23 * (1 - t) ** 1.2,
      dz: (t) => dims.headH * 0.17 * t ** 1.4,
    }
    return [
      {
        name: 'beak',
        geometry: pointForward(
          prism({
            sides: res.sides(4),
            sections: sample(profile, dims.headLen * 1.3, res.bands(2)),
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
            rx: (t) => dims.headW * (0.42 - 0.06 * t),
            rz: (t) => dims.headH * (0.32 - 0.07 * t),
            dz: (t) => dims.headH * 0.05 * t,
          },
          dims.headLen * 0.55,
          res.bands(2),
        ),
        colors: { side: palette.body, belly: palette.belly, cap: palette.belly },
      }),
    ),
    position: { x: 0, y: dims.headH * 0.32, z: front },
  }

  if (type === 'blunt') return [muzzle]

  // 'crest' — a blunt face under a swept plate, the parasaurolophus silhouette.
  const crest: Placed = {
    name: 'crest',
    geometry: pointBackward(
      prism({
        sides: res.sides(4),
        sections: sample(
          {
            rx: (t) => dims.headW * 0.07 * (1 - t * 0.6),
            rz: (t) => dims.headH * (0.34 + 0.3 * Math.sin(Math.PI * t)) * (1 - t * 0.35),
          },
          dims.headLen * 1.15,
          res.bands(3),
        ),
        colors: { side: palette.accent, cap: palette.accent },
      }),
    ),
    position: { x: 0, y: dims.headH * 0.9, z: -dims.headD * 0.1 },
    rotation: { x: -0.35, y: 0, z: 0 },
  }

  return [muzzle, crest]
}

export function eyes(dims: Dims, palette: Palette, res: Resolution): Placed[] {
  const size = Math.max(0.03, dims.headW * 0.11)

  return [-1, 1].map((side) => ({
    name: side < 0 ? 'eyeL' : 'eyeR',
    geometry: pointForward(
      prism({
        sides: res.sides(4),
        sections: sample({ rx: taper(size, size * 0.7), rz: taper(size * 0.72, size * 0.48) }, size * 0.9, 1),
        colors: { side: palette.eye },
      }),
    ),
    position: { x: side * dims.headW * 0.27, y: dims.headH * 0.6, z: dims.headD * 0.38 },
  }))
}

export function horns(dims: Dims, palette: Palette, res: Resolution, count: number): Placed[] {
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
      colors: { side: palette.accent },
      tip: 'top',
    }),
    position: { x, y: dims.headH * 0.88, z: -dims.headD * 0.06 },
    rotation: { x: -0.45, y: 0, z: -x * 1.6 },
  }))
}

/** Ear geometry, built pointing up — the generator swings it into place. */
export function ear(dims: Dims, palette: Palette, res: Resolution, type: CreatureSpec['head']['ears']): Placed | null {
  if (type === 'none') return null
  const width = dims.headW * 0.16

  if (type === 'pointed') {
    return {
      name: 'ear',
      geometry: prism({
        sides: res.sides(4),
        sections: sample(
          { rx: (t) => width * (1 - t) ** 0.7, rz: (t) => width * 0.5 * (1 - t) ** 0.7 },
          dims.headW * 0.58,
          res.bands(2),
        ),
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
            rz: (t) => width * 0.44 * (1 - 0.4 * t),
            dz: (t) => dims.headW * 0.3 * t * t,
          },
          dims.headW * 1.5,
          res.bands(3),
        ),
        colors: { side: palette.body, belly: palette.belly, cap: palette.belly },
      }),
    }
  }

  // 'frill' — a wide thin fan standing off the side of the skull.
  return {
    name: 'ear',
    geometry: prism({
      sides: res.sides(4),
      sections: sample(
        {
          rx: () => width * 0.22,
          rz: (t) => dims.headD * (0.3 + 0.55 * Math.sin(Math.PI * t ** 0.8)),
        },
        dims.headW * 0.8,
        res.bands(3),
      ),
      colors: { side: palette.accent, cap: palette.accent },
    }),
  }
}

// ─── limbs ──────────────────────────────────────────────────────────────────

/** A limb segment: thin at the far end, bulging mid-way, square at the joint. */
export function limb(
  palette: Palette,
  res: Resolution,
  length: number,
  near: number,
  bulge: number,
  far: number,
): THREE.BufferGeometry {
  const profile: Profile = {
    rx: (t) => far + (near - far) * t + (bulge - Math.max(near, far)) * Math.sin(Math.PI * t) * 0.9,
    rz: (t) => (far + (near - far) * t) * 0.96 + (bulge - Math.max(near, far)) * Math.sin(Math.PI * t) * 0.85,
    yaw: (t) => Math.sin(Math.PI * t) * 0.2,
  }

  return hangDown(
    prism({
      sides: res.sides(5),
      sections: sample(profile, length, res.bands(2)),
      colors: { side: palette.body },
    }),
  )
}

export function foot(dims: Dims, palette: Palette, res: Resolution, height: number): THREE.BufferGeometry {
  const length = dims.legThick * 2.2
  const profile: Profile = {
    rx: (t) => dims.legThick * (0.52 - 0.18 * t ** 1.6),
    rz: (t) => height * (0.5 - 0.24 * t ** 1.4),
    dz: (t) => -height * 0.2 * t,
  }

  return pointForward(
    prism({
      sides: res.sides(5),
      sections: sample(profile, length, res.bands(2)),
      colors: { side: palette.body, cap: palette.accent },
    }),
  )
}

export function hand(palette: Palette, res: Resolution, thickness: number): THREE.BufferGeometry {
  return hangDown(
    prism({
      sides: res.sides(5),
      sections: sample(
        { rx: taper(thickness * 0.5, thickness * 0.42), rz: taper(thickness * 0.56, thickness * 0.46) },
        thickness * 0.85,
        res.bands(1),
      ),
      colors: { side: palette.accent },
    }),
  )
}

// ─── decoration ─────────────────────────────────────────────────────────────

/**
 * One element of a back ridge, built pointing backward along the spine's -Z —
 * which is straight up on a quadruped and straight back on an upright creature.
 */
export function ridgeElement(
  dims: Dims,
  palette: Palette,
  res: Resolution,
  type: CreatureSpec['back']['ridge'],
  along: number,
): THREE.BufferGeometry | null {
  if (type === 'none') return null
  const swell = Math.sin(Math.PI * along ** 0.85)

  if (type === 'spines') {
    const height = dims.torsoW * (0.22 + 0.4 * swell)
    return pointBackward(
      prism({
        sides: res.sides(4),
        sections: sample(
          { rx: (t) => dims.torsoW * 0.05 * (1 - t) ** 0.8, rz: (t) => dims.torsoW * 0.05 * (1 - t) ** 0.8 },
          height,
          res.bands(1),
        ),
        colors: { side: palette.accent },
        tip: 'top',
      }),
    )
  }

  const tall = type === 'sail'
  const height = dims.torsoW * (tall ? 0.35 + 1.05 * swell : 0.2 + 0.5 * swell)
  const spread = dims.spineLength * (tall ? 0.09 : 0.12)

  return pointBackward(
    prism({
      sides: res.sides(4),
      sections: sample(
        {
          rx: (t) => dims.torsoW * 0.035 * (1 - 0.5 * t),
          rz: (t) => spread * (1 - 0.45 * t ** 1.5),
        },
        height,
        res.bands(2),
      ),
      colors: { side: palette.accent, cap: palette.accent },
    }),
  )
}

/** A folded wing: a spar swept up and back, with a membrane hanging off it. */
export function wing(
  dims: Dims,
  palette: Palette,
  res: Resolution,
  type: CreatureSpec['wings']['type'],
): Placed[] {
  if (type === 'none') return []
  const scale = type === 'large' ? 1.6 : 1
  const span = dims.spineLength * 0.72 * scale

  return [
    {
      name: 'spar',
      geometry: prism({
        sides: res.sides(4),
        sections: sample(
          { rx: (t) => dims.torsoW * 0.06 * (1 - t) ** 0.7, rz: (t) => dims.torsoW * 0.05 * (1 - t) ** 0.7 },
          span,
          res.bands(2),
        ),
        colors: { side: palette.accent },
        tip: 'top',
      }),
    },
    {
      name: 'membrane',
      geometry: prism({
        sides: res.sides(3),
        sections: sample(
          {
            rx: () => dims.torsoW * 0.025,
            rz: (t) => dims.torsoD * (0.3 + 0.75 * Math.sin(Math.PI * t ** 0.7)) * scale,
            dz: (t) => -dims.torsoD * 0.3 * t * scale,
          } satisfies Profile,
          span * 0.88,
          res.bands(3),
        ),
        colors: { side: palette.belly, cap: palette.belly },
      }),
      position: { x: dims.torsoW * 0.03, y: 0, z: 0 },
    },
  ]
}

// ─── tail ───────────────────────────────────────────────────────────────────

export function tailSegment(
  palette: Palette,
  res: Resolution,
  length: number,
  from: number,
  to: number,
  tip: boolean,
): THREE.BufferGeometry {
  return pointBackward(
    prism({
      sides: res.sides(5),
      sections: sample(
        { rx: taper(from, tip ? 0 : to), rz: taper(from, tip ? 0 : to), yaw: (t) => t * 0.25 },
        length,
        res.bands(2),
      ),
      colors: { side: palette.body, belly: palette.belly, cap: palette.body },
      ...(tip ? { tip: 'top' as const } : {}),
    }),
  )
}

/** The business end of a club or fan tail. */
export function tailTip(
  palette: Palette,
  res: Resolution,
  type: CreatureSpec['tail']['type'],
  radius: number,
): THREE.BufferGeometry | null {
  if (type === 'club') {
    return pointBackward(
      prism({
        sides: res.sides(6),
        sections: sample(
          {
            rx: (t) => radius * (0.8 + 1.5 * Math.sin(Math.PI * t)),
            rz: (t) => radius * (0.8 + 1.5 * Math.sin(Math.PI * t)),
          },
          radius * 3.4,
          res.bands(3),
        ),
        colors: { side: palette.accent, cap: palette.accent },
      }),
    )
  }

  if (type === 'fan') {
    return pointBackward(
      prism({
        sides: res.sides(4),
        sections: sample(
          {
            rx: (t) => radius * (0.6 + 2.6 * t ** 0.7),
            rz: (t) => radius * (0.7 - 0.45 * t),
          },
          radius * 3,
          res.bands(2),
        ),
        colors: { side: palette.accent, cap: palette.belly },
      }),
    )
  }

  return null
}
