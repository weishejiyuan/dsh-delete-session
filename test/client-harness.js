/**
 * Shared harness for the client-half tests.
 *
 * `client/client.js` is a classic-script factory bundle: loading it means
 * calling `window.__ModuleLoader__.load` synchronously, and the factory knows
 * nothing about React or the host context beyond what `require` and `apply`
 * hand it. Every client test therefore assembles the same three stand-ins — a
 * `__ModuleLoader__` sandbox, a React that renders plain element trees while
 * keeping hook state, and a fake `ctx` that records what the plugin registers.
 * They live here so the suite has one shape to maintain.
 */

import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import vm from 'node:vm'

export const PACKAGE_ID = '@local/dsh-delete-session'
const LOCALE_NAMESPACE = 'deleteSession'
export const ROW_ACTION_SLOT = 'sidebar.workspaces.session.row.action'
export const OVERLAY_SLOT = 'shell.overlay'
export const CONTEXT_MENU_ICON_SLOT = 'contextMenu.icon'

/**
 * Minimal React stand-in: elements are plain `{ type, props, children }` trees
 * and hook state survives across renders per component function, so driving a
 * component twice models a re-render. `useEffect` is a no-op — the delete store
 * is read at render time, so a test observes store changes by rendering again.
 */
export function makeReact() {
  const cells = new Map()
  let rendering = null
  let index = 0

  function cellsOf(component) {
    let list = cells.get(component)
    if (list === undefined) {
      list = []
      cells.set(component, list)
    }
    return list
  }

  const React = {
    Fragment: function Fragment() {},
    createElement(type, props, ...children) {
      return { type, props: props ?? {}, children }
    },
    useState(initial) {
      const list = cellsOf(rendering)
      const position = index++
      if (!(position in list)) list[position] = typeof initial === 'function' ? initial() : initial
      return [
        list[position],
        (next) => {
          list[position] = typeof next === 'function' ? next(list[position]) : next
        },
      ]
    },
    useEffect() {},
    useMemo(factory) {
      return factory()
    },
  }

  return {
    React,
    /** One render pass: fresh hook cursor, state kept per component function. */
    render(component, props) {
      rendering = component
      index = 0
      return component(props)
    },
  }
}

/** `dsh-client-locale` interpolation: `{name}` replaced from params. */
export function makeTranslator(dictionary, language) {
  return (key, params) => {
    const template = dictionary[language]?.[key] ?? key
    if (params === undefined) return template
    return template.replace(/\{(\w+)\}/g, (match, name) => (name in params ? String(params[name]) : match))
  }
}

export function jsonResponse(body, status = 200) {
  return { status, json: async () => body }
}

/** Lets the delete request's promise chain run to its end. */
export async function settle() {
  await new Promise((resolve) => setImmediate(resolve))
  await new Promise((resolve) => setImmediate(resolve))
}

/** A `{ ids, byId }` sessions snapshot; rows default to a plain Session. */
export function sessionState(rows) {
  const byId = {}
  for (const [id, row] of Object.entries(rows)) byId[id] = { id, running: false, blank: false, ...row }
  return { ids: Object.keys(byId), byId }
}

/**
 * Runs the bundle in a vm sandbox and returns the registration it made at load
 * time. `fetchImpl` answers the delete endpoint; tests that count requests read
 * them from `loadPlugin().fetches` instead.
 */
export async function loadRegistration(fetchImpl = async () => jsonResponse({ ok: true, code: 'OK' })) {
  const source = await readFile(new URL('../client/client.js', import.meta.url), 'utf8')
  let registration
  const sandbox = {
    window: {
      __ModuleLoader__: {
        load(candidate) {
          registration = candidate
        },
      },
    },
    console,
    fetch: fetchImpl,
  }
  vm.runInNewContext(source, sandbox, { filename: 'client/client.js' })
  return registration
}

/**
 * Loads the bundle, applies the plugin to a recording fake context, and returns
 * both the records and the lookups a test needs to drive components. `language`
 * picks what `ctx.locale.bind()` translates into; a test can still ask for
 * another language through `translator()`.
 */
export async function loadPlugin({ fetchImpl = async () => jsonResponse({ ok: true, code: 'OK' }), language = 'zh' } = {}) {
  const { React, render } = makeReact()
  const primitives = {
    Button: function Button() {},
    Modal: function Modal() {},
    Tooltip: function Tooltip() {},
    IconTrashOutlineRegular: function IconTrashOutlineRegular() {},
  }

  const fetches = []
  const registration = await loadRegistration(async (url, options) => {
    fetches.push({ url, options })
    return fetchImpl(url, options)
  })

  const dictionary = {}
  const locales = []
  const injections = []
  const slotRegistrations = []
  const menuContributions = []
  const effects = []
  const notifications = []
  let sessionsSnapshot = sessionState({})

  const ctx = {
    locale: {
      register(ns, dicts) {
        assert.equal(ns, LOCALE_NAMESPACE, '插件只注册自己的 locale 命名空间')
        locales.push({ ns, dicts })
        Object.assign(dictionary, dicts)
        return () => {}
      },
      bind() {
        return makeTranslator(dictionary, language)
      },
    },
    slots: {
      inject(key, callback) {
        injections.push(key)
        return callback()
      },
      register(options, component) {
        slotRegistrations.push({ options, component })
        return () => {}
      },
    },
    contextMenus: {
      register(contribution) {
        menuContributions.push(contribution)
        return () => {}
      },
      notify(text, success) {
        notifications.push({ text, success })
      },
    },
    sessions: {
      list: {
        getSnapshot: () => sessionsSnapshot,
        subscribe: () => () => {},
      },
    },
    effect(factory, label) {
      effects.push(label)
      return factory()
    },
  }

  const plugin = registration.factory((specifier) => {
    if (specifier === 'react') return React
    if (specifier === '@deepseek-ai/dsh-client-ui-primitives') return primitives
    throw new Error(`unexpected require("${specifier}")`)
  })
  plugin.apply(ctx)

  return {
    React,
    render,
    primitives,
    ctx,
    plugin,
    registration,
    dictionary,
    locales,
    injections,
    slotRegistrations,
    menuContributions,
    effects,
    notifications,
    fetches,
    translator: (target) => makeTranslator(dictionary, target),
    t: makeTranslator(dictionary, language),
    /** The registered entry for a slot name; every client test needs one. */
    slot(name) {
      const entry = slotRegistrations.find((candidate) => candidate.options.name === name)
      assert.notEqual(entry, undefined, `应注册 ${name}`)
      return entry
    },
    setSessions(rows) {
      sessionsSnapshot = sessionState(rows)
    },
  }
}
