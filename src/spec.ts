import { PATTERNS, type Pattern } from './pattern'

/**
 * The creature as plain data. Single source of truth for everything downstream:
 * `generate` reads it to build geometry, `ui` writes to it, and because it is
 * plain and serialisable, exporting or sharing a creature later costs nothing.
 *
 * Every slider is normalised 0..1. Mapping those to world units is `generate`'s
 * job, not the spec's — so a slider range never has to agree with a model scale.
 *
 * The spec separates two kinds of variation. Sliders change a creature's
 * measurements; the enums below change its *plan* — how many limbs reach the
 * ground, which way the spine runs, what grows out of its back. Measurements
 * alone only ever produce bigger and smaller versions of one animal.
 */

export type Build = 'upright' | 'hunched' | 'quadruped'
/**
 * How the creature is put together. `jointed` is a stack of rigid parts that
 * pivot at visible seams; `skinned` is one continuous mesh bound to a skeleton,
 * which is how Spyro was actually built and why it reads as a single creature.
 */
export type MeshMode = 'jointed' | 'skinned'
/**
 * A structural mutation. Each one changes how a creature is *put together* —
 * its symmetry, its topology, what its surface even is — rather than bolting
 * another part onto the same plan.
 */
export type Mutation =
  | 'none'
  | 'radial'
  | 'shattered'
  | 'melted'
  | 'strut'
  | 'segmented'
  | 'voxel'
  | 'twisted'
  | 'exploded'
  | 'recursive'
  | 'asymmetric'
  | 'inverted'
  | 'inflated'
  | 'lattice'
  | 'flattened'
  | 'coiled'
  | 'swarm'
  | 'plated'
export type FrontLimb = 'arms' | 'forelegs' | 'none'
export type HeadType = 'none' | 'snout' | 'beak' | 'blunt' | 'crest'
export type LegType = 'digitigrade' | 'plantigrade' | 'none'
export type TailType = 'none' | 'stub' | 'long' | 'club' | 'fan'
export type RidgeType = 'none' | 'spines' | 'plates' | 'sail'
export type EarType = 'none' | 'pointed' | 'long' | 'frill'
export type WingType = 'none' | 'small' | 'large'
export type HornCount = 0 | 1 | 2
export type EyeCount = 0 | 2 | 4 | 6
export type SegmentCount = 2 | 3 | 4 | 5
export type PairCount = 1 | 2 | 3 | 4
export type SegmentsPerLimb = 2 | 3 | 4 | 5

export const BUILDS: readonly Build[] = ['upright', 'hunched', 'quadruped']
export const MESH_MODES: readonly MeshMode[] = ['jointed', 'skinned']
/**
 * The mutations, in families. A mutation either changes the body's plan, or
 * replaces what its surface is made of, or deforms the surface it already has —
 * and which of the three it is tells you more than its name does.
 */
export const MUTATION_GROUPS: readonly { title: string; items: readonly Mutation[] }[] = [
  { title: 'Plan', items: ['none', 'radial', 'segmented', 'coiled', 'recursive'] },
  { title: 'Surface', items: ['strut', 'lattice', 'voxel', 'swarm', 'plated', 'shattered'] },
  {
    title: 'Deform',
    items: ['melted', 'inflated', 'twisted', 'flattened', 'exploded', 'asymmetric', 'inverted'],
  },
]

export const MUTATIONS: readonly Mutation[] = [
  'none',
  'radial',
  'shattered',
  'melted',
  'strut',
  'segmented',
  'voxel',
  'twisted',
  'exploded',
  'recursive',
  'asymmetric',
  'inverted',
  'inflated',
  'lattice',
  'flattened',
  'coiled',
  'swarm',
  'plated',
]
export const FRONT_LIMBS: readonly FrontLimb[] = ['arms', 'forelegs', 'none']
export const HEAD_TYPES: readonly HeadType[] = ['none', 'snout', 'beak', 'blunt', 'crest']
export const LEG_TYPES: readonly LegType[] = ['digitigrade', 'plantigrade', 'none']
export const TAIL_TYPES: readonly TailType[] = ['none', 'stub', 'long', 'club', 'fan']
export const RIDGE_TYPES: readonly RidgeType[] = ['none', 'spines', 'plates', 'sail']
export const EAR_TYPES: readonly EarType[] = ['none', 'pointed', 'long', 'frill']
export const WING_TYPES: readonly WingType[] = ['none', 'small', 'large']
export const HORN_COUNTS: readonly HornCount[] = [0, 1, 2]
export const EYE_COUNTS: readonly EyeCount[] = [0, 2, 4, 6]
export const SEGMENT_COUNTS: readonly SegmentCount[] = [2, 3, 4, 5]
export const PAIR_COUNTS: readonly PairCount[] = [1, 2, 3, 4]
export const LIMB_SEGMENTS: readonly SegmentsPerLimb[] = [2, 3, 4, 5]

export interface CreatureSpec {
  body: { build: Build; frontLimb: FrontLimb; mesh: MeshMode; mutation: Mutation }
  /** Markings, painted from the creature's own geometry rather than a texture. */
  skin: { pattern: Pattern; scale: number; strength: number }
  /** How finely the same shape is described. Slides a creature between eras. */
  detail: { level: number }
  /**
   * Three genes that reshape every part at once, rather than resizing it. They
   * are what stop two creatures with different numbers being the same animal.
   */
  shape: { edge: number; section: number; bulk: number }
  head: { type: HeadType; length: number; width: number; horns: HornCount; eyes: EyeCount; ears: EarType }
  neck: { length: number }
  /**
   * The line the body runs along. Spore's spine is a curve the player bends;
   * ours is the same idea as two numbers, and the builds become presets of the
   * pitch rather than three hardcoded constants.
   */
  spine: { arch: number; sway: number }
  torso: { height: number; width: number; depth: number; segments: SegmentCount }
  arms: { length: number; thickness: number }
  /**
   * How many pairs of limbs, and where along the body they sit. Spore lets you
   * drop a limb anywhere; this is the same idea with the pairs spread evenly
   * between the hindmost and foremost attachment.
   */
  limbs: { pairs: PairCount; segments: SegmentsPerLimb; back: number; front: number }
  legs: { type: LegType; length: number; thickness: number }
  tail: { type: TailType; length: number }
  back: { ridge: RidgeType }
  wings: { type: WingType }
  colors: { body: string; belly: string; accent: string; pattern: string; eye: string }
}

export type SliderPath =
  | 'detail.level'
  | 'shape.edge'
  | 'shape.section'
  | 'shape.bulk'
  | 'skin.scale'
  | 'skin.strength'
  | 'head.length'
  | 'head.width'
  | 'neck.length'
  | 'tail.length'
  | 'spine.arch'
  | 'spine.sway'
  | 'torso.height'
  | 'torso.width'
  | 'torso.depth'
  | 'arms.length'
  | 'arms.thickness'
  | 'limbs.back'
  | 'limbs.front'
  | 'legs.length'
  | 'legs.thickness'

export interface SliderDef {
  path: SliderPath
  label: string
  group: string
}

/** Drives both clamping and the control panel, so the two can never disagree. */
export const SLIDERS: readonly SliderDef[] = [
  { path: 'detail.level', label: 'Vertices', group: 'Detail' },
  { path: 'shape.edge', label: 'Soft → sharp', group: 'Shape' },
  { path: 'shape.section', label: 'Deep → wide', group: 'Shape' },
  { path: 'shape.bulk', label: 'Mass fore/aft', group: 'Shape' },
  { path: 'skin.scale', label: 'Size', group: 'Markings' },
  { path: 'skin.strength', label: 'Strength', group: 'Markings' },
  { path: 'head.length', label: 'Length', group: 'Head' },
  { path: 'head.width', label: 'Width', group: 'Head' },
  { path: 'neck.length', label: 'Length', group: 'Neck' },
  { path: 'tail.length', label: 'Tail', group: 'Tail' },
  { path: 'spine.arch', label: 'Sag → arch', group: 'Spine' },
  { path: 'spine.sway', label: 'Sway', group: 'Spine' },
  { path: 'torso.height', label: 'Height', group: 'Torso' },
  { path: 'torso.width', label: 'Width', group: 'Torso' },
  { path: 'torso.depth', label: 'Depth', group: 'Torso' },
  { path: 'arms.length', label: 'Length', group: 'Arms' },
  { path: 'arms.thickness', label: 'Thickness', group: 'Arms' },
  { path: 'limbs.back', label: 'Hindmost at', group: 'Limbs' },
  { path: 'limbs.front', label: 'Foremost at', group: 'Limbs' },
  { path: 'legs.length', label: 'Length', group: 'Legs' },
  { path: 'legs.thickness', label: 'Thickness', group: 'Legs' },
]

export const COLOR_KEYS = ['body', 'belly', 'accent', 'pattern', 'eye'] as const
export type ColorKey = (typeof COLOR_KEYS)[number]

export const COLOR_LABELS: Record<ColorKey, string> = {
  body: 'Body',
  belly: 'Belly',
  accent: 'Horns & claws',
  pattern: 'Markings',
  eye: 'Eyes',
}

export function defaultSpec(): CreatureSpec {
  return {
    body: { build: 'upright', frontLimb: 'arms', mesh: 'jointed', mutation: 'none' },
    detail: { level: 0.3 },
    shape: { edge: 0.55, section: 0.45, bulk: 0.5 },
    skin: { pattern: 'none', scale: 0.4, strength: 0.85 },
    head: { type: 'snout', length: 0.5, width: 0.5, horns: 1, eyes: 2, ears: 'none' },
    neck: { length: 0.3 },
    spine: { arch: 0.5, sway: 0.5 },
    torso: { height: 0.5, width: 0.5, depth: 0.45, segments: 3 },
    arms: { length: 0.5, thickness: 0.45 },
    limbs: { pairs: 2, segments: 2, back: 0.04, front: 0.82 },
    legs: { type: 'digitigrade', length: 0.5, thickness: 0.5 },
    tail: { type: 'long', length: 0.5 },
    back: { ridge: 'none' },
    wings: { type: 'none' },
    colors: { body: '#7b4fbf', belly: '#e8c45a', accent: '#e07a2f', pattern: '#2e1a4a', eye: '#1a1420' },
  }
}

type SliderGroup = Record<string, number>

export function readSlider(spec: CreatureSpec, path: SliderPath): number {
  const [group, key] = path.split('.') as [keyof CreatureSpec, string]
  const value = (spec[group] as unknown as SliderGroup)[key]
  return typeof value === 'number' ? value : NaN
}

export function writeSlider(spec: CreatureSpec, path: SliderPath, value: number): void {
  const [group, key] = path.split('.') as [keyof CreatureSpec, string]
  ;(spec[group] as unknown as SliderGroup)[key] = value
}

const HEX = /^#[0-9a-f]{6}$/i

function oneOf<T>(allowed: readonly T[], value: unknown, fallback: T): T {
  return allowed.includes(value as T) ? (value as T) : fallback
}

function unitOr(value: number, fallback: number): number {
  if (!Number.isFinite(value)) return fallback
  return Math.min(1, Math.max(0, value))
}

/**
 * Returns a valid spec no matter what it is handed. Geometry is built from the
 * result, so this is the only place that has to think about NaN or a nonsense
 * enum — `generate` can then assume its input is sane.
 */
export function clampSpec(spec: CreatureSpec): CreatureSpec {
  const fallback = defaultSpec()
  const out = defaultSpec()

  out.body.build = oneOf(BUILDS, spec.body?.build, fallback.body.build)
  out.body.frontLimb = oneOf(FRONT_LIMBS, spec.body?.frontLimb, fallback.body.frontLimb)
  out.body.mesh = oneOf(MESH_MODES, spec.body?.mesh, fallback.body.mesh)
  out.body.mutation = oneOf(MUTATIONS, spec.body?.mutation, fallback.body.mutation)
  out.head.type = oneOf(HEAD_TYPES, spec.head?.type, fallback.head.type)
  out.head.horns = oneOf(HORN_COUNTS, spec.head?.horns, fallback.head.horns)
  out.head.eyes = oneOf(EYE_COUNTS, spec.head?.eyes, fallback.head.eyes)
  out.head.ears = oneOf(EAR_TYPES, spec.head?.ears, fallback.head.ears)
  out.torso.segments = oneOf(SEGMENT_COUNTS, spec.torso?.segments, fallback.torso.segments)
  out.limbs.pairs = oneOf(PAIR_COUNTS, spec.limbs?.pairs, fallback.limbs.pairs)
  out.limbs.segments = oneOf(LIMB_SEGMENTS, spec.limbs?.segments, fallback.limbs.segments)
  out.legs.type = oneOf(LEG_TYPES, spec.legs?.type, fallback.legs.type)
  out.tail.type = oneOf(TAIL_TYPES, spec.tail?.type, fallback.tail.type)
  out.back.ridge = oneOf(RIDGE_TYPES, spec.back?.ridge, fallback.back.ridge)
  out.skin.pattern = oneOf(PATTERNS, spec.skin?.pattern, fallback.skin.pattern)
  out.wings.type = oneOf(WING_TYPES, spec.wings?.type, fallback.wings.type)

  for (const slider of SLIDERS) {
    writeSlider(out, slider.path, unitOr(readSlider(spec, slider.path), readSlider(fallback, slider.path)))
  }

  for (const key of COLOR_KEYS) {
    const value = spec.colors?.[key]
    out.colors[key] = typeof value === 'string' && HEX.test(value) ? value : fallback.colors[key]
  }

  return out
}

/**
 * Rolls a whole creature. Takes its randomness as an argument rather than
 * reaching for `Math.random`, so a roll can be replayed exactly.
 *
 * Sliders are biased toward their middle by averaging two rolls — a creature
 * with every proportion at an extreme is a mess — and then two of them are
 * pushed hard to an edge, because one exaggerated feature is what makes a roll
 * memorable while nine of them is noise.
 */
export function randomSpec(
  random: () => number = Math.random,
  detail = defaultSpec().detail.level,
  mesh: MeshMode = defaultSpec().body.mesh,
  mutation: Mutation = defaultSpec().body.mutation,
): CreatureSpec {
  const pick = <T>(options: readonly T[]): T => options[Math.floor(random() * options.length)] ?? options[0]!
  const biased = () => (random() + random()) / 2
  const spec_detail = Math.min(1, Math.max(0, detail))

  const spec: CreatureSpec = {
    // Mesh mode is a way of looking at a creature, not part of its identity,
    // so a roll keeps whatever is selected — like detail.
    body: { build: pick(BUILDS), frontLimb: pick(FRONT_LIMBS), mesh, mutation },
    detail: { level: spec_detail },
    // Rolled flat, not biased: the shape genes are the anti-sameness axis, and
    // their whole value is in the extremes a biased roll would never reach.
    shape: { edge: random(), section: random(), bulk: random() },
    skin: { pattern: pick(PATTERNS), scale: 0.2 + random() * 0.6, strength: 0.6 + random() * 0.4 },
    head: {
      type: pick(HEAD_TYPES),
      length: biased(),
      width: biased(),
      horns: pick(HORN_COUNTS),
      eyes: pick(EYE_COUNTS),
      ears: pick(EAR_TYPES),
    },
    neck: { length: biased() },
    spine: { arch: biased(), sway: biased() },
    torso: { height: biased(), width: biased(), depth: biased(), segments: pick(SEGMENT_COUNTS) },
    arms: { length: biased(), thickness: biased() },
    limbs: {
      pairs: pick(PAIR_COUNTS),
      segments: pick(LIMB_SEGMENTS),
      back: random() * 0.3,
      front: 0.55 + random() * 0.45,
    },
    legs: { type: pick(LEG_TYPES), length: biased(), thickness: biased() },
    tail: { type: pick(TAIL_TYPES), length: biased() },
    back: { ridge: pick(RIDGE_TYPES) },
    wings: { type: pick(WING_TYPES) },
    colors: rollPalette(random),
  }

  const proportions = SLIDERS.filter(
    (slider) => slider.group !== 'Detail' && slider.group !== 'Shape',
  )
  for (let i = 0; i < 2; i++) {
    const exaggerated = pick(proportions)
    writeSlider(spec, exaggerated.path, random() < 0.5 ? random() * 0.16 : 0.84 + random() * 0.16)
  }

  return spec
}

/**
 * Builds a palette rather than picking one, so no two rolls repeat.
 *
 * Two rules do the work. The belly is lighter than the body, which is how real
 * animals are countershaded and reads as "creature" rather than "object". The
 * accent sits across the wheel from the body, so horns and claws separate from
 * the hide instead of blending into it.
 */
function rollPalette(random: () => number): CreatureSpec['colors'] {
  const hue = random() * 360
  const saturation = 0.42 + random() * 0.38
  const lightness = 0.34 + random() * 0.2

  return {
    body: hslToHex(hue, saturation, lightness),
    belly: hslToHex(
      wrapHue(hue + (random() * 50 - 25)),
      saturation * (0.4 + random() * 0.25),
      Math.min(0.9, lightness + 0.26 + random() * 0.1),
    ),
    accent: hslToHex(wrapHue(hue + 150 + random() * 60), 0.6 + random() * 0.3, 0.46 + random() * 0.16),
    // Markings read as the same animal's, so they stay near the body's hue and
    // step away in lightness rather than colour.
    pattern: hslToHex(
      wrapHue(hue + (random() * 40 - 20)),
      saturation * (0.6 + random() * 0.5),
      random() < 0.5 ? Math.max(0.08, lightness - 0.2) : Math.min(0.92, lightness + 0.3),
    ),
    eye: hslToHex(wrapHue(hue + 180), 0.3 + random() * 0.3, lightness * 0.28),
  }
}

const wrapHue = (hue: number) => ((hue % 360) + 360) % 360

function hslToHex(hue: number, saturation: number, lightness: number): string {
  const chroma = saturation * Math.min(lightness, 1 - lightness)
  const channel = (offset: number): string => {
    const k = (offset + hue / 30) % 12
    const value = lightness - chroma * Math.max(-1, Math.min(k - 3, 9 - k, 1))
    return Math.round(255 * value)
      .toString(16)
      .padStart(2, '0')
  }
  return `#${channel(0)}${channel(8)}${channel(4)}`
}

export { PATTERNS, type Pattern }

/**
 * A short stable name for a creature, derived from the whole spec.
 *
 * Two creatures that look the same get the same ident and a single changed
 * slider gets a different one, so it is a real identity rather than a decorative
 * code — and it is what a share link will carry when there is one.
 */
export function identOf(spec: CreatureSpec): string {
  const text = JSON.stringify(clampSpec(spec))
  let a = 0x811c9dc5
  let b = 0x01000193
  for (let i = 0; i < text.length; i++) {
    a = Math.imul(a ^ text.charCodeAt(i), 0x01000193)
    b = Math.imul(b + text.charCodeAt(i), 0x85ebca6b) ^ (b >>> 13)
  }
  const block = (value: number) => (value >>> 0).toString(36).toUpperCase().padStart(7, '0').slice(-4)
  return `${block(a)}-${block(b)}-${block(a ^ b)}`
}
