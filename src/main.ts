import './style.css'
import type { Gait } from './animate'
import { generate } from './generate'
import { createViewport, defaultView, type ViewSettings } from './render'
import { defaultSpec, type CreatureSpec } from './spec'
import { mountUi } from './ui'

const canvas = document.querySelector<HTMLCanvasElement>('#viewport')
const counter = document.querySelector<HTMLElement>('#triangles')
const zones = {
  modes: document.querySelector<HTMLElement>('#modes'),
  mutations: document.querySelector<HTMLElement>('#mutations'),
  body: document.querySelector<HTMLElement>('#body'),
}
if (!canvas || !counter || !zones.modes || !zones.mutations || !zones.body) {
  throw new Error('the page is missing its viewport or one of its control zones')
}

const viewport = createViewport(canvas)
const view: ViewSettings = defaultView()

function show(spec: CreatureSpec): void {
  const creature = generate(spec)
  viewport.show(creature, spec.body)
  counter!.textContent = `${creature.triangleCount} tris`
}

const spec = defaultSpec()
mountUi({ modes: zones.modes, mutations: zones.mutations, body: zones.body }, spec, view, {
  onSpecChange: show,
  onGaitChange: (gait: Gait) => viewport.setGait(gait),
  onViewChange: (next) => viewport.setView(next),
})

viewport.setView(view)
show(spec)
