import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import vm from 'node:vm'

const PACKAGE_ID = '@local/dsh-delete-session'
const ROW_ACTION_SLOT = 'sidebar.workspaces.session.row.action'
const OVERLAY_SLOT = 'shell.overlay'

function makeRequire() {
  const fakeReact = {
    Fragment: function Fragment() {},
    createElement(type, props, ...children) {
      return { type, props: props ?? {}, children }
    },
    useState(initial) {
      return [typeof initial === 'function' ? initial() : initial, () => {}]
    },
    useEffect() {},
    useMemo(factory) {
      return factory()
    },
  }
  const fakePrimitives = {
    Button() {},
    Modal() {},
    Tooltip() {},
    IconTrashOutlineRegular() {},
  }
  return (specifier) => {
    if (specifier === 'react') return fakeReact
    if (specifier === '@deepseek-ai/dsh-client-ui-primitives') return fakePrimitives
    throw new Error(`unexpected require("${specifier}")`)
  }
}

function makeClientContext() {
  const client = {
    locales: [],
    injections: [],
    slotRegistrations: [],
    menuContributions: [],
    effects: [],
    notifications: [],
  }
  client.ctx = {
    locale: {
      register(ns, dicts) {
        client.locales.push({ ns, dicts })
        return () => {}
      },
      bind(ns) {
        return (key) => client.locales.find((entry) => entry.ns === ns)?.dicts.zh?.[key] ?? key
      },
    },
    slots: {
      inject(key, callback) {
        client.injections.push(key)
        return callback()
      },
      register(options, component) {
        client.slotRegistrations.push({ options, component })
        return () => {}
      },
    },
    contextMenus: {
      register(contribution) {
        client.menuContributions.push(contribution)
        return () => {}
      },
      notify(text, success) {
        client.notifications.push({ text, success })
      },
    },
    sessions: { list: { getSnapshot: () => ({ ids: [], byId: {} }), subscribe: () => () => {} } },
    layout: { panelInfo: { getSnapshot: () => ({ activePanelId: null }), subscribe: () => () => {} } },
    effect(factory, label) {
      client.effects.push(label)
      return factory()
    },
  }
  return client
}

async function loadRegistration(fetchImpl) {
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

async function loadPlugin({ result = { ok: true, code: 'OK' } } = {}) {
  const posts = []
  const fetchImpl = async (url, options) => {
    posts.push({ url, options })
    return { json: async () => result }
  }
  const registration = await loadRegistration(fetchImpl)
  const plugin = registration.factory(makeRequire())
  return { plugin, client: makeClientContext(), posts }
}

test('顶层同步注册工厂包，id 等于包名', async () => {
  const pkg = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'))
  const registration = await loadRegistration(async () => {})

  assert.equal(registration.id, pkg.name)
  assert.equal(registration.id, PACKAGE_ID)
  assert.equal(typeof registration.factory, 'function')
})

test('factory 收到同步 require 并返回 name/inject/apply 三件套', async () => {
  const { plugin } = await loadPlugin()

  assert.equal(plugin.name, 'delete-session-client')
  assert.deepEqual([...plugin.inject], ['slots', 'locale', 'contextMenus', 'sessions', 'layout'])
  assert.equal(typeof plugin.apply, 'function')
})

test('apply 注册中英字典、行内按钮 slot（order 300）、shell.overlay 确认框与菜单图标 key', async () => {
  const { plugin, client } = await loadPlugin()
  plugin.apply(client.ctx)

  assert.equal(client.locales.length, 1)
  const [locale] = client.locales
  assert.equal(locale.ns, 'deleteSession')
  assert.deepEqual(Object.keys(locale.dicts).sort(), ['en', 'zh'])
  for (const language of ['zh', 'en']) {
    assert.equal(typeof locale.dicts[language]['label.deletePermanently'], 'string')
    assert.notEqual(locale.dicts[language]['label.deletePermanently'].trim(), '', `${language} 按钮标签不得为空`)
    assert.equal(typeof locale.dicts[language].deleted, 'string')
    assert.notEqual(locale.dicts[language].deleted.trim(), '', `${language} 成功提示不得为空`)
  }

  assert.deepEqual(client.injections, [ROW_ACTION_SLOT, OVERLAY_SLOT, 'contextMenu.icon'])
  assert.equal(client.slotRegistrations.length, 3)

  const options = client.slotRegistrations.find((entry) => entry.options.name === ROW_ACTION_SLOT).options
  assert.equal(options.id, 'delete-session')
  assert.equal(options.order, 300)
  assert.equal(options.locale, 'deleteSession')
  assert.equal('priority' in options, false, 'list slot 不应传 priority')

  const overlay = client.slotRegistrations.find((entry) => entry.options.name === OVERLAY_SLOT).options
  assert.equal(overlay.id, 'delete-session.confirm')
  assert.equal(overlay.locale, 'deleteSession')
  assert.equal('priority' in overlay, false, 'overlay 条目不应传 priority')
})

test('行内按钮是纯图标 + 500ms Tooltip + aria-label', async () => {
  const { plugin, client } = await loadPlugin()
  plugin.apply(client.ctx)

  const { component } = client.slotRegistrations[0]
  const tree = component({ sessionId: 's-1', displayTitle: '会话标题', t: (key) => `t:${key}` })

  assert.equal(tree.props.label, 't:label.deletePermanently')
  assert.equal(tree.props.side, 'bottom')
  assert.equal(tree.props.align, 'end')
  assert.equal(tree.props.delayMs, 500)
  assert.equal(tree.props.portal, true)

  const button = tree.children[0]
  assert.equal(button.type, 'button')
  assert.equal(button.props.type, 'button')
  assert.equal(button.props['aria-label'], 't:label.deletePermanently')
  assert.equal(typeof button.props.onClick, 'function')

  const icon = button.children[0]
  assert.equal(icon.type.name, 'IconTrashOutlineRegular')
  assert.equal(icon.props.size, 14)
})

test('点击按钮只打开确认请求，不发请求、不弹提示', async () => {
  const { plugin, client, posts } = await loadPlugin()
  plugin.apply(client.ctx)

  const row = client.slotRegistrations.find((entry) => entry.options.name === ROW_ACTION_SLOT)
  const button = row.component({ sessionId: 's-1', displayTitle: '会话标题', t: (key) => `t:${key}` }).children[0]
  button.props.onClick()
  await new Promise((resolve) => setImmediate(resolve))

  assert.equal(posts.length, 0, '删除必须等确认框里点「永久删除」')
  assert.deepEqual(client.notifications, [])

  const overlay = client.slotRegistrations.find((entry) => entry.options.name === OVERLAY_SLOT)
  const dialog = overlay.component({ t: (key) => `t:${key}` })
  assert.equal(dialog.props.request.sessionId, 's-1')
  assert.equal(dialog.props.request.displayTitle, '会话标题')
})
