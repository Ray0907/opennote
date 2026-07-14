import { describe, expect, it } from 'vitest'
import { parseGitHistory } from '../src/shell'

describe('parseGitHistory', () => {
  it('parses git field separators and ignores malformed lines', () => {
    const raw = [
      'abc123\u001f2026-07-14T10:00:00Z\u001fAutomatic snapshot',
      'malformed',
      'def456\u001f2026-07-14T09:00:00Z\u001fBefore edit',
    ].join('\n')

    expect(parseGitHistory(raw)).toEqual([
      { hash: 'abc123', date: '2026-07-14T10:00:00Z', message: 'Automatic snapshot' },
      { hash: 'def456', date: '2026-07-14T09:00:00Z', message: 'Before edit' },
    ])
  })
})
