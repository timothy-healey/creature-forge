import { defineConfig } from 'vite'

/**
 * GitHub Pages serves this from a repository subfolder rather than a domain
 * root, so every asset URL carries that prefix.
 *
 * It is set unconditionally, which means the dev server answers on
 * /creature-forge/ too and the root redirects there. Scoping it to the build
 * instead looks tidier and is a trap: `vite preview` runs as a serve command,
 * so it would host a build whose assets expect the prefix at a root that does
 * not have one, and the page comes up blank. One base everywhere, and what you
 * preview is what deploys.
 */
export default defineConfig({
  base: '/creature-forge/',
})
