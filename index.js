/**
 * Host half. Mounts the HTTP endpoint the client half posts to and performs the
 * four-step deletion in this fixed order: activity gate, recursive directory
 * removal, archive-set cleanup, pin-set cleanup.
 *
 * The session is located through `sessionPersistence.stat` — the authoritative
 * answer to "where does this session live on disk". The configured sessions
 * root is only a fence that decides whether the located directory may be
 * deleted, never a directory name to guess at.
 */

import { rm as realRm } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'

import z from '@deepseek-ai/schemastery'

export const name = 'delete-session-host'

export const inject = ['webServer', 'connection', 'workspaceRegistry', 'sessionPersistence']

export const Config = z.object({ sessionsRoot: z.string() })

const ROUTE_PREFIX = '/delete-session/api'
const DELETE_PATH = `${ROUTE_PREFIX}/delete`
const MAX_BODY_BYTES = 64 * 1024

export function apply(ctx, config) {
  const handler = createDeleteHandler(ctx, config)
  ctx.effect(() => ctx.webServer.register({ kind: 'prefix', path: ROUTE_PREFIX, handler }), 'delete-session: api')
}

/**
 * Resolves the directory every deletion is fenced inside. A configured
 * `sessionsRoot` is that directory; without one the default is derived the way
 * `dsh-home-paths` resolves the DSH home (`$DSH_HOME`, blank counting as unset,
 * then `~/.dsh`) with `sessions` appended.
 */
export function resolveSessionsRoot(config) {
  const configured = config?.sessionsRoot
  if (typeof configured === 'string' && configured.trim() !== '') return resolve(configured)

  const fromEnv = process.env.DSH_HOME
  const home = typeof fromEnv === 'string' && fromEnv.trim() !== '' ? fromEnv : join(homedir(), '.dsh')
  return resolve(join(home, 'sessions'))
}

/**
 * Builds the route handler from the host context so tests can drive it without
 * starting a web server. `rm` is the only injected dependency: the recursive
 * removal has no other seam that fails on demand.
 */
export function createDeleteHandler(ctx, config, { rm = realRm } = {}) {
  return async function deleteSessionHandler(req, res) {
    if (req.method !== 'POST') return sendJson(res, 405, { ok: false, code: 'METHOD_NOT_ALLOWED' })

    const rejection = ctx.connection.requestRejection(req)
    if (rejection !== undefined) {
      return sendJson(res, rejection, { ok: false, code: 'REJECTED', message: `request rejected (${rejection})` })
    }

    if (pathnameOf(req.url) !== DELETE_PATH) return sendJson(res, 404, { ok: false, code: 'NOT_FOUND' })

    const sessionId = await readSessionId(req)
    if (sessionId === undefined) return sendJson(res, 400, { ok: false, code: 'INVALID_SESSION_ID' })

    const activity = await ctx.waterfall('workspace/session-activity', { sessionId }, () => Promise.resolve([]))
    if (activity.length > 0) {
      return sendJson(res, 409, { ok: false, code: 'SESSION_ACTIVE', message: '会话正在运行，请先停止' })
    }

    const snapshot = await ctx.sessionPersistence.stat(sessionId)
    const logPath = snapshot?.location?.path
    if (typeof logPath !== 'string' || logPath.trim() === '') {
      return sendJson(res, 404, { ok: false, code: 'SESSION_NOT_FOUND', message: '会话不存在，可能已被删除' })
    }

    const sessionDir = resolve(dirname(logPath))
    const sessionsRoot = resolveSessionsRoot(config)
    if (!isWithin(sessionsRoot, sessionDir)) {
      return sendJson(res, 500, {
        ok: false,
        code: 'DELETE_FAILED',
        message: `目标目录不在 sessions 根内：${sessionDir}`,
      })
    }

    try {
      await rm(sessionDir, { recursive: true, force: true })
      await ctx.workspaceRegistry.unarchiveSession(sessionId)
      await ctx.workspaceRegistry.unpinSession(sessionId)
    } catch (error) {
      return sendJson(res, 500, { ok: false, code: 'DELETE_FAILED', message: reasonOf(error) })
    }

    return sendJson(res, 200, { ok: true, code: 'OK' })
  }
}

/** A path is inside the root only when it is strictly below it, on one drive. */
function isWithin(root, target) {
  const fold = process.platform === 'win32' ? (value) => value.toLowerCase() : (value) => value
  const step = relative(fold(root), fold(target))
  if (step === '' || step === '..' || isAbsolute(step)) return false
  return !step.startsWith(`..${sep}`)
}

function reasonOf(error) {
  return error instanceof Error ? error.message : String(error)
}

function sendJson(res, status, payload) {
  res.statusCode = status
  res.setHeader('content-type', 'application/json; charset=utf-8')
  res.setHeader('cache-control', 'no-store')
  res.end(JSON.stringify(payload))
}

function pathnameOf(url) {
  return new URL(url ?? '/', 'http://localhost').pathname
}

async function readSessionId(req) {
  const text = await readBoundedBody(req)
  if (text === undefined) return undefined

  let body
  try {
    body = JSON.parse(text)
  } catch {
    return undefined
  }
  if (body === null || typeof body !== 'object') return undefined

  const { sessionId } = body
  if (typeof sessionId !== 'string') return undefined
  const trimmed = sessionId.trim()
  return trimmed === '' ? undefined : trimmed
}

async function readBoundedBody(req) {
  const chunks = []
  let size = 0
  for await (const chunk of req) {
    size += chunk.byteLength
    if (size > MAX_BODY_BYTES) {
      if (typeof req.resume === 'function') req.resume()
      return undefined
    }
    chunks.push(chunk)
  }
  return Buffer.concat(chunks, size).toString('utf8')
}
