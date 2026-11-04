// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { TooltipProvider } from '@/components/ui/tooltip'
import type { GiteaReviewDetails } from '../../../../../shared/gitea-review-details'
import { makeWorktree } from '../../worktree-jump/worktree-jump-palette-test-fixtures'
import { GiteaReviewPanel } from './gitea-review-panel'

vi.mock('@/store', async () => {
  const { createTestStore } = await import('@/store/slices/store-test-helpers')
  return { useAppStore: createTestStore() }
})
const worktree = makeWorktree('gitea', 'Gitea')
const data: GiteaReviewDetails = {
  review: {
    provider: 'gitea',
    number: 7,
    title: 'Feature',
    state: 'open',
    status: 'failure',
    url: 'https://git.example.com/team/repo/pulls/7',
    updatedAt: '',
    mergeable: 'MERGEABLE'
  },
  description: '',
  reviews: [
    {
      id: 1,
      author: 'reviewer',
      avatarUrl: '',
      state: 'REQUEST_CHANGES',
      body: 'Review decision body',
      submittedAt: '',
      dismissed: false,
      stale: false,
      url: 'https://git.example.com/team/repo/pulls/7#review-1'
    }
  ],
  comments: [
    { id: 2, author: 'human', authorAvatarUrl: '', body: 'Human comment', createdAt: '', url: '' },
    {
      id: -3,
      author: 'bot',
      authorAvatarUrl: '',
      isBot: true,
      body: 'Inline bot comment',
      createdAt: '',
      url: '',
      path: 'src/main.ts',
      line: 12,
      threadId: 'gitea-comment:3',
      isResolved: false
    }
  ],
  checks: [{ name: 'Lint', status: 'completed', conclusion: 'failure', url: null }],
  checkDescriptions: { Lint: 'Lint status description' },
  unavailable: [],
  truncated: false
}
afterEach(cleanup)
describe('Gitea review panel', () => {
  it('shows a card linked from the conversation when the PR metadata has no task id', () => {
    const view = render(
      <TooltipProvider>
        <GiteaReviewPanel
          review={data.review}
          qunliCardUrls={['https://qunli.co/2025/T18033']}
          state={{ data, loading: false, error: null, refresh: vi.fn() }}
        />
      </TooltipProvider>
    )
    const cards = within(view.container.querySelector('[data-qunli-card-links]')!)
    expect(cards.getByRole('link', { name: 'T18033' }).getAttribute('href')).toBe(
      'https://qunli.co/2025/T18033'
    )
  })
  it('shows deduplicated Qunli card links beside the selected PR and clears them on a PR switch', () => {
    const linkedData = {
      ...data,
      review: { ...data.review, title: 'T18033 feat: add run notes' },
      description: 'Task: https://qunli.co/2025/T18033',
      comments: [
        ...data.comments,
        {
          ...data.comments[0],
          id: 99,
          body: 'https://qunli.co/2025/T18033#comment https://qunli.co/2025/T18015'
        }
      ]
    }
    const view = render(
      <TooltipProvider>
        <GiteaReviewPanel
          review={linkedData.review}
          state={{ data: linkedData, loading: false, error: null, refresh: vi.fn() }}
        />
      </TooltipProvider>
    )
    const cards = within(view.container.querySelector('[data-qunli-card-links]')!)
    expect(cards.getAllByRole('link')).toHaveLength(2)
    expect(cards.getByRole('link', { name: 'T18033' }).getAttribute('href')).toBe(
      'https://qunli.co/2025/T18033'
    )
    expect(cards.getByRole('link', { name: 'T18015' }).getAttribute('href')).toBe(
      'https://qunli.co/2025/T18015'
    )
    view.rerender(
      <TooltipProvider>
        <GiteaReviewPanel
          review={data.review}
          state={{ data, loading: false, error: null, refresh: vi.fn() }}
        />
      </TooltipProvider>
    )
    expect(view.container.querySelector('[data-qunli-card-links]')).toBeNull()
  })
  it('renders review decisions and status descriptions without GitHub check identifiers', async () => {
    render(
      <TooltipProvider>
        <GiteaReviewPanel
          worktree={worktree}
          review={data.review}
          state={{ data, loading: false, error: null, refresh: vi.fn() }}
        />
      </TooltipProvider>
    )
    expect(screen.getByText('Review decision body')).toBeTruthy()
    await waitFor(() => expect(screen.getByText('Lint status description')).toBeTruthy())
    expect(screen.queryByText('View full details')).toBeNull()
    expect(screen.getByText('Inline bot comment')).toBeTruthy()
    expect(screen.getByText('Human comment')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: /Humans/ }))
    expect(screen.queryByText('Inline bot comment')).toBeNull()
    expect(screen.getByText('Human comment')).toBeTruthy()
  })
  it('preserves existing review and comment bodies when a refresh fails', () => {
    const refresh = vi.fn()
    render(
      <TooltipProvider>
        <GiteaReviewPanel
          worktree={worktree}
          review={data.review}
          state={{ data, loading: false, error: 'Hermes authentication required', refresh }}
        />
      </TooltipProvider>
    )
    expect(screen.getByText('Hermes authentication required')).toBeTruthy()
    expect(screen.getByText('Review decision body')).toBeTruthy()
    expect(screen.getByText('Human comment')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }))
    expect(refresh).toHaveBeenCalledOnce()
  })
})
