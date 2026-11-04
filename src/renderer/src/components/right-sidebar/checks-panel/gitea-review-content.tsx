import type { HostedReviewInfo } from '../../../../../shared/source-control/hosted-review/hosted-review-contracts'
import type { Repo } from '../../../../../shared/repo-types'
import type { Worktree } from '../../../../../shared/worktree/types'
import { GiteaReviewPanel } from './gitea-review-panel'
import { useGiteaReviewDetails } from './use-gitea-review-details'

export function GiteaReviewContent(props: {
  repo: Repo
  worktree: Worktree
  review: HostedReviewInfo
  visible: boolean
}): React.JSX.Element {
  const state = useGiteaReviewDetails(
    props.repo,
    props.review.number,
    props.visible,
    `${props.review.headSha ?? ''}:${props.review.updatedAt}`
  )
  return <GiteaReviewPanel worktree={props.worktree} review={props.review} state={state} />
}
