import { useState } from 'react'
import type { ConversationReviewScope } from '../../native-chat/conversation-review-scope'
import {
  NativeChatRelatedReviewsPanel,
  conversationReviewAddress
} from '../../native-chat/NativeChatRelatedReviewsPanel'
import type { ConversationReviewRow } from '../../native-chat/use-conversation-reviews'
import { useGiteaReviewUrlDetails } from './use-gitea-review-details'
import { GiteaReviewPanel } from './gitea-review-panel'
import { translate } from '@/i18n/i18n'

export function ConversationReviewsSidebar({
  scope,
  visible
}: {
  scope: ConversationReviewScope
  visible: boolean
}): React.JSX.Element {
  const [selectedUrl, setSelectedUrl] = useState<string | null>(null)
  const [expanded, setExpanded] = useState(true)
  const selected =
    scope.rows.find((row) => conversationReviewAddress(row).url === selectedUrl) ??
    scope.rows.find((row) => conversationReviewAddress(row).url)
  const url = selected ? conversationReviewAddress(selected).url : null
  return (
    <div className="flex min-h-0 flex-1 flex-col" data-conversation-reviews-sidebar="">
      <NativeChatRelatedReviewsPanel
        rows={scope.rows}
        loadingHistory={scope.loadingHistory}
        error={scope.error}
        lookupError={scope.lookupError}
        expanded={expanded}
        selectedKey={url ?? undefined}
        onToggle={() => setExpanded((value) => !value)}
        onRefresh={scope.refresh}
        onSelectReview={(row) => setSelectedUrl(conversationReviewAddress(row).url)}
      />
      {selected && url ? (
        <ConversationReviewDetails
          key={url}
          scope={scope}
          row={selected}
          url={url}
          visible={visible}
        />
      ) : null}
    </div>
  )
}

function ConversationReviewDetails({
  scope,
  row,
  url,
  visible
}: {
  scope: ConversationReviewScope
  row: ConversationReviewRow
  url: string
  visible: boolean
}): React.JSX.Element {
  const state = useGiteaReviewUrlDetails(scope.target, url, visible)
  const review = state.data?.review ?? row.review
  return review ? (
    <GiteaReviewPanel review={review} state={state} qunliCardUrls={row.qunliCardUrls} />
  ) : (
    <div className="space-y-2 p-3 text-xs text-muted-foreground" role="status">
      {state.error ??
        translate('components.native-chat.relatedReviews.loading', 'Loading PR status…')}
    </div>
  )
}
