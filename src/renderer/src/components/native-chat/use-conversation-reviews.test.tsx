// @vitest-environment happy-dom
import { cleanup, renderHook, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { AgentJournalRenderItem } from '../../../../shared/agent-session/journal/agent-session-journal-types'
import type { HostedReviewInfo } from '../../../../shared/hosted-review'
import { useConversationReviews } from './use-conversation-reviews'
import type { NativeChatMessage } from '../../../../shared/native-chat/native-chat-types'

const rpc = vi.hoisted(() => vi.fn())
vi.mock('@/runtime/runtime-rpc-client', () => ({ callRuntimeRpc: rpc }))
const url = 'https://git.example.com/jiri/jiri/pulls/7'
const review: HostedReviewInfo = {
  provider: 'gitea',
  number: 7,
  title: 'Feature',
  state: 'open',
  status: 'success',
  url,
  updatedAt: '2026-11-03',
  mergeable: 'MERGEABLE'
}
function item(sequence: number, command: string, output = url): AgentJournalRenderItem {
  return {
    sequence,
    itemId: String(sequence),
    revision: 1,
    observedAt: 0,
    body: {
      kind: 'tool-call',
      name: 'Bash',
      input: { command },
      state: 'completed',
      exitCode: 0,
      output: { head: output, byteLength: output.length, digest: 'digest', truncated: false }
    }
  }
}
const history = {
  ok: true,
  page: {
    sessionId: 'session',
    epoch: 'epoch',
    direction: 'tail',
    items: [],
    hasOlder: false,
    window: { oldest: null, nextCursor: { epoch: 'epoch', sequence: 0 } }
  }
}
function historyFor(sessionId: string) {
  return { ...history, page: { ...history.page, sessionId } }
}
beforeEach(() => {
  rpc.mockReset()
})
afterEach(cleanup)
describe('conversation PR list reads', () => {
  it('attaches a successful Qunli card comment to an existing PR without adding PRs only mentioned there', async () => {
    const comment: AgentJournalRenderItem = {
      ...item(10, ''),
      body: {
        kind: 'tool-call',
        name: 'mcp__claude_ai_Qunli__add_comment',
        state: 'completed',
        input: {
          account_id: '2025',
          recording_id: 'T18033',
          text: `PR: ${url} and https://git.example.com/jiri/jiri/pulls/999`
        },
        output: { head: '{"ok":true}', byteLength: 11, digest: '', truncated: false }
      }
    }
    rpc.mockImplementation(async (_target, method, params) =>
      method === 'agentSession.history'
        ? {
            ...historyFor(params.sessionId),
            page: { ...historyFor(params.sessionId).page, items: [comment] }
          }
        : review
    )
    const items = [item(1, 'tea pulls create')]
    const { result } = renderHook(() =>
      useConversationReviews({
        sessionId: 'qunli-linked',
        target: { kind: 'local' },
        items,
        open: true
      })
    )
    await waitFor(() =>
      expect(result.current.rows[0]?.qunliCardUrls).toEqual(['https://qunli.co/2025/T18033'])
    )
    expect(result.current.rows).toHaveLength(1)
  })
  it('reads every terminal transcript page on its owning runtime and keeps PRs outside the visible tail', async () => {
    const urls = [
      'https://git.example.com/jiri/jiri/pulls/349',
      'https://git.example.com/jinshuju/goldendata/pulls/272',
      'https://git.example.com/jiri/jiri/pulls/356'
    ]
    const messages: NativeChatMessage[] = urls.flatMap((url, index) => [
      {
        id: `call-${index}`,
        role: 'assistant',
        source: 'transcript',
        timestamp: index,
        blocks: [
          {
            type: 'tool-call',
            callId: String(index),
            name: 'Bash',
            input: { command: 'tea pulls create' }
          }
        ]
      },
      {
        id: `result-${index}`,
        role: 'tool',
        source: 'transcript',
        timestamp: index,
        blocks: [{ type: 'tool-result', callId: String(index), output: url }]
      }
    ])
    rpc.mockImplementation(async (_target, method, params) => {
      if (method === 'nativeChat.readSession') {
        return params.beforeOffset === undefined
          ? { messages: messages.slice(4), hasMore: true, beforeOffset: 100 }
          : { messages: messages.slice(0, 4), hasMore: false, beforeOffset: 0 }
      }
      if (method === 'hostedReview.conversationLookup') {
        return { ...review, url: params.url }
      }
      throw new Error('Terminal chat must not read a structured journal')
    })
    const { result } = renderHook(() =>
      useConversationReviews({
        sessionId: 'terminal-session',
        target: { kind: 'environment', environmentId: 'Hermes' },
        items: [],
        open: true,
        transcript: {
          agent: 'claude',
          transcriptPath: '/remote/session.jsonl',
          messages: messages.slice(4)
        }
      })
    )
    await waitFor(() => expect(result.current.rows.filter((row) => row.review)).toHaveLength(3))
    expect(result.current.rows.map((row) => row.review?.url)).toEqual(urls)
    expect(rpc).toHaveBeenCalledWith(
      { kind: 'environment', environmentId: 'Hermes' },
      'nativeChat.readSession',
      expect.objectContaining({ transcriptPath: '/remote/session.jsonl', beforeOffset: 100 }),
      expect.anything()
    )
  })
  it('refreshes metadata when the same PR is changed again while retaining Created', async () => {
    let current = review
    rpc.mockImplementation(async (_target, method, params) =>
      method === 'agentSession.history' ? historyFor(params.sessionId) : current
    )
    const created = item(1, 'tea pulls create')
    const { result, rerender } = renderHook(
      ({ items }) =>
        useConversationReviews({
          sessionId: 'updates',
          target: { kind: 'local' },
          items,
          open: true
        }),
      { initialProps: { items: [created] } }
    )
    await waitFor(() => expect(result.current.rows[0]?.review?.status).toBe('success'))
    current = { ...review, status: 'failure' }
    rerender({ items: [created, item(2, `tea pulls edit ${url}`)] })
    await waitFor(() => expect(result.current.rows[0]?.review?.status).toBe('failure'))
    expect(result.current.rows).toHaveLength(1)
    expect(result.current.rows[0].action).toBe('created')
  })
  it('does not invent a PR for a pushed branch without one', async () => {
    rpc.mockImplementation(async (_target, method, params) =>
      method === 'agentSession.history' ? historyFor(params.sessionId) : null
    )
    const push = item(
      3,
      'git push',
      'To git@git.example.com:jiri/jiri.git\n   abc1234..abc5678  feature -> feature\n'
    )
    const { result } = renderHook(() =>
      useConversationReviews({
        sessionId: 'push-no-pr',
        target: { kind: 'local' },
        items: [push],
        open: true
      })
    )
    await waitFor(() => expect(result.current.loadingHistory).toBe(false))
    expect(result.current.rows).toEqual([])
  })
  it('combines creation and push evidence for the same canonical PR', async () => {
    rpc.mockImplementation(async (_target, method, params) =>
      method === 'agentSession.history' ? historyFor(params.sessionId) : review
    )
    const items = [
      item(4, 'tea pulls create'),
      item(
        5,
        'git push',
        'To git@git.example.com:jiri/jiri.git\n   abc1234..abc5678  feature -> feature\n'
      )
    ]
    const { result } = renderHook(() =>
      useConversationReviews({ sessionId: 'dedupe', target: { kind: 'local' }, items, open: true })
    )
    await waitFor(() => expect(result.current.rows).toHaveLength(1))
    await waitFor(() => expect(result.current.rows[0]?.review?.title).toBe('Feature'))
    expect(result.current.rows[0].action).toBe('created')
  })
  it('does not fetch hidden lists, and a failed status read retains the exact PR link', async () => {
    rpc.mockImplementation(async (_target, method, params) => {
      if (method === 'agentSession.history') {
        return historyFor(params.sessionId)
      }
      throw new Error('HTTP 401')
    })
    const items = [item(6, 'tea pulls create')]
    const { result, rerender } = renderHook(
      ({ open }) =>
        useConversationReviews({ sessionId: 'hidden', target: { kind: 'local' }, items, open }),
      { initialProps: { open: false } }
    )
    expect(rpc).not.toHaveBeenCalled()
    rerender({ open: true })
    await waitFor(() => expect(result.current.lookupError).toBe(true))
    expect(result.current.rows[0]).toMatchObject({ lookup: { url }, review: null, loading: false })
  })
})
