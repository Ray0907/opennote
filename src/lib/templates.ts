/**
 * Built-in page templates (M7).
 *
 * A template is a factory: calling `instantiate` produces a fresh BNBlock[]
 * with new block ids each time, so two pages created from the same template
 * never share block identity (block ids are sync/DB primary keys).
 */
import type { BNBlock, Inline } from './markdown'

export interface PageTemplate {
  id: string
  name: string
  /** Default page title; the user renames after creation. */
  title: string
  /** Emoji icon applied to the created page (M6 icon support). */
  icon: string | null
  build: () => BNBlock[]
}

function txt(text: string): Inline[] {
  return [{ type: 'text', text, styles: {} }]
}

function block(
  type: string,
  content: Inline[],
  props: Record<string, unknown> = {},
  children: BNBlock[] = [],
): BNBlock {
  return { id: crypto.randomUUID(), type, props, content, children }
}

const h = (level: number, text: string) => block('heading', txt(text), { level })
const p = (text = '') => block('paragraph', txt(text))
const li = (text: string) => block('bulletListItem', txt(text))
const check = (text: string) => block('checkListItem', txt(text), { checked: false })

export const TEMPLATES: PageTemplate[] = [
  {
    id: 'meeting-notes',
    name: 'Meeting Notes',
    title: 'Meeting Notes',
    icon: '📝',
    build: () => [
      h(2, 'Attendees'),
      li(''),
      h(2, 'Agenda'),
      li(''),
      h(2, 'Notes'),
      p(),
      h(2, 'Action Items'),
      check(''),
    ],
  },
  {
    id: 'weekly-plan',
    name: 'Weekly Plan',
    title: 'Weekly Plan',
    icon: '📅',
    build: () => [
      h(2, 'Goals'),
      check(''),
      h(2, 'Monday'),
      p(),
      h(2, 'Tuesday'),
      p(),
      h(2, 'Wednesday'),
      p(),
      h(2, 'Thursday'),
      p(),
      h(2, 'Friday'),
      p(),
      h(2, 'Review'),
      p(),
    ],
  },
  {
    id: 'project-brief',
    name: 'Project Brief',
    title: 'Project Brief',
    icon: '🎯',
    build: () => [
      h(2, 'Overview'),
      p(),
      h(2, 'Goals'),
      li(''),
      h(2, 'Non-goals'),
      li(''),
      h(2, 'Milestones'),
      check(''),
      h(2, 'Risks'),
      li(''),
    ],
  },
]

export function getTemplate(id: string): PageTemplate | null {
  return TEMPLATES.find((t) => t.id === id) ?? null
}
