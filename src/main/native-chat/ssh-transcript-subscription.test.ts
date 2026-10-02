import { afterEach, describe, expect, it, vi } from 'vitest'
import type { NativeChatMessage } from '../../shared/native-chat-types'
import type { IFilesystemProvider } from '../providers/filesystem-provider-contract'
import {
  registerSshFilesystemProvider,
  SSH_FILESYSTEM_PROVIDER_UNAVAILABLE_MESSAGE,
  unregisterSshFilesystemProvider
} from '../providers/ssh-filesystem-dispatch'
import { subscribeSshNativeChatTranscript } from './ssh-transcript-subscription'

const CONNECTION = 'ssh-hermes'
const FILE = '/home/dev/.claude/projects/-home-dev-app/s1.jsonl'

function claudeLine(uuid: string, role: 'user' | 'assistant', text: string): string {
  return `${JSON.stringify({
    type: role,
    uuid,
    timestamp: '2026-06-01T10:00:00.000Z',
    message: { role, content: role === 'user' ? text : [{ type: 'text', text }] }
  })}\n`
}

function registerFile(read: () => Buffer | null): void {
  // Shaped like a relay-forwarded error: the transport's numeric code, Node's message.
  const missing = (): never => {
    throw Object.assign(new Error(`ENOENT: no such file or directory, stat '${FILE}'`), {
      code: -32000
    })
  }
  const provider = {
    stat: vi.fn(async () => ({ size: (read() ?? missing()).length, type: 'file', mtime: 0 })),
    supportsFileRangeRead: vi.fn(async () => true),
    readFileRange: vi.fn(async (_path: string, position: number, length: number) => {
      const bytes = (read() ?? missing()).subarray(position, position + length)
      return { bytes, bytesRead: bytes.length }
    })
  }
  // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: the subscription only calls the methods faked here.
  registerSshFilesystemProvider(CONNECTION, provider as unknown as IFilesystemProvider)
}

async function waitFor(predicate: () => boolean): Promise<void> {
  const deadline = Date.now() + 2_000
  while (!predicate()) {
    if (Date.now() > deadline) {
      throw new Error('timed out waiting for condition')
    }
    await new Promise((resolve) => setTimeout(resolve, 5))
  }
}

const ids = (messages: NativeChatMessage[]): string[] => messages.map((message) => message.id)

afterEach(() => {
  unregisterSshFilesystemProvider(CONNECTION)
})

describe('subscribeSshNativeChatTranscript', () => {
  it('snapshots the remote transcript, then streams appended records', async () => {
    let content = claudeLine('u1', 'user', 'hi')
    registerFile(() => Buffer.from(content))
    const snapshots: string[][] = []
    const appends: string[][] = []
    const subscription = subscribeSshNativeChatTranscript(
      {
        agent: 'claude',
        sessionId: 's1',
        pollIntervalMs: 5,
        onInitialSnapshot: (messages) => snapshots.push(ids(messages)),
        onAppend: (messages) => appends.push(ids(messages))
      },
      { connectionId: CONNECTION, transcriptPath: FILE }
    )
    await waitFor(() => snapshots.length === 1)
    content += claudeLine('a1', 'assistant', 'hello')
    await waitFor(() => appends.length === 1)
    subscription.unsubscribe()
    expect(snapshots).toEqual([['u1']])
    expect(appends).toEqual([['a1']])
  })

  it('reports pending until the agent flushes its first record', async () => {
    let content: string | null = null
    registerFile(() => (content === null ? null : Buffer.from(content)))
    const events: string[] = []
    const subscription = subscribeSshNativeChatTranscript(
      {
        agent: 'claude',
        sessionId: 's1',
        pollIntervalMs: 5,
        onTranscriptPending: () => events.push('pending'),
        onInitialSnapshot: (messages) => events.push(`snapshot:${ids(messages).join(',')}`),
        onAppend: () => {}
      },
      { connectionId: CONNECTION, transcriptPath: FILE }
    )
    await waitFor(() => events.length === 1)
    content = claudeLine('u1', 'user', 'hi')
    await waitFor(() => events.length === 2)
    subscription.unsubscribe()
    expect(events).toEqual(['pending', 'snapshot:u1'])
  })

  it('surfaces a disconnected SSH target instead of an empty conversation', async () => {
    const errors: (string | undefined)[] = []
    const subscription = subscribeSshNativeChatTranscript(
      {
        agent: 'claude',
        sessionId: 's1',
        pollIntervalMs: 5,
        onInitialSnapshot: (_messages, _hasMore, _beforeOffset, error) => errors.push(error),
        onAppend: () => {}
      },
      { connectionId: CONNECTION, transcriptPath: FILE }
    )
    await waitFor(() => errors.length === 1)
    registerFile(() => Buffer.from(claudeLine('u1', 'user', 'hi')))
    await waitFor(() => errors.length === 2)
    subscription.unsubscribe()
    expect(errors).toEqual([SSH_FILESYSTEM_PROVIDER_UNAVAILABLE_MESSAGE, undefined])
  })

  it('replaces the conversation when the remote file is rewritten', async () => {
    let content = claudeLine('u1', 'user', 'one') + claudeLine('a1', 'assistant', 'two')
    registerFile(() => Buffer.from(content))
    const replacements: string[][] = []
    let snapshotted = false
    const subscription = subscribeSshNativeChatTranscript(
      {
        agent: 'claude',
        sessionId: 's1',
        pollIntervalMs: 5,
        onInitialSnapshot: () => {
          snapshotted = true
        },
        onReplace: (messages) => replacements.push(ids(messages)),
        onAppend: () => {}
      },
      { connectionId: CONNECTION, transcriptPath: FILE }
    )
    await waitFor(() => snapshotted)
    content = claudeLine('n1', 'user', 'x')
    await waitFor(() => replacements.length === 1)
    subscription.unsubscribe()
    expect(replacements).toEqual([['n1']])
  })
})
