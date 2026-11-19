import assert from 'node:assert/strict'
import { mkdir, mkdtemp, rm, stat, writeFile } from 'node:fs/promises'
import { homedir, tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import test from 'node:test'

import { apply, createDeleteHandler, inject, name, resolveSessionsRoot } from '../index.js'

const DELETE_PATH = '/delete-session/api/delete'
const SESSION_ID = 'session-bf025748-2511-430b-8ca7-e7ff95fec92a'

function makeContext({ rejection, activity = [], snapshot } = {}) {
  const state = {
    effects: 0,
    routes: [],
    registryCalls: { unarchiveSession: 0, unpinSession: 0 },
    registryIds: { unarchiveSession: [], unpinSession: [] },
    statCalls: [],
    waterfallCalls: [],
    events: [],
  }
  const ctx = {
    connection: { requestRejection: () => rejection },
    workspaceRegistry: {
      async unarchiveSession(sessionId) {
        state.registryCalls.unarchiveSession += 1
        state.registryIds.unarchiveSession.push(sessionId)
      },
      async unpinSession(sessionId) {
        state.registryCalls.unpinSession += 1
        state.registryIds.unpinSession.push(sessionId)
      },
    },
    sessionPersistence: {
      async stat(sessionId) {
        state.statCalls.push(sessionId)
        return snapshot
      },
    },
    async waterfall(event, payload) {
      state.waterfallCalls.push({ event, payload })
      return activity
    },
    webServer: {
      register(route) {
        state.routes.push(route)
        return () => {
          route.disposed = true
        }
      },
    },
    effect(callback) {
      state.effects += 1
      return callback()
    },
    emit(event, sessionId) {
      state.events.push({ event, sessionId })
    },
  }
  return { ctx, state }
}

function makeRequest({ method = 'POST', url = DELETE_PATH, body = JSON.stringify({ sessionId: SESSION_ID }) } = {}) {
  const chunks = body === '' ? [] : [Buffer.from(body, 'utf8')]
  return {
    method,
    url,
    headers: { 'content-type': 'application/json' },
    async *[Symbol.asyncIterator]() {
      yield* chunks
    },
    resume() {},
  }
}

function makeResponse() {
  return {
    statusCode: 0,
    headers: {},
    body: '',
    setHeader(key, value) {
      this.headers[key.toLowerCase()] = value
    },
    end(payload) {
      this.body = payload ?? ''
    },
  }
}

async function invoke(handler, request) {
  const response = makeResponse()
  await handler(request, response)
  return { status: response.statusCode, headers: response.headers, payload: JSON.parse(response.body) }
}

/** A temporary sessions root with one persisted session inside it. */
async function makeSessionTree(t, { project = '--cwd--', dirName = SESSION_ID } = {}) {
  const root = join(await mkdtemp(join(tmpdir(), 'dsh-delete-session-')), 'sessions')
  const sessionDir = join(root, project, dirName)
  await mkdir(sessionDir, { recursive: true })
  const logPath = join(sessionDir, 'session.v4.jsonl.zstd')
  await writeFile(logPath, '{"kind":"header"}\n')
  t.after(() => rm(dirname(root), { recursive: true, force: true }))
  return { root, sessionDir, logPath, snapshot: { location: { kind: 'jsonl', path: logPath } } }
}

async function exists(target) {
  return stat(target).then(
    () => true,
    () => false,
  )
}

function withoutDshHome(t) {
  const previous = process.env.DSH_HOME
  delete process.env.DSH_HOME
  t.after(() => {
    if (previous === undefined) delete process.env.DSH_HOME
    else process.env.DSH_HOME = previous
  })
}

test('Host 半导出 name/inject，apply 用 effect 包住 prefix 路由注册', () => {
  assert.equal(name, 'delete-session-host')
  assert.deepEqual(inject, ['webServer', 'connection', 'workspaceRegistry', 'sessionPersistence'])

  const { ctx, state } = makeContext()
  apply(ctx, { sessionsRoot: join(tmpdir(), 'unused') })

  assert.equal(state.effects, 1)
  assert.equal(state.routes.length, 1)
  assert.equal(state.routes[0].kind, 'prefix')
  assert.equal(state.routes[0].path, '/delete-session/api')
  assert.equal(typeof state.routes[0].handler, 'function')
  assert.equal(state.routes[0].handler.length, 2)
})

test('非 POST 返回 405 METHOD_NOT_ALLOWED，先于鉴权与路径判定', async () => {
  const { ctx, state } = makeContext({ rejection: 403 })
  const handler = createDeleteHandler(ctx, {})

  for (const method of ['GET', 'PUT', 'PATCH', 'DELETE']) {
    const { status, payload } = await invoke(handler, makeRequest({ method }))
    assert.equal(status, 405, `method=${method}`)
    assert.deepEqual(payload, { ok: false, code: 'METHOD_NOT_ALLOWED' })
  }
  assert.deepEqual(state.waterfallCalls, [])
  assert.deepEqual(state.statCalls, [])
  assert.deepEqual(state.registryCalls, { unarchiveSession: 0, unpinSession: 0 })
})

test('同源放行判定拒绝时返回其 HTTP 状态与 REJECTED 码，先于路径判定', async () => {
  const forbidden = makeContext({ rejection: 403 })
  const forbiddenResult = await invoke(createDeleteHandler(forbidden.ctx, {}), makeRequest())
  assert.equal(forbiddenResult.status, 403)
  assert.equal(forbiddenResult.payload.ok, false)
  assert.equal(forbiddenResult.payload.code, 'REJECTED')
  assert.equal(typeof forbiddenResult.payload.message, 'string')
  assert.notEqual(forbiddenResult.payload.message, '')
  assert.deepEqual(forbidden.state.statCalls, [])

  const unauthenticated = await invoke(createDeleteHandler(makeContext({ rejection: 401 }).ctx, {}), makeRequest())
  assert.equal(unauthenticated.status, 401)
  assert.equal(unauthenticated.payload.code, 'REJECTED')

  const offPath = await invoke(
    createDeleteHandler(forbidden.ctx, {}),
    makeRequest({ url: '/delete-session/api/other' }),
  )
  assert.equal(offPath.status, 403)
  assert.equal(offPath.payload.code, 'REJECTED')
})

test('未知路径返回 404 NOT_FOUND', async () => {
  const handler = createDeleteHandler(makeContext().ctx, {})

  for (const url of ['/delete-session/api/other', '/delete-session/api/delete/extra', '/delete-session', '/other']) {
    const { status, payload } = await invoke(handler, makeRequest({ url }))
    assert.equal(status, 404, `url=${url}`)
    assert.deepEqual(payload, { ok: false, code: 'NOT_FOUND' })
  }
})

test('缺失、非字符串或空白的 sessionId 返回 400 INVALID_SESSION_ID', async () => {
  const { ctx, state } = makeContext()
  const handler = createDeleteHandler(ctx, {})

  const bodies = [
    '{}',
    '{"sessionId":42}',
    '{"sessionId":null}',
    '{"sessionId":""}',
    '{"sessionId":"   "}',
    '{"sessionId":{}}',
    '',
    'not json',
    'null',
    '[]',
  ]
  for (const body of bodies) {
    const { status, payload } = await invoke(handler, makeRequest({ body }))
    assert.equal(status, 400, `body=${body}`)
    assert.deepEqual(payload, { ok: false, code: 'INVALID_SESSION_ID' })
  }
  assert.deepEqual(state.waterfallCalls, [])
  assert.deepEqual(state.statCalls, [])
})

test('删除普通会话：目录与日志一起消失，归档与置顶各清一次', async (t) => {
  const tree = await makeSessionTree(t)
  const { ctx, state } = makeContext({ snapshot: tree.snapshot })

  const { status, headers, payload } = await invoke(
    createDeleteHandler(ctx, { sessionsRoot: tree.root }),
    makeRequest(),
  )

  assert.equal(status, 200)
  assert.deepEqual(payload, { ok: true, code: 'OK' })
  assert.equal(headers['content-type'], 'application/json; charset=utf-8')
  assert.equal(await exists(tree.sessionDir), false, '会话目录应已消失')
  assert.equal(await exists(dirname(tree.sessionDir)), true, 'project 目录本身应保留')
  assert.deepEqual(state.registryCalls, { unarchiveSession: 1, unpinSession: 1 })
  assert.deepEqual(state.registryIds.unarchiveSession, [SESSION_ID])
  assert.deepEqual(state.registryIds.unpinSession, [SESSION_ID])
  assert.deepEqual(state.waterfallCalls, [{ event: 'workspace/session-activity', payload: { sessionId: SESSION_ID } }])
  assert.deepEqual(state.statCalls, [SESSION_ID])
})

test('session-<uuid> 之外的目录名同样被删：删除只看 stat 定位，不猜命名形态', async (t) => {
  const tree = await makeSessionTree(t, { dirName: 'bf025748-2511-430b-8ca7-e7ff95fec92a' })
  const { ctx, state } = makeContext({ snapshot: tree.snapshot })

  const { status, payload } = await invoke(createDeleteHandler(ctx, { sessionsRoot: tree.root }), makeRequest())

  assert.equal(status, 200)
  assert.equal(payload.code, 'OK')
  assert.equal(await exists(tree.sessionDir), false)
  assert.deepEqual(state.registryCalls, { unarchiveSession: 1, unpinSession: 1 })
})

test('未落盘的 pending 会话（快照无 location）返回 404，磁盘与 registry 都不动', async (t) => {
  const tree = await makeSessionTree(t)
  const { ctx, state } = makeContext({ snapshot: {} })

  const { status, payload } = await invoke(createDeleteHandler(ctx, { sessionsRoot: tree.root }), makeRequest())

  assert.equal(status, 404)
  assert.equal(payload.ok, false)
  assert.equal(payload.code, 'SESSION_NOT_FOUND')
  assert.equal(typeof payload.message, 'string')
  assert.equal(await exists(tree.logPath), true, '日志文件不应被碰')
  assert.deepEqual(state.registryCalls, { unarchiveSession: 0, unpinSession: 0 })
})

test('持久化层查不到会话（stat 返回 undefined）返回 404 SESSION_NOT_FOUND', async (t) => {
  const tree = await makeSessionTree(t)
  const { ctx, state } = makeContext({ snapshot: undefined })

  const { status, payload } = await invoke(createDeleteHandler(ctx, { sessionsRoot: tree.root }), makeRequest())

  assert.equal(status, 404)
  assert.equal(payload.code, 'SESSION_NOT_FOUND')
  assert.equal(await exists(tree.logPath), true)
  assert.deepEqual(state.registryCalls, { unarchiveSession: 0, unpinSession: 0 })
})

test('活动闸门非空返回 409 SESSION_ACTIVE，在任何文件操作之前中止', async (t) => {
  const tree = await makeSessionTree(t)
  const { ctx, state } = makeContext({ activity: [{ kind: 'turn' }], snapshot: tree.snapshot })

  const { status, payload } = await invoke(createDeleteHandler(ctx, { sessionsRoot: tree.root }), makeRequest())

  assert.equal(status, 409)
  assert.equal(payload.ok, false)
  assert.equal(payload.code, 'SESSION_ACTIVE')
  assert.equal(typeof payload.message, 'string')
  assert.notEqual(payload.message, '')
  assert.deepEqual(state.statCalls, [], '定位都不能发生，更不用说删盘')
  assert.equal(await exists(tree.sessionDir), true)
  assert.deepEqual(state.registryCalls, { unarchiveSession: 0, unpinSession: 0 })
})

test('递归删除抛错返回 500 DELETE_FAILED 并带上真实原因', async (t) => {
  const tree = await makeSessionTree(t)
  const { ctx, state } = makeContext({ snapshot: tree.snapshot })
  const failingRm = async () => {
    const error = new Error('EBUSY: resource busy or locked, rmdir sessions')
    error.code = 'EBUSY'
    throw error
  }

  const { status, payload } = await invoke(
    createDeleteHandler(ctx, { sessionsRoot: tree.root }, { rm: failingRm }),
    makeRequest(),
  )

  assert.equal(status, 500)
  assert.equal(payload.ok, false)
  assert.equal(payload.code, 'DELETE_FAILED')
  assert.match(payload.message, /EBUSY/)
  assert.equal(await exists(tree.logPath), true, '删除失败时目录保持原样')
  assert.deepEqual(state.registryCalls, { unarchiveSession: 0, unpinSession: 0 })
})

test('stat 定位到的目录在 sessions 根之外返回 500 DELETE_FAILED，不删', async (t) => {
  const base = await mkdtemp(join(tmpdir(), 'dsh-delete-session-'))
  t.after(() => rm(base, { recursive: true, force: true }))
  const outsideDir = join(base, 'outside', SESSION_ID)
  await mkdir(outsideDir, { recursive: true })
  const outsideLog = join(outsideDir, 'session.v4.jsonl.zstd')
  await writeFile(outsideLog, 'log')
  const root = join(base, 'sessions')
  await mkdir(root, { recursive: true })

  const { ctx, state } = makeContext({ snapshot: { location: { kind: 'jsonl', path: outsideLog } } })
  const { status, payload } = await invoke(createDeleteHandler(ctx, { sessionsRoot: root }), makeRequest())

  assert.equal(status, 500)
  assert.equal(payload.code, 'DELETE_FAILED')
  assert.match(payload.message, /sessions 根/)
  assert.equal(await exists(outsideDir), true, '根外目录必须原样保留')
  assert.deepEqual(state.registryCalls, { unarchiveSession: 0, unpinSession: 0 })
})

test('从未归档、从未置顶的会话：两个清理照常各调一次且不报错', async (t) => {
  const tree = await makeSessionTree(t)
  const { ctx } = makeContext({ snapshot: tree.snapshot })

  const { status, payload } = await invoke(createDeleteHandler(ctx, { sessionsRoot: tree.root }), makeRequest())

  assert.equal(status, 200)
  assert.equal(payload.code, 'OK')
  assert.equal(await exists(tree.sessionDir), false)
})

test('Windows 大小写不敏感：根与 stat 路径大小写不同仍判为根内', { skip: process.platform !== 'win32' }, async (t) => {
  const tree = await makeSessionTree(t)
  const shouty = { location: { kind: 'jsonl', path: tree.logPath.toUpperCase() } }
  const { ctx } = makeContext({ snapshot: shouty })

  const { status, payload } = await invoke(createDeleteHandler(ctx, { sessionsRoot: tree.root }), makeRequest())

  assert.equal(status, 200)
  assert.equal(payload.code, 'OK')
  assert.equal(await exists(tree.sessionDir), false)
})

test('resolveSessionsRoot：未配置且 $DSH_HOME 未设时回落到 ~/.dsh/sessions', (t) => {
  withoutDshHome(t)
  assert.equal(resolveSessionsRoot({}), join(homedir(), '.dsh', 'sessions'))
  assert.equal(resolveSessionsRoot(undefined), join(homedir(), '.dsh', 'sessions'))
})

test('resolveSessionsRoot：$DSH_HOME 生效，纯空白视为未设', (t) => {
  withoutDshHome(t)
  const home = join(tmpdir(), 'dsh-home-probe')
  process.env.DSH_HOME = home
  assert.equal(resolveSessionsRoot({}), join(home, 'sessions'))

  process.env.DSH_HOME = '   '
  assert.equal(resolveSessionsRoot({}), join(homedir(), '.dsh', 'sessions'))
})

test('resolveSessionsRoot：显式配置优先于 $DSH_HOME', (t) => {
  const previous = process.env.DSH_HOME
  process.env.DSH_HOME = join(tmpdir(), 'dsh-home-from-env')
  t.after(() => {
    if (previous === undefined) delete process.env.DSH_HOME
    else process.env.DSH_HOME = previous
  })
  const configured = join(tmpdir(), 'sessions-root-from-config')

  assert.equal(resolveSessionsRoot({ sessionsRoot: configured }), resolve(configured))
})

test('删除成功后向客户端广播 api-session/removed：Host 列表仍含驻留会话，不广播侧栏就不会消失', async (t) => {
  const tree = await makeSessionTree(t)
  const { ctx, state } = makeContext({ snapshot: tree.snapshot })
  const handler = createDeleteHandler(ctx, { sessionsRoot: tree.root })
  const res = makeResponse()

  await handler(makeRequest(), res)

  assert.equal(res.statusCode, 200)
  assert.deepEqual(state.events, [{ event: 'api-session/removed', sessionId: SESSION_ID }])
})

test('会话不存在时也广播 api-session/removed：清掉此前遗留的幽灵行', async () => {
  const { ctx, state } = makeContext({ snapshot: undefined })
  const handler = createDeleteHandler(ctx, { sessionsRoot: join(tmpdir(), 'unused-root') })
  const res = makeResponse()

  await handler(makeRequest(), res)

  assert.equal(res.statusCode, 404)
  assert.deepEqual(state.events, [{ event: 'api-session/removed', sessionId: SESSION_ID }])
})

test('删除失败（rm 抛错）不广播：会话还在，不能骗客户端把行删掉', async (t) => {
  const tree = await makeSessionTree(t)
  const { ctx, state } = makeContext({ snapshot: tree.snapshot })
  const handler = createDeleteHandler(ctx, { sessionsRoot: tree.root }, {
    rm: async () => { throw new Error('EPERM: operation not permitted') },
  })
  const res = makeResponse()

  await handler(makeRequest(), res)

  assert.equal(res.statusCode, 500)
  assert.deepEqual(state.events, [])
})
