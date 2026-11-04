import type { GiteaReviewDetails } from '../../shared/gitea-review-details'
import type { Repo } from '../../shared/repo-types'
import { PrioritySemaphore } from '../../shared/priority-semaphore'
import { requestJson } from './client'
import { trustedGiteaReviewReference } from './trusted-review-reference'
import { parseGiteaRepoRef, type GiteaRepoRef } from './repository-ref'
import {
  deriveGiteaCommitStatus,
  mapGiteaPullRequest,
  type RawGiteaPullRequest
} from './pull-request-mappers'
import {
  mapGiteaReview,
  mapGiteaReviewComment,
  mapGiteaStatus,
  type RawGiteaReview,
  type RawGiteaReviewComment,
  type RawGiteaStatus
} from './review-detail-mappers'

const inlineReads = new PrioritySemaphore(3)
const PAGE_SIZE = 50
const MAX_PAGES = 20

async function listPages<T>(repo: GiteaRepoRef, path: string) {
  const items: T[] = []
  for (let page = 1; page <= MAX_PAGES; page++) {
    const result = await requestJson<T[]>(
      repo,
      path,
      { searchParams: { page, limit: PAGE_SIZE } },
      true
    )
    if (!Array.isArray(result)) {
      throw new Error('Invalid Gitea list response')
    }
    items.push(...result)
    if (result.length < PAGE_SIZE) {
      return { items, truncated: false }
    }
  }
  return { items, truncated: true }
}

async function readChecks(repo: GiteaRepoRef, path: string, sha?: string | null) {
  if (!sha) {
    throw new Error('Gitea did not supply a PR head')
  }
  const statuses: RawGiteaStatus[] = []
  let state: string | undefined
  for (let page = 1; page <= MAX_PAGES; page++) {
    const result = await requestJson<{
      state?: string
      statuses?: RawGiteaStatus[]
      total_count?: number
    }>(
      repo,
      `${path}/commits/${encodeURIComponent(sha)}/status`,
      { searchParams: { page, limit: PAGE_SIZE } },
      true
    )
    if (!result || !Array.isArray(result.statuses)) {
      throw new Error('Invalid Gitea checks response')
    }
    state ??= result.state
    statuses.push(...result.statuses)
    if (
      result.statuses.length < PAGE_SIZE ||
      (result.total_count !== undefined && statuses.length >= result.total_count)
    ) {
      return { state, statuses, truncated: false }
    }
  }
  return { state, statuses, truncated: true }
}

export async function readGiteaReviewDetailsForRepo(
  registeredRepo: Repo,
  number: number
): Promise<GiteaReviewDetails> {
  if (!Number.isSafeInteger(number) || number <= 0) {
    throw new Error('Invalid Gitea PR number')
  }
  const repo = parseGiteaRepoRef(registeredRepo.gitRemoteIdentity?.remoteUrl ?? '')
  if (!repo || registeredRepo.kind === 'folder') {
    throw new Error('A registered Gitea repository is required')
  }
  return readGiteaReviewDetails(repo, number)
}

export async function readGiteaReviewDetailsForUrl(
  url: string,
  trustedRemotes: readonly string[]
): Promise<GiteaReviewDetails> {
  const reference = trustedGiteaReviewReference(url, trustedRemotes)
  if (!reference) {
    throw new Error('A PR on a configured or registered Gitea server is required')
  }
  return readGiteaReviewDetails(reference.repo, reference.number)
}

async function readGiteaReviewDetails(
  repo: GiteaRepoRef,
  number: number
): Promise<GiteaReviewDetails> {
  const path = `/repos/${encodeURIComponent(repo.owner)}/${encodeURIComponent(repo.repo)}`
  const raw = await requestJson<RawGiteaPullRequest & { body?: string }>(
    repo,
    `${path}/pulls/${number}`,
    {},
    true
  )
  if (!raw || raw.number !== number) {
    throw new Error('Gitea returned a different PR')
  }
  const [checksResult, reviewsResult, commentsResult] = await Promise.allSettled([
    readChecks(repo, path, raw.head?.sha),
    listPages<RawGiteaReview>(repo, `${path}/pulls/${number}/reviews`),
    requestJson<RawGiteaReviewComment[]>(repo, `${path}/issues/${number}/comments`, {}, true)
  ])
  const unavailable: GiteaReviewDetails['unavailable'] = []
  const combined = checksResult.status === 'fulfilled' ? checksResult.value : null
  if (!combined) {
    unavailable.push('checks')
  }
  const mapped = mapGiteaPullRequest(raw, deriveGiteaCommitStatus(combined))
  if (!mapped) {
    throw new Error('Invalid Gitea PR response')
  }
  const review = {
    ...mapped,
    provider: 'gitea' as const,
    checksAvailable: combined !== null,
    url: `${repo.webBaseUrl}/${encodeURIComponent(repo.owner)}/${encodeURIComponent(repo.repo)}/pulls/${number}`
  }
  const rawReviews = reviewsResult.status === 'fulfilled' ? reviewsResult.value.items : []
  if (reviewsResult.status === 'rejected') {
    unavailable.push('reviews')
  }
  const inlineResults = await Promise.allSettled(
    rawReviews
      .filter((item) => item.comments_count !== 0)
      .map(async (item) => {
        const release = await inlineReads.acquire(0)
        try {
          const comments = await requestJson<RawGiteaReviewComment[]>(
            repo,
            `${path}/pulls/${number}/reviews/${item.id}/comments`,
            {},
            true
          )
          if (!Array.isArray(comments)) {
            throw new Error('Invalid Gitea inline comments')
          }
          return comments
        } finally {
          release()
        }
      })
  )
  if (inlineResults.some((result) => result.status === 'rejected')) {
    unavailable.push('inline-comments')
  }
  const inline = inlineResults.flatMap((result) =>
    result.status === 'fulfilled' ? result.value : []
  )
  const ordinary =
    commentsResult.status === 'fulfilled' && Array.isArray(commentsResult.value)
      ? commentsResult.value
      : []
  if (commentsResult.status === 'rejected' || !Array.isArray(commentsResult.value)) {
    unavailable.push('comments')
  }
  const comments = [
    ...ordinary.map((item) => mapGiteaReviewComment(item, false)),
    ...inline.map((item) => mapGiteaReviewComment(item, true, raw.head?.sha ?? undefined))
  ]
  const uniqueStatuses = new Map<string, RawGiteaStatus>()
  for (const status of combined?.statuses ?? []) {
    const name = status.context || String(status.id ?? 'Gitea')
    if (!uniqueStatuses.has(name)) {
      uniqueStatuses.set(name, status)
    }
  }
  return {
    review,
    description: raw.body ?? '',
    reviews: rawReviews.map((item) => mapGiteaReview(item, review.url)),
    comments: [...new Map(comments.map((comment) => [comment.id, comment])).values()].sort((a, b) =>
      a.createdAt.localeCompare(b.createdAt)
    ),
    checks: [...uniqueStatuses.values()].map(mapGiteaStatus),
    checkDescriptions: Object.fromEntries(
      [...uniqueStatuses].map(([name, status]) => [name, status.description ?? ''])
    ),
    unavailable,
    truncated:
      combined?.truncated === true ||
      (reviewsResult.status === 'fulfilled' && reviewsResult.value.truncated)
  }
}
