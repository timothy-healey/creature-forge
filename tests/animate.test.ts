import { describe, expect, test } from 'vitest'
import { GAITS, GAIT_PERIOD, applyPose, poseAt, type Gait, type Stance } from '../src/animate'
import { generate } from '../src/generate'
import { defaultSpec } from '../src/spec'

const BIPED: Stance = { build: 'upright', frontLimb: 'arms', mesh: 'jointed', mutation: 'none' }
const QUADRUPED: Stance = { build: 'quadruped', frontLimb: 'forelegs', mesh: 'jointed', mutation: 'none' }
const STANCES: [string, Stance][] = [
  ['biped', BIPED],
  ['quadruped', QUADRUPED],
]
const CASES: [Gait, string, Stance][] = GAITS.flatMap((gait) =>
  STANCES.map(([name, stance]) => [gait, name, stance] as [Gait, string, Stance]),
)

const sweep = (gait: Gait, steps = 24) =>
  Array.from({ length: steps }, (_, i) => (i / steps) * GAIT_PERIOD[gait])

const rx = (gait: Gait, t: number, joint: string, stance: Stance = BIPED) =>
  poseAt(t, gait, stance)[joint]?.rx ?? 0

describe('poseAt', () => {
  test.each(CASES)('%s loops seamlessly as a %s, so the cycle never snaps', (gait, _name, stance) => {
    const start = poseAt(0, gait, stance)
    const end = poseAt(GAIT_PERIOD[gait], gait, stance)

    for (const joint of Object.keys(start)) {
      expect(end[joint]?.rx ?? 0, `${joint}.rx`).toBeCloseTo(start[joint]?.rx ?? 0, 5)
      expect(end[joint]?.py ?? 0, `${joint}.py`).toBeCloseTo(start[joint]?.py ?? 0, 5)
    }
  })

  test.each(CASES)('%s keeps every rotation of a %s inside a believable range', (gait, _name, stance) => {
    for (const t of sweep(gait)) {
      for (const [joint, pose] of Object.entries(poseAt(t, gait, stance))) {
        for (const axis of ['rx', 'ry', 'rz'] as const) {
          expect(Math.abs(pose[axis] ?? 0), `${joint}.${axis} at t=${t}`).toBeLessThanOrEqual(1.2)
        }
      }
    }
  })

  test.each(CASES)('%s poses only joints a %s actually has built', (gait, name, stance) => {
    const spec = defaultSpec()
    spec.body.build = stance.build
    spec.body.frontLimb = stance.frontLimb
    spec.head.ears = 'pointed'
    spec.wings.type = 'small'
    spec.tail.type = 'long'
    const built = new Set(Object.keys(generate(spec).joints))

    for (const joint of Object.keys(poseAt(0, gait, stance))) {
      if (joint === 'tail3') continue
      expect(built.has(joint), `${joint} is posed but never built on a ${name}`).toBe(true)
    }
  })

  test('is pure — the same moment gives the same pose', () => {
    expect(poseAt(0.37, 'walk', BIPED)).toEqual(poseAt(0.37, 'walk', BIPED))
  })

  test('idle breathes: the hip rises and falls rather than sitting still', () => {
    const heights = sweep('idle').map((t) => poseAt(t, 'idle', BIPED).hip?.py ?? 0)

    expect(Math.max(...heights) - Math.min(...heights)).toBeGreaterThan(0.005)
  })

  test.each(STANCES)('walk swings a %s\u2019s hind legs in antiphase, half a cycle apart', (_name, stance) => {
    const half = GAIT_PERIOD.walk / 2

    for (const t of sweep('walk')) {
      expect(rx('walk', t + half, 'backUpperR', stance), `t=${t}`).toBeCloseTo(
        rx('walk', t, 'backUpperL', stance),
        5,
      )
    }
  })

  test('walk swings a biped\u2019s arm against the leg on its own side', () => {
    for (const t of sweep('walk')) {
      expect(rx('walk', t, 'frontUpperL') * rx('walk', t, 'backUpperL'), `t=${t}`).toBeLessThanOrEqual(1e-9)
    }
  })

  test('walk moves a quadruped in diagonal pairs, front-left with back-right', () => {
    for (const t of sweep('walk')) {
      expect(rx('walk', t, 'frontUpperL', QUADRUPED), `t=${t}`).toBeCloseTo(
        rx('walk', t, 'backUpperR', QUADRUPED) * (0.44 / 0.5),
        5,
      )
    }
  })

  test.each(STANCES)('walk bends a %s\u2019s knee as the leg swings forward', (_name, stance) => {
    const forwardSwing = sweep('walk').filter((t) => rx('walk', t, 'backUpperL', stance) < -0.1)

    expect(forwardSwing.length).toBeGreaterThan(0)
    for (const t of forwardSwing) {
      expect(rx('walk', t, 'backLowerL', stance), `t=${t}`).toBeGreaterThan(0)
    }
  })
})

describe('applyPose', () => {
  test('adds the pose on top of the rest pose rather than replacing it', () => {
    const creature = generate(defaultSpec())
    const restRx = creature.rest.backUpperL!.rx

    applyPose(creature.joints, creature.rest, { backUpperL: { rx: 0.3 } })

    expect(creature.joints.backUpperL!.rotation.x).toBeCloseTo(restRx + 0.3)
  })

  test('returns an unmentioned joint to its rest pose', () => {
    const creature = generate(defaultSpec())
    creature.joints.backUpperL!.rotation.x = 99

    applyPose(creature.joints, creature.rest, {})

    expect(creature.joints.backUpperL!.rotation.x).toBeCloseTo(creature.rest.backUpperL!.rx)
  })

  test('offsets height from the joint’s resting height, not from zero', () => {
    const creature = generate(defaultSpec())
    const restY = creature.joints.hip!.position.y

    applyPose(creature.joints, creature.rest, { hip: { py: 0.1 } })

    expect(creature.joints.hip!.position.y).toBeCloseTo(restY + 0.1)
  })

  test('ignores a pose naming a joint this creature does not have', () => {
    const tailless = defaultSpec()
    tailless.tail.type = 'none'
    const creature = generate(tailless)

    expect(() => applyPose(creature.joints, creature.rest, { tail0: { rx: 0.4 } })).not.toThrow()
  })
})
