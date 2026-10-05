# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

**Primary: a technical visitor, opening a link cold.** An engineer or hiring
manager with a couple of minutes. They did not come to make a creature; they
came to see whether the thing is any good. They may be on a phone. The first few
seconds decide whether they stay.

**Secondary: the author, making creatures to use elsewhere.** Wants a creature
to leave the app — into a game engine, Blender, a screenshot — rather than only
existing in a browser tab.

## Product Purpose

A generative creature editor whose interface teaches how it works.

Every creature is built from a plain spec by code: geometry sampled from
continuous profiles, a spine chain, limbs solved against the floor, and gaits
that drive a creature nobody designed.

Success is a technical visitor coming away understanding one idea they did not
arrive with — how you animate a morphology nobody wrote the animation for — and
the author being able to get a creature out of the app and into something else.

## Positioning

Creature editors hide their machinery and show you a creature. This one shows
the machinery *on* the creature, live, while it walks: the limb registry and
each limb's phase in the stride, the spine chain and where parts attach along
it, the rings a profile was sampled at, skin weights as colour, the floor-solve
drawing the measurement it just made.

The teaching is not a document beside the tool. It is the tool.

## Operating Context

Hosted at a public URL and opened cold, by strangers, with no introduction and
no account — including on phones. Also run locally by the author during
development (`npm run dev`).

Nothing is server-side. A creature is a plain serialisable object, so sharing
and saving can work without a backend.

## Capabilities and Constraints

**Stack.** Vite + TypeScript + Three.js. No UI framework. Vitest, 317 tests.
Everything is generated at runtime from a spec; there are no authored assets,
no model files and no textures.

**Today.** A creature spec drives: a bendable spine chain; one to four limb
pairs placed anywhere along it with two to five bones each; head, face, eyes,
ears, horns, tail, ridge and wings, each able to be absent; three shape genes;
a detail slider that slides the same silhouette between roughly 250 and 3000
triangles; six procedural marking patterns; twelve structural mutations;
jointed and skinned mesh modes; four render modes; four backgrounds; two gaits.
Every one of those values, and the view it is being looked at under, packs into
a 73-character code that the address bar carries, so a creature is a link.

**Missing, and known to be missing.** No .glb export, no undo, no way to lock
part of a creature and reroll the rest. A creature can leave as a link but not
yet as a file.

**Deliberately undecided.** The author declined to fix any constraint as
permanent. The low-poly era look, vertex-colours-only, and fully-generated
geometry are how it works *now*, and are free to change. Future work should
treat them as the incumbent design rather than as commitments.

## Brand Commitments

Named **Creature Forge**. No logo, no established voice, no other identity
assets.

## Evidence on Hand

The working application and its 317 tests. Measurements taken during
development and reproducible from the repo: triangle counts per mutation and
detail level, build times per creature, skin-weight distributions, eye-occlusion
sweeps.

No users, no testimonials, no third-party benchmarks, no press. Nothing of that
kind may be invented.

## Product Principles

1. **The interface teaches the architecture.** If a system matters, it should be
   visible on the creature, not described beside it.
2. **Everything is generated.** A creature is a function of its spec. Nothing is
   authored, so anything you can see, you can roll.
3. **Measure, then change.** Claims about the thing are checked against the
   thing. The record of being wrong is part of what the project is for.
4. **Gaits stay morphology-blind.** The animator is never told what it is
   animating. A new body plan either works with the existing gaits or the gait
   generalises — never a special case.
5. **A creature must be able to leave.** A tool whose output cannot go anywhere
   is a demo.

## Accessibility & Inclusion

No specific standard was established. The surface is publicly reachable and
opened cold, so keyboard reachability, visible focus, and text contrast are
expected of the panel UI; the 3D viewport itself is a visual medium and is not
expected to be operable without sight.
