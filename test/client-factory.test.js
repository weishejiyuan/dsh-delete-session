import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

import {
  CONTEXT_MENU_ICON_SLOT,
  OVERLAY_SLOT,
  PACKAGE_ID,
  ROW_ACTION_SLOT,
  loadPlugin,
  loadRegistration,
} from './client-harness.js'

test('顶层同步注册工厂包，id 等于包名', async () => {
  const pkg = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'))
  const registration = await loadRegistration()

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
  const app = await loadPlugin()

  assert.equal(app.locales.length, 1)
  const [locale] = app.locales
  assert.equal(locale.ns, 'deleteSession')
  assert.deepEqual(Object.keys(locale.dicts).sort(), ['en', 'zh'])
  for (const language of ['zh', 'en']) {
    assert.equal(typeof locale.dicts[language]['label.deletePermanently'], 'string')
    assert.notEqual(locale.dicts[language]['label.deletePermanently'].trim(), '', `${language} 按钮标签不得为空`)
    assert.equal(typeof locale.dicts[language].deleted, 'string')
    assert.notEqual(locale.dicts[language].deleted.trim(), '', `${language} 成功提示不得为空`)
  }

  assert.deepEqual(app.injections, [ROW_ACTION_SLOT, OVERLAY_SLOT, CONTEXT_MENU_ICON_SLOT])
  assert.equal(app.slotRegistrations.length, 3)

  const options = app.slot(ROW_ACTION_SLOT).options
  assert.equal(options.id, 'delete-session')
  assert.equal(options.order, 300)
  assert.equal(options.locale, 'deleteSession')
  assert.equal('priority' in options, false, 'list slot 不应传 priority')

  const overlay = app.slot(OVERLAY_SLOT).options
  assert.equal(overlay.id, 'delete-session.confirm')
  assert.equal(overlay.locale, 'deleteSession')
  assert.equal('priority' in overlay, false, 'overlay 条目不应传 priority')
})

test('行内按钮是纯图标 + 500ms Tooltip + aria-label', async () => {
  const app = await loadPlugin()

  const { component } = app.slot(ROW_ACTION_SLOT)
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
  const app = await loadPlugin()

  const button = app
    .slot(ROW_ACTION_SLOT)
    .component({ sessionId: 's-1', displayTitle: '会话标题', t: (key) => `t:${key}` })
    .children[0]
  button.props.onClick()
  await new Promise((resolve) => setImmediate(resolve))

  assert.equal(app.fetches.length, 0, '删除必须等确认框里点「永久删除」')
  assert.deepEqual(app.notifications, [])

  const dialog = app.render(app.slot(OVERLAY_SLOT).component, { t: (key) => `t:${key}` })
  assert.equal(dialog.props.request.sessionId, 's-1')
  assert.equal(dialog.props.request.displayTitle, '会话标题')
})
