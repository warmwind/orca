import { useCallback } from 'react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import CommentMarkdown from '@/components/sidebar/CommentMarkdown'
import { openAppHttpLink } from '@/lib/app-http-link-open'
import { openAnnotationLocation } from '@/components/editor/check-annotation-open'
import { translate } from '@/i18n/i18n'
import type { HostedReviewInfo } from '../../../../../shared/hosted-review'
import type { GiteaReviewDetails } from '../../../../../shared/gitea-review-details'
import type { Worktree } from '../../../../../shared/worktree/types'
import type { PRCheckDetail, PRCheckRunDetails } from '../../../../../shared/github/check-types'
import { ChecksPanelReviewHeader } from './review-header'
import { ChecksPanelUpdatedAtMetadata } from '../checks-panel-updated-at-metadata'
import { ChecksList } from './checks-list'
import { PRCommentsList } from './comments-list'
import { QunliCardLinks } from './QunliCardLinks'

export function GiteaReviewPanel(props: {
  worktree?: Worktree
  review: HostedReviewInfo
  qunliCardUrls?: readonly string[]
  state: {
    data: GiteaReviewDetails | null
    loading: boolean
    error: string | null
    refresh: () => void
  }
}): React.JSX.Element {
  const { state } = props
  const review = state.data?.review ?? props.review
  const contextKey = JSON.stringify([
    props.worktree?.hostId,
    props.worktree?.id,
    review.url,
    review.headSha
  ])
  const loadCheck = useCallback(
    async (check: PRCheckDetail): Promise<PRCheckRunDetails> => ({
      name: check.name,
      status: check.status,
      conclusion: check.conclusion,
      url: check.url,
      detailsUrl: check.url,
      startedAt: null,
      completedAt: null,
      title: check.name,
      summary: state.data?.checkDescriptions[check.name] ?? null,
      text: null,
      annotations: [],
      jobs: []
    }),
    [state.data?.checkDescriptions]
  )
  const failed = (part: 'checks' | 'comments' | 'inline-comments' | 'reviews') =>
    state.data?.unavailable.includes(part)
  const commentsError =
    failed('comments') || failed('inline-comments')
      ? translate(
          'gitea.review.commentsUnavailable',
          'Some Gitea comments could not be loaded. Refresh to try again.'
        )
      : null
  return (
    <div className="flex-1 overflow-auto scrollbar-sleek" data-gitea-review-panel="">
      <div className="space-y-2.5 border-b border-border px-3 py-3">
        <ChecksPanelReviewHeader
          review={review}
          isRefreshing={state.loading}
          canUnlinkReview={false}
          showReferenceActions={false}
          modifierHintDestination={null}
          onRefresh={state.refresh}
          onOpenReview={(event) => {
            openAppHttpLink(review.url, { event, worktreeId: props.worktree?.id })
          }}
          onUnlinkReview={() => {}}
          onLinkAnotherReview={() => {}}
        />
        <p className="text-sm font-medium text-foreground">{review.title}</p>
        <QunliCardLinks
          title={review.title}
          texts={[
            ...(props.qunliCardUrls ?? []),
            state.data?.description ?? '',
            ...(state.data?.comments ?? []).map((comment) => comment.body)
          ]}
          worktreeId={props.worktree?.id}
        />
        {review.updatedAt ? (
          <ChecksPanelUpdatedAtMetadata reviewShortLabel="PR" updatedAt={review.updatedAt} />
        ) : null}
        {state.data?.description ? (
          <details className="text-xs text-muted-foreground">
            <summary className="cursor-pointer">
              {translate('gitea.review.description', 'Description')}
            </summary>
            <CommentMarkdown content={state.data.description} variant="compact" />
          </details>
        ) : null}
        {state.error ? (
          <div role="alert" className="space-y-1 text-xs text-muted-foreground">
            <p>
              {translate(
                'gitea.review.loadFailed',
                'Could not load Gitea review details in this environment.'
              )}
            </p>
            <p>{state.error}</p>
            <Button size="xs" variant="outline" disabled={state.loading} onClick={state.refresh}>
              {translate('common.retry', 'Retry')}
            </Button>
          </div>
        ) : null}
        {state.data?.truncated ? (
          <p role="status" className="text-xs text-muted-foreground">
            {translate(
              'gitea.review.truncated',
              'This PR has more review history than can be displayed here. Open it on Gitea to see all entries.'
            )}
          </p>
        ) : null}
      </div>
      <ChecksList
        checks={state.data?.checks ?? []}
        checksLoading={state.loading}
        checksError={
          failed('checks')
            ? translate('gitea.review.checksUnavailable', 'Gitea checks could not be loaded.')
            : state.error
        }
        checkDetailsContextKey={contextKey}
        worktreeId={props.worktree?.id}
        onLoadCheckDetails={loadCheck}
        fullDetailsSupported={false}
      />
      <section
        aria-label={translate('gitea.review.reviews', 'Reviews')}
        className="space-y-2 border-t border-border p-3"
      >
        <h3 className="text-xs font-semibold text-foreground">
          {translate('gitea.review.reviews', 'Reviews')}{' '}
          {state.data ? `· ${state.data.reviews.length}` : ''}
        </h3>
        {failed('reviews') ? (
          <p role="alert" className="text-xs text-muted-foreground">
            {translate(
              'gitea.review.reviewsUnavailable',
              'Gitea reviews could not be loaded. Refresh to try again.'
            )}
          </p>
        ) : null}
        {state.data?.reviews.map((item) => (
          <article key={item.id} className="space-y-1.5 rounded-md border border-border p-2.5">
            <div className="flex flex-wrap items-center gap-1.5 text-xs">
              <span className="font-medium">{item.author}</span>
              <Badge variant="outline">{reviewStateLabel(item.state)}</Badge>
              {item.dismissed ? (
                <Badge variant="outline">{translate('gitea.review.dismissed', 'Dismissed')}</Badge>
              ) : null}
              {item.stale ? (
                <Badge variant="outline">{translate('gitea.review.stale', 'Outdated')}</Badge>
              ) : null}
            </div>
            {item.body ? <CommentMarkdown content={item.body} variant="compact" /> : null}
            <a
              href={item.url}
              target="_blank"
              rel="noreferrer"
              className="block text-xs text-muted-foreground underline underline-offset-2"
              onClick={(event) => {
                event.preventDefault()
                openAppHttpLink(item.url, { event, worktreeId: props.worktree?.id })
              }}
            >
              {translate('gitea.review.openReview', 'Open review on Gitea')}
            </a>
          </article>
        ))}
        {state.data && !failed('reviews') && !state.data.reviews.length ? (
          <p className="text-xs text-muted-foreground">
            {translate('gitea.review.noReviews', 'No reviews yet.')}
          </p>
        ) : null}
      </section>
      <PRCommentsList
        comments={state.data?.comments ?? []}
        commentsLoading={state.loading}
        commentsError={commentsError ?? state.error}
        selectionContextKey={contextKey}
        onOpenLocation={
          props.worktree
            ? (path, line) => {
                if (props.worktree) {
                  openAnnotationLocation({
                    worktreeId: props.worktree.id,
                    executionHostId: props.worktree.hostId,
                    path,
                    line
                  })
                }
              }
            : undefined
        }
      />
    </div>
  )
}

function reviewStateLabel(state: string): string {
  switch (state.toUpperCase()) {
    case 'APPROVED':
      return translate('gitea.review.approved', 'Approved')
    case 'REQUEST_CHANGES':
      return translate('gitea.review.changesRequested', 'Changes requested')
    case 'COMMENT':
      return translate('gitea.review.commented', 'Commented')
    case 'PENDING':
      return translate('gitea.review.pending', 'Pending')
    case 'REQUEST_REVIEW':
      return translate('gitea.review.requested', 'Review requested')
    default:
      return state
  }
}
