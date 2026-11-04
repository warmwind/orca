import { useCallback, useEffect, useMemo, useState } from 'react'
import type { AgentJournalRenderItem } from '../../../../shared/agent-session/journal/agent-session-journal-types'
import type { AgentSessionHistoryResult } from '../../../../shared/agent-session/agent-session-wire'
import type { RuntimeClientTarget } from '../../../../shared/runtime-client-target'
import type { HostedReviewInfo } from '../../../../shared/source-control/hosted-review/hosted-review-contracts'
import { PrioritySemaphore } from '../../../../shared/priority-semaphore'
import { callRuntimeRpc } from '@/runtime/runtime-rpc-client'
import {
  collectConversationReviewMutations,
  readConversationReviewHistory,
  mergeConversationReviewEvidence,
  collectConversationQunliCardLinks,
  type ConversationReviewEvidence
} from './conversation-review-history'
import { createHoverPreviewCache } from './native-chat-hover-preview-cache'
import type { AgentType } from '../../../../shared/agent-status/contracts/agent-status-types'
import type { NativeChatMessage } from '../../../../shared/native-chat/native-chat-types'
import {
  collectTranscriptReviewMutations,
  collectTranscriptQunliCardLinks,
  readConversationReviewTranscript,
  type ConversationTranscriptPage
} from './conversation-review-transcript'
import {
  mergeConversationQunliCardLinks,
  type ConversationQunliCardLinks
} from '../../../../shared/conversation-qunli-card-links'

export type ConversationReviewTranscript = {
  agent: AgentType
  transcriptPath?: string | null
  messages: readonly NativeChatMessage[]
}

export type ConversationReviewRow = ConversationReviewEvidence & {
  key: string
  review: HostedReviewInfo | null
  loading: boolean
  qunliCardUrls?: readonly string[]
}

const reads = new PrioritySemaphore(3)
const previews = createHoverPreviewCache<HostedReviewInfo>({ freshMs: 60_000, maxEntries: 200 })

export function useConversationReviews({
  sessionId,
  target,
  items,
  open,
  directory,
  transcript
}: {
  sessionId: string
  target: RuntimeClientTarget
  items: readonly AgentJournalRenderItem[]
  open: boolean
  directory?: string
  transcript?: ConversationReviewTranscript
}) {
  const [saved, setSaved] = useState<readonly ConversationReviewEvidence[]>([])
  const [savedCards, setSavedCards] = useState<ConversationQunliCardLinks>({})
  const [loadingHistory, setLoadingHistory] = useState(false)
  const [error, setError] = useState(false)
  const [lookupError, setLookupError] = useState(false)
  const [refresh, setRefresh] = useState(0)
  const [answers, setAnswers] = useState<Record<string, HostedReviewInfo | null>>({})
  const environmentId = target.kind === 'local' ? null : target.environmentId
  const readTarget = useMemo<RuntimeClientTarget>(
    () => (environmentId === null ? { kind: 'local' } : { kind: 'environment', environmentId }),
    [environmentId]
  )
  const transcriptAgent = transcript?.agent
  const transcriptPath = transcript?.transcriptPath
  useEffect(() => {
    if (!open) {
      return
    }
    const controller = new AbortController()
    setLoadingHistory(true)
    setError(false)
    let found: ConversationReviewEvidence[] = []
    let cards: ConversationQunliCardLinks = {}
    const readHistory = transcriptAgent
      ? sessionId
        ? readConversationReviewTranscript(
            (beforeOffset) =>
              callRuntimeRpc<ConversationTranscriptPage>(
                readTarget,
                'nativeChat.readSession',
                {
                  agent: transcriptAgent,
                  sessionId,
                  transcriptPath: transcriptPath ?? undefined,
                  limit: 500,
                  beforeOffset,
                  capabilities: { transcriptSourceOrder: 1 }
                },
                { signal: controller.signal }
              ),
            controller.signal
          ).then((messages) => {
            if (!controller.signal.aborted) {
              setSaved(collectTranscriptReviewMutations(messages, directory))
              setSavedCards(collectTranscriptQunliCardLinks(messages))
            }
          })
        : Promise.resolve()
      : readConversationReviewHistory(
          sessionId,
          (request) =>
            callRuntimeRpc<AgentSessionHistoryResult>(readTarget, 'agentSession.history', request, {
              signal: controller.signal
            }),
          controller.signal,
          (page) => {
            found = mergeConversationReviewEvidence([
              ...found,
              ...collectConversationReviewMutations(page, directory)
            ])
            setSaved(found)
            cards = mergeConversationQunliCardLinks(cards, collectConversationQunliCardLinks(page))
            setSavedCards(cards)
          }
        )
    void readHistory
      .catch(() => {
        if (!controller.signal.aborted) {
          setError(true)
        }
      })
      .finally(() => {
        if (!controller.signal.aborted) {
          setLoadingHistory(false)
        }
      })
    return () => controller.abort()
  }, [open, sessionId, readTarget, refresh, directory, transcriptAgent, transcriptPath])
  const transcriptMessages = transcript?.messages
  const relatedCards = useMemo(
    () =>
      mergeConversationQunliCardLinks(
        savedCards,
        transcriptMessages
          ? collectTranscriptQunliCardLinks(transcriptMessages)
          : collectConversationQunliCardLinks(items)
      ),
    [savedCards, transcriptMessages, items]
  )
  const mutations = useMemo(() => {
    return mergeConversationReviewEvidence([
      ...saved,
      ...(transcriptMessages
        ? collectTranscriptReviewMutations(transcriptMessages, directory)
        : collectConversationReviewMutations(items, directory))
    ])
  }, [items, saved, directory, transcriptMessages])
  const mutationKey = JSON.stringify(mutations)
  useEffect(() => {
    if (!open) {
      return
    }
    const controller = new AbortController()
    setAnswers({})
    setLookupError(false)
    const queries: ConversationReviewEvidence[] = JSON.parse(mutationKey)
    for (const mutation of queries) {
      const key = JSON.stringify(mutation.lookup)
      const read = async () => {
        const release = await reads.acquire(0, controller.signal)
        try {
          if (controller.signal.aborted) {
            return
          }
          const cacheKey = JSON.stringify([readTarget, sessionId, mutation, refresh])
          const review = await previews.load(cacheKey, () =>
            callRuntimeRpc<HostedReviewInfo | null>(
              readTarget,
              'hostedReview.conversationLookup',
              mutation.lookup
            )
          )
          if (!controller.signal.aborted) {
            setAnswers((prior) => ({ ...prior, [key]: review }))
          }
        } finally {
          release()
        }
      }
      void read().catch(() => {
        if (!controller.signal.aborted) {
          setAnswers((prior) => ({ ...prior, [key]: null }))
          setLookupError(true)
        }
      })
    }
    return () => controller.abort()
  }, [open, readTarget, sessionId, mutationKey, refresh])
  const rows = useMemo(() => {
    const rows = new Map<string, ConversationReviewRow>()
    const queries: ConversationReviewEvidence[] = JSON.parse(mutationKey)
    for (const mutation of queries) {
      const key = JSON.stringify(mutation.lookup)
      const review = answers[key] ?? null
      if ('remoteUrl' in mutation.lookup && !review) {
        continue
      }
      const identity = review?.url ?? key
      const prior = rows.get(identity)
      rows.set(identity, {
        ...mutation,
        action: prior?.action === 'created' ? 'created' : mutation.action,
        key: identity,
        review,
        qunliCardUrls: relatedCards[identity],
        loading: !Object.hasOwn(answers, key)
      })
    }
    return [...rows.values()]
  }, [mutationKey, answers, relatedCards])
  return {
    rows,
    loadingHistory,
    error,
    lookupError,
    refresh: useCallback(() => setRefresh((value) => value + 1), [])
  }
}
