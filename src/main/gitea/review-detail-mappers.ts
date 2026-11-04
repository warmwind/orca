import type { PRComment } from '../../shared/github/comment-types'
import type { PRCheckDetail } from '../../shared/github/check-types'
import type { GiteaPullReview } from '../../shared/gitea-review-details'

type GiteaReviewUser = { login?: string; avatar_url?: string; type?: string }
export type RawGiteaReview = {
  id: number
  user?: GiteaReviewUser
  state?: string
  body?: string
  html_url?: string
  submitted_at?: string
  dismissed?: boolean
  stale?: boolean
  comments_count?: number
}
export type RawGiteaReviewComment = {
  id: number
  user?: GiteaReviewUser
  body?: string
  html_url?: string
  created_at?: string
  path?: string
  position?: number
  commit_id?: string
  diff_hunk?: string
  resolver?: GiteaReviewUser | null
}
export type RawGiteaStatus = {
  id?: number
  context?: string
  status?: string
  description?: string
  target_url?: string
}

export function mapGiteaReview(raw: RawGiteaReview, reviewUrl: string): GiteaPullReview {
  return {
    id: raw.id,
    author: raw.user?.login ?? '',
    avatarUrl: raw.user?.avatar_url ?? '',
    state: raw.state ?? 'UNKNOWN',
    body: raw.body ?? '',
    url: raw.html_url || reviewUrl,
    submittedAt: raw.submitted_at ?? '',
    dismissed: raw.dismissed === true,
    stale: raw.stale === true
  }
}

export function mapGiteaReviewComment(
  raw: RawGiteaReviewComment,
  inline: boolean,
  headSha?: string
): PRComment {
  return {
    id: inline ? -raw.id : raw.id,
    author: raw.user?.login ?? '',
    authorAvatarUrl: raw.user?.avatar_url ?? '',
    body: raw.body ?? '',
    createdAt: raw.created_at ?? '',
    url: raw.html_url ?? '',
    ...(raw.user?.type?.toLowerCase() === 'bot' ? { isBot: true } : {}),
    ...(inline
      ? {
          threadId: `gitea-comment:${raw.id}`,
          path: raw.path,
          ...(raw.position && raw.position > 0 ? { line: raw.position } : {}),
          isResolved: raw.resolver != null,
          ...(headSha && raw.commit_id ? { isOutdated: headSha !== raw.commit_id } : {}),
          ...(raw.diff_hunk ? { diffHunk: raw.diff_hunk } : {})
        }
      : {})
  }
}

export function mapGiteaStatus(raw: RawGiteaStatus): PRCheckDetail {
  const state = raw.status?.toLowerCase()
  const pending = state === 'pending'
  const conclusion =
    state === 'success'
      ? 'success'
      : state === 'failure' || state === 'error'
        ? 'failure'
        : state === 'skipped'
          ? 'skipped'
          : pending
            ? null
            : 'neutral'
  return {
    name: raw.context || String(raw.id ?? 'Gitea'),
    status: pending ? 'in_progress' : 'completed',
    conclusion,
    url: raw.target_url || null
  }
}
