import { describe, expect, it, vi } from 'vitest'
import type { IFilesystemProvider } from '../providers/filesystem-provider-contract'
import { readSshTranscriptAppend, readSshTranscriptTail } from './ssh-transcript-reader'

const FILE = '/home/dev/.claude/projects/-home-dev-app/s1.jsonl'

function claudeLine(uuid: string, role: 'user' | 'assistant', text: string): string {
  return `${JSON.stringify({
    type: role,
    uuid,
    timestamp: '2026-06-01T10:00:00.000Z',
    message: { role, content: role === 'user' ? text : [{ type: 'text', text }] }
  })}\n`
}

function fakeProvider(read: () => Buffer, rangeReads = true): IFilesystemProvider {
  const provider = {
    stat: vi.fn(async () => ({ size: read().length, type: 'file', mtime: 0 })),
    supportsFileRangeRead: vi.fn(async () => rangeReads),
    readFileRange: vi.fn(async (_path: string, position: number, length: number) => {
      const bytes = read().subarray(position, position + length)
      return { bytes, bytesRead: bytes.length }
    }),
    readFile: vi.fn(async () => ({ content: read().toString('utf8'), isBinary: false }))
  }
  // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: the reader only calls the four methods faked here.
  return provider as unknown as IFilesystemProvider
}

function texts(messages: { blocks: unknown[] }[]): unknown[] {
  return messages.map((message) => message.blocks)
}

describe('readSshTranscriptTail', () => {
  it('returns the newest records and the offset to follow appends from', async () => {
    const content = Buffer.from(
      claudeLine('u1', 'user', 'one') +
        claudeLine('a1', 'assistant', 'two') +
        claudeLine('u2', 'user', 'three')
    )
    const page = await readSshTranscriptTail({
      provider: fakeProvider(() => content),
      filePath: FILE,
      agent: 'claude',
      limit: 2
    })
    expect(page.messages.map((message) => message.id)).toEqual(['a1', 'u2'])
    expect(page.hasMore).toBe(true)
    expect(page.cursor.offset).toBe(content.length)
    expect(page.beforeOffset).toBe(claudeLine('u1', 'user', 'one').length)
  })

  it('leaves an unterminated record for the next append read', async () => {
    const complete = claudeLine('u1', 'user', 'one')
    const content = Buffer.from(complete + claudeLine('a1', 'assistant', 'two').slice(0, 20))
    const page = await readSshTranscriptTail({
      provider: fakeProvider(() => content),
      filePath: FILE,
      agent: 'claude',
      limit: 10
    })
    expect(page.messages.map((message) => message.id)).toEqual(['u1'])
    expect(page.cursor.offset).toBe(complete.length)
  })

  it('pages older history before an offset', async () => {
    const first = claudeLine('u1', 'user', 'one')
    const content = Buffer.from(first + claudeLine('a1', 'assistant', 'two'))
    const page = await readSshTranscriptTail({
      provider: fakeProvider(() => content),
      filePath: FILE,
      agent: 'claude',
      limit: 10,
      beforeOffset: first.length
    })
    expect(page.messages.map((message) => message.id)).toEqual(['u1'])
    expect(page.hasMore).toBe(false)
  })

  it('reads through hosts without positional reads', async () => {
    const content = Buffer.from(claudeLine('u1', 'user', 'one'))
    const page = await readSshTranscriptTail({
      provider: fakeProvider(() => content, false),
      filePath: FILE,
      agent: 'claude',
      limit: 10
    })
    expect(texts(page.messages)).toHaveLength(1)
  })
})

describe('readSshTranscriptAppend', () => {
  async function cursorAtEnd(provider: IFilesystemProvider) {
    return (await readSshTranscriptTail({ provider, filePath: FILE, agent: 'claude', limit: 10 }))
      .cursor
  }

  it('decodes only records written after the cursor', async () => {
    let content = Buffer.from(claudeLine('u1', 'user', 'one'))
    const provider = fakeProvider(() => content)
    const cursor = await cursorAtEnd(provider)
    content = Buffer.concat([content, Buffer.from(claudeLine('a1', 'assistant', 'two'))])
    const appended = await readSshTranscriptAppend({
      provider,
      filePath: FILE,
      agent: 'claude',
      cursor
    })
    expect(appended?.messages.map((message) => message.id)).toEqual(['a1'])
    expect(appended?.cursor.offset).toBe(content.length)
  })

  it('reports a shrunk file so the caller re-reads the tail', async () => {
    let content = Buffer.from(claudeLine('u1', 'user', 'one') + claudeLine('a1', 'assistant', 'x'))
    const provider = fakeProvider(() => content)
    const cursor = await cursorAtEnd(provider)
    content = Buffer.from(claudeLine('n1', 'user', 'one'))
    expect(
      await readSshTranscriptAppend({ provider, filePath: FILE, agent: 'claude', cursor })
    ).toBeNull()
  })

  it('detects a rewrite that keeps or exceeds the old size', async () => {
    let content = Buffer.from(claudeLine('u1', 'user', 'one'))
    const provider = fakeProvider(() => content)
    const cursor = await cursorAtEnd(provider)
    content = Buffer.from(claudeLine('u9', 'user', 'two') + claudeLine('a9', 'assistant', 'more'))
    expect(
      await readSshTranscriptAppend({ provider, filePath: FILE, agent: 'claude', cursor })
    ).toBeNull()
  })

  it('skips past a record larger than the scan window', async () => {
    const first = claudeLine('u1', 'user', 'one')
    let content = Buffer.from(first)
    const provider = fakeProvider(() => content)
    let cursor = await cursorAtEnd(provider)
    const oversized = `${JSON.stringify({ type: 'user', blob: 'x'.repeat(9 * 1024 * 1024) })}\n`
    content = Buffer.from(first + oversized + claudeLine('a1', 'assistant', 'after'))
    const seen: string[] = []
    for (let poll = 0; poll < 4 && seen.length === 0; poll++) {
      const appended = await readSshTranscriptAppend({
        provider,
        filePath: FILE,
        agent: 'claude',
        cursor
      })
      cursor = appended!.cursor
      seen.push(...appended!.messages.map((message) => message.id))
    }
    expect(seen).toEqual(['a1'])
  })
})
