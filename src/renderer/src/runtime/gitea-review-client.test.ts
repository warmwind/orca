import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { makeRepo } from '../components/worktree-jump/worktree-jump-palette-test-fixtures'
import { loadGiteaReviewDetails } from './gitea-review-client'
const rpc = vi.hoisted(() => vi.fn())
vi.mock('./runtime-rpc-client', () => ({ callRuntimeRpc: rpc }))
const ipc = vi.fn()
beforeEach(() => {
  rpc.mockReset().mockResolvedValue(null)
  ipc.mockReset().mockResolvedValue(null)
  vi.stubGlobal('window', { api: { hostedReview: { giteaDetails: ipc } } })
})
afterEach(() => vi.unstubAllGlobals())
describe('Gitea review credential ownership', () => {
  it('reads a paired repository on its own server', async () => {
    await loadGiteaReviewDetails({ ...makeRepo(), executionHostId: 'runtime:hermes' }, 7)
    expect(rpc).toHaveBeenCalledWith(
      { kind: 'environment', environmentId: 'hermes' },
      'hostedReview.giteaDetails',
      { repo: 'id:repo-1', number: 7 },
      { timeoutMs: 60_000 }
    )
    expect(ipc).not.toHaveBeenCalled()
  })
  it('uses this computer for native SSH repositories without changing to a focused server', async () => {
    const repo = { ...makeRepo(), connectionId: 'ssh-hermes' }
    await loadGiteaReviewDetails(repo, 7)
    expect(ipc).toHaveBeenCalledWith({
      repoPath: repo.path,
      repoId: repo.id,
      repoOwnerExecutionHostId: 'ssh:ssh-hermes',
      number: 7
    })
    expect(rpc).not.toHaveBeenCalled()
  })
})
