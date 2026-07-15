/**
 * Bridge to the native shell (Electron preload). The web core only ever
 * talks to this interface, never to Electron directly, so it also runs in a
 * plain browser (mirror becomes a no-op there; import/export fall back to
 * the browser's download / file-picker mechanisms).
 */
export interface ImportedFile {
  name: string
  content: string
}

export interface VaultRevision {
  hash: string
  date: string
  message: string
}

export const MAX_ATTACHMENT_BYTES = 50 * 1024 * 1024

export function assertAttachmentSize(size: number): void {
  if (size > MAX_ATTACHMENT_BYTES) {
    throw new Error('Attachments must be 50 MB or smaller.')
  }
}

export interface ShellApi {
  /** Atomically write a mirror file, path relative to the vault root. */
  writeMirror(relPath: string, content: string): Promise<void>
  /** Delete a mirror file; missing files are not an error. */
  deleteMirror(relPath: string): Promise<void>
  /** Absolute path of the vault folder (for display). */
  vaultPath(): Promise<string>
  /** Open the vault folder in the OS file manager. */
  revealVault(): Promise<void>
  /** Whether native shell features (mirror, reveal) are available. */
  readonly isDesktop: boolean
  /** Save-dialog + write. Resolves to the chosen path, or null if cancelled. */
  exportMarkdown(defaultName: string, content: string): Promise<string | null>
  /** Open-dialog + read .md files. Resolves to files, or null if cancelled. */
  importMarkdown(): Promise<ImportedFile[] | null>
  /** Persist an editor upload and return the URL stored in the block. */
  saveAttachment(name: string, type: string, data: ArrayBuffer): Promise<string>
  /** Git-backed revisions for one mirror path, newest first. */
  listHistory(relPath: string): Promise<VaultRevision[]>
  /** Read one historical mirror file without changing the vault. */
  readHistory(relPath: string, hash: string): Promise<string | null>
}

export function attachmentDisplayUrl(url: string, desktop: boolean): string {
  if (!desktop || !url.startsWith('attachments/')) return url
  return `opennote-asset://vault/${url.split('/').map(encodeURIComponent).join('/')}`
}

export function parseGitHistory(raw: string): VaultRevision[] {
  return raw.split('\n').flatMap((line) => {
    const [hash, date, message] = line.split('\u001f')
    return hash && date && message ? [{ hash, date, message }] : []
  })
}

const noopShell: ShellApi = {
  async writeMirror() {
    /* browser dev: mirror disabled */
  },
  async deleteMirror() {
    /* browser dev: mirror disabled */
  },
  async vaultPath() {
    return '(mirror disabled outside the desktop app)'
  },
  async revealVault() {
    /* browser dev: no OS file manager */
  },
  isDesktop: false,
  /** Browser fallback: trigger a download of the .md file. */
  async exportMarkdown(defaultName, content) {
    const blob = new Blob([content], { type: 'text/markdown' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = defaultName
    a.click()
    URL.revokeObjectURL(url)
    return defaultName
  },
  /** Browser fallback: hidden <input type="file"> picker. */
  importMarkdown() {
    return new Promise((resolve) => {
      const input = document.createElement('input')
      input.type = 'file'
      input.accept = '.md,.markdown,.txt'
      input.multiple = true
      input.onchange = async () => {
        const files = Array.from(input.files ?? [])
        if (files.length === 0) return resolve(null)
        resolve(
          await Promise.all(
            files.map(async (f) => ({ name: f.name, content: await f.text() })),
          ),
        )
      }
      input.oncancel = () => resolve(null)
      input.click()
    })
  },
  saveAttachment(_name, type, data) {
    assertAttachmentSize(data.byteLength)
    return new Promise((resolve, reject) => {
      const reader = new FileReader()
      reader.onload = () => resolve(String(reader.result))
      reader.onerror = () => reject(reader.error)
      reader.readAsDataURL(new Blob([data], { type: type || 'application/octet-stream' }))
    })
  },
  async listHistory() {
    return []
  },
  async readHistory() {
    return null
  },
}

export function getShell(): ShellApi {
  const injected = window.opennote
  if (!injected) return noopShell
  // The preload bridge doesn't carry isDesktop; derive it here.
  return {
    ...injected,
    isDesktop: true,
    saveAttachment(name, type, data) {
      assertAttachmentSize(data.byteLength)
      return injected.saveAttachment(name, type, data)
    },
    async listHistory(relPath) {
      const raw = await injected.listHistory(relPath) as unknown
      return parseGitHistory(typeof raw === 'string' ? raw : '')
    },
  }
}
