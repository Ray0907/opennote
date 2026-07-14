/**
 * OpenNote Electron main process — intentionally thin (spec §2).
 * Responsibilities: one window, and the Markdown-mirror file IPC.
 * No application logic belongs here.
 */
import { app, BrowserWindow, dialog, ipcMain, shell } from 'electron'
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

// Open the vault folder in the OS file manager (critique Q3: make the
// data-sovereignty promise visible). Creates it first if it doesn't exist.
ipcMain.handle('vault:reveal', async () => {
  const dir = vaultDir()
  await fs.mkdir(dir, { recursive: true })
  await shell.openPath(dir)
})

/** M4 export: save-dialog + write. Returns the chosen path, or null if cancelled. */
ipcMain.handle(
  'export:markdown',
  async (event, defaultName: string, content: string): Promise<string | null> => {
    const win = BrowserWindow.fromWebContents(event.sender)
    if (!win) return null
    const { canceled, filePath } = await dialog.showSaveDialog(win, {
      defaultPath: defaultName,
      filters: [{ name: 'Markdown', extensions: ['md'] }],
    })
    if (canceled || !filePath) return null
    await atomicWrite(filePath, content)
    return filePath
  },
)

/** M4 import: open-dialog + read. Returns [{name, content}], or null if cancelled. */
ipcMain.handle(
  'import:markdown',
  async (event): Promise<Array<{ name: string; content: string }> | null> => {
    const win = BrowserWindow.fromWebContents(event.sender)
    if (!win) return null
    const { canceled, filePaths } = await dialog.showOpenDialog(win, {
      properties: ['openFile', 'multiSelections'],
      filters: [{ name: 'Markdown', extensions: ['md', 'markdown', 'txt'] }],
    })
    if (canceled || filePaths.length === 0) return null
    return Promise.all(
      filePaths.map(async (p) => ({
        name: path.basename(p),
        content: await fs.readFile(p, 'utf8'),
      })),
    )
  },
)

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
