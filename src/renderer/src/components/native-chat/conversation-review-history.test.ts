import { describe, expect, it } from 'vitest'
import type { AgentJournalRenderItem } from '../../../../shared/agent-session/journal/agent-session-journal-types'
import type {
  AgentSessionHistoryRequest,
  AgentSessionHistoryResult
} from '../../../../shared/agent-session/agent-session-wire'
import {
  collectConversationReviewMutations,
  readConversationReviewHistory
} from './conversation-review-history'

function item(id: string, command: string, url: string): AgentJournalRenderItem {
  return {
    itemId: id,
    revision: 1,
    sequence: Number(id),
    observedAt: 0,
    body: {
      kind: 'tool-call',
      name: 'Bash',
      input: { command },
      state: 'completed',
      exitCode: 0,
      output: { head: url, byteLength: url.length, digest: 'digest', truncated: false }
    }
  }
}
const a = item('2', 'tea pulls create', 'https://git.example.com/jiri/jiri/pulls/7')
const b = item('3', 'tea pulls create', 'https://git.example.com/jiri/nextfe/pulls/7')
const c = item('4', `tea pulls edit ${'https://git.example.com/jiri/jiri/pulls/7'}`, 'Updated')
function page(items: AgentJournalRenderItem[], hasOlder = false): AgentSessionHistoryResult {
  return {
    ok: true,
    page: {
      sessionId: 'session',
      epoch: 'epoch',
      direction: 'tail',
      items,
      removedItemIds: [],
      submissions: [],
      window: {
        oldest: { epoch: 'epoch', sequence: items[0]?.sequence ?? 0 },
        newest: null,
        nextCursor: { epoch: 'epoch', sequence: 100 }
      },
      hasOlder,
      hasNewer: false
    }
  }
}
describe('saved conversation PR changes', () => {
  it('keeps same-number PRs in separate repositories and preserves creation on later edits', () => {
    expect(collectConversationReviewMutations([a, b, c])).toMatchObject([
      { action: 'created', lookup: { url: 'https://git.example.com/jiri/jiri/pulls/7' } },
      { action: 'created', lookup: { url: 'https://git.example.com/jiri/nextfe/pulls/7' } }
    ])
  })
  it('finds changes before the rendered tail after reopening, using the oldest anchor', async () => {
    const requests: AgentSessionHistoryRequest[] = []
    const pages = [page([c], true), page([a, b])]
    const found: AgentJournalRenderItem[] = []
    await readConversationReviewHistory(
      'session',
      async (request) => {
        requests.push(request)
        return pages.shift()!
      },
      new AbortController().signal,
      (items) => found.push(...items)
    )
    expect(collectConversationReviewMutations(found)).toHaveLength(2)
    expect(requests[1]).toMatchObject({
      direction: 'before',
      cursor: { epoch: 'epoch', sequence: 4 }
    })
  })
  it('reports interrupted scans rather than treating partial history as complete', async () => {
    const pages: AgentSessionHistoryResult[] = [
      page([c], true),
      { ok: false, page: page([a]).page, reset: 'epoch_changed' }
    ]
    await expect(
      readConversationReviewHistory(
        'session',
        async () => pages.shift()!,
        new AbortController().signal,
        () => {}
      )
    ).rejects.toThrow('history changed')
  })
  it('stops reading when the conversation is closed', async () => {
    const controller = new AbortController()
    let reads = 0
    await readConversationReviewHistory(
      'session',
      async () => {
        reads++
        return page([c], true)
      },
      controller.signal,
      () => controller.abort()
    )
    expect(reads).toBe(1)
  })
})
