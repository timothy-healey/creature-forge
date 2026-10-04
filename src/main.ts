import './style.css'
import type { Gait } from './animate'
import { generate } from './generate'
import type { Lens } from './inspect'
import { createViewport, defaultView, type ViewSettings } from './render'
import { defaultSpec, identOf, type CreatureSpec } from './spec'
import { mountUi, reportTotals } from './ui'

const need = <T extends Element>(selector: string): T => {
  const node = document.querySelector<T>(selector)
  if (!node) throw new Error(`the sheet is missing ${selector}`)
  return node
}

const canvas = need<HTMLCanvasElement>('#viewport')
const zones = {
  modes: need<HTMLElement>('#modes'),
  rail: need<HTMLElement>('#rail'),
  spec: need<HTMLElement>('#spec'),
  zoneY: need<HTMLElement>('#zone-y'),
  zoneX: need<HTMLElement>('#zone-x'),
}

const viewport = createViewport(canvas)
const view: ViewSettings = defaultView()

function show(spec: CreatureSpec): void {
  const creature = generate(spec)
  viewport.show(creature, spec.body)
  reportTotals(zones.spec, {
    triangles: creature.triangleCount,
    joints: Object.keys(creature.joints).length,
    limbs: creature.limbs.length,
    ident: identOf(spec),
  })
}

const spec = defaultSpec()
mountUi(zones, spec, view, {
  onSpecChange: show,
  onGaitChange: (gait: Gait) => viewport.setGait(gait),
  onViewChange: (next) => viewport.setView(next),
  onFocus: (lens: Lens | null) => viewport.focus(lens),
})

viewport.setView(view)
show(spec)
