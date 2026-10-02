import type * as THREE from 'three'
import type { RestMap, RestPose } from './joints'

/**
 * Motion as arithmetic. `poseAt` is a pure function of time and gait that knows
 * nothing about geometry — only the joint names in `joints.ts` — so changing a
 * creature's proportions never touches a gait, and adding a gait never touches
 * the generator.
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

export function poseAt(time: number, gait: Gait): Pose {
  const phase = (TAU * time) / GAIT_PERIOD[gait]
  return gait === 'walk' ? walk(phase) : idle(phase)
}

/** Standing: a slow breath, a drifting head, and a tail with nothing to do. */
function idle(phase: number): Pose {
  const breath = Math.sin(phase)
  const drift = Math.sin(phase * 2)

  return {
    hip: { py: breath * 0.011 },
    spine: { rx: breath * -0.022 },
    head: { rx: breath * 0.03, ry: drift * 0.09 },
    armL: { rx: breath * 0.05, rz: breath * 0.03 },
    armR: { rx: breath * 0.05, rz: breath * -0.03 },
    forearmL: { rx: breath * 0.06 },
    forearmR: { rx: breath * 0.06 },
    ...tailSwish(phase * 2, 0.1),
  }
}

/**
 * Walking. One stride per period: the legs run half a cycle apart, each arm
 * opposes the leg on its own side, and the knee bends through the swing so the
 * foot clears the ground instead of scraping through it.
 */
function walk(phase: number): Pose {
  const swing = Math.sin(phase)
  // Positive rx swings a tip backward, so negative swing is the leg reaching forward.
  const thigh = swing * 0.5
  // Always positive, peaking in mid-swing — a knee bends one way only.
  const flexL = 0.45 * (1 - Math.cos(phase - Math.PI * 0.35)) * 0.5
  const flexR = 0.45 * (1 - Math.cos(phase + Math.PI * 0.65)) * 0.5
  // Twice per stride: the body dips each time a foot takes the weight.
  const dip = -0.018 * (1 - Math.cos(phase * 2)) * 0.5

  return {
    hip: { py: dip, ry: swing * -0.05 },
    spine: { ry: swing * 0.07, rx: -0.04 },
    head: { ry: swing * -0.05, rx: 0.03 },

    thighL: { rx: thigh },
    shinL: { rx: flexL },
    footL: { rx: flexL * -0.4 },
    thighR: { rx: -thigh },
    shinR: { rx: flexR },
    footR: { rx: flexR * -0.4 },

    armL: { rx: -thigh * 0.82 },
    forearmL: { rx: 0.1 - swing * 0.1 },
    armR: { rx: thigh * 0.82 },
    forearmR: { rx: 0.1 + swing * 0.1 },

    ...tailSwish(phase, 0.12),
  }
}

/** The tail lags behind itself, each segment a little later than the last. */
function tailSwish(phase: number, amount: number): Pose {
  return {
    tail0: { ry: Math.sin(phase) * amount },
    tail1: { ry: Math.sin(phase - 0.6) * amount * 1.4 },
    tail2: { ry: Math.sin(phase - 1.2) * amount * 1.8 },
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
