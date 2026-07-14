# OpenNote

A local-first, data-sovereign Notion-style workspace for macOS, Windows, and
Linux.

- **Block editor** — BlockNote-based rich text: headings, lists, checklists,
  code, quotes, nested blocks
- **Page tree** — hierarchical pages with drag-lite ordering (fractional keys)
- **Local-first** — all data lives in an embedded Postgres (PGlite); no
  account, no cloud required
- **Markdown mirror** — every page is mirrored as a real `.md` file with YAML
  frontmatter into `~/Documents/OpenNoteVault` (atomic writes,
  Obsidian-friendly). Your data is always yours.

## Development

```bash
npm install
npm run dev        # web core in the browser (mirror disabled)
npm start          # build + launch the Electron app
npm run verify     # typecheck + tests + build (CI gate)
```

## Layout

```
electron/            thin native shell (window + mirror IPC only)
src/                 web core (React + BlockNote + PGlite)
  db/                schema bootstrap + repository layer
  lib/               pure logic: fractional keys, markdown serializer
  components/        sidebar + editor pane
shared/migrations/   SQL executed identically by PGlite and (M2) server
docs/                design spec + loop run records
```

## Milestones

- [x] Spec + review findings (`snapshot-0-spec`)
- [ ] M1 local-first editor (`m1`)
- [ ] M2 sync server + offline queue (`m2`)
- [ ] M3 database views (`m3`)
- [ ] M4 wiki links / backlinks / search / import-export (`m4`)
