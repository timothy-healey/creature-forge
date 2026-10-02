import type * as THREE from 'three'
import type { RestMap, RestPose } from './joints'
import type { Build, FrontLimb } from './spec'

/**
 * Motion as arithmetic. `poseAt` is a pure function of time, gait and stance
 * that knows nothing about geometry — only the joint names in `joints.ts` — so
 * changing a creature's proportions never touches a gait, and adding a gait
 * never touches the generator.
 *
 * Every term is built from sine waves whose periods divide the gait period, so
 * a cycle always meets itself cleanly at the seam.
 */

export const GAITS = ['idle', 'walk'] as const
export type Gait = (typeof GAITS)[number]

export const GAIT_PERIOD: Record<Gait, number> = {
  idle: 3.2,
  walk: 0.9,
}

/** What the creature is standing on, which is all a gait needs to know about it. */
export interface Stance {
  build: Build
  frontLimb: FrontLimb
}

/** An offset applied on top of a joint's rest pose. */
export interface JointPose {
  rx?: number
  ry?: number
  rz?: number
  /** Height offset, in world units, from where the joint rests. */
  py?: number
}

export type Pose = Record<string, JointPose>

const TAU = Math.PI * 2

export function poseAt(time: number, gait: Gait, stance: Stance): Pose {
  const phase = (TAU * time) / GAIT_PERIOD[gait]
  return gait === 'walk' ? walk(phase, stance) : idle(phase, stance)
}

/** Standing: a slow breath, a drifting head, and a tail with nothing to do. */
function idle(phase: number, stance: Stance): Pose {
  const breath = Math.sin(phase)
  const drift = Math.sin(phase * 2)
  const planted = stance.frontLimb === 'forelegs'
  const sway = planted ? 0.015 : 0.05

  return {
    hip: { py: breath * (planted ? 0.006 : 0.011) },
    spine: { rx: breath * -0.02 },
    neck: { rx: breath * 0.025, ry: drift * 0.05 },
    head: { rx: breath * 0.03, ry: drift * 0.09 },

    frontUpperL: { rx: breath * sway, rz: breath * 0.03 },
    frontUpperR: { rx: breath * sway, rz: breath * -0.03 },
    frontLowerL: { rx: breath * sway * 1.2 },
    frontLowerR: { rx: breath * sway * 1.2 },

    earL: { rz: drift * 0.1, rx: breath * 0.07 },
    earR: { rz: drift * -0.1, rx: breath * 0.07 },
    wingL: { rz: breath * 0.05, rx: drift * 0.04 },
    wingR: { rz: breath * -0.05, rx: drift * 0.04 },

    ...tailSwish(phase * 2, 0.1),
  }
}

/**
 * Walking. One stride per period.
 *
 * The limb phases are the same whether the creature walks on two legs or four —
 * each front limb runs half a cycle out of step with the hind limb on its own
 * side. On a biped that reads as an arm swinging against its leg; on a
 * quadruped the very same phasing is the diagonal pair, front-left moving with
 * back-right. Only the amplitudes differ, and whether the front limb bends like
 * a leg or swings like an arm.
 */
function walk(phase: number, stance: Stance): Pose {
  const planted = stance.frontLimb === 'forelegs'
  const swing = Math.sin(phase)
  // Twice per stride: the body dips each time a foot takes the weight.
  const dip = -0.018 * (1 - Math.cos(phase * 2)) * 0.5
  const level = stance.build === 'upright' ? 1 : 0.6

  const back = { reach: 0.5, flex: 0.45, push: -0.4 }
  const front = planted ? { reach: 0.44, flex: 0.38, push: -0.35 } : { reach: 0.42, flex: 0.16, push: 0 }

  return {
    hip: { py: dip, ry: swing * -0.05 * level },
    spine: { ry: swing * 0.07 * level, rx: -0.04 * level },
    neck: { rx: dip * 1.5 },
    head: { ry: swing * -0.05, rx: 0.03 * level },

    ...limbPose('backUpperL', 'backLowerL', 'backFootL', phase, back),
    ...limbPose('backUpperR', 'backLowerR', 'backFootR', phase + Math.PI, back),
    ...limbPose('frontUpperL', 'frontLowerL', 'frontFootL', phase + Math.PI, front),
    ...limbPose('frontUpperR', 'frontLowerR', 'frontFootR', phase, front),

    earL: { rz: swing * 0.12, rx: -dip * 4 },
    earR: { rz: swing * -0.12, rx: -dip * 4 },
    wingL: { rz: swing * 0.07 },
    wingR: { rz: swing * -0.07 },

    ...tailSwish(phase, 0.14),
  }
}

/**
 * One limb through a stride. Positive rx swings a tip backward, so a negative
 * upper angle is the limb reaching forward; the joint below it bends — always
 * one way, never hyperextending — so the foot clears the ground on the way
 * through instead of scraping it.
 */
function limbPose(
  upper: string,
  lower: string,
  foot: string,
  phase: number,
  amount: { reach: number; flex: number; push: number },
): Pose {
  const flex = amount.flex * (1 - Math.cos(phase - Math.PI * 0.35)) * 0.5

  return {
    [upper]: { rx: Math.sin(phase) * amount.reach },
    [lower]: { rx: flex },
    [foot]: { rx: flex * amount.push },
  }
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
