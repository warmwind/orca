// @vitest-environment happy-dom
import { act, cleanup, render, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { TooltipProvider } from '@/components/ui/tooltip'
import { useAppStore } from '@/store'
import type { AgentJournalRenderItem } from '../../../../shared/agent-session/journal/agent-session-journal-types'
import { NativeChatRelatedReviews } from './NativeChatRelatedReviews'
import { useConversationReviewScope } from './conversation-review-scope'

const rpc = vi.hoisted(() => vi.fn())
vi.mock('@/runtime/runtime-rpc-client', () => ({ callRuntimeRpc: rpc }))
vi.mock('@/store', async () => {
  const { createTestStore } = await import('@/store/slices/store-test-helpers')
  return { useAppStore: createTestStore() }
})
const target = { kind: 'local' } as const
const items: AgentJournalRenderItem[] = []
function history(sessionId: string) {
  const url = `https://git.example.com/team/${sessionId}/pulls/7`
  return {
    ok: true,
    page: {
      sessionId,
      epoch: 'epoch',
      direction: 'tail',
      hasOlder: false,
      window: { oldest: null, nextCursor: { epoch: 'epoch', sequence: 1 } },
      items: [
        {
          sequence: 1,
          itemId: 'one',
          revision: 1,
          observedAt: 0,
          body: {
            kind: 'tool-call',
            name: 'Bash',
            input: { command: 'tea pulls create' },
            state: 'completed',
            exitCode: 0,
            output: { head: url, byteLength: url.length, digest: 'digest', truncated: false }
          }
        }
      ]
    }
  }
}
beforeEach(() => {
  useConversationReviewScope.setState({ active: null })
  useAppStore.setState({ rightSidebarOpen: true, rightSidebarTab: 'checks' })
  rpc.mockReset().mockImplementation(async (_target, method, params) => {
    if (method === 'agentSession.history') {
      return history(params.sessionId)
    }
    return {
      provider: 'gitea',
      number: 7,
      title: params.url,
      url: params.url,
      state: 'open',
      status: 'success',
      updatedAt: '',
      mergeable: 'MERGEABLE'
    }
  })
})
afterEach(cleanup)
describe('focused conversation review scope', () => {
  it('loads saved mutations for the sidebar while the in-chat list is collapsed', async () => {
    render(
      <TooltipProvider>
        <NativeChatRelatedReviews sessionId="jiri" target={target} items={items} isVisible />
      </TooltipProvider>
    )
    await waitFor(() =>
      expect(useConversationReviewScope.getState().active?.rows[0]?.review?.url).toBe(
        'https://git.example.com/team/jiri/pulls/7'
      )
    )
    expect(rpc).toHaveBeenCalledWith(
      target,
      'agentSession.history',
      expect.objectContaining({ sessionId: 'jiri' }),
      expect.anything()
    )
  })
  it('publishes only the focused chat and does not clear it when another chat unmounts', async () => {
    const { rerender } = render(
      <TooltipProvider>
        <NativeChatRelatedReviews
          key="one"
          sessionId="jiri"
          target={target}
          items={items}
          isVisible
        />
        <NativeChatRelatedReviews
          key="two"
          sessionId="nextfe"
          target={target}
          items={items}
          isVisible={false}
        />
      </TooltipProvider>
    )
    await waitFor(() =>
      expect(useConversationReviewScope.getState().active?.sessionId).toBe('jiri')
    )
    rerender(
      <TooltipProvider>
        <NativeChatRelatedReviews
          key="one"
          sessionId="jiri"
          target={target}
          items={items}
          isVisible={false}
        />
        <NativeChatRelatedReviews
          key="two"
          sessionId="nextfe"
          target={target}
          items={items}
          isVisible
        />
      </TooltipProvider>
    )
    await waitFor(() =>
      expect(useConversationReviewScope.getState().active?.rows[0]?.review?.url).toBe(
        'https://git.example.com/team/nextfe/pulls/7'
      )
    )
    rerender(
      <TooltipProvider>
        <NativeChatRelatedReviews
          key="two"
          sessionId="nextfe"
          target={target}
          items={items}
          isVisible
        />
      </TooltipProvider>
    )
    expect(useConversationReviewScope.getState().active?.sessionId).toBe('nextfe')
    act(() => useAppStore.setState({ rightSidebarOpen: false }))
  })
})
