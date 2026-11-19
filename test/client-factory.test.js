import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import vm from 'node:vm'

const PACKAGE_ID = '@local/dsh-delete-session'
const ROW_ACTION_SLOT = 'sidebar.workspaces.session.row.action'

function makeRequire() {
  const fakeReact = {
    createElement(type, props, ...children) {
      return { type, props: props ?? {}, children }
    },
  }
  const fakePrimitives = {
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
  const client = { locales: [], injections: [], slotRegistrations: [], notifications: [] }
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
      notify(text, success) {
        client.notifications.push({ text, success })
      },
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
  assert.deepEqual([...plugin.inject], ['slots', 'locale', 'contextMenus'])
  assert.equal(typeof plugin.apply, 'function')
})

test('apply 注册 deleteSession 中英字典与行内按钮 slot（order 300、无 priority）', async () => {
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

  assert.deepEqual(client.injections, [ROW_ACTION_SLOT])
  assert.equal(client.slotRegistrations.length, 1)
  const { options } = client.slotRegistrations[0]
  assert.equal(options.name, ROW_ACTION_SLOT)
  assert.equal(options.id, 'delete-session')
  assert.equal(options.order, 300)
  assert.equal(options.locale, 'deleteSession')
  assert.equal('priority' in options, false, 'list slot 不应传 priority')
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

test('点击按钮向 Host 发出 POST，收到 OK 后弹出成功提示', async () => {
  const { plugin, client, posts } = await loadPlugin()
  plugin.apply(client.ctx)

  const { component } = client.slotRegistrations[0]
  const button = component({ sessionId: 's-1', displayTitle: '会话标题', t: (key) => `t:${key}` }).children[0]
  button.props.onClick()
  await new Promise((resolve) => setImmediate(resolve))

  assert.equal(posts.length, 1)
  assert.equal(posts[0].url, '/delete-session/api/delete')
  assert.equal(posts[0].options.method, 'POST')
  assert.equal(posts[0].options.headers['content-type'], 'application/json')
  assert.deepEqual(JSON.parse(posts[0].options.body), { sessionId: 's-1' })

  assert.deepEqual(client.notifications, [{ text: '会话已永久删除', success: true }])
})
