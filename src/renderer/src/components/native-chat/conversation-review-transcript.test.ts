import { describe, expect, it } from 'vitest'
import type { NativeChatMessage } from '../../../../shared/native-chat/native-chat-types'
import {
  collectTranscriptReviewMutations,
  collectTranscriptQunliCardLinks,
  readConversationReviewTranscript
} from './conversation-review-transcript'

function message(id: string, blocks: NativeChatMessage['blocks']): NativeChatMessage {
  return { id, role: 'assistant', source: 'transcript', blocks, timestamp: 1 }
}
function creation(repo: string, number: number): NativeChatMessage[] {
  const callId = `${repo}-${number}`
  return [
    message(callId, [
      {
        type: 'tool-call',
        name: 'Bash',
        callId,
        input: {
          command: `curl -X POST https://git.example.com/api/v1/repos/${repo}/pulls | python3 -c "print('response')"`
        }
      }
    ]),
    message(`${callId}-result`, [
      {
        type: 'tool-result',
        callId,
        output: `${number} https://git.example.com/${repo}/pulls/${number}`
      }
    ])
  ]
}
describe('terminal chat conversation reviews', () => {
  it('pairs a Qunli comment write with its result to recover a card-to-PR association', () => {
    const call = message('qunli-call', [
      {
        type: 'tool-call',
        name: 'mcp__claude_ai_Qunli__add_comment',
        callId: 'qunli',
        input: {
          account_id: '2025',
          recording_id: 'T18033',
          text: 'PR https://git.example.com/jiri/jiri/pulls/349'
        }
      }
    ])
    const result = message('qunli-result', [
      { type: 'tool-result', callId: 'qunli', output: '{"ok":true}' }
    ])
    expect(collectTranscriptQunliCardLinks([call, result])).toEqual({
      'https://git.example.com/jiri/jiri/pulls/349': ['https://qunli.co/2025/T18033']
    })
    expect(
      collectTranscriptQunliCardLinks([
        call,
        {
          ...result,
          blocks: [{ type: 'tool-result', callId: 'qunli', output: 'failed', isError: true }]
        }
      ])
    ).toEqual({})
  })
  it('finds multiple repositories from paired legacy tool calls and results, excluding prose and failures', () => {
    const messages = [
      ...creation('jiri/jiri', 349),
      ...creation('jinshuju/goldendata', 272),
      ...creation('jiri/jiri', 356)
    ]
    messages.push(
      message('mention', [
        { type: 'text', text: 'See https://git.example.com/jiri/jiri/pulls/999' }
      ])
    )
    const failed = creation('other/repo', 99)
    failed[1].blocks = [
      {
        type: 'tool-result',
        callId: 'other/repo-99',
        output: '99 https://git.example.com/other/repo/pulls/99',
        isError: true
      }
    ]
    expect(
      collectTranscriptReviewMutations([...messages, ...failed]).map((entry) => entry.lookup)
    ).toEqual([
      { url: 'https://git.example.com/jiri/jiri/pulls/349' },
      { url: 'https://git.example.com/jinshuju/goldendata/pulls/272' },
      { url: 'https://git.example.com/jiri/jiri/pulls/356' }
    ])
  })
  it('pairs call ids across pages and ignores unmatched or non-transcript outputs', async () => {
    const [call, result] = creation('jiri/jiri', 356)
    const reads: (number | undefined)[] = []
    const messages = await readConversationReviewTranscript(async (beforeOffset) => {
      reads.push(beforeOffset)
      return beforeOffset === undefined
        ? { messages: [result], hasMore: true, beforeOffset: 100 }
        : { messages: [call], hasMore: false, beforeOffset: 0 }
    }, new AbortController().signal)
    expect(reads).toEqual([undefined, 100])
    expect(collectTranscriptReviewMutations(messages)).toHaveLength(1)
    expect(collectTranscriptReviewMutations([result])).toEqual([])
    expect(collectTranscriptReviewMutations([call, { ...result, source: 'scrape' }])).toEqual([])
  })
  it('stops repeated cursors instead of claiming complete history', async () => {
    await expect(
      readConversationReviewTranscript(
        async () => ({ messages: [], hasMore: true, beforeOffset: 100 }),
        new AbortController().signal
      )
    ).rejects.toThrow('Could not finish')
  })
})
