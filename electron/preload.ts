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
  revealVault: () => ipcRenderer.invoke('vault:reveal'),
  exportMarkdown: (defaultName: string, content: string) =>
    ipcRenderer.invoke('export:markdown', defaultName, content),
  importMarkdown: () => ipcRenderer.invoke('import:markdown'),
  saveAttachment: (name: string, type: string, data: ArrayBuffer) =>
    ipcRenderer.invoke('attachment:save', name, type, data),
  listHistory: (relPath: string) => ipcRenderer.invoke('history:list', relPath),
  readHistory: (relPath: string, hash: string) => ipcRenderer.invoke('history:read', relPath, hash),
})
