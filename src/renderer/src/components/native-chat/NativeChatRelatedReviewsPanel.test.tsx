// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { NativeChatRelatedReviewsPanel } from './NativeChatRelatedReviewsPanel'
import type { ConversationReviewRow } from './use-conversation-reviews'

const opened = vi.hoisted(() => vi.fn())
vi.mock('@/lib/app-http-link-open', () => ({
  openAppHttpLinkFromAnchor: (event: {
    currentTarget: HTMLAnchorElement
    preventDefault: () => void
  }) => {
    event.preventDefault()
    opened(event.currentTarget.href)
  }
}))
const url = 'https://git.example.com/team/repo/pulls/42'
const row: ConversationReviewRow = {
  key: url,
  lookup: { url },
  operationKey: 'created',
  sequence: 1,
  action: 'created',
  loading: false,
  review: {
    provider: 'gitea',
    number: 42,
    title: 'Add feature',
    url,
    state: 'merged',
    status: 'success',
    mergeable: 'MERGEABLE',
    updatedAt: ''
  }
}
const props = {
  expanded: true,
  loadingHistory: false,
  error: false,
  onToggle: vi.fn(),
  onRefresh: vi.fn()
}
afterEach(() => {
  cleanup()
  opened.mockClear()
})

describe('conversation PR list actions', () => {
  it('opens the PR title link while a separate button switches inline details', () => {
    const onSelectReview = vi.fn()
    render(
      <NativeChatRelatedReviewsPanel {...props} rows={[row]} onSelectReview={onSelectReview} />
    )
    const link = screen.getByRole('link', { name: 'Add feature' })
    expect(link.getAttribute('href')).toBe(url)
    fireEvent.click(link)
    expect(opened).toHaveBeenCalledWith(url)
    expect(onSelectReview).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'View details for Add feature' }))
    expect(onSelectReview).toHaveBeenCalledWith(row)
    expect(opened).toHaveBeenCalledTimes(1)
  })
  it('exposes a distinct lifecycle badge for every known PR state and marks the selected detail action', () => {
    const rows = (['open', 'closed', 'merged', 'draft'] as const).map((state) => ({
      ...row,
      key: state,
      review: { ...row.review!, title: state, state, url: `${url}?state=${state}` }
    }))
    render(
      <NativeChatRelatedReviewsPanel
        {...props}
        rows={rows}
        onSelectReview={vi.fn()}
        selectedKey={`${url}?state=merged`}
      />
    )
    for (const state of ['Open', 'Closed', 'Merged']) {
      expect(screen.getByLabelText(`State: ${state}`).textContent).toBe(state.toLowerCase())
    }
    expect(screen.getByLabelText('State: Draft PR').textContent).toBe('draft')
    expect(
      screen.getByRole('button', { name: 'View details for merged' }).getAttribute('aria-pressed')
    ).toBe('true')
    expect(
      screen.getByRole('button', { name: 'View details for open' }).getAttribute('aria-pressed')
    ).toBe('false')
  })
  it('does not invent a lifecycle state while PR metadata is unavailable', () => {
    const view = render(
      <NativeChatRelatedReviewsPanel {...props} rows={[{ ...row, review: null, loading: true }]} />
    )
    expect(view.container.querySelector('[data-review-state]')).toBeNull()
    expect(screen.getByRole('link', { name: 'Open PR' }).getAttribute('href')).toBe(url)
  })
})
