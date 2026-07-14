/**
 * Runnable sync server entry (M2). PGlite-on-disk keeps the server as
 * dependency-free as the rest of the stack; the core (server/sync.ts) is
 * written against Queryable, so swapping in `pg` Pool later is a two-line
 * change here and nowhere else.
 *
 * Built by `vite build --ssr` (see npm run sync-server) so the shared ?raw
 * migration imports resolve under plain node.
 *
 *   PORT      listen port            (default 8787)
 *   DATA_DIR  PGlite data directory  (default ./opennote-sync-data)
 */
import { createDb } from '../src/db/db'
import { createSyncServer } from './http'

const port = Number(process.env.PORT ?? 8787)
const dataDir = process.env.DATA_DIR ?? './opennote-sync-data'

const db = await createDb(dataDir)
const server = createSyncServer(db)
server.listen(port, '127.0.0.1', () => {
  console.log(`OpenNote sync server: http://127.0.0.1:${port} (data: ${dataDir})`)
})

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => {
    server.close(() => {
      void db.close().then(() => process.exit(0))
    })
  })
}
