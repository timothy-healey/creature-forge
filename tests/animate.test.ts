import { describe, expect, test } from 'vitest'
import { GAITS, GAIT_PERIOD, applyPose, poseAt, type Gait } from '../src/animate'
import { generate } from '../src/generate'
import { defaultSpec } from '../src/spec'

const sweep = (gait: Gait, steps = 24) =>
  Array.from({ length: steps }, (_, i) => (i / steps) * GAIT_PERIOD[gait])

const rx = (gait: Gait, t: number, joint: string) => poseAt(t, gait)[joint]?.rx ?? 0

describe('poseAt', () => {
  test.each(GAITS)('%s loops seamlessly, so the cycle never snaps', (gait) => {
    const start = poseAt(0, gait)
    const end = poseAt(GAIT_PERIOD[gait], gait)

    for (const joint of Object.keys(start)) {
      expect(end[joint]?.rx ?? 0, `${joint}.rx`).toBeCloseTo(start[joint]?.rx ?? 0, 5)
      expect(end[joint]?.py ?? 0, `${joint}.py`).toBeCloseTo(start[joint]?.py ?? 0, 5)
    }
  })

  test.each(GAITS)('%s keeps every rotation inside a believable range', (gait) => {
    for (const t of sweep(gait)) {
      for (const [joint, pose] of Object.entries(poseAt(t, gait))) {
        for (const axis of ['rx', 'ry', 'rz'] as const) {
          expect(Math.abs(pose[axis] ?? 0), `${joint}.${axis} at t=${t}`).toBeLessThanOrEqual(1.2)
        }
      }
    }
  })

  test.each(GAITS)('%s poses only joints the generator actually builds', (gait) => {
    const built = new Set(Object.keys(generate(defaultSpec()).joints))

    for (const joint of Object.keys(poseAt(0, gait))) {
      expect(built.has(joint), `${joint} is posed but never built`).toBe(true)
    }
  })

  test('is pure — the same moment gives the same pose', () => {
    expect(poseAt(0.37, 'walk')).toEqual(poseAt(0.37, 'walk'))
  })

  test('idle breathes: the hip rises and falls rather than sitting still', () => {
    const heights = sweep('idle').map((t) => poseAt(t, 'idle').hip?.py ?? 0)

    expect(Math.max(...heights) - Math.min(...heights)).toBeGreaterThan(0.005)
  })

  test('walk swings the legs in antiphase, half a cycle apart', () => {
    const half = GAIT_PERIOD.walk / 2

    for (const t of sweep('walk')) {
      expect(rx('walk', t + half, 'thighR'), `t=${t}`).toBeCloseTo(rx('walk', t, 'thighL'), 5)
    }
  })

  test('walk swings each arm against the leg on its own side', () => {
    for (const t of sweep('walk')) {
      expect(rx('walk', t, 'armL') * rx('walk', t, 'thighL'), `t=${t}`).toBeLessThanOrEqual(1e-9)
    }
  })

  test('walk bends the knee of the leg that is swinging forward', () => {
    const forwardSwing = sweep('walk').filter((t) => rx('walk', t, 'thighL') < -0.1)

    expect(forwardSwing.length).toBeGreaterThan(0)
    for (const t of forwardSwing) {
      expect(rx('walk', t, 'shinL'), `t=${t}`).toBeGreaterThan(0)
    }
  })
})

describe('applyPose', () => {
  test('adds the pose on top of the rest pose rather than replacing it', () => {
    const creature = generate(defaultSpec())
    const restRx = creature.rest.thighL!.rx

    applyPose(creature.joints, creature.rest, { thighL: { rx: 0.3 } })

    expect(creature.joints.thighL!.rotation.x).toBeCloseTo(restRx + 0.3)
  })

  test('returns an unmentioned joint to its rest pose', () => {
    const creature = generate(defaultSpec())
    creature.joints.thighL!.rotation.x = 99

    applyPose(creature.joints, creature.rest, {})

    expect(creature.joints.thighL!.rotation.x).toBeCloseTo(creature.rest.thighL!.rx)
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
