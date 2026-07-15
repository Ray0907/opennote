/**
 * Repository layer: all SQL for pages and blocks lives here.
 * The UI never writes SQL directly, which keeps the M2 sync/outbox refactor
 * contained to this file.
 */
import type { PGlite, Transaction } from '@electric-sql/pglite'
import type { Queryable } from '../../shared/sync'
import { keyBetween } from '../lib/sortkey'
import { extractWikiLinks } from '../lib/wikilinks'
import { extractPlainText, makeSnippet } from '../lib/plaintext'
import { sanitizeFileName, type BNBlock } from '../lib/markdown'

export interface Page {
  id: string
  parent_id: string | null
  title: string
  icon: string | null
  sort_key: string
  is_database: boolean
  db_schema: unknown
  props: Record<string, unknown> | null
  is_favorite: boolean
  cover: string | null
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
    `SELECT id, parent_id, title, icon, sort_key, is_database, db_schema, props,
            is_favorite, cover, created_at::text, updated_at::text
       FROM pages
      WHERE deleted_at IS NULL
      ORDER BY sort_key, id`,
  )
  return rows
}

export async function getPage(db: PGlite, id: string): Promise<Page | null> {
  const { rows } = await db.query<Page>(
    `SELECT id, parent_id, title, icon, sort_key, is_database, db_schema, props,
            is_favorite, cover, created_at::text, updated_at::text
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
  await reresolveLinks(db) // a dangling [[title]] may now bind to this page
  const page = await getPage(db, id)
  if (!page) throw new Error(`createPage: page ${id} vanished after insert`)
  return page
}

/** Replace a database page's property schema + view configs (M3). */
export async function setDbSchema(db: PGlite, id: string, schema: unknown): Promise<void> {
  await db.query(
    `UPDATE pages SET db_schema = $2, updated_at = now() WHERE id = $1`,
    [id, JSON.stringify(schema)],
  )
}

/** Replace a database row's typed property values (M3). */
export async function setPageProps(
  db: PGlite,
  id: string,
  props: Record<string, unknown>,
): Promise<void> {
  await db.query(
    `UPDATE pages SET props = $2, updated_at = now() WHERE id = $1`,
    [id, JSON.stringify(props)],
  )
}

export async function renamePage(db: PGlite, id: string, title: string): Promise<void> {
  await db.query(
    `UPDATE pages SET title = $2, updated_at = now() WHERE id = $1`,
    [id, title],
  )
  await reresolveLinks(db)
}

/**
 * Soft-delete a page and its whole subtree, plus their blocks. The whole
 * operation shares one tombstone timestamp so restorePage can identify it by
 * equality. now() alone is not enough: under PGlite's WASM clock it has
 * millisecond resolution, so two quick deletes can collide — bump the stamp
 * past every existing tombstone to keep each delete operation distinct.
 */
export async function deletePage(db: PGlite, id: string): Promise<void> {
  const { rows: stampRows } = await db.query<{ stamp: string }>(
    `SELECT GREATEST(
       now(),
       COALESCE((SELECT max(deleted_at) FROM pages) + interval '1 microsecond', now()),
       COALESCE((SELECT max(deleted_at) FROM blocks) + interval '1 microsecond', now())
     )::text AS stamp`,
  )
  const stamp = stampRows[0].stamp
  await db.query(
    `WITH RECURSIVE subtree AS (
       SELECT id FROM pages WHERE id = $1
       UNION ALL
       SELECT p.id FROM pages p JOIN subtree s ON p.parent_id = s.id
     ),
     blocks_marked AS (
       UPDATE blocks SET deleted_at = $2::timestamptz
        WHERE page_id IN (SELECT id FROM subtree) AND deleted_at IS NULL
        RETURNING 1
     )
     UPDATE pages SET deleted_at = $2::timestamptz, updated_at = now()
      WHERE id IN (SELECT id FROM subtree) AND deleted_at IS NULL`,
    [id, stamp],
  )
  // Drop the deleted subtree's outgoing links and unbind inbound ones.
  await db.query(
    `DELETE FROM links
      WHERE source_page_id NOT IN (SELECT id FROM pages WHERE deleted_at IS NULL)`,
  )
  await reresolveLinks(db)
}

/** Move a page under a new parent, appended as the last child. */
async function assertValidParent(db: PGlite, id: string, newParentId: string | null): Promise<void> {
  if (!newParentId) return
  const { rows } = await db.query<{ exists: boolean; cycle: boolean }>(
    `WITH RECURSIVE ancestors AS (
       SELECT id, parent_id FROM pages WHERE id = $2 AND deleted_at IS NULL
       UNION ALL
       SELECT p.id, p.parent_id FROM pages p JOIN ancestors a ON p.id = a.parent_id
     )
     SELECT EXISTS(SELECT 1 FROM ancestors WHERE id = $2) AS exists,
            EXISTS(SELECT 1 FROM ancestors WHERE id = $1) AS cycle`,
    [id, newParentId],
  )
  if (!rows[0]?.exists) throw new Error('Move target does not exist')
  if (rows[0].cycle) throw new Error('Cannot move a page into its own subtree')
}

export async function movePage(
  db: PGlite,
  id: string,
  newParentId: string | null,
): Promise<void> {
  await assertValidParent(db, id, newParentId)
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

/** Move one page immediately before another, adopting the target's parent. */
export async function reorderPage(db: PGlite, id: string, beforeId: string): Promise<void> {
  if (id === beforeId) return
  const target = await getPage(db, beforeId)
  if (!target) throw new Error('Reorder target does not exist')
  await assertValidParent(db, id, target.parent_id)
  const { rows } = await db.query<{ sort_key: string }>(
    `SELECT sort_key FROM pages
      WHERE parent_id IS NOT DISTINCT FROM $1 AND deleted_at IS NULL
        AND id <> $2 AND id <> $3 AND sort_key < $4
      ORDER BY sort_key DESC, id DESC LIMIT 1`,
    [target.parent_id, id, beforeId, target.sort_key],
  )
  const sortKey = keyBetween(rows[0]?.sort_key ?? null, target.sort_key)
  await db.query(
    `UPDATE pages SET parent_id = $2, sort_key = $3, updated_at = now() WHERE id = $1`,
    [id, target.parent_id, sortKey],
  )
}

/** Duplicate a page and its complete subtree with fresh page/block ids. */
export async function duplicatePage(db: PGlite, id: string): Promise<Page> {
  const originals = await listPages(db)
  const source = originals.find((page) => page.id === id)
  if (!source) throw new Error('Page to duplicate does not exist')
  const usedByParent = new Map<string, Set<string>>()
  const titleKey = (title: string) => sanitizeFileName(title).toLocaleLowerCase()
  const availableTitle = (parentId: string | null, desired: string): string => {
    const key = parentId ?? '__root'
    let used = usedByParent.get(key)
    if (!used) {
      used = new Set(
        originals
          .filter((page) => page.parent_id === parentId)
          .map((page) => titleKey(page.title)),
      )
      usedByParent.set(key, used)
    }
    let attempt = 1
    const candidate = () => {
      const suffix = attempt === 1 ? '' : ` ${attempt}`
      return desired.slice(0, Math.max(1, 120 - suffix.length)).trimEnd() + suffix
    }
    let title = candidate()
    while (used.has(titleKey(title))) {
      attempt++
      title = candidate()
    }
    used.add(titleKey(title))
    return title
  }
  const copies = new Map<string, Page>()
  const createCopyTree = async (original: Page, parentId: string | null, title: string): Promise<Page> => {
    const copy = await createPage(db, {
      parentId,
      title,
      isDatabase: original.is_database,
    })
    copies.set(original.id, copy)
    for (const child of originals.filter((page) => page.parent_id === original.id)) {
      await createCopyTree(child, copy.id, availableTitle(copy.id, child.title || 'Untitled'))
    }
    return copy
  }

  const rootTitle = availableTitle(
    source.parent_id,
    `${source.title || 'Untitled'} copy`,
  )
  const rootCopy = await createCopyTree(source, source.parent_id, rootTitle)

  const remapValue = (value: unknown): unknown => {
    if (typeof value === 'string') {
      const direct = copies.get(value)
      if (direct) return direct.id
      const reference = /^(opennote:\/\/(?:page|database)\/)(.+)$/.exec(value)
      const referenced = reference ? copies.get(reference[2]) : undefined
      return referenced && reference ? reference[1] + referenced.id : value
    }
    if (Array.isArray(value)) return value.map(remapValue)
    if (value && typeof value === 'object') {
      return Object.fromEntries(
        Object.entries(value as Record<string, unknown>).map(([key, item]) => [key, remapValue(item)]),
      )
    }
    return value
  }
  const cloneBlock = (block: BNBlock): BNBlock => ({
    ...block,
    id: uuid(),
    props: remapValue(block.props) as Record<string, unknown> | undefined,
    content: remapValue(block.content),
    children: block.children?.map(cloneBlock),
  })

  for (const original of originals.filter((page) => copies.has(page.id))) {
    const copy = copies.get(original.id)!
    await db.query(
      `UPDATE pages
          SET icon = $2, cover = $3, db_schema = $4, props = $5, updated_at = now()
        WHERE id = $1`,
      [
        copy.id,
        original.icon,
        original.cover,
        original.db_schema === null ? null : JSON.stringify(remapValue(original.db_schema)),
        original.props === null ? null : JSON.stringify(remapValue(original.props)),
      ],
    )
    const blocks = (await getBlocks(db, original.id)).map((row) => cloneBlock(row.content))
    if (blocks.length > 0) await savePageBlocks(db, copy.id, blocks)
  }
  const duplicated = await getPage(db, rootCopy.id)
  if (!duplicated) throw new Error('Duplicated page vanished')
  return duplicated
}

/** Toggle a page's favorite flag (M6). */
export async function setFavorite(db: PGlite, id: string, fav: boolean): Promise<void> {
  await db.query(
    `UPDATE pages SET is_favorite = $2, updated_at = now() WHERE id = $1`,
    [id, fav],
  )
}

/** Set or clear a page's icon emoji (M6). */
export async function setPageIcon(db: PGlite, id: string, icon: string | null): Promise<void> {
  await db.query(
    `UPDATE pages SET icon = $2, updated_at = now() WHERE id = $1`,
    [id, icon],
  )
}

/** Set or clear a page's cover (CSS gradient key or data URL, M6). */
export async function setPageCover(db: PGlite, id: string, cover: string | null): Promise<void> {
  await db.query(
    `UPDATE pages SET cover = $2, updated_at = now() WHERE id = $1`,
    [id, cover],
  )
}

export async function listFavorites(db: PGlite): Promise<Page[]> {
  const { rows } = await db.query<Page>(
    `SELECT id, parent_id, title, icon, sort_key, is_database, db_schema, props,
            is_favorite, cover, created_at::text, updated_at::text
       FROM pages
      WHERE is_favorite AND deleted_at IS NULL
      ORDER BY title, id`,
  )
  return rows
}

/**
 * Trash roots: deleted pages whose parent is live or absent. Children deleted
 * in the same operation are restored along with their root, so listing them
 * separately would only produce confusing duplicates.
 */
export async function listTrash(db: PGlite): Promise<Page[]> {
  const { rows } = await db.query<Page>(
    `SELECT p.id, p.parent_id, p.title, p.icon, p.sort_key, p.is_database,
            p.db_schema, p.props, p.is_favorite, p.cover,
            p.created_at::text, p.updated_at::text
       FROM pages p
      WHERE p.deleted_at IS NOT NULL
        AND (p.parent_id IS NULL OR NOT EXISTS (
              SELECT 1 FROM pages q
               WHERE q.id = p.parent_id AND q.deleted_at IS NOT NULL))
      ORDER BY p.updated_at DESC, p.id`,
  )
  return rows
}

/**
 * Restore a trashed page and the subtree that was deleted with it. deletePage
 * stamps the whole subtree (pages + blocks) with a single now(), so equality
 * on that timestamp restores exactly the pages/blocks removed by that one
 * delete — descendants trashed in an earlier, separate operation stay trashed.
 */
export async function restorePage(db: PGlite, id: string): Promise<void> {
  const { rows } = await db.query<{ deleted_at: string | null; parent_id: string | null }>(
    `SELECT deleted_at::text, parent_id FROM pages WHERE id = $1`,
    [id],
  )
  const root = rows[0]
  if (!root?.deleted_at) return
  const { rows: restored } = await db.query<{ id: string }>(
    `WITH RECURSIVE subtree AS (
       SELECT id FROM pages WHERE id = $1
       UNION ALL
       SELECT p.id FROM pages p JOIN subtree s ON p.parent_id = s.id
        WHERE p.deleted_at = $2::timestamptz
     ),
     blocks_restored AS (
       UPDATE blocks SET deleted_at = NULL
        WHERE page_id IN (SELECT id FROM subtree) AND deleted_at = $2::timestamptz
        RETURNING 1
     )
     UPDATE pages SET deleted_at = NULL, updated_at = now()
      WHERE id IN (SELECT id FROM subtree) AND deleted_at = $2::timestamptz
      RETURNING id`,
    [id, root.deleted_at],
  )
  // If the original parent is still trashed (or gone), surface at top level.
  if (root.parent_id) {
    const { rows: parent } = await db.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM pages WHERE id = $1 AND deleted_at IS NULL`,
      [root.parent_id],
    )
    if (!parent[0]?.n) await movePage(db, id, null)
  }
  // deletePage dropped the subtree's outgoing links; re-derive them, then let
  // dangling [[titles]] elsewhere bind to the restored pages.
  await rebuildLinksForPages(
    db,
    restored.map((r) => r.id),
  )
  await reresolveLinks(db)
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
    await rebuildPageLinks(tx, pageId, docBlocks)
  })
}

/**
 * M4 wiki links. `links` is a derived, local-only index (see 005_links.sql):
 * rebuilt from the saved document inside the same transaction, so it can
 * never drift from blocks. Resolution is by case-insensitive title; ties
 * break to the oldest page so results are deterministic.
 */
async function rebuildPageLinks(
  tx: Queryable,
  pageId: string,
  docBlocks: BNBlock[],
): Promise<void> {
  await tx.query(`DELETE FROM links WHERE source_page_id = $1`, [pageId])
  for (const title of extractWikiLinks(docBlocks)) {
    await tx.query(
      `INSERT INTO links (source_page_id, target_title, target_page_id)
       VALUES ($1, $2,
         (SELECT id FROM pages
           WHERE lower(title) = lower($2) AND deleted_at IS NULL
           ORDER BY created_at, id LIMIT 1))
       ON CONFLICT (source_page_id, target_title) DO NOTHING`,
      [pageId, title],
    )
  }
}

/**
 * Rebuild the links index for specific pages from current DB state. The sync
 * pull path writes blocks via upsertRow (bypassing savePageBlocks), so pulled
 * document changes must re-derive their links here. Idempotent; a page whose
 * blocks are all deleted simply ends up with no outgoing links.
 */
export async function rebuildLinksForPages(
  db: Queryable,
  pageIds: Iterable<string>,
): Promise<void> {
  for (const pageId of pageIds) {
    const { rows } = await db.query<{ content: BNBlock }>(
      `SELECT content FROM blocks
        WHERE page_id = $1 AND deleted_at IS NULL
        ORDER BY sort_key, id`,
      [pageId],
    )
    await rebuildPageLinks(
      db,
      pageId,
      rows.map((r) => r.content),
    )
  }
}

/**
 * Re-resolve every link's target after the page set changes (create, rename,
 * delete — locally or via sync pull). Cheap at this scale and idempotent;
 * unresolved titles simply stay NULL until a matching page appears.
 */
export async function reresolveLinks(db: Queryable): Promise<void> {
  await db.query(
    `UPDATE links l
        SET target_page_id = (
          SELECT p.id FROM pages p
           WHERE lower(p.title) = lower(l.target_title) AND p.deleted_at IS NULL
           ORDER BY p.created_at, p.id LIMIT 1)`,
  )
}

/** Pages whose documents currently contain [[title-of pageId]]. */
export async function getBacklinks(db: PGlite, pageId: string): Promise<Page[]> {
  const { rows } = await db.query<Page>(
    `SELECT p.id, p.parent_id, p.title, p.icon, p.sort_key, p.is_database,
            p.db_schema, p.props, p.created_at::text, p.updated_at::text
       FROM links l JOIN pages p ON p.id = l.source_page_id
      WHERE l.target_page_id = $1 AND p.deleted_at IS NULL
      ORDER BY p.title, p.id`,
    [pageId],
  )
  return rows
}

export interface SearchHit {
  pageId: string
  title: string
  snippet: string
  matchKind: 'title' | 'content'
}

/** Escape ILIKE metacharacters so user input is a literal substring match. */
function escapeLike(q: string): string {
  return q.replace(/[\\%_]/g, (m) => '\\' + m)
}

/**
 * Substring search over page titles and block text. Plain ILIKE (no
 * pg_trgm extension needed) so CJK and Latin both match by substring on
 * PGlite and server Postgres identically. Title hits rank before content
 * hits; within each group, most recently updated first.
 *
 * Content matching is two-pass: content::text ILIKE coarse-filters in SQL
 * (may match JSON keys), then extractPlainText verifies precisely in JS
 * and builds the snippet.
 */
export async function searchPages(
  db: PGlite,
  query: string,
  limit = 20,
): Promise<SearchHit[]> {
  const q = query.trim()
  if (!q) return []
  const pattern = `%${escapeLike(q)}%`
  const qLower = q.toLowerCase()
  const hits: SearchHit[] = []
  const seen = new Set<string>()

  const { rows: titleRows } = await db.query<{ id: string; title: string }>(
    `SELECT id, title FROM pages
      WHERE deleted_at IS NULL AND title ILIKE $1
      ORDER BY updated_at DESC, id LIMIT $2`,
    [pattern, limit],
  )
  for (const r of titleRows) {
    seen.add(r.id)
    hits.push({ pageId: r.id, title: r.title, snippet: '', matchKind: 'title' })
  }
  if (hits.length >= limit) return hits.slice(0, limit)

  // Coarse SQL prefilter; cap candidates to bound the JS verification pass.
  const { rows: candRows } = await db.query<{ id: string; title: string }>(
    `SELECT DISTINCT p.id, p.title, p.updated_at
       FROM pages p JOIN blocks b ON b.page_id = p.id
      WHERE p.deleted_at IS NULL AND b.deleted_at IS NULL
        AND b.content::text ILIKE $1
      ORDER BY p.updated_at DESC, p.id LIMIT $2`,
    [pattern, limit * 3],
  )
  for (const r of candRows) {
    if (hits.length >= limit) break
    if (seen.has(r.id)) continue
    const blocks = await getBlocks(db, r.id)
    const text = extractPlainText(blocks.map((b) => b.content))
    if (!text.toLowerCase().includes(qLower)) continue // JSON-key false positive
    seen.add(r.id)
    hits.push({
      pageId: r.id,
      title: r.title,
      snippet: makeSnippet(text, q),
      matchKind: 'content',
    })
  }
  return hits
}
