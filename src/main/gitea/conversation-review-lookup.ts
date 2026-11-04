import { requestJson, encodedRepoPath, giteaPullRequestScanKey, matchesBranch } from './client'
import { parseGiteaRepoRef, type GiteaRepoRef } from './repository-ref'
import { trustedGiteaWebBases } from './trusted-review-reference'
import { invalidateGiteaPullRequestScan, scanGiteaPullRequests } from './pull-request-scan-cache'
import {
  deriveGiteaCommitStatus,
  mapGiteaPullRequest,
  type RawGiteaCombinedStatus,
  type RawGiteaPullRequest
} from './pull-request-mappers'
import type { ConversationReviewLookup } from '../../shared/conversation-review-mutations'
import type { HostedReviewInfo } from '../../shared/hosted-review'
import { parseWorkspaceReferenceUrl } from '../../shared/workspace-reference-identity'

const PULL_REQUEST_LIST_TIMEOUT_MS = 15_000
const PULL_REQUEST_PAGE_LIMIT = 50
const MAX_PULL_REQUEST_PAGES = 5

/** Cross-repository reads use only a configured server or a registered remote's web origin. */
export async function lookupGiteaConversationReview(
  lookup: Exclude<ConversationReviewLookup, { directory: string }>,
  trustedRemotes: readonly string[]
): Promise<HostedReviewInfo | null> {
  const bases = trustedGiteaWebBases(trustedRemotes)
  let reference: ReturnType<typeof parseWorkspaceReferenceUrl> | null = null
  let repo: GiteaRepoRef | null = null
  if ('url' in lookup) {
    reference = parseWorkspaceReferenceUrl(lookup.url)
    if (reference.provider !== 'gitea' || reference.type !== 'pr' || !reference.url) {
      return null
    }
    repo = parseGiteaRepoRef(reference.url.replace(/\/pulls\/\d+$/, ''))
  } else if ('remoteUrl' in lookup) {
    repo = parseGiteaRepoRef(lookup.remoteUrl)
  } else if (bases.length === 1 && /^[\w.-]+\/[\w.-]+$/.test(lookup.repository)) {
    repo = parseGiteaRepoRef(`${bases[0]}/${lookup.repository}`)
  }
  if (!repo || !bases.includes(repo.webBaseUrl)) {
    return null
  }
  const path = `/repos/${encodedRepoPath(repo)}/pulls`
  let raw: RawGiteaPullRequest | null
  if ('remoteUrl' in lookup) {
    const scanKey = `${giteaPullRequestScanKey(repo)}::conversation:${lookup.branch}`
    invalidateGiteaPullRequestScan(scanKey)
    const pulls = await scanGiteaPullRequests(
      scanKey,
      (page) =>
        requestJson<RawGiteaPullRequest[]>(
          repo!,
          path,
          {
            searchParams: {
              state: 'all',
              sort: 'recentupdate',
              page,
              limit: PULL_REQUEST_PAGE_LIMIT
            },
            timeoutMs: PULL_REQUEST_LIST_TIMEOUT_MS
          },
          true
        ),
      PULL_REQUEST_PAGE_LIMIT,
      MAX_PULL_REQUEST_PAGES
    )
    const matching = pulls.filter(
      (item) => matchesBranch(item, lookup.branch) && item.head?.sha?.startsWith(lookup.headSha)
    )
    raw = matching.length === 1 ? matching[0] : null
  } else {
    const number = reference?.number ?? ('number' in lookup ? lookup.number : null)
    if (!number) {
      return null
    }
    raw = await requestJson<RawGiteaPullRequest>(repo, `${path}/${number}`, {}, true)
    if (raw?.number !== number) {
      return null
    }
  }
  let combinedStatus: RawGiteaCombinedStatus | null = null
  if (raw?.head?.sha) {
    combinedStatus = await requestJson<RawGiteaCombinedStatus>(
      repo,
      `/repos/${encodedRepoPath(repo)}/commits/${encodeURIComponent(raw.head.sha)}/status`
    )
  }
  const review = raw ? mapGiteaPullRequest(raw, deriveGiteaCommitStatus(combinedStatus)) : null
  if (!review) {
    return null
  }
  // The canonical URL comes from the trusted request target, not a response-supplied host.
  return {
    ...review,
    provider: 'gitea',
    checksAvailable: combinedStatus !== null,
    url: `${repo.webBaseUrl}/${encodeURIComponent(repo.owner)}/${encodeURIComponent(repo.repo)}/pulls/${review.number}`
  }
}
