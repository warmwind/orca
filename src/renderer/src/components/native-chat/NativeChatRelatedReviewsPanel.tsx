import { ChevronDown, ChevronRight, ExternalLink, GitPullRequest } from 'lucide-react'
import { useId } from 'react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { translate } from '@/i18n/i18n'
import { openAppHttpLinkFromAnchor } from '@/lib/app-http-link-open'
import { checksLabel } from '../sidebar/WorktreeCardHelpers'
import { ReviewStateBadge } from '../sidebar/WorktreeCardMetadataStatusBadges'
import type { ConversationReviewRow } from './use-conversation-reviews'

export function conversationReviewAddress(row: ConversationReviewRow): {
  url: string | null
  label: string
} {
  const url = row.review?.url ?? ('url' in row.lookup ? row.lookup.url : null)
  if (url) {
    const address = new URL(url)
    return {
      url,
      label: `${address.host}${address.pathname.replace(/\/(?:pull|pulls|merge_requests)\/(\d+)$/, ' #$1').replace('/- #', ' #')}`
    }
  }
  return {
    url: null,
    label:
      'repository' in row.lookup
        ? `${row.lookup.repository} #${row.lookup.number}`
        : 'remoteUrl' in row.lookup
          ? `${row.lookup.remoteUrl} · ${row.lookup.branch}`
          : 'directory' in row.lookup
            ? `${row.lookup.directory} #${row.lookup.number}`
            : row.lookup.url
  }
}

export function NativeChatRelatedReviewsPanel(props: {
  rows: readonly ConversationReviewRow[]
  expanded: boolean
  loadingHistory: boolean
  error: boolean
  lookupError?: boolean
  onToggle: () => void
  onRefresh: () => void
  onSelectReview?: (row: ConversationReviewRow) => void
  selectedKey?: string
}): React.JSX.Element {
  const contentId = useId()
  return (
    <section
      className="shrink-0 border-b border-border bg-card text-card-foreground"
      aria-label={translate(
        'components.native-chat.relatedReviews.title',
        'PRs changed in this conversation'
      )}
    >
      <div className="flex items-center gap-1 px-3 py-1">
        <Button
          variant="ghost"
          size="xs"
          className="min-w-0 flex-1 justify-start"
          aria-expanded={props.expanded}
          aria-controls={contentId}
          onClick={props.onToggle}
        >
          {props.expanded ? (
            <ChevronDown className="size-3.5" />
          ) : (
            <ChevronRight className="size-3.5" />
          )}
          <GitPullRequest className="size-3.5" />
          <span className="truncate">
            {translate(
              'components.native-chat.relatedReviews.title',
              'PRs changed in this conversation'
            )}
          </span>
          {props.rows.length ? <span className="tabular-nums">{props.rows.length}</span> : null}
        </Button>
        {props.expanded ? (
          <Button
            variant="ghost"
            size="xs"
            onClick={props.onRefresh}
            disabled={props.loadingHistory}
          >
            {translate('common.refresh', 'Refresh')}
          </Button>
        ) : null}
      </div>
      {props.expanded ? (
        <div
          id={contentId}
          className={cn(
            'scrollbar-sleek space-y-2 overflow-y-auto px-4 pb-3 text-xs',
            props.onSelectReview ? 'max-h-96' : 'max-h-60'
          )}
        >
          {props.rows.map((row) => {
            const { url, label } = conversationReviewAddress(row)
            return (
              <div
                key={row.key}
                data-current={props.selectedKey === (url ?? row.key) || undefined}
                className={`space-y-1 rounded-md border border-border p-2 ${props.selectedKey === (url ?? row.key) ? 'bg-accent' : ''}`}
              >
                <div className="flex flex-wrap items-center gap-1.5 text-muted-foreground">
                  {row.review ? (
                    <ReviewStateBadge state={row.review.state} label="PR" prominent />
                  ) : null}
                  <span className="min-w-0 break-all">{label}</span>
                  <span className="text-2xs text-muted-foreground">
                    {row.action === 'created'
                      ? translate('components.native-chat.relatedReviews.created', 'Created')
                      : translate('components.native-chat.relatedReviews.updated', 'Updated')}
                  </span>
                </div>
                {url ? (
                  <a
                    className="block break-words rounded-sm text-sm font-medium underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    href={url}
                    target="_blank"
                    rel="noopener noreferrer"
                    onClick={openAppHttpLinkFromAnchor}
                  >
                    {row.review?.title ||
                      translate('components.native-chat.relatedReviews.open', 'Open PR')}
                    <ExternalLink className="ml-1 inline size-3.5" aria-hidden="true" />
                  </a>
                ) : null}
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0 text-muted-foreground" role="status">
                    {row.loading
                      ? translate(
                          'components.native-chat.relatedReviews.loading',
                          'Loading PR status…'
                        )
                      : row.review
                        ? translate(
                            'components.native-chat.relatedReviews.checks',
                            'Checks: {{status}}',
                            {
                              status:
                                row.review.checksAvailable === false
                                  ? translate(
                                      'components.native-chat.relatedReviews.unknown',
                                      'Unavailable'
                                    )
                                  : row.review.status === 'neutral'
                                    ? translate(
                                        'components.native-chat.relatedReviews.noChecks',
                                        'No checks'
                                      )
                                    : checksLabel(row.review.status)
                            }
                          )
                        : translate(
                            'components.native-chat.relatedReviews.unavailable',
                            'PR status unavailable. Check the hosting service connection and refresh.'
                          )}
                  </div>
                  {url && props.onSelectReview ? (
                    <Button
                      variant="ghost"
                      size="xs"
                      className="shrink-0"
                      aria-pressed={props.selectedKey === (url ?? row.key)}
                      aria-label={translate(
                        'components.native-chat.relatedReviews.detailsFor',
                        'View details for {{title}}',
                        { title: row.review?.title ?? label }
                      )}
                      onClick={() => props.onSelectReview?.(row)}
                    >
                      {translate('components.native-chat.relatedReviews.details', 'View details')}
                    </Button>
                  ) : null}
                </div>
              </div>
            )
          })}
          {props.loadingHistory ? (
            <p role="status" className="text-muted-foreground">
              {translate(
                'components.native-chat.relatedReviews.reading',
                'Reading earlier PR changes…'
              )}
            </p>
          ) : null}
          {props.lookupError ? (
            <p role="alert" className="text-muted-foreground">
              {translate(
                'components.native-chat.relatedReviews.lookupError',
                'Some PR updates could not be resolved. Check the hosting service connection and refresh.'
              )}
            </p>
          ) : null}
          {props.error ? (
            <p role="alert" className="text-muted-foreground">
              {translate(
                'components.native-chat.relatedReviews.partial',
                'Could not read all conversation history. Refresh to try again.'
              )}
            </p>
          ) : !props.loadingHistory && !props.rows.length ? (
            <p className="text-muted-foreground">
              {translate(
                'components.native-chat.relatedReviews.empty',
                'No PR creation or update was detected in this conversation.'
              )}
            </p>
          ) : null}
        </div>
      ) : null}
    </section>
  )
}
