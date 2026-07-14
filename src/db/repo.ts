/**
 * Repository layer: all SQL for pages and blocks lives here.
 * The UI never writes SQL directly, which keeps the M2 sync/outbox refactor
 * contained to this file.
 */
import type { PGlite, Transaction } from '@electric-sql/pglite'
import { keyBetween } from '../lib/sortkey'
import type { BNBlock } from '../lib/markdown'

export interface Page {
  id: string
  parent_id: string | null
  title: string
  icon: string | null
  sort_key: string
  is_database: boolean
  db_schema: unknown
  created_at: string
  updated_at: string
}

export interface BlockRow {
  id: string
  page_id: string
  sort_key: string
  type: string
  content: BNBlock
}

function uuid(): string {
  return crypto.randomUUID()
}

export async function listPages(db: PGlite): Promise<Page[]> {
  const { rows } = await db.query<Page>(
    `SELECT id, parent_id, title, icon, sort_key, is_database, db_schema,
            created_at::text, updated_at::text
       FROM pages
      WHERE deleted_at IS NULL
      ORDER BY sort_key, id`,
  )
  return rows
}

export async function getPage(db: PGlite, id: string): Promise<Page | null> {
  const { rows } = await db.query<Page>(
    `SELECT id, parent_id, title, icon, sort_key, is_database, db_schema,
            created_at::text, updated_at::text
       FROM pages WHERE id = $1 AND deleted_at IS NULL`,
    [id],
  )
  return rows[0] ?? null
}

export async function createPage(
  db: PGlite,
  opts: { parentId?: string | null; title?: string; isDatabase?: boolean } = {},
): Promise<Page> {
  const parentId = opts.parentId ?? null
  // Append after the current last sibling.
  const { rows } = await db.query<{ sort_key: string }>(
    `SELECT sort_key FROM pages
      WHERE parent_id IS NOT DISTINCT FROM $1 AND deleted_at IS NULL
      ORDER BY sort_key DESC, id DESC LIMIT 1`,
    [parentId],
  )
  const sortKey = keyBetween(rows[0]?.sort_key ?? null, null)
  const id = uuid()
  await db.query(
    `INSERT INTO pages (id, parent_id, title, sort_key, is_database)
     VALUES ($1, $2, $3, $4, $5)`,
    [id, parentId, opts.title ?? '', sortKey, opts.isDatabase ?? false],
  )
  const page = await getPage(db, id)
  if (!page) throw new Error(`createPage: page ${id} vanished after insert`)
  return page
}

export async function renamePage(db: PGlite, id: string, title: string): Promise<void> {
  await db.query(
    `UPDATE pages SET title = $2, updated_at = now() WHERE id = $1`,
    [id, title],
  )
}

/** Soft-delete a page and its whole subtree, plus their blocks. */
export async function deletePage(db: PGlite, id: string): Promise<void> {
  await db.query(
    `WITH RECURSIVE subtree AS (
       SELECT id FROM pages WHERE id = $1
       UNION ALL
       SELECT p.id FROM pages p JOIN subtree s ON p.parent_id = s.id
     ),
     blocks_marked AS (
       UPDATE blocks SET deleted_at = now()
        WHERE page_id IN (SELECT id FROM subtree) AND deleted_at IS NULL
        RETURNING 1
     )
     UPDATE pages SET deleted_at = now(), updated_at = now()
      WHERE id IN (SELECT id FROM subtree) AND deleted_at IS NULL`,
    [id],
  )
}

/** Move a page under a new parent, appended as the last child. */
export async function movePage(
  db: PGlite,
  id: string,
  newParentId: string | null,
): Promise<void> {
  const { rows } = await db.query<{ sort_key: string }>(
    `SELECT sort_key FROM pages
      WHERE parent_id IS NOT DISTINCT FROM $1 AND deleted_at IS NULL AND id <> $2
      ORDER BY sort_key DESC, id DESC LIMIT 1`,
    [newParentId, id],
  )
  const sortKey = keyBetween(rows[0]?.sort_key ?? null, null)
  await db.query(
    `UPDATE pages SET parent_id = $2, sort_key = $3, updated_at = now() WHERE id = $1`,
    [id, newParentId, sortKey],
  )
}

export async function getBlocks(db: PGlite, pageId: string): Promise<BlockRow[]> {
  const { rows } = await db.query<BlockRow>(
    `SELECT id, page_id, sort_key, type, content
       FROM blocks
      WHERE page_id = $1 AND deleted_at IS NULL
      ORDER BY sort_key, id`,
    [pageId],
  )
  return rows
}

/**
 * Persist a full editor document (BlockNote top-level blocks, in order).
 *
 * Sort keys are kept stable for blocks whose relative order did not change
 * (so unchanged rows are not rewritten and M2 sync churn stays low): existing
 * keys that already form an increasing sequence are kept, and only the
 * remaining blocks get fresh keys inserted between their neighbors.
 */
export async function savePageBlocks(
  db: PGlite,
  pageId: string,
  docBlocks: BNBlock[],
): Promise<void> {
  const existingRows = await getBlocks(db, pageId)
  const existing = new Map(existingRows.map((r) => [r.id, r]))

  // Pass 1: keep the longest increasing subsequence of existing keys, so a
  // single moved block gets a fresh key instead of renumbering the rest.
  const kept: (string | null)[] = docBlocks.map((b) => existing.get(b.id)?.sort_key ?? null)
  {
    const tails: number[] = [] // indices of current LIS tails, by length
    const parent = new Map<number, number>()
    for (let i = 0; i < kept.length; i++) {
      if (kept[i] === null) continue
      const key = kept[i]!
      let lo = 0
      let hi = tails.length
      while (lo < hi) {
        const mid = (lo + hi) >> 1
        if (kept[tails[mid]]! < key) lo = mid + 1
        else hi = mid
      }
      if (lo > 0) parent.set(i, tails[lo - 1])
      tails[lo] = i
    }
    const inLis = new Set<number>()
    let cursor: number | undefined = tails.length > 0 ? tails[tails.length - 1] : undefined
    while (cursor !== undefined) {
      inLis.add(cursor)
      cursor = parent.get(cursor)
    }
    for (let i = 0; i < kept.length; i++) {
      if (kept[i] !== null && !inLis.has(i)) kept[i] = null
    }
  }

  // Pass 2: fill the gaps with keys between the kept neighbors.
  const keys: string[] = []
  let prev: string | null = null
  for (let i = 0; i < kept.length; i++) {
    if (kept[i] !== null) {
      keys.push(kept[i]!)
      prev = kept[i]!
      continue
    }
    let next: string | null = null
    for (let j = i + 1; j < kept.length; j++) {
      if (kept[j] !== null) {
        next = kept[j]!
        break
      }
    }
    const k = keyBetween(prev, next)
    keys.push(k)
    prev = k
  }

  const presentIds = docBlocks.map((b) => b.id)

  await db.transaction(async (tx: Transaction) => {
    for (let i = 0; i < docBlocks.length; i++) {
      const block = docBlocks[i]
      const row = existing.get(block.id)
      const contentJson = JSON.stringify(block)
      if (row) {
        // Skip no-op writes to keep updated_at meaningful for LWW display.
        if (row.sort_key === keys[i] && JSON.stringify(row.content) === contentJson) continue
        await tx.query(
          `UPDATE blocks
              SET sort_key = $2, type = $3, content = $4, updated_at = now()
            WHERE id = $1`,
          [block.id, keys[i], block.type, contentJson],
        )
      } else {
        await tx.query(
          `INSERT INTO blocks (id, page_id, sort_key, type, content)
           VALUES ($1, $2, $3, $4, $5)
           ON CONFLICT (id) DO UPDATE
             SET sort_key = EXCLUDED.sort_key, type = EXCLUDED.type,
                 content = EXCLUDED.content, updated_at = now(), deleted_at = NULL`,
          [block.id, pageId, keys[i], block.type, contentJson],
        )
      }
    }
    // Soft-delete rows no longer present in the document.
    if (presentIds.length === 0) {
      await tx.query(
        `UPDATE blocks SET deleted_at = now()
          WHERE page_id = $1 AND deleted_at IS NULL`,
        [pageId],
      )
    } else {
      await tx.query(
        `UPDATE blocks SET deleted_at = now()
          WHERE page_id = $1 AND deleted_at IS NULL AND NOT (id = ANY($2))`,
        [pageId, presentIds],
      )
    }
    await tx.query(`UPDATE pages SET updated_at = now() WHERE id = $1`, [pageId])
  })
}
