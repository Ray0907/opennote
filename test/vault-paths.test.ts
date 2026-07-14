import { describe, expect, it } from 'vitest'
import { mkdtemp, mkdir, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  assertNoSymlinkParents,
  safeAttachmentPath,
  safeChildPath,
  safeExistingChildPath,
} from '../electron/vault-paths'

describe('vault path boundaries', () => {
  it('keeps mirror paths inside the vault root', () => {
    const root = join(tmpdir(), 'opennote-root')
    expect(safeChildPath(root, 'folder/page.md')).toBe(join(root, 'folder', 'page.md'))
    expect(() => safeChildPath(root, '../outside.md')).toThrow('outside')
  })

  it('only resolves attachment URLs inside the attachments directory', () => {
    const root = join(tmpdir(), 'opennote-root')
    expect(safeAttachmentPath(root, 'attachments/photo.png')).toBe(
      join(root, 'attachments', 'photo.png'),
    )
    expect(() => safeAttachmentPath(root, 'page.md')).toThrow('attachment')
    expect(() => safeAttachmentPath(root, 'attachments/../page.md')).toThrow('outside')
  })

  it('rejects symlinked ancestors for writes and existing asset reads', async () => {
    const root = await mkdtemp(join(tmpdir(), 'opennote-vault-'))
    const outside = await mkdtemp(join(tmpdir(), 'opennote-outside-'))
    await mkdir(join(root, 'attachments'))
    await writeFile(join(outside, 'secret.txt'), 'secret')
    await symlink(
      outside,
      join(root, 'attachments', 'linked'),
      process.platform === 'win32' ? 'junction' : 'dir',
    )

    const target = safeAttachmentPath(root, 'attachments/linked/new.txt')
    await expect(assertNoSymlinkParents(join(root, 'attachments'), target)).rejects.toThrow('symlink')
    await expect(
      safeExistingChildPath(join(root, 'attachments'), 'linked/secret.txt'),
    ).rejects.toThrow('outside')
  })
})
