# OpenNote — Design Spec (2026-07-14)

A 1:1-spirit Notion clone that runs on macOS, Windows, and Linux.
Local-first, data-sovereign, with a plain-Markdown mirror of everything you write.

## 1. Product Scope

- Hierarchical pages with a sidebar tree (create / rename / move / soft-delete)
- Block-based rich text editor (BlockNote): paragraphs, headings, lists,
  checklists, code blocks, quotes, nested blocks
- Databases: table / board / calendar views with typed properties,
  filtering and sorting (M3)
- Wiki features: `[[wiki-links]]`, backlinks, full-text search,
  Markdown import/export (M4)
- Multi-device sync with offline editing (M2)

## 2. Architecture

- **Thin native shell**: Electron hosts a window, a preload bridge, and
  file-mirror IPC. No application logic lives in the shell, so the web core
  stays portable (desktop today, browser/mobile later).
- **Web core**: React + TypeScript + BlockNote editor.
- **Local store**: PGlite (Postgres-in-WASM) persisted via IndexedDB in the
  renderer. The local DB is treated as a rebuildable cache (F5); the source
  of durability is the Markdown mirror plus (from M2) the sync server.
- **Markdown mirror**: every page is mirrored as a real `.md` file with YAML
  frontmatter into a vault folder (`~/Documents/OpenNoteVault`), written
  atomically (temp + rename, F4). This guarantees data sovereignty: the
  vault alone is enough to rebuild the workspace, and it is Obsidian-friendly.
- **Sync (M2)**: server Postgres + ElectricSQL for the read path
  (shape subscriptions), plus a small custom write API. Electric v1 is
  read-path only by design ("Electric does reads, you do writes").

## 3. Data Model

Shared DDL lives in `shared/migrations/*.sql` and is executed identically by
PGlite and the server Postgres (F6).

- `pages(id, parent_id, title, icon, sort_key, is_database, db_schema,
  created_at, updated_at, deleted_at)`
- `blocks(id, page_id, sort_key, type, content, updated_at, deleted_at)`

Key decisions:

- **Sync granularity = BlockNote top-level block** (F2). One row per
  top-level block; `content` stores that block's full BlockNote JSON,
  including inline content and nested children. LWW applies per top-level
  block, so two devices editing different paragraphs of the same page merge
  cleanly.
- **Ordering**: fractional `sort_key` strings so a reorder touches only the
  moved row. Keys carry a short random jitter suffix to avoid offline
  same-gap collisions (F7); readers always sort by `(sort_key, id)`.
- **Deletes are soft** (`deleted_at`), so they replicate as updates.

## 4. Sync Design (M2)

- Read path: Electric shape subscriptions on `pages` and `blocks`.
- Write path: client keeps an outbox queue in PGlite; a small HTTP API
  applies writes to server Postgres.
- Conflict policy: last-write-wins per row. The server stamps every applied
  write with a monotonically increasing `server_seq`; arrival order at the
  server decides conflicts, never client clocks (F3). Client `updated_at`
  is display-only.

## 5. Milestones and Acceptance

- **M1 — Local-first editor**: Electron shell + sidebar page tree +
  BlockNote editing + PGlite persistence + atomic Markdown mirror.
  *Accept*: create/edit/rename/delete pages; content survives restart;
  vault contains up-to-date `.md` files.
- **M2 — Sync**: docker-compose server (Postgres + Electric), write API,
  client outbox with offline replay, per-block LWW.
  *Accept*: two clients converge; offline edits replay on reconnect.
- **M3 — Databases**: table/board/calendar views, typed properties,
  filter/sort, views persisted per database page.
  *Accept*: create a database page, add rows/properties, switch views,
  filter and sort.
- **M4 — Wiki**: `[[links]]` with autocomplete, backlinks panel, full-text
  search (trigram-based for CJK correctness, F1), Markdown import/export.
  *Accept*: linking two pages shows a backlink; search finds CJK and Latin
  text; a page exports to `.md` and reimports losslessly enough to read.

Every milestone ends with a git commit + tag (`m1`, `m2`, ...). Spec baseline
is tagged `snapshot-0-spec`.

## 6. Review Findings Resolutions (spec review, 2026-07-14)

| # | Finding | Resolution |
|---|---|---|
| F1 | Postgres FTS does not segment CJK text; tsvector search is useless for Chinese | Drop tsvector; use `pg_trgm` + ILIKE (supported by PGlite) with title hits ranked first |
| F2 | BlockNote JSON ↔ block-row mapping was undefined, but it defines sync granularity | One row per BlockNote top-level block; `content` = full block JSON including children |
| F3 | LWW on client clocks breaks under clock skew | Server stamps `server_seq` on apply; arrival order wins; client timestamps display-only |
| F4 | Mirror files can be torn by a crash mid-write | Atomic write: temp file + rename, with 500 ms debounce, implemented in the shell |
| F5 | PGlite persistence location vs thin-shell discipline | PGlite runs in the renderer (IndexedDB). Sovereignty comes from the mirror; local DB is a rebuildable cache |
| F6 | Schema drift between PGlite and server Postgres | Single `shared/migrations/*.sql` set executed by both sides |
| F7 | Fractional keys can collide when two offline devices insert into the same gap | Append a short random jitter suffix; sort by `(sort_key, id)` for stability |

## 7. Open Questions (not blocking M1)

- Mirror layout: nested folders following the page tree (leaning yes,
  Obsidian-compatible) vs flat files with `parent` frontmatter
- Database-row mirror format: frontmatter properties (leaning yes) vs CSV
- Electric write-path details: plain REST vs Electric's recommended write
  pattern at M2 time
