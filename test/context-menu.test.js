import assert from 'node:assert/strict'
import test from 'node:test'

import { CONTEXT_MENU_ICON_SLOT, OVERLAY_SLOT, loadPlugin } from './client-harness.js'

const SESSION_MENU_ID = 'session.delete'
const SESSION_MENU_ICON_KEY = 'session.delete'

/** The menu resolve call as the host makes it, with a signal the fake ignores. */
function resolve(app, target = { sessionId: 's-1', displayTitle: '会话标题' }) {
  return app.menuContributions[0].resolve(target, new AbortController().signal)
}

/** The shared store is observable only through the overlay entry: render it. */
function readStore(app) {
  const dialog = app.render(app.slot(OVERLAY_SLOT).component, { t: app.t })
  return dialog === null ? null : dialog.props.request
}

test('菜单项经 ctx.effect 包裹注册为 {id: session.delete, target: session, order: 700}', async () => {
  const app = await loadPlugin()

  // The locale dictionaries are registered through `ctx.effect` as well, so
  // unloading the plugin revokes them instead of leaving the namespace behind.
  assert.deepEqual(app.effects, ['delete-session: locale', 'delete-session: session menu'])
  assert.equal(app.menuContributions.length, 1, '只注册一个 contribution，不碰别人的菜单项')
  assert.equal(app.menuContributions[0].id, SESSION_MENU_ID)
  assert.equal(app.menuContributions[0].target, 'session')
  assert.equal(app.menuContributions[0].order, 700)
})

test('observe 返回 sessions.list / layout.panelInfo / locale 三个反应式源', async () => {
  const app = await loadPlugin()

  const sources = app.menuContributions[0].observe({ sessionId: 's-1', displayTitle: '会话标题' })

  assert.equal(sources.length, 3)
  assert.equal(sources[0], app.ctx.sessions.list)
  assert.equal(sources[1], app.ctx.layout.panelInfo)
  assert.equal(sources[2], app.ctx.locale)
})

test('图标 key 注册在 contextMenu.icon keyed slot，组件来自 primitives', async () => {
  const app = await loadPlugin()

  const icon = app.slot(CONTEXT_MENU_ICON_SLOT)
  assert.equal(icon.options.key, SESSION_MENU_ICON_KEY)
  assert.equal(icon.component, app.primitives.IconTrashOutlineRegular, '图标必须来自官方图标库，不自绘')
})

test('普通会话：一项、带图标/danger/分隔线、无 afterContent 与 commandId、可点', async () => {
  const app = await loadPlugin()
  app.setSessions({ 's-1': {} })

  const actions = resolve(app)

  assert.equal(actions.length, 1)
  const [action] = actions
  assert.equal(action.icon.key, SESSION_MENU_ICON_KEY)
  assert.equal(action.danger, true)
  assert.equal(action.separatorBefore, true)
  assert.equal('afterContent' in action, false, '不排在官方归档项之后之外的位置')
  assert.equal('commandId' in action, false, '菜单项不绑定快捷键命令')
  assert.notEqual(action.disabled, true)
  assert.equal(action.label, '永久删除')
  assert.equal(typeof action.run, 'function')
})

test('当前会话：一项、置灰、文案「不能删除当前会话」', async () => {
  const app = await loadPlugin()
  app.setSessions({ 's-1': { retainedBy: { mainView: 1 } } })

  const actions = resolve(app)

  assert.equal(actions.length, 1, '置灰不少一项，只是不可点')
  assert.equal(actions[0].disabled, true)
  assert.equal(actions[0].label, '不能删除当前会话')
})

test('运行中会话：一项、置灰、文案「会话正在运行，请先停止」', async () => {
  const app = await loadPlugin()
  app.setSessions({ 's-1': { running: true } })

  const actions = resolve(app)

  assert.equal(actions.length, 1)
  assert.equal(actions[0].disabled, true)
  assert.equal(actions[0].label, '会话正在运行，请先停止')
})

test('同时命中当前会话与运行中：文案取「不能删除当前会话」', async () => {
  const app = await loadPlugin()
  app.setSessions({ 's-1': { running: true, retainedBy: { mainView: 2 } } })

  const actions = resolve(app)

  assert.equal(actions.length, 1)
  assert.equal(actions[0].disabled, true)
  assert.equal(actions[0].label, '不能删除当前会话')
})

test('面板激活态下 mainView 行不置灰（当前会话判定让位于运行中判定）', async () => {
  const app = await loadPlugin()
  app.setSessions({ 's-1': { retainedBy: { mainView: 1 } } })
  app.setActivePanel('diff')

  const actions = resolve(app)

  assert.equal(actions.length, 1)
  assert.notEqual(actions[0].disabled, true)
  assert.equal(actions[0].label, '永久删除')
})

test('空白会话行：不出现该项（返回空数组，不是置灰）', async () => {
  const app = await loadPlugin()
  app.setSessions({ 's-1': { blank: true } })

  assert.equal(resolve(app).length, 0, '空白行不出现该项，不是置灰')
})

test('byId 里查不到会话：不出现该项', async () => {
  const app = await loadPlugin()
  app.setSessions({ other: {} })

  assert.equal(resolve(app, { sessionId: 'missing', displayTitle: '会话标题' }).length, 0)
})

test('点该项只把删除请求放进共享 store，不发任何请求', async () => {
  const app = await loadPlugin()
  app.setSessions({ 's-1': {} })

  resolve(app, { sessionId: 's-1', displayTitle: '会话标题' })[0].run()

  const store = readStore(app)
  assert.equal(store.sessionId, 's-1')
  assert.equal(store.displayTitle, '会话标题')
  assert.equal(app.fetches.length, 0, '删除必须等确认框里点「永久删除」')
})

test('英文界面下三项文案都是英文', async () => {
  const app = await loadPlugin({ language: 'en' })

  app.setSessions({ plain: {}, current: { retainedBy: { mainView: 1 } }, busy: { running: true } })
  assert.equal(resolve(app, { sessionId: 'plain', displayTitle: 't' })[0].label, 'Delete permanently')
  assert.equal(
    resolve(app, { sessionId: 'current', displayTitle: 't' })[0].label,
    'Cannot delete current session',
  )
  assert.equal(
    resolve(app, { sessionId: 'busy', displayTitle: 't' })[0].label,
    'Session is running; stop it first',
  )
})

test('行内按钮与菜单项共用同一个 store：菜单项入口也能打开同一个确认框', async () => {
  const app = await loadPlugin()
  app.setSessions({ 's-1': {} })

  assert.equal(readStore(app), null)
  resolve(app)[0].run()

  const store = readStore(app)
  assert.equal(store.sessionId, 's-1')
  assert.equal(store.displayTitle, '会话标题')
})
