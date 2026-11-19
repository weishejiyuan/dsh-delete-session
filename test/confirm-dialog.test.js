import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import vm from 'node:vm'

const ROW_ACTION_SLOT = 'sidebar.workspaces.session.row.action'
const OVERLAY_SLOT = 'shell.overlay'
const DANGER_TEXT_COLOR = 'var(--dsw-alias-state-error-primary)'

/**
 * Minimal React stand-in: elements are plain trees and hook state survives
 * across renders per component, so driving a component twice models a
 * re-render. `useEffect` is a no-op — the store is read at render time, so a
 * test observes store changes by rendering again.
 */
function makeReact() {
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
function makeTranslator(dictionary, language) {
  return (key, params) => {
    const template = dictionary[language]?.[key] ?? key
    if (params === undefined) return template
    return template.replace(/\{(\w+)\}/g, (match, name) => (name in params ? String(params[name]) : match))
  }
}

function jsonResponse(body, status = 200) {
  return { status, json: async () => body }
}

async function settle() {
  await new Promise((resolve) => setImmediate(resolve))
  await new Promise((resolve) => setImmediate(resolve))
}

async function loadClient({ fetchImpl = async () => jsonResponse({ ok: true, code: 'OK' }) } = {}) {
  const source = await readFile(new URL('../client/client.js', import.meta.url), 'utf8')
  const { React, render } = makeReact()
  const primitives = {
    Button: function Button() {},
    Modal: function Modal() {},
    Tooltip: function Tooltip() {},
    IconTrashOutlineRegular: function IconTrashOutlineRegular() {},
  }

  const fetches = []
  const fetchStub = async (url, options) => {
    fetches.push({ url, options })
    return fetchImpl(url, options)
  }

  let registration
  const sandbox = {
    window: { __ModuleLoader__: { load(candidate) { registration = candidate } } },
    console,
    fetch: fetchStub,
  }
  vm.runInNewContext(source, sandbox, { filename: 'client/client.js' })

  const dictionary = {}
  const notifications = []
  const registrations = []

  const ctx = {
    locale: {
      register(ns, dicts) {
        assert.equal(ns, 'deleteSession')
        Object.assign(dictionary, dicts)
        return () => {}
      },
      bind() {
        return makeTranslator(dictionary, 'zh')
      },
    },
    slots: {
      inject(key, callback) {
        return callback()
      },
      register(options, component) {
        registrations.push({ options, component })
        return () => {}
      },
    },
    contextMenus: {
      notify(text, success) {
        notifications.push({ text, success })
      },
    },
  }

  const plugin = registration.factory((specifier) => {
    if (specifier === 'react') return React
    if (specifier === '@deepseek-ai/dsh-client-ui-primitives') return primitives
    throw new Error(`unexpected require("${specifier}")`)
  })
  plugin.apply(ctx)

  const registrationOf = (slot) => registrations.find((entry) => entry.options.name === slot)
  const row = registrationOf(ROW_ACTION_SLOT)
  const overlay = registrationOf(OVERLAY_SLOT)
  assert.notEqual(row, undefined, '应注册行内按钮 slot')
  assert.notEqual(overlay, undefined, '应注册 shell.overlay 确认框')

  return {
    primitives,
    render,
    dictionary,
    notifications,
    fetches,
    registrations,
    translator: (language) => makeTranslator(dictionary, language),
    t: makeTranslator(dictionary, 'zh'),
    rowComponent: row.component,
    rowOptions: row.options,
    overlayComponent: overlay.component,
    overlayOptions: overlay.options,
  }
}

const IDLE_SESSIONS = { ids: ['s-1'], byId: { 's-1': { id: 's-1', running: false, blank: false } } }

function renderRow(app, { sessionId = 's-1', displayTitle = '会话标题', sessions = IDLE_SESSIONS } = {}) {
  return app.render(app.rowComponent, {
    sessionId,
    displayTitle,
    t: app.t,
    useSessions: (selector) => selector(sessions),
    usePanelInfo: (selector) => selector({ activePanelId: null }),
  })
}

/** Clicks the row entry: from here on the request lives in the store only. */
function openFromRow(app, options) {
  renderRow(app, options).children[0].props.onClick()
}

/** Renders the overlay entry and, when a request is pending, the dialog it holds. */
function renderDialog(app, { t = app.t } = {}) {
  const form = app.render(app.overlayComponent, { t })
  if (form === null) return null
  const modal = app.render(form.type, form.props)
  const [cancel, confirm] = modal.props.footer.children
  return { form, modal, cancel, confirm, request: form.props.request }
}

test('确认框未打开时 shell.overlay 条目返回 null，不常驻空浮层', async () => {
  const app = await loadClient()

  assert.equal(app.render(app.overlayComponent, { t: app.t }), null)
})

test('点行内按钮只把删除请求放进共享 store，不发任何请求、不弹提示', async () => {
  const app = await loadClient()

  openFromRow(app)

  assert.equal(app.fetches.length, 0)
  assert.equal(app.notifications.length, 0)
  const dialog = renderDialog(app)
  assert.notEqual(dialog, null, '点按钮后应能打开确认框')
  assert.equal(dialog.request.sessionId, 's-1')
  assert.equal(dialog.request.displayTitle, '会话标题')
})

test('置灰行点击不打开 store', async () => {
  const app = await loadClient()
  const sessions = { ids: ['s-1'], byId: { 's-1': { id: 's-1', running: true, blank: false } } }

  const button = renderRow(app, { sessions }).children[0]

  assert.equal(button.props.disabled, true)
  assert.equal(button.props.onClick, undefined)
  assert.equal(app.render(app.overlayComponent, { t: app.t }), null)
})

test('确认框显示标题与含会话标题的不可撤销说明，取消在左、永久删除在右', async () => {
  const app = await loadClient()
  openFromRow(app)

  const { modal, cancel, confirm } = renderDialog(app)

  assert.equal(modal.type, app.primitives.Modal)
  assert.equal(modal.props.open, true)
  assert.equal(modal.props.title, '永久删除会话')
  assert.equal(modal.props.description, '将永久删除「会话标题」，此操作不可撤销。')
  assert.deepEqual(modal.props.footer.children.map((button) => button.children[0]), ['取消', '永久删除'])
  assert.equal(cancel.type, app.primitives.Button)
  assert.equal(confirm.type, app.primitives.Button)
})

test('「永久删除」是描边样式配红色文字，不是实心红块', async () => {
  const app = await loadClient()
  openFromRow(app)

  const { confirm } = renderDialog(app)

  assert.equal(confirm.props.variant, 'outline')
  assert.equal(confirm.props.style.color, DANGER_TEXT_COLOR)
  assert.equal('background' in confirm.props.style, false)
})

test('英文界面下确认框的标题、说明与两个按钮文案都正确', async () => {
  const app = await loadClient()
  openFromRow(app)

  const modal = renderDialog(app, { t: app.translator('en') }).modal

  assert.equal(modal.props.title, 'Delete session permanently')
  assert.equal(modal.props.description, '「会话标题」 will be deleted permanently. This cannot be undone.')
  assert.deepEqual(modal.props.footer.children.map((button) => button.children[0]), ['Cancel', 'Delete permanently'])
})

test('点取消：关框、store 清空、不发请求、不弹提示', async () => {
  const app = await loadClient()
  openFromRow(app)
  const { cancel } = renderDialog(app)

  cancel.props.onClick()

  assert.equal(app.fetches.length, 0, '取消不得发送任何到 Host 的请求')
  assert.equal(app.notifications.length, 0, '取消不得有任何提示打扰')
  assert.equal(renderDialog(app), null, '取消后 store 应清空')
})

test('Esc / 点遮罩（onClose）等同于取消，不执行删除', async () => {
  const app = await loadClient()
  openFromRow(app)
  const { modal } = renderDialog(app)

  assert.equal(typeof modal.props.onClose, 'function')
  modal.props.onClose()

  assert.equal(app.fetches.length, 0)
  assert.equal(app.notifications.length, 0)
  assert.equal(renderDialog(app), null)
})

test('点永久删除：恰好一次 POST，成功后关框并提示「会话已永久删除」', async () => {
  const app = await loadClient()
  openFromRow(app)
  const { confirm } = renderDialog(app)

  confirm.props.onClick()
  await settle()

  assert.equal(app.fetches.length, 1)
  assert.equal(app.fetches[0].url, '/delete-session/api/delete')
  assert.equal(app.fetches[0].options.method, 'POST')
  assert.equal(app.fetches[0].options.headers['content-type'], 'application/json')
  assert.deepEqual(JSON.parse(app.fetches[0].options.body), { sessionId: 's-1' })
  assert.deepEqual(app.notifications, [{ text: '会话已永久删除', success: true }])
  assert.equal(renderDialog(app), null, '成功后 store 应清空')
})

test('请求进行中：按钮文案切「正在删除…」、两按钮禁用、连点不产生第二个请求', async () => {
  let release
  const app = await loadClient({ fetchImpl: () => new Promise((resolve) => { release = resolve }) })
  openFromRow(app)
  const first = renderDialog(app)

  first.confirm.props.onClick()
  assert.equal(app.fetches.length, 1)

  // 同一个闭包连点第二次（React 还没来得及重渲染时的那一次点击）。
  first.confirm.props.onClick()
  assert.equal(app.fetches.length, 1, '连点两次只发一个请求')

  const pending = renderDialog(app)
  assert.equal(pending.confirm.children[0], '正在删除…')
  assert.equal(pending.confirm.props.disabled, true)
  assert.equal(pending.cancel.props.disabled, true)

  pending.confirm.props.onClick()
  first.cancel.props.onClick()
  pending.cancel.props.onClick()
  assert.equal(app.fetches.length, 1)
  assert.notEqual(renderDialog(app), null, '进行中既不能重发也不能关框')

  release(jsonResponse({ ok: true, code: 'OK' }))
  await settle()
  assert.deepEqual(app.notifications, [{ text: '会话已永久删除', success: true }])
})

test('409 SESSION_ACTIVE：框保持打开、不弹提示、框内显示「会话正在运行，请先停止」', async () => {
  const app = await loadClient({
    fetchImpl: async () => jsonResponse({ ok: false, code: 'SESSION_ACTIVE', message: '会话正在运行，请先停止' }, 409),
  })
  openFromRow(app)
  const { confirm } = renderDialog(app)

  confirm.props.onClick()
  await settle()

  assert.equal(app.notifications.length, 0)
  const failed = renderDialog(app)
  assert.notEqual(failed, null, '失败后确认框必须留在原地')
  assert.equal(failed.modal.children[0].props.role, 'alert')
  assert.equal(failed.modal.children[0].children[0], '会话正在运行，请先停止')
  assert.equal(failed.confirm.props.disabled, false, '失败后可以重试')
  assert.equal(failed.confirm.children[0], '永久删除')
})

test('SESSION_NOT_FOUND / DELETE_FAILED / 未知码各自映射到对应文案', async () => {
  const cases = [
    [
      { ok: false, code: 'SESSION_NOT_FOUND', message: '会话不存在，可能已被删除' },
      '会话不存在，可能已被删除',
    ],
    [
      { ok: false, code: 'DELETE_FAILED', message: 'EPERM: 目录只读' },
      '删除失败 — EPERM: 目录只读',
    ],
    [{ ok: false, code: 'DELETE_FAILED' }, '删除失败'],
    [
      { ok: false, code: 'REJECTED', message: 'request rejected (403)' },
      '删除失败 — request rejected (403)',
    ],
  ]

  for (const [body, expected] of cases) {
    const app = await loadClient({ fetchImpl: async () => jsonResponse(body) })
    openFromRow(app)
    const { confirm } = renderDialog(app)

    confirm.props.onClick()
    await settle()

    const line = renderDialog(app).modal.children[0].children[0]
    assert.equal(line, expected, `${body.code} 的框内文案`)
  }
})

test('网络异常：框内显示「删除失败」加原始消息', async () => {
  const app = await loadClient({
    fetchImpl: async () => {
      throw new Error('Failed to fetch')
    },
  })
  openFromRow(app)
  const { confirm } = renderDialog(app)

  confirm.props.onClick()
  await settle()

  assert.equal(app.notifications.length, 0)
  assert.equal(renderDialog(app).modal.children[0].children[0], '删除失败 — Failed to fetch')
})

test('确认框注册到 shell.overlay：id / locale 正确，不传 priority', async () => {
  const app = await loadClient()

  assert.equal(app.overlayOptions.name, OVERLAY_SLOT)
  assert.equal(app.overlayOptions.id, 'delete-session.confirm')
  assert.equal(app.overlayOptions.locale, 'deleteSession')
  assert.equal('priority' in app.overlayOptions, false, 'overlay 条目不应传 priority')
  assert.equal(app.rowOptions.order, 300, '行内按钮保持 order 300')
  assert.equal('priority' in app.rowOptions, false)
})

test('两个 locale 字典覆盖全部 key，中英都非空且既有文案未改', async () => {
  const app = await loadClient()
  const keys = [
    'label.deletePermanently',
    'label.deleteCurrentDisabled',
    'confirm.title',
    'confirm.desc',
    'confirm.action',
    'confirm.pending',
    'cancel',
    'deleted',
    'sessionActive',
    'sessionNotFound',
    'deleteFailed',
  ]

  for (const language of ['zh', 'en']) {
    assert.deepEqual(Object.keys(app.dictionary[language]).sort(), [...keys].sort(), `${language} 字典的 key 集`)
    for (const key of keys) {
      const value = app.dictionary[language][key]
      assert.equal(typeof value, 'string', `${language} ${key} 应为字符串`)
      assert.notEqual(value.trim(), '', `${language} ${key} 不得为空串`)
    }
  }

  assert.equal(app.dictionary.zh['label.deletePermanently'], '永久删除')
  assert.equal(app.dictionary.zh['label.deleteCurrentDisabled'], '不能删除当前会话')
  assert.equal(app.dictionary.zh.sessionActive, '会话正在运行，请先停止')
  assert.equal(app.dictionary.zh.deleted, '会话已永久删除')
  assert.equal(app.dictionary.zh['confirm.title'], '永久删除会话')
  assert.equal(app.dictionary.zh['confirm.desc'], '将永久删除「{title}」，此操作不可撤销。')
  assert.equal(app.dictionary.zh['confirm.action'], '永久删除')
  assert.equal(app.dictionary.zh['confirm.pending'], '正在删除…')
  assert.equal(app.dictionary.zh.cancel, '取消')
  assert.equal(app.dictionary.zh.sessionNotFound, '会话不存在，可能已被删除')
  assert.equal(app.dictionary.zh.deleteFailed, '删除失败')
  assert.match(app.dictionary.en['confirm.desc'], /\{title\}/, '英文说明同样要保留 {title} 占位')
})
