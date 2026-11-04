import { defineMethod } from '../core'
import { lookupGiteaConversationReview } from '../../../gitea/conversation-review-lookup'
import { parseGiteaRepoRef } from '../../../gitea/repository-ref'
import {
  readGiteaReviewDetailsForRepo,
  readGiteaReviewDetailsForUrl
} from '../../../gitea/review-details'
import { supportsHostedReviewCreation } from '../../../../shared/source-control/hosted-review/hosted-review-creation-providers'
import { UNSUPPORTED_HOSTED_REVIEW_PROVIDER } from '../../../source-control/hosted-review-creation'
import {
  HostedReviewCreate,
  HostedReviewCreationEligibility,
  HostedReviewForBranch,
  HostedReviewConversationLookup,
  GiteaReviewDetails
} from '../../../../shared/rpc-contract/hosted-review-params'

export const HOSTED_REVIEW_METHODS = [
  defineMethod({
    name: 'hostedReview.giteaDetails',
    permission: 'workspace',
    params: GiteaReviewDetails,
    handler: async (params, { runtime }) =>
      'url' in params
        ? readGiteaReviewDetailsForUrl(
            params.url,
            runtime
              .listRepos()
              .flatMap((repo) => (repo.gitRemoteIdentity ? [repo.gitRemoteIdentity.remoteUrl] : []))
          )
        : readGiteaReviewDetailsForRepo(await runtime.showRepo(params.repo), params.number)
  }),
  defineMethod({
    name: 'hostedReview.conversationLookup',
    permission: 'workspace',
    params: HostedReviewConversationLookup,
    handler: async (params, { runtime }) => {
      let lookup: Exclude<typeof params, { directory: string }>
      if ('directory' in params) {
        const references = await runtime
          .listWorkspaceReferences(`path:${params.directory}`)
          .catch(() => null)
        if (!references?.worktree.repoId) {
          return null
        }
        const repo = await runtime.showRepo(`id:${references.worktree.repoId}`)
        const ref = repo.gitRemoteIdentity && parseGiteaRepoRef(repo.gitRemoteIdentity.remoteUrl)
        if (!ref) {
          return null
        }
        lookup = {
          url: `${ref.webBaseUrl}/${encodeURIComponent(ref.owner)}/${encodeURIComponent(ref.repo)}/pulls/${params.number}`
        }
      } else {
        lookup = params
      }
      return lookupGiteaConversationReview(
        lookup,
        runtime
          .listRepos()
          .flatMap((repo) => (repo.gitRemoteIdentity ? [repo.gitRemoteIdentity.remoteUrl] : []))
      )
    }
  }),
  defineMethod({
    name: 'hostedReview.forBranch',
    permission: 'workspace',
    params: HostedReviewForBranch,
    handler: async (params, { runtime }) => {
      const fallbackGitHubPR =
        params.linkedGitHubPR == null ? (params.fallbackGitHubPR ?? null) : null
      return runtime.getHostedReviewForBranch({
        repoSelector: params.repo,
        branch: params.branch,
        ...(params.admissionTier ? { admissionTier: params.admissionTier } : {}),
        currentHeadOid: params.currentHeadOid ?? null,
        ...(params.active === true ? { active: true } : {}),
        ...(params.force === true ? { force: true } : {}),
        ...(params.userRefresh === true ? { userRefresh: true } : {}),
        ...(params.reportReadOutcome === true ? { reportReadOutcome: true } : {}),
        linkedGitHubPR: params.linkedGitHubPR ?? null,
        ...(fallbackGitHubPR !== null ? { fallbackGitHubPR } : {}),
        linkedGitLabMR: params.linkedGitLabMR ?? null,
        linkedBitbucketPR: params.linkedBitbucketPR ?? null,
        linkedAzureDevOpsPR: params.linkedAzureDevOpsPR ?? null,
        linkedGiteaPR: params.linkedGiteaPR ?? null
      })
    }
  }),
  defineMethod({
    name: 'hostedReview.getCreationEligibility',
    permission: 'workspace',
    params: HostedReviewCreationEligibility,
    handler: async (params, { runtime }) => {
      const fallbackGitHubPR =
        params.linkedGitHubPR == null ? (params.fallbackGitHubPR ?? null) : null
      return runtime.getHostedReviewCreationEligibility({
        repoSelector: params.repo,
        worktreeSelector: params.worktree,
        branch: params.branch,
        base: params.base ?? null,
        hasUncommittedChanges: params.hasUncommittedChanges,
        hasUpstream: params.hasUpstream,
        ahead: params.ahead,
        behind: params.behind,
        linkedGitHubPR: params.linkedGitHubPR ?? null,
        ...(fallbackGitHubPR !== null ? { fallbackGitHubPR } : {}),
        linkedGitLabMR: params.linkedGitLabMR ?? null,
        linkedBitbucketPR: params.linkedBitbucketPR ?? null,
        linkedAzureDevOpsPR: params.linkedAzureDevOpsPR ?? null,
        linkedGiteaPR: params.linkedGiteaPR ?? null,
        wakeWslDistro: params.wakeWslDistro
      })
    }
  }),
  defineMethod({
    name: 'hostedReview.create',
    permission: 'workspace',
    params: HostedReviewCreate,
    handler: async (params, { runtime }) => {
      // Refuse an unknown host-issued provider token here; schema rejection would be unreadable to the client.
      if (!supportsHostedReviewCreation(params.provider)) {
        return UNSUPPORTED_HOSTED_REVIEW_PROVIDER
      }
      return runtime.createHostedReview({
        repoSelector: params.repo,
        worktreeSelector: params.worktree,
        provider: params.provider,
        base: params.base,
        head: params.head,
        title: params.title,
        body: params.body,
        draft: params.draft,
        useTemplate: params.useTemplate
      })
    }
  }),
  defineMethod({
    name: 'hostedReview.createStacked',
    permission: 'workspace',
    params: HostedReviewCreate,
    handler: async (params, { runtime }) => {
      if (!supportsHostedReviewCreation(params.provider)) {
        return UNSUPPORTED_HOSTED_REVIEW_PROVIDER
      }
      return runtime.createStackedHostedReview({
        repoSelector: params.repo,
        worktreeSelector: params.worktree,
        provider: params.provider,
        base: params.base,
        head: params.head,
        title: params.title,
        body: params.body,
        draft: params.draft,
        useTemplate: params.useTemplate
      })
    }
  })
]
