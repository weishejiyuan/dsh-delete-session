/**
 * Test-only stand-in for `@deepseek-ai/schemastery`. The plugin only builds a
 * schema at import time (`z.object({ sessionsRoot: z.string() })`); nothing in
 * this suite validates values against it, and the real package is not
 * resolvable outside the DSH install tree. So this models construction only —
 * every accessor returns another descriptor and no field is checked.
 */

function descriptor(meta = {}) {
  const self = {
    ...meta,
    default: (value) => descriptor({ ...meta, default: value }),
    description: (text) => descriptor({ ...meta, description: text }),
    required: () => descriptor({ ...meta, required: true }),
    optional: () => descriptor({ ...meta, required: false }),
  }
  return self
}

export default {
  object: (shape) => descriptor({ type: 'object', dict: shape }),
  string: () => descriptor({ type: 'string' }),
}
