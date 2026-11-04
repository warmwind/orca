import type { AgentJournalRenderItem } from '../../../../shared/agent-session/journal/agent-session-journal-types'
import type {
  AgentSessionHistoryRequest,
  AgentSessionHistoryResult
} from '../../../../shared/agent-session/agent-session-wire'
import {
  conversationReviewMutations,
  type ConversationReviewMutation
} from '../../../../shared/conversation-review-mutations'
import { conversationQunliCardLinks } from '../../../../shared/conversation-qunli-card-links'

export function collectConversationQunliCardLinks(items: readonly AgentJournalRenderItem[]) {
  return conversationQunliCardLinks(
    items.flatMap((item) => (item.body.kind === 'tool-call' ? [item.body] : []))
  )
}

export type ConversationReviewEvidence = ConversationReviewMutation & {
  operationKey: string
  sequence: number
}

const evidenceByItem = new WeakMap<
  AgentJournalRenderItem,
  {
    directory: string | undefined
    evidence: ConversationReviewEvidence[]
  }
>()

export function mergeConversationReviewEvidence(
  evidence: readonly ConversationReviewEvidence[]
): ConversationReviewEvidence[] {
  const result = new Map<string, ConversationReviewEvidence>()
  for (const mutation of [...evidence].sort((a, b) => a.sequence - b.sequence)) {
    const key = JSON.stringify(mutation.lookup)
    const prior = result.get(key)
    result.set(key, {
      ...mutation,
      action: prior?.action === 'created' ? 'created' : mutation.action
    })
  }
  return [...result.values()]
}

export function collectConversationReviewMutations(
  items: readonly AgentJournalRenderItem[],
  defaultDirectory?: string
): ConversationReviewEvidence[] {
  const result: ConversationReviewEvidence[] = []
  for (const item of items) {
    if (item.body.kind !== 'tool-call') {
      continue
    }
    const cached = evidenceByItem.get(item)
    if (cached && cached.directory === defaultDirectory) {
      result.push(...cached.evidence)
      continue
    }
    const evidence = conversationReviewMutations(item.body, defaultDirectory).map((mutation) => ({
      ...mutation,
      operationKey: `${item.itemId}:${item.revision}`,
      sequence: item.sequence
    }))
    evidenceByItem.set(item, { directory: defaultDirectory, evidence })
    result.push(...evidence)
  }
  return mergeConversationReviewEvidence(result)
}

/** Read the saved journal so off-screen writes and earlier pages survive reopening the chat. */
export async function readConversationReviewHistory(
  sessionId: string,
  read: (request: AgentSessionHistoryRequest) => Promise<AgentSessionHistoryResult>,
  signal: AbortSignal,
  publish: (items: readonly AgentJournalRenderItem[]) => void
): Promise<void> {
  let request: AgentSessionHistoryRequest = { sessionId, direction: 'tail', limit: 200 }
  let epoch: string | null = null
  for (;;) {
    if (signal.aborted) {
      return
    }
    const result = await read(request)
    if (signal.aborted) {
      return
    }
    const page = result.page
    if (!result.ok || page.sessionId !== sessionId || (epoch !== null && page.epoch !== epoch)) {
      throw new Error('Conversation history changed. Refresh the PR list.')
    }
    epoch = page.epoch
    publish(page.items)
    if (!page.hasOlder) {
      return
    }
    const cursor = page.window.oldest
    if (
      !cursor ||
      cursor.epoch !== epoch ||
      (request.cursor && cursor.sequence >= request.cursor.sequence)
    ) {
      throw new Error('Could not finish reading conversation history.')
    }
    request = { sessionId, direction: 'before', cursor, limit: 200 }
  }
}
