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

function send(res: http.ServerResponse, status: number, body: unknown): void {
  const json = JSON.stringify(body)
  res.writeHead(status, {
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
    try {
      const url = new URL(req.url ?? '/', 'http://localhost')

      if (req.method === 'POST' && url.pathname === '/push') {
        let parsed: unknown
        try {
          parsed = JSON.parse(await readBody(req))
        } catch {
          return send(res, 400, { error: 'invalid JSON body' })
        }
        const body = parsed as { clientId?: unknown; ops?: unknown }
        if (
          typeof body.clientId !== 'string' ||
          !Array.isArray(body.ops) ||
          !body.ops.every(isSyncOp)
        ) {
          return send(res, 400, { error: 'expected {clientId, ops: SyncOp[]}' })
        }
        return send(res, 200, await applyOps(db, body.clientId, body.ops))
      }

      if (req.method === 'GET' && url.pathname === '/pull') {
        const since = Number(url.searchParams.get('since') ?? '0')
        if (!Number.isInteger(since) || since < 0) {
          return send(res, 400, { error: 'since must be a non-negative integer' })
        }
        return send(res, 200, await pullChanges(db, since))
      }

      return send(res, 404, { error: 'not found' })
    } catch (err) {
      // Unknown table names etc. are client mistakes -> 400; anything else 500.
      const msg = err instanceof Error ? err.message : String(err)
      send(res, msg.startsWith('unknown sync table') ? 400 : 500, { error: msg })
    }
  })
}
