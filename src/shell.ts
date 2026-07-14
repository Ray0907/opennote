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
}

export function getShell(): ShellApi {
  const injected = window.opennote
  if (!injected) return noopShell
  // The preload bridge doesn't carry isDesktop; derive it here.
  return { ...injected, isDesktop: true }
}
