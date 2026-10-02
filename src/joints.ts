/**
 * The contract between the generator and the animator.
 *
 * `generate` promises to produce a node for every core joint; `animate` promises
 * to pose nothing else. Neither imports the other — they meet here, which is why
 * a new body part costs no animation code and a new gait costs no geometry.
 *
 * Limbs are named front and back rather than arm and leg. A front limb is an arm
 * on an upright creature and a foreleg on a quadruped, and it is the same joint
 * either way — only its rest pose and its share of the gait differ.
 */

export const CORE_JOINTS = [
  'hip',
  'spine',
  'neck',
  'head',
  'frontUpperL',
  'frontLowerL',
  'frontFootL',
  'frontUpperR',
  'frontLowerR',
  'frontFootR',
  'backUpperL',
  'backLowerL',
  'backFootL',
  'backUpperR',
  'backLowerR',
  'backFootR',
] as const

export type CoreJoint = (typeof CORE_JOINTS)[number]

/** Optional joints — a creature may have no tail, no ears and no wings. */
export const TAIL_JOINTS = ['tail0', 'tail1', 'tail2', 'tail3'] as const
export const EAR_JOINTS = ['earL', 'earR'] as const
export const WING_JOINTS = ['wingL', 'wingR'] as const

export type JointName =
  | CoreJoint
  | (typeof TAIL_JOINTS)[number]
  | (typeof EAR_JOINTS)[number]
  | (typeof WING_JOINTS)[number]

/**
 * The pose a joint rests in before any animation is added on top.
 *
 * `y` is where the joint actually sits once built, so the animator can offset a
 * joint's height without having to know how long a leg turned out to be.
 */
export interface RestPose {
  rx: number
  ry: number
  rz: number
  y: number
}

export type RestMap = Partial<Record<string, RestPose>>

export function rest(rx = 0, ry = 0, rz = 0): RestPose {
  return { rx, ry, rz, y: 0 }
}
