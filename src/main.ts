import './style.css'
import type { Gait } from './animate'
import { generate } from './generate'
import type { Lens } from './inspect'
import { createViewport, type ViewSettings } from './render'
import { decodeShare, encodeShare, identOf, type Share } from './share'
import type { CreatureSpec } from './spec'
import { keepFitted } from './density'
import { mountUi, reportIdent, reportTotals } from './ui'

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

// The address is the creature: a link opens on exactly what was sent, lenses
// and all, and anything that is not a creature opens on the default one.
const opened = decodeShare(window.location.hash.slice(1))
const spec: CreatureSpec = opened.spec
const view: ViewSettings = opened.view

/**
 * Writes the current creature into the address bar and the title block.
 *
 * `replaceState` rather than `pushState`: a slider drag would otherwise stack
 * a hundred entries into the back button between one end of the rail and the
 * other.
 */
function syncShare(share: Share): void {
  const code = encodeShare(share)
  reportIdent(zones.spec, identOf(code))
  if (window.location.hash.slice(1) !== code) {
    window.history.replaceState(null, '', `#${code}`)
  }
}

function show(next: CreatureSpec): void {
  const creature = generate(next)
  viewport.show(creature, next.body)
  reportTotals(zones.spec, {
    triangles: creature.triangleCount,
    joints: Object.keys(creature.joints).length,
    limbs: creature.limbs.length,
  })
  syncShare({ spec: next, view })
}

mountUi(zones, spec, view, {
  onSpecChange: show,
  onGaitChange: (gait: Gait) => viewport.setGait(gait),
  onViewChange: (next) => {
    viewport.setView(next)
    syncShare({ spec, view: next })
  },
  onFocus: (lens: Lens | null) => viewport.focus(lens),
})

viewport.setView(view)
show(spec)

// The rails compress to whatever height the window gives them, and keep
// compressing as it changes shape.
const refit = keepFitted([zones.rail, zones.spec])
window.addEventListener('beforeunload', () => refit())
