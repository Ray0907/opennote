/**
 * OpenNote Electron main process — intentionally thin (spec §2).
 * Responsibilities: one window, and the Markdown-mirror file IPC.
 * No application logic belongs here.
 */
import { app, BrowserWindow, ipcMain } from 'electron'
import * as path from 'node:path'
import * as fs from 'node:fs/promises'

function vaultDir(): string {
  return path.join(app.getPath('documents'), 'OpenNoteVault')
}

/** Resolve a vault-relative path and refuse anything escaping the vault. */
function safeVaultPath(relPath: string): string {
  const root = vaultDir()
  const abs = path.normalize(path.join(root, relPath))
  if (abs !== root && !abs.startsWith(root + path.sep)) {
    throw new Error(`Mirror path escapes the vault: ${relPath}`)
  }
  return abs
}

/** Atomic write (temp + rename) so a crash never leaves a torn file (F4). */
async function atomicWrite(absPath: string, content: string): Promise<void> {
  await fs.mkdir(path.dirname(absPath), { recursive: true })
  const tmp = `${absPath}.tmp-${process.pid}-${Date.now()}`
  await fs.writeFile(tmp, content, 'utf8')
  await fs.rename(tmp, absPath)
}

ipcMain.handle('mirror:write', async (_event, relPath: string, content: string) => {
  await atomicWrite(safeVaultPath(relPath), content)
})

ipcMain.handle('mirror:delete', async (_event, relPath: string) => {
  try {
    await fs.unlink(safeVaultPath(relPath))
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err
  }
})

ipcMain.handle('vault:path', async () => vaultDir())

function createWindow(): void {
  const win = new BrowserWindow({
    width: 1280,
    height: 800,
    title: 'OpenNote',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
    },
  })
  const devUrl = process.env.VITE_DEV_SERVER_URL
  if (devUrl) {
    void win.loadURL(devUrl)
  } else {
    void win.loadFile(path.join(__dirname, '../dist/index.html'))
  }
}

app.whenReady().then(() => {
  createWindow()
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
