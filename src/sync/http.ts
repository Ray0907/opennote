/**
 * HTTP SyncTransport (M2): the production counterpart of the direct-call
 * transport used in unit tests. Matches server/http.ts's protocol.
 */
import type { SyncChange, SyncOp } from '../../shared/sync'
import type { SyncTransport } from './client'

async function expectOk(res: Response): Promise<Response> {
  if (!res.ok) {
    let detail = ''
    try {
      detail = ((await res.json()) as { error?: string }).error ?? ''
    } catch {
      /* non-JSON error body */
    }
    throw new Error(`sync server ${res.status}${detail ? `: ${detail}` : ''}`)
  }
  return res
}

/**
 * Transport against a sync server base URL (no trailing slash needed).
 * Failures throw; syncOnce leaves the outbox intact, so the next cycle
 * retries idempotently (op_id dedupe on the server).
 */
export function createHttpTransport(baseUrl: string): SyncTransport {
  const base = baseUrl.replace(/\/$/, '')
  return {
    async push(clientId: string, ops: SyncOp[]): Promise<void> {
      await expectOk(
        await fetch(`${base}/push`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ clientId, ops }),
        }),
      )
    },
    async pull(sinceSeq: number): Promise<SyncChange[]> {
      const res = await expectOk(await fetch(`${base}/pull?since=${sinceSeq}`))
      return (await res.json()) as SyncChange[]
    },
  }
}
