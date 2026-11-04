import { useEffect, useState } from 'react'
import type { AgentJournalRenderItem } from '../../../../shared/agent-session/journal/agent-session-journal-types'
import type { RuntimeClientTarget } from '../../../../shared/runtime-client-target'
import {
  useConversationReviews,
  type ConversationReviewTranscript
} from './use-conversation-reviews'
import { NativeChatRelatedReviewsPanel } from './NativeChatRelatedReviewsPanel'
import { useAppStore } from '@/store'
import {
  publishConversationReviewScope,
  clearConversationReviewScope
} from './conversation-review-scope'

export function NativeChatRelatedReviews(props: {
  sessionId: string
  target: RuntimeClientTarget
  items: readonly AgentJournalRenderItem[]
  isVisible: boolean
  directory?: string
  transcript?: ConversationReviewTranscript
}): React.JSX.Element {
  const [expanded, setExpanded] = useState(false)
  const sidebarOpen = useAppStore(
    (state) => state.rightSidebarOpen && state.rightSidebarTab === 'checks'
  )
  const reviews = useConversationReviews({
    ...props,
    open: props.isVisible && (expanded || sidebarOpen)
  })
  const { rows, loadingHistory, error, lookupError, refresh } = reviews
  const scopeKey = JSON.stringify([
    props.target,
    props.transcript?.agent ?? 'structured',
    props.sessionId
  ])
  useEffect(() => {
    if (props.isVisible) {
      publishConversationReviewScope({
        key: scopeKey,
        sessionId: props.sessionId,
        target: props.target,
        rows,
        loadingHistory,
        error,
        lookupError,
        refresh
      })
    }
  }, [
    props.isVisible,
    props.sessionId,
    props.target,
    scopeKey,
    rows,
    loadingHistory,
    error,
    lookupError,
    refresh
  ])
  useEffect(() => () => clearConversationReviewScope(scopeKey), [scopeKey, props.isVisible])
  return (
    <NativeChatRelatedReviewsPanel
      {...reviews}
      expanded={expanded}
      onToggle={() => setExpanded(!expanded)}
      onRefresh={reviews.refresh}
    />
  )
}
