/**
 * Pure BlockNote-JSON -> Markdown serializer for the mirror files.
 *
 * Kept dependency-free (no editor/DOM instance needed) so it is unit-testable
 * and reusable by the M4 exporter. Handles the block types OpenNote enables;
 * unknown types degrade to their plain text content.
 */

export interface InlineText {
  type: 'text'
  text: string
  styles?: Record<string, unknown>
}

export interface InlineLink {
  type: 'link'
  href: string
  content: InlineText[]
}

export type Inline = InlineText | InlineLink | { type: string; [k: string]: unknown }

export interface BNBlock {
  id: string
  type: string
  props?: Record<string, unknown>
  content?: Inline[] | unknown
  children?: BNBlock[]
}

export interface MirrorPage {
  id: string
  title: string
  created_at?: string
  updated_at?: string
}

function styleWrap(text: string, styles: Record<string, unknown> | undefined): string {
  if (!text) return text
  let out = text
  if (!styles) return out
  if (styles.code) out = '`' + out + '`'
  if (styles.bold) out = '**' + out + '**'
  if (styles.italic) out = '*' + out + '*'
  if (styles.strike || styles.strikethrough) out = '~~' + out + '~~'
  return out
}

export function serializeInline(content: unknown): string {
  if (!Array.isArray(content)) return ''
  return content
    .map((node: Inline) => {
      if (node.type === 'link') {
        const link = node as InlineLink
        return `[${serializeInline(link.content)}](${link.href})`
      }
      if (node.type === 'text') {
        const t = node as InlineText
        return styleWrap(t.text, t.styles)
      }
      // Unknown inline node (e.g. future mentions): best-effort text.
      const anyNode = node as { text?: string }
      return anyNode.text ?? ''
    })
    .join('')
}

interface Ctx {
  indent: string
  listIndex: number
  attachmentPrefix: string
}

function attachmentUrl(url: unknown, prefix: string): string {
  if (typeof url !== 'string') return ''
  return url.startsWith('attachments/') ? prefix + url : url
}

function canonicalAttachmentUrl(url: string): string {
  return /^(?:\.\.\/)*attachments\//.test(url)
    ? url.replace(/^(?:\.\.\/)*attachments\//, 'attachments/')
    : url
}

function serializeBlock(block: BNBlock, ctx: Ctx): string[] {
  const text = serializeInline(block.content)
  const props = block.props ?? {}
  const lines: string[] = []
  let childIndent = ctx.indent
  let closeDetails = false

  if (block.type === 'columns') {
    const columns = block.children ?? []
    lines.push(`${ctx.indent}<div class="opennote-columns" data-columns="${Number(props.columns) || columns.length || 2}">`)
    for (const column of columns) {
      lines.push(`${ctx.indent}<section class="opennote-column">`)
      for (const child of column.children ?? []) {
        lines.push(...serializeBlock(child, { ...ctx, listIndex: 1 }))
      }
      lines.push(`${ctx.indent}</section>`)
    }
    lines.push(`${ctx.indent}</div>`)
    return lines
  }

  switch (block.type) {
    case 'heading': {
      const level = Math.min(Math.max(Number(props.level ?? 1), 1), 6)
      lines.push(`${ctx.indent}${'#'.repeat(level)} ${text}`)
      break
    }
    case 'bulletListItem':
      lines.push(`${ctx.indent}- ${text}`)
      childIndent = ctx.indent + '  '
      break
    case 'numberedListItem':
      lines.push(`${ctx.indent}${ctx.listIndex}. ${text}`)
      childIndent = ctx.indent + '   '
      break
    case 'checkListItem':
      lines.push(`${ctx.indent}- [${props.checked ? 'x' : ' '}] ${text}`)
      childIndent = ctx.indent + '  '
      break
    case 'codeBlock': {
      const lang = typeof props.language === 'string' ? props.language : ''
      lines.push(`${ctx.indent}\`\`\`${lang}`)
      for (const line of text.split('\n')) lines.push(`${ctx.indent}${line}`)
      lines.push(`${ctx.indent}\`\`\``)
      break
    }
    case 'quote':
      lines.push(`${ctx.indent}> ${text}`)
      break
    case 'callout':
      lines.push(`${ctx.indent}> [!NOTE] ${String(props.icon || '💡')} ${text}`)
      break
    case 'toggle':
      lines.push(`${ctx.indent}<details${props.collapsed ? '' : ' open'}>`)
      lines.push(`${ctx.indent}<summary>${text}</summary>`)
      lines.push('')
      closeDetails = true
      break
    case 'column':
      break
    case 'image': {
      const label = String(props.caption || props.name || '')
      lines.push(`${ctx.indent}![${label}](${attachmentUrl(props.url, ctx.attachmentPrefix)})`)
      break
    }
    case 'file': {
      const label = String(props.name || props.caption || 'File')
      lines.push(`${ctx.indent}[${label}](${attachmentUrl(props.url, ctx.attachmentPrefix)})<!-- opennote:file -->`)
      break
    }
    case 'video':
    case 'audio': {
      const label = String(props.caption || props.name || (block.type === 'video' ? 'Video' : 'Audio'))
      lines.push(`${ctx.indent}[${label}](${attachmentUrl(props.url, ctx.attachmentPrefix)})<!-- opennote:${block.type} -->`)
      break
    }
    case 'pageLink':
      lines.push(`${ctx.indent}[${String(props.title || 'Untitled')}](opennote://page/${String(props.pageId || '')})`)
      break
    case 'databaseView':
      lines.push(`${ctx.indent}[${String(props.title || 'Database')}](opennote://database/${String(props.databaseId || '')})`)
      break
    case 'tableOfContents':
      lines.push(`${ctx.indent}[Table of contents](opennote://toc)`)
      break
    case 'breadcrumb':
      lines.push(`${ctx.indent}[Breadcrumb](opennote://breadcrumb)`)
      break
    case 'paragraph':
    default:
      lines.push(`${ctx.indent}${text}`)
      break
  }

  if (block.children && block.children.length > 0) {
    let listIndex = 1
    for (const child of block.children) {
      lines.push(...serializeBlock(child, { indent: childIndent, listIndex, attachmentPrefix: ctx.attachmentPrefix }))
      listIndex = child.type === 'numberedListItem' ? listIndex + 1 : 1
    }
  }
  if (closeDetails) lines.push(`${ctx.indent}</details>`)
  return lines
}

export function blocksToMarkdown(blocks: BNBlock[], attachmentPrefix = ''): string {
  const out: string[] = []
  let listIndex = 1
  for (const block of blocks) {
    out.push(...serializeBlock(block, { indent: '', listIndex, attachmentPrefix }))
    listIndex = block.type === 'numberedListItem' ? listIndex + 1 : 1
    out.push('') // blank line between top-level blocks
  }
  return out.join('\n').replace(/\n{3,}/g, '\n\n').trimEnd() + '\n'
}

function yamlEscape(value: string): string {
  return `"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`
}

/** Full mirror file: YAML frontmatter (page identity) + markdown body. */
export function pageToMarkdown(page: MirrorPage, blocks: BNBlock[], attachmentPrefix = ''): string {
  const fm = [
    '---',
    `id: ${page.id}`,
    `title: ${yamlEscape(page.title)}`,
    ...(page.created_at ? [`created: ${page.created_at}`] : []),
    ...(page.updated_at ? [`updated: ${page.updated_at}`] : []),
    '---',
    '',
  ]
  return fm.join('\n') + blocksToMarkdown(blocks, attachmentPrefix)
}

/** Prefix from a nested mirror file back to the vault-root attachments folder. */
export function attachmentPrefixForMirror(relPath: string): string {
  return '../'.repeat(Math.max(0, relPath.split('/').length - 1))
}

// ---------------------------------------------------------------------------
// Markdown -> BlockNote-JSON parser (M4 importer). Inverse of the serializer
// above for the block types OpenNote enables; unknown markdown degrades to
// paragraphs. Dependency-free and unit-testable, same as the serializer.
// ---------------------------------------------------------------------------

export type IdFactory = () => string

const defaultId: IdFactory = () => crypto.randomUUID()

/** Parse inline markdown (bold/italic/code/strike/links) into BN inline nodes. */
export function parseInline(src: string): Inline[] {
  const out: Inline[] = []
  let text = ''
  const flush = (styles?: Record<string, unknown>) => {
    if (text) out.push({ type: 'text', text, ...(styles ? { styles } : {}) })
    text = ''
  }
  let i = 0
  while (i < src.length) {
    // [label](href)
    if (src[i] === '[') {
      const m = /^\[([^\]]*)\]\(([^)]*)\)/.exec(src.slice(i))
      if (m) {
        flush()
        out.push({
          type: 'link',
          href: m[2],
          content: parseInline(m[1]).filter((n) => n.type === 'text') as InlineText[],
        })
        i += m[0].length
        continue
      }
    }
    // `code` (no nesting inside)
    if (src[i] === '`') {
      const end = src.indexOf('`', i + 1)
      if (end > i) {
        flush()
        out.push({ type: 'text', text: src.slice(i + 1, end), styles: { code: true } })
        i = end + 1
        continue
      }
    }
    // **bold**, *italic*, ~~strike~~ — find matching closer, parse inner recursively.
    const wrap = (marker: string, style: string): boolean => {
      if (!src.startsWith(marker, i)) return false
      let end = src.indexOf(marker, i + marker.length)
      if (end === -1 || end === i + marker.length) return false // no closer / empty inner
      // '**a *b***': prefer the closer that keeps inner '*' markers balanced.
      if (marker === '**' && src[end + marker.length] === '*') {
        const inner = src.slice(i + marker.length, end)
        if ((inner.split('*').length - 1) % 2 === 1) end += 1
      }
      flush()
      for (const node of parseInline(src.slice(i + marker.length, end))) {
        if (node.type === 'text') {
          const t = node as InlineText
          out.push({ ...t, styles: { ...(t.styles ?? {}), [style]: true } })
        } else {
          out.push(node)
        }
      }
      i = end + marker.length
      return true
    }
    if (wrap('**', 'bold') || wrap('~~', 'strike') || wrap('*', 'italic')) continue
    text += src[i]
    i++
  }
  flush()
  return out
}

interface ParsedLine {
  indent: number
  type: BNBlock['type']
  props: Record<string, unknown>
  text: string
}

function classifyLine(raw: string): ParsedLine {
  const indentMatch = /^(\s*)/.exec(raw)!
  const indent = indentMatch[1].length
  const line = raw.slice(indent)
  let m: RegExpExecArray | null
  if ((m = /^(#{1,6})\s+(.*)$/.exec(line)))
    return { indent, type: 'heading', props: { level: m[1].length }, text: m[2] }
  if ((m = /^- \[( |x|X)\]\s+(.*)$/.exec(line)))
    return { indent, type: 'checkListItem', props: { checked: m[1].toLowerCase() === 'x' }, text: m[2] }
  if ((m = /^[-*]\s+(.*)$/.exec(line)))
    return { indent, type: 'bulletListItem', props: {}, text: m[1] }
  if ((m = /^\d+\.\s+(.*)$/.exec(line)))
    return { indent, type: 'numberedListItem', props: {}, text: m[1] }
  if ((m = /^>\s*\[!NOTE\]\s+(\S+)\s*(.*)$/.exec(line)))
    return { indent, type: 'callout', props: { icon: m[1] }, text: m[2] }
  if ((m = /^>\s?(.*)$/.exec(line)))
    return { indent, type: 'quote', props: {}, text: m[1] }
  return { indent, type: 'paragraph', props: {}, text: line }
}

const LIST_TYPES = new Set(['bulletListItem', 'numberedListItem', 'checkListItem'])

/** Parse a markdown body (no frontmatter) into BlockNote-JSON blocks. */
export function markdownToBlocks(md: string, id: IdFactory = defaultId): BNBlock[] {
  const lines = md.replace(/\r\n/g, '\n').split('\n')
  const roots: BNBlock[] = []
  // Stack of open list items for nesting: [{ block, indent }]
  const stack: Array<{ block: BNBlock; indent: number }> = []
  let i = 0
  while (i < lines.length) {
    const raw = lines[i]
    if (!raw.trim()) {
      i++
      continue
    }
    // Fenced code block (never nested — serializer emits them at any indent,
    // but content is taken verbatim relative to the fence indent).
    const fence = /^(\s*)```(.*)$/.exec(raw)
    if (fence) {
      const fenceIndent = fence[1].length
      const language = fence[2].trim()
      const body: string[] = []
      i++
      while (i < lines.length && !/^\s*```\s*$/.test(lines[i])) {
        body.push(lines[i].slice(fenceIndent))
        i++
      }
      i++ // skip closing fence
      roots.push({
        id: id(),
        type: 'codeBlock',
        props: language ? { language } : {},
        content: [{ type: 'text', text: body.join('\n') }],
        children: [],
      })
      stack.length = 0
      continue
    }
    const details = /^<details( open)?>\s*$/.exec(raw.trim())
    if (details) {
      const summary = /^<summary>(.*)<\/summary>\s*$/.exec(lines[i + 1]?.trim() ?? '')
      if (!summary) {
        i++
        continue
      }
      i += 2
      const body: string[] = []
      while (i < lines.length && lines[i].trim() !== '</details>') body.push(lines[i++])
      if (i < lines.length) i++
      roots.push({
        id: id(),
        type: 'toggle',
        props: { collapsed: !details[1] },
        content: parseInline(summary[1]),
        children: markdownToBlocks(body.join('\n'), id),
      })
      stack.length = 0
      continue
    }
    const columns = /^<div class="opennote-columns" data-columns="(\d+)">\s*$/.exec(raw.trim())
    if (columns) {
      const children: BNBlock[] = []
      i++
      while (i < lines.length && lines[i].trim() !== '</div>') {
        if (lines[i].trim() !== '<section class="opennote-column">') {
          i++
          continue
        }
        i++
        const body: string[] = []
        while (i < lines.length && lines[i].trim() !== '</section>') body.push(lines[i++])
        if (i < lines.length) i++
        children.push({
          id: id(),
          type: 'column',
          props: {},
          content: [],
          children: markdownToBlocks(body.join('\n'), id),
        })
      }
      if (i < lines.length) i++
      roots.push({
        id: id(),
        type: 'columns',
        props: { columns: Number(columns[1]) },
        content: [],
        children,
      })
      stack.length = 0
      continue
    }
    if (raw.trim() === '[Table of contents](opennote://toc)') {
      roots.push({ id: id(), type: 'tableOfContents', props: {}, content: [], children: [] })
      stack.length = 0
      i++
      continue
    }
    if (raw.trim() === '[Breadcrumb](opennote://breadcrumb)') {
      roots.push({ id: id(), type: 'breadcrumb', props: {}, content: [], children: [] })
      stack.length = 0
      i++
      continue
    }
    const reference = /^\[([^\]]*)\]\(opennote:\/\/(page|database)\/([^)]+)\)$/.exec(raw.trim())
    if (reference) {
      roots.push({
        id: id(),
        type: reference[2] === 'page' ? 'pageLink' : 'databaseView',
        props: reference[2] === 'page'
          ? { pageId: reference[3], title: reference[1] }
          : { databaseId: reference[3], title: reference[1] },
        content: [],
        children: [],
      })
      stack.length = 0
      i++
      continue
    }
    const file = /^\[([^\]]*)\]\(([^)]+)\)<!-- opennote:(file|video|audio) -->$/.exec(raw.trim())
    if (file) {
      const kind = file[3] as 'file' | 'video' | 'audio'
      const fallback = kind === 'video' ? 'Video' : kind === 'audio' ? 'Audio' : 'File'
      roots.push({
        id: id(),
        type: kind,
        props: { url: canonicalAttachmentUrl(file[2]), name: file[1] || fallback },
        content: [],
        children: [],
      })
      stack.length = 0
      i++
      continue
    }
    const image = /^!\[([^\]]*)\]\(([^)]+)\)$/.exec(raw.trim())
    if (image) {
      roots.push({
        id: id(),
        type: 'image',
        props: { url: canonicalAttachmentUrl(image[2]), name: image[1], caption: image[1] },
        content: [],
        children: [],
      })
      stack.length = 0
      i++
      continue
    }
    const parsed = classifyLine(raw)
    const block: BNBlock = {
      id: id(),
      type: parsed.type,
      props: parsed.props,
      content: parseInline(parsed.text),
      children: [],
    }
    if (LIST_TYPES.has(parsed.type)) {
      // Pop siblings/parents at >= indent, then attach to nearest shallower item.
      while (stack.length > 0 && stack[stack.length - 1].indent >= parsed.indent) stack.pop()
      if (stack.length > 0) stack[stack.length - 1].block.children!.push(block)
      else roots.push(block)
      stack.push({ block, indent: parsed.indent })
    } else {
      stack.length = 0
      roots.push(block)
    }
    i++
  }
  return roots
}

export interface ImportedPage {
  title: string
  blocks: BNBlock[]
}

/**
 * Full import: optional YAML frontmatter (title only — ids are never trusted
 * from imported files) + markdown body. Falls back to the first heading, then
 * the provided default, for the title.
 */
export function markdownToPage(
  md: string,
  fallbackTitle = 'Imported page',
  id: IdFactory = defaultId,
): ImportedPage {
  let body = md
  let title: string | undefined
  const fm = /^---\n([\s\S]*?)\n---\n?/.exec(md)
  if (fm) {
    body = md.slice(fm[0].length)
    const t = /^title:\s*(.*)$/m.exec(fm[1])
    if (t) {
      const rawTitle = t[1].trim()
      title = rawTitle.startsWith('"')
        ? rawTitle.slice(1, -1).replace(/\\"/g, '"').replace(/\\\\/g, '\\')
        : rawTitle
    }
  }
  const blocks = markdownToBlocks(body, id)
  if (!title) {
    const h = blocks.find((b) => b.type === 'heading')
    if (h) title = serializeInline(h.content).trim() || undefined
  }
  return { title: title || fallbackTitle, blocks }
}

/** Safe cross-platform file name derived from a page title. */
export function sanitizeFileName(title: string): string {
  const cleaned = title
    .replace(/[<>:"/\\|?*\x00-\x1f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 120)
  return cleaned || 'Untitled'
}
