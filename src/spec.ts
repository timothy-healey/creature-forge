/**
 * The creature as plain data. Single source of truth for everything downstream:
 * `generate` reads it to build geometry, `ui` writes to it, and because it is
 * plain and serialisable, exporting or sharing a creature later costs nothing.
 *
 * Every slider is normalised 0..1. Mapping those to world units is `generate`'s
 * job, not the spec's — so a slider range never has to agree with a model scale.
 */

export type HeadType = 'snout' | 'beak' | 'blunt'
export type LegType = 'digitigrade' | 'plantigrade'
export type TailType = 'none' | 'stub' | 'long'
export type HornCount = 0 | 1 | 2

export const HEAD_TYPES: readonly HeadType[] = ['snout', 'beak', 'blunt']
export const LEG_TYPES: readonly LegType[] = ['digitigrade', 'plantigrade']
export const TAIL_TYPES: readonly TailType[] = ['none', 'stub', 'long']
export const HORN_COUNTS: readonly HornCount[] = [0, 1, 2]

export interface CreatureSpec {
  head: { type: HeadType; length: number; width: number; horns: HornCount }
  torso: { height: number; width: number; depth: number }
  arms: { length: number; thickness: number }
  legs: { type: LegType; length: number; thickness: number }
  tail: { type: TailType }
  colors: { body: string; belly: string; accent: string; eye: string }
}

export type SliderPath =
  | 'head.length'
  | 'head.width'
  | 'torso.height'
  | 'torso.width'
  | 'torso.depth'
  | 'arms.length'
  | 'arms.thickness'
  | 'legs.length'
  | 'legs.thickness'

export interface SliderDef {
  path: SliderPath
  label: string
  group: string
}

/** Drives both clamping and the control panel, so the two can never disagree. */
export const SLIDERS: readonly SliderDef[] = [
  { path: 'head.length', label: 'Length', group: 'Head' },
  { path: 'head.width', label: 'Width', group: 'Head' },
  { path: 'torso.height', label: 'Height', group: 'Torso' },
  { path: 'torso.width', label: 'Width', group: 'Torso' },
  { path: 'torso.depth', label: 'Depth', group: 'Torso' },
  { path: 'arms.length', label: 'Length', group: 'Arms' },
  { path: 'arms.thickness', label: 'Thickness', group: 'Arms' },
  { path: 'legs.length', label: 'Length', group: 'Legs' },
  { path: 'legs.thickness', label: 'Thickness', group: 'Legs' },
]

export const COLOR_KEYS = ['body', 'belly', 'accent', 'eye'] as const
export type ColorKey = (typeof COLOR_KEYS)[number]

export const COLOR_LABELS: Record<ColorKey, string> = {
  body: 'Body',
  belly: 'Belly',
  accent: 'Horns & claws',
  eye: 'Eyes',
}

export function defaultSpec(): CreatureSpec {
  return {
    head: { type: 'snout', length: 0.5, width: 0.5, horns: 1 },
    torso: { height: 0.5, width: 0.5, depth: 0.45 },
    arms: { length: 0.5, thickness: 0.45 },
    legs: { type: 'digitigrade', length: 0.5, thickness: 0.5 },
    tail: { type: 'long' },
    colors: { body: '#7b4fbf', belly: '#e8c45a', accent: '#e07a2f', eye: '#1a1420' },
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

  out.head.type = oneOf(HEAD_TYPES, spec.head?.type, fallback.head.type)
  out.head.horns = oneOf(HORN_COUNTS, spec.head?.horns, fallback.head.horns)
  out.legs.type = oneOf(LEG_TYPES, spec.legs?.type, fallback.legs.type)
  out.tail.type = oneOf(TAIL_TYPES, spec.tail?.type, fallback.tail.type)

  for (const slider of SLIDERS) {
    writeSlider(out, slider.path, unitOr(readSlider(spec, slider.path), readSlider(fallback, slider.path)))
  }

  for (const key of COLOR_KEYS) {
    const value = spec.colors?.[key]
    out.colors[key] = typeof value === 'string' && HEX.test(value) ? value : fallback.colors[key]
  }

  return out
}

const PALETTES: readonly CreatureSpec['colors'][] = [
  { body: '#7b4fbf', belly: '#e8c45a', accent: '#e07a2f', eye: '#1a1420' },
  { body: '#d9622b', belly: '#f0d9a8', accent: '#6b4a2f', eye: '#241a12' },
  { body: '#3f8f6a', belly: '#cfe3a8', accent: '#e8d24a', eye: '#10201a' },
  { body: '#4a6fd0', belly: '#b8d4f0', accent: '#f0f0f0', eye: '#101828' },
  { body: '#c23f5e', belly: '#f2c0a8', accent: '#2f2434', eye: '#1c1018' },
  { body: '#8a8f99', belly: '#d8dce2', accent: '#f08a3c', eye: '#14181e' },
  { body: '#6f3f8f', belly: '#9fd9c0', accent: '#e8e05a', eye: '#1a1024' },
  { body: '#2f6f7f', belly: '#e0c8a0', accent: '#d94f3f', eye: '#0e1a1e' },
]

/**
 * Rolls a whole creature. Takes its randomness as an argument rather than
 * reaching for `Math.random`, so a roll can be replayed exactly.
 *
 * Sliders are biased toward their middle by averaging two rolls: a creature
 * with every proportion at an extreme is a mess, and the interesting shapes
 * live in the broad middle with one or two features pushed out.
 */
export function randomSpec(random: () => number = Math.random): CreatureSpec {
  const pick = <T>(options: readonly T[]): T => options[Math.floor(random() * options.length)] ?? options[0]!
  const biased = () => (random() + random()) / 2

  const spec: CreatureSpec = {
    head: { type: pick(HEAD_TYPES), length: biased(), width: biased(), horns: pick(HORN_COUNTS) },
    torso: { height: biased(), width: biased(), depth: biased() },
    arms: { length: biased(), thickness: biased() },
    legs: { type: pick(LEG_TYPES), length: biased(), thickness: biased() },
    tail: { type: pick(TAIL_TYPES) },
    colors: { ...pick(PALETTES) },
  }

  // One feature pushed to an extreme is what makes a roll memorable.
  const exaggerated = pick(SLIDERS)
  writeSlider(spec, exaggerated.path, random() < 0.5 ? random() * 0.18 : 0.82 + random() * 0.18)

  return spec
}
