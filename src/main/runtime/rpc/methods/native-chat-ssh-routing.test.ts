import { beforeEach, describe, expect, it, vi } from 'vitest'
import { SSH_FILESYSTEM_PROVIDER_UNAVAILABLE_MESSAGE } from '../../../providers/ssh-filesystem-dispatch'
import type { RpcContext } from '../core'

const hookRows = vi.hoisted(() => ({ value: new Array<unknown>() }))
const localWatch = vi.hoisted(() => ({
  readTail: vi.fn(async () => ({ messages: [], hasMore: false, beforeOffset: 0 })),
  subscribe: vi.fn(async () => ({ watching: true, unsubscribe: () => {} }))
}))
const sshSubscribe = vi.hoisted(() => vi.fn(() => ({ watching: true, unsubscribe: () => {} })))

vi.mock('../../../agent-hooks/server', () => ({
  agentHookServer: { getStatusSnapshot: () => hookRows.value }
}))
vi.mock('../../../native-chat/transcript-watch', () => ({
  readNativeChatTranscriptTail: localWatch.readTail,
  subscribeNativeChatTranscript: localWatch.subscribe
}))
vi.mock('../../../native-chat/ssh-transcript-subscription', () => ({
  subscribeSshNativeChatTranscript: sshSubscribe
}))

import { NATIVE_CHAT_METHODS } from './native-chat'

type Handler = (
  params: unknown,
  ctx: RpcContext,
  emit?: (value: unknown) => void
) => Promise<unknown>

function handler(name: string): Handler {
  const method = NATIVE_CHAT_METHODS.find((candidate) => candidate.name === name)
  if (!method) {
    throw new Error(`${name} not registered`)
  }
  // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: both registered handler shapes accept (params, ctx, emit?).
  return method.handler as Handler
}

function context(): RpcContext {
  return {
    // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: the subscribe handler only touches these runtime members.
    runtime: {
      registerSubscriptionCleanup: vi.fn(),
      cleanupSubscription: vi.fn()
    } as unknown as RpcContext['runtime'],
    connectionId: 'mobile-1',
    clientKind: 'mobile'
  }
}

const remotePath = '/home/dev/.claude/projects/-home-dev-app/s1.jsonl'

beforeEach(() => {
  hookRows.value = []
  localWatch.readTail.mockClear()
  localWatch.subscribe.mockClear()
  sshSubscribe.mockClear()
})

describe('native chat SSH transcript routing', () => {
  it('keeps local sessions on the local transcript reader', async () => {
    hookRows.value = [
      {
        connectionId: null,
        receivedAt: 1,
        providerSession: { key: 'session_id', id: 's1', transcriptPath: remotePath }
      }
    ]
    await handler('nativeChat.subscribe')({ agent: 'claude', sessionId: 's1' }, context(), () => {})
    expect(localWatch.subscribe).toHaveBeenCalledOnce()
    expect(sshSubscribe).not.toHaveBeenCalled()
  })

  it('follows an SSH session through the connection that reported it', async () => {
    hookRows.value = [
      {
        connectionId: 'ssh-hermes',
        receivedAt: 1,
        providerSession: { key: 'session_id', id: 's1', transcriptPath: remotePath }
      }
    ]
    await handler('nativeChat.subscribe')({ agent: 'claude', sessionId: 's1' }, context(), () => {})
    expect(localWatch.subscribe).not.toHaveBeenCalled()
    expect(sshSubscribe).toHaveBeenCalledWith(expect.objectContaining({ sessionId: 's1' }), {
      connectionId: 'ssh-hermes',
      transcriptPath: remotePath
    })
  })

  it('reports a disconnected SSH target rather than reading the desktop disk', async () => {
    hookRows.value = [
      {
        connectionId: 'ssh-hermes',
        receivedAt: 1,
        providerSession: { key: 'session_id', id: 's1', transcriptPath: remotePath }
      }
    ]
    const result = await handler('nativeChat.readSession')(
      { agent: 'claude', sessionId: 's1' },
      context()
    )
    expect(localWatch.readTail).not.toHaveBeenCalled()
    expect(result).toEqual({ error: SSH_FILESYSTEM_PROVIDER_UNAVAILABLE_MESSAGE })
  })
})
