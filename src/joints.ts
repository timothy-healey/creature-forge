/**
 * The contract between the generator and the animator.
 *
 * `generate` promises to produce a node for every core joint; `animate` promises
 * to pose nothing else. Neither imports the other — they meet here, which is why
 * a new body part costs no animation code and a new gait costs no geometry.
 */

export const CORE_JOINTS = [
  'hip',
  'spine',
  'head',
  'armL',
  'forearmL',
  'armR',
  'forearmR',
  'thighL',
  'shinL',
  'footL',
  'thighR',
  'shinR',
  'footR',
] as const

export type CoreJoint = (typeof CORE_JOINTS)[number]

/** Tail joints are optional — a creature may have none. */
export const MAX_TAIL_SEGMENTS = 3
export const TAIL_JOINTS = ['tail0', 'tail1', 'tail2'] as const
export type TailJoint = (typeof TAIL_JOINTS)[number]

export type JointName = CoreJoint | TailJoint

/** The pose a joint rests in before any animation is added on top. */
export interface RestPose {
  rx: number
  ry: number
  rz: number
  py: number
}

export type RestMap = Partial<Record<string, RestPose>>

export function rest(rx = 0, ry = 0, rz = 0, py = 0): RestPose {
  return { rx, ry, rz, py }
}
