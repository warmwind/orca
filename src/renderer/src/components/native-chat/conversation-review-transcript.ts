import type { NativeChatMessage } from '../../../../shared/native-chat/native-chat-types'
import { pairToolBlocks } from '../../../../shared/native-chat/tools/native-chat-tool-pairs'
import { conversationReviewMutations } from '../../../../shared/conversation-review-mutations'
import type { ConversationReviewEvidence } from './conversation-review-history'
import { mergeConversationReviewEvidence } from './conversation-review-history'
import { conversationQunliCardLinks } from '../../../../shared/conversation-qunli-card-links'

export function collectTranscriptQunliCardLinks(messages: readonly NativeChatMessage[]) {
  const blocks = messages
    .filter((message) => message.source === 'transcript')
    .flatMap((message) => message.blocks)
  return conversationQunliCardLinks(
    pairToolBlocks(blocks).flatMap(({ call, result }) => {
      if (
        !call ||
        !result ||
        result.isError ||
        call.endedAs ||
        (call.state && call.state !== 'completed')
      ) {
        return []
      }
      return [
        {
          ...call,
          kind: 'tool-call' as const,
          state: 'completed' as const,
          output: {
            head: result.output,
            byteLength: result.output.length,
            digest: '',
            truncated: false
          }
        }
      ]
    })
  )
}

export function collectTranscriptReviewMutations(
  messages: readonly NativeChatMessage[],
  directory?: string
): ConversationReviewEvidence[] {
  const transcript = messages.filter((message) => message.source === 'transcript')
  const positions = new Map(
    transcript.flatMap((message, index) =>
      message.blocks.map(
        (block) =>
          [
            block,
            {
              id: message.id,
              sequence:
                message.transcriptOrder ?? message.transcriptOffset ?? message.timestamp ?? index
            }
          ] as const
      )
    )
  )
  const evidence: ConversationReviewEvidence[] = []
  for (const { call, result } of pairToolBlocks(transcript.flatMap((message) => message.blocks))) {
    if (
      !call ||
      !result ||
      result.isError ||
      call.endedAs ||
      (call.state && call.state !== 'completed')
    ) {
      continue
    }
    const position = positions.get(call)!
    evidence.push(
      ...conversationReviewMutations(
        {
          ...call,
          kind: 'tool-call',
          state: 'completed',
          output: {
            head: result.output,
            byteLength: result.output.length,
            digest: '',
            truncated: false
          }
        },
        directory
      ).map((mutation) => ({
        ...mutation,
        operationKey: `${position.id}:${call.callId ?? call.name}`,
        sequence: position.sequence
      }))
    )
  }
  return mergeConversationReviewEvidence(evidence)
}

export type ConversationTranscriptPage =
  | { messages: NativeChatMessage[]; hasMore: boolean; beforeOffset: number }
  | { error: string }

export async function readConversationReviewTranscript(
  read: (beforeOffset?: number) => Promise<ConversationTranscriptPage>,
  signal: AbortSignal
): Promise<NativeChatMessage[]> {
  let beforeOffset: number | undefined
  let messages: NativeChatMessage[] = []
  while (!signal.aborted) {
    const page = await read(beforeOffset)
    if (signal.aborted) {
      return []
    }
    if ('error' in page) {
      throw new Error(page.error)
    }
    messages = [...page.messages, ...messages]
    if (!page.hasMore) {
      return messages
    }
    if (
      !Number.isSafeInteger(page.beforeOffset) ||
      page.beforeOffset < 0 ||
      (beforeOffset !== undefined && page.beforeOffset >= beforeOffset)
    ) {
      throw new Error('Could not finish reading conversation history.')
    }
    beforeOffset = page.beforeOffset
  }
  return []
}
