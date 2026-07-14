---
name: OpenNote
description: A local-first, data-sovereign Notion-style workspace
colors:
  working-blue: "#2f80ed"
  ink: "#37352f"
  muted-ink: "#9b9a97"
  paper: "#ffffff"
  desk: "#f7f6f3"
  hairline: "#e6e4df"
  hover-wash: "#eceae5"
  selected-wash: "#e3e1dc"
  selection-tint: "#e3f0f8"
  selection-ink: "#1f5f8b"
  error: "#c0392b"
  dark-paper: "#1f1f1e"
  dark-desk: "#191918"
  dark-hairline: "#33322f"
  dark-hover-wash: "#2a2a28"
  dark-selected-wash: "#35342f"
  dark-ink: "#e9e7e2"
  dark-muted-ink: "#8f8d87"
  dark-working-blue: "#4a92f0"
  dark-selection-tint: "#1e3a5c"
  dark-selection-ink: "#8ec1f5"
  dark-error: "#e57373"
typography:
  display:
    fontFamily: "ui-sans-serif, -apple-system, 'Segoe UI', Helvetica, Arial, sans-serif"
    fontSize: "34px"
    fontWeight: 700
    lineHeight: 1.2
  body:
    fontFamily: "ui-sans-serif, -apple-system, 'Segoe UI', Helvetica, Arial, sans-serif"
    fontSize: "14px"
    fontWeight: 400
    lineHeight: 1.5
  input:
    fontFamily: "ui-sans-serif, -apple-system, 'Segoe UI', Helvetica, Arial, sans-serif"
    fontSize: "15px"
    fontWeight: 400
    lineHeight: 1.4
  compact:
    fontFamily: "ui-sans-serif, -apple-system, 'Segoe UI', Helvetica, Arial, sans-serif"
    fontSize: "13px"
    fontWeight: 400
    lineHeight: 1.4
  chip:
    fontFamily: "ui-sans-serif, -apple-system, 'Segoe UI', Helvetica, Arial, sans-serif"
    fontSize: "12px"
    fontWeight: 400
    lineHeight: 1.4
  micro:
    fontFamily: "ui-sans-serif, -apple-system, 'Segoe UI', Helvetica, Arial, sans-serif"
    fontSize: "11px"
    fontWeight: 400
    lineHeight: 1.3
  label:
    fontFamily: "ui-sans-serif, -apple-system, 'Segoe UI', Helvetica, Arial, sans-serif"
    fontSize: "11px"
    fontWeight: 600
    letterSpacing: "0.04em"
rounded:
  sm: "4px"
  md: "6px"
  lg: "8px"
spacing:
  xs: "4px"
  sm: "8px"
  md: "12px"
  lg: "16px"
  xl: "32px"
  xxl: "48px"
components:
  tree-item:
    textColor: "{colors.ink}"
    rounded: "{rounded.sm}"
    padding: "4px 8px"
  tree-item-hover:
    backgroundColor: "{colors.hover-wash}"
  tree-item-selected:
    backgroundColor: "{colors.selected-wash}"
  button-chip:
    backgroundColor: "{colors.paper}"
    textColor: "{colors.ink}"
    rounded: "{rounded.sm}"
    padding: "2px 8px"
  db-card:
    backgroundColor: "{colors.paper}"
    rounded: "{rounded.sm}"
    padding: "4px 8px"
  search-dialog:
    backgroundColor: "{colors.paper}"
    rounded: "{rounded.lg}"
    width: "560px"
---

# Design System: OpenNote

## 1. Overview

**Creative North Star: "The Paper Workspace"**

OpenNote's interface is a desk with paper on it. The white content surface is
the page you are writing; the faintly warm sidebar (`#f7f6f3`) is the desk it
rests on. Everything you write is literally paper — a Markdown file in a vault
you own — and the UI honors that: flat surfaces, hairline separations, quiet
grays, and one Working Blue that appears only when something is selected or
actionable. The chrome recedes; the document is the interface.

The system explicitly rejects SaaS-gradient aesthetics, over-branded
"developer tool" dark UIs, decorative motion, and custom form controls. This
is the Notion lineage by deliberate choice: earned familiarity is the brand.
Users fluent in Notion should never pause at an off component.

**Key Characteristics:**
- Two-layer neutral scheme: white paper for content, warm desk gray for chrome
- One accent (Working Blue) at well under 10% of any screen
- Flat by default; shadows only on floating layers
- Compact, refined controls that reveal themselves on hover
- System font stack throughout — no display fonts, no font loading

## 2. Colors

Warm-neutral paper tones carrying a single functional blue.

### Primary
- **Working Blue** (#2f80ed): Links, wiki-links, primary actions, focus
  rings, sync-state indicators. Never decoration; if nothing is selected or
  actionable, the screen contains no blue.
- **Selection Tint / Selection Ink** (#e3f0f8 / #337ea9): Chosen options in
  multi-select and relation cells — Working Blue's quiet resting form.

### Neutral
- **Ink** (#37352f): All body and heading text. A warm near-black, never
  pure #000.
- **Muted Ink** (#9b9a97): Placeholders, empty states, timestamps, metadata.
  For text that must actually be read, use Ink — Muted Ink is for text the
  user is allowed to ignore.
- **Paper** (#ffffff): The content surface. Pages, cards, dialogs, inputs.
- **Desk** (#f7f6f3): The chrome layer — sidebar, template menu, active
  search hit. Always paired with a Hairline border where it meets Paper.
- **Hairline** (#e6e4df): 1px borders and dividers. The only border weight
  in the system.
- **Hover Wash / Selected Wash** (#eceae5 / #e3e1dc): Tree-item hover and
  selected states — the desk darkening under your hand.
- **Error** (#c0392b): Boot failures and destructive confirmation only.

### Dark theme
Warm-dark, never pure black — the desk goes near-black (#191918), paper one
step lighter (#1f1f1e), separated by a warm Hairline (#33322f). Ink lifts to
#e9e7e2 (13:1 on paper), muted to #8f8d87 (still ≥4.9:1, so dark actually
reads *better* than light for metadata). Working Blue brightens to #4a92f0 so
it stays legible on dark surfaces. Set on `<html data-theme="dark">` by
`src/lib/theme.ts`; preference is system-following by default, cycled
system → light → dark from the sidebar header.

### Named Rules
**The Working Blue Rule.** The accent marks selection, links, and primary
actions — nothing else. A screen with no selection and no actionable state
contains zero blue pixels.

**The Two-Layer Rule.** Content lives on Paper; chrome lives on Desk. No
third background tone is permitted, and the two always meet at a 1px
Hairline.

## 3. Typography

**Display Font:** system UI sans (ui-sans-serif → -apple-system → Segoe UI)
**Body Font:** same family — one stack carries everything

**Character:** Invisible, native, instant. The OS's own face at a compact,
Notion-derived scale; typography earns trust by being unremarkable.

### Hierarchy
- **Display** (700, 34px, 1.2): Page titles only — the one large text
  element per screen.
- **Body** (400, 14px, 1.5): Tree items, editor prose base, search-hit
  titles (500). Editor prose column caps at 820px (~72ch).
- **Compact** (400, 13px): Buttons, template items, hints, db cards.
- **Label** (600, 11px, 0.04em, uppercase): Sidebar section labels
  (FAVORITES, PAGES) and calendar day headers only. This is the system's
  single sanctioned eyebrow — never introduce it above content sections.
- **Micro** (400, 11–12px): Snippets, calendar dates, cover buttons.

### Named Rules
**The One Voice Rule.** One font family, one text scale. A second family or
a >34px size is forbidden.

## 4. Elevation

Flat by default. Surfaces at rest are separated by Hairline borders and the
Paper/Desk tonal split — never by shadow. Shadows exist solely to mark the
floating layer: things that hover above the page and will be dismissed.

### Shadow Vocabulary
- **Dialog** (`box-shadow: 0 8px 32px rgba(0, 0, 0, 0.2)`): Search dialog
  over its scrim (`rgba(15, 15, 15, 0.4)`).
- **Popover** (`box-shadow: 0 4px 16px rgba(15, 15, 15, 0.12)`): Icon and
  cover pickers anchored to the page header.

### Named Rules
**The Float-Only Rule.** If it doesn't float, it doesn't cast. Cards, board
columns, and tables are flat; a shadow on a resting surface is a bug.

## 5. Components

Refined and restrained: small type, hairline borders, actions that appear on
hover. Controls whisper until needed.

### Buttons
- **Shape:** Gently rounded (4px)
- **Chip buttons** (sidebar, covers): Paper background, 1px Hairline border,
  12px text, 2px 8px padding.
- **Ghost buttons** (db tabs, add-row, tree actions, icon picker): borderless
  and transparent; hover paints a faint ink wash (`rgba(0,0,0,0.05–0.08)`).
- **Hover-reveal:** Row and header actions are hidden at rest
  (`display: none` / `opacity: 0`) and appear on hover, 0.15s ease.
- **Disabled:** 50% opacity, default cursor.

### Tree items (signature)
- 14px text, 4px 8px padding, 4px radius, 4px side margins.
- Hover: Hover Wash. Selected: Selected Wash + weight 600 — selection is a
  tone shift, not a blue fill.
- Action buttons materialize on hover only.

### Cards / Containers
- **db-card:** Paper on a `rgba(0,0,0,0.03)` board column, 1px Hairline,
  4px radius, 13px text. Flat (Float-Only Rule).
- **Board columns:** 6px radius, 8px padding, min-width 180px.

### Inputs / Fields
- **Page title:** borderless transparent input, 34px/700; placeholder in
  Muted Ink.
- **Table cells:** invisible inputs (`font: inherit`, no border) inside
  1px-bordered cells — the grid is the affordance.
- **Search input:** 15px, borderless, hairline bottom divider.

### Navigation
- **Sidebar:** 260px fixed, Desk background, Hairline right border; header,
  scrollable tree, footer split by hairlines.
- **Search dialog:** 560px, 8px radius, Dialog shadow, centered at 12vh
  under the scrim; active hit takes the Desk tone.

### Database views (signature)
- Table: `border-collapse` grid of 1px Hairline cells, 2px 6px padding —
  denser than prose, per product register.
- Calendar: 7-column grid, 72px min cells, 11px micro labels.

## 6. Do's and Don'ts

### Do:
- **Do** keep Working Blue under 10% of any screen (The Working Blue Rule).
- **Do** separate resting surfaces with 1px Hairline (#e6e4df) or the
  Paper/Desk split — never with shadow.
- **Do** ship every control with hover, focus, active, disabled, and
  selected states; hover-reveal actions at 0.15s.
- **Do** keep motion 150–250ms, ease-out, state-conveying only — nothing
  animates while the user is typing.
- **Do** use native form controls; familiarity is the feature.

### Don't:
- **Don't** let "SaaS-gradient landing-page aesthetics" leak into the app —
  no gradient text, no glassmorphism, no hero metrics (PRODUCT.md
  anti-reference, verbatim).
- **Don't** build an "over-branded developer-tool dark UI — neon accents,
  terminal cosplay" when dark mode lands; dark surfaces stay warm and quiet.
- **Don't** add decorative motion or page-load choreography.
- **Don't** replace native scrollbars, selects, or inputs with custom
  controls.
- **Don't** use color as decoration: blue backgrounds on inactive chrome,
  colored side-stripes (`border-left` > 1px), or full-saturation accents on
  inactive states.
- **Don't** introduce a second font family, a third background tone, or an
  uppercase eyebrow outside sidebar section labels.
