import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

import { apply, createDeleteHandler, inject, name } from '../index.js'

const DELETE_PATH = '/delete-session/api/delete'

function makeContext({ rejection } = {}) {
  const state = {
    effects: 0,
    routes: [],
    registryCalls: { unarchiveSession: 0, unpinSession: 0 },
  }
  const ctx = {
    connection: { requestRejection: () => rejection },
    workspaceRegistry: {
      unarchiveSession() {
        state.registryCalls.unarchiveSession += 1
      },
      unpinSession() {
        state.registryCalls.unpinSession += 1
      },
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
  }
  return { ctx, state }
}

function makeRequest({ method = 'POST', url = DELETE_PATH, body = '{"sessionId":"s-1"}' } = {}) {
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

test('Host 半导出 name/inject，apply 用 effect 包住 prefix 路由注册', () => {
  assert.equal(name, 'delete-session-host')
  assert.deepEqual(inject, ['webServer', 'connection', 'workspaceRegistry'])

  const { ctx, state } = makeContext()
  apply(ctx)

  assert.equal(state.effects, 1)
  assert.equal(state.routes.length, 1)
  assert.equal(state.routes[0].kind, 'prefix')
  assert.equal(state.routes[0].path, '/delete-session/api')
  assert.equal(typeof state.routes[0].handler, 'function')
  assert.equal(state.routes[0].handler.length, 2)
})

test('非 POST 返回 405 METHOD_NOT_ALLOWED，先于鉴权与路径判定', async () => {
  const handler = createDeleteHandler(makeContext({ rejection: 403 }).ctx)

  for (const method of ['GET', 'PUT', 'PATCH', 'DELETE']) {
    const { status, payload } = await invoke(handler, makeRequest({ method }))
    assert.equal(status, 405, `method=${method}`)
    assert.deepEqual(payload, { ok: false, code: 'METHOD_NOT_ALLOWED' })
  }
})

test('同源放行判定拒绝时返回其 HTTP 状态与 REJECTED 码，先于路径判定', async () => {
  const forbidden = makeContext({ rejection: 403 })
  const forbiddenResult = await invoke(createDeleteHandler(forbidden.ctx), makeRequest())
  assert.equal(forbiddenResult.status, 403)
  assert.equal(forbiddenResult.payload.ok, false)
  assert.equal(forbiddenResult.payload.code, 'REJECTED')
  assert.equal(typeof forbiddenResult.payload.message, 'string')
  assert.notEqual(forbiddenResult.payload.message, '')

  const unauthenticated = await invoke(createDeleteHandler(makeContext({ rejection: 401 }).ctx), makeRequest())
  assert.equal(unauthenticated.status, 401)
  assert.equal(unauthenticated.payload.code, 'REJECTED')

  const offPath = await invoke(createDeleteHandler(forbidden.ctx), makeRequest({ url: '/delete-session/api/other' }))
  assert.equal(offPath.status, 403)
  assert.equal(offPath.payload.code, 'REJECTED')
})

test('未知路径返回 404 NOT_FOUND', async () => {
  const handler = createDeleteHandler(makeContext().ctx)

  for (const url of ['/delete-session/api/other', '/delete-session/api/delete/extra', '/delete-session', '/other']) {
    const { status, payload } = await invoke(handler, makeRequest({ url }))
    assert.equal(status, 404, `url=${url}`)
    assert.deepEqual(payload, { ok: false, code: 'NOT_FOUND' })
  }
})

test('缺失、非字符串或空白的 sessionId 返回 400 INVALID_SESSION_ID', async () => {
  const handler = createDeleteHandler(makeContext().ctx)

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
})

test('合法请求返回 200 OK，且不触碰 registry 或文件系统', async () => {
  const { ctx, state } = makeContext()

  const { status, headers, payload } = await invoke(
    createDeleteHandler(ctx),
    makeRequest({ body: '{"sessionId":"  s-1  "}' }),
  )

  assert.equal(status, 200)
  assert.deepEqual(payload, { ok: true, code: 'OK' })
  assert.equal(headers['content-type'], 'application/json; charset=utf-8')
  assert.deepEqual(state.registryCalls, { unarchiveSession: 0, unpinSession: 0 })

  const source = await readFile(new URL('../index.js', import.meta.url), 'utf8')
  assert.equal(/from\s+['"]node:fs/.test(source), false, 'index.js 不应 import node:fs')
  assert.equal(/from\s+['"]fs/.test(source), false, 'index.js 不应 import fs')
})
