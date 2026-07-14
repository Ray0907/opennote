# OpenNote → Notion 1:1 Parity — Gap Analysis

Date: 2026-07-14
Status: assessment only (no code in this document)

This is an honest inventory of what still separates OpenNote from a true 1:1
Notion clone, grounded in the current codebase. Each gap notes its size and
whether it fits OpenNote's local-first, single-user architecture (a self-hosted
sync server, Markdown vault as source of truth, PGlite cache). Some Notion
features are **deliberately out of scope** because they contradict that
architecture; those are called out rather than treated as debt.

Legend: **P0** table-stakes for "feels like Notion" · **P1** important ·
**P2** nice-to-have · **OOS** intentionally out of scope for this product.

---

## 1. What already reaches parity

For context, these are at or near Notion's bar today:

- Block editor (BlockNote): paragraphs, headings, lists, checklists, code,
  quotes, nested blocks, `/` slash menu, in-page block drag.
- Hierarchical page tree with favorites, page icons, cover images.
- Databases with table / board / calendar views; typed properties incl.
  **relation** and **rollup**.
- `[[wiki-links]]`, backlinks, CJK-safe full-text search (⌘K).
- Markdown import/export, templates, trash + undo, light/dark themes.
- Multi-device sync (offline outbox, per-block LWW) — single user, many
  devices.

The gaps below are what remains.

---

## 2. Editor / blocks

Notion's block vocabulary is much larger than what OpenNote enables and, more
importantly, larger than what the **Markdown mirror serializes**
(`src/lib/markdown.ts` handles: heading, bullet/numbered/check list, code,
quote, paragraph, table). Anything the editor allows but the mirror can't
serialize is a silent data-fidelity gap.

| Gap | Notion has | OpenNote today | Size | Notes |
|---|---|---|---|---|
| Toggle / collapsible blocks | yes | no | **P1** | Common in real notes; needs a mirror representation (e.g. `<details>`). |
| Callout blocks | yes | no | **P1** | Icon + tinted box; maps to a blockquote variant in md. |
| Columns / multi-column layout | yes | no | **P1** | Layout blocks; md has no native columns (needs HTML in mirror). |
| Sub-page **as an in-document block** | yes (a page can be a block inside another page's body) | no — pages nest only via the sidebar tree | **P0** | This is core Notion "everything is a page/block". Today `pages` and `blocks` are separate tables; a page cannot appear inline in another page's content. |
| Inline **linked / embedded database** | yes (drop a filtered view of a DB inside any page) | no — a database is always a full page | **P0** | Big structural feature; see §3. |
| Equations (KaTeX), Mermaid/diagrams | yes | no | **P2** | |
| Embeds (YouTube, Figma, bookmarks, tweets) | yes | no | **P2** | Needs iframe/oEmbed handling; tension with the offline/sovereign posture. |
| Table of contents, breadcrumb, button, table-of-databases | yes | no | **P2** | |
| Synced blocks (same block on two pages) | yes | no | **P2** | Hard to reconcile with block-per-row LWW sync. |
| Color / background on text and blocks | yes | no (one ink color) | **P2** | Deliberately restrained per DESIGN.md, but Notion has it. |

**Mirror-fidelity risk:** if the editor is ever configured to allow a block the
serializer doesn't handle, that block degrades to plain text in the vault.
Keep the enabled block set and the serializer in lockstep, or extend the
serializer first.

---

## 3. Databases

Property types (`src/lib/database.ts`) cover text, number, select,
multi-select, date, checkbox, url, relation, rollup. Views are table / board /
calendar.

| Gap | Notion has | OpenNote today | Size | Notes |
|---|---|---|---|---|
| **Filter & sort actually applied** | yes | **schema fields exist but are dead** — `ViewDef.filter`/`sortBy`/`sortDir` are defined but not wired into rendering (`DatabaseView` only reads `groupBy`) | **P0** | Highest-value database gap: the data model is ready, only the view layer ignores it. |
| Group-by in table view | yes | board groups by select; table has no grouping | **P1** | |
| Formula property | yes | no | **P1** | Needs an expression evaluator. |
| Person / created-by / last-edited-by / created-time / last-edited-time | yes | no | **P1** | created_at/updated_at exist on rows but aren't exposed as properties. |
| Files & media property | yes | no | **P1** | Blocked on file upload (§4). |
| Email / phone / status (grouped select) | yes | no | **P2** | |
| Inline / linked database views | yes | no | **P0** | Same as §2; a DB can't be embedded or filtered-per-view inside another page. |
| Gallery / list / timeline / gantt views | yes | table/board/calendar only | **P2** | |
| Per-view visible-property + column-width config | yes | no | **P2** | |
| Database templates (row templates) | yes | page templates only | **P2** | |
| Sub-items / dependencies | yes | no | **P2** | |

---

## 4. Media & files

| Gap | Notion has | OpenNote today | Size | Notes |
|---|---|---|---|---|
| Image/file **upload** into a page | yes | no — covers are CSS gradients only, no upload path | **P0** | Real notes contain screenshots. Needs a vault attachments folder + mirror-relative paths + BlockNote image block wired to the shell. Fits local-first well (store next to the `.md`). |
| Cover from image / Unsplash | yes | gradient presets only | **P2** | |
| Paste image from clipboard | yes | no | **P1** | Expected muscle memory. |
| Audio / video / PDF preview blocks | yes | no | **P2** | |

---

## 5. Collaboration (mostly OOS by design)

PRODUCT.md scopes OpenNote to **single-user, multi-device**. These are Notion
features that a team wants but that conflict with the current architecture
(server-as-truth + Markdown mirror, no accounts):

| Gap | Notion has | OpenNote today | Size | Notes |
|---|---|---|---|---|
| Real-time presence / cursors | yes | no | **OOS** now | Would need CRDT (Yjs) instead of per-block LWW. A deliberate architectural fork, not a bug. |
| Comments / discussions | yes | no | **P2 / OOS** | Feasible as a non-synced or lightly-synced side table, but no account model to attribute them. |
| @mentions of people | yes | no | **OOS** | No user directory. |
| Sharing & granular permissions | yes | no | **OOS** | The security review already flagged the sync server is single-user/unauthenticated by design. Multi-tenant sharing is a different product. |
| Public web publish | yes | no | **P2** | Could export a page/site statically without the account model. |
| Guests, workspaces, teamspaces | yes | no | **OOS** | |

If team collaboration becomes a goal, the honest path is a **second track**
(accounts + auth + CRDT), not incremental patches to the local-first core.

---

## 6. History, safety, org

| Gap | Notion has | OpenNote today | Size | Notes |
|---|---|---|---|---|
| Page version history / revisions | yes (30-day+) | no | **P1** | The Markdown vault + git could back this cheaply (snapshot the vault); no in-app timeline yet. |
| Duplicate page / duplicate with content | Notion yes | templates only; no generic "duplicate this page" | **P1** | |
| Move-to (reparent via picker), not just tree drag | yes | `movePage` exists in the repo but no UI to invoke it | **P1** | |
| Drag-to-reorder (tree pages, board cards) | yes | fractional-key model exists; **no drag UI** | **P1** | Mechanism is ready (`sortkey.ts`), only the DnD interaction is missing. |
| Bulk select / multi-page actions | yes | no | **P2** | |
| Recently visited / quick switcher history | ⌘K exists; no recency | partial | **P2** | Search has no recent-items list. |

---

## 7. Platform & integrations (mostly OOS / later)

| Gap | Notion has | OpenNote today | Size | Notes |
|---|---|---|---|---|
| Mobile apps (iOS/Android) | yes | no (desktop Electron only) | **P2 / later** | Web core is portable; a native shell is a separate milestone. |
| Web app (browser, no install) | yes | dev-only browser mode (mirror disabled) | **P2** | |
| Public API / integrations / webhooks | yes | no | **OOS** | |
| Notion AI (Q&A, summarize, autofill) | yes | no | **P2** | |
| Reminders / notifications / recurring dates | yes | no | **P2** | |
| Import from Notion / Evernote / others | Notion imports many | Markdown import only | **P2** | A Notion-export (zip of md+csv) importer is high-value and feasible. |

---

## 8. Interaction polish still short of Notion

From the two design critiques (`.impeccable/critique/`), score 30/40, these
remain (not blockers, but Notion does them):

- Slash-command / shortcut hints surfaced in the UI (discoverability).
- Arrow-key navigation in the page tree (Enter/Space only today).
- `<select multiple>` cells break table density — should be chip cells.
- Editor autosave has no visible "saving/saved" state (only server sync does).
- No sidebar-collapse affordance at narrow widths.
- Onboarding / help / empty-state teaching is thin (Help & Docs scored 2/4).

---

## 9. Recommended sequence toward 1:1

If the goal is genuinely "1:1 Notion" for a **single user**, tackle in this
order — each is architecture-compatible and high-leverage:

1. **P0 — Filter & sort in database views.** The data model is done; only
   `DatabaseView` ignores `ViewDef.filter`/`sortBy`. Cheapest big win.
2. **P0 — Image/file upload** into the vault (attachments folder + mirror
   paths + BlockNote image block + clipboard paste). Unblocks the Files
   property too.
3. **P0 — Sub-page-as-block + inline/linked databases.** The defining Notion
   structural feature ("everything is a block"). Largest single effort; may
   need a `blocks.type = 'page' | 'database-view'` bridge between the `pages`
   and `blocks` tables.
4. **P1 — More property types**: formula, created/edited-by/-time, person(-lite),
   files; plus table group-by.
5. **P1 — Editor blocks**: toggle, callout, columns (with mirror
   serialization).
6. **P1 — History**: snapshot the Markdown vault (git-backed) + an in-app
   restore timeline; plus duplicate-page and a move-to picker; wire drag
   reorder onto the existing fractional keys.
7. **P2 — Notion-export importer**, public static page publish, web build,
   remaining view types, interaction polish from §8.

Explicitly **not on this path** (would fork the product): real-time
collaboration/CRDT, accounts, sharing/permissions, @mentions, public API,
teamspaces. Those belong to a separate "OpenNote Teams" track if ever pursued.

---

## Verification note

Every gap above was checked against the codebase on 2026-07-14:
`src/lib/database.ts` (property/view types), `src/components/DatabaseView.tsx`
(filter/sort not wired — only `groupBy` read), `src/lib/markdown.ts` (mirror
block coverage), `src/lib/database.ts` grep for `formula|person|files` (0),
`src/` grep for `upload|presence|comment|share|permission|yjs|crdt|version|
history` (none found), and `shared/migrations/` (no revisions table).
