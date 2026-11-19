import assert from 'node:assert/strict'
import test from 'node:test'

import { ROW_ACTION_SLOT, loadPlugin, sessionState } from './client-harness.js'

/** The row button plus the dictionaries it translates against. */
async function loadRowButton(fetchImpl) {
  const app = await loadPlugin(fetchImpl === undefined ? {} : { fetchImpl })
  return { component: app.slot(ROW_ACTION_SLOT).component, dictionary: app.dictionary, fetches: app.fetches }
}

function makeStandardProps({ sessions, includeStandardProps = true }) {
  if (!includeStandardProps) return {}
  return { useSessions: (selector) => selector(sessions) }
}

function render(component, { sessionId, sessions, includeStandardProps = true, dictionary, t }) {
  const translate = t ?? ((key) => dictionary.zh[key] ?? key)
  return component({
    sessionId,
    displayTitle: '会话标题',
    t: translate,
    ...makeStandardProps({ sessions, includeStandardProps }),
  })
}

function buttonOf(tree) {
  assert.notEqual(tree, null, '该行应渲染按钮')
  return tree.children[0]
}

test('置灰文案在 zh/en 字典里都非空', async () => {
  const { dictionary } = await loadRowButton()

  for (const language of ['zh', 'en']) {
    const value = dictionary[language].sessionActive
    assert.equal(typeof value, 'string', `${language} sessionActive 应为字符串`)
    assert.notEqual(value.trim(), '', `${language} sessionActive 不得为空串`)
  }
  assert.equal(dictionary.zh.sessionActive, '会话正在运行，请先停止')
})

test('空白会话行不渲染按钮', async () => {
  const { component, dictionary } = await loadRowButton()
  const sessions = sessionState({ blankRow: { blank: true } })

  const tree = render(component, { sessionId: 'blankRow', sessions, dictionary })

  assert.equal(tree, null)
})

test('当前会话（mainView > 0，已停止活动）可点，提示「永久删除」', async () => {
  const { component, dictionary } = await loadRowButton()
  const sessions = sessionState({ current: { retainedBy: { mainView: 1 } } })

  const tree = render(component, { sessionId: 'current', sessions, dictionary })
  const button = buttonOf(tree)

  assert.equal(button.props.disabled, false)
  assert.equal(button.props['aria-label'], '永久删除')
  assert.equal(tree.props.label, '永久删除')
  assert.equal(typeof button.props.onClick, 'function')
  assert.equal(button.props.style.cursor, 'pointer')
  assert.equal(button.props.style.opacity, 1)
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

test('当前会话且运行中时置灰，文案「会话正在运行，请先停止」', async () => {
  const { component, dictionary } = await loadRowButton()
  const sessions = sessionState({ currentBusy: { running: true, retainedBy: { mainView: 2 } } })

  const tree = render(component, { sessionId: 'currentBusy', sessions, dictionary })
  const button = buttonOf(tree)

  assert.equal(button.props.disabled, true)
  assert.equal(button.props['aria-label'], '会话正在运行，请先停止')
  assert.equal(tree.props.label, '会话正在运行，请先停止')
})

test('普通会话可点，提示「永久删除」', async () => {
  const { component, dictionary } = await loadRowButton()
  const sessions = sessionState({ plain: {} })

  const tree = render(component, { sessionId: 'plain', sessions, dictionary })
  const button = buttonOf(tree)

  assert.equal(button.props.disabled, false)
  assert.equal(button.props['aria-label'], '永久删除')
  assert.equal(tree.props.label, '永久删除')
  assert.equal(typeof button.props.onClick, 'function')
  assert.equal(button.props.style.cursor, 'pointer')
  assert.equal(button.props.style.opacity, 1)
})

test('byId 里只剩一个会话且它是当前会话：入口可点（最后一个会话也能删）', async () => {
  const { component, dictionary } = await loadRowButton()
  const sessions = sessionState({ lastOne: { retainedBy: { mainView: 1 } } })

  assert.deepEqual(sessions.ids, ['lastOne'], '前置：确实只剩一个会话')
  const button = buttonOf(render(component, { sessionId: 'lastOne', sessions, dictionary }))

  assert.equal(button.props.disabled, false)
  assert.equal(button.props['aria-label'], '永久删除')
  assert.equal(typeof button.props.onClick, 'function')
})

test('retainedBy 不参与判定：mainView 行与侧栏引用行都可点', async () => {
  const { component, dictionary } = await loadRowButton()
  const sessions = sessionState({
    current: { retainedBy: { mainView: 1 } },
    selected: { retainedBy: { mainView: 0, sidebarView: 1 } },
  })

  for (const sessionId of ['current', 'selected']) {
    const button = buttonOf(render(component, { sessionId, sessions, dictionary }))
    assert.equal(button.props.disabled, false, `${sessionId} 可点`)
    assert.equal(button.props['aria-label'], '永久删除')
  }
})

test('缺少 useSessions 标准 prop 时不抛异常且不置灰', async () => {
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
  const { component, dictionary, fetches } = await loadRowButton()
  const sessions = sessionState({ busy: { running: true } })

  const button = buttonOf(render(component, { sessionId: 'busy', sessions, dictionary }))

  assert.equal(button.props.disabled, true)
  assert.equal(button.props.onClick, undefined)
  assert.equal(fetches.length, 0)
})
