import { create } from 'zustand'
import type { RuntimeClientTarget } from '../../../../shared/runtime-client-target'
import type { ConversationReviewRow } from './use-conversation-reviews'

export type ConversationReviewScope = {
  key: string
  sessionId: string
  target: RuntimeClientTarget
  rows: readonly ConversationReviewRow[]
  loadingHistory: boolean
  error: boolean
  lookupError: boolean
  refresh: () => void
}

export const useConversationReviewScope = create<{ active: ConversationReviewScope | null }>(
  () => ({ active: null })
)

export function publishConversationReviewScope(scope: ConversationReviewScope): void {
  useConversationReviewScope.setState({ active: scope })
}

export function clearConversationReviewScope(key: string): void {
  if (useConversationReviewScope.getState().active?.key === key) {
    useConversationReviewScope.setState({ active: null })
  }
}
