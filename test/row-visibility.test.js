import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import vm from 'node:vm'

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

async function loadRowButton(fetchImpl = async () => ({ json: async () => ({ ok: true, code: 'OK' }) })) {
  const source = await readFile(new URL('../client/client.js', import.meta.url), 'utf8')
  let registration
  let rowComponent
  let dictionary
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

  const ctx = {
    locale: {
      register(ns, dicts) {
        dictionary = dicts
        return () => {}
      },
      bind() {
        return (key) => dictionary.zh[key] ?? key
      },
    },
    slots: {
      inject(_key, callback) {
        return callback()
      },
      register(options, component) {
        if (options.name === ROW_ACTION_SLOT) rowComponent = component
        return () => {}
      },
    },
    contextMenus: { notify() {} },
  }
  registration.factory(makeRequire()).apply(ctx)
  return { component: rowComponent, dictionary }
}

function sessionState(rows) {
  const byId = {}
  for (const [id, row] of Object.entries(rows)) byId[id] = { id, running: false, blank: false, ...row }
  return { ids: Object.keys(byId), byId }
}

function makeStandardProps({ sessions, activePanelId = null, includeStandardProps = true }) {
  if (!includeStandardProps) return {}
  return {
    useSessions: (selector) => selector(sessions),
    usePanelInfo: (selector) => selector({ activePanelId }),
  }
}

function render(component, { sessionId, sessions, activePanelId, includeStandardProps = true, dictionary, t }) {
  const translate = t ?? ((key) => dictionary.zh[key] ?? key)
  return component({
    sessionId,
    displayTitle: '会话标题',
    t: translate,
    ...makeStandardProps({ sessions, activePanelId, includeStandardProps }),
  })
}

function buttonOf(tree) {
  assert.notEqual(tree, null, '该行应渲染按钮')
  return tree.children[0]
}

test('新增置灰文案在 zh/en 字典里都非空', async () => {
  const { dictionary } = await loadRowButton()

  for (const language of ['zh', 'en']) {
    for (const key of ['label.deleteCurrentDisabled', 'sessionActive']) {
      const value = dictionary[language][key]
      assert.equal(typeof value, 'string', `${language} ${key} 应为字符串`)
      assert.notEqual(value.trim(), '', `${language} ${key} 不得为空串`)
    }
  }
  assert.equal(dictionary.zh['label.deleteCurrentDisabled'], '不能删除当前会话')
  assert.equal(dictionary.zh.sessionActive, '会话正在运行，请先停止')
})

test('空白会话行不渲染按钮', async () => {
  const { component, dictionary } = await loadRowButton()
  const sessions = sessionState({ blankRow: { blank: true } })

  const tree = render(component, { sessionId: 'blankRow', sessions, dictionary })

  assert.equal(tree, null)
})

test('当前会话（mainView > 0）置灰，提示「不能删除当前会话」', async () => {
  const { component, dictionary } = await loadRowButton()
  const sessions = sessionState({ current: { retainedBy: { mainView: 1 } } })

  const tree = render(component, { sessionId: 'current', sessions, dictionary })
  const button = buttonOf(tree)

  assert.equal(button.props.disabled, true)
  assert.equal(button.props['aria-label'], '不能删除当前会话')
  assert.equal(tree.props.label, '不能删除当前会话')
  assert.equal(button.props.onClick, undefined, '置灰时不应挂请求回调')
  assert.equal(button.props.style.cursor, 'default')
  assert.equal(button.props.style.opacity, 0.4)
})

test('运行中会话置灰，提示「会话正在运行，请先停止」', async () => {
  const { component, dictionary } = await loadRowButton()
  const sessions = sessionState({ busy: { running: true } })

  const tree = render(component, { sessionId: 'busy', sessions, dictionary })
  const button = buttonOf(tree)

  assert.equal(button.props.disabled, true)
  assert.equal(button.props['aria-label'], '会话正在运行，请先停止')
  assert.equal(tree.props.label, '会话正在运行，请先停止')
  assert.equal(button.props.onClick, undefined)
})

test('同时命中当前会话与运行中时，文案取「不能删除当前会话」', async () => {
  const { component, dictionary } = await loadRowButton()
  const sessions = sessionState({ currentBusy: { running: true, retainedBy: { mainView: 2 } } })

  const tree = render(component, { sessionId: 'currentBusy', sessions, dictionary })
  const button = buttonOf(tree)

  assert.equal(button.props.disabled, true)
  assert.equal(button.props['aria-label'], '不能删除当前会话')
  assert.equal(tree.props.label, '不能删除当前会话')
})

test('普通会话可点，提示「永久删除」', async () => {
  const { component, dictionary } = await loadRowButton()
  const sessions = sessionState({ plain: {}, current: { retainedBy: { mainView: 1 } } })

  const tree = render(component, { sessionId: 'plain', sessions, dictionary })
  const button = buttonOf(tree)

  assert.equal(button.props.disabled, false)
  assert.equal(button.props['aria-label'], '永久删除')
  assert.equal(tree.props.label, '永久删除')
  assert.equal(typeof button.props.onClick, 'function')
  assert.equal(button.props.style.cursor, 'pointer')
  assert.equal(button.props.style.opacity, 1)
})

test('面板激活态下不判定当前会话，mainView 行仍可点', async () => {
  const { component, dictionary } = await loadRowButton()
  const sessions = sessionState({ shown: { retainedBy: { mainView: 1 } } })

  const tree = render(component, { sessionId: 'shown', sessions, activePanelId: 'diff', dictionary })
  const button = buttonOf(tree)

  assert.equal(button.props.disabled, false)
  assert.equal(button.props['aria-label'], '永久删除')
})

test('面板激活态下运行中行仍置灰', async () => {
  const { component, dictionary } = await loadRowButton()
  const sessions = sessionState({ busy: { running: true } })

  const tree = render(component, { sessionId: 'busy', sessions, activePanelId: 'diff', dictionary })
  const button = buttonOf(tree)

  assert.equal(button.props.disabled, true)
  assert.equal(button.props['aria-label'], '会话正在运行，请先停止')
})

test('只有 mainView 引用判定当前会话：侧栏引用 / 选中态行仍可点', async () => {
  const { component, dictionary } = await loadRowButton()
  const sessions = sessionState({ selected: { retainedBy: { mainView: 0, sidebarView: 1 } } })

  const tree = render(component, { sessionId: 'selected', sessions, dictionary })
  const button = buttonOf(tree)

  assert.equal(button.props.disabled, false)
  assert.equal(button.props['aria-label'], '永久删除')
})

test('缺少 useSessions / usePanelInfo 标准 props 时不抛异常且不置灰', async () => {
  const { component, dictionary } = await loadRowButton()

  let tree
  assert.doesNotThrow(() => {
    tree = render(component, {
      sessionId: 'plain',
      sessions: sessionState({ plain: {} }),
      dictionary,
      includeStandardProps: false,
    })
  })
  const button = buttonOf(tree)

  assert.equal(button.props.disabled, false)
  assert.equal(button.props['aria-label'], '永久删除')
})

test('置灰按钮被点击时不发请求（回调未挂载）', async () => {
  const posts = []
  const { component, dictionary } = await loadRowButton(async (url, options) => {
    posts.push({ url, options })
    return { json: async () => ({ ok: true, code: 'OK' }) }
  })
  const sessions = sessionState({ current: { retainedBy: { mainView: 1 } } })

  const button = buttonOf(render(component, { sessionId: 'current', sessions, dictionary }))
  assert.equal(button.props.disabled, true)
  assert.equal(button.props.onClick, undefined)
  assert.equal(posts.length, 0)
})
