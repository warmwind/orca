// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { TooltipProvider } from '@/components/ui/tooltip'
import type { GiteaReviewDetails } from '../../../../../shared/gitea-review-details'
import type { ConversationReviewScope } from '../../native-chat/conversation-review-scope'
import { ConversationReviewsSidebar } from './ConversationReviewsSidebar'

const rpc = vi.hoisted(() => vi.fn())
vi.mock('@/runtime/runtime-rpc-client', () => ({ callRuntimeRpc: rpc }))
vi.mock('@/store', async () => {
  const { createTestStore } = await import('@/store/slices/store-test-helpers')
  return { useAppStore: createTestStore() }
})
const repositories = ['jiri', 'nextfe', 'goldendata']
function scope(sessionId: string, repos = repositories): ConversationReviewScope {
  return {
    key: sessionId,
    sessionId,
    target: { kind: 'environment', environmentId: 'hermes' },
    loadingHistory: false,
    error: false,
    lookupError: false,
    refresh: vi.fn(),
    rows: repos.map((name, index) => {
      const url = `https://git.example.com/team/${name}/pulls/7`
      return {
        key: url,
        sequence: index,
        operationKey: name,
        action: 'created',
        lookup: { url },
        loading: false,
        review: {
          provider: 'gitea',
          number: 7,
          title: `${name} PR`,
          url,
          state: 'open',
          status: 'success',
          mergeable: 'MERGEABLE',
          updatedAt: ''
        }
      }
    })
  }
}
beforeEach(() => {
  rpc
    .mockReset()
    .mockImplementation(async (_target, method, params): Promise<GiteaReviewDetails> => {
      expect(method).toBe('hostedReview.giteaDetails')
      const name = new URL(params.url).pathname.split('/')[2]
      return {
        review: {
          provider: 'gitea',
          number: 7,
          title: `${name} PR`,
          url: params.url,
          state: 'open',
          status: 'success',
          mergeable: 'MERGEABLE',
          updatedAt: ''
        },
        description: '',
        checks: [],
        reviews: [],
        checkDescriptions: {},
        unavailable: [],
        truncated: false,
        comments: [
          {
            id: 1,
            author: 'reviewer',
            authorAvatarUrl: '',
            body: `Review for ${name}`,
            createdAt: '',
            url: ''
          }
        ]
      }
    })
})
afterEach(cleanup)
describe('conversation-scoped review sidebar', () => {
  it('lists three repositories and switches details by URL even when PR numbers match', async () => {
    render(
      <TooltipProvider>
        <ConversationReviewsSidebar scope={scope('session-one')} visible />
      </TooltipProvider>
    )
    for (const name of repositories) {
      expect(screen.getByRole('link', { name: `${name} PR` })).toBeTruthy()
    }
    await waitFor(() => expect(screen.getByText('Review for jiri')).toBeTruthy())
    fireEvent.click(screen.getByRole('button', { name: 'View details for nextfe PR' }))
    await waitFor(() => expect(screen.getByText('Review for nextfe')).toBeTruthy())
    expect(screen.queryByText('Review for jiri')).toBeNull()
    expect(rpc).toHaveBeenLastCalledWith(
      { kind: 'environment', environmentId: 'hermes' },
      'hostedReview.giteaDetails',
      { url: 'https://git.example.com/team/nextfe/pulls/7' },
      { timeoutMs: 60_000 }
    )
    fireEvent.click(screen.getByRole('button', { name: 'View details for goldendata PR' }))
    await waitFor(() => expect(screen.getByText('Review for goldendata')).toBeTruthy())
  })
  it('clears the previous conversation when the focused session changes', async () => {
    const first = scope('first')
    const { rerender } = render(
      <TooltipProvider>
        <ConversationReviewsSidebar key={first.key} scope={first} visible />
      </TooltipProvider>
    )
    await waitFor(() => expect(screen.getByText('Review for jiri')).toBeTruthy())
    const second = scope('second', [])
    rerender(
      <TooltipProvider>
        <ConversationReviewsSidebar key={second.key} scope={second} visible />
      </TooltipProvider>
    )
    expect(screen.queryByText('Review for jiri')).toBeNull()
    expect(screen.queryByRole('link', { name: 'nextfe PR' })).toBeNull()
    expect(
      screen.getByText('No PR creation or update was detected in this conversation.')
    ).toBeTruthy()
  })
})
