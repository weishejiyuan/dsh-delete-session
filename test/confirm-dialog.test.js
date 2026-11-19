import assert from 'node:assert/strict'
import test from 'node:test'

import {
  OVERLAY_SLOT,
  ROW_ACTION_SLOT,
  jsonResponse,
  loadPlugin,
  sessionState,
  settle,
} from './client-harness.js'

const DANGER_TEXT_COLOR = 'var(--dsw-alias-state-error-primary)'

const IDLE_SESSIONS = sessionState({ 's-1': {} })

function renderRow(app, { sessionId = 's-1', displayTitle = '会话标题', sessions = IDLE_SESSIONS } = {}) {
  return app.render(app.slot(ROW_ACTION_SLOT).component, {
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
  const form = app.render(app.slot(OVERLAY_SLOT).component, { t })
  if (form === null) return null
  const modal = app.render(form.type, form.props)
  const [cancel, confirm] = modal.props.footer.children
  return { form, modal, cancel, confirm, request: form.props.request }
}

test('确认框未打开时 shell.overlay 条目返回 null，不常驻空浮层', async () => {
  const loaded = await loadPlugin()

  assert.equal(loaded.render(loaded.slot(OVERLAY_SLOT).component, { t: loaded.t }), null)
})

test('点行内按钮只把删除请求放进共享 store，不发任何请求、不弹提示', async () => {
  const loaded = await loadPlugin()

  openFromRow(loaded)

  assert.equal(loaded.fetches.length, 0)
  assert.equal(loaded.notifications.length, 0)
  const dialog = renderDialog(loaded)
  assert.notEqual(dialog, null, '点按钮后应能打开确认框')
  assert.equal(dialog.request.sessionId, 's-1')
  assert.equal(dialog.request.displayTitle, '会话标题')
})

test('置灰行点击不打开 store', async () => {
  const loaded = await loadPlugin()
  const sessions = sessionState({ 's-1': { running: true } })

  const button = renderRow(loaded, { sessions }).children[0]

  assert.equal(button.props.disabled, true)
  assert.equal(button.props.onClick, undefined)
  assert.equal(loaded.render(loaded.slot(OVERLAY_SLOT).component, { t: loaded.t }), null)
})

test('确认框显示标题与含会话标题的不可撤销说明，取消在左、永久删除在右', async () => {
  const loaded = await loadPlugin()
  openFromRow(loaded)

  const { modal, cancel, confirm } = renderDialog(loaded)

  assert.equal(modal.type, loaded.primitives.Modal)
  assert.equal(modal.props.open, true)
  assert.equal(modal.props.title, '永久删除会话')
  assert.equal(modal.props.description, '将永久删除「会话标题」，此操作不可撤销。')
  assert.deepEqual(modal.props.footer.children.map((button) => button.children[0]), ['取消', '永久删除'])
  assert.equal(cancel.type, loaded.primitives.Button)
  assert.equal(confirm.type, loaded.primitives.Button)
})

test('「永久删除」是描边样式配红色文字，不是实心红块', async () => {
  const loaded = await loadPlugin()
  openFromRow(loaded)

  const { confirm } = renderDialog(loaded)

  assert.equal(confirm.props.variant, 'outline')
  assert.equal(confirm.props.style.color, DANGER_TEXT_COLOR)
  assert.equal('background' in confirm.props.style, false)
})

test('英文界面下确认框的标题、说明与两个按钮文案都正确', async () => {
  const loaded = await loadPlugin()
  openFromRow(loaded)

  const modal = renderDialog(loaded, { t: loaded.translator('en') }).modal

  assert.equal(modal.props.title, 'Delete session permanently')
  assert.equal(modal.props.description, '「会话标题」 will be deleted permanently. This cannot be undone.')
  assert.deepEqual(modal.props.footer.children.map((button) => button.children[0]), ['Cancel', 'Delete permanently'])
})

test('点取消：关框、store 清空、不发请求、不弹提示', async () => {
  const loaded = await loadPlugin()
  openFromRow(loaded)
  const { cancel } = renderDialog(loaded)

  cancel.props.onClick()

  assert.equal(loaded.fetches.length, 0, '取消不得发送任何到 Host 的请求')
  assert.equal(loaded.notifications.length, 0, '取消不得有任何提示打扰')
  assert.equal(renderDialog(loaded), null, '取消后 store 应清空')
})

test('Esc / 点遮罩（onClose）等同于取消，不执行删除', async () => {
  const loaded = await loadPlugin()
  openFromRow(loaded)
  const { modal } = renderDialog(loaded)

  assert.equal(typeof modal.props.onClose, 'function')
  modal.props.onClose()

  assert.equal(loaded.fetches.length, 0)
  assert.equal(loaded.notifications.length, 0)
  assert.equal(renderDialog(loaded), null)
})

test('点永久删除：恰好一次 POST，成功后关框并提示「会话已永久删除」', async () => {
  const loaded = await loadPlugin()
  openFromRow(loaded)
  const { confirm } = renderDialog(loaded)

  confirm.props.onClick()
  await settle()

  assert.equal(loaded.fetches.length, 1)
  assert.equal(loaded.fetches[0].url, '/delete-session/api/delete')
  assert.equal(loaded.fetches[0].options.method, 'POST')
  assert.equal(loaded.fetches[0].options.headers['content-type'], 'application/json')
  assert.deepEqual(JSON.parse(loaded.fetches[0].options.body), { sessionId: 's-1' })
  assert.deepEqual(loaded.notifications, [{ text: '会话已永久删除', success: true }])
  assert.equal(renderDialog(loaded), null, '成功后 store 应清空')
})

test('请求进行中：独立状态行显示「正在删除…」、按钮文案不变、两按钮禁用、连点不产生第二个请求', async () => {
  let release
  const loaded = await loadPlugin({ fetchImpl: () => new Promise((resolve) => { release = resolve }) })
  openFromRow(loaded)
  const first = renderDialog(loaded)

  first.confirm.props.onClick()
  assert.equal(loaded.fetches.length, 1)

  // 同一个闭包连点第二次（React 还没来得及重渲染时的那一次点击）。
  first.confirm.props.onClick()
  assert.equal(loaded.fetches.length, 1, '连点两次只发一个请求')

  const pending = renderDialog(loaded)
  assert.equal(pending.confirm.children[0], '永久删除', '进行中按钮仍显示动作名，进度由状态行承担')
  assert.equal(pending.modal.children[0].props.role, 'status', '进度必须是独立的 role=status 行')
  assert.equal(pending.modal.children[0].children[0], '正在删除…')
  assert.equal(pending.confirm.props.disabled, true)
  assert.equal(pending.cancel.props.disabled, true)
  assert.equal(pending.confirm.props.style, undefined, '禁用态不得继续带危险红字')

  pending.confirm.props.onClick()
  first.cancel.props.onClick()
  pending.cancel.props.onClick()
  assert.equal(loaded.fetches.length, 1)
  assert.notEqual(renderDialog(loaded), null, '进行中既不能重发也不能关框')

  release(jsonResponse({ ok: true, code: 'OK' }))
  await settle()
  assert.deepEqual(loaded.notifications, [{ text: '会话已永久删除', success: true }])
})

test('409 SESSION_ACTIVE：框保持打开、不弹提示、框内显示「会话正在运行，请先停止」', async () => {
  const loaded = await loadPlugin({
    fetchImpl: async () => jsonResponse({ ok: false, code: 'SESSION_ACTIVE', message: '会话正在运行，请先停止' }, 409),
  })
  openFromRow(loaded)
  const { confirm } = renderDialog(loaded)

  confirm.props.onClick()
  await settle()

  assert.equal(loaded.notifications.length, 0)
  const failed = renderDialog(loaded)
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
    const loaded = await loadPlugin({ fetchImpl: async () => jsonResponse(body) })
    openFromRow(loaded)
    const { confirm } = renderDialog(loaded)

    confirm.props.onClick()
    await settle()

    const line = renderDialog(loaded).modal.children[0].children[0]
    assert.equal(line, expected, `${body.code} 的框内文案`)
  }
})

test('网络异常：框内显示「删除失败」加原始消息', async () => {
  const loaded = await loadPlugin({
    fetchImpl: async () => {
      throw new Error('Failed to fetch')
    },
  })
  openFromRow(loaded)
  const { confirm } = renderDialog(loaded)

  confirm.props.onClick()
  await settle()

  assert.equal(loaded.notifications.length, 0)
  assert.equal(renderDialog(loaded).modal.children[0].children[0], '删除失败 — Failed to fetch')
})

/** A response whose body is an HTML error page instead of the endpoint's JSON. */
function nonJsonResponse(status) {
  return {
    status,
    json: async () => {
      throw new SyntaxError('Unexpected token \'<\', "<html><head" is not valid JSON')
    },
  }
}

test('非 2xx 且响应体不是 JSON：文案回落为「删除失败 — HTTP <status>」，不暴露解析器错误', async () => {
  const loaded = await loadPlugin({ fetchImpl: async () => nonJsonResponse(502) })
  openFromRow(loaded)
  const { confirm } = renderDialog(loaded)

  confirm.props.onClick()
  await settle()

  assert.equal(loaded.notifications.length, 0)
  const line = renderDialog(loaded).modal.children[0].children[0]
  assert.equal(line, '删除失败 — HTTP 502')
  assert.doesNotMatch(line, /Unexpected token|is not valid JSON|SyntaxError/)
})

test('2xx 但响应体不是 JSON：同样回落为 HTTP 状态，不当作成功也不暴露解析器错误', async () => {
  for (const response of [nonJsonResponse(200), { status: 200, json: async () => null }]) {
    const loaded = await loadPlugin({ fetchImpl: async () => response })
    openFromRow(loaded)
    const { confirm } = renderDialog(loaded)

    confirm.props.onClick()
    await settle()

    assert.equal(loaded.notifications.length, 0, 'body 不可读时不得提示成功')
    const line = renderDialog(loaded).modal.children[0].children[0]
    assert.equal(line, '删除失败 — HTTP 200')
    assert.doesNotMatch(line, /Unexpected token|is not valid JSON|SyntaxError/)
  }
})

test('四个前置守卫码落到可读兜底：有 message 拼上原因，无 message 只显示「删除失败」', async () => {
  const cases = [
    [{ ok: false, code: 'METHOD_NOT_ALLOWED' }, 405, '删除失败'],
    [{ ok: false, code: 'INVALID_SESSION_ID' }, 400, '删除失败'],
    [{ ok: false, code: 'NOT_FOUND' }, 404, '删除失败'],
    [{ ok: false, code: 'REJECTED', message: 'request rejected (403)' }, 403, '删除失败 — request rejected (403)'],
  ]

  for (const [body, status, expected] of cases) {
    const loaded = await loadPlugin({ fetchImpl: async () => jsonResponse(body, status) })
    openFromRow(loaded)
    const { confirm } = renderDialog(loaded)

    confirm.props.onClick()
    await settle()

    const line = renderDialog(loaded).modal.children[0].children[0]
    assert.equal(line, expected, `${body.code} 的框内文案`)
    assert.equal(line.includes(body.code), false, `${body.code} 不得作为机器码漏给用户`)
  }
})

test('确认框注册到 shell.overlay：id / locale 正确，不传 priority', async () => {
  const loaded = await loadPlugin()

  const overlay = loaded.slot(OVERLAY_SLOT).options
  assert.equal(overlay.name, OVERLAY_SLOT)
  assert.equal(overlay.id, 'delete-session.confirm')
  assert.equal(overlay.locale, 'deleteSession')
  assert.equal('priority' in overlay, false, 'overlay 条目不应传 priority')

  const row = loaded.slot(ROW_ACTION_SLOT).options
  assert.equal(row.order, 300, '行内按钮保持 order 300')
  assert.equal('priority' in row, false)
})

test('两个 locale 字典覆盖全部 key，中英都非空且既有文案未改', async () => {
  const loaded = await loadPlugin()
  const keys = [
    'label.deletePermanently',
    'label.deleteCurrentDisabled',
    'confirm.title',
    'confirm.desc',
    'confirm.action',
    'confirm.pending',
    'cancel',
    'close',
    'deleted',
    'sessionActive',
    'sessionNotFound',
    'deleteFailed',
  ]

  for (const language of ['zh', 'en']) {
    assert.deepEqual(Object.keys(loaded.dictionary[language]).sort(), [...keys].sort(), `${language} 字典的 key 集`)
    for (const key of keys) {
      const value = loaded.dictionary[language][key]
      assert.equal(typeof value, 'string', `${language} ${key} 应为字符串`)
      assert.notEqual(value.trim(), '', `${language} ${key} 不得为空串`)
    }
  }

  assert.equal(loaded.dictionary.zh['label.deletePermanently'], '永久删除')
  assert.equal(loaded.dictionary.zh['label.deleteCurrentDisabled'], '不能删除当前会话')
  assert.equal(loaded.dictionary.zh.sessionActive, '会话正在运行，请先停止')
  assert.equal(loaded.dictionary.zh.deleted, '会话已永久删除')
  assert.equal(loaded.dictionary.zh['confirm.title'], '永久删除会话')
  assert.equal(loaded.dictionary.zh['confirm.desc'], '将永久删除「{title}」，此操作不可撤销。')
  assert.equal(loaded.dictionary.zh['confirm.action'], '永久删除')
  assert.equal(loaded.dictionary.zh['confirm.pending'], '正在删除…')
  assert.equal(loaded.dictionary.zh.cancel, '取消')
  assert.equal(loaded.dictionary.zh.sessionNotFound, '会话不存在，可能已被删除')
  assert.equal(loaded.dictionary.zh.deleteFailed, '删除失败')
  assert.match(loaded.dictionary.en['confirm.desc'], /\{title\}/, '英文说明同样要保留 {title} 占位')
})
