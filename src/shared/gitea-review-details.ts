import type { HostedReviewInfo } from './hosted-review'
import type { PRComment } from './github/comment-types'
import type { PRCheckDetail } from './github/check-types'

export type GiteaPullReview = {
  id: number
  author: string
  avatarUrl: string
  state: string
  body: string
  url: string
  submittedAt: string
  dismissed: boolean
  stale: boolean
}

export type GiteaReviewDetails = {
  review: HostedReviewInfo
  description: string
  reviews: GiteaPullReview[]
  comments: PRComment[]
  checks: PRCheckDetail[]
  checkDescriptions: Record<string, string>
  unavailable: ('checks' | 'reviews' | 'comments' | 'inline-comments')[]
  truncated: boolean
}

export type GiteaReviewDetailsArgs = {
  repoPath: string
  repoId?: string
  repoOwnerExecutionHostId?: string
  number: number
}
