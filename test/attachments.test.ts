import { describe, expect, it } from 'vitest'
import { assertAttachmentSize, attachmentDisplayUrl, MAX_ATTACHMENT_BYTES } from '../src/shell'

describe('attachmentDisplayUrl', () => {
  it('maps vault attachments to the desktop protocol', () => {
    expect(attachmentDisplayUrl('attachments/a diagram.png', true)).toBe(
      'opennote-asset://vault/attachments/a%20diagram.png',
    )
  })

  it('leaves browser, data, and remote URLs alone', () => {
    expect(attachmentDisplayUrl('attachments/photo.png', false)).toBe('attachments/photo.png')
    expect(attachmentDisplayUrl('data:image/png;base64,abc', true)).toBe('data:image/png;base64,abc')
    expect(attachmentDisplayUrl('https://example.com/photo.png', true)).toBe('https://example.com/photo.png')
  })

  it('rejects uploads that would overwhelm renderer IPC memory', () => {
    expect(() => assertAttachmentSize(MAX_ATTACHMENT_BYTES)).not.toThrow()
    expect(() => assertAttachmentSize(MAX_ATTACHMENT_BYTES + 1)).toThrow('50 MB')
  })
})
