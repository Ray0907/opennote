# OpenNote

A local-first, data-sovereign Notion-style workspace. Runs on macOS, Windows,
and Linux (Electron shell + portable web core). Everything you write is
mirrored as plain Markdown files in a vault you own.

## What

Hierarchical pages with a sidebar tree, block-based rich-text editing
(BlockNote), databases with table/board/calendar views and typed properties
(relation/rollup/multi-select), wiki-links + backlinks, full-text search,
Markdown import/export, templates, favorites, trash/restore, page icons and
covers, and multi-device sync with offline editing (PGlite outbox + LWW,
Electric read path).

## Why

Notion's UX with none of the lock-in. The local PGlite DB is a rebuildable
cache; the source of truth is the Markdown vault (`~/Documents/OpenNoteVault`,
Obsidian-friendly) plus the optional self-hosted sync server. Your files,
your disk, your server.

## Platform

web — web core rendered in an Electron desktop shell (macOS / Windows /
Linux). Desktop-window sizes are the primary viewport; no mobile layouts yet,
but the sidebar/editor split must tolerate narrow windows (~800px).

## Register

product — design serves the tool. The interface should disappear into the
task of writing and organizing.

## Audiences

- **The builder (personal use)** — daily notes and knowledge management;
  fast, keyboard-friendly, zero ceremony.
- **Privacy-minded knowledge workers** — Notion/Obsidian users who demand
  data portability; they will judge whether this feels as trustworthy and
  polished as the tools they left.
- **Small teams (2–10)** — collaborate through the sync server; need clear
  sync/conflict affordances that never interrupt writing.
- **Open-source community** — self-hosters and contributors; conventional,
  legible UI patterns lower the contribution barrier.

## Brand personality

Quiet, dependable, invisible. A calm writing environment in the
Notion/Obsidian lineage: the chrome recedes, the document is the interface.
No decoration that doesn't convey state; familiarity is the feature.

## Visual direction

**Faithful Notion register (deliberate identity choice).** OpenNote is a
1:1-spirit clone; earned familiarity with Notion's visual language is the
point, not a shortcut. Preserve the existing committed palette and metrics:

- Sidebar `#f7f6f3` on white content surface, hairline borders `#e6e4df`
- Ink `#37352f`, muted `#9b9a97`, accent `#2f80ed` (selection, links,
  primary actions only — never decoration)
- System sans stack (ui-sans-serif / -apple-system / Segoe UI)
- 260px sidebar, compact 12–14px UI type, dense-but-airy Notion spacing

Color strategy: **Restrained** — tinted neutrals + one blue accent ≤10%.

**Theme:** light + dark, following system preference (`prefers-color-scheme`),
with a manual override. Dark theme must be a true Notion-style dark
(warm-dark surfaces, not pure black), keeping contrast ≥4.5:1 for body text.

## Anti-references

- SaaS-gradient landing-page aesthetics leaking into the app (gradient text,
  glassmorphism, hero metrics)
- Over-branded "developer tool" dark UIs (neon accents, terminal cosplay)
- Decorative motion; anything that animates while the user is typing
- Custom form controls / scrollbars where native ones read as trustworthy

## Design principles

1. **The document is the interface.** Chrome stays neutral; the accent color
   marks selection and action, nothing else.
2. **Earned familiarity.** When in doubt, do what Notion does; users fluent
   in Notion should never pause at an off component.
3. **State over decoration.** Every interactive element ships with hover /
   focus / active / disabled / selected states; motion (150–250ms, ease-out)
   only conveys state change.
4. **Local-first honesty.** Sync status, offline state, and conflict
   outcomes are visible but never modal; writing is never blocked.
5. **Keyboard-first.** Cmd+K search, `[[` linking, slash commands — every
   pointer path has a keyboard path.
