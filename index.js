/**
 * Host half. Mounts the HTTP endpoint the client half posts to.
 *
 * Ticket 01 only proves the transport: the handler validates the request and
 * answers OK without deleting anything. The four-step deletion (activity gate,
 * recursive file removal, archive/pin cleanup) arrives in ticket 02.
 */

export const name = 'delete-session-host'

export const inject = ['webServer', 'connection', 'workspaceRegistry']

const ROUTE_PREFIX = '/delete-session/api'
const DELETE_PATH = '/delete-session/api/delete'
const MAX_BODY_BYTES = 64 * 1024

export function apply(ctx) {
  const handler = createDeleteHandler(ctx)
  ctx.effect(() => ctx.webServer.register({ kind: 'prefix', path: ROUTE_PREFIX, handler }), 'delete-session: api')
}

/**
 * Builds the route handler from the host context so tests can drive it without
 * starting a web server.
 */
export function createDeleteHandler(ctx) {
  return async function deleteSessionHandler(req, res) {
    if (req.method !== 'POST') return sendJson(res, 405, { ok: false, code: 'METHOD_NOT_ALLOWED' })

    const rejection = ctx.connection.requestRejection(req)
    if (rejection !== undefined) {
      return sendJson(res, rejection, { ok: false, code: 'REJECTED', message: `request rejected (${rejection})` })
    }

    if (pathnameOf(req.url) !== DELETE_PATH) return sendJson(res, 404, { ok: false, code: 'NOT_FOUND' })

    const sessionId = await readSessionId(req)
    if (sessionId === undefined) return sendJson(res, 400, { ok: false, code: 'INVALID_SESSION_ID' })

    return sendJson(res, 200, { ok: true, code: 'OK' })
  }
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
