import * as path from 'node:path'
import { lstat, realpath } from 'node:fs/promises'

export function safeChildPath(root: string, relPath: string): string {
  const resolved = path.resolve(root, relPath)
  if (resolved !== root && !resolved.startsWith(root + path.sep)) {
    throw new Error('Path is outside the allowed directory')
  }
  const parts = path.relative(root, resolved).split(path.sep)
  if (parts.some((part) => part.toLowerCase() === '.git')) {
    throw new Error('Path uses a reserved Git metadata directory')
  }
  return resolved
}

export type NavigationDisposition = 'asset' | 'external' | 'deny'

export function classifyNavigationUrl(raw: string): NavigationDisposition {
  try {
    const url = new URL(raw)
    if (
      url.protocol === 'opennote-asset:' &&
      url.hostname === 'vault' &&
      url.pathname.startsWith('/attachments/')
    ) return 'asset'
    if (url.protocol === 'https:' || url.protocol === 'http:' || url.protocol === 'mailto:') {
      return 'external'
    }
  } catch {
    // Invalid URLs are denied below.
  }
  return 'deny'
}

export function safeAttachmentPath(vaultRoot: string, relPath: string): string {
  const normalized = relPath.replace(/\\/g, '/')
  if (!normalized.startsWith('attachments/')) {
    throw new Error('Path is not an attachment')
  }
  return safeChildPath(path.join(vaultRoot, 'attachments'), normalized.slice('attachments/'.length))
}

export async function assertNoSymlinkParents(root: string, target: string): Promise<void> {
  const rootPath = path.resolve(root)
  const targetPath = safeChildPath(rootPath, path.relative(rootPath, path.resolve(target)))
  try {
    const rootStat = await lstat(rootPath)
    if (rootStat.isSymbolicLink()) throw new Error('Path contains a symlinked directory')
    if (!rootStat.isDirectory()) throw new Error('Path root is not a directory')
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return
    throw error
  }
  const parentParts = path.relative(rootPath, path.dirname(targetPath)).split(path.sep).filter(Boolean)
  let current = rootPath
  for (const part of parentParts) {
    current = path.join(current, part)
    try {
      const stat = await lstat(current)
      if (stat.isSymbolicLink()) throw new Error('Path contains a symlinked directory')
      if (!stat.isDirectory()) throw new Error('Path parent is not a directory')
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return
      throw error
    }
  }
}

export async function safeExistingChildPath(root: string, relPath: string): Promise<string> {
  const lexical = safeChildPath(root, relPath)
  const [realRoot, realTarget] = await Promise.all([realpath(root), realpath(lexical)])
  return safeChildPath(realRoot, path.relative(realRoot, realTarget))
}
