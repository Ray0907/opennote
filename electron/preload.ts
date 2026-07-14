/**
 * Preload bridge: exposes exactly the ShellApi surface (src/shell.ts) to the
 * web core. Keep this whitelist minimal — it is the entire attack surface.
 */
import { contextBridge, ipcRenderer } from 'electron'

contextBridge.exposeInMainWorld('opennote', {
  writeMirror: (relPath: string, content: string) =>
    ipcRenderer.invoke('mirror:write', relPath, content),
  deleteMirror: (relPath: string) => ipcRenderer.invoke('mirror:delete', relPath),
  vaultPath: () => ipcRenderer.invoke('vault:path'),
  exportMarkdown: (defaultName: string, content: string) =>
    ipcRenderer.invoke('export:markdown', defaultName, content),
  importMarkdown: () => ipcRenderer.invoke('import:markdown'),
})
