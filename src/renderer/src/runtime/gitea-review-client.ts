import type { Repo } from '../../../shared/repo-types'
import type { GiteaReviewDetails } from '../../../shared/gitea-review-details'
import { getRepoExecutionHostId } from '../../../shared/execution-host'
import { forgeCredentialTarget } from './forge-credential-target'
import { callRuntimeRpc } from './runtime-rpc-client'

export function loadGiteaReviewDetails(repo: Repo, number: number): Promise<GiteaReviewDetails> {
  const hostId = getRepoExecutionHostId(repo)
  const target = forgeCredentialTarget({ repoOwnerExecutionHostId: hostId })
  if (target.kind === 'environment') {
    return callRuntimeRpc(
      target,
      'hostedReview.giteaDetails',
      { repo: `id:${repo.id}`, number },
      { timeoutMs: 60_000 }
    )
  }
  return window.api.hostedReview.giteaDetails({
    repoPath: repo.path,
    repoId: repo.id,
    repoOwnerExecutionHostId: hostId,
    number
  })
}
