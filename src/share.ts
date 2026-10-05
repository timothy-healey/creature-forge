import { LENSES } from './inspect'
import { BACKGROUNDS, RENDER_MODES, defaultView, type ViewSettings } from './render'
import {
  BUILDS,
  COLOR_KEYS,
  EAR_TYPES,
  EYE_COUNTS,
  FRONT_LIMBS,
  HEAD_TYPES,
  HORN_COUNTS,
  LEG_TYPES,
  LIMB_SEGMENTS,
  MESH_MODES,
  MUTATIONS,
  PAIR_COUNTS,
  PATTERNS,
  RIDGE_TYPES,
  SEGMENT_COUNTS,
  SLIDERS,
  TAIL_TYPES,
  WING_TYPES,
  clampSpec,
  defaultSpec,
  readSlider,
  writeSlider,
  type ColorKey,
  type CreatureSpec,
} from './spec'

/**
 * A creature as a line of text.
 *
 * Every value the sheet holds — what the creature is, and how it is being
 * looked at — packs into one bitstream and comes back out the same. That makes
 * a creature a thing you can send someone rather than a thing you can only
 * rebuild from memory, and it is what the address bar carries.
 *
 * The table below is generated from the same lists that build the controls, so
 * a field cannot exist in the panel and go missing from the code. The price is
 * that changing those lists changes the layout, which is what `VERSION` is for:
 * a code from an older shape of the app is refused rather than misread.
 */

export interface Share {
  spec: CreatureSpec
  view: ViewSettings
}

/**
 * Crockford's base32. No I, L, O or U, so nothing in a code collides with 1, 0
 * or an obscenity when somebody reads one off a screen or down a phone.
 */
const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ'
const BITS_PER_SYMBOL = 5

const VERSION = 1
const VERSION_BITS = 4

/** Enough to catch a mistyped character. Not a security device. */
const CHECK_BITS = 10
const CHECK_SYMBOLS = CHECK_BITS / BITS_PER_SYMBOL

/**
 * Sliders are stored in eight bits across this many steps. Two hundred is far
 * below what the eye resolves on a creature this size, and it puts 0.5 exactly
 * on a whole number, so the defaults survive a round trip unchanged.
 */
export const SLIDER_STEPS = 200
export const SLIDER_STEP = 1 / SLIDER_STEPS

// ─── the field table ────────────────────────────────────────────────────────

interface Field {
  bits: number
  get(share: Share): number
  set(share: Share, value: number): void
}

/** The narrowest number of bits that can name one of `count` options. */
function widthFor(count: number): number {
  let bits = 1
  while (1 << bits < count) bits++
  return bits
}

function choice<T>(
  options: readonly T[],
  get: (share: Share) => T,
  set: (share: Share, value: T) => void,
): Field {
  return {
    bits: widthFor(options.length),
    // An option that is no longer offered reads back as the first one rather
    // than as -1, which would encode as every bit set.
    get: (share) => Math.max(0, options.indexOf(get(share))),
    set: (share, value) => set(share, options[value] ?? options[0]!),
  }
}

function unit(get: (share: Share) => number, set: (share: Share, value: number) => void): Field {
  return {
    bits: 8,
    // Divided, never multiplied by the step: 164 * (1/200) is 0.8200000000000001,
    // and a value that cannot survive its own round trip is not a share code.
    get: (share) => Math.round(Math.min(1, Math.max(0, get(share))) * SLIDER_STEPS),
    set: (share, value) => set(share, Math.min(1, value / SLIDER_STEPS)),
  }
}

function colour(key: ColorKey): Field {
  return {
    bits: 24,
    get: (share) => Number.parseInt(share.spec.colors[key].slice(1), 16) || 0,
    set: (share, value) => {
      share.spec.colors[key] = `#${value.toString(16).padStart(6, '0')}`
    },
  }
}

const lenses: Field = {
  bits: LENSES.length,
  get: (share) =>
    LENSES.reduce((mask, lens, index) => (share.view.lenses.includes(lens) ? mask | (1 << index) : mask), 0),
  set: (share, value) => {
    share.view.lenses = LENSES.filter((_, index) => ((value >> index) & 1) === 1)
  },
}

const FIELDS: readonly Field[] = [
  choice(BUILDS, (s) => s.spec.body.build, (s, v) => void (s.spec.body.build = v)),
  choice(FRONT_LIMBS, (s) => s.spec.body.frontLimb, (s, v) => void (s.spec.body.frontLimb = v)),
  choice(MESH_MODES, (s) => s.spec.body.mesh, (s, v) => void (s.spec.body.mesh = v)),
  choice(MUTATIONS, (s) => s.spec.body.mutation, (s, v) => void (s.spec.body.mutation = v)),
  choice(PATTERNS, (s) => s.spec.skin.pattern, (s, v) => void (s.spec.skin.pattern = v)),
  choice(HEAD_TYPES, (s) => s.spec.head.type, (s, v) => void (s.spec.head.type = v)),
  choice(HORN_COUNTS, (s) => s.spec.head.horns, (s, v) => void (s.spec.head.horns = v)),
  choice(EYE_COUNTS, (s) => s.spec.head.eyes, (s, v) => void (s.spec.head.eyes = v)),
  choice(EAR_TYPES, (s) => s.spec.head.ears, (s, v) => void (s.spec.head.ears = v)),
  choice(SEGMENT_COUNTS, (s) => s.spec.torso.segments, (s, v) => void (s.spec.torso.segments = v)),
  choice(PAIR_COUNTS, (s) => s.spec.limbs.pairs, (s, v) => void (s.spec.limbs.pairs = v)),
  choice(LIMB_SEGMENTS, (s) => s.spec.limbs.segments, (s, v) => void (s.spec.limbs.segments = v)),
  choice(LEG_TYPES, (s) => s.spec.legs.type, (s, v) => void (s.spec.legs.type = v)),
  choice(TAIL_TYPES, (s) => s.spec.tail.type, (s, v) => void (s.spec.tail.type = v)),
  choice(RIDGE_TYPES, (s) => s.spec.back.ridge, (s, v) => void (s.spec.back.ridge = v)),
  choice(WING_TYPES, (s) => s.spec.wings.type, (s, v) => void (s.spec.wings.type = v)),

  ...SLIDERS.map((slider) =>
    unit(
      (s) => readSlider(s.spec, slider.path),
      (s, v) => writeSlider(s.spec, slider.path, v),
    ),
  ),
  ...COLOR_KEYS.map(colour),

  choice(RENDER_MODES, (s) => s.view.render, (s, v) => void (s.view.render = v)),
  choice(BACKGROUNDS, (s) => s.view.background, (s, v) => void (s.view.background = v)),
  lenses,
  unit((s) => s.view.outline, (s, v) => void (s.view.outline = v)),
  unit((s) => s.view.pixels, (s, v) => void (s.view.pixels = v)),
  unit((s) => s.view.wobble, (s, v) => void (s.view.wobble = v)),
]

const PAYLOAD_BITS = FIELDS.reduce((total, field) => total + field.bits, VERSION_BITS)
const PAYLOAD_SYMBOLS = Math.ceil(PAYLOAD_BITS / BITS_PER_SYMBOL)

// ─── the code ───────────────────────────────────────────────────────────────

export function encodeShare(share: Share): string {
  const tidy: Share = { spec: clampSpec(share.spec), view: { ...share.view, lenses: [...share.view.lenses] } }

  const bits: number[] = []
  const put = (value: number, width: number) => {
    const safe = Math.max(0, Math.min(2 ** width - 1, Math.round(value)))
    for (let bit = width - 1; bit >= 0; bit--) bits.push((safe >>> bit) & 1)
  }

  put(VERSION, VERSION_BITS)
  for (const field of FIELDS) put(field.get(tidy), field.bits)

  const symbols: number[] = []
  for (let at = 0; at < bits.length; at += BITS_PER_SYMBOL) {
    let symbol = 0
    for (let bit = 0; bit < BITS_PER_SYMBOL; bit++) symbol = (symbol << 1) | (bits[at + bit] ?? 0)
    symbols.push(symbol)
  }

  const check = checksum(symbols)
  for (let bit = CHECK_BITS - BITS_PER_SYMBOL; bit >= 0; bit -= BITS_PER_SYMBOL) {
    symbols.push((check >> bit) & (2 ** BITS_PER_SYMBOL - 1))
  }

  return symbols.map((symbol) => ALPHABET[symbol]!).join('')
}

/**
 * The creature a code describes, or the default one if it does not describe a
 * creature. A share link is something a person pastes, so every way it can
 * arrive damaged — truncated, retyped, from an older version of the app —
 * lands on a creature rather than on an error.
 */
export function decodeShare(code: string): Share {
  const share: Share = { spec: defaultSpec(), view: defaultView() }
  const symbols: number[] = []
  for (const character of code.trim().toUpperCase()) {
    const symbol = ALPHABET.indexOf(character)
    if (symbol < 0) return fallback()
    symbols.push(symbol)
  }

  if (symbols.length !== PAYLOAD_SYMBOLS + CHECK_SYMBOLS) return fallback()

  const payload = symbols.slice(0, PAYLOAD_SYMBOLS)
  let check = 0
  for (const symbol of symbols.slice(PAYLOAD_SYMBOLS)) check = (check << BITS_PER_SYMBOL) | symbol
  if (check !== checksum(payload)) return fallback()

  const bits: number[] = []
  for (const symbol of payload) {
    for (let bit = BITS_PER_SYMBOL - 1; bit >= 0; bit--) bits.push((symbol >> bit) & 1)
  }

  let at = 0
  const take = (width: number) => {
    let value = 0
    for (let bit = 0; bit < width; bit++) value = (value << 1) | (bits[at++] ?? 0)
    return value
  }

  if (take(VERSION_BITS) !== VERSION) return fallback()
  for (const field of FIELDS) field.set(share, take(field.bits))

  share.spec = clampSpec(share.spec)
  return share

  function fallback(): Share {
    return { spec: clampSpec(defaultSpec()), view: defaultView() }
  }
}

/**
 * A position-weighted sum over the code's own symbols, so a character typed
 * wrong and two characters swapped both change it.
 */
function checksum(symbols: readonly number[]): number {
  let sum = 1
  for (let index = 0; index < symbols.length; index++) {
    sum = (sum * 33 + symbols[index]! + index) % 1021
  }
  return sum
}

/**
 * The drawing number: a short, stable name for one exact creature in one exact
 * view. Taken from the code rather than from the spec, so everything the code
 * carries — the lenses lit, the scene it stands in — is part of its identity.
 */
export function identOf(code: string): string {
  let a = 0x811c9dc5
  let b = 0x01000193
  for (let index = 0; index < code.length; index++) {
    a = Math.imul(a ^ code.charCodeAt(index), 0x01000193)
    b = Math.imul(b + code.charCodeAt(index), 0x85ebca6b) ^ (b >>> 13)
  }
  const block = (value: number) => (value >>> 0).toString(36).toUpperCase().padStart(7, '0').slice(-4)
  return `${block(a)}-${block(b)}-${block(a ^ b)}`
}
