import { describe, expect, test } from 'vitest'

import { LENSES } from '../src/inspect'
import { BACKGROUNDS, RENDER_MODES, defaultView } from '../src/render'
import {
  COLOR_KEYS,
  MESH_MODES,
  MUTATIONS,
  SLIDERS,
  clampSpec,
  defaultSpec,
  randomSpec,
  readSlider,
  writeSlider,
} from '../src/spec'
import { SLIDER_STEP, decodeShare, encodeShare, identOf, type Share } from '../src/share'

const state = (edit: (share: Share) => void = () => {}): Share => {
  const share = { spec: defaultSpec(), view: defaultView() }
  edit(share)
  return share
}

/** Everything a code has to carry, rolled, including what `randomSpec` holds fixed. */
function rolledState(random = Math.random): Share {
  const pick = <T>(options: readonly T[]) => options[Math.floor(random() * options.length)]!
  const spec = randomSpec(random)
  spec.body.mesh = pick(MESH_MODES)
  spec.body.mutation = pick(MUTATIONS)
  spec.detail.level = random()
  spec.bake.amount = random()
  return {
    spec,
    view: {
      render: pick(RENDER_MODES),
      background: pick(BACKGROUNDS),
      outline: random(),
      pixels: random(),
      wobble: random(),
      lenses: LENSES.filter(() => random() < 0.5),
    },
  }
}

describe('a creature as a line of text', () => {
  test('brings the default creature back exactly as it went in', () => {
    const before = state()
    const after = decodeShare(encodeShare(before))

    expect(after.spec).toEqual(clampSpec(before.spec))
    expect(after.view).toEqual(before.view)
  })

  test('brings every choice back exactly, across rolled creatures', () => {
    for (let seed = 0; seed < 150; seed++) {
      const before = rolledState()
      const after = decodeShare(encodeShare(before))

      expect(after.spec.body, `roll ${seed}`).toEqual(before.spec.body)
      expect(after.spec.head.type, `roll ${seed}`).toBe(before.spec.head.type)
      expect(after.spec.head.horns, `roll ${seed}`).toBe(before.spec.head.horns)
      expect(after.spec.head.eyes, `roll ${seed}`).toBe(before.spec.head.eyes)
      expect(after.spec.head.ears, `roll ${seed}`).toBe(before.spec.head.ears)
      expect(after.spec.torso.segments, `roll ${seed}`).toBe(before.spec.torso.segments)
      expect(after.spec.limbs.pairs, `roll ${seed}`).toBe(before.spec.limbs.pairs)
      expect(after.spec.limbs.segments, `roll ${seed}`).toBe(before.spec.limbs.segments)
      expect(after.spec.legs.type, `roll ${seed}`).toBe(before.spec.legs.type)
      expect(after.spec.tail.type, `roll ${seed}`).toBe(before.spec.tail.type)
      expect(after.spec.back.ridge, `roll ${seed}`).toBe(before.spec.back.ridge)
      expect(after.spec.wings.type, `roll ${seed}`).toBe(before.spec.wings.type)
      expect(after.spec.skin.pattern, `roll ${seed}`).toBe(before.spec.skin.pattern)
      for (const key of COLOR_KEYS) {
        expect(after.spec.colors[key], `roll ${seed} ${key}`).toBe(before.spec.colors[key])
      }
    }
  })

  test('brings every slider back to within half a step', () => {
    for (let seed = 0; seed < 100; seed++) {
      const before = rolledState()
      const after = decodeShare(encodeShare(before))

      for (const slider of SLIDERS) {
        const drift = Math.abs(readSlider(after.spec, slider.path) - readSlider(before.spec, slider.path))
        expect(drift, `roll ${seed} ${slider.path}`).toBeLessThanOrEqual(SLIDER_STEP / 2 + 1e-9)
      }
      for (const dial of ['outline', 'pixels', 'wobble'] as const) {
        expect(Math.abs(after.view[dial] - before.view[dial]), dial).toBeLessThanOrEqual(SLIDER_STEP / 2 + 1e-9)
      }
    }
  })

  test('carries the lenses that were lit', () => {
    const before = state((share) => void (share.view.lenses = ['spine', 'rings']))

    expect(decodeShare(encodeShare(before)).view.lenses).toEqual(['spine', 'rings'])
  })

  test('a code decoded and re-encoded is the same code', () => {
    for (let seed = 0; seed < 100; seed++) {
      const code = encodeShare(rolledState())

      expect(encodeShare(decodeShare(code)), `roll ${seed}`).toBe(code)
    }
  })

  test('reads aloud without ambiguity: no I, L, O or U, and no lowercase', () => {
    for (let seed = 0; seed < 50; seed++) {
      expect(encodeShare(rolledState())).toMatch(/^[0-9A-HJKMNP-TV-Z]+$/)
    }
  })

  test('a display value changes the code, not only the creature', () => {
    const plain = encodeShare(state())

    expect(encodeShare(state((share) => void (share.view.background = 'grid')))).not.toBe(plain)
    expect(encodeShare(state((share) => void (share.view.render = 'toon')))).not.toBe(plain)
    expect(encodeShare(state((share) => void (share.view.lenses = ['rig'])))).not.toBe(plain)
  })

  test('a code that was damaged in transit gives back the default creature', () => {
    const good = encodeShare(state())

    for (const bad of ['', 'NONSENSE', good.slice(0, -4), `${good}ZZZZ`, good.slice(1), 'ZZZZZZZZZZZZ']) {
      expect(decodeShare(bad).spec, bad).toEqual(clampSpec(defaultSpec()))
    }
  })

  test('a single mistyped character is rejected rather than read as another creature', () => {
    const good = encodeShare(state())
    const mine = defaultSpec()
    let rejected = 0
    let tried = 0

    for (let at = 0; at < good.length; at++) {
      for (const swap of ['2', '7', 'K', 'W']) {
        if (good[at] === swap) continue
        tried++
        const bent = `${good.slice(0, at)}${swap}${good.slice(at + 1)}`
        if (decodeShare(bent).spec.body.mutation === clampSpec(mine).body.mutation
          && JSON.stringify(decodeShare(bent).spec) === JSON.stringify(clampSpec(mine))) rejected++
      }
    }

    // A ten-bit checksum lets roughly one corruption in a thousand through.
    expect(tried).toBeGreaterThan(200)
    expect(rejected / tried).toBeGreaterThan(0.97)
  })
})

describe('identOf', () => {
  const ident = (edit: (share: Share) => void = () => {}) => identOf(encodeShare(state(edit)))

  test('is the same for the same creature every time', () => {
    expect(ident()).toBe(ident())
  })

  test('changes when a slider moves', () => {
    expect(ident((share) => writeSlider(share.spec, 'torso.width', 0.9))).not.toBe(ident())
  })

  test('changes when a display value changes, because the view travels too', () => {
    expect(ident((share) => void (share.view.background = 'dusk'))).not.toBe(ident())
  })

  test('is three blocks of four, which is what the title block has room for', () => {
    expect(ident()).toMatch(/^[0-9A-Z]{4}-[0-9A-Z]{4}-[0-9A-Z]{4}$/)
  })

  test('tells four hundred rolled creatures apart', () => {
    const idents = new Set(Array.from({ length: 400 }, () => identOf(encodeShare(rolledState()))))

    expect(idents.size).toBe(400)
  })
})
