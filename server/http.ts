/**
 * HTTP surface for the sync core (M2). Dependency-free node:http so the
 * same file serves tests (PGlite) and production (pg Pool), both of which
 * satisfy Queryable.
 *
 * Protocol (JSON):
 *   POST /push  {clientId, ops: SyncOp[]}  -> ApplyResult
 *   GET  /pull?since=N                     -> SyncChange[]
 */
import http from 'node:http'
import type { Queryable, SyncOp } from '../shared/sync'
import { applyOps, pullChanges } from './sync'

/** Reject bodies over 10 MB: a push batch should never come close (F2 rows). */
const MAX_BODY_BYTES = 10_000_000

function readBody(req: http.IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let size = 0
    const chunks: Buffer[] = []
    req.on('data', (chunk: Buffer) => {
      size += chunk.length
      if (size > MAX_BODY_BYTES) {
        reject(new Error('body too large'))
        req.destroy()
        return
      }
      chunks.push(chunk)
    })
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')))
    req.on('error', reject)
  })
}

/**
 * Browser-facing hardening. The sync server is unauthenticated in M2, so it
 * must not be reachable by arbitrary web pages running in a local browser:
 *
 *  - CORS: echo the Origin only when it is explicitly allowlisted (vite dev
 *    origins by default; extend via OPENNOTE_SYNC_ORIGINS, comma-separated).
 *    Never `*`: because pushes carry `content-type: application/json`, every
 *    cross-origin push/pull is preflighted, so an unlisted origin can neither
 *    read nor write.
 *  - DNS rebinding: unless OPENNOTE_SYNC_PUBLIC=1, reject any request whose
 *    Host header is not loopback — a rebound hostname resolves to 127.0.0.1
 *    but still carries the attacker's Host value.
 *
 * Non-browser clients (tests, Electron main via node fetch) send no Origin
 * header and are unaffected.
 */
const DEFAULT_ALLOWED_ORIGINS = ['http://localhost:5173', 'http://127.0.0.1:5173']

const allowedOrigins = new Set(
  process.env.OPENNOTE_SYNC_ORIGINS?.split(',')
    .map((s) => s.trim())
    .filter(Boolean) ?? DEFAULT_ALLOWED_ORIGINS,
)

function corsHeaders(req: http.IncomingMessage): Record<string, string> {
  const origin = req.headers.origin
  if (!origin || !allowedOrigins.has(origin)) return {}
  return {
    'access-control-allow-origin': origin,
    'access-control-allow-methods': 'GET, POST, OPTIONS',
    'access-control-allow-headers': 'content-type',
    vary: 'origin',
  }
}

const LOOPBACK_HOST = /^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/i

function hostAllowed(req: http.IncomingMessage): boolean {
  if (process.env.OPENNOTE_SYNC_PUBLIC === '1') return true
  return LOOPBACK_HOST.test(req.headers.host ?? '')
}

function send(
  res: http.ServerResponse,
  status: number,
  body: unknown,
  cors: Record<string, string> = {},
): void {
  const json = JSON.stringify(body)
  res.writeHead(status, {
    ...cors,
    'content-type': 'application/json',
    'content-length': Buffer.byteLength(json),
  })
  res.end(json)
}

function isSyncOp(v: unknown): v is SyncOp {
  if (typeof v !== 'object' || v === null) return false
  const op = v as Record<string, unknown>
  return (
    typeof op.opId === 'string' &&
    typeof op.table === 'string' &&
    typeof op.rowId === 'string' &&
    typeof op.row === 'object' &&
    op.row !== null
  )
}

/**
 * Build the sync server around any Queryable. Caller owns listen()/close().
 * All ops in one push are applied sequentially in arrival order (F3); node's
 * single-threaded request handling means two concurrent pushes interleave at
 * op granularity, which arrival-order LWW is defined to tolerate.
 */
export function createSyncServer(db: Queryable): http.Server {
  return http.createServer(async (req, res) => {
    const cors = corsHeaders(req)
    try {
      if (!hostAllowed(req)) {
        return send(res, 403, { error: 'forbidden host' })
      }
      const url = new URL(req.url ?? '/', 'http://localhost')

      if (req.method === 'OPTIONS') {
        res.writeHead(204, cors)
        return res.end()
      }

      if (req.method === 'POST' && url.pathname === '/push') {
        let parsed: unknown
        try {
          parsed = JSON.parse(await readBody(req))
        } catch {
          return send(res, 400, { error: 'invalid JSON body' }, cors)
        }
        const body = parsed as { clientId?: unknown; ops?: unknown }
        if (
          typeof body.clientId !== 'string' ||
          !Array.isArray(body.ops) ||
          !body.ops.every(isSyncOp)
        ) {
          return send(res, 400, { error: 'expected {clientId, ops: SyncOp[]}' }, cors)
        }
        return send(res, 200, await applyOps(db, body.clientId, body.ops), cors)
      }

      if (req.method === 'GET' && url.pathname === '/pull') {
        const since = Number(url.searchParams.get('since') ?? '0')
        if (!Number.isInteger(since) || since < 0) {
          return send(res, 400, { error: 'since must be a non-negative integer' }, cors)
        }
        return send(res, 200, await pullChanges(db, since), cors)
      }

      return send(res, 404, { error: 'not found' }, cors)
    } catch (err) {
      // Unknown table names etc. are client mistakes -> 400; anything else 500.
      const msg = err instanceof Error ? err.message : String(err)
      send(res, msg.startsWith('unknown sync table') ? 400 : 500, { error: msg }, cors)
    }
  })
}
