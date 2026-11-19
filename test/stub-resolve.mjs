/**
 * Test-time module resolution shim, loaded with `--import`.
 *
 * The Host half imports `@deepseek-ai/schemastery` to declare its Config. That
 * package only exists inside the DSH install tree, not in this checkout, so a
 * bare `node --test` cannot load `index.js`. This hook redirects exactly that
 * one specifier to a construction-only stub and sends every other specifier
 * through the default resolver.
 */

import { registerHooks } from 'node:module'

const SCHEMASTERY_STUB = new URL('./schemastery-stub.js', import.meta.url).href

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === '@deepseek-ai/schemastery') {
      return { url: SCHEMASTERY_STUB, shortCircuit: true, format: 'module' }
    }
    return nextResolve(specifier, context)
  },
})
