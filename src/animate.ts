import type * as THREE from 'three'
import type { RestMap, RestPose } from './joints'
import type { CreatureSpec } from './spec'

/**
 * Motion as arithmetic. `poseAt` is a pure function of time, gait and stance
 * that knows nothing about geometry — only the joint names in `joints.ts` — so
 * changing a creature's proportions never touches a gait, and adding a gait
 * never touches the generator.
 *
 * Every term is built from sine waves whose periods divide the gait period, so
 * a cycle always meets itself cleanly at the seam.
 */

const TAU = Math.PI * 2

export const GAITS = ['idle', 'walk'] as const
export type Gait = (typeof GAITS)[number]

export const GAIT_PERIOD: Record<Gait, number> = {
  idle: 3.2,
  walk: 0.9,
}

/** What the creature is standing on, which is all a gait needs to know about it. */
export type Stance = CreatureSpec['body']

/**
 * One limb, as the gait sees it: a chain of joints from the body outward, what
 * it is for, and where in the stride it is.
 *
 * This is the whole reason a gait can drive a creature nobody wrote it for. It
 * never names a joint; it is handed chains and asks each one to reach, bend and
 * push. A two-segment leg and a five-segment one take the same instruction, and
 * so does a ring of six.
 */
export interface Limb {
  joints: readonly string[]
  kind: 'leg' | 'arm'
  phase: number
}

/** Phases are angles: two pi is zero, and only one of them reads as a phase. */
export const wrapPhase = (phase: number) => ((phase % TAU) + TAU) % TAU

/** The ordinary four-limbed arrangement, for callers that have nothing else. */
export const DEFAULT_LIMBS: readonly Limb[] = [
  { joints: ['backUpperL', 'backLowerL', 'backFootL'], kind: 'leg', phase: 0 },
  { joints: ['backUpperR', 'backLowerR', 'backFootR'], kind: 'leg', phase: Math.PI },
  { joints: ['frontUpperL', 'frontLowerL', 'frontFootL'], kind: 'arm', phase: Math.PI },
  { joints: ['frontUpperR', 'frontLowerR', 'frontFootR'], kind: 'arm', phase: 0 },
]

/** An offset applied on top of a joint's rest pose. */
export interface JointPose {
  rx?: number
  ry?: number
  rz?: number
  /** Height offset, in world units, from where the joint rests. */
  py?: number
}

export type Pose = Record<string, JointPose>

export function poseAt(
  time: number,
  gait: Gait,
  stance: Stance,
  limbs: readonly Limb[] = DEFAULT_LIMBS,
): Pose {
  const phase = (TAU * time) / GAIT_PERIOD[gait]
  return gait === 'walk' ? walk(phase, stance, limbs) : idle(phase, stance, limbs)
}

/** Standing: a slow breath, a drifting head, and a tail with nothing to do. */
function idle(phase: number, stance: Stance, limbs: readonly Limb[]): Pose {
  const breath = Math.sin(phase)
  const drift = Math.sin(phase * 2)
  const planted = stance.frontLimb === 'forelegs'

  const pose: Pose = {
    hip: { py: breath * (planted ? 0.006 : 0.011) },
    spine: { rx: breath * -0.02 },
    neck: { rx: breath * 0.025, ry: drift * 0.05 },
    head: { rx: breath * 0.03, ry: drift * 0.09 },

    earL: { rz: drift * 0.1, rx: breath * 0.07 },
    earR: { rz: drift * -0.1, rx: breath * 0.07 },
    wingL: { rz: breath * 0.05, rx: drift * 0.04 },
    wingR: { rz: breath * -0.05, rx: drift * 0.04 },

    ...tailSwish(phase * 2, 0.1),
  }

  for (const limb of limbs) {
    if (roleOf(limb, stance) !== 'arm') continue
    const sway = breath * 0.05
    const [shoulder, ...rest] = limb.joints
    if (shoulder) pose[shoulder] = { rx: sway, rz: sway * 0.6 }
    for (const joint of rest) pose[joint] = { rx: sway * 1.2 }
  }

  return pose
}

/**
 * Walking. One stride per period.
 *
 * Each limb is told to reach, bend and push at its own point in the stride; it
 * is not told which joints it has. On a biped that reads as an arm swinging
 * against its leg; on a quadruped the same phasing is the diagonal pair; on a
 * centipede it is a wave running down the body. The gait never finds out.
 */
function walk(phase: number, stance: Stance, limbs: readonly Limb[]): Pose {
  const swing = Math.sin(phase)
  // Twice per stride: the body dips each time a foot takes the weight.
  const dip = -0.018 * (1 - Math.cos(phase * 2)) * 0.5
  const level = stance.build === 'upright' ? 1 : 0.6

  const pose: Pose = {
    hip: { py: dip, ry: swing * -0.05 * level },
    spine: { ry: swing * 0.07 * level, rx: -0.04 * level },
    neck: { rx: dip * 1.5 },
    head: { ry: swing * -0.05, rx: 0.03 * level },

    earL: { rz: swing * 0.12, rx: -dip * 4 },
    earR: { rz: swing * -0.12, rx: -dip * 4 },
    wingL: { rz: swing * 0.07 },
    wingR: { rz: swing * -0.07 },

    ...tailSwish(phase, 0.14),
  }

  for (const limb of limbs) {
    Object.assign(pose, stride(limb, roleOf(limb, stance), phase + limb.phase))
  }

  return pose
}

/**
 * One limb through a stride, whatever it is made of.
 *
 * The first joint reaches — positive rx swings a tip backward, so a negative
 * angle is the limb reaching forward. Everything between bends, always one way
 * so it never hyperextends, and alternating down the chain so a long limb
 * folds like an insect's rather than bowing like a hoop. The last joint pushes.
 */
/**
 * A front limb is an arm only while the creature is not standing on it. The
 * stance has the last word, so a gait handed the default arrangement still
 * walks a quadruped on four legs.
 */
function roleOf(limb: Limb, stance: Stance): Limb['kind'] {
  return limb.kind === 'arm' && stance.frontLimb === 'forelegs' ? 'leg' : limb.kind
}

function stride(limb: Limb, kind: Limb['kind'], phase: number): Pose {
  const arm = kind === 'arm'
  const reach = arm ? 0.42 : 0.5
  const flex = (arm ? 0.16 : 0.45) * (1 - Math.cos(phase - Math.PI * 0.35)) * 0.5

  const pose: Pose = {}
  const last = limb.joints.length - 1

  limb.joints.forEach((joint, index) => {
    if (index === 0) {
      pose[joint] = { rx: Math.sin(phase) * reach }
      return
    }
    if (index === last) {
      pose[joint] = { rx: flex * (arm ? 0 : -0.4) }
      return
    }
    // Alternating, and weaker the further down the limb.
    const fold = index % 2 === 1 ? 1 : -0.7
    pose[joint] = { rx: flex * fold * (1 - (index - 1) * 0.18) }
  })

  return pose
}

/** The tail lags behind itself, each segment a little later than the last. */
function tailSwish(phase: number, amount: number): Pose {
  return {
    tail0: { ry: Math.sin(phase) * amount },
    tail1: { ry: Math.sin(phase - 0.6) * amount * 1.4 },
    tail2: { ry: Math.sin(phase - 1.2) * amount * 1.8 },
    tail3: { ry: Math.sin(phase - 1.8) * amount * 2.1 },
  }
}

const AT_REST: RestPose = { rx: 0, ry: 0, rz: 0, y: 0 }

/**
 * Writes a pose onto a creature's joints, on top of their rest pose. Every joint
 * is written every frame — a joint the pose does not mention returns to rest
 * rather than keeping whatever the last gait left on it.
 */
export function applyPose(joints: Record<string, THREE.Object3D>, rest: RestMap, pose: Pose): void {
  for (const name of Object.keys(joints)) {
    const node = joints[name]
    if (!node) continue
    const base = rest[name] ?? AT_REST
    const offset = pose[name]

    node.rotation.set(
      base.rx + (offset?.rx ?? 0),
      base.ry + (offset?.ry ?? 0),
      base.rz + (offset?.rz ?? 0),
    )
    node.position.y = base.y + (offset?.py ?? 0)
  }
}
