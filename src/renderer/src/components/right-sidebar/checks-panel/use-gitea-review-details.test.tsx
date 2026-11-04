// @vitest-environment happy-dom
import { act, cleanup, renderHook, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { GiteaReviewDetails } from '../../../../../shared/gitea-review-details'
import { makeRepo } from '../../worktree-jump/worktree-jump-palette-test-fixtures'
import { useGiteaReviewDetails } from './use-gitea-review-details'

const load = vi.hoisted(() => vi.fn())
vi.mock('@/runtime/gitea-review-client', () => ({ loadGiteaReviewDetails: load }))
vi.mock('./checks-panel-forge-owner', () => ({
  checksPanelLoadErrorMessage: (error: Error) => error.message
}))
const repo = makeRepo()
const data: GiteaReviewDetails = {
  review: {
    provider: 'gitea',
    number: 7,
    title: 'Feature',
    state: 'open',
    status: 'success',
    url: 'https://git.example.com/team/repo/pulls/7',
    updatedAt: '',
    mergeable: 'MERGEABLE'
  },
  description: '',
  reviews: [],
  comments: [],
  checks: [],
  checkDescriptions: {},
  unavailable: [],
  truncated: false
}
beforeEach(() => {
  load.mockReset()
})
afterEach(cleanup)
describe('Gitea review detail loading', () => {
  it('waits until visible and reloads when the PR head changes', async () => {
    load.mockResolvedValue(data)
    const { result, rerender } = renderHook(
      ({ visible, revision }) => useGiteaReviewDetails(repo, 7, visible, revision),
      { initialProps: { visible: false, revision: 'head-one' } }
    )
    expect(load).not.toHaveBeenCalled()
    rerender({ visible: true, revision: 'head-one' })
    await waitFor(() => expect(result.current.data).toEqual(data))
    rerender({ visible: true, revision: 'head-two' })
    await waitFor(() => expect(load).toHaveBeenCalledTimes(2))
  })
  it('retains loaded comments after refresh fails and supports retry', async () => {
    load
      .mockResolvedValueOnce(data)
      .mockRejectedValueOnce(new Error('HTTP 401'))
      .mockResolvedValue(data)
    const { result } = renderHook(() => useGiteaReviewDetails(repo, 7, true))
    await waitFor(() => expect(result.current.data).toEqual(data))
    act(() => result.current.refresh())
    await waitFor(() => expect(result.current.error).toBe('HTTP 401'))
    expect(result.current.data).toEqual(data)
    act(() => result.current.refresh())
    await waitFor(() => expect(result.current.error).toBeNull())
    await waitFor(() => expect(result.current.loading).toBe(false))
  })
  it('ignores an old host response after switching to another PR', async () => {
    let resolveOld: ((value: GiteaReviewDetails) => void) | undefined
    load
      .mockImplementationOnce(
        () =>
          new Promise<GiteaReviewDetails>((resolve) => {
            resolveOld = resolve
          })
      )
      .mockResolvedValue({ ...data, review: { ...data.review, number: 8 } })
    const { result, rerender } = renderHook(
      ({ number }) => useGiteaReviewDetails(repo, number, true),
      { initialProps: { number: 7 } }
    )
    rerender({ number: 8 })
    await waitFor(() => expect(result.current.data?.review.number).toBe(8))
    await act(async () => resolveOld?.(data))
    expect(result.current.data?.review.number).toBe(8)
  })
})
