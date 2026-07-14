/**
 * Bridge to the native shell (Electron preload). The web core only ever
 * talks to this interface, never to Electron directly, so it also runs in a
 * plain browser (mirror becomes a no-op there).
 */
export interface ShellApi {
  /** Atomically write a mirror file, path relative to the vault root. */
  writeMirror(relPath: string, content: string): Promise<void>
  /** Delete a mirror file; missing files are not an error. */
  deleteMirror(relPath: string): Promise<void>
  /** Absolute path of the vault folder (for display). */
  vaultPath(): Promise<string>
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
}

export function getShell(): ShellApi {
  return window.opennote ?? noopShell
}
