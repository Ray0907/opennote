/**
 * OpenNote Electron main process — intentionally thin (spec §2).
 * Responsibilities: one window, and the Markdown-mirror file IPC.
 * No application logic belongs here.
 */
import { app, BrowserWindow, dialog, ipcMain, net, protocol, shell } from 'electron'
import { randomUUID } from 'node:crypto'
import { execFile } from 'node:child_process'
import * as path from 'node:path'
import * as fs from 'node:fs/promises'
import { pathToFileURL } from 'node:url'
import { promisify } from 'node:util'
import {
  assertNoSymlinkParents,
  classifyNavigationUrl,
  safeAttachmentPath,
  safeChildPath,
  safeExistingChildPath,
} from './vault-paths'

protocol.registerSchemesAsPrivileged([
  { scheme: 'opennote-asset', privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true } },
])

const execFileAsync = promisify(execFile)
const MAX_ATTACHMENT_BYTES = 50 * 1024 * 1024
let gitAvailability: Promise<void> | null = null

function requireGit(): Promise<void> {
  gitAvailability ??= execFileAsync('git', ['--version'])
    .then(() => undefined)
    .catch(() => {
      throw new Error('Page history requires Git to be installed and available on PATH.')
    })
  return gitAvailability
}

function vaultDir(): string {
  return path.join(app.getPath('documents'), 'OpenNoteVault')
}

/** Resolve a vault-relative path and refuse anything escaping the vault. */
function safeVaultPath(relPath: string): string {
  return safeChildPath(vaultDir(), relPath)
}

/** Atomic write (temp + rename) so a crash never leaves a torn file (F4). */
async function atomicWrite(absPath: string, content: string | Uint8Array): Promise<void> {
  await fs.mkdir(path.dirname(absPath), { recursive: true })
  const tmp = `${absPath}.tmp-${process.pid}-${Date.now()}`
  if (typeof content === 'string') await fs.writeFile(tmp, content, 'utf8')
  else await fs.writeFile(tmp, content)
  await fs.rename(tmp, absPath)
}

async function runGit(args: string[]): Promise<string> {
  const { stdout } = await execFileAsync('git', ['-C', vaultDir(), ...args], { encoding: 'utf8' })
  return stdout
}

async function ensureVaultHistory(): Promise<void> {
  await requireGit()
  await fs.mkdir(vaultDir(), { recursive: true })
  try {
    await fs.access(path.join(vaultDir(), '.git'))
  } catch {
    await runGit(['init'])
    await runGit(['config', 'user.name', 'OpenNote'])
    await runGit(['config', 'user.email', 'history@opennote.local'])
  }
}

async function snapshotVault(): Promise<void> {
  await ensureVaultHistory()
  await runGit(['add', '-A'])
  if (!(await runGit(['status', '--porcelain'])).trim()) return
  await runGit(['commit', '-m', 'Automatic snapshot'])
}

let snapshotTimer: NodeJS.Timeout | null = null
let snapshotQueue: Promise<void> = Promise.resolve()
function queueSnapshot(): Promise<void> {
  const queued = snapshotQueue.catch(() => undefined).then(snapshotVault)
  snapshotQueue = queued
  return queued
}

function scheduleSnapshot(): void {
  if (snapshotTimer) clearTimeout(snapshotTimer)
  snapshotTimer = setTimeout(() => {
    snapshotTimer = null
    void queueSnapshot().catch((error) => console.error('Vault snapshot failed', error))
  }, 1500)
}

ipcMain.handle('mirror:write', async (_event, relPath: string, content: string) => {
  const target = safeVaultPath(relPath)
  await assertNoSymlinkParents(vaultDir(), target)
  await atomicWrite(target, content)
  scheduleSnapshot()
})

ipcMain.handle('mirror:delete', async (_event, relPath: string) => {
  const target = safeVaultPath(relPath)
  await assertNoSymlinkParents(vaultDir(), target)
  try {
    await fs.unlink(target)
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err
  }
  scheduleSnapshot()
})

ipcMain.handle('vault:path', async () => vaultDir())

ipcMain.handle(
  'attachment:save',
  async (_event, name: string, _type: string, data: ArrayBuffer): Promise<string> => {
    if (data.byteLength > MAX_ATTACHMENT_BYTES) throw new Error('Attachments must be 50 MB or smaller.')
    const clean = path.basename(name)
      .replace(/[<>:"/\\|?*\x00-\x1f]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 120) || 'attachment'
    const relPath = `attachments/${randomUUID()}-${clean}`
    const target = safeAttachmentPath(vaultDir(), relPath)
    await assertNoSymlinkParents(vaultDir(), target)
    await atomicWrite(target, new Uint8Array(data))
    scheduleSnapshot()
    return relPath
  },
)

ipcMain.handle('history:list', async (_event, relPath: string): Promise<string> => {
  safeVaultPath(relPath)
  if (snapshotTimer) {
    clearTimeout(snapshotTimer)
    snapshotTimer = null
  }
  await queueSnapshot()
  return runGit(['log', '--follow', '--format=%H%x1f%cI%x1f%s', '--', relPath])
})

ipcMain.handle('history:read', async (_event, relPath: string, hash: string): Promise<string | null> => {
  safeVaultPath(relPath)
  if (!/^[0-9a-f]{7,64}$/i.test(hash)) throw new Error('Invalid revision hash')
  await ensureVaultHistory()
  try {
    return await runGit(['show', `${hash}:${relPath}`])
  } catch {
    return null
  }
})

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
      filters: [{ name: 'Markdown & Notion CSV', extensions: ['md', 'markdown', 'txt', 'csv'] }],
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
  win.webContents.setWindowOpenHandler(({ url }) => {
    const disposition = classifyNavigationUrl(url)
    if (disposition === 'external') {
      void shell.openExternal(url)
      return { action: 'deny' }
    }
    if (disposition === 'asset') {
      return {
        action: 'allow',
        overrideBrowserWindowOptions: {
          autoHideMenuBar: true,
          webPreferences: {
            contextIsolation: true,
            sandbox: true,
            nodeIntegration: false,
            preload: undefined,
          },
        },
      }
    }
    return { action: 'deny' }
  })
  win.webContents.on('will-navigate', (event, url) => {
    event.preventDefault()
    if (classifyNavigationUrl(url) === 'external') void shell.openExternal(url)
  })
  const devUrl = process.env.VITE_DEV_SERVER_URL
  if (devUrl) {
    void win.loadURL(devUrl)
  } else {
    void win.loadFile(path.join(__dirname, '../dist/index.html'))
  }
}

app.whenReady().then(() => {
  protocol.handle('opennote-asset', async (request) => {
    try {
      const url = new URL(request.url)
      if (url.hostname !== 'vault') return new Response(null, { status: 404 })
      const relPath = decodeURIComponent(url.pathname.replace(/^\//, ''))
      if (!relPath.startsWith('attachments/')) return new Response(null, { status: 403 })
      const lexicalTarget = safeAttachmentPath(vaultDir(), relPath)
      await assertNoSymlinkParents(vaultDir(), lexicalTarget)
      const target = await safeExistingChildPath(
        path.join(vaultDir(), 'attachments'),
        relPath.slice('attachments/'.length),
      )
      return net.fetch(pathToFileURL(target).toString())
    } catch {
      return new Response(null, { status: 404 })
    }
  })
  createWindow()
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
